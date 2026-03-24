# Remote Agent Chat Protocol

## Purpose

This document defines the shared protocol between:

- browser clients
- the relay server
- the Windows agent proxy

The protocol exists to replace heuristic transport behavior with explicit rules for:

- connection negotiation
- session lifecycle
- message delivery lifecycle
- replay and reconnect
- health reporting
- durable session metadata

## Scope

This protocol covers application-level JSON messages sent over WebSocket.

It does not define:

- OAuth or HTTP auth flows
- file upload HTTP transport details
- CDP internals
- frontend rendering behavior

## Protocol Version

- Current version: `1`
- Every WebSocket peer must declare `protocol_version` during connection setup.
- If versions are incompatible, the receiver must reply with an error and close the socket.

## Transport Rules

- All protocol frames are UTF-8 JSON objects.
- Every frame must include a top-level `type`.
- Unknown fields must be ignored unless marked as required by this spec.
- Unknown message `type` values must produce a protocol error event when practical.
- Timestamps use ISO 8601 UTC strings unless otherwise noted.

## Connection Roles

There are two WebSocket role pairings:

1. browser client <-> relay
2. proxy <-> relay

The relay is the protocol coordinator. Browser and proxy peers do not speak directly.

## Envelope

Every protocol message must include:

```json
{
  "type": "string",
  "protocol_version": 1
}
```

Optional common envelope fields:

```json
{
  "request_id": "uuid-or-stable-client-id",
  "connection_id": "relay-assigned-connection-id",
  "server_ts": "2026-03-19T10:15:30.000Z"
}
```

Field rules:

- `type`: required on every message
- `protocol_version`: required on every message
- `request_id`: required for request/response or send-lifecycle correlation where applicable
- `connection_id`: assigned by the relay after successful handshake
- `server_ts`: added by the relay on relay-originated events

## Core Identifiers

### Connection identifiers

- `connection_id`: relay-assigned ID for one active WebSocket connection

### Session identifiers

- `session_id`: durable logical session ID
- `target_id`: transient proxy-local CDP target identifier
- `target_signature`: proxy-generated stable-ish identity fingerprint used to match a discovered target back to an existing durable session

Rules:

- `session_id` must remain stable across reconnects when the proxy can confidently match the same logical agent session.
- `target_id` must never be exposed as the primary UI identifier.

### Message identifiers

- `client_message_id`: stable ID created by the browser for user-originated sends
- `message_id`: canonical ID for a message record in the relay ledger
- `event_id`: ID for one emitted event
- `sequence`: monotonic per-session event sequence

Rules:

- browser sends must include `client_message_id`
- the relay must store and upsert browser-originated sends by `client_message_id`
- the relay may set `message_id = client_message_id` for browser-originated messages if that simplifies the model
- every event emitted for a session must include `sequence`

## Session Metadata Contract

Every `session_up`, `session_snapshot`, and session-bearing history event should use this shape:

```json
{
  "session": {
    "session_id": "uuid",
    "agent_type": "claude|codex|gemini|unknown",
    "display_name": "Codex",
    "window_title": "repo-name",
    "workspace_name": "repo-name",
    "workspace_path": "C:\\\\Users\\\\Robert\\\\Documents\\\\Remote Agent Chat",
    "machine_label": "Robert-Windows",
    "target_signature": "sha-like-or-derived-string",
    "target_id": "transient-target-id",
    "last_seen_at": "2026-03-19T10:15:30.000Z",
    "status": "healthy|degraded|disconnected|scraping_failed|agent_ui_changed",
    "activity": {
      "kind": "thinking|generating|reading_files|running_command|applying_patch|waiting_for_user|idle",
      "label": "Thinking",
      "updated_at": "2026-03-19T10:15:30.000Z"
    }
  }
}
```

Required fields:

- `session_id`
- `agent_type`
- `status`

Recommended fields:

- `display_name`
- `window_title`
- `workspace_name`
- `workspace_path`
- `last_seen_at`

## Connection Lifecycle

### `connection_hello`

Sent by browser or proxy immediately after socket open.

Browser example:

```json
{
  "type": "connection_hello",
  "protocol_version": 1,
  "peer_role": "browser",
  "client_name": "webui",
  "client_version": "dev",
  "resume": {
    "sessions": [
      { "session_id": "sess_123", "last_sequence": 42 }
    ]
  }
}
```

