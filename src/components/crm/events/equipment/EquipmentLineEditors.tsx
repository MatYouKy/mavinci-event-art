'use client';
/* eslint-disable @next/next/no-img-element */
import { useId, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react';
import { ImagePlus, Loader2, Minus, Plus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useDialog } from '@/contexts/DialogContext';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import {
  EQUIPMENT_CHECKLIST_RPC as RPC,
  EQUIPMENT_RETURN_PHOTO_BUCKET,
  EQUIPMENT_RETURN_PHOTO_LIMIT,
  equipmentLoadbackError,
  equipmentPackedError,
  equipmentReturnError,
  equipmentReturnMissing,
  equipmentReturnPhotoPath,
  type EquipmentChecklistPerson,
} from '@/lib/events/equipment/equipmentChecklist';
import {
  equipmentErrorMessage,
  equipmentInputClass,
  equipmentPhotoUrl,
  equipmentPrimaryButton,
  equipmentQuietButton,
  type EquipmentRowChecklist,
} from './equipmentChecklistUi';

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
type AvatarMetadata = ComponentProps<typeof EmployeeAvatar>['avatarMetadata'];

/** Mały awatar osoby z checklisty (jak w zadaniach); bez zdjęcia — inicjał. */
export function EquipmentPersonAvatar({
  person,
  name,
  size = 16,
}: {
  person?: EquipmentChecklistPerson | null;
  name?: string | null;
  size?: number;
}) {
  const label = person?.name || name || 'Pracownik';
  return (
    <span className="inline-flex shrink-0" aria-hidden>
      <EmployeeAvatar
        employeeId={person?.id}
        employeeName={label}
        avatarUrl={person?.avatar_url ?? null}
        avatarMetadata={(person?.avatar_metadata ?? null) as AvatarMetadata}
        size={size}
        className="!border-0"
      />
    </span>
  );
}

const onEnter = (action: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    action();
  }
};

/** Ilość 0..max: przyciski −/+ i pole liczby. */
export function QtyStepper({
  value,
  max,
  onChange,
  onSubmit,
  disabled,
  label,
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="inline-flex items-center rounded-lg bg-black/25" role="group" aria-label={label}>
      <button
        type="button"
        disabled={disabled || value <= 0}
        onClick={() => onChange(Math.max(value - 1, 0))}
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
        value={value}
        disabled={disabled}
        aria-label={label}
        onKeyDown={onSubmit ? onEnter(onSubmit) : undefined}
        onChange={event => {
          const parsed = Math.trunc(Number(event.target.value || 0));
          if (Number.isFinite(parsed)) onChange(Math.min(Math.max(parsed, 0), max));
        }}
        className="w-12 bg-transparent py-1.5 text-center text-sm tabular-nums text-[#e5e4e2] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="pr-1 text-xs tabular-nums text-[#e5e4e2]/45">/ {max}</span>
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(value + 1, max))}
        aria-label={`${label}: więcej`}
        className="rounded-r-lg p-2 text-[#e5e4e2]/80 hover:bg-white/10 disabled:opacity-35"
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function EditorError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200">
      {message}
    </p>
  );
}

function EditorButtons({
  busy,
  onSave,
  onCancel,
  onClear,
  clearLabel = 'Odznacz',
}: {
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  onClear?: () => void;
  clearLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
      {onClear && (
        <button type="button" disabled={busy} onClick={onClear} className={`${equipmentQuietButton} mr-auto`}>
          {clearLabel}
        </button>
      )}
      <button type="button" disabled={busy} onClick={onCancel} className={equipmentQuietButton}>
        Anuluj
      </button>
      <button type="button" disabled={busy} onClick={onSave} className={equipmentPrimaryButton}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
        Zapisz
      </button>
    </div>
  );
}

type EditorProps = EquipmentRowChecklist & { onClose: () => void };

