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
    "host_type": "vscode|antigravity_ide|unknown_editor|null",
    "host_label": "VS Code",
    "display_name": "Codex",
    "window_title": "repo-name",
    "workspace_name": "repo-name",
    "workspace_path": "C:\\\\Users\\\\Robert\\\\Documents\\\\Remote Agent Chat",
    "project_root": "C:\\\\Users\\\\Robert\\\\Documents\\\\Remote Agent Chat",
    "machine_label": "Robert-Windows",
    "target_signature": "sha-like-or-derived-string",
    "target_id": "transient-target-id",
    "is_list_view": false,
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
- `host_type`: native editor host identity for iframe-backed sessions. This is
  independent of `agent_type`; for example, Claude Code can run in VS Code or
  Antigravity IDE without changing its agent type.
- `host_label`: user-facing label for `host_type`.
- `window_title`
- `workspace_name`
- `workspace_path`
- `project_root`: canonical grouping root resolved by the proxy. For Git linked
  worktrees this is the working tree that owns the common `.git` directory, so
  sibling worktrees share one project identity. Non-Git directories use their
  resolved workspace directory. Clients must not derive sidebar group identity
  from harness, thread, branch, window, or workspace display names.
- `last_seen_at`
- `is_list_view`: true when the native surface is on a conversation picker,
  history, scheduled-task, or new-conversation view rather than an active
  transcript.

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
- clients correlate `heartbeat_ack.request_id` with the local send timestamp and expose
  round-trip time as connection health: healthy at <=500 ms, slow at <=2 s, and poor above
  2 s; a missed application-heartbeat timeout closes the socket so bounded reconnect and
  diff resync begin immediately
- a user send created while the client socket is offline remains one optimistic bubble in
  an explicit offline queue. After `connection_ack`, the client flushes it with the same
  `client_message_id`, then resumes the ordinary accepted/delivered/agent-started receipt
  lifecycle. Offline residence time is not a relay-acceptance timeout.

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
- the heavy inventory is sent once in `connection_ack`/`session_snapshot`, then only when
  session membership, workspace identity, or schema recovery genuinely requires a new base
- metadata changes for an existing session use `session_patch` instead of replaying every
  session object

### `session_patch`

Relay-to-client keyed update for one session already present in the current inventory.
`patch` uses top-level replacement semantics; `removed_fields` explicitly deletes optional
top-level fields. Clients ignore unsafe prototype keys and a patch for an unknown session,
then request/wait for an authoritative inventory recovery rather than inventing membership.

```json
{
  "type": "session_patch",
  "protocol_version": 1,
  "session_id": "sess_123",
  "patch": {
    "model_id": "gpt-5",
    "last_seen_at": "2026-07-14T02:35:00.000Z"
  },
  "removed_fields": ["rate_limited_until"],
  "state_epoch": "b1d7e3c90a42",
  "state_seq": 1842
}
```

Web and Android keep the base inventory in a normalized ID-keyed registry. Applying a patch
must retain the registry order, unchanged row objects, selected transcript state, route
projections, and sidebar node identity.

### Coalesced state ordering

Relay-to-client inventory and activity state is latest-wins and carries:

```json
{
  "state_epoch": "b1d7e3c90a42",
  "state_seq": 1842
}
```

- membership-changing `session_list`/`session_snapshot` updates are coalesced for at most
  250 ms; existing-session `session_patch` updates are latest-wins and coalesced for at most
  50 ms per session.
- `status` updates are coalesced for at most 50 ms per session; relay lifecycle,
  notification, and send-receipt correlation still consume every source update.
- `state_seq` increases across emitted state events within one `state_epoch`.
  Clients retain the greatest sequence independently for inventory and for each
  `status:<session_id>` stream, and drop an event whose sequence is not greater.
- `connection_ack.state_epoch` establishes the current relay process epoch. A new
  epoch clears client sequence gates after a relay restart.
- `session_summary` preserves the sequence fields when it replaces a full status for an
  unsubscribed session. It contains one compact `activity.goal` projection (not a duplicate
  top-level goal), and bounds goal objective/labels so summary traffic stays lightweight.
- Legacy relays/events without these additive fields remain accepted.

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
- `launch_accepted`
- `delivered`
- `agent_started`
- `failed`

Optional internal state:

- `sending_to_proxy`

State transition rules:

1. browser creates local `queued` message and sends `send_message`
2. relay records the row and independent receipt journal entry as `accepted`
3. proxy may report `launch_accepted` after an owned native process or injection attempt starts
4. proxy reports `delivered` only after producer-authoritative evidence identifies the exact native user turn
5. proxy reports `agent_started` only after a later native task/reasoning/assistant/tool event for that turn
6. any stage before native delivery may instead advance to `failed`; a late authoritative receipt may recover a timed-out failure

Rules:

- `accepted` means the relay durably accepted the send request
- `launch_accepted` means native dispatch started; it is not delivery
- `delivered` means the exact user turn was observed at the intended native harness and carries a native receipt or equivalent producer evidence
- `agent_started` means a later native event proves the agent began processing that delivered turn
- `failed` means the relay or proxy has determined the send cannot currently be completed
- relay persistence, WebSocket acknowledgement, process spawn, stdout, exit code 0, dequeue, and an outbound/optimistic/history echo are never delivery evidence
- relay lifecycle persistence is monotonic and keyed by `(session_id, client_message_id)`; duplicate or wrong-session lifecycle events must not rebroadcast
- retries reuse the same `client_message_id` and consult the durable receipt journal before proxy availability or redispatch
- historical rows without receipt provenance render as neutral `recorded` / `receipt unknown`

### Busy and native queue surfaces

`message_queued` and `native_queue` retain their legacy `content` / `items[].text`
fields for interactive queue controls. They also carry canonical
`queued_message` blocks so web and Android do not have to flatten the native
surface back to an untyped string:

```json
{
  "type": "message_queued",
  "session_id": "sess_123",
  "client_message_id": "cmsg_123",
  "content": "Run after this turn",
  "content_blocks": [
    {
      "type": "queued_message",
      "label": "Queued message",
      "content": "Run after this turn",
      "client_message_id": "cmsg_123",
      "status": "queued"
    }
  ]
}
```

Each `native_queue.items[]` row carries the same one-block array, while the
event-level `content_blocks` array contains the rows in native queue order.
Clients must prefer the typed block content, preserve it through local edits,
and fall back to legacy text for older producers.

## Scheduled Sends

Scheduled sends are durable relay jobs that enter the ordinary single-message
delivery lifecycle only when their trigger becomes eligible. They are managed
through authenticated HTTP endpoints so web and Android clients share one
queue across reconnects and device changes.

`POST /api/scheduled-sends` accepts:

```json
{
  "session_id": "sess_123",
  "content": "Continue the overnight run",
  "trigger_kind": "at",
  "deliver_at": "2026-03-20T06:00:00.000Z"
}
```

- `trigger_kind` is `at` or `idle`.
- `at` requires a future ISO-8601 `deliver_at`; `idle` omits it and fires on
  the session's next transition into idle.
- The relay assigns a stable `scheduled-send-*` `client_message_id`, claims a
  pending job atomically, then forwards it through the same proxy send and
  receipt path as an immediate message.
- Pending jobs survive relay and client restarts. A restart after proxy
  hand-off is recorded as failed/unknown rather than replayed, because silent
  replay could duplicate a native send.

`GET /api/scheduled-sends?session_id=sess_123` lists the authenticated
operator's jobs. `DELETE /api/scheduled-sends/:id` atomically cancels a pending
job owned by that operator. Mutations and proxy settlement emit:

```json
{
  "type": "scheduled_send_status",
  "scheduled_send": {
    "id": "scheduled-123",
    "session_id": "sess_123",
    "trigger_kind": "idle",
    "state": "pending",
    "client_message_id": "scheduled-send-scheduled-123"
  }
}
```

Job states are `pending`, `dispatching`, `completed`, `failed`, and
`cancelled`. Only `pending` jobs may be cancelled. Every `scheduled_send_status`
event is delivered only to browser WebSockets authenticated as the owning
operator; pending message content and job state are never broadcast to another
authenticated principal.

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

### `proxy_send_result: delivered`

Sent only when the proxy reports a producer-authoritative native receipt. Codex CLI receipts
are scoped to the intended native session and a pre-launch file cursor; they correlate the
post-cursor user event by content hash/length, occurrence, process epoch, and source cursor.
Prompt bodies are not stored in receipt evidence.

```json
{
  "type": "proxy_send_result",
  "protocol_version": 1,
  "event_id": "evt_127",
  "sequence": 47,
  "session_id": "sess_123",
  "message_id": "msg_cli_123",
  "client_message_id": "msg_cli_123",
  "result": "delivered",
  "lifecycle": "native_user_turn_observed",
  "delivered_at": "2026-03-19T10:16:32.000Z",
  "native_receipt": {
    "session_id": "native_session_uuid",
    "content_sha256": "redacted-sha256",
    "content_utf8_bytes": 23,
    "post_baseline_occurrence": 1,
    "process_epoch": "owned-process-epoch",
    "source_cursor": { "start_offset": 120, "end_offset": 240 }
  }
}
```

### `agent_started`

Sent after delivery when a later native event for the same turn proves work began. Relay
activity may derive this event only for legacy producers that do not manage native receipts;
receipt-managed producers emit it directly.

