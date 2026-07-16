import importlib.util
import os
import pathlib
import subprocess
import tempfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / 'tools' / 'rebuild_unraid_docker.py'


def load_module(source_root):
    old = os.environ.get('DEPLOY_SOURCE_ROOT')
    os.environ['DEPLOY_SOURCE_ROOT'] = str(source_root)
    try:
        spec = importlib.util.spec_from_file_location('rebuild_unraid_dependency_smoke', MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if old is None:
            os.environ.pop('DEPLOY_SOURCE_ROOT', None)
        else:
            os.environ['DEPLOY_SOURCE_ROOT'] = old


with tempfile.TemporaryDirectory(prefix='rac-clean-deploy-') as temp:
    source_root = pathlib.Path(temp)
    frontend = source_root / 'frontend'
    frontend.mkdir(parents=True)
    (frontend / 'build.js').write_text(
        "require('esbuild'); process.stdout.write('clean-source-esbuild-ok');\n",
        encoding='utf-8',
    )
    module = load_module(source_root)
    module.build_frontend()

    env = os.environ.copy()
    candidates = [
        ROOT / 'frontend' / 'node_modules',
        ROOT / 'agent-proxy' / 'vscode-ext' / 'node_modules',
    ]
    env['NODE_PATH'] = os.pathsep.join(
        str(path) for path in candidates if (path / 'esbuild' / 'package.json').is_file()
    )
    resolved = subprocess.run(
        ['node', '-p', "require.resolve('esbuild')"],
        cwd=frontend,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert resolved, 'esbuild did not resolve from canonical workspace dependencies'

print('frontend clean-snapshot dependency smoke: PASS')
