#!/usr/bin/env bash
#
# Build and install the desktop app on the Windows machine, from the devcontainer.
#
#   npm run install:desktop                 sync, build, install
#   npm run install:desktop -- --no-sync    use whatever source is already over there
#   npm run install:desktop -- --skip-build reinstall the package already built
#
# The WinUI 3 app cannot be built here at all, so the build has to happen on
# Windows. What this adds over sshing in by hand is the sync: it copies the
# WORKING TREE, not a commit, so a change can be installed and tried before it is
# committed. That order is the point. `npm run validate` and `verify:desktop`
# cannot see XAML, code-behind or packaging, so "does it actually run" is the only
# check that covers them, and it has to come before the commit rather than after.
#
# What is deliberately NOT synced: `external/promo` is a submodule with its own
# clone over there, and bin/obj/artifacts/layout are build output. The signing
# certificate (*.pfx) is generated on that machine on first run and stays there,
# which is what makes every later install an in-place update rather than a second
# copy of the app.
set -euo pipefail

HOST="${PERSISTENT_WINDOWS_HOST:-laptop}"
REMOTE_REPO='D:/persistent'
SYNC=1
PS_ARGS=''

for arg in "$@"; do
  case "$arg" in
    --no-sync) SYNC=0 ;;
    --skip-build) PS_ARGS="$PS_ARGS -SkipBuild" ;;
    *) echo "install-dev-msix: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/../.."

if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "cd ." >/dev/null 2>&1; then
  cat >&2 <<EOF
install-dev-msix: cannot reach '$HOST' over SSH.

The Windows machine is expected as an SSH host alias (see ~/.ssh/config). Set
PERSISTENT_WINDOWS_HOST to use a different one.
EOF
  exit 1
fi

if [ "$SYNC" = "1" ]; then
  echo "Syncing apps/desktop to $HOST:$REMOTE_REPO ..."
  # tar over ssh rather than scp -r: it is one round trip, it preserves the tree
  # shape, and the excludes are the whole reason this is not a plain copy. Windows
  # 11 ships bsdtar as tar.exe, so the far side needs nothing installed.
  tar czf - \
    --exclude='apps/desktop/external/promo' \
    --exclude='*/bin' --exclude='*/obj' \
    --exclude='apps/desktop/artifacts' \
    --exclude='apps/desktop/Persistent.DesktopMSIX/layout' \
    --exclude='*.msix' --exclude='*.pfx' \
    apps/desktop \
  | ssh "$HOST" "tar xzf - -C $REMOTE_REPO"
fi

echo "Building and installing on $HOST ..."
# -ExecutionPolicy Bypass because the file arrived from another machine; without
# it PowerShell refuses to run a script it considers unsigned and remote.
ssh "$HOST" "powershell -NoProfile -ExecutionPolicy Bypass -File $REMOTE_REPO/apps/desktop/install-dev-msix.ps1$PS_ARGS"
