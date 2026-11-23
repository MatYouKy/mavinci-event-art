#!/bin/bash
# Wydanie aplikacji Mavinci na Maca — `yarn release` z głównego katalogu projektu:
#  0. numer wersji o jeden wyżej niż ostatnie wydanie (plik VERSION): `yarn release` — drobna zmiana, 0.23.0 → 0.23.1;
#     `yarn release minor` (albo `kluczowa`) — kluczowa zmiana, 0.23.4 → 0.24.0; `yarn release major` — 0.24.0 → 1.0.0;
#     `yarn release none` — bez zmiany numeru. Po publikacji plik VERSION dostaje nowy numer (do commita),
#  1. kompilacja release z podpisem zespołu Mavinci (scripts/build-app.sh), numer kompilacji = data i godzina (RRRRMMDDGGMM),
#  2. notaryzacja Apple, gdy jest certyfikat „Developer ID Application” i profil notarytool w pęku kluczy (README → „Instalator
#     i aktualizacje”), inaczej bez notaryzacji (instalator działa, macOS przy pierwszym otwarciu pyta o zgodę),
#  3. instalator DMG i paczka aktualizacji ZIP w desktop/mac/build/release/ oraz opis wydania latest.json (wersja, sumy SHA-256,
#     co nowego),
#  4. publikacja na serwerze CRM (ssh, jak `yarn deploy`): pliki do katalogu wydań, na końcu latest.json — od tej chwili
#     aplikacje na Macach pokazują „Nowa wersja …” w stopce paska bocznego (kliknięcie: Ustawienia → Oprogramowanie — co nowego
#     i kroki instalacji), a CRM (Dysk → Programy, Ustawienia → Ogólne) wydaje nowy instalator.
# Połączenie z serwerem jest wbudowane w program z Resources/Configuration.json (scripts/build-app.sh — bez niego wydanie nie powstaje).
# Zmienne: VERSION (wersja podana wprost, bez podnoszenia numeru), BUMP (jak argument: patch, minor, major, none), NOTES (co nowego —
# Ustawienia → Oprogramowanie), PUBLISH=0 (tylko pliki lokalnie, bez serwera i bez zmiany pliku VERSION), NOTARY_PROFILE (profil
# notarytool, domyślnie „mavinci-notary”), MAVINCI_DEPLOY_REMOTE, DESKTOP_RELEASES_DIR.
set -euo pipefail
cd "$(dirname "$0")/.."

# Numer wersji: plik VERSION to ostatnie opublikowane wydanie; nowe wydanie podnosi go według rodzaju zmiany.
BUMP="${1:-${BUMP:-patch}}"
case "$BUMP" in
  patch|drobna) BUMP=patch ;;
  minor|kluczowa) BUMP=minor ;;
  major) BUMP=major ;;
  none|bez) BUMP=none ;;
  *) echo "❌ Nieznany rodzaj wydania: $BUMP (patch — domyślnie, minor albo kluczowa, major, none)."; exit 1 ;;
esac
PREVIOUS=""
if [ -f VERSION ]; then PREVIOUS="$(tr -d '[:space:]' < VERSION)"; fi
PREVIOUS="${PREVIOUS:-0.22.0}"
VERSION="${VERSION:-}"
if [ -z "$VERSION" ]; then
  [[ "$PREVIOUS" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || { echo "❌ Nieprawidłowa wersja w pliku VERSION: $PREVIOUS (oczekiwano np. 0.23.0)."; exit 1; }
  IFS=. read -r V_MAJOR V_MINOR V_PATCH <<<"$PREVIOUS"
  V_MAJOR=$((10#$V_MAJOR)); V_MINOR=$((10#$V_MINOR)); V_PATCH=$((10#${V_PATCH:-0}))
  case "$BUMP" in
    patch) V_PATCH=$((V_PATCH + 1)) ;;
    minor) V_MINOR=$((V_MINOR + 1)); V_PATCH=0 ;;
    major) V_MAJOR=$((V_MAJOR + 1)); V_MINOR=0; V_PATCH=0 ;;
    none) ;;
  esac
  VERSION="$V_MAJOR.$V_MINOR.$V_PATCH"
