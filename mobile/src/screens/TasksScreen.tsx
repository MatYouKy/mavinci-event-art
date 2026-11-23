import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Keyboard, PanResponder, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View, type GestureResponderEvent, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, glow, ink, withAlpha } from '../theme';
import { useForegroundEffect } from '../hooks/useForegroundEffect';
import { createRefreshQueue } from '../lib/refreshQueue';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { canView } from '../lib/permissions';
import { useContentWidth, useTabletLayout } from '../hooks/useTabletLayout';
import { openInCrmWeb } from '../navigation/navigationRef';
import BrandHeading from '../components/BrandHeading';
import { TaskBoardCard } from '../components/Tasks/TaskBoardCard';
import { TaskEditorSheet, type TaskEditTarget } from '../components/Tasks/TaskEditorSheet';
import { BoardGrip } from '../components/InquiryBoard';
import { ActionMenu, type MenuItem } from '../components/Inquiries/WorkspaceSheets';
import { DayField, NoticeScope, Segmented, Sheet, SheetActions, TimeField, kit, useNotice } from '../components/Inquiries/InquiryKit';
import type { TasksStackParamList } from '../navigation/TasksStackNavigator';
import {
  TASK_COLUMNS, TASK_PRIORITIES, boardDropIndex, boardTaskTimer, cachedTaskBoard, deleteBoardTask, loadTaskBoard, moveBoardTask, newTaskId,
  saveBoardTask, saveBoardTaskFields, sortBoardTasks, taskColumnLabel, taskDueBadge, taskDueClock, taskDueDay, taskPriority,
  type ActiveTaskTimer, type BoardTask, type TaskBoardData, type TaskBoardKind, type TaskColumnId, type TaskPriorityId,
} from '../lib/tasksBoard';
import { taskDueIso } from '../lib/taskDue';

/*
 * Tablica zadań jak w Trello (te same dane, uprawnienia i zapisy co CRM i aplikacja na Maca — `lib/tasksBoard.ts`):
 *  - kolumny obok siebie: telefon — kolumna na prawie całą szerokość z widocznym brzegiem następnej i przyciąganiem do kolumny,
 *    tablet — kilka kolumn naraz,
 *  - uchwyt ≡ na karcie (jak w lejku zapytań — dotyk od razu podnosi kartę) albo przytrzymanie karty: karta pod palcem,
 *    przeciąganie w dowolną stronę, przy krawędzi ekranu tablica sama się przewija, w docelowej kolumnie widać miejsce,
 *    w którym karta stanie (kolejność jak w CRM: priorytet, termin, kolejność na tablicy),
 *  - „+ Dodaj kartę” na dole każdej kolumny — szybkie dodawanie kolejnych kart bez otwierania formularza,
 *  - „⋯” na karcie — szybkie czynności (przenieś, licznik czasu, priorytet, termin, edycja, usunięcie), dotknięcie — szczegóły,
 *  - pełny formularz („+” u góry albo w nagłówku kolumny) z załącznikami: zdjęcia, zrzuty ekranu, aparat, pliki, obraz ze schowka.
 * Przeniesienie do „W trakcie” uruchamia licznik czasu (jak w CRM), wyjście z „W trakcie” pyta o zatrzymanie licznika.
 */

type Navigation = NativeStackNavigationProp<TasksStackParamList, 'TasksList'>;
type Rect = { x: number; y: number; width: number; height: number };
type Drag = { task: BoardTask; from: TaskColumnId; target: TaskColumnId; width: number; height: number; grabX: number; grabY: number };

const GAP = 12;
const SIDE = 16;
const PAGE = 60;
const EDGE = 64;
const MAX_SPEED = 18;

const measure = (node: View | null | undefined) =>
  new Promise<Rect | null>((resolve) => {
    if (!node) { resolve(null); return; }
    node.measure((_x, _y, width, height, pageX, pageY) => {
      resolve([width, height, pageX, pageY].every((value) => Number.isFinite(value)) ? { x: pageX, y: pageY, width, height } : null);
    });
  });

const clock = (iso: string) => {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? '' : new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(time);
};

type CardActions = {
  register: (id: string, node: View | null) => void;
  open: (task: BoardTask) => void;
  lift: (task: BoardTask, event: GestureResponderEvent) => void;
  pressOut: () => void;
  menu: (task: BoardTask) => void;
  /** Uchwyt ≡: początek, ruch i koniec przeciągania (gest prowadzi uchwyt, nie tablica). */
  gripStart: (task: BoardTask, pageX: number, pageY: number) => void;
  gripMove: (task: BoardTask, pageX: number, pageY: number) => void;
  gripEnd: (task: BoardTask, cancelled: boolean) => void;
};

/** Karta w kolumnie (pamiętana — przy przeciąganiu odświeżają się tylko karty, których stan się zmienił). */
const CardRow = memo(function CardRow({ task, me, timerActive, busy, movable, slot, actions }: {
  task: BoardTask; me: string | null; timerActive: boolean; busy: boolean;
  /** Pracownik może przenosić karty na tej tablicy — karta ma uchwyt ≡. */
  movable: boolean;
  /** `hidden` — karta podniesiona, jej miejsce w tej kolumnie; `collapsed` — karta podniesiona nad inną kolumną. */
  slot: 'normal' | 'hidden' | 'collapsed';
  actions: CardActions;
}) {
  return (
    <View style={slot === 'collapsed' ? styles.collapsed : slot === 'hidden' ? styles.slot : styles.cardWrap}>
      <View style={slot === 'normal' ? null : styles.invisible}>
        <TaskBoardCard
          ref={(node) => actions.register(task.id, node)}
          task={task}
          me={me}
          timerActive={timerActive}
          busy={busy}
          onPress={() => actions.open(task)}
          onLongPress={(event) => actions.lift(task, event)}
          onPressOut={actions.pressOut}
          onMenu={() => actions.menu(task)}
          grip={movable && !busy && !task.id.startsWith('tmp-') ? (
            <BoardGrip
              label={`Przenieś: ${task.titleLabel}`}
              hint="Przeciągnij kartę do innej kolumny"
              onGrant={(x, y) => actions.gripStart(task, x, y)}
              onMove={(x, y) => actions.gripMove(task, x, y)}
              onRelease={(cancelled) => actions.gripEnd(task, cancelled)}
            />
          ) : null}
        />
      </View>
    </View>
  );
});

