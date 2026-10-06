export type StatementFinancialSummary = {
  id: string;
  month: number;
  year: number;
  currency: string;
  total_income: number;
  total_expenses: number;
  invoices_issued_count: number;
  invoices_received_count: number;
  invoices_paid_count: number;
  invoices_unpaid_count: number;
  invoices_overdue_count: number;
  bank_statement_uploaded: boolean;
  cash_document_count: number;
};

type Source = 'ksef' | 'crm' | 'external';
type Row = Record<string, unknown>;
type Entry = {
  source: Source;
  row: Row;
  id: string;
  companyId: string;
  date: string | null;
  direction: 'income' | 'expense' | null;
  currency: string | null;
  cents: number | null;
  references: string[];
};
type Result = {
  summaries: StatementFinancialSummary[];
  currencies: string[];
  availableYears: number[];
  warnings: string[];
};

const PAGE_SIZE = 250;
const SOURCE_LABELS: Record<Source, string> = { ksef: 'KSeF', crm: 'CRM', external: 'spoza KSeF' };
const CRM_FIELDS = 'id,my_company_id,invoice_number,invoice_type,is_proforma,status,issue_date,payment_due_date,total_gross,currency_code,payment_status,payment_method,ksef_reference_number';
const KSEF_FIELDS = 'id,my_company_id,invoice_id,ksef_reference_number,invoice_number,invoice_type,issue_date,payment_due_date,gross_amount,currency,payment_status,payment_method,sync_status,sync_error';
const STATEMENT_FIELDS = 'id,my_company_id,statement_month,statement_year,currency';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const code = (value: unknown): string => text(value).toLowerCase();
const label = (entry: Entry): string => `${SOURCE_LABELS[entry.source]}: ${text(entry.row.invoice_number) || text(entry.row.label) || entry.id}`;

function documentDate(value: unknown): string | null {
  const date = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? date : null;
}

function amountCents(value: unknown): number | null {
  if (value == null || value === '' || (typeof value !== 'string' && typeof value !== 'number')) return null;
  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const amount = Number(value);
  const cents = Math.sign(amount) * Math.round(Math.abs(amount) * 100);
  return Number.isFinite(amount) && Number.isSafeInteger(cents) ? cents : null;
}

