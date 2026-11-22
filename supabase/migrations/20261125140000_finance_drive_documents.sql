-- Dysk → Finanse (CRM, Mac, Finder): firma → Księgowość → rok → miesiąc → Sprzedaż, Koszty, Bank, Podatki i ZUS, XML z KSeF.
--
-- • Dział i pliki buduje serwer Next (`src/lib/drive/drive.server.ts`) z istniejących tabel, czytanych tokenem pracownika
--   (RLS): faktury CRM, faktury z KSeF, dokumenty spoza KSeF, wyciągi bankowe i deklaracje. Ta migracja nie zmienia tabel.
-- • Prywatny bucket `finance-documents` na pliki tworzone na żądanie i trzymane jako kopia:
--     <firma>/invoices/<faktura>-<wersja>.pdf  — wydruk faktury CRM bez zapisanego PDF-a,
--     <firma>/ksef/<faktura>-v<n>-<wersja>.pdf — wizualizacja faktury z KSeF,
--     <firma>/ksef/<faktura>-<wersja>.xml      — plik XML faktury z KSeF.
--   Zapisuje i podpisuje je wyłącznie serwer (konto serwisowe) — po sprawdzeniu dostępu pracownika do faktury i do finansów
--   firmy. Użytkownicy nie mają polityk na tym buckecie (jak katalog `contracts/` w `employee-documents`).
-- Plik idempotentny — można go wykonać ponownie.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('finance-documents', 'finance-documents', false, 52428800, array['application/pdf', 'application/xml', 'text/xml'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

commit;
