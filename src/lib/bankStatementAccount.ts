export type BankStatementAccountKind = 'regular' | 'vat' | 'unclassified';

export interface BankStatementAccountMetadata {
  id: string;
  account_type?: string | null;
  account_number?: string | null;
  file_name?: string | null;
  import_format?: string | null;
  file_type?: string | null;
}

/** Identifies a saved Polish account; does not validate a destination for a transfer. */
export function normalizeBankStatementAccount(value?: string | null): string | null {
  const compact = String(value || '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^(?:PL)?\d{26}$/.test(compact)) return null;
  const account = compact.replace(/^PL/, '');
  return /^0+$/.test(account) ? null : account;
}

/** Supports NRB/IBAN inside :25: bank prefixes and source filenames, without joining unrelated digits. */
export function extractBankStatementAccountNumber(value?: string | null): string | null {
  const direct = normalizeBankStatementAccount(value);
  if (direct) return direct;
  const candidates = Array.from(
    String(value || '').matchAll(/(?:^|[^A-Z0-9])((?:PL[ \t-]*)?\d{2}(?:[ \t-]*\d{4}){6})(?=$|[^0-9])/gi),
    (match) => normalizeBankStatementAccount(match[1]),
  ).filter((account): account is string => Boolean(account));
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
}

export function resolveStatementAccount(statement: Pick<BankStatementAccountMetadata, 'account_number' | 'file_name'>): {
  accountNumber: string | null;
  warning: string | null;
} {
  const parsed = extractBankStatementAccountNumber(statement.account_number);
  const filename = extractBankStatementAccountNumber(statement.file_name);
  return {
    accountNumber: parsed || filename,
    warning: parsed && filename && parsed !== filename
      ? 'Numer rachunku zapisany z treści wyciągu różni się od numeru w nazwie pliku. Używamy numeru z treści; sprawdź plik źródłowy.'
      : null,
  };
}

export function resolveBankStatementAccountKinds(
  statements: readonly BankStatementAccountMetadata[],
  config?: { bank_account?: string | null; vat_bank_account?: string | null },
): Map<string, BankStatementAccountKind> {
  const sourceKinds = new Map<string, Set<'regular' | 'vat'>>();
  const configKinds = new Map<string, Set<'regular' | 'vat'>>();
  const add = (map: Map<string, Set<'regular' | 'vat'>>, number: string | null, kind: 'regular' | 'vat') => {
    if (!number) return;
    const kinds = map.get(number) || new Set<'regular' | 'vat'>();
    kinds.add(kind);
    map.set(number, kinds);
  };
  for (const statement of statements) {
    if (statement.account_type === 'regular' || statement.account_type === 'vat') {
      add(sourceKinds, resolveStatementAccount(statement).accountNumber, statement.account_type);
    }
  }
  add(configKinds, normalizeBankStatementAccount(config?.bank_account), 'regular');
  add(configKinds, normalizeBankStatementAccount(config?.vat_bank_account), 'vat');
  return new Map(statements.map((statement) => {
    if (statement.account_type === 'regular' || statement.account_type === 'vat') {
      return [statement.id, statement.account_type] as const;
    }
    const number = resolveStatementAccount(statement).accountNumber;
    const kinds = number ? sourceKinds.get(number) || configKinds.get(number) : undefined;
    const kind: BankStatementAccountKind = kinds?.size === 1 ? [...kinds][0] : 'unclassified';
    return [statement.id, kind] as const;
  }));
}

export function bankStatementImportFormat(
  statement: Pick<BankStatementAccountMetadata, 'account_type' | 'import_format' | 'file_type' | 'file_name'>,
): 'PDF' | 'MT940' | null {
  for (const value of [statement.import_format, statement.file_type]) {
    const format = String(value || '').trim().toUpperCase();
    if (format === 'PDF' || format === 'MT940') return format;
  }
  if (statement.account_type === 'mt940') return 'MT940';
  if (/\.(?:txt|sta|mt940)$/i.test(statement.file_name || '')) return 'MT940';
  if (/\.pdf$/i.test(statement.file_name || '')) return 'PDF';
  return null;
}
