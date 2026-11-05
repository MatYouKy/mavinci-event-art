'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  EQUIPMENT_CHECKLIST_RPC as RPC,
  EQUIPMENT_STAGE_TABS,
  equipmentLineActor,
  equipmentLineDone,
  equipmentLineTone,
  type EquipmentChecklistLine,
  type EquipmentStageKey,
} from '@/lib/events/equipment/equipmentChecklist';
import { DispatchEditor, EquipmentPersonAvatar, LoadbackEditor, ReturnEditor } from './EquipmentLineEditors';
import { equipmentByLine, equipmentPhotoUrl, firstName, type EquipmentRowChecklist } from './equipmentChecklistUi';

/*
 * Stan checklisty w wierszu istniejącej listy sprzętu (zakładka Sprzęt): okrągły znacznik, badge z awatarem,
 * powód / opis pod nazwą i chip ilości z małym edytorem. Jedna lista — bez osobnej sekcji.
 */

const FULL_LABEL: Record<EquipmentStageKey, string> = {
  dispatch: 'Spakowane w całości',
  loadback: 'Wraca komplet',
  return: 'Wróciło sprawne',
};

const doneLabel = (stage: EquipmentStageKey) => EQUIPMENT_STAGE_TABS.find(tab => tab.key === stage)?.done ?? 'Gotowe';

/** Ilość „zrobiona” na etapie (null = nieodhaczone) i ilość odniesienia. */
function stageQty(line: EquipmentChecklistLine, stage: EquipmentStageKey): { value: number | null; of: number } {
  if (stage === 'dispatch') return { value: line.packed_qty, of: line.quantity };
  if (stage === 'loadback') return { value: line.loadback_qty, of: line.shipped_qty };
  return { value: line.return_ok_qty, of: line.shipped_qty };
}

export function isEquipmentRowDone(checklist: EquipmentRowChecklist | undefined): boolean {
  return Boolean(checklist && equipmentLineDone(checklist.line, checklist.stage));
}

/** Okrągły znacznik po lewej: dotknięcie = pełna ilość na etapie, ponowne na zrobionej pozycji = odznacz. */
export function EquipmentRowTick({ line, stage, editable, busy, save }: EquipmentRowChecklist) {
  const { showSnackbar } = useSnackbar();
  const tone = equipmentLineTone(line, stage);
  const done = tone === 'ok';
  const problem = tone === 'shortage' || tone === 'missing' || tone === 'damaged';
  const circle = done
    ? 'bg-emerald-500 text-[#0f1119]'
    : problem
      ? 'bg-red-500/25 text-red-100'
      : tone === 'pending'
        ? 'bg-amber-400/25 text-amber-100'
        : 'bg-white/10 text-transparent';
  const icon = busy ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#e5e4e2]" aria-hidden />
  ) : done ? (
    <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
  ) : problem || tone === 'pending' ? (
    <span className="text-xs font-bold leading-none" aria-hidden>
      !
    </span>
  ) : (
    <Check className="h-3.5 w-3.5" aria-hidden />
  );

  if (!editable) {
    return (
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${circle}`} title={done ? doneLabel(stage) : undefined}>
        {icon}
      </span>
    );
  }

  const toggle = async () => {
    if (busy) return;
    let fn: (typeof RPC)[keyof typeof RPC];
    let params: Record<string, unknown>;
    if (stage === 'dispatch') {
      fn = RPC.pack;
      params = { p_line: line.id, p_qty: done ? null : line.quantity, p_reason: null };
    } else if (stage === 'loadback') {
      fn = RPC.loadback;
      params = { p_line: line.id, p_qty: done ? null : line.shipped_qty, p_note: null };
    } else {
      fn = RPC.returnLine;
      params = done
        ? { p_line: line.id, p_ok: null, p_damaged: 0, p_note: null, p_photos: null }
        : { p_line: line.id, p_ok: line.shipped_qty, p_damaged: 0, p_note: line.return_note, p_photos: null };
    }
    const result = await save(fn, params);
    if (!result.ok) showSnackbar(result.message, 'error');
  };

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={done}
      aria-label={`${done ? 'Odznacz' : FULL_LABEL[stage]}: ${line.name}`}
      title={done ? 'Odznacz' : FULL_LABEL[stage]}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${circle} ${
        done ? 'hover:bg-emerald-400' : 'hover:bg-emerald-500/30 hover:text-emerald-200'
      } disabled:cursor-wait`}
    >
      {icon}
    </button>
  );
}

