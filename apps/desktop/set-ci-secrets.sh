#!/usr/bin/env bash
#
# Set the desktop app's GitHub Actions secrets, from the devcontainer.
#
# Two workflows need credentials that cannot live in the repo:
#
#   SUBMODULES_TOKEN                 Read access to the private
#                                    RyanEwen/technicallyreal-promo submodule.
#                                    build-desktop-msix.yml and store-publish.yml
#                                    both check it out, and the csproj imports it
#                                    unconditionally, so without this the desktop
#                                    build does not compile at all.
#
#   AZURE_AD_TENANT_ID               Entra tenant ID
#   AZURE_AD_APPLICATION_CLIENT_ID   App registration (client) ID
#   AZURE_AD_APPLICATION_SECRET      Client secret for that app registration
#   SELLER_ID                        Partner Center seller / publisher ID
#
# The last four are what the Microsoft Store Developer CLI authenticates with in
# store-publish.yml. The names match the sibling Little Launcher repo on purpose:
# the same Entra app registration and seller account back every TechnicallyReal
# app, so rotating the client secret is the same value in every repo rather than
# four different names for one credential.
#
# Values are read with the terminal echo off, piped to `gh secret set` over stdin,
# and unset immediately. They never appear in argv (so not in `ps`), never reach
# the shell history, and are never written to disk. That is also why they cannot be
# copied from another repo: GitHub returns secret names only, never values.
#
# Run it again whenever the client secret is rotated - Entra secrets expire (24
# months max), and an expired one fails the publish step with an auth error.
#
# Setting AZURE_AD_APPLICATION_SECRET also prompts for its expiry date and records
# it as the STORE_SECRET_EXPIRES repository VARIABLE, which store-secret-expiry.yml
# checks weekly and warns on 60 days out. Nothing can be asked for that date later
# (reading an app registration's own credentials needs Graph permissions this one
# does not have), so capturing it at rotation time is the only way the reminder
# stays true.
#
# Prerequisites:
#   - gh authenticated with `repo` scope (`gh auth status`)
#   - the Entra app registration must hold the **Manager** role in Partner Center
#     (Account settings > User management > Microsoft Entra applications), or
#     authentication succeeds and submission is refused.
#
# Usage:
#   ./set-ci-secrets.sh
#   ./set-ci-secrets.sh --only SUBMODULES_TOKEN
#   ./set-ci-secrets.sh --only AZURE_AD_APPLICATION_SECRET   # rotate just the secret
#   ./set-ci-secrets.sh --repo RyanEwen/persistent           # repeatable
#   ./set-ci-secrets.sh --all --only SUBMODULES_TOKEN        # rotate across the fleet
#
# --all targets every repo that consumes the promo submodule. SUBMODULES_TOKEN is
# one PAT shared by all of them, so regenerating it means updating all four or the
# ones you missed start failing at checkout. Each value is prompted for once and
# then written to every target, so a rotated token is pasted once rather than four
# times - which is the point, since pasting it four times is how one gets a typo.
#
set -euo pipefail

# Every repo whose CI checks out RyanEwen/technicallyreal-promo. Confirmed by
# looking for the secret itself rather than by code search, which under-indexes
# .gitmodules and silently missed one.
SUBMODULE_REPOS=(
  RyanEwen/persistent
  RyanEwen/LittleLauncher
  RyanEwen/Repilot
  RyanEwen/ImmichDrive
)

REPOS=()
ONLY=()

# Parallel arrays rather than an associative array: the prompt order is part of the
# UX (the token that blocks the build comes first), and bash does not preserve
# insertion order for associative keys.
NAMES=(
  SUBMODULES_TOKEN
  AZURE_AD_TENANT_ID
  AZURE_AD_APPLICATION_CLIENT_ID
  AZURE_AD_APPLICATION_SECRET
  SELLER_ID
)
HINTS=(
  "PAT, read-only Contents on technicallyreal-promo"
  "Entra tenant ID          (entra.microsoft.com > Identity > Overview)"
  "Application (client) ID  (Entra > App registrations > your app)"
  "Client secret VALUE      (Entra > your app > Certificates & secrets)"
  "Seller / Publisher ID    (Partner Center > Account settings > Identifiers)"
)

usage() { sed -n '2,52p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPOS+=("${2:?--repo needs a value}"); shift 2 ;;
    --all) REPOS+=("${SUBMODULE_REPOS[@]}"); shift ;;
    --only) ONLY+=("${2:?--only needs a secret name}"); shift 2 ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown argument: $1" >&2; usage 1 >&2 ;;
  esac
done

