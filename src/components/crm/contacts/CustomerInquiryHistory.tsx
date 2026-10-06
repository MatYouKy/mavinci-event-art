'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/browser';
import { inquiryTitleLabel } from '@/lib/ui/systemLabels';
import { STAGES } from '@/lib/CRM/inquiries/pipeline';
import InquiryNotesPanel from '@/components/crm/inquiries/InquiryNotesPanel';

type Inquiry = { id: string; title: string; inquiry_stage: string; created_at: string; archived_at: string | null };
export default function CustomerInquiryHistory({ contactId, organizationId }: { contactId?: string; organizationId?: string }) {
  const [items, setItems] = useState<Inquiry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async (offset = 0) => {
    if (!contactId && !organizationId) return;
    const current = ++generation.current;
    setLoading(true); setError(false);
    try {
      const result = await supabase.from('tasks').select('id,title,inquiry_stage,created_at,archived_at').eq('is_inquiry', true)
        .eq(contactId ? 'contact_id' : 'organization_id', contactId || organizationId!)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 24);
      if (result.error) throw result.error;
      if (current !== generation.current) return;
      setItems(previous => offset ? [...previous, ...(result.data || [])] : result.data || []);
      setMore(result.data?.length === 25);
    } catch { if (current === generation.current) setError(true); }
    finally { if (current === generation.current) setLoading(false); }
  }, [contactId, organizationId]);
  useEffect(() => { setItems([]); setExpanded(null); void load(); return () => { generation.current++; }; }, [load]);
  return <section className="space-y-4 rounded-xl bg-black/10 p-5">
    <h2 className="text-lg">Zapytania i notatki klienta</h2>
    <p className="text-sm text-[#e5e4e2]/60">Historia powiązanych zapytań, ustaleń i rozmów dostępnych w Twoim zakresie uprawnień.</p>
    {items.map(item => <article key={item.id} className="space-y-3 rounded-lg bg-black/15 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><Link href={`/crm/inquiries/${item.id}`} className="font-medium text-[#d3bb73] hover:underline">{inquiryTitleLabel(item.title)}</Link><span className="text-sm">{STAGES.find(stage => stage.id === item.inquiry_stage)?.label || 'Zapytanie'}{item.archived_at ? ' · Zarchiwizowane' : ''}</span></div>
      <p className="text-xs text-[#e5e4e2]/60">{new Date(item.created_at).toLocaleString('pl-PL')}</p>
      <button type="button" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)} className="text-sm text-[#d3bb73]">{expanded === item.id ? 'Ukryj notatki' : 'Pokaż notatki i rozmowy'}</button>
      {expanded === item.id && <InquiryNotesPanel inquiryId={item.id} />}
    </article>)}
    {error && <p role="alert" className="text-sm text-red-300">Nie udało się pobrać historii. <button onClick={() => void load()} className="underline">Spróbuj ponownie</button></p>}
    {loading ? <p role="status">Ładowanie historii…</p> : !error && !items.length ? <p className="text-sm text-[#e5e4e2]/60">Brak powiązanych zapytań.</p> : null}
    {more && <button disabled={loading} onClick={() => void load(items.length)} className="text-sm text-[#d3bb73]">Pokaż starsze zapytania</button>}
  </section>;
}
