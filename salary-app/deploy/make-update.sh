#!/usr/bin/env bash
#
# Build an UPDATE for an HRMS that is already installed on the BNF server.
# Not the whole thing - no node.exe, no node_modules, no database. Just the
# parts that changed, which UPDATE.ps1 swaps in and can roll back.
#
#   ./deploy/make-update.sh                 -> dist/BNFHRMS-update.zip  (screens only)
#   ./deploy/make-update.sh --server        -> screens + backend/src + shared
#
# Why this exists rather than a line in a document: the dashboard is built
# into frontend/dist and then COPIED into backend/public, and forgetting the
# copy is silent - backend/public already exists from a previous build, so
# every check passes and a bundle ships last week's screens. That happened,
# and the only symptom was Dinesh saying "i think this is old version". The
# freshness check below is the thing that cannot be forgotten.
#
set -euo pipefail

WITH_SERVER=false
[ "${1:-}" = "--server" ] && WITH_SERVER=true

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # ...../salary-app
OUT="$HERE/dist"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n== %s\n' "$1"; }

say "Building the dashboard"
npm --prefix "$HERE/frontend" run build >/dev/null
test -f "$HERE/frontend/dist/index.html" || { echo "the build produced no dist/index.html"; exit 1; }

rm -rf "$HERE/backend/public"
mkdir -p "$HERE/backend/public"
cp -r "$HERE/frontend/dist/." "$HERE/backend/public/"
test -f "$HERE/backend/public/index.html" || { echo "nothing was copied into backend/public"; exit 1; }

# Prove the copy is newer than every source file it was built from.
newest_src="$(find "$HERE/frontend/src" "$HERE/shared" -type f -newer "$HERE/backend/public/index.html" -print -quit)"
if [ -n "$newest_src" ]; then
  echo "backend/public is older than $newest_src - the build did not take"; exit 1
fi

say "Staging the update"
U="$WORK/BNFHRMS-update"
mkdir -p "$U"
cp -r "$HERE/backend/public" "$U/public-new"
cp "$HERE/deploy/windows-local/UPDATE.ps1" "$U/"

if [ "$WITH_SERVER" = true ]; then
  cp -r "$HERE/backend/src" "$U/src-new"
  cp -r "$HERE/shared"      "$U/shared-new"
  # Never ship the installed app's settings or its database over the top.
  rm -f "$U/src-new/.env"
  say "Including backend/src and shared"
else
  say "Screens only - no server file changes in this update"
fi

say "Zipping"
mkdir -p "$OUT"
rm -f "$OUT/BNFHRMS-update.zip"
(cd "$WORK" && zip -q -r "$OUT/BNFHRMS-update.zip" BNFHRMS-update)

printf '\n%s\n' "Done:  $OUT/BNFHRMS-update.zip  ($(du -h "$OUT/BNFHRMS-update.zip" | cut -f1))"
printf '%s\n' "Built: $(date -u -r "$HERE/backend/public/index.html" '+%d %b %Y %H:%M UTC')"
printf '%s\n' "On the server: extract it anywhere and run UPDATE.ps1 - it finds the install"
printf '%s\n' "from the BNFHRMS scheduled task, keeps a rollback copy, and restarts."
