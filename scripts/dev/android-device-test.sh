#!/bin/bash
set -euo pipefail

# Rebuilds tracked native overlays, discovers one paired wireless ADB device,
# installs the direct debug flavor, and launches it. An optional host or
# host:port narrows discovery.

candidate="${1:-}"
repo_root="$(git rev-parse --show-toplevel)"
apk="$repo_root/apps/mobile/android/app/build/outputs/apk/direct/debug/app-direct-debug.apk"

cd "$repo_root"
if [ -n "$candidate" ]; then
    python3 scripts/dev/adb-discover.py "$candidate"
else
    python3 scripts/dev/adb-discover.py
fi

source scripts/dev/adb-display-timeout.sh
trap android_restore_display_timeout EXIT
android_extend_display_timeout

scripts/dev/android-debug-build.sh

adb install -r "$apk"
adb shell am force-stop ca.persistent.app
adb shell am start -W -n ca.persistent.app/.MainActivity