// ---------------------------------------------------------------------------------------------------------------
// Wydanie: ilość spakowana, mniej = powód braku (wymagany przy pozycji wymaganej)
// ---------------------------------------------------------------------------------------------------------------
export function DispatchEditor({ line, busy, save, onClose }: EditorProps) {
  const id = useId();
  const [qty, setQty] = useState<number>(line.packed_qty ?? line.quantity);
  const [reason, setReason] = useState(line.shortage_reason ?? '');
  const [error, setError] = useState('');
  const short = qty < line.quantity;

  const submit = async (value: number | null, why: string | null) => {
    const result = await save(RPC.pack, { p_line: line.id, p_qty: value, p_reason: why });
    if (result.ok) onClose();
    else setError(result.message);
  };
  const onSave = () => {
    if (busy) return;
    const problem = equipmentPackedError(line, qty, reason);
    if (problem) {
      setError(problem);
      return;
    }
    void submit(qty, short ? reason.trim() || null : null);
  };

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-[#e5e4e2]/60">Spakowano (na liście {line.quantity})</p>
      <QtyStepper value={qty} max={line.quantity} onChange={value => { setQty(value); setError(''); }} onSubmit={onSave} disabled={busy} label={`Spakowano: ${line.name}`} />
      {short && (
        <div>
          <label htmlFor={`${id}-reason`} className="block text-xs text-[#e5e4e2]/65">
            Powód braku ({line.quantity - qty} szt.){line.required ? <span className="text-[#d3bb73]"> *</span> : ' — opcjonalnie'}
          </label>
          <input
            id={`${id}-reason`}
            data-autofocus
            value={reason}
            maxLength={1000}
            disabled={busy}
            placeholder="np. uszkodzony, wypożyczony gdzie indziej"
            onKeyDown={onEnter(onSave)}
            onChange={event => {
              setReason(event.target.value);
              setError('');
            }}
            className={`mt-1 ${equipmentInputClass}`}
          />
          {line.required && <p className="mt-1 text-[11px] text-amber-200/80">Brak wymaga zgody sprzedawcy lub administratora.</p>}
        </div>
      )}
      <EditorError message={error} />
      <EditorButtons busy={busy} onSave={onSave} onCancel={onClose} onClear={line.packed_qty != null ? () => void submit(null, null) : undefined} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Po wydarzeniu (kierownik): ile wraca z wydanego, mniej = opis
// ---------------------------------------------------------------------------------------------------------------
export function LoadbackEditor({ line, busy, save, onClose }: EditorProps) {
  const id = useId();
  const shipped = line.shipped_qty;
  const [qty, setQty] = useState<number>(line.loadback_qty ?? shipped);
  const [note, setNote] = useState(line.loadback_note ?? '');
  const [error, setError] = useState('');

  const submit = async (value: number | null, text: string | null) => {
    const result = await save(RPC.loadback, { p_line: line.id, p_qty: value, p_note: text });
    if (result.ok) onClose();
    else setError(result.message);
  };
  const onSave = () => {
    if (busy) return;
    const problem = equipmentLoadbackError(line, qty, note);
    if (problem) {
      setError(problem);
      return;
    }
    void submit(qty, note.trim() || null);
  };

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-[#e5e4e2]/60">Wraca po wydarzeniu (wydano {shipped})</p>
      <QtyStepper value={qty} max={shipped} onChange={value => { setQty(value); setError(''); }} onSubmit={onSave} disabled={busy} label={`Wraca: ${line.name}`} />
      {qty < shipped && (
        <div>
          <label htmlFor={`${id}-note`} className="block text-xs text-[#e5e4e2]/65">
            Co się stało z {shipped - qty} szt.? <span className="text-[#d3bb73]">*</span>
          </label>
          <input
            id={`${id}-note`}
            data-autofocus
            value={note}
            maxLength={1000}
            disabled={busy}
            placeholder="np. zostało na obiekcie, zaginęło, uszkodzone"
            onKeyDown={onEnter(onSave)}
            onChange={event => {
              setNote(event.target.value);
              setError('');
            }}
            className={`mt-1 ${equipmentInputClass}`}
          />
        </div>
      )}
      <EditorError message={error} />
      <EditorButtons busy={busy} onSave={onSave} onCancel={onClose} onClear={line.loadback_qty != null ? () => void submit(null, null) : undefined} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Zwrot (magazyn): sprawne / uszkodzone, brak liczy się sam, opis i zdjęcia
// ---------------------------------------------------------------------------------------------------------------
export function ReturnEditor({ line, busy, save, eventId, onClose }: EditorProps) {
  const id = useId();
  const shipped = line.shipped_qty;
  const [ok, setOk] = useState<number>(line.return_ok_qty ?? shipped);
  const [damaged, setDamaged] = useState<number>(line.return_damaged_qty ?? 0);
  const [note, setNote] = useState(line.return_note ?? '');
  const [error, setError] = useState('');
  const missing = equipmentReturnMissing(line, ok, damaged);
  const needsNote = damaged > 0 || missing > 0;

  const submit = async (value: number | null, broken: number, text: string | null) => {
    const result = await save(RPC.returnLine, { p_line: line.id, p_ok: value, p_damaged: broken, p_note: text, p_photos: null });
    if (result.ok) onClose();
    else setError(result.message);
  };
  const onSave = () => {
    if (busy) return;
    const problem = equipmentReturnError(line, ok, damaged, note);
    if (problem) {
      setError(problem);
      return;
    }
    void submit(ok, damaged, note.trim() || null);
  };

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-[#e5e4e2]/60">Zwrot na magazyn (wydano {shipped})</p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="mb-1 text-[11px] text-[#e5e4e2]/55">Sprawne</p>
          <QtyStepper
            value={ok}
            max={shipped}
            onChange={value => {
              setOk(value);
              setDamaged(current => Math.min(current, Math.max(shipped - value, 0)));
              setError('');
            }}
            onSubmit={onSave}
            disabled={busy}
            label={`Sprawne: ${line.name}`}
          />
        </div>
        <div>
          <p className="mb-1 text-[11px] text-[#e5e4e2]/55">Uszkodzone</p>
          <QtyStepper
            value={damaged}
            max={shipped}
            onChange={value => {
              setDamaged(value);
              setOk(current => Math.min(current, Math.max(shipped - value, 0)));
              setError('');
            }}
            onSubmit={onSave}
            disabled={busy}
            label={`Uszkodzone: ${line.name}`}
          />
        </div>
        <p className="pb-2 text-xs">
          <span className="text-[#e5e4e2]/55">Brak: </span>
          <span className={`tabular-nums ${missing ? 'font-medium text-red-200' : 'text-[#e5e4e2]/80'}`}>{missing}</span>
        </p>
      </div>
      {(needsNote || note) && (
        <div>
          <label htmlFor={`${id}-note`} className="block text-xs text-[#e5e4e2]/65">
            Opis uszkodzeń lub braku{needsNote ? <span className="text-[#d3bb73]"> *</span> : ' — opcjonalnie'}
          </label>
          <textarea
            id={`${id}-note`}
            rows={2}
            value={note}
            maxLength={2000}
            disabled={busy}
            placeholder="Co, ile, co się stało"
            onChange={event => {
              setNote(event.target.value);
              setError('');
            }}
            className={`mt-1 ${equipmentInputClass}`}
          />
        </div>
      )}
      <ReturnPhotos line={line} eventId={eventId} busy={busy} save={save} />
      <EditorError message={error} />
      <EditorButtons busy={busy} onSave={onSave} onCancel={onClose} onClear={line.return_ok_qty != null ? () => void submit(null, 0, null) : undefined} />
    </div>
  );
}

/** Zdjęcia zwrotu: zapis od razu, z zapisanym stanem pozycji (wpisane, niezapisane ilości zostają w formularzu). */
function ReturnPhotos({ line, eventId, busy, save }: Pick<EquipmentRowChecklist, 'line' | 'eventId' | 'busy' | 'save'>) {
  const id = useId();
  const { showConfirm } = useDialog();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const working = busy || uploading;

  const savePhotos = (photos: string[]) =>
    save(RPC.returnLine, {
      p_line: line.id,
      p_ok: line.return_ok_qty,
      p_damaged: line.return_damaged_qty ?? 0,
      p_note: line.return_note,
      p_photos: photos,
    });

  const add = async (files: FileList | null) => {
    if (!files?.length || working) return;
    const room = EQUIPMENT_RETURN_PHOTO_LIMIT - line.return_photos.length;
    if (room <= 0) {
      setError(`Najwyżej ${EQUIPMENT_RETURN_PHOTO_LIMIT} zdjęć na pozycję.`);
      return;
    }
    const images = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (!images.length) {
      setError('Wybierz pliki zdjęć (JPG, PNG, HEIC).');
      return;
    }
    const tooBig = images.find(file => file.size > MAX_PHOTO_BYTES);
    if (tooBig) {
      setError(`Zdjęcie „${tooBig.name}” ma więcej niż 15 MB.`);
      return;
    }
    const batch = images.slice(0, room);
    const uploaded: string[] = [];
    const storage = supabase.storage.from(EQUIPMENT_RETURN_PHOTO_BUCKET);
    setUploading(true);
    setError('');
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
        setError(result.message);
      } else if (images.length > batch.length) {
        setError(`Dodano ${batch.length} zdj. — limit to ${EQUIPMENT_RETURN_PHOTO_LIMIT} na pozycję.`);
      }
    } catch (uploadError) {
      if (uploaded.length) await storage.remove(uploaded);
      setError(equipmentErrorMessage(uploadError, 'Nie udało się wysłać zdjęcia.'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (path: string) => {
    if (working) return;
    const confirmed = await showConfirm({ title: 'Usunąć zdjęcie?', message: 'Zdjęcie zniknie z pozycji zwrotu.', confirmText: 'Usuń' });
    if (!confirmed) return;
    setError('');
    const result = await savePhotos(line.return_photos.filter(item => item !== path));
    if (!result.ok) setError(result.message);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {line.return_photos.map((path, index) => (
          <div key={path} className="relative">
            <a href={equipmentPhotoUrl(path)} target="_blank" rel="noopener noreferrer" aria-label={`Zdjęcie ${index + 1}: ${line.name}`}>
              <img src={equipmentPhotoUrl(path)} alt="" loading="lazy" className="h-12 w-12 rounded-md bg-black/20 object-cover" />
            </a>
            <button
              type="button"
              disabled={working}
              onClick={() => void remove(path)}
              aria-label={`Usuń zdjęcie ${index + 1}`}
              className="absolute -right-1.5 -top-1.5 rounded-full bg-[#1c1f33] p-0.5 text-[#e5e4e2]/80 hover:text-red-300 disabled:opacity-40"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
        {line.return_photos.length < EQUIPMENT_RETURN_PHOTO_LIMIT && (
          <>
            <input
              ref={inputRef}
              id={`${id}-photos`}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={working}
              onChange={event => void add(event.target.files)}
            />
            <label htmlFor={`${id}-photos`} className={`${equipmentQuietButton} cursor-pointer ${working ? 'pointer-events-none opacity-45' : ''}`}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden />}
              {uploading ? 'Wysyłanie…' : `Zdjęcia (${line.return_photos.length}/${EQUIPMENT_RETURN_PHOTO_LIMIT})`}
            </label>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
