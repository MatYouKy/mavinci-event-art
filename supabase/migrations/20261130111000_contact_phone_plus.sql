-- Telefony kontaktów zapisane jako same cyfry z kierunkowym Polski („48510233670”) — z „+” i odstępami.
--
-- Formularz nowego kontaktu (CRM `/crm/contacts/new`, Mac — `createEntity`) zapisywał numer jako same cyfry: wpisany
-- „+48 510 233 670” trafiał do bazy jako „48510233670”, więc oferta i karta klienta pokazywały numer bez „+”, a „Zadzwoń”
-- wybierało zły numer. Formularze zapisują już numer z kierunkowym (`src/lib/CRM/client/phoneFormat.ts`); tu poprawiamy
-- zapisane wcześniej numery w tym samym formacie: komórkowe i specjalne „+48 510 233 670”, stacjonarne z numerem strefy
-- „+48 22 123 45 67”. Tylko pola zawierające dokładnie 11 cyfr zaczynających się od 48 (bez innych znaków) — pozostałe
-- zapisy (9 cyfr, numery zagraniczne, opisy „… lub …”) bez zmian.

create or replace function pg_temp.mavinci_phone_plus(value text)
returns text
language sql
immutable
as $$
  select case
    when value !~ '^48[1-9][0-9]{8}$' then value
    when substr(value, 3, 2) = any (array[
      '12', '13', '14', '15', '16', '17', '18', '22', '23', '24', '25', '29', '32', '33', '34', '41', '42', '43', '44', '46',
      '48', '52', '54', '55', '56', '58', '59', '61', '62', '63', '65', '67', '68', '71', '74', '75', '76', '77', '81', '82',
      '83', '84', '85', '86', '87', '89', '91', '94', '95'
    ])
      then '+48 ' || substr(value, 3, 2) || ' ' || substr(value, 5, 3) || ' ' || substr(value, 8, 2) || ' ' || substr(value, 10, 2)
    else '+48 ' || substr(value, 3, 3) || ' ' || substr(value, 6, 3) || ' ' || substr(value, 9, 3)
  end
$$;

update public.contacts
   set phone = pg_temp.mavinci_phone_plus(phone),
       mobile = pg_temp.mavinci_phone_plus(mobile),
       business_phone = pg_temp.mavinci_phone_plus(business_phone)
 where phone ~ '^48[1-9][0-9]{8}$'
    or mobile ~ '^48[1-9][0-9]{8}$'
    or business_phone ~ '^48[1-9][0-9]{8}$';
