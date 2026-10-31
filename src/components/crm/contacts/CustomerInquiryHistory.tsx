'use client';
import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { inquiryTitleLabel } from '@/lib/ui/systemLabels';
import { STAGES } from '@/lib/CRM/inquiries/pipeline';
import InquiryNotesPanel from '@/components/crm/inquiries/InquiryNotesPanel';

type Inquiry = { id: string; title: string; inquiry_stage: string; created_at: string; archived_at: string | null };
export default function CustomerInquiryHistory({ contactId, organizationId }: { contactId?: string; organizationId?: string }) {
  const panelId = useId();
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
      let query = supabase.from('tasks').select('id,title,inquiry_stage,created_at,archived_at').eq('is_inquiry', true);
      if (contactId) {
        query = query.eq('contact_id', contactId);
      } else {
        const relations = await supabase.from('contact_organizations').select('contact_id')
          .eq('organization_id', organizationId!).eq('is_current', true);
        if (relations.error) throw relations.error;
        if (current !== generation.current) return;
        const contactIds = [...new Set((relations.data || []).map(row => row.contact_id))]
          .filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id));
        // An explicit organization always wins over a contact's employment relation.
        query = contactIds.length
          ? query.or(`organization_id.eq.${organizationId},and(organization_id.is.null,contact_id.in.(${contactIds.join(',')}))`)
          : query.eq('organization_id', organizationId!);
      }
      const result = await query.order('created_at', { ascending: false })
        .order('id', { ascending: false }).range(offset, offset + 24);
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
    {items.length > 0 && <div className="overflow-x-auto rounded-lg">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Zapytania klienta z rozwijanymi notatkami i rozmowami</caption>
        <thead className="bg-black/20 text-xs text-[#e5e4e2]/55">
          <tr><th scope="col" className="px-4 py-3 font-medium">Zapytanie</th><th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">Utworzono</th><th scope="col" className="px-4 py-3 font-medium">Etap</th><th scope="col" className="w-14 px-2 py-3 text-center font-medium"><span className="sr-only">Notatki</span></th></tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const stage = STAGES.find(stage => stage.id === item.inquiry_stage);
            const open = expanded === item.id;
            const notesId = `${panelId}-notes-${item.id}`;
            const title = inquiryTitleLabel(item.title);
            return <Fragment key={item.id}>
              <tr className={`transition-colors ${open ? 'bg-[#d3bb73]/10' : index % 2 ? 'bg-white/[0.04]' : 'bg-black/10'} hover:bg-white/[0.07]`}>
                <td className="px-4 py-3"><Link href={`/crm/inquiries/${item.id}`} className="font-medium text-[#d3bb73] hover:underline">{title}</Link><span className="mt-1 block text-xs text-[#e5e4e2]/45 sm:hidden">{new Date(item.created_at).toLocaleDateString('pl-PL')}</span></td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-[#e5e4e2]/55 sm:table-cell">{new Date(item.created_at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${stage?.className || 'bg-white/5 text-white/60'}`}><span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${stage?.dot || 'bg-gray-400'}`} />{stage?.label || 'Zapytanie'}</span>{item.archived_at && <span className="mt-1 block text-xs text-white/40">Zarchiwizowane</span>}</td>
                <td className="px-2 py-2 text-center"><button type="button" aria-expanded={open} aria-controls={notesId} aria-label={`${open ? 'Ukryj' : 'Pokaż'} notatki i rozmowy: ${title}`} title={open ? 'Ukryj notatki' : 'Pokaż notatki'} onClick={() => setExpanded(open ? null : item.id)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[#d3bb73] hover:bg-white/5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#d3bb73]/50"><ChevronDown aria-hidden="true" className={`h-5 w-5 transition-transform ${open ? 'rotate-180' : ''}`} /></button></td>
              </tr>
              <tr hidden={!open} className="bg-black/20"><td colSpan={4} className="p-3 sm:p-4"><div id={notesId} role="region" aria-label={`Notatki: ${title}`} className="min-w-0">{open && <InquiryNotesPanel inquiryId={item.id} />}</div></td></tr>
            </Fragment>;
          })}
        </tbody>
      </table>
    </div>}
    {error && <p role="alert" className="text-sm text-red-300">Nie udało się pobrać historii. <button onClick={() => void load()} className="underline">Spróbuj ponownie</button></p>}
    {loading ? <p role="status">Ładowanie historii…</p> : !error && !items.length ? <p className="text-sm text-[#e5e4e2]/60">Brak powiązanych zapytań.</p> : null}
    {more && <button disabled={loading} onClick={() => void load(items.length)} className="text-sm text-[#d3bb73]">Pokaż starsze zapytania</button>}
  </section>;
}
