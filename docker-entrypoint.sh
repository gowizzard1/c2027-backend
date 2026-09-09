#!/bin/sh
set -eu

# Railway volumes are commonly mounted as root-owned paths. Prepare the public
# candidate-media directory before starting Node, then drop privileges again.
UPLOADS_DIR="${PUBLIC_UPLOADS_DIR:-/app/uploads}"
mkdir -p "$UPLOADS_DIR"
chown -R appuser:appgroup "$UPLOADS_DIR"

exec su-exec appuser "$@"
