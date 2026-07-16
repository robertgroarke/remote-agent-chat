#!/usr/bin/env python3
"""Read-only proof that the production relay serves the expected source files."""

import argparse
import hashlib
import json
import os
import shlex
from pathlib import Path

import paramiko


ROOT = Path(__file__).resolve().parent.parent


def load_root_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def sha256(path: Path) -> str:
    content = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(content).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    parser.add_argument("--source-root", type=Path, default=ROOT)
    args = parser.parse_args()
    load_root_env()
    source_root = args.source_root.resolve()

    host = os.environ.get("DEPLOY_HOST", "tower")
    user = os.environ.get("DEPLOY_USER", "root")
    password = os.environ.get("DEPLOY_PASSWORD")
    if not password:
        raise RuntimeError("DEPLOY_PASSWORD is required in the local environment")

    expected = {
        "/app/index.js": sha256(source_root / "relay-server" / "index.js"),
        "/app/usage-resume.js": sha256(source_root / "relay-server" / "usage-resume.js"),
        "/app/usage-thresholds.js": sha256(source_root / "relay-server" / "usage-thresholds.js"),
        "/app/proxy-outage-monitor.js": sha256(source_root / "relay-server" / "proxy-outage-monitor.js"),
        "/app/session-export.js": sha256(source_root / "relay-server" / "session-export.js"),
        "/app/session-noise-policy.js": sha256(source_root / "relay-server" / "session-noise-policy.js"),
        "/app/scheduled-sends.js": sha256(source_root / "relay-server" / "scheduled-sends.js"),
        "/app/question-contract-loader.js": sha256(source_root / "relay-server" / "question-contract-loader.js"),
        "/app/question-prompt-registry.js": sha256(source_root / "relay-server" / "question-prompt-registry.js"),
        "/app/shared/question-prompt-contract.js": sha256(source_root / "shared" / "question-prompt-contract.js"),
    }
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(host, username=user, password=password, timeout=15)
        remote_paths = " ".join(expected)
        command = (
            f"docker exec agent-relay sh -c 'for f in {remote_paths}; "
            "do sed \"s/\\r$//\" \"$f\" | sha256sum; done'"
        )
        _, stdout, stderr = ssh.exec_command(command)
        output = stdout.read().decode("utf-8", errors="replace").strip()
        error = stderr.read().decode("utf-8", errors="replace").strip()
        exit_code = stdout.channel.recv_exit_status()
        if exit_code != 0:
            raise RuntimeError(f"remote sha256sum failed ({exit_code}): {error}")
        schema_script = (
            "const Database=require('better-sqlite3');"
            "const db=new Database('/data/messages.db',{readonly:true});"
            "const columns=db.prepare(\"PRAGMA table_info(usage_resume_jobs)\").all().map(r=>r.name);"
            "const rows=db.prepare(\"SELECT state,COUNT(*) count FROM usage_resume_jobs GROUP BY state\").all();"
            "process.stdout.write(JSON.stringify({columns,states:Object.fromEntries(rows.map(r=>[r.state,r.count]))}));"
        )
        _, stdout, stderr = ssh.exec_command(
            f"docker exec agent-relay node -e {shlex.quote(schema_script)}"
        )
        schema_output = stdout.read().decode("utf-8", errors="replace").strip()
        schema_error = stderr.read().decode("utf-8", errors="replace").strip()
        schema_exit = stdout.channel.recv_exit_status()
        if schema_exit != 0:
            raise RuntimeError(f"production usage-resume schema probe failed ({schema_exit}): {schema_error}")
        scheduled_schema_script = (
            "const Database=require('better-sqlite3');"
            "const db=new Database('/data/messages.db',{readonly:true});"
            "const columns=db.prepare(\"PRAGMA table_info(scheduled_sends)\").all().map(r=>r.name);"
            "const indexes=db.prepare(\"PRAGMA index_list(scheduled_sends)\").all().map(r=>r.name).sort();"
            "const rows=db.prepare(\"SELECT state,COUNT(*) count FROM scheduled_sends GROUP BY state\").all();"
            "const total=db.prepare(\"SELECT COUNT(*) count FROM scheduled_sends\").get().count;"
            "process.stdout.write(JSON.stringify({columns,indexes,total,states:Object.fromEntries(rows.map(r=>[r.state,r.count]))}));"
        )
        _, stdout, stderr = ssh.exec_command(
            f"docker exec agent-relay node -e {shlex.quote(scheduled_schema_script)}"
        )
        scheduled_schema_output = stdout.read().decode("utf-8", errors="replace").strip()
        scheduled_schema_error = stderr.read().decode("utf-8", errors="replace").strip()
        scheduled_schema_exit = stdout.channel.recv_exit_status()
        if scheduled_schema_exit != 0:
            raise RuntimeError(
                f"production scheduled-sends schema probe failed ({scheduled_schema_exit}): {scheduled_schema_error}"
            )
    finally:
        ssh.close()

    digest_lines = [line.split()[0].lower() for line in output.splitlines() if line.strip()]
    if len(digest_lines) != len(expected):
        raise AssertionError(f"production source hash output was incomplete: {output!r}")
    actual = dict(zip(expected.keys(), digest_lines))
    if actual != expected:
        raise AssertionError(f"production source hash mismatch: expected={expected} actual={actual}")

    schema = json.loads(schema_output)
    required_columns = {
        "session_id", "goal_fingerprint", "goal_objective", "reset_hint", "reset_at",
        "state", "cycle_cleared", "attempts", "next_attempt_at", "client_msg_id",
        "last_error", "created_at", "updated_at", "completed_at",
    }
    if set(schema.get("columns", [])) != required_columns:
        raise AssertionError(f"production usage_resume_jobs schema mismatch: {schema.get('columns')}")

    scheduled_schema = json.loads(scheduled_schema_output)
    required_scheduled_columns = {
        "id", "owner_email", "session_id", "content", "trigger_kind", "deliver_at",
        "state", "client_msg_id", "last_error", "created_at", "updated_at",
        "dispatched_at", "completed_at",
    }
    if set(scheduled_schema.get("columns", [])) != required_scheduled_columns:
        raise AssertionError(
            f"production scheduled_sends schema mismatch: {scheduled_schema.get('columns')}"
        )
    required_scheduled_indexes = {
        "idx_scheduled_sends_due", "idx_scheduled_sends_session",
        "sqlite_autoindex_scheduled_sends_1", "sqlite_autoindex_scheduled_sends_2",
    }
    if set(scheduled_schema.get("indexes", [])) != required_scheduled_indexes:
        raise AssertionError(
            f"production scheduled_sends indexes mismatch: {scheduled_schema.get('indexes')}"
        )

    result = {
        "ok": True,
        "container": "agent-relay",
        "source_root": str(source_root),
        "files": {path: {"sha256": digest, "match": True} for path, digest in expected.items()},
        "usage_resume_jobs": {
            "schema_complete": True,
            "state_counts": schema.get("states", {}),
        },
        "scheduled_sends": {
            "schema_complete": True,
            "indexes_complete": True,
            "total": scheduled_schema.get("total", 0),
            "state_counts": scheduled_schema.get("states", {}),
        },
        "read_only": True,
        "visible_windows_opened": 0,
    }
    serialized = json.dumps(result, indent=2) + "\n"
    if args.output:
        output_path = Path(args.output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(serialized, encoding="utf-8")
    print(serialized, end="")


if __name__ == "__main__":
    main()
