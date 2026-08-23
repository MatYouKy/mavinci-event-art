'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Edit3, Loader2, Plus, Save, Trash2, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

type Person = {
  local_id: string;
  side: 'bride' | 'groom' | 'shared';
  role: 'bride' | 'groom' | 'witness' | 'mother' | 'father' | 'godparent' | 'guardian' | 'subcontractor' | 'venue_contact' | 'other';
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  notes: string;
};

type ScheduleItem = {
  local_id: string;
  title: string;
  scheduled_at: string;
  category: string;
  location: string;
  responsible_person: string;
  notes: string;
  is_confirmed: boolean;
};

const ROLE_LABELS: Record<Person['role'], string> = {
  bride: 'Panna Młoda', groom: 'Pan Młody', witness: 'Świadek / Świadkowa',
  mother: 'Mama', father: 'Tata', godparent: 'Chrzestny / Chrzestna', guardian: 'Opiekun / Opiekunka',
  subcontractor: 'Podwykonawca', venue_contact: 'Osoba po stronie sali', other: 'Inna osoba',
};

const newId = () => crypto.randomUUID();
const blankPerson = (side: Person['side'], role: Person['role']): Person => ({
  local_id: newId(), side, role, first_name: '', last_name: '', phone: '', email: '', notes: '',
});

function withRequiredPeople(side: 'bride' | 'groom', people: Person[]) {
  const roles: Person['role'][] = [side === 'bride' ? 'bride' : 'groom', 'witness', 'mother', 'father'];
  const existing = people.filter((person) => person.side === side);
  return [
    ...roles.map((role) => existing.find((person) => person.role === role) || blankPerson(side, role)),
    ...existing.filter((person) => !roles.includes(person.role)),
  ];
}