Proxy example:

```json
{
  "type": "connection_hello",
  "protocol_version": 1,
  "peer_role": "proxy",
  "client_name": "agent-proxy",
  "client_version": "dev",
  "machine_label": "Robert-Windows"
}
```

Required fields:

- `peer_role`
- `client_name`

### `connection_ack`

Sent by relay in response to a valid `connection_hello`.

```json
{
  "type": "connection_ack",
  "protocol_version": 1,
  "connection_id": "conn_123",
  "server_ts": "2026-03-19T10:15:30.000Z",
  "heartbeat_interval_ms": 10000,
  "heartbeat_timeout_ms": 30000
}
```

### `connection_error`

Sent when the handshake or a later protocol operation is invalid.

```json
{
  "type": "connection_error",
  "protocol_version": 1,
  "code": "protocol_version_unsupported",
  "message": "Expected protocol_version 1"
}
```

## Heartbeat And Health

### `heartbeat`

Sent periodically by browser and proxy after `connection_ack`.

```json
{
  "type": "heartbeat",
  "protocol_version": 1,
  "request_id": "hb_123",
  "connection_id": "conn_123",
  "client_ts": "2026-03-19T10:15:30.000Z"
}
```

### `heartbeat_ack`

Sent in reply to `heartbeat`.

```json
{
  "type": "heartbeat_ack",
  "protocol_version": 1,
  "request_id": "hb_123",
  "connection_id": "conn_123",
  "server_ts": "2026-03-19T10:15:31.000Z"
}
```

Rules:

- peers should send heartbeats on the interval provided by `connection_ack`
- the relay should mark a connection stale if no heartbeat or other message arrives before `heartbeat_timeout_ms`
- session health must be derived separately from socket liveness when needed

## Session Lifecycle Events

### `session_snapshot`

Sent by relay to browser after handshake or reconnect resume.

```json
{
  "type": "session_snapshot",
  "protocol_version": 1,
  "sessions": [
    {
      "session_id": "sess_123",
      "agent_type": "codex",
      "display_name": "Codex",
      "workspace_name": "Remote Agent Chat",
      "status": "healthy"
    }
  ]
}
```

Rules:

- replaces the old `session_list` shape
- includes metadata, not just IDs

### `session_up`

Sent by relay when a logical session becomes available or resumes.

```json
{
  "type": "session_up",
  "protocol_version": 1,
  "event_id": "evt_123",
  "sequence": 43,
  "session": {
    "session_id": "sess_123",
    "agent_type": "codex",
    "status": "healthy"
  }
}
```

### `session_down`

Sent by relay when a logical session becomes unavailable.

```json
{
  "type": "session_down",
  "protocol_version": 1,
  "event_id": "evt_124",
  "sequence": 44,
  "session_id": "sess_123",
  "reason": "proxy_disconnected"
}
```

### `session_status`

Sent by relay when health or activity changes.

```json
{
  "type": "session_status",
  "protocol_version": 1,
  "event_id": "evt_125",
  "sequence": 45,
  "session_id": "sess_123",
  "status": "degraded",
  "activity": {
    "kind": "thinking",
    "label": "Thinking",
    "updated_at": "2026-03-19T10:16:00.000Z"
  }
}
```

## Browser Send Lifecycle

### `send_message`

Sent by browser to relay when the user sends content.

```json
{
  "type": "send_message",
  "protocol_version": 1,
  "client_message_id": "msg_cli_123",
  "session_id": "sess_123",
  "content": "Please review this file",
  "attachments": [
    {
      "attachment_id": "att_123",
      "name": "Screenshot.png",
      "kind": "uploaded_file"
    }
  ],
  "created_at": "2026-03-19T10:16:30.000Z"
}
```

Required fields:

- `client_message_id`
- `session_id`
- at least one of `content` or `attachments`
- `created_at`

Rules:

- the browser must generate `client_message_id` before sending
- retries from the browser must reuse the same `client_message_id`
- the relay must treat `client_message_id` as idempotent for browser-originated sends

## Message Delivery State Model

Allowed terminal and non-terminal states:

- `queued`
- `accepted`
- `delivered`
- `failed`

Optional internal state:

- `sending_to_proxy`

State transition rules:

1. browser creates local pending message and sends `send_message`
2. relay records message as `queued`
3. relay emits `message_accepted` after durable acceptance
4. proxy attempts injection
5. relay emits `message_delivered` or `message_failed`

