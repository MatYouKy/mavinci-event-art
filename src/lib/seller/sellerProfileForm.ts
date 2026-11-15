/**
 * Warunki zapisu sprzedawcy — jedno źródło dla formularza w CRM (`CrmSellerProfileSettings.tsx`) i kreatora „Nowy sprzedawca”
 * na Macu (`src/lib/native/sellerCreate.ts`). Lista braków w kolejności dotychczasowych komunikatów zapisu; `step` mówi,
 * w którym kroku kreatora jest brak, `section` — w której sekcji formularza CRM. Bez zależności od Reacta i Supabase.
 */

export type SellerProfileStep = 'person' | 'hotel' | 'terms' | 'access';
export type SellerProfileSection = 'organization' | 'pricing' | 'access';
export type SellerProfileProblem = { step: SellerProfileStep; section: SellerProfileSection; text: string };

export type SellerProfileFormTerm = {
  my_company_id: string;
  is_active: boolean;
  commission_enabled: boolean;
  default_commission_rate: number;
  dividend_tax_rate: number;
};

export type SellerProfileFormInput = {
  personSource: 'contact' | 'employee';
  personId: string;
  /** E-mail osoby z kartoteki kontaktów (dla zaproszenia do portalu). */
  personEmail: string | null;
  partnerType: string;
  organizationId: string;
  /** Wybrana organizacja (rodzaj działalności i powiązana lokalizacja z salami). */
  organization: { business_type: string | null; location_id: string | null } | null;
  portalEnabled: boolean;
  status: string;
  terms: SellerProfileFormTerm[];
  defaultCompanyId: string;
};

const sectionOf: Record<SellerProfileStep, SellerProfileSection> = { person: 'organization', hotel: 'organization', terms: 'pricing', access: 'access' };

/** Domyślny cennik nowych ofert: przy jednej aktywnej marce — ta marka, przy kilku — wybrana. */
export function sellerEffectiveDefaultCompany(terms: SellerProfileFormTerm[], defaultCompanyId: string) {
  const active = terms.filter((term) => term.is_active);
  return active.length === 1 ? active[0].my_company_id : defaultCompanyId;
}

export function sellerProfileProblems(input: SellerProfileFormInput): SellerProfileProblem[] {
  const list: SellerProfileProblem[] = [];
  const add = (step: SellerProfileStep, text: string) => list.push({ step, section: sectionOf[step], text });
  const activeTerms = input.terms.filter((term) => term.is_active);
  const effectiveDefault = sellerEffectiveDefaultCompany(input.terms, input.defaultCompanyId);
  if (!input.personId) add('person', 'Wybierz osobę z bazy pracowników lub kontaktów');
  if (input.partnerType === 'hotel_employee' && !input.organizationId) add('hotel', 'Pracownik hotelu musi mieć przypisany hotel');
  else if (input.portalEnabled && !input.organizationId) add('hotel', 'Wybierz organizację, w imieniu której sprzedawca będzie tworzył oferty');
  if (input.organizationId && (input.partnerType === 'hotel_employee' || input.organization?.business_type === 'hotel') && !input.organization?.location_id) {
    add('hotel', 'Powiąż hotel z lokalizacją w kartotece organizacji. Sale i teren zewnętrzny dodaj w tej lokalizacji.');
  }
  if (input.portalEnabled && input.personSource !== 'contact') add('access', 'Konto portalu hotelowego musi być powiązane z osobą z kartoteki kontaktów');
  else if (input.portalEnabled && input.personId && !input.personEmail) add('access', 'Aby wysłać dane logowania, uzupełnij adres e-mail w kartotece kontaktu');
  if (input.portalEnabled && input.status !== 'active') add('access', 'Dostęp do portalu można nadać tylko aktywnemu sprzedawcy');
  if (!activeTerms.length) add('terms', 'Włącz co najmniej jedną markę dla sprzedawcy');
  else if (input.portalEnabled && !activeTerms.some((term) => term.my_company_id === effectiveDefault)) add('terms', 'Wskaż domyślny cennik nowych ofert sprzedawcy');
  if (input.terms.some((term) => term.is_active && term.commission_enabled && !(Number(term.default_commission_rate) > 0))) {
    add('terms', 'Podaj % od zysku większy od 0 albo wyłącz rozliczenie prowizyjne dla marki.');
  }
  if (input.terms.some((term) => !Number.isFinite(Number(term.default_commission_rate)) || Number(term.default_commission_rate) < 0
    || !Number.isFinite(Number(term.dividend_tax_rate)) || Number(term.dividend_tax_rate) < 0 || Number(term.dividend_tax_rate) >= 100)) {
    add('terms', 'Podaj nieujemną prowizję oraz podatek od 0 do poniżej 100%.');
  }
  return list;
}

export const SELLER_PARTNER_TYPE_LABELS: Record<string, string> = {
  internal_employee: 'Sprzedawca Mavinci',
  hotel_employee: 'Pracownik hotelu',
  agency_employee: 'Pracownik agencji',
  independent_referrer: 'Niezależny polecający',
};

export const SELLER_PROFILE_STATUS_LABELS: Record<string, string> = {
  onboarding: 'Do uzgodnienia',
  active: 'Aktywny',
  inactive: 'Nieaktywny',
};