fi
[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+){1,3}$ ]] || { echo "❌ Nieprawidłowa wersja: $VERSION (oczekiwano np. 0.23.0)."; exit 1; }
echo "🏷️  Wersja $VERSION (poprzednie wydanie: $PREVIOUS)."
BUILD="$(date +%Y%m%d%H%M)"
NOTES="${NOTES:-Nowa wersja aplikacji Mavinci.}"
PUBLISH="${PUBLISH:-1}"
REMOTE="${MAVINCI_DEPLOY_REMOTE:-root@185.235.68.130}"
RELEASES_DIR="${DESKTOP_RELEASES_DIR:-/var/www/mavinci/desktop-releases}"
NOTARY_PROFILE="${NOTARY_PROFILE:-mavinci-notary}"
TEAM_ID="5DC8P5M489"
OUT="build/release"
NAME="Mavinci-$VERSION-$BUILD"
APP="build/Mavinci.app"

# Połączenie z serwerem sprawdzone przed kosztownym budowaniem (jak `yarn deploy`).
if [ "$PUBLISH" != "0" ]; then
  echo "🔌 Sprawdzam połączenie SSH z serwerem CRM ($REMOTE)…"
  if ! ssh -o ConnectTimeout=10 -o ConnectionAttempts=1 "$REMOTE" 'true'; then
    echo "❌ Brak połączenia SSH z serwerem — nic nie zostało zbudowane."
    echo "   Sam instalator bez publikacji: PUBLISH=0 yarn dmg"
    exit 1
  fi
fi

echo "🔨 Kompilacja Mavinci $VERSION ($BUILD)…"
VERSION="$VERSION" BUILD="$BUILD" CONFIGURATION=release bash scripts/build-app.sh

# Aktualizacje w aplikacji przyjmują tylko pakiet podpisany przez zespół Mavinci.
SIGNATURE="$(codesign -dvv "$APP" 2>&1 || true)"
if ! grep -q "TeamIdentifier=$TEAM_ID" <<<"$SIGNATURE"; then
  echo "❌ Aplikacja nie ma podpisu zespołu Mavinci ($TEAM_ID) — aplikacje na Macach odrzuciłyby taką aktualizację."
  echo "   Potrzebny certyfikat „Developer ID Application” (albo „Apple Development”) zespołu w pęku kluczy."
  exit 1
fi
DEVELOPER_ID=0
if grep -q "Authority=Developer ID Application" <<<"$SIGNATURE"; then DEVELOPER_ID=1; fi
# Kompilacja deweloperska („Apple Development”) działa w pełni na Macu, na którym ją zbudowano; na innych Macach macOS może nie
# uruchomić rozszerzenia Findera („Mavinci” w pasku bocznym). Przed publikacją takiego wydania — pytanie (ALLOW_DEVELOPMENT_RELEASE=1
# pomija pytanie, PUBLISH=0 — tylko pliki lokalnie).
if [ "$DEVELOPER_ID" != 1 ]; then
  echo ""
  echo "⚠️  Podpis „Apple Development” (kompilacja deweloperska), nie „Developer ID Application”."
  echo "   Na tym Macu wszystko działa, ale na innych Macach „Mavinci” może nie pojawić się w Finderze."
  echo "   Wydanie dla zespołu: certyfikat Developer ID (desktop/mac/README.md → „Instalator dla innych Maców”)."
  if [ "$PUBLISH" != "0" ] && [ -t 0 ] && [ "${ALLOW_DEVELOPMENT_RELEASE:-}" != "1" ]; then
    read -r -p "   Opublikować mimo to? [t/N] " answer
    case "$answer" in t|T|tak|Tak|TAK|y|Y) ;; *) echo "Przerwano — nic nie zostało opublikowane (pliki: PUBLISH=0 yarn dmg)."; exit 1;; esac
  fi
fi

mkdir -p "$OUT"
NOTARIZED=false
if [ "$DEVELOPER_ID" = 1 ] && xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  echo "📝 Notaryzacja aplikacji (Apple, kilka minut)…"
  ditto -c -k --keepParent "$APP" "$OUT/$NAME-notarize.zip"
  xcrun notarytool submit "$OUT/$NAME-notarize.zip" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$APP"
  rm -f "$OUT/$NAME-notarize.zip"
  NOTARIZED=true
elif [ "$DEVELOPER_ID" = 1 ]; then
  echo "ℹ️  Bez notaryzacji: brak profilu „$NOTARY_PROFILE” (README → „Instalator i aktualizacje”). Aktualizacje w aplikacji działają;"
  echo "   pierwsze otwarcie instalatora pobranego z sieci wymaga zgody w macOS (prawy przycisk → Otwórz)."