Rules:

- `accepted` means the relay durably accepted the send request
- `delivered` means the proxy successfully injected the message into the agent UI
- `failed` means the relay or proxy has determined the send cannot currently be completed
- an implementation may keep scraping the echoed user message for history accuracy, but delivery state must not depend on scrape echo

## Message Lifecycle Events

### `message_accepted`

Sent by relay to browser after it durably accepts a browser-originated send.

```json
{
  "type": "message_accepted",
  "protocol_version": 1,
  "event_id": "evt_126",
  "sequence": 46,
  "session_id": "sess_123",
  "message_id": "msg_cli_123",
  "client_message_id": "msg_cli_123",
  "status": "accepted",
  "accepted_at": "2026-03-19T10:16:31.000Z"
}
```

### `message_delivered`

Sent when the proxy reports successful injection.

```json
{
  "type": "message_delivered",
  "protocol_version": 1,
  "event_id": "evt_127",
  "sequence": 47,
  "session_id": "sess_123",
  "message_id": "msg_cli_123",
  "client_message_id": "msg_cli_123",
  "status": "delivered",
  "delivered_at": "2026-03-19T10:16:32.000Z"
}
```

### `message_failed`

Sent when the relay or proxy determines the send failed.

```json
{
  "type": "message_failed",
  "protocol_version": 1,
  "event_id": "evt_128",
  "sequence": 48,
  "session_id": "sess_123",
  "message_id": "msg_cli_123",
  "client_message_id": "msg_cli_123",
  "status": "failed",
  "failed_at": "2026-03-19T10:16:35.000Z",
  "error": {
    "code": "session_not_connected",
    "message": "Session is not currently connected"
  }
}
```

### `message_event`

Used for actual conversation transcript records coming from relay history or proxy scraping.

```json
{
  "type": "message_event",
  "protocol_version": 1,
  "event_id": "evt_129",
  "sequence": 49,
  "session_id": "sess_123",
  "message": {
    "message_id": "msg_srv_456",
    "role": "assistant",
    "content": "I updated the file.",
    "created_at": "2026-03-19T10:17:10.000Z"
  }
}
```

Rules:

- `message_event` is for transcript content
- `message_accepted`, `message_delivered`, and `message_failed` are transport/delivery lifecycle events
- the frontend should merge both into one per-session model without assuming they are the same record type

## History And Replay

### `history_request`

Sent by browser to relay when it needs snapshot or replay data.

```json
{
  "type": "history_request",
  "protocol_version": 1,
  "session_id": "sess_123",
  "after_sequence": 42
}
```

Rules:

- omit `after_sequence` to request a full snapshot
- include `after_sequence` to request deltas after reconnect

### `history_snapshot`

Sent by relay when returning the full known transcript for a session.

```json
{
  "type": "history_snapshot",
  "protocol_version": 1,
  "session_id": "sess_123",
  "last_sequence": 49,
  "messages": [
    {
      "message_id": "msg_srv_111",
      "role": "user",
      "content": "hello",
      "created_at": "2026-03-19T10:00:00.000Z"
    }
  ]
}
```

### `history_delta`

Sent by relay when returning only events after a known sequence.

```json
{
  "type": "history_delta",
  "protocol_version": 1,
  "session_id": "sess_123",
  "from_sequence": 42,
  "last_sequence": 49,
  "events": [
    {
      "type": "message_event",
      "event_id": "evt_129",
      "sequence": 49,
      "session_id": "sess_123",
      "message": {
        "message_id": "msg_srv_456",
        "role": "assistant",
        "content": "I updated the file.",
        "created_at": "2026-03-19T10:17:10.000Z"
      }
    }
  ]
}
```

Rules:

- `sequence` must be monotonic per session
- `history_delta` may contain lifecycle events and transcript events if the frontend needs both to recover state

## Proxy-Originated Events

### `proxy_session_snapshot`

Sent by proxy to relay after handshake and whenever rediscovery materially changes known sessions.

```json
{
  "type": "proxy_session_snapshot",
  "protocol_version": 1,
  "sessions": [
    {
      "session_id": "sess_123",
      "agent_type": "codex",
      "target_signature": "sig_abc",
      "window_title": "Remote Agent Chat",
      "workspace_name": "Remote Agent Chat",
      "status": "healthy"
    }
  ]
}
```

