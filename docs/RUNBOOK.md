# Remote Agent Chat operations and disaster recovery runbook

This is the operator path for restoring service without opening or focusing a window. Run
PowerShell commands in an existing terminal. Do not start `.bat` files directly. Preserve
the current database and logs before replacing anything, and never push `master`.

## First five minutes

1. Establish whether the failure is relay, tunnel, proxy, or one harness:

   ```powershell
   Invoke-WebRequest "$env:PUBLIC_URL/healthz" -UseBasicParsing
   Invoke-WebRequest "$env:PUBLIC_URL/readyz" -UseBasicParsing
   Get-Content .\proxy.log -Tail 100
   Get-Content .\proxy-err.log -Tail 100
   Get-NetTCPConnection -State Listen | Where-Object LocalPort -In 9223,9225,9226,9227,9228
   ```

2. Protect foreground applications. If a proxy restart is needed, use only the mutex path:

   ```powershell
   python proxy_restart_lock.py --agent "operator-recovery"
   ```

   That path launches `restart-proxy-hidden.vbs`; do not run `restart-proxy.bat`,
   `start-proxy.bat`, a browser, an IDE, or an emulator visibly.

3. After recovery, verify the public health endpoint, tokenless OAuth redirect, authenticated
   app shell, proxy connection, and one representative existing transcript. A green
   `/healthz` alone is not recovery.

## Relay outage or bad deploy

Diagnosis on the Docker host:

```sh
docker ps --filter name=agent-relay
docker logs agent-relay --tail 200
docker inspect agent-relay --format '{{json .State.Health}}'
curl -fsS http://127.0.0.1:3500/healthz
curl -fsS http://127.0.0.1:3500/readyz
```

If the container is absent or unhealthy, use the repository's atomic deploy path from the
existing hidden terminal. It builds a candidate, checks health plus both auth paths, and only
then swaps containers:

```powershell
python deploy_lock.py python tools/rebuild_unraid_docker.py --relay-only
node tools/production-auth-smoke.js
```

Do not hand-copy relay files or run `docker compose down` as a first response. If deployment
cannot recover service, keep the rescue relay online, capture `docker logs agent-relay`, and
roll back through the same deploy lock to the last verified relay commit.

## Proxy dead, stale, or wedged

A stale `proxy.log`, no connected proxy in `/readyz`, or sessions remaining offline while the
relay is healthy indicates the Windows proxy path. Diagnose without starting another proxy:

```powershell
Get-Item .\proxy.log, .\proxy-err.log | Select-Object Name,Length,LastWriteTime
Get-Content .\proxy.log -Tail 100
Get-Content .\proxy-err.log -Tail 100
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in 'node.exe','cmd.exe' -and $_.CommandLine -match 'agent-proxy|restart-proxy\.bat'
} | Select-Object ProcessId,ParentProcessId,Name,CommandLine
schtasks /Query /TN agent-proxy-task /V /FO LIST
```

Recover only through the bounded restart mutex:

```powershell
python proxy_restart_lock.py --agent "operator-recovery"
node tools/duplicate-proxy-alarm-smoke.js
```

The restart helper stops the owned launcher/worker set, relaunches through the hidden VBS,
waits for relay reconnection, and settles. Never run `node agent-proxy/index.js` beside the
scheduled task.

The production self-healing task is `Remote Agent Chat Proxy Watchdog`. It polls the relay
without opening a window and remains passive during relay outages. After the relay is healthy
but all authenticated proxy connections have been absent for two minutes, it performs at most
three mutex restarts with 30/60/120-second backoff. State and logs live under
`%LOCALAPPDATA%\RemoteAgentChat\proxy-watchdog-*`, so its retry budget survives a watchdog
process restart. Inspect or reinstall it without launching a visible process:

