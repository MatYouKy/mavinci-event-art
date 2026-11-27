/**
 * Uzgodnienie wyciągów — „dlaczego płatność nie ma dokumentu” (docs/bank-reconciliation.md, sekcja 18).
 *
 * Fakty liczy baza (`get_bank_unmatched_reasons`, migracja 20261202190000): opis braku dokumentu wpisany przez użytkownika,
 * lista „Dokumenty do dosłania”, dokumenty tego kontrahenta w systemie, dokument na tę kwotę od innego kontrahenta, dokument
 * spoza KSeF pomijany przez uzgodnienie. Tu — zdania dla ludzi, wspólne dla:
 *   - załącznika „Dopasowanych faktur (PDF)” (`drive.server.ts` → `matchedDocumentsPdf.server.ts`) — kontekst `pdf`,
 *   - Maca (`financeBank.ts` → `why`, `pendingNote`) i CRM (`BankReconciliationPanel`) — kontekst `app` (opis i propozycję
 *     ekran pokazuje osobno),
 *   - „Braków dokumentów (CSV)” w CRM i na Macu (`unmatchedHint`).
 * Bez migracji (baza bez funkcji) — powód z propozycji i stanu płatności, bez faktów o dokumentach.
 */

import { explanationLabel, proposalRuleLabel, RECONCILIATION_STATUS_META, type ReconciliationStatus } from './bankReconciliation';

export type UnmatchedDocumentFact = {
  source?: string | null;
  id?: string | null;
  number?: string | null;
  party?: string | null;
  currency?: string | null;
  due?: number | string | null;
  open?: number | string | null;
  issue_date?: string | null;
  /** Dokument w całości rozliczony przelewami z wyciągu (innymi niż ta płatność). */
  settled?: boolean | null;
  /** Oznaczony ręcznie jako opłacony, bez potwierdzenia w wyciągu. */
  manual?: boolean | null;
};

/** Wiersz `get_bank_unmatched_reasons`. */
export type UnmatchedReasonFacts = {
  id: string;
  party?: string | null;
  token?: string | null;
  pending_note?: { category?: string | null; subtype?: string | null; note?: string | null } | null;
  followup?: boolean | null;
  party_documents?: number | string | null;
  party_open?: number | string | null;
  party_name?: string | null;
  party_exact?: UnmatchedDocumentFact | null;
  party_nearest?: UnmatchedDocumentFact | null;
  same_amount?: UnmatchedDocumentFact | null;
  same_amount_count?: number | string | null;
  needs_review?: UnmatchedDocumentFact | null;
};

/** Płatność z uzgodnienia miesiąca (pola wspólne dla `ReconciliationTransaction` i wiersza bazy). */
export type UnmatchedTransaction = {
  status: string;
  direction: string;
  amount: number | string;
  allocated?: number | string | null;
  remaining?: number | string | null;
  currency?: string | null;
  proposal?: { kind?: string | null; rule?: string | null; reason?: string | null } | null;
};

/** Opis braku dokumentu (wyjaśnienie „do kontroli”): rodzaj, `subtype` do edycji i treść. */
export type BankPendingNote = { label: string; subtype: string; note: string };

/** Domyślny opis „Brak faktury od dostawcy” („Opisz brak dokumentu”) — CRM (`BankTransactionAccountingModal`) i Mac (`financeBank.ts`). */
export const SUPPLIER_INVOICE_MISSING_NOTE = 'Faktury jeszcze nie ma w systemie — do pozyskania od dostawcy (pobranie z konta u dostawcy albo prośba o wystawienie na właściwą działalność).';

/** Komunikat po zapisie opisu braku dokumentu (wyjaśnienie, które zostaje „do kontroli”). */
export const PENDING_NOTE_SAVED_MESSAGE = 'Opis zapisany — płatność dalej czeka na dokument, a opis trafi do załącznika „Dopasowane faktury (PDF)”.';

