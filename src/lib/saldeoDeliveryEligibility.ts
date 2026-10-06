/** Exact, persisted KSeF evidence only — never infer identity from an amount or invoice number. */
export function hasKsefRegistration(row: Record<string, unknown>): boolean {
  return ['ksef_reference_number', 'ksef_number', 'ksef_invoice_id'].some((field) =>
    typeof row[field] === 'string' && Boolean((row[field] as string).trim()),
  ) || String(row.ksef_status || '').trim().toLowerCase() === 'accepted';
}

/** Shared by package preparation and the final server-side dispatch check. */
export function saldeoDocumentExclusionReason(source: string, row: Record<string, unknown>): string | null {
  if (source !== 'external_invoice' && source !== 'local_invoice') {
    return 'Ten dokument pozostaje w CRM. Do Saldeo przekazujemy dokumenty kosztowe i sprzedażowe spoza KSeF, bez osobnych załączników kadrowych, podatkowych ani potwierdzeń przelewów.';
  }
  if (hasKsefRegistration(row)) {
    return 'Dokument jest już powiązany z KSeF i nie może być ponownie wysłany do Saldeo. Przygotuj aktualną paczkę.';
  }
  const status = String(source === 'local_invoice' ? row.status || '' : row.payment_status || '').trim().toLowerCase();
  if (['draft', 'cancelled'].includes(status) || String(row.invoice_type || '').trim().toLowerCase() === 'proforma') {
    return 'Dokument roboczy, anulowany lub proforma nie należy do paczki księgowej. Przygotuj aktualną paczkę.';
  }
  return null;
}
