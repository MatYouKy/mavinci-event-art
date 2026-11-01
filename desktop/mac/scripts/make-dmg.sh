#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d build/Mavinci.app ] || { echo 'Najpierw uruchom scripts/build-app.sh'; exit 1; }
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/mavinci-dmg.XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT
cp -R build/Mavinci.app "$STAGING/"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname Mavinci -srcfolder "$STAGING" -ov -format UDZO build/Mavinci.dmg
