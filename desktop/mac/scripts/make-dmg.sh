#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d build/Mavinci.app ] || { echo 'Najpierw uruchom scripts/build-app.sh'; exit 1; }
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/mavinci-dmg.XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT
cp -R build/Mavinci.app "$STAGING/"
ln -s /Applications "$STAGING/Applications"
# Ikona woluminu instalatora — ta sama co aplikacji (z brandbooka), gdy są narzędzia Xcode.
if [ -f build/Mavinci.app/Contents/Resources/AppIcon.icns ] && command -v SetFile >/dev/null 2>&1; then
  cp build/Mavinci.app/Contents/Resources/AppIcon.icns "$STAGING/.VolumeIcon.icns"
  SetFile -c icnC "$STAGING/.VolumeIcon.icns" && SetFile -a C "$STAGING" || true
fi
hdiutil create -volname Mavinci -srcfolder "$STAGING" -ov -format UDZO build/Mavinci.dmg
