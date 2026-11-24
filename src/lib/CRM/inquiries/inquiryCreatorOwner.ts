/*
 * Opiekun zapytania dodanego ręcznie — osoba, która je dodaje (baza: `prepare_inquiry_sales_automation()`, migracja
 * `20261130110000_inquiry_creator_owner`). Dotyczy każdego zapytania dodanego przez pracownika: „Nowe zapytanie” w CRM, na Macu
 * i w telefonie, z wiadomości, przetargu, karty klienta i kalendarza. Opiekunem zostaje ten, kto może prowadzić zapytania
 * (administrator albo uprawnienie z listy niżej — jak przejmowanie ze wspólnej puli); bez takiego uprawnienia zapytanie trafia
 * do wspólnej kolejki „Nieprzypisane”. Wybrany w oknie inny opiekun (przydział) — bez zmian. Zapytania z formularzy WWW,
 * webhooków i poczty (AI) jak dotąd. Telefon: `canOwnNewInquiry` w `mobile/src/lib/permissions.ts`; Mac: `NewInquiryModel.creatorOwns`.
 */

export const INQUIRY_CREATOR_OWNER_SCOPES = ['admin', 'inquiries_assign', 'inquiries_manage', 'inquiries_manage_own', 'inquiries_manage_all'] as const;

type InquiryCreator = { role?: string | null; access_level?: string | null; permissions?: string[] | null } | null | undefined;

/** Czy osoba dodająca zapytanie zostanie od razu jego opiekunem (ta sama reguła co w bazie). */
export function becomesInquiryOwner(employee: InquiryCreator): boolean {
  if (!employee) return false;
  return employee.role === 'admin' || employee.access_level === 'admin'
    || INQUIRY_CREATOR_OWNER_SCOPES.some((scope) => employee.permissions?.includes(scope) === true);
}

/** Opis w oknie „Nowe zapytanie”. */
export const inquiryCreatorOwnerNote = (owns: boolean) => (owns
  ? 'Opiekunem zapytania zostaniesz Ty — znajdziesz je w „Moje”. Przekazać je możesz w karcie zapytania.'
  : 'Zapytanie trafi do wspólnej kolejki „Nieprzypisane” — opiekuna wybierze osoba prowadząca zapytania.');

/** Komunikat po zapisie (CRM, jak na Macu): opiekun z bazy — Ty, przydział automatyczny albo wspólna kolejka. */
export function inquiryCreatedMessage(owner: { id: string | null; name?: string | null } | null | undefined, meId: string | null | undefined) {
  if (!owner?.id) return 'Zapytanie zostało dodane do wspólnej kolejki';
  if (owner.id === meId) return 'Zapytanie zostało dodane i przypisane do Ciebie';
  return `Zapytanie zostało dodane — przydział automatyczny: ${owner.name?.trim() || 'wybrana osoba'}`;
}