function currencyCode(value: unknown): string | null {
  const currency = text(value).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

/** Financial validity is independent of cash, bank matching and Saldeo delivery. */
function isFinancialDocument(source: Source, row: Row): boolean {
  const status = code(source === 'crm' ? row.status : row.payment_status);
  return !['draft', 'cancelled', 'proforma'].includes(status)
    && !['draft', 'cancelled'].includes(code(row.status))
    && code(row.invoice_type) !== 'proforma' && row.is_proforma !== true;
}

function paymentMethod(entry: Entry): string {
  return String(entry.row.payment_method ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isCash(entry: Entry): boolean {
  const method = paymentMethod(entry);
  return (entry.source === 'ksef' && method === '1') || method.startsWith('GOTOWK')
    || ['CASH', 'CASHONDELIVERY', 'PAYMENTINCASH'].includes(method);
}

async function readPages(client: any, table: string, fields: string, companyIds: string[] | null): Promise<Row[]> {
  const rows = new Map<string, Row>();
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = client.from(table).select(fields).order('id').range(from, from + PAGE_SIZE - 1);
    if (companyIds !== null) query = query.in('my_company_id', companyIds);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) {
      // Do not return a partial year when any required source is unavailable.
      throw new Error(`Nie udało się odczytać pełnych danych ${table === 'ksef_invoices' ? 'KSeF' : table === 'invoices' ? 'faktur CRM' : table === 'external_invoices' ? 'dokumentów spoza KSeF' : 'wyciągów'}. Podsumowanie nie zostało obliczone.`);
    }
    for (const row of data as Row[]) {
      const id = text(row.id);
      if (!id) throw new Error('Źródło danych zwróciło rekord bez identyfikatora. Podsumowanie nie zostało obliczone.');
      rows.set(id, row);
    }
    if (data.length < PAGE_SIZE) return [...rows.values()];
  }
}

/**
 * Gross document totals, not bank turnover or a tax-profit report.
 * null means all companies visible to the authenticated client's RLS;
 * [] means no permitted companies and never expands to an unscoped query.
 */
export async function loadStatementFinancialSummaries(
  client: any,
  { year, companyIds }: { year: number; companyIds: string[] | null },
): Promise<Result> {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) throw new Error('Wybierz poprawny rok podsumowania.');
  const scope = companyIds === null ? null : [...new Set(companyIds.map((id) => text(id)).filter(Boolean))];
  if (scope !== null && !scope.length) return { summaries: [], currencies: [], availableYears: [], warnings: [] };
  const scopeSet = scope === null ? null : new Set(scope);
  const warnings = new Set<string>();
  const years = new Set<number>([year]);

  const [ksefRows, crmRows, externalRows, statementRows] = await Promise.all([
    readPages(client, 'ksef_invoices', KSEF_FIELDS, scope),
    readPages(client, 'invoices', CRM_FIELDS, scope),
    // KSeF link fields on external documents are optional across schema versions.
    // Read the stored row rather than selecting possibly nonexistent columns.
    readPages(client, 'external_invoices', '*', scope),
    readPages(client, 'bank_statements', STATEMENT_FIELDS, scope),
  ]);

  const entries: Entry[] = [];
  const unassigned = new Map<string, number>();
  const companyFor = (row: Row, sourceLabel: string): string | null => {
    const companyId = text(row.my_company_id);
    if (!companyId) { unassigned.set(sourceLabel, (unassigned.get(sourceLabel) || 0) + 1); return null; }
    if (scopeSet && !scopeSet.has(companyId)) throw new Error('Źródło zwróciło dane poza wybranym zakresem firm. Podsumowanie nie zostało obliczone.');
    return companyId;
  };
  for (const [source, rows] of [['ksef', ksefRows], ['crm', crmRows], ['external', externalRows]] as const) {
    for (const row of rows) {
      const companyId = companyFor(row, SOURCE_LABELS[source]);
      if (!companyId) continue;
      const date = documentDate(source === 'external' ? row.invoice_date : row.issue_date);
      if (date) years.add(Number(date.slice(0, 4)));
      if (!isFinancialDocument(source, row)) continue;
      const references = [...new Set([row.ksef_reference_number, row.ksef_number].map((value) => text(value).toUpperCase()).filter(Boolean))];
      entries.push({
        source, row, id: text(row.id), companyId, date,
        direction: source === 'crm' ? 'income' : source === 'external' ? 'expense' : code(row.invoice_type) === 'issued' ? 'income' : code(row.invoice_type) === 'received' ? 'expense' : null,
        currency: currencyCode(source === 'crm' ? row.currency_code : row.currency),
        cents: amountCents(source === 'crm' ? row.total_gross : source === 'external' ? row.amount_gross : row.gross_amount),
        references,
      });
    }
  }

  const uploadedMonths = new Set<number>();
  const bankCurrencies = new Set<string>();
  for (const row of statementRows) {
    if (!companyFor(row, 'wyciągi')) continue;
    const statementYear = Number(row.statement_year);
    const statementMonth = Number(row.statement_month);
    if (!Number.isInteger(statementYear) || statementYear < 1900 || statementYear > 9999 || !Number.isInteger(statementMonth) || statementMonth < 1 || statementMonth > 12) {
      warnings.add('Co najmniej jeden wyciąg ma nieprawidłowy okres i nie został przypisany do miesiąca.');
      continue;
    }
    years.add(statementYear);
    if (statementYear === year) {
      // Uploaded is not synonymous with parsed or complete: every account and
      // format contributes to this flag; parsing readiness is a separate view.
      uploadedMonths.add(statementMonth);
      const currency = currencyCode(row.currency);
      if (currency) bankCurrencies.add(currency);
    }
  }
  for (const [source, count] of unassigned) warnings.add(`Pominięto rekordy bez przypisanej firmy (${source}: ${count}). Uzupełnij firmę, aby uwzględnić je w podsumowaniu.`);

  // Explicit identity graph. The ordinary invoice number, amount and seller
  // name are never identity keys. All keys are isolated by company.
  const parents = entries.map((_, index) => index);
  const references = entries.map((entry) => new Set(entry.references));
  const owners = new Map<string, number>();
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) { const next = parents[index]; parents[index] = root; index = next; }
    return root;
  };
  const relevant = (entry: Entry) => !entry.date || Number(entry.date.slice(0, 4)) === year;
  const merge = (left: number, right: number) => {
    const a = find(left); const b = find(right);
    if (a === b) return;
    const combined = new Set([...references[a], ...references[b]]);
    if (combined.size > 1) {
      if (relevant(entries[left]) || relevant(entries[right])) warnings.add(`Sprzeczne powiązania KSeF: ${label(entries[left])} oraz ${label(entries[right])}. Nie scalono tych rekordów; sumy wymagają kontroli powiązania.`);
      return;
    }
    parents[b] = a;
    references[a] = combined;
  };
  entries.forEach((entry, index) => {
    if (entry.references.length > 1) {
      if (relevant(entry)) warnings.add(`${label(entry)}: zapisano różne numery KSeF. Dokument nie został automatycznie scalony; podsumowanie wymaga kontroli powiązania.`);
      return;
    }
    const tokens = entry.references.map((reference) => `reference:${reference}`);
    if (entry.source === 'ksef') {
      tokens.push(`ksef-id:${entry.id}`);
      if (text(entry.row.invoice_id)) tokens.push(`crm-id:${text(entry.row.invoice_id)}`);
    } else if (entry.source === 'crm') tokens.push(`crm-id:${entry.id}`);
    if (entry.source !== 'ksef' && text(entry.row.ksef_invoice_id)) tokens.push(`ksef-id:${text(entry.row.ksef_invoice_id)}`);
    for (const token of tokens) {
      const key = `${entry.companyId}:${token}`;
      const previous = owners.get(key);
      if (previous == null) owners.set(key, index);
      else merge(previous, index);
    }
  });
  const groups = new Map<number, Entry[]>();
  entries.forEach((entry, index) => { const key = find(index); groups.set(key, [...(groups.get(key) || []), entry]); });
  const rank: Record<Source, number> = { ksef: 0, crm: 1, external: 2 };
  const canonicalGroups = [...groups.values()].map((group) => group.sort((a, b) => rank[a.source] - rank[b.source]
    || Number(a.date == null || a.currency == null || a.cents == null || a.direction == null) - Number(b.date == null || b.currency == null || b.cents == null || b.direction == null)
    || a.id.localeCompare(b.id)));

  const currencies = new Set<string>();
  const totals = new Map<string, StatementFinancialSummary>();
  const cents = new Map<string, { income: number; expense: number }>();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const getSummary = (month: number, currency: string) => {
    const key = `${year}-${month}-${currency}`;
    let summary = totals.get(key);
    if (!summary) {
      summary = { id: key, month, year, currency, total_income: 0, total_expenses: 0,
        invoices_issued_count: 0, invoices_received_count: 0, invoices_paid_count: 0,
        invoices_unpaid_count: 0, invoices_overdue_count: 0, bank_statement_uploaded: uploadedMonths.has(month), cash_document_count: 0 };
      totals.set(key, summary); cents.set(key, { income: 0, expense: 0 });
    }
    return summary;
  };
  for (const group of canonicalGroups) {
    const entry = group[0];
    if (!entry.date) { warnings.add(`${label(entry)}: brak poprawnej daty wystawienia. Dokument nie został przypisany do miesiąca.`); continue; }
    if (Number(entry.date.slice(0, 4)) !== year) continue;
    for (const source of group) {
      if (source.source === 'ksef' && (code(source.row.sync_status) === 'error' || text(source.row.sync_error))) warnings.add(`${label(source)}: zapisano błąd synchronizacji KSeF. Podsumowanie używa wyłącznie dostępnych danych i może wymagać ich uzupełnienia.`);
    }
    if (group.some((source) => source.date && source.date !== entry.date)) warnings.add(`${label(entry)}: połączone źródła mają różne daty wystawienia; użyto daty ${entry.date} ze źródła ${SOURCE_LABELS[entry.source]}.`);
    if (group.some((source) => source.currency && entry.currency && source.currency !== entry.currency)) warnings.add(`${label(entry)}: połączone źródła mają różne waluty; użyto waluty źródła ${SOURCE_LABELS[entry.source]}.`);
    if (group.some((source) => source.cents != null && entry.cents != null && source.cents !== entry.cents)) warnings.add(`${label(entry)}: połączone źródła mają różne kwoty brutto; użyto kwoty źródła ${SOURCE_LABELS[entry.source]}.`);
    if (group.some((source) => source.direction && entry.direction && source.direction !== entry.direction)) warnings.add(`${label(entry)}: połączone źródła wskazują różny kierunek sprzedaży/zakupu; użyto kierunku źródła ${SOURCE_LABELS[entry.source]}.`);
    if (!entry.currency) { warnings.add(`${label(entry)}: brak poprawnej waluty. Dokument nie został dodany do sum walutowych.`); continue; }
    currencies.add(entry.currency);
    if (!entry.direction) { warnings.add(`${label(entry)}: nieznany kierunek sprzedaży/zakupu. Dokument nie został dodany do przychodów ani kosztów.`); continue; }
    const summary = getSummary(Number(entry.date.slice(5, 7)), entry.currency);
    if (entry.direction === 'income') summary.invoices_issued_count += 1;
    else summary.invoices_received_count += 1;
    if (entry.cents == null) warnings.add(`${label(entry)}: brak poprawnej kwoty brutto. Dokument jest w liczniku, ale nie w sumie — nie uznano jego wartości za zero.`);
    else {
      const amounts = cents.get(summary.id)!;
      const sum = amounts[entry.direction] + entry.cents;
      if (!Number.isSafeInteger(sum)) warnings.add(`${label(entry)}: suma kwot przekracza bezpieczną dokładność. Nie dodano tej kwoty; podsumowanie jest niepełne.`);
      else amounts[entry.direction] = sum;
    }
    const status = code(entry.row.payment_status) || (entry.source === 'crm' ? code(entry.row.status) : '');
    const paid = status === 'paid' || status === 'refunded';
    if (paid) summary.invoices_paid_count += 1;
    else {
      summary.invoices_unpaid_count += 1;
      const dueDate = documentDate(entry.row.payment_due_date || entry.row.due_date);
      if (status === 'overdue' || (dueDate && dueDate < today)) summary.invoices_overdue_count += 1;
    }
    // An explicit source method wins. A missing method may be filled from one
    // unambiguous cash/non-cash classification of its explicitly linked copies.
    if (paymentMethod(entry)) { if (isCash(entry)) summary.cash_document_count += 1; }
    else {
      const knownMethods = group.filter((source) => paymentMethod(source));
      if (knownMethods.length && knownMethods.every(isCash)) summary.cash_document_count += 1;
      else if (knownMethods.some(isCash)) warnings.add(`${label(entry)}: połączone źródła mają sprzeczne sposoby płatności. Nie zaliczono dokumentu do licznika gotówki.`);
    }
  }

  if (!currencies.size) for (const currency of bankCurrencies) currencies.add(currency);
  if (!currencies.size) currencies.add('PLN');
  const orderedCurrencies = [...currencies].sort((a, b) => a === 'PLN' ? -1 : b === 'PLN' ? 1 : a.localeCompare(b));
  const summaries: StatementFinancialSummary[] = [];
  for (const currency of orderedCurrencies) for (let month = 1; month <= 12; month += 1) {
    const summary = getSummary(month, currency);
    const amounts = cents.get(summary.id)!;
    summary.total_income = amounts.income / 100;
    summary.total_expenses = amounts.expense / 100;
    summaries.push(summary);
  }
  return { summaries, currencies: orderedCurrencies, availableYears: [...years].sort((a, b) => b - a), warnings: [...warnings] };
}
