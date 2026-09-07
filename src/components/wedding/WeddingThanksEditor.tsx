'use client';

import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { THANKS_GROUP_LABELS, THANKS_SIDE_LABELS, thanksRecipientsFromCard, type ThanksEntry, type ThanksGroup, type ThanksCardPerson, type ThanksSide } from '@/lib/weddingCardDetails';

const inputClass = 'w-full min-w-0 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-[#d2b859]/50';

export default function WeddingThanksEditor({ entries, people = [], onChange }: {
  entries: ThanksEntry[];
  people?: ThanksCardPerson[];
  onChange: (entries: ThanksEntry[]) => void;
}) {
  function add(group: ThanksGroup) {
    const recipients = thanksRecipientsFromCard(group, people);
    onChange([...entries, { id: crypto.randomUUID(), group, recipients: recipients.length ? recipients : [{ id: crypto.randomUUID(), name: '', side: '' }], notes: '' }]);
  }
  function update(id: string, patch: Partial<ThanksEntry>) {
    onChange(entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
  }
  function move(index: number, direction: number) {
    const next = [...entries];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  }
  return <div className="space-y-4">
    <div><h3 className="font-medium text-[#d2b859]">Kolejność wyjść do podziękowań</h3><p className="mt-1 text-xs leading-5 text-white/45">Dodajcie osobne wyjście dla każdej grupy. Rodziców i świadków pobierzemy z Karty Weselnej. Kolejność możecie zmieniać strzałkami.</p></div>
    {entries.map((entry, index) => <section key={entry.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-sm font-medium text-[#d2b859]">Wyjście {index + 1}: {THANKS_GROUP_LABELS[entry.group]}</h4>
        <div className="flex gap-1">
          <button type="button" aria-label={`Przesuń wyjście ${index + 1} wyżej`} disabled={index === 0} onClick={() => move(index, -1)} className="rounded-lg p-2 text-white/50 disabled:opacity-20"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" aria-label={`Przesuń wyjście ${index + 1} niżej`} disabled={index === entries.length - 1} onClick={() => move(index, 1)} className="rounded-lg p-2 text-white/50 disabled:opacity-20"><ArrowDown className="h-4 w-4" /></button>
          <button type="button" aria-label={`Usuń wyjście ${index + 1}`} onClick={() => onChange(entries.filter((item) => item.id !== entry.id))} className="rounded-lg p-2 text-red-300"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="space-y-3">{entry.recipients.map((person) => <div key={person.id} className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label><span className="mb-1 block text-xs text-white/45">Imię</span><input value={person.name} onChange={(event) => update(entry.id, { recipients: entry.recipients.map((item) => item.id === person.id ? { ...item, name: event.target.value } : item) })} placeholder="Imię osoby" className={inputClass} /></label>
        <label><span className="mb-1 block text-xs text-white/45">Z której strony?</span><select value={person.side} onChange={(event) => update(entry.id, { recipients: entry.recipients.map((item) => item.id === person.id ? { ...item, side: event.target.value as ThanksSide | '' } : item) })} className={inputClass}><option value="">Wybierz stronę…</option>{Object.entries(THANKS_SIDE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <button type="button" aria-label={`Usuń osobę ${person.name || 'z wyjścia'}`} onClick={() => update(entry.id, { recipients: entry.recipients.filter((item) => item.id !== person.id) })} className="justify-self-end rounded-lg p-3 text-red-300/70"><Trash2 className="h-4 w-4" /></button>
      </div>)}</div>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={() => update(entry.id, { recipients: [...entry.recipients, { id: crypto.randomUUID(), name: '', side: '' }] })} className="inline-flex items-center gap-1.5 text-xs text-[#d2b859]"><Plus className="h-3.5 w-3.5" />Dodaj osobę</button>
        {['parents', 'witnesses'].includes(entry.group) && <button type="button" onClick={() => {
          const candidates = thanksRecipientsFromCard(entry.group, people);
          const added = candidates.filter((candidate) => !entry.recipients.some((person) => person.name.trim() === candidate.name.trim() && person.side === candidate.side));
          update(entry.id, { recipients: [...entry.recipients.filter((person) => person.name.trim() || person.side), ...added] });
        }} className="inline-flex items-center gap-1.5 text-xs text-white/55"><RefreshCw className="h-3.5 w-3.5" />Dodaj brakujące osoby z karty</button>}
      </div>
      {['parents', 'witnesses'].includes(entry.group) && !thanksRecipientsFromCard(entry.group, people).length && <p className="mt-2 text-xs text-white/40">Brak imion w poprzednich krokach. Możecie je uzupełnić w karcie lub wpisać tutaj.</p>}
      <label className="mt-4 block"><span className="mb-1 block text-xs text-white/45">Notatki do tego wyjścia (opcjonalnie)</span><textarea rows={2} value={entry.notes} onChange={(event) => update(entry.id, { notes: event.target.value })} placeholder="Np. kolejność zaproszenia, muzyka, upominek lub indywidualna zapowiedź" className={inputClass} /></label>
    </section>)}
    <div className="flex flex-wrap gap-2">{Object.entries(THANKS_GROUP_LABELS).map(([group, label]) => <button key={group} type="button" onClick={() => add(group as ThanksGroup)} className="inline-flex items-center gap-2 rounded-xl border border-dashed border-[#d2b859]/30 px-3 py-2.5 text-xs text-[#d2b859]"><Plus className="h-4 w-4" />{label}</button>)}</div>
  </div>;
}