function Badge({ tone, title, children }: { tone: 'ok' | 'danger' | 'warning' | 'muted'; title?: string; children: ReactNode }) {
  const cls = {
    ok: 'bg-emerald-500/15 text-emerald-300',
    danger: 'bg-red-500/20 text-red-200',
    warning: 'bg-amber-400/20 text-amber-200',
    muted: 'bg-white/10 text-[#e5e4e2]/60',
  }[tone];
  return (
    <span data-brand-badge="true" title={title} className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

/** Badge'e etapu przy nazwie: „Załadowane” z awatarem, braki, uszkodzenia. */
export function EquipmentRowBadges({ line, stage, people }: EquipmentRowChecklist) {
  const actor = equipmentLineActor(line, stage);
  const person = actor.id ? people[actor.id] : null;
  const who = equipmentByLine(person?.name || actor.name, actor.at);
  const avatar = actor.id || actor.name ? <EquipmentPersonAvatar person={person} name={actor.name} size={16} /> : null;
  const badges: ReactNode[] = [];

  if (equipmentLineDone(line, stage)) {
    badges.push(
      <Badge key="done" tone="ok" title={who || undefined}>
        {avatar}
        {doneLabel(stage)}
      </Badge>,
    );
  } else if (stage === 'dispatch' && line.packed_qty != null && line.packed_qty < line.quantity) {
    const short = line.shortage_qty;
    const decider = line.shortage_decided_by ? people[line.shortage_decided_by] : null;
    const deciderName = decider?.name || line.shortage_decided_name;
    const decidedTitle = equipmentByLine(deciderName, line.shortage_decided_at) || undefined;
    if (!line.required) {
      badges.push(
        <Badge key="partial" tone="muted" title={who || undefined}>
          {avatar}
          Spakowano {line.packed_qty}/{line.quantity}
        </Badge>,
      );
    } else if (line.shortage_status === 'approved') {
      badges.push(
        <Badge key="short" tone="danger" title={decidedTitle}>
          <EquipmentPersonAvatar person={decider} name={deciderName} size={16} />
          Brak {short} · zgoda: {firstName(deciderName) || 'tak'}
        </Badge>,
      );
    } else if (line.shortage_status === 'rejected') {
      badges.push(
        <Badge key="short" tone="danger" title={decidedTitle}>
          Brak {short} · bez zgody
        </Badge>,
      );
    } else {
      badges.push(
        <Badge key="short" tone="warning" title={who || undefined}>
          Brak {short} · czeka na zgodę
        </Badge>,
      );
    }
  } else if (stage === 'loadback' && line.loadback_qty != null && line.loadback_qty < line.shipped_qty) {
    badges.push(
      <Badge key="missing" tone="danger" title={who || undefined}>
        {avatar}
        Brak {line.shipped_qty - line.loadback_qty} po wydarzeniu
      </Badge>,
    );
  } else if (stage === 'return' && line.return_ok_qty != null) {
    if ((line.return_damaged_qty || 0) > 0) {
      badges.push(
        <Badge key="damaged" tone="danger" title={who || undefined}>
          {avatar}
          Uszkodzone {line.return_damaged_qty}
        </Badge>,
      );
    }
    if ((line.return_missing_qty || 0) > 0) {
      badges.push(
        <Badge key="missing" tone="danger" title={who || undefined}>
          {(line.return_damaged_qty || 0) > 0 ? null : avatar}
          Brak {line.return_missing_qty}
        </Badge>,
      );
    }
  }
  if (stage !== 'dispatch' && !equipmentLineDone(line, stage) && line.shipped_qty < line.quantity) {
    badges.push(
      <Badge key="shipped" tone="muted">
        Wydano {line.shipped_qty}/{line.quantity}
      </Badge>,
    );
  }
  return <>{badges}</>;
}

/** Powód braku / opis pod nazwą pozycji (i miniatury zdjęć zwrotu). */
export function EquipmentRowNote({ line, stage }: EquipmentRowChecklist) {
  let text: string | null = null;
  let extra: string | null = null;
  if (stage === 'dispatch' && line.packed_qty != null && line.packed_qty < line.quantity) {
    text = line.shortage_reason;
    extra = line.shortage_status !== 'pending' ? line.shortage_decision_note : null;
  } else if (stage === 'loadback' && line.loadback_qty != null) {
    text = line.loadback_note;
  } else if (stage === 'return' && line.return_ok_qty != null) {
    text = line.return_note;
  }
  const photos = stage === 'return' ? line.return_photos : [];
  if (!text && !extra && !photos.length) return null;
  const problem = equipmentLineTone(line, stage) !== 'ok';
  return (
    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {text && <span className={`min-w-0 break-words ${problem ? 'text-red-200/85' : 'text-[#e5e4e2]/55'}`}>{text}</span>}
      {extra && <span className="min-w-0 break-words text-[#e5e4e2]/55">Decyzja: {extra}</span>}
      {photos.length > 0 && (
        <span className="flex items-center gap-1">
          {photos.slice(0, 4).map((path, index) => (
            <a key={path} href={equipmentPhotoUrl(path)} target="_blank" rel="noopener noreferrer" aria-label={`Zdjęcie ${index + 1}: ${line.name}`}>
              <img src={equipmentPhotoUrl(path)} alt="" loading="lazy" className="h-7 w-7 rounded bg-black/20 object-cover" />
            </a>
          ))}
          {photos.length > 4 && <span className="text-[#e5e4e2]/50">+{photos.length - 4}</span>}
        </span>
      )}
    </div>
  );
}

/** Chip ilości „3/4” — otwiera mały edytor (ilość, powód / opis, przy zwrocie uszkodzone i zdjęcia). */
export function EquipmentRowQtyChip(props: EquipmentRowChecklist) {
  const { line, stage, editable, busy } = props;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tone = equipmentLineTone(line, stage);
  const { value, of } = stageQty(line, stage);
  const done = tone === 'ok';

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!editable) setOpen(false);
  }, [editable]);

  // Odczyt: chip tylko przy brakach / częściowej ilości (zrobione = przekreślenie + badge).
  if (!editable && (value == null || done)) return null;

  const cls =
    tone === 'pending'
      ? 'bg-amber-400/20 text-amber-100'
      : tone === 'shortage' || tone === 'missing' || tone === 'damaged'
        ? 'bg-red-500/20 text-red-100'
        : done
          ? 'bg-emerald-500/15 text-emerald-200'
          : 'bg-white/10 text-[#e5e4e2]/75';
  const label = `${value ?? '–'}/${of}`;
  const titles: Record<EquipmentStageKey, string> = {
    dispatch: 'Spakowana ilość',
    loadback: 'Ile wraca po wydarzeniu',
    return: 'Ile wróciło sprawne',
  };

  if (!editable) {
    return (
      <span title={titles[stage]} className={`shrink-0 rounded-md px-2 py-0.5 text-xs tabular-nums ${cls}`}>
        {label}
      </span>
    );
  }

  const close = () => setOpen(false);
  const editorProps = { ...props, onClose: close };
  return (
    <span ref={wrapRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${titles[stage]} — zmień`}
        disabled={busy && !open}
        onClick={() => setOpen(current => !current)}
        className={`rounded-md px-2 py-0.5 text-xs tabular-nums hover:brightness-125 ${cls}`}
      >
        {label}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${titles[stage]}: ${line.name}`}
          className="absolute right-0 top-full z-40 mt-1.5 w-[19rem] max-w-[86vw] rounded-xl bg-[#1c1f33] p-3 text-left shadow-2xl shadow-black/50"
        >
          <p className="mb-2 truncate text-sm font-medium text-[#e5e4e2]">{line.name}</p>
          {stage === 'dispatch' ? (
            <DispatchEditor {...editorProps} />
          ) : stage === 'loadback' ? (
            <LoadbackEditor {...editorProps} />
          ) : (
            <ReturnEditor {...editorProps} />
          )}
        </div>
      )}
    </span>
  );
}
