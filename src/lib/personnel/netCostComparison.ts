import { emptyPayrollProfile } from './legal';
import { emptyNetCostSettings, estimateNetCost, type NetCostSettings, type NetCostEstimate } from './netCostEstimate';

export type NetCostScenario = { id: string; label: string; assumption: string; result: NetCostEstimate };

/** Hypothetical profiles for comparison only. Never apply them to the contractor or payroll. */
export function compareNetCosts(amount: number, settings: NetCostSettings, currency: string): NetCostScenario[] {
  const base: NetCostSettings = {
    ...emptyNetCostSettings(), ...settings,
    payment_date: settings.payment_date || '2026-01-15',
    insurance: 'social_health', sickness: false, small_contract: false, youth_remaining: '85528',
  };
  // Each example has a consistent status throughout one hypothetical work period.
  base.work_from = base.payment_date;
  base.work_to = base.payment_date;
  const adult = { ...emptyPayrollProfile(), birth_date: '1990-01-01', education: 'none', own_employer: 'no', tax_residency: 'PL', youth_opt_out: 'no' };
  const young = { ...adult, birth_date: '2002-01-01' };
  const student = { ...young, education: 'student', education_from: '2026-01-01', education_to: '2026-12-31' };
  const scenario = (id: string, label: string, assumption: string, kind: string, overrides: Partial<NetCostSettings> = {}, profile = adult): NetCostScenario => ({
    id, label, assumption,
    result: estimateNetCost(amount, { ...base, ...overrides }, { kind, profile, currency, partyKind: 'person', hypothetical: true }),
  });
  return [
    scenario('mandate', 'Zlecenie — pełne ZUS', 'Osoba po 26. urodzinach, bez dobrowolnego chorobowego.', 'mandate'),
    scenario('mandate_sickness', 'Zlecenie — ZUS i chorobowe', 'Osoba po 26. urodzinach, z dobrowolnym chorobowym.', 'mandate', { sickness: true }),
    scenario('mandate_health', 'Zlecenie — tylko zdrowotna', 'Potwierdzony inny tytuł zwalniający ze składek społecznych.', 'mandate', { insurance: 'health_only' }),
    scenario('mandate_young', 'Zlecenie — ulga dla młodych', 'Osoba przed 26. urodzinami, bez statusu ucznia/studenta, pełne ZUS bez chorobowego.', 'mandate', {}, young),
    scenario('mandate_student', 'Zlecenie — uczeń / student przed 26. urodzinami', 'Bez ZUS, ulga dla młodych w ramach dostępnego limitu.', 'mandate', { insurance: 'auto' }, student),
    scenario('employment', 'Umowa o pracę', 'Osoba po 26. urodzinach; składki obowiązkowe.', 'employment'),
    scenario('employment_young', 'Umowa o pracę — ulga dla młodych', 'Osoba przed 26. urodzinami; składki obowiązkowe pozostają.', 'employment', {}, young),
    scenario('specific_work', 'Umowa o dzieło', 'Określony rezultat, poza własnym pracodawcą; standardowe KUP 20%.', 'specific_work'),
    scenario('oral_cash', 'Ustne zlecenie — gotówka', 'Pełne ZUS bez chorobowego. Forma wypłaty nie zmienia składek ani PIT.', 'mandate'),
  ];
}