```powershell
Get-ScheduledTask -TaskName 'Remote Agent Chat Proxy Watchdog' | Get-ScheduledTaskInfo
Get-Content "$env:LOCALAPPDATA\RemoteAgentChat\proxy-watchdog.log" -Tail 100
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-proxy-watchdog-task.ps1
```

The relay sends one infrastructure-offline push after the same two-minute grace and one
recovery push. If all bounded restarts fail, the watchdog posts one separately authenticated,
de-duplicated failure alert to the relay. Do not add an unbounded process restart loop.

## Duplicate proxy

Symptoms are an orange tray warning, `duplicate_proxy_alarm`, flickering session ownership,
or more than one standalone worker. Capture the process list and proxy log first, then run
the same mutex restart exactly once. Confirm one launcher family and one connected standalone
proxy afterward. Do not kill unrelated Node processes.

```powershell
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -match 'agent-proxy|restart-proxy\.bat'
} | Format-Table ProcessId,ParentProcessId,Name,CommandLine -AutoSize
python proxy_restart_lock.py --agent "duplicate-proxy-recovery"
Get-Content .\proxy.log -Tail 100
```

If duplication returns, verify the VSIX is uninstalled and only `agent-proxy-task` owns the
standalone mode before making another change.

## CDP target or port loss

Map ports to products; do not infer a product from the selected model:

| Port | Product |
|---:|---|
| 9223 | VS Code extension host |
| 9228 | Antigravity IDE extension host |
| 9225 | Codex Desktop |
| 9226 | Antigravity v2 Agent Manager |
| 9227 | Cursor IDE |

Read-only diagnosis:

```powershell
9223,9225,9226,9227,9228 | ForEach-Object {
  $port = $_
  try { Invoke-RestMethod "http://127.0.0.1:$port/json/list" -TimeoutSec 2 |
    Select-Object @{n='Port';e={$port}},id,title,url }
  catch { "CDP $port unavailable: $($_.Exception.Message)" }
}
Get-Content .\agent-proxy\panel-discovery.log -Tail 150
```

If an app updated or restarted itself, wait for automatic rediscovery and then use its
repeatable validator. Never restart or rebind a user's active app. A real GUI relaunch is
allowed only in a user-approved safe window and must be unmappable before first paint; a
post-launch hide is not sufficient.

## History database growth or corruption

The persistent relay database is `/data/messages.db`. WAL and shared-memory siblings are
runtime files, not standalone backups. Measure and create a consistent online backup through
the authenticated maintenance API described in [HISTORY_STORE_OPERATIONS.md](HISTORY_STORE_OPERATIONS.md).
Never copy a live `.db`, `-wal`, and `-shm` set with ordinary filesystem commands.

For suspected corruption, stop only the relay before manipulating files and preserve the
entire current set:

```sh
docker stop agent-relay
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "/mnt/user/appdata/agent-relay/recovery/$stamp"
cp -a /mnt/user/appdata/agent-relay/data/messages.db* "/mnt/user/appdata/agent-relay/recovery/$stamp/"
```

Choose only a completed `/data/backups/messages-*.db` file, never `.partial`. In an isolated
container or host with SQLite, verify before restoring:

```sh
sqlite3 /path/to/messages-completed.db 'PRAGMA integrity_check;'
sqlite3 /path/to/messages-completed.db 'SELECT COUNT(*) AS messages FROM messages;'
```

With the relay stopped, remove stale target `-wal`/`-shm` siblings, copy the verified backup
to the mounted data directory as `messages.db`, fix ownership to the container's data owner,
and start the relay. Keep the preserved pre-restore set until message counts and representative
session resumes are verified. Then run health, readiness, OAuth-redirect, authenticated-app,
Android bearer, and transcript-resume gates.

The repository's safe repeatable drill never touches production:

```powershell
node tools/relay-db-restore-drill.js --output evidence/harness-maturity/2026-07-12/relay-db-restore-drill.json
```

