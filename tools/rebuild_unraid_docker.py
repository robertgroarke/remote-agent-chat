import argparse
import paramiko
import os
import shlex
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_ROOT = os.path.abspath(os.environ.get('DEPLOY_SOURCE_ROOT', SCRIPT_DIR))

# Load root .env if present (so deploy creds don't need to be in shell env)
_env_path = os.path.join(SCRIPT_DIR, '.env')
if os.path.isfile(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _k, _v = _line.split('=', 1)
                os.environ.setdefault(_k.strip(), _v.strip())

RELAY_SKIP = {'node_modules', '__pycache__', '.env', '.gitignore', 'data'}
FRONTEND_SKIP = {'node_modules', '.gitignore', 'src', 'entry.jsx', 'build.js',
                 'package.json', 'package-lock.json', '.gitkeep',
                 'agent-chat.apk', 'agent-chat.apk.idsig'}
PRUNE_PROTECTED_CONTAINERS = ('agent-relay', 'agent-relay-rescue')


def sftp_mkdir_p(sftp, remote_path):
    """Recursively create remote directory, ignoring if it already exists."""
    parts = remote_path.replace('\\', '/').split('/')
    path = ''
    for part in parts:
        if not part:
            path = '/'
            continue
        path = f"{path}/{part}" if path != '/' else f"/{part}"
        try:
            sftp.stat(path)
        except FileNotFoundError:
            sftp.mkdir(path)


def sync_dir(sftp, local_dir, remote_dir, skip_names, depth=0):
    """Recursively sync local_dir → remote_dir via SFTP, skipping skip_names."""
    sftp_mkdir_p(sftp, remote_dir)
    ALLOW_DOTFILES = {'.dockerignore'}
    for entry in sorted(os.listdir(local_dir)):
        if entry in skip_names or (entry.startswith('.') and entry not in ALLOW_DOTFILES):
            continue
        local_path = os.path.join(local_dir, entry)
        remote_path = f"{remote_dir}/{entry}"
        if os.path.isdir(local_path):
            sync_dir(sftp, local_path, remote_path, set(), depth + 1)
        else:
            sftp.put(local_path, remote_path)
            indent = '  ' * (depth + 1)
            print(f"{indent}synced {os.path.relpath(local_path, SOURCE_ROOT)}")


def build_frontend():
    """Run esbuild to compile JSX → dist/bundle.js before deploying."""
    import subprocess
    frontend_dir = os.path.join(SOURCE_ROOT, 'frontend')
    env = os.environ.copy()
    dependency_roots = []
    for candidate in (
        os.path.join(frontend_dir, 'node_modules'),
        os.path.join(SCRIPT_DIR, 'frontend', 'node_modules'),
        os.path.join(SCRIPT_DIR, 'agent-proxy', 'vscode-ext', 'node_modules'),
    ):
        if os.path.isfile(os.path.join(candidate, 'esbuild', 'package.json')):
            dependency_roots.append(candidate)
    inherited = [entry for entry in env.get('NODE_PATH', '').split(os.pathsep) if entry]
    node_path = list(dict.fromkeys(dependency_roots + inherited))
    if not node_path:
        print("  ERROR: Frontend build dependency 'esbuild' is unavailable. Run npm install in frontend/.")
        sys.exit(1)
    env['NODE_PATH'] = os.pathsep.join(node_path)
    print("  Building frontend (esbuild)...")
    result = subprocess.run(
        ['node', 'build.js'],
        cwd=frontend_dir,
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"  ERROR: Frontend build failed:\n{result.stderr}")
        sys.exit(1)
    print(f"  {result.stderr.strip() or 'Build complete.'}")


def sync_files(ssh, do_relay=True):
    sftp = ssh.open_sftp()
    relay_path = os.environ.get('DEPLOY_RELAY_PATH', '/mnt/user/appdata/agent-relay')

    if do_relay:
        print("  Syncing relay-server/...")
        sync_dir(
            sftp,
            os.path.join(SOURCE_ROOT, 'relay-server'),
            relay_path,
            RELAY_SKIP,
        )
        print("  Syncing shared runtime contracts/...")
        sync_dir(
            sftp,
            os.path.join(SOURCE_ROOT, 'shared'),
            f'{relay_path}/shared',
            set(),
        )
        print("  Syncing frontend/...")
        sync_dir(
            sftp,
            os.path.join(SOURCE_ROOT, 'frontend'),
            f'{relay_path}/public',
            FRONTEND_SKIP,
        )

    sftp.close()
    print("File sync complete.\n")


DEPLOY_LOCK = "/tmp/agent-relay-deploy.lock"
LOCK_TIMEOUT = 300


def acquire_lock(ssh):
    deadline = time.time() + LOCK_TIMEOUT
    while time.time() < deadline:
        _, stdout, _ = ssh.exec_command(
            f'set -o noclobber && echo $$ > {DEPLOY_LOCK} 2>/dev/null && echo acquired'
        )
        result = stdout.read().decode().strip()
        if result == 'acquired':
            print("Deploy lock acquired.")
            return
        _, stdout, _ = ssh.exec_command(f'cat {DEPLOY_LOCK} 2>/dev/null || echo unknown')
        holder = stdout.read().decode().strip()
        print(f"Deploy lock held by PID {holder}, waiting…")
        time.sleep(10)
    print(f"ERROR: Could not acquire deploy lock after {LOCK_TIMEOUT}s. Aborting.")
    sys.exit(1)


def release_lock(ssh):
    ssh.exec_command(f'rm -f {DEPLOY_LOCK}')
    print("Deploy lock released.")


def build_prune_command():
    protected_clause = " && ".join(
        [f'[ \"$name\" != \"{name}\" ]' for name in PRUNE_PROTECTED_CONTAINERS]
    )
    return (
        "stopped=\"$(docker ps -a --filter status=exited --filter status=created "
        "--filter status=dead --format '{{.ID}} {{.Names}}')\"; "
        "if [ -z \"$stopped\" ]; then "
        "echo 'No stopped orphaned containers to remove.'; "
        "else "
        "while read -r id name; do "
        "[ -n \"$id\" ] || continue; "
        f"if {protected_clause}; then "
        "echo \"Removing stopped container: $name ($id)\"; "
        "docker rm -f \"$id\"; "
        "else "
        "echo \"Preserving protected container: $name\"; "
        "fi; "
        "done <<EOF\n"
        "$stopped\n"
        "EOF\n"
        "fi && "
        "docker image prune -a -f && "
        "docker builder prune -a -f"
    )


def build_relay_deploy_command(relay_path, docker_network, cache_bust=None):
    """Build first, then atomically swap the live relay with rollback.

    The previous deploy command removed the production container before starting
    a multi-minute image build. A failed or merely slow build therefore caused a
    full outage. Keep the existing container serving while Docker builds the
    candidate, and retain the stopped previous container until the candidate
    passes the real /healthz endpoint.
    """
    cache_bust = int(time.time()) if cache_bust is None else int(cache_bust)
    candidate_image = f'agent-relay-img:candidate-{cache_bust}'
    relay_dir = shlex.quote(relay_path)
    network = shlex.quote(docker_network)
    candidate = shlex.quote(candidate_image)
    env_file = shlex.quote(f'{relay_path}/.env')
    data_dir = shlex.quote(f'{relay_path}/data')
    return f"""set -u
cd {relay_dir}
candidate={candidate}
previous=agent-relay-previous
old_present=0
min_docker_free_kb=2097152

rollback_relay() {{
  echo 'Candidate relay failed; restoring previous container.' >&2
  docker rm -f agent-relay >/dev/null 2>&1 || true
  if docker container inspect "$previous" >/dev/null 2>&1; then
    docker rename "$previous" agent-relay >/dev/null 2>&1 || true
    docker start agent-relay >/dev/null 2>&1 || true
  fi
}}

docker_root=$(docker info --format '{{{{.DockerRootDir}}}}' 2>/dev/null || true)
if [ -z "$docker_root" ] || [ ! -d "$docker_root" ]; then
  echo 'Docker storage preflight failed: DockerRootDir is unavailable.' >&2
  exit 1
fi
docker_free_kb=$(df -Pk "$docker_root" | awk 'NR == 2 {{ print $4 }}')
case "$docker_free_kb" in
  ''|*[!0-9]*)
    echo 'Docker storage preflight failed: free-space value is unavailable.' >&2
    exit 1
    ;;
esac
if [ "$docker_free_kb" -lt "$min_docker_free_kb" ]; then
  echo "Docker storage is below the 2 GiB candidate-build floor ($docker_free_kb KiB free); pruning dangling images only..."
  docker image prune -f
  docker_free_kb=$(df -Pk "$docker_root" | awk 'NR == 2 {{ print $4 }}')
  case "$docker_free_kb" in
    ''|*[!0-9]*)
      echo 'Docker storage preflight failed after dangling-image cleanup.' >&2
      exit 1
      ;;
  esac
  if [ "$docker_free_kb" -lt "$min_docker_free_kb" ]; then
    echo "Docker storage remains below the 2 GiB candidate-build floor ($docker_free_kb KiB free); production was not touched." >&2
    exit 1
  fi
fi
echo "Docker storage preflight passed: $docker_free_kb KiB free."

echo "Building relay candidate $candidate while production remains online..."
if ! docker build --build-arg CACHE_BUST={cache_bust} -f Dockerfile -t "$candidate" .; then
  echo 'Candidate image build failed; production container was not touched.' >&2
  exit 1
fi

if docker container inspect agent-relay >/dev/null 2>&1; then
  old_present=1
  docker rm -f "$previous" >/dev/null 2>&1 || true
  if ! docker stop -t 10 agent-relay; then
    echo 'Could not stop the existing relay; candidate was not started.' >&2
    exit 1
  fi
  if ! docker rename agent-relay "$previous"; then
    docker start agent-relay >/dev/null 2>&1 || true
    echo 'Could not preserve the previous relay container.' >&2
    exit 1
  fi
fi

if ! docker run -d --name agent-relay --restart always \
  --log-opt max-size=10m --log-opt max-file=3 \
  --env-file {env_file} \
  -v {data_dir}:/data \
  --network {network} -p 3500:3500 "$candidate"; then
  rollback_relay
  exit 1
fi

healthy=0
attempt=1
while [ "$attempt" -le 30 ]; do
  if curl -fsS --max-time 2 http://127.0.0.1:3500/healthz >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
  attempt=$((attempt + 1))
done

if [ "$healthy" -ne 1 ]; then
  echo 'Candidate relay did not become healthy within 30 seconds.' >&2
  docker logs agent-relay --tail 80 >&2 || true
  rollback_relay
  exit 1
fi

# A healthy API is not enough: the 2026-07-11 outage served JSON unauthorized
# at the app root while /healthz stayed green. Probe both browser and native
# auth paths before removing the preserved previous container.
auth_headers=$(mktemp /tmp/rac-auth-headers.XXXXXX)
auth_body=$(mktemp /tmp/rac-auth-body.XXXXXX)
cleanup_auth_probe() {{ rm -f "$auth_headers" "$auth_body"; }}
trap cleanup_auth_probe EXIT
unauth_status=$(curl -sS --max-time 5 -o "$auth_body" -D "$auth_headers" \
  -H 'X-Forwarded-For: 203.0.113.10' -H 'X-Forwarded-Proto: https' \
  http://127.0.0.1:3500/ -w '%{{http_code}}' || true)
if [ "$unauth_status" != 302 ] || ! grep -qi '^location: /auth/google' "$auth_headers"; then
  echo "Candidate relay auth probe failed: unauthenticated root returned $unauth_status without /auth/google redirect." >&2
  docker logs agent-relay --tail 80 >&2 || true
  rollback_relay
  exit 1
fi

bearer_token=$(docker exec agent-relay node -e \
  'const jwt=require("jsonwebtoken"); const email=process.env.ALLOWED_EMAIL||"deploy-probe@localhost"; if(!process.env.JWT_SECRET) process.exit(2); process.stdout.write(jwt.sign({{email}},process.env.JWT_SECRET,{{expiresIn:"5m"}}));' \
  2>/dev/null || true)
if [ -z "$bearer_token" ]; then
  echo 'Candidate relay auth probe failed: could not mint short-lived bearer token.' >&2
  rollback_relay
  exit 1
fi
auth_status=$(curl -sS --max-time 5 -o "$auth_body" \
  -H 'X-Forwarded-For: 203.0.113.10' -H 'X-Forwarded-Proto: https' \
  -H "Authorization: Bearer $bearer_token" \
  http://127.0.0.1:3500/ -w '%{{http_code}}' || true)
if [ "$auth_status" != 200 ] || ! grep -q 'id="root"' "$auth_body"; then
  echo "Candidate relay auth probe failed: authenticated root returned $auth_status or missing app root." >&2
  docker logs agent-relay --tail 80 >&2 || true
  rollback_relay
  exit 1
fi
cleanup_auth_probe
trap - EXIT
echo 'Candidate auth probes passed: OAuth redirect and bearer app shell.'

if ! docker tag "$candidate" agent-relay-img:latest; then
  echo 'Candidate is healthy, but updating the latest image tag failed.' >&2
  exit 1
fi
docker image rm "$candidate" >/dev/null 2>&1 || true
if [ "$old_present" -eq 1 ]; then
  docker rm -f "$previous" >/dev/null 2>&1 || true
fi
if docker image prune -f; then
  echo 'Pruned dangling Docker images after the successful atomic swap.'
else
  echo 'WARNING: post-swap dangling-image cleanup failed; the healthy relay remains active.' >&2
fi
echo 'Relay candidate is healthy; atomic swap completed.'
"""


def run_ssh_command(do_relay=True, prune=False):
    host     = os.environ.get('DEPLOY_HOST', 'tower')
    user     = os.environ.get('DEPLOY_USER', 'root')
    password = os.environ.get('DEPLOY_PASSWORD')
    if not password:
        print("ERROR: DEPLOY_PASSWORD env var not set. Add it to your shell or a local .env file.")
        sys.exit(1)

    print(f"Connecting to {host}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(host, username=user, password=password, timeout=15)
        acquire_lock(ssh)
        if do_relay:
            build_frontend()
        print("Syncing local files to server...")
        sync_files(ssh, do_relay=do_relay)

        commands = []

        relay_path    = os.environ.get('DEPLOY_RELAY_PATH', '/mnt/user/appdata/agent-relay')
        docker_network = os.environ.get('DEPLOY_DOCKER_NETWORK', 'bridge')

        if do_relay:
            print("Rebuilding agent-relay...")
            commands.append(build_relay_deploy_command(relay_path, docker_network))

        commands.append(
            "sleep 3 && docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep agent-relay"
        )

        if prune:
            commands.append(build_prune_command())

        for i, cmd in enumerate(commands):
            print(f"\n--- Running Step {i+1} ---")
            stdin, stdout, stderr = ssh.exec_command(cmd, get_pty=True)
            for line in iter(stdout.readline, ""):
                try:
                    print(line, end="", flush=True)
                except UnicodeEncodeError:
                    pass
            exit_status = stdout.channel.recv_exit_status()
            if exit_status != 0:
                print(f"Step {i+1} failed with exit status: {exit_status}")
                sys.exit(1)

        print("\nAll commands completed successfully.")

    except Exception as e:
        print(f"SSH Error: {e}")
        sys.exit(1)
    finally:
        release_lock(ssh)
        ssh.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Deploy Agent Relay to Unraid")
    parser.add_argument("--relay-only", action="store_true", help="Rebuild relay server only")
    parser.add_argument(
        "--prune",
        action="store_true",
        help="Remove stopped orphaned containers, then prune unused Docker images/build cache after deploy",
    )
    args = parser.parse_args()

    run_ssh_command(do_relay=True, prune=args.prune)