```json
{
  "type": "agent_started",
  "protocol_version": 1,
  "session_id": "sess_123",
  "client_message_id": "msg_cli_123",
  "delivered_at": "2026-03-19T10:16:32.000Z",
  "started_at": "2026-03-19T10:16:33.000Z",
  "native_start": {
    "source": "response_item.reasoning",
    "source_cursor": { "start_offset": 241, "end_offset": 310 }
  }
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

## Selective Session Delivery

### `subscribe`

Web and Android clients use `subscribe` to declare the selected transcript. The set replaces
the prior set atomically; an empty array requests summary-only delivery for every session.

```json
{
  "type": "subscribe",
  "protocol_version": 1,
  "request_id": "web-sub-42",
  "sessions": ["sess_selected", "sess_active_1"]
}
```

The relay accepts at most 128 valid session IDs and replies with `subscription_ack`.
Invalid shapes fail closed with `connection_error.code = "invalid_subscription"`. A new
connection starts with an empty subscription set, so the reconnect interval before the first
`subscribe` is summary-only instead of an all-session transcript replay.

Subscribed sessions receive incremental `message`, `message_delta`, and full `status` events.
Other sessions receive `session_summary` instead. Explicit history is routed only to the
requesting client. Permission/error prompts and request-correlated control responses are not
filtered by the transcript subscription contract.

## Provider Usage Registry

The standalone Windows proxy owns provider-account quota collection. Authentication files,
OAuth/API tokens, cookies, request headers, full emails/account identifiers, and provider
response bodies never enter this protocol. The proxy publishes only a versioned, normalized,
redacted `provider_usage_snapshot`; the relay validates it against an allow-listed shape,
keeps the latest snapshot in memory only, and restores it to clients as
`connection_ack.provider_usage`. It is never written to relay SQLite.

Registry identity is `(provider_id, account_fingerprint, quota_domain)`. UI/CLI surfaces are
merged only inside an identity, so a second account produces another card. Each account
snapshot carries all native windows rather than a single worst percentage, plus a masked
label, plan, source/fallback history, freshness state, credits/reset credits, and mapped
harness types/session count.

The current local adapters prefer Codex app-server with bounded OAuth `/wham` fallback,
Claude OAuth usage/profile with a hidden ConPTY `/usage` fallback, Antigravity's local
Settings quota cache, and Cursor's read-only local authentication plus Connect usage API.
Cursor reads SQLite through `node:sqlite` when the proxy runtime provides it; older proxy
runtimes use a bounded hidden Python stdlib `sqlite3` read-only query and record that fallback
in sanitized source history.
The Claude fallback runs in a dedicated hidden pseudo-console, never opens or focuses a
window, and publishes only parsed normalized windows; its raw terminal stream stays local.

```json
{
  "type": "provider_usage_snapshot",
  "protocol_version": 1,
  "snapshot": {
    "schema_version": 1,
    "generation": 42,
    "generated_at": "2026-07-14T12:00:00.000Z",
    "poll_interval_ms": 300000,
    "in_flight": false,
    "snapshots": [{
      "schema_version": 1,
      "provider_id": "openai-codex",
      "provider_name": "OpenAI Codex",
      "quota_domain": "codex-plan",
      "account_fingerprint": "acct_0123456789abcdef0123",
      "account_label": "ro***@example.com",
      "plan": "ChatGPT Pro",
      "source": "app_server",
      "source_history": [{ "source": "app_server", "status": "ok", "captured_at": "2026-07-14T12:00:00.000Z" }],
      "status": "fresh",
      "captured_at": "2026-07-14T12:00:00.000Z",
      "stale_after": "2026-07-14T12:10:00.000Z",
      "windows": [{
        "id": "codex-primary",
        "label": "5-hour",
        "scope": "Codex",
        "used_percent": 13,
        "remaining_percent": 87,
        "duration_minutes": 300,
        "resets_at": "2026-07-14T15:00:00.000Z",
        "reset_description": null
      }],
      "credits": null,
      "reset_credits": null,
      "error": null,
      "request_count": 1,
      "latency_ms": 31,
      "mapped_harness_types": ["codex", "codex_cli"],
      "session_count": 13
    }]
  }
}
```

Allowed account statuses are `fresh`, `stale`, `refreshing`, `auth_required`,
`rate_limited`, and `unavailable`. Fetch throttling (`rate_limited`) is not plan exhaustion;
only a native window at 100% is exhausted. A failed refresh keeps last-good windows visible
as `stale` and attaches the current sanitized error separately. Missing or malformed values
remain unavailable and must not be synthesized as zero usage.

Web and Android clients may request an asynchronous refresh without blocking initial paint:

```json
{
  "type": "provider_usage_refresh",
  "protocol_version": 1,
  "request_id": "provider-usage-42",
  "force": true
}
```

The relay forwards this frame only to authenticated live proxies. The proxy enforces one
single-flight request per provider and a five-minute cache/routine cadence, so dashboard-open
and reconnect refreshes inside that interval reuse the latest result. An explicit manual
refresh bypasses the cache but not an active single-flight or provider backoff/`Retry-After`.
Relevant native limit/clear events explicitly refresh the authoritative window after the
event while retaining the same single-flight/backoff boundary.

Refresh is receipt-backed. The relay forwards a concurrent storm to exactly one authenticated
proxy and immediately returns `accepted` to the first requester or `coalesced` to followers.
Every requester then receives the same terminal `completed` or `error` receipt, correlated to
its original `request_id`; a completed receipt includes the accepted generation and independent
cost lifecycle state. Provider quota collection and local cost scanning use separate single-flight
jobs, so valid quota may publish while a slower cost scan remains `scanning`.

```json
{
  "type": "provider_usage_refresh_receipt",
  "protocol_version": 1,
  "request_id": "provider-usage-42",
  "status": "completed",
  "coalesced": false,
  "generation": 43,
  "cost_status": "ready"
}
```

Large local cost detail never expands the snapshot envelope. The snapshot contains exact
aggregates plus at most 256 inline `daily_breakdown` rows and explicit `detail` pagination
metadata. Web and Android request bounded, range/project/provider-filtered pages as needed:

```json
{
  "type": "provider_usage_cost_detail_request",
  "protocol_version": 1,
  "request_id": "provider-cost-42",
  "days": 365,
  "provider_id": null,
  "project": "Remote Agent Chat",
  "cursor": "0",
  "page_size": 256
}
```

The proxy replies through the relay with `provider_usage_cost_detail`. The page carries exact
filtered aggregate totals, bounded model/day summaries, up to 256 ordered rows, and
`pagination.{cursor,next_cursor,page_size,returned_rows,total_rows}`. The relay validates the
allow-listed shape and 1 MiB credential-safe ceiling, routes the response only to its requester,
and returns `provider_usage_cost_detail_error` on invalid input, timeout, unavailable proxy, or
invalid response. Cursors are decimal row offsets scoped to the exact query; changing a filter
starts again at `"0"`.

## Host Resource Snapshots

Host CPU, memory, disk I/O, network I/O, and process attribution are collected only by the
standalone Windows proxy while a client has the Host resources view open. Clients request a
sample with:

```json
{
  "type": "host_resource_refresh",
  "protocol_version": 1,
  "request_id": "host-resource-client-42",
  "force": false
}
```

The relay rate-limits each client to one request every two seconds, selects one authenticated
Windows proxy, replaces the client request ID with an opaque single-use upstream ID, and
keeps only a 12-second pending requester route. The first active request starts one persistent
hidden PowerShell helper shared by all requesters. Node samples CPU/memory at no more than 1 Hz;
the helper updates device/process detail at no more than one five-second cadence, and concurrent
requests coalesce onto the same in-flight detail read. A refresh extends the active lease without
starting another helper. When requests cease, the proxy stops the helper and clears its transient
sample state within 30 seconds. Chart presentation or repeated refresh inside either sampling
interval performs no additional native query. The proxy returns `host_resource_snapshot`:

```json
{
  "type": "host_resource_snapshot",
  "protocol_version": 1,
  "request_id": "host-resource-client-42",
  "snapshot": {
    "schema_version": 2,
    "source": "windows_proxy",
    "status": "fresh",
    "captured_at": "2026-07-14T16:49:51.705Z",
    "monotonic_ms": 418728342,
    "sample_sequence": 41,
    "sample_interval_ms": 1004,
    "dropped_gap_count": 0,
    "machine_label": "Windows host",
    "system": {
      "cpu_percent": 19.2,
      "cpu": {
        "total_percent": 19.2,
        "user_percent": 14.1,
        "privileged_percent": 5.1,
        "idle_percent": 80.8,
        "logical_core_count": 16,
        "physical_core_count": 8,
        "per_logical": []
      },
      "memory": { "total_bytes": 68719476736, "used_bytes": 34359738368, "available_bytes": 34359738368, "used_percent": 50 },
      "disk": { "read_bps": 1200000, "write_bps": 450000, "read_iops": 125, "write_iops": 48, "busy_percent": 4 },
      "disks": [],
      "network": { "receive_bps": 82000, "send_bps": 19000, "receive_pps": 90, "send_pps": 24 },
      "network_adapters": []
    },
    "processes": [{
      "pid": 4242,
      "parent_pid": 4000,
      "start_time": "2026-07-14T15:00:00.000Z",
      "stable_key": "d5874d3b18c5a4f006cf",
      "parent_key": null,
      "name": "node",
      "attributed": true,
      "agent_label": "Remote Agent proxy",
      "agent_types": ["agent-proxy"],
      "workspace_label": "Remote Agent Chat",
      "session_count": 0,
      "attribution_level": "runtime",
      "attribution_reason": "Command signature matches the Remote Agent proxy runtime",
      "owned_session_id": null,
      "cpu_percent": 1.5,
      "cpu_host_percent": 1.5,
      "cpu_core_equivalent": 24,
      "memory_bytes": 125829120,
      "io_read_bps": 1200,
      "io_write_bps": 800,
      "counter_totals": {
        "io_read_bytes": "18446744073709551615",
        "io_write_bytes": "9007199254740993",
        "io_read_operations": "400",
        "io_write_operations": "200"
      }
    }],
    "sampling": {
      "process_limit": 32,
      "process_included": 1,
      "selection_rule": "union: owned + top cpu + top memory + top read + top write",
      "system_interval_ms": 1000,
      "detail_interval_ms": 5000,
      "windows_hide": true
    },
    "privacy": {
      "ephemeral": true,
      "relay_cached": false,
      "relay_persisted": false,
      "command_lines_transmitted": false,
      "executable_paths_transmitted": false,
      "aggregate_only": false,
      "transient_fields": ["pid", "process_name", "machine_label", "workspace_label", "metrics"]
    }
  }
}
```

Schema v2 timestamps every frame with wall time, a monotonic sample sequence, the actual
sample interval, and a dropped-gap counter. It preserves cumulative process byte/operation
counters as decimal strings so values above JavaScript's safe-integer range remain lossless.
Process identity is the opaque hash of PID plus start time; `owned_session_id` is allowed only
for an explicitly owned process, while `runtime` and `workspace-associated` are deliberately
non-owning evidence levels. The capped set is the union of proved-owned rows and the top CPU,
memory, read-I/O, and write-I/O rows. `cpu_host_percent` is Task-Manager-comparable and
`cpu_core_equivalent` may exceed 100 percent.

The relay validates an allow-listed shape capped at 64 KiB and 32 process rows. It rejects
tokens, email addresses, user-home paths, command lines, executable paths, unexpected fields,
and snapshots from a proxy other than the one selected for that request. A valid snapshot is
sent only to the requesting authenticated WebSocket. It is never broadcast, cached, stored in
SQLite or logs, restored in `connection_ack`, or sent to another reconnecting client. Agent
attribution may inspect command lines and paths locally, but transmitted process rows contain
only bounded labels and measurements. Aggregate-only mode additionally removes machine,
device, adapter, process, and workspace labels while retaining numeric system metrics.

Failures use a requester-scoped `host_resource_error` with the original client `request_id`,
a bounded `code` (`refresh_throttled`, `proxy_unavailable`, `collector_timeout`, or
`invalid_snapshot`), and a safe message. Web and Android clients refresh at most every five
seconds while the view is open and stop immediately when it closes; they do not persist raw
snapshots or process lists. The proxy's 30-second lease absorbs close/reconnect races but is not
persistent retention.

### Host resource subscription and history

Interactive charts use an explicit requester-scoped subscription instead of polling native
counters. An authenticated Web/Android client opens or resumes one subscription:

```json
{
  "type": "host_resource_subscribe",
  "protocol_version": 1,
  "request_id": "host-subscribe-client-42",
  "resume_subscription_id": null,
  "aggregate_only": false
}
```

The relay creates a cryptographically random `host-sub-...` token, replaces the client request
ID upstream, binds the token to that browser socket and the chosen proxy, and forwards the proxy's
`host_resource_subscription_ack` only to that requester. A reconnecting client may present the
same in-memory token for up to 30 seconds. The relay does not persist, cache, log, broadcast, or
restore the token or its telemetry in `connection_ack`.

While subscribed, the proxy emits requester-addressed `host_resource_live` system points at no
more than 1 Hz and `host_resource_detail` schema-v2 snapshots at no more than one five-second
cadence. A live point is capped at 16 KiB and contains wall/monotonic time, ordered sequence,
actual interval/gap count, collection status, and numeric CPU/memory/disk/network aggregates; it
contains no machine, device, adapter, process, workspace, or session label. A detail frame retains
the 64 KiB/32-row snapshot boundary. The relay rejects duplicate or out-of-order sequences on each
stream and accepts frames only from the proxy bound to the token.

History bootstrap is pull/chunk based:

```json
{
  "type": "host_resource_history_request",
  "protocol_version": 1,
  "request_id": "host-history-client-42",
  "subscription_id": "host-sub-0123456789abcdef0123456789abcdef",
  "stream": "system",
  "after_sequence": 0,
  "max_points": 64
}
```

`host_resource_history_chunk` returns ordered points plus `next_sequence`, `done`, retained count,
and aggregate-only state. System chunks contain at most 128 points; detail chunks contain at most
eight snapshots; every encoded chunk is capped at 64 KiB. Clients continue from `next_sequence`
until `done`. Presentation range, legend, hover, pause, zoom, and pan are client-only operations and
must not issue collector calls.

`host_resource_unsubscribe` explicitly destroys the requester ring. An unplanned socket close
causes relay-to-proxy `host_resource_detach`; the proxy keeps that ring only for the 30-second
resume grace, then clears it and stops the single helper when no other subscriber remains.
Aggregate-only subscription detail sets `machine_label` to null, removes device/adapter/process/
workspace labels and rows, and keeps only numeric system telemetry.

## Usage Threshold Events

Proxies emit `rate_limit_active` for both visible usage warnings and hard exhaustion.
`percent_used` is the current window percentage when readable, `retry_after_hint` is the
native reset text, `reset_at` is its absolute timestamp normalized in the proxy's local
timezone, and `hard_limited` distinguishes a warning from a harness that cannot continue.
Relays deduplicate push delivery per session and usage cycle: the highest newly
crossed threshold at 80%, 90%, or hard exhaustion is delivered once. `rate_limit_cleared`
ends the cycle and re-arms those thresholds; a cleared push is emitted only when the prior
cycle reached hard exhaustion.

When a fresh provider-account snapshot covers a session, its individual native window is
authoritative for warnings and auto-resume. The relay deduplicates the 80%, 90%, and 100%
thresholds by provider/account/window/reset cycle, associates every mapped session, and emits
one `provider_usage_threshold` event. Per-session `rate_limit_active` frames remain useful as
context diagnostics but do not create duplicate Codex-vs-Codex-CLI or
Claude-vs-Claude-CLI pushes/resume jobs while provider authority is fresh.

```json
{
  "type": "rate_limit_active",
  "protocol_version": 1,
  "session_id": "codex_cli_example",
  "percent_used": 91,
  "retry_after_hint": "in 2h 15m",
  "reset_at": "2026-07-12T22:15:00.000Z",
  "hard_limited": false
}
```

When a hard limit belongs to a session with a non-terminal goal and a parseable reset
timestamp, the relay persists a `usage_resume_scheduled` job. At or after the reset it sends
one deterministic `continue` message through the owning proxy. Disconnected sessions use
bounded exponential retries before a visible/push failure; once dispatch begins, the relay
does not blindly retry and risk a duplicate prompt. Proxy delivery settles the job and emits
`usage_resume_started` plus the resumed push. Jobs and deterministic client message IDs
survive relay restarts, and terminal goals cancel before dispatch.

Relay-to-client lifecycle events are `usage_resume_scheduled`, `usage_resume_dispatching`,
`usage_resume_started`, `usage_resume_failed`, and `usage_resume_cancelled`. They share
`session_id`, `goal_objective`, `reset_at`, `attempts`, and `client_message_id` where known.

```json
{
  "type": "session_summary",
  "protocol_version": 1,
  "session_id": "sess_background",
  "status": "healthy",
  "activity": {
    "kind": "working",
    "label": "Running tests",
    "goal": { "state": "active", "objective": "Finish validation" },
    "work_context": {
      "kind": "goal",
      "label": "Goal",
      "text": "Finish validation",
      "source": "goal",
      "state": "active"
    }
  },
  "last_snippet": "The latest bounded transcript snippet",
  "last_message_at": 1783887000,
  "unread_delta": 1
}
```

Summaries preserve sidebar status, unread increments, last-message recency/snippet, a bounded
`activity.work_context`, capability-supported goal, and usage metadata. The work-context record
contains only normalized display text and progress; it never carries raw command output,
credentials, or the full task list. Summaries omit full transcript blocks and streaming
thinking/current output. Selecting a summary-only session is reconciled by the normal bounded
history request before full live delivery continues.

## History And Replay

### `history_request`

Sent by browser to relay when it needs snapshot or replay data.

```json
{
  "type": "history_request",
  "protocol_version": 1,
  "session_id": "sess_123",
  "after_sequence": 42,
  "limit": 250,
  "full": false
}
```

Rules:

- omit `after_sequence` to request a full snapshot
- include `after_sequence` to request deltas after reconnect
- include `limit` without `after_sequence` to request the latest N messages
  as an ascending tail snapshot; the relay responds with `partial: true` when
  older messages are available
- include `full: true` to force a complete snapshot even if the browser usually
  asks for a bounded tail for very large transcript surfaces such as Codex CLI
- for large transcripts, the browser may send `history_chunk_request` for
  newest-first hydration. Relay-backed sessions use SQLite chunks; Codex CLI can
  ask the owning proxy for native JSONL byte chunks.

### `history_snapshot`

Sent by relay when returning an explicitly requested full known transcript, and accepted
proxy-to-relay as an authoritative persistence/reconciliation input. The relay does not
broadcast requestless snapshots. An append-only legacy snapshot is converted to persisted
incremental `message` rows; a suffix mutation, clear, or resync emits
`transcript_resync_required` so only subscribed clients explicitly rehydrate from SQLite.

Proxy-to-relay snapshots normally also carry the legacy `history` alias for compatibility.
When duplicating a large transcript into both `messages` and `history` would exceed the
bounded relay frame budget, a v1 proxy may omit only the redundant `history` alias. The
canonical `messages` array remains complete and authoritative; this is not a partial or
tail snapshot.

File-backed CLI producers do not send a snapshot on every file change. Claude CLI, Codex
CLI, and Cursor CLI retain an accepted byte cursor and emit one `proxy_message` per newly
settled semantic row. A full snapshot from those producers is limited to explicit selected-
session hydration, older-page requests, cursor-gap recovery, or authoritative mutation/
rotation recovery. Recovery snapshots carry `resync_id`, `resync_reason`, `source`,
`source_cursor`, `source_bytes`, and `resync_rate_limit_ms`; producers advance their
published state only after the recovery is accepted. Ordinary appends never use a
requestless `history_chunk`.

```json
{
  "type": "history_snapshot",
  "protocol_version": 1,
  "session_id": "sess_123",
  "last_sequence": 49,
  "partial": false,
  "total_messages": 1,
  "loaded_messages": 1,
  "messages": [
    {
      "message_id": "msg_srv_111",
      "role": "user",
      "content": "hello",
      "content_blocks": null,
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
        "content_blocks": [
          { "type": "markdown", "content": "I updated the file." }
        ],
        "created_at": "2026-03-19T10:17:10.000Z"
      }
    }
  ]
}
```

Rules:

- `sequence` must be monotonic per session
- `history_delta` may contain lifecycle events and transcript events if the frontend needs both to recover state

### `history_chunk_request`

Sent by browser to relay when transcript history should be read incrementally
instead of as one full snapshot.

```json
{
  "type": "history_chunk_request",
  "protocol_version": 1,
  "session_id": "sess_123",
  "request_id": "histchunk-1",
  "mode": "tail",
  "source": "relay_sqlite",
  "limit": 120,
  "chunk_bytes": 2097152
}
```

Rules:

- use `source: "relay_sqlite"` for normal persisted histories across agent
  types
- use `source: "native"` for native archive readers such as Codex CLI JSONL
- for older relay chunks, send `mode: "older"` plus `before_id`
- for older native byte chunks, send `mode: "older"` plus `before_offset`
- a content-safe fidelity repair may additionally send `reconcile_metadata: true`
  on an authenticated, user-initiated native `mode: "older"` request. The relay
  updates only stable source ID, producer timestamp, and source name for a
  same-length persisted tail whose role, content, and structured blocks match
  every native row exactly. Any semantic mismatch, incomplete metadata,
  duplicate source ID, non-older request, or window larger than 1,000 rows
  fails closed without changing SQLite content or order. A successful response
  carries `metadata_reconciliation: { "applied": true,
  "code": "metadata_reconciled", "rows": <count> }`.
- for a global transcript-search deep link, send `source: "relay_sqlite"`,
  `mode: "around"`, and a positive persisted `around_id`; the relay returns a
  replacement chunk containing that exact row without loading the full session
- while the selected transcript remains partial, an intentional scroll within
  160 px of the top requests one older chunk; the client preserves the visible
  scroll anchor after prepending and keeps the explicit Load older button as a
  keyboard-accessible fallback
- after reconnect, a client that already has a positive message `sequence`
  sends `history_request.after_sequence` instead of replaying its tail; only a
  first load or a sequence-less legacy transcript requests a replacement tail

### `history_chunk`

Sent by relay, or by proxy through relay, only to the client whose `request_id` initiated the
read. A requestless or orphaned proxy chunk is dropped after its lightweight summary is
retained; it is never broadcast. `messages` are in
chronological order within the chunk. `mode: "tail"` replaces the visible
transcript tail; `mode: "older"` prepends older unique messages; and
`mode: "around"` replaces with a chunk containing the requested persisted row.

```json
{
  "type": "history_chunk",
  "protocol_version": 1,
  "session_id": "sess_123",
  "request_id": "histchunk-1",
  "mode": "tail",
  "source": "relay_sqlite",
  "partial": true,
  "complete": false,
  "total_messages": 500,
  "loaded_messages": 120,
  "cursor": {
    "next_before_id": 12345,
    "start_offset": 10485760,
    "end_offset": 12582912,
    "next_before_offset": 10485760,
    "total_bytes": 12582912
  },
  "messages": []
}
```

Rules:

- `cursor.next_before_id` is null when no older relay SQLite rows remain
- `cursor.next_before_offset` is null when no older native bytes remain
- chunks are not authoritative SQLite snapshots and must not delete relay
  history
- browsers should stop auto-requesting older chunks when the session is no
  longer selected

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
      "workspace_path": "C:\\\\Users\\\\Robert\\\\Documents\\\\Remote Agent Chat",
      "project_root": "C:\\\\Users\\\\Robert\\\\Documents\\\\Remote Agent Chat",
      "session_kind": "operator",
      "is_test_session": false,
      "cursor_agent_id": null,
      "cursor_workspace_key": null,
      "cursor_native_status": null,
      "status": "healthy"
    }
  ]
}
```

