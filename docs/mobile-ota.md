# Aplikacja mobilna — aktualizacje bez sklepu (EAS Update)

Od wersji 1.3.16 aplikacja (iOS i Android) pobiera nowe wersje kodu JS bez sklepu.

- Moduł: `expo-updates` (`mobile/package.json`), serwer: `https://u.expo.dev/25b8480f-7b88-490e-80f7-1f1925702388` (`mobile/app.json` → `updates.url`, `android/…/AndroidManifest.xml`; iOS — folder `ios/` nie jest w git, EAS generuje go z `app.json` przy buildzie).
- Kanał: **production** — buildy `production` (iOS, App Store) i `android-internal` (APK) słuchają tego samego kanału (`mobile/eas.json`).
- Wersja środowiska: **`runtimeVersion` 1.0.0** (`app.json` i `android/app/src/main/res/values/strings.xml` → `expo_runtime_version`; iOS bierze ją z `app.json`). Aktualizacja trafia tylko do buildów z tą samą wartością.
- W aplikacji: `src/services/appUpdates.ts` (`useOtaUpdates` w `App.tsx`) — przy starcie i powrocie do aplikacji sprawdza aktualizację, pobiera ją i pokazuje „Nowa wersja aplikacji” → „Uruchom ponownie” (albo „Później” — włączy się przy następnym uruchomieniu). W trybie deweloperskim wyłączone.

- W Ustawieniach, pod wersją: kanał, wersja środowiska i „kod wbudowany w aplikację” albo „aktualizacja z …” (`appUpdateLabel` w `src/lib/appVersion.ts`) — po tym widać, czy dany telefon dostaje aktualizacje. „kanał brak” albo „aktualizacje wyłączone” — trzeba zainstalować nową wersję aplikacji (build EAS).

## Wydanie aktualizacji

```bash
cd mobile
yarn deploy:ota --message "Krótki opis zmiany"
```
(`eas update --channel production --environment production` — zmienne `EXPO_PUBLIC_*` ze środowiska „production” w EAS, jak przy buildzie).

## Kiedy potrzebny jest nowy build w sklepie (i podniesienie `runtimeVersion`)

Zmiany natywne: nowy moduł Expo / React Native z kodem natywnym, zmiana Expo SDK, uprawnienia, ikony, `app.json` w częściach natywnych, pliki w `android/` i `ios/`. Wtedy: podnieś `runtimeVersion` w `app.json` i w `strings.xml` (np. 1.0.0 → 1.1.0) i zbuduj nową wersję w sklepach. Zmiany tylko w kodzie JS / TS (`src/`, `App.tsx`) — wystarczy `yarn deploy:ota`.

Numer wersji aplikacji (`version` w `app.json` i `package.json`) podnosimy przy każdym buildzie do sklepu, jak dotąd — nie ma związku z `runtimeVersion`.

## Przenosiny Supabase (docs/migracja-frankfurt.md)

Nowy adres i klucz bazy w środowisku „production” w EAS (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` — expo.dev → projekt → Environment variables) i `yarn deploy:ota --message "Nowy serwer (Frankfurt)"`. Telefony z wersją ≥ 1.3.16 przełączą się po ponownym uruchomieniu aplikacji.

## Android — osobny build (`yarn deploy:android`)

`yarn deploy` buduje tylko iOS (App Store). Android to APK z profilu `android-internal` (kanał **production**):

```bash
cd mobile
yarn deploy:android
```

Folder `mobile/android/` jest w git (projekt natywny utrzymywany ręcznie), więc EAS nie generuje go z `app.json` jak `ios/` — zmiany
natywne dla Androida (uprawnienia, wtyczki, Firebase, `runtimeVersion` w `strings.xml`) wpisujemy w `android/`.

APK zbudowany przed 1.3.16 (09.11.2026) ma wyłączone aktualizacje bez sklepu (`expo.modules.updates.ENABLED=false`) — nie dostaje
`yarn deploy:ota` i nie pokazuje „Nowa wersja aplikacji”. Wersja w menu aplikacji niższa niż 1.3.16 = stary APK → zainstaluj nowy.
Od 27.11.2026 komunikat „Nowa wersja aplikacji” pojawia się także wtedy, gdy aktualizację pobrało sprawdzenie przy starcie
aplikacji (na Androidzie zwykle kończy się ono przed sprawdzeniem w kodzie — wcześniej komunikat się wtedy nie pokazywał,
a aktualizacja włączała się dopiero po ponownym uruchomieniu).

## Powiadomienia push na Androidzie (Firebase Cloud Messaging)

iPhone dostaje powiadomienia przez APNs (EAS ma klucz Apple). Android potrzebuje Firebase Cloud Messaging: bez konfiguracji
Firebase w aplikacji telefon nie dostaje tokenu push (`getExpoPushTokenAsync` kończy się błędem), w `push_tokens` nie ma żadnego
wpisu z `platform = 'android'`, więc funkcje `send-chat-push`, `send-push-notification` i `send-crm-notification-push` nie mają
dokąd wysłać powiadomienia (komunikator, zadania, CRM). Wysyłka ma już kanał `default` z dźwiękiem i priorytet `high`.

Jednorazowo:

1. **Firebase** (console.firebase.google.com) → projekt (np. „Mavinci CRM”) → *Dodaj aplikację* → Android → nazwa pakietu
   `com.mavinci.crm` → pobierz `google-services.json` → zapisz jako `mobile/android/app/google-services.json` i dodaj do git
   (to konfiguracja klienta, nie sekret — Google ogranicza ją do pakietu aplikacji). Wtyczka Gradle
   `com.google.gms.google-services` (4.4.1, `android/build.gradle`) włącza się sama, gdy plik jest na miejscu
   (`android/app/build.gradle`); bez pliku build działa jak dotąd, tylko bez powiadomień.
2. **Klucz do wysyłki (FCM V1)**: Firebase → Ustawienia projektu → *Konta usługi* → *Wygeneruj nowy klucz prywatny* (plik JSON —
   **sekret, nie dodawaj do git**) → `cd mobile && npx eas-cli credentials` → Android → `production` → *Google Service Account* →
   *Manage your Google Service Account Key for Push Notifications (FCM V1)* → wgraj plik (albo expo.dev → projekt →
   *Credentials* → Android → `com.mavinci.crm` → *FCM V1 service account key*). Bez klucza usługa Expo nie dostarczy
   powiadomienia na Androida, nawet z tokenem.
3. `yarn deploy:android`, instalacja nowego APK, logowanie, zgoda na powiadomienia (Android 13+ pyta przy pierwszym
   uruchomieniu). Telefon zapisuje token w `push_tokens` (`platform = 'android'`).

Kanał Androida `default` („Mavinci CRM”: najwyższa ważność, dźwięk, wibracja) tworzy aplikacja przy starcie
(`src/services/pushNotifications.ts`, `ANDROID_NOTIFICATION_CHANNEL`); używają go powiadomienia push i lokalne (wiadomość
z komunikatora przy otwartej aplikacji, przypomnienia o spotkaniach) — wcześniej lokalne trafiały do kanału zapasowego bez
banera. Dźwięk kanału użytkownik może zmienić w Ustawieniach Androida → Aplikacje → Mavinci CRM → Powiadomienia.
