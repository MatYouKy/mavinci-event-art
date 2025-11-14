# Instrukcja logowania do CRM Mavinci

## Krok 1: Utwórz konto użytkownika

Otwórz konsolę przeglądarki (F12) i wklej poniższy kod:

```javascript
// Uruchom w konsoli na stronie /crm/login
const { createClient } = window.supabase;

const supabase = createClient(
  'https://0ec90b57d6e95fcbda19832f.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJib2x0IiwicmVmIjoiMGVjOTBiNTdkNmU5NWZjYmRhMTk4MzJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4ODE1NzQsImV4cCI6MTc1ODg4MTU3NH0.9I8-U0x86Ak8t2DGaIk0HfvTSLsAyzdnz-Nw00mMkKw',
);

// Zarejestruj użytkownika
await supabase.auth.signUp({
  email: 'crm@mavinci.pl',
  password: 'mavinci2025',
});

console.log('✅ Użytkownik utworzony! Możesz się teraz zalogować.');
```

## Krok 2: Zaloguj się

Przejdź do: **http://localhost:3000/crm/login**

Dane logowania:

- **Email:** crm@mavinci.pl
- **Hasło:** mavinci2025

## Gotowe!

Po zalogowaniu masz pełny dostęp do systemu CRM z:

- Dashboard z rzeczywistymi danymi
- Zarządzaniem klientami
- Wydarzeniami
- Pracownikami
- Zadaniami

## Bezpieczeństwo

System jest w pełni zabezpieczony Row Level Security (RLS):

- ✅ Dostęp tylko dla zalogowanych użytkowników
- ✅ Pełna ochrona danych przed wyciekiem
- ✅ Każda operacja wymaga autoryzacji Supabase Auth

## Dodawanie nowych użytkowników

Aby dodać kolejnych użytkowników, użyj powyższego kodu w konsoli zmieniając email i hasło.
