import {
  bankStatementImportFormat,
  normalizeBankStatementAccount,
  resolveBankStatementAccountKinds,
  resolveStatementAccount,
  type BankStatementAccountMetadata,
} from '@/lib/bankStatementAccount';

type AccountKind = 'regular' | 'vat';
type Format = 'PDF' | 'MT940';

export interface CompletenessStatement extends BankStatementAccountMetadata {
  processed?: boolean | null;
  validation_status?: string | null;
  transactions_count?: number | string | null;
}

export interface BankStatementFormatCompleteness {
  status: 'ready' | 'missing' | 'unprocessed';
  files: Array<{ id: string; name: string; ready: boolean }>;
}

export interface BankStatementCompleteness {
  status: 'complete' | 'incomplete' | 'unavailable';
  accounts: Array<{
    key: string;
    kind: AccountKind;
    accountNumber: string;
    formats: Record<Format, BankStatementFormatCompleteness>;
  }>;
  missing: string[];
  notices: string[];
}

function isForeignIban(value?: string | null): boolean {
  const compact = String(value || '').toUpperCase().replace(/[\s-]/g, '');
  return !compact.startsWith('PL') && /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(compact);
}

/** Completeness of saved source files, never confirmation of accounting or of a fully reconciled month. */
export function buildBankStatementCompleteness(
  statements: readonly CompletenessStatement[],
  options: {
    companyAccounts?: { bank_account?: string | null; vat_bank_account?: string | null } | null;
    configurationAvailable: boolean;
    sourceRowCounts?: ReadonlyMap<string, number>;
  },
): BankStatementCompleteness {
  const { companyAccounts, configurationAvailable, sourceRowCounts } = options;
  const kinds = resolveBankStatementAccountKinds(statements, companyAccounts || undefined);
  const accounts = new Map<string, BankStatementCompleteness['accounts'][number]>();
  const notices = new Set<string>();
  let unresolved = !configurationAvailable;
  let skippedForeign = false;
  const addAccount = (kind: AccountKind, accountNumber: string) => {
    const key = `${kind}:${accountNumber}`;
    if (!accounts.has(key)) accounts.set(key, {
      key, kind, accountNumber,
      formats: { PDF: { status: 'missing', files: [] }, MT940: { status: 'missing', files: [] } },
    });
    return accounts.get(key)!;
  };
  if (!configurationAvailable) {
    notices.add('Nie udało się odczytać konfiguracji rachunków firmy. Nie można potwierdzić, czy sprawdzono wszystkie wymagane konta.');
  }
  const configured: Array<[AccountKind, string | null | undefined]> = [
    ['regular', companyAccounts?.bank_account], ['vat', companyAccounts?.vat_bank_account],
  ];
  for (const [kind, rawNumber] of configured) {
    if (!rawNumber?.trim()) continue;
    const number = normalizeBankStatementAccount(rawNumber);
    if (number) addAccount(kind, number);
    else if (isForeignIban(rawNumber)) skippedForeign = true;
    else {
      unresolved = true;
      notices.add(`Sprawdź numer ${kind === 'vat' ? 'konta VAT' : 'konta bieżącego'} w ustawieniach firmy — nie można ustalić kompletu jego źródeł.`);
    }
  }
  for (const statement of statements) {
    const resolved = resolveStatementAccount(statement);
    if (!resolved.accountNumber && isForeignIban(statement.account_number)) {
      skippedForeign = true;
      continue;
    }
    const kind = kinds.get(statement.id);
    const fileName = statement.file_name || 'Plik bez nazwy';
    if (!resolved.accountNumber || (kind !== 'regular' && kind !== 'vat')) {
      unresolved = true;
      notices.add(`Plik „${fileName}” wymaga identyfikacji rachunku. Nie zaliczamy go do kompletu innego konta.`);
      continue;
    }
    if (resolved.warning) {
      unresolved = true;
      notices.add(`Plik „${fileName}”: ${resolved.warning}`);
    }
    const account = addAccount(kind, resolved.accountNumber);
    const format = bankStatementImportFormat(statement);
    if (!format) {
      unresolved = true;
      notices.add(`Plik „${fileName}” nie ma rozpoznanego formatu PDF lub MT940.`);
      continue;
    }
    const expected = statement.transactions_count == null ? null : Number(statement.transactions_count);
    const expectedKnown = expected != null && Number.isInteger(expected) && expected >= 0;
    const countAgrees = sourceRowCounts
      ? expectedKnown && (sourceRowCounts.get(statement.id) || 0) === expected
      : true;
    account.formats[format].files.push({
      id: statement.id,
      name: fileName,
      ready: statement.processed === true && statement.validation_status === 'valid' && countAgrees,
    });
  }
  const missing: string[] = [];
  for (const account of accounts.values()) {
    const accountLabel = `${account.kind === 'vat' ? 'Konto VAT' : 'Konto bieżące'} (${account.accountNumber})`;
    for (const format of ['PDF', 'MT940'] as const) {
      const cell = account.formats[format];
      cell.status = cell.files.length === 0 ? 'missing'
        : cell.files.every((file) => file.ready) ? 'ready' : 'unprocessed';
      if (cell.status === 'missing') missing.push(`${accountLabel}: brak pliku ${format}.`);
      else if (cell.status === 'unprocessed') missing.push(`${accountLabel}: ${format} jest dodany, ale odczyt nie jest kompletny lub zatwierdzony.`);
    }
  }
  const kindsByNumber = new Map<string, Set<AccountKind>>();
  accounts.forEach((account) => {
    const accountKinds = kindsByNumber.get(account.accountNumber) || new Set<AccountKind>();
    accountKinds.add(account.kind);
    kindsByNumber.set(account.accountNumber, accountKinds);
  });
  kindsByNumber.forEach((accountKinds, number) => {
    if (accountKinds.size > 1) {
      unresolved = true;
      notices.add(`Rachunek ${number} jest oznaczony jednocześnie jako bieżący i VAT. Wyjaśnij oznaczenie przed potwierdzeniem kompletności.`);
    }
  });
  if (skippedForeign) {
    notices.add('Nie wymagamy polskiego zestawu PDF + MT940 dla rozpoznanych rachunków zagranicznych. Ich odczyty pozostają dostępne poniżej.');
  }
  if (accounts.size === 0) {
    notices.add('Nie ustalono polskich rachunków objętych kontrolą. Nie zakładamy istnienia konta VAT ani nie potwierdzamy pełnej analizy bez identyfikacji kont.');
  }
  return {
    status: accounts.size === 0 ? 'unavailable' : missing.length || unresolved ? 'incomplete' : 'complete',
    accounts: [...accounts.values()].sort((left, right) =>
      Number(left.kind === 'vat') - Number(right.kind === 'vat')
        || left.accountNumber.localeCompare(right.accountNumber)),
    missing,
    notices: [...notices],
  };
}
