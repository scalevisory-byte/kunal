#!/usr/bin/env bash
#
# Build the Windows bundle: one folder that runs on TSRV with NOTHING
# downloaded there - no GitHub, no npm, no internet.
#
# Dinesh asked for it this way ("github pe kuch nahi chahiye, Arrohan aur TAJ
# wala jaisa"), which also means the server never reaches out for anything.
#
#   ./deploy/make-bundle.sh            -> dist/BNFHRMS.zip
#
# Three things in here are easy to forget and silently fatal, which is why
# this is a script and not a list of steps in a document:
#
#   1. better-sqlite3 is NATIVE. `npm install` on this Linux machine builds a
#      Linux .node, which on Windows fails to load. The Windows prebuilt
#      binary has to be swapped in by hand.
#   2. The ABI has to match the Node that will RUN it. Node 22 is ABI 127.
#      Ship Node 24 and the same binary will not load.
#   3. node.exe is bundled so the server's own Node is never touched. TSRV
#      runs ZynTask on its Node, and the first install attempt failed exactly
#      because npm found the server's Node 24 on PATH.
#
set -euo pipefail

NODE_VER="v22.13.1"      # ABI 127, which is what the prebuilt binary below is for
NODE_ABI="127"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # ...../salary-app
OUT="$HERE/dist"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n== %s\n' "$1"; }

say "Building the dashboard"
npm --prefix "$HERE/frontend" run build >/dev/null
test -f "$HERE/backend/public/index.html" || { echo "the build produced no public/index.html"; exit 1; }

say "Staging the app"
B="$WORK/BNFHRMS"
mkdir -p "$B/app" "$B/node"
cp -r "$HERE/backend" "$B/app/backend"
cp -r "$HERE/shared"  "$B/app/shared"
rm -rf "$B/app/backend/node_modules" "$B/app/backend/test" "$B/app/backend/.env" "$B/app/backend/Dockerfile"

say "Installing the packages it will actually run with"
(cd "$B/app/backend" && npm install --omit=dev --no-audit --no-fund >/dev/null)

say "Swapping better-sqlite3 for the Windows binary"
SQLITE_VER="$(node -p "require('$B/app/backend/node_modules/better-sqlite3/package.json').version")"
URL="https://github.com/WiseLibs/better-sqlite3/releases/download/v${SQLITE_VER}/better-sqlite3-v${SQLITE_VER}-node-v${NODE_ABI}-win32-x64.tar.gz"
curl -fsSL -o "$WORK/sqlite-win.tar.gz" "$URL"
tar xzf "$WORK/sqlite-win.tar.gz" -C "$WORK"
cp "$WORK/build/Release/better_sqlite3.node" \
   "$B/app/backend/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
# Only needed to COMPILE; a few MB of C++ nobody on that server will build.
rm -rf "$B/app/backend/node_modules/better-sqlite3/deps" \
       "$B/app/backend/node_modules/better-sqlite3/src"
file "$B/app/backend/node_modules/better-sqlite3/build/Release/better_sqlite3.node" | grep -q "MS Windows" \
  || { echo "that is not a Windows binary"; exit 1; }

say "Fetching node.exe ${NODE_VER}"
curl -fsSL -o "$WORK/node.zip" "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-win-x64.zip"
(cd "$WORK" && unzip -q node.zip)
cp "$WORK/node-${NODE_VER}-win-x64/node.exe" "$B/node/node.exe"
file "$B/node/node.exe" | grep -q "MS Windows" || { echo "that is not a Windows node.exe"; exit 1; }

say "Scripts and the guide"
cp "$HERE/deploy/windows-local/"*.ps1 "$HERE/deploy/windows-local/PADHO.txt" "$B/"

say "Zipping"
mkdir -p "$OUT"
rm -f "$OUT/BNFHRMS.zip"
(cd "$WORK" && zip -q -r "$OUT/BNFHRMS.zip" BNFHRMS)

printf '\n%s\n' "Done:  $OUT/BNFHRMS.zip  ($(du -h "$OUT/BNFHRMS.zip" | cut -f1))"
printf '%s\n' "Copy it to the server, extract into E:\\BNFHR, run INSTALL.ps1."
