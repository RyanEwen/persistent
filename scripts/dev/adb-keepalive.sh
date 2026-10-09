#!/bin/bash

# Keep an already-unlocked device active using a press/release modifier key.
# Unlike WAKEUP or UNKNOWN, Shift counts as Android user activity. It types no
# text, taps no controls, and leaves no modifier held. No settings are written.

android_keepalive_pid=""

# Pin one device and choose a cadence shorter than its existing display timeout.
# Callers must install android_stop_keepalive as their EXIT trap before starting.
android_start_keepalive() {
    local serial screen_timeout interval parent_pid
    serial="$(adb get-serialno | tr -d '\r')"
    if [ -z "$serial" ] || [ "$serial" = "unknown" ]; then
        echo "Select one connected Android device before starting keepalives." >&2
        return 1
    fi
    screen_timeout="$(adb -s "$serial" shell settings get system screen_off_timeout | tr -d '\r')"
    if [[ ! "$screen_timeout" =~ ^[0-9]+$ ]]; then
        echo "Unable to read the Android display timeout for keepalive scheduling." >&2
        return 1
    fi
    interval=$((screen_timeout / 3000))
    if [ "$interval" -lt 1 ]; then interval=1; fi
    if [ "$interval" -gt 20 ]; then interval=20; fi
    parent_pid="$BASHPID"

    (
        keepalive_sleep_pid=""
        trap 'if [ -n "$keepalive_sleep_pid" ]; then kill "$keepalive_sleep_pid" 2>/dev/null || true; fi; exit 0' TERM INT
        while kill -0 "$parent_pid" 2>/dev/null; do
            if ! timeout 10s adb -s "$serial" shell input keyevent KEYCODE_SHIFT_LEFT; then
                echo "Android keepalives stopped: device disconnected or input failed." >&2
                break
            fi
            sleep "$interval" &
            keepalive_sleep_pid=$!
            wait "$keepalive_sleep_pid" || break
            keepalive_sleep_pid=""
        done
    ) &
    android_keepalive_pid=$!
    echo "Android input keepalives started (every ${interval}s; display timeout unchanged)."
}

# Stop and reap the owned loop so no keepalive remains after testing ends.
android_stop_keepalive() {
    if [ -n "$android_keepalive_pid" ]; then
        kill "$android_keepalive_pid" 2>/dev/null || true
        wait "$android_keepalive_pid" 2>/dev/null || true
        android_keepalive_pid=""
    fi
}
