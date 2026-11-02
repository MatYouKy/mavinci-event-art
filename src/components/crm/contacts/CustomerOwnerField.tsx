'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { isEligibleContactOwner } from './ownerEligibility';

type OwnerCandidate = { id: string; name: string | null; surname: string | null };

const fullName = (person?: OwnerCandidate | null) => [person?.name, person?.surname].filter(Boolean).join(' ') || 'inna osoba';

/** Osoby, które można wskazać jako opiekuna — reguła z bazy (list_customer_owner_candidates). */
function useOwnerCandidates() {
  const [candidates, setCandidates] = useState<OwnerCandidate[]>([]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await supabase.rpc('list_customer_owner_candidates');
      if (!active) return;
      if (!error) { setCandidates((data || []) as OwnerCandidate[]); return; }
      // Do czasu wdrożenia migracji 20261102090000: dotychczasowa lista.
      const fallback = await supabase.from('employees').select('id, name, surname, role, access_level, access_levels(slug)').eq('is_active', true).order('surname');
      if (active) setCandidates(((fallback.data || []) as any[]).filter(isEligibleContactOwner));
    })();
    return () => { active = false; };
  }, []);
  return candidates;
}

/**
 * Opiekun kontaktu / organizacji. Zasady (wymusza je baza — wyzwalacz protect_customer360_responsibility):
 * administrator zmienia każde przypisanie; opiekun może przekazać klienta innej osobie albo go zwolnić;
 * klienta bez opiekuna można przypisać tylko sobie; cudzego klienta nie można przejąć.
 */
export default function CustomerOwnerField({ value, savedOwnerId, onChange }: {
  value: string;
  /** Opiekun zapisany w bazie — od niego zależy, kto może zmienić przypisanie. */
  savedOwnerId: string | null | undefined;
  onChange: (ownerId: string) => void;
}) {
  const { employee, isAdmin } = useCurrentEmployee();
  const candidates = useOwnerCandidates();
  const me = employee?.id || null;
  const saved = savedOwnerId || null;
  const isOwner = Boolean(me && saved === me);
  const canChoose = isAdmin || isOwner || !saved;
  const options = isAdmin || isOwner ? candidates : candidates.filter((candidate) => candidate.id === me);
  const savedPerson = candidates.find((candidate) => candidate.id === saved) || null;
  const missingSelected = value && !options.some((candidate) => candidate.id === value);

  const hint = isAdmin
    ? 'Jako administrator możesz przypisać klienta dowolnej osobie.'
    : isOwner
      ? 'Jesteś opiekunem — możesz przekazać klienta innej osobie albo go zwolnić.'
      : !saved
        ? 'Klient nie ma opiekuna — możesz przypisać go sobie. Innej osobie przypisuje administrator.'
        : `Opiekunem jest ${fullName(savedPerson)}. Zmienić przypisanie może tylko ta osoba albo administrator.`;

  return (
    <label className="block text-xs text-gray-400">Opiekun
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={!canChoose}
        className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60">
        <option value="">Brak opiekuna</option>
        {missingSelected && <option value={value}>{value === saved ? fullName(savedPerson) : 'Obecny opiekun'}</option>}
        {options.map((candidate) => <option key={candidate.id} value={candidate.id}>{fullName(candidate)}</option>)}
      </select>
      <span className="mt-1 block text-[11px] leading-4 text-gray-500">{hint}</span>
    </label>
  );
}
