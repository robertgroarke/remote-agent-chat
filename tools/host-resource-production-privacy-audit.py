#!/usr/bin/env python3
"""Read-only production proof that host-resource frames are neither logged nor stored."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import paramiko


ROOT = Path(__file__).resolve().parent.parent


def load_env(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def remote(ssh: paramiko.SSHClient, command: str, timeout: int = 60) -> str:
    _, stdout, stderr = ssh.exec_command(command, timeout=timeout)
    output = stdout.read().decode("utf-8", errors="replace").strip()
    error = stderr.read().decode("utf-8", errors="replace").strip()
    exit_code = stdout.channel.recv_exit_status()
    if exit_code != 0:
        raise RuntimeError(f"remote command failed ({exit_code}): {error or output}")
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    load_env(ROOT / ".env")
    load_env(ROOT / "relay-server" / ".env")
    password = os.environ.get("DEPLOY_PASSWORD")
    if not password:
        raise RuntimeError("DEPLOY_PASSWORD is unavailable")

    source_commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True,
        creationflags=0x08000000 if os.name == "nt" else 0,
    ).strip()
    database_script = r"""
const Database = require('better-sqlite3');
const db = new Database('/data/messages.db', { readonly: true });
db.pragma('query_only = ON');
const schemaRows = db.prepare(
  "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
).all();
const schemaMatches = schemaRows.filter(row => JSON.stringify(row).toLowerCase().includes('host_resource_'));
const recentMessages = db.prepare(
  'SELECT id,session,content,content_blocks,source FROM messages ORDER BY id DESC LIMIT 1000'
).all();
const recentMessageMatches = recentMessages.filter(row => JSON.stringify(row).toLowerCase().includes('host_resource_')).length;
process.stdout.write(JSON.stringify({
  schema_objects_scanned: schemaRows.length,
  schema_matches: schemaMatches.map(row => ({ type: row.type, name: row.name, table: row.tbl_name })),
  recent_messages_scanned: recentMessages.length,
  recent_message_matches: recentMessageMatches,
}));
"""

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(
            os.environ.get("DEPLOY_HOST", "tower"),
            username=os.environ.get("DEPLOY_USER", "root"),
            password=password,
            timeout=15,
        )
        database = json.loads(remote(
            ssh,
            f"docker exec agent-relay node -e {shlex.quote(database_script)}",
            timeout=60,
        ))
        log_count = int(remote(
            ssh,
            "sh -c \"docker logs --since 15m agent-relay 2>&1 | "
            "grep -aEc 'host_resource_(snapshot|refresh)' || true\"",
            timeout=30,
        ) or 0)
        inspect = remote(
            ssh,
            "docker inspect --format '{{.Id}}|{{.Image}}|{{.State.Status}}' agent-relay",
            timeout=15,
        ).split("|")
    finally:
        ssh.close()

    result = {
        "ok": (
            not database["schema_matches"]
            and database["recent_message_matches"] == 0
            and log_count == 0
        ),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_commit": source_commit,
        "container": {
            "name": "agent-relay",
            "id": inspect[0],
            "image": inspect[1],
            "status": inspect[2],
        },
        "database": {
            "path": "/data/messages.db",
            "query_only": True,
            "schema_objects_scanned": database["schema_objects_scanned"],
            "host_resource_schema_matches": database["schema_matches"],
            "recent_messages_scanned": database["recent_messages_scanned"],
            "host_resource_recent_message_matches": database["recent_message_matches"],
            "exhaustive_storage_canary_evidence": "host-resource-relay-exact-9fb610c.json",
        },
        "logs": {
            "scope": "last_15_minutes",
            "host_resource_marker_matches": log_count,
        },
        "raw_rows_emitted": False,
        "credentials_emitted": False,
    }
    if not result["ok"]:
        raise AssertionError(json.dumps(result, indent=2))
    serialized = json.dumps(result, indent=2) + "\n"
    if args.output:
        output = args.output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(serialized, encoding="utf-8")
    print(serialized, end="")


if __name__ == "__main__":
    main()
