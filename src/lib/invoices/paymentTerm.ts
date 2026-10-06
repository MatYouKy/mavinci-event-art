export const DEFAULT_INVOICE_PAYMENT_TERM_DAYS = 7;

/** Calendar days from the issue date, without local timezone/DST shifts. */
export function getInvoicePaymentDueDate(issueDate: string, termDays: string | number): string | null {
  const input = String(termDays).trim();
  if (!/^\d+$/.test(input) || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return null;

  const days = Number(input);
  if (!Number.isSafeInteger(days) || days < 0) return null;

  const date = new Date(`${issueDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== issueDate) return null;

  date.setUTCDate(date.getUTCDate() + days);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null;
  return date.toISOString().slice(0, 10);
}
