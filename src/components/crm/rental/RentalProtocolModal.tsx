'use client';

import { useMemo, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  issueRental,
  rentalErrorMessage,
  rentalOutQty,
  returnRental,
  uploadRentalPhoto,
  type RentalDetail,
} from '@/lib/CRM/rental/rental';
import { RentalError, RentalField, RentalModal, numberOrNull, rentalButton, rentalInput, rentalPrimaryButton } from './rentalUi';

/*
 * Protokół wydania (WZ) i odbioru (PZ) — magazyn. Wydanie: ilość do wydania (mniej niż zostało — z opisem braku). Odbiór:
 * sprawne / uszkodzone / brak (rozbieżność z opisem, zdjęcia). Po zapisie — PDF do wydruku i podpisu (skan dodaje się
 * w protokole na karcie wypożyczenia).
 */

type Row = { item_id: string; name: string; unit: string; max: number; qty: string; damaged: string; missing: string; note: string; photos: string[] };

export default function RentalProtocolModal({
  rental,
  kind,
  onClose,
  onSaved,
}: {
  rental: RentalDetail;
  kind: 'issue' | 'return';
  onClose: () => void;
  onSaved: (protocolId: string) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const issue = kind === 'issue';
  const [rows, setRows] = useState<Row[]>(() =>
    rental.items
      .filter((item) => item.kind === 'equipment')
      .map((item) => {
        const max = issue ? item.quantity - item.issued_qty : rentalOutQty(item);
        return { item_id: item.id, name: item.name, unit: item.unit, max, qty: String(max), damaged: '0', missing: '0', note: '', photos: [] };
      })
      .filter((row) => row.max > 0),
  );
  const [person, setPerson] = useState(issue ? rental.recipient_name || '' : rental.recipient_name || '');
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (itemId: string, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.item_id === itemId ? { ...row, ...patch } : row)));
  const count = (value: string) => Math.max(0, Math.floor(numberOrNull(value) ?? 0));

  const problems = useMemo(() => rows.flatMap((row) => {
    const qty = count(row.qty);
    const damaged = issue ? 0 : count(row.damaged);
    const missing = issue ? 0 : count(row.missing);
    const list: string[] = [];
    if (qty + damaged + missing > row.max) list.push(`„${row.name}”: najwyżej ${row.max} ${row.unit}`);
    if (issue && qty > 0 && qty < row.max && row.note.trim().length < 3) list.push(`„${row.name}”: opisz brak przy wydaniu`);
    if (!issue && damaged + missing > 0 && row.note.trim().length < 3) list.push(`„${row.name}”: opisz uszkodzenia lub brak`);
    return list;
  }), [issue, rows]);

  const addPhotos = async (itemId: string, files: FileList | null) => {
    if (!files?.length) return;
    setUploading(itemId);
    setError(null);
    try {
      const paths: string[] = [];
      for (const file of Array.from(files).slice(0, 10)) {
        paths.push(await uploadRentalPhoto(supabase, rental.id, { body: file, name: file.name, type: file.type, size: file.size }));
      }
      setRows((current) => current.map((row) => (row.item_id === itemId ? { ...row, photos: [...row.photos, ...paths].slice(0, 10) } : row)));
    } catch (failure) {
      setError(rentalErrorMessage(failure, 'Nie udało się przesłać zdjęcia.'));
    } finally {
      setUploading(null);
    }
  };

  const submit = async () => {
    setError(null);
    if (person.trim().length < 2) return setError(issue ? 'Podaj, kto odbiera sprzęt.' : 'Podaj, kto zwraca sprzęt.');
    if (problems.length) return setError(problems.join('; '));
    setSaving(true);
    try {
      const protocolId = issue
        ? await issueRental(supabase, rental.id,
          rows.filter((row) => count(row.qty) > 0).map((row) => ({ item_id: row.item_id, qty: count(row.qty), note: row.note.trim() || null, photos: row.photos })),
          person.trim(), note.trim() || null)
        : await returnRental(supabase, rental.id,
          rows.filter((row) => count(row.qty) + count(row.damaged) + count(row.missing) > 0).map((row) => ({
            item_id: row.item_id, ok: count(row.qty), damaged: count(row.damaged), missing: count(row.missing), note: row.note.trim() || null, photos: row.photos,
          })),
          person.trim(), note.trim() || null);
      showSnackbar(issue ? 'Zapisano protokół wydania' : 'Zapisano protokół odbioru', 'success');
      onSaved(protocolId);
    } catch (failure) {
      setError(rentalErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <RentalModal
      wide
      title={issue ? 'Protokół wydania' : 'Protokół odbioru'}
      subtitle={`${rental.number} · ${rental.client_name}${issue ? '' : ' · wpisz, co wróciło sprawne, uszkodzone i czego brakuje'}`}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-xs text-[#e5e4e2]/50">Po zapisie pobierzesz PDF do podpisu; skan podpisanego protokołu dodasz na karcie wypożyczenia.</span>
          <button type="button" className={rentalButton} onClick={onClose} disabled={saving}>Anuluj</button>
          <button type="button" className={rentalPrimaryButton} onClick={submit} disabled={saving || rows.length === 0 || uploading !== null}>
            {saving ? 'Zapisywanie…' : issue ? 'Zapisz wydanie' : 'Zapisz odbiór'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <RentalError message={error} />
        {rows.length === 0 ? (
          <p className="rounded-xl border border-white/10 p-6 text-center text-sm text-[#e5e4e2]/60">
            {issue ? 'Cały sprzęt został już wydany.' : 'U klienta nie ma już sprzętu z tego wypożyczenia.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-[#e5e4e2]/50">
                <tr>
                  <th className="py-2 pr-2 font-normal">Pozycja</th>
                  <th className="w-24 py-2 pr-2 font-normal">{issue ? 'Wydaję' : 'Sprawne'}</th>
                  {!issue && <th className="w-24 py-2 pr-2 font-normal">Uszkodzone</th>}
                  {!issue && <th className="w-24 py-2 pr-2 font-normal">Brak</th>}
                  <th className="py-2 pr-2 font-normal">Opis / zdjęcia</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.item_id} className="border-t border-white/5 align-top">
                    <td className="py-2 pr-2">
                      <p className="font-medium text-[#e5e4e2]">{row.name}</p>
                      <p className="text-xs text-[#e5e4e2]/50">{issue ? `Do wydania: ${row.max} ${row.unit}` : `U klienta: ${row.max} ${row.unit}`}</p>
                    </td>
                    <td className="py-2 pr-2"><input value={row.qty} onChange={(event) => update(row.item_id, { qty: event.target.value })} inputMode="numeric" className={rentalInput} /></td>
                    {!issue && <td className="py-2 pr-2"><input value={row.damaged} onChange={(event) => update(row.item_id, { damaged: event.target.value })} inputMode="numeric" className={rentalInput} /></td>}
                    {!issue && <td className="py-2 pr-2"><input value={row.missing} onChange={(event) => update(row.item_id, { missing: event.target.value })} inputMode="numeric" className={rentalInput} /></td>}
                    <td className="space-y-1 py-2 pr-2">
                      <input value={row.note} onChange={(event) => update(row.item_id, { note: event.target.value })}
                        placeholder={issue ? 'Uwagi (wymagane przy wydaniu mniejszej ilości)' : 'Opis uszkodzeń lub braku'} className={rentalInput} />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className={`${rentalButton} cursor-pointer py-1 text-xs`}>
                          <Camera className="h-3.5 w-3.5" />{uploading === row.item_id ? 'Przesyłanie…' : 'Zdjęcia'}
                          <input type="file" accept="image/*" multiple className="hidden" disabled={uploading !== null}
                            onChange={(event) => { void addPhotos(row.item_id, event.target.files); event.target.value = ''; }} />
                        </label>
                        {row.photos.map((path, index) => (
                          <span key={path} className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-xs text-[#e5e4e2]/70">
                            Zdjęcie {index + 1}
                            <button type="button" aria-label="Usuń zdjęcie" onClick={() => update(row.item_id, { photos: row.photos.filter((item) => item !== path) })}>
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <RentalField label={issue ? 'Odbiera (imię i nazwisko)' : 'Zwraca (imię i nazwisko)'}>
            <input value={person} onChange={(event) => setPerson(event.target.value)} className={rentalInput} />
          </RentalField>
          <RentalField label="Uwagi do protokołu">
            <input value={note} onChange={(event) => setNote(event.target.value)} className={rentalInput} />
          </RentalField>
        </div>
      </div>
    </RentalModal>
  );
}
