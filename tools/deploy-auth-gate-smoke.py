#!/usr/bin/env python3
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rebuild_unraid_docker import build_relay_deploy_command


command = build_relay_deploy_command('/tmp/relay fixture', 'bridge', cache_bust=123)
required = [
    "http://127.0.0.1:3500/ -w '%{http_code}'",
    "grep -qi '^location: /auth/google'",
    'Authorization: Bearer $bearer_token',
    "grep -q 'id=\"root\"'",
    'rollback_relay',
    'Candidate auth probes passed: OAuth redirect and bearer app shell.',
]
missing = [marker for marker in required if marker not in command]
if missing:
    raise AssertionError(f'missing deploy auth markers: {missing}')
if command.index("http://127.0.0.1:3500/healthz") > command.index("grep -qi '^location: /auth/google'"):
    raise AssertionError('auth probes must run after healthz')
if command.index("grep -q 'id=\"root\"'") > command.index('docker tag "$candidate" agent-relay-img:latest'):
    raise AssertionError('auth probes must pass before candidate promotion')

print(json.dumps({
    'ok': True,
    'unauthenticated_redirect_gate': True,
    'authenticated_app_shell_gate': True,
    'rollback_on_auth_failure': True,
    'runs_before_candidate_promotion': True,
}, indent=2))
