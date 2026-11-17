-- Własne prowizje pracownika: pracownik widzi całe swoje konto prowizji, nie tylko udział w sprzedaży wydarzeń.
--
-- Dotąd „Moje prowizje” (get_my_commissions) i własne konto w get_commission_settlements pokazywały pracownikowi wyłącznie
-- wpisy z beneficjentem „pracownik”. Ręczna prowizja typu „Sprzedawca” przypisana do pracownika (salesperson_id) i prowizja
-- z profilu sprzedawcy powiązanego z pracownikiem były widoczne tylko dla osób z dostępem do finansów — a to też jego dorobek.
-- Teraz własne konto obejmuje te same wpisy co konto pracownika w CRM (employee_id, salesperson_id, profil sprzedawcy).
--
-- Zmieniamy tylko warunek widoczności własnych wpisów: dokładny fragment definicji jest podmieniany, reszta funkcji zostaje
-- bez zmian (uprawnienia funkcji zostają, bo to CREATE OR REPLACE). Inna definicja niż oczekiwana zatrzymuje migrację.

DO $migration$
DECLARE
  def text;
  old_fragment text;
  new_fragment text;
BEGIN
  def := pg_get_functiondef('public.get_commission_settlements(text,text,uuid)'::regprocedure);
  old_fragment := '(own_account AND c.employee_id = account_id AND c.beneficiary_type = ''employee'')';
  new_fragment := '(own_account AND (c.employee_id = account_id OR c.salesperson_id = account_id OR profile.employee_id = account_id))';
  IF position(new_fragment IN def) = 0 THEN
    IF (length(def) - length(replace(def, old_fragment, ''))) / length(old_fragment) <> 1 THEN
      RAISE EXCEPTION 'get_commission_settlements: nieoczekiwana definicja — sprawdź funkcję przed migracją.';
    END IF;
    EXECUTE replace(def, old_fragment, new_fragment);
  END IF;

  def := pg_get_functiondef('public.get_my_commissions()'::regprocedure);
  old_fragment := 'WHERE c.employee_id = v_emp AND c.beneficiary_type = ''employee'' AND c.status <> ''cancelled''';
  new_fragment := 'WHERE (c.employee_id = v_emp OR c.salesperson_id = v_emp) AND c.status <> ''cancelled''';
  IF position(new_fragment IN def) = 0 THEN
    IF (length(def) - length(replace(def, old_fragment, ''))) / length(old_fragment) <> 1 THEN
      RAISE EXCEPTION 'get_my_commissions: nieoczekiwana definicja — sprawdź funkcję przed migracją.';
    END IF;
    EXECUTE replace(def, old_fragment, new_fragment);
  END IF;
END
$migration$;
