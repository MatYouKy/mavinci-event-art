import { counterpartyNameWords, formatAccount, normalizeBankText } from './bankReconciliation';

/**
 * Uzgodnienie wyciągów — „co do czego pasuje” w propozycji systemu (CRM `BankReconciliationPanel`, Mac `ReconciliationInspector`
 * przez `/bridge/native/v1/finance`): płatność z wyciągu obok dokumentu, wiersz po wierszu — kwota, kontrahent, numer dokumentu
 * w tytule, data, oznaczenie ręczne — z zaznaczonym fragmentem, który się zgadza, i oceną („zgodna”, „do sprawdzenia”, „brak”).
 * Liczone z danych propozycji (to, co baza porównała w `reconcile_bank_month`: kwota otwarta, NIP / rachunek / nazwa z dowodu
 * `evidence`, okno dat jak w `private.bank_amount_only_plausible`) — bez zapytań do bazy, ten sam wynik w CRM i na Macu.
 */

export type ComparisonState = 'match' | 'partial' | 'mismatch' | 'info';
export type ComparisonSegment = { text: string; hit: boolean };
export type ComparisonRow = {
  key: 'amount' | 'party' | 'number' | 'date' | 'manual';
  label: string;
  /** Z wyciągu — fragment z zaznaczeniem tego, co się zgadza. */
  payment: ComparisonSegment[];
  /** Z dokumentu. */
  document: ComparisonSegment[];
  state: ComparisonState;
  verdict: string;
};

export type ProposalComparisonInput = {
  rule: string;
  /** Jeden przelew na kilka dokumentów (propozycja „allocate” z kilkoma dokumentami): kwota dokumentu to część przelewu. */
  share?: boolean;
  tx: {
    date: string;
    amount: number;
    remaining: number;
    currency: string;
    counterparty?: string | null;
    counterpartyAccount?: string | null;
    title?: string | null;
    description?: string | null;
  };
  doc: {
    source: string;
    number?: string | null;
    party?: string | null;
    amount: number;
    due?: number | null;
    open?: number | null;
    manual?: boolean | null;
    issueDate?: string | null;
    dueDate?: string | null;
    evidence?: string | null;
    documentAmount?: number | null;
    documentCurrency?: string | null;
    rate?: number | null;
    manualPaid?: number | null;
    manualDate?: string | null;
  };
};

/** Porównanie dotyczy faktur i dokumentów (KSeF, CRM, spoza KSeF) — deklaracje, wypłaty, umowy i zwroty mają własne opisy. */
export const COMPARABLE_SOURCES = new Set(['ksef', 'invoice', 'external']);

const money = (value: number, currency = 'PLN') =>
  `${Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'PLN' ? 'zł' : currency}`;
const plDate = (value?: string | null) => {
  if (!value) return '';
  const [y, m, d] = value.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : value.slice(0, 10);
};
/** Dni od `from` do `to` (daty RRRR-MM-DD, bez strefy czasowej). */
const daysBetween = (from: string, to: string) => {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
};
const isDate = (value?: string | null): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value);
const plural = (n: number, one: string, few: string, many: string) => {
  const abs = Math.abs(n);
  if (abs === 1) return one;
  const last = abs % 10;
  const lastTwo = abs % 100;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
};
const days = (n: number) => `${Math.abs(n)} ${plural(n, 'dzień', 'dni', 'dni')}`;

// MARK: Zaznaczanie fragmentów

type Range = [number, number];

/** Znak tekstu w zapisie do porównań (jak `normalizeBankText`): wielkie litery bez polskich znaków, separator — spacja. */
function normalizeChar(ch: string): string {
  const upper = ch.toUpperCase().replace(/Ł/g, 'L').normalize('NFD').replace(/[̀-ͯ]/g, '');
  return upper.replace(/[^A-Z0-9]/g, ' ') || ' ';
}

/** Tekst znormalizowany ze wskazaniem, z którego znaku oryginału pochodzi każdy znak (`alnum` — tylko litery i cyfry). */
function normalizedMap(raw: string, alnum: boolean, digits = false) {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    for (const ch of normalizeChar(raw[i])) {
      if (digits && !/[0-9]/.test(ch)) continue;
      if (alnum && ch === ' ') continue;
      text += ch;
      map.push(i);
    }
  }
  return { text, map };
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Miejsca w tekście, gdzie występuje `needle`: `words` — całe słowa po normalizacji (separatory dowolne), `compact` — bez
 * separatorów (np. numer dokumentu zapisany bez ukośników), `digits` — same cyfry (NIP zapisany z myślnikami).
 */
