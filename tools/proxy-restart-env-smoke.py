#!/usr/bin/env python3
"""Verify mutex restarts launch with the canonical agent-proxy environment."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent.parent
CONFIG_ROOT = Path(os.environ.get("RAC_CONFIG_ROOT") or ROOT).resolve()
sys.path.insert(0, str(ROOT))


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def main() -> None:
    proxy_env_path = CONFIG_ROOT / "agent-proxy" / ".env"
    if not proxy_env_path.is_file():
        raise AssertionError(f"missing canonical proxy env: {proxy_env_path}")
    expected = read_env(proxy_env_path)
    import proxy_restart_lock  # noqa: F401,E402 - importing applies launch env overlay

    if proxy_restart_lock.LOCK_FILE != CONFIG_ROOT / "proxy_restart.lock":
        raise AssertionError("restart mutex is not anchored to RAC_CONFIG_ROOT")

    for key in ("CDP_PORTS", "RELAY_URL"):
        if not expected.get(key):
            raise AssertionError(f"canonical proxy env is missing {key}")
        if os.environ.get(key) != expected[key]:
            raise AssertionError(
                f"effective {key} does not match agent-proxy/.env: "
                f"{os.environ.get(key)!r} != {expected[key]!r}"
            )

    previous_node_path = os.environ.pop("NODE_PATH", None)
    previous_store_path = os.environ.pop("SESSION_STORE_PATH", None)
    previous_drift_state_path = os.environ.pop("RAC_APP_UPDATE_DRIFT_STATE_PATH", None)
    try:
        with tempfile.TemporaryDirectory(prefix="rac-proxy-clean-source-") as temp:
            clean_root = Path(temp)
            clean_proxy = clean_root / "agent-proxy"
            clean_proxy.mkdir()
            proxy_restart_lock.ProxyRestartLock(
                agent="clean-source-env-smoke",
                source_root=clean_root,
            )
            canonical_modules = str(CONFIG_ROOT / "agent-proxy" / "node_modules")
            node_path = os.environ.get("NODE_PATH", "").split(os.pathsep)
            if canonical_modules not in node_path:
                raise AssertionError("clean source restart did not inherit canonical NODE_PATH dependencies")
            canonical_store = str(CONFIG_ROOT / "agent-proxy" / "session-store.json")
            if os.environ.get("SESSION_STORE_PATH") != canonical_store:
                raise AssertionError("clean source restart did not retain the canonical session store")
            canonical_drift_state = str(CONFIG_ROOT / "data" / "app-update-drift-state.json")
            if os.environ.get("RAC_APP_UPDATE_DRIFT_STATE_PATH") != canonical_drift_state:
                raise AssertionError("clean source restart did not retain canonical app-validation state")
            resolved = subprocess.run(
                ["node", "-p", "require.resolve('dotenv')"],
                cwd=clean_proxy,
                env=os.environ.copy(),
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
            if not resolved.endswith(str(Path("dotenv") / "lib" / "main.js")):
                raise AssertionError(f"clean source resolved unexpected dotenv module: {resolved}")
            resolved_state = subprocess.run(
                [
                    "node",
                    "-p",
                    "require('./agent-proxy/harness-revalidation').DEFAULT_STATE_PATH",
                ],
                cwd=ROOT,
                env=os.environ.copy(),
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
            if resolved_state != canonical_drift_state:
                raise AssertionError(
                    f"proxy adapter resolved unexpected validation state: "
                    f"{resolved_state!r} != {canonical_drift_state!r}"
                )
    finally:
        if previous_node_path is None:
            os.environ.pop("NODE_PATH", None)
        else:
            os.environ["NODE_PATH"] = previous_node_path
        if previous_store_path is None:
            os.environ.pop("SESSION_STORE_PATH", None)
        else:
            os.environ["SESSION_STORE_PATH"] = previous_store_path
        if previous_drift_state_path is None:
            os.environ.pop("RAC_APP_UPDATE_DRIFT_STATE_PATH", None)
        else:
            os.environ["RAC_APP_UPDATE_DRIFT_STATE_PATH"] = previous_drift_state_path

    print("PASS proxy restart environment and clean-source dependency/state fallback")


if __name__ == "__main__":
    main()
