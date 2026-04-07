/**
 * Parsuje metadane płatności z faktury KSeF
 */

interface PaymentData {
  payment_method: string | null;
  payment_due_date: string | null;
  payment_date: string | null;
  bank_account_number: string | null;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  '1': 'Gotówka',
  '2': 'Karta płatnicza',
  '3': 'Bon/Kupon',
  '4': 'Czek',
  '5': 'Kredyt kupiecki',
  '6': 'Przelew',
  '7': 'Inne',
};

export function parsePaymentData(inv: any): PaymentData {
  // Forma płatności
  const paymentMethod =
    inv.paymentMethod ||
    inv.payment_method ||
    inv.FormaPlatnosci ||
    inv.formaPlatnosci ||
    inv.PaymentMethod ||
    inv.paymentType ||
    inv.payment_type ||
    null;

  // Termin płatności
  const paymentDueDate =
    inv.paymentDueDate ||
    inv.payment_due_date ||
    inv.TerminPlatnosci ||
    inv.terminPlatnosci ||
    inv.dueDate ||
    inv.PaymentDueDate ||
    inv.deadline ||
    inv.Termin ||
    inv.termin ||
    null;

  // Data zapłaty
  const paymentDate =
    inv.paymentDate ||
    inv.payment_date ||
    inv.DataZaplaty ||
    inv.dataZaplaty ||
    inv.DatePaid ||
    inv.paidDate ||
    null;

  // Numer rachunku bankowego
  const bankAccountNumber =
    inv.bankAccountNumber ||
    inv.bank_account_number ||
    inv.NrRachunkuBankowego ||
    inv.nrRachunkuBankowego ||
    inv.RachunekBankowy ||
    inv.rachunekBankowy ||
    inv.accountNumber ||
    null;

  return {
    payment_method: paymentMethod ? String(paymentMethod) : null,
    payment_due_date: paymentDueDate,
    payment_date: paymentDate,
    bank_account_number: bankAccountNumber,
  };
}

export function getPaymentMethodLabel(code: string | null): string {
  if (!code) return 'Nieznana';
  return PAYMENT_METHOD_LABELS[code] || 'Nieznana';
}

export function isCashPayment(paymentMethod: string | null): boolean {
  return paymentMethod === '1';
}

export function isTransferPayment(paymentMethod: string | null): boolean {
  return paymentMethod === '6';
}

/**
 * Pobiera aktualny certyfikat publiczny KSeF do szyfrowania tokenów
 */
export async function getKSeFPublicKeyCertificate(isTestEnvironment: boolean): Promise<string> {
  const { getKSeFPublicKeyCertificates } = await import('./client');

  const certificates = await getKSeFPublicKeyCertificates(isTestEnvironment);

  if (!certificates || certificates.length === 0) {
    throw new Error('Brak dostępnych certyfikatów publicznych KSeF');
  }

  // Wybierz pierwszy certyfikat (KSeF API zwraca aktywne certyfikaty)
  return certificates[0].certificate;
}
