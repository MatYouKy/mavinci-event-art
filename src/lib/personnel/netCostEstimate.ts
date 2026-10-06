import { assessQuestionnaire, profileFromQuestionnaire } from './questionnaire';
import { type PersonnelPayrollProfile, roundMoney, statutoryRates } from './legal';

/** Planning only. These figures never create or approve payroll liabilities. */
export type NetCostSettings = {
  basis: 'monthly' | 'fixed' | 'hourly' | 'piecework';
  quantity: string;
  payment_date: string;
  work_from: string;
  work_to: string;
  insurance: 'auto' | 'social_health' | 'health_only';
  sickness: boolean;
  pit_rate: '12' | '32';
  pit_credit: '0' | '100' | '150' | '300';
  employment_kup: '0' | '250' | '300';
  youth_remaining: string;
  small_contract: boolean;
  accident_rate: string;
  labour_fund: 'auto' | 'yes' | 'no';
  fgsp: boolean;
  cit_rate: '9' | '19';
};
export const netBasisLabels: Record<NetCostSettings['basis'], string> = {
  monthly: 'Za miesiąc', fixed: 'Za realizację / jedną wypłatę', hourly: 'Za godzinę', piecework: 'Za jednostkę akordu',
};
export const emptyNetCostSettings = (): NetCostSettings => ({
  basis: 'monthly', quantity: '', payment_date: '', work_from: '', work_to: '',
  insurance: 'auto', sickness: false, pit_rate: '12', pit_credit: '0', employment_kup: '250',
  youth_remaining: '', small_contract: false, accident_rate: '1.67', labour_fund: 'auto', fgsp: true, cit_rate: '9',
});
export const normalizeNetCostSettings = (value?: Partial<NetCostSettings> | null): NetCostSettings => ({ ...emptyNetCostSettings(), ...value });
export type NetCostContext = {
  kind: string; profile: PersonnelPayrollProfile; currency: string; partyKind: string; hypothetical?: boolean;
};
export type NetCostBreakdown = {
  gross: number; net: number; pit: number; social: number; health: number;
  employerPension: number; employerDisability: number; accident: number; labourFund: number; fgsp: number;
  employer: number; company: number; youth: number; healthCapped: boolean;
};
export type NetCostEstimate = {
  target: number; breakdown: NetCostBreakdown | null; issue: string | null; notes: string[];
  insuranceLabel: string; citBenefit: number; afterCit: number;
  dividendProfit: number; dividendCit: number; dividendTax: number;
};
const isDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const birthday26 = (born: string) => {
  const [y, m, d] = born.split('-').map(Number);
  // A leap-day birthday reaches the age on the last day of February in a non-leap year.
  const last = new Date(Date.UTC(y + 26, m, 0)).getUTCDate();
  return `${y + 26}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

export function estimateNetCost(amount: number, settings: NetCostSettings, context: NetCostContext): NetCostEstimate {
  const s = normalizeNetCostSettings(settings), p = profileFromQuestionnaire(context.profile);
  const unit = s.basis === 'hourly' || s.basis === 'piecework';
  const quantity = unit ? Number(s.quantity) : 1;
  const target = roundMoney(amount * quantity);
  const result: NetCostEstimate = { target, breakdown: null, issue: null, notes: [], insuranceLabel: '', citBenefit: 0, afterCit: 0, dividendProfit: 0, dividendCit: 0, dividendTax: 0 };
  const stop = (issue: string) => ({ ...result, issue });
  if (!Number.isFinite(amount) || amount <= 0) return stop('Wpisz kwotę netto, aby zobaczyć koszt.');
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(target) || target > 1000000) return stop('Podaj liczbę godzin / jednostek w jednym miesiącu. Limit symulacji to 1 000 000 zł netto.');
  if (context.currency.toUpperCase() !== 'PLN') return stop('Symulacja podatkowa jest dostępna dla kwot w PLN.');
  if (context.partyKind !== 'person') return stop('Kalkulator dotyczy wynagrodzenia osoby fizycznej. Rozliczenie firmy wymaga danych z faktury.');
  if (!['employment', 'mandate', 'specific_work'].includes(context.kind)) return stop('Wybierz podstawę prawną umowy.');
  if (!isDate(s.payment_date)) return stop('Uzupełnij datę wypłaty w założeniach kalkulacji.');
  if (!s.payment_date.startsWith('2026-')) return stop('Ta wersja kalkulatora zawiera zasady podatkowe na 2026 rok.');
  if (p.tax_residency === 'other') return stop('Nierezydent wymaga indywidualnego ustalenia zasad opodatkowania.');
  if (!context.hypothetical) {
    const decision = assessQuestionnaire({ ...context, profile: p, settings: s });
    if (decision.issues.length) return stop(decision.issues[0].message);
    Object.assign(s, decision.settings);
  }
  const employment = context.kind === 'employment', mandate = context.kind === 'mandate';
  if (!employment && p.own_employer === 'yes') return stop('Zaznaczono dodatkową umowę do istniejącego etatu. Jej koszt wymaga danych o wynagrodzeniu z etatu. Jeżeli osoba nie ma takiego etatu i nie pracuje na rzecz swojego pracodawcy, popraw odpowiedź w danych PIT i ZUS na „Nie”.');
  if (!employment && p.own_employer !== 'no') return stop('W danych PIT i ZUS określ, czy jest to praca dla własnego pracodawcy.');
  const knownAge = isDate(p.birth_date), birthday = knownAge ? birthday26(p.birth_date) : '';
  if (knownAge && p.birth_date > s.payment_date) return stop('Data urodzenia jest późniejsza niż data wypłaty.');
  const educated = ['pupil', 'student'].includes(p.education);
  let student = false;
  if (mandate && s.insurance === 'auto' && educated) {
    if (!knownAge || !isDate(s.work_from) || !isDate(s.work_to) || s.work_to < s.work_from) return stop('Dla ucznia / studenta uzupełnij datę urodzenia oraz okres pracy objęty symulacją.');
    if (s.work_from < p.birth_date) return stop('Okres pracy jest wcześniejszy niż data urodzenia.');
    if (s.work_from < birthday && s.work_to >= birthday) return stop('Okres obejmuje 26. urodziny. Podziel kalkulację według zmiany tytułu ubezpieczenia.');
    if (s.work_to < birthday) {
      if (!isDate(p.education_from) || !isDate(p.education_to) || p.education_from > s.work_from || p.education_to < s.work_to) return stop('Zwolnienie z ZUS wymaga potwierdzonego statusu ucznia / studenta przez cały wskazany okres pracy.');
      student = true;
    }
  }
  const social = employment || (mandate && !student && s.insurance !== 'health_only');
  const health = employment || (mandate && !student);
  result.insuranceLabel = employment ? 'Etat — składki społeczne i zdrowotna' : student ? 'Uczeń / student przed 26. urodzinami — bez ZUS' : !mandate ? 'Dzieło poza własnym pracodawcą — bez ZUS' : social ? 'Zlecenie — składki społeczne i zdrowotna' : 'Zlecenie — tylko składka zdrowotna';
  if (p.tax_residency !== 'PL') result.notes.push('Przyjęto polską rezydencję podatkową — nie została jeszcze potwierdzona w danych osoby.');
  if (mandate && s.insurance === 'auto' && !educated) result.notes.push('Przyjęto obowiązkowe składki społeczne i zdrowotną. Inny tytuł ubezpieczenia wymaga ustalenia zbiegu. KRUS sam w sobie nie zwalnia ze składek zlecenia.');
  if (mandate && s.insurance === 'health_only') result.notes.push('Tylko zdrowotna: wariant zakłada potwierdzony zbieg tytułów zwalniający ze składek społecznych. Sam KRUS nie wystarcza.');
  if (s.small_contract && employment) return stop('Ryczałt dla należności do 200 zł nie dotyczy umowy o pracę.');
  if (s.small_contract && s.basis !== 'fixed') return stop('Dla ryczałtu do 200 zł wybierz kwotę za jedną realizację / wypłatę. Sama stawka godzinowa ani miesięczna nie określa należności z całej umowy.');
  const youthEligible = (employment || mandate) && knownAge && s.payment_date <= birthday && p.youth_opt_out === 'no' && !s.small_contract;
  if (youthEligible && (s.youth_remaining === '' || !Number.isFinite(Number(s.youth_remaining)) || Number(s.youth_remaining) < 0 || Number(s.youth_remaining) > 85528)) return stop('Podaj pozostały limit ulgi dla młodych (0–85 528 zł), po uwzględnieniu wszystkich płatników i wspólnych ulg.');
  const youthRemaining = youthEligible ? Number(s.youth_remaining) : 0;
  if ((employment || mandate) && !youthEligible && !s.small_contract) result.notes.push('PIT liczony bez ulgi dla młodych. Zastosowanie ulgi wymaga daty urodzenia, braku wniosku o niestosowanie oraz pozostałego limitu.');
  const accidentRate = Number(s.accident_rate);
  if (!Number.isFinite(accidentRate) || accidentRate < 0.67 || accidentRate > 3.33) return stop('Podaj stawkę wypadkową firmy w zakresie 0,67–3,33%.');
  if (!['12','32'].includes(s.pit_rate) || !['0','100','150','300'].includes(s.pit_credit) || !['0','250','300'].includes(s.employment_kup) || !['9','19'].includes(s.cit_rate)) return stop('Sprawdź stawki w założeniach kalkulacji.');
  const payroll = (gross: number): NetCostBreakdown => {
    const pension = social ? roundMoney(gross * .0976) : 0;
    const disability = social ? roundMoney(gross * .015) : 0;
    const sickness = social && (employment || s.sickness) ? roundMoney(gross * .0245) : 0;
    const employeeSocial = roundMoney(pension + disability + sickness);
    const youth = Math.min(gross, youthRemaining);
    const taxableGross = roundMoney(gross - youth);
    const taxableSocial = gross ? roundMoney(employeeSocial * taxableGross / gross) : 0;
    const afterSocial = Math.max(0, roundMoney(taxableGross - taxableSocial));
    const kup = s.small_contract ? 0 : employment ? Math.min(afterSocial, Number(s.employment_kup)) : roundMoney(afterSocial * .2);
    const taxBase = Math.round(Math.max(0, afterSocial - kup));
    const pit = s.small_contract ? Math.round(gross * .12) : Math.max(0, Math.round(taxBase * Number(s.pit_rate) / 100 - Number(s.pit_credit)));
    const healthBase = roundMoney(gross - employeeSocial);
    const fullHealth = health ? roundMoney(healthBase * .09) : 0;
    // Art. 83: hypothetical advance under the rules of 31 December 2021, before health deduction.
    const oldKup = employment ? Math.min(healthBase, Number(s.employment_kup)) : roundMoney(healthBase * .2);
    const oldCredit = employment && Number(s.pit_credit) > 0 ? 43.76 : 0;
    const healthCap = Math.max(0, roundMoney(Math.round(Math.max(0, healthBase - oldKup)) * .17 - oldCredit));
    const employeeHealth = !health ? 0 : s.small_contract ? fullHealth : Math.min(fullHealth, healthCap);
    const employerPension = social ? roundMoney(gross * .0976) : 0;
    const employerDisability = social ? roundMoney(gross * .065) : 0;
    const accident = social ? roundMoney(gross * accidentRate / 100) : 0;
    const payLabourFund = s.labour_fund === 'yes' || (s.labour_fund === 'auto' && gross >= statutoryRates['2026'].monthly);
    const labourFund = social && payLabourFund ? roundMoney(gross * .0245) : 0;
    const fgsp = social && s.fgsp ? roundMoney(gross * .001) : 0;
    const employer = roundMoney(employerPension + employerDisability + accident + labourFund + fgsp);
    return { gross, net: roundMoney(gross - employeeSocial - employeeHealth - pit), pit, social: employeeSocial, health: employeeHealth,
      employerPension, employerDisability, accident, labourFund, fgsp, employer, company: roundMoney(gross + employer), youth, healthCapped: employeeHealth < fullHealth };
  };
  // Integer PIT rounding creates small downward jumps in net. Search the neighbourhood in cents.
  let low = 0, high = Math.ceil(target * 4 + 1000);
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2;
    if (payroll(roundMoney(mid)).net < target) low = mid; else high = mid;
  }
  const near = Math.round(high * 100);
  let chosen: NetCostBreakdown | null = null;
  for (let cents = Math.max(0, near - 500); cents <= near + 500; cents++) {
    const candidate = payroll(cents / 100);
    if (candidate.net >= target) { chosen = candidate; break; }
  }
  if (!chosen) return stop('Nie udało się dopasować brutto do podanej kwoty.');
  if (s.small_contract && chosen.gross > 200) return stop('Ryczałt 12% dotyczy należności określonej w całej umowie, nieprzekraczającej 200 zł brutto.');
  if (!context.hypothetical && !employment && s.basis === 'fixed' && !s.small_contract && chosen.gross <= 200) return stop('Wyliczone brutto za całą umowę nie przekracza 200 zł. Sprawdź odpowiedź o ryczałcie w kroku 5.');
  if (!context.hypothetical && mandate && Number(p.questionnaire?.answers.planned_hours)>0 && chosen.gross < roundMoney(Number(p.questionnaire?.answers.planned_hours)*31.40)) return stop('Planowane netto daje brutto poniżej minimum 31,40 zł za godzinę. Zwiększ wynagrodzenie lub popraw liczbę rzeczywistych godzin.');
  result.breakdown = chosen;
  result.citBenefit = roundMoney(chosen.company * Number(s.cit_rate) / 100);
  result.afterCit = roundMoney(chosen.company - result.citBenefit);
  result.dividendProfit = roundMoney(target / ((1 - Number(s.cit_rate) / 100) * .81));
  result.dividendCit = roundMoney(result.dividendProfit * Number(s.cit_rate) / 100);
  result.dividendTax = roundMoney(result.dividendProfit - result.dividendCit - target);
  if (s.small_contract) result.notes.push('Ryczałt zakłada kwotę należności określoną w umowie do 200 zł brutto i brak stosunku pracy z płatnikiem. Nie stosuje KUP, PIT-2 ani ulgi dla młodych.');
  if (social) result.notes.push(s.labour_fund === 'auto' ? 'FP/FS automatycznie: próg 4 806 zł podstawy w pełnym miesiącu. Dostosuj przy innych tytułach, części miesiąca i zwolnieniach z funduszy (m.in. wiek 55/60 lat).' : 'FP/FS według wybranego założenia. Zweryfikuj zwolnienia z FP/FS i FGŚP oraz podstawy u pozostałych płatników.');
  if (chosen.healthCapped) result.notes.push('Zdrowotna ograniczona do hipotetycznej zaliczki według zasad z 2021 r. Założono standardowe oświadczenia do obniżenia tej zaliczki.');
  result.notes.push('Jedna wypłata w miesiącu, bez PPK, absencji, potrąceń, 50% KUP i przekroczenia limitu składek emerytalno-rentowych. Stawka PIT dotyczy całej podstawy; miesiąc przekroczenia progu wymaga osobnego rozliczenia.');
  return result;
}
