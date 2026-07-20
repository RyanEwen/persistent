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
# The wireless-debug PORT rotates every toggle, so a pinned ADB_CONNECT goes
# stale. When no explicit target connects (or none is configured but a last-good
# endpoint was saved), we hand off to adb-discover.py, which re-finds the phone by
# scanning and persists the result to ~/.android/adb-endpoint. mDNS can't help
# here -- multicast doesn't cross the container's Docker/WSL bridge; see that
# script's header.
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

# Discovery re-finds the phone when the port rotated or the IP moved. It reads
# the same ADB_CONNECT plus the persisted last-good endpoint, so it is useful even
# when `targets` is empty. Prefer it; fall back to a plain connect if it is
# missing. Runs in the background so a scan never delays container startup.
DISCOVER="$(dirname "$0")/adb-discover.py"

if [ -z "$targets" ] && [ ! -f "${HOME}/.android/adb-endpoint" ]; then
    # Nothing configured and nothing learned yet: genuine no-op.
    exit 0
fi

# Fast path: try any explicit host:port targets directly first (instant when the
# port hasn't rotated). Then let discovery reconcile/rediscover in the background.
for target in ${targets//,/ }; do
    echo "adb-connect: connecting to ${target}"
    "$ADB" connect "$target" || true
done

if [ -x "$DISCOVER" ] && command -v python3 >/dev/null 2>&1; then
    echo "adb-connect: running discovery in background (adb-discover.py)"
    nohup python3 "$DISCOVER" >/tmp/adb-discover.log 2>&1 &
fi
