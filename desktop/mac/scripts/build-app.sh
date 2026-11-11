#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${VERSION:-0.5.0}"
CONFIGURATION="${CONFIGURATION:-release}"
case "$CONFIGURATION" in debug|release) ;; *) echo "Nieznany wariant kompilacji"; exit 1;; esac
BUILD="${BUILD:-$(date +%Y%m%d%H%M)}"
IDENTITY="${SIGN_IDENTITY:--}"
swift build -c "$CONFIGURATION"
BIN="$(swift build -c "$CONFIGURATION" --show-bin-path)/Mavinci"
mkdir -p build
if [ "$CONFIGURATION" = "debug" ]; then
  TARGET_APP="$(pwd)/build/Mavinci-Dev.app"
else
  TARGET_APP="$(pwd)/build/Mavinci.app"
fi
# Never truncate the executable of a running application. Sign a complete new bundle,
# then replace its directory; the running process keeps its original mapped binary.
STAGING_ROOT="$(mktemp -d "$(pwd)/build/.mavinci-package.XXXXXX")"
APP="$STAGING_ROOT/$(basename "$TARGET_APP")"
PREVIOUS="$STAGING_ROOT/previous.app"
cleanup() {
  if [ ! -d "$TARGET_APP" ] && [ -d "$PREVIOUS" ]; then mv "$PREVIOUS" "$TARGET_APP"; fi
  rm -rf "$STAGING_ROOT"
}
trap cleanup EXIT
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Mavinci"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" Resources/Info.plist > "$APP/Contents/Info.plist"
if [ -f Resources/Configuration.json ]; then cp Resources/Configuration.json "$APP/Contents/Resources/Configuration.json"; fi
# Ikona z brandbooka (jedyne źródło prawdy): marka zapisana przez aplikację po zalogowaniu, a do pierwszego logowania —
# Resources/Brand/brand.json. Bez sieci i bez sygnetu zostaje ikona z poprzedniego budowania (build/icon/AppIcon.icns).
BRAND_JSON="$HOME/Library/Application Support/Mavinci/Desktop/v1/brand/brand.json"
[ -f "$BRAND_JSON" ] || BRAND_JSON="$(pwd)/Resources/Brand/brand.json"
mkdir -p build/icon
if swiftc -O -o build/icon/make-icon scripts/make-icon/main.swift Sources/Mavinci/Brand/BrandIcon.swift \
  && build/icon/make-icon "$BRAND_JSON" build/icon/AppIcon.iconset \
  && iconutil -c icns build/icon/AppIcon.iconset -o build/icon/AppIcon.icns; then :; else
  echo "Uwaga: nie udało się odświeżyć ikony z brandbooka — używam poprzedniej, jeśli jest."
fi
if [ -f build/icon/AppIcon.icns ]; then cp build/icon/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"; fi
if [ "$IDENTITY" = "-" ]; then
  codesign --force --options runtime --timestamp=none --sign "$IDENTITY" "$APP"
else
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$APP"
fi
codesign --verify --deep --strict "$APP"
if [ -d "$TARGET_APP" ]; then mv "$TARGET_APP" "$PREVIOUS"; fi
mv "$APP" "$TARGET_APP"
# Finder i Dock odświeżają ikonę zmienionego pakietu.
touch "$TARGET_APP"
echo "Gotowe: $TARGET_APP"
