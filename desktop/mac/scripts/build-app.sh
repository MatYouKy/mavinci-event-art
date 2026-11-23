#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Wersja aplikacji: zmienna VERSION albo plik desktop/mac/VERSION (aktualizacje porównują numer kompilacji BUILD).
if [ -z "${VERSION:-}" ] && [ -f VERSION ]; then VERSION="$(tr -d '[:space:]' < VERSION)"; fi
VERSION="${VERSION:-0.22.0}"
CONFIGURATION="${CONFIGURATION:-release}"
case "$CONFIGURATION" in debug|release) ;; *) echo "Nieznany wariant kompilacji"; exit 1;; esac
BUILD="${BUILD:-$(date +%Y%m%d%H%M)}"
# Podpis zespołu Mavinci (Team ID 5DC8P5M489): „Developer ID Application” (do rozdania), a bez niego „Apple Development”
# (testy na tym Macu). Tylko z nim w pakiecie jest rozszerzenie Findera („Mavinci” w pasku bocznym, grupa aplikacji
# 5DC8P5M489.pl.mavinci) i widżety zadań na pulpit („Moje zadania”, „Zadania prywatne” — ta sama sesja z kontenera grupy).
# FINDER=0 — budowanie bez rozszerzeń; WIDGETS=0 — bez widżetów.
TEAM_ID="5DC8P5M489"
TEAM_IDENTITY=""
if [ "${FINDER:-1}" != "0" ] && [ "$CONFIGURATION" = "release" ]; then
  while IFS= read -r name; do
    case "$name" in "Developer ID Application:"*|"Apple Development:"*) ;; *) continue;; esac
    subject="$(security find-certificate -c "$name" -p 2>/dev/null | openssl x509 -noout -subject 2>/dev/null || true)"
    case "$subject" in *"OU=$TEAM_ID"*|*"OU = $TEAM_ID"*) ;; *) continue;; esac
    case "$name" in "Developer ID Application:"*) TEAM_IDENTITY="$name"; break;; esac
    [ -n "$TEAM_IDENTITY" ] || TEAM_IDENTITY="$name"
  done < <(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/^ *[0-9]*) [0-9A-F]* "\(.*\)"$/\1/p')
fi
# Bez podpisu zespołu: stały certyfikat „Mavinci Development” (Pęk kluczy → Asystent certyfikatów, typ „Podpisywanie
# kodu”) — z nim macOS pamięta zgodę na pęk kluczy także po kolejnych budowaniach. Bez niego podpis jest jednorazowy
# (ad hoc) i po każdym budowaniu macOS raz pyta o hasło do pęku kluczy.
LOCAL_IDENTITY="Mavinci Development"
IDENTITIES="$(security find-identity -p codesigning 2>/dev/null || true)"
IDENTITY="${SIGN_IDENTITY:-}"
if [ -z "$IDENTITY" ] && [ -n "$TEAM_IDENTITY" ]; then IDENTITY="$TEAM_IDENTITY"; fi
if [ -z "$IDENTITY" ] && [[ "$IDENTITIES" == *"\"$LOCAL_IDENTITY\""* ]]; then IDENTITY="$LOCAL_IDENTITY"; fi
IDENTITY="${IDENTITY:--}"
WITH_FINDER=0
if [ -n "$TEAM_IDENTITY" ] && [ "$IDENTITY" = "$TEAM_IDENTITY" ]; then WITH_FINDER=1; fi
# Połączenie wbudowane w program (źródło danych, adres serwera, publiczny klucz aplikacji — `EmbeddedConnection.swift`):
# z ignorowanego Resources/Configuration.json (`node desktop/mac/scripts/import-env.cjs`) do ignorowanego
# Sources/Mavinci/EmbeddedConnection.generated.swift. Zainstalowana aplikacja (release) nie ma zakładki „Połączenie” ani pliku
# konfiguracji w pakiecie, więc bez połączenia nie powstaje; kompilacja deweloperska — z zakładką „Połączenie” do testów.
SWIFT_FLAGS=()
EMBED_STATUS=0
node scripts/embed-connection.cjs || EMBED_STATUS=$?
if [ "$EMBED_STATUS" = 0 ]; then
  SWIFT_FLAGS=(-Xswiftc -DMAVINCI_EMBEDDED_CONNECTION)
