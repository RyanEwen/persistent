#!/bin/bash
set -uo pipefail

# Re-establish wireless adb (TCP/IP) connections on container start.
#
# Why this exists: adb's runtime connection table lives only in the adb server's
# memory, so every container (re)start drops all `adb connect` targets. The
# device's *authorization* survives rebuilds because ~/.android (which holds the
# adb RSA key) is now a persisted named volume — see compose.persist.yml — but
# the live connection still has to be remade. This script remakes it.
#
# Targets come from ADB_CONNECT (a space/comma-separated list of host:port, e.g.
# "192.168.1.50:5555 192.168.1.51:5555"), read from the environment or, failing
# that, from the workspace .env. Unset => no-op, so users who don't use wireless
# debugging (or who attach over USB) are unaffected. Always exits 0: a device
# that's off or off-network must never block container startup.
#
# Invoked from devcontainer.json `postStartCommand` (runs on create and on every
# subsequent start/reopen).

# Resolve adb without relying on a login shell having sourced the PATH drop-in.
ADB="$(command -v adb || true)"
[ -n "$ADB" ] || ADB="${ANDROID_SDK_ROOT:-/opt/android-sdk}/platform-tools/adb"
if [ ! -x "$ADB" ]; then
    echo "adb-connect: adb not found; skipping" >&2
    exit 0
fi

# Prefer an explicit env value; otherwise pull ADB_CONNECT from .env (the repo's
# config surface). The sed strips the key, optional quotes, and inline comments.
targets="${ADB_CONNECT:-}"
if [ -z "$targets" ] && [ -f .env ]; then
    targets="$(sed -n 's/^[[:space:]]*ADB_CONNECT[[:space:]]*=[[:space:]]*//p' .env \
        | tail -n1 | sed -e 's/[[:space:]]*#.*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
fi

if [ -z "$targets" ]; then
    exit 0
fi

# Split on commas and whitespace; connect to each target independently.
for target in ${targets//,/ }; do
    echo "adb-connect: connecting to ${target}"
    "$ADB" connect "$target" || true
done
