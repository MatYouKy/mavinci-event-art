'use client';

import { useEffect, useRef, useState } from 'react';
import { UsersRound, UserPlus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

export type InquiryTeamPerson = { id: string; name: string; surname: string; active?: boolean };
export type InquiryTeam = { members: InquiryTeamPerson[]; candidates: InquiryTeamPerson[]; canManageTeam: boolean; isMember: boolean };

export default function InquiryTeamPanel({ inquiryId, owner, team, error, onChanged, onRefresh }: {
  inquiryId: string;
  owner: InquiryTeamPerson | null;
  team: InquiryTeam | null;
  error?: string;
  onChanged: (team: InquiryTeam) => void;
  onRefresh: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  useEffect(() => { setSelected(''); setSaveError(''); }, [inquiryId]);
  const candidates = (team?.candidates || []).filter(person => `${person.name} ${person.surname}`.toLocaleLowerCase('pl-PL').includes(search.trim().toLocaleLowerCase('pl-PL')));
  const save = async (personId: string, active: boolean) => {
    if (lock.current || !team?.canManageTeam) return;
    lock.current = true; setBusy(true); setSaveError(''); setMessage('');
    try {
      const result = await supabase.rpc('set_inquiry_team_member', { p_inquiry_id: inquiryId, p_employee_id: personId, p_active: active });
      if (result.error) throw result.error;
      onChanged(result.data as InquiryTeam);
      setSelected(''); setSearch('');
      setMessage(active ? 'Pracownik dołączył do zespołu.' : 'Usunięto pracownika z zespołu.');
      onRefresh();
    } catch (cause: any) {
      setSaveError(cause?.code === 'PGRST202' ? 'Zarządzanie zespołem wymaga aktualizacji bazy danych.' : cause?.message || 'Nie udało się zapisać zespołu.');
    } finally { lock.current = false; setBusy(false); }
  };
  return <section className="rounded-xl bg-[#1c1f33] p-5">
    <h2 className="flex items-center gap-2 text-lg"><UsersRound className="h-5 w-5 text-[#d3bb73]" />Zespół zapytania</h2>
    <p className="mt-2 text-sm text-white/60">Opiekun prowadzi sprzedaż. Współpracownicy pomagają w ustaleniach, zadaniach, ofertach i kalkulacjach tego zapytania.</p>
    <p className="mt-2 text-xs text-white/45">Dostęp do skrzynek pocztowych pozostaje zgodny z indywidualnymi uprawnieniami.</p>
    {error ? <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-amber-200">{error}</p><button type="button" onClick={onRefresh} className="text-sm text-[#d3bb73]">Spróbuj ponownie</button></div> : <>
      <div className="mt-5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-black/20 p-3 text-sm">
          <span>{owner ? `${owner.name} ${owner.surname}` : 'Brak opiekuna'}</span><span className="text-xs text-[#d3bb73]">Opiekun</span>
        </div>
        {(team?.members || []).map(person => <div key={person.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/5 p-3 text-sm">
          <div><p>{person.name} {person.surname}</p><p className="mt-1 text-xs text-white/45">{person.active === false ? 'Konto nieaktywne' : 'Współpracownik'}</p></div>
          {team?.canManageTeam && <button type="button" disabled={busy} onClick={() => void save(person.id, false)} aria-label={`Usuń z zespołu: ${person.name} ${person.surname}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-white/55 hover:bg-white/5 disabled:opacity-40"><X className="h-4 w-4" /><span>Usuń</span></button>}
        </div>)}
        {!team?.members.length && <p className="py-2 text-sm text-white/50">Nie dodano jeszcze współpracowników.</p>}
      </div>
      {team?.canManageTeam && <div className="mt-6 space-y-3">
        <h3 className="text-sm">Dodaj pracownika do zespołu</h3>
        {!owner ? <p className="text-sm text-white/55">Najpierw przypisz opiekuna zapytania.</p> : <>
          <label className="block text-sm"><span className="sr-only">Wyszukaj pracownika</span><input type="search" value={search} onChange={event => { setSearch(event.target.value); setSelected(''); }} disabled={busy} placeholder="Szukaj po imieniu lub nazwisku" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2" /></label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select aria-label="Pracownik do dodania" value={selected} onChange={event => setSelected(event.target.value)} disabled={busy} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">
              <option value="">Wybierz pracownika</option>{candidates.map(person => <option key={person.id} value={person.id}>{person.name} {person.surname}</option>)}
            </select>
            <button type="button" disabled={busy || !selected} onClick={() => void save(selected, true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#250914] disabled:opacity-40"><UserPlus className="h-4 w-4" />{busy ? 'Zapisywanie…' : 'Dodaj do zespołu'}</button>
          </div>
          {!candidates.length && <p className="text-sm text-white/50">Brak pracowników pasujących do wyszukiwania.</p>}
          <p className="text-xs text-white/45">Lista obejmuje aktywnych pracowników z kontem i dostępem do zapytań. Opiekun i osoby już dodane nie są ponownie wyświetlane.</p>
        </>}
      </div>}
    </>}
    {saveError && <p role="alert" className="mt-4 text-sm text-amber-200">{saveError}</p>}
    {message && <p role="status" className="mt-4 text-sm text-emerald-300">{message}</p>}
  </section>;
}
