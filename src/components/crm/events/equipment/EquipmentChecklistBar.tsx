'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, History, Lock, MoreHorizontal, RefreshCw, RotateCcw, Unlock } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import {
  EQUIPMENT_CHECKLIST_RPC as RPC,
  EQUIPMENT_STAGE_HINTS,
  EQUIPMENT_STAGE_TABS,
  equipmentDefaultStage,
  equipmentReopenableStage,
  equipmentShortageDecisionLines,
  type EquipmentChecklist,
  type EquipmentStageKey,
} from '@/lib/events/equipment/equipmentChecklist';
import EventStepDialog from '../steps/EventStepDialog';
import EquipmentNoteDialog, { type EquipmentNoteDialogConfig } from './EquipmentNoteDialog';
import { EquipmentPersonAvatar } from './EquipmentLineEditors';
import type { EquipmentChecklistRpc, useEquipmentChecklist } from './useEquipmentChecklist';
import {
  equipmentByLine,
  equipmentDangerButton,
  equipmentLogDetail,
  equipmentLogLabel,
  equipmentPrimaryButton,
  equipmentQuietButton,
  equipmentSecondaryButton,
  equipmentStageProgress,
  formatEquipmentDate,
  formatEquipmentShortDate,
} from './equipmentChecklistUi';

type ActionKind =
  | 'request_approval'
  | 'approve'
  | 'reject'
  | 'confirm_dispatch'
  | 'request_unlock'
  | 'confirm_loadback'
  | 'confirm_return'
  | 'ack_issues'
  | 'reopen';

type ActionSpec = EquipmentNoteDialogConfig & {
  call: (note: string) => [EquipmentChecklistRpc, Record<string, unknown>];
  success: string;
};

/** Stan dawnej listy załadunku (gdy baza nie ma jeszcze checklisty) — tylko do odczytu. */
export type LegacyLoadingSummary = { loaded: number; total: number; confirmed: boolean; confirmedAt?: string | null };

const tabOf = (key: EquipmentStageKey) => EQUIPMENT_STAGE_TABS.find(tab => tab.key === key)!;

function confirmation(c: EquipmentChecklist, key: EquipmentStageKey): { at: string | null; by: string | null; name: string | null; note: string | null } {
  if (key === 'dispatch') return { at: c.dispatch.confirmed_at, by: c.dispatch.confirmed_by, name: c.dispatch.confirmed_by_name, note: c.dispatch.note };
  if (key === 'loadback') return { at: c.loadback.confirmed_at, by: c.loadback.confirmed_by, name: c.loadback.confirmed_by_name, note: c.loadback.note };
  return { at: c.return.confirmed_at, by: c.return.confirmed_by, name: c.return.confirmed_by_name, note: c.return.note };
}

/**
 * Pasek checklisty nad listą sprzętu: etapy (Wydanie · Po wydarzeniu · Zwrot) filtrują listę, obok podpowiedź lub
 * blokady i przyciski etapu. Uprawnienia i blokady liczy baza (`can`, `blockers`) — docs/equipment-checklist.md.
 */