Cursor IDE 3.5+ can host multiple native agent threads in one CDP page. Each such
thread is a separate durable `agent_type: "cursor"` session. Its optional
`cursor_agent_id` is the native thread UUID and is the stable identity across
target/restart churn; `cursor_workspace_key` carries the native repository key,
and `cursor_native_status` carries the native activity label. These fields must
not be synthesized for Cursor CLI sessions or legacy single-surface rows.

### `transcript_resync_required`

The relay sends this small session-scoped signal to a subscribed client when it rejects a
cursor gap/generation change, reconciles an authoritative mutation/clear, or drops full
transcript traffic for that client under bounded WebSocket backpressure. It never contains
transcript rows. Web and Android request a replacement `relay_sqlite` tail and resume live
rows only after that explicit response clears the gap.

```json
{
  "type": "transcript_resync_required",
  "protocol_version": 1,
  "session_id": "sess_123",
  "reason": "cursor_gap",
  "source": "codex_cli_jsonl",
  "source_cursor": {
    "generation": "48fd74a8c0d3f14e",
    "message_index": 44,
    "end_offset": 90210,
    "file_size": 90210
  },
  "expected_message_index": 43,
  "received_message_index": 44,
  "server_ts": "2026-07-13T17:20:00.000Z"
}
```

Validator-owned sessions use `session_kind: "validator"` and `is_test_session: true`.
They should also provide `project_group` with the human parent project (for example,
`"Remote Agent Chat"`) so directory grouping does not depend on a throwaway workspace
slug. The proxy derives these fields for established validator paths and preserves an
explicit producer tag. The relay persists them with archived session metadata, suppresses
push and unread-summary noise for validator sessions, and omits them from
`GET /api/sessions/history` unless the authenticated caller sets `include_test=true`.
Web and Android clients hide them by default behind a persisted Show test sessions toggle.

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
    "content_blocks": [
      { "type": "markdown", "content": "Done." }
    ],
    "source_message_id": "codex_cli:48fd74a8c0d3f14e:42",
    "source_cursor": {
      "generation": "48fd74a8c0d3f14e",
      "message_index": 42,
      "end_offset": 88421,
      "file_size": 88421
    },
    "source": "codex_cli_jsonl",
    "created_at": "2026-03-19T10:17:10.000Z"
  }
}
```

`content_blocks` is optional. When present it is an ordered array of structured
rendering blocks such as `markdown`, `thinking`, `tool_call`, `tool_result`,
`terminal`, `file_changes`, `artifact`, `prompt`, `plan`, `queued_message`,
`notice`, `error`, or `status`. Receivers must preserve it
through persistence and replay while continuing to treat `content` as the plain
text fallback for older clients.

`source_message_id`, `source_cursor`, and `source` are optional for DOM-backed producers
and required for file-backed semantic appends. The identity uses the file generation plus
a semantic row fingerprint, so it survives a bounded-tail offset change and proxy restart.
The relay persists it under a unique `(session_id, source_message_id)` constraint and must
neither reinsert nor fan out a repeated ID; two distinct IDs remain distinct even when their
visible content is identical. The accepted cursor and sanitized source provenance are stored
with the row. Cursor offsets advance only through complete accepted JSONL events. An
incomplete final line remains behind the cursor and is re-read with the minimum suffix
overlap after the next append.

Canonical block fields:

```json
[
  { "type": "markdown", "content": "Rendered Markdown including tables and fenced code." },
  { "type": "thinking", "label": "Worked for 5m", "content": "Reasoning/work summary text", "collapsed": true },
  { "type": "tool_call", "label": "Run command", "status": "running|done|error", "content": "Visible tool body" },
  { "type": "tool_result", "label": "Command result", "status": "done|error", "content": "Visible tool output", "call_id": "call_123" },
  { "type": "terminal", "command": "npm test", "stdout": "...", "stderr": "", "exit_code": 0 },
  { "type": "file_changes", "summary": "2 files changed", "files": [{ "path": "x.js", "added": 52, "removed": 5 }] },
  { "type": "artifact", "label": "Walkthrough", "artifact_type": "walkthrough", "content": "Visible artifact text" },
  { "type": "prompt", "label": "Permission required", "content": "Prompt text", "actions": [{ "id": "allow", "label": "Allow" }] },
  { "type": "plan", "label": "Plan", "total": 2, "completed": 1, "tasks": [{ "id": "step-1", "text": "Inspect state", "state": "completed" }, { "id": "step-2", "text": "Apply fix", "state": "in_progress" }] },
  { "type": "queued_message", "label": "Queued message", "content": "Send after the current turn", "client_message_id": "msg_cli_123" },
  { "type": "notice", "label": "Context compacted", "content": "Older context was summarized.", "tone": "info|warning|error", "actions": [{ "id": "retry", "label": "Retry" }] },
  { "type": "error", "label": "Failed", "content": "Error text", "actions": [{ "id": "retry", "label": "Retry" }] },
  { "type": "status", "label": "Worked for 5m", "status": "working|done|idle" }
]
```

Senders must not emit off-spec block types. If a reader sees legacy `code`, it
should normalize it to a `markdown` block containing a fenced code block. Legacy
`file_change` should normalize to `file_changes`.
Legacy `tool_output`/`result`, `task_list`, `queue`/`queued`, and
`banner`/`notification` should normalize to `tool_result`, `plan`,
`queued_message`, and `notice` respectively. Tool results must remain distinct
from tool calls so clients can preserve call/result order and visual treatment.

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

### `agent_started`

Sent by the relay after a delivered browser send is followed by native harness activity.
This is the final correlated send-lifecycle receipt: it proves that the message was not
only injected, but that the agent began processing it. The relay correlates the first
active `proxy_status`/`status` transition after `proxy_send_result.result=delivered` and
expires unmatched correlations after two minutes.

```json
{
  "type": "agent_started",
  "protocol_version": 1,
  "session_id": "sess_123",
  "client_message_id": "msg_cli_123",
  "delivered_at": "2026-03-19T10:16:32.000Z",
  "started_at": "2026-03-19T10:16:32.240Z",
  "activity": {
    "kind": "thinking",
    "label": "Thinking"
  }
}
```

Clients advance the matching optimistic user bubble to `agent_started` and must ignore
unmatched IDs. A later failure for the same ID still wins and remains retryable.

### `proxy_status`

Sent by proxy when session health or activity changes.

```json
{
  "type": "proxy_status",
  "protocol_version": 1,
  "session_id": "sess_123",
  "status": "degraded",
  "activity": {
    "kind": "running_command",
    "label": "Working",
    "started_at": "2026-03-19T10:17:42.000Z",
    "updated_at": "2026-03-19T10:18:00.000Z",
    "interrupt_hint": "esc to interrupt",
    "goal": {
      "text": "Finish production maturity",
      "state": "active",
      "started_at": "2026-03-18T19:00:00.000Z",
      "time_used_seconds": 54822
    },
    "thinking": {
      "text": "Checking the retained transcript before changing the parser.",
      "since": "2026-03-19T10:17:42.000Z"
    },
    "current": {
      "kind": "tool",
      "label": "Running command",
      "partial": "$ npm test\n42 passed",
      "since": "2026-03-19T10:17:51.000Z"
    },
    "task_list": {
      "completed": 1,
      "total": 2,
      "tasks": [
        { "text": "Inspect state", "state": "completed" },
        { "text": "Apply fix", "state": "in_progress" }
      ],
      "content_blocks": [
        {
          "type": "plan",
          "label": "Plan",
          "completed": 1,
          "total": 2,
          "tasks": [
            { "text": "Inspect state", "state": "completed" },
            { "text": "Apply fix", "state": "in_progress" }
          ]
        }
      ]
    },
    "step": {
      "current": 1,
      "total": 4,
      "state": "in_progress",
      "text": "Repair the canonical activity shape",
      "added": 9135,
      "deleted": 3
    },
    "usage": {
      "state": "exhausted",
      "title": "You're out of Codex and Work usage",
      "detail": "Your rate limit resets at 2026-07-17T23:02:00.000Z.",
      "resets_at": "2026-07-17T23:02:00.000Z"
    }
  }
}
```

The relay guarantees a stable `activity.started_at` for every continuous active
interval. If a producer omits it, the relay anchors the interval at the first active
status and carries that timestamp across later tool/kind/label changes until an inactive
status arrives. Clients use this field for the live elapsed-time ticker; `updated_at`
continues to describe the most recent observation and must not reset elapsed time.

`activity.goal`, `activity.thinking`, and `activity.current` are independent live
channels. Producers map native state into them; clients must not infer reasoning from a
tool label or tool arguments. `goal` persists across active, attention, and terminal states,
`thinking` contains only current reasoning text, and `current` contains only the active
tool/command or streaming answer. The relay also stabilizes `goal.started_at`,
`thinking.since`, and `current.since` across updates. Ephemeral `thinking` and `current`
channels are cleared when activity becomes idle. `thinking_content` and
`activity.thinkingContent` remain temporary legacy compatibility fields and must not be
used by channel-aware clients.

The relay attaches an additive `activity.work_context` projection for Fleet and sidebar
surfaces. It is a bounded record with `kind`, `label`, `text`, `source`, optional
`updated_at`, and optional explicit `completed`/`total`, `percent`, or `state`. Priority is a
capability-supported native goal, an active structured task/plan or current response/tool,
harness context card, latest bounded user request, specific activity label, then the honest
`No current work reported` fallback. Clients must not display raw JSON, shell payloads,
credential-shaped text, stale completed tasks, or infer goal progress from unrelated task
counts. Only `goal_lifecycle: true` admits a goal; consumers discard stray goal records from
all other harnesses and may emit bounded diagnostics.

#### Canonical goal lifecycle record

Codex and Codex CLI producers must project native goal metadata into one provenance-bearing
record. Other harnesses may adopt the same additive shape when they expose a trustworthy native
goal lifecycle.

```json
{
  "objective": "Finish production maturity",
  "objective_hash": "sha256-hex",
  "fingerprint": "goal:stable-generation-id",
  "generation": 2,
  "state": "active",
  "status": "active",
  "raw_state": "in_progress",
  "native_state": "in_progress",
  "terminal": false,
  "transition_seq": 4,
  "transition_id": "goal-transition:stable-id",
  "source": "codex_cli_jsonl",
  "native_updated_at": "2026-07-15T12:00:00.000Z",
  "native_cursor": { "kind": "codex_cli_jsonl", "end_offset": 18422 },
  "observed_at": "2026-07-15T12:00:00.050Z"
}
```

The canonical states are `active`, `paused`, `blocked`, `usageLimited`, `budgetLimited`,
`complete`, `cancelled`, and `failed`. An unrecognized or absent native state is preserved in
`raw_state` and normalized to `unknown`; it must fail closed and never imply completion.
`fingerprint` identifies one goal generation, `transition_seq` is monotonic inside that
generation, and `transition_id` is stable for duplicate observations of the same native
transition. A terminal-to-active transition creates a new generation even when the objective
text is unchanged. The relay rejects older generation/sequence frames and preserves the last
authoritative terminal record until a later active generation arrives.

An idle activity frame does not change an active goal into a completed goal. It means only that
the current turn or loop iteration is between work intervals. Clients render the canonical goal
record and never synthesize goal completion from `thinking`, `generating`, transcript text, or an
active-to-idle activity transition.

### `semantic_notification`

The relay, not individual clients, derives user-facing turn/goal notifications from persisted
turn and goal lifecycle state.

```json
{
  "type": "semantic_notification",
  "event_type": "goal_completed",
  "category": "goal_completed",
  "dedupe_key": "goal_completed:goal-transition:stable-id",
  "session_id": "sess_123",
  "session_name": "Sol",
  "title": "Goal completed",
  "body": "Sol completed its goal.",
  "activity_type": "goal_completed",
  "created_at": "2026-07-15T12:00:00.100Z",
  "harness": "codex_cli",
  "goal_affiliation": "active_terminal_goal",
  "native_event_id": "goal-transition:stable-id",
  "goal": { "fingerprint": "goal:stable-generation-id", "state": "complete" }
}
```

The currently accepted event/category values are:

- `goal_completed`: the same goal fingerprint transitioned from a non-terminal state to native
  `complete`. Copy is `Goal completed` and `<session> completed its goal.`
- `goal_attention`: the same goal fingerprint transitioned to `paused`, `blocked`,
  `usageLimited`, `budgetLimited`, `cancelled`, or `failed`; title/body identify that state and
  never use completion copy.

`turn_ready` is fail-closed and currently unsupported for every harness. An active-to-idle edge,
fresh timestamp, settled text, process exit, or missing goal record is not an authoritative turn
terminal. The relay neither creates nor replays `turn_ready`, and Web, service-worker, and Android
boundaries reject both `turn_ready` and legacy `agent_idle` / `Session completed` payloads. A
harness may re-enable the category only after it supplies a correlated native turn identity,
explicit completed terminal event, settled output/tools, and explicit non-goal affiliation.

The capability gate is per harness; every current row is intentionally `GATED_OFF`:

| Harness | Observable source | Native terminal source | Gate |
| --- | --- | --- | --- |
| `codex_cli` | Codex CLI JSONL | `event_msg.task_started` + `event_msg.task_complete` | `GATED_OFF`: events are not yet carried as one stable turn ID with correlated start/terminal cursors, completed reason, settled output, zero pending work, and explicit non-goal affiliation |
| `codex-desktop` | Codex Desktop rollout JSONL | `event_msg.task_started` + `event_msg.task_complete` | `GATED_OFF`: same complete envelope is not published to relay status |
| `claude_cli`, `cursor_cli` | CLI JSONL | none proved | `GATED_OFF`: no complete native envelope |
| `codex`, `claude`, `claude-desktop`, `cursor` | IDE/app store, webview, DOM, or terminal observations | none proved | `GATED_OFF`: inferred idle is not terminal evidence |
| `gemini`, `continue`, `continue_yolo`, `roo_code`, `cline`, `antigravity`, `antigravity_panel`, `antigravity-v2` | pane/bridge/DOM status | none proved | `GATED_OFF`: inferred idle is not terminal evidence |

Unknown future harness identifiers inherit the same fail-closed gate. Enabling one registry row never
enables another harness and does not weaken client rejection of legacy completion payloads.

Active goal loop checkpoints are silent even when activity changes from generating/thinking to
idle hundreds of times. Missing/unknown goal metadata is also silent. Validator/test sessions
are hydration-only and cannot create notification events.

The relay persists lifecycle state and `dedupe_key` in SQLite before delivery. Duplicate status
frames, out-of-order frames, snapshots, and repeated relay reconnects therefore create at most
one event. A startup snapshot with no prior transition hydrates state silently; a fresh terminal
transition missed during a brief relay disconnect may reconcile once against the persisted prior
state. `connection_ack.semantic_notifications` may replay recent persisted events so a live
client can recover a brief socket gap. Web and Android consume both live and replay arrays through
a persistent per-device dedupe ledger; web uses a cross-tab lock/ledger so two tabs or a PWA do
not both surface the event.

Per-user category preferences and per-session mute are applied before live WebSocket delivery or
push. When an authenticated app socket is open, the in-app event owns the banner/toast and
optional sound/haptic; Web Push/FCM is used when no app socket is open. Web Push tags and Android
foreground handling reuse `dedupe_key`, so the title, body, event type, and exactly-once identity
are the same on every surface.

The relay also persists a content-free delivery ledger in
`semantic_notification_telemetry`. Rows use the stages `candidate`, `eligible`, `suppressed`,
`dispatched`, `claimed`, and `displayed` and retain only lifecycle identity/provenance:
`dedupe_key`, session, event type, harness, three-valued goal affiliation, optional native
event/turn ID, reason code, preference revision, channel, timestamp, and bounded diagnostic
metadata. Titles, bodies, transcript text, prompt text, tokens, endpoints, and account addresses
are never copied into this ledger. Raw classifier candidates and telemetry are diagnostic-only
and never enter `connection_ack.semantic_notifications`.

Codex producers may also attach `activity.task_list`, `activity.step`, and
`activity.usage`. A task list must carry its canonical `plan` block; clients prefer that
typed shape and retain the legacy counts/tasks fields for compatibility. `step` drives the
native-style centered progress chip and may include added/deleted diff counts when the
harness reports them. `usage` drives the informational exhaustion banner and the existing
rate-limit notification path. Clients render no action buttons unless the producer also
advertises and implements the corresponding real control.

During measured streaming runs, `proxy_status` may also carry an additive
`stream_trace` object. Its `trace_id` correlates monotonic epoch-millisecond stamps for
`native_event_at_ms`, `proxy_read_at_ms`, `proxy_normalized_at_ms`,
`proxy_sent_at_ms`, `relay_received_at_ms`, `relay_forwarded_at_ms`,
`browser_received_at_ms`, and `browser_paint_at_ms`. A source that does not expose a
native timestamp sets `native_event_at_ms` to the first observable proxy read and records
that limitation in `native_timestamp_source`. Trace metadata is diagnostic only: it must
not change status deduplication, activity state, or transcript reconciliation.

### `message_delta`

`message_delta` carries ephemeral in-flight assistant content without waiting for a
settled transcript row or SQLite write. Producers enable it per harness behind a rollout
flag; settled semantic `proxy_message` appends remain authoritative, with an identified,
rate-limited history snapshot used only for mutation/rotation recovery. Codex CLI
uses `RAC_CODEX_CLI_MESSAGE_DELTA=true`; Claude CLI uses
`RAC_CLAUDE_CLI_MESSAGE_DELTA=true`; Cursor CLI uses
`RAC_CURSOR_CLI_MESSAGE_DELTA=true`. All flags default off.

```json
{
  "type": "message_delta",
  "protocol_version": 1,
  "session_id": "sess_123",
  "message_id": "codex-cli-turn-8f2c",
  "role": "assistant",
  "block_index": 0,
  "block_type": "text",
  "seq": 1,
  "op": "append",
  "append": "First streamed chunk"
}
```

Each `(session_id, message_id, block_index)` stream begins with `seq: 0` and
`op: "block_open"`, continues with non-empty `append` operations whose sequence grows by
exactly one, and ends with `op: "block_close"`. Marker frames do not carry content.
The relay validates ordering and payload size, timestamps and forwards accepted frames
immediately, and never persists them. A gap, duplicate, late frame, reconnect, or unknown
stream is recovered by the next settled `proxy_message` or explicit recovery snapshot; clients must
discard provisional state when that canonical message arrives.

`message_delta` is also expendable per browser connection. When a browser socket's
`bufferedAmount` exceeds 256 KiB, the relay skips further deltas for that browser only;
healthy clients continue receiving the complete stream. Authoritative messages/history,
send receipts, and control responses never pass through this delta gate. A slow client
therefore freezes its provisional bubble on the first sequence gap and reconciles normally
when the settled message arrives, without queuing a stream burst ahead of controls.

### `chat_list`

Sent by proxy to relay when an agent surface exposes conversation navigation.
Relay broadcasts the event to browser clients and may cache the latest list for
reconnect.

```json
{
  "type": "chat_list",
  "protocol_version": 1,
  "session_id": "sess_123",
  "chats": [
    { "id": "__agv2:new_conversation", "kind": "nav", "action": "new_conversation", "title": "New Conversation" },
    { "id": "__agv2:project:0", "kind": "project", "title": "Remote Agent Chat", "project": "Remote Agent Chat", "project_index": 0 },
    { "id": "4fe356d9-7107-4fab-90c2-ee9d0c1fd534", "kind": "chat", "title": "Fixing Catalyst Events API", "project": "Remote Agent Chat", "active": true },
    { "id": "__agv2:see_all:0", "kind": "see_all", "action": "see_all", "title": "See all (9)", "project": "Remote Agent Chat" }
  ],
  "read_at": "2026-03-19T10:18:00.000Z"
}
```

`kind` taxonomy:

- `nav`: top-level native navigation such as new conversation, conversation history, or scheduled tasks.
- `project`: a project/group row.
- `chat`: an addressable conversation. For Antigravity v2 the `id` is the route UUID from `/c/<uuid>`.
- `see_all`: explicit user-triggered expansion for a project. Passive polling must not click these controls.

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
| browser → relay → proxy | `permission_response`, `agent_interrupt`, `agent_set_model`, `set_codex_config`, `agent_config_request` | validate, then forward to the proxy socket registered for `session_id` |
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
  "content_blocks": [
    {
      "type": "prompt",
      "label": "Permission required",
      "content": "Edit file relay-server/index.js in /mnt/user/appdata/agent-relay?",
      "actions": [
        { "id": "yes", "label": "Yes" },
        { "id": "no", "label": "No" },
        { "id": "always", "label": "Always" }
      ]
    }
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
- AskUserQuestion prompts set `kind: "question"` and may add `questions`. Each question has
  `question_id`, `label`, optional `message`, `multi_select`, and its own `choices`.
  Question choices may include `description` and `requires_text` (the native "Other" row).
  The top-level `choices` array remains a flattened compatibility view; its choice IDs are
  scoped as `<question_id>__<choice_id>`.

Optional fields:

- `timeout_ms`: if the dialog auto-dismisses, set this so the relay can expire the stored prompt
- `default_choice`: `choice_id` applied on timeout; must match an entry in `choices`
- Native action prompts may preserve separate `title`, `command`, and `description` fields.
  When the native surface accepts a free-form alternative, set
  `alternate_instruction_supported: true` and include its visible
  `alternate_instruction_placeholder`; `cancel_hint` preserves the native escape copy.

Rules:

- The proxy must not re-emit `permission_prompt` for a `prompt_id` it has already sent and not yet received a `permission_response` for.
- `choice_id` values should be stable machine-readable identifiers (`"yes"`, `"no"`, `"always"`, `"never"`) rather than raw button labels, unless the label is the only available identity.
- Updated producers attach one canonical `prompt` block. Clients prefer its typed
  label/content while retaining `choices` and structured `questions` for native actions.

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

Structured question responses omit `choice_id` and send all answers atomically:

```json
{
  "type": "permission_response",
  "protocol_version": 1,
  "request_id": "resp_questions_xyz",
  "session_id": "sess_123",
  "prompt_id": "prompt_questions_abc",
  "answers": [
    { "question_id": "approach", "choice_ids": ["approach__fix_launcher"] },
    { "question_id": "checks", "choice_ids": ["checks__tests", "checks__docs"] },
    { "question_id": "notes", "choice_ids": ["notes__other"], "other_text": "Preserve the old flag" }
  ]
}
```

Claude Code action prompts that advertise `alternate_instruction_supported` may instead
submit the native "Tell Claude what to do instead" field:

```json
{
  "type": "permission_response",
  "protocol_version": 1,
  "request_id": "resp_instruction_xyz",
  "session_id": "sess_123",
  "prompt_id": "prompt_abc",
  "instruction": "Do not run it; explain what the command would do."
}
```

Required fields:

- `session_id`
- `prompt_id`: must match an open prompt in the relay's store
- Exactly one response shape is required: `choice_id`, `answers` for `kind: "question"`,
  or `instruction` when the open prompt advertises alternate-instruction support.
- `choice_id` must match one of the `choice_id` values from the original `permission_prompt`.
- `answers` contains one unique entry per question.
  Radio questions accept exactly one choice, multi-select questions accept one or more,
  every choice must belong to that question, and `other_text` is limited to 2,000 characters.
- `instruction` must be non-empty after trimming and is limited to 2,000 characters.

Rules:

- The relay must reject `permission_response` for an unknown or already-answered `prompt_id` by emitting `agent_control_result` with `error_code: "prompt_not_found"`.
- Relay forwards the command to the proxy, which maps `choice_id` to one DOM button click,
  applies the structured `answers` selection/input sequence before native Submit, or fills
  and submits Claude Code's advertised native alternate-instruction editor.
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

### `session_error_prompt`

Sent when the harness exposes a retry/dismiss/error surface. The event retains its
specialized action fields and carries one canonical block: blocking action failures use
`error`; nonblocking inline slow-response or attention surfaces use `notice`. Clients
prefer the block label/content and retain the event actions, display mode, and blocking
state for the real native controls.

### `file_change_response`

Sent by browser to relay to accept or reject a pending Cursor file-change card (auto-apply off).

```json
{
  "type": "file_change_response",
  "protocol_version": 1,
  "session_id": "sess_123",
  "change_id": "file-readme-md",
  "action": "accept",
  "request_id": "filechg_abc"
}
```

Rules:

- `action` is `accept` or `reject`.
- `change_id` matches an `id` from the latest `file_changes` control result for that session.
- Relay forwards to the proxy; proxy clicks the matching Accept/Reject control in the Cursor DOM.
- On success, relay returns `agent_control_result` with `command: "file_change_response"` and `result: "ok"`; browsers should refresh `file_changes`.

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
- For `config_semantics: "observed_and_next_send"` (including Codex CLI), the command sets
  `next_send_model_id` only. It must not overwrite `observed_model_id`; confirmation occurs
  only after native metadata from the resulting turn agrees. Effort controls follow the
  same rule with `next_send_effort` and `observed_effort`.

### `set_codex_config`

Sent by Web or Android to change exactly one Codex configuration field. For VS Code Codex,
this is a selected-conversation native composer operation with `config_semantics:
"next_turn_native"`; it must never write the shared `~/.codex/config.toml` file or VS Code
user settings. Codex Desktop retains its separate restart-scoped implementation.

```json
{
  "type": "set_codex_config",
  "protocol_version": 1,
  "request_id": "codex_cfg_abc",
  "session_id": "sess_codex_123",
  "model_id": "gpt-5.6-sol",
  "source_revision": "codex-0123456789abcdef0123"
}
```

Exactly one of these intent fields is required:

- `model_id`
- `effort`
- `speed`
- `access_mode`
- `permission_profile`
- `workspace_mode`

VS Code Codex currently admits only `model_id`, `effort`, and `permission_profile`; the
published granular capabilities are authoritative. `permission_profile: "full-access"`
also requires `confirm_bypass: true`, because it maps to both
`approval_policy: "never"` and `permission_mode: "danger-full-access"`. Confirmation is
invalid for any other intent.

Rules:

- `session_id`, `request_id`, the single field/value, confirmation bit, and
  `source_revision` form the request identity. Reusing a request ID for a different identity
  fails with `duplicate_request_conflict`.
- Relay validation is bounded and fail-closed. Invalid multi-field, control-character,
  unsupported-enum, and unconfirmed bypass messages never reach the proxy.
- VS Code Codex queues controls independently per `session_id`. Same-session requests are
  serialized; different selected conversations may progress concurrently.
- The proxy targets the selected conversation frame, applies the exact native option, reads
  that same frame back, broadcasts the authoritative `agent_config`, and only then returns a
  successful `agent_control_result`.
- A duplicate in-flight request applies once. A completed duplicate returns the bounded
  cached receipt without another native mutation.
- Stale source/frame, unsupported choice, native rejection, read-back mismatch, timeout, and
  reconnect failures return a field-level error. Clients roll back optimistic state; a late
  receipt for session A must not update session B.
- A successful receipt may include sanitized `details` with `field`, `value`, the new
  `source_revision`, and exact safe read-back fields. It must not expose raw CDP state,
  selectors, config file contents, or other sessions.

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
    "goal_lifecycle": true,
    "permission_mode_change": false,
    "permission_dialogs": true
  },
  "read_at": "2026-03-19T10:25:05.000Z"
}
```

