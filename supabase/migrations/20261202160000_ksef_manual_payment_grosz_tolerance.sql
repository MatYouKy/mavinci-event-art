-- Zatwierdzenie propozycji z fakturą KSeF oznaczoną ręcznie jako opłacona, gdy wpłata z wyciągu różni się o 1 grosz
-- (docs/bank-reconciliation.md, sekcja 13).
--
-- Przykład: faktura końcowa do zapłaty 11 515,87 zł oznaczona ręcznie jako opłacona, klient przelał 11 515,88 zł.
-- Propozycja „Zgodna kwota i kontrahent” traktuje grosz różnicy jako zaokrąglenie (jak wszystkie dopasowania — tolerancja
-- 0,01 zł), ale `reconcile_paid_ksef_invoice_with_bank_transaction` po zastąpieniu ręcznej wpłaty (11 515,87 zł) zostawała
-- z 0,01 zł „do zastąpienia” i kończyła się błędem „Nie udalo sie przygotowac platnosci recznej do zamiany”: zatwierdzenie
-- niczego nie zapisywało, a propozycja wracała. Teraz reszta do 1 grosza jest zaokrągleniem — tak jak w pozostałych
-- warunkach tej funkcji (kwota ≤ część oznaczona ręcznie + 0,01 zł, saldo dokumentu + 0,01 zł) i w
-- `match_bank_transaction_to_document` (kwota ≤ saldo dokumentu + 0,01 zł). Większa różnica nadal zatrzymuje zapis.
--
-- Funkcja jest poprawiana w miejscu: aktualna treść z bazy z jedną zmianą warunku, żeby nie cofnąć innych zmian
-- wprowadzonych w niej po migracji 20260903200000. Uprawnienia zostają (CREATE OR REPLACE). Ponowne uruchomienie
-- niczego nie zmienia.

do $patch$
declare
  v_def text;
  v_old constant text := 'IF v_remaining > 0.009 THEN';
  v_new constant text := 'IF v_remaining > 0.01 THEN';
begin
  v_def := pg_get_functiondef(
    'public.reconcile_paid_ksef_invoice_with_bank_transaction(uuid, uuid, numeric, numeric, text[])'::regprocedure
  );
  if position(v_new in v_def) > 0 then
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'reconcile_paid_ksef_invoice_with_bank_transaction: oczekiwano dokładnie jednego warunku „%”', v_old;
  end if;
  execute replace(v_def, v_old, v_new);
end
$patch$;