### `proxy_message`

Sent by proxy to relay when the proxy observes transcript content.

```json
{
  "type": "proxy_message",
  "protocol_version": 1,
  "session_id": "sess_123",
  "message": {
    "role": "assistant",
    "content": "Done.",
    "created_at": "2026-03-19T10:17:10.000Z"
  }
}
```

### `proxy_send_result`

Sent by proxy in response to a relay-forwarded send request.

```json
{
  "type": "proxy_send_result",
  "protocol_version": 1,
  "session_id": "sess_123",
  "client_message_id": "msg_cli_123",
  "result": "delivered",
  "delivered_at": "2026-03-19T10:16:32.000Z"
}
```

Failure example:

```json
{
  "type": "proxy_send_result",
  "protocol_version": 1,
  "session_id": "sess_123",
  "client_message_id": "msg_cli_123",
  "result": "failed",
  "failed_at": "2026-03-19T10:16:35.000Z",
  "error": {
    "code": "send_button_not_found",
    "message": "Could not locate the active send button"
  }
}
```

### `proxy_status`

Sent by proxy when session health or activity changes.

```json
{
  "type": "proxy_status",
  "protocol_version": 1,
  "session_id": "sess_123",
  "status": "degraded",
  "activity": {
    "kind": "thinking",
    "label": "Thinking",
    "updated_at": "2026-03-19T10:18:00.000Z"
  }
}
```

## Session Management

This section defines the protocol for launching new agent sessions and closing existing ones remotely from the browser, without physical access to the dev machine.

### Session Launch Lifecycle

```
browser                 relay                   proxy
  |                       |                       |
  |-- launch_session ---> |                       |
  |                       |-- launch_session -->  |
  | <-- session_launching |                       |
  |                       |           [CDP: inject "New Chat" click]
  |                       |           [poll CDP targets for new session]
  |                       | <-- session_launch_ack (or _failed) --
  | <-- session_launch_ack (or _failed) -------> |
  |  [new session card appears in sidebar]        |
```

State machine for a launch request:

```
pending → launched   (proxy found a new session within timeout)
        → failed     (proxy rejected, timeout exceeded, or no proxy)
```

The relay owns the pending-request store. Each in-flight request is keyed by `request_id`. If the browser disconnects and reconnects while a request is still pending, the relay re-sends `session_launching` in the `connection_ack` payload so the browser can resume the pending state.

### `launch_session`

Sent by browser to relay. Relay forwards to proxy unchanged (after auth check).

```json
{
  "type": "launch_session",
  "protocol_version": 1,
  "request_id": "launch_abc123",
  "agent_type": "claude",
  "workspace_path": "C:\\Users\\Robert\\Documents\\Remote Agent Chat",
  "window_title": "Remote Agent Chat"
}
```

Required fields:

- `request_id`: stable ID generated by the browser; used to correlate ack/failure back to this request
- `agent_type`: one of `"claude"`, `"codex"`, `"gemini"`

Optional fields:

- `workspace_path`: if provided, the proxy should attempt to navigate the new session to this directory after launch (best-effort)
- `window_title`: hint for the new session's display name

Rules:

- the relay must reject `launch_session` commands from unauthenticated browser sockets and emit `session_launch_failed` with `error_code: "unauthorized"`
- the relay must emit `session_launch_failed` immediately with `error_code: "no_proxy_connected"` if no proxy socket is active at the time the command arrives
- the relay must record the pending request and start a timeout timer (default 30 s)
- the relay must forward `launch_session` to the proxy only if a proxy socket is active

### `session_launching`

Sent by relay to the requesting browser immediately after forwarding the command to the proxy. This is an intermediate state event — it allows the browser to show a "starting…" indicator before the final ack or failure arrives.

```json
{
  "type": "session_launching",
  "protocol_version": 1,
  "request_id": "launch_abc123",
  "agent_type": "claude",
  "server_ts": "2026-03-19T10:20:00.000Z"
}
```

Rules:

- only sent to the browser that issued the `launch_session` command, not broadcast
- also re-sent as part of `connection_ack` payload if the browser reconnects while the request is still in-flight:

