#!/usr/bin/env python3
"""Read-only post-deploy audit of the production semantic notification ledger."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shlex

import paramiko


ROOT = Path(__file__).resolve().parents[1]


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def remote_command(ssh: paramiko.SSHClient, command: str) -> str:
    _, stdout, stderr = ssh.exec_command(command, timeout=30)
    output = stdout.read().decode("utf-8", errors="replace").strip()
    error = stderr.read().decode("utf-8", errors="replace").strip()
    exit_code = stdout.channel.recv_exit_status()
    if exit_code != 0:
        raise RuntimeError(f"remote command failed ({exit_code}): {error or output}")
    return output


def build_audit_result(
    ledger: dict,
    *,
    container_id: str,
    image_id: str,
    restart_count: int,
    container_started_at: str,
    require_telemetry: bool = False,
    min_duration_minutes: float = 0,
    expected_container_id: str | None = None,
    expected_image_id: str | None = None,
) -> dict:
    by_type = {row["event_type"]: row["count"] for row in ledger["by_type"]}
    telemetry_present = bool(ledger.get("telemetry_present"))
    acceptance = {
        "zero_persisted_turn_ready": by_type.get("turn_ready", 0) == 0,
        "zero_false_goal_completed": int(ledger.get("invalid_goal_completed", 0)) == 0,
        "zero_legacy_completion_copy": int(ledger.get("legacy_completion_events", 0)) == 0,
        "zero_turn_ready_delivery_stages": int(ledger.get("turn_ready_delivery_stages", 0)) == 0,
        "every_display_has_eligible_stage": int(ledger.get("displayed_without_eligible", 0)) == 0,
        "every_display_has_dispatch_stage": int(ledger.get("displayed_without_dispatch", 0)) == 0,
        "content_free_telemetry_schema": (
            not telemetry_present or int(ledger.get("telemetry_forbidden_columns", 0)) == 0
        ),
        "required_telemetry_present": telemetry_present or not require_telemetry,
        "minimum_duration_met": float(ledger.get("duration_minutes", 0)) >= min_duration_minutes,
        "container_restart_count_zero": int(restart_count) == 0,
        "expected_container_unchanged": (
            not expected_container_id or container_id.lower().startswith(expected_container_id.lower())
        ),
        "expected_image_unchanged": (
            not expected_image_id or image_id.removeprefix("sha256:").lower().startswith(
                expected_image_id.removeprefix("sha256:").lower()
            )
        ),
    }
    invalid_goal_completed = int(ledger.get("invalid_goal_completed", 0))
    goal_completed = int(by_type.get("goal_completed", 0))
    result = {
        "ok": all(acceptance.values()),
        "mode": "read_only",
        "container_id": container_id[:12],
        "image_id": image_id.removeprefix("sha256:")[:12],
        "restart_count": int(restart_count),
        "container_started_at": container_started_at,
        "since": ledger["since"],
        "generated_at": ledger.get("generated_at"),
        "duration_minutes": ledger.get("duration_minutes", 0),
        "minimum_duration_minutes": min_duration_minutes,
        "semantic_events_total": ledger["total"],
        "semantic_events_by_type": ledger["by_type"],
        "turn_ready_events": by_type.get("turn_ready", 0),
        "goal_completed_events": goal_completed,
        "valid_native_goal_completed_events": max(0, goal_completed - invalid_goal_completed),
        "false_goal_completed_events": invalid_goal_completed,
        "legacy_completion_events": int(ledger.get("legacy_completion_events", 0)),
        "preference_rows": ledger["preference_rows"],
        "telemetry": {
            "present": telemetry_present,
            "total": int(ledger.get("telemetry_total", 0)),
            "by_stage": ledger.get("telemetry_by_stage", []),
            "by_reason": ledger.get("telemetry_by_reason", []),
            "by_channel": ledger.get("telemetry_by_channel", []),
            "by_event_type": ledger.get("telemetry_by_event_type", []),
            "turn_ready_delivery_stages": int(ledger.get("turn_ready_delivery_stages", 0)),
            "displayed_without_eligible": int(ledger.get("displayed_without_eligible", 0)),
            "displayed_without_dispatch": int(ledger.get("displayed_without_dispatch", 0)),
            "forbidden_content_columns": int(ledger.get("telemetry_forbidden_columns", 0)),
        },
        "baseline_comparison": {
            "prior_false_turn_ready_events": 39,
            "current_turn_ready_events": by_type.get("turn_ready", 0),
            "absolute_reduction": 39 - int(by_type.get("turn_ready", 0)),
        },
        "acceptance": acceptance,
        "writes": 0,
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", help="ISO-8601 lower bound; defaults to current container start")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--require-telemetry", action="store_true")
    parser.add_argument("--min-duration-minutes", type=float, default=0)
    parser.add_argument("--expected-container-id")
    parser.add_argument("--expected-image-id")
    args = parser.parse_args()

    load_env(ROOT / ".env")
    load_env(ROOT / "relay-server" / ".env")
    host = os.environ.get("DEPLOY_HOST") or os.environ.get("RELAY_HOST") or "tower"
    username = os.environ.get("DEPLOY_USER", "root")
    password = os.environ.get("DEPLOY_PASSWORD")
    if not password:
        raise RuntimeError("DEPLOY_PASSWORD is required")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(host, username=username, password=password, timeout=15)
    try:
        inspect_raw = remote_command(
            ssh,
            "docker inspect --format "
            + shlex.quote("{{json .Id}}|{{json .Image}}|{{.RestartCount}}|{{json .State.StartedAt}}")
            + " agent-relay",
        )
        container_json, image_json, restart_text, started_json = inspect_raw.split("|", 3)
        container_id = json.loads(container_json)
        image_id = json.loads(image_json)
        started_at = json.loads(started_json)
        since = args.since or started_at

        node_script = f"""