export function findRanges(raw: string, needle: string, mode: 'words' | 'compact' | 'digits'): Range[] {
  if (!raw || !needle) return [];
  const ranges: Range[] = [];
  if (mode === 'words') {
    const tokens = normalizeBankText(needle).split(' ').filter(Boolean);
    if (!tokens.length) return [];
    const { text, map } = normalizedMap(raw, false);
    const pattern = new RegExp(`(^|[^A-Z0-9])(${tokens.map(escape).join(' +')})(?=[^A-Z0-9]|$)`, 'g');
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      const start = m.index + m[1].length;
      const end = start + m[2].length - 1;
      ranges.push([map[start], map[end] + 1]);
      pattern.lastIndex = start + Math.max(m[2].length, 1);
    }
    return ranges;
  }
  const target = mode === 'digits' ? needle.replace(/\D/g, '') : normalizeBankText(needle).replace(/ /g, '');
  if (target.length < (mode === 'digits' ? 6 : 5)) return [];
  const { text, map } = normalizedMap(raw, true, mode === 'digits');
  for (let index = text.indexOf(target); index >= 0; index = text.indexOf(target, index + target.length)) {
    ranges.push([map[index], map[index + target.length - 1] + 1]);
  }
  return ranges;
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else out.push([range[0], range[1]]);
  }
  return out;
}

/** Tekst podzielony na fragmenty zwykłe i zaznaczone; długi tekst — wycinek wokół pierwszego zaznaczenia. */
export function segmentsOf(raw: string, ranges: Range[], limit = 110): ComparisonSegment[] {
  const text = raw;
  const merged = mergeRanges(ranges.filter(([a, b]) => b > a && a >= 0 && b <= text.length));
  let from = 0;
  let to = text.length;
  if (text.length > limit) {
    const first = merged[0];
    if (first) {
      const room = Math.max(limit - (first[1] - first[0]), 20);
      from = Math.max(0, first[0] - Math.floor(room / 2));
      to = Math.min(text.length, from + Math.max(limit, first[1] - from + 10));
    } else {
      to = limit;
    }
  }
  const segments: ComparisonSegment[] = [];
  const push = (value: string, hit: boolean) => {
    if (!value) return;
    const last = segments[segments.length - 1];
    if (last && last.hit === hit) last.text += value;
    else segments.push({ text: value, hit });
  };
  if (from > 0) push('…', false);
  let cursor = from;
  for (const [a, b] of merged) {
    if (b <= from || a >= to) continue;
    const start = Math.max(a, from);
    const end = Math.min(b, to);
    push(text.slice(cursor, start), false);
    push(text.slice(start, end), true);
    cursor = end;
  }
  push(text.slice(cursor, to), false);
  if (to < text.length) push('…', false);
  return segments;
}

const plain = (text: string): ComparisonSegment[] => [{ text, hit: false }];
const highlighted = (text: string, needles: string[], mode: 'words' | 'compact' | 'digits' = 'words') =>
  segmentsOf(text, needles.flatMap((needle) => findRanges(text, needle, mode)));

// MARK: Dowód z bazy

type Evidence = { kind: 'nip'; nip: string } | { kind: 'account' } | { kind: 'name'; token: string } | null;

/** Dowód kontrahenta zapisany przez bazę w propozycji (`evidence`): NIP w treści, ten sam rachunek albo słowo z nazwy. */
export function parseEvidence(evidence?: string | null): Evidence {
  const value = String(evidence || '');
  const nip = value.match(/NIP\s+(\d{10})/);
  if (nip) return { kind: 'nip', nip: nip[1] };
  if (/rachunek/i.test(value)) return { kind: 'account' };
  const token = value.match(/„([^”]+)”/);
  if (token) return { kind: 'name', token: token[1] };
  return null;
}

const CARD = /U[ZŻ]YCIU\s+KARTY|P[ŁL]ATNO[SŚ][CĆ]\s+KART[AĄ]|TRANSAKCJA\s+KART/i;

// MARK: Porównanie