/** Stany, w których płatności brakuje dokumentu (jak „Do zrobienia” w uzgodnieniu). */
export const UNMATCHED_STATUSES = ['proposal', 'choice', 'partial', 'missing'];

const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value: unknown, currency?: string | null) => {
  const code = String(currency || 'PLN').toUpperCase();
  return `${number(value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code === 'PLN' ? 'zł' : code}`;
};

const plDate = (value?: string | null) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10).split('-').reverse().join('.') : '');

/** Tekst z wyciągu i nazwy firm: bez „˙”, pojedyncze spacje, krótsze formy prawne. */
export function unmatchedPartyName(value?: string | null): string {
  return String(value || '')
    .replace(/[˙]+/g, ' ')
    .replace(/sp[óo][łl]ka\s+z\s+ograniczon[ąa]\s+odpowiedzialno[śs]ci[ąa]/gi, 'sp. z o.o.')
    .replace(/sp[óo][łl]ka\s+komandytowo[\s-]+akcyjna/gi, 'S.K.A.')
    .replace(/sp[óo][łl]ka\s+komandytowa/gi, 'sp.k.')
    .replace(/sp[óo][łl]ka\s+akcyjna/gi, 'S.A.')
    .replace(/sp[óo][łl]ka\s+jawna/gi, 'sp.j.')
    .replace(/\s+/g, ' ')
    .trim();
}

const SOURCE_WORDS: Record<string, string> = {
  ksef: 'faktura KSeF',
  invoice: 'faktura CRM',
  external: 'dokument spoza KSeF',
};

const capitalize = (value: string) => (value ? value[0].toUpperCase() + value.slice(1) : value);

/** „faktura KSeF FV/1/10”, „dokument spoza KSeF bez numeru”. */
function documentLabel(doc: UnmatchedDocumentFact) {
  return `${SOURCE_WORDS[String(doc.source || '')] || 'dokument'} ${doc.number?.trim() || 'bez numeru'}`;
}

/** Rodzaj gramatyczny: faktura (KSeF, CRM) — żeński, dokument (spoza KSeF) — męski. */
const pick = (doc: UnmatchedDocumentFact, feminine: string, masculine: string) =>
  (doc.source === 'ksef' || doc.source === 'invoice' ? feminine : masculine);

const plural = (n: number, one: string, few: string, many: string) => {
  if (n === 1) return one;
  const lastTwo = n % 100;
  const last = n % 10;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
};

/** Mapa faktów po identyfikatorze płatności (wynik RPC; `null` — baza bez migracji). */
export function unmatchedFactsMap(value: unknown): Map<string, UnmatchedReasonFacts> {
  const map = new Map<string, UnmatchedReasonFacts>();
  if (!Array.isArray(value)) return map;
  for (const row of value) {
    if (row && typeof row === 'object' && typeof (row as UnmatchedReasonFacts).id === 'string') {
      map.set((row as UnmatchedReasonFacts).id, row as UnmatchedReasonFacts);
    }
  }
  return map;
}

/** Opis braku dokumentu wpisany przez użytkownika („Opisz brak dokumentu”, wyjaśnienie „do kontroli”). */
export function pendingNoteOf(facts?: UnmatchedReasonFacts | null): BankPendingNote | null {
  const note = facts?.pending_note;
  const text = String(note?.note || '').trim();
  const subtype = String(note?.subtype || '').trim();
  if (!note || !text || !subtype) return null;
  return { label: explanationLabel(String(note.category || 'other'), subtype), subtype, note: text };
}

/**
 * Powody braku dokumentu, najważniejszy pierwszy. `pdf` — pełny opis (opis użytkownika, propozycja, część rozliczona);
 * `app` — tylko to, czego ekran uzgodnienia nie pokazuje osobno (lista do dosłania i fakty o dokumentach).
 */
