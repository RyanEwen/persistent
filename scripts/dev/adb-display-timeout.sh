#!/bin/bash

# Temporarily maximizes Android's screen-off timeout for an active ADB helper.
# Callers own the lifecycle and must restore the captured value from an EXIT trap.

android_saved_screen_timeout_ms=""

android_extend_display_timeout() {
    local current_timeout
    current_timeout="$(adb shell settings get system screen_off_timeout | tr -d '\r')"

    if [[ ! "$current_timeout" =~ ^[0-9]+$ ]]; then
        echo "Unable to read the current Android display timeout." >&2
        return 1
    fi

    android_saved_screen_timeout_ms="$current_timeout"
    adb shell settings put system screen_off_timeout 2147483647
    echo "Extended Android display timeout for this device session."
}

android_restore_display_timeout() {
    if [ -z "$android_saved_screen_timeout_ms" ]; then
        return 0
    fi

    if adb shell settings put system screen_off_timeout "$android_saved_screen_timeout_ms"; then
        echo "Restored Android display timeout to ${android_saved_screen_timeout_ms} ms."
    else
        echo "Warning: unable to restore Android display timeout to ${android_saved_screen_timeout_ms} ms." >&2
    fi

    android_saved_screen_timeout_ms=""
}