```json
{
  "type": "connection_ack",
  "protocol_version": 1,
  "pending_launches": [
    {
      "request_id": "launch_abc123",
      "agent_type": "claude",
      "launched_at": "2026-03-19T10:20:00.000Z",
      "timeout_at": "2026-03-19T10:20:30.000Z"
    }
  ]
}
```

### `session_launch_ack`

Sent by proxy to relay once it has confirmed a new session is registered. Relay forwards to the requesting browser.

```json
{
  "type": "session_launch_ack",
  "protocol_version": 1,
  "request_id": "launch_abc123",
  "session_id": "sess_new456",
  "agent_type": "claude",
  "server_ts": "2026-03-19T10:20:08.000Z"
}
```

Required fields:

- `request_id`: must match the original `launch_session` request
- `session_id`: the durable session ID of the newly registered session

Rules:

- the relay must clear the pending launch record on receipt
- the relay must forward `session_launch_ack` to the browser that originated the request
- the relay must also emit a `session_up` or update the `session_snapshot` for the new session so all connected browsers see it (not just the requesting browser)
- if the requesting browser has disconnected before `session_launch_ack` arrives, the relay should hold it until that browser reconnects (same window as the pending-request store)

### `session_launch_failed`

Sent by proxy to relay if the launch could not complete. Also sent directly by relay if no proxy is connected or the timeout elapses. Relay forwards to the requesting browser.

```json
{
  "type": "session_launch_failed",
  "protocol_version": 1,
  "request_id": "launch_abc123",
  "agent_type": "claude",
  "reason": "Antigravity is not running",
  "error_code": "agent_not_open",
  "server_ts": "2026-03-19T10:20:30.000Z"
}
```

Required fields:

- `request_id`
- `error_code`: machine-readable failure reason (see error codes)
- `reason`: human-readable explanation suitable for display in a toast

Rules:

- the relay must clear the pending launch record on emit
- the relay auto-emits this event with `error_code: "launch_timeout"` if the proxy does not respond within the timeout window

### `close_session`

Sent by browser to relay. Relay forwards to the proxy that owns the target session.

```json
{
  "type": "close_session",
  "protocol_version": 1,
  "request_id": "close_xyz789",
  "session_id": "sess_123"
}
```

Required fields:

- `request_id`
- `session_id`

Rules:

- the relay must reject `close_session` from unauthenticated browsers
- the relay must emit `session_launch_failed` (using a `close_session_failed` analog in future) if the session is not currently in the relay's registry; for now return `connection_error` with `code: "session_unknown"`
- the relay forwards the command to the proxy socket registered for `session_id`

### `session_closed`

Sent by proxy to relay after the session's CDP target is successfully closed. Relay broadcasts to all connected browsers.

```json
{
  "type": "session_closed",
  "protocol_version": 1,
  "request_id": "close_xyz789",
  "session_id": "sess_123",
  "reason": "user_requested",
  "server_ts": "2026-03-19T10:21:00.000Z"
}
```

Required fields:

- `session_id`

Optional fields:

- `request_id`: present when the close was initiated by a browser command; absent when the proxy closes a session on its own initiative
- `reason`: one of `"user_requested"`, `"target_closed"`, `"proxy_shutdown"`

Rules:

- the relay must remove the session from its live registry on receipt
- the relay must broadcast `session_closed` to all connected browsers (not just the requestor) so every open tab removes the session card
- existing history for the session remains in SQLite and is not deleted

### Proxy Launch Behavior

The proxy is responsible for translating the `launch_session` command into agent-specific CDP actions. Implementation details are in `agent-proxy/launchers.js` (see A3-10), but the protocol contract is:

1. On receiving `launch_session`, the proxy attempts the per-agent launch action.
2. The proxy polls the CDP target list waiting for a new matching target (poll interval ≤ 2 s, max 30 s).
3. Once found, the proxy registers the new session with a durable `session_id` and emits `session_launch_ack`.
4. If the target does not appear within the timeout, the proxy emits `session_launch_failed` with `error_code: "launch_timeout"`.
5. The proxy may also emit `session_launch_failed` immediately if it can determine the agent is not installed or not open, using `error_code: "agent_not_open"`.
6. If `workspace_path` was provided and the agent supports it, the proxy injects a navigation command into the new session's input after launch. This step is best-effort and does not affect the success or failure of the launch itself.

## Agent Control Protocol

This section defines the protocol for:

