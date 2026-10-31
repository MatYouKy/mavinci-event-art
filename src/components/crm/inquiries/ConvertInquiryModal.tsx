'use client';
import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { inquiryTitleLabel } from '@/lib/ui/systemLabels';

const toLocalInput = (value?: string | null) => {
  if (!value) return '';
  // Calendar dates have no timezone; keep the recorded day unchanged.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function ConvertInquiryModal({ inquiry, categories, companies, initialEventDate, initialEventLocation, onBeforeConvert, onClose, onConverted }: { initialEventDate?: string | null; initialEventLocation?: string | null; inquiry: any; categories: any[]; companies: any[]; onBeforeConvert: () => Promise<void>; onClose: () => void; onConverted: (eventId: string) => void }) {
  const { showSnackbar } = useSnackbar();
  const details = inquiry.inquiry_details || {};
  const locationLabel = initialEventLocation?.trim() || details.location_text || '';
  const [name, setName] = useState(inquiryTitleLabel(inquiry.title));
  const [date, setDate] = useState(() => {
    const inquiryDate = toLocalInput(details.termin);
    if (inquiryDate) return details.event_start_time
      ? `${inquiryDate.slice(0, 10)}T${String(details.event_start_time).slice(0, 5)}` : inquiryDate;
    // The task deadline is a sales follow-up date, not the event date.
    return toLocalInput(initialEventDate);
  });
  const [categoryId, setCategoryId] = useState('');
  const [companyId, setCompanyId] = useState(companies.find((item) => item.is_default)?.id || companies[0]?.id || '');
  const [saving, setSaving] = useState(false);
  const convertLock = useRef(false);
  const convert = async () => {
    if(convertLock.current) return;
    if (!date || !Number.isFinite(new Date(date).getTime())) { showSnackbar('Uzupełnij poprawny termin wydarzenia', 'warning'); return; }
    convertLock.current = true;
    setSaving(true);
    try {
      await onBeforeConvert();
    const { data, error } = await supabase.rpc(inquiry.accepted_offer_id ? 'prepare_inquiry_realization' : 'convert_inquiry_to_event', { p_inquiry_id: inquiry.id, p_event_name: name.trim(), p_event_date: new Date(date).toISOString(), p_category_id: categoryId || null, p_my_company_id: companyId || null });
      if (error) throw error;
    showSnackbar('Zapytanie zostało przekształcone w wydarzenie', 'success'); onConverted(data);
    } catch (error: any) {
      showSnackbar(error.message || 'Nie udało się utworzyć wydarzenia', 'error');
    } finally {
      convertLock.current = false;
      setSaving(false);
    }
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onMouseDown={() => { if(!convertLock.current) onClose(); }}><div className="w-full max-w-xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-5" onMouseDown={(event) => event.stopPropagation()}><h2 className="text-lg font-light text-[#e5e4e2]">Utwórz wydarzenie z zapytania</h2><p className="mt-1 text-xs text-[#e5e4e2]/45">Dokumenty i zadania zachowają powiązania. Przy zaakceptowanej ofercie przeniesiemy wycenę oraz plan zasobów i dodamy zadanie weryfikacji dostępności. Bez akceptacji utworzymy robocze wydarzenie, pozostawiając sprzedaż otwartą.</p>{details.event_end_date && details.event_single_day !== true && <p className="mt-3 text-sm text-[#e5e4e2]/70">Zakończenie z zapytania: {new Date(`${details.event_end_date}T12:00:00`).toLocaleDateString('pl-PL')}, {details.event_end_time}</p>}{locationLabel && <p className="mt-3 text-sm text-[#e5e4e2]/70">Miejsce wydarzenia: {locationLabel}</p>}<div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Nazwa</span><input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]" /></label><label><span className="mb-2 block text-xs text-[#e5e4e2]/50">Termin *</span><input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]" /></label><label><span className="mb-2 block text-xs text-[#e5e4e2]/50">Kategoria</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="">Bez kategorii</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="sm:col-span-2"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Działalność</span><select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="">Nieprzypisana</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.legal_name || item.name}</option>)}</select></label></div><div className="mt-5 flex justify-end gap-3"><button type="button" disabled={saving} onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60">Anuluj</button><button type="button" onClick={() => void convert()} disabled={!name.trim() || !date || saving} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Utwórz wydarzenie</button></div></div></div>;
}
