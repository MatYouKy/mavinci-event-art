import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors, spacing } from '../../../theme';
import { supabase } from '../../../lib/supabase';
import { useForegroundEffect } from '../../../hooks/useForegroundEffect';
import { createRefreshQueue } from '../../../lib/refreshQueue';
import { formatEventStepDate } from '../../../lib/eventSteps';
import {
  EQUIPMENT_LOG_LABELS,
  EQUIPMENT_RETURN_PHOTO_LIMIT,
  EQUIPMENT_STAGE_HINTS,
  EQUIPMENT_STAGE_LABELS,
  EQUIPMENT_STAGE_TABS,
  type EquipmentChecklist,
  type EquipmentChecklistLine,
  type EquipmentChecklistLogEntry,
  type EquipmentStageKey,
  equipmentDefaultStage,
  equipmentLineTone,
  equipmentStageLines,
} from '../../../lib/equipmentChecklist';
import {
  EQUIPMENT_DATABASE_UPDATE_MESSAGE,
  type EquipmentChecklistLoad,
  discardEquipmentReturnPhotos,
  equipmentChecklistApi,
  equipmentErrorMessage,
  equipmentShortageDecisionLines,
  fetchEquipmentChecklist,
  uploadEquipmentReturnPhoto,
} from '../../../lib/equipmentChecklistApi';
import { EquipmentLineRow, type EquipmentLineDraft } from './EquipmentLineRow';
import { EquipmentNoteModal, type EquipmentNoteRequest } from './EquipmentNoteModal';

/*
 * Checklista sprzętu wydarzenia w trzech etapach (wydanie → załadunek powrotny → zwrot) — zakładka „Checklista”
 * w szczegółach wydarzenia i „Sprzęt” w pulpicie realizacji. Wszystko (etap, `can`, blokady, stan pozycji) liczy baza
 * (get_event_equipment_checklist); każda czynność to RPC zwracające odświeżoną checklistę. Zmiany z innych urządzeń
 * przychodzą przez Realtime (event_equipment_checks, event_equipment_checklists). Baza bez migracji → dawna lista
 * tylko do odczytu i „Wymaga aktualizacji bazy”. docs/equipment-checklist.md.
 */

type Props = {
  eventId: string;
  /** Po czynności zamykającej / cofającej etap (kroki realizacji, dane wydarzenia). */
  onChanged?: () => void;
  /** Dawna lista sprzętu tylko do odczytu — pokazywana, gdy baza nie ma jeszcze checklisty. */
  legacy?: React.ReactNode;
  /** Zmiana wartości (np. „pociągnij, aby odświeżyć” na ekranie wydarzenia) wczytuje checklistę ponownie. */
  refreshKey?: number;
};

type LoadState = { eventId: string; load: EquipmentChecklistLoad };

const RED_TEXT = '#fca5a5';
const AMBER_TEXT = '#fcd34d';
const GREEN_TEXT = '#86efac';

const STAGE_TAB_LABEL: Record<EquipmentStageKey, string> = {
  dispatch: 'Wydanie',
  loadback: 'Załadunek powrotny',
  return: 'Zwrot',
};

const CHECK_TONES = new Set(['unchecked', 'pending', 'missing', 'shortage', 'damaged']);

const lineKey = (stage: EquipmentStageKey, lineId: string) => `${stage}:${lineId}`;

const atLeast = (min: number, max: number, message: string) => (note: string) => {
  const length = note.trim().length;
  return length < min || length > max ? message : null;
};

const atMost = (max: number, message: string) => (note: string) => (note.trim().length > max ? message : null);

