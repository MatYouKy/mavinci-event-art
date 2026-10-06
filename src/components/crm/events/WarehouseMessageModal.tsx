'use client';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/UI/Modal';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

type Recipient = { id: string; name: string };
export default function WarehouseMessageModal({ eventId, request, onClose }: { eventId: string; request: boolean; onClose: () => void }) {
  const { showSnackbar } = useSnackbar();
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipient, setRecipient] = useState('');
  const [body, setBody] = useState(request ? 'Proszę o przyjęcie wydarzenia do przygotowania oraz sprawdzenie dostępności sprzętu i brakujących zasobów.' : '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await supabase.rpc('get_event_warehouse_recipients', { p_event_id: eventId });
        if (result.error) throw result.error;
        if (active) setRecipients(result.data || []);
      } catch { if (active) setError('Nie udało się pobrać pracowników magazynu. Zamknij okno i spróbuj ponownie.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [eventId]);
  const close = () => { if (!busy.current) onClose(); };
  const send = async () => {
    if (busy.current || !recipient || !body.trim()) return;
    busy.current = true; setSaving(true); setError('');
    requestId.current ||= crypto.randomUUID();
    try {
      const result = await supabase.rpc('send_event_warehouse_message', { p_event_id: eventId, p_recipient: recipient, p_message: body.trim(), p_request: request, p_request_id: requestId.current });
      if (result.error) throw result.error;
      showSnackbar('Wiadomość trafiła do powiadomień wybranego pracownika magazynu', 'success');
      onClose();
    } catch { setError('Nie udało się wysłać wiadomości. Sprawdź dostęp i spróbuj ponownie.'); }
    finally { busy.current = false; setSaving(false); }
  };
  return <Modal open onClose={close} title={request ? 'Poproś magazyn o podjęcie akcji' : 'Napisz do magazynu'}>
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); void send(); }} aria-busy={loading || saving}>
      <p className="text-sm text-[#e5e4e2]/60">Pracownik otrzyma powiadomienie z treścią i odnośnikiem do tego wydarzenia.</p>
      <fieldset disabled={loading || saving} className="space-y-4">
        <label className="block text-sm">Pracownik magazynu<select required value={recipient} onChange={e => { setRecipient(e.target.value); requestId.current = null; }} className="mt-2 w-full rounded-lg bg-black/20 p-3"><option value="">Wybierz osobę</option>{recipients.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label className="block text-sm">Wiadomość<textarea required maxLength={4000} rows={5} value={body} onChange={e => { setBody(e.target.value); requestId.current = null; }} className="mt-2 w-full rounded-lg bg-black/20 p-3" /></label>
      </fieldset>
      {loading && <p role="status">Ładowanie pracowników…</p>}
      {!loading && !error && !recipients.length && <p className="text-sm">Brak dostępnych pracowników magazynu dla tego wydarzenia.</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" disabled={saving} onClick={close} className="rounded-lg bg-white/5 px-4 py-2">Anuluj</button><button disabled={loading || saving || !recipient || !body.trim()} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#250914] disabled:opacity-50">{saving ? 'Wysyłanie…' : 'Wyślij'}</button></div>
    </form>
  </Modal>;
}