/** Wiersze porównania płatności z dokumentem propozycji (pusta lista — rodzaj dokumentu bez porównania). */
export function proposalComparison({ rule, share = false, tx, doc }: ProposalComparisonInput): ComparisonRow[] {
  if (!COMPARABLE_SOURCES.has(doc.source)) return [];
  const currency = tx.currency || 'PLN';
  const counterparty = (tx.counterparty || '').trim();
  const title = (tx.title || '').trim();
  const description = (tx.description || '').trim();
  const fields = [counterparty, title, description].filter(Boolean);
  const card = CARD.test(`${title} ${description}`);
  const rows: ComparisonRow[] = [];

  // Kwota
  {
    // Przelew na kilka dokumentów — porównanie części przypadającej na ten dokument.
    const paid = share ? doc.amount : tx.remaining;
    const payment = share
      ? `${money(doc.amount, currency)} z przelewu ${money(tx.remaining, currency)}`
      : money(tx.remaining, currency) + (tx.remaining < tx.amount - 0.009 ? ` (pozostało z ${money(tx.amount, currency)})` : '');
    const foreign = doc.documentCurrency && doc.documentCurrency !== currency && Number(doc.documentAmount) > 0;
    if (foreign) {
      rows.push({
        key: 'amount', label: 'Kwota', payment: plain(payment),
        document: plain(`${money(Number(doc.documentAmount), String(doc.documentCurrency))}${doc.rate ? ` × kurs ${String(doc.rate).replace('.', ',')}` : ''} = ${money(doc.amount, currency)}`),
        state: Math.abs(paid - doc.amount) <= 0.01 ? 'match' : 'partial',
        verdict: 'dokument w walucie — porównanie po przeliczeniu kursem; sprawdź kurs',
      });
    } else {
      const open = doc.open ?? null;
      const due = doc.due ?? null;
      const target = doc.manual ? Number(doc.manualPaid ?? due ?? doc.amount) : Number(open ?? due ?? doc.amount);
      const documentText = doc.manual
        ? `oznaczona ręcznie jako opłacona: ${money(target, currency)}`
        : open !== null && due !== null && open < due - 0.009
          ? `pozostało do zapłaty ${money(open, currency)} z ${money(due, currency)}`
          : `do zapłaty ${money(target, currency)}`;
      const diff = Math.round((paid - target) * 100) / 100;
      rows.push({
        key: 'amount', label: 'Kwota', payment: plain(payment), document: plain(documentText),
        state: Math.abs(diff) <= 0.01 ? 'match' : 'partial',
        verdict: Math.abs(diff) <= 0.01 ? (share ? 'część przelewu zgodna co do grosza z kwotą dokumentu' : 'zgodna co do grosza')
          : diff < 0 ? `płatność częściowa — brakuje ${money(-diff, currency)}` : `${share ? 'część przelewu większa' : 'przelew większy'} o ${money(diff, currency)}`,
      });
    }
  }

  // Kontrahent
  {
    const party = (doc.party || '').trim();
    const evidence = parseEvidence(doc.evidence);
    if (evidence?.kind === 'nip') {
      const field = fields.find((value) => findRanges(value, evidence.nip, 'digits').length) || title || counterparty;
      rows.push({
        key: 'party', label: 'Kontrahent',
        payment: field ? highlighted(field, [evidence.nip], 'digits') : plain('—'),
        document: [...plain(party ? `${party} · NIP ` : 'NIP '), { text: evidence.nip, hit: true }],
        state: 'match', verdict: 'NIP z dokumentu jest w treści przelewu',
      });
    } else if (evidence?.kind === 'account') {
      rows.push({
        key: 'party', label: 'Kontrahent',
        payment: tx.counterpartyAccount ? [{ text: formatAccount(tx.counterpartyAccount), hit: true }] : plain(counterparty || '—'),
        document: plain(party || '—'),
        state: 'match', verdict: 'ten sam rachunek kontrahenta co we wcześniejszych płatnościach dla tego kontrahenta',
      });
    } else {
      const needles = evidence?.kind === 'name' ? [evidence.token] : counterpartyNameWords(party);
      const found = needles.length > 0 && needles.every((needle) => fields.some((value) => findRanges(value, needle, 'words').length));
      const field = found ? fields.find((value) => needles.some((needle) => findRanges(value, needle, 'words').length)) : undefined;
      rows.push({
        key: 'party', label: 'Kontrahent',
        payment: field ? highlighted(field, needles) : segmentsOf(counterparty || title || '—', []),
        document: party ? highlighted(party, found ? needles : []) : plain('—'),
        state: found ? 'match' : rule === 'tylko_kwota' ? 'mismatch' : 'info',
        verdict: found
          ? needles.length === 1 ? `słowo „${normalizeBankText(needles[0])}” z nazwy kontrahenta jest w przelewie` : `nazwa kontrahenta („${needles.map(normalizeBankText).join(' ')}”) jest w przelewie`
          : rule === 'tylko_kwota' ? 'kontrahenta nie potwierdzono — sprawdź, czy to ta sama firma lub sklep' : 'nazwy kontrahenta nie znaleziono w przelewie',
      });
    }
  }

  // Numer dokumentu w tytule
  const number = (doc.number || '').trim();
  if (number) {
    let field: string | undefined;
    let mode: 'words' | 'compact' = 'words';
    field = fields.find((value) => findRanges(value, number, 'words').length);
    if (!field) {
      field = fields.find((value) => findRanges(value, number, 'compact').length);
      mode = 'compact';
    }
    rows.push({
      key: 'number', label: 'Numer dokumentu',
      payment: field ? highlighted(field, [number], mode) : plain(card ? 'płatność kartą — bez numeru dokumentu' : 'brak numeru w tytule'),
      document: [{ text: number, hit: Boolean(field) }],
      state: field ? 'match' : 'info',
      verdict: field ? 'numer dokumentu jest w tytule przelewu' : card ? 'przy płatności kartą tytuł nie zawiera numeru faktury — to normalne' : 'tytuł nie zawiera numeru dokumentu — dopasowanie po kwocie i kontrahencie',
    });
  }

  // Data
  {
    const issue = isDate(doc.issueDate) ? doc.issueDate.slice(0, 10) : null;
    const dueDate = isDate(doc.dueDate) ? doc.dueDate.slice(0, 10) : null;
    const date = isDate(tx.date) ? tx.date.slice(0, 10) : null;
    const document = [issue ? `wystawiona ${plDate(issue)}` : '', dueDate ? `termin ${plDate(dueDate)}` : ''].filter(Boolean).join(' · ') || 'brak dat w dokumencie';
    let state: ComparisonState = 'info';
    let verdict = 'brak dat do porównania';
    if (date && (issue || dueDate)) {
      // Okno jak w bazie (`private.bank_amount_only_plausible`): karta — faktura od 3 dni przed do 14 dni po płatności;
      // przelew — wystawiona do 60 dni przed albo 7 dni po płatności, albo termin do 30 dni przed / 14 dni po.
      const sinceIssue = issue ? daysBetween(issue, date) : null;
      const sinceDue = dueDate ? daysBetween(dueDate, date) : null;
      const plausible = card
        ? (issue ?? dueDate) !== null && daysBetween(date, (issue ?? dueDate)!) >= -3 && daysBetween(date, (issue ?? dueDate)!) <= 14
        : (sinceIssue !== null && sinceIssue >= -7 && sinceIssue <= 60) || (sinceDue !== null && sinceDue >= -14 && sinceDue <= 30);
      state = plausible ? 'match' : 'partial';
      if (sinceDue !== null && !card) {
        verdict = sinceDue === 0 ? 'zapłacona w dniu terminu' : sinceDue < 0 ? `zapłacona ${days(sinceDue)} przed terminem` : `zapłacona ${days(sinceDue)} po terminie`;
      } else if (sinceIssue !== null) {
        verdict = sinceIssue === 0 ? `${card ? 'płatność kartą' : 'płatność'} w dniu wystawienia dokumentu`
          : sinceIssue > 0 ? `${card ? 'płatność kartą' : 'płatność'} ${days(sinceIssue)} po wystawieniu`
            : `dokument wystawiony ${days(sinceIssue)} po ${card ? 'płatności kartą' : 'płatności'}`;
      } else if (sinceDue !== null) {
        verdict = sinceDue === 0 ? 'w dniu terminu' : sinceDue < 0 ? `${days(sinceDue)} przed terminem` : `${days(sinceDue)} po terminie`;
      }
      if (!plausible) verdict += ' — data odległa, sprawdź, czy to ten dokument';
    }
    rows.push({
      key: 'date', label: 'Data',
      payment: plain(`${date ? plDate(date) : '—'}${card ? ' · płatność kartą' : ''}`),
      document: plain(document),
      state, verdict,
    });
  }

  // Oznaczenie ręczne
  if (doc.manual) {
    const manualDate = isDate(doc.manualDate) ? doc.manualDate.slice(0, 10) : null;
    const date = isDate(tx.date) ? tx.date.slice(0, 10) : null;
    const gap = manualDate && date ? daysBetween(manualDate, date) : null;
    rows.push({
      key: 'manual', label: 'Oznaczenie ręczne',
      payment: plain(date ? `płatność z wyciągu ${plDate(date)}` : 'płatność z wyciągu'),
      document: plain(`oznaczona ręcznie jako opłacona${manualDate ? ` ${plDate(manualDate)}` : ''}`),
      state: gap !== null && Math.abs(gap) <= 3 ? 'match' : 'info',
      verdict: 'zatwierdzenie potwierdzi ręczne oznaczenie płatnością z wyciągu (bez podwójnej zapłaty)',
    });
  }
  return rows;
}

/** Krótkie podsumowanie: co się zgadza, a co sprawdzić. */
export function comparisonSummary(rows: ComparisonRow[]): string {
  const names: Record<ComparisonRow['key'], string> = { amount: 'kwota', party: 'kontrahent', number: 'numer w tytule', date: 'data', manual: 'oznaczenie ręczne' };
  const matched = rows.filter((row) => row.state === 'match').map((row) => names[row.key]);
  const check = rows.filter((row) => row.state === 'partial' || row.state === 'mismatch').map((row) => names[row.key]);
  return [matched.length ? `Zgadza się: ${matched.join(', ')}` : '', check.length ? `Sprawdź: ${check.join(', ')}` : ''].filter(Boolean).join(' · ');
}