Provenance-aware CLI producers use the extended split shape:

```json
{
  "type": "agent_config",
  "protocol_version": 1,
  "session_id": "sess_cli_123",
  "config_semantics": "observed_and_next_send",
  "observed_model_id": "gpt-5.5-codex",
  "observed_model_raw": "gpt-5.5-codex",
  "observed_effort": "xhigh",
  "observed_effort_raw": "xhigh",
  "model_provenance": { "source": "turn_context", "observed_at": "2026-07-14T21:00:00.000Z" },
  "effort_provenance": { "source": "turn_context", "observed_at": "2026-07-14T21:00:00.000Z" },
  "next_send_model_id": "Sol",
  "next_send_model_status": "pending",
  "next_send_effort": "high",
  "next_send_effort_status": "pending",
  "effective_model_id": "gpt-5.5-codex",
  "effective_model_provenance": "native_metadata",
  "effective_effort": "xhigh",
  "effective_effort_provenance": "native_metadata"
}
```

Required fields:

- `session_id`
- legacy producers: `model_id` is the current model; use `"unknown"` if not readable
- split CLI producers: `config_semantics`, with observed values explicitly null/unknown when no exact native observation exists

Optional fields:

- `permission_mode`: one of `"bypassPermissions"`, `"default"`, `"ask"`, `"unknown"`
- `file_access_scope`: one of `"full"`, `"workspace"`, `"none"`, `"unknown"`
- `available_models`: list of known model IDs for this agent type; omit if not readable
- `capabilities`: map of boolean flags declaring which control operations this agent type supports; unknown capabilities should be omitted rather than set to `false`
- `source_revision`: stable hash of the selected native conversation's exact configuration;
  clients echo it on `set_codex_config`
