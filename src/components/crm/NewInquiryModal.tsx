'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, PhoneCall, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

interface NewInquiryModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDate?: Date;
  onSaved?: () => void;
}

type OrgRow = { id: string; name: string; alias?: string | null };
type ContactRow = { id: string; first_name: string | null; last_name: string | null; phone: string | null; email: string | null };
type LocationRow = { id: string; name: string; address?: string | null; city?: string | null };

function toLocalDateTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NewInquiryModal({ isOpen, onClose, initialDate, onSaved }: NewInquiryModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [termin, setTermin] = useState('');
  const [scope, setScope] = useState('');
  const [budget, setBudget] = useState('');
  const [expectations, setExpectations] = useState('');

  const [clientText, setClientText] = useState('');
  const [clientOrgId, setClientOrgId] = useState<string | null>(null);
  const [clientContactId, setClientContactId] = useState<string | null>(null);
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');

  const [locationText, setLocationText] = useState('');
  const [locationId, setLocationId] = useState<string | null>(null);

  const [organizations, setOrganizations] = useState<OrgRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);

  const [clientOpen, setClientOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const clientRef = useRef<HTMLDivElement | null>(null);
  const locRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setTermin(initialDate ? toLocalDateTimeInput(initialDate) : '');
    setScope('');
    setBudget('');
    setExpectations('');
    setClientText('');
    setClientOrgId(null);
    setClientContactId(null);
    setClientPhone('');
    setClientEmail('');
    setLocationText('');
    setLocationId(null);

    (async () => {
      const [orgsRes, contactsRes, locsRes] = await Promise.all([
        supabase.from('organizations').select('id, name, alias').order('name').limit(200),
        supabase.from('contacts').select('id, first_name, last_name, phone, email').order('last_name').limit(200),
        supabase.from('locations').select('id, name, address, city').order('name').limit(200),
      ]);
      setOrganizations((orgsRes.data as OrgRow[]) || []);
      setContacts((contactsRes.data as ContactRow[]) || []);
      setLocations((locsRes.data as LocationRow[]) || []);
    })();
  }, [isOpen, initialDate]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (clientRef.current && !clientRef.current.contains(e.target as Node)) setClientOpen(false);
      if (locRef.current && !locRef.current.contains(e.target as Node)) setLocOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const filteredClients = useMemo(() => {
    const q = clientText.trim().toLowerCase();
    if (!q) return { orgs: organizations.slice(0, 20), contacts: contacts.slice(0, 20) };
    const orgs = organizations
      .filter((o) => `${o.alias || ''} ${o.name || ''}`.toLowerCase().includes(q))
      .slice(0, 10);
    const cs = contacts
      .filter((c) => `${c.first_name || ''} ${c.last_name || ''} ${c.email || ''} ${c.phone || ''}`.toLowerCase().includes(q))
      .slice(0, 10);
    return { orgs, contacts: cs };
  }, [clientText, organizations, contacts]);

  const filteredLocations = useMemo(() => {
    const q = locationText.trim().toLowerCase();
    if (!q) return locations.slice(0, 20);
    return locations
      .filter((l) => `${l.name} ${l.address || ''} ${l.city || ''}`.toLowerCase().includes(q))
      .slice(0, 20);
  }, [locationText, locations]);

  const pickOrg = (org: OrgRow) => {
    setClientOrgId(org.id);
    setClientContactId(null);
    setClientText(org.alias || org.name);
    setClientOpen(false);
  };
  const pickContact = (c: ContactRow) => {
    setClientContactId(c.id);
    setClientOrgId(null);
    setClientText(`${c.first_name || ''} ${c.last_name || ''}`.trim());
    if (c.phone) setClientPhone(c.phone);
    if (c.email) setClientEmail(c.email);
    setClientOpen(false);
  };
  const pickLocation = (l: LocationRow) => {
    setLocationId(l.id);
    setLocationText([l.name, l.city].filter(Boolean).join(', '));
    setLocOpen(false);
  };

  const handleSave = async () => {
    setError(null);

    if (!clientText.trim() && !clientPhone.trim() && !clientEmail.trim()) {
      setError('Podaj przynajmniej dane kontaktowe klienta (nazwa, telefon lub e-mail).');
      return;
    }

    setSaving(true);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        setError('Brak aktywnej sesji. Zaloguj się ponownie.');
        setSaving(false);
        return;
      }

      const { data: minRow } = await supabase
        .from('tasks')
        .select('order_index')
        .order('order_index', { ascending: true })
        .limit(1)
        .maybeSingle();

      const newOrderIndex = (minRow?.order_index ?? 0) - 1;

      const clientLabel = clientText.trim() || clientPhone.trim() || clientEmail.trim() || 'nieznany';
      const title = `Zapytanie: ${clientLabel}`;

      const descParts: string[] = [];
      if (termin) descParts.push(`Termin: ${termin.replace('T', ' ')}`);
      if (locationText.trim()) descParts.push(`Lokalizacja: ${locationText.trim()}`);
      if (scope.trim()) descParts.push(`Zakres: ${scope.trim()}`);
      if (budget.trim()) descParts.push(`Budżet: ${budget.trim()}`);
      if (expectations.trim()) descParts.push(`Oczekiwania: ${expectations.trim()}`);
      const contactBits = [clientText.trim(), clientPhone.trim(), clientEmail.trim()].filter(Boolean);
      if (contactBits.length) descParts.push(`Kontakt: ${contactBits.join(' | ')}`);

      const inquiryDetails = {
        termin: termin || null,
        location_text: locationText.trim() || null,
        location_id: locationId,
        scope: scope.trim() || null,
        budget: budget.trim() || null,
        expectations: expectations.trim() || null,
        client_text: clientText.trim() || null,
        client_organization_id: clientOrgId,
        client_contact_id: clientContactId,
        client_phone: clientPhone.trim() || null,
        client_email: clientEmail.trim() || null,
      };

      const { error: insertError } = await supabase.from('tasks').insert([
        {
          title,
          description: descParts.join('\n'),
          priority: 'high',
          status: 'todo',
          board_column: 'todo',
          order_index: newOrderIndex,
          due_date: termin ? new Date(termin).toISOString() : null,
          created_by: session.user.id,
          is_inquiry: true,
          inquiry_details: inquiryDetails,
        },
      ]);

      if (insertError) {
        setError('Błąd zapisu: ' + insertError.message);
        setSaving(false);
        return;
      }

      setSaving(false);
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Nieznany błąd');
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-[#d3bb73]/10 sticky top-0 bg-[#0f1119] z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#d3bb73]/10 rounded-full">
              <PhoneCall className="w-5 h-5 text-[#d3bb73]" />
            </div>
            <h2 className="text-xl font-semibold text-[#e5e4e2]">Nowe zapytanie</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] hover:bg-white/5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm text-[#e5e4e2]/70 mb-1">Termin</label>
            <input
              type="datetime-local"
              value={termin}
              onChange={(e) => setTermin(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
            />
          </div>

          <div ref={clientRef} className="relative">
            <label className="block text-sm text-[#e5e4e2]/70 mb-1">Klient</label>
            <input
              type="text"
              value={clientText}
              onChange={(e) => {
                setClientText(e.target.value);
                setClientOrgId(null);
                setClientContactId(null);
                setClientOpen(true);
              }}
              onFocus={() => setClientOpen(true)}
              placeholder="Wyszukaj lub wpisz nazwę..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
            />
            {clientOpen && (filteredClients.orgs.length > 0 || filteredClients.contacts.length > 0) && (
              <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] shadow-lg">
                {filteredClients.orgs.length > 0 && (
                  <div>
                    <div className="px-3 py-1 text-xs text-[#d3bb73]/70 bg-[#1c1f33]/60">Organizacje</div>
                    {filteredClients.orgs.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => pickOrg(o)}
                        className="block w-full text-left px-3 py-2 text-sm text-[#e5e4e2] hover:bg-white/5"
                      >
                        {o.alias || o.name}
                      </button>
                    ))}
                  </div>
                )}
                {filteredClients.contacts.length > 0 && (
                  <div>
                    <div className="px-3 py-1 text-xs text-[#d3bb73]/70 bg-[#1c1f33]/60">Osoby kontaktowe</div>
                    {filteredClients.contacts.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => pickContact(c)}
                        className="block w-full text-left px-3 py-2 text-sm text-[#e5e4e2] hover:bg-white/5"
                      >
                        {`${c.first_name || ''} ${c.last_name || ''}`.trim()}
                        {c.phone && <span className="text-[#e5e4e2]/50 ml-2">{c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-1">Telefon</label>
              <input
                type="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="+48..."
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-1">E-mail</label>
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="klient@example.com"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              />
            </div>
          </div>

          <div ref={locRef} className="relative">
            <label className="block text-sm text-[#e5e4e2]/70 mb-1">Lokalizacja</label>
            <input
              type="text"
              value={locationText}
              onChange={(e) => {
                setLocationText(e.target.value);
                setLocationId(null);
                setLocOpen(true);
              }}
              onFocus={() => setLocOpen(true)}
              placeholder="Wyszukaj z bazy lub wpisz..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
            />
            {locOpen && filteredLocations.length > 0 && (
              <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] shadow-lg">
                {filteredLocations.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => pickLocation(l)}
                    className="block w-full text-left px-3 py-2 text-sm text-[#e5e4e2] hover:bg-white/5"
                  >
                    {l.name}
                    {(l.city || l.address) && (
                      <span className="text-[#e5e4e2]/50 ml-2">{[l.address, l.city].filter(Boolean).join(', ')}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/70 mb-1">Zakres</label>
            <textarea
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              rows={2}
              placeholder="Np. nagłośnienie, DJ, konferansjer..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/70 mb-1">Budżet</label>
            <input
              type="text"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="Np. 10 000 zł netto"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/70 mb-1">Oczekiwania</label>
            <textarea
              value={expectations}
              onChange={(e) => setExpectations(e.target.value)}
              rows={3}
              placeholder="Co jest najważniejsze dla klienta?"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex gap-3 p-6 border-t border-[#d3bb73]/10 sticky bottom-0 bg-[#0f1119]">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2 border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-[#d3bb73] rounded-lg text-[#0f1119] font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Zapisz zapytanie
          </button>
        </div>
      </div>
    </div>
  );
}
