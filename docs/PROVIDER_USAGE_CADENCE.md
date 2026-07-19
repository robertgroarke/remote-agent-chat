# Provider usage refresh cadence

Provider quota collection is proxy-owned. Credentials and raw provider responses remain local; the relay receives only the bounded, redacted provider-usage snapshot.

## Cadence contract

| Provider | Cost class | Usage view open | Usage view closed | Guarded work |
|---|---|---:|---:|---:|
| OpenAI Codex | cheap local app-server/auth read | 60 s | 5 min | 5 min |
| Anthropic Claude | cheap OAuth read with guarded hidden-CLI fallback | 75 s | 5 min | CLI fallback no more than every 5 min |
| Cursor | cheap local auth + bounded API read | 60 s | 5 min | 5 min |
| Ollama | loopback runtime + read-only existing port-9240 page read | 90 s | 5 min | 5 min |
| Google Antigravity | guarded last-good quota cache | 5 min | 10 min | 5 min |

Every routine deadline has bounded 8% jitter. The Usage view sends a reference-counted watch subscription through the relay; the proxy applies the fast cadence while at least one Web or Android client is watching and returns to the idle cadence after the last watcher closes or disconnects. The local cost scan remains on its guarded five-minute schedule and is not amplified by the watch subscription.

Each account snapshot includes `next_refresh_at`, the active refresh interval, both fast and idle intervals, the cadence class, last attempt/success timestamps, and consecutive misses. The UI shows Updated age and the next refresh on every card. One miss retains bounded last-good data; two consecutive misses mark that card stale with the retained capture age and an explicit `two_consecutive_misses` reason.

Each provider card has a correlated **Refresh now** action. The proxy rate-limits that action per provider to one request every 30 seconds, preserves provider Retry-After/backoff, and returns an accepted/coalesced/completed/error receipt carrying the provider ID. Routine and manual work is single-flight per requested provider set.

## Acceptance evidence

Run from the repository root:

```powershell
node tools/provider-usage-live-cadence-smoke.js
node tools/provider-usage-registry-smoke.js
node tools/provider-usage-relay-e2e.js
node tools/usage-dashboard-browser-e2e.js
```

The deterministic live-cadence smoke simulates a Usage view held open for ten minutes, samples every provider once per minute, asserts cheap-source age never exceeds twice its documented live cadence, forces two consecutive failures, measures CPU/wall overhead, and records zero visible-window or focus actions.
