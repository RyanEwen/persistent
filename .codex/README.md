# Codex hooks

The repository `PreToolUse` hook rejects direct `apply_patch` edits to files
whose header says they are generated. It also rejects edits under
`apps/mobile/android/`, which Capacitor regenerates. Change
`apps/mobile/android-plugin/` or `apps/mobile/scripts/setup-android.mjs`, then
run the normal Android setup command instead.

Codex requires review whenever a non-managed hook definition changes. Open
`/hooks` in a new session, inspect the repository-local definition, and trust
its current hash before relying on it. The project `.codex/` layer must also be
trusted. This guardrail complements the normal tests and generated-project
workflow; it does not replace them.
