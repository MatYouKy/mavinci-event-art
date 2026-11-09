# Android — instalacja dla zespołu

## Budowanie APK

Z katalogu `mobile`:

```sh
yarn deploy:android
```

Profil `android-internal` w `eas.json` buduje podpisany APK w środowisku
`production`, z automatycznie zwiększanym numerem buildu. Korzysta z istniejącego
klucza podpisu w Expo oraz identyfikatora `com.mavinci.crm`. Zachowaj ten podpis
przy kolejnych aktualizacjach, aby instalować je na istniejącej aplikacji.

Link do zakończonego buildu pozwala pobrać APK na telefon. Android może poprosić
o zezwolenie przeglądarce na instalowanie aplikacji z tego źródła.
Nie jest to publikacja w Google Play. `yarn deploy` nadal buduje wersję iOS.

Przed kolejną wersją zwiększ zgodnie `version` w `app.json` i `package.json`.
Natywny katalog `android/` jest w repozytorium, więc EAS nie generuje go od nowa.
Po zmianach konfiguracji lub pluginów zsynchronizuj go i sprawdź różnice:

```sh
yarn expo prebuild --platform android --no-install
```

## Powiadomienia Androida — jeszcze nieskonfigurowane

Projekt Firebase `mavinci-crm-ea9c7` został utworzony na bezpłatnym planie Spark,
a aplikacja Android `com.mavinci.crm` jest zarejestrowana.
Nie włączono Google Analytics ani płatnego planu.
Wersja 1.3.15 nie ma jeszcze konfiguracji Firebase/FCM. Powiadomienia systemowe push
na Androidzie wymagają osobnego projektu Firebase; nie wymaga to przenoszenia
danych aplikacji z Supabase.

1. Otwórz ustawienia aplikacji w projekcie `mavinci-crm-ea9c7`. Rejestracja jest już zakończona.
2. Dodaj plik konfiguracji klienta `google-services.json` i wskaż go przez
   `expo.android.googleServicesFile` w `app.json`.
3. Wgraj klucz konta usługi FCM V1 do poświadczeń Androida w EAS.
   Klucz prywatny nie może trafić do repozytorium ani paczki aplikacji.
4. Zsynchronizuj Androida, zbuduj nowy APK i sprawdź push na prawdziwym telefonie.

Instrukcja: https://docs.expo.dev/push-notifications/fcm-credentials/

## Sprawdzenie na urządzeniu

Po instalacji sprawdź logowanie, uprawnienia konta, powrót między ekranami,
klawiaturę w czacie, zdjęcia i filmy, zapis zdjęcia do galerii, checklistę
załadunku i timer czasu pracy. Sam poprawny build nie potwierdza działania
wszystkich funkcji na konkretnym telefonie.