function logNumber(details: Record<string, unknown>, key: string): number | null {
  const value = details[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function logText(details: Record<string, unknown>, key: string): string | null {
  const value = details[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Krótki opis wpisu historii (ilości, braki) z `details` zapisanych przez bazę. */
function logDetails(entry: EquipmentChecklistLogEntry): string | null {
  const d = entry.details;
  switch (entry.action) {
    case 'packed': {
      const packed = logNumber(d, 'packed_qty');
      return packed == null ? 'Odznaczono' : `Spakowano ${packed} z ${logNumber(d, 'quantity') ?? '?'}`;
    }
    case 'loadback_set': {
      const qty = logNumber(d, 'loadback_qty');
      return qty == null ? 'Odznaczono' : `Wraca ${qty} z ${logNumber(d, 'shipped_qty') ?? '?'}`;
    }
    case 'return_set': {
      const ok = logNumber(d, 'ok');
      const photos = logNumber(d, 'photos');
      const photoText = photos ? ` · zdjęcia: ${photos}` : '';
      if (ok == null) return `Bez oceny${photoText}`;
      return `Sprawne ${ok} · uszkodzone ${logNumber(d, 'damaged') ?? 0} · brak ${logNumber(d, 'missing') ?? 0}${photoText}`;
    }
    case 'filled': {
      const count = logNumber(d, 'count');
      return count != null ? `Uzupełniono pozycji: ${count}` : null;
    }
    case 'dispatch_confirmed': {
      const shortages = logText(d, 'shortages');
      return shortages ? `Braki (zgoda): ${shortages}` : 'Komplet';
    }
    case 'shortage_requested':
    case 'shortage_approved':
    case 'shortage_rejected':
      return logText(d, 'shortages');
    case 'loadback_confirmed': {
      const missing = logText(d, 'missing');
      return missing ? `Braki: ${missing}` : 'Komplet';
    }
    case 'return_confirmed': {
      const issues = logNumber(d, 'issues');
      const list = logText(d, 'list');
      return issues ? `Rozbieżności: ${issues}${list ? ` — ${list}` : ''}` : 'Bez rozbieżności';
    }
    default:
      return null;
  }
}

function stageProgress(checklist: EquipmentChecklist, stage: EquipmentStageKey): { done: number; total: number } {
  const s = checklist.summary;
  if (stage === 'dispatch') {
    const total = s.required || s.lines;
    return { done: Math.max(total - s.unchecked_dispatch, 0), total };
  }
  if (stage === 'loadback') return { done: Math.max(s.shipped - s.loadback_unchecked, 0), total: s.shipped };
  return { done: Math.max(s.shipped - s.return_unchecked, 0), total: s.shipped };
}

function stageConfirmed(checklist: EquipmentChecklist, stage: EquipmentStageKey): boolean {
  if (stage === 'dispatch') return Boolean(checklist.dispatch.confirmed_at);
  if (stage === 'loadback') return Boolean(checklist.loadback.confirmed_at);
  return Boolean(checklist.return.confirmed_at);
}

/** Kierownik zgłosił brak przy załadunku powrotnym (wraca mniej, niż wydano). */
function loadbackShortfall(line: EquipmentChecklistLine): boolean {
  return line.loadback_qty != null && line.loadback_qty < line.shipped_qty;
}

function returnIssueLines(checklist: EquipmentChecklist): EquipmentChecklistLine[] {
  return checklist.lines.filter(
    (line) => line.shipped_qty > 0 && line.return_ok_qty != null && ((line.return_damaged_qty || 0) > 0 || (line.return_missing_qty || 0) > 0),
  );
}

export default function EquipmentChecklistPanel({ eventId, onChanged, legacy, refreshKey }: Props) {
  const [state, setState] = useState<LoadState | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EquipmentStageKey>('dispatch');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [busyLines, setBusyLines] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [todoOnly, setTodoOnly] = useState(false);
  const [noteRequest, setNoteRequest] = useState<EquipmentNoteRequest | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  // Odczyty rozpoczęte przed zapisem są odrzucane (wynik zapisu jest nowszy); `inflight` — zapisy w toku.
  const stamp = useRef(0);
  const inflight = useRef(0);
  const overlapped = useRef(false);
  const seenStage = useRef<{ eventId: string; stage: string } | null>(null);

  const current = state?.eventId === eventId ? state.load : null;
  const checklist = current?.status === 'ready' ? current.checklist : null;
  const checklistRef = useRef<EquipmentChecklist | null>(null);
  checklistRef.current = checklist;
  const stateRef = useRef<LoadState | null>(state);
  stateRef.current = state;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const startedAt = stamp.current;
      const result = await fetchEquipmentChecklist(eventId, signal);
      if (signal?.aborted || startedAt !== stamp.current) return;
      if (result.status === 'error') {
        // Chwilowy błąd odświeżania nie zasłania wczytanej listy — tylko komunikat nad nią.
        const previous = stateRef.current;
        if (previous?.eventId === eventId && previous.load.status === 'ready') {
          setRefreshError(result.message);
          return;
        }
        setRefreshError(null);
        setState({ eventId, load: result });
        return;
      }
      setRefreshError(null);
      setState({ eventId, load: result });
    },
    [eventId],
  );

  useEffect(() => {
    setExpanded(null);
    setTodoOnly(false);
    setHistoryOpen(false);
    void load();
  }, [eventId, load]);

  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return;
    lastRefreshKey.current = refreshKey;
    void load();
  }, [refreshKey, load]);

  // Etap pokazywany domyślnie: bieżący etap wydarzenia; po zmianie etapu (np. potwierdzone wydanie) — nowy etap.
  useEffect(() => {
    if (!checklist) return;
    const seen = seenStage.current;
    if (!seen || seen.eventId !== eventId || seen.stage !== checklist.stage) {
      seenStage.current = { eventId, stage: checklist.stage };
      setSelected(equipmentDefaultStage(checklist));
      setExpanded(null);
    }
  }, [checklist, eventId]);

  const live = current?.status === 'ready' || current?.status === 'error';
  useForegroundEffect(
    (signal, resumed) => {
      if (!live) return;
      const queue = createRefreshQueue(signal, (requestSignal) => load(requestSignal));
      if (resumed) void queue.refresh();
      const channel = supabase.channel(`mobile-equipment-checklist-${eventId}`);
      ['event_equipment_checks', 'event_equipment_checklists', 'event_equipment'].forEach((table) => {
        channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `event_id=eq.${eventId}` }, queue.schedule);
      });
      // Prośba o odblokowanie wydania jest zapisana w wydarzeniu (events.loading_unlock_*).
      channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, queue.schedule);
      channel.subscribe();
      return () => supabase.removeChannel(channel);
    },
    [eventId, load, live],
  );

  /** Wykonuje RPC checklisty; wynik zastępuje stan, błąd bazy (po polsku) — w alercie. */
  const run = useCallback(
    async (
      key: string,
      action: () => Promise<EquipmentChecklist>,
      options: { lineId?: string; changesSteps?: boolean; errorTitle?: string } = {},
    ): Promise<boolean> => {
      stamp.current += 1;
      if (inflight.current > 0) overlapped.current = true;
      inflight.current += 1;
      if (options.lineId) {
        const lineId = options.lineId;
        setBusyLines((previous) => new Set(previous).add(lineId));
      } else {
        setBusyAction(key);
      }
      let ok = false;
      let next: EquipmentChecklist | null = null;
      try {
        next = await action();
        ok = true;
      } catch (error) {
        Alert.alert(options.errorTitle || 'Nie zapisano', equipmentErrorMessage(error, 'Spróbuj ponownie.'));
      } finally {
        inflight.current -= 1;
        stamp.current += 1;
        if (options.lineId) {
          const lineId = options.lineId;
          setBusyLines((previous) => {
            const copy = new Set(previous);
            copy.delete(lineId);
            return copy;
          });
        } else {
          setBusyAction(null);
        }
      }
      if (next && inflight.current === 0) {
        setState({ eventId, load: { status: 'ready', checklist: next } });
        setRefreshError(null);
        // Zapisy nakładały się — odpowiedzi mogły przyjść w innej kolejności niż zapis w bazie; dociągamy stan.
        if (overlapped.current) {
          overlapped.current = false;
          void load();
        }
      } else if (inflight.current === 0 || !next) {
        // Błąd — pobieramy aktualny stan z bazy (np. ktoś inny zmienił checklistę).
        void load();
      }
      if (ok && options.changesSteps) onChangedRef.current?.();
      return ok;
    },
    [eventId, load],
  );

  const latestLine = (lineId: string) => checklistRef.current?.lines.find((line) => line.id === lineId) ?? null;

  // ---------- pozycje ----------

  const quick = (line: EquipmentChecklistLine, stage: EquipmentStageKey) => {
    const key = lineKey(stage, line.id);
    if (stage === 'dispatch') {
      if (line.packed_qty == null) void run(key, () => equipmentChecklistApi.pack(line.id, line.quantity), { lineId: line.id });
      else if (line.packed_qty >= line.quantity) void run(key, () => equipmentChecklistApi.pack(line.id, null), { lineId: line.id });
      else setExpanded(key);
      return;
    }
    if (stage === 'loadback') {
      if (line.loadback_qty == null) void run(key, () => equipmentChecklistApi.loadback(line.id, line.shipped_qty), { lineId: line.id });
      else if (line.loadback_qty >= line.shipped_qty) void run(key, () => equipmentChecklistApi.loadback(line.id, null), { lineId: line.id });
      else setExpanded(key);
      return;
    }
    if (line.return_ok_qty == null && loadbackShortfall(line)) {
      // Kierownik zgłosił brak przy załadunku — zwrot tej pozycji wymaga wpisania ilości i opisu.
      setExpanded(key);
    } else if (line.return_ok_qty == null) {
      void run(key, () => equipmentChecklistApi.returnLine(line.id, line.shipped_qty, 0, null, null), { lineId: line.id });
    } else if (line.return_ok_qty >= line.shipped_qty && !(line.return_damaged_qty || 0)) {
      void run(key, () => equipmentChecklistApi.returnLine(line.id, null, 0, null, null), { lineId: line.id });
    } else {
      setExpanded(key);
    }
  };

  const saveLine = async (line: EquipmentChecklistLine, stage: EquipmentStageKey, draft: EquipmentLineDraft) => {
    const key = lineKey(stage, line.id);
    const done = await run(
      key,
      () =>
        stage === 'dispatch'
          ? equipmentChecklistApi.pack(line.id, draft.qty, draft.note)
          : stage === 'loadback'
            ? equipmentChecklistApi.loadback(line.id, draft.qty, draft.note)
            : equipmentChecklistApi.returnLine(line.id, draft.ok, draft.damaged, draft.note, null),
      { lineId: line.id },
    );
    if (done) setExpanded((value) => (value === key ? null : value));
    return done;
  };

  const uncheckLine = async (line: EquipmentChecklistLine, stage: EquipmentStageKey) => {
    const key = lineKey(stage, line.id);
    const done = await run(
      key,
      () =>
        stage === 'dispatch'
          ? equipmentChecklistApi.pack(line.id, null)
          : stage === 'loadback'
            ? equipmentChecklistApi.loadback(line.id, null)
            : equipmentChecklistApi.returnLine(line.id, null, 0, null, null),
      { lineId: line.id },
    );
    if (done) setExpanded((value) => (value === key ? null : value));
    return done;
  };

  const pickAndUpload = async (lineId: string, source: 'camera' | 'library', remaining: number) => {
    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Brak dostępu',
          source === 'camera' ? 'Zezwól aplikacji na dostęp do aparatu.' : 'Zezwól aplikacji na dostęp do zdjęć.',
        );
        return;
      }
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, exif: false })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              quality: 0.7,
              allowsMultipleSelection: remaining > 1,
              selectionLimit: remaining,
            });
      if (result.canceled || !result.assets?.length) return;
      const assets = result.assets.slice(0, remaining);
      setBusyLines((previous) => new Set(previous).add(lineId));
      const uploaded: string[] = [];
      try {
        for (const asset of assets) {
          uploaded.push(await uploadEquipmentReturnPhoto(eventId, lineId, asset));
        }
      } catch (error) {
        await discardEquipmentReturnPhotos(uploaded);
        Alert.alert('Nie wysłano zdjęcia', equipmentErrorMessage(error, 'Spróbuj ponownie.'));
        return;
      } finally {
        setBusyLines((previous) => {
          const copy = new Set(previous);
          copy.delete(lineId);
          return copy;
        });
      }
      // Zdjęcia dopisujemy do zapisanego stanu pozycji (ilości i opis bez zmian); pełna lista ścieżek.
      const line = latestLine(lineId);
      if (!line) {
        await discardEquipmentReturnPhotos(uploaded);
        return;
      }
      const photos = [...line.return_photos, ...uploaded].slice(0, EQUIPMENT_RETURN_PHOTO_LIMIT);
      const done = await run(
        `photo:${lineId}`,
        () => equipmentChecklistApi.returnLine(line.id, line.return_ok_qty, line.return_damaged_qty ?? 0, line.return_note, photos),
        { lineId, errorTitle: 'Nie zapisano zdjęcia' },
      );
      if (!done) await discardEquipmentReturnPhotos(uploaded);
    } catch (error) {
      Alert.alert('Nie wysłano zdjęcia', equipmentErrorMessage(error, 'Spróbuj ponownie.'));
    }
  };

  const addPhotos = (line: EquipmentChecklistLine) => {
    const remaining = EQUIPMENT_RETURN_PHOTO_LIMIT - line.return_photos.length;
    if (remaining <= 0) {
      Alert.alert('Limit zdjęć', `Najwyżej ${EQUIPMENT_RETURN_PHOTO_LIMIT} zdjęć na pozycję.`);
      return;
    }
    Alert.alert('Zdjęcie zwrotu', 'Wybierz źródło zdjęcia.', [
      { text: 'Zrób zdjęcie', onPress: () => void pickAndUpload(line.id, 'camera', remaining) },
      { text: 'Wybierz z galerii', onPress: () => void pickAndUpload(line.id, 'library', remaining) },
      { text: 'Anuluj', style: 'cancel' },
    ]);
  };

  const removePhoto = (line: EquipmentChecklistLine, path: string) => {
    Alert.alert('Usunąć zdjęcie?', 'Zdjęcie zniknie z tej pozycji zwrotu.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: () => {
          const fresh = latestLine(line.id) ?? line;
          void run(
            `photo:${line.id}`,
            () =>
              equipmentChecklistApi.returnLine(
                fresh.id,
                fresh.return_ok_qty,
                fresh.return_damaged_qty ?? 0,
                fresh.return_note,
                fresh.return_photos.filter((item) => item !== path),
              ),
            { lineId: line.id, errorTitle: 'Nie usunięto zdjęcia' },
          );
        },
      },
    ]);
  };

  // ---------- czynności etapów ----------

  const fill = (stage: EquipmentStageKey, count: number, skipped = 0) => {
    const title = stage === 'dispatch' ? 'Wszystko zgodne' : stage === 'loadback' ? 'Wszystko wraca' : 'Wszystko wróciło sprawne';
    const what =
      stage === 'dispatch'
        ? 'pełną ilością spakowaną'
        : stage === 'loadback'
          ? 'pełną wydaną ilością (wraca komplet)'
          : 'jako sprawne w pełnej wydanej ilości';
    const skippedText =
      skipped > 0
        ? ` Pominiemy pozycje z brakiem zgłoszonym przy załadunku powrotnym (${skipped}) — wpisz je ręcznie z opisem.`
        : '';
    Alert.alert(title, `Uzupełnić niesprawdzone pozycje (${count}) ${what}? Już wpisane pozycje się nie zmienią.${skippedText}`, [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Uzupełnij', onPress: () => void run(`fill:${stage}`, () => equipmentChecklistApi.fill(eventId, stage)) },
    ]);
  };

  const askNote = (request: EquipmentNoteRequest) => setNoteRequest(request);

  const requestApproval = (c: EquipmentChecklist) =>
    askNote({
      title: 'Poproś o zgodę na braki',
      description: [
        c.summary.shortages_pending > 0 ? `Braki czekające na zgodę: ${c.summary.shortages_pending}.` : null,
        c.summary.shortages_rejected > 0 ? `Braki bez zgody: ${c.summary.shortages_rejected} — napisz, co się zmieniło.` : null,
        'Powiadomimy sprzedawcę wydarzenia i administratorów.',
      ]
        .filter(Boolean)
        .join(' '),
      label: 'Notatka dla sprzedawcy',
      placeholder: 'np. co proponujesz w zamian, do kiedy uzupełnisz',
      maxLength: 1000,
      validate: atMost(1000, 'Notatka może mieć najwyżej 1000 znaków.'),
      confirmLabel: 'Wyślij prośbę',
      onSubmit: (note) => run('request_approval', () => equipmentChecklistApi.requestApproval(eventId, note)),
    });

  // Decyzja dotyczy braków, które osoba widzi (pending i rejected); zmiana ilości w międzyczasie → baza odrzuca,
  // komunikat w alercie i ponowne wczytanie (run).
  const decideShortages = (c: EquipmentChecklist, approve: boolean) => {
    const lines = equipmentShortageDecisionLines(c);
    askNote(
      approve
        ? {
            title: 'Zgoda na braki',
            description: 'Magazyn będzie mógł potwierdzić wydanie z tymi brakami.',
            label: 'Notatka dla magazynu',
            placeholder: 'opcjonalnie',
            maxLength: 1000,
            validate: atMost(1000, 'Notatka może mieć najwyżej 1000 znaków.'),
            confirmLabel: 'Zgoda',
            tone: 'success',
            onSubmit: (note) => run('decide', () => equipmentChecklistApi.decideShortages(eventId, true, note, lines)),
          }
        : {
            title: 'Odmowa — braki bez zgody',
            description: 'Wydanie zostanie zablokowane, dopóki magazyn nie uzupełni sprzętu albo nie zmieni ilości.',
            label: 'Co magazyn ma zrobić?',
            placeholder: 'np. dowieźć, wynająć, zamienić',
            required: true,
            maxLength: 1000,
            validate: atLeast(3, 1000, 'Napisz, co magazyn ma zrobić (np. dowieźć, wynająć, zamienić).'),
            confirmLabel: 'Odmów',
            tone: 'danger',
            onSubmit: (note) =>
              run('decide:reject', () => equipmentChecklistApi.decideShortages(eventId, false, note, lines)),
          },
    );
  };

  const confirmDispatch = (c: EquipmentChecklist) =>
    askNote({
      title: 'Potwierdź wydanie',
      description: [
        c.summary.shortages_approved > 0 ? `Braki ze zgodą: ${c.summary.shortages_approved}.` : 'Komplet zgodny z listą.',
        'Po potwierdzeniu lista zostanie zablokowana — zmiana wymaga cofnięcia wydania przez administratora. Powiadomimy kierownika realizacji.',
      ].join(' '),
      label: 'Notatka do wydania',
      placeholder: 'opcjonalnie, np. auto, godzina, kto odebrał',
      maxLength: 2000,
      validate: atMost(2000, 'Notatka może mieć najwyżej 2000 znaków.'),
      confirmLabel: 'Potwierdź wydanie',
      tone: 'success',
      onSubmit: (note) => run('confirm_dispatch', () => equipmentChecklistApi.confirmDispatch(eventId, note), { changesSteps: true }),
    });

  const requestUnlock = () =>
    askNote({
      title: 'Poproś o odblokowanie',
      description: 'Prośba trafi do administratorów — cofną wydanie, żeby można było poprawić listę.',
      label: 'Co trzeba zmienić w wydaniu?',
      placeholder: 'np. dołożono 2 kable XLR, pomyłkowo odhaczony mikser',
      required: true,
      maxLength: 1000,
      validate: atLeast(5, 1000, 'Opisz, co trzeba zmienić w wydaniu (5–1000 znaków).'),
      confirmLabel: 'Wyślij prośbę',
      onSubmit: (reason) => run('request_unlock', () => equipmentChecklistApi.requestUnlock(eventId, reason)),
    });

  const confirmLoadback = (c: EquipmentChecklist) =>
    askNote({
      title: 'Zatwierdź załadunek powrotny',
      description:
        c.summary.loadback_missing > 0
          ? `Rozbieżności: ${c.summary.loadback_missing} poz. — powiadomimy magazyn, sprzedawcę wydarzenia i administratorów.`
          : 'Wraca komplet — powiadomimy magazyn.',
      label: 'Notatka',
      placeholder: 'opcjonalnie, np. auto, kto wiezie, godzina',
      maxLength: 2000,
      validate: atMost(2000, 'Notatka może mieć najwyżej 2000 znaków.'),
      confirmLabel: 'Zatwierdź',
      tone: 'success',
      onSubmit: (note) => run('confirm_loadback', () => equipmentChecklistApi.confirmLoadback(eventId, note), { changesSteps: true }),
    });

  const confirmReturn = (c: EquipmentChecklist) => {
    const issues = returnIssueLines(c).length;
    askNote({
      title: 'Zatwierdź zwrot',
      description:
        issues > 0
          ? `Rozbieżności: ${issues} poz. — trafią do sprzedawcy wydarzenia i administratorów do przyjęcia z decyzją.`
          : 'Bez rozbieżności — krok „Przyjmij zwrot” zamknie się sam.',
      label: 'Notatka',
      placeholder: 'opcjonalnie',
      maxLength: 2000,
      validate: atMost(2000, 'Notatka może mieć najwyżej 2000 znaków.'),
      confirmLabel: 'Zatwierdź zwrot',
      tone: 'success',
      onSubmit: (note) => run('confirm_return', () => equipmentChecklistApi.confirmReturn(eventId, note), { changesSteps: true }),
    });
  };

  const ackIssues = (c: EquipmentChecklist) =>
    askNote({
      title: 'Przyjmij rozbieżności',
      description: `Rozbieżności w zwrocie: ${c.return.issue_count}. Napisz decyzję — krok „Przyjmij zwrot” się zamknie, magazyn dostanie powiadomienie.`,
      label: 'Co dalej?',
      placeholder: 'np. obciążamy klienta, naprawa na nasz koszt, sprzęt odnaleziony',
      required: true,
      maxLength: 1000,
      validate: atLeast(5, 1000, 'Napisz, co dalej (np. obciążamy klienta, naprawa na nasz koszt, sprzęt odnaleziony) — 5–1000 znaków.'),
      confirmLabel: 'Przyjmij',
      onSubmit: (note) => run('ack_issues', () => equipmentChecklistApi.ackIssues(eventId, note), { changesSteps: true }),
    });

  const reopen = (stage: EquipmentStageKey) =>
    askNote({
      title: `Cofnij etap — ${STAGE_TAB_LABEL[stage]}`,
      description:
        stage === 'dispatch'
          ? 'Lista wydania zostanie odblokowana — magazyn będzie mógł ją poprawić i ponownie potwierdzić.'
          : stage === 'loadback'
            ? 'Kierownik realizacji będzie mógł ponownie sprawdzić załadunek powrotny.'
            : 'Magazyn będzie mógł ponownie sprawdzić zwrot; przyjęcie rozbieżności zostanie wyczyszczone.',
      label: 'Powód',
      placeholder: 'co trzeba poprawić',
      required: true,
      maxLength: 1000,
      validate: atLeast(5, 1000, 'Podaj powód (5–1000 znaków).'),
      confirmLabel: 'Cofnij etap',
      tone: 'danger',
      onSubmit: (reason) => run('reopen', () => equipmentChecklistApi.reopen(eventId, stage, reason), { changesSteps: true }),
    });

  // ---------- widok ----------

  const visibleLines = useMemo(() => {
    if (!checklist) return [];
    const lines = equipmentStageLines(checklist, selected);
    return todoOnly ? lines.filter((line) => CHECK_TONES.has(equipmentLineTone(line, selected))) : lines;
  }, [checklist, selected, todoOnly]);

  if (!current) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary.gold} />
        <Text style={styles.loadingText}>Wczytywanie checklisty sprzętu…</Text>
      </View>
    );
  }

  if (current.status === 'missing') {
    return (
      <View>
        <View style={styles.notice}>
          <Feather name="database" size={18} color={colors.primary.gold} />
          <View style={styles.flex}>
            <Text style={styles.noticeTitle}>{EQUIPMENT_DATABASE_UPDATE_MESSAGE}</Text>
            <Text style={styles.noticeText}>
              Checklista sprzętu w trzech etapach (wydanie, załadunek powrotny, zwrot) zadziała po aktualizacji bazy. Poniżej lista sprzętu tylko do odczytu.
            </Text>
          </View>
        </View>
        {legacy}
      </View>
    );
  }

  if (current.status === 'denied') {
    return (
      <View style={styles.notice}>
        <Feather name="lock" size={18} color={colors.primary.gold} />
        <Text style={[styles.noticeText, styles.flex]}>{current.message}</Text>
      </View>
    );
  }

  if (current.status === 'error') {
    return (
      <View style={styles.notice}>
        <Feather name="alert-circle" size={18} color={RED_TEXT} />
        <View style={styles.flex}>
          <Text style={styles.noticeTitle}>Nie udało się wczytać checklisty sprzętu</Text>
          <Text style={styles.noticeText}>{current.message}</Text>
          <TouchableOpacity style={[styles.secondaryBtn, styles.retry]} onPress={() => void load()}>
            <Feather name="refresh-cw" size={15} color={colors.text.primary} />
            <Text style={styles.secondaryBtnText}>Spróbuj ponownie</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const c = current.checklist;
  const can = c.can;
  const editable = selected === 'dispatch' ? can.pack : selected === 'loadback' ? can.loadback : can.return;
  const allLines = equipmentStageLines(c, selected);
  const todoCount = allLines.filter((line) => CHECK_TONES.has(equipmentLineTone(line, selected))).length;
  const reopenStage: EquipmentStageKey | null = c.return.confirmed_at
    ? 'return'
    : c.loadback.confirmed_at
      ? 'loadback'
      : c.dispatch.confirmed_at
        ? 'dispatch'
        : null;
  const stageLocked = selected !== 'dispatch' && !c.dispatch.confirmed_at;
  const decisionShortages = c.lines.filter((line) => line.shortage_status === 'pending' || line.shortage_status === 'rejected');
  const issueLines = returnIssueLines(c);
  const owner = EQUIPMENT_STAGE_TABS.find((tab) => tab.key === selected)?.owner;

  const actionButton = (
    key: string,
    label: string,
    icon: string,
    onPress: () => void,
    variant: 'primary' | 'success' | 'secondary' | 'danger' = 'secondary',
    /** Czynność jeszcze niedostępna — przycisk przygaszony, dotknięcie pokazuje, co blokuje (zdania z bazy). */
    blocked: string | null = null,
  ) => {
    const busy = busyAction === key;
    const working = busyAction !== null;
    const style =
      variant === 'primary'
        ? styles.primaryBtn
        : variant === 'success'
          ? styles.successBtn
          : variant === 'danger'
            ? styles.dangerBtn
            : styles.secondaryBtn;
    const textStyle =
      variant === 'primary' ? styles.primaryBtnText : variant === 'secondary' ? styles.secondaryBtnText : styles.whiteBtnText;
    const iconColor = variant === 'primary' ? colors.background.primary : variant === 'secondary' ? colors.text.primary : colors.white;
    return (
      <TouchableOpacity
        key={key}
        style={[style, (blocked !== null || working) && styles.disabled]}
        onPress={blocked !== null ? () => Alert.alert('Jeszcze nie można', blocked) : onPress}
        disabled={working}
        accessibilityRole="button"
        accessibilityState={{ disabled: blocked !== null || working }}
      >
        {busy ? <ActivityIndicator size="small" color={iconColor} /> : <Feather name={icon as any} size={17} color={iconColor} />}
        <Text style={textStyle}>{label}</Text>
      </TouchableOpacity>
    );
  };

  const stageInfo: { text: string; color?: string; italic?: boolean }[] = [];
  const by = (name: string | null, at: string | null) => [name, formatEventStepDate(at)].filter(Boolean).join(', ');
  if (selected === 'dispatch') {
    if (c.dispatch.confirmed_at) {
      stageInfo.push({ text: `Wydanie potwierdził(a): ${by(c.dispatch.confirmed_by_name, c.dispatch.confirmed_at)}`, color: GREEN_TEXT });
      if (c.dispatch.note) stageInfo.push({ text: c.dispatch.note, italic: true });
      if (c.dispatch.locked) stageInfo.push({ text: 'Lista zablokowana — zmiana wymaga cofnięcia wydania przez administratora.' });
    }
    if (c.dispatch.unlock_requested) {
      stageInfo.push({
        text: `Prośba o odblokowanie wysłana${c.dispatch.unlock_requested_at ? ` (${formatEventStepDate(c.dispatch.unlock_requested_at)})` : ''}${c.dispatch.unlock_reason ? `: ${c.dispatch.unlock_reason}` : ''}`,
        color: AMBER_TEXT,
      });
    }
    if (!c.dispatch.confirmed_at && c.dispatch.shortage_requested_at) {
      stageInfo.push({
        text: `O zgodę na braki poprosił(a): ${by(c.dispatch.shortage_requested_name, c.dispatch.shortage_requested_at)}${c.dispatch.shortage_request_note ? ` — ${c.dispatch.shortage_request_note}` : ''}`,
        color: c.summary.shortages_pending > 0 ? AMBER_TEXT : undefined,
      });
    }
  } else if (selected === 'loadback') {
    if (stageLocked) stageInfo.push({ text: 'Załadunek powrotny otworzy się po potwierdzeniu wydania z magazynu.' });
    else if (c.loadback.confirmed_at) {
      stageInfo.push({ text: `Zatwierdził(a): ${by(c.loadback.confirmed_by_name, c.loadback.confirmed_at)}`, color: GREEN_TEXT });
      if (c.loadback.note) stageInfo.push({ text: c.loadback.note, italic: true });
    } else if (c.return.confirmed_at) {
      stageInfo.push({ text: 'Zwrot przyjęto bez zatwierdzonego załadunku powrotnego.' });
    }
  } else {
    if (stageLocked) stageInfo.push({ text: 'Zwrot otworzy się po potwierdzeniu wydania z magazynu.' });
    else if (c.return.confirmed_at) {
      stageInfo.push({ text: `Zwrot zatwierdził(a): ${by(c.return.confirmed_by_name, c.return.confirmed_at)}`, color: GREEN_TEXT });
      if (c.return.note) stageInfo.push({ text: c.return.note, italic: true });
      if (c.return.issue_count > 0) {
        stageInfo.push({ text: `Rozbieżności: ${c.return.issue_count}`, color: RED_TEXT });
        if (c.return.issues_ack_at) {
          stageInfo.push({
            text: `Przyjął(a): ${by(c.return.issues_ack_name, c.return.issues_ack_at)}${c.return.issues_ack_note ? ` — ${c.return.issues_ack_note}` : ''}`,
            color: GREEN_TEXT,
          });
        }
      }
    } else if (!c.loadback.confirmed_at) {
      stageInfo.push({ text: 'Zwrot można sprawdzić także przed zatwierdzeniem załadunku powrotnego — podstawą jest ilość wydana.' });
    }
  }

  const blockedText = (fallback: string) => (c.blockers.length ? c.blockers.join('\n') : fallback);
  const stageActions: React.ReactNode[] = [];
  if (selected === 'dispatch') {
    if (can.pack && c.summary.unchecked_dispatch > 0) {
      stageActions.push(actionButton('fill:dispatch', 'Wszystko zgodne', 'check-square', () => fill('dispatch', c.summary.unchecked_dispatch), 'primary'));
    }
    if (can.request_approval) {
      stageActions.push(actionButton('request_approval', 'Poproś o zgodę na braki', 'send', () => requestApproval(c)));
    }
    if (can.pack) {
      stageActions.push(
        actionButton(
          'confirm_dispatch',
          'Potwierdź wydanie',
          'truck',
          () => confirmDispatch(c),
          'success',
          can.confirm_dispatch ? null : blockedText('Odhacz wszystkie pozycje; braki wymagają zgody sprzedawcy lub administratora.'),
        ),
      );
    }
    if (can.request_unlock) {
      stageActions.push(actionButton('request_unlock', 'Poproś o odblokowanie', 'unlock', requestUnlock));
    }
  } else if (selected === 'loadback' && !stageLocked) {
    if (can.loadback && c.summary.loadback_unchecked > 0) {
      stageActions.push(actionButton('fill:loadback', 'Wszystko wraca', 'check-square', () => fill('loadback', c.summary.loadback_unchecked), 'primary'));
    }
    if (can.loadback) {
      stageActions.push(
        actionButton(
          'confirm_loadback',
          'Zatwierdź załadunek powrotny',
          'truck',
          () => confirmLoadback(c),
          'success',
          can.confirm_loadback ? null : blockedText('Sprawdź wszystkie wydane pozycje.'),
        ),
      );
    }
  } else if (selected === 'return' && !stageLocked) {
    // „Wszystko wróciło sprawne” pomija pozycje z brakiem zgłoszonym przy załadunku powrotnym (wymagają opisu).
    const returnSkipped = c.lines.filter((line) => line.shipped_qty > 0 && line.return_ok_qty == null && loadbackShortfall(line)).length;
    const returnFillable = c.summary.return_unchecked - returnSkipped;
    if (can.return && returnFillable > 0) {
      stageActions.push(
        actionButton(
          'fill:return',
          'Wszystko wróciło sprawne',
          'check-square',
          () => fill('return', returnFillable, returnSkipped),
          'primary',
        ),
      );
    }
    if (can.return) {
      stageActions.push(
        actionButton(
          'confirm_return',
          'Zatwierdź zwrot',
          'archive',
          () => confirmReturn(c),
          'success',
          can.confirm_return ? null : blockedText('Sprawdź wszystkie wydane pozycje.'),
        ),
      );
    }
  }

  return (
    <View>
      {/* Etap wydarzenia */}
      <View style={[styles.header, c.stage === 'issues' && styles.headerIssues, c.stage === 'done' && styles.headerDone]}>
        <Text style={styles.headerKicker}>Checklista sprzętu</Text>
        <Text style={styles.headerTitle}>{EQUIPMENT_STAGE_LABELS[c.stage]}</Text>
        <Text style={styles.headerHint}>{EQUIPMENT_STAGE_HINTS[c.stage]}</Text>
        {c.blockers.map((blocker) => (
          <View key={blocker} style={styles.blocker}>
            <Feather name="alert-circle" size={15} color={AMBER_TEXT} />
            <Text style={styles.blockerText}>{blocker}</Text>
          </View>
        ))}
        {can.reopen && reopenStage && (
          <TouchableOpacity
            style={[styles.linkBtn, busyAction !== null && styles.disabled]}
            onPress={() => reopen(reopenStage)}
            disabled={busyAction !== null}
            accessibilityRole="button"
          >
            <Feather name="rotate-ccw" size={14} color={colors.primary.gold} />
            <Text style={styles.linkBtnText}>Cofnij etap: {STAGE_TAB_LABEL[reopenStage]}</Text>
          </TouchableOpacity>
        )}
      </View>

      {!!refreshError && (
        <TouchableOpacity style={styles.refreshError} onPress={() => void load()} accessibilityRole="button">
          <Feather name="wifi-off" size={14} color={AMBER_TEXT} />
          <Text style={styles.refreshErrorText}>Nie udało się odświeżyć: {refreshError} Dotknij, aby spróbować ponownie.</Text>
        </TouchableOpacity>
      )}

      {c.stage !== 'empty' && (
        <>
          {/* Wydanie / Załadunek powrotny / Zwrot */}
          <View style={styles.segment} accessibilityRole="tablist">
            {EQUIPMENT_STAGE_TABS.map((tab) => {
              const active = tab.key === selected;
              const progress = stageProgress(c, tab.key);
              const confirmed = stageConfirmed(c, tab.key);
              const issues = tab.key === 'return' && c.stage === 'issues';
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.segmentItem, active && styles.segmentItemActive]}
                  onPress={() => {
                    setSelected(tab.key);
                    setExpanded(null);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]} numberOfLines={2}>
                    {tab.label}
                  </Text>
                  <View style={styles.segmentMeta}>
                    {confirmed && (
                      <Feather
                        name={issues ? 'alert-circle' : 'check-circle'}
                        size={12}
                        color={issues ? RED_TEXT : GREEN_TEXT}
                      />
                    )}
                    <Text style={styles.segmentCount}>
                      {progress.done}/{progress.total}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Stan wybranego etapu i czynności */}
          <View style={styles.stageCard}>
            {!!owner && <Text style={styles.owner}>Odpowiada: {owner}</Text>}
            {stageInfo.map((info, index) => (
              <Text key={index} style={[styles.stageInfo, info.color ? { color: info.color } : null, info.italic && styles.italic]}>
                {info.text}
              </Text>
            ))}
            {selected === 'dispatch' && (
              <View style={styles.chips}>
                <Text style={[styles.chip, styles.chipOk]}>W całości: {c.summary.packed_full}</Text>
                {c.summary.shortages_pending > 0 && (
                  <Text style={[styles.chip, styles.chipPending]}>Czeka na zgodę: {c.summary.shortages_pending}</Text>
                )}
                {c.summary.shortages_approved > 0 && (
                  <Text style={[styles.chip, styles.chipBad]}>Braki ze zgodą: {c.summary.shortages_approved}</Text>
                )}
                {c.summary.shortages_rejected > 0 && (
                  <Text style={[styles.chip, styles.chipBad]}>Bez zgody: {c.summary.shortages_rejected}</Text>
                )}
              </View>
            )}
            {selected === 'loadback' && !stageLocked && (
              <View style={styles.chips}>
                <Text style={styles.chip}>Do sprawdzenia: {c.summary.loadback_unchecked}</Text>
                {c.summary.loadback_missing > 0 && (
                  <Text style={[styles.chip, styles.chipBad]}>Braki: {c.summary.loadback_missing}</Text>
                )}
              </View>
            )}
            {selected === 'return' && !stageLocked && (
              <View style={styles.chips}>
                <Text style={styles.chip}>Do sprawdzenia: {c.summary.return_unchecked}</Text>
                {c.summary.return_damaged > 0 && <Text style={[styles.chip, styles.chipBad]}>Uszkodzone: {c.summary.return_damaged}</Text>}
                {c.summary.return_missing > 0 && <Text style={[styles.chip, styles.chipBad]}>Brak: {c.summary.return_missing}</Text>}
              </View>
            )}
            {stageActions.length > 0 && <View style={styles.actions}>{stageActions}</View>}
          </View>

          {/* Zgoda na braki (sprzedawca wydarzenia / administrator) */}
          {selected === 'dispatch' && can.approve_shortages && decisionShortages.length > 0 && (
            <View style={[styles.stageCard, styles.pendingCard]}>
              <Text style={styles.cardTitle}>Zgoda na braki</Text>
              {decisionShortages.map((line) => (
                <Text key={line.id} style={[styles.stageInfo, line.shortage_status === 'rejected' && { color: RED_TEXT }]}>
                  {line.name}: {line.packed_qty ?? 0} z {line.quantity} (brak {line.shortage_qty})
                  {line.shortage_reason ? ` — ${line.shortage_reason}` : ''}
                  {line.shortage_status === 'rejected'
                    ? ` · odmowa${line.shortage_decision_note ? `: ${line.shortage_decision_note}` : ''}`
                    : ''}
                </Text>
              ))}
              <View style={styles.actions}>
                {actionButton('decide', 'Zgoda na braki', 'check', () => decideShortages(c, true), 'success')}
                {actionButton('decide:reject', 'Odmowa', 'x', () => decideShortages(c, false), 'danger')}
              </View>
            </View>
          )}

          {/* Rozbieżności zwrotu do przyjęcia (sprzedawca wydarzenia / administrator) */}
          {selected === 'return' && can.ack_issues && (
            <View style={[styles.stageCard, styles.issuesCard]}>
              <Text style={styles.cardTitle}>Rozbieżności do przyjęcia</Text>
              {issueLines.map((line) => (
                <Text key={line.id} style={styles.stageInfo}>
                  {line.name}: {[(line.return_damaged_qty || 0) > 0 ? `${line.return_damaged_qty} uszk.` : null, (line.return_missing_qty || 0) > 0 ? `${line.return_missing_qty} brak` : null]
                    .filter(Boolean)
                    .join(', ')}
                  {line.return_note ? ` — ${line.return_note}` : ''}
                </Text>
              ))}
              <View style={styles.actions}>{actionButton('ack_issues', 'Przyjmij rozbieżności', 'check-circle', () => ackIssues(c), 'primary')}</View>
            </View>
          )}

          {/* Pozycje */}
          {!stageLocked && allLines.length > 0 && (
            <View style={styles.filterRow}>
              <TouchableOpacity
                style={[styles.filterChip, !todoOnly && styles.filterChipActive]}
                onPress={() => setTodoOnly(false)}
                accessibilityRole="button"
                accessibilityState={{ selected: !todoOnly }}
              >
                <Text style={[styles.filterText, !todoOnly && styles.filterTextActive]}>Wszystkie ({allLines.length})</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterChip, todoOnly && styles.filterChipActive]}
                onPress={() => setTodoOnly(true)}
                accessibilityRole="button"
                accessibilityState={{ selected: todoOnly }}
              >
                <Text style={[styles.filterText, todoOnly && styles.filterTextActive]}>Do sprawdzenia / braki ({todoCount})</Text>
              </TouchableOpacity>
            </View>
          )}
          {!stageLocked && allLines.length === 0 && (
            <Text style={styles.empty}>{selected === 'dispatch' ? 'Brak pozycji sprzętu.' : 'Nic nie wydano z magazynu.'}</Text>
          )}
          {!stageLocked && todoOnly && visibleLines.length === 0 && allLines.length > 0 && (
            <Text style={styles.empty}>Wszystkie pozycje sprawdzone i zgodne.</Text>
          )}
          {!stageLocked &&
            visibleLines.map((line, index) => {
              const category = line.category || 'Inne';
              const previous = index > 0 ? visibleLines[index - 1].category || 'Inne' : null;
              const key = lineKey(selected, line.id);
              return (
                <React.Fragment key={key}>
                  {category !== previous && <Text style={styles.category}>{category}</Text>}
                  <EquipmentLineRow
                    line={line}
                    stage={selected}
                    editable={editable}
                    busy={busyLines.has(line.id)}
                    expanded={expanded === key}
                    onQuick={() => quick(line, selected)}
                    onExpand={() => setExpanded(key)}
                    onCollapse={() => setExpanded((value) => (value === key ? null : value))}
                    onSave={(draft) => saveLine(line, selected, draft)}
                    onUncheck={() => uncheckLine(line, selected)}
                    onAddPhotos={() => addPhotos(line)}
                    onRemovePhoto={(path) => removePhoto(line, path)}
                    onPreview={setPreview}
                  />
                </React.Fragment>
              );
            })}
          {!stageLocked && stageActions.length > 0 && visibleLines.length > 6 && (
            <View style={[styles.actions, styles.bottomActions]}>{stageActions}</View>
          )}
        </>
      )}

      {/* Historia */}
      {c.log.length > 0 && (
        <View style={styles.history}>
          <TouchableOpacity
            style={styles.historyToggle}
            onPress={() => setHistoryOpen((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: historyOpen }}
          >
            <Text style={styles.cardTitle}>Historia ({c.log.length})</Text>
            <Feather name={historyOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary.gold} />
          </TouchableOpacity>
          {historyOpen &&
            c.log.map((entry) => {
              const details = logDetails(entry);
              return (
                <View key={entry.id} style={styles.logEntry}>
                  <Text style={styles.logTitle}>
                    {EQUIPMENT_LOG_LABELS[entry.action] || entry.action}
                    <Text style={styles.logStage}> · {STAGE_TAB_LABEL[entry.stage]}</Text>
                  </Text>
                  {!!entry.line_name && <Text style={styles.logLine}>{entry.line_name}</Text>}
                  {!!details && <Text style={styles.logText}>{details}</Text>}
                  {!!entry.note && <Text style={[styles.logText, styles.italic]}>{entry.note}</Text>}
                  <Text style={styles.logMeta}>{[entry.actor_name, formatEventStepDate(entry.created_at)].filter(Boolean).join(' · ')}</Text>
                </View>
              );
            })}
        </View>
      )}

      <EquipmentNoteModal request={noteRequest} onClose={() => setNoteRequest(null)} />

      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.previewOverlay} onPress={() => setPreview(null)}>
          {preview && <Image source={{ uri: preview }} style={styles.previewImage} resizeMode="contain" />}
          <TouchableOpacity style={styles.previewClose} onPress={() => setPreview(null)} accessibilityLabel="Zamknij podgląd">
            <Feather name="x" size={24} color={colors.white} />
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { paddingVertical: spacing.xl, alignItems: 'center', gap: 8 },
  loadingText: { color: colors.text.tertiary, fontSize: 13 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    marginBottom: spacing.md,
    backgroundColor: 'rgba(211, 187, 115, 0.08)',
  },
  noticeTitle: { color: colors.text.primary, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  noticeText: { fontSize: 13, lineHeight: 18, color: colors.text.secondary },
  retry: { alignSelf: 'flex-start', marginTop: 10 },
  header: { padding: 14, borderRadius: 12, marginBottom: 12, backgroundColor: colors.background.secondary, gap: 4 },
  headerIssues: { backgroundColor: colors.status.error + '1f' },
  headerDone: { backgroundColor: colors.status.success + '1a' },
  headerKicker: { fontSize: 11, color: colors.text.tertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  headerTitle: {
    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary.gold,
  },
  headerHint: { fontSize: 13, lineHeight: 18, color: colors.text.secondary },
  blocker: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 6,
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.status.warning + '1f',
  },
  blockerText: { flex: 1, fontSize: 13, lineHeight: 18, color: AMBER_TEXT },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 40, marginTop: 4 },
  linkBtnText: { color: colors.primary.gold, fontSize: 13, fontWeight: '600' },
  refreshError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
    backgroundColor: colors.status.warning + '1a',
  },
  refreshErrorText: { flex: 1, fontSize: 12, lineHeight: 17, color: AMBER_TEXT },
  segment: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: 12, marginBottom: 12, backgroundColor: colors.background.secondary },
  segmentItem: { flex: 1, minHeight: 56, borderRadius: 9, paddingHorizontal: 6, paddingVertical: 6, alignItems: 'center', justifyContent: 'center', gap: 2 },
  segmentItemActive: { backgroundColor: colors.primary.gold + '26' },
  segmentLabel: { fontSize: 13, fontWeight: '600', color: colors.text.secondary, textAlign: 'center' },
  segmentLabelActive: { color: colors.primary.gold },
  segmentMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  segmentCount: { fontSize: 11, color: colors.text.tertiary },
  stageCard: { padding: 12, borderRadius: 12, marginBottom: 12, backgroundColor: colors.background.secondary, gap: 6 },
  pendingCard: { backgroundColor: colors.status.warning + '1f' },
  issuesCard: { backgroundColor: colors.status.error + '1f' },
  owner: { fontSize: 12, color: colors.text.tertiary },
  stageInfo: { fontSize: 13, lineHeight: 18, color: colors.text.secondary },
  italic: { fontStyle: 'italic' },
  cardTitle: {
    fontFamily: 'MBFAtom',
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text.secondary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: colors.background.tertiary,
  },
  chipOk: { color: GREEN_TEXT, backgroundColor: colors.status.success + '1f' },
  chipPending: { color: AMBER_TEXT, backgroundColor: colors.status.warning + '1f' },
  chipBad: { color: RED_TEXT, backgroundColor: colors.status.error + '1f' },
  actions: { gap: 8, marginTop: 4 },
  bottomActions: { marginTop: 8, marginBottom: 12 },
  primaryBtn: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.primary.gold,
  },
  primaryBtnText: { color: colors.background.primary, fontSize: 15, fontWeight: '700' },
  successBtn: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#059669',
  },
  dangerBtn: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#b91c1c',
  },
  whiteBtnText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.background.tertiary,
  },
  secondaryBtnText: { color: colors.text.primary, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  filterChip: { minHeight: 40, paddingHorizontal: 12, borderRadius: 20, justifyContent: 'center', backgroundColor: colors.background.secondary },
  filterChipActive: { backgroundColor: colors.primary.gold + '26' },
  filterText: { fontSize: 13, color: colors.text.secondary },
  filterTextActive: { color: colors.primary.gold, fontWeight: '600' },
  empty: { color: colors.text.tertiary, fontSize: 13, paddingVertical: 12, textAlign: 'center' },
  category: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 6,
    marginBottom: 6,
    paddingLeft: 4,
  },
  history: { marginTop: 8, marginBottom: 16, padding: 12, borderRadius: 12, backgroundColor: colors.background.secondary },
  historyToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  logEntry: { paddingVertical: 8, gap: 2 },
  logTitle: { fontSize: 13, fontWeight: '600', color: colors.text.primary },
  logStage: { fontSize: 12, fontWeight: '400', color: colors.text.tertiary },
  logLine: { fontSize: 12, color: colors.primary.gold },
  logText: { fontSize: 12, lineHeight: 17, color: colors.text.secondary },
  logMeta: { fontSize: 11, color: colors.text.tertiary },
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  previewImage: { width: Dimensions.get('window').width - 32, height: Dimensions.get('window').height * 0.75 },
  previewClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
});