- surfacing IDE permission/confirmation dialogs to the browser and answering them remotely
- stopping or interrupting a running agent generation
- reading and changing per-session agent configuration (model, permission mode, file access)

All messages in this section are routed through the relay. The proxy originates `permission_prompt` and `agent_config` events; the browser originates all control commands.

### Relay Routing Rules

| Direction | Message types | Relay action |
|---|---|---|
| proxy → relay → browser | `permission_prompt`, `agent_config` | broadcast to all browsers watching the session; cache latest value |
| browser → relay → proxy | `permission_response`, `agent_interrupt`, `agent_set_model`, `agent_config_request` | forward to the proxy socket registered for `session_id` |
| proxy → relay → browser (scoped) | `agent_control_result` | forward only to the browser identified by `request_id` |

Rules:

- All browser-originated control commands must be rejected with `connection_error` `code: "unauthorized"` if the browser socket is not authenticated.
- If no proxy is connected when a control command arrives, the relay must emit `agent_control_result` with `result: "failed"` and `error_code: "no_proxy_connected"`.
- The relay must cache the latest `agent_config` per session. On browser reconnect, include current config in `connection_ack`:

```json
{
  "type": "connection_ack",
  "session_configs": {
    "sess_123": {
      "model_id": "claude-opus-4-6",
      "permission_mode": "bypassPermissions",
      "file_access_scope": "full",
      "capabilities": { "interrupt": true, "set_model": true }
    }
  }
}
```

### Permission Prompt Relay Behavior

The relay maintains an **open prompt store** keyed by `(session_id, prompt_id)`.

1. On `permission_prompt` from proxy: store it; broadcast to all connected browsers for the session.
2. On browser reconnect: re-deliver all open prompts for the session in `connection_ack`:

```json
{
  "type": "connection_ack",
  "open_prompts": [
    {
      "session_id": "sess_123",
      "prompt_id": "prompt_abc",
      "prompt_text": "Edit file relay-server/index.js?",
      "choices": [
        { "choice_id": "yes", "label": "Yes", "is_default": false },
        { "choice_id": "no",  "label": "No",  "is_default": true  }
      ],
      "expires_at": "2026-03-19T10:25:30.000Z"
    }
  ]
}
```

3. On `permission_response` from browser: validate prompt is open; route to proxy; remove from store.
4. On timeout: relay emits a synthetic `permission_response` with `default_choice` to the proxy, removes the prompt from store, and broadcasts `permission_prompt_expired` to all browsers.

### `permission_prompt`

Sent by proxy to relay when a permission or confirmation dialog appears in the agent's UI.

```json
{
  "type": "permission_prompt",
  "protocol_version": 1,
  "session_id": "sess_123",
  "prompt_id": "prompt_abc",
  "prompt_text": "Edit file relay-server/index.js in /mnt/user/appdata/agent-relay?",
  "choices": [
    { "choice_id": "yes",    "label": "Yes",    "is_default": false },
    { "choice_id": "no",     "label": "No",     "is_default": true  },
    { "choice_id": "always", "label": "Always", "is_default": false }
  ],
  "timeout_ms": 30000,
  "default_choice": "no",
  "detected_at": "2026-03-19T10:25:00.000Z"
}
```

Required fields:

- `session_id`
- `prompt_id`: stable ID for this dialog instance; must be derived from dialog content or DOM identity so the same open dialog is not re-emitted on every poll cycle
- `prompt_text`: the full displayed text of the prompt as shown in the IDE
- `choices`: array with at least one entry; entries must have `choice_id`, `label`, and `is_default`

Optional fields:

- `timeout_ms`: if the dialog auto-dismisses, set this so the relay can expire the stored prompt
- `default_choice`: `choice_id` applied on timeout; must match an entry in `choices`

Rules:

- The proxy must not re-emit `permission_prompt` for a `prompt_id` it has already sent and not yet received a `permission_response` for.
- `choice_id` values should be stable machine-readable identifiers (`"yes"`, `"no"`, `"always"`, `"never"`) rather than raw button labels, unless the label is the only available identity.

### `permission_response`

Sent by browser to relay when the user selects an answer for a permission prompt.

```json
{
  "type": "permission_response",
  "protocol_version": 1,
  "request_id": "resp_xyz",
  "session_id": "sess_123",
  "prompt_id": "prompt_abc",
  "choice_id": "yes"
}
```

Required fields:

- `session_id`
- `prompt_id`: must match an open prompt in the relay's store
- `choice_id`: must match one of the `choice_id` values from the original `permission_prompt`

Rules:

- The relay must reject `permission_response` for an unknown or already-answered `prompt_id` by emitting `agent_control_result` with `error_code: "prompt_not_found"`.
- Relay forwards the command to the proxy, which maps `choice_id` to the corresponding DOM button click.
- Relay removes the prompt from store immediately on forwarding (optimistic — prevents duplicate answers).

### `permission_prompt_expired`

Sent by relay to all browsers for a session when a timed prompt expires before being answered.

```json
{
  "type": "permission_prompt_expired",
  "protocol_version": 1,
  "session_id": "sess_123",
  "prompt_id": "prompt_abc",
  "applied_choice": "no",
  "server_ts": "2026-03-19T10:25:30.000Z"
}
```

Rules:

- Browsers must dismiss any open overlay for this `prompt_id` on receipt.
- The relay has already applied the `default_choice` to the proxy before broadcasting this event.

### `agent_interrupt`

Sent by browser to relay to stop a running agent generation.

```json
{
  "type": "agent_interrupt",
  "protocol_version": 1,
  "request_id": "intr_abc",
  "session_id": "sess_123"
}
```

Required fields:

- `session_id`
- `request_id`: used to correlate the `agent_control_result` response

Rules:

- Relay routes to proxy.
- Proxy clicks the Stop/Interrupt button in the agent's DOM.
- On success, proxy emits `agent_control_result` with `result: "ok"` and a `proxy_status` update.
- If the agent is not currently generating (no Stop button present), proxy emits `agent_control_result` with `error_code: "agent_not_active"`.
- The browser should disable the interrupt button and show a pending state until `agent_control_result` arrives or `isThinking` clears.

### `agent_config_request`

Sent by browser to relay to request a fresh configuration snapshot from the proxy.

```json
{
  "type": "agent_config_request",
  "protocol_version": 1,
  "request_id": "cfg_req_abc",
  "session_id": "sess_123"
}
```

Required fields:

- `session_id`

Rules:

- Relay routes to proxy.
- Proxy reads current config from the agent DOM and emits `agent_config`.
- Relay may also respond immediately from its cached `agent_config` for the session (before the fresh read arrives) to allow the UI to populate immediately.

### `agent_set_model`

Sent by browser to relay to change the active model for an agent session.

```json
{
  "type": "agent_set_model",
  "protocol_version": 1,
  "request_id": "mdl_abc",
  "session_id": "sess_123",
  "model_id": "claude-opus-4-6"
}
```

Required fields:

- `session_id`
- `model_id`: the target model identifier as it appears in the agent's model selector UI

Rules:

- Relay routes to proxy.
- Proxy opens the model selector in the agent DOM and selects the matching option.
- On success, proxy emits `agent_config` with the confirmed new `model_id`; the relay updates its cache and broadcasts.
- On failure, proxy emits `agent_control_result` with `result: "failed"` and `error_code: "model_not_available"` or `"control_not_supported"`.
- The browser must treat the model change as pending until it receives a confirming `agent_config` event.

### `agent_config`

Sent by proxy to relay when agent configuration is read on connect, on request, or after a change. Relay broadcasts to all browsers for the session and caches the latest value.

```json
{
  "type": "agent_config",
  "protocol_version": 1,
  "session_id": "sess_123",
  "model_id": "claude-opus-4-6",
  "permission_mode": "bypassPermissions",
  "file_access_scope": "full",
  "available_models": [
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5"
  ],
  "capabilities": {
    "interrupt": true,
    "set_model": true,
    "permission_mode_change": false,
    "permission_dialogs": true
  },
  "read_at": "2026-03-19T10:25:05.000Z"
}
```

Required fields:

- `session_id`
- `model_id`: current model; use `"unknown"` if not readable from the agent DOM

Optional fields:

- `permission_mode`: one of `"bypassPermissions"`, `"default"`, `"ask"`, `"unknown"`
- `file_access_scope`: one of `"full"`, `"workspace"`, `"none"`, `"unknown"`
- `available_models`: list of known model IDs for this agent type; omit if not readable
- `capabilities`: map of boolean flags declaring which control operations this agent type supports; unknown capabilities should be omitted rather than set to `false`

`capabilities` keys:

| Key | Meaning |
|---|---|
| `interrupt` | proxy can find and click the Stop button |
| `set_model` | proxy can open the model selector and change it |
| `permission_mode_change` | proxy can change the permission mode setting |
| `permission_dialogs` | proxy polls for and can answer permission dialogs |

Rules:

- The proxy must emit `agent_config` on session connect so browsers always have a starting state without issuing a request.
- The proxy must emit `agent_config` after any successful `agent_set_model` operation.
- Fields the proxy cannot read for a given agent type must be omitted or set to `"unknown"`.
- The relay must update its cached `agent_config` for the session on every received `agent_config` event.

### `agent_control_result`

Sent by proxy to relay in response to a control command. Relay forwards only to the browser identified by `request_id`, not broadcast.

Success example:

```json
{
  "type": "agent_control_result",
  "protocol_version": 1,
  "request_id": "intr_abc",
  "session_id": "sess_123",
  "command": "agent_interrupt",
  "result": "ok",
  "server_ts": "2026-03-19T10:25:06.000Z"
}
```

Failure example:

```json
{
  "type": "agent_control_result",
  "protocol_version": 1,
  "request_id": "intr_abc",
  "session_id": "sess_123",
  "command": "agent_interrupt",
  "result": "failed",
  "error": {
    "code": "agent_not_active",
    "message": "The agent is not currently generating — no Stop button found"
  },
  "server_ts": "2026-03-19T10:25:06.000Z"
}
```

Required fields:

- `request_id`: echoes the `request_id` from the originating command
- `session_id`
- `command`: type string of the command this result is for
- `result`: `"ok"` or `"failed"`

Rules:

- `agent_control_result` is always point-to-point (originating browser only), never broadcast.
- For `agent_set_model`: `agent_control_result` confirms the command was received and attempted; the confirming `agent_config` event is what the browser should use to update the displayed model.

## Error Codes

Recommended error codes:

- `protocol_version_unsupported`
- `invalid_message`
- `session_not_connected`
- `session_unknown`
- `send_rejected`
- `send_injection_failed`
- `selector_failure`
- `history_not_available`
- `resume_cursor_invalid`
- `no_proxy_connected`
- `launch_timeout`
- `agent_not_open`
- `launch_not_supported`
- `unauthorized`
- `prompt_not_found`
- `agent_not_active`
- `model_not_available`
- `control_not_supported`
- `config_read_failed`

Rules:

- error codes should be stable strings
- human-readable `message` fields may change

## Compatibility Mapping From Current Implementation

Current implementation names:

- `session_list` -> should become `session_snapshot`
- `send` -> should become `send_message`
- `history` -> should become `history_snapshot` or `history_delta`
- `message` -> should split into `message_event` for transcript content and explicit delivery events for transport state
- `status` -> should become `session_status` or `proxy_status` depending on direction

## Minimum Adoption Order

To reduce migration risk, implement in this order:

1. `connection_hello` and `connection_ack`
2. `send_message`
3. `message_accepted`
4. `proxy_send_result` -> `message_delivered` / `message_failed`
5. `session_snapshot` replacing `session_list`
6. `heartbeat` and `heartbeat_ack`
7. `history_delta`
8. durable session metadata and full health/activity model
9. `launch_session`, `session_launching`, `session_launch_ack`, `session_launch_failed`
10. `close_session`, `session_closed`
11. `agent_config` on session connect; `agent_config_request`
12. `agent_interrupt` and `agent_control_result`
13. `permission_prompt`, `permission_response`, `permission_prompt_expired`
14. `agent_set_model` with confirming `agent_config`

## Acceptance Criteria

This protocol is ready for implementation when:

- relay, proxy, and browser can all reference one canonical message vocabulary
- delivery state no longer depends on scraped echo suppression
- reconnect behavior can be implemented from `connection_hello`, `heartbeat`, and history replay rules
- session identity and UI labels can be built from durable session metadata rather than transient CDP IDs
- a browser can launch a new agent session and track the full pending → success/failure lifecycle without polling
- a browser can close an existing session and see it removed from all open tabs without a manual refresh
- permission dialogs detected in the IDE DOM are surfaced to the browser and can be answered remotely within `timeout_ms`
- a running agent generation can be stopped from the browser without touching the dev machine
- the current model, permission mode, and file access scope are readable from the browser and model changes can be initiated and confirmed remotely