export default function TasksScreen() {
  const navigation = useNavigation<Navigation>();
  const { employee } = useAuth();
  const contentWidth = useContentWidth();
  const { tablet } = useTabletLayout();
  const notice = useNotice();
  const { run, notify } = notice;
  const companyAllowed = canView(employee, 'tasks');
  const me = employee?.id ?? null;

  const [board, setBoard] = useState<TaskBoardKind>('mine');
  const [data, setData] = useState<TaskBoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [limits, setLimits] = useState<Partial<Record<TaskColumnId, number>>>({});
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [editor, setEditor] = useState<TaskEditTarget | null>(null);
  const [menuTask, setMenuTask] = useState<BoardTask | null>(null);
  const [priorityTask, setPriorityTask] = useState<BoardTask | null>(null);
  const [dueTarget, setDueTarget] = useState<{ task: BoardTask; day: string; time: string } | null>(null);
  const [deleting, setDeleting] = useState<BoardTask | null>(null);
  const [stopping, setStopping] = useState<{ task: BoardTask; column: TaskColumnId } | null>(null);
  const [switching, setSwitching] = useState<BoardTask | null>(null);
  const [composer, setComposer] = useState<{ column: TaskColumnId; text: string } | null>(null);
  const [armed, setArmed] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [boardHeight, setBoardHeight] = useState(0);
  const [page, setPage] = useState(0);
  const [keyboardPad, setKeyboardPad] = useState(0);

  const access = data?.access ?? null;
  const timer: ActiveTaskTimer | null = data?.timer ?? null;
  const canCreate = access?.canCreate ?? board === 'mine';
  const canManage = access?.canManage ?? board === 'mine';
  const canMove = access?.canMove ?? board === 'mine';

  // MARK: Wczytywanie

  const boardRef = useRef(board);
  boardRef.current = board;
  const dragRef = useRef<Drag | null>(null);
  const pendingData = useRef<TaskBoardData | null>(null);
  const queueRef = useRef<ReturnType<typeof createRefreshQueue> | null>(null);
  const forceNext = useRef(false);

  const apply = useCallback((next: TaskBoardData) => {
    // W trakcie przeciągania tablica się nie przebudowuje — nowe dane po upuszczeniu karty.
    if (dragRef.current) pendingData.current = next;
    else setData(next);
  }, []);

  const load = useCallback(async () => {
    const target = boardRef.current;
    const force = forceNext.current;
    forceNext.current = false;
    try {
      const next = await loadTaskBoard(target, force);
      if (boardRef.current !== target) return;
      apply(next);
      setLoadError(null);
    } catch (error) {
      if (boardRef.current !== target) return;
      setLoadError(error instanceof Error ? error.message : 'Nie udało się wczytać zadań.');
    } finally {
      if (boardRef.current === target) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [apply]);

  const reload = useCallback((force = false) => {
    if (force) forceNext.current = true;
    if (queueRef.current) void queueRef.current.refresh();
    else void load();
  }, [load]);

  useForegroundEffect((signal) => {
    if (!me) return;
    const queue = createRefreshQueue(signal, () => load());
    queueRef.current = queue;
    void queue.refresh();
    const channel = supabase.channel(`tasks_board_${me}`);
    (['tasks', 'task_assignees', 'task_comments', 'task_attachments'] as const).forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => queue.schedule());
    });
    channel.subscribe();
    return () => {
      if (queueRef.current === queue) queueRef.current = null;
      return supabase.removeChannel(channel);
    };
  }, [me, load]);

  // Powrót ze szczegółów zadania — świeże liczniki komentarzy i załączników.
  useFocusEffect(useCallback(() => { queueRef.current?.schedule(); }, []));

  // Zmiana tablicy: od razu ostatnio pobrana wersja, potem świeża.
  const firstBoard = useRef(true);
  useEffect(() => {
    if (firstBoard.current) { firstBoard.current = false; return; }
    let alive = true;
    setComposer(null);
    setLimits({});
    void cachedTaskBoard(board).then((cached) => {
      if (!alive) return;
      setData(cached);
      setLoading(!cached);
      setLoadError(null);
      reload();
    });
    return () => { alive = false; };
  }, [board, reload]);

  // MARK: Kolumny

  const query = search.trim().toLocaleLowerCase('pl-PL');
  const columns = useMemo(() => {
    const tasks = (data?.tasks ?? []).filter((task) => !query
      || task.titleLabel.toLocaleLowerCase('pl-PL').includes(query) || task.title.toLocaleLowerCase('pl-PL').includes(query));
    return TASK_COLUMNS.map((column) => ({ ...column, tasks: sortBoardTasks(tasks.filter((task) => task.boardColumn === column.id)) }));
  }, [data, query]);

  const columnWidth = tablet
    ? Math.max(280, Math.min(360, (contentWidth - SIDE * 2 - GAP * 3) / 4))
    : Math.max(240, Math.min(contentWidth - 56, 440));
  const snapInterval = columnWidth + GAP;

  // MARK: Przeciąganie kart

  const rootRef = useRef<View>(null);
  const viewportRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const cardRefs = useRef(new Map<string, View>());
  const columnRefs = useRef(new Map<TaskColumnId, View>());
  const armedRef = useRef(false);
  const grantedRef = useRef(false);
  /** Karta przeciągana za uchwyt ≡ — wtedy gest prowadzi uchwyt, a tablica go nie przejmuje. */
  const gripTask = useRef<string | null>(null);
  const finger = useRef({ x: 0, y: 0 });
  const rootRect = useRef<Rect | null>(null);
  const viewportRect = useRef<Rect | null>(null);
  const columnRects = useRef(new Map<TaskColumnId, Rect>());
  const scrollX = useRef(0);
  const scrollAtStart = useRef(0);
  const contentWidthRef = useRef(0);
  const viewportWidth = useRef(0);
  const speed = useRef(0);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const ghost = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const stopAutoScroll = () => {
    speed.current = 0;
    if (autoTimer.current) { clearInterval(autoTimer.current); autoTimer.current = null; }
  };

  const positionGhost = () => {
    const current = dragRef.current;
    const root = rootRect.current;
    if (!current || !root) return;
    ghost.setValue({ x: finger.current.x - current.grabX - root.x, y: finger.current.y - current.grabY - root.y });
  };

  const updateTarget = () => {
    const current = dragRef.current;
    if (!current) return;
    const shift = scrollX.current - scrollAtStart.current;
    let next = current.target;
    for (const column of TASK_COLUMNS) {
      const rect = columnRects.current.get(column.id);
      if (!rect) continue;
      const left = rect.x - shift;
      if (finger.current.x >= left - GAP / 2 && finger.current.x <= left + rect.width + GAP / 2) { next = column.id; break; }
    }
    if (next !== current.target) {
      const value = { ...current, target: next };
      dragRef.current = value;
      setDrag(value);
    }
  };

  const tick = () => {
    const step = speed.current;
    if (!step || !dragRef.current) { stopAutoScroll(); return; }
    const max = Math.max(0, contentWidthRef.current - viewportWidth.current);
    const next = Math.max(0, Math.min(max, scrollX.current + step));
    if (next === scrollX.current) return;
    scrollX.current = next;
    scrollRef.current?.scrollTo({ x: next, animated: false });
    updateTarget();
  };

  const updateAutoScroll = () => {
    const rect = viewportRect.current;
    if (!rect) return;
    const x = finger.current.x;
    let next = 0;
    if (x < rect.x + EDGE) next = -MAX_SPEED * Math.min(1, (rect.x + EDGE - x) / EDGE);
    else if (x > rect.x + rect.width - EDGE) next = MAX_SPEED * Math.min(1, (x - (rect.x + rect.width - EDGE)) / EDGE);
    speed.current = next;
    if (next && !autoTimer.current) autoTimer.current = setInterval(tick, 16);
    if (!next) stopAutoScroll();
  };

  const moveFinger = (x: number, y: number) => {
    finger.current = { x, y };
    if (!dragRef.current) return;
    positionGhost();
    updateTarget();
    updateAutoScroll();
  };

  const finishDrag = (commit: boolean) => {
    stopAutoScroll();
    const current = dragRef.current;
    armedRef.current = false;
    grantedRef.current = false;
    gripTask.current = null;
    dragRef.current = null;
    setDrag(null);
    setArmed(false);
    if (pendingData.current) {
      setData(pendingData.current);
      pendingData.current = null;
    }
    if (commit && current && current.target !== current.from) void dropTaskRef.current(current.task, current.target);
  };

  /** Podniesienie karty pod palcem (przytrzymanie albo uchwyt ≡). Zwraca `false`, gdy karty nie można teraz przenieść. */
  const liftAt = (task: BoardTask, pageX: number, pageY: number) => {
    if (!canMove || armedRef.current || busyIds.includes(task.id) || task.id.startsWith('tmp-')) return false;
    armedRef.current = true;
    grantedRef.current = false;
    setArmed(true);
    setComposer(null);
    const start = { x: pageX, y: pageY };
    finger.current = start;
    void (async () => {
      const [card, root, viewport, ...rects] = await Promise.all([
        measure(cardRefs.current.get(task.id)), measure(rootRef.current), measure(viewportRef.current),
        ...TASK_COLUMNS.map((column) => measure(columnRefs.current.get(column.id))),
      ]);
      if (!armedRef.current) return;
      if (!card || !root || !viewport) { finishDrag(false); return; }
      rootRect.current = root;
      viewportRect.current = viewport;
      columnRects.current = new Map();
      TASK_COLUMNS.forEach((column, index) => { const rect = rects[index]; if (rect) columnRects.current.set(column.id, rect); });
      scrollAtStart.current = scrollX.current;
      const value: Drag = {
        task, from: task.boardColumn, target: task.boardColumn, width: card.width, height: card.height,
        grabX: Math.max(0, Math.min(card.width, start.x - card.x)), grabY: Math.max(0, Math.min(card.height, start.y - card.y)),
      };
      dragRef.current = value;
      setDrag(value);
      positionGhost();
    })();
    return true;
  };

  const lift = (task: BoardTask, event: GestureResponderEvent) => { liftAt(task, event.nativeEvent.pageX, event.nativeEvent.pageY); };

  const gripStart = (task: BoardTask, pageX: number, pageY: number) => {
    if (!liftAt(task, pageX, pageY)) return;
    gripTask.current = task.id;
    grantedRef.current = true;
  };
  const gripMove = (task: BoardTask, pageX: number, pageY: number) => {
    if (gripTask.current === task.id) moveFinger(pageX, pageY);
  };
  const gripEnd = (task: BoardTask, cancelled: boolean) => {
    if (gripTask.current === task.id) finishDrag(!cancelled);
  };

  const pressOut = () => {
    // Puszczenie bez ruchu po przytrzymaniu — karta wraca na miejsce (przy ruchu tablica przejęła gest i zakończy go sama).
    setTimeout(() => { if (armedRef.current && !grantedRef.current) finishDrag(false); }, 90);
  };

  const finishRef = useRef(finishDrag);
  finishRef.current = finishDrag;
  const moveRef = useRef(moveFinger);
  moveRef.current = moveFinger;

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponderCapture: () => armedRef.current && !gripTask.current,
    onMoveShouldSetPanResponder: () => armedRef.current && !gripTask.current,
    onPanResponderGrant: (event) => { grantedRef.current = true; moveRef.current(event.nativeEvent.pageX, event.nativeEvent.pageY); },
    onPanResponderMove: (event) => moveRef.current(event.nativeEvent.pageX, event.nativeEvent.pageY),
    onPanResponderRelease: () => finishRef.current(true),
    onPanResponderTerminate: () => finishRef.current(false),
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), []);

  useEffect(() => () => stopAutoScroll(), []);

  // iOS: klawiatura nie zasłania pola „Dodaj kartę” na dole kolumny — dolny margines równy części ekranu pod klawiaturą
  // (liczone od rzeczywistego położenia ekranu, więc nagłówek nawigacji nie przesuwa wyniku). Android zmienia rozmiar okna sam.
  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const change = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      const top = event.endCoordinates.screenY;
      rootRef.current?.measure((_x, _y, _width, height, _pageX, pageY) => {
        if (Number.isFinite(pageY) && Number.isFinite(height)) setKeyboardPad(Math.max(0, Math.round(pageY + height - top)));
      });
    });
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardPad(0));
    return () => { change.remove(); hide.remove(); };
  }, []);

  // MARK: Zapisy

  const markBusy = (id: string, busy: boolean) =>
    setBusyIds((current) => (busy ? (current.includes(id) ? current : [...current, id]) : current.filter((value) => value !== id)));

  const patchTask = (id: string, change: (task: BoardTask) => BoardTask) =>
    setData((current) => (current ? { ...current, tasks: current.tasks.map((task) => (task.id === id ? change(task) : task)) } : current));

  const setTimer = (next: ActiveTaskTimer | null) => setData((current) => (current ? { ...current, timer: next } : current));

  const scrollToColumn = (column: TaskColumnId) => {
    if (tablet) return;
    const index = TASK_COLUMNS.findIndex((item) => item.id === column);
    if (index < 0) return;
    const x = index * snapInterval;
    scrollX.current = x;
    setPage(index);
    setTimeout(() => scrollRef.current?.scrollTo({ x, animated: true }), 40);
  };

  /** Przeniesienie z natychmiastową zmianą na tablicy; błąd przywraca kartę. */
  const commitMove = async (task: BoardTask, column: TaskColumnId, options: { working?: boolean; startTimer?: boolean; stopTimer?: boolean } = {}) => {
    const before = task;
    const myName = employee ? `${employee.name ?? ''} ${employee.surname ?? ''}`.trim() : '';
    patchTask(task.id, (item) => {
      if (column !== 'in_progress') return { ...item, boardColumn: column, workingBy: null, workingName: '' };
      if (options.working) return { ...item, boardColumn: column, workingBy: me, workingName: myName || item.workingName };
      return { ...item, boardColumn: column };
    });
    scrollToColumn(column);
    markBusy(task.id, true);
    try {
      if (options.stopTimer) setTimer(await boardTaskTimer(board, 'stop'));
      const next = await moveBoardTask(board, task.id, column, { working: options.working, startTimer: options.startTimer });
      setTimer(next);
      notify(options.startTimer ? `Zadanie rozpoczęte — ${taskColumnLabel(column, board)}` : `Przeniesiono do: ${taskColumnLabel(column, board)}`);
      reload(true);
    } catch (error) {
      patchTask(task.id, () => before);
      notify(error instanceof Error ? error.message : 'Błąd podczas przenoszenia zadania', true);
    } finally {
      markBusy(task.id, false);
    }
  };

  /** Jak `handleDrop` w CRM i na Macu: „W trakcie” uruchamia licznik (gdy nie działa inny), wyjście z „W trakcie” pyta o zatrzymanie. */
  const dropTask = async (task: BoardTask, column: TaskColumnId) => {
    if (!canMove || task.boardColumn === column) return;
    const old = task.boardColumn;
    const auto = access?.autoTimer ?? true;
    if (auto && column === 'in_progress' && old !== 'in_progress') {
      if (timer && timer.taskId !== task.id) {
        notify('Zakończ poprzednie zadanie aby rozpocząć kolejne lub przenieś je do zrobienia', true);
        return;
      }
      if (!timer) { await commitMove(task, column, { working: true, startTimer: true }); return; }
    }
    if (auto && (column === 'review' || column === 'completed') && old === 'in_progress' && timer?.taskId === task.id) {
      setStopping({ task, column });
      return;
    }
    await commitMove(task, column);
  };
  const dropTaskRef = useRef(dropTask);
  dropTaskRef.current = dropTask;

  /** Szybkie dodanie karty na dole kolumny (pole zostaje otwarte na kolejną kartę — jak w Trello). */
  const quickAdd = async () => {
    if (!composer) return;
    const title = composer.text.trim();
    const column = composer.column;
    if (!title) { setComposer(null); return; }
    setComposer({ column, text: '' });
    const company = board === 'company';
    const id = company ? null : newTaskId();
    const tempId = id || `tmp-${newTaskId()}`;
    const draft: BoardTask = {
      id: tempId, title, titleLabel: title, description: '', priority: 'medium', boardColumn: column, orderIndex: 0, dueDate: null,
      createdBy: me, createdAt: new Date().toISOString(), isPrivate: !company, ownerId: me, eventId: null, inquiryId: null, workingBy: null,
      workingName: '', assignees: [], comments: 0, attachments: 0,
    };
    setData((current) => (current ? { ...current, tasks: [...current.tasks, draft] } : current));
    markBusy(tempId, true);
    try {
      await saveBoardTask(board, {
        id, existing: false, title, description: '', priority: 'medium', boardColumn: column, dueDate: null, dueTime: null,
        assignees: company ? (me ? [me] : []) : null,
      });
      notify(`Dodano kartę: ${title}`);
      reload(true);
    } catch (error) {
      setData((current) => (current ? { ...current, tasks: current.tasks.filter((task) => task.id !== tempId) } : current));
      setComposer((current) => (current && current.column === column && !current.text ? { column, text: title } : current));
      notify(error instanceof Error ? error.message : 'Nie udało się dodać karty.', true);
    } finally {
      markBusy(tempId, false);
    }
  };

  const startTimer = async (task: BoardTask, action: 'start' | 'switch') => {
    const next = await run(action === 'switch' ? 'Przełączam licznik czasu…' : 'Uruchamiam licznik czasu…', () => boardTaskTimer(board, action, task.id),
      'Licznik czasu uruchomiony.');
    if (next !== null) { setTimer(next); reload(true); }
  };

  const stopTimer = async () => {
    const reply = await run('Zatrzymuję licznik czasu…', async () => { await boardTaskTimer(board, 'stop'); return true; }, 'Licznik czasu zatrzymany.');
    if (reply) { setTimer(null); reload(true); }
  };

  const savePriority = async (task: BoardTask, priority: TaskPriorityId) => {
    if (task.priority === priority) return;
    const done = await run('Zapisuję priorytet…', () => saveBoardTaskFields(board, task, { priority }), `Priorytet: ${taskPriority(priority).label}.`);
    if (done) { patchTask(task.id, (item) => ({ ...item, priority })); reload(true); }
  };

  /** Termin z karty: dzień i opcjonalna godzina (bez godziny — cały dzień). */
  const saveDue = async (task: BoardTask, day: string | null, time: string | null) => {
    const done = await run('Zapisuję termin…', () => saveBoardTaskFields(board, task, { dueDate: day, dueTime: day ? time : null }), day ? 'Termin zapisany.' : 'Usunięto termin.');
    if (done) { setDueTarget(null); patchTask(task.id, (item) => ({ ...item, dueDate: day ? taskDueIso(day, time) : null })); reload(true); }
  };

  const removeTask = async (task: BoardTask) => {
    const done = await run('Usuwam zadanie…', async () => { await deleteBoardTask(board, task.id); return true; }, 'Zadanie zostało usunięte.');
    if (done) {
      setDeleting(null);
      setData((current) => (current ? { ...current, tasks: current.tasks.filter((item) => item.id !== task.id) } : current));
      reload(true);
    }
  };

  const openTask = (task: BoardTask) => {
    if (armedRef.current || task.id.startsWith('tmp-')) return;
    navigation.navigate('TaskDetail', { taskId: task.id });
  };

  // Stałe funkcje kart (karty są pamiętane), zawsze z bieżącym stanem ekranu.
  const handlers = useRef({ open: openTask, lift, pressOut, menu: (task: BoardTask) => setMenuTask(task), gripStart, gripMove, gripEnd });
  handlers.current = {
    open: openTask, lift, pressOut, menu: (task: BoardTask) => { if (!armedRef.current) setMenuTask(task); }, gripStart, gripMove, gripEnd,
  };
  const actions = useMemo<CardActions>(() => ({
    register: (id, node) => { if (node) cardRefs.current.set(id, node); else cardRefs.current.delete(id); },
    open: (task) => handlers.current.open(task),
    lift: (task, event) => handlers.current.lift(task, event),
    pressOut: () => handlers.current.pressOut(),
    menu: (task) => handlers.current.menu(task),
    gripStart: (task, x, y) => handlers.current.gripStart(task, x, y),
    gripMove: (task, x, y) => handlers.current.gripMove(task, x, y),
    gripEnd: (task, cancelled) => handlers.current.gripEnd(task, cancelled),
  }), []);

  const menuItems = (task: BoardTask): MenuItem[] => {
    const items: MenuItem[] = [{ key: 'open', label: 'Szczegóły zadania', icon: 'info', detail: 'Opis, osoby, pliki i komentarze' }];
    if (canMove) {
      TASK_COLUMNS.filter((column) => column.id !== task.boardColumn).forEach((column) => {
        items.push({ key: `move:${column.id}`, label: `Przenieś do: ${taskColumnLabel(column.id, board)}`, icon: 'arrow-right' });
      });
      items.push(timer?.taskId === task.id
        ? { key: 'stop', label: 'Zatrzymaj licznik czasu', icon: 'pause-circle' }
        : { key: 'start', label: 'Rozpocznij licznik czasu', icon: 'play-circle', detail: timer ? `Teraz działa: ${timer.title}` : undefined });
    }
    if (canManage) {
      const due = taskDueBadge(task.dueDate, false);
      items.push({ key: 'priority', label: 'Priorytet', icon: 'flag', detail: taskPriority(task.priority).label });
      items.push({ key: 'due', label: 'Termin wykonania', icon: 'calendar', detail: due ? due.label : 'Bez terminu' });
      items.push({ key: 'edit', label: 'Edytuj zadanie', icon: 'edit-2', detail: 'Tytuł, opis, załączniki, osoby' });
    }
    items.push({ key: 'crm', label: 'Otwórz w CRM', icon: 'external-link' });
    if (canManage) items.push({ key: 'delete', label: 'Usuń zadanie', icon: 'trash-2', danger: true });
    return items;
  };

  const pickMenu = (task: BoardTask, key: string) => {
    if (key === 'open') openTask(task);
    else if (key.startsWith('move:')) void dropTask(task, key.slice(5) as TaskColumnId);
    else if (key === 'start') { if (timer) setSwitching(task); else void startTimer(task, 'start'); }
    else if (key === 'stop') void stopTimer();
    else if (key === 'priority') setPriorityTask(task);
    else if (key === 'due') setDueTarget({ task, day: taskDueDay(task.dueDate) ?? '', time: taskDueClock(task.dueDate) ?? '' });
    else if (key === 'edit') setEditor({ key: Date.now(), task, column: task.boardColumn });
    else if (key === 'crm') openInCrmWeb(`/crm/tasks/${task.id}`);
    else if (key === 'delete') setDeleting(task);
  };

  // MARK: Widok

  const renderColumn = (column: (typeof columns)[number]) => {
    const limit = limits[column.id] ?? PAGE;
    const shown = column.tasks.slice(0, limit);
    const target = drag?.target === column.id;
    let placeholder = -1;
    if (drag && target && drag.from !== column.id) placeholder = Math.min(boardDropIndex(column.tasks, drag.task), shown.length);
    const count = column.tasks.filter((task) => (drag ? task.id !== drag.task.id || drag.target === column.id : true)).length + (placeholder >= 0 ? 1 : 0);
    const holder = <View key="placeholder" style={[styles.placeholder, { height: drag?.height ?? 80 }]} />;
    const adding = composer?.column === column.id;
    return (
      <View
        key={column.id}
        ref={(node) => { if (node) columnRefs.current.set(column.id, node); else columnRefs.current.delete(column.id); }}
        collapsable={false}
        style={[styles.column, { width: columnWidth, maxHeight: Math.max(200, boardHeight - spacing.md) }, target && drag ? styles.columnTarget : null]}
      >
        <View style={styles.columnHeader}>
          <View style={[styles.columnDot, { backgroundColor: column.color }]} />
          <BrandHeading style={styles.columnTitle} numberOfLines={1}>{taskColumnLabel(column.id, board)}</BrandHeading>
          <Text style={styles.columnCount}>{count}</Text>
          {canCreate ? (
            <TouchableOpacity onPress={() => setEditor({ key: Date.now(), task: null, column: column.id })} hitSlop={8} style={styles.columnAdd}
              accessibilityRole="button" accessibilityLabel={`Nowe zadanie w kolumnie ${taskColumnLabel(column.id, board)}`}>
              <Feather name="plus" size={18} color={colors.primary.gold} />
            </TouchableOpacity>
          ) : null}
        </View>
        <ScrollView
          style={styles.columnScroll}
          contentContainerStyle={styles.columnContent}
          scrollEnabled={!armed}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          alwaysBounceVertical
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); reload(true); }} tintColor={colors.primary.gold} colors={[colors.primary.gold]} />}
        >
          {shown.map((task, index) => {
            const lifted = drag?.task.id === task.id;
            const slot = !lifted ? 'normal' : drag?.target === column.id ? 'hidden' : 'collapsed';
            return (
              <React.Fragment key={task.id}>
                {index === placeholder ? holder : null}
                <CardRow task={task} me={me} timerActive={timer?.taskId === task.id} busy={busyIds.includes(task.id)} movable={canMove} slot={slot} actions={actions} />
              </React.Fragment>
            );
          })}
          {placeholder === shown.length ? holder : null}
          {!column.tasks.length && placeholder < 0 ? (
            <Text style={styles.empty}>{query ? 'Brak zadań pasujących do wyszukiwania' : 'Brak zadań'}</Text>
          ) : null}
          {column.tasks.length > shown.length ? (
            <TouchableOpacity onPress={() => setLimits((current) => ({ ...current, [column.id]: limit + PAGE }))} style={styles.more} accessibilityRole="button">
              <Text style={styles.moreText}>Pokaż kolejne ({column.tasks.length - shown.length})</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
        {canCreate ? (
          adding ? (
            <View style={styles.composer}>
              <TextInput
                value={composer?.text ?? ''}
                onChangeText={(text) => setComposer({ column: column.id, text })}
                placeholder="Tytuł karty…"
                placeholderTextColor={ink(0.35)}
                style={styles.composerInput}
                autoFocus
                submitBehavior="submit"
                returnKeyType="done"
                onSubmitEditing={() => void quickAdd()}
                accessibilityLabel={`Tytuł nowej karty w kolumnie ${taskColumnLabel(column.id, board)}`}
              />
              <View style={styles.composerActions}>
                <TouchableOpacity onPress={() => void quickAdd()} style={[kit.primary, styles.composerButton]} accessibilityRole="button">
                  <Text style={kit.primaryText}>Dodaj kartę</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setComposer(null)} style={kit.iconButton} accessibilityRole="button" accessibilityLabel="Zamknij dodawanie karty">
                  <Feather name="x" size={20} color={colors.text.secondary} />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setComposer({ column: column.id, text: '' })} disabled={armed} style={styles.addCard} accessibilityRole="button">
              <Feather name="plus" size={16} color={colors.text.secondary} />
              <Text style={styles.addCardText}>Dodaj kartę</Text>
            </TouchableOpacity>
          )
        ) : null}
      </View>
    );
  };

  const boardOptions = [{ id: 'mine' as const, label: 'Moja tablica' }, { id: 'company' as const, label: 'Zadania firmowe' }];

  return (
    <NoticeScope value={notice.scope}>
      <View ref={rootRef} collapsable={false} style={[styles.container, keyboardPad ? { paddingBottom: keyboardPad } : null]}>
        <View style={[styles.header, tablet && styles.headerWide]}>
          {companyAllowed ? <Segmented value={board} options={boardOptions} onChange={(value) => { if (!armed) setBoard(value); }} /> : null}
          <View style={[styles.searchRow, tablet && styles.flex]}>
            <View style={styles.search}>
              <Feather name="search" size={18} color={colors.text.tertiary} />
              <TextInput value={search} onChangeText={setSearch} placeholder="Szukaj zadania po tytule…" placeholderTextColor={ink(0.35)}
                style={styles.searchInput} autoCorrect={false} returnKeyType="search" />
              {search ? (
                <TouchableOpacity onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Wyczyść wyszukiwanie">
                  <Feather name="x" size={18} color={colors.text.tertiary} />
                </TouchableOpacity>
              ) : null}
            </View>
            {canCreate ? (
              <TouchableOpacity onPress={() => setEditor({ key: Date.now(), task: null, column: 'todo' })} style={styles.addButton}
                accessibilityRole="button" accessibilityLabel="Nowe zadanie">
                <Feather name="plus" size={22} color={colors.background.primary} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {loadError && data ? (
          <TouchableOpacity onPress={() => reload(true)} style={styles.banner} accessibilityRole="button">
            <Feather name="wifi-off" size={14} color={colors.status.error} />
            <Text style={styles.bannerText} numberOfLines={2}>{`${loadError} Dotknij, aby spróbować ponownie.`}</Text>
          </TouchableOpacity>
        ) : null}

        {timer ? (
          <View style={styles.timerBar}>
            <View style={styles.timerDot} />
            <Text style={styles.timerText} numberOfLines={1}>Licznik czasu: {timer.title}{clock(timer.startTime) ? ` · od ${clock(timer.startTime)}` : ''}</Text>
            <TouchableOpacity onPress={() => void stopTimer()} style={styles.timerStop} accessibilityRole="button" accessibilityLabel="Zatrzymaj licznik czasu">
              <Feather name="square" size={13} color={colors.status.error} />
              <Text style={styles.timerStopText}>Zatrzymaj</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View
          ref={viewportRef}
          collapsable={false}
          style={styles.flex}
          onLayout={(event: LayoutChangeEvent) => { setBoardHeight(event.nativeEvent.layout.height); viewportWidth.current = event.nativeEvent.layout.width; }}
          {...responder.panHandlers}
        >
          {loading && !data ? (
            <View style={styles.center}><ActivityIndicator size="large" color={colors.primary.gold} /></View>
          ) : loadError && !data ? (
            <View style={styles.center}>
              <Feather name="alert-circle" size={28} color={colors.status.error} />
              <Text style={[kit.text, styles.centerText]}>{loadError}</Text>
              <TouchableOpacity onPress={() => { setLoading(true); reload(true); }} style={kit.secondary}><Text style={kit.secondaryText}>Spróbuj ponownie</Text></TouchableOpacity>
            </View>
          ) : (
            <ScrollView
              ref={scrollRef}
              horizontal
              scrollEnabled={!armed}
              showsHorizontalScrollIndicator={tablet}
              snapToInterval={tablet ? undefined : snapInterval}
              snapToAlignment="start"
              decelerationRate={tablet ? 'normal' : 'fast'}
              disableIntervalMomentum={!tablet}
              contentContainerStyle={styles.boardContent}
              scrollEventThrottle={16}
              onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => { scrollX.current = event.nativeEvent.contentOffset.x; }}
              onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
                if (!tablet) setPage(Math.max(0, Math.min(TASK_COLUMNS.length - 1, Math.round(event.nativeEvent.contentOffset.x / snapInterval))));
              }}
              onContentSizeChange={(width) => { contentWidthRef.current = width; }}
              keyboardShouldPersistTaps="handled"
            >
              {columns.map(renderColumn)}
            </ScrollView>
          )}
        </View>

        {!tablet && data ? (
          <View style={styles.dots}>
            {TASK_COLUMNS.map((column, index) => {
              const current = drag ? drag.target === column.id : page === index;
              return <View key={column.id} style={[styles.dot, { backgroundColor: current ? colors.primary.gold : withAlpha(column.color, 0.45) }, current && styles.dotCurrent]} />;
            })}
            <Text style={styles.hint}>
              {drag ? 'Przesuń do krawędzi ekranu, aby przejść do kolejnej kolumny' : canMove ? 'Chwyć kartę za ≡, aby przenieść ją do innej kolumny' : ''}
            </Text>
          </View>
        ) : null}

        {drag ? (
          <Animated.View pointerEvents="none" style={[styles.ghost, { width: drag.width, transform: [{ translateX: ghost.x }, { translateY: ghost.y }, { rotate: '2.5deg' }, { scale: 1.03 }] }]}>
            <TaskBoardCard task={drag.task} me={me} timerActive={timer?.taskId === drag.task.id} lifted />
          </Animated.View>
        ) : null}

        {notice.overlay}
      </View>

      {editor ? (
        <TaskEditorSheet
          key={editor.key}
          board={board}
          target={editor}
          me={me}
          run={run}
          notify={notify}
          onClose={(changed) => { setEditor(null); if (changed) reload(true); }}
          onSaved={(_id, created) => { setEditor(null); notify(created ? 'Zadanie zostało utworzone' : 'Zadanie zostało zaktualizowane'); reload(true); }}
        />
      ) : null}

      {menuTask ? (
        <ActionMenu visible title={menuTask.titleLabel} subtitle={taskColumnLabel(menuTask.boardColumn, board)} items={menuItems(menuTask)}
          onClose={() => setMenuTask(null)} onPick={(key) => pickMenu(menuTask, key)} />
      ) : null}

      {priorityTask ? (
        <ActionMenu visible title="Priorytet" subtitle={priorityTask.titleLabel}
          items={[...TASK_PRIORITIES].reverse().map((item) => ({ key: item.id, label: item.label, icon: 'flag' as const, detail: item.id === priorityTask.priority ? 'Obecny priorytet' : undefined }))}
          onClose={() => setPriorityTask(null)} onPick={(key) => void savePriority(priorityTask, key as TaskPriorityId)} />
      ) : null}

      {dueTarget ? (
        <Sheet visible title="Termin wykonania" subtitle={dueTarget.task.titleLabel} onClose={() => setDueTarget(null)} width={480}
          footer={<SheetActions onCancel={() => setDueTarget(null)} onConfirm={() => void saveDue(dueTarget.task, dueTarget.day || null, dueTarget.time || null)} label="Zapisz" />}>
          <DayField value={dueTarget.day} onChange={(day) => setDueTarget({ ...dueTarget, day })} placeholder="Bez terminu" />
          {dueTarget.day ? (
            <>
              <TimeField value={dueTarget.time} onChange={(time) => setDueTarget({ ...dueTarget, time })} placeholder="Godzina (opcjonalnie)" />
              <Text style={kit.muted}>{dueTarget.time ? `Termin: do ${dueTarget.time}.` : 'Bez godziny — termin na cały dzień (do końca dnia).'}</Text>
              <TouchableOpacity onPress={() => setDueTarget({ ...dueTarget, day: '', time: '' })} style={kit.secondary} accessibilityRole="button">
                <Text style={kit.secondaryText}>Bez terminu</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </Sheet>
      ) : null}

      {deleting ? (
        <Sheet visible title="Usuń zadanie" subtitle={deleting.titleLabel} onClose={() => setDeleting(null)} width={480}
          footer={<SheetActions onCancel={() => setDeleting(null)} onConfirm={() => void removeTask(deleting)} label="Usuń" danger />}>
          <Text style={kit.text}>Czy na pewno chcesz usunąć to zadanie? Usunięte zostaną również wszystkie powiązane wpisy czasu pracy. Ta operacja jest nieodwracalna.</Text>
        </Sheet>
      ) : null}

      {stopping ? (
        <Sheet visible title="Zatrzymać czas pracy?" subtitle={stopping.task.titleLabel} onClose={() => setStopping(null)} width={480}
          footer={(
            <>
              <TouchableOpacity onPress={() => { const next = stopping; setStopping(null); void commitMove(next.task, next.column); }} style={kit.secondary}>
                <Text style={kit.secondaryText}>Nie zatrzymuj</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { const next = stopping; setStopping(null); void commitMove(next.task, next.column, { stopTimer: true }); }} style={kit.primary}>
                <Text style={kit.primaryText}>Zatrzymaj</Text>
              </TouchableOpacity>
            </>
          )}>
          <Text style={kit.text}>Zadanie jest przenoszone do kolejnego etapu. Czy chcesz zatrzymać licznik czasu?</Text>
        </Sheet>
      ) : null}

      {switching ? (
        <Sheet visible title="Przełączyć licznik czasu?" subtitle={switching.titleLabel} onClose={() => setSwitching(null)} width={480}
          footer={<SheetActions onCancel={() => setSwitching(null)} onConfirm={() => { const task = switching; setSwitching(null); void startTimer(task, 'switch'); }} label="Przełącz" />}>
          <Text style={kit.text}>{`Licznik działa dla „${timer?.title ?? 'innego zadania'}”. Zakończyć go i rozpocząć dla tego zadania?`}</Text>
        </Sheet>
      ) : null}
    </NoticeScope>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  flex: { flex: 1 },
  header: {
    gap: spacing.sm, paddingHorizontal: SIDE, paddingVertical: spacing.sm, backgroundColor: colors.background.secondary,
    borderBottomWidth: 1, borderBottomColor: glow(0.08),
  },
  headerWide: { flexDirection: 'row', alignItems: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  search: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: borderRadius.lg,
    backgroundColor: colors.background.primary, borderWidth: 1, borderColor: glow(0.1),
  },
  searchInput: { flex: 1, minHeight: 44, color: colors.text.primary, fontSize: typography.fontSizes.md },
  addButton: { width: 44, height: 44, borderRadius: borderRadius.lg, backgroundColor: colors.primary.gold, alignItems: 'center', justifyContent: 'center' },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: SIDE, paddingVertical: 6,
    backgroundColor: 'rgba(239,68,68,0.08)', borderBottomWidth: 1, borderBottomColor: 'rgba(239,68,68,0.25)',
  },
  bannerText: { flex: 1, color: colors.text.primary, fontSize: typography.fontSizes.xs },
  timerBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: SIDE, paddingVertical: 6,
    backgroundColor: withAlpha('#22c55e', 0.1), borderBottomWidth: 1, borderBottomColor: withAlpha('#22c55e', 0.25),
  },
  timerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ade80' },
  timerText: { flex: 1, color: colors.text.primary, fontSize: typography.fontSizes.sm },
  timerStop: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: spacing.sm },
  timerStopText: { color: colors.status.error, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  centerText: { textAlign: 'center' },
  boardContent: { alignItems: 'flex-start', gap: GAP, paddingHorizontal: SIDE, paddingTop: spacing.md },
  column: {
    flexDirection: 'column', borderRadius: borderRadius.xl, backgroundColor: colors.background.secondary, borderWidth: 1, borderColor: glow(0.06),
    paddingBottom: spacing.xs, overflow: 'hidden',
  },
  columnTarget: { borderColor: colors.primary.gold, backgroundColor: glow(0.05) },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  columnDot: { width: 9, height: 9, borderRadius: 5 },
  columnTitle: { flex: 1, color: colors.text.primary, fontFamily: typography.fontFamilies.heading, fontSize: typography.fontSizes.md },
  columnCount: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm, fontVariant: ['tabular-nums'] },
  columnAdd: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  columnScroll: { flexGrow: 0, flexShrink: 1 },
  columnContent: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  cardWrap: { marginBottom: spacing.sm },
  slot: { marginBottom: spacing.sm, borderRadius: borderRadius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: glow(0.25), backgroundColor: glow(0.04) },
  collapsed: { height: 0, overflow: 'hidden' },
  invisible: { opacity: 0 },
  placeholder: { marginBottom: spacing.sm, borderRadius: borderRadius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary.gold, backgroundColor: glow(0.06) },
  empty: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm, textAlign: 'center', paddingVertical: spacing.lg },
  more: { alignItems: 'center', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  moreText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  addCard: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, marginHorizontal: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: borderRadius.lg },
  addCardText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.medium },
  composer: { gap: spacing.xs, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  composerInput: {
    minHeight: 48, paddingHorizontal: spacing.sm + 2, borderRadius: borderRadius.lg, backgroundColor: colors.background.tertiary,
    color: colors.text.primary, fontSize: typography.fontSizes.md, borderWidth: 1, borderColor: colors.primary.gold,
  },
  composerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  composerButton: { flex: 1 },
  dots: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SIDE, paddingVertical: spacing.xs + 2,
    borderTopWidth: 1, borderTopColor: glow(0.06), backgroundColor: colors.background.secondary,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotCurrent: { width: 16 },
  hint: { flex: 1, marginLeft: spacing.xs, color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  ghost: { position: 'absolute', left: 0, top: 0, zIndex: 50, elevation: 20 },
});
