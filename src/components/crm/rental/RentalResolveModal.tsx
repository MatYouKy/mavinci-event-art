'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  RENTAL_RESOLVE_LABELS,
  rentalErrorMessage,
  rentalItemUnits,
  resolveRentalItem,
  type RentalDetail,
  type RentalItem,
  type RentalResolveAction,
  type RentalUnit,
} from '@/lib/CRM/rental/rental';
import { RentalError, RentalField, RentalModal, numberOrNull, rentalButton, rentalInput, rentalPrimaryButton } from './rentalUi';

/*
 * Rozbieżność pozycji po zwrocie (magazyn): uszkodzone — sprawne po sprawdzeniu / do serwisu / spisz ze stanu; brak — oddane
 * później / spisz ze stanu. Serwis i spisanie wskazują egzemplarze (status „Uszkodzony” / „Wycofany”), sprzęt bez egzemplarzy —
 * spisanie zmniejsza ilość. Do rozstrzygnięcia sztuki zajmują stan magazynu.
 */

const UNIT_STATUS: Record<string, string> = { available: 'Dostępny', damaged: 'Uszkodzony', in_service: 'W serwisie', retired: 'Wycofany', reserved: 'Zarezerwowany', in_use: 'W użyciu' };

export default function RentalResolveModal({ rental, item, onClose, onSaved }: { rental: RentalDetail; item: RentalItem; onClose: () => void; onSaved: (rental: RentalDetail) => void }) {
  const { showSnackbar } = useSnackbar();
  const actions = useMemo(() => {
    const list: RentalResolveAction[] = [];
    if (item.open_damaged > 0) list.push('damaged_back', ...(item.has_units ? ['damaged_service' as const] : []), 'damaged_write_off');
    if (item.open_missing > 0) list.push('missing_back', 'missing_write_off');
    return list;
  }, [item]);
  const [action, setAction] = useState<RentalResolveAction>(actions[0] || 'damaged_back');
  const open = action.startsWith('damaged') ? item.open_damaged : item.open_missing;
  const [qty, setQty] = useState(String(open));
  const [note, setNote] = useState('');
  const [units, setUnits] = useState<RentalUnit[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsUnits = item.has_units && (action === 'damaged_service' || action.endsWith('write_off'));
  const needsNote = action === 'damaged_service' || action.endsWith('write_off');

  useEffect(() => {
    setQty(String(action.startsWith('damaged') ? item.open_damaged : item.open_missing));
    setSelected([]);
  }, [action, item.open_damaged, item.open_missing]);

  useEffect(() => {
    if (!needsUnits) return;
    let alive = true;
    rentalItemUnits(supabase, item.id)
      .then((rows) => alive && setUnits(rows.filter((unit) => ['available', 'reserved', 'in_use'].includes(unit.status))))
      .catch((failure) => alive && setError(rentalErrorMessage(failure, 'Nie udało się pobrać egzemplarzy.')));
    return () => {
      alive = false;
    };
  }, [item.id, needsUnits]);

  const amount = Math.max(0, Math.floor(numberOrNull(qty) ?? 0));

  const submit = async () => {
    setError(null);
    if (amount < 1 || amount > open) return setError(`Podaj ilość od 1 do ${open}.`);
    if (needsUnits && selected.length !== amount) return setError(`Zaznacz ${amount} egzemplarz(e/y).`);
    if (needsNote && note.trim().length < 3) return setError('Opisz decyzję (stan, przyczyna).');
    setSaving(true);
    try {
      const saved = await resolveRentalItem(supabase, item.id, action, amount, needsUnits ? selected : null, note.trim() || null);
      showSnackbar('Zapisano rozstrzygnięcie', 'success');
      onSaved(saved);
    } catch (failure) {
      setError(rentalErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <RentalModal
      title="Rozbieżność po zwrocie"
      subtitle={`${rental.number} · ${item.name} · uszkodzone: ${item.open_damaged}, brak: ${item.open_missing}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={rentalButton} onClick={onClose} disabled={saving}>Anuluj</button>
          <button type="button" className={rentalPrimaryButton} onClick={submit} disabled={saving || !actions.length}>{saving ? 'Zapisywanie…' : 'Zapisz'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <RentalError message={error} />
        <RentalField label="Decyzja">
          <div className="grid gap-2 sm:grid-cols-2">
            {actions.map((value) => (
              <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${action === value ? 'border-[#d3bb73]/60 bg-[#d3bb73]/10 text-[#e5e4e2]' : 'border-white/10 text-[#e5e4e2]/70'}`}>
                <input type="radio" name="resolve-action" checked={action === value} onChange={() => setAction(value)} />
                <span>{value.startsWith('damaged') ? 'Uszkodzone' : 'Brak'}: {RENTAL_RESOLVE_LABELS[value]}</span>
              </label>
            ))}
          </div>
        </RentalField>
        <RentalField label="Ilość" hint={`Do rozstrzygnięcia: ${open} ${item.unit}`}>
          <input value={qty} onChange={(event) => setQty(event.target.value)} inputMode="numeric" className={rentalInput} />
        </RentalField>
        {needsUnits && (
          <RentalField label={`Egzemplarze (${selected.length} z ${amount})`} hint={action === 'damaged_service' ? 'Dostaną status „Uszkodzony” — wrócą na stan po naprawie w Magazynie.' : 'Dostaną status „Wycofany”.'}>
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-white/10 p-2">
              {units.length === 0 && <li className="p-2 text-sm text-[#e5e4e2]/50">Brak egzemplarzy na stanie.</li>}
              {units.map((unit) => (
                <li key={unit.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-[#e5e4e2] hover:bg-white/5">
                    <input type="checkbox" checked={selected.includes(unit.id)}
                      onChange={(event) => setSelected((current) => (event.target.checked ? [...current, unit.id] : current.filter((id) => id !== unit.id)))} />
                    <span className="flex-1">{unit.serial || 'Bez numeru'}</span>
                    <span className="text-xs text-[#e5e4e2]/50">{[UNIT_STATUS[unit.status] || unit.status, unit.location].filter(Boolean).join(' · ')}</span>
                  </label>
                </li>
              ))}
            </ul>
          </RentalField>
        )}
        <RentalField label={needsNote ? 'Opis (wymagany)' : 'Opis'}>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} className={rentalInput} />
        </RentalField>
      </div>
    </RentalModal>
  );
}
