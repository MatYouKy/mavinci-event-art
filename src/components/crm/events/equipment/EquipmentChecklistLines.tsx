'use client';
/* eslint-disable @next/next/no-img-element */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ImagePlus, Loader2, Minus, Package, Plus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useDialog } from '@/contexts/DialogContext';
import {
  EQUIPMENT_KIND_LABELS,
  EQUIPMENT_RETURN_PHOTO_BUCKET,
  EQUIPMENT_RETURN_PHOTO_LIMIT,
  EQUIPMENT_SHORTAGE_LABELS,
  equipmentLineTone,
  equipmentLoadbackError,
  equipmentPackedError,
  equipmentReturnError,
  equipmentReturnMissing,
  equipmentReturnPhotoPath,
  type EquipmentChecklistLine,
} from '@/lib/events/equipment/equipmentChecklist';
import {
  EQUIPMENT_TONE_CHIP,
  EQUIPMENT_TONE_ROW,
  equipmentByLine,
  equipmentErrorMessage,
  equipmentInputClass,
  equipmentPhotoUrl,
  equipmentQuietButton,
  equipmentToneLabel,
} from './equipmentChecklistUi';
import type { EquipmentChecklistRunResult } from './useEquipmentChecklist';

type SaveResult = Promise<EquipmentChecklistRunResult>;

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const fullButton =
  'inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-45';
const saveButton =
  'inline-flex items-center gap-1 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-xs font-medium text-[#210811] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-45';

const onEnter = (action: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    action();
  }
};

