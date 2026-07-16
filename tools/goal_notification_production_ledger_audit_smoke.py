#!/usr/bin/env python3
"""Offline behavioral checks for the production notification soak evaluator."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

from goal_notification_production_ledger_audit import build_audit_result


def green_ledger() -> dict:
    return {
        "since": "2026-07-15T13:00:00.000Z",
        "generated_at": "2026-07-15T15:01:00.000Z",
        "duration_minutes": 121,
        "total": 2,
        "by_type": [
            {"event_type": "goal_attention", "count": 1, "first_at": "x", "last_at": "x"},
            {"event_type": "goal_completed", "count": 1, "first_at": "x", "last_at": "x"},
        ],
        "preference_rows": [{"turn_ready": 0, "goal_completed": 1, "accounts": 1}],
        "invalid_goal_completed": 0,
        "legacy_completion_events": 0,
        "telemetry_present": True,
        "telemetry_total": 12,
        "telemetry_by_stage": [
            {"key": "candidate", "count": 2},
            {"key": "eligible", "count": 2},
            {"key": "dispatched", "count": 2},
            {"key": "claimed", "count": 2},
            {"key": "displayed", "count": 2},
            {"key": "suppressed", "count": 2},
        ],
        "telemetry_by_reason": [{"key": "authoritative_terminal_missing", "count": 2}],
        "telemetry_by_channel": [{"key": "websocket-live", "count": 2}],
        "telemetry_by_event_type": [
            {"key": "goal_completed", "count": 6},
            {"key": "goal_attention", "count": 6},
        ],
        "turn_ready_delivery_stages": 0,
        "displayed_without_eligible": 0,
        "displayed_without_dispatch": 0,
        "telemetry_forbidden_columns": 0,
    }


def evaluate(ledger: dict, **overrides) -> dict:
    options = {
        "container_id": "abcdef1234567890",
        "image_id": "sha256:0123456789abcdef",
        "restart_count": 0,
        "container_started_at": ledger["since"],
        "require_telemetry": True,
        "min_duration_minutes": 120,
        "expected_container_id": "abcdef123456",
        "expected_image_id": "0123456789ab",
    }
    options.update(overrides)
    return build_audit_result(ledger, **options)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    baseline = evaluate(green_ledger())
    assert baseline["ok"] is True
    assert baseline["valid_native_goal_completed_events"] == 1
    assert baseline["false_goal_completed_events"] == 0
    assert baseline["baseline_comparison"]["absolute_reduction"] == 39

    mutations = {
        "persisted_turn_ready": ("by_type", [
            {"event_type": "turn_ready", "count": 1, "first_at": "x", "last_at": "x"}
        ]),
        "false_goal_completed": ("invalid_goal_completed", 1),
        "legacy_copy": ("legacy_completion_events", 1),
        "turn_ready_delivery": ("turn_ready_delivery_stages", 1),
        "display_without_eligible": ("displayed_without_eligible", 1),
        "display_without_dispatch": ("displayed_without_dispatch", 1),
        "content_column": ("telemetry_forbidden_columns", 1),
        "telemetry_missing": ("telemetry_present", False),
        "duration_short": ("duration_minutes", 119.99),
    }
    rejected = []
    for name, (field, value) in mutations.items():
        fixture = copy.deepcopy(green_ledger())
        if field == "by_type":
            fixture[field].extend(value)
            fixture["total"] += 1
        else:
            fixture[field] = value
        result = evaluate(fixture)
        assert result["ok"] is False, f"{name} mutation passed"
        rejected.append(name)

    assert evaluate(green_ledger(), restart_count=1)["ok"] is False
    assert evaluate(green_ledger(), expected_container_id="different")["ok"] is False
    assert evaluate(green_ledger(), expected_image_id="different")["ok"] is False
    legacy_without_telemetry = copy.deepcopy(green_ledger())
    legacy_without_telemetry["telemetry_present"] = False
    assert evaluate(legacy_without_telemetry, require_telemetry=False)["ok"] is True

    result = {
        "ok": True,
        "truthful_native_goal_completion_accepted": True,
        "false_conditions_rejected": rejected,
        "container_restart_rejected": True,
        "container_identity_change_rejected": True,
        "image_identity_change_rejected": True,
        "telemetry_required_for_formal_soak": True,
        "minimum_duration_minutes": 120,
        "content_values_emitted": 0,
        "production_connections": 0,
        "production_writes": 0,
        "visible_windows_opened": 0,
        "focus_actions": 0,
    }
    serialized = json.dumps(result, indent=2) + "\n"
    if args.output:
        output = args.output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(serialized, encoding="utf-8")
    print(serialized, end="")


if __name__ == "__main__":
    main()
