#!/bin/bash
set -euo pipefail

# Explicit local-release workflow. No deployment, installation or live synchronization.
APP_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_ROOT"
VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' MavinciReminders/Resources/Info.plist)
OUTPUT="$APP_ROOT/release/$VERSION"
if [ -e "$OUTPUT" ]; then
  echo "Wydanie $VERSION już istnieje. Nie nadpisuję poprzedniego pakietu."
  exit 1
fi
if [ ! -f "release-notes-$VERSION.md" ]; then
  echo "Brak release-notes-$VERSION.md. Dodaj informacje o tej wersji przed pakowaniem."
  exit 1
fi
if [ "$(uname -m)" != "arm64" ]; then
  echo "Ten wariant wydania przeznaczony jest dla Apple Silicon."
  exit 1
fi
STAGING=$(mktemp -d /private/tmp/mavinci-release.XXXXXX)
SCRATCH="${MAVINCI_RELEASE_SCRATCH:-$STAGING/build}"
swift build -c release --scratch-path "$SCRATCH"
BIN_DIR=$(swift build -c release --scratch-path "$SCRATCH" --show-bin-path)
APP="$STAGING/image/Mavinci Reminders.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/MavinciReminders" "$APP/Contents/MacOS/MavinciReminders"
cp MavinciReminders/Resources/Info.plist "$APP/Contents/Info.plist"
cp MavinciReminders/Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cp "release-notes-$VERSION.md" "$STAGING/image/Informacje o wydaniu.md"
ln -s /Applications "$STAGING/image/Applications"
# Preserve the previous unsandboxed, ad-hoc distribution variant. Do not feed
# Xcode entitlements containing unresolved AppIdentifierPrefix to codesign.
codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP"
plutil -lint "$APP/Contents/Info.plist"
DMG="Mavinci-Reminders-$VERSION-apple-silicon.dmg"
hdiutil create -volname "Mavinci Reminders $VERSION" -srcfolder "$STAGING/image" -format UDZO "$STAGING/$DMG"
hdiutil verify "$STAGING/$DMG"
mkdir "$OUTPUT"
mv "$STAGING/$DMG" "$OUTPUT/$DMG"
mv "$APP" "$OUTPUT/Mavinci Reminders.app"
cp "release-notes-$VERSION.md" "$OUTPUT/Informacje o wydaniu.md"
cd "$OUTPUT"
shasum -a 256 "$DMG" > SHA256SUMS.txt
echo "Gotowe wydanie lokalne (ad-hoc, bez notaryzacji): $OUTPUT"