elif [ "$CONFIGURATION" = "release" ]; then
  if [ "$EMBED_STATUS" = 2 ]; then
    echo "Brak desktop/mac/Resources/Configuration.json — zainstalowana aplikacja ma połączenie wbudowane w program." >&2
    echo "Utwórz go z .env: node desktop/mac/scripts/import-env.cjs (zapisuje tylko publiczny adres i klucz aplikacji)." >&2
  else
    echo "Nie udało się wbudować połączenia w program (kod $EMBED_STATUS) — aplikacja nie została zbudowana." >&2
  fi
  exit 1
elif [ "$EMBED_STATUS" = 2 ]; then
  echo "Uwaga: brak Resources/Configuration.json — kompilacja deweloperska bez wbudowanego połączenia (Ustawienia → Połączenie)."
else
  echo "Uwaga: nie udało się wbudować połączenia (kod $EMBED_STATUS) — kompilacja deweloperska bez niego (Ustawienia → Połączenie)."
fi
swift build -c "$CONFIGURATION" ${SWIFT_FLAGS[@]+"${SWIFT_FLAGS[@]}"}
BIN="$(swift build -c "$CONFIGURATION" ${SWIFT_FLAGS[@]+"${SWIFT_FLAGS[@]}"} --show-bin-path)/Mavinci"
# Rozszerzenie Findera — osobny program (punkt wejścia NSExtensionMain), kompilowany z plikami wspólnymi z aplikacją
# (sesja i adresy serwera — FinderShared, miniatury i skróty plików Materiałów — MaterialMedia).
if [ "$WITH_FINDER" = 1 ]; then
  EXT_BUILD="build/finder-$CONFIGURATION"
  mkdir -p "$EXT_BUILD"
  swiftc -O -module-name MavinciFileProvider -parse-as-library -application-extension \
    -target "$(uname -m)-apple-macos14.0" \
    -Xlinker -e -Xlinker _NSExtensionMain \
    -o "$EXT_BUILD/MavinciFileProvider" \
    Sources/MavinciFileProvider/*.swift Sources/Mavinci/Finder/FinderShared.swift Sources/Mavinci/Finder/MaterialMedia.swift
fi
# Widżety zadań (WidgetKit) — osobny program w piaskownicy jak rozszerzenie Findera: punkt wejścia NSExtensionMain (jak Xcode
# dla rozszerzeń), widżety z `@main WidgetBundle`; sesja i adresy serwera z kontenera grupy (FinderShared).
WITH_WIDGETS=0
if [ "$WITH_FINDER" = 1 ] && [ "${WIDGETS:-1}" != "0" ]; then
  WITH_WIDGETS=1
  WIDGET_BUILD="build/widgets-$CONFIGURATION"
  mkdir -p "$WIDGET_BUILD"
  swiftc -O -module-name MavinciWidgets -parse-as-library -application-extension \
    -target "$(uname -m)-apple-macos14.0" \
    -Xlinker -e -Xlinker _NSExtensionMain \
    -o "$WIDGET_BUILD/MavinciWidgets" \
    Sources/MavinciWidgets/*.swift Sources/Mavinci/Finder/FinderShared.swift
fi
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
# Kod wyjścia skryptu zostaje zachowany (bash 3.2 z macOS oddaje inaczej wynik ostatniego polecenia pułapki) — błąd
# pakowania przerywa `yarn build:mac && yarn open mac`, zamiast po cichu otwierać poprzednią wersję aplikacji.
cleanup() {
  local status=$?
  if [ ! -d "$TARGET_APP" ] && [ -d "$PREVIOUS" ]; then mv "$PREVIOUS" "$TARGET_APP"; fi
  rm -rf "$STAGING_ROOT"
  if [ "$status" -ne 0 ]; then echo "Błąd budowania aplikacji (kod $status) — aplikacja nie została podmieniona." >&2; fi
  exit "$status"
}
trap cleanup EXIT
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Mavinci"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" Resources/Info.plist > "$APP/Contents/Info.plist"
# Bez Resources/Configuration.json w pakiecie — połączenie jest wbudowane w program (EmbeddedConnection.swift).
# Fonty wydruków (Inter) — te same pliki co na serwerze (`public/fonts/invoice`): lokalny silnik PDF wstawia je do HTML
# identycznie jak `loadPrintFontCss`, więc dokument z Maca jest taki sam jak z serwera.
mkdir -p "$APP/Contents/Resources/PrintFonts"
for font in Inter-Regular Inter-Medium Inter-SemiBold Inter-Bold; do
  if [ -f "../../public/fonts/invoice/$font.ttf" ]; then cp "../../public/fonts/invoice/$font.ttf" "$APP/Contents/Resources/PrintFonts/$font.ttf"; fi
done
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
if [ "$WITH_FINDER" = 1 ]; then
  EXT="$APP/Contents/PlugIns/MavinciFileProvider.appex"
  mkdir -p "$EXT/Contents/MacOS"
  cp "$EXT_BUILD/MavinciFileProvider" "$EXT/Contents/MacOS/MavinciFileProvider"
  sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" Resources/FileProvider-Info.plist > "$EXT/Contents/Info.plist"
  # Ikona „Mavinci” w pasku bocznym Findera: sygnet jako własny symbol SF w zasobach rozszerzenia
  # (Resources/FinderSymbol.xcassets, `CFBundleSymbolName` w FileProvider-Info.plist). Bez actool (Xcode) — symbol zastępczy.
  mkdir -p "$EXT/Contents/Resources"
  if ! xcrun actool Resources/FinderSymbol.xcassets --compile "$EXT/Contents/Resources" --platform macosx \
      --minimum-deployment-target 14.0 --output-partial-info-plist "$EXT_BUILD/assets.plist" >"$EXT_BUILD/actool.log" 2>&1; then
    echo "Uwaga: ikona Findera nie została skompilowana (actool) — szczegóły: desktop/mac/$EXT_BUILD/actool.log."
    /usr/libexec/PlistBuddy -c "Set :CFBundleIcons:CFBundlePrimaryIcon:CFBundleSymbolName folder.fill" "$EXT/Contents/Info.plist" || true
  fi
  # Znacznik czasu Apple tylko dla Developer ID (rozdawanie); Apple Development — bez (działa bez sieci).
  TIMESTAMP="--timestamp=none"
  case "$IDENTITY" in "Developer ID Application:"*) TIMESTAMP="--timestamp";; esac
  codesign --force --options runtime "$TIMESTAMP" --entitlements Resources/MavinciFileProvider.entitlements --sign "$IDENTITY" "$EXT"
  if [ "$WITH_WIDGETS" = 1 ]; then
    WIDGETS_EXT="$APP/Contents/PlugIns/MavinciWidgets.appex"
    mkdir -p "$WIDGETS_EXT/Contents/MacOS"
    cp "$WIDGET_BUILD/MavinciWidgets" "$WIDGETS_EXT/Contents/MacOS/MavinciWidgets"
    sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" Resources/Widgets-Info.plist > "$WIDGETS_EXT/Contents/Info.plist"
    codesign --force --options runtime "$TIMESTAMP" --entitlements Resources/MavinciWidgets.entitlements --sign "$IDENTITY" "$WIDGETS_EXT"
  fi
  codesign --force --options runtime "$TIMESTAMP" --entitlements Resources/Mavinci.entitlements --sign "$IDENTITY" "$APP"
  if [ "$WITH_WIDGETS" = 1 ]; then
    echo "Podpis: $IDENTITY — z rozszerzeniem Findera („Mavinci” w pasku bocznym) i widżetami zadań na pulpit."
  else
    echo "Podpis: $IDENTITY — z rozszerzeniem Findera („Mavinci” w pasku bocznym)."
  fi
elif [ "$IDENTITY" = "-" ] || [ "$IDENTITY" = "$LOCAL_IDENTITY" ]; then
  codesign --force --options runtime --timestamp=none --sign "$IDENTITY" "$APP"
  if [ "$IDENTITY" = "-" ]; then
    echo "Podpis ad hoc: po tym budowaniu macOS raz zapyta o dostęp do pęku kluczy (kliknij „Zawsze pozwalaj”)."
    echo "Aby nie pytał po każdym budowaniu, utwórz certyfikat „${LOCAL_IDENTITY}” (desktop/mac/README.md, „Podpis i pęk kluczy”)."
  fi
else
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$APP"
fi
codesign --verify --deep --strict "$APP"
if [ -d "$TARGET_APP" ]; then mv "$TARGET_APP" "$PREVIOUS"; fi
mv "$APP" "$TARGET_APP"
# Finder i Dock odświeżają ikonę zmienionego pakietu.
touch "$TARGET_APP"
echo "Gotowe: $TARGET_APP"
