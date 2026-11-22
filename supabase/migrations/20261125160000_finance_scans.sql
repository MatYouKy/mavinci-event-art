-- Skaner w aplikacji (Dysk → „Skanuj dokument”): zdjęcia stron skanu czekają chwilę w prywatnym buckecie `finance-scans`
-- (`<firma>/<skan>/<nr strony>.jpg`), aż serwer Next złoży z nich PDF i zapisze go w wybranym folderze Finansów (Koszty miesiąca
-- jako dokument spoza KSeF, Dokumenty spółki, umowa stała). Strony usuwa serwer zaraz po zapisie albo po przerwaniu skanu.
--
-- • Adresy wysyłki podpisuje i pliki czyta wyłącznie serwer (konto serwisowe) — po sprawdzeniu poziomu „Finanse — zarządzanie”
--   w firmie. Użytkownicy nie mają polityk na tym buckecie.
-- • Do 15 MB na stronę, tylko zdjęcia JPG i PNG (PDF składa pdf-lib).
-- Plik idempotentny — można go wykonać ponownie.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('finance-scans', 'finance-scans', false, 15728640, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

commit;
