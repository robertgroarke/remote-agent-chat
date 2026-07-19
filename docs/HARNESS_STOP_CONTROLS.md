# Harness stop and goal-control parity

This table is the authoritative product contract for operator-initiated stop controls. A session
advertises `interrupt: true` only when its listed adapter can address that exact session. A control
must fail closed when the native target is absent, the session or turn generation is stale, or the
adapter cannot prove that work stopped. Remote Agent Chat never sends keys to an unowned TUI and
never reports an interrupt as completion.

| Session `agent_type` | Strongest safe stop ladder | Goal pause/resume | Production capability |
|---|---|---|---|
| `antigravity-v2` | Click the selected native page's visible Stop/Cancel control; require two consecutive idle observations | No | `interrupt: true`, `interrupt_method: native_stop` |
| `antigravity` | No verified session-scoped stop for this legacy surface | No | `interrupt: false`, gate `no_verified_session_scoped_stop` |
| `antigravity_panel` | No verified session-scoped stop for Antigravity Chat without risking the wrong right-hand pane | No | `interrupt: false`, gate `no_verified_session_scoped_stop` |
| `claude` | Selected Claude Code webview Stop/Interrupt control, with its native Escape DOM fallback; require two idle observations | No | `interrupt: true`, `interrupt_method: native_stop` |
| `claude_cli` | Stop only the RAC-owned native child process tree; externally owned CLI/TUI turns fail `interrupt_unavailable` | No | `interrupt: true`, `interrupt_method: owned_process_tree` |
| `claude-desktop` | Selected Claude Code desktop webview Stop/Interrupt control; require two idle observations | No | `interrupt: true`, `interrupt_method: native_stop` |
| `codex` | Selected Codex side-pane Stop control; require two idle observations | Native Pause/Resume DOM action plus authoritative state, objective, budget, generation, and fingerprint readback | `interrupt: true`, `goal_pause_resume: true` |
| `codex_cli` | Owned app-server `turn/interrupt`, falling back only to an RAC-owned process tree | Native app-server `thread/goal/get` and `thread/goal/set`, followed by authoritative readback | `interrupt: true`, `goal_pause_resume: true` |
| `codex-desktop` | Selected Codex Desktop page Stop control; require two idle observations | Native Pause/Resume DOM action plus authoritative readback | `interrupt: true`, `goal_pause_resume: true` |
| `continue` | Selected Continue webview Stop/Cancel control, including its generating-submit-button form; require two idle observations | No | `interrupt: true`, `interrupt_method: native_stop` |
| `continue_yolo` | Same selected Continue adapter and verification as `continue` | No | `interrupt: true`, `interrupt_method: native_stop` |
| `cursor` | Selected Cursor agent's native cancel control through the Cursor adapter; require two idle observations | No | `interrupt: true`, `interrupt_method: native_stop` |
| `cursor_cli` | Stop only the RAC-owned Cursor Agent process tree; externally owned CLI/TUI turns fail `interrupt_unavailable` | No | `interrupt: true`, `interrupt_method: owned_process_tree` |
| `gemini` | Selected Gemini Code Assist `Stop current request` control; require two idle observations | No | `interrupt: true`, `interrupt_method: native_stop` |
| `roo_code` | Selected Roo Code webview Stop/Cancel control; require two idle observations | No | `interrupt: true`, `interrupt_method: native_stop` |
| `cline` | Selected Cline webview through the Roo-compatible Stop/Cancel adapter; require two idle observations | No | `interrupt: true`, `interrupt_method: native_stop` |

## Exactly-once and state rules

- Web and Android include the relay-issued `connection_id`, the native-owner
  `session_generation`, and the authoritative goal or turn generation in every control.
- The relay atomically claims one semantic operation across tabs and devices. Concurrent requests
  coalesce to one upstream request; each requester receives a separately correlated terminal
  receipt. A repeated resolved request replays the receipt without another native operation.
- Goal operations additionally bind `goal_generation`, `goal_transition_seq`, and
  `goal_fingerprint`. Pause is legal only from `active`; resume is legal only from `paused`.
- Success requires `native_acknowledged: true`. The relay converts an unacknowledged nominal
  success to `native_receipt_missing`; its 15-second native timeout is retryable and truthful.
- Pause preserves objective and token budget, adds no transcript message, and emits no completion.
  Interrupt ends only the current turn, retains any active goal, and emits no completion.

## Executable evidence

- `node tools/goal-interrupt-control-smoke.js` proves Codex app-server and DOM pause/resume,
  objective/budget preservation, the 14-supported/2-gated capability matrix, owned-turn fail-close,
  one-operation interrupt, two-idle verification, goal retention, and zero false completions.
- `node tools/goal-control-relay-two-client-e2e.js` starts a hidden disposable relay and proves
  two-client coalescing for goal and interrupt controls, correlated receipts, double-click replay,
  stale connection/session rejection, and fail-closing when native acknowledgment is missing.
- `node tools/harness-stop-selector-smoke.js` exercises ten DOM selector families, the installed
  Cursor 3.5.33 trusted-click/settle fixture, all three owned CLI stop adapters, two-idle
  verification, and the two explicit legacy Antigravity gates (14 supported plus 2 gated).
- `npm run build` in `frontend` and a headless Android Expo export compile the Web and Android
  header/Fleet controls and their pending/receipt states.
