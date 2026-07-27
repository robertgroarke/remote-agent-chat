# LATENCY EPIC — WebUI ⇄ Agent round-trip feedback (operator-requested, 2026-07-24)

Operator report: significant lag between sending a message in the webui and
seeing agent feedback, far beyond the ~42 ms network ping each way. Goal:
faster, more *tactile* feedback — cut total send→first-feedback and
send→first-agent-output times, and make every waiting state visibly staged.

This epic is **instrumentation-first**: no cadence tuning may land before the
trace ledger (L0) exists, because the dominant stage is currently a hypothesis,
not a measurement. Operator closes; no self-closing bars.

## Architecture map (verified against source, 2026-07-24)

Send path:
browser (`frontend/hooks.jsx:1089`, WS `/client-ws`) → relay
(`relay-server/index.js`, WS push both directions; sqlite writes batched per
event-loop turn ~`index.js:1489` — sub-ms, not a suspect) → agent-proxy
(`agent-proxy/proxy-engine.js`) → harness surface (Codex CLI native send with
rollout-file receipt polling `agent-proxy/codex-cli.js:3611` @75 ms /
`:3630` @100 ms; desktop/webview surfaces via CDP).

Receive path:
harness UI/rollout → proxy transcript read → relay (instant WS broadcast) →
browser (push, no polling). The browser and relay are push-based; **the
proxy→harness boundary is where the latency lives.**

Known cadence facts (cite before changing):
- `proxy-engine.js:1120` `POLL_INTERVAL_MS = 1000`; main tick at `:21135`.
- Desktop apps (codex-desktop/cursor): 2 ticks active / 4 idle; **wedge
  backoff 15 ticks (~15 s) after 2 consecutive CDP timeouts**. Codex webview:
  3 active / 5 idle (`:21237-21274` region).
- The main poll loop is **serialized** — a slow CDP renderer stalls every
  session's tick and logs "Previous tick still running; skipped N tick(s)"
  (`:21137`).
- CDP DOM-push (`agent-proxy/cdp-dom-push.js`): MutationObserver, 50 ms
  debounce, triggers an immediate bounded poll via `_handleDomPush`
  (`proxy-engine.js:1366`) — sub-second when healthy. BUT fallback windows
  when the observer degrades: 5 s working / 30 s idle; observer-unavailable
  750 ms working / 5 s idle; error backoff 30–300 s. A silently dead observer
  turns a push surface into a 5–30 s poll surface.
- `codex_cli` sessions (the fleet TUI lanes) have **no DOM-push**; they ride
  the 1 s tick, plus send-side receipt handshake (native user-turn append
  observed in the rollout file before the send is confirmed; then
  `waitForCodexAgentStart` before "agent started" is surfaced).

## Work order

### L0 (P0) — End-to-end latency trace + evidence ledger. LAND FIRST.
Stamp a `trace_id` + monotonic stage timestamps onto one message's lifecycle:
`webui_send → relay_recv → proxy_recv → harness_delivered (native receipt) →
agent_first_output → relay_broadcast → webui_render`. Persist per-hop
rows to `data/latency-trace-ledger.jsonl` (append-only; reuse the existing
`source_at`/`cdpToQueueMs`/`bindingToProxyMs` fields already flowing through
dom-push events). Add a validator that computes p50/p95 per stage per
agentType from the ledger. **DoD:** a table from ≥20 real sends naming the
dominant stage per surface class (codex_cli lane, codex-desktop, webview).
No optimization may cite anything but this ledger as motivation.

#### L0 evidence admission and Phase 2 normalization

`tools/latency-trace-ledger-report.js` accepts one or more
`--sample-receipt <path>` arguments and fails closed. A row can rank only when
its receipt proves matching source/served builds, matching requested/observed
model and effort, the cheap-model policy, a unique privacy-clean session/turn
pair, a native causal match, a topology receipt, and a Web or Android evidence
consumer. A legacy non-zero `clock_adjustment_ms` clamp excludes the row.
Browser/Android and proxy heartbeats estimate their offset to the relay with
four-timestamp round-trip samples; every stage preserves its raw host epoch
beside its relay-adjusted epoch. Only complete, fresh `synchronized` samples
enter the relay-adjusted ranking bucket. Missing/stale samples, high RTT,
threshold-exceeded skew, domain mismatches and any adjusted stage regression
fail closed. Raw cross-host durations (including physically impossible negative
values) remain visible in a separate forensic bucket and never enter adjusted
percentiles. The report publishes
`included`, `provisional`, and `excluded` rows with reasons, but never content
or session identifiers.

