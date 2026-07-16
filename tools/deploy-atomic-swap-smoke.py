#!/usr/bin/env python3
"""Static contract smoke for the production relay's atomic deploy command."""

from rebuild_unraid_docker import build_prune_command, build_relay_deploy_command


command = build_relay_deploy_command(
    '/mnt/user/appdata/agent-relay path',
    'options-net',
    cache_bust=123456,
)

build_at = command.index('docker build --build-arg CACHE_BUST=123456')
preflight_at = command.index("docker_root=$(docker info --format '{{.DockerRootDir}}'")
preflight_prune_at = command.index('docker image prune -f')
inspect_at = command.index('docker container inspect agent-relay')
stop_at = command.index('docker stop -t 10 agent-relay')
rename_at = command.index('docker rename agent-relay "$previous"')
run_at = command.index('docker run -d --name agent-relay')
health_at = command.index('http://127.0.0.1:3500/healthz')
tag_at = command.index('docker tag "$candidate" agent-relay-img:latest')
remove_previous_at = command.rindex('docker rm -f "$previous"')
post_swap_prune_at = command.rindex('docker image prune -f')

assert preflight_at < preflight_prune_at < build_at < inspect_at < stop_at < rename_at < run_at < health_at < tag_at
assert tag_at < remove_previous_at < post_swap_prune_at
assert 'docker rm -f agent-relay || true && docker build' not in command
assert 'Candidate image build failed; production container was not touched.' in command
assert 'production was not touched.' in command
assert 'min_docker_free_kb=2097152' in command
assert command.count('docker image prune -f') == 2
assert 'docker image prune -a' not in command
assert 'docker volume prune' not in command
assert '--log-opt max-size=10m --log-opt max-file=3' in command
assert 'docker builder prune' not in command
assert 'post-swap dangling-image cleanup failed; the healthy relay remains active.' in command
assert 'rollback_relay' in command
assert 'docker rename "$previous" agent-relay' in command
assert 'docker start agent-relay' in command
assert "cd '/mnt/user/appdata/agent-relay path'" in command
assert '--network options-net' in command

prune_command = build_prune_command()
assert isinstance(prune_command, str) and prune_command
assert 'Preserving protected container: $name' in prune_command
assert '[ "$name" != "agent-relay" ]' in prune_command
assert '[ "$name" != "agent-relay-rescue" ]' in prune_command

print('deploy atomic swap smoke: PASS')
