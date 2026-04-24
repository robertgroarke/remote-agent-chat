# relay-server/public/

This directory is the production frontend asset location inside the Docker image.

## How frontend files get here

The deploy script (tools/rebuild_unraid_docker.py) syncs frontend/ -> public/ on the
Unraid server before running docker build, so the built image includes the current
frontend code.

## Local development

You do NOT need files in this directory for local development. The relay falls back to
serving directly from ../frontend/ when this directory is empty (or missing its HTML).

See relay-server/index.js lines near FRONTEND_DIR for the exact fallback logic.

## Override

Set FRONTEND_DIR env var to any absolute path to override both locations.