- `config_semantics`: for VS Code Codex, `"next_turn_native"`
- `permission_profile`, `approval_policy`, `approvals_reviewer`, and
  `bypass_permissions_active`: separate native permission dimensions
- `controls_available` and `controls_unavailable_reason`: whether conversation-scoped native
  controls are currently actionable
- `available_efforts`, `available_permission_profiles`, and catalog provenance (`source`,
  `client_version`, `observed_at`)
- Split CLI config uses this precedence independently for model and effort: latest exact
  native metadata, exact launch argument for an owned active resume, labeled next-send
  override, otherwise unknown. Raw native values and observation provenance are preserved.
- `next_send_*_status` is `unset`, `pending`, `confirmed`, or `failed`; failed overrides
  retain their requested value plus an actionable error while preserving the prior observation.
- `available_models` and per-model efforts come from the harness's current advertised
  catalog. Display aliases may normalize deliberately, but do not replace raw native truth.

`capabilities` keys:

| Key | Meaning |
|---|---|
| `interrupt` | proxy can find and click the Stop button |
| `goal_lifecycle` | harness exposes a trustworthy native goal lifecycle; currently Codex, Codex CLI, and Codex Desktop only |
| `set_model` | proxy can open the model selector and change it |
| `permission_mode_change` | proxy can change the permission mode setting |
| `permission_dialogs` | proxy polls for and can answer permission dialogs |
| `set_codex_config` | surface supports at least one validated Codex config operation |
| `codex_model_change` | selected Codex conversation supports exact model apply/read-back |
| `codex_effort_change` | selected Codex conversation supports exact effort apply/read-back |
| `codex_permission_profile_change` | selected Codex conversation supports native profile apply/read-back |
| `codex_bypass_permissions` | native full-access profile maps to no approval plus danger-full-access and requires confirmation |
| `codex_access_change` | surface supports a separate mutable access/sandbox control |
| `codex_speed_change` | surface supports a separate mutable service-speed control |

