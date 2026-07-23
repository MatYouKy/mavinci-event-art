# Mavinci CRM Mobile

Dokumentacja budowania, aktualizacji i publikowania aplikacji mobilnej Mavinci CRM.

## Stack

- Expo SDK 54
- React Native
- Supabase
- EAS Build
- TestFlight
- Yarn 1

## Wymagania

- Node.js
- Yarn 1
- konto Expo
- aktywne konto Apple Developer
- dostęp do projektu w App Store Connect

W projekcie nie ma lokalnie zainstalowanego polecenia `eas`, dlatego używamy:

```bash
npx eas-cli@latest
```

## Środowiska EAS

Projekt korzysta z trzech środowisk:

- `development`
- `preview`
- `production`

W aplikacji mobilnej używamy wyłącznie publicznych zmiennych Supabase:

```env
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

Nigdy nie dodawaj do aplikacji mobilnej:

```env
SUPABASE_SERVICE_ROLE_KEY=
```

Klucz `service_role` może być używany wyłącznie po stronie serwera.

## Konfiguracja `eas.json`

Plik `eas.json` powinien wyglądać tak:

```json
{
  "cli": {
    "version": ">= 21.1.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "environment": "development"
    },
    "preview": {
      "distribution": "internal",
      "environment": "preview"
    },
    "production": {
      "autoIncrement": true,
      "environment": "production"
    }
  },
  "submit": {
    "production": {}
  }
}
```

Najważniejsze ustawienia:

```json
"environment": "production"
```

Powoduje pobranie produkcyjnych zmiennych środowiskowych z EAS.

```json
"autoIncrement": true
```

Automatycznie zwiększa numer kolejnego builda iOS.

## Sprawdzanie zmiennych środowiskowych

Przed buildem produkcyjnym sprawdź, czy EAS widzi zmienne:

```bash
npx eas-cli@latest env:list --environment production
```

Na liście powinny znajdować się:

```text
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
```

Dla pozostałych środowisk:

```bash
npx eas-cli@latest env:list --environment preview
```

```bash
npx eas-cli@latest env:list --environment development
```

## Standardowa praca nad aplikacją

### 1. Przejdź do katalogu aplikacji

```bash
cd mobile
```

### 2. Pobierz aktualny kod

```bash
git pull origin main
```

### 3. Zainstaluj zależności

Uruchom po zmianie `package.json` lub `yarn.lock`:

```bash
yarn install
```

### 4. Sprawdź TypeScript

```bash
yarn tsc --noEmit
```

Jeżeli projekt nie ma skryptu `tsc`:

```bash
npx tsc --noEmit
```

### 5. Uruchom aplikację lokalnie

```bash
yarn start
```

lub:

```bash
npx expo start
```

Przy problemach z cache:

```bash
npx expo start --clear
```

### 6. Sprawdź najważniejsze funkcje

Przed publikacją sprawdź co najmniej:

- logowanie
- pobieranie danych z Supabase
- nawigację
- tworzenie i edycję danych
- wylogowanie
- ponowne uruchomienie aplikacji
- działanie bez internetu
- brak czarnego ekranu przy starcie

### 7. Zapisz zmiany w Git

```bash
git status
```

```bash
git add .
```

```bash
git commit -m "Opis zmian"
```

```bash
git push origin main
```

## Produkcyjny build iOS do TestFlight

Najważniejsza komenda:

```bash
npx eas-cli@latest build --platform ios --profile production --auto-submit
```

Komenda wykonuje:

1. wysłanie kodu do EAS
2. zbudowanie aplikacji iOS
3. zwiększenie numeru builda
4. wysłanie gotowego builda do App Store Connect
5. przekazanie builda do TestFlight po przetworzeniu przez Apple

W terminalu może pojawić się:

```text
Scheduled iOS submission
Waiting for build to complete
```

To oznacza, że submission jest zaplanowany i wystartuje po zakończeniu builda.

Możesz nacisnąć `Ctrl+C`. Build będzie kontynuowany w chmurze.

## Sprawdzanie statusu builda

```bash
npx eas-cli@latest build:list --platform ios
```

Ostatnie pięć buildów:

```bash
npx eas-cli@latest build:list --platform ios --limit 5
```

## Sprawdzanie statusu submission

```bash
npx eas-cli@latest submission:list --platform ios
```

Jeżeli build powstał poprawnie, ale automatyczne wysłanie do Apple się nie udało:

```bash
npx eas-cli@latest submit --platform ios --latest
```

Nie trzeba wtedy wykonywać nowego builda.

## Aktualizacja aplikacji w TestFlight

Po zakończeniu procesu:

1. otwórz App Store Connect
2. przejdź do aplikacji Mavinci CRM
3. otwórz zakładkę TestFlight
4. poczekaj na zakończenie przetwarzania przez Apple
5. otwórz TestFlight na iPhonie
6. wybierz `Uaktualnij`
7. uruchom aplikację
8. przetestuj najważniejsze funkcje

## Wersja aplikacji i numer builda

Przykład:

```text
Wersja aplikacji: 1.0.0
Numer builda: 3
```

Można wysyłać kolejne buildy tej samej wersji:

```text
1.0.0 (3)
1.0.0 (4)
1.0.0 (5)
```

Numer builda jest zwiększany automatycznie przez EAS.

Wersję aplikacji zmieniamy przy większej aktualizacji, np.:

```json
{
  "expo": {
    "version": "1.1.0"
  }
}
```

## Build bez automatycznego wysyłania

Tylko build:

```bash
npx eas-cli@latest build --platform ios --profile production
```

Późniejsze wysłanie do Apple:

```bash
npx eas-cli@latest submit --platform ios --latest
```

## Build preview

Do testów wewnętrznych:

```bash
npx eas-cli@latest build --platform ios --profile preview
```

Profil `preview` nie jest standardowym buildem TestFlight.

## Build development

Do pracy z development client:

```bash
npx eas-cli@latest build --platform ios --profile development
```

Build development nie służy do publikacji w App Store.

## Dodawanie bibliotek

Dla paczek Expo:

```bash
npx expo install nazwa-pakietu
```

Przykład:

```bash
npx expo install expo-camera
```

Dla zwykłych bibliotek JavaScript:

```bash
yarn add nazwa-pakietu
```

Po instalacji:

```bash
yarn tsc --noEmit
```

Jeżeli biblioteka zawiera część natywną, wymagany jest nowy build TestFlight.

## Aktualizacja Expo SDK

Nie aktualizuj Expo SDK przez ręczną zmianę numeru w `package.json`.

Podstawowa procedura:

```bash
npx expo install expo@nowa-wersja
```

```bash
npx expo install --fix
```

```bash
npx expo-doctor
```

```bash
yarn tsc --noEmit
```

Po aktualizacji Expo SDK zawsze wykonaj nowy build iOS.

## Diagnostyka czarnego ekranu

Jeżeli aplikacja z TestFlight uruchamia się na czarnym ekranie:

1. podłącz iPhone do Maca
2. otwórz aplikację `Konsola`
3. wybierz iPhone
4. rozpocznij strumieniowanie logów
5. wpisz filtr:

```text
process:MavinciCRM
```

6. zamknij aplikację na iPhonie
7. uruchom ją ponownie
8. szukaj wpisów:

```text
Unhandled JS Exception
ReactNativeJS
RCTFatal
Error
Exception
```

Przykładowy błąd:

```text
Unhandled JS Exception: [runtime not ready]:
Error: supabaseUrl is required.
```

Oznacza brak:

```env
EXPO_PUBLIC_SUPABASE_URL
```

w środowisku użytym do produkcyjnego builda.

Po dodaniu brakującej zmiennej trzeba wykonać nowy build. Istniejącego builda TestFlight nie da się naprawić samą zmianą konfiguracji EAS.

## Kontrola projektu

```bash
npx expo-doctor
```

Podgląd wynikowej konfiguracji Expo:

```bash
npx expo config
```

## Czyszczenie zależności

Przy problemach z lokalnym środowiskiem:

```bash
rm -rf node_modules
```

```bash
yarn install
```

```bash
npx expo start --clear
```

Nie usuwaj `yarn.lock`, chyba że robisz to świadomie.

## Nieudany build

Jeżeli EAS Build zakończy się błędem:

1. otwórz link do builda
2. znajdź pierwszy czerwony etap
3. znajdź pierwszy rzeczywisty błąd
4. popraw kod lub konfigurację
5. uruchom build ponownie

```bash
npx eas-cli@latest build --platform ios --profile production --auto-submit
```

Najczęstsze przyczyny:

- brak pliku
- błędna ścieżka do assetu
- brak zmiennej środowiskowej
- błędna konfiguracja `app.json`
- niezgodna wersja paczki
- problem z pluginem Expo
- problem CocoaPods

## Nieudany submission

Jeżeli build jest poprawny, ale submission zakończył się błędem:

```bash
npx eas-cli@latest submit --platform ios --latest
```

Sprawdź też:

- status Apple Developer Program
- umowy w App Store Connect
- dane podatkowe
- uprawnienia konta
- identyfikator aplikacji
- certyfikaty
- dokładny komunikat błędu

## Publikacja w App Store

Wysłanie builda przez EAS nie publikuje aplikacji automatycznie publicznie.

Aby opublikować aplikację w App Store:

1. otwórz App Store Connect
2. utwórz nową wersję aplikacji
3. wybierz właściwy build
4. uzupełnij opis
5. dodaj zrzuty ekranu
6. uzupełnij informacje o prywatności
7. uzupełnij dane dla recenzenta
8. wyślij wersję do App Review

## Szybka procedura aktualizacji TestFlight

```bash
cd mobile
```

```bash
git pull origin main
```

```bash
yarn install
```

```bash
yarn tsc --noEmit
```

```bash
npx eas-cli@latest env:list --environment production
```

```bash
git status
```

```bash
git add .
```

```bash
git commit -m "Opis zmian"
```

```bash
git push origin main
```

```bash
npx eas-cli@latest build --platform ios --profile production --auto-submit
```

Następnie:

1. poczekaj na zakończenie builda
2. poczekaj na zakończenie submission
3. poczekaj na przetworzenie przez Apple
4. zainstaluj aktualizację z TestFlight
5. przetestuj aplikację na fizycznym iPhonie

## Checklista przed wydaniem

- [ ] Aplikacja działa lokalnie
- [ ] TypeScript nie zwraca błędów
- [ ] Logowanie działa
- [ ] Supabase działa
- [ ] Najważniejsze ekrany zostały sprawdzone
- [ ] Zmienne production istnieją w EAS
- [ ] `SUPABASE_SERVICE_ROLE_KEY` nie jest używany w aplikacji mobilnej
- [ ] Zmiany są zapisane w Git
- [ ] Zmiany są wysłane do `main`
- [ ] Uruchomiono build production z `--auto-submit`
- [ ] Nowy build pojawił się w TestFlight
- [ ] Aktualizacja została sprawdzona na iPhonie

## Najważniejsza komenda

```bash
npx eas-cli@latest build --platform ios --profile production --auto-submit
```

Schemat publikacji:

```text
Kod → EAS Build → App Store Connect → TestFlight
```
