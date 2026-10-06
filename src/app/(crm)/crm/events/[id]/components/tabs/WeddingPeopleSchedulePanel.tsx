'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Edit3, Loader2, Plus, Save, Trash2, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

type Person = {
  id?: string;
  local_id: string;
  side: 'bride' | 'groom' | 'shared';
  role: 'bride' | 'groom' | 'witness' | 'mother' | 'father' | 'godparent' | 'guardian' | 'subcontractor' | 'venue_contact' | 'other';
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  instagram_handle: string;
  instagram_tag_consent: boolean;
  notes: string;
};

type ScheduleItem = {
  id?: string;
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
const blankPerson = (side: Person['side'], role: Person['role']): Person => {
  const id = newId();
  return {
    id, local_id: id, side, role, first_name: '', last_name: '', phone: '', email: '', instagram_handle: '', instagram_tag_consent: false, notes: '',
  };
};

function withRequiredPeople(side: 'bride' | 'groom', people: Person[]) {
  const roles: Person['role'][] = [side === 'bride' ? 'bride' : 'groom', 'witness', 'mother', 'father'];
  const existing = people.filter((person) => person.side === side);
  return [
    ...roles.map((role) => existing.find((person) => person.role === role) || blankPerson(side, role)),
    ...existing.filter((person) => !roles.includes(person.role)),
  ];
}

type PanelView = 'all' | 'bride' | 'groom' | 'shared' | 'schedule';

const VIEW_TITLES: Record<PanelView, { title: string; description: string }> = {
  all: { title: 'Osoby i harmonogram', description: 'Każda osoba oraz punkt dnia jest oddzielnym rekordem.' },
  bride: { title: 'Strona Panny Młodej', description: 'Panna Młoda, świadek, rodzice i inne bliskie osoby.' },
  groom: { title: 'Strona Pana Młodego', description: 'Pan Młody, świadek, rodzice i inne bliskie osoby.' },
  shared: { title: 'Pozostałe osoby organizacyjne', description: 'Osoby po stronie sali i pozostali uczestnicy — zapisz imię, telefon oraz opcjonalny e-mail.' },
  schedule: { title: 'Harmonogram i posiłki', description: 'Wspólna kolejność dnia widoczna również w Strefie Pary Młodej.' },
};

export default function WeddingPeopleSchedulePanel({ cardId, canManage, view = 'all' }: { cardId: string; canManage: boolean; view?: PanelView }) {
  const { showSnackbar } = useSnackbar();
  const [people, setPeople] = useState<Person[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [peopleResult, scheduleResult] = await Promise.all([
      supabase.from('wedding_card_people').select('id,side,role,first_name,last_name,phone,email,instagram_handle,instagram_tag_consent,notes').eq('wedding_card_id', cardId).order('side').order('sort_order'),
      supabase.from('wedding_schedule_items').select('id,title,scheduled_at,category,location,responsible_person,notes,is_confirmed').eq('wedding_card_id', cardId).order('scheduled_at', { ascending: true, nullsFirst: false }).order('sort_order'),
    ]);
    if (peopleResult.error) throw peopleResult.error;
    if (scheduleResult.error) throw scheduleResult.error;
    const loadedPeople = (peopleResult.data || []).map((person) => ({
      ...person, local_id: person.id, last_name: person.last_name || '', phone: person.phone || '', email: person.email || '', instagram_handle: person.instagram_handle || '', instagram_tag_consent: person.instagram_tag_consent === true, notes: person.notes || '',
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
    const peoplePayload = people
      .filter((person) => person.first_name.trim())
      .map(({ local_id, ...person }) => ({
        ...person,
        id: person.id || local_id || newId(),
      }));
    const schedulePayload = schedule
      .filter((item) => item.title.trim())
      .map(({ local_id, ...item }) => ({
        ...item,
        id: item.id || local_id || newId(),
        scheduled_at: item.scheduled_at ? new Date(item.scheduled_at).toISOString() : null,
      }));

    const { error } = await supabase.rpc('replace_wedding_people_and_schedule', {
      p_wedding_card_id: cardId,
      p_people: peoplePayload,
      p_schedule: schedulePayload,
    });
    if (error) {
      console.error('Error saving wedding people and schedule:', error);
      setSaving(false);
      showSnackbar('Nie udało się zapisać osób lub harmonogramu', 'error');
      return;
    }
    setEditing(false);
    await load();
    setSaving(false);
    showSnackbar('Osoby i harmonogram zostały zapisane', 'success');
  };

  if (loading) return <div className="flex min-h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>;

  const visibleSides: Array<'bride' | 'groom' | 'shared'> = view === 'all'
    ? ['bride', 'groom', 'shared']
    : view === 'schedule'
      ? []
      : [view];
  const viewCopy = VIEW_TITLES[view];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="text-lg font-semibold text-white">{viewCopy.title}</h3><p className="text-xs text-[#e5e4e2]/45">{viewCopy.description}</p></div>
        {canManage && (editing ? <div className="flex gap-2"><button onClick={() => { setEditing(false); void load(); }} className="rounded-lg border border-white/10 p-2 text-white/55"><X className="h-4 w-4" /></button><button disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#111320]">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Zapisz</button></div> : <button data-crm-action="secondary" onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-3 py-2 text-xs text-[#d3bb73]"><Edit3 className="h-4 w-4" />Edytuj</button>)}
      </div>

      {visibleSides.length > 0 && <div className="grid gap-4">
        {visibleSides.map((side) => (
          <section key={side} className="rounded-2xl border border-white/10 bg-[#171927] p-5">
            <h4 className="mb-4 flex items-center gap-2 font-semibold text-white"><Users className="h-4 w-4 text-[#d3bb73]" />{side === 'bride' ? 'Strona Panny Młodej' : side === 'groom' ? 'Strona Pana Młodego' : 'Pozostałe osoby organizacyjne'}</h4>
            <div className="space-y-3">{people.filter((person) => person.side === side).map((person) => (
              <div key={person.local_id} className="rounded-xl border border-white/5 bg-black/10 p-3">
                <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-[#d3bb73]">{ROLE_LABELS[person.role]}</span>{editing && person.role === 'other' && <button onClick={() => setPeople((current) => current.filter((item) => item.local_id !== person.local_id))} className="text-red-300/60"><Trash2 className="h-4 w-4" /></button>}</div>
                {editing ? <div className="grid gap-2 sm:grid-cols-2">
                  <input placeholder="Imię" value={person.first_name} onChange={(event) => updatePerson(person.local_id, { first_name: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm sm:col-span-2" />
                  <input type="tel" placeholder="Telefon" value={person.phone} onChange={(event) => updatePerson(person.local_id, { phone: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" />
                  <input type="email" placeholder="E-mail (opcjonalnie)" value={person.email} onChange={(event) => updatePerson(person.local_id, { email: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" />
                  {['bride', 'groom'].includes(person.role) && <>
                    <input placeholder="Instagram, np. @ania" value={person.instagram_handle} onChange={(event) => updatePerson(person.local_id, { instagram_handle: event.target.value.replace(/^@+/, '') })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm sm:col-span-2" />
                    <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs text-white/60 sm:col-span-2"><input type="checkbox" checked={person.instagram_tag_consent} onChange={(event) => updatePerson(person.local_id, { instagram_tag_consent: event.target.checked })} className="h-4 w-4 accent-[#d3bb73]" />Zgoda na oznaczanie profilu przez Event Rulers</label>
                  </>}
                </div> : <div>
                  <p className="text-sm text-white">{[person.first_name, person.last_name].filter(Boolean).join(' ') || 'Nie uzupełniono'}</p>
                  {person.phone && <p className="text-xs text-white/45">{person.phone}</p>}
                  {person.email && <p className="text-xs text-white/45">{person.email}</p>}
                  {['bride', 'groom'].includes(person.role) && person.instagram_handle && <p className="mt-1 text-xs text-[#d3bb73]">@{person.instagram_handle} · {person.instagram_tag_consent ? 'zgoda na oznaczanie' : 'bez zgody na oznaczanie'}</p>}
                </div>}
              </div>
            ))}</div>
            {editing && <button onClick={() => setPeople((current) => [...current, blankPerson(side, side === 'shared' ? 'venue_contact' : 'godparent')])} className="mt-3 inline-flex items-center gap-2 text-xs text-[#d3bb73]"><Plus className="h-4 w-4" />Dodaj osobę</button>}
          </section>
        ))}
      </div>}

      {(view === 'all' || view === 'schedule') && <section className="rounded-2xl border border-white/10 bg-[#171927] p-5">
        <h4 className="mb-4 flex items-center gap-2 font-semibold text-white"><CalendarClock className="h-4 w-4 text-[#d3bb73]" />Harmonogram wesela</h4>
        <div className="mb-3 rounded-xl border border-[#d3bb73]/20 bg-[#d3bb73]/[0.05] p-3 text-xs leading-5 text-[#e5e4e2]/65">Rekomendujemy planowanie wydawania posiłków o pełnych godzinach. Pozycje typu „Posiłek” są wspólnym harmonogramem CRM i Strefy Pary Młodej.</div>
        <div className="space-y-3">{schedule.map((item, index) => <div key={item.local_id} className="grid gap-2 rounded-xl border border-white/5 bg-black/10 p-3 md:grid-cols-[170px_130px_1fr_1fr_auto]">{editing ? <><input type="datetime-local" value={item.scheduled_at} onChange={(event) => updateSchedule(item.local_id, { scheduled_at: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" /><select value={item.category} onChange={(event) => updateSchedule(item.local_id, { category: event.target.value })} className="rounded-lg border border-white/10 bg-[#111320] px-3 py-2 text-sm"><option value="other">Inne</option><option value="ceremony">Ceremonia</option><option value="arrival">Przyjazd</option><option value="meal">Posiłek</option><option value="first_dance">Pierwszy taniec</option><option value="cake">Tort</option><option value="parents_thanks">Podziękowania</option><option value="oczepiny">Oczepiny</option><option value="attraction">Atrakcja</option><option value="ending">Zakończenie</option></select><input placeholder="Punkt harmonogramu" value={item.title} onChange={(event) => updateSchedule(item.local_id, { title: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" /><input placeholder="Miejsce / odpowiedzialny" value={item.location} onChange={(event) => updateSchedule(item.local_id, { location: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" /><button onClick={() => setSchedule((current) => current.filter((entry) => entry.local_id !== item.local_id))} className="p-2 text-red-300/60"><Trash2 className="h-4 w-4" /></button></> : <><span className="text-sm text-[#d3bb73]">{item.scheduled_at ? new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.scheduled_at)) : `Punkt ${index + 1}`}</span><span className="text-xs uppercase tracking-wide text-white/35">{item.category === 'meal' ? 'Posiłek' : item.category}</span><span className="text-sm text-white">{item.title}</span><span className="text-sm text-white/45">{item.location || item.responsible_person || '—'}</span></>}</div>)}</div>
        {!schedule.length && !editing && <p className="text-sm text-white/40">Harmonogram nie został jeszcze uzupełniony.</p>}
        {editing && <div className="mt-3 flex flex-wrap gap-3"><button onClick={() => setSchedule((current) => [...current, { local_id: newId(), title: '', scheduled_at: '', category: 'other', location: '', responsible_person: '', notes: '', is_confirmed: false }])} className="inline-flex items-center gap-2 text-xs text-[#d3bb73]"><Plus className="h-4 w-4" />Dodaj punkt harmonogramu</button><button data-crm-action="secondary" onClick={() => setSchedule((current) => [...current, { local_id: newId(), title: 'Wydanie posiłku', scheduled_at: '', category: 'meal', location: '', responsible_person: '', notes: '', is_confirmed: false }])} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-xs text-[#d3bb73]"><Plus className="h-4 w-4" />Dodaj posiłek</button></div>}
      </section>}
    </div>
  );
}
