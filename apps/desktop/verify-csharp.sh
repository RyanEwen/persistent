#!/usr/bin/env bash
#
# Compile-check the desktop app's non-XAML C# in the Linux devcontainer.
#
# WinUI 3 cannot be fully built here — the Windows App SDK's XamlCompiler.exe and
# MakePri.exe are Windows-only — so `.github/workflows/build-desktop-msix.yml` on
# windows-2025 remains the only complete check. What this DOES catch, without a CI
# round-trip, is a misremembered WinRT API or a broken reference in the code that
# has no XAML behind it (see tools/csharp-check/CSharpCheck.csproj for the list).
#
# The build always exits non-zero here: MakePri fails at the very end, long after
# the compiler has run. So the exit code is useless and this checks two things
# instead, which together can't produce a false pass:
#
#   1. the compiler emitted no `error CS...`, and
#   2. it actually produced its assembly — so a compile that never ran, or was
#      skipped as up to date, fails loudly rather than reading as success.
#
set -uo pipefail

cd "$(dirname "$0")"

PROJECT="tools/csharp-check/CSharpCheck.csproj"
OUT_DIR="tools/csharp-check"

if ! command -v dotnet >/dev/null 2>&1; then
  # The devcontainer image installs it; a bare checkout may not have it.
  echo "verify-csharp: no 'dotnet' on PATH - install the .NET 10 SDK, or rebuild the devcontainer." >&2
  exit 1
fi

# Searched, not hardcoded: Directory.Build.props auto-detects the platform, so the
# assembly lands under a bin/<platform>/... path that differs by machine.
find_output() { find "$OUT_DIR/bin" "$OUT_DIR/obj" -name CSharpCheck.dll 2>/dev/null | head -1; }

# Removed rather than trusted: step 2 below treats this file's existence as proof
# the compiler ran, which only holds if a stale one from a previous run is gone.
find "$OUT_DIR/bin" "$OUT_DIR/obj" -name CSharpCheck.dll -delete 2>/dev/null || true

# Well-formedness of every XML file the Windows build reads, before the compile.
# This check exists because a comment in Persistent.Desktop.csproj once contained a
# double hyphen, which XML forbids: MSBuild rejected the entire project file before
# reading a single property, and nothing here noticed, because the compile below
# drives tools/csharp-check/CSharpCheck.csproj and never opens the app's own csproj.
# A CI round-trip on windows-2025 was the first thing to catch it. One second here
# is cheaper.
echo "verify-csharp: checking XML well-formedness..."
# "." and not "$(dirname "$0")": the script already cd'd there at the top, so
# re-deriving it here nests the path (apps/desktop/apps/desktop), matches nothing,
# and passes. Which it did, on the very commit this check was written to catch.
if ! python3 - . <<'PY'
import sys, pathlib, xml.etree.ElementTree as ET

root = pathlib.Path(sys.argv[1])
patterns = ('*.csproj', '*.props', '*.appxmanifest', '*.projitems', '*.xaml', '*.slnx')
files = [p for pat in patterns for p in root.rglob(pat)
         if 'bin/' not in str(p) and 'obj/' not in str(p)]

# A check that finds nothing has not passed, it has failed to run. Without this the
# only symptom of a broken path is silence.
if not files:
    print("  no XML files found - the search path is wrong", file=sys.stderr)
    sys.exit(1)

bad = 0
for path in sorted(files):
    try:
        ET.parse(path)
    except ET.ParseError as err:
        print(f"  {path}: {err}", file=sys.stderr)
        bad += 1

if bad:
    sys.exit(1)

print(f"verify-csharp: {len(files)} XML files well-formed.")
PY
then
  echo "verify-csharp: FAILED - the XML above is malformed; the Windows build cannot load it." >&2
  exit 1
fi

echo "verify-csharp: compiling the desktop app's non-XAML sources..."
LOG="$(dotnet build "$PROJECT" -p:EnableWindowsTargeting=true -v:minimal 2>&1)"

# Deduplicated: MSBuild prints each diagnostic once per target that saw it.
if echo "$LOG" | grep -qE "error CS"; then
  echo "$LOG" | grep -E "error CS" | sed 's|.*/Persistent.Desktop/|  |' | sort -u
  echo "verify-csharp: FAILED - the C# above does not compile." >&2
  exit 1
fi

if [ -z "$(find_output)" ]; then
  echo "$LOG" | tail -30 >&2
  echo "verify-csharp: FAILED - the compiler produced no assembly, so nothing was checked." >&2
  exit 1
fi

echo "verify-csharp: OK - no C# errors."
echo "verify-csharp: NOTE - XAML, the code-behind files and packaging are NOT checked here."
echo "                     Only CI (windows-2025) builds the real app."
