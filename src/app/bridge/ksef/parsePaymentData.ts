/**
 * Parsuje metadane płatności z faktury KSeF
 */

interface PaymentData {
  payment_method: string | null;
  payment_due_date: string | null;
  payment_date: string | null;
  bank_account_number: string | null;
  payment_status: 'paid' | 'unpaid' | 'overdue' | 'partially_paid';
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

  // Data zapłaty (FA3: DataZaplaty / Zaplacono)
  const paymentDate =
    inv.paymentDate ||
    inv.payment_date ||
    inv.DataZaplaty ||
    inv.dataZaplaty ||
    inv.DatePaid ||
    inv.paidDate ||
    inv.Zaplacono ||
    inv.zaplacono ||
    null;

  // Kwota zapłacona (FA3: ZaplataCzesciowa / KwotaZaplacona)
  const paidAmount =
    inv.paidAmount ||
    inv.paid_amount ||
    inv.KwotaZaplacona ||
    inv.kwotaZaplacona ||
    inv.ZnijZaplacono ||
    inv.amountPaid ||
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

  // Determine payment status based on available data
  const paymentStatus = determinePaymentStatus({
    paymentMethod: paymentMethod ? String(paymentMethod) : null,
    paymentDate,
    paymentDueDate,
    paidAmount,
    grossAmount: inv.grossAmount ?? inv.gross_amount ?? null,
  });

  return {
    payment_method: paymentMethod ? String(paymentMethod) : null,
    payment_due_date: paymentDueDate,
    payment_date: paymentDate,
    bank_account_number: bankAccountNumber,
    payment_status: paymentStatus,
  };
}

function determinePaymentStatus(params: {
  paymentMethod: string | null;
  paymentDate: string | null;
  paymentDueDate: string | null;
  paidAmount: any;
  grossAmount: any;
}): 'paid' | 'unpaid' | 'overdue' | 'partially_paid' {
  const { paymentMethod, paymentDate, paymentDueDate, paidAmount, grossAmount } = params;

  // Cash payment (method '1') or card payment (method '2') = paid immediately
  if (paymentMethod === '1' || paymentMethod === '2') return 'paid';

  // If payment date is set, it was paid
  if (paymentDate) return 'paid';

  // If paid amount is set, check if full or partial
  if (paidAmount != null && Number(paidAmount) > 0) {
    if (grossAmount != null && Number(paidAmount) < Number(grossAmount)) {
      return 'partially_paid';
    }
    return 'paid';
  }

  // Check if overdue
  if (paymentDueDate) {
    const due = new Date(paymentDueDate);
    const now = new Date();
    if (due < now) return 'overdue';
  }

  return 'unpaid';
}

export function getPaymentMethodLabel(code: string | null): string {
  if (!code) return 'Nieznana';
  return PAYMENT_METHOD_LABELS[code] || 'Nieznana';
}

export function isCashPayment(paymentMethod: string | null): boolean {
  return paymentMethod === '1';
}

export function isCardPayment(paymentMethod: string | null): boolean {
  return paymentMethod === '2';
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
