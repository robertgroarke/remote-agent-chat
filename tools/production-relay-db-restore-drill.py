#!/usr/bin/env python3
"""Validate a completed production relay backup as an isolated restored DB.

The live database and container are never stopped, mounted, or modified. The selected
completed backup is copied beneath /tmp on the Docker host and mounted read-only into a
networkless one-shot container using the currently deployed relay image.
"""

import argparse
import json
import os
import re
import shlex
import sys
from datetime import datetime, timezone
from pathlib import Path

import paramiko


ROOT = Path(__file__).resolve().parent.parent


def load_env(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backup-path", required=True,
                        help="Completed relay path, e.g. /data/backups/messages-...db")
    parser.add_argument("--output", help="Local JSON evidence path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_env(ROOT / ".env")

    match = re.fullmatch(r"/data/backups/(messages-[A-Za-z0-9._-]+\.db)", args.backup_path)
    if not match:
        raise ValueError("--backup-path must name a completed /data/backups/messages-*.db file")
    backup_name = match.group(1)

    host = os.environ.get("DEPLOY_HOST")
    user = os.environ.get("DEPLOY_USER")
    password = os.environ.get("DEPLOY_PASSWORD")
    relay_path = os.environ.get("DEPLOY_RELAY_PATH", "/mnt/user/appdata/agent-relay")
    if not all((host, user, password)):
        raise RuntimeError("DEPLOY_HOST, DEPLOY_USER, and DEPLOY_PASSWORD are required")

    remote_backup = f"{relay_path}/data/backups/{backup_name}"
    node_probe = r"""
const Database = require('/app/node_modules/better-sqlite3');
const db = new Database('/restore/messages.db', { readonly: true, fileMustExist: true });
try {
  db.pragma('query_only = ON');
  const integrity = db.pragma('integrity_check', { simple: true });
  const quick = db.pragma('quick_check', { simple: true });
  const messages = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
  const sessions = db.prepare('SELECT COUNT(DISTINCT session) AS n FROM messages').get().n;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all().map(row => row.name);
  const required = ['messages', 'session_meta'];
  if (integrity !== 'ok' || quick !== 'ok') throw new Error(`SQLite checks failed: ${integrity}/${quick}`);
  for (const name of required) if (!tables.includes(name)) throw new Error(`missing table: ${name}`);
  console.log(JSON.stringify({ integrity_check: integrity, quick_check: quick, messages, sessions,
    required_tables: required, opened_readonly: true }));
} finally {
  db.close();
}
""".strip()

    # Emit results only after explicit cleanup succeeds. The trap is a second safety net.
    remote_script = f"""set -eu
backup={shlex.quote(remote_backup)}
test -f "$backup"
case "$backup" in *.partial) echo 'partial backup refused' >&2; exit 20;; esac
bytes=$(stat -c %s "$backup")
available=$(df -PB1 /tmp | awk 'NR==2 {{print $4}}')
required=$((bytes + 536870912))
if [ "$available" -lt "$required" ]; then
  echo "insufficient /tmp space for isolated restore copy" >&2
  exit 21
fi
tmp=$(mktemp -d /tmp/rac-relay-restore-drill.XXXXXX)
cleanup() {{ rm -rf "$tmp"; }}
trap cleanup EXIT
cp -- "$backup" "$tmp/messages.db"
test ! -e "$tmp/messages.db-wal"
test ! -e "$tmp/messages.db-shm"
source_sha=$(sha256sum "$backup" | awk '{{print $1}}')
copy_sha=$(sha256sum "$tmp/messages.db" | awk '{{print $1}}')
test "$source_sha" = "$copy_sha"
image=$(docker inspect agent-relay --format '{{{{.Image}}}}')
probe=$(docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  -v "$tmp:/restore:ro" --entrypoint node "$image" -e {shlex.quote(node_probe)})
rm -rf "$tmp"
trap - EXIT
test ! -e "$tmp"
printf 'RAC_DRILL_PROBE=%s\n' "$probe"
printf 'RAC_DRILL_SHA=%s\n' "$source_sha"
printf 'RAC_DRILL_BYTES=%s\n' "$bytes"
printf 'RAC_DRILL_CLEANUP=true\n'
"""

    started = datetime.now(timezone.utc)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(host, username=user, password=password, timeout=15)
        _, stdout, stderr = ssh.exec_command(remote_script)
        output = stdout.read().decode("utf-8", errors="replace")
        errors = stderr.read().decode("utf-8", errors="replace")
        exit_code = stdout.channel.recv_exit_status()
    finally:
        ssh.close()
    if exit_code != 0:
        raise RuntimeError(f"isolated production restore drill failed ({exit_code}): {errors.strip()}")

    fields = {}
    for line in output.splitlines():
        if line.startswith("RAC_DRILL_") and "=" in line:
            key, value = line.split("=", 1)
            fields[key] = value
    probe = json.loads(fields["RAC_DRILL_PROBE"])
    if fields.get("RAC_DRILL_CLEANUP") != "true":
        raise RuntimeError("remote temp cleanup was not proved")

    result = {
        "ok": True,
        "started_at": started.isoformat().replace("+00:00", "Z"),
        "completed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "scope": "completed production backup copied to isolated networkless read-only container",
        "backup": {
            "name": backup_name,
            "bytes": int(fields["RAC_DRILL_BYTES"]),
            "sha256": fields["RAC_DRILL_SHA"],
            "partial_refused": True,
        },
        "restore": probe,
        "live_database_stopped": False,
        "live_database_mounted": False,
        "production_database_mutations": 0,
        "network_access_in_restore_container": False,
        "temporary_copy_removed": True,
        "visible_windows_opened": 0,
    }
    serialized = json.dumps(result, indent=2) + "\n"
    if args.output:
        output_path = Path(args.output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(serialized, encoding="utf-8")
    sys.stdout.write(serialized)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"production relay DB restore drill: FAIL ({exc})", file=sys.stderr)
        raise SystemExit(1)
