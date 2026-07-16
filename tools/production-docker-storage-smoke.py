#!/usr/bin/env python3
"""Read-only proof that relay Docker storage can accept the next atomic candidate."""

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import paramiko


ROOT = Path(__file__).resolve().parent.parent
MIN_FREE_KB = 2 * 1024 * 1024


def load_env(path):
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def run(ssh, command):
    _, stdout, stderr = ssh.exec_command(command, timeout=30)
    body = stdout.read().decode("utf-8", "replace").strip()
    error = stderr.read().decode("utf-8", "replace").strip()
    status = stdout.channel.recv_exit_status()
    if status:
        raise RuntimeError(f"remote command failed ({status}): {error or body}")
    return body


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    args = parser.parse_args()

    load_env(ROOT / ".env")
    password = os.environ.get("DEPLOY_PASSWORD")
    if not password:
        raise RuntimeError("DEPLOY_PASSWORD is unavailable")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        os.environ.get("DEPLOY_HOST", "tower"),
        username=os.environ.get("DEPLOY_USER", "root"),
        password=password,
        timeout=15,
    )
    try:
        docker_root = run(ssh, "docker info --format '{{.DockerRootDir}}'")
        disk_fields = run(ssh, f"df -Pk {docker_root} | awk 'NR == 2 {{ print $2, $3, $4, $5 }}'").split()
        if len(disk_fields) != 4:
            raise RuntimeError("Docker free-space fields are unavailable")
        total_kb, used_kb, free_kb = (int(value) for value in disk_fields[:3])
        dangling_ids = [value for value in run(
            ssh, "docker images --filter dangling=true --format '{{.ID}}'"
        ).splitlines() if value]
        dangling_referenced = 0
        dangling_unreferenced = 0
        dangling_referenced_bytes = 0
        for image_id in dangling_ids:
            references = [value for value in run(
                ssh, f"docker ps -a --filter ancestor={image_id} --format '{{{{.ID}}}}'"
            ).splitlines() if value]
            if references:
                dangling_referenced += 1
                dangling_referenced_bytes += int(run(
                    ssh, f"docker image inspect --format '{{{{.Size}}}}' {image_id}"
                ))
            else:
                dangling_unreferenced += 1
        relay_fields = run(
            ssh,
            "docker inspect --format '{{.Id}}|{{.Image}}|{{.State.Status}}|{{.RestartCount}}' agent-relay",
        ).split("|")
        if len(relay_fields) != 4:
            raise RuntimeError("active relay container fields are unavailable")
        result = {
            "ok": free_kb >= MIN_FREE_KB and dangling_unreferenced == 0 and relay_fields[2] == "running",
            "docker_root": docker_root,
            "minimum_free_kb": MIN_FREE_KB,
            "storage": {
                "total_kb": total_kb,
                "used_kb": used_kb,
                "free_kb": free_kb,
                "used_percent": disk_fields[3],
            },
            "dangling_images": {
                "total_count": len(dangling_ids),
                "referenced_by_container_count": dangling_referenced,
                "unreferenced_count": dangling_unreferenced,
                "referenced_bytes": dangling_referenced_bytes,
            },
            "relay": {
                "container_id_prefix": relay_fields[0][:12],
                "image_id_prefix": relay_fields[1].removeprefix("sha256:")[:12],
                "state": relay_fields[2],
                "restart_count": int(relay_fields[3]),
            },
            "safety": {
                "read_only": True,
                "prune_all_used": False,
                "volumes_pruned": False,
            },
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        if not result["ok"]:
            raise RuntimeError(f"production Docker storage gate failed: {json.dumps(result)}")
        serialized = json.dumps(result, indent=2) + "\n"
        if args.output:
            output = Path(args.output).resolve()
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(serialized, encoding="utf-8")
        print(serialized, end="")
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
