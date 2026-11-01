'use client';

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import MonthlyDocumentPreviewModal from '@/components/crm/invoices/tabs/MonthlyDocumentPreviewModal';
import type { Document } from '@/components/crm/invoices/tabs/SaldeoDeliveryPanel';

/** Dokumenty, które można obejrzeć: faktura KSeF (wizualizacja XML), faktura CRM (PDF lub wizualizacja), dokument spoza KSeF (wgrany plik). */
export type PreviewableDocumentSource = 'ksef' | 'invoice' | 'external';

export const isPreviewableDocumentSource = (source: string | null | undefined): source is PreviewableDocumentSource =>
  source === 'ksef' || source === 'invoice' || source === 'external';

const EXTERNAL_INVOICES_BUCKET = 'external-invoices';

function previewItem(source: Document['source'], id: string, number: string): Document {
  return {
    key: `${source}:${id}`, source, id, number, kind: '', date: '', dueDate: '', counterparty: '', amount: null,
    currency: 'PLN', note: '', ksefReference: '', bucket: null, path: null, filename: number || 'dokument',
    saldeoType: 'FK', sentAt: null,
  };
}

/**
 * Podgląd dokumentu z uzgadniania wyciągów i wyboru dokumentu do płatności. Uprawnienia sprawdza baza (RLS faktur
 * i magazynu plików) — podgląd pokaże tylko to, co pracownik może zobaczyć w finansach tej działalności.
 */
export function useDocumentPreview() {
  const { showSnackbar } = useSnackbar();
  const [item, setItem] = useState<Document | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const openPreview = useCallback(async (source: PreviewableDocumentSource, id: string, number?: string | null) => {
    const label = number || 'dokument';
    if (source === 'ksef') { setItem(previewItem('ksef', id, label)); return; }
    if (source === 'invoice') { setItem(previewItem('local_invoice', id, label)); return; }
    setOpening(id);
    const { data, error } = await supabase.from('external_invoices').select('invoice_number, file_url').eq('id', id).maybeSingle();
    setOpening(null);
    if (error || !data) { showSnackbar('Nie udało się odczytać dokumentu.', 'error'); return; }
    if (!data.file_url) { showSnackbar('Do tego dokumentu nie wgrano pliku.', 'warning'); return; }
    const documentNumber = data.invoice_number || label;
    setItem({ ...previewItem('external_invoice', id, documentNumber), bucket: EXTERNAL_INVOICES_BUCKET, path: data.file_url, filename: documentNumber });
  }, [showSnackbar]);

  const previewModal = item ? <MonthlyDocumentPreviewModal item={item} onClose={() => setItem(null)} /> : null;
  return { openPreview, previewModal, opening };
}
