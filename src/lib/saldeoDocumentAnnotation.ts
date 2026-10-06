import { supabase } from '@/lib/supabase/browser';

export interface SaldeoPaymentAnnotation {
  date?: string | null;
  postingDate?: string | null;
  reference?: string | null;
  title?: string | null;
  counterparty?: string | null;
  bankAmount?: number | null;
  bankCurrency?: string | null;
  allocatedAmount?: number | null;
  documentAllocatedAmount?: number | null;
  documentCurrency?: string | null;
  paymentNote?: string | null;
  collective?: boolean;
  statementName?: string | null;
}

export interface SaldeoDocumentAnnotationInput {
  original: Blob;
  filename: string;
  companyId: string;
  documentNumber?: string | null;
  documentKind?: string | null;
  accountingNote?: string | null;
  payments?: SaldeoPaymentAnnotation[];
  companyName?: string | null;
  period?: string | null;
}

/** Keeps an unchanged original unless an existing accounting description is supplied. */
export async function annotateSaldeoDocument({ original, filename, ...annotation }: SaldeoDocumentAnnotationInput): Promise<{ blob: Blob; filename: string }> {
  if (!original.size) throw new Error(`Plik ${filename} jest pusty.`);
  if (!annotation.accountingNote?.trim() && !annotation.payments?.length) {
    return { blob: original, filename };
  }
  if (original.size > 12 * 1024 * 1024) {
    throw new Error(`Plik ${filename} przekracza limit 12 MB przygotowania kopii z opisem. Nie został wysłany.`);
  }
  const body = new FormData();
  body.append('file', original, filename);
  body.append('annotation', JSON.stringify(annotation));
  const { data, error } = await supabase.functions.invoke('annotate-saldeo-document', { body });
  if (error) {
    let message = error.message;
    const response = (error as { context?: Response }).context;
    if (response instanceof Response) {
      try {
        const details = await response.json();
        message = details.error || message;
      } catch { /* Keep the transport error when no JSON response is available. */ }
    }
    throw new Error(`Nie przygotowano dokumentu ${filename}: ${message}`);
  }
  if (!(data instanceof Blob) || !data.size || !data.type.includes('application/pdf')) {
    throw new Error(`Nie otrzymano poprawnej kopii PDF dokumentu ${filename}. Wysyłka została zatrzymana.`);
  }
  const stem = filename.replace(/\.[^.]+$/, '').replace(/[\r\n/\\]/g, '_') || 'dokument';
  return { blob: data, filename: `${stem}-opis-CRM.pdf` };
}