The pre-P3-15 ledgers are not additive evidence. They were re-derived under
this policy in `phase3-p3-15-rederived-original-ledger.json` and
`phase3-p3-15-rederived-after-codex-cli-20.json`: every old measured row is
excluded and every dominant stage is withheld. New synchronized samples must
replace those rows before L0 can choose an optimization target.

Each required surface needs at least 20 included real sends and both values of
every representative topology dimension:

- session temperature: `cold`, `warm`
- transcript state: `short`, `long_resumed`
- delivery mode: `sequential`, `queued`
- connection state: `stable`, `reconnect_resync`
- traffic shape: `direct`, `goal_loop`
- evidence consumers across the cohort: `web`, `android`

Until all required surfaces pass together, `dominant_stage` is withheld and
`can_prioritize_p3_3` is false. The Phase 2 production scoreboard (`8cba60f4`)
and Continue distribution (`f556da6b`) are normalized as the composite
`agent_first_output → webui_render` span with original hashes and compatibility
verdicts. They cannot rank adjacent stages because they do not contain those
boundaries. The question-budget (`713cf02f`) and VS Code question-push evidence
remain explicit prompt-lifecycle references because their semantics are not an
L0 real-send stage.

### L1 (P1) — Kill the known structural stalls (each gated on L0 evidence).
- **Serialized tick contention:** bound per-session CDP read time and move
  slow window-group reads off the shared tick (per-group concurrency or
  deadline), so one pegged renderer can't add seconds to every other
  session's cadence. The skipped-ticks warning count in proxy logs is the
  before/after metric.
- **Dom-push observer health:** surface observer state per session in the
  proxy snapshot (healthy/fallback/backoff + age); auto-reinstall faster than
  the 30 s idle fallback when a remote user is actively viewing that session;
  alarm when a push surface silently degrades to polling.
- **Wedge backoff vs. remote-waiting:** when a remote user sent a message
  <60 s ago, cap effective poll interval at 1 tick for that session even
  under idle thresholds (never override the 15-tick wedge backoff — that
  protects a pegged renderer; instead surface "renderer wedged" to the webui
  so waiting is visible instead of mysterious).

### L2 (P1) — Event-driven "remote-waiting" fast path for codex_cli lanes.
The fleet TUI lanes are file-tailed at 1 s. After a remote send, switch that
session to a tight bounded fast-follow (rollout-file watcher or 100–250 ms
poll, like the existing Continue remote fast-poll pattern at
`proxy-engine.js:21114`) until the agent turn stabilizes, then decay back.
Budget: first agent output visible in the webui < 1 s after it hits the
rollout file.

### L3 (P2) — Tactile feedback in the webui (perceived latency).
- Optimistic local echo of the user's own message with staged state chips
  driven by the existing send-lifecycle receipts (`queued → delivered →
  agent started → responding`), so the user sees movement within ~100 ms even
  when the harness handshake takes seconds.
- Render `agent started` / thinking indicators from the receipt stream
  immediately, not on first transcript delta.
- Frontend render-path check: confirm no state-sequence gating batches
  incoming WS messages behind timers (`frontend/state-sequence.js`,
  `transcript-cache.js`); fix if found.

### L4 (P2) — SLO + regression gate.
Add p95 budgets per stage (proposal: webui→proxy ≤ 250 ms;
proxy→harness-delivered ≤ 1.5 s; first-output→webui ≤ 1 s) to the nightly
validation harness, failing on regression, with the L0 ledger as the source.

## Fences
- No focus stealing, ever (`Test-OperatorScreenProtected` honored; hidden
  windows only). No touching protected/live sessions for probes — owned
  disposable surfaces only.
- Don't break the exactly-once send/receipt contracts or transcript-fidelity
  validators; run the relevant `tools/*-validate-all.js` after each slice.
- Cadence numbers in this doc are code-verified but *impact* is unproven
  until L0 — do not tune constants ahead of the ledger.
- Commit per slice with evidence under `evidence/harness-maturity/`;
  do not push any remote.
