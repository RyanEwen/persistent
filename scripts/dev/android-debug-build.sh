#!/bin/bash
set -euo pipefail

# Regenerates the project when absent, otherwise reapplies the tracked native
# overlay before assembling the direct debug flavor.

repo_root="$(git rev-parse --show-toplevel)"
android_root="$repo_root/apps/mobile/android"
apk="$android_root/app/build/outputs/apk/direct/debug/app-direct-debug.apk"

cd "$repo_root"
if [ ! -f "$android_root/gradlew" ]; then
    npm --prefix apps/mobile run prepare:android
else
    npm --prefix apps/mobile run setup:android
    npm --prefix apps/mobile run sync
fi
npm --prefix apps/mobile run assemble:android

echo "Android direct-debug APK: $apk"
