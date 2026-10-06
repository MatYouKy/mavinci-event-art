'use client';

import { type ChangeEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  Check,
  ChevronRight,
  Cloud,
  Database,
  Download,
  Edit3,
  Eye,
  FileQuestion,
  Gamepad2,
  Lightbulb,
  MonitorCheck,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import MavinciQuizShowPanel from './MavinciQuizShowPanel';

type HubTab = 'overview' | 'quizshow' | 'familiada' | 'presets' | 'users' | 'sync';

type FamiliadaAnswer = { text: string; points: number };
type FamiliadaQuestion = {
  id: string;
  event_id: string | null;
  category: string;
  question: string;
  answers: FamiliadaAnswer[];
  tags: string[];
  is_active: boolean;
  usage_count: number;
  source: string;
  updated_at: string;
};
type FamiliadaGameRound = {
  id?: string;
  question_id: string;
  sort_order: number;
  multiplier: 1 | 2 | 3;
};
type FamiliadaGame = {
  id: string;
  event_id: string | null;
  name: string;
  description: string;
  is_active: boolean;
  updated_at: string;
  rounds: FamiliadaGameRound[];
};
type LightMagicPreset = {
  id: string;
  event_id: string | null;
  name: string;
  description: string;
  schema_version: number;
  snapshot: Record<string, unknown>;
  updated_at: string;
};
type DesktopSession = {
  id: string;
  instance_id: string;
  employee_id: string;
  device_name: string;
  platform: string;
  app_version: string;
  active_event_id: string | null;
  active_module: string | null;
  sync_status: 'online' | 'idle' | 'offline' | 'error';
  sync_summary: Record<string, unknown>;
  last_sync_at: string | null;
  last_seen_at: string;
  employee_name: string;
  employee_email: string;
  event_name: string | null;
};
type CloudProject = {
  id: string;
  event_id: string;
  name: string;
  enabled_modules: string[];
  version: number;
  published_manifest: Record<string, unknown> | null;
  updated_at: string;
  event_name: string;
  event_date: string | null;
  event_status: string | null;
};
type EventOption = { id: string; name: string; event_date: string | null; status: string | null };

const MODULE_LABELS: Record<string, string> = {
  quiz_show: 'Quiz Show',
  familiada: 'Familiada',
  wedding_show: 'Wedding Show',
  light_magic: 'Light Magic',
  streaming: 'Streaming',
};

const emptyAnswers = (): FamiliadaAnswer[] => Array.from({ length: 6 }, () => ({ text: '', points: 0 }));
const emptyQuestion = () => ({ id: '', event_id: '', category: 'Ogólne', question: '', answers: emptyAnswers(), tags: '' });
const emptyGame = () => ({ id: '', event_id: '', name: '', description: '', is_active: true, rounds: [] as FamiliadaGameRound[] });

const FAMILIADA_ROUND_RULES = [
  { answers: 6, multiplier: 1 as const },
  { answers: 6, multiplier: 1 as const },
  { answers: 5, multiplier: 2 as const },
  { answers: 4, multiplier: 2 as const },
  { answers: 3, multiplier: 3 as const },
  { answers: 3, multiplier: 3 as const },
] as const;

const formatDate = (value?: string | null) => value
  ? new Date(value).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
  : '—';

const downloadJson = (filename: string, payload: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export default function MavinciLiveHubClient() {
  const { canManageModule, canViewModule, hasScope, isAdmin, loading: employeeLoading } = useCurrentEmployee();
  const canViewHub = isAdmin || canViewModule('mavinci_live');
  const canManage = isAdmin || canManageModule('mavinci_live');
  const canUseQuizShow = isAdmin || hasScope('mavinci_live_quiz_show');
  const canUseFamiliada = isAdmin || hasScope('mavinci_live_familiada');
  const canManageFamiliada = canUseFamiliada && canManage;
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const importPresetRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<HubTab>('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [questions, setQuestions] = useState<FamiliadaQuestion[]>([]);
  const [games, setGames] = useState<FamiliadaGame[]>([]);
  const [presets, setPresets] = useState<LightMagicPreset[]>([]);
  const [sessions, setSessions] = useState<DesktopSession[]>([]);
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [questionEditorOpen, setQuestionEditorOpen] = useState(false);
  const [questionPreview, setQuestionPreview] = useState<FamiliadaQuestion | null>(null);
  const [gamePreview, setGamePreview] = useState<FamiliadaGame | null>(null);
  const [questionDraft, setQuestionDraft] = useState(emptyQuestion);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [structuredGameEditorOpen, setStructuredGameEditorOpen] = useState(false);
  const [gameDraft, setGameDraft] = useState(emptyGame);
  const [roundQuestionSearch, setRoundQuestionSearch] = useState<Record<number, string>>({});
  const [openRoundQuestionSelector, setOpenRoundQuestionSelector] = useState<number | null>(null);
  const [savingGame, setSavingGame] = useState(false);

  const loadData = useCallback(async (quiet = false) => {
    if (!canViewHub) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    const [questionsResult, gamesResult, presetsResult, sessionsResult, projectsResult, eventsResult] = await Promise.all([
      supabase.from('mavinci_familiada_questions').select('*').order('updated_at', { ascending: false }),
      supabase.from('mavinci_familiada_games').select('*,rounds:mavinci_familiada_game_questions(id,question_id,sort_order,multiplier)').order('updated_at', { ascending: false }),
      supabase.from('mavinci_light_magic_presets').select('id,event_id,name,description,schema_version,snapshot,updated_at').order('updated_at', { ascending: false }),
      supabase.rpc('mavinci_hub_desktop_sessions'),
      supabase.rpc('mavinci_hub_projects'),
      supabase.from('events').select('id,name,event_date,status').order('event_date', { ascending: false }).limit(250),
    ]);

    const schemaError = [questionsResult.error, gamesResult.error, sessionsResult.error].find((error) => error?.code === '42P01' || error?.code === 'PGRST205');
    setMigrationMissing(Boolean(schemaError));
    setQuestions((questionsResult.data || []) as unknown as FamiliadaQuestion[]);
    setGames(((gamesResult.data || []) as unknown as FamiliadaGame[]).map((game) => ({
      ...game,
      rounds: [...(game.rounds || [])].sort((a, b) => a.sort_order - b.sort_order),
    })));
    setPresets((presetsResult.data || []) as unknown as LightMagicPreset[]);
    setSessions((sessionsResult.data || []) as unknown as DesktopSession[]);
    setProjects((projectsResult.data || []) as unknown as CloudProject[]);
    setEvents((eventsResult.data || []) as unknown as EventOption[]);

    const firstError = [questionsResult.error, gamesResult.error, presetsResult.error, sessionsResult.error, projectsResult.error].find(Boolean);
    if (firstError && !schemaError) showSnackbar(`Nie udało się pobrać części danych Mavinci LIVE: ${firstError.message}`, 'error');
    setLoading(false);
    setRefreshing(false);
  }, [canViewHub, showSnackbar]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    if (!canUseQuizShow && tab === 'quizshow') setTab('overview');
    if (!canUseFamiliada && tab === 'familiada') setTab('overview');
  }, [canUseFamiliada, canUseQuizShow, tab]);

  useEffect(() => {
    const channel = supabase
      .channel('mavinci-live-hub')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mavinci_light_magic_presets' }, () => void loadData(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mavinci_familiada_questions' }, () => void loadData(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mavinci_familiada_games' }, () => void loadData(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mavinci_familiada_game_questions' }, () => void loadData(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mavinci_desktop_sessions' }, () => void loadData(true))
      .subscribe();
    const timer = window.setInterval(() => void loadData(true), 30000);
    return () => { window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [loadData]);

  const eventMap = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const now = Date.now();
  const activeSessions = sessions.filter((session) => now - new Date(session.last_seen_at).getTime() < 90000 && session.sync_status !== 'offline');
  const onlineEmployeeIds = new Set(activeSessions.map((session) => session.employee_id));

  const filteredQuestions = questions.filter((question) => {
    const term = search.trim().toLocaleLowerCase('pl-PL');
    return !term || question.question.toLocaleLowerCase('pl-PL').includes(term)
      || question.category.toLocaleLowerCase('pl-PL').includes(term)
      || question.tags.some((tag) => tag.toLocaleLowerCase('pl-PL').includes(term));
  });
  const filteredGames = games.filter((game) => {
    const term = search.trim().toLocaleLowerCase('pl-PL');
    return !term || game.name.toLocaleLowerCase('pl-PL').includes(term)
      || game.description.toLocaleLowerCase('pl-PL').includes(term);
  });
  const filteredPresets = presets.filter((preset) => {
    const term = search.trim().toLocaleLowerCase('pl-PL');
    return !term || preset.name.toLocaleLowerCase('pl-PL').includes(term)
      || preset.description.toLocaleLowerCase('pl-PL').includes(term);
  });

  const openQuestionEditor = (question?: FamiliadaQuestion) => {
    setQuestionDraft(question ? {
      id: question.id,
      event_id: question.event_id || '',
      category: question.category,
      question: question.question,
      answers: question.answers.map((answer) => ({ ...answer })),
      tags: question.tags.join(', '),
    } : emptyQuestion());
    setQuestionEditorOpen(true);
  };

  const distributePoints = () => {
    const activeAnswers = questionDraft.answers.filter((answer) => answer.text.trim());
    if (!activeAnswers.length) {
      showSnackbar('Najpierw wpisz odpowiedzi.', 'warning');
      return;
    }
    const weightSum = activeAnswers.reduce((sum, _answer, index) => sum + activeAnswers.length - index, 0);
    let used = 0;
    const points = activeAnswers.map((_answer, index) => {
      const value = Math.floor((100 * (activeAnswers.length - index)) / weightSum);
      used += value;
      return value;
    });
    points[0] += 100 - used;
    let activeIndex = 0;
    setQuestionDraft((current) => ({
      ...current,
      answers: current.answers.map((answer) => answer.text.trim()
        ? { ...answer, points: points[activeIndex++] }
        : answer),
    }));
  };

  const saveQuestion = async () => {
    const answers = questionDraft.answers
      .map((answer) => ({ text: answer.text.trim(), points: Math.max(0, Math.round(Number(answer.points) || 0)) }))
      .filter((answer) => answer.text);
    const sum = answers.reduce((total, answer) => total + answer.points, 0);
    if (!questionDraft.question.trim() || answers.length < 3 || answers.length > 6) {
      showSnackbar('Wpisz pytanie oraz od 3 do 6 odpowiedzi.', 'warning');
      return;
    }
    if (sum > 100) {
      showSnackbar(`Suma punktów wynosi ${sum}. Nie może przekraczać 100.`, 'error');
      return;
    }
    setSavingQuestion(true);
    const payload = {
      event_id: questionDraft.event_id || null,
      category: questionDraft.category.trim() || 'Ogólne',
      question: questionDraft.question.trim(),
      answers,
      tags: questionDraft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      source: 'crm',
    };
    const result = questionDraft.id
      ? await supabase.from('mavinci_familiada_questions').update(payload).eq('id', questionDraft.id)
      : await supabase.from('mavinci_familiada_questions').insert(payload);
    setSavingQuestion(false);
    if (result.error) {
      showSnackbar(result.error.message, 'error');
      return;
    }
    setQuestionEditorOpen(false);
    showSnackbar(questionDraft.id ? 'Pytanie zostało zaktualizowane.' : 'Pytanie dodane do wspólnej bazy.', 'success');
    await loadData(true);
  };

  const removeQuestion = async (question: FamiliadaQuestion) => {
    if (!await showConfirm(`Usunąć pytanie „${question.question}”?`, 'Usuń')) return false;
    const { error } = await supabase.from('mavinci_familiada_questions').delete().eq('id', question.id);
    if (error) {
      showSnackbar(error.message, 'error');
      return false;
    }
    showSnackbar('Pytanie usunięte.', 'success');
    await loadData(true);
    return true;
  };

  const openGameEditor = (game?: FamiliadaGame) => {
    setGameDraft(game ? {
      id: game.id,
      event_id: game.event_id || '',
      name: game.name,
      description: game.description,
      is_active: game.is_active,
      rounds: game.rounds.slice(0, FAMILIADA_ROUND_RULES.length).map((round, index) => ({
        ...round,
        sort_order: index,
        multiplier: FAMILIADA_ROUND_RULES[index].multiplier,
      })),
    } : emptyGame());
    setRoundQuestionSearch({});
    setOpenRoundQuestionSelector(null);
    setStructuredGameEditorOpen(true);
  };

  const addStructuredFamiliadaRound = () => {
    const roundIndex = gameDraft.rounds.length;
    const rule = FAMILIADA_ROUND_RULES[roundIndex];
    if (!rule) {
      showSnackbar('Gra Familiady ma dokładnie 6 rund.', 'warning');
      return;
    }
    const hasUnusedQuestion = questions.some(
      (question) =>
        question.answers.length === rule.answers &&
        !gameDraft.rounds.some((round) => round.question_id === question.id),
    );
    if (!hasUnusedQuestion) {
      showSnackbar(
        `Brakuje niewykorzystanego pytania z ${rule.answers} odpowiedziami dla rundy ${roundIndex + 1}.`,
        'warning',
      );
      return;
    }
    setGameDraft((current) => ({
      ...current,
      rounds: [
        ...current.rounds,
        {
          question_id: '',
          sort_order: roundIndex,
          multiplier: rule.multiplier,
        },
      ],
    }));
    setRoundQuestionSearch((current) => ({ ...current, [roundIndex]: '' }));
    setOpenRoundQuestionSelector(roundIndex);
  };

  const saveGame = async () => {
    if (gameDraft.name.trim().length < 2 || gameDraft.rounds.length !== FAMILIADA_ROUND_RULES.length) {
      showSnackbar('Podaj nazwę i skonfiguruj dokładnie 6 rund Familiady.', 'warning');
      return;
    }
    if (gameDraft.rounds.some((round) => !round.question_id)) {
      showSnackbar('Wybierz pytanie dla każdej rundy.', 'warning');
      return;
    }
    if (new Set(gameDraft.rounds.map((round) => round.question_id)).size !== gameDraft.rounds.length) {
      showSnackbar('Każde pytanie może wystąpić w grze tylko raz.', 'warning');
      return;
    }
    const invalidRoundIndex = gameDraft.rounds.findIndex((round, index) => {
      const question = questions.find((item) => item.id === round.question_id);
      return !question || question.answers.length !== FAMILIADA_ROUND_RULES[index].answers;
    });
    if (invalidRoundIndex >= 0) {
      const rule = FAMILIADA_ROUND_RULES[invalidRoundIndex];
      showSnackbar(
        `Runda ${invalidRoundIndex + 1} wymaga pytania z ${rule.answers} odpowiedziami.`,
        'warning',
      );
      return;
    }
    setSavingGame(true);
    const { error } = await supabase.rpc('mavinci_save_familiada_game', {
      p_game: {
        id: gameDraft.id || null,
        event_id: gameDraft.event_id || null,
        name: gameDraft.name.trim(),
        description: gameDraft.description.trim(),
        is_active: gameDraft.is_active,
        rounds: gameDraft.rounds.map((round, index) => ({
          question_id: round.question_id,
          multiplier: FAMILIADA_ROUND_RULES[index].multiplier,
        })),
      },
    });
    setSavingGame(false);
    if (error) {
      showSnackbar(error.message, 'error');
      return;
    }
    setStructuredGameEditorOpen(false);
    showSnackbar(gameDraft.id ? 'Gra została zaktualizowana.' : 'Gra została zapisana w centralnej bazie.', 'success');
    await loadData(true);
  };

  const removeGame = async (game: FamiliadaGame) => {
    if (!await showConfirm(`Usunąć grę „${game.name}”?`, 'Usuń')) return false;
    const { error } = await supabase.from('mavinci_familiada_games').delete().eq('id', game.id);
    if (error) {
      showSnackbar(error.message, 'error');
      return false;
    }
    showSnackbar('Gra usunięta.', 'success');
    await loadData(true);
    return true;
  };

  const importPreset = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, any>;
      const snapshot = parsed.snapshot && typeof parsed.snapshot === 'object' ? parsed.snapshot : parsed;
      if (snapshot.schema !== 'mavinci-light-magic-preset') throw new Error('Plik nie jest presetem Light Magic Mavinci LIVE.');
      const { error } = await supabase.from('mavinci_light_magic_presets').insert({
        event_id: null,
        name: String(snapshot.name || file.name.replace(/\.(mvlmpreset|json)$/i, '')),
        description: String(snapshot.description || 'Import z panelu CRM'),
        schema_version: Number(snapshot.schemaVersion || 1),
        snapshot,
      });
      if (error) throw error;
      showSnackbar('Preset zaimportowany do wspólnej bazy.', 'success');
      await loadData(true);
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Import presetu nie powiódł się.', 'error');
    }
  };

  const removePreset = async (preset: LightMagicPreset) => {
    if (!await showConfirm(`Usunąć preset „${preset.name}”?`, 'Usuń')) return;
    const { error } = await supabase.from('mavinci_light_magic_presets').delete().eq('id', preset.id);
    if (error) showSnackbar(error.message, 'error');
    else { showSnackbar('Preset usunięty.', 'success'); await loadData(true); }
  };

  const tabs: Array<{ id: HubTab; label: string; icon: typeof Database; count?: number }> = [
    { id: 'overview', label: 'Przegląd', icon: Activity },
    ...(canUseQuizShow ? [{ id: 'quizshow' as const, label: 'Quiz Show', icon: BookOpenCheck }] : []),
    ...(canUseFamiliada ? [{ id: 'familiada' as const, label: 'Baza Familiady', icon: FileQuestion, count: questions.length + games.length }] : []),
    { id: 'presets', label: 'Presety Light Magic', icon: Lightbulb, count: presets.length },
    { id: 'users', label: 'Aktywni użytkownicy', icon: Users, count: activeSessions.length },
    { id: 'sync', label: 'Synchronizacja', icon: Cloud, count: projects.length },
  ];

  if (employeeLoading || loading) return <div className="flex min-h-[420px] items-center justify-center text-[#d3bb73]"><RefreshCw className="mr-3 h-5 w-5 animate-spin" /> Wczytuję Mavinci LIVE…</div>;
  if (!canViewHub) return <div className="mx-auto mt-12 max-w-2xl rounded-2xl border border-red-400/20 bg-red-400/10 p-8 text-center text-red-100"><h1 className="text-2xl font-semibold">Brak dostępu do Mavinci LIVE</h1><p className="mt-2 text-sm text-red-100/70">Administrator musi nadać temu pracownikowi główne uprawnienie Mavinci LIVE.</p></div>;

  return (
    <div className="mx-auto w-full max-w-[1700px] space-y-5 text-[#e5e4e2]">
      <header className="overflow-hidden rounded-2xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#20243a] via-[#171b2b] to-[#111522] p-6 shadow-2xl shadow-black/20">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <span className="rounded-2xl border border-[#d3bb73]/25 bg-[#d3bb73]/10 p-4 text-[#d3bb73]"><MonitorCheck className="h-8 w-8" /></span>
            <div><p className="text-xs font-bold uppercase tracking-[.24em] text-[#d3bb73]">Centrum zarządzania</p><h1 className="mt-1 text-3xl font-semibold">Mavinci LIVE</h1><p className="mt-1 text-sm text-[#e5e4e2]/55">Jedno źródło pytań, presetów, dostępów i zsynchronizowanych realizacji.</p></div>
          </div>
          <button type="button" onClick={() => void loadData(true)} disabled={refreshing} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold hover:border-[#d3bb73]/40 hover:text-[#d3bb73] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Odśwież dane</button>
        </div>
      </header>

      {migrationMissing && <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">Nowy magazyn danych nie jest jeszcze dostępny. Zastosuj migrację <strong>20260826090000_create_mavinci_live_hub.sql</strong> w Supabase.</div>}

      <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-[#171b2b] p-2">
        {tabs.map((item) => { const Icon = item.icon; return <button data-crm-tab-active={tab === item.id} key={item.id} type="button" onClick={() => { setTab(item.id); setSearch(''); }} className={`flex min-w-max items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${tab === item.id ? 'bg-[#d3bb73] text-[#111522]' : 'text-[#e5e4e2]/55 hover:bg-white/5 hover:text-[#e5e4e2]'}`}><Icon className="h-4 w-4" />{item.label}{item.count !== undefined && <span className={`rounded-full px-2 py-0.5 text-xs ${tab === item.id ? 'bg-black/15' : 'bg-white/5'}`}>{item.count}</span>}</button>; })}
      </nav>

      {tab === 'overview' && <div className="space-y-5">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ...(canUseFamiliada ? [{ label: 'Gry Familiady', value: games.length, detail: `${questions.length} pytań w bibliotece`, icon: Gamepad2, color: 'text-amber-300' }] : []),
            { label: 'Presety Light Magic', value: presets.length, detail: `${presets.filter((item) => item.event_id).length} przypisanych do eventów`, icon: Lightbulb, color: 'text-cyan-300' },
            { label: 'Użytkownicy online', value: activeSessions.length, detail: `${onlineEmployeeIds.size} pracowników`, icon: Users, color: 'text-emerald-300' },
            { label: 'Projekty w chmurze', value: projects.length, detail: `${projects.filter((item) => item.version > 0).length} opublikowanych`, icon: Cloud, color: 'text-violet-300' },
          ].map((card) => { const Icon = card.icon; return <article key={card.label} className="rounded-2xl border border-white/10 bg-[#171b2b] p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-[#e5e4e2]/40">{card.label}</p><strong className="mt-3 block text-4xl font-semibold">{card.value}</strong><span className="mt-2 block text-xs text-[#e5e4e2]/40">{card.detail}</span></div><Icon className={`h-6 w-6 ${card.color}`} /></div></article>; })}
        </section>
        <section className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          <div className="rounded-2xl border border-white/10 bg-[#171b2b] p-5"><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#d3bb73]">Ostatnia aktywność</p><h2 className="mt-1 text-xl font-semibold">Uruchomione instalacje</h2></div><button onClick={() => setTab('users')} className="flex items-center gap-1 text-sm text-[#d3bb73]">Zobacz wszystkie <ChevronRight className="h-4 w-4" /></button></div><div className="space-y-2">{sessions.slice(0, 5).map((session) => { const online = now - new Date(session.last_seen_at).getTime() < 90000 && session.sync_status !== 'offline'; return <div key={session.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-[#111522] px-4 py-3"><div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400 shadow-[0_0_10px_#34d399]' : 'bg-slate-600'}`} /><div><strong className="text-sm">{session.employee_name || session.device_name}</strong><p className="text-xs text-[#e5e4e2]/40">{session.device_name} · {session.active_module ? MODULE_LABELS[session.active_module] || session.active_module : 'Pulpit'}</p></div></div><small className="text-[#e5e4e2]/35">{online ? 'teraz' : formatDate(session.last_seen_at)}</small></div>; })}{sessions.length === 0 && <EmptyState text="Żadna instalacja Mavinci LIVE nie wysłała jeszcze statusu." />}</div></div>
          <div className="rounded-2xl border border-white/10 bg-[#171b2b] p-5"><p className="text-xs font-bold uppercase tracking-[.16em] text-[#d3bb73]">Spójność danych</p><h2 className="mt-1 text-xl font-semibold">Stan publikacji</h2><div className="mt-5 space-y-3"><StatusRow label="Projekty opublikowane" value={`${projects.filter((item) => item.version > 0).length}/${projects.length}`} ok={!projects.length || projects.every((item) => item.version > 0)} /><StatusRow label="Sesje zsynchronizowane" value={`${sessions.filter((item) => item.last_sync_at).length}/${sessions.length}`} ok={!sessions.length || sessions.every((item) => item.last_sync_at)} /><StatusRow label="Presety z opisem" value={`${presets.filter((item) => item.description.trim()).length}/${presets.length}`} ok={!presets.length || presets.every((item) => item.description.trim())} /></div></div>
        </section>
      </div>}

      {tab === 'quizshow' && <MavinciQuizShowPanel canManage={canManage && canUseQuizShow} />}

      {tab === 'familiada' && <div className="space-y-5">
        <section className="rounded-2xl border border-white/10 bg-[#171b2b] p-5">
          <SectionHeader eyebrow="Familiada · gry" title="Gotowe rozgrywki" description="Wybierz sześć pytań. Liczba odpowiedzi i mnożnik są pilnowane automatycznie dla każdej rundy." actions={<>{canManageFamiliada && <button onClick={() => openGameEditor()} className="flex items-center gap-2 rounded-xl bg-[#d3bb73] px-4 py-3 text-sm font-bold text-[#111522]"><Plus className="h-4 w-4" /> Nowa gra</button>}</>} />
          <SearchBox value={search} onChange={setSearch} placeholder="Szukaj gry albo pytania…" />
          <div className="mt-4 overflow-hidden rounded-xl border border-white/8 bg-[#111522]">
            <div className="hidden grid-cols-[minmax(0,1fr)_180px_90px_130px_40px] gap-3 border-b border-white/8 bg-white/[.035] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#e5e4e2]/35 md:grid">
              <span>Rozgrywka</span>
              <span>Wydarzenie</span>
              <span>Rundy</span>
              <span>Aktualizacja</span>
              <span className="sr-only">Akcje</span>
            </div>
            <div className="max-h-[430px] divide-y divide-white/5 overflow-y-auto overscroll-contain">
              {filteredGames.map((game) => (
                <div
                  key={game.id}
                  className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_40px] items-center gap-2 px-3 py-2.5 hover:bg-white/[.025] md:grid-cols-[minmax(0,1fr)_180px_90px_130px_40px] md:gap-3"
                >
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setGamePreview(game)}
                      className="block max-w-full truncate text-left text-sm font-semibold text-[#e5e4e2] hover:text-[#d3bb73]"
                    >
                      {game.name}
                    </button>
                    <span className="block truncate text-[10px] text-[#e5e4e2]/35">
                      {game.description || 'Bez opisu'}
                    </span>
                  </div>
                  <span className="hidden truncate text-xs text-[#e5e4e2]/50 md:block">
                    {game.event_id ? eventMap.get(game.event_id)?.name || 'Wydarzenie' : 'Gra globalna'}
                  </span>
                  <span className="hidden text-xs tabular-nums text-[#e5e4e2]/50 md:block">
                    {game.rounds.length} / {FAMILIADA_ROUND_RULES.length}
                  </span>
                  <span className="hidden text-xs text-[#e5e4e2]/35 md:block">
                    {formatDate(game.updated_at)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setGamePreview(game)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-[#e5e4e2]/55 hover:border-[#d3bb73]/35 hover:text-[#d3bb73]"
                    title="Pokaż rundy rozgrywki"
                    aria-label={`Pokaż rozgrywkę: ${game.name}`}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {filteredGames.length === 0 && (
                <EmptyState text="Nie ma jeszcze gotowej gry. Utwórz ją z pytań poniżej." />
              )}
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-[#171b2b] p-5">
          <SectionHeader eyebrow="Familiada · pytania" title="Centralna biblioteka pytań" description="Każde pytanie ma od 3 do 6 odpowiedzi. Mnożnik wybierasz dopiero podczas układania gry." actions={<>{canManageFamiliada && <button data-crm-action="secondary" onClick={() => openQuestionEditor()} className="flex items-center gap-2 rounded-xl border border-[#d3bb73]/30 px-4 py-3 text-sm font-bold text-[#d3bb73]"><Plus className="h-4 w-4" /> Dodaj pytanie</button>}</>} />
          <div className="mt-4 overflow-hidden rounded-xl border border-white/8 bg-[#111522]">
            <div className="hidden grid-cols-[minmax(0,1fr)_140px_125px_48px] gap-3 border-b border-white/8 bg-white/[.035] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#e5e4e2]/35 md:grid">
              <span>Pytanie</span>
              <span>Kategoria</span>
              <span>Odpowiedzi</span>
              <span className="sr-only">Akcje</span>
            </div>
            <div className="max-h-[540px] divide-y divide-white/5 overflow-y-auto overscroll-contain">
              {filteredQuestions.map((question, index) => (
                <div
                  key={question.id}
                  className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_40px] items-center gap-2 px-3 py-2 hover:bg-white/[.025] md:grid-cols-[minmax(0,1fr)_140px_125px_40px] md:gap-3"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-[#e5e4e2]/25">
                      {index + 1}.
                    </span>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setQuestionPreview(question)}
                        className="block max-w-full truncate text-left text-sm font-medium text-[#e5e4e2] hover:text-[#d3bb73]"
                        title={question.question}
                      >
                        {question.question}
                      </button>
                      <span className="block truncate text-[10px] text-[#e5e4e2]/30 md:hidden">
                        {question.category} · {question.answers.length} odpowiedzi
                      </span>
                    </div>
                  </div>
                  <span className="hidden truncate text-xs text-[#e5e4e2]/55 md:block">
                    {question.category}
                  </span>
                  <span className="hidden text-xs tabular-nums text-[#e5e4e2]/45 md:block">
                    {question.answers.length} · {question.answers.reduce((sum, answer) => sum + answer.points, 0)} pkt
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuestionPreview(question)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-[#e5e4e2]/55 hover:border-[#d3bb73]/35 hover:text-[#d3bb73]"
                    title="Pokaż pytanie i odpowiedzi"
                    aria-label={`Pokaż szczegóły pytania: ${question.question}`}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {filteredQuestions.length === 0 && (
                <EmptyState text="Brak pytań spełniających wybrane kryteria." />
              )}
            </div>
            {filteredQuestions.length > 10 && (
              <div className="border-t border-white/8 px-3 py-2 text-[10px] text-[#e5e4e2]/30">
                Wyświetlono {filteredQuestions.length} pytań · przewiń listę, aby zobaczyć pozostałe
              </div>
            )}
          </div>
        </section>
      </div>}

      {tab === 'presets' && <section className="rounded-2xl border border-white/10 bg-[#171b2b] p-5">
        <SectionHeader eyebrow="Light Magic" title="Baza presetów" description="Presety globalne i przypisane do wydarzeń. Plik można bezpiecznie przenieść między macOS i Windows." actions={<>{canManage && <><input ref={importPresetRef} type="file" accept=".mvlmpreset,.json,application/json" className="hidden" onChange={(event) => void importPreset(event)} /><button onClick={() => importPresetRef.current?.click()} className="flex items-center gap-2 rounded-xl bg-[#d3bb73] px-4 py-3 text-sm font-bold text-[#111522]"><Upload className="h-4 w-4" /> Importuj preset</button></>}</>} />
        <SearchBox value={search} onChange={setSearch} placeholder="Szukaj presetu…" />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredPresets.map((preset) => <article key={preset.id} className="rounded-xl border border-white/8 bg-[#111522] p-4"><div className="flex items-start justify-between gap-3"><span className="rounded-xl bg-cyan-400/10 p-3 text-cyan-300"><Lightbulb className="h-5 w-5" /></span><div className="flex gap-2"><button onClick={() => downloadJson(`${preset.name.replace(/[^a-z0-9-_]+/gi, '-')}.mvlmpreset`, preset.snapshot)} className="rounded-lg border border-white/10 p-2 text-[#e5e4e2]/55 hover:text-cyan-300" title="Eksportuj"><Download className="h-4 w-4" /></button>{canManage && <button onClick={() => void removePreset(preset)} className="rounded-lg border border-red-400/20 p-2 text-red-300/70 hover:bg-red-400/10" title="Usuń"><Trash2 className="h-4 w-4" /></button>}</div></div><h3 className="mt-4 font-semibold">{preset.name}</h3><p className="mt-1 min-h-10 text-sm text-[#e5e4e2]/45">{preset.description || 'Bez opisu'}</p><div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3 text-[11px] text-[#e5e4e2]/35"><span>{preset.event_id ? eventMap.get(preset.event_id)?.name || 'Preset wydarzenia' : 'Preset globalny'}</span><span>v{preset.schema_version} · {formatDate(preset.updated_at)}</span></div></article>)}{filteredPresets.length === 0 && <div className="md:col-span-2 xl:col-span-3"><EmptyState text="Brak zapisanych presetów Light Magic." /></div>}</div>
      </section>}

      {tab === 'users' && <section className="rounded-2xl border border-white/10 bg-[#171b2b] p-5">
        <SectionHeader eyebrow="Aplikacje desktopowe" title="Aktywni użytkownicy" description="Instalacja jest online, jeśli wysłała status w ciągu ostatnich 90 sekund." />
        <div className="mt-5 overflow-hidden rounded-xl border border-white/8"><div className="hidden grid-cols-[1.2fr_1.2fr_.7fr_1fr_.8fr] gap-3 bg-white/[.035] px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#e5e4e2]/35 md:grid"><span>Użytkownik</span><span>Komputer</span><span>Wersja</span><span>Aktywny obszar</span><span>Status</span></div>{sessions.map((session) => { const online = now - new Date(session.last_seen_at).getTime() < 90000 && session.sync_status !== 'offline'; return <div key={session.id} className="grid gap-2 border-t border-white/5 px-4 py-4 first:border-0 md:grid-cols-[1.2fr_1.2fr_.7fr_1fr_.8fr] md:items-center md:gap-3"><div><strong className="text-sm">{session.employee_name || 'Nieznany pracownik'}</strong><small className="block text-[#e5e4e2]/35">{session.employee_email || session.employee_id}</small></div><div className="text-sm">{session.device_name}<small className="block text-[#e5e4e2]/35">{session.platform}</small></div><span className="text-sm">{session.app_version || '—'}</span><div className="text-sm">{session.active_module ? MODULE_LABELS[session.active_module] || session.active_module : 'Pulpit'}<small className="block text-[#e5e4e2]/35">{session.active_event_id ? session.event_name || 'Wydarzenie' : 'Bez wydarzenia'}</small></div><div><span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${online ? 'bg-emerald-400/10 text-emerald-300' : 'bg-slate-500/10 text-slate-400'}`}><i className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-slate-500'}`} />{online ? 'Online' : 'Offline'}</span><small className="mt-1 block text-[#e5e4e2]/30">{formatDate(session.last_seen_at)}</small></div></div>; })}{sessions.length === 0 && <EmptyState text="Brak zarejestrowanych instalacji Mavinci LIVE." />}</div>
      </section>}

      {tab === 'sync' && <section className="rounded-2xl border border-white/10 bg-[#171b2b] p-5">
        <SectionHeader eyebrow="Chmura wydarzeń" title="Zsynchronizowane dane" description="Wersja jest zwiększana przy każdej publikacji projektu w wydarzeniu." />
        <div className="mt-5 space-y-3">{projects.map((project) => <article key={project.id} className="grid gap-4 rounded-xl border border-white/8 bg-[#111522] p-4 lg:grid-cols-[1.2fr_.8fr_.8fr_auto] lg:items-center"><div><span className="text-[10px] font-bold uppercase tracking-wider text-[#d3bb73]">{project.event_name || 'Wydarzenie'}</span><h3 className="mt-1 font-semibold">{project.name}</h3><small className="text-[#e5e4e2]/35">{project.event_date ? new Date(project.event_date).toLocaleDateString('pl-PL') : 'Bez daty'}</small></div><div><span className="text-xs text-[#e5e4e2]/35">Moduły</span><div className="mt-2 flex flex-wrap gap-1">{project.enabled_modules.map((module) => <span key={module} className="rounded-full bg-white/5 px-2 py-1 text-[10px]">{MODULE_LABELS[module] || module}</span>)}</div></div><div><span className="text-xs text-[#e5e4e2]/35">Ostatnia aktualizacja</span><strong className="mt-1 block text-sm">{formatDate(project.updated_at)}</strong></div><span className={`rounded-full px-3 py-2 text-center text-xs font-bold ${project.version > 0 && project.published_manifest ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>{project.version > 0 && project.published_manifest ? `Opublikowano v${project.version}` : 'Tylko szkic'}</span></article>)}{projects.length === 0 && <EmptyState text="Brak projektów Mavinci LIVE przypisanych do wydarzeń." />}</div>
      </section>}

      {gamePreview && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setGamePreview(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="familiada-game-preview-title"
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#d3bb73]/25 bg-[#171b2b] shadow-2xl"
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-[#171b2b]/95 px-5 py-4 backdrop-blur">
              <div className="min-w-0">
                <span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-200">
                  {gamePreview.event_id
                    ? eventMap.get(gamePreview.event_id)?.name || 'Wydarzenie'
                    : 'Gra globalna'}
                </span>
                <h2 id="familiada-game-preview-title" className="mt-3 text-xl font-semibold text-[#e5e4e2]">
                  {gamePreview.name}
                </h2>
                {gamePreview.description && (
                  <p className="mt-1 text-sm text-[#e5e4e2]/45">{gamePreview.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setGamePreview(null)}
                className="shrink-0 rounded-lg border border-white/10 p-2 text-[#e5e4e2]/55 hover:text-[#e5e4e2]"
                aria-label="Zamknij podgląd rozgrywki"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="space-y-2 p-5">
              {gamePreview.rounds.map((round, index) => {
                const question = questions.find((item) => item.id === round.question_id);
                return (
                  <div
                    key={round.id || `${gamePreview.id}-${index}`}
                    className="flex items-start gap-3 rounded-xl border border-white/8 bg-[#111522] px-3 py-3"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#d3bb73]/10 text-xs font-bold text-[#d3bb73]">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      {question ? (
                        <button
                          type="button"
                          onClick={() => {
                            setGamePreview(null);
                            setQuestionPreview(question);
                          }}
                          className="block max-w-full text-left text-sm font-medium text-[#e5e4e2] hover:text-[#d3bb73]"
                        >
                          {question.question}
                        </button>
                      ) : (
                        <span className="text-sm text-red-300/70">Usunięte pytanie</span>
                      )}
                      <span className="mt-1 block text-[10px] text-[#e5e4e2]/35">
                        {question ? `${question.answers.length} odpowiedzi · ${question.category}` : 'Brak danych pytania'}
                      </span>
                    </div>
                    <strong className="shrink-0 rounded-lg bg-[#d3bb73]/10 px-2.5 py-1.5 text-xs text-[#d3bb73]">
                      ×{round.multiplier}
                    </strong>
                  </div>
                );
              })}
              {gamePreview.rounds.length === 0 && (
                <EmptyState text="Ta rozgrywka nie ma jeszcze rund." />
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
              <span className="mr-auto text-xs text-[#e5e4e2]/35">
                {gamePreview.rounds.length} rund · aktualizacja {formatDate(gamePreview.updated_at)}
              </span>
              {canManageFamiliada && (
                <button
                  type="button"
                  onClick={async () => {
                    if (await removeGame(gamePreview)) setGamePreview(null);
                  }}
                  className="rounded-xl border border-red-400/20 px-4 py-2.5 text-sm text-red-300/75 hover:bg-red-400/10"
                >
                  Usuń
                </button>
              )}
              <button
                type="button"
                onClick={() => setGamePreview(null)}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-[#e5e4e2]/70"
              >
                Zamknij
              </button>
              {canManageFamiliada && (
                <button
                  type="button"
                  onClick={() => {
                    const game = gamePreview;
                    setGamePreview(null);
                    openGameEditor(game);
                  }}
                  className="flex items-center gap-2 rounded-xl bg-[#d3bb73] px-4 py-2.5 text-sm font-bold text-[#111522]"
                >
                  <Edit3 className="h-4 w-4" />
                  Edytuj rozgrywkę
                </button>
              )}
            </footer>
          </div>
        </div>
      )}

      {structuredGameEditorOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setStructuredGameEditorOpen(false);
          }}
        >
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-[#d3bb73]/25 bg-[#171b2b] shadow-2xl">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#171b2b]/95 px-6 py-5 backdrop-blur">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.16em] text-[#d3bb73]">
                  Kompozytor Familiady
                </p>
                <h2 className="mt-1 text-xl font-semibold">
                  {gameDraft.id ? 'Edytuj grę' : 'Nowa gra'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setStructuredGameEditorOpen(false)}
                className="rounded-lg border border-white/10 p-2 text-[#e5e4e2]/55"
                aria-label="Zamknij kompozytor"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="space-y-5 p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm text-[#e5e4e2]/65">
                  Nazwa gry
                  <input
                    value={gameDraft.name}
                    onChange={(event) =>
                      setGameDraft((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="np. Familiada weselna"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-[#111522] px-4 py-3 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
                  />
                </label>
                <label className="text-sm text-[#e5e4e2]/65">
                  Wydarzenie
                  <select
                    value={gameDraft.event_id}
                    onChange={(event) =>
                      setGameDraft((current) => ({ ...current, event_id: event.target.value }))
                    }
                    className="mt-2 w-full rounded-xl border border-white/10 bg-[#111522] px-4 py-3 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
                  >
                    <option value="">Gra globalna</option>
                    {events.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.name}
                        {event.event_date
                          ? ` · ${new Date(event.event_date).toLocaleDateString('pl-PL')}`
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block text-sm text-[#e5e4e2]/65">
                Opis
                <textarea
                  value={gameDraft.description}
                  onChange={(event) =>
                    setGameDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  rows={2}
                  className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-[#111522] px-4 py-3 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
                />
              </label>

              <div className="rounded-xl border border-[#d3bb73]/15 bg-[#d3bb73]/5 px-4 py-3 text-xs text-[#e5e4e2]/65">
                Układ gry: rundy 1–2 — 6 odpowiedzi i ×1; runda 3 — 5 odpowiedzi i ×2;
                runda 4 — 4 odpowiedzi i ×2; rundy 5–6 — 3 odpowiedzi i ×3.
              </div>

              <div>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Rundy gry</h3>
                    <p className="text-xs text-[#e5e4e2]/40">
                      Dla każdej rundy dostępne są tylko pytania z właściwą liczbą odpowiedzi.
                    </p>
                  </div>
                  <button data-crm-action="secondary"
                    type="button"
                    onClick={addStructuredFamiliadaRound}
                    disabled={gameDraft.rounds.length >= FAMILIADA_ROUND_RULES.length}
                    className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/25 px-3 py-2 text-xs font-semibold text-[#d3bb73] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <Plus className="h-4 w-4" />
                    Dodaj rundę
                  </button>
                </div>

                <div className="space-y-2">
                  {gameDraft.rounds.map((round, index) => {
                    const rule = FAMILIADA_ROUND_RULES[index];
                    const currentQuestion = questions.find(
                      (question) => question.id === round.question_id,
                    );
                    const currentQuestionIsInvalid =
                      currentQuestion && currentQuestion.answers.length !== rule.answers;
                    const eligibleQuestions = questions.filter(
                      (question) => question.answers.length === rule.answers,
                    );
                    const questionSearch = (roundQuestionSearch[index] || '')
                      .trim()
                      .toLocaleLowerCase('pl-PL');
                    const visibleQuestions = eligibleQuestions.filter(
                      (question) =>
                        !questionSearch ||
                        question.question.toLocaleLowerCase('pl-PL').includes(questionSearch) ||
                        question.category.toLocaleLowerCase('pl-PL').includes(questionSearch) ||
                        question.tags.some((tag) =>
                          tag.toLocaleLowerCase('pl-PL').includes(questionSearch),
                        ),
                    );

                    return (
                      <div
                        key={`${round.question_id}-${index}`}
                        className="grid gap-2 rounded-xl border border-white/8 bg-[#111522] p-3 md:grid-cols-[48px_minmax(0,1fr)_150px_auto] md:items-center"
                      >
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#d3bb73]/10 text-sm font-bold text-[#d3bb73]">
                          {index + 1}
                        </span>
                        <div
                          className="relative min-w-0"
                          onBlur={(event) => {
                            if (
                              !event.currentTarget.contains(event.relatedTarget as Node | null)
                            ) {
                              setOpenRoundQuestionSelector((current) =>
                                current === index ? null : current,
                              );
                            }
                          }}
                        >
                          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/35" />
                          <input
                            type="search"
                            autoFocus={openRoundQuestionSelector === index}
                            value={
                              openRoundQuestionSelector === index
                                ? roundQuestionSearch[index] || ''
                                : currentQuestion?.question || ''
                            }
                            onFocus={() => {
                              setOpenRoundQuestionSelector(index);
                              setRoundQuestionSearch((current) => ({
                                ...current,
                                [index]: '',
                              }));
                            }}
                            onChange={(event) => {
                              setOpenRoundQuestionSelector(index);
                              setRoundQuestionSearch((current) => ({
                                ...current,
                                [index]: event.target.value,
                              }));
                            }}
                            placeholder={`Szukaj pytania z ${rule.answers} odpowiedziami…`}
                            role="combobox"
                            aria-autocomplete="list"
                            aria-controls={`familiada-round-${index}-questions`}
                            aria-expanded={openRoundQuestionSelector === index}
                            className={`w-full rounded-lg border bg-[#0c1020] py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73] ${
                              currentQuestionIsInvalid
                                ? 'border-red-400/50'
                                : 'border-white/10'
                            }`}
                          />

                          {openRoundQuestionSelector === index && (
                            <div
                              id={`familiada-round-${index}-questions`}
                              className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#0c1020] shadow-2xl"
                            >
                              <div className="border-b border-white/8 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#e5e4e2]/35">
                                {visibleQuestions.length} z {eligibleQuestions.length} pytań ·{' '}
                                {rule.answers} odpowiedzi
                              </div>
                              <div className="max-h-64 overflow-y-auto overscroll-contain p-1.5">
                                {visibleQuestions.map((question) => {
                                  const usedRoundIndex = gameDraft.rounds.findIndex(
                                    (item) => item.question_id === question.id,
                                  );
                                  const usedElsewhere =
                                    usedRoundIndex >= 0 && usedRoundIndex !== index;
                                  const isSelected = round.question_id === question.id;

                                  return (
                                    <button
                                      key={question.id}
                                      type="button"
                                      disabled={usedElsewhere}
                                      onClick={() => {
                                        setGameDraft((current) => ({
                                          ...current,
                                          rounds: current.rounds.map((item, itemIndex) =>
                                            itemIndex === index
                                              ? { ...item, question_id: question.id }
                                              : item,
                                          ),
                                        }));
                                        setRoundQuestionSearch((current) => ({
                                          ...current,
                                          [index]: '',
                                        }));
                                        setOpenRoundQuestionSelector(null);
                                      }}
                                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                                        isSelected
                                          ? 'bg-[#d3bb73]/12 text-[#d3bb73]'
                                          : 'text-[#e5e4e2]/80 hover:bg-white/5'
                                      } disabled:cursor-not-allowed disabled:opacity-35`}
                                    >
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate">{question.question}</span>
                                        <span className="mt-0.5 block truncate text-[10px] text-[#e5e4e2]/35">
                                          {question.category}
                                          {question.tags.length > 0
                                            ? ` · ${question.tags.map((tag) => `#${tag}`).join(' ')}`
                                            : ''}
                                        </span>
                                      </span>
                                      {usedElsewhere && (
                                        <span className="shrink-0 text-[10px] text-[#e5e4e2]/40">
                                          runda {usedRoundIndex + 1}
                                        </span>
                                      )}
                                      {isSelected && <Check className="h-4 w-4 shrink-0" />}
                                    </button>
                                  );
                                })}
                                {visibleQuestions.length === 0 && (
                                  <div className="px-3 py-6 text-center text-xs text-[#e5e4e2]/40">
                                    Brak pytań pasujących do wyszukiwania.
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="rounded-lg bg-white/5 px-2.5 py-2 text-[#e5e4e2]/60">
                            {rule.answers} odpowiedzi
                          </span>
                          <strong className="rounded-lg bg-[#d3bb73]/10 px-2.5 py-2 text-[#d3bb73]">
                            ×{rule.multiplier}
                          </strong>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setGameDraft((current) => ({
                              ...current,
                              rounds: current.rounds.slice(0, -1),
                            }))
                          }
                          disabled={index !== gameDraft.rounds.length - 1}
                          className="rounded-lg p-2 text-red-300/60 disabled:invisible"
                          title="Usuń ostatnią rundę"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                  {gameDraft.rounds.length === 0 && (
                    <EmptyState text="Dodaj pierwszą rundę. Kompozytor dobierze pytania zgodnie z formatem gry." />
                  )}
                </div>
              </div>

              <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 pt-5">
                <span className="mr-auto text-sm text-[#e5e4e2]/45">
                  {gameDraft.rounds.length} / {FAMILIADA_ROUND_RULES.length} rund
                </span>
                <button
                  type="button"
                  onClick={() => setStructuredGameEditorOpen(false)}
                  className="rounded-xl border border-white/10 px-5 py-3 text-sm"
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  onClick={() => void saveGame()}
                  disabled={savingGame || gameDraft.rounds.length !== FAMILIADA_ROUND_RULES.length}
                  className="rounded-xl bg-[#d3bb73] px-5 py-3 text-sm font-bold text-[#111522] disabled:opacity-50"
                >
                  {savingGame ? 'Zapisywanie…' : 'Zapisz grę'}
                </button>
              </footer>
            </div>
          </div>
        </div>
      )}

      {questionPreview && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setQuestionPreview(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="familiada-question-preview-title"
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#d3bb73]/25 bg-[#171b2b] shadow-2xl"
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-[#171b2b]/95 px-5 py-4 backdrop-blur">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[#d3bb73]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#d3bb73]">
                    {questionPreview.category}
                  </span>
                  <span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-200">
                    {questionPreview.event_id
                      ? eventMap.get(questionPreview.event_id)?.name || 'Wydarzenie'
                      : 'Pytanie globalne'}
                  </span>
                </div>
                <h2 id="familiada-question-preview-title" className="text-xl font-semibold text-[#e5e4e2]">
                  {questionPreview.question}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setQuestionPreview(null)}
                className="shrink-0 rounded-lg border border-white/10 p-2 text-[#e5e4e2]/55 hover:text-[#e5e4e2]"
                aria-label="Zamknij podgląd pytania"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="p-5">
              <div className="space-y-2">
                {questionPreview.answers.map((answer, index) => (
                  <div
                    key={`${answer.text}-${index}`}
                    className="flex min-h-12 items-center gap-3 rounded-xl border border-white/8 bg-[#111522] px-3 py-2.5"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#d3bb73]/10 text-xs font-bold text-[#d3bb73]">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-[#e5e4e2]">{answer.text}</span>
                    <strong className="shrink-0 text-sm tabular-nums text-[#d3bb73]">
                      {answer.points} pkt
                    </strong>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/8 pt-4 text-xs text-[#e5e4e2]/40">
                <span>
                  {questionPreview.answers.length} odpowiedzi · suma{' '}
                  {questionPreview.answers.reduce((sum, answer) => sum + answer.points, 0)} pkt
                </span>
                <span>Aktualizacja: {formatDate(questionPreview.updated_at)}</span>
                {questionPreview.tags.length > 0 && (
                  <span>{questionPreview.tags.map((tag) => `#${tag}`).join(' ')}</span>
                )}
              </div>
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
              {canManageFamiliada && (
                <button
                  type="button"
                  onClick={async () => {
                    if (await removeQuestion(questionPreview)) setQuestionPreview(null);
                  }}
                  className="mr-auto rounded-xl border border-red-400/20 px-4 py-2.5 text-sm text-red-300/75 hover:bg-red-400/10"
                >
                  Usuń
                </button>
              )}
              <button
                type="button"
                onClick={() => setQuestionPreview(null)}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-[#e5e4e2]/70"
              >
                Zamknij
              </button>
              {canManageFamiliada && (
                <button
                  type="button"
                  onClick={() => {
                    const question = questionPreview;
                    setQuestionPreview(null);
                    openQuestionEditor(question);
                  }}
                  className="flex items-center gap-2 rounded-xl bg-[#d3bb73] px-4 py-2.5 text-sm font-bold text-[#111522]"
                >
                  <Edit3 className="h-4 w-4" />
                  Edytuj pytanie
                </button>
              )}
            </footer>
          </div>
        </div>
      )}


      {questionEditorOpen && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setQuestionEditorOpen(false); }}><div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-[#d3bb73]/25 bg-[#171b2b] shadow-2xl"><header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#171b2b]/95 px-6 py-5 backdrop-blur"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#d3bb73]">Baza Familiady</p><h2 className="mt-1 text-xl font-semibold">{questionDraft.id ? 'Edytuj pytanie' : 'Nowe pytanie'}</h2></div><button onClick={() => setQuestionEditorOpen(false)} className="rounded-lg border border-white/10 p-2 text-[#e5e4e2]/55"><X className="h-5 w-5" /></button></header><div className="space-y-5 p-6"><div className="grid gap-4 md:grid-cols-3"><label className="text-sm text-[#e5e4e2]/65">Wydarzenie<select value={questionDraft.event_id} onChange={(event) => setQuestionDraft((current) => ({ ...current, event_id: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#111522] px-4 py-3 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"><option value="">Globalne — dostępne dla wszystkich</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}{event.event_date ? ` · ${new Date(event.event_date).toLocaleDateString('pl-PL')}` : ''}</option>)}</select></label><label className="text-sm text-[#e5e4e2]/65">Kategoria<input value={questionDraft.category} onChange={(event) => setQuestionDraft((current) => ({ ...current, category: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#111522] px-4 py-3 text-[#e5e4e2] outline-none focus:border-[#d3bb73]" /></label><label className="text-sm text-[#e5e4e2]/65">Tagi, oddzielone przecinkami<input value={questionDraft.tags} onChange={(event) => setQuestionDraft((current) => ({ ...current, tags: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#111522] px-4 py-3 text-[#e5e4e2] outline-none focus:border-[#d3bb73]" /></label></div><label className="block text-sm text-[#e5e4e2]/65">Treść pytania<textarea value={questionDraft.question} onChange={(event) => setQuestionDraft((current) => ({ ...current, question: event.target.value }))} rows={3} className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-[#111522] px-4 py-3 text-[#e5e4e2] outline-none focus:border-[#d3bb73]" /></label><div><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold">Odpowiedzi i punkty</h3><p className="text-xs text-[#e5e4e2]/40">Od 3 do 6 odpowiedzi, suma nie większa niż 100.</p></div><button data-crm-action="secondary" onClick={distributePoints} className="rounded-lg border border-[#d3bb73]/25 px-3 py-2 text-xs font-semibold text-[#d3bb73]">Rozłóż 100 pkt</button></div><div className="space-y-2">{questionDraft.answers.map((answer, index) => <div key={index} className="grid grid-cols-[auto_1fr_90px_auto] items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#d3bb73]/10 text-sm font-bold text-[#d3bb73]">{index + 1}</span><input value={answer.text} onChange={(event) => setQuestionDraft((current) => ({ ...current, answers: current.answers.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) }))} placeholder="Odpowiedź" className="rounded-lg border border-white/10 bg-[#111522] px-3 py-2.5 outline-none focus:border-[#d3bb73]" /><input type="number" min={0} max={100} value={answer.points} onChange={(event) => setQuestionDraft((current) => ({ ...current, answers: current.answers.map((item, itemIndex) => itemIndex === index ? { ...item, points: Number(event.target.value) } : item) }))} className="rounded-lg border border-white/10 bg-[#111522] px-3 py-2.5 text-center outline-none focus:border-[#d3bb73]" /><button disabled={questionDraft.answers.length <= 3} onClick={() => setQuestionDraft((current) => ({ ...current, answers: current.answers.filter((_item, itemIndex) => itemIndex !== index) }))} className="rounded-lg p-2 text-red-300/60 disabled:opacity-20"><Trash2 className="h-4 w-4" /></button></div>)}</div>{questionDraft.answers.length < 6 && <button onClick={() => setQuestionDraft((current) => ({ ...current, answers: [...current.answers, { text: '', points: 0 }] }))} className="mt-3 flex items-center gap-2 text-xs font-semibold text-[#d3bb73]"><Plus className="h-4 w-4" /> Dodaj odpowiedź</button>}<div className="mt-4 flex items-center justify-end gap-3"><span className={`mr-auto text-sm ${questionDraft.answers.reduce((sum, answer) => sum + (Number(answer.points) || 0), 0) > 100 ? 'text-red-300' : 'text-[#e5e4e2]/45'}`}>Suma: <strong>{questionDraft.answers.reduce((sum, answer) => sum + (Number(answer.points) || 0), 0)} / 100</strong></span><button onClick={() => setQuestionEditorOpen(false)} className="rounded-xl border border-white/10 px-5 py-3 text-sm">Anuluj</button><button onClick={() => void saveQuestion()} disabled={savingQuestion} className="rounded-xl bg-[#d3bb73] px-5 py-3 text-sm font-bold text-[#111522] disabled:opacity-50">{savingQuestion ? 'Zapisywanie…' : 'Zapisz pytanie'}</button></div></div></div></div></div>}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="mt-5 flex items-center gap-3 rounded-xl border border-white/10 bg-[#111522] px-4 py-3"><Search className="h-4 w-4 text-[#e5e4e2]/35" /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full bg-transparent text-sm outline-none placeholder:text-[#e5e4e2]/25" /></label>;
}

function SectionHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#d3bb73]">{eyebrow}</p><h2 className="mt-1 text-2xl font-semibold">{title}</h2><p className="mt-1 text-sm text-[#e5e4e2]/45">{description}</p></div><div>{actions}</div></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-[#e5e4e2]/35">{text}</div>;
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return <div className="flex items-center justify-between rounded-xl border border-white/5 bg-[#111522] px-4 py-3"><span className="flex items-center gap-2 text-sm"><span className={`rounded-full p-1 ${ok ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>{ok ? <Check className="h-3.5 w-3.5" /> : <Database className="h-3.5 w-3.5" />}</span>{label}</span><strong className="text-sm">{value}</strong></div>;
}
