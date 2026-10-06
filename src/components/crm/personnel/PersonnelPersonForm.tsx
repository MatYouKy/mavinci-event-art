'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import {type PersonnelPerson,personnelInput as input,personnelButton as button,personnelSecondary as secondary} from '@/lib/personnel/workspace';
const blank = { name: '', surname: '', email: '', phone: '', address: '', identifier: '', bank_account: '', notes: '', is_active: true };
export function PersonnelPersonForm({ person, onSaved, onCancel }: { person?: PersonnelPerson; onSaved: (p: PersonnelPerson) => void; onCancel: () => void }) {
  const [form, setForm] = useState(person ? { ...blank, ...Object.fromEntries(Object.entries(person).map(([k,v]) => [k,v ?? ''])) } as typeof blank : blank);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      const payload = { ...Object.fromEntries(Object.entries(form).filter(([key]) => key in blank).map(([key,v]) => [key, typeof v === 'string' ? v.trim() : v])), name: form.name.trim(), surname: form.surname.trim() };
      const result = person ? await supabase.from('personnel_people').update(payload).eq('id',person.id).select('*').single() : await supabase.from('personnel_people').insert(payload).select('*').single();
      if (result.error) throw result.error;
      onSaved(result.data as PersonnelPerson);
    } catch (e: any) { setError(e.message || 'Nie udało się zapisać osoby.'); } finally { setBusy(false); }
  };
  return <form onSubmit={save} className="space-y-4 rounded-xl bg-white/[0.035] p-5">
    <h2 className="text-lg">{person ? 'Dane osoby' : 'Nowy współpracownik'}</h2>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
      {([['name','Imię'],['surname','Nazwisko'],['email','E-mail'],['phone','Telefon'],['address','Adres do umowy'],['identifier','PESEL / identyfikator'],['bank_account','Rachunek bankowy']] as const).map(([key,label]) => <label key={key} className="text-sm">{label}<input className={input} required={key==='name' || key==='surname'} type={key==='email'?'email':'text'} value={String(form[key])} onChange={e => setForm({...form,[key]:e.target.value})} /></label>)}
      <label className="text-sm sm:col-span-2">Notatki<textarea className={input} rows={3} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} /></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={e=>setForm({...form,is_active:e.target.checked})} />Aktywna współpraca</label>
    </fieldset>
    <div className="flex gap-2"><button disabled={busy} className={button}>{busy?'Zapisywanie…':'Zapisz osobę'}</button><button type="button" disabled={busy} onClick={onCancel} className={secondary}>Anuluj</button></div>
  </form>;
}
