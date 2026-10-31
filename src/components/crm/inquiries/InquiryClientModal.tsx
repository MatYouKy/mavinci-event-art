'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { matchOrganizationByEmail } from '@/lib/CRM/inquiries/matchOrganizationByEmail';

type Props = { inquiry: any; firstName: string; lastName: string; email: string; phone: string; onClose: () => void; onSaved: (contact: any, organization: any) => void };
export default function InquiryClientModal({ inquiry, firstName, lastName, email, phone, onClose, onSaved }: Props) {
  const [mode, setMode] = useState(inquiry.contact_id ? 'existing' : 'new');
  const [type, setType] = useState(inquiry.organization_id ? 'contact' : inquiry.contact?.contact_type || '');
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const [mail, setMail] = useState(email);
  const [telephone, setTelephone] = useState(phone);
  const [contact, setContact] = useState<any>(inquiry.contact || null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [orgMode, setOrgMode] = useState(inquiry.organization_id ? 'existing' : 'none');
  const [organization, setOrganization] = useState<any>(inquiry.organization || null);
  const [orgQuery, setOrgQuery] = useState('');
  const [orgResults, setOrgResults] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [nip, setNip] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Reuse successfully created records if a later link update needs retrying.
  const createdContact = useRef<any>(null);
  const createdOrganization = useRef<any>(null);
  const busy = useRef(false);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      if (query.trim().length < 2) { setResults([]); return; }
      const escaped = query.trim().replace(/[\\%_]/g, '\\$&');
      const r = await supabase.from('contacts').select('id,full_name,first_name,last_name,email,contact_type')
        .ilike('full_name', `%${escaped}%`).limit(15);
      if (active) { setResults(r.data || []); if (r.error) setError('Nie udało się wyszukać kontaktów.'); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      if (orgQuery.trim().length < 2) { setOrgResults([]); return; }
      const escaped = orgQuery.trim().replace(/[\\%_]/g, '\\$&');
      const r = await supabase.from('organizations').select('id,name,alias').ilike('name', `%${escaped}%`).limit(15);
      if (active) { setOrgResults(r.data || []); if (r.error) setError('Nie udało się wyszukać organizacji.'); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [orgQuery]);
  useEffect(() => {
    let active = true;
    if (!inquiry.organization_id && email) void matchOrganizationByEmail(email).then(match => {
      if (active && match.organization) setOrgResults([match.organization]);
    }).catch(() => {});
    return () => { active = false; };
  }, [inquiry.organization_id, email]);
  const save = async () => {
    if (busy.current) return;
    setError('');
    if (!type) return setError('Wybierz typ klienta.');
    if (mode === 'existing' && !contact?.id) return setError('Wybierz kontakt z listy.');
    if (mode === 'new' && !first.trim()) return setError('Podaj imię klienta.');
    if (type === 'contact' && orgMode === 'existing' && !organization?.id) return setError('Wybierz organizację.');
    if (type === 'contact' && orgMode === 'new' && !name.trim()) return setError('Podaj nazwę organizacji.');
    if (mail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.trim())) return setError('Podaj poprawny adres e-mail.');
    busy.current = true; setSaving(true);
    try {
      let chosenContact = mode === 'existing' ? contact : createdContact.current;
      let chosenOrganization = type === 'contact' && orgMode === 'existing' ? organization : null;
      // Resolve duplicates before any inserts. Never create a second contact silently.
      if (!chosenContact && mail.trim()) {
        const duplicate = await supabase.from('contacts').select('id,full_name,first_name,last_name,email,contact_type').eq('email', mail.trim().toLowerCase()).limit(2);
        if (duplicate.error) throw duplicate.error;
        if (duplicate.data?.length) { setResults(duplicate.data); setMode('existing'); throw new Error('Ten adres jest już w bazie. Wybierz istniejący kontakt.'); }
      }
      if (type === 'contact' && orgMode === 'new') {
        chosenOrganization = createdOrganization.current;
        if (!chosenOrganization) {
          let duplicates = supabase.from('organizations').select('id,name,alias');
          duplicates = nip.trim() ? duplicates.eq('nip', nip.replace(/[\s-]/g, '')) : duplicates.eq('name', name.trim());
          const existing = await duplicates.limit(5);
          if (existing.error) throw existing.error;
          if (existing.data?.length) { setOrgResults(existing.data); setOrgMode('existing'); throw new Error('Taka organizacja jest już w bazie. Wybierz ją z listy.'); }
          const r = await supabase.from('organizations').insert({ name: name.trim(), nip: nip.replace(/[\s-]/g, '') || null, organization_type: 'client', business_type: 'company' }).select('id,name,alias').single();
          if (r.error) throw r.error;
          chosenOrganization = r.data; createdOrganization.current = r.data;
        }
      }
      if (!chosenContact) {
        const r = await supabase.from('contacts').insert({ first_name: first.trim(), last_name: last.trim(), email: mail.trim().toLowerCase() || null, phone: telephone.trim() || null, contact_type: type, status: 'active', lifecycle_status: 'prospect' }).select('id,full_name,first_name,last_name,email,contact_type').single();
        if (r.error) throw r.error;
        chosenContact = r.data; createdContact.current = r.data;
      } else if (chosenContact.contact_type !== type) {
        const r = await supabase.from('contacts').update({ contact_type: type }).eq('id', chosenContact.id).select('id,full_name,first_name,last_name,email,contact_type').single();
        if (r.error) throw r.error;
        chosenContact = r.data;
      }
      if (chosenOrganization) {
        const r = await supabase.from('contact_organizations').upsert({ contact_id: chosenContact.id, organization_id: chosenOrganization.id, is_current: true }, { onConflict: 'contact_id,organization_id' });
        if (r.error) throw r.error;
      }
      let update = supabase.from('tasks').update({ contact_id: chosenContact.id, organization_id: chosenOrganization?.id || null }).eq('id', inquiry.id);
      update = inquiry.contact_id ? update.eq('contact_id', inquiry.contact_id) : update.is('contact_id', null);
      update = inquiry.organization_id ? update.eq('organization_id', inquiry.organization_id) : update.is('organization_id', null);
      const linked = await update.select('id').single();
      if (linked.error) throw new Error('Nie udało się powiązać klienta. Odśwież zapytanie; utworzone rekordy pozostają w bazie.');
      onSaved(chosenContact, chosenOrganization);
    } catch (e: any) { setError(e.message || 'Nie udało się zapisać klienta.'); }
    finally { busy.current = false; setSaving(false); }
  };
  const input = 'mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2';
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="inquiry-client-title">
    <section className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-xl bg-[#1c1f33] p-6 text-[#e5e4e2]">
      <h2 id="inquiry-client-title" className="text-xl">Klient i organizacja</h2>
      <p className="mt-2 text-sm text-white/60">Dane zostaną zapisane dopiero po zatwierdzeniu. Zmiana typu istniejącego kontaktu dotyczy również jego karty klienta.</p>
      <fieldset disabled={saving} className="mt-4 space-y-4">
        <label className="block">Kontakt<select className={input} value={mode} onChange={e => setMode(e.target.value)}><option value="new">Dodaj nowy kontakt</option><option value="existing">Wybierz z bazy</option></select></label>
        {mode === 'existing' ? <div><input aria-label="Szukaj kontaktu" placeholder="Szukaj po imieniu i nazwisku" className={input} value={query} onChange={e => setQuery(e.target.value)} />{contact && <p className="mt-2 text-sm text-[#d3bb73]">Wybrano: {contact.full_name || `${contact.first_name} ${contact.last_name}`}</p>}{results.map(row => <button type="button" key={row.id} className="block w-full py-2 text-left text-sm" onClick={() => { setContact(row); setType(row.contact_type || 'contact'); setResults([]); }}>{row.full_name} · {row.email}</button>)}</div> : <div className="grid gap-3 sm:grid-cols-2"><label>Imię<input className={input} value={first} onChange={e => setFirst(e.target.value)} /></label><label>Nazwisko<input className={input} value={last} onChange={e => setLast(e.target.value)} /></label><label>E-mail<input type="email" className={input} value={mail} onChange={e => setMail(e.target.value)} /></label><label>Telefon<input className={input} value={telephone} onChange={e => setTelephone(e.target.value)} /></label></div>}
        <label className="block">Typ klienta<select className={input} value={type} onChange={e => setType(e.target.value)}><option value="">Wybierz typ</option><option value="individual">Klient indywidualny</option><option value="contact">Kontakt firmowy</option></select></label>
        {type === 'contact' && <><label className="block">Organizacja<select className={input} value={orgMode} onChange={e => setOrgMode(e.target.value)}><option value="none">Powiąż później</option><option value="existing">Wybierz istniejącą</option><option value="new">Dodaj nową organizację</option></select></label>
          {orgMode === 'existing' && <div><input aria-label="Szukaj organizacji" placeholder="Szukaj organizacji po nazwie" className={input} value={orgQuery} onChange={e => setOrgQuery(e.target.value)} />{organization && <p className="mt-2 text-sm text-[#d3bb73]">Wybrano: {organization.alias || organization.name}</p>}{orgResults.map(row => <button type="button" key={row.id} className="block w-full py-2 text-left text-sm" onClick={() => { setOrganization(row); setOrgResults([]); }}>{row.alias || row.name}</button>)}</div>}
          {orgMode === 'new' && <><label className="block">Nazwa organizacji<input className={input} value={name} onChange={e => setName(e.target.value)} /></label><label className="block">NIP (opcjonalnie)<input className={input} value={nip} onChange={e => setNip(e.target.value)} /></label><p className="text-xs text-white/50">Pozostałe dane organizacji uzupełnisz w jej karcie.</p></>}
        </>}
      </fieldset>
      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
      <div className="mt-6 flex justify-end gap-3"><button disabled={saving} onClick={onClose}>Anuluj</button><button disabled={saving} onClick={() => void save()} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] disabled:opacity-50">{saving ? 'Zapisywanie…' : 'Zapisz i powiąż'}</button></div>
    </section>
  </div>;
}