Rules:

- The proxy must emit `agent_config` on session connect so browsers always have a starting state without issuing a request.
- The proxy must emit `agent_config` after any successful `agent_set_model` operation. For
  split CLI config this reports the pending next-send override, not a fabricated current value.
- Fields the proxy cannot read for a given agent type must be omitted or set to `"unknown"`.
- The relay must update its cached `agent_config` for the session on every received `agent_config` event.
- Any relay compaction used for live broadcasts or `connection_ack.agent_configs` must retain
  the authoritative control state needed to render and safely mutate the selected session,
  including `source_revision`, permission/bypass dimensions, control availability, native
  choices and catalog provenance, and `config_semantics`. Reconnect snapshots must not degrade
  a writable native config into a legacy read-only model/effort subset.

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
- For `set_codex_config`, success means exact selected-frame read-back already matched and the
  corresponding authoritative `agent_config` was emitted first. Successful sanitized data is
  under `details`; failures are under `error` with `code`, `message`, and optional rollback state.

## Relay Notification Preferences API

Notification categories are persisted by authenticated relay user and shared by the web UI
and Android app. Cookie-authenticated browser requests and Android bearer-token requests use
the same endpoints.

### `GET /api/preferences/notifications`

Response:

```json
{
  "preferences": {
    "permission_required": true,
    "agent_ready": true,
    "turn_ready": false,
    "goal_completed": false,
    "goal_attention": true,
    "agent_error": true,
    "session_offline": true,
    "rate_limit_cleared": true,
    "completion_sound": false,
    "completion_haptic": false
  }
}
```