export default function WeddingPeopleSchedulePanel({ cardId, canManage }: { cardId: string; canManage: boolean }) {
  const { showSnackbar } = useSnackbar();
  const [people, setPeople] = useState<Person[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [peopleResult, scheduleResult] = await Promise.all([
      supabase.from('wedding_card_people').select('id,side,role,first_name,last_name,phone,email,notes').eq('wedding_card_id', cardId).order('side').order('sort_order'),
      supabase.from('wedding_schedule_items').select('id,title,scheduled_at,category,location,responsible_person,notes,is_confirmed').eq('wedding_card_id', cardId).order('scheduled_at', { ascending: true, nullsFirst: false }).order('sort_order'),
    ]);
    if (peopleResult.error) throw peopleResult.error;
    if (scheduleResult.error) throw scheduleResult.error;
    const loadedPeople = (peopleResult.data || []).map((person) => ({
      ...person, local_id: person.id, last_name: person.last_name || '', phone: person.phone || '', email: person.email || '', notes: person.notes || '',
    })) as Person[];
    setPeople([
      ...withRequiredPeople('bride', loadedPeople),
      ...withRequiredPeople('groom', loadedPeople),
      ...loadedPeople.filter((person) => person.side === 'shared'),
    ]);
    setSchedule((scheduleResult.data || []).map((item) => ({
      ...item, local_id: item.id, scheduled_at: item.scheduled_at ? item.scheduled_at.slice(0, 16) : '', location: item.location || '', responsible_person: item.responsible_person || '', notes: item.notes || '',
    })) as ScheduleItem[]);
  }, [cardId]);

  useEffect(() => {
    setLoading(true);
    void load().catch((error) => {
      console.error('Error loading wedding people and schedule:', error);
      showSnackbar('Nie udało się pobrać osób i harmonogramu', 'error');
    }).finally(() => setLoading(false));
  }, [load, showSnackbar]);

  const updatePerson = (id: string, patch: Partial<Person>) => setPeople((current) => current.map((person) => person.local_id === id ? { ...person, ...patch } : person));
  const updateSchedule = (id: string, patch: Partial<ScheduleItem>) => setSchedule((current) => current.map((item) => item.local_id === id ? { ...item, ...patch } : item));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const validPeople = people.filter((person) => person.first_name.trim());
    const validSchedule = schedule.filter((item) => item.title.trim());
    const [deletePeople, deleteSchedule] = await Promise.all([
      supabase.from('wedding_card_people').delete().eq('wedding_card_id', cardId),
      supabase.from('wedding_schedule_items').delete().eq('wedding_card_id', cardId),
    ]);
    if (deletePeople.error || deleteSchedule.error) {
      setSaving(false);
      showSnackbar('Nie udało się przygotować zapisu', 'error');
      return;
    }
    const [peopleInsert, scheduleInsert] = await Promise.all([
      validPeople.length ? supabase.from('wedding_card_people').insert(validPeople.map(({ local_id: _id, ...person }, index) => ({ ...person, wedding_card_id: cardId, source: 'crm', sort_order: index }))) : Promise.resolve({ error: null }),
      validSchedule.length ? supabase.from('wedding_schedule_items').insert(validSchedule.map(({ local_id: _id, ...item }, index) => ({ ...item, wedding_card_id: cardId, scheduled_at: item.scheduled_at ? new Date(item.scheduled_at).toISOString() : null, source: 'crm', sort_order: index }))) : Promise.resolve({ error: null }),
    ]);
    setSaving(false);
    if (peopleInsert.error || scheduleInsert.error) {
      showSnackbar('Nie udało się zapisać osób lub harmonogramu', 'error');
      return;
    }
    setEditing(false);
    await load();
    showSnackbar('Osoby i harmonogram zostały zapisane', 'success');
  };

  if (loading) return <div className="flex min-h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="text-lg font-semibold text-white">Osoby i harmonogram</h3><p className="text-xs text-[#e5e4e2]/45">Każda osoba oraz punkt dnia jest oddzielnym rekordem.</p></div>
        {canManage && (editing ? <div className="flex gap-2"><button onClick={() => { setEditing(false); void load(); }} className="rounded-lg border border-white/10 p-2 text-white/55"><X className="h-4 w-4" /></button><button disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#111320]">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Zapisz</button></div> : <button onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-3 py-2 text-xs text-[#d3bb73]"><Edit3 className="h-4 w-4" />Edytuj</button>)}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {(['bride', 'groom', 'shared'] as const).map((side) => (
          <section key={side} className="rounded-2xl border border-white/10 bg-[#171927] p-5">
            <h4 className="mb-4 flex items-center gap-2 font-semibold text-white"><Users className="h-4 w-4 text-[#d3bb73]" />{side === 'bride' ? 'Strona Panny Młodej' : side === 'groom' ? 'Strona Pana Młodego' : 'Kontakty organizacyjne'}</h4>
            <div className="space-y-3">{people.filter((person) => person.side === side).map((person) => (
              <div key={person.local_id} className="rounded-xl border border-white/5 bg-black/10 p-3">
                <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-[#d3bb73]">{ROLE_LABELS[person.role]}</span>{editing && person.role === 'other' && <button onClick={() => setPeople((current) => current.filter((item) => item.local_id !== person.local_id))} className="text-red-300/60"><Trash2 className="h-4 w-4" /></button>}</div>
                {editing ? <div className="grid gap-2 sm:grid-cols-2"><input placeholder="Imię" value={person.first_name} onChange={(event) => updatePerson(person.local_id, { first_name: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" /><input placeholder="Nazwisko" value={person.last_name} onChange={(event) => updatePerson(person.local_id, { last_name: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" /><input placeholder="Telefon" value={person.phone} onChange={(event) => updatePerson(person.local_id, { phone: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" /><input placeholder="E-mail" value={person.email} onChange={(event) => updatePerson(person.local_id, { email: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" /><textarea placeholder="Notatka" value={person.notes} onChange={(event) => updatePerson(person.local_id, { notes: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm sm:col-span-2" /></div> : <div><p className="text-sm text-white">{[person.first_name, person.last_name].filter(Boolean).join(' ') || 'Nie uzupełniono'}</p>{person.phone && <p className="text-xs text-white/45">{person.phone}</p>}</div>}
              </div>
            ))}</div>
            {editing && <button onClick={() => setPeople((current) => [...current, blankPerson(side, side === 'shared' ? 'venue_contact' : 'godparent')])} className="mt-3 inline-flex items-center gap-2 text-xs text-[#d3bb73]"><Plus className="h-4 w-4" />Dodaj osobę</button>}
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-white/10 bg-[#171927] p-5">
        <h4 className="mb-4 flex items-center gap-2 font-semibold text-white"><CalendarClock className="h-4 w-4 text-[#d3bb73]" />Harmonogram wesela</h4>
        <div className="space-y-3">{schedule.map((item, index) => <div key={item.local_id} className="grid gap-2 rounded-xl border border-white/5 bg-black/10 p-3 md:grid-cols-[170px_1fr_1fr_auto]">{editing ? <><input type="datetime-local" value={item.scheduled_at} onChange={(event) => updateSchedule(item.local_id, { scheduled_at: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" /><input placeholder="Punkt harmonogramu" value={item.title} onChange={(event) => updateSchedule(item.local_id, { title: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" /><input placeholder="Miejsce / odpowiedzialny" value={item.location} onChange={(event) => updateSchedule(item.local_id, { location: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" /><button onClick={() => setSchedule((current) => current.filter((entry) => entry.local_id !== item.local_id))} className="p-2 text-red-300/60"><Trash2 className="h-4 w-4" /></button></> : <><span className="text-sm text-[#d3bb73]">{item.scheduled_at ? new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.scheduled_at)) : `Punkt ${index + 1}`}</span><span className="text-sm text-white">{item.title}</span><span className="text-sm text-white/45">{item.location || item.responsible_person || '—'}</span></>}</div>)}</div>
        {!schedule.length && !editing && <p className="text-sm text-white/40">Harmonogram nie został jeszcze uzupełniony.</p>}
        {editing && <button onClick={() => setSchedule((current) => [...current, { local_id: newId(), title: '', scheduled_at: '', category: 'other', location: '', responsible_person: '', notes: '', is_confirmed: false }])} className="mt-3 inline-flex items-center gap-2 text-xs text-[#d3bb73]"><Plus className="h-4 w-4" />Dodaj punkt harmonogramu</button>}
      </section>
    </div>
  );
}