export function unmatchedReasons(tx: UnmatchedTransaction, facts: UnmatchedReasonFacts | null | undefined, context: 'pdf' | 'app'): string[] {
  if (!UNMATCHED_STATUSES.includes(tx.status)) return [];
  const lines: string[] = [];
  const currency = tx.currency || 'PLN';
  const credit = tx.direction === 'credit';
  const amount = number(tx.amount);
  const remaining = tx.remaining === null || tx.remaining === undefined ? amount : number(tx.remaining);
  const allocated = number(tx.allocated);
  const proposal = tx.proposal && tx.proposal.kind ? tx.proposal : null;

  if (context === 'pdf') {
    const note = pendingNoteOf(facts);
    if (note) lines.push(`${note.label} — opis: „${note.note}”`);
  }
  if (facts?.followup) lines.push('Na liście „Dokumenty do dosłania” — brak dokumentu zgłoszony do późniejszego dosłania.');
  if (context === 'pdf') {
    if (proposal?.kind === 'allocate') {
      lines.push(`Czeka na zatwierdzenie propozycji „${proposalRuleLabel(String(proposal.rule || ''))}”: ${String(proposal.reason || '').trim()}`);
    } else if (proposal?.kind === 'choose') {
      lines.push(`Kilka pasujących dokumentów — trzeba wybrać właściwy: ${String(proposal.reason || '').trim()}`);
    } else if (proposal?.kind === 'hint' && proposal.reason) {
      lines.push(`Wskazówka uzgodnienia: ${String(proposal.reason).trim()}`);
    }
    if (tx.status === 'partial' && allocated > 0.009) {
      lines.push(`Przypisano dokumenty na ${money(allocated, currency)} z ${money(amount, currency)} — brakuje dokumentu na ${money(remaining, currency)}.`);
    }
  }
  // Fakty o dokumentach — tylko gdy uzgodnienie nie ma propozycji do zatwierdzenia ani wyboru.
  if (tx.status !== 'missing' && tx.status !== 'partial') return lines;
  if (!facts) {
    if (context === 'pdf' && !proposal) lines.push('Uzgodnienie nie znalazło dokumentu na tę kwotę od tego kontrahenta.');
    return lines;
  }

  const bankName = unmatchedPartyName(facts.party);
  const docName = unmatchedPartyName(facts.party_name);
  const name = docName || bankName;
  const total = number(facts.party_documents);
  const open = number(facts.party_open);

  const review = facts.needs_review;
  if (review) {
    lines.push(`${capitalize(documentLabel(review))} od ${unmatchedPartyName(review.party) || name} (${money(review.due, review.currency)}) ma stan „częściowo opłacony” bez kwoty zapłaty — uzgodnienie go pomija. Uzupełnij kwotę zapłaconą w dokumentach spoza KSeF.`);
  }

  const exact = facts.party_exact;
  if (exact) {
    const label = documentLabel(exact);
    const party = unmatchedPartyName(exact.party) || name;
    if (exact.settled) {
      lines.push(`${capitalize(label)} od ${party} na ${money(exact.due, exact.currency)} jest już w całości ${pick(exact, 'rozliczona', 'rozliczony')} innym przelewem z wyciągu — sprawdź, czy to nie druga płatność za ten sam dokument; jeśli to inny zakup, jego dokumentu jeszcze nie ma w systemie.`);
    } else if (exact.manual) {
      lines.push(`${capitalize(label)} od ${party} na tę kwotę jest ${pick(exact, 'oznaczona', 'oznaczony')} ręcznie jako ${pick(exact, 'opłacona', 'opłacony')} — jeśli to ta płatność, przypisz ${pick(exact, 'ją', 'go')} („Wybierz dokument”), a wyciąg potwierdzi oznaczenie.`);
    } else {
      const issued = plDate(exact.issue_date);
      lines.push(`Jest ${pick(exact, 'otwarta', 'otwarty')} ${label} od ${party} na tę kwotę${issued ? ` (z ${issued})` : ''}, ale uzgodnienie ${pick(exact, 'jej', 'go')} nie przypisało — np. propozycja została odrzucona albo data dokumentu jest daleko od płatności. Jeśli to ta płatność, przypisz ${pick(exact, 'ją', 'go')} („Wybierz dokument”).`);
    }
  } else if (open > 0) {
    const nearest = facts.party_nearest;
    const from = name || 'tego kontrahenta';
    if (nearest) {
      const nearestOpen = nearest.open ?? nearest.due;
      const found = `${documentLabel(nearest)} (do zapłaty ${money(nearestOpen, nearest.currency)})`;
      const partialHint = String(nearest.currency || 'PLN').toUpperCase() === String(currency).toUpperCase() && number(nearestOpen) > remaining + 0.01
        ? ' Jeśli to część płatności (rata, zaliczka), przypisz ją do tego dokumentu jako płatność częściową.'
        : '';
      lines.push(open === 1
        ? `Od ${from} jest jeden otwarty dokument, ale na inną kwotę niż ${money(remaining, currency)}: ${found}.${partialHint}`
        : `Od ${from} są otwarte dokumenty (${open}), ale żaden na ${money(remaining, currency)} — najbliższy kwotą: ${found}.${partialHint}`);
    } else {
      lines.push(`Od ${from} ${open === 1 ? 'jest jeden otwarty dokument, ale na inną kwotę' : `są otwarte dokumenty (${open}), ale żaden na tę kwotę`}.`);
    }
  } else if (total > 0) {
    lines.push(total === 1
      ? `Jedyny dokument od ${name || 'tego kontrahenta'} w systemie jest już rozliczony — dokumentu za tę płatność jeszcze nie ma.`
      : `Wszystkie dokumenty od ${name || 'tego kontrahenta'} w systemie (${total}) są już rozliczone — dokumentu za tę płatność jeszcze nie ma.`);
  } else if (name) {
    lines.push(credit
      ? `W systemie nie ma faktury sprzedaży dla „${name}”.`
      : `W systemie nie ma żadnego dokumentu od „${name}” — ani w KSeF, ani w dokumentach spoza KSeF.`);
  } else if (!review) {
    lines.push('Nie rozpoznano kontrahenta w opisie płatności — w systemie nie ma dokumentu, który by do niej pasował.');
  }
  if (!credit && !exact && open === 0 && !review) {
    lines.push('Jeśli sprzedawca nie wysyła faktur do KSeF (np. zagraniczny serwis), pobierz fakturę z konta u sprzedawcy i dodaj ją jako dokument spoza KSeF; faktura krajowa pojawi się po synchronizacji z KSeF.');
  }

  const other = facts.same_amount;
  if (other) {
    const count = number(facts.same_amount_count);
    const more = count > 1 ? ` (i ${count - 1} ${plural(count - 1, 'inny', 'inne', 'innych')})` : '';
    lines.push(`Na tę kwotę jest ${pick(other, 'otwarta', 'otwarty')} ${documentLabel(other)} od innego kontrahenta — ${unmatchedPartyName(other.party) || 'bez nazwy'}${more}; sprawdź, czy nie dotyczy tej płatności.`);
  }
  return lines;
}

/** Stan w załączniku PDF: „Brak dokumentu · opisana · do dosłania”. */
export function unmatchedStateLabel(tx: UnmatchedTransaction, facts?: UnmatchedReasonFacts | null): string {
  const meta = RECONCILIATION_STATUS_META[tx.status as ReconciliationStatus];
  const parts = [meta ? meta.label : 'Brak dokumentu'];
  if (pendingNoteOf(facts)) parts.push('opisana');
  if (facts?.followup) parts.push('do dosłania');
  return parts.join(' · ');
}

/** „Wskazówka” w „Brakach dokumentów (CSV)”: opis użytkownika, propozycja (albo wskazówka) i powody z faktów. */
export function unmatchedHint(tx: UnmatchedTransaction, facts?: UnmatchedReasonFacts | null): string {
  const note = pendingNoteOf(facts);
  return [
    note ? `${note.label}: ${note.note}` : '',
    String(tx.proposal?.reason || '').trim(),
    ...unmatchedReasons(tx, facts, 'app'),
  ].filter(Boolean).join(' ');
}
