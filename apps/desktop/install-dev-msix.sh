#!/usr/bin/env bash
# Compatibility entry point; use the shared npm install:desktop workflow.
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
exec "$repo_root/scripts/windows-build" --install "$@"