const Database = require('/app/node_modules/better-sqlite3');
const db = new Database('/data/messages.db', {{ readonly: true, fileMustExist: true }});
const since = {json.dumps(since)};
const byType = db.prepare(`
  SELECT event_type, COUNT(*) AS count, MIN(created_at) AS first_at, MAX(created_at) AS last_at
  FROM semantic_notification_events
  WHERE created_at >= ?
  GROUP BY event_type
  ORDER BY event_type
`).all(since);
const preferenceRows = db.prepare(`
  SELECT turn_ready, goal_completed, COUNT(*) AS accounts
  FROM notification_preferences
  GROUP BY turn_ready, goal_completed
  ORDER BY turn_ready, goal_completed
`).all();
const eventRows = db.prepare(`
  SELECT event_type, title, body, payload_json
  FROM semantic_notification_events
  WHERE created_at >= ?
`).all(since);
let invalidGoalCompleted = 0;
let legacyCompletionEvents = 0;
for (const row of eventRows) {{
  if (/session completed/i.test(`${{row.title || ''}} ${{row.body || ''}}`)) legacyCompletionEvents += 1;
  if (row.event_type !== 'goal_completed') continue;
  let payload = {{}};
  try {{ payload = JSON.parse(row.payload_json || '{{}}'); }} catch {{}}
  const valid = payload.goal_affiliation === 'active_terminal_goal'
    && !!String(payload.native_event_id || '').trim()
    && payload.goal?.state === 'complete'
    && String(payload.dedupe_key || '').startsWith('goal_completed:');
  if (!valid) invalidGoalCompleted += 1;
}}
const telemetryPresent = db.prepare(`
  SELECT COUNT(*) AS count FROM sqlite_master
  WHERE type = 'table' AND name = 'semantic_notification_telemetry'
`).get().count === 1;
let telemetryRows = [];
let telemetryColumns = [];
if (telemetryPresent) {{
  telemetryRows = db.prepare(`
    SELECT dedupe_key, event_type, stage, reason_code, client_channel
    FROM semantic_notification_telemetry
    WHERE occurred_at >= ?
    ORDER BY id
  `).all(since);
  telemetryColumns = db.prepare('PRAGMA table_info(semantic_notification_telemetry)').all().map(row => row.name);
}}
const grouped = field => Object.entries(telemetryRows.reduce((counts, row) => {{
  const key = String(row[field] || 'none');
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}}, {{}})).map(([key, count]) => ({{ key, count }})).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
const eligibleKeys = new Set(telemetryRows.filter(row => row.stage === 'eligible').map(row => row.dedupe_key));
const dispatchedKeys = new Set(telemetryRows.filter(row => row.stage === 'dispatched').map(row => row.dedupe_key));
const displayedKeys = [...new Set(telemetryRows.filter(row => row.stage === 'displayed').map(row => row.dedupe_key))];
const turnReadyDeliveryStages = telemetryRows.filter(row =>
  row.event_type === 'turn_ready' && ['eligible', 'dispatched', 'claimed', 'displayed'].includes(row.stage)
).length;
const forbiddenColumns = new Set(['title', 'body', 'content', 'message', 'email', 'endpoint', 'token']);
const total = db.prepare(`
  SELECT COUNT(*) AS count
  FROM semantic_notification_events
  WHERE created_at >= ?
`).get(since).count;
db.close();
const generatedAt = new Date().toISOString();
const sinceMs = Date.parse(since);
process.stdout.write(JSON.stringify({{
  since,
  generated_at: generatedAt,
  duration_minutes: Number.isFinite(sinceMs) ? Math.max(0, (Date.now() - sinceMs) / 60000) : 0,
  total,
  by_type: byType,
  preference_rows: preferenceRows,
  invalid_goal_completed: invalidGoalCompleted,
  legacy_completion_events: legacyCompletionEvents,
  telemetry_present: telemetryPresent,
  telemetry_total: telemetryRows.length,
  telemetry_by_stage: grouped('stage'),
  telemetry_by_reason: grouped('reason_code'),
  telemetry_by_channel: grouped('client_channel'),
  telemetry_by_event_type: grouped('event_type'),
  turn_ready_delivery_stages: turnReadyDeliveryStages,
  displayed_without_eligible: displayedKeys.filter(key => !eligibleKeys.has(key)).length,
  displayed_without_dispatch: displayedKeys.filter(key => !dispatchedKeys.has(key)).length,
  telemetry_forbidden_columns: telemetryColumns.filter(column => forbiddenColumns.has(column)).length,
}}));
""".strip()
        ledger = json.loads(remote_command(
            ssh,
            f"docker exec agent-relay node -e {shlex.quote(node_script)}",
        ))
    finally:
        ssh.close()

    result = build_audit_result(
        ledger,
        container_id=container_id,
        image_id=image_id,
        restart_count=int(restart_text),
        container_started_at=started_at,
        require_telemetry=args.require_telemetry,
        min_duration_minutes=max(0, args.min_duration_minutes),
        expected_container_id=args.expected_container_id,
        expected_image_id=args.expected_image_id,
    )
    if not result["ok"]:
        raise AssertionError(json.dumps(result, indent=2))
    serialized = json.dumps(result, indent=2) + "\n"
    if args.output:
        output = args.output if args.output.is_absolute() else ROOT / args.output
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(serialized, encoding="utf-8")
    print(serialized, end="")


if __name__ == "__main__":
    main()
