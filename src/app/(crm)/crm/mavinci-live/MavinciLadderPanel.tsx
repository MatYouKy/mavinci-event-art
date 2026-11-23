'use client';

import { type ChangeEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Edit3, FileSpreadsheet, Layers, Plus, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';

/**
 * Baza pytań Drabinki (format „Milionerzy”): pytania ABCD na trzech poziomach.
 * Mavinci LIVE układa drabinkę od łatwych (pierwsza ⅓ stawek) przez średnie do trudnych.
 */

type Difficulty = 'easy' | 'medium' | 'hard';
type LadderQuestion = {
  id: string;
  event_id: string | null;
  difficulty: Difficulty;
  category: string;
  question: string;
  answers: string[];
  correct: number;
  host_note: string;
  tags: string[];
  source: 'crm' | 'desktop' | 'import';
  updated_at: string;
};
type QuizEvent = { event_id: string; event_name: string; event_date: string | null };
type Draft = {
  id: string;
  event_id: string;
  difficulty: Difficulty;
  category: string;
  question: string;
  answers: [string, string, string, string];
  correct: number;
  host_note: string;
  tags: string;
};

const LEVELS: Array<{ id: Difficulty; label: string; short: string; tone: string }> = [
  { id: 'easy', label: 'Łatwe', short: 'Łatwe', tone: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' },
  { id: 'medium', label: 'Średnie', short: 'Średnie', tone: 'border-amber-300/30 bg-amber-300/10 text-amber-200' },
  { id: 'hard', label: 'Trudne', short: 'Trudne', tone: 'border-rose-400/30 bg-rose-400/10 text-rose-200' },
];
const LEVEL = Object.fromEntries(LEVELS.map((level) => [level.id, level])) as Record<Difficulty, (typeof LEVELS)[number]>;
const LETTERS = ['A', 'B', 'C', 'D'];

const emptyDraft = (difficulty: Difficulty = 'easy'): Draft => ({
  id: '', event_id: '', difficulty, category: 'Ogólne', question: '', answers: ['', '', '', ''], correct: 0, host_note: '', tags: '',
});

/** Poziom z CSV: łatwe/średnie/trudne, easy/medium/hard albo 1/2/3. */
const parseLevel = (value: string): Difficulty | null => {
  const text = value.trim().toLocaleLowerCase('pl-PL');
  if (['easy', 'łatwe', 'latwe', 'łatwy', 'latwy', '1'].includes(text)) return 'easy';
  if (['medium', 'średnie', 'srednie', 'średni', 'sredni', '2'].includes(text)) return 'medium';
  if (['hard', 'trudne', 'trudny', '3'].includes(text)) return 'hard';
  return null;
};

const splitCsvLine = (line: string, delimiter: string) => {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { cells.push(current); current = ''; }
    else current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
};

const CSV_HEADER = 'Poziom;Kategoria;Pytanie;A;B;C;D;Poprawna;Notatka';
const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

export default function MavinciLadderPanel({ canManage }: { canManage: boolean }) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [questions, setQuestions] = useState<LadderQuestion[]>([]);
  const [events, setEvents] = useState<QuizEvent[]>([]);
  const [level, setLevel] = useState<Difficulty | 'all'>('all');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadData = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    const [questionResult, eventResult] = await Promise.all([
      supabase.from('mavinci_ladder_questions').select('*').eq('is_active', true).order('updated_at', { ascending: false }),
      supabase.rpc('mavinci_quiz_show_events'),
    ]);
    if (questionResult.error) showSnackbar(`Nie udało się pobrać bazy Drabinki: ${questionResult.error.message}`, 'error');
    setQuestions(((questionResult.data || []) as LadderQuestion[]).map((item) => ({
      ...item, answers: Array.isArray(item.answers) ? item.answers.map(String) : [],
    })));
    setEvents((eventResult.data || []) as QuizEvent[]);
    setLoading(false);
    setRefreshing(false);
  }, [showSnackbar]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => {
    const channel = supabase.channel('mavinci-ladder-questions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mavinci_ladder_questions' }, () => void loadData(true))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadData]);

  const counts = useMemo(() => ({
    easy: questions.filter((item) => item.difficulty === 'easy').length,
    medium: questions.filter((item) => item.difficulty === 'medium').length,
    hard: questions.filter((item) => item.difficulty === 'hard').length,
  }), [questions]);
  const categories = useMemo(() => [...new Set(questions.map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'pl')), [questions]);
  const eventMap = useMemo(() => new Map(events.map((event) => [event.event_id, event])), [events]);
  const term = search.trim().toLocaleLowerCase('pl-PL');
  const visible = questions
    .filter((item) => level === 'all' || item.difficulty === level)
    .filter((item) => !category || item.category === category)
    .filter((item) => !term || `${item.question} ${item.answers.join(' ')} ${item.category} ${item.tags.join(' ')}`.toLocaleLowerCase('pl-PL').includes(term))
    .sort((a, b) => LEVELS.findIndex((l) => l.id === a.difficulty) - LEVELS.findIndex((l) => l.id === b.difficulty) || a.category.localeCompare(b.category, 'pl'));
  // Drabinka 15 stawek potrzebuje po 5 pytań na poziom (więcej = losowanie i różne gry).
  const ready = Math.min(counts.easy, counts.medium, counts.hard);

  const save = async () => {
    if (!draft) return;
    const answers = draft.answers.map((answer) => answer.trim());
    if (draft.question.trim().length < 2) return showSnackbar('Wpisz treść pytania.', 'warning');
    if (answers.some((answer) => !answer)) return showSnackbar('Uzupełnij wszystkie 4 odpowiedzi.', 'warning');
    if (new Set(answers.map((answer) => answer.toLocaleLowerCase('pl-PL'))).size !== 4) return showSnackbar('Odpowiedzi nie mogą się powtarzać.', 'warning');
    setSaving(true);
    const payload = {
      event_id: draft.event_id || null,
      difficulty: draft.difficulty,
      category: draft.category.trim() || 'Ogólne',
      question: draft.question.trim(),
      answers,
      correct: draft.correct,
      host_note: draft.host_note.trim(),
      tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      is_active: true,
    };
    const { error } = draft.id
      ? await supabase.from('mavinci_ladder_questions').update(payload).eq('id', draft.id)
      : await supabase.from('mavinci_ladder_questions').insert({ ...payload, source: 'crm' });
    setSaving(false);
    if (error) return showSnackbar(error.message, 'error');
    showSnackbar(draft.id ? 'Pytanie zapisane.' : 'Pytanie dodane do bazy Drabinki.', 'success');
    setDraft(null);
    await loadData(true);
  };

  const archive = async (item: LadderQuestion) => {
    if (!await showConfirm(`Usunąć pytanie „${item.question.slice(0, 60)}” z bazy Drabinki?`, 'Usuń')) return;
    const { error } = await supabase.from('mavinci_ladder_questions').update({ is_active: false }).eq('id', item.id);
    if (error) showSnackbar(error.message, 'error');
    else { showSnackbar('Pytanie usunięte z bazy.', 'success'); await loadData(true); }
  };

  const edit = (item: LadderQuestion) => setDraft({
    id: item.id,
    event_id: item.event_id || '',
    difficulty: item.difficulty,
    category: item.category,
    question: item.question,
    answers: [0, 1, 2, 3].map((index) => item.answers[index] || '') as Draft['answers'],
    correct: item.correct,
    host_note: item.host_note,
    tags: item.tags.join(', '),
  });

  const importCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const lines = (await file.text()).replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) throw new Error('Plik nie zawiera pytań.');
      const delimiter = lines[0].includes(';') ? ';' : ',';
      const errors: string[] = [];
      const rows = lines.slice(1).map((line, index) => {
        const [lvl, cat, question, a, b, c, d, correct, note] = splitCsvLine(line, delimiter);
        const difficulty = parseLevel(lvl || '');
        const correctIndex = LETTERS.indexOf((correct || '').trim().toUpperCase());
        const answers = [a, b, c, d].map((value) => (value || '').trim());
        if (!difficulty || !question || answers.some((value) => !value) || correctIndex < 0) {
          errors.push(`wiersz ${index + 2}`);
          return null;
        }
        return { difficulty, category: cat || 'Ogólne', question, answers, correct: correctIndex, host_note: note || '', tags: [], source: 'import' as const, is_active: true };
      }).filter((row): row is NonNullable<typeof row> => row !== null);
      if (!rows.length) throw new Error('Żaden wiersz nie ma kompletu danych (poziom, pytanie, 4 odpowiedzi, poprawna A–D).');
      const { error } = await supabase.from('mavinci_ladder_questions').insert(rows);
      if (error) throw new Error(error.message);
      showSnackbar(`Zaimportowano ${rows.length} pytań${errors.length ? `, pominięto: ${errors.slice(0, 5).join(', ')}${errors.length > 5 ? '…' : ''}` : ''}.`, errors.length ? 'warning' : 'success');
      await loadData(true);
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Nie udało się zaimportować pliku.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const exportCsv = () => {
    const lines = visible.map((item) => [
      LEVEL[item.difficulty].label, item.category, item.question, ...[0, 1, 2, 3].map((index) => item.answers[index] || ''), LETTERS[item.correct], item.host_note,
    ].map(quote).join(';'));
    download('baza-drabinki.csv', [CSV_HEADER, ...lines].join('\r\n'));
  };
  const downloadTemplate = () => download('szablon-drabinki.csv', [
    CSV_HEADER,
    ['Łatwe', 'Polska', 'Stolicą Polski jest:', 'Kraków', 'Warszawa', 'Gdańsk', 'Poznań', 'B', 'Warszawa — stolica od XVII w.'].map(quote).join(';'),
  ].join('\r\n'));

  if (loading) return <div className="flex min-h-72 items-center justify-center text-[#d3bb73]"><RefreshCw className="mr-3 h-5 w-5 animate-spin" /> Wczytuję bazę Drabinki…</div>;

  return <div className="space-y-5">
    <section className="overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-[#d3bb73]">Drabinka · CRM</p>
          <h2 className="mt-1 text-2xl font-semibold">Baza pytań na trzech poziomach</h2>
          <p className="mt-1 max-w-4xl text-sm text-[#e5e4e2]/48">Mavinci LIVE układa drabinkę sam: pierwsza ⅓ stawek to pytania łatwe, środek — średnie, końcówka — trudne. Pytania są losowane, więc każda gra jest inna.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void loadData(true)} disabled={refreshing} className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold hover:border-[#d3bb73]/30 hover:text-[#d3bb73] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Odśwież</button>
          {canManage && <>
            <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => void importCsv(event)} />
            <button data-crm-action="secondary" onClick={() => csvInputRef.current?.click()} disabled={importing} className="flex items-center gap-2 rounded-xl border border-[#d3bb73]/25 px-4 py-3 text-sm font-semibold text-[#d3bb73] disabled:opacity-50"><Upload className="h-4 w-4" /> {importing ? 'Importuję…' : 'Import CSV'}</button>
            <button onClick={() => setDraft(emptyDraft(level === 'all' ? 'easy' : level))} className="flex items-center gap-2 rounded-xl bg-[#d3bb73] px-4 py-3 text-sm font-bold text-[#1c1f33]"><Plus className="h-4 w-4" /> Nowe pytanie</button>
          </>}
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-4">
        {LEVELS.map((item) => <button key={item.id} type="button" onClick={() => setLevel(level === item.id ? 'all' : item.id)} className={`rounded-xl border p-4 text-left transition ${level === item.id ? item.tone : 'border-white/8 bg-black/10 hover:border-white/20'}`}>
          <span className="text-xs font-semibold uppercase tracking-wider opacity-70">{item.label}</span>
          <strong className="mt-2 block text-3xl">{counts[item.id]}</strong>
          <span className="text-xs opacity-50">pytań</span>
        </button>)}
        <div className="rounded-xl border border-white/8 bg-black/10 p-4">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#e5e4e2]/50"><Layers className="h-4 w-4" /> Gotowość</span>
          <strong className={`mt-2 block text-3xl ${ready >= 5 ? 'text-emerald-300' : 'text-amber-300'}`}>{Math.floor(ready / 5)}</strong>
          <span className="text-xs text-[#e5e4e2]/45">pełnych gier po 15 stawek bez powtórek</span>
        </div>
      </div>
    </section>

    <section className="rounded-xl border border-white/10 bg-[#1c1f33] p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl border border-white/10 bg-[#0f1119] p-1">
          {[{ id: 'all' as const, label: `Wszystkie · ${questions.length}` }, ...LEVELS.map((item) => ({ id: item.id, label: `${item.short} · ${counts[item.id]}` }))].map((item) =>
            <button key={item.id} type="button" onClick={() => setLevel(item.id)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${level === item.id ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/55 hover:text-[#e5e4e2]'}`}>{item.label}</button>)}
        </div>
        <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-xl border border-white/10 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none">
          <option value="">Wszystkie kategorie</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <label className="flex min-w-[240px] flex-1 items-center gap-3 rounded-xl border border-white/10 bg-[#0f1119] px-4 py-2.5">
          <Search className="h-4 w-4 text-[#e5e4e2]/35" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj pytania, odpowiedzi, kategorii…" className="w-full bg-transparent text-sm outline-none" />
        </label>
        <button type="button" onClick={exportCsv} title="Eksportuj widoczne pytania do CSV" className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-sm text-[#e5e4e2]/65 hover:text-[#d3bb73]"><Download className="h-4 w-4" /> CSV</button>
        <button type="button" onClick={downloadTemplate} title="Szablon CSV do importu" className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-sm text-[#e5e4e2]/65 hover:text-[#d3bb73]"><FileSpreadsheet className="h-4 w-4" /> Szablon</button>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-white/8">
        <div className="hidden grid-cols-[110px_130px_1fr_260px_84px] gap-3 bg-white/[.035] px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#e5e4e2]/35 lg:grid">
          <span>Poziom</span><span>Kategoria</span><span>Pytanie</span><span>Poprawna odpowiedź</span><span />
        </div>
        {visible.map((item) => <div key={item.id} className="grid gap-2 border-t border-white/5 px-4 py-3 first:border-t-0 lg:grid-cols-[110px_130px_1fr_260px_84px] lg:items-center lg:gap-3">
          <span><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${LEVEL[item.difficulty].tone}`}>{LEVEL[item.difficulty].label}</span></span>
          <span className="truncate text-xs text-[#e5e4e2]/55">{item.category}{item.event_id && <span className="block truncate text-[10px] text-[#d3bb73]/70">{eventMap.get(item.event_id)?.event_name || 'Event'}</span>}</span>
          <div className="min-w-0">
            <p className="text-sm text-[#e5e4e2]">{item.question}</p>
            <p className="mt-1 truncate text-[11px] text-[#e5e4e2]/35">{item.answers.map((answer, index) => `${LETTERS[index]}: ${answer}`).join(' · ')}</p>
          </div>
          <span className="flex min-w-0 items-center gap-2 text-sm text-emerald-200"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-400/15 text-xs font-bold">{LETTERS[item.correct]}</span><span className="truncate">{item.answers[item.correct]}</span></span>
          <span className="flex justify-end gap-2">{canManage && <>
            <IconButton title="Edytuj" onClick={() => edit(item)}><Edit3 /></IconButton>
            <IconButton title="Usuń" danger onClick={() => void archive(item)}><Trash2 /></IconButton>
          </>}</span>
        </div>)}
        {!visible.length && <div className="p-8 text-center text-sm text-[#e5e4e2]/35">{questions.length ? 'Brak pytań dla wybranych filtrów.' : 'Baza jest pusta — dodaj pytanie albo zaimportuj CSV (Poziom; Kategoria; Pytanie; A; B; C; D; Poprawna; Notatka).'}</div>}
      </div>
    </section>

    {draft && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}>
      <div role="dialog" aria-modal="true" data-crm-modal="true" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#d3bb73]/25 bg-[#1c1f33] shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#1c1f33]/95 px-6 py-5 backdrop-blur">
          <div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#d3bb73]">Baza Drabinki</p><h2 className="mt-1 text-xl font-semibold">{draft.id ? 'Edytuj pytanie' : 'Nowe pytanie'}</h2></div>
          <button onClick={() => setDraft(null)} className="rounded-lg border border-white/10 p-2 text-[#e5e4e2]/55"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-5 p-6">
          <div>
            <span className="mb-2 block text-sm text-[#e5e4e2]/60">Poziom</span>
            <div className="grid grid-cols-3 gap-2">{LEVELS.map((item) => <button key={item.id} type="button" onClick={() => setDraft((current) => current && ({ ...current, difficulty: item.id }))} className={`rounded-xl border px-4 py-3 text-sm font-semibold ${draft.difficulty === item.id ? item.tone : 'border-white/10 text-[#e5e4e2]/55'}`}>{item.label}</button>)}</div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Kategoria"><input value={draft.category} list="ladder-categories" onChange={(event) => setDraft((current) => current && ({ ...current, category: event.target.value }))} /></Field>
            <datalist id="ladder-categories">{categories.map((item) => <option key={item} value={item} />)}</datalist>
            <Field label="Dostępność"><select value={draft.event_id} onChange={(event) => setDraft((current) => current && ({ ...current, event_id: event.target.value }))}><option value="">Globalne — dla wszystkich eventów</option>{events.map((item) => <option key={item.event_id} value={item.event_id}>{item.event_name}{item.event_date ? ` · ${new Date(item.event_date).toLocaleDateString('pl-PL')}` : ''}</option>)}</select></Field>
          </div>
          <Field label="Treść pytania"><textarea rows={3} value={draft.question} onChange={(event) => setDraft((current) => current && ({ ...current, question: event.target.value }))} placeholder="np. Najwyższy szczyt Polski to:" /></Field>
          <div>
            <span className="mb-2 block text-sm text-[#e5e4e2]/60">Odpowiedzi — zaznacz poprawną</span>
            <div className="grid gap-2 md:grid-cols-2">{draft.answers.map((answer, index) => <div key={index} className={`flex items-center gap-2 rounded-xl border p-2 ${draft.correct === index ? 'border-emerald-400/40 bg-emerald-400/[.06]' : 'border-white/10 bg-[#0f1119]'}`}>
              <button type="button" title="Poprawna odpowiedź" onClick={() => setDraft((current) => current && ({ ...current, correct: index }))} className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${draft.correct === index ? 'bg-emerald-400 text-[#0b1a12]' : 'bg-white/5 text-[#e5e4e2]/60'}`}>{draft.correct === index ? <Check className="h-4 w-4" /> : LETTERS[index]}</button>
              <input value={answer} onChange={(event) => setDraft((current) => current && ({ ...current, answers: current.answers.map((item, itemIndex) => itemIndex === index ? event.target.value : item) as Draft['answers'] }))} placeholder={`Odpowiedź ${LETTERS[index]}`} className="w-full bg-transparent px-2 py-2 text-sm text-[#e5e4e2] outline-none" />
            </div>)}</div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Notatka dla prowadzącego"><input value={draft.host_note} onChange={(event) => setDraft((current) => current && ({ ...current, host_note: event.target.value }))} placeholder="Ciekawostka do odczytania po odpowiedzi" /></Field>
            <Field label="Tagi, oddzielone przecinkami"><input value={draft.tags} onChange={(event) => setDraft((current) => current && ({ ...current, tags: event.target.value }))} /></Field>
          </div>
          <footer className="flex justify-end gap-3 border-t border-white/10 pt-5">
            <button onClick={() => setDraft(null)} className="rounded-xl border border-white/10 px-5 py-3 text-sm">Anuluj</button>
            <button onClick={() => void save()} disabled={saving} className="rounded-xl bg-[#d3bb73] px-5 py-3 text-sm font-bold text-[#1c1f33] disabled:opacity-50">{saving ? 'Zapisywanie…' : 'Zapisz pytanie'}</button>
          </footer>
        </div>
      </div>
    </div>}
  </div>;
}

function IconButton({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return <button type="button" title={title} aria-label={title} onClick={onClick} className={`rounded-lg border p-2 [&_svg]:h-4 [&_svg]:w-4 ${danger ? 'border-red-400/20 text-red-300/70' : 'border-white/10 text-[#e5e4e2]/55 hover:text-[#d3bb73]'}`}>{children}</button>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm text-[#e5e4e2]/58 [&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-white/10 [&_input]:bg-[#0f1119] [&_input]:px-4 [&_input]:py-3 [&_input]:text-[#e5e4e2] [&_input]:outline-none [&_select]:w-full [&_select]:rounded-xl [&_select]:border [&_select]:border-white/10 [&_select]:bg-[#0f1119] [&_select]:px-4 [&_select]:py-3 [&_select]:text-[#e5e4e2] [&_select]:outline-none [&_textarea]:w-full [&_textarea]:resize-none [&_textarea]:rounded-xl [&_textarea]:border [&_textarea]:border-white/10 [&_textarea]:bg-[#0f1119] [&_textarea]:px-4 [&_textarea]:py-3 [&_textarea]:text-[#e5e4e2] [&_textarea]:outline-none"><span className="mb-2 block">{label}</span>{children}</label>;
}
