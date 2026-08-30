'use client';

import { type ChangeEvent, type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  Cloud,
  Download,
  Edit3,
  Gamepad2,
  Image as ImageIcon,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';

type QuizCategory = {
  id: string;
  local_id: string;
  name: string;
  description: string;
  question_count: number;
  slide_count: number;
  question_types: string[];
  has_media: boolean;
  source_instance_id: string;
  local_updated_at: string | null;
  updated_at: string;
};
type GameCategory = { id?: string; category_id: string; sort_order: number };
type QuizGame = {
  id: string;
  local_id: string | null;
  event_id: string | null;
  name: string;
  description: string;
  source: 'crm' | 'desktop' | 'import';
  updated_at: string;
  categories: GameCategory[];
};
type Participant = {
  id?: string;
  first_name: string;
  last_name: string;
  nickname: string;
  email: string;
  team: string;
  pilot_id: number | null;
  sort_order: number;
};
type Roster = {
  id: string;
  event_id: string;
  name: string;
  description: string;
  updated_at: string;
  participants: Participant[];
};
type QuizEvent = { event_id: string; event_name: string; event_date: string | null; event_status: string | null };
type EventSetup = { id: string; event_id: string; game_id: string | null; roster_id: string | null; anonymous_mode: boolean };
type GameDraft = { id: string; event_id: string; name: string; description: string; categoryIds: string[] };
type RosterDraft = { id: string; event_id: string; name: string; description: string; participants: Participant[] };

const blankParticipant = (sortOrder: number): Participant => ({
  first_name: '', last_name: '', nickname: '', email: '', team: '', pilot_id: null, sort_order: sortOrder,
});
const emptyGame = (): GameDraft => ({ id: '', event_id: '', name: '', description: '', categoryIds: [] });
const emptyRoster = (eventId = ''): RosterDraft => ({ id: '', event_id: eventId, name: '', description: '', participants: [blankParticipant(0)] });
const eventDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('pl-PL') : 'bez daty';

export default function MavinciQuizShowPanel({ canManage }: { canManage: boolean }) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [events, setEvents] = useState<QuizEvent[]>([]);
  const [categories, setCategories] = useState<QuizCategory[]>([]);
  const [games, setGames] = useState<QuizGame[]>([]);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [setups, setSetups] = useState<EventSetup[]>([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [setupGameId, setSetupGameId] = useState('');
  const [setupRosterId, setSetupRosterId] = useState('');
  const [anonymousMode, setAnonymousMode] = useState(false);
  const [savingSetup, setSavingSetup] = useState(false);
  const [gameDraft, setGameDraft] = useState<GameDraft | null>(null);
  const [rosterDraft, setRosterDraft] = useState<RosterDraft | null>(null);
  const [savingEditor, setSavingEditor] = useState(false);

  const loadData = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    const [eventResult, categoryResult, gameResult, rosterResult, setupResult] = await Promise.all([
      supabase.rpc('mavinci_quiz_show_events'),
      supabase.from('mavinci_quiz_show_categories').select('*').eq('is_active', true).order('name'),
      supabase.from('mavinci_quiz_show_games').select('*,categories:mavinci_quiz_show_game_categories(id,category_id,sort_order)').eq('is_active', true).order('updated_at', { ascending: false }),
      supabase.from('mavinci_quiz_show_rosters').select('*,participants:mavinci_quiz_show_participants(*)').eq('is_active', true).order('updated_at', { ascending: false }),
      supabase.from('mavinci_quiz_show_event_setups').select('*'),
    ]);
    const firstError = [eventResult.error, categoryResult.error, gameResult.error, rosterResult.error, setupResult.error].find(Boolean);
    if (firstError) showSnackbar(`Nie udało się pobrać katalogu Quiz Show: ${firstError.message}`, 'error');
    const nextEvents = (eventResult.data || []) as QuizEvent[];
    setEvents(nextEvents);
    setCategories((categoryResult.data || []) as QuizCategory[]);
    setGames(((gameResult.data || []) as unknown as QuizGame[]).map((game) => ({
      ...game, categories: [...(game.categories || [])].sort((a, b) => a.sort_order - b.sort_order),
    })));
    setRosters(((rosterResult.data || []) as unknown as Roster[]).map((roster) => ({
      ...roster, participants: [...(roster.participants || [])].sort((a, b) => a.sort_order - b.sort_order),
    })));
    setSetups((setupResult.data || []) as EventSetup[]);
    setSelectedEventId((current) => current || nextEvents[0]?.event_id || '');
    setLoading(false);
    setRefreshing(false);
  }, [showSnackbar]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => {
    const setup = setups.find((item) => item.event_id === selectedEventId);
    setSetupGameId(setup?.game_id || '');
    setSetupRosterId(setup?.roster_id || '');
    setAnonymousMode(setup?.anonymous_mode || false);
  }, [selectedEventId, setups]);

  const selectedEvent = events.find((event) => event.event_id === selectedEventId);
  const availableGames = games.filter((game) => !game.event_id || game.event_id === selectedEventId);
  const availableRosters = rosters.filter((roster) => roster.event_id === selectedEventId);
  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const eventMap = useMemo(() => new Map(events.map((event) => [event.event_id, event])), [events]);
  const term = search.trim().toLocaleLowerCase('pl-PL');
  const filteredCategories = categories.filter((category) => !term || `${category.name} ${category.description} ${category.question_types.join(' ')}`.toLocaleLowerCase('pl-PL').includes(term));
  const filteredGames = games.filter((game) => !term || `${game.name} ${game.description}`.toLocaleLowerCase('pl-PL').includes(term));

  const saveSetup = async () => {
    if (!selectedEventId) return showSnackbar('Wybierz wydarzenie z ofertą Quiz Show.', 'warning');
    if (!setupGameId) return showSnackbar('Wybierz grę dla wydarzenia.', 'warning');
    if (!anonymousMode && !setupRosterId) return showSnackbar('Wybierz listę uczestników albo włącz tryb anonimowy.', 'warning');
    setSavingSetup(true);
    const { error } = await supabase.from('mavinci_quiz_show_event_setups').upsert({
      event_id: selectedEventId,
      game_id: setupGameId,
      roster_id: anonymousMode ? null : setupRosterId || null,
      anonymous_mode: anonymousMode,
    }, { onConflict: 'event_id' });
    setSavingSetup(false);
    if (error) return showSnackbar(error.message, 'error');
    showSnackbar('Realizacja Quiz Show została przygotowana dla wydarzenia.', 'success');
    await loadData(true);
  };

  const saveGame = async () => {
    if (!gameDraft) return;
    if (gameDraft.name.trim().length < 2 || !gameDraft.categoryIds.length) return showSnackbar('Podaj nazwę i wybierz przynajmniej jedną kategorię.', 'warning');
    setSavingEditor(true);
    const { error } = await supabase.rpc('mavinci_save_quiz_show_game', { p_game: {
      id: gameDraft.id || null,
      event_id: gameDraft.event_id || null,
      name: gameDraft.name.trim(),
      description: gameDraft.description.trim(),
      categories: gameDraft.categoryIds.map((categoryId) => ({ category_id: categoryId })),
    } });
    setSavingEditor(false);
    if (error) return showSnackbar(error.message, 'error');
    setGameDraft(null);
    showSnackbar('Gra Quiz Show zapisana. Treść kategorii nadal pozostaje lokalna.', 'success');
    await loadData(true);
  };

  const saveRoster = async () => {
    if (!rosterDraft) return;
    const participants = rosterDraft.participants.filter((participant) => participant.first_name.trim()).map((participant, index) => ({ ...participant, sort_order: index }));
    const pilots = participants.map((participant) => participant.pilot_id).filter((pilot): pilot is number => pilot !== null);
    if (!rosterDraft.event_id || rosterDraft.name.trim().length < 2) return showSnackbar('Wybierz wydarzenie i podaj nazwę listy.', 'warning');
    if (new Set(pilots).size !== pilots.length) return showSnackbar('Każdy pilot może być przypisany tylko do jednej osoby.', 'warning');
    setSavingEditor(true);
    const { error } = await supabase.rpc('mavinci_save_quiz_show_roster', { p_roster: {
      id: rosterDraft.id || null,
      event_id: rosterDraft.event_id,
      name: rosterDraft.name.trim(),
      description: rosterDraft.description.trim(),
      participants,
    } });
    setSavingEditor(false);
    if (error) return showSnackbar(error.message, 'error');
    setRosterDraft(null);
    showSnackbar('Uczestnicy i przypisania pilotów zostały zapisane.', 'success');
    await loadData(true);
  };

  const removeGame = async (game: QuizGame) => {
    if (!await showConfirm(`Usunąć grę „${game.name}” z katalogu CRM?`, 'Usuń')) return;
    const { error } = await supabase.from('mavinci_quiz_show_games').update({ is_active: false }).eq('id', game.id);
    if (error) showSnackbar(error.message, 'error'); else { showSnackbar('Gra usunięta z katalogu.', 'success'); await loadData(true); }
  };
  const removeRoster = async (roster: Roster) => {
    if (!await showConfirm(`Usunąć listę „${roster.name}”?`, 'Usuń')) return;
    const { error } = await supabase.from('mavinci_quiz_show_rosters').update({ is_active: false }).eq('id', roster.id);
    if (error) showSnackbar(error.message, 'error'); else { showSnackbar('Lista uczestników usunięta.', 'success'); await loadData(true); }
  };

  const editGame = (game: QuizGame) => setGameDraft({
    id: game.id, event_id: game.event_id || '', name: game.name, description: game.description,
    categoryIds: game.categories.map((item) => item.category_id),
  });
  const editRoster = (roster: Roster) => setRosterDraft({
    id: roster.id, event_id: roster.event_id, name: roster.name, description: roster.description,
    participants: roster.participants.length ? roster.participants.map((participant) => ({ ...participant })) : [blankParticipant(0)],
  });

  const importParticipants = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !rosterDraft) return;
    try {
      const text = (await file.text()).replace(/^\uFEFF/, '');
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      if (!lines.length) throw new Error('Plik jest pusty.');
      const delimiter = lines[0].includes(';') ? ';' : ',';
      const headers = lines[0].split(delimiter).map((value) => value.trim().toLocaleLowerCase('pl-PL'));
      const valueAt = (row: string[], names: string[]) => {
        const index = headers.findIndex((header) => names.includes(header));
        return index >= 0 ? (row[index] || '').trim() : '';
      };
      const participants = lines.slice(1).map((line, index) => {
        const row = line.split(delimiter);
        const pilot = Number(valueAt(row, ['pilot', 'pilot id', 'pilot_id', 'nr pilota']));
        return {
          first_name: valueAt(row, ['imię', 'imie', 'first_name']),
          last_name: valueAt(row, ['nazwisko', 'last_name']),
          nickname: valueAt(row, ['pseudonim', 'nickname', 'nick']),
          email: valueAt(row, ['email', 'e-mail']),
          team: valueAt(row, ['drużyna', 'druzyna', 'team']),
          pilot_id: Number.isInteger(pilot) && pilot > 0 ? pilot : null,
          sort_order: index,
        };
      }).filter((participant) => participant.first_name);
      if (!participants.length) throw new Error('Nie znaleziono kolumny „Imię” ani uczestników.');
      setRosterDraft((current) => current ? ({ ...current, participants }) : current);
      showSnackbar(`Wczytano ${participants.length} uczestników. Zapisz listę, aby zatwierdzić import.`, 'success');
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Nie udało się odczytać pliku.', 'error');
    }
  };

  const exportRoster = (roster: Roster) => {
    const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = ['Imię;Nazwisko;Pseudonim;Email;Drużyna;Pilot ID', ...roster.participants.map((participant) => [
      participant.first_name, participant.last_name, participant.nickname, participant.email, participant.team, participant.pilot_id ?? '',
    ].map(quote).join(';'))].join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${roster.name.replace(/[^a-z0-9-_]+/gi, '-') || 'uczestnicy'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="flex min-h-72 items-center justify-center text-[#d3bb73]"><RefreshCw className="mr-3 h-5 w-5 animate-spin" /> Wczytuję katalog Quiz Show…</div>;

  return <div className="space-y-5">
    <section className="overflow-hidden rounded-2xl border border-cyan-300/15 bg-gradient-to-br from-[#17243a] via-[#171b2b] to-[#111522] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[.18em] text-cyan-300">Quiz Show · CRM</p><h2 className="mt-1 text-2xl font-semibold">Plan gry bez kopiowania pytań do chmury</h2><p className="mt-1 max-w-4xl text-sm text-[#e5e4e2]/48">CRM zna nazwy kategorii, liczbę pytań i kolejność gry. Pytania, odpowiedzi, slajdy oraz multimedia pozostają wyłącznie w lokalnym Mavinci LIVE.</p></div>
        <button onClick={() => void loadData(true)} disabled={refreshing} className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold hover:border-cyan-300/30 hover:text-cyan-200 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Odśwież katalog</button>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <Metric icon={ListChecks} label="Kategorie lokalne" value={categories.length} />
        <Metric icon={Gamepad2} label="Gotowe gry" value={games.length} />
        <Metric icon={Users} label="Listy uczestników" value={rosters.length} />
        <Metric icon={CalendarDays} label="Realizacje z Quiz Show" value={events.length} />
      </div>
    </section>

    <section className="rounded-2xl border border-[#d3bb73]/20 bg-[#171b2b] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#d3bb73]">Przygotowanie wydarzenia</p><h2 className="mt-1 text-xl font-semibold">Gra i uczestnicy gotowi przed realizacją</h2><p className="mt-1 text-sm text-[#e5e4e2]/45">Lista zawiera tylko wydarzenia, których oferta obejmuje Quiz Show.</p></div>{selectedEvent && <span className="rounded-full bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-300"><CheckCircle2 className="mr-1.5 inline h-4 w-4" />{selectedEvent.event_name} · {eventDate(selectedEvent.event_date)}</span>}</div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-end">
        <Field label="Wydarzenie"><select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)}><option value="">Wybierz realizację…</option>{events.map((event) => <option key={event.event_id} value={event.event_id}>{event.event_name} · {eventDate(event.event_date)}</option>)}</select></Field>
        <Field label="Gra"><select value={setupGameId} onChange={(event) => setSetupGameId(event.target.value)}><option value="">Wybierz grę…</option>{availableGames.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}</select></Field>
        <Field label="Uczestnicy"><select value={setupRosterId} onChange={(event) => setSetupRosterId(event.target.value)} disabled={anonymousMode}><option value="">Wybierz listę…</option>{availableRosters.map((roster) => <option key={roster.id} value={roster.id}>{roster.name} · {roster.participants.length} os.</option>)}</select></Field>
        <button onClick={() => void saveSetup()} disabled={!canManage || savingSetup} className="rounded-xl bg-[#d3bb73] px-5 py-3 text-sm font-bold text-[#111522] disabled:opacity-40">{savingSetup ? 'Zapisywanie…' : 'Zapisz realizację'}</button>
      </div>
      <label className="mt-4 inline-flex items-center gap-3 rounded-xl border border-white/8 bg-[#111522] px-4 py-3 text-sm"><input type="checkbox" checked={anonymousMode} onChange={(event) => setAnonymousMode(event.target.checked)} className="h-4 w-4 accent-[#d3bb73]" /><span><strong>Tryb anonimowy</strong><small className="ml-2 text-[#e5e4e2]/40">bez osobistego przypisania pilotów</small></span></label>
    </section>

    <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <section className="rounded-2xl border border-white/10 bg-[#171b2b] p-5">
        <PanelTitle eyebrow="Kompozytor" title="Gry z kategorii" description="Układaj kolejność kategorii bez dostępu do treści pytań." action={canManage && <button onClick={() => setGameDraft({ ...emptyGame(), event_id: selectedEventId })} className="flex items-center gap-2 rounded-xl bg-[#d3bb73] px-4 py-3 text-sm font-bold text-[#111522]"><Plus className="h-4 w-4" /> Nowa gra</button>} />
        <SearchInput value={search} onChange={setSearch} />
        <div className="mt-4 space-y-3">{filteredGames.map((game) => <article key={game.id} className="rounded-xl border border-white/8 bg-[#111522] p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap gap-2"><Badge>{game.source === 'desktop' ? 'Z Mavinci LIVE' : 'Ułożona w CRM'}</Badge>{game.event_id && <Badge>{eventMap.get(game.event_id)?.event_name || 'Wydarzenie'}</Badge>}</div><h3 className="mt-3 font-semibold">{game.name}</h3><p className="mt-1 text-sm text-[#e5e4e2]/40">{game.description || 'Bez opisu'}</p></div>{canManage && <div className="flex gap-2"><IconButton title="Edytuj" onClick={() => editGame(game)}><Edit3 /></IconButton><IconButton title="Usuń" danger onClick={() => void removeGame(game)}><Trash2 /></IconButton></div>}</div><div className="mt-4 flex flex-wrap gap-2">{game.categories.map((link, index) => <span key={link.category_id} className="rounded-lg border border-cyan-300/10 bg-cyan-300/[.04] px-3 py-2 text-xs"><b className="mr-2 text-cyan-300">{index + 1}</b>{categoryMap.get(link.category_id)?.name || 'Kategoria niedostępna'}</span>)}</div></article>)}{!filteredGames.length && <Empty text="Brak gier w katalogu. Najpierw zsynchronizuj Mavinci LIVE albo utwórz kompozycję w CRM." />}</div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#171b2b] p-5">
        <PanelTitle eyebrow="Piloci QRF" title="Uczestnicy wydarzenia" description="Jedna osoba, jeden pilot — gotowe do użycia w Quiz Show i Wedding Show." action={canManage && <button disabled={!selectedEventId} onClick={() => setRosterDraft(emptyRoster(selectedEventId))} className="flex items-center gap-2 rounded-xl bg-[#d3bb73] px-4 py-3 text-sm font-bold text-[#111522] disabled:opacity-40"><Plus className="h-4 w-4" /> Nowa lista</button>} />
        <div className="mt-5 space-y-3">{availableRosters.map((roster) => <article key={roster.id} className="rounded-xl border border-white/8 bg-[#111522] p-4"><div className="flex items-start justify-between gap-3"><div><Badge>{roster.participants.length} uczestników</Badge><h3 className="mt-3 font-semibold">{roster.name}</h3><p className="mt-1 text-xs text-[#e5e4e2]/40">{roster.participants.filter((person) => person.pilot_id).length} przypisanych pilotów</p></div><div className="flex gap-2"><IconButton title="Eksportuj CSV" onClick={() => exportRoster(roster)}><Download /></IconButton>{canManage && <><IconButton title="Edytuj" onClick={() => editRoster(roster)}><Edit3 /></IconButton><IconButton title="Usuń" danger onClick={() => void removeRoster(roster)}><Trash2 /></IconButton></>}</div></div><div className="mt-3 flex flex-wrap gap-1.5">{roster.participants.slice(0, 10).map((person) => <span key={person.id || `${person.first_name}-${person.sort_order}`} className="rounded-full bg-white/5 px-2.5 py-1 text-[11px]">{person.nickname || `${person.first_name} ${person.last_name}`.trim()} {person.pilot_id ? <b className="text-[#d3bb73]">#{person.pilot_id}</b> : <i className="text-red-300/70">bez pilota</i>}</span>)}{roster.participants.length > 10 && <span className="px-2 py-1 text-[11px] text-[#e5e4e2]/35">+{roster.participants.length - 10}</span>}</div></article>)}{!selectedEventId ? <Empty text="Wybierz wydarzenie, aby zobaczyć jego uczestników." /> : !availableRosters.length && <Empty text="Brak listy uczestników dla tego wydarzenia." />}</div>
      </section>
    </div>

    <section className="rounded-2xl border border-white/10 bg-[#171b2b] p-5">
      <PanelTitle eyebrow="Podgląd katalogu" title="Kategorie dostępne lokalnie" description="CRM pokazuje tylko opis i statystyki. Nie przechowuje pytań, odpowiedzi, slajdów ani plików." />
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredCategories.map((category) => <article key={category.id} className="rounded-xl border border-white/8 bg-[#111522] p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{category.name}</h3><p className="mt-1 line-clamp-2 text-sm text-[#e5e4e2]/40">{category.description || 'Bez opisu'}</p></div>{category.has_media && <ImageIcon className="h-5 w-5 text-cyan-300" />}</div><div className="mt-4 grid grid-cols-2 gap-2"><Stat label="Pytania" value={category.question_count} /><Stat label="Slajdy" value={category.slide_count} /></div><div className="mt-3 flex flex-wrap gap-1.5">{category.question_types.map((type) => <Badge key={type}>{type}</Badge>)}</div><footer className="mt-4 border-t border-white/5 pt-3 text-[10px] text-[#e5e4e2]/30">ID lokalne: {category.local_id}</footer></article>)}{!filteredCategories.length && <div className="md:col-span-2 xl:col-span-3"><Empty text="Brak zsynchronizowanych metadanych kategorii." /></div>}</div>
    </section>

    {gameDraft && <Modal eyebrow="Quiz Show" title={gameDraft.id ? 'Edytuj grę' : 'Nowa gra z kategorii'} onClose={() => setGameDraft(null)}>
      <div className="grid gap-4 md:grid-cols-2"><Field label="Nazwa gry"><input value={gameDraft.name} onChange={(event) => setGameDraft((current) => current && ({ ...current, name: event.target.value }))} placeholder="np. Quiz weselny" /></Field><Field label="Dostępność"><select value={gameDraft.event_id} onChange={(event) => setGameDraft((current) => current && ({ ...current, event_id: event.target.value }))}><option value="">Gra globalna</option>{events.map((event) => <option key={event.event_id} value={event.event_id}>{event.event_name} · {eventDate(event.event_date)}</option>)}</select></Field></div>
      <Field label="Opis"><textarea rows={2} value={gameDraft.description} onChange={(event) => setGameDraft((current) => current && ({ ...current, description: event.target.value }))} /></Field>
      <div><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold">Kolejność kategorii</h3><p className="text-xs text-[#e5e4e2]/40">Zawartość kategorii zostanie pobrana lokalnie podczas realizacji.</p></div><button onClick={() => { const category = categories.find((item) => !gameDraft.categoryIds.includes(item.id)); if (category) setGameDraft((current) => current && ({ ...current, categoryIds: [...current.categoryIds, category.id] })); }} className="flex items-center gap-2 rounded-xl border border-[#d3bb73]/25 px-4 py-2.5 text-sm font-semibold text-[#d3bb73]"><Plus className="h-4 w-4" /> Dodaj</button></div><div className="space-y-2">{gameDraft.categoryIds.map((categoryId, index) => <div key={`${categoryId}-${index}`} className="grid grid-cols-[40px_1fr_auto] items-center gap-2 rounded-xl border border-white/8 bg-[#111522] p-2"><span className="text-center text-sm font-bold text-[#d3bb73]">{index + 1}</span><select value={categoryId} onChange={(event) => setGameDraft((current) => current && ({ ...current, categoryIds: current.categoryIds.map((id, itemIndex) => itemIndex === index ? event.target.value : id) }))}>{categories.map((category) => <option key={category.id} value={category.id} disabled={gameDraft.categoryIds.some((id, itemIndex) => itemIndex !== index && id === category.id)}>{category.name} · {category.question_count} pytań</option>)}</select><div className="flex"><button disabled={index === 0} onClick={() => setGameDraft((current) => current && ({ ...current, categoryIds: move(current.categoryIds, index, index - 1) }))}><ArrowUp className="h-4 w-4" /></button><button disabled={index === gameDraft.categoryIds.length - 1} onClick={() => setGameDraft((current) => current && ({ ...current, categoryIds: move(current.categoryIds, index, index + 1) }))}><ArrowDown className="h-4 w-4" /></button><button onClick={() => setGameDraft((current) => current && ({ ...current, categoryIds: current.categoryIds.filter((_id, itemIndex) => itemIndex !== index) }))}><Trash2 className="h-4 w-4 text-red-300" /></button></div></div>)}{!gameDraft.categoryIds.length && <Empty text="Dodaj przynajmniej jedną kategorię." />}</div></div>
      <ModalActions saving={savingEditor} onCancel={() => setGameDraft(null)} onSave={() => void saveGame()} />
    </Modal>}

    {rosterDraft && <Modal eyebrow="Quiz Show · piloci" title={rosterDraft.id ? 'Edytuj listę uczestników' : 'Nowa lista uczestników'} onClose={() => setRosterDraft(null)} wide>
      <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => void importParticipants(event)} />
      <div className="grid gap-4 md:grid-cols-2"><Field label="Nazwa listy"><input value={rosterDraft.name} onChange={(event) => setRosterDraft((current) => current && ({ ...current, name: event.target.value }))} placeholder="np. Goście weselni" /></Field><Field label="Wydarzenie"><select value={rosterDraft.event_id} onChange={(event) => setRosterDraft((current) => current && ({ ...current, event_id: event.target.value }))}>{events.map((event) => <option key={event.event_id} value={event.event_id}>{event.event_name} · {eventDate(event.event_date)}</option>)}</select></Field></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Osoby i piloty</h3><p className="text-xs text-[#e5e4e2]/40">CSV: Imię, Nazwisko, Pseudonim, Email, Drużyna, Pilot ID.</p></div><div className="flex gap-2"><button onClick={() => csvInputRef.current?.click()} className="flex items-center gap-2 rounded-xl border border-[#d3bb73]/25 px-4 py-2.5 text-sm font-semibold text-[#d3bb73]"><Upload className="h-4 w-4" /> Import CSV</button><button onClick={() => setRosterDraft((current) => current && ({ ...current, participants: [...current.participants, blankParticipant(current.participants.length)] }))} className="flex items-center gap-2 rounded-xl bg-[#d3bb73] px-4 py-2.5 text-sm font-bold text-[#111522]"><Plus className="h-4 w-4" /> Dodaj osobę</button></div></div>
      <div className="overflow-x-auto rounded-xl border border-white/8"><div className="min-w-[930px]"><div className="grid grid-cols-[44px_1fr_1fr_1fr_1fr_110px_44px] gap-2 bg-white/[.035] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#e5e4e2]/35"><span>#</span><span>Imię i nazwisko</span><span>Pseudonim</span><span>E-mail</span><span>Drużyna</span><span>Pilot</span><span /></div>{rosterDraft.participants.map((person, index) => <div key={person.id || index} className="grid grid-cols-[44px_1fr_1fr_1fr_1fr_110px_44px] items-center gap-2 border-t border-white/5 px-3 py-2"><span className="text-center text-xs text-[#e5e4e2]/35">{index + 1}</span><div className="grid grid-cols-2 gap-2"><input value={person.first_name} onChange={(event) => updateParticipant(setRosterDraft, index, 'first_name', event.target.value)} placeholder="Imię" /><input value={person.last_name} onChange={(event) => updateParticipant(setRosterDraft, index, 'last_name', event.target.value)} placeholder="Nazwisko" /></div><input value={person.nickname} onChange={(event) => updateParticipant(setRosterDraft, index, 'nickname', event.target.value)} placeholder="Nick" /><input value={person.email} onChange={(event) => updateParticipant(setRosterDraft, index, 'email', event.target.value)} placeholder="adres@email.pl" /><input value={person.team} onChange={(event) => updateParticipant(setRosterDraft, index, 'team', event.target.value)} placeholder="Drużyna" /><input type="number" min={1} max={624} value={person.pilot_id ?? ''} onChange={(event) => updateParticipant(setRosterDraft, index, 'pilot_id', event.target.value ? Number(event.target.value) : null)} placeholder="—" /><button onClick={() => setRosterDraft((current) => current && ({ ...current, participants: current.participants.filter((_item, itemIndex) => itemIndex !== index) }))}><Trash2 className="h-4 w-4 text-red-300/70" /></button></div>)}</div></div>
      <ModalActions saving={savingEditor} onCancel={() => setRosterDraft(null)} onSave={() => void saveRoster()} />
    </Modal>}
  </div>;
}

function updateParticipant(setDraft: Dispatch<SetStateAction<RosterDraft | null>>, index: number, key: keyof Participant, value: string | number | null) {
  setDraft((current) => current && ({ ...current, participants: current.participants.map((person, itemIndex) => itemIndex === index ? { ...person, [key]: value } : person) }));
}
function move<T>(items: T[], from: number, to: number) { const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; }
function Metric({ icon: Icon, label, value }: { icon: typeof Cloud; label: string; value: number }) { return <div className="rounded-xl border border-white/8 bg-black/10 p-4"><Icon className="h-5 w-5 text-cyan-300" /><strong className="mt-3 block text-2xl">{value}</strong><span className="text-xs text-[#e5e4e2]/40">{label}</span></div>; }
function PanelTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) { return <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#d3bb73]">{eyebrow}</p><h2 className="mt-1 text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-[#e5e4e2]/45">{description}</p></div>{action}</div>; }
function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <label className="mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-[#111522] px-4 py-3"><Search className="h-4 w-4 text-[#e5e4e2]/35" /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Szukaj gry lub kategorii…" className="w-full bg-transparent text-sm outline-none" /></label>; }
function Badge({ children }: { children: ReactNode }) { return <span className="rounded-full bg-cyan-300/[.08] px-2.5 py-1 text-[10px] font-semibold text-cyan-200">{children}</span>; }
function Stat({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-white/[.03] px-3 py-2"><strong className="block text-lg">{value}</strong><span className="text-[10px] text-[#e5e4e2]/35">{label}</span></div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-white/10 p-7 text-center text-sm text-[#e5e4e2]/35">{text}</div>; }
function IconButton({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: ReactNode }) { return <button type="button" title={title} onClick={onClick} className={`rounded-lg border p-2 [&_svg]:h-4 [&_svg]:w-4 ${danger ? 'border-red-400/20 text-red-300/70' : 'border-white/10 text-[#e5e4e2]/55 hover:text-[#d3bb73]'}`}>{children}</button>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-sm text-[#e5e4e2]/58 [&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-white/10 [&_input]:bg-[#111522] [&_input]:px-4 [&_input]:py-3 [&_input]:text-[#e5e4e2] [&_input]:outline-none [&_select]:w-full [&_select]:rounded-xl [&_select]:border [&_select]:border-white/10 [&_select]:bg-[#111522] [&_select]:px-4 [&_select]:py-3 [&_select]:text-[#e5e4e2] [&_select]:outline-none [&_textarea]:w-full [&_textarea]:rounded-xl [&_textarea]:border [&_textarea]:border-white/10 [&_textarea]:bg-[#111522] [&_textarea]:px-4 [&_textarea]:py-3 [&_textarea]:text-[#e5e4e2] [&_textarea]:outline-none"><span className="mb-2 block">{label}</span>{children}</label>; }
function Modal({ eyebrow, title, onClose, wide, children }: { eyebrow: string; title: string; onClose: () => void; wide?: boolean; children: ReactNode }) { return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={`max-h-[92vh] w-full overflow-y-auto rounded-2xl border border-[#d3bb73]/25 bg-[#171b2b] shadow-2xl ${wide ? 'max-w-7xl' : 'max-w-4xl'}`}><header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#171b2b]/95 px-6 py-5 backdrop-blur"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#d3bb73]">{eyebrow}</p><h2 className="mt-1 text-xl font-semibold">{title}</h2></div><button onClick={onClose} className="rounded-lg border border-white/10 p-2 text-[#e5e4e2]/55"><X className="h-5 w-5" /></button></header><div className="space-y-5 p-6 [&_input]:rounded-lg [&_input]:border [&_input]:border-white/10 [&_input]:bg-[#111522] [&_input]:px-3 [&_input]:py-2.5 [&_input]:text-[#e5e4e2] [&_input]:outline-none [&_select]:rounded-lg [&_select]:border [&_select]:border-white/10 [&_select]:bg-[#111522] [&_select]:px-3 [&_select]:py-2.5 [&_select]:text-[#e5e4e2] [&_select]:outline-none">{children}</div></div></div>; }
function ModalActions({ saving, onCancel, onSave }: { saving: boolean; onCancel: () => void; onSave: () => void }) { return <footer className="flex justify-end gap-3 border-t border-white/10 pt-5"><button onClick={onCancel} className="rounded-xl border border-white/10 px-5 py-3 text-sm">Anuluj</button><button onClick={onSave} disabled={saving} className="rounded-xl bg-[#d3bb73] px-5 py-3 text-sm font-bold text-[#111522] disabled:opacity-50">{saving ? 'Zapisywanie…' : 'Zapisz'}</button></footer>; }
