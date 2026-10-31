'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/UI/Modal';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

type Choice = {
  id: string; label: string; date?: string | null;
  company?: string; contact?: string; email?: string;
};
type ContactSource = Choice & {
  contactId?: string | null; organizationId?: string | null;
};
const textValue = (value: unknown) => typeof value === 'string' ? value.trim() : '';

// Two batched reads for the displayed results; no per-row requests or ambiguous FK joins.
async function loadContactDetails(rows: ContactSource[], signal: AbortSignal): Promise<Choice[]> {
  const contactIds = [...new Set(rows.map(row => row.contactId).filter((id): id is string => !!id))];
  const organizationIds = [...new Set(rows.map(row => row.organizationId).filter((id): id is string => !!id))];
  const [contacts, organizations] = await Promise.all([
    contactIds.length ? supabase.from('contacts').select('id,first_name,last_name,full_name,email')
      .in('id', contactIds).abortSignal(signal) : Promise.resolve({ data: [], error: null }),
    organizationIds.length ? supabase.from('organizations').select('id,name,email')
      .in('id', organizationIds).abortSignal(signal) : Promise.resolve({ data: [], error: null }),
  ]);
  if (contacts.error) throw contacts.error;
  if (organizations.error) throw organizations.error;
  const contactMap = new Map((contacts.data || []).map(row => [row.id, row]));
  const organizationMap = new Map((organizations.data || []).map(row => [row.id, row]));
  return rows.map(row => {
    const contact = row.contactId ? contactMap.get(row.contactId) : undefined;
    const organization = row.organizationId ? organizationMap.get(row.organizationId) : undefined;
    return {
      ...row,
      company: textValue(organization?.name) || row.company,
      contact: textValue(contact?.full_name) || [contact?.first_name, contact?.last_name].filter(Boolean).join(' ').trim() || row.contact,
      email: textValue(contact?.email) || row.email || textValue(organization?.email),
    };
  });
}
export default function OfferLinkModal({ offer, onClose, onSaved }: {
  offer: { id: string; event_id?: string | null; inquiry_id?: string | null; status: string };
  onClose: () => void; onSaved: () => void;
}) {
  const [tab, setTab] = useState<'event' | 'inquiry'>(offer.event_id ? 'inquiry' : 'event');
  const [search, setSearch] = useState('');
  const [choices, setChoices] = useState<Choice[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const { showSnackbar } = useSnackbar();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setSelected(''); setChoices([]); setError('');
    const timer = setTimeout(async () => {
      try {
        const term = search.trim().replace(/[%_]/g, '');
        if (tab === 'event') {
          let query = supabase.from('events').select('id,name,event_date,contact_person_id,organization_id').order('event_date', { ascending: false }).limit(30);
          if (term) query = query.ilike('name', `%${term}%`);
          const { data, error } = await query.abortSignal(controller.signal);
          if (error) throw error;
          const results = await loadContactDetails((data || []).map(row => ({
            id: row.id, label: row.name, date: row.event_date,
            contactId: row.contact_person_id, organizationId: row.organization_id,
          })), controller.signal);
          if (!controller.signal.aborted) setChoices(results);
        } else {
          const { data: employeeId, error: employeeError } = await supabase.rpc('sales_employee_id');
          if (employeeError) throw employeeError;
          if (!employeeId) throw new Error('Nie znaleziono konta pracownika.');
          let query = supabase.from('tasks').select('id,title,contact_id,organization_id,inquiry_details').eq('is_inquiry', true)
            .eq('inquiry_owner_id', employeeId).is('archived_at', null).order('created_at', { ascending: false }).limit(30);
          if (term) query = query.ilike('title', `%${term}%`);
          const { data, error } = await query.abortSignal(controller.signal);
          if (error) throw error;
          const results = await loadContactDetails((data || []).map(row => {
            const details = row.inquiry_details && typeof row.inquiry_details === 'object' && !Array.isArray(row.inquiry_details)
              ? row.inquiry_details as Record<string, unknown> : {};
            return {
              id: row.id, label: row.title, contactId: row.contact_id, organizationId: row.organization_id,
              company: textValue(details.client_company), contact: textValue(details.client_text), email: textValue(details.client_email),
            };
          }), controller.signal);
          if (!controller.signal.aborted) setChoices(results);
        }
      } catch (cause: any) {
        if (!controller.signal.aborted) setError(cause.message || 'Nie udało się wczytać listy.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [tab, search]);
  const save = async () => {
    if (!selected || busy.current || loading) return;
    busy.current = true; setSaving(true); setError('');
    try {
      const { error } = await supabase.rpc('link_offer_context', {
        p_offer: offer.id, p_event: tab === 'event' ? selected : null, p_inquiry: tab === 'inquiry' ? selected : null,
      });
      if (error) throw error;
      showSnackbar('Zapisano powiązanie oferty', 'success');
      onSaved(); onClose();
    } catch (cause: any) { setError(cause.message || 'Nie udało się powiązać oferty.'); }
    finally { busy.current = false; setSaving(false); }
  };
  return <Modal open title="Powiąż ofertę" onClose={() => { if (!busy.current) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4">
      <fieldset disabled={saving} className="space-y-4">
        <div className="flex gap-2" role="tablist" aria-label="Rodzaj powiązania">
          {(['event', 'inquiry'] as const).map(kind => <button type="button" role="tab" key={kind}
            aria-selected={tab === kind} disabled={kind === 'event' ? !!offer.event_id : !!offer.inquiry_id}
            onClick={() => { setTab(kind); setSelected(''); setSearch(''); }}
            className={`rounded-lg px-4 py-2 disabled:opacity-40 ${tab === kind ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'bg-black/10'}`}>
            {kind === 'event' ? 'Wydarzenia' : 'Moje zapytania'}
          </button>)}
        </div>
        <input type="search" aria-label="Wyszukaj powiązanie" placeholder={tab === 'event' ? 'Wyszukaj wydarzenie…' : 'Wyszukaj moje zapytanie…'}
          value={search} onChange={event => { setSelected(''); setSearch(event.target.value); }}
          className="w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2" />
        <div className="max-h-72 space-y-2 overflow-y-auto" aria-busy={loading}>
          {loading ? <p>Wczytywanie…</p> : choices.length ? choices.map(choice => <label key={choice.id}
            className={`flex cursor-pointer items-center gap-3 rounded-lg p-3 ${selected === choice.id ? 'bg-[#d3bb73]/15' : 'bg-black/10'}`}>
            <input type="radio" name="offer-link" value={choice.id} checked={selected === choice.id} onChange={() => setSelected(choice.id)} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{choice.label}</span>
              {choice.date && <small className="block opacity-60">{new Date(choice.date).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' })}</small>}
              {choice.company && <span className="mt-1 block text-sm opacity-80">Klient: {choice.company}</span>}
              {choice.contact && <span className="block text-sm opacity-75">Kontakt: {choice.contact}</span>}
              {choice.email ? <span className="block break-all text-sm text-[#d3bb73]">{choice.email}</span>
                : <span className="block text-xs opacity-45">Brak adresu e-mail</span>}
            </span>
          </label>) : <p className="text-sm opacity-60">Brak wyników. Spróbuj innej nazwy.</p>}
        </div>
        <p className="text-xs opacity-65">Lista pokazuje do 30 wyników. Powiązanie nie rezerwuje sprzętu.
          {offer.status === 'accepted' && tab === 'inquiry' && ' Ta oferta zostanie oznaczona jako zaakceptowana w wybranym zapytaniu.'}</p>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" disabled={saving} onClick={onClose}>Anuluj</button>
        <button type="submit" disabled={!selected || loading || saving} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-black disabled:opacity-40">{saving ? 'Zapisywanie…' : 'Powiąż ofertę'}</button>
      </div>
    </form>
  </Modal>;
}
