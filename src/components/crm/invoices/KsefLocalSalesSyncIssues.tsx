'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

type Issue = { ksef_invoice_id: string; error_message: string; ksef_invoices: { invoice_number: string; my_company_id: string } };

export default function KsefLocalSalesSyncIssues({ companyIds, canManage, onSynced }: {
  companyIds: string[] | null; canManage: boolean; onSynced: () => void;
}) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const { showSnackbar } = useSnackbar();
  const companyKey = companyIds ? [...companyIds].sort().join(',') : '';
  const load = useCallback(async () => {
    let query = supabase.from('ksef_local_sales_sync_issues')
      .select('ksef_invoice_id,error_message,ksef_invoices!inner(invoice_number,my_company_id)').order('updated_at', { ascending: false });
    if (companyIds) query = query.in('ksef_invoices.my_company_id', companyKey ? companyKey.split(',') : []);
    const { data, error } = await query;
    setLoadError(Boolean(error));
    if (!error) setIssues((data || []) as unknown as Issue[]);
  }, [companyKey, companyIds === null]);
  useEffect(() => { void load(); }, [load]);
  if (loadError) return <p className="mb-4 text-sm text-amber-200">Nie udało się sprawdzić kompletności lokalnego rejestru względem KSeF.</p>;
  if (!issues.length) return null;
  return <details className="mb-4 rounded-xl bg-amber-400/10 p-4 text-sm text-amber-100">
    <summary className="cursor-pointer">Faktury KSeF wymagające sprawdzenia powiązania lokalnego ({issues.length})</summary>
    <div className="mt-3 space-y-3">{issues.map(issue => <div key={issue.ksef_invoice_id} className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><strong>{issue.ksef_invoices.invoice_number}</strong><p className="mt-1 text-xs">{issue.error_message}</p></div>
      {canManage && <button type="button" disabled={Boolean(busy)} className="rounded-lg bg-white/5 px-3 py-2 text-xs disabled:opacity-40" onClick={async () => {
        setBusy(issue.ksef_invoice_id);
        try {
          const { data, error } = await supabase.rpc('retry_local_sales_ksef', { p_ksef: issue.ksef_invoice_id });
          if (error || data?.error) throw new Error(error?.message || data.error);
          await load(); onSynced(); showSnackbar('Powiązano fakturę lokalną i KSeF', 'success');
        } catch (error) { showSnackbar(error instanceof Error ? error.message : 'Nie udało się zsynchronizować faktury', 'error'); }
        finally { setBusy(null); }
      }}>{busy === issue.ksef_invoice_id ? 'Synchronizowanie…' : 'Ponów synchronizację'}</button>}
    </div>)}</div>
  </details>;
}
