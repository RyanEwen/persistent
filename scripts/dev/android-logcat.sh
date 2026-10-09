#!/bin/bash
set -euo pipefail

# Streams logs only for the running direct-debug Persistent process.

package_name="ca.persistent.app"
pid="$(adb shell pidof -s "$package_name" | tr -d '\r')"
if [ -z "$pid" ]; then
    echo "Persistent is not running on the connected Android device." >&2
    exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/adb-keepalive.sh"
trap android_stop_keepalive EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
android_start_keepalive

adb logcat --pid="$pid"
