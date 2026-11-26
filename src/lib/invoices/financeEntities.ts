/*
 * Działalność a marka. Finanse — faktury, KSeF, wyciągi i uzgodnienie, dokumenty spoza KSeF, koszty i wypłaty, deklaracje,
 * umowy stałe i personelu, Saldeo, ustawienia faktur i poziomy dostępu do finansów — dotyczą działalności: podmiotu z NIP
 * (np. Mavinci, NASTROJOWO). Marka bez NIP (np. Event Rulers) realizuje wydarzenia, ma księgę znaku i cennik, ale nie ma
 * własnych finansów, więc listy działalności w finansach jej nie pokazują. Tak samo serwer dla Maca (`financeCompanies`,
 * `entityCompanies`) i baza (`purchases_access`, `purchase_can_record`, `personnel_picker_companies`).
 */

export type FinanceEntityLike = { nip?: string | null };

/** Działalność (ma NIP) — a nie marka bez NIP. */
export function isFinanceEntity(company: FinanceEntityLike | null | undefined): boolean {
  return String(company?.nip ?? '').trim() !== '';
}

/**
 * Działalności z listy firm. `keepId` — firma już zapisana w dokumencie (np. starsza faktura), żeby formularz edycji
 * nie zgubił jej z listy.
 */
export function financeEntities<T extends FinanceEntityLike & { id: string }>(companies: T[], keepId?: string | null): T[] {
  return companies.filter((company) => isFinanceEntity(company) || (Boolean(keepId) && company.id === keepId));
}

/** NIP z samymi cyframi (bez prefiksu „PL”, myślników i spacji) — porównanie NIP-u z dokumentu z NIP-em działalności. */
export function nipDigits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

/** Działalność, na którą wystawiono dokument (NIP nabywcy z odczytu), albo `undefined`. */
export function financeEntityByNip<T extends FinanceEntityLike>(companies: T[], nip: string | null | undefined): T | undefined {
  const digits = nipDigits(nip);
  if (digits.length < 10) return undefined;
  return companies.find((company) => {
    const own = nipDigits(company.nip);
    return own.length >= 10 && (digits === own || digits.endsWith(own));
  });
}