It creates a WAL-backed fixture under the OS temp directory, takes an online backup, rejects
an incomplete `.partial`, preserves a simulated corrupt DB, restores the completed backup,
runs `integrity_check` and `quick_check`, compares exact rows/canonical blocks, and removes
the fixture.

For a completed real production backup, first create or reuse one through the guarded
maintenance API, then validate a copied restore in an isolated container:

```powershell
node tools/production-history-store-hygiene-smoke.js --output evidence/harness-maturity/<date>/production-history-store-hygiene-restore-source.json
python tools/production-relay-db-restore-drill.py --backup-path /data/backups/messages-<completed-timestamp>.db --output evidence/harness-maturity/<date>/production-relay-db-restore-drill.json
```

The production drill maps only the validated completed-backup basename into the configured
relay data directory. It checks temp capacity, copies the backup under `/tmp`, verifies its
SHA-256, mounts that copy read-only into a one-shot container using the running relay's
immutable image ID, disables container networking, runs integrity/schema/count checks, and
removes the copy before emitting success. It never stops, mounts, or writes the live DB.

## Certificate, DNS, or Cloudflare Tunnel failure

If local relay health passes but the public URL fails, separate DNS/TLS from the connector:

```powershell
Resolve-DnsName ([uri]$env:PUBLIC_URL).Host
curl.exe -sSvo NUL "$env:PUBLIC_URL/healthz"
```

On the Docker host:

```sh
docker ps --filter name=cloudflared
docker logs cloudflared --tail 200
docker inspect cloudflared --format '{{json .State}}'
```

Confirm the named tunnel token is current and its public hostname routes to
`http://relay:3500`, not `localhost`. Certificate name/expiry errors belong to the public
hostname or tunnel edge; do not disable TLS verification. After tunnel recovery, repeat both
tokenless OAuth and authenticated app checks, not only `/healthz`.

## Rescue relay

The rescue relay on port 3501 is intentionally independent. If it activates, follow the
binding rescue protocol in `CLAUDE.md`: inspect the main relay, repair through `deploy_lock.py`,
verify main health/auth, and leave the rescue path running until main service is confirmed.
Use `node tools/rescue-path-production-drill.js` only under its documented isolation guards;
it is not a substitute for the database restore drill.

## New-machine bootstrap

1. Install Git, Node.js 20, Python 3, Docker/Compose, and the required browser/IDE harnesses.
2. Clone the repository, check out the private working branch `master`, and install runtime
   dependencies:

   ```powershell
   npm --prefix relay-server ci
   npm --prefix agent-proxy ci
   ```

3. Create gitignored `relay-server/.env` and `agent-proxy/.env` from the documented variables
   in `CLAUDE.md`/`SELF_HOSTING.md`. Generate new strong secrets; do not copy credentials into
   source control or evidence.
4. Provision the persistent `/data` volume, Google OAuth callback, Cloudflare named tunnel,
   and public URL. Bring up the relay with the atomic deploy path and prove `/healthz`,
   `/readyz`, OAuth redirect, authenticated app shell, and Android bearer access.
5. Import `agent-proxy-task.xml` and retain its hidden VBS route:

   ```powershell
   schtasks /Create /TN agent-proxy-task /XML .\agent-proxy-task.xml /F
   wscript.exe .\restart-proxy-hidden.vbs
   ```

6. Configure the distinct CDP ports above. Never launch a visible app while the operator's
   screen is protected. Verify `/json/list` read-only, then run the relevant harness validators.
7. Restore a verified completed history backup only after the blank relay is healthy. Run the
   isolated restore drill first, stop the relay, preserve the blank DB, restore, and execute all
   post-restore gates before declaring the machine ready.

## Recovery evidence checklist

Record timestamps, failing and recovered health/readiness results, exact commit/image, proxy
PID count, relevant log excerpts, DB backup hash/counts/integrity result, validator names, and
the authenticated/tokenless/Android outcomes. Never record credentials, bearer tokens,
cookies, private hostnames, or raw user transcripts.