else
  echo "ℹ️  Podpis „Apple Development” — bez notaryzacji. Aktualizacje w aplikacji działają; pierwsze otwarcie instalatora"
  echo "   pobranego z sieci wymaga zgody w macOS (prawy przycisk → Otwórz albo Ustawienia → Prywatność i ochrona)."
fi

echo "📦 Paczka aktualizacji i instalator…"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT/$NAME.zip"
bash scripts/make-dmg.sh
mv -f build/Mavinci.dmg "$OUT/$NAME.dmg"
if [ "$NOTARIZED" = true ]; then
  echo "📝 Notaryzacja instalatora…"
  xcrun notarytool submit "$OUT/$NAME.dmg" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$OUT/$NAME.dmg"
fi

sha() { shasum -a 256 "$1" | awk '{print $1}'; }
bytes() { stat -f%z "$1"; }
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || true)"
node -e '
const [file, version, build, notes, notarized, commit, dmgFile, dmgSize, dmgSha, zipFile, zipSize, zipSha] = process.argv.slice(1);
const release = {
  platform: "mac", version, build, publishedAt: new Date().toISOString(), notes, minimumSystem: "14.0",
  notarized: notarized === "true", commit,
  dmg: { file: dmgFile, size: Number(dmgSize), sha256: dmgSha },
  zip: { file: zipFile, size: Number(zipSize), sha256: zipSha },
};
require("fs").writeFileSync(file, JSON.stringify(release, null, 2) + "\n");
' "$OUT/latest.json" "$VERSION" "$BUILD" "$NOTES" "$NOTARIZED" "$COMMIT" \
  "$NAME.dmg" "$(bytes "$OUT/$NAME.dmg")" "$(sha "$OUT/$NAME.dmg")" \
  "$NAME.zip" "$(bytes "$OUT/$NAME.zip")" "$(sha "$OUT/$NAME.zip")"

if [ "$PUBLISH" != "0" ]; then
  echo "📤 Publikuję wersję na serwerze CRM…"
  ssh "$REMOTE" mkdir -p "$RELEASES_DIR/mac"
  rsync -av --progress "$OUT/$NAME.dmg" "$OUT/$NAME.zip" "$REMOTE:$RELEASES_DIR/mac/"
  rsync -av "$OUT/latest.json" "$REMOTE:$RELEASES_DIR/mac/latest.json.tmp"
  # Opis wydania podmieniany na końcu (aplikacje nie zobaczą wersji bez plików); zostaje 5 najnowszych wersji.
  ssh "$REMOTE" bash -s -- "$RELEASES_DIR/mac" <<'REMOTE_SCRIPT'
set -euo pipefail
cd "$1"
mv -f latest.json.tmp latest.json
ls -1t Mavinci-*.zip 2>/dev/null | tail -n +6 | while read -r zip; do rm -f -- "$zip" "${zip%.zip}.dmg"; done || true
REMOTE_SCRIPT
  # Numer opublikowanego wydania — następne `yarn release` zacznie od niego.
  printf '%s\n' "$VERSION" > VERSION
fi

echo ""
echo "✅ Mavinci $VERSION ($BUILD)"
echo "   Instalator:          desktop/mac/$OUT/$NAME.dmg"
echo "   Paczka aktualizacji: desktop/mac/$OUT/$NAME.zip"
echo "   Notaryzacja Apple:   $([ "$NOTARIZED" = true ] && echo tak || echo nie)"
if [ "$PUBLISH" != "0" ]; then
  echo "   Opublikowano: aplikacje na Macach pokażą nową wersję w stopce paska bocznego w ciągu godziny"
  echo "   (od razu: Ustawienia → Oprogramowanie → Sprawdź teraz albo Mavinci → Sprawdź aktualizacje…);"
  echo "   instalator do pierwszej instalacji: CRM → Dysk → Programy (także Finder i aplikacja) albo Ustawienia → Ogólne."
  if [ "$VERSION" != "$PREVIOUS" ]; then
    echo "   Numer wersji: desktop/mac/VERSION $PREVIOUS → $VERSION — dołącz plik do commita."
  fi
else
  echo "   Bez publikacji (PUBLISH=0) — aplikacje na Macach nie zobaczą tej wersji."
fi
open -R "$OUT/$NAME.dmg" >/dev/null 2>&1 || true