### `PUT /api/preferences/notifications`

Request fields are optional booleans; omitted categories keep their current value.

```json
{
  "preferences": {
    "permission_required": true,
    "turn_ready": false,
    "goal_completed": true,
    "goal_attention": true,
    "agent_error": true,
    "session_offline": true,
    "rate_limit_cleared": true,
    "completion_sound": false,
    "completion_haptic": true
  }
}
```

The response returns `ok: true` and the complete normalized `preferences` object. The relay
maps permission prompts to `permission_required`, native completed goals to `goal_completed`,
actionable goal states to `goal_attention`, errors
and active rate limits to `agent_error`, disconnected sessions and a
global proxy outage/recovery to `session_offline`, and cleared limits to `rate_limit_cleared`.
Repeated watchdog-recovery failure maps to `agent_error`. Missing preference rows default
`turn_ready` and `goal_completed` to disabled while the supported attention categories retain
their documented defaults.
`agent_ready` remains a read/write compatibility field for older clients but cannot enable or
seed `turn_ready` or `goal_completed`; migration adds both as false. Existing rows seed
`goal_attention` from `agent_error`. Per-session mute is applied after category filtering.

### `POST /api/notifications/semantic-receipts`

Authenticated Web, service-worker, and Android clients acknowledge a persisted semantic event
after local exactly-once claim and after the in-app/OS surface has been requested for display.
The body contains `dedupe_key`, `stage` (`claimed`, `displayed`, or `suppressed`), a bounded
lowercase `channel`, optional machine-readable `reason_code`, and an optional non-secret
`client_id`. Unknown event keys return `404`; arbitrary client-created events cannot enter the
ledger. Receipt failure never delays or retries a user-facing cue.

### `GET /api/notifications/semantic-diagnostics`

Returns content-free counts grouped by stage, reason, channel, harness, and event type for a
bounded window. `max_age_minutes` is clamped from one minute through 30 days and defaults to 24
hours. The response includes `content_persisted: false`; no transcript or notification copy is
returned.

`completion_sound` and `completion_haptic` are optional attention-feedback preferences,
both defaulting to `false`. They do not change push delivery. The web client may play one
subtle synthesized cue and the Android client may issue one short vibration when a new
permission/question prompt or allowed `semantic_notification` arrives while that session is
not focused (or the app/document itself is not focused). Initial state restoration, active
foreground-session events, duplicate prompt/event IDs, and repeated idle snapshots remain silent.

### Proxy outage and watchdog events

`GET /healthz` exposes both `connections.proxy_sessions` and
`connections.proxy_connections`. The latter counts authenticated, open proxy transports and
is authoritative for infrastructure monitoring: a connected proxy may legitimately have zero
CDP targets while an application is restarting. `proxy_watchdog` reports the relay monitor's
`healthy`, `grace`, or `offline` state and its 120-second grace period.

