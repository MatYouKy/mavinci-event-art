import {
  bankStatementImportFormat,
  normalizeBankStatementAccount,
  resolveBankStatementAccountKinds,
  resolveStatementAccount,
  type BankStatementAccountMetadata,
} from '@/lib/bankStatementAccount';

type UploadAccountType = 'regular' | 'vat';
type UploadFormat = 'PDF' | 'MT940';
type CompanyAccounts = { bank_account?: string | null; vat_bank_account?: string | null };

/** Call with every source for exactly one company and period, before filtering by format. */
export function selectBankStatementsForUpload<T extends BankStatementAccountMetadata>(
  statements: readonly T[],
  accountType: UploadAccountType,
  format: UploadFormat,
  companyAccounts?: CompanyAccounts,
): T[] {
  const kinds = resolveBankStatementAccountKinds(statements, companyAccounts);
  return statements.filter((statement) => kinds.get(statement.id) === accountType
    && bankStatementImportFormat(statement) === format);
}

/**
 * A read-only safety gate to run before deleting/replacing any previous source.
 * The explicit choice can classify a new account, but cannot override evidence
 * that its number belongs to the other account kind.
 */
export function validateBankStatementUploadAccount({
  accountType,
  accountNumber,
  statements,
  companyAccounts,
}: {
  accountType: UploadAccountType;
  accountNumber?: string | null;
  statements: readonly BankStatementAccountMetadata[];
  companyAccounts?: CompanyAccounts;
}): string | null {
  const number = normalizeBankStatementAccount(accountNumber);
  if (!number) {
    return 'Nie rozpoznano jednoznacznego numeru polskiego rachunku w przesyłanym wyciągu. Sprawdź nagłówek PDF lub pole rachunku w MT940 oraz nazwę pliku. Import został zatrzymany; istniejące wyciągi pozostają bez zmian.';
  }

  const knownKinds = new Set<UploadAccountType>();
  for (const statement of statements) {
    if (statement.account_type !== 'regular' && statement.account_type !== 'vat') continue;
    const resolved = resolveStatementAccount(statement);
    if (resolved.accountNumber === number) knownKinds.add(statement.account_type);
  }
  // Do not use the source-priority resolver here: conflicting company settings
  // are evidence of an unsafe import even when a source has an explicit kind.
  if (normalizeBankStatementAccount(companyAccounts?.bank_account) === number) knownKinds.add('regular');
  if (normalizeBankStatementAccount(companyAccounts?.vat_bank_account) === number) knownKinds.add('vat');

  const readableNumber = `${number.slice(0, 2)} ${number.slice(2).match(/.{4}/g)?.join(' ')}`;
  if (knownKinds.size > 1) {
    return `Rachunek ${readableNumber} jest oznaczony jednocześnie jako konto bieżące i konto VAT w zapisanych wyciągach lub ustawieniach firmy. Najpierw wyjaśnij sprzeczne oznaczenia. Import został zatrzymany; nie zastąpiono żadnego pliku.`;
  }

  const oppositeType: UploadAccountType = accountType === 'regular' ? 'vat' : 'regular';
  if (knownKinds.has(oppositeType)) {
    const expectedLabel = oppositeType === 'vat' ? 'Konto VAT' : 'Konto bieżące';
    const selectedLabel = accountType === 'vat' ? 'konto VAT' : 'konto bieżące';
    return `Rachunek ${readableNumber} należy do ${oppositeType === 'vat' ? 'konta VAT' : 'konta bieżącego'}, a wybrano ${selectedLabel}. Wybierz „${expectedLabel}” albo właściwy plik. Import został zatrzymany; istniejące wyciągi pozostają bez zmian.`;
  }

  return null;
}