/** Ilość 0..max: przyciski −/+ i pole liczby (puste = nieodhaczone). */
function QtyStepper({
  value,
  max,
  onChange,
  onSubmit,
  disabled,
  label,
  allowEmpty = true,
}: {
  value: number | null;
  max: number;
  onChange: (value: number | null) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  label: string;
  allowEmpty?: boolean;
}) {
  return (
    <div className="inline-flex items-center rounded-lg bg-black/25" role="group" aria-label={label}>
      <button
        type="button"
        disabled={disabled || (value != null && value <= 0)}
        onClick={() => onChange(Math.max((value ?? max) - 1, 0))}
        aria-label={`${label}: mniej`}
        className="rounded-l-lg p-2 text-[#e5e4e2]/80 hover:bg-white/10 disabled:opacity-35"
      >
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        step={1}
        value={value ?? ''}
        disabled={disabled}
        aria-label={label}
        onKeyDown={onSubmit ? onEnter(onSubmit) : undefined}
        onChange={event => {
          const raw = event.target.value;
          if (raw === '') {
            onChange(allowEmpty ? null : 0);
            return;
          }
          const parsed = Math.trunc(Number(raw));
          if (Number.isFinite(parsed)) onChange(Math.min(Math.max(parsed, 0), max));
        }}
        className="w-12 bg-transparent py-1.5 text-center text-sm tabular-nums text-[#e5e4e2] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="pr-1 text-xs tabular-nums text-[#e5e4e2]/45">/ {max}</span>
      <button
        type="button"
        disabled={disabled || (value != null && value >= max)}
        onClick={() => onChange(value == null ? max : Math.min(value + 1, max))}
        aria-label={`${label}: więcej`}
        className="rounded-r-lg p-2 text-[#e5e4e2]/80 hover:bg-white/10 disabled:opacity-35"
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function LineHead({ line, chip, chipClass, summary }: { line: EquipmentChecklistLine; chip: string; chipClass: string; summary: string }) {
  const flags = [
    EQUIPMENT_KIND_LABELS[line.kind],
    line.optional && 'opcjonalne',
    line.external_rental && 'wynajem zewnętrzny',
    line.removed && 'usunięte z oferty',
  ].filter(Boolean);
  return (
    <div className="flex items-start gap-3">
      {line.thumbnail_url ? (
        <img src={line.thumbnail_url} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-md bg-black/20 object-cover" />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-black/20">
          <Package className="h-4 w-4 text-[#e5e4e2]/35" aria-hidden />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium text-[#e5e4e2]">{line.name}</p>
        <p className="mt-0.5 text-xs text-[#e5e4e2]/50">{flags.join(' · ')}</p>
        {line.notes && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-[#e5e4e2]/60">{line.notes}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        <span data-brand-badge="true" className={`rounded-md px-2 py-0.5 text-[11px] ${chipClass}`}>
          {chip}
        </span>
        <span className="text-xs tabular-nums text-[#e5e4e2]/70">{summary}</span>
      </div>
    </div>
  );
}

function LineError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-2 rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200">
      {message}
    </p>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-[11px] text-[#e5e4e2]/45">{children}</p>;
}

// ---------------------------------------------------------------------------------------------------------------
// Etap 1 — wydanie
// ---------------------------------------------------------------------------------------------------------------
export function DispatchLine({
  line,
  canEdit,
  busy,
  onSave,
}: {
  line: EquipmentChecklistLine;
  canEdit: boolean;
  busy: boolean;
  onSave: (qty: number | null, reason: string | null) => SaveResult;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const tone = equipmentLineTone(line, 'dispatch');
  const shownQty = editing ? qty : line.packed_qty;
  const short = shownQty != null && shownQty < line.quantity;

  const change = (next: number | null) => {
    if (!editing) setReason(line.shortage_reason ?? '');
    setQty(next);
    setEditing(true);
    setError('');
  };
  const cancel = () => {
    setEditing(false);
    setError('');
  };
  const save = async () => {
    if (busy) return;
    const problem = equipmentPackedError(line, qty, reason);
    if (problem) {
      setError(problem);
      return;
    }
    const result = await onSave(qty, qty != null && qty < line.quantity ? reason.trim() || null : null);
    if (result.ok) cancel();
    else setError(result.message);
  };
  const quick = async (value: number | null) => {
    if (busy) return;
    setError('');
    const result = await onSave(value, null);
    if (result.ok) cancel();
    else setError(result.message);
  };

  const chip = line.shortage_status !== 'none' ? EQUIPMENT_SHORTAGE_LABELS[line.shortage_status] : equipmentToneLabel(tone, 'dispatch');
  const summary = line.packed_qty == null ? `${line.quantity} szt.` : `${line.packed_qty}/${line.quantity} szt.`;

  return (
    <li className={`rounded-lg px-3 py-2.5 ${EQUIPMENT_TONE_ROW[tone]}`} aria-busy={busy}>
      <LineHead line={line} chip={chip} chipClass={EQUIPMENT_TONE_CHIP[tone]} summary={summary} />

      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <QtyStepper value={shownQty} max={line.quantity} onChange={change} onSubmit={() => void save()} disabled={busy} label={`Spakowano: ${line.name}`} />
          {(editing || line.packed_qty !== line.quantity) && (
            <button type="button" disabled={busy} onClick={() => void quick(line.quantity)} className={fullButton}>
              Pełna ilość
            </button>
          )}
          {!editing && line.packed_qty != null && (
            <button type="button" disabled={busy} onClick={() => void quick(null)} className={equipmentQuietButton}>
              Odznacz
            </button>
          )}
          {editing && (
            <>
              <button type="button" disabled={busy} onClick={() => void save()} className={saveButton}>
                Zapisz
              </button>
              <button type="button" disabled={busy} onClick={cancel} className={equipmentQuietButton}>
                Anuluj
              </button>
            </>
          )}
          {busy && <Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" aria-label="Zapisywanie" />}
        </div>
      )}

      {editing && short && (
        <div className="mt-2">
          <label htmlFor={`${id}-reason`} className="block text-xs text-[#e5e4e2]/65">
            Powód braku ({line.quantity - (qty ?? 0)} szt.){line.required ? <span className="text-[#d3bb73]"> *</span> : ' — opcjonalnie'}
          </label>
          <input
            id={`${id}-reason`}
            value={reason}
            maxLength={1000}
            disabled={busy}
            placeholder="np. uszkodzony, wypożyczony gdzie indziej"
            onKeyDown={onEnter(() => void save())}
            onChange={event => {
              setReason(event.target.value);
              if (error) setError('');
            }}
            className={`mt-1 ${equipmentInputClass}`}
          />
        </div>
      )}

      {!editing && line.packed_qty != null && line.shortage_qty > 0 && (
        <div className="mt-2 rounded-md bg-black/15 px-2.5 py-1.5 text-xs text-[#e5e4e2]/80">
          <p>
            <span className={line.required ? 'font-medium text-red-200' : 'font-medium text-[#e5e4e2]/70'}>Brak {line.shortage_qty} szt.</span>
            {line.shortage_reason ? ` — ${line.shortage_reason}` : ''}
          </p>
          {line.shortage_decided_at && line.shortage_status !== 'pending' && (
            <p className="mt-0.5 text-[#e5e4e2]/60">
              {line.shortage_status === 'approved' ? 'Zgoda' : 'Odmowa'}: {equipmentByLine(line.shortage_decided_name, line.shortage_decided_at)}
              {line.shortage_decision_note ? ` — ${line.shortage_decision_note}` : ''}
            </p>
          )}
        </div>
      )}

      <LineError message={error} />
      {line.packed_at && <Meta>Spakował(a): {equipmentByLine(line.packed_by_name, line.packed_at)}</Meta>}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Etap 2 — załadunek powrotny
// ---------------------------------------------------------------------------------------------------------------
export function LoadbackLine({
  line,
  canEdit,
  busy,
  onSave,
}: {
  line: EquipmentChecklistLine;
  canEdit: boolean;
  busy: boolean;
  onSave: (qty: number | null, note: string | null) => SaveResult;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const tone = equipmentLineTone(line, 'loadback');
  const shipped = line.shipped_qty;
  const shownQty = editing ? qty : line.loadback_qty;

  const change = (next: number | null) => {
    if (!editing) setNote(line.loadback_note ?? '');
    setQty(next);
    setEditing(true);
    setError('');
  };
  const cancel = () => {
    setEditing(false);
    setError('');
  };
  const save = async () => {
    if (busy) return;
    const problem = equipmentLoadbackError(line, qty, note);
    if (problem) {
      setError(problem);
      return;
    }
    const result = await onSave(qty, qty == null ? null : note.trim() || null);
    if (result.ok) cancel();
    else setError(result.message);
  };
  const quick = async (value: number | null) => {
    if (busy) return;
    setError('');
    const result = await onSave(value, null);
    if (result.ok) cancel();
    else setError(result.message);
  };

  const summary = line.loadback_qty == null ? `wydano ${shipped} szt.` : `${line.loadback_qty}/${shipped} szt.`;

  return (
    <li className={`rounded-lg px-3 py-2.5 ${EQUIPMENT_TONE_ROW[tone]}`} aria-busy={busy}>
      <LineHead line={line} chip={equipmentToneLabel(tone, 'loadback')} chipClass={EQUIPMENT_TONE_CHIP[tone]} summary={summary} />

      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <QtyStepper value={shownQty} max={shipped} onChange={change} onSubmit={() => void save()} disabled={busy} label={`Wraca: ${line.name}`} />
          {(editing || line.loadback_qty !== shipped) && (
            <button type="button" disabled={busy} onClick={() => void quick(shipped)} className={fullButton}>
              Wraca komplet
            </button>
          )}
          {!editing && line.loadback_qty != null && (
            <button type="button" disabled={busy} onClick={() => void quick(null)} className={equipmentQuietButton}>
              Odznacz
            </button>
          )}
          {editing && (
            <>
              <button type="button" disabled={busy} onClick={() => void save()} className={saveButton}>
                Zapisz
              </button>
              <button type="button" disabled={busy} onClick={cancel} className={equipmentQuietButton}>
                Anuluj
              </button>
            </>
          )}
          {busy && <Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" aria-label="Zapisywanie" />}
        </div>
      )}

      {editing && qty != null && qty < shipped && (
        <div className="mt-2">
          <label htmlFor={`${id}-note`} className="block text-xs text-[#e5e4e2]/65">
            Co się stało z brakującymi {shipped - qty} szt.? <span className="text-[#d3bb73]">*</span>
          </label>
          <input
            id={`${id}-note`}
            value={note}
            maxLength={1000}
            disabled={busy}
            placeholder="np. zostało na obiekcie, zaginęło, uszkodzone"
            onKeyDown={onEnter(() => void save())}
            onChange={event => {
              setNote(event.target.value);
              if (error) setError('');
            }}
            className={`mt-1 ${equipmentInputClass}`}
          />
        </div>
      )}

      {!editing && line.loadback_note && (
        <p className="mt-2 rounded-md bg-black/15 px-2.5 py-1.5 text-xs text-[#e5e4e2]/80">
          {line.loadback_qty != null && line.loadback_qty < shipped && (
            <span className="font-medium text-red-200">Brak {shipped - line.loadback_qty} szt. — </span>
          )}
          {line.loadback_note}
        </p>
      )}

      <LineError message={error} />
      {line.loadback_at && <Meta>Sprawdził(a): {equipmentByLine(line.loadback_by_name, line.loadback_at)}</Meta>}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Etap 3 — zwrot na magazyn (sprawne / uszkodzone / brak, opis, zdjęcia)
// ---------------------------------------------------------------------------------------------------------------
export function ReturnLine({
  eventId,
  line,
  canEdit,
  busy,
  onSave,
}: {
  eventId: string;
  line: EquipmentChecklistLine;
  canEdit: boolean;
  busy: boolean;
  /** `photos` null = bez zmiany zdjęć. */
  onSave: (ok: number | null, damaged: number, note: string | null, photos: string[] | null) => SaveResult;
}) {
  const id = useId();
  const { showConfirm } = useDialog();
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [ok, setOk] = useState<number | null>(null);
  const [damaged, setDamaged] = useState(0);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const tone = equipmentLineTone(line, 'return');
  const shipped = line.shipped_qty;
  const shownOk = editing ? ok : line.return_ok_qty;
  const shownDamaged = editing ? damaged : line.return_damaged_qty ?? 0;
  const missing = shownOk == null ? null : equipmentReturnMissing(line, shownOk, shownDamaged);
  const working = busy || uploading;

  const begin = () => {
    if (editing) return { ok, damaged };
    setNote(line.return_note ?? '');
    setEditing(true);
    return { ok: line.return_ok_qty, damaged: line.return_damaged_qty ?? 0 };
  };
  const changeOk = (next: number | null) => {
    const current = begin();
    setOk(next);
    setDamaged(next == null ? 0 : Math.min(current.damaged, Math.max(shipped - next, 0)));
    setError('');
  };
  const changeDamaged = (next: number | null) => {
    const current = begin();
    const value = next ?? 0;
    setDamaged(value);
    setOk(current.ok == null ? Math.max(shipped - value, 0) : Math.min(current.ok, Math.max(shipped - value, 0)));
    setError('');
  };
  const cancel = () => {
    setEditing(false);
    setError('');
  };
  const save = async () => {
    if (working) return;
    const problem = equipmentReturnError(line, ok, damaged, note);
    if (problem) {
      setError(problem);
      return;
    }
    const result = await onSave(ok, damaged, note.trim() || null, null);
    if (result.ok) cancel();
    else setError(result.message);
  };
  const quick = async (value: number | null) => {
    if (working) return;
    setError('');
    const result = await onSave(value, 0, value == null ? null : line.return_note, null);
    if (result.ok) cancel();
    else setError(result.message);
  };

  // Zdjęcia zapisujemy z zapisanym stanem pozycji (wpisane, niezapisane ilości zostają w formularzu).
  const savePhotos = (photos: string[]) => onSave(line.return_ok_qty, line.return_damaged_qty ?? 0, line.return_note, photos);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length || working) return;
    const room = EQUIPMENT_RETURN_PHOTO_LIMIT - line.return_photos.length;
    if (room <= 0) {
      setPhotoError(`Najwyżej ${EQUIPMENT_RETURN_PHOTO_LIMIT} zdjęć na pozycję.`);
      return;
    }
    const images = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (!images.length) {
      setPhotoError('Wybierz pliki zdjęć (JPG, PNG, HEIC).');
      return;
    }
    const tooBig = images.find(file => file.size > MAX_PHOTO_BYTES);
    if (tooBig) {
      setPhotoError(`Zdjęcie „${tooBig.name}” ma więcej niż 15 MB.`);
      return;
    }
    const batch = images.slice(0, room);
    const uploaded: string[] = [];
    const storage = supabase.storage.from(EQUIPMENT_RETURN_PHOTO_BUCKET);
    setUploading(true);
    setPhotoError('');
    try {
      for (const file of batch) {
        const path = equipmentReturnPhotoPath(eventId, line.id, file.name);
        const { error: uploadError } = await storage.upload(path, file, {
          contentType: file.type || 'image/jpeg',
          cacheControl: '3600',
          upsert: false,
        });
        if (uploadError) throw uploadError;
        uploaded.push(path);
      }
      const result = await savePhotos([...line.return_photos, ...uploaded]);
      if (!result.ok) {
        await storage.remove(uploaded);
        setPhotoError(result.message);
      } else if (images.length > batch.length) {
        setPhotoError(`Dodano ${batch.length} zdj. — limit to ${EQUIPMENT_RETURN_PHOTO_LIMIT} na pozycję.`);
      }
    } catch (uploadError) {
      if (uploaded.length) await storage.remove(uploaded);
      setPhotoError(equipmentErrorMessage(uploadError, 'Nie udało się wysłać zdjęcia.'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const removePhoto = async (path: string) => {
    if (working) return;
    const confirmed = await showConfirm({ title: 'Usunąć zdjęcie?', message: 'Zdjęcie zniknie z pozycji zwrotu.', confirmText: 'Usuń' });
    if (!confirmed) return;
    setPhotoError('');
    const result = await savePhotos(line.return_photos.filter(item => item !== path));
    if (!result.ok) setPhotoError(result.message);
  };

  const summary =
    line.return_ok_qty == null
      ? `wydano ${shipped} szt.`
      : [`sprawne ${line.return_ok_qty}`, line.return_damaged_qty ? `uszk. ${line.return_damaged_qty}` : '', line.return_missing_qty ? `brak ${line.return_missing_qty}` : '']
          .filter(Boolean)
          .join(' · ') + ` / ${shipped}`;
  const needsNote = editing && ok != null && (damaged > 0 || (missing ?? 0) > 0);

  return (
    <li className={`rounded-lg px-3 py-2.5 ${EQUIPMENT_TONE_ROW[tone]}`} aria-busy={working}>
      <LineHead line={line} chip={equipmentToneLabel(tone, 'return')} chipClass={EQUIPMENT_TONE_CHIP[tone]} summary={summary} />

      {canEdit && (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div>
            <p className="mb-1 text-[11px] text-[#e5e4e2]/55">Sprawne</p>
            <QtyStepper value={shownOk} max={shipped} onChange={changeOk} onSubmit={() => void save()} disabled={working} label={`Sprawne: ${line.name}`} />
          </div>
          <div>
            <p className="mb-1 text-[11px] text-[#e5e4e2]/55">Uszkodzone</p>
            <QtyStepper
              value={shownDamaged}
              max={shipped}
              allowEmpty={false}
              onChange={changeDamaged}
              onSubmit={() => void save()}
              disabled={working}
              label={`Uszkodzone: ${line.name}`}
            />
          </div>
          <div className="pb-2 text-xs">
            <span className="text-[#e5e4e2]/55">Brak: </span>
            <span className={`tabular-nums ${missing ? 'font-medium text-red-200' : 'text-[#e5e4e2]/80'}`}>{missing ?? '—'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-0.5">
            {(editing || line.return_ok_qty !== shipped) && (
              <button type="button" disabled={working} onClick={() => void quick(shipped)} className={fullButton}>
                Komplet sprawny
              </button>
            )}
            {!editing && line.return_ok_qty != null && (
              <button type="button" disabled={working} onClick={() => void quick(null)} className={equipmentQuietButton}>
                Odznacz
              </button>
            )}
            {editing && (
              <>
                <button type="button" disabled={working} onClick={() => void save()} className={saveButton}>
                  Zapisz
                </button>
                <button type="button" disabled={working} onClick={cancel} className={equipmentQuietButton}>
                  Anuluj
                </button>
              </>
            )}
            {busy && <Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" aria-label="Zapisywanie" />}
          </div>
        </div>
      )}

      {editing && (needsNote || note) && (
        <div className="mt-2">
          <label htmlFor={`${id}-note`} className="block text-xs text-[#e5e4e2]/65">
            Opis uszkodzeń lub braku{needsNote ? <span className="text-[#d3bb73]"> *</span> : ' — opcjonalnie'}
          </label>
          <textarea
            id={`${id}-note`}
            rows={2}
            value={note}
            maxLength={2000}
            disabled={working}
            placeholder="Co, ile, co się stało"
            onChange={event => {
              setNote(event.target.value);
              if (error) setError('');
            }}
            className={`mt-1 ${equipmentInputClass}`}
          />
        </div>
      )}

      {!editing && line.return_note && (
        <p className="mt-2 whitespace-pre-wrap rounded-md bg-black/15 px-2.5 py-1.5 text-xs text-[#e5e4e2]/80">{line.return_note}</p>
      )}

      {(line.return_photos.length > 0 || canEdit) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {line.return_photos.map((path, index) => (
            <div key={path} className="relative">
              <a href={equipmentPhotoUrl(path)} target="_blank" rel="noopener noreferrer" aria-label={`Zdjęcie ${index + 1}: ${line.name}`}>
                <img src={equipmentPhotoUrl(path)} alt="" loading="lazy" className="h-14 w-14 rounded-md bg-black/20 object-cover" />
              </a>
              {canEdit && (
                <button
                  type="button"
                  disabled={working}
                  onClick={() => void removePhoto(path)}
                  aria-label={`Usuń zdjęcie ${index + 1}`}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-[#1c1f33] p-0.5 text-[#e5e4e2]/80 hover:text-red-300 disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
          ))}
          {canEdit && line.return_photos.length < EQUIPMENT_RETURN_PHOTO_LIMIT && (
            <>
              <input
                ref={inputRef}
                id={`${id}-photos`}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                disabled={working}
                onChange={event => void addPhotos(event.target.files)}
              />
              <label
                htmlFor={`${id}-photos`}
                className={`${equipmentQuietButton} cursor-pointer ${working ? 'pointer-events-none opacity-45' : ''}`}
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden />}
                {uploading ? 'Wysyłanie…' : `Dodaj zdjęcia (${line.return_photos.length}/${EQUIPMENT_RETURN_PHOTO_LIMIT})`}
              </label>
            </>
          )}
        </div>
      )}

      <LineError message={error || photoError} />
      {line.returned_at && <Meta>Sprawdził(a): {equipmentByLine(line.returned_by_name, line.returned_at)}</Meta>}
    </li>
  );
}