`GET /readyz` is deliberately identity-free: it returns only relay/database readiness and the
aggregate proxy connection state. It never returns session IDs or browser-client activity.
App-token and Google-ID-token exchanges share a 30-attempt/minute source-address budget. FCM
registration requires a bearer-authenticated Android principal, validates a bounded native FCM
token, prevents cross-principal reassignment, retains at most 20 current tokens per principal,
and permits at most 20 mutations/minute. Browser-session and Android-bearer uploads share the
same authenticated endpoint; decoded content is capped at 2 MiB, base64 must be canonical, and
the relay accepts only generated basename-only `/uploads/<timestamp>_<safe-name>` references
before reading an attachment for proxy forwarding.

After the relay has seen at least one authenticated proxy, a transition to zero proxy
connections starts a 120-second timer. Reconnection within the timer is silent. If the timer
expires, the relay sends one `proxy_offline` push and broadcasts:

```json
{
  "type": "proxy_watchdog_status",
  "status": "offline",
  "incident_id": "proxy-1783900000000",
  "missing_since": "2026-07-12T20:00:00.000Z",
  "missing_ms": 120000,
  "server_ts": "2026-07-12T20:02:00.000Z"
}
```

The first authenticated reconnection emits the same event with `status: "recovered"` and
sends one `proxy_recovered` push. Multiple simultaneous proxy transports are safe: losing one
does not start an outage while another authenticated transport remains open.

The local Windows watchdog polls `/healthz` but stays passive when the relay itself is
unreachable (the rescue path owns relay outages). After a continuously healthy relay reports
zero proxy connections for 120 seconds, it invokes `proxy_restart_lock.py` through the hidden
launcher, at most three times with bounded exponential backoff. If all attempts fail it sends
an authenticated `POST /api/proxy-watchdog-event` with a bearer `PROXY_SECRET`, type
`proxy_watchdog_failed`, incident ID, elapsed seconds, and attempt count. The relay validates
and de-duplicates that incident, emits `proxy_watchdog_status` with `status: "failed"`, and
sends one `proxy_watchdog_failed` push. This internal endpoint accepts no other event type.

### PWA Web Push subscription API

Authenticated browser clients use `GET /api/push/web-config` to retrieve the relay's stable
VAPID public key. `POST /api/push/web-subscription` accepts the browser `PushSubscription`
JSON (`endpoint`, `keys.p256dh`, and `keys.auth`) and stores it for the authenticated email.
`DELETE /api/push/web-subscription` accepts `{ "endpoint": "..." }` and removes only that
user's subscription. VAPID keys are generated once and persisted in the relay SQLite data
volume. Web Push uses the same global category and per-session mute filters as Android
FCM; HTTP 404/410 subscriptions are removed after a send attempt.

## Relay History Maintenance API

Authenticated operators can measure and maintain the SQLite transcript store without copying a
live WAL database:

- `GET /api/maintenance/history?retention_days=90` returns database/WAL bytes, transcript and
  session counts, oldest/newest timestamps, and inactive-session prune candidates.
- `POST /api/maintenance/history/backup` starts or returns the current bounded background
  SQLite online-backup job. `GET /api/maintenance/history/backup` reports `idle`, `running`,
  `complete`, or `failed`; completed jobs include the timestamped path and byte count.
  A same-size completed backup from the last 24 hours is reused unless `reuse_recent: false`.
- `POST /api/maintenance/history/prune` requires `retention_days` and the exact confirmation
  string `PRUNE_INACTIVE_HISTORY`, plus the exact path of the newest completed backup from the
  last 24 hours. It deletes only sessions that are both unclaimed by a live proxy and older than
  the retention cutoff.

The endpoints use the same cookie-or-bearer authorization boundary as other private relay APIs.
See `docs/HISTORY_STORE_OPERATIONS.md` for retention, backup-copy, restore, and verification rules.

## Session Export API

Authenticated web and Android clients can export the complete persisted transcript for any
session through `GET /api/sessions/:sessionId/export?format=markdown|json`. Cookie and bearer
authentication use the same private relay boundary and history-read rate limiter. The relay
resolves an archived or aliased session to its effective history source, reads the full history
in ascending message order, and includes the requested session metadata and per-user display
name without mutating the session.

Markdown exports expand every canonical `content_blocks` entry under its message; canonical
blocks take precedence over the row's transport-fallback `content` to avoid duplicate rendered
answers. JSON exports use `schema_version: 1` and preserve normalized message IDs, sequence,
role, content, canonical blocks, status, client-message ID, and ISO timestamp. Successful
responses set a sanitized UTF-8 attachment filename, `Cache-Control: private, no-store`, and
`X-Content-Type-Options: nosniff`. Unsupported formats and invalid session IDs return `400`.

## Scheduled Send API

Authenticated web and Android clients manage durable one-shot messages through
`GET /api/scheduled-sends?session_id=...`, `POST /api/scheduled-sends`, and
`DELETE /api/scheduled-sends/:id`. Create accepts `session_id`, non-empty `content`,
`trigger_kind` (`at` or `idle`), and an ISO `deliver_at` only for `at`. Timed jobs must be
in the future and no more than 366 days away; jobs are isolated by authenticated owner.

The relay persists `pending -> dispatching -> completed|failed` in SQLite; pending jobs can
be cancelled. Timed jobs become eligible at `deliver_at`; idle jobs become eligible on the
next non-idle to idle transition. Dispatch atomically claims the job, uses a stable
`scheduled-send-...` client message ID, inserts the user row idempotently, and forwards the
ordinary proxy `send` contract. Existing `proxy_send_result` receipts settle the job, so a
relay restart cannot replay an already claimed send. Offline sessions retain pending jobs.
Create, cancel, dispatch, and settlement status events are WebSocket-owner-scoped to the
same authenticated email used by the REST operations.

## Duplicate Proxy Alarm

The relay tracks the complete set of session IDs claimed by every live proxy connection.
When two live proxies claim the same session, browser and Android clients receive:

```json
{
  "type": "duplicate_proxy_alarm",
  "active": true,
  "duplicate_sessions": [
    { "session_id": "sess_123", "proxy_ids": ["desktop-a", "desktop-b"] }
  ],
  "server_ts": "2026-07-11T22:00:00.000Z"
}
```

`connection_ack.duplicate_proxy_alarms` restores active alarms after client reconnect. The
relay sends `active: false` with an empty array as soon as the duplicate claim disappears.
Clients must keep the warning visible while the array is non-empty; last-writer-wins session
routing does not make the collision safe.

## Relay Session Preferences API

Session display names, pinned order, hidden/archive state, and per-session notification mute
are persisted by authenticated relay user and shared by the web UI and Android app.

- `GET /api/preferences/sessions` returns a `preferences` object keyed by `session_id`.
- `PUT /api/preferences/sessions/:sessionId` accepts a partial `preference` object with
  `display_name` (string, at most 100 characters), `pinned` (boolean), `archived` (boolean),
  and `muted` (boolean), then returns the complete normalized preference. The response also
  includes the relay-assigned positive `pin_order` for pinned chats (zero when unpinned).
- `DELETE /api/preferences/sessions/:sessionId` resets that user's preference row.

Example:

```json
{
  "preference": {
    "display_name": "Release checks",
    "pinned": true,
    "archived": false,
    "muted": true
  }
}
```

Archived sessions stay available to the management surface for restore but are omitted from
the normal sidebar/session list. A muted session continues receiving transcript and status
events; only push notification delivery is suppressed for that session. Newly pinned chats
are appended to the authenticated user's stable pin order. Unpinning clears that chat's
order without renumbering or reordering the remaining pins.

## Nightly Validation Status API

The hidden Windows nightly task runs every `tools/*-validate-all.js` entry point with
`--read-only`, appends one JSONL record per harness locally, and publishes each latest result
to the authenticated relay API.

- `GET /api/maintenance/validation` returns the latest persisted result for each harness.
- `PUT /api/maintenance/validation` accepts a single `validation` object containing
  `harness`, `status` (`pass`, `fail`, or `timed_out`), `app_version`, `validator`, `run_id`,
  `duration_ms`, optional `exit_code`, bounded `detail`, and ISO `completed_at`.
- The relay broadcasts `nightly_validation_status` with `validations` and the non-passing
  `failures` subset after each update.
- `connection_ack.nightly_validation_failures` restores persistent warnings after web or
  Android reconnect. A later passing result for a harness removes it from the warning.

Only the eleven auto-discovered validation harness IDs are accepted: `antigravity-v2`,
`claude-cli`, `claude`, `codex-cli`, `codex-desktop`, `continue`, `cursor-cli`, `cursor`,
`native-golden-approval`, `production-block-inventory`, and `visual-regression`. The relay
allowlist is contract-checked against nightly discovery so a newly added validator cannot
silently fail publication. Both endpoints require the same cookie or bearer authentication
as the other maintenance APIs.

### Event-driven app-update validation

The hidden app-update sentinel watches installed executable, package, and extension
version sources and keeps a durable local baseline. A changed version immediately runs
only the matching `*-validate-all.js` entry point in read-only mode. Missing validators
fail closed. The published validation uses `kind: "app_update_validation"` and adds
`previous_app_version` plus `change_detected_at` to the nightly validation fields.

After accepting that kind, the relay persists the latest app-update result and broadcasts:

```json
{
  "type": "app_update_validation_status",
  "validation": {
    "kind": "app_update_validation",
    "harness": "cursor",
    "previous_app_version": "3.5.32",
    "app_version": "3.5.33",
    "status": "pass",
    "completed_at": "2026-07-12T21:00:00.000Z"
  }
}
```

`connection_ack.latest_app_update_validation` restores the banner after reconnect, and
`GET /api/maintenance/validation` returns the same value as
`latest_app_update_validation`. The relay routes a pass through the `agent_ready`
notification preference and a failure through `agent_error`. Web and Android show results
completed within the last 24 hours. Validator failures also append a checkbox under the
backlog's `App-update drift sentinel triage` heading.

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
14. `file_changes` read and `file_change_response` accept/reject (Cursor)
15. `agent_set_model` with confirming `agent_config`

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
