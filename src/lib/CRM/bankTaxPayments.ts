import { repairBrokenBankText } from '@/lib/bankTextEncoding';

export type TaxPaymentCompanyAccounts = {
  id: string;
  bank_account?: string | null;
  vat_bank_account?: string | null;
  private_bank_account?: string | null;
  tax_office_bank_account?: string | null;
  zus_bank_account?: string | null;
};

// Akceptujemy polski NRB lub IBAN PL, z kontrolą sumy kontrolnej.
export function normalizeTaxPaymentAccount(value?: string | null): string {
  const compact = String(value || '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^(?:PL)?\d{26}$/.test(compact)) return '';
  const account = compact.replace(/^PL/, '');
  const rearranged = `${account.slice(2)}2521${account.slice(0, 2)}`;
  let remainder = 0;
  for (const digit of rearranged) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1 ? account : '';
}

// Wyłączenie dotyczy tylko poszukiwania dokumentów, nie statusu księgowania.
export function taxPaymentExclusionReason(transaction: {
  transaction_type?: string | null;
  counterparty_name?: string | null;
  counterparty_account?: string | null;
  accounting_category?: string | null;
}, company?: TaxPaymentCompanyAccounts): string | null {
  if (transaction.transaction_type !== 'debit') return null;

  const recipientAccount = normalizeTaxPaymentAccount(transaction.counterparty_account);
  const ownAccounts = [company?.bank_account, company?.vat_bank_account, company?.private_bank_account]
    .map(normalizeTaxPaymentAccount).filter(Boolean);
  if (recipientAccount && ownAccounts.includes(recipientAccount)) return null;
  if (recipientAccount && company) {
    if (recipientAccount === normalizeTaxPaymentAccount(company.zus_bank_account)) return 'Rachunek ZUS';
    if (recipientAccount === normalizeTaxPaymentAccount(company.tax_office_bank_account)) return 'Rachunek urzędu skarbowego';
  }
  if (transaction.accounting_category === 'tax_or_zus') return 'Zapisana klasyfikacja: podatek lub ZUS';

  const recipient = repairBrokenBankText(transaction.counterparty_name)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/Ł/g, 'L')
    .replace(/[^A-Z0-9]+/g, ' ').trim();
  if (/^ZUS(?:\s|$)/.test(recipient) || recipient.includes('ZAKLAD UBEZPIECZEN SPOLECZNYCH')) {
    return 'Odbiorca: ZUS';
  }
  if (/URZ(?:A)?DSKARBOW/.test(recipient.replace(/\s/g, ''))) return 'Odbiorca: urząd skarbowy';
  // Samo „VAT” lub „PIT” w tytule nie wyłącza faktur i płatności split payment.
  return null;
}