# Default to this repo alone. Fanning out is opt-in: the Store credentials only
# mean anything here, and quietly writing them to three unrelated repos would be a
# surprising thing for a bare invocation to do.
[[ ${#REPOS[@]} -eq 0 ]] && REPOS=(RyanEwen/persistent)

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) not found." >&2
  exit 1
fi

# Fail early with a clear message rather than midway through prompting.
if ! gh auth status >/dev/null 2>&1; then
  echo "gh is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

# Validate --only against the known names, so a typo does not silently set nothing.
for want in ${ONLY+"${ONLY[@]}"}; do
  found=0
  for name in "${NAMES[@]}"; do [[ "$name" == "$want" ]] && found=1 && break; done
  if [[ $found -eq 0 ]]; then
    echo "Unknown secret: $want" >&2
    echo "Known: ${NAMES[*]}" >&2
    exit 1
  fi
done

wanted() {
  [[ ${#ONLY[@]} -eq 0 ]] && return 0
  for want in "${ONLY[@]}"; do [[ "$want" == "$1" ]] && return 0; done
  return 1
}

# Dedupe, so `--all --repo RyanEwen/persistent` does not write it twice.
TARGETS=()
for repo in "${REPOS[@]}"; do
  seen=0
  for t in ${TARGETS+"${TARGETS[@]}"}; do [[ "$t" == "$repo" ]] && seen=1 && break; done
  [[ $seen -eq 0 ]] && TARGETS+=("$repo")
done

echo
echo "Setting desktop CI secrets on:"
for repo in "${TARGETS[@]}"; do echo "  - $repo"; done
echo
echo "Input is hidden. Press Enter on a blank prompt to skip a secret."

# Only when fanning out. One repo is the ordinary case and does not need a gate;
# writing credentials across the fleet on a mistyped flag does.
if [[ ${#TARGETS[@]} -gt 1 ]]; then
  read -rp "Write to these ${#TARGETS[@]} repos? [y/N] " confirm </dev/tty
  [[ "$confirm" == [yY] ]] || { echo "Aborted."; exit 1; }
fi
echo

count=0
skipped=()

for i in "${!NAMES[@]}"; do
  name="${NAMES[$i]}"
  wanted "$name" || continue

  echo "$name"
  echo "  ${HINTS[$i]}"

  # -s keeps the value off the screen; -r stops backslashes being escapes, which a
  # generated client secret can legitimately contain.
  read -rsp "  value: " value </dev/tty
  echo

  if [[ -z "$value" ]]; then
    echo "  ~ skipped"
    echo
    skipped+=("$name")
    continue
  fi

  # NOT `--body -`: gh reads stdin only when --body is absent, and passing "-"
  # sets the secret to a literal hyphen while silently ignoring the pipe. Verified
  # against gh's own encryption output - the sealed box came back one byte longer
  # than an empty value, which is the "-" itself.
  for repo in "${TARGETS[@]}"; do
    if printf '%s' "$value" | gh secret set "$name" --repo "$repo"; then
      echo "  + set on $repo"
      count=$((count + 1))
    else
      unset value
      echo "  ! failed to set $name on $repo" >&2
      exit 1
    fi
  done
  unset value

  # The expiry date rides along with the secret it describes. Entra credentials
  # last 24 months at most and nothing can be asked for the date later - reading
  # an app registration's own passwordCredentials needs Graph permissions this
  # credential does not have. Recording it here is what stops
  # store-secret-expiry.yml drifting from reality: you cannot rotate the secret
  # without being asked when the new one dies.
  #
  # A repository variable, not a secret. An expiry date is not sensitive, and the
  # workflow needs to print it to be useful.
  if [[ "$name" == "AZURE_AD_APPLICATION_SECRET" ]]; then
    default_expiry=$(date -u -d '+24 months' +%F)
    echo "  When does it expire? Entra's maximum is 24 months from creation."
    read -rp "  expires (YYYY-MM-DD) [$default_expiry]: " expiry </dev/tty
    expiry="${expiry:-$default_expiry}"

    if [[ ! "$expiry" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
      echo "  ! expected YYYY-MM-DD, got '$expiry'" >&2
      exit 1
    fi

    for repo in "${TARGETS[@]}"; do
      gh variable set STORE_SECRET_EXPIRES --repo "$repo" --body "$expiry"
      echo "  + STORE_SECRET_EXPIRES=$expiry on $repo"
    done
  fi

  echo
done

echo "Done - $count write(s) across ${#TARGETS[@]} repo(s)."
[[ ${#skipped[@]} -gt 0 ]] && echo "Skipped: ${skipped[*]}"

for repo in "${TARGETS[@]}"; do
  echo
  echo "$repo:"
  gh secret list --repo "$repo"
done

# Only worth suggesting where the Store workflow actually lives.
for repo in "${TARGETS[@]}"; do
  if [[ "$repo" == "RyanEwen/persistent" ]]; then
    cat <<EOF

Next: a draft submission, which uploads but sends nothing for review.
  gh workflow run store-publish.yml --repo $repo -f mode=draft
  gh run watch "\$(gh run list --workflow=store-publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
EOF
  fi
done
