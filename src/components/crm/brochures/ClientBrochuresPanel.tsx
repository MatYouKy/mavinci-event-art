'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, Eye, FileText, RefreshCw, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { Modal } from '@/components/UI/Modal';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import SendSavedBrochureEmailModal from './SendSavedBrochureEmailModal';

type SavedBrochure = {
  id: string; brochure_id: string; version: number; pdf_path: string; file_name: string;
  created_at: string; created_by: string; recipient_name: string | null; recipient_email: string | null;
  snapshot: { brochure?: { name?: string }; recipient?: { organizationName?: string } };
  author: { name: string | null; surname: string | null } | null;
};

export default function ClientBrochuresPanel({ contactId, organizationId }: { contactId?: string; organizationId?: string }) {
  const { employee, isAdmin, hasScope } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const canAll = isAdmin || hasScope('offers_brochures_view_all');
  const canSend = isAdmin || hasScope('offers_manage');
  const [mailGenerationId, setMailGenerationId] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<SavedBrochure[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [pdf, setPdf] = useState<{ url: string; downloadUrl: string; title: string } | null>(null);
  const ticket = useRef(0);
  const openingLock = useRef(false);
  const showAll = canAll && all;

  const load = useCallback(async () => {
    if (!employee?.id || (!contactId && !organizationId)) return;
    const current = ++ticket.current;
    setLoading(true); setError(''); setRows([]); setPdf(null);
    try {
      let query = supabase.from('sales_brochure_generations')
        .select('id,brochure_id,version,pdf_path,file_name,created_at,created_by,recipient_name,recipient_email,snapshot,author:employees(name,surname)')
        .order('created_at', { ascending: false }).order('id').range(offset, offset + 24);
      if (contactId) query = query.eq('recipient_contact_id', contactId);
      if (organizationId) query = query.eq('recipient_organization_id', organizationId);
      if (!showAll) query = query.eq('created_by', employee.id);
      const result = await query;
      if (result.error) throw result.error;
      if (current === ticket.current) setRows((result.data || []) as unknown as SavedBrochure[]);
    } catch (failure) {
      if (current !== ticket.current) return;
      const code = (failure as { code?: string })?.code;
      setError(code === '42703' || code === 'PGRST204'
        ? 'Widok wymaga migracji powiązań broszur z klientami. Poproś administratora o jej wdrożenie.'
        : 'Nie udało się pobrać broszur klienta. Spróbuj ponownie.');
    } finally {
      if (current === ticket.current) setLoading(false);
    }
  }, [employee?.id, contactId, organizationId, offset, showAll]);

  useEffect(() => { void load(); return () => { ticket.current += 1; }; }, [load]);

  const openPdf = async (row: SavedBrochure) => {
    if (openingLock.current) return;
    openingLock.current = true; setOpening(true);
    const current = ticket.current;
    try {
      const [preview, download] = await Promise.all([
        supabase.storage.from('generated-brochures').createSignedUrl(row.pdf_path, 300),
        supabase.storage.from('generated-brochures').createSignedUrl(row.pdf_path, 300, { download: row.file_name }),
      ]);
      if (preview.error || download.error || !preview.data?.signedUrl || !download.data?.signedUrl) {
        throw new Error('Nie udało się otworzyć zapisanego PDF. Odśwież listę i spróbuj ponownie.');
      }
      if (current === ticket.current) setPdf({
        url: preview.data.signedUrl, downloadUrl: download.data.signedUrl,
        title: `${row.snapshot?.brochure?.name || 'Broszura'} · wersja ${row.version}`,
      });
    } catch (failure) {
      if (current === ticket.current) showSnackbar(failure instanceof Error ? failure.message : 'Nie udało się otworzyć PDF.', 'error');
    } finally {
      openingLock.current = false; setOpening(false);
    }
  };

  return <section className="space-y-4 rounded-xl bg-white/[.025] p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm uppercase"><FileText className="h-4 w-4 text-[#d3bb73]" />Broszury klienta</h2>
      <button type="button" onClick={() => void load()} disabled={loading || opening}
        className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs disabled:opacity-50">
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Odśwież
      </button>
    </div>
    <p className="text-sm leading-6 text-white/55">
      Zapisane wersje PDF przypisane do tego klienta, także bez wysłania e-maila.
      Możesz je otworzyć i pobrać ponownie. Późniejsze zmiany broszury bazowej nie zmieniają tych plików.
    </p>
    {canAll && <div className="flex gap-2">{[false, true].map(value =>
      <button type="button" key={String(value)} aria-pressed={showAll === value}
        onClick={() => { setAll(value); setOffset(0); }}
        className={`rounded-lg px-3 py-2 text-sm ${showAll === value ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/5'}`}>
        {value ? 'Wszystkie dostępne' : 'Moje'}
      </button>)}</div>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {loading ? <p role="status" className="text-sm text-white/50">Wczytywanie broszur…</p>
      : !error && !rows.length ? <p className="text-sm text-white/50">Brak zapisanych broszur w wybranym zakresie. W edytorze broszury wybierz tego klienta i wygeneruj PDF.</p>
        : <div className="space-y-2">{rows.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-white/[.035] p-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm">{row.snapshot?.brochure?.name || 'Broszura'} <span className="ml-2 rounded-md bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73]">Wersja {row.version}</span></p>
            <p className="text-xs text-white/55">{new Date(row.created_at).toLocaleString('pl-PL')} · {row.recipient_name || 'Klient'}
              {row.recipient_email ? ` · ${row.recipient_email}` : ' · bez e-maila'}</p>
            {row.snapshot?.recipient?.organizationName && <p className="text-xs text-white/45">{row.snapshot.recipient.organizationName}</p>}
            {showAll && <p className="text-xs text-white/45">Przygotował: {[row.author?.name, row.author?.surname].filter(Boolean).join(' ') || 'Pracownik'}</p>}
            <Link href={`/crm/brochures/${row.brochure_id}`} className="inline-block text-xs text-[#d3bb73]">Otwórz broszurę bazową</Link>
          </div>
          <ResponsiveActionBar alwaysDropdown compact disabledBackground actions={[
            { label: 'Wyślij broszurę', icon: <Send className="h-4 w-4" />, onClick: () => setMailGenerationId(row.id), show: canSend && row.created_by === employee?.id, disabled: opening },
            { label: 'Otwórz / pobierz zapisany PDF', icon: <Eye className="h-4 w-4" />, onClick: () => void openPdf(row), disabled: opening },
          ]} />
        </article>)}</div>}
    <div className="flex justify-between text-xs text-[#d3bb73]">
      <button type="button" disabled={!offset || loading} className="disabled:opacity-40" onClick={() => setOffset(value => Math.max(0, value - 25))}>Poprzednie</button>
      <button type="button" disabled={rows.length < 25 || loading} className="disabled:opacity-40" onClick={() => setOffset(value => value + 25)}>Następne</button>
    </div>
    {mailGenerationId && <SendSavedBrochureEmailModal key={mailGenerationId} generationId={mailGenerationId}
      onClose={() => setMailGenerationId(null)} onSent={() => void load()} />}
    <Modal open={Boolean(pdf)} onClose={() => setPdf(null)} title={pdf?.title || 'Zapisana broszura'}>
      {pdf && <div className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <a href={pdf.downloadUrl} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#250914]"><Download className="h-4 w-4" />Pobierz ten PDF</a>
          <a href={pdf.url} target="_blank" rel="noreferrer" className="px-3 py-2 text-sm text-[#d3bb73]">Otwórz osobno</a>
        </div>
        <p className="text-xs text-white/50">To zapisany plik, nie nowa wersja. Link wygasa po 5 minutach — możesz otworzyć plik z listy ponownie.</p>
        <iframe title="Zapisana broszura PDF" src={pdf.url} className="h-[65vh] w-full rounded-lg bg-white" />
      </div>}
    </Modal>
  </section>;
}
