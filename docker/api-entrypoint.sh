#!/bin/sh
set -e

cd /app/apps/api
mkdir -p "${AURA_DATA_ROOT:-/data}" "$(dirname "${AURA_STATE_FILE:-/aura-state/storage-state.json}")"
alembic upgrade head
exec "$@"
