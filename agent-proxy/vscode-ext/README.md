# Remote Agent Proxy

Bridges your IDE agent webviews (Claude Code, Codex, Gemini) to the [Remote Agent Chat](https://github.com/yourname/remote-agent-chat) relay server via Chrome DevTools Protocol (CDP).

This extension replaces the standalone `agent-proxy` Node.js process — no background service, no scheduled task, no system tray app needed.

## How it works

1. The extension connects to agent webviews via CDP (Chrome DevTools Protocol)
2. It polls for new messages, detects thinking/generating state, and reads agent config
3. Everything is relayed to your relay server over a persistent WebSocket
4. You chat with your agents from your phone or any browser

## Setup

1. **Install the extension** — Extensions → `···` → Install from VSIX
2. **Configure settings** (Ctrl+, → search `remoteAgentProxy`):

| Setting | Description | Example |
|---|---|---|
| **Relay URL** | WebSocket URL of your relay server | `wss://agents.yourdomain.com/proxy-ws` |
| **Proxy Secret** | Shared secret (must match relay) | `pxy-abc123...` |
| **CDP Ports** | Comma-separated CDP ports | `9223` or `9223,9225` |
| **Machine Label** | Label for this machine (optional) | *(defaults to hostname)* |
| **Auto Start** | Start proxy on activation | `true` (default) |

3. **Launch Antigravity with CDP enabled** using `launch-antigravity-cdp.bat`

The proxy starts automatically. Look for the status indicator in the status bar.

## Status Bar

| Icon | Meaning |
|---|---|
| `$(broadcast) Proxy (N)` | Connected, N sessions active |
| `$(search) Proxy (discovering)` | Relay connected, scanning for agents |
| `$(debug-disconnect) Proxy (no relay)` | Running but relay not connected |
| `$(eye) Proxy (standby)` | Another window is the leader |
| `$(circle-slash) Proxy Off` | Proxy is stopped |

Click the status bar item for a quick menu (Stop, Restart, Show Logs).

## Multi-Window Support

Only one Antigravity window runs the proxy at a time (the "leader"). Other windows enter standby mode automatically. If the leader window is closed, a standby window takes over within 5–15 seconds.

## Commands

Open the Command Palette (Ctrl+Shift+P) and search for:

- **Remote Agent Proxy: Start** — start the proxy
- **Remote Agent Proxy: Stop** — stop the proxy
- **Remote Agent Proxy: Restart** — restart with current settings
- **Remote Agent Proxy: Show Logs** — open the output channel

## Standalone Mode vs VSIX

| | VSIX (this extension) | Standalone (`node index.js`) |
|---|---|---|
| **Install** | Install from VSIX, configure in Settings | Configure `.env`, run via Scheduled Task |
| **Status** | Status bar | System tray icon |
| **Multi-window** | Leader election with auto-failover | Single process only |
| **Always-on** | Only when Antigravity is open | Runs independently |
| **Best for** | Most users | Codex Desktop or always-on operation |

**Do not run both at once.** Disable the `agent-proxy-task` Scheduled Task before using this extension.
