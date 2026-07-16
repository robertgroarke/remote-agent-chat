# Relay history-store operations

The relay stores transcripts and resumable session metadata in `/data/messages.db` inside
the `agent-relay` container. That path must remain on the persistent Docker volume.

## Retention policy

- Keep all active-session history.
- Treat a session as inactive only when it is not claimed by a connected proxy and its most
  recent message is older than the selected retention window.
- The operational default is 90 days. The API accepts 1–3650 days.
- Measure before changing retention. Pruning is manual, requires the exact confirmation
  `PRUNE_INACTIVE_HISTORY`, and always creates a SQLite online backup first.
- Do not run filesystem copies of the live `.db`, `-wal`, or `-shm` files as a backup set.

## Measure growth

Use an authenticated browser session or Android bearer token:

```text
GET /api/maintenance/history?retention_days=90
```

Record `db_bytes`, `wal_bytes`, message/session counts, oldest/newest timestamps, and inactive
candidate counts in the maintenance ledger. Compare byte and message deltas between runs.

## Create a consistent backup

```text
POST /api/maintenance/history/backup
Content-Type: application/json

{}
```

The relay starts a background SQLite online-backup job and returns HTTP 202. Poll
`GET /api/maintenance/history/backup` until `job.status` is `complete` (or investigate
`failed`). In-progress files end in `.partial`; only a completed backup is renamed to `.db`.
By default the start request reuses a completed same-size backup from the last 24 hours; send
`{"reuse_recent":false}` only when policy requires a fresh copy.
Copy that completed timestamped file beneath `/data/backups/` off-host using the normal private backup system.
Retain at least one daily backup for 14 days and one weekly backup for 8 weeks. Periodically
restore a copy into an isolated container and run `PRAGMA integrity_check`.

## Prune inactive history

Review the measurement first. Then send:

```text
POST /api/maintenance/history/prune
Content-Type: application/json

{"retention_days":90,"confirm":"PRUNE_INACTIVE_HISTORY","backup_path":"/data/backups/messages-<timestamp>.db"}
```

`backup_path` must exactly match the newest completed backup and that backup must be less than
24 hours old. The response identifies the backup path and exact session/message delete counts.
A missing/incorrect confirmation or backup path is rejected without deleting anything.

## Restore

1. Stop only the relay container through the normal Unraid/Docker workflow.
2. Preserve the current `/data/messages.db*` files under a timestamped recovery directory.
3. Copy the chosen completed backup to `/data/messages.db` and ensure the container user owns it.
4. Start the relay, verify `/healthz` and `/readyz`, then run the mandatory tokenless-login,
   signed-in browser, and Android bearer gates.
5. Keep the pre-restore files until transcript counts and representative session resumes are
   verified.
