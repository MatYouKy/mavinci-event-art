'use client';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Lock, RefreshCw, RotateCcw } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import {
  EQUIPMENT_CHECKLIST_RPC as RPC,
  EQUIPMENT_STAGE_HINTS,
  EQUIPMENT_STAGE_LABELS,
  EQUIPMENT_STAGE_TABS,
  equipmentDefaultStage,
  equipmentStageLines,
  type EquipmentChecklist,
  type EquipmentChecklistStage,
  type EquipmentStageKey,
} from '@/lib/events/equipment/equipmentChecklist';
import EquipmentNoteDialog, { type EquipmentNoteDialogConfig } from './EquipmentNoteDialog';
import { DispatchLine, LoadbackLine, ReturnLine } from './EquipmentChecklistLines';
import { useEquipmentChecklist, type EquipmentChecklistRpc } from './useEquipmentChecklist';
import {
  equipmentByLine,
  equipmentDangerButton,
  equipmentLogDetail,
  equipmentLogLabel,
  equipmentPrimaryButton,
  equipmentQuietButton,
  equipmentSecondaryButton,
  formatEquipmentDate,
  groupEquipmentLines,
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
export type LegacyLoadingSummary = {
  loaded: number;
  total: number;
  confirmed: boolean;
  confirmedAt?: string | null;
  notes?: string | null;
};

const STAGE_CHIP: Record<EquipmentChecklistStage, string> = {
  empty: 'bg-white/5 text-[#e5e4e2]/60',
  dispatch: 'bg-sky-400/15 text-sky-200',
  loadback: 'bg-sky-400/15 text-sky-200',
  return: 'bg-sky-400/15 text-sky-200',
  issues: 'bg-red-500/20 text-red-200',
  done: 'bg-emerald-400/15 text-emerald-200',
};

type TabTone = 'done' | 'current' | 'problem' | 'waiting';
const TAB_TONE: Record<TabTone, string> = {
  done: 'bg-emerald-500/[0.10]',
  current: 'bg-white/[0.07]',
  problem: 'bg-red-500/[0.12]',
  waiting: 'bg-white/[0.03]',
};

const ownerOf = (key: EquipmentStageKey) => EQUIPMENT_STAGE_TABS.find(tab => tab.key === key)?.owner ?? '';

function stageStatus(c: EquipmentChecklist, key: EquipmentStageKey): { text: string; tone: TabTone; count: number } {
  const s = c.summary;
  if (key === 'dispatch') {
    if (c.dispatch.confirmed_at) {
      return { text: `Potwierdził(a) ${equipmentByLine(c.dispatch.confirmed_by_name, c.dispatch.confirmed_at)}`, tone: 'done', count: 0 };
    }
    return {
      text: `Spakowano w całości ${s.packed_full}/${s.lines}${s.shortages ? ` · braki: ${s.shortages}` : ''}`,
      tone: s.shortages_pending || s.shortages_rejected ? 'problem' : 'current',
      count: s.unchecked_dispatch,
    };
  }
  if (key === 'loadback') {
    if (c.loadback.confirmed_at) {
      return {
        text: `Zatwierdził(a) ${equipmentByLine(c.loadback.confirmed_by_name, c.loadback.confirmed_at)}${s.loadback_missing ? ` · braki: ${s.loadback_missing}` : ''}`,
        tone: s.loadback_missing ? 'problem' : 'done',
        count: 0,
      };
    }
    if (c.return.confirmed_at) return { text: 'Pominięty — zwrot zatwierdzony', tone: 'waiting', count: 0 };
    if (c.stage === 'loadback') {
      return {
        text: `Sprawdzono ${s.shipped - s.loadback_unchecked}/${s.shipped}${s.loadback_missing ? ` · braki: ${s.loadback_missing}` : ''}`,
        tone: s.loadback_missing ? 'problem' : 'current',
        count: s.loadback_unchecked,
      };
    }
    return { text: 'Po potwierdzeniu wydania', tone: 'waiting', count: 0 };
  }
  if (c.return.confirmed_at) {
    if (c.return.issue_count > 0 && !c.return.issues_ack_at) {
      return { text: `Rozbieżności: ${c.return.issue_count} — do przyjęcia`, tone: 'problem', count: 0 };
    }
    return {
      text: `Zatwierdził(a) ${equipmentByLine(c.return.confirmed_by_name, c.return.confirmed_at)}${c.return.issue_count ? ` · rozbieżności przyjęte` : ''}`,
      tone: 'done',
      count: 0,
    };
  }
  if (c.stage === 'loadback' || c.stage === 'return') {
    const issues = s.return_damaged + s.return_missing;
    return {
      text: `Sprawdzono ${s.shipped - s.return_unchecked}/${s.shipped}${issues ? ` · uszk.: ${s.return_damaged}, braki: ${s.return_missing}` : ''}`,
      tone: issues ? 'problem' : c.stage === 'return' ? 'current' : 'waiting',
      count: s.return_unchecked,
    };
  }
  return { text: 'Po wydarzeniu', tone: 'waiting', count: 0 };
}

function InfoBox({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  const cls = {
    neutral: 'bg-white/[0.04] text-[#e5e4e2]/75',
    success: 'bg-emerald-500/10 text-emerald-100',
    warning: 'bg-amber-400/10 text-amber-100',
    danger: 'bg-red-500/10 text-red-100',
  }[tone];
  return <div className={`rounded-lg px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

/**
 * Checklista sprzętu wydarzenia w trzech etapach (wydanie → załadunek powrotny → zwrot). Uprawnienia, etap i blokady
 * liczy baza (`can`, `stage`, `blockers`) — panel je wyświetla i wywołuje RPC (docs/equipment-checklist.md).
 */
export default function EventEquipmentChecklistPanel({
  eventId,
  legacy,
  className = '',
}: {
  eventId: string;
  legacy?: LegacyLoadingSummary;
  className?: string;
}) {
  const headingId = useId();
  const tabsId = useId();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { checklist, status, loadError, busyKeys, refresh, run } = useEquipmentChecklist(eventId);
  const [picked, setPicked] = useState<EquipmentStageKey | null>(null);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [actionError, setActionError] = useState('');
  const [reopenStage, setReopenStage] = useState<EquipmentStageKey>('dispatch');
  const [reopenNote, setReopenNote] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const stageRef = useRef<EquipmentChecklistStage | null>(null);

  useEffect(() => {
    setPicked(null);
    setAction(null);
    setHistoryOpen(false);
    stageRef.current = null;
  }, [eventId]);

  // Etap wydarzenia się zmienił (zatwierdzenie tu albo na innym urządzeniu) → pokaż bieżący etap.
  useEffect(() => {
    const current = checklist?.stage ?? null;
    if (stageRef.current && current && current !== stageRef.current) setPicked(null);
    stageRef.current = current;
  }, [checklist?.stage]);

  const stageBusy = useMemo(() => Array.from(busyKeys).some(key => key.startsWith('stage:')), [busyKeys]);
  const stage: EquipmentStageKey = checklist ? picked ?? equipmentDefaultStage(checklist) : 'dispatch';
  const lines = useMemo(() => (checklist ? equipmentStageLines(checklist, stage) : []), [checklist, stage]);
  const groups = useMemo(() => groupEquipmentLines(lines), [lines]);

  if (status === 'loading' && !checklist) {
    return (
      <section className={`mb-6 rounded-xl bg-white/[0.04] p-4 ${className}`} aria-busy="true" aria-labelledby={headingId}>
        <h3 id={headingId} className="text-base text-[#e5e4e2]">
          Checklista sprzętu
        </h3>
        <p className="mt-2 text-sm text-[#e5e4e2]/50">Wczytywanie checklisty sprzętu…</p>
      </section>
    );
  }

  if (status === 'missing') {
    return (
      <section className={`mb-6 rounded-xl bg-amber-400/10 p-4 ${className}`} aria-labelledby={headingId}>
        <h3 id={headingId} className="text-base text-[#e5e4e2]">
          Checklista sprzętu
        </h3>
        <p className="mt-2 text-sm text-amber-100">Checklista wymaga migracji 20261105170000_event_equipment_checklist.sql</p>
        {legacy && legacy.total > 0 && (
          <p className="mt-1 text-xs text-[#e5e4e2]/65">
            Dawna lista załadunku: załadowano {legacy.loaded}/{legacy.total}
            {legacy.confirmed ? ` · potwierdzony${legacy.confirmedAt ? ` ${formatEquipmentDate(legacy.confirmedAt)}` : ''}` : ''}
            {legacy.notes ? ` · uwagi: ${legacy.notes}` : ''}
          </p>
        )}
      </section>
    );
  }

  if (!checklist) {
    return (
      <section className={`mb-6 rounded-xl bg-red-500/10 p-4 ${className}`} aria-labelledby={headingId}>
        <h3 id={headingId} className="text-base text-[#e5e4e2]">
          Checklista sprzętu
        </h3>
        <p role="alert" className="mt-2 text-sm text-red-200">
          {loadError || 'Nie udało się wczytać checklisty sprzętu.'}{' '}
          <button type="button" onClick={refresh} className="underline">
            Spróbuj ponownie
          </button>
        </p>
      </section>
    );
  }

  if (checklist.stage === 'empty') return null;

  const c = checklist;
  const can = c.can;
  const summary = c.summary;
  // Braki do decyzji sprzedawcy / administratora: czekające i wcześniej odrzucone (można je później zaakceptować).
  const decidableShortages = c.lines.filter(line => line.shortage_status === 'pending' || line.shortage_status === 'rejected');
  // Baza sprawdza, że decyzja dotyczy dokładnie tej listy braków (inaczej: „Lista braków zmieniła się…”).
  const shortageLines = decidableShortages.map(line => ({ id: line.id, shortage_qty: line.shortage_qty }));
  const returnIssues = c.lines.filter(
    line => line.shipped_qty > 0 && line.return_ok_qty != null && ((line.return_damaged_qty || 0) > 0 || (line.return_missing_qty || 0) > 0),
  );
  const latestConfirmed: EquipmentStageKey = c.return.confirmed_at ? 'return' : c.loadback.confirmed_at ? 'loadback' : 'dispatch';
  const confirmedAt: Record<EquipmentStageKey, string | null> = {
    dispatch: c.dispatch.confirmed_at,
    loadback: c.loadback.confirmed_at,
    return: c.return.confirmed_at,
  };
  const confirmedBy: Record<EquipmentStageKey, string | null> = {
    dispatch: c.dispatch.confirmed_by_name,
    loadback: c.loadback.confirmed_by_name,
    return: c.return.confirmed_by_name,
  };
  const blockersTitle = c.blockers.join(' · ') || undefined;

  const specs: Record<ActionKind, ActionSpec> = {
    request_approval: {
      title: 'Poproś o zgodę na braki',
      description: `Sprzedawca wydarzenia i administratorzy dostaną powiadomienie z listą braków (${
        summary.shortages_pending + summary.shortages_rejected
      }).${summary.shortages_rejected ? ' Przy brakach bez zgody napisz, co się zmieniło.' : ''}`,
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
      call: note => [RPC.decideShortages, { p_event: eventId, p_approve: true, p_note: note || null, p_lines: shortageLines }],
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
      call: note => [RPC.decideShortages, { p_event: eventId, p_approve: false, p_note: note, p_lines: shortageLines }],
      success: 'Odmówiono zgody na braki — magazyn dostał powiadomienie.',
    },
    confirm_dispatch: {
      title: 'Potwierdź wydanie',
      description:
        'Potwierdzenie blokuje listę wydania — późniejsza zmiana wymaga cofnięcia przez administratora. Kierownik realizacji dostanie powiadomienie.',
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
      title: 'Zatwierdź załadunek powrotny',
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
      success: 'Załadunek powrotny zatwierdzony.',
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
      title: 'Cofnij etap',
      description: 'Etapy cofa się od końca: zwrot → załadunek powrotny → wydanie. Cofnięcie przywraca otwarte kroki realizacji.',
      label: 'Powód',
      placeholder: 'np. pomyłka w ilości, sprzęt odnaleziony',
      required: true,
      minLength: 5,
      maxLength: 1000,
      submitLabel: 'Cofnij etap',
      danger: true,
      initialNote: reopenNote,
      call: note => [RPC.reopen, { p_event: eventId, p_stage: reopenStage, p_reason: note }],
      success: 'Etap cofnięty.',
    },
  };

  const openAction = (kind: ActionKind) => {
    setActionError('');
    setAction(kind);
  };
  const openReopen = (target: EquipmentStageKey = latestConfirmed, note = '') => {
    setReopenStage(target);
    setReopenNote(note);
    openAction('reopen');
  };
  const submitAction = async (note: string) => {
    if (!action) return;
    const spec = specs[action];
    const [fn, params] = spec.call(note);
    setActionError('');
    const result = await run(`stage:${action}`, fn, params);
    if (!result.ok) {
      // Np. „Lista braków zmieniła się — odśwież i sprawdź ponownie.” — komunikat z bazy i świeży stan listy.
      setActionError(result.message);
      refresh();
      return;
    }
    showSnackbar(spec.success, 'success');
    setAction(null);
    setPicked(null);
  };

  const fill = async (target: EquipmentStageKey) => {
    const copy = {
      dispatch: {
        title: 'Wszystko zgodne',
        message: 'Niesprawdzone pozycje wymagane zostaną oznaczone jako spakowane w pełnej ilości. Wpisane już ilości zostaną bez zmian.',
        success: 'Uzupełniono niesprawdzone pozycje pełną ilością.',
      },
      loadback: {
        title: 'Wszystko wraca',
        message: 'Niesprawdzone pozycje zostaną oznaczone jako wracające w komplecie (tyle, ile wydano). Wpisane już ilości zostaną bez zmian.',
        success: 'Niesprawdzone pozycje oznaczono jako wracające w komplecie.',
      },
      return: {
        title: 'Wszystko wróciło sprawne',
        message:
          'Niesprawdzone pozycje zostaną oznaczone jako sprawne w pełnej wydanej ilości. Wpisane już pozycje zostaną bez zmian, a pozycje z brakiem przy załadunku powrotnym trzeba wpisać ręcznie z opisem.',
        success: 'Niesprawdzone pozycje oznaczono jako sprawne.',
      },
    }[target];
    const confirmed = await showConfirm({ title: copy.title, message: copy.message, confirmText: copy.title });
    if (!confirmed) return;
    const result = await run(`stage:fill:${target}`, RPC.fill, { p_event: eventId, p_stage: target });
    showSnackbar(result.ok ? copy.success : result.message, result.ok ? 'success' : 'error');
  };

  const lineBusy = (lineId: string) => busyKeys.has(`line:${lineId}`);
  const saveLine = (lineId: string, fn: EquipmentChecklistRpc, params: Record<string, unknown>) => run(`line:${lineId}`, fn, params);

  const onTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = EQUIPMENT_STAGE_TABS[(index + (event.key === 'ArrowRight' ? 1 : EQUIPMENT_STAGE_TABS.length - 1)) % EQUIPMENT_STAGE_TABS.length];
    setPicked(next.key);
    document.getElementById(`${tabsId}-tab-${next.key}`)?.focus();
  };

  const confirmButton = (() => {
    if (stage === 'dispatch' && can.pack) {
      return (
        <button
          type="button"
          disabled={stageBusy || !can.confirm_dispatch}
          title={!can.confirm_dispatch ? blockersTitle : undefined}
          onClick={() => openAction('confirm_dispatch')}
          className={equipmentPrimaryButton}
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Potwierdź wydanie
        </button>
      );
    }
    if (stage === 'loadback' && can.loadback) {
      return (
        <button
          type="button"
          disabled={stageBusy || !can.confirm_loadback}
          title={!can.confirm_loadback ? blockersTitle : undefined}
          onClick={() => openAction('confirm_loadback')}
          className={equipmentPrimaryButton}
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Zatwierdź załadunek powrotny
        </button>
      );
    }
    if (stage === 'return' && can.return) {
      return (
        <button
          type="button"
          disabled={stageBusy || !can.confirm_return}
          title={!can.confirm_return ? blockersTitle || 'Sprawdź wszystkie wydane pozycje.' : undefined}
          onClick={() => openAction('confirm_return')}
          className={equipmentPrimaryButton}
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Zatwierdź zwrot
        </button>
      );
    }
    return null;
  })();

  const fillButton = (() => {
    if (stage === 'dispatch' && can.pack && summary.unchecked_dispatch > 0) {
      return (
        <button type="button" disabled={stageBusy} onClick={() => void fill('dispatch')} className={equipmentSecondaryButton}>
          Wszystko zgodne
        </button>
      );
    }
    if (stage === 'loadback' && can.loadback && summary.loadback_unchecked > 0) {
      return (
        <button type="button" disabled={stageBusy} onClick={() => void fill('loadback')} className={equipmentSecondaryButton}>
          Wszystko wraca
        </button>
      );
    }
    if (stage === 'return' && can.return && summary.return_unchecked > 0) {
      return (
        <button type="button" disabled={stageBusy} onClick={() => void fill('return')} className={equipmentSecondaryButton}>
          Wszystko wróciło sprawne
        </button>
      );
    }
    return null;
  })();

  const stageNotes: ReactNode[] = [];
  if (stage === 'dispatch') {
    if (c.dispatch.confirmed_at) {
      stageNotes.push(
        <InfoBox key="confirmed" tone="success">
          <p>
            <Lock className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            Wydanie potwierdził(a) <strong>{equipmentByLine(c.dispatch.confirmed_by_name, c.dispatch.confirmed_at)}</strong> — lista jest
            zablokowana.
          </p>
          {c.dispatch.note && <p className="mt-1 whitespace-pre-wrap text-xs text-emerald-100/80">{c.dispatch.note}</p>}
        </InfoBox>,
      );
    } else if (!can.pack) {
      stageNotes.push(
        <InfoBox key="owner">Spakowane ilości odhacza magazyn. Widzisz stan na żywo.</InfoBox>,
      );
    }
    if (!c.dispatch.confirmed_at && summary.shortages_rejected > 0 && !can.approve_shortages) {
      stageNotes.push(
        <InfoBox key="rejected" tone="danger">
          Sprzedawca lub administrator nie zgodził się na braki ({summary.shortages_rejected}). Uzupełnij sprzęt albo zmień ilość z
          powodem i poproś ponownie.
        </InfoBox>,
      );
    }
    if (!c.dispatch.confirmed_at && summary.shortages_pending > 0 && c.dispatch.shortage_requested_at && !can.approve_shortages) {
      stageNotes.push(
        <InfoBox key="requested" tone="warning">
          Prośba o zgodę na braki: {equipmentByLine(c.dispatch.shortage_requested_name, c.dispatch.shortage_requested_at)} — czeka na
          sprzedawcę wydarzenia lub administratora.
          {c.dispatch.shortage_request_note && <span className="block text-xs text-amber-100/80">{c.dispatch.shortage_request_note}</span>}
        </InfoBox>,
      );
    }
  } else if (stage === 'loadback') {
    if (!c.dispatch.confirmed_at) {
      stageNotes.push(
        <InfoBox key="wait">Załadunek powrotny otworzy się po potwierdzeniu wydania. Poniżej pozycje spakowane do tej pory.</InfoBox>,
      );
    } else if (c.loadback.confirmed_at) {
      stageNotes.push(
        <InfoBox key="confirmed" tone={summary.loadback_missing ? 'warning' : 'success'}>
          <p>
            Załadunek powrotny zatwierdził(a) <strong>{equipmentByLine(c.loadback.confirmed_by_name, c.loadback.confirmed_at)}</strong>
            {summary.loadback_missing ? ` — rozbieżności: ${summary.loadback_missing}.` : ' — komplet.'}
          </p>
          {c.loadback.note && <p className="mt-1 whitespace-pre-wrap text-xs opacity-80">{c.loadback.note}</p>}
        </InfoBox>,
      );
    } else if (c.return.confirmed_at) {
      stageNotes.push(<InfoBox key="skipped">Zwrot zatwierdzono bez załadunku powrotnego.</InfoBox>);
    } else if (!can.loadback) {
      stageNotes.push(
        <InfoBox key="owner">Przy załadunku po wydarzeniu listę odhacza kierownik realizacji. Widzisz stan na żywo.</InfoBox>,
      );
    }
  } else {
    if (!c.dispatch.confirmed_at) {
      stageNotes.push(<InfoBox key="wait">Zwrot otworzy się po wydaniu sprzętu i wydarzeniu.</InfoBox>);
    } else if (c.return.confirmed_at) {
      stageNotes.push(
        <InfoBox key="confirmed" tone={c.return.issue_count > 0 && !c.return.issues_ack_at ? 'warning' : 'success'}>
          <p>
            Zwrot zatwierdził(a) <strong>{equipmentByLine(c.return.confirmed_by_name, c.return.confirmed_at)}</strong>
            {c.return.issue_count > 0 ? ` — rozbieżności: ${c.return.issue_count}.` : ' — bez rozbieżności.'}
          </p>
          {c.return.note && <p className="mt-1 whitespace-pre-wrap text-xs opacity-80">{c.return.note}</p>}
        </InfoBox>,
      );
    } else if (c.stage === 'loadback' && can.return) {
      stageNotes.push(
        <InfoBox key="early">
          Załadunek powrotny nie jest jeszcze zatwierdzony — zwrot możesz sprawdzić od razu. Podstawą jest ilość wydana.
        </InfoBox>,
      );
    } else if (!can.return) {
      stageNotes.push(<InfoBox key="owner">Zwrot sprawdza magazyn. Widzisz stan na żywo.</InfoBox>);
    }
  }

  return (
    <section className={`mb-6 rounded-xl bg-white/[0.04] p-4 sm:p-5 ${className}`} aria-labelledby={headingId} aria-busy={stageBusy}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-base text-[#e5e4e2]">
            Checklista sprzętu
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span data-brand-badge="true" className={`rounded-md px-2 py-0.5 text-[11px] ${STAGE_CHIP[c.stage]}`}>
              {EQUIPMENT_STAGE_LABELS[c.stage]}
            </span>
            {c.dispatch.locked && (
              <span className="inline-flex items-center gap-1 text-xs text-[#e5e4e2]/55">
                <Lock className="h-3.5 w-3.5" aria-hidden />
                Lista wydania zablokowana
              </span>
            )}
          </div>
          <p className="mt-1.5 max-w-3xl text-xs text-[#e5e4e2]/60">{EQUIPMENT_STAGE_HINTS[c.stage]}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {can.reopen && (
            <button type="button" disabled={stageBusy} onClick={() => openReopen()} className={equipmentQuietButton}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Cofnij etap
            </button>
          )}
          <button
            type="button"
            onClick={refresh}
            aria-label="Odśwież checklistę sprzętu"
            title="Odśwież"
            className="rounded-lg p-2 text-[#e5e4e2]/50 hover:bg-white/5 hover:text-[#d3bb73]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {loadError && (
        <p role="status" className="mt-2 text-xs text-amber-200/80">
          {loadError}{' '}
          <button type="button" onClick={refresh} className="underline">
            Odśwież
          </button>
        </p>
      )}

      {c.blockers.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-400/10 px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            Przed zatwierdzeniem etapu
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-100/90">
            {c.blockers.map(blocker => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}

      {c.dispatch.unlock_requested && (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          <p className="min-w-0">
            <span className="font-medium">Prośba o odblokowanie wydania</span>
            {c.dispatch.unlock_requested_at ? ` (${formatEquipmentDate(c.dispatch.unlock_requested_at)})` : ''}: {c.dispatch.unlock_reason}
            {!can.reopen && <span className="block text-amber-100/70">Czeka na administratora.</span>}
          </p>
          {can.reopen && (
            <button
              type="button"
              disabled={stageBusy}
              onClick={() => openReopen('dispatch', c.dispatch.unlock_reason ? `Prośba: ${c.dispatch.unlock_reason}` : '')}
              className={equipmentQuietButton}
            >
              Cofnij wydanie
            </button>
          )}
        </div>
      )}

      <div role="tablist" aria-label="Etapy checklisty sprzętu" className="mt-4 grid gap-2 sm:grid-cols-3">
        {EQUIPMENT_STAGE_TABS.map((tab, index) => {
          const info = stageStatus(c, tab.key);
          const selected = stage === tab.key;
          return (
            <button
              key={tab.key}
              id={`${tabsId}-tab-${tab.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${tabsId}-panel`}
              tabIndex={selected ? 0 : -1}
              onKeyDown={event => onTabKey(event, index)}
              onClick={() => setPicked(tab.key)}
              className={`relative rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/[0.09] ${selected ? 'bg-[#d3bb73]/15' : TAB_TONE[info.tone]}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={`text-sm font-medium ${selected ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'}`}>
                  {index + 1}. {tab.label}
                </span>
                {info.count > 0 && (
                  <span data-brand-badge="true" className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] tabular-nums text-[#e5e4e2]/80">
                    {info.count}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[11px] text-[#e5e4e2]/50">{tab.owner}</span>
              <span
                className={`mt-1 block text-xs ${
                  info.tone === 'done' ? 'text-emerald-200/90' : info.tone === 'problem' ? 'text-red-200/90' : 'text-[#e5e4e2]/65'
                }`}
              >
                {info.text}
              </span>
              {selected && <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[#d3bb73]" />}
            </button>
          );
        })}
      </div>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-tab-${stage}`} className="mt-4 space-y-3">
        <p className="text-xs text-[#e5e4e2]/50">Odpowiada: {ownerOf(stage)}</p>
        {stageNotes}

        {stage === 'dispatch' && can.approve_shortages && decidableShortages.length > 0 && (
          <div className="rounded-lg bg-amber-400/10 p-3">
            <h4 className="text-sm text-amber-100">Zgoda na braki</h4>
            {c.dispatch.shortage_requested_at ? (
              <p className="mt-1 text-xs text-amber-100/80">
                Prośba magazynu: {equipmentByLine(c.dispatch.shortage_requested_name, c.dispatch.shortage_requested_at)}
                {c.dispatch.shortage_request_note ? ` — ${c.dispatch.shortage_request_note}` : ''}
              </p>
            ) : (
              <p className="mt-1 text-xs text-amber-100/80">Magazyn oznaczył braki — bez zgody nie potwierdzi wydania.</p>
            )}
            <ul className="mt-2 space-y-1 text-sm text-[#e5e4e2]/90">
              {decidableShortages.map(line => (
                <li key={line.id} className="rounded-md bg-black/15 px-2.5 py-1.5">
                  <span className="font-medium">{line.name}</span>: spakowano {line.packed_qty} z {line.quantity}{' '}
                  <span className="text-red-200">(brak {line.shortage_qty})</span>
                  {line.shortage_reason ? <span className="text-[#e5e4e2]/70"> — {line.shortage_reason}</span> : null}
                  {line.shortage_status === 'rejected' && (
                    <span className="mt-0.5 block text-xs text-red-200/80">
                      Bez zgody: {equipmentByLine(line.shortage_decided_name, line.shortage_decided_at)}
                      {line.shortage_decision_note ? ` — ${line.shortage_decision_note}` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={stageBusy} onClick={() => openAction('approve')} className={equipmentPrimaryButton}>
                Zgoda na braki
              </button>
              <button type="button" disabled={stageBusy} onClick={() => openAction('reject')} className={equipmentDangerButton}>
                Odmów
              </button>
            </div>
          </div>
        )}

        {stage === 'return' && c.return.confirmed_at && c.return.issue_count > 0 && (
          <div className={`rounded-lg p-3 ${c.return.issues_ack_at ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
            <h4 className="text-sm text-[#e5e4e2]">Rozbieżności w zwrocie ({c.return.issue_count})</h4>
            {returnIssues.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-[#e5e4e2]/90">
                {returnIssues.map(line => (
                  <li key={line.id} className="rounded-md bg-black/15 px-2.5 py-1.5">
                    <span className="font-medium">{line.name}</span>:{' '}
                    {[
                      line.return_damaged_qty ? `uszkodzone ${line.return_damaged_qty}` : '',
                      line.return_missing_qty ? `brak ${line.return_missing_qty}` : '',
                    ]
                      .filter(Boolean)
                      .join(', ')}{' '}
                    z {line.shipped_qty}
                    {line.return_note ? <span className="text-[#e5e4e2]/70"> — {line.return_note}</span> : null}
                    {line.return_photos.length > 0 && <span className="text-[#e5e4e2]/50"> · zdjęcia: {line.return_photos.length}</span>}
                  </li>
                ))}
              </ul>
            )}
            {c.return.issues_ack_at ? (
              <p className="mt-2 text-xs text-emerald-100">
                Przyjął(ęła): <strong>{equipmentByLine(c.return.issues_ack_name, c.return.issues_ack_at)}</strong>
                {c.return.issues_ack_note ? ` — ${c.return.issues_ack_note}` : ''}
              </p>
            ) : (
              <p className="mt-2 text-xs text-red-100/80">Czeka na decyzję sprzedawcy wydarzenia lub administratora.</p>
            )}
            {can.ack_issues && (
              <button type="button" disabled={stageBusy} onClick={() => openAction('ack_issues')} className={`mt-3 ${equipmentPrimaryButton}`}>
                Przyjmij rozbieżności
              </button>
            )}
          </div>
        )}

        {(fillButton || confirmButton || (stage === 'dispatch' && (can.request_approval || can.request_unlock))) && (
          <div className="flex flex-wrap items-center gap-2">
            {fillButton}
            {stage === 'dispatch' && can.request_approval && (
              <button type="button" disabled={stageBusy} onClick={() => openAction('request_approval')} className={equipmentSecondaryButton}>
                Poproś o zgodę na braki
              </button>
            )}
            {confirmButton}
            {stage === 'dispatch' && can.request_unlock && (
              <button type="button" disabled={stageBusy} onClick={() => openAction('request_unlock')} className={equipmentQuietButton}>
                Poproś o odblokowanie wydania
              </button>
            )}
          </div>
        )}

        {lines.length === 0 ? (
          <p className="rounded-lg bg-white/[0.03] px-3 py-3 text-sm text-[#e5e4e2]/55">
            {stage === 'dispatch' ? 'Brak pozycji do wydania.' : 'Nie wydano jeszcze żadnego sprzętu.'}
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map(group => (
              <div key={group.category}>
                <h4 className="mb-1.5 flex items-center justify-between gap-2 text-[11px] tracking-wider text-[#d3bb73]/80">
                  <span>{group.category}</span>
                  <span className="tabular-nums text-[#e5e4e2]/40">{group.lines.length}</span>
                </h4>
                <ul className="space-y-1.5">
                  {group.lines.map(line =>
                    stage === 'dispatch' ? (
                      <DispatchLine
                        key={line.id}
                        line={line}
                        canEdit={can.pack}
                        busy={lineBusy(line.id)}
                        onSave={(qty, reason) => saveLine(line.id, RPC.pack, { p_line: line.id, p_qty: qty, p_reason: reason })}
                      />
                    ) : stage === 'loadback' ? (
                      <LoadbackLine
                        key={line.id}
                        line={line}
                        canEdit={can.loadback}
                        busy={lineBusy(line.id)}
                        onSave={(qty, note) => saveLine(line.id, RPC.loadback, { p_line: line.id, p_qty: qty, p_note: note })}
                      />
                    ) : (
                      <ReturnLine
                        key={line.id}
                        eventId={eventId}
                        line={line}
                        canEdit={can.return}
                        busy={lineBusy(line.id)}
                        onSave={(ok, damaged, note, photos) =>
                          saveLine(line.id, RPC.returnLine, { p_line: line.id, p_ok: ok, p_damaged: damaged, p_note: note, p_photos: photos })
                        }
                      />
                    ),
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}

        {confirmButton && lines.length > 6 && <div className="flex justify-end pt-1">{confirmButton}</div>}
      </div>

      {c.log.length > 0 && (
        <div className="mt-5">
          <button
            type="button"
            aria-expanded={historyOpen}
            aria-controls={`${tabsId}-history`}
            onClick={() => setHistoryOpen(open => !open)}
            className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.03]"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-[#d3bb73]">Historia checklisty</span>
            <span className="flex items-center gap-2 text-xs tabular-nums text-[#e5e4e2]/50">
              {c.log.length}
              <ChevronDown className={`h-4 w-4 transition-transform ${historyOpen ? 'rotate-180' : ''}`} aria-hidden />
            </span>
          </button>
          <ol id={`${tabsId}-history`} hidden={!historyOpen} className="mt-2 space-y-1.5">
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
                    {EQUIPMENT_STAGE_TABS.find(tab => tab.key === entry.stage)?.label} · {equipmentByLine(entry.actor_name, entry.created_at)}
                  </p>
                </li>
              );
            })}
          </ol>
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
        submitDisabled={action === 'reopen' && !confirmedAt[reopenStage]}
      >
        {action === 'reopen' && (
          <fieldset>
            <legend className="text-sm text-[#e5e4e2]/70">Etap do cofnięcia</legend>
            <div className="mt-2 grid gap-2">
              {EQUIPMENT_STAGE_TABS.map(tab => {
                const at = confirmedAt[tab.key];
                return (
                  <label
                    key={tab.key}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                      reopenStage === tab.key ? 'bg-[#d3bb73]/15 text-[#e5e4e2]' : 'bg-white/5 text-[#e5e4e2]/80'
                    } ${at ? '' : 'cursor-not-allowed opacity-50'}`}
                  >
                    <input
                      type="radio"
                      name={`${tabsId}-reopen`}
                      value={tab.key}
                      checked={reopenStage === tab.key}
                      disabled={!at}
                      onChange={() => {
                        setReopenStage(tab.key);
                        setActionError('');
                      }}
                      className="accent-[#d3bb73]"
                    />
                    <span className="min-w-0 flex-1">
                      {tab.label}
                      <span className="block text-xs text-[#e5e4e2]/50">
                        {at ? `zatwierdził(a) ${equipmentByLine(confirmedBy[tab.key], at)}` : 'nie jest zatwierdzony'}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
      </EquipmentNoteDialog>
    </section>
  );
}
