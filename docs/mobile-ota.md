# Aplikacja mobilna — aktualizacje bez sklepu (EAS Update)

Od wersji 1.3.16 aplikacja (iOS i Android) pobiera nowe wersje kodu JS bez sklepu.

- Moduł: `expo-updates` (`mobile/package.json`), serwer: `https://u.expo.dev/25b8480f-7b88-490e-80f7-1f1925702388` (`mobile/app.json` → `updates.url`, `android/…/AndroidManifest.xml`, `ios/MavinciCRM/Supporting/Expo.plist`).
- Kanał: **production** — buildy `production` (iOS, App Store) i `android-internal` (APK) słuchają tego samego kanału (`mobile/eas.json`).
- Wersja środowiska: **`runtimeVersion` 1.0.0** (`app.json`, `android/app/src/main/res/values/strings.xml` → `expo_runtime_version`, `Expo.plist` → `EXUpdatesRuntimeVersion`). Aktualizacja trafia tylko do buildów z tą samą wartością.
- W aplikacji: `src/services/appUpdates.ts` (`useOtaUpdates` w `App.tsx`) — przy starcie i powrocie do aplikacji sprawdza aktualizację, pobiera ją i pokazuje „Nowa wersja aplikacji” → „Uruchom ponownie” (albo „Później” — włączy się przy następnym uruchomieniu). W trybie deweloperskim wyłączone.

## Wydanie aktualizacji

```bash
cd mobile
yarn deploy:ota --message "Krótki opis zmiany"
```
(`eas update --channel production --environment production` — zmienne `EXPO_PUBLIC_*` ze środowiska „production” w EAS, jak przy buildzie).

## Kiedy potrzebny jest nowy build w sklepie (i podniesienie `runtimeVersion`)

Zmiany natywne: nowy moduł Expo / React Native z kodem natywnym, zmiana Expo SDK, uprawnienia, ikony, `app.json` w częściach natywnych, pliki w `android/` i `ios/`. Wtedy: podnieś `runtimeVersion` we wszystkich trzech miejscach (np. 1.0.0 → 1.1.0) i zbuduj nową wersję w sklepach. Zmiany tylko w kodzie JS / TS (`src/`, `App.tsx`) — wystarczy `yarn deploy:ota`.

Numer wersji aplikacji (`version` w `app.json` i `package.json`) podnosimy przy każdym buildzie do sklepu, jak dotąd — nie ma związku z `runtimeVersion`.

## Przenosiny Supabase (docs/migracja-frankfurt.md)

Nowy adres i klucz bazy w środowisku „production” w EAS (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` — expo.dev → projekt → Environment variables) i `yarn deploy:ota --message "Nowy serwer (Frankfurt)"`. Telefony z wersją ≥ 1.3.16 przełączą się po ponownym uruchomieniu aplikacji.