export default function EquipmentChecklistBar({
  eventId,
  state,
  stage,
  onStageChange,
  legacy,
}: {
  eventId: string;
  state: ReturnType<typeof useEquipmentChecklist>;
  stage: EquipmentStageKey | null;
  onStageChange: (stage: EquipmentStageKey | null) => void;
  legacy?: LegacyLoadingSummary;
}) {
  const tabsId = useId();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { checklist, status, loadError, busyKeys, refresh, run } = state;
  const [action, setAction] = useState<ActionKind | null>(null);
  const [actionError, setActionError] = useState('');
  const [reopenNote, setReopenNote] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAction(null);
    setMenuOpen(false);
    setHistoryOpen(false);
  }, [eventId]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  if (status === 'loading' && !checklist) {
    return <p className="mb-4 rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-[#e5e4e2]/50">Wczytywanie checklisty sprzętu…</p>;
  }
  if (status === 'missing') {
    return (
      <p className="mb-4 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
        Checklista wymaga migracji 20261105170000_event_equipment_checklist.sql
        {legacy && legacy.total > 0 && (
          <span className="text-[#e5e4e2]/60">
            {' '}
            · dawna lista: załadowano {legacy.loaded}/{legacy.total}
            {legacy.confirmed ? `, potwierdzony ${formatEquipmentDate(legacy.confirmedAt)}` : ''}
          </span>
        )}
      </p>
    );
  }
  if (!checklist) {
    return (
      <p role="alert" className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200">
        {loadError || 'Nie udało się wczytać checklisty sprzętu.'}{' '}
        <button type="button" onClick={refresh} className="underline">
          Spróbuj ponownie
        </button>
      </p>
    );
  }
  if (checklist.stage === 'empty' || !stage) return null;

  const c = checklist;
  const can = c.can;
  const summary = c.summary;
  const currentStage = equipmentDefaultStage(c);
  const stageBusy = Array.from(busyKeys).some(key => key.startsWith('stage:'));
  const decidable = c.lines.filter(line => line.shortage_status === 'pending' || line.shortage_status === 'rejected');
  const returnIssues = c.lines.filter(
    line => line.shipped_qty > 0 && line.return_ok_qty != null && ((line.return_damaged_qty || 0) > 0 || (line.return_missing_qty || 0) > 0),
  );
  const reopenable = can.reopen ? equipmentReopenableStage(c) : null;
  const selectedConfirmation = confirmation(c, stage);

  const specs: Record<ActionKind, ActionSpec> = {
    request_approval: {
      title: 'Poproś o zgodę na braki',
      description: `Sprzedawca wydarzenia i administratorzy dostaną powiadomienie z listą braków (${summary.shortages_pending + summary.shortages_rejected}).`,
      label: 'Notatka dla sprzedawcy',
      placeholder: 'np. co proponujesz zamiast brakującego sprzętu',
      required: false,
      minLength: 0,
      maxLength: 1000,
      submitLabel: 'Wyślij prośbę',
      call: note => [RPC.requestApproval, { p_event: eventId, p_note: note || null }],
      success: 'Wysłano prośbę o zgodę na braki.',
    },
    approve: {
      title: 'Zgoda na braki',
      description: 'Magazyn będzie mógł potwierdzić wydanie z tymi brakami.',
      label: 'Notatka',
      required: false,
      minLength: 0,
      maxLength: 1000,
      submitLabel: 'Zgoda na braki',
      call: note => [RPC.decideShortages, { p_event: eventId, p_approve: true, p_note: note || null, p_lines: equipmentShortageDecisionLines(c) }],
      success: 'Zaakceptowano braki — magazyn może wydać sprzęt.',
    },
    reject: {
      title: 'Brak zgody na braki',
      description: 'Wydanie zostanie zablokowane, dopóki magazyn nie uzupełni sprzętu albo nie poprosi ponownie.',
      label: 'Co magazyn ma zrobić?',
      placeholder: 'np. dowieźć, wynająć, zamienić',
      required: true,
      minLength: 3,
      maxLength: 1000,
      submitLabel: 'Odmów',
      danger: true,
      call: note => [RPC.decideShortages, { p_event: eventId, p_approve: false, p_note: note, p_lines: equipmentShortageDecisionLines(c) }],
      success: 'Odmówiono zgody na braki — magazyn dostał powiadomienie.',
    },
    confirm_dispatch: {
      title: 'Potwierdź wydanie',
      description: 'Potwierdzenie blokuje listę — późniejsza zmiana wymaga cofnięcia przez administratora. Kierownik realizacji dostanie powiadomienie.',
      label: 'Notatka do wydania',
      required: false,
      minLength: 0,
      maxLength: 2000,
      submitLabel: 'Potwierdź wydanie',
      call: note => [RPC.confirmDispatch, { p_event: eventId, p_note: note || null }],
      success: 'Wydanie potwierdzone.',
    },
    request_unlock: {
      title: 'Poproś o odblokowanie wydania',
      description: 'Administratorzy dostaną powiadomienie. Do czasu cofnięcia wydania lista pozostaje zablokowana.',
      label: 'Co trzeba zmienić w wydaniu?',
      placeholder: 'np. dołożono drugi mikrofon, pomyłka w ilości kabli',
      required: true,
      minLength: 5,
      maxLength: 1000,
      submitLabel: 'Wyślij prośbę',
      call: note => [RPC.requestUnlock, { p_event: eventId, p_reason: note }],
      success: 'Prośba o odblokowanie wysłana do administratorów.',
    },
    confirm_loadback: {
      title: 'Zatwierdź załadunek po wydarzeniu',
      description:
        summary.loadback_missing > 0
          ? `Rozbieżności (${summary.loadback_missing}) trafią do magazynu, sprzedawcy i administratorów.`
          : 'Magazyn dostanie powiadomienie, że sprzęt wraca w komplecie.',
      label: 'Notatka',
      required: false,
      minLength: 0,
      maxLength: 2000,
      submitLabel: 'Zatwierdź załadunek',
      call: note => [RPC.confirmLoadback, { p_event: eventId, p_note: note || null }],
      success: 'Załadunek po wydarzeniu zatwierdzony.',
    },
    confirm_return: {
      title: 'Zatwierdź zwrot',
      description:
        returnIssues.length > 0
          ? `Rozbieżności (${returnIssues.length}) trafią do sprzedawcy i administratorów — przyjmą je z decyzją, co dalej.`
          : 'Zwrot bez rozbieżności zamyka krok „Przyjmij zwrot i sprawdź sprzęt”.',
      label: 'Notatka',
      required: false,
      minLength: 0,
      maxLength: 2000,
      submitLabel: 'Zatwierdź zwrot',
      call: note => [RPC.confirmReturn, { p_event: eventId, p_note: note || null }],
      success: 'Zwrot zatwierdzony.',
    },
    ack_issues: {
      title: 'Przyjmij rozbieżności',
      description: 'Napisz decyzję — magazyn dostanie powiadomienie, a krok zwrotu się zamknie.',
      label: 'Decyzja',
      placeholder: 'np. obciążamy klienta, naprawa na nasz koszt, sprzęt odnaleziony',
      required: true,
      minLength: 5,
      maxLength: 1000,
      submitLabel: 'Przyjmij rozbieżności',
      call: note => [RPC.ackIssues, { p_event: eventId, p_note: note }],
      success: 'Rozbieżności przyjęte.',
    },
    reopen: {
      title: `Cofnij etap: ${reopenable ? tabOf(reopenable).label : ''}`,
      description: 'Etapy cofa się od końca: zwrot → po wydarzeniu → wydanie. Cofnięcie przywraca otwarte kroki realizacji.',
      label: 'Powód',
      placeholder: 'np. pomyłka w ilości, sprzęt odnaleziony',
      required: true,
      minLength: 5,
      maxLength: 1000,
      submitLabel: 'Cofnij etap',
      danger: true,
      initialNote: reopenNote,
      call: note => [RPC.reopen, { p_event: eventId, p_stage: reopenable, p_reason: note }],
      success: 'Etap cofnięty.',
    },
  };

  const openAction = (kind: ActionKind, note = '') => {
    setMenuOpen(false);
    setActionError('');
    setReopenNote(note);
    setAction(kind);
  };
  const submitAction = async (note: string) => {
    if (!action) return;
    const spec = specs[action];
    const [fn, params] = spec.call(note);
    setActionError('');
    const result = await run(`stage:${action}`, fn, params);
    if (!result.ok) {
      // Np. „Lista braków zmieniła się — odśwież i sprawdź ponownie.” — komunikat z bazy i świeży stan.
      setActionError(result.message);
      refresh();
      return;
    }
    showSnackbar(spec.success, 'success');
    setAction(null);
    onStageChange(null);
  };
  const fill = async (target: EquipmentStageKey) => {
    const copy = {
      dispatch: {
        title: 'Wszystko zgodne',
        message: 'Nieodhaczone pozycje wymagane zostaną oznaczone jako spakowane w pełnej ilości. Wpisane już ilości zostaną bez zmian.',
        success: 'Uzupełniono nieodhaczone pozycje pełną ilością.',
      },
      loadback: {
        title: 'Wszystko wraca',
        message: 'Nieodhaczone pozycje zostaną oznaczone jako wracające w komplecie (tyle, ile wydano). Wpisane już ilości zostaną bez zmian.',
        success: 'Nieodhaczone pozycje oznaczono jako wracające w komplecie.',
      },
      return: {
        title: 'Wszystko wróciło sprawne',
        message:
          'Nieodhaczone pozycje zostaną oznaczone jako sprawne w pełnej wydanej ilości. Pozycje z brakiem po wydarzeniu trzeba wpisać ręcznie z opisem.',
        success: 'Nieodhaczone pozycje oznaczono jako sprawne.',
      },
    }[target];
    const confirmed = await showConfirm({ title: copy.title, message: copy.message, confirmText: copy.title });
    if (!confirmed) return;
    const result = await run(`stage:fill:${target}`, RPC.fill, { p_event: eventId, p_stage: target });
    showSnackbar(result.ok ? copy.success : result.message, result.ok ? 'success' : 'error');
  };

  const onTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = EQUIPMENT_STAGE_TABS[(index + (event.key === 'ArrowRight' ? 1 : EQUIPMENT_STAGE_TABS.length - 1)) % EQUIPMENT_STAGE_TABS.length];
    onStageChange(next.key);
    document.getElementById(`${tabsId}-${next.key}`)?.focus();
  };

  // Podpowiedź pod etapami: blokady bieżącego etapu, kto zatwierdził wybrany etap albo co dalej.
  const hint = (() => {
    if (stage === currentStage && c.blockers.length && !selectedConfirmation.at) {
      return (
        <span className="flex items-start gap-1.5 text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {c.blockers.join(' · ')}
        </span>
      );
    }
    if (selectedConfirmation.at) {
      return (
        <span className="text-[#e5e4e2]/65">
          {stage === 'dispatch' && <Lock className="mr-1 inline h-3.5 w-3.5" aria-hidden />}
          {tabOf(stage).label}: zatwierdził(a) {equipmentByLine(selectedConfirmation.name, selectedConfirmation.at)}
          {stage === 'dispatch' ? ' — lista zablokowana' : ''}
          {selectedConfirmation.note ? ` · „${selectedConfirmation.note}”` : ''}
        </span>
      );
    }
    if (stage !== 'dispatch' && !c.dispatch.confirmed_at) {
      return <span className="text-[#e5e4e2]/55">Etap otworzy się po potwierdzeniu wydania.</span>;
    }
    if (stage === 'loadback' && c.return.confirmed_at) {
      return <span className="text-[#e5e4e2]/55">Zwrot zatwierdzono bez załadunku po wydarzeniu.</span>;
    }
    if (stage === 'return' && c.stage === 'loadback') {
      return <span className="text-[#e5e4e2]/55">Zwrot możesz sprawdzić przed zatwierdzeniem załadunku po wydarzeniu — podstawą jest ilość wydana.</span>;
    }
    return <span className="text-[#e5e4e2]/55">{EQUIPMENT_STAGE_HINTS[c.stage]}</span>;
  })();

  const buttons = (() => {
    const list: ReactNode[] = [];
    if (stage === 'dispatch' && can.pack) {
      if (summary.unchecked_dispatch > 0) {
        list.push(
          <button key="fill" type="button" disabled={stageBusy} onClick={() => void fill('dispatch')} className={equipmentSecondaryButton}>
            Wszystko zgodne
          </button>,
        );
      }
      if (can.request_approval) {
        list.push(
          <button key="ask" type="button" disabled={stageBusy} onClick={() => openAction('request_approval')} className={equipmentSecondaryButton}>
            Poproś o zgodę na braki
          </button>,
        );
      }
      list.push(
        <button
          key="confirm"
          type="button"
          disabled={stageBusy || !can.confirm_dispatch}
          title={!can.confirm_dispatch ? c.blockers.join(' · ') || undefined : undefined}
          onClick={() => openAction('confirm_dispatch')}
          className={equipmentPrimaryButton}
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          Potwierdź wydanie
        </button>,
      );
    }
    if (stage === 'loadback' && can.loadback) {
      if (summary.loadback_unchecked > 0) {
        list.push(
          <button key="fill" type="button" disabled={stageBusy} onClick={() => void fill('loadback')} className={equipmentSecondaryButton}>
            Wszystko wraca
          </button>,
        );
      }
      list.push(
        <button
          key="confirm"
          type="button"
          disabled={stageBusy || !can.confirm_loadback}
          title={!can.confirm_loadback ? c.blockers.join(' · ') || undefined : undefined}
          onClick={() => openAction('confirm_loadback')}
          className={equipmentPrimaryButton}
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          Zatwierdź załadunek po wydarzeniu
        </button>,
      );
    }
    if (stage === 'return' && can.return) {
      if (summary.return_unchecked > 0) {
        list.push(
          <button key="fill" type="button" disabled={stageBusy} onClick={() => void fill('return')} className={equipmentSecondaryButton}>
            Wszystko wróciło sprawne
          </button>,
        );
      }
      list.push(
        <button
          key="confirm"
          type="button"
          disabled={stageBusy || !can.confirm_return}
          title={!can.confirm_return ? c.blockers.join(' · ') || 'Sprawdź wszystkie wydane pozycje.' : undefined}
          onClick={() => openAction('confirm_return')}
          className={equipmentPrimaryButton}
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          Zatwierdź zwrot
        </button>,
      );
    }
    return list;
  })();

  const menuItems = [
    can.request_unlock && { key: 'unlock', label: 'Poproś o odblokowanie wydania', icon: Unlock, onClick: () => openAction('request_unlock') },
    reopenable && { key: 'reopen', label: `Cofnij etap: ${tabOf(reopenable).label}`, icon: RotateCcw, onClick: () => openAction('reopen') },
    { key: 'history', label: `Historia zmian (${c.log.length})`, icon: History, onClick: () => { setMenuOpen(false); setHistoryOpen(true); } },
    { key: 'refresh', label: 'Odśwież', icon: RefreshCw, onClick: () => { setMenuOpen(false); refresh(); } },
  ].filter(Boolean) as { key: string; label: string; icon: typeof History; onClick: () => void }[];

  return (
    <div className="mb-5 rounded-xl bg-white/[0.04] p-3" aria-busy={stageBusy}>
      <div className="flex items-start gap-2">
        <div role="tablist" aria-label="Checklista sprzętu — etapy" className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
          {EQUIPMENT_STAGE_TABS.map((tab, index) => {
            const selected = stage === tab.key;
            const progress = equipmentStageProgress(c, tab.key);
            const conf = confirmation(c, tab.key);
            const person = conf.by ? c.people[conf.by] : null;
            const issuesOpen = tab.key === 'return' && c.stage === 'issues';
            const tint = selected
              ? 'bg-[#d3bb73]/15'
              : conf.at && !issuesOpen
                ? 'bg-emerald-500/[0.08]'
                : progress.problems || issuesOpen
                  ? 'bg-red-500/[0.10]'
                  : 'bg-white/[0.04]';
            return (
              <button
                key={tab.key}
                id={`${tabsId}-${tab.key}`}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onKeyDown={event => onTabKey(event, index)}
                onClick={() => onStageChange(tab.key)}
                className={`rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/[0.08] ${tint}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm font-medium ${selected ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'}`}>{tab.label}</span>
                  <span className={`shrink-0 text-xs tabular-nums ${progress.problems ? 'text-red-200' : 'text-[#e5e4e2]/60'}`}>
                    {progress.done}/{progress.total}
                  </span>
                </span>
                <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-[#e5e4e2]/50">
                  {conf.at ? (
                    <>
                      <EquipmentPersonAvatar person={person} name={conf.name} size={18} />
                      <span className="truncate" title={equipmentByLine(person?.name || conf.name, conf.at)}>
                        {issuesOpen ? 'rozbieżności do przyjęcia' : formatEquipmentShortDate(conf.at)}
                      </span>
                    </>
                  ) : (
                    <span className="truncate">{tab.owner}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="Więcej: odblokowanie, cofnięcie etapu, historia"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(open => !open)}
            className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-white/5 hover:text-[#d3bb73]"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl bg-[#1c1f33] p-1.5 shadow-2xl shadow-black/50">
              {menuItems.map(item => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  disabled={stageBusy && item.key !== 'history'}
                  onClick={item.onClick}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[#e5e4e2]/85 hover:bg-white/5 disabled:opacity-45"
                >
                  <item.icon className="h-4 w-4 shrink-0 text-[#d3bb73]" aria-hidden />
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="min-w-0 flex-1 text-xs">{hint}</p>
        {buttons.length > 0 && <div className="flex flex-wrap items-center gap-2">{buttons}</div>}
      </div>

      {loadError && (
        <p role="status" className="mt-1 px-1 text-xs text-amber-200/80">
          {loadError}{' '}
          <button type="button" onClick={refresh} className="underline">
            Odśwież
          </button>
        </p>
      )}

      {c.dispatch.unlock_requested && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          <p className="min-w-0">
            <span className="font-medium">Prośba o odblokowanie wydania</span>
            {c.dispatch.unlock_requested_at ? ` (${formatEquipmentShortDate(c.dispatch.unlock_requested_at)})` : ''}: {c.dispatch.unlock_reason}
            {reopenable !== 'dispatch' && <span className="text-amber-100/70"> · czeka na administratora</span>}
          </p>
          {reopenable === 'dispatch' && (
            <button
              type="button"
              disabled={stageBusy}
              onClick={() => openAction('reopen', c.dispatch.unlock_reason ? `Prośba: ${c.dispatch.unlock_reason}` : '')}
              className={equipmentQuietButton}
            >
              Cofnij wydanie
            </button>
          )}
        </div>
      )}

      {can.approve_shortages && decidable.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          <p className="min-w-0 flex-1">
            <span className="font-medium">Braki do zgody ({decidable.length}):</span>{' '}
            {decidable.map(line => `${line.name} ${line.packed_qty}/${line.quantity}${line.shortage_reason ? ` — ${line.shortage_reason}` : ''}`).join('; ')}
            {c.dispatch.shortage_request_note ? <span className="text-amber-100/70"> · magazyn: {c.dispatch.shortage_request_note}</span> : null}
          </p>
          <span className="flex gap-2">
            <button type="button" disabled={stageBusy} onClick={() => openAction('approve')} className={equipmentPrimaryButton}>
              Zgoda na braki
            </button>
            <button type="button" disabled={stageBusy} onClick={() => openAction('reject')} className={equipmentDangerButton}>
              Odmów
            </button>
          </span>
        </div>
      )}

      {can.ack_issues && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-100">
          <p className="min-w-0 flex-1">
            <span className="font-medium">Rozbieżności w zwrocie ({c.return.issue_count}):</span>{' '}
            {returnIssues
              .map(line =>
                [line.name, line.return_damaged_qty ? `uszk. ${line.return_damaged_qty}` : '', line.return_missing_qty ? `brak ${line.return_missing_qty}` : '']
                  .filter(Boolean)
                  .join(' '),
              )
              .join('; ')}
          </p>
          <button type="button" disabled={stageBusy} onClick={() => openAction('ack_issues')} className={equipmentPrimaryButton}>
            Przyjmij rozbieżności
          </button>
        </div>
      )}

      <EquipmentNoteDialog
        open={Boolean(action)}
        config={action ? specs[action] : null}
        busy={action ? busyKeys.has(`stage:${action}`) : false}
        error={actionError}
        onCancel={() => {
          if (action && busyKeys.has(`stage:${action}`)) return;
          setAction(null);
          setActionError('');
        }}
        onSubmit={submitAction}
        submitDisabled={action === 'reopen' && !reopenable}
      />

      <EventStepDialog open={historyOpen} title="Historia checklisty sprzętu" onClose={() => setHistoryOpen(false)} wide>
        {c.log.length === 0 ? (
          <p className="text-sm text-[#e5e4e2]/55">Brak zmian.</p>
        ) : (
          <ol className="space-y-1.5">
            {c.log.map(entry => {
              const detail = equipmentLogDetail(entry);
              return (
                <li key={entry.id} className="rounded-md bg-white/[0.03] px-3 py-2">
                  <p className="break-words text-sm text-[#e5e4e2]">
                    <span className="font-medium">{equipmentLogLabel(entry)}</span>
                    {entry.line_name && <span> — {entry.line_name}</span>}
                    {detail && <span className="text-[#e5e4e2]/65"> · {detail}</span>}
                  </p>
                  {entry.note && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-[#e5e4e2]/70">„{entry.note}”</p>}
                  <p className="mt-0.5 text-[11px] text-[#e5e4e2]/45">
                    {tabOf(entry.stage).label} · {equipmentByLine(entry.actor_name, entry.created_at)}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </EventStepDialog>
    </div>
  );
}
