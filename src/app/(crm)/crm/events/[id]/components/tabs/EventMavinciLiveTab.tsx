'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Cloud, FileText, Gamepad2, Lightbulb, Loader2, MonitorPlay, Printer, RefreshCw, Save, Send, ShieldCheck, UserCog } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

export interface MavinciLiveModuleRequirement {
  module_key: string;
  name: string;
  description: string | null;
  display_order: number;
  product_names: string[];
}

interface MavinciProject {
  id: string;
  event_id: string;
  name: string;
  enabled_modules: string[];
  draft_manifest: Record<string, unknown>;
  published_manifest: Record<string, unknown> | null;
  version: number;
  updated_at: string;
}

type AccessLevel = '' | 'view' | 'edit' | 'run' | 'admin';

interface AssignedEmployee {
  employee_id: string;
  status?: string | null;
  employee?: { id: string; name?: string | null; surname?: string | null } | null;
}

interface ModuleAccessRow {
  id: string;
  employee_id: string;
  module_key: string;
  can_view: boolean;
  can_edit: boolean;
  can_run: boolean;
  can_admin: boolean;
  valid_from: string | null;
  valid_until: string | null;
}

interface FamiliadaGameOption {
  id: string;
  event_id: string | null;
  name: string;
  description: string;
  rounds: Array<{ id: string }>;
}

interface QuizShowGameOption {
  id: string;
  event_id: string | null;
  name: string;
  description: string;
}

interface FamiliadaManifest {
  gameId?: string;
  gameName?: string;
  pdfPath?: string | null;
  pdfFileName?: string | null;
  generatedAt?: string | null;
}

interface Props {
  eventId: string;
  eventName: string;
  canManage: boolean;
  employees?: AssignedEmployee[];
  requiredModules: MavinciLiveModuleRequirement[];
}

const accessLevelFor = (row?: ModuleAccessRow): AccessLevel => {
  if (!row) return '';
  if (row.can_admin) return 'admin';
  if (row.can_run) return 'run';
  if (row.can_edit) return 'edit';
  return row.can_view ? 'view' : '';
};

const localDateTime = (value: string | null | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const baseLightMagicModule: MavinciLiveModuleRequirement = {
  module_key: 'light_magic',
  name: 'Light Magic',
  description: 'Podstawowy moduł każdego użytkownika Mavinci LIVE: CUE, EXEC, fadery i MIDI.',
  display_order: -1,
  product_names: [],
};

export default function EventMavinciLiveTab({ eventId, eventName, canManage, employees = [], requiredModules }: Props) {
  const { showSnackbar } = useSnackbar();
  const availableModules = useMemo(
    () => requiredModules.some((module) => module.module_key === 'light_magic')
      ? requiredModules
      : [baseLightMagicModule, ...requiredModules],
    [requiredModules],
  );
  const requiredModuleKeys = useMemo(
    () => availableModules.map((module) => module.module_key),
    [availableModules],
  );
  const [project, setProject] = useState<MavinciProject | null>(null);
  const [projectName, setProjectName] = useState(`${eventName} · Mavinci LIVE`);
  const [enabledModules, setEnabledModules] = useState<string[]>(requiredModuleKeys);
  const [presets, setPresets] = useState<Array<{ id: string; name: string; description: string; updated_at: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [missingSchema, setMissingSchema] = useState(false);
  const [accessRows, setAccessRows] = useState<ModuleAccessRow[]>([]);
  const [accessEmployeeId, setAccessEmployeeId] = useState('');
  const [accessDraft, setAccessDraft] = useState<Record<string, AccessLevel>>({});
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [familiadaGames, setFamiliadaGames] = useState<FamiliadaGameOption[]>([]);
  const [quizShowGames, setQuizShowGames] = useState<QuizShowGameOption[]>([]);
  const [familiadaGameId, setFamiliadaGameId] = useState('');
  const [quizShowGameId, setQuizShowGameId] = useState('');
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const assignedEmployees = useMemo(
    () => employees.filter((assignment) => assignment.status !== 'rejected' && assignment.employee_id),
    [employees],
  );
  const hasFamiliada = requiredModuleKeys.includes('familiada');
  const hasQuizShow = requiredModuleKeys.includes('quiz_show');

  const load = useCallback(async () => {
    setLoading(true);
    setMissingSchema(false);
    const [projectResult, presetResult, accessResult, familiadaResult, quizShowResult, quizSetupResult] = await Promise.all([
      supabase.from('mavinci_event_projects').select('*').eq('event_id', eventId).maybeSingle(),
      supabase.from('mavinci_light_magic_presets').select('id,name,description,updated_at').or(`event_id.eq.${eventId},event_id.is.null`).order('updated_at', { ascending: false }),
      supabase.from('mavinci_event_module_access').select('*').eq('event_id', eventId),
      supabase.from('mavinci_familiada_games').select('id,event_id,name,description,rounds:mavinci_familiada_game_questions(id)').eq('is_active', true).or(`event_id.is.null,event_id.eq.${eventId}`).order('updated_at', { ascending: false }),
      supabase.from('mavinci_quiz_show_games').select('id,event_id,name,description').eq('is_active', true).or(`event_id.is.null,event_id.eq.${eventId}`).order('updated_at', { ascending: false }),
      supabase.from('mavinci_quiz_show_event_setups').select('game_id').eq('event_id', eventId).maybeSingle(),
    ]);
    setLoading(false);
    if (projectResult.error && /does not exist|schema cache/i.test(projectResult.error.message)) {
      setMissingSchema(true);
      return;
    }
    if (projectResult.error) {
      showSnackbar(projectResult.error.message, 'error');
      return;
    }
    const nextProject = projectResult.data as MavinciProject | null;
    setProject(nextProject);
    if (nextProject) {
      setProjectName(nextProject.name);
    }
    const familiada = (nextProject?.draft_manifest?.familiada || {}) as FamiliadaManifest;
    setFamiliadaGameId(familiada.gameId || '');
    setQuizShowGameId(quizSetupResult.data?.game_id || String((nextProject?.draft_manifest?.quizShow as { gameId?: string } | undefined)?.gameId || ''));
    setEnabledModules(requiredModuleKeys);
    if (!presetResult.error) setPresets(presetResult.data || []);
    if (!accessResult.error) setAccessRows((accessResult.data || []) as ModuleAccessRow[]);
    if (!familiadaResult.error) setFamiliadaGames((familiadaResult.data || []) as unknown as FamiliadaGameOption[]);
    if (!quizShowResult.error) setQuizShowGames((quizShowResult.data || []) as QuizShowGameOption[]);
  }, [eventId, requiredModuleKeys, showSnackbar]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!accessEmployeeId && assignedEmployees.length > 0) {
      setAccessEmployeeId(assignedEmployees[0].employee_id);
    }
  }, [accessEmployeeId, assignedEmployees]);

  useEffect(() => {
    if (!accessEmployeeId) return;
    const rows = accessRows.filter((row) => row.employee_id === accessEmployeeId);
    setAccessDraft(Object.fromEntries(availableModules.map((module) => [
      module.module_key,
      accessLevelFor(rows.find((row) => row.module_key === module.module_key)),
    ])) as Record<string, AccessLevel>);
    setValidFrom(localDateTime(rows[0]?.valid_from));
    setValidUntil(localDateTime(rows[0]?.valid_until));
  }, [accessEmployeeId, accessRows, availableModules]);

  const selectedFamiliadaGame = useMemo(
    () => familiadaGames.find((game) => game.id === familiadaGameId) || null,
    [familiadaGameId, familiadaGames],
  );
  const selectedQuizShowGame = useMemo(
    () => quizShowGames.find((game) => game.id === quizShowGameId) || null,
    [quizShowGameId, quizShowGames],
  );
  const savedFamiliada = (project?.draft_manifest?.familiada || {}) as FamiliadaManifest;

  const draftManifest = useMemo(() => {
    const previousFamiliada = (project?.draft_manifest?.familiada || {}) as FamiliadaManifest;
    const keepsGeneratedPdf = previousFamiliada.gameId === familiadaGameId;
    return {
      schema: 'mavinci-live-event-project',
      schemaVersion: 1,
      eventId,
      eventName,
      enabledModules,
      familiada: familiadaGameId ? {
        gameId: familiadaGameId,
        gameName: selectedFamiliadaGame?.name || previousFamiliada.gameName || '',
        pdfPath: keepsGeneratedPdf ? previousFamiliada.pdfPath || null : null,
        pdfFileName: keepsGeneratedPdf ? previousFamiliada.pdfFileName || null : null,
        generatedAt: keepsGeneratedPdf ? previousFamiliada.generatedAt || null : null,
      } : null,
      quizShow: quizShowGameId ? {
        gameId: quizShowGameId,
        gameName: selectedQuizShowGame?.name || '',
      } : null,
      updatedAt: new Date().toISOString(),
    };
  }, [enabledModules, eventId, eventName, familiadaGameId, project?.draft_manifest, quizShowGameId, selectedFamiliadaGame?.name, selectedQuizShowGame?.name]);

  const saveDraft = async (silent = false) => {
    setSaving(true);
    const result = await supabase.from('mavinci_event_projects').upsert({
      ...(project?.id ? { id: project.id } : {}),
      event_id: eventId,
      name: projectName.trim() || `${eventName} · Mavinci LIVE`,
      enabled_modules: enabledModules,
      draft_manifest: { ...(project?.draft_manifest || {}), ...draftManifest },
    }, { onConflict: 'event_id' }).select('*').single();
    if (result.error) { setSaving(false); showSnackbar(result.error.message, 'error'); return null; }
    const quizSetupResult = await supabase.from('mavinci_quiz_show_event_setups').upsert({
      event_id: eventId,
      game_id: quizShowGameId || null,
    }, { onConflict: 'event_id' });
    setSaving(false);
    if (quizSetupResult.error && requiredModuleKeys.includes('quiz_show')) {
      showSnackbar(quizSetupResult.error.message, 'error');
      return null;
    }
    setProject(result.data as MavinciProject);
    if (!silent) showSnackbar('Projekt Mavinci LIVE i gotowe gry zapisano w CRM', 'success');
    return result.data as MavinciProject;
  };

  const publish = async () => {
    const saved = await saveDraft();
    if (!saved) return;
    setSaving(true);
    const result = await supabase.rpc('publish_mavinci_event_project', { p_project_id: saved.id });
    setSaving(false);
    if (result.error) { showSnackbar(result.error.message, 'error'); return; }
    setProject(result.data as MavinciProject);
    showSnackbar(`Opublikowano wersję ${(result.data as MavinciProject).version}. Jest dostępna w aplikacji Mavinci LIVE.`, 'success');
  };

  const saveModuleAccess = async () => {
    if (!accessEmployeeId) return;
    if (validFrom && validUntil && new Date(validFrom) >= new Date(validUntil)) {
      showSnackbar('Data odebrania dostępu musi być późniejsza niż data rozpoczęcia.', 'error');
      return;
    }
    setSaving(true);
    const rows = availableModules.flatMap((module) => {
      const level = accessDraft[module.module_key];
      if (!level) return [];
      return [{ module_key: module.module_key, level }];
    });
    const insertResult = await supabase.rpc('set_mavinci_module_access', {
      p_event_id: eventId,
      p_employee_id: accessEmployeeId,
      p_access: rows,
      p_valid_from: validFrom ? new Date(validFrom).toISOString() : null,
      p_valid_until: validUntil ? new Date(validUntil).toISOString() : null,
    });
    setSaving(false);
    if (insertResult.error) {
      showSnackbar(insertResult.error.message, 'error');
      return;
    }
    showSnackbar('Dostęp pracownika do Mavinci LIVE został zapisany.', 'success');
    await load();
  };

  const openFamiliadaPdf = async (path = savedFamiliada.pdfPath) => {
    if (!path) return;
    const popup = window.open('', '_blank');
    const { data, error } = await supabase.storage.from('event-files').createSignedUrl(path, 60 * 60);
    if (error || !data?.signedUrl) {
      popup?.close();
      showSnackbar(error?.message || 'Nie udało się otworzyć PDF-u.', 'error');
      return;
    }
    if (popup) popup.location.href = data.signedUrl;
    else window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const generateFamiliadaPdf = async () => {
    if (!familiadaGameId || generatingPdf) return;
    const popup = window.open('', '_blank');
    const saved = await saveDraft(true);
    if (!saved) {
      popup?.close();
      return;
    }
    setGeneratingPdf(true);
    try {
      const response = await fetch('/bridge/events/mavinci-live/familiada-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, gameId: familiadaGameId }),
      });
      const result = await response.json() as { error?: string; signedUrl?: string };
      if (!response.ok) throw new Error(result.error || 'Nie udało się przygotować PDF-u.');
      showSnackbar('Arkusz pytań Familiady zapisano w Karcie Weselnej i plikach wydarzenia.', 'success');
      await load();
      if (result.signedUrl && popup) popup.location.href = result.signedUrl;
      else if (result.signedUrl) window.open(result.signedUrl, '_blank', 'noopener,noreferrer');
      else popup?.close();
    } catch (error) {
      popup?.close();
      showSnackbar(error instanceof Error ? error.message : 'Nie udało się przygotować PDF-u.', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  if (loading) return <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-10 text-center text-[#e5e4e2]/60">Wczytuję projekt Mavinci LIVE…</div>;

  if (missingSchema) return <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-6 text-amber-100"><h2 className="mb-2 text-lg font-semibold">Moduł czeka na migrację bazy</h2><p className="text-sm text-amber-100/70">Zastosuj migrację <code>20260825090000_create_mavinci_live_cloud.sql</code>, a ta karta automatycznie zacznie działać.</p></div>;

  return <div className="space-y-5">
    <section className="rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3"><span className="rounded-lg bg-[#d3bb73]/10 p-3 text-[#d3bb73]"><MonitorPlay className="h-6 w-6" /></span><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#d3bb73]">Mavinci LIVE</p><h2 className="text-xl font-semibold text-[#e5e4e2]">Projekt realizacji</h2><p className="mt-1 text-sm text-[#e5e4e2]/55">CRM przygotowuje wydarzenie, a aplikacja desktopowa pobiera opublikowaną wersję i respektuje dostęp pracownika.</p></div></div>
        <div className="flex gap-2"><button type="button" onClick={() => void load()} className="flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm text-[#e5e4e2]/75"><RefreshCw className="h-4 w-4" />Odśwież</button>{canManage && <><button data-crm-action="secondary" type="button" onClick={() => void saveDraft()} disabled={saving} className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/25 px-4 py-2 text-sm font-semibold text-[#d3bb73]"><Save className="h-4 w-4" />Zapisz szkic</button><button type="button" onClick={() => void publish()} disabled={saving} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-bold text-[#151522]"><Send className="h-4 w-4" />Publikuj do aplikacji</button></>}</div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]"><label className="grid gap-2 text-xs font-semibold text-[#e5e4e2]/65">Nazwa projektu<input value={projectName} disabled={!canManage} onChange={(event) => setProjectName(event.target.value)} className="h-11 rounded-lg border border-white/10 bg-[#111522] px-3 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/60" /></label><div className="grid min-w-44 gap-1 rounded-lg border border-white/10 bg-[#111522] px-4 py-2"><span className="text-[10px] font-bold uppercase tracking-widest text-[#e5e4e2]/40">Wersja publikowana</span><strong className="text-xl text-[#d3bb73]">v{project?.version || 0}</strong></div></div>
    </section>

    <section className="rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-6"><div className="mb-4"><p className="text-xs font-bold uppercase tracking-[.18em] text-[#d3bb73]">Moduły z oferty wydarzenia</p><h2 className="text-lg font-semibold text-[#e5e4e2]">Zakres wydarzenia</h2><p className="mt-1 text-xs text-[#e5e4e2]/45">Light Magic jest modułem podstawowym. Pozostały zakres wynika automatycznie z produktów zaakceptowanej oferty, a przed akceptacją — z najnowszej aktywnej wersji.</p></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{availableModules.map((module) => <article key={module.module_key} className="flex items-start gap-3 rounded-xl border border-[#d3bb73]/55 bg-[#d3bb73]/10 p-4 text-left"><span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#d3bb73] text-[#111522]"><Check className="h-3.5 w-3.5" /></span><span><strong className="block text-sm text-[#e5e4e2]">{module.name}</strong><small className="mt-1 block text-xs leading-relaxed text-[#e5e4e2]/45">{module.description || 'Moduł zawartości Mavinci LIVE'}</small>{module.product_names.length > 0 && <small className="mt-2 block text-[10px] text-[#d3bb73]/80">Wymagany przez: {module.product_names.join(', ')}</small>}</span></article>)}</div></section>

    {(hasFamiliada || hasQuizShow) && <section className="rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="rounded-lg bg-[#d3bb73]/10 p-3 text-[#d3bb73]"><Gamepad2 className="h-5 w-5" /></span>
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-[#d3bb73]">Gotowe rozgrywki</p>
          <h2 className="text-lg font-semibold text-[#e5e4e2]">Gry przypisane do wydarzenia</h2>
          <p className="mt-1 text-xs text-[#e5e4e2]/45">Wybierasz raz, a ta sama rozgrywka trafia do projektu Mavinci LIVE i materiałów wydarzenia.</p>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {hasFamiliada && <article className="rounded-xl border border-white/10 bg-[#111522] p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><strong className="text-base text-[#e5e4e2]">Familiada</strong><p className="mt-1 text-xs text-[#e5e4e2]/45">Niezależny generator estetycznego arkusza zawierającego wyłącznie pytania.</p></div>
            {savedFamiliada.pdfPath && savedFamiliada.gameId === familiadaGameId && <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">PDF gotowy</span>}
          </div>
          <label className="grid gap-2 text-xs font-semibold text-[#e5e4e2]/65">Gotowa gra
            <select value={familiadaGameId} disabled={!canManage} onChange={(event) => setFamiliadaGameId(event.target.value)} className="h-11 rounded-lg border border-white/10 bg-[#171b2a] px-3 text-sm text-[#e5e4e2]">
              <option value="">Nie wybrano gry</option>
              {familiadaGames.map((game) => <option key={game.id} value={game.id}>{game.name} · {game.rounds.length} pytań</option>)}
            </select>
          </label>
          {selectedFamiliadaGame && <div className="mt-3 rounded-lg bg-white/[0.03] p-3"><p className="text-xs leading-relaxed text-[#e5e4e2]/55">{selectedFamiliadaGame.description || 'Gra bez dodatkowego opisu.'}</p><p className="mt-2 text-[10px] font-semibold text-[#d3bb73]">{selectedFamiliadaGame.rounds.length} pytań · bez odpowiedzi, punktów i mnożników</p></div>}
          {canManage && <div className="mt-4 flex flex-wrap gap-2">
            <button data-crm-action="secondary" type="button" onClick={() => void saveDraft()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/25 px-4 py-2 text-xs font-semibold text-[#d3bb73]"><Save className="h-4 w-4" />Zapisz wybór</button>
            <button type="button" onClick={() => void generateFamiliadaPdf()} disabled={!familiadaGameId || generatingPdf || saving} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-xs font-bold text-[#151522] disabled:opacity-45">{generatingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}Generuj arkusz pytań</button>
            {savedFamiliada.pdfPath && savedFamiliada.gameId === familiadaGameId && <button type="button" onClick={() => void openFamiliadaPdf()} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-xs text-[#e5e4e2]/75"><Printer className="h-4 w-4" />Otwórz i drukuj</button>}
          </div>}
          {!canManage && savedFamiliada.pdfPath && <button type="button" onClick={() => void openFamiliadaPdf()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-xs text-[#e5e4e2]/75"><Printer className="h-4 w-4" />Otwórz materiał</button>}
        </article>}

        {hasQuizShow && <article className="rounded-xl border border-white/10 bg-[#111522] p-5">
          <div className="mb-4"><strong className="text-base text-[#e5e4e2]">Quiz Show</strong><p className="mt-1 text-xs text-[#e5e4e2]/45">Gotowa gra zostanie automatycznie wczytana w aplikacji realizacyjnej.</p></div>
          <label className="grid gap-2 text-xs font-semibold text-[#e5e4e2]/65">Gotowa gra
            <select value={quizShowGameId} disabled={!canManage} onChange={(event) => setQuizShowGameId(event.target.value)} className="h-11 rounded-lg border border-white/10 bg-[#171b2a] px-3 text-sm text-[#e5e4e2]">
              <option value="">Nie wybrano gry</option>
              {quizShowGames.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
            </select>
          </label>
          {selectedQuizShowGame && <p className="mt-3 rounded-lg bg-white/[0.03] p-3 text-xs leading-relaxed text-[#e5e4e2]/55">{selectedQuizShowGame.description || 'Gra bez dodatkowego opisu.'}</p>}
          {canManage && <button data-crm-action="secondary" type="button" onClick={() => void saveDraft()} disabled={saving} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/25 px-4 py-2 text-xs font-semibold text-[#d3bb73]"><Save className="h-4 w-4" />Zapisz wybór gry</button>}
        </article>}
      </div>
    </section>}

    {canManage && <section className="rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-6">
      <div className="mb-5 flex items-start gap-3"><span className="rounded-lg bg-[#d3bb73]/10 p-3 text-[#d3bb73]"><UserCog className="h-5 w-5" /></span><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#d3bb73]">Pracownicy i okres dostępu</p><h2 className="text-lg font-semibold text-[#e5e4e2]">Uprawnienia do sektorów Mavinci LIVE</h2><p className="mt-1 text-xs text-[#e5e4e2]/45">Po upływie terminu aplikacja desktopowa automatycznie przestanie udostępniać wybrane moduły.</p></div></div>
      {assignedEmployees.length > 0 ? <div className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="grid gap-2 text-xs font-semibold text-[#e5e4e2]/65">Pracownik<select value={accessEmployeeId} onChange={(event) => setAccessEmployeeId(event.target.value)} className="h-11 rounded-lg border border-white/10 bg-[#111522] px-3 text-sm text-[#e5e4e2]"><option value="">Wybierz pracownika</option>{assignedEmployees.map((assignment) => <option key={assignment.employee_id} value={assignment.employee_id}>{`${assignment.employee?.name || ''} ${assignment.employee?.surname || ''}`.trim() || assignment.employee_id}</option>)}</select></label>
          <label className="grid gap-2 text-xs font-semibold text-[#e5e4e2]/65">Dostęp od (opcjonalnie)<input type="datetime-local" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} className="h-11 rounded-lg border border-white/10 bg-[#111522] px-3 text-sm text-[#e5e4e2]" /></label>
          <label className="grid gap-2 text-xs font-semibold text-[#e5e4e2]/65">Dostęp do (opcjonalnie)<input type="datetime-local" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} className="h-11 rounded-lg border border-white/10 bg-[#111522] px-3 text-sm text-[#e5e4e2]" /></label>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{availableModules.map((module) => <label key={module.module_key} className="grid gap-2 rounded-lg border border-white/10 bg-[#111522] p-3 text-xs font-semibold text-[#e5e4e2]/65"><span className="flex items-center gap-2 text-sm text-[#e5e4e2]"><ShieldCheck className="h-4 w-4 text-[#d3bb73]" />{module.name}</span><select value={accessDraft[module.module_key] || ''} onChange={(event) => setAccessDraft((current) => ({ ...current, [module.module_key]: event.target.value as AccessLevel }))} className="h-10 rounded-lg border border-white/10 bg-[#171b2a] px-3 text-sm text-[#e5e4e2]"><option value="">Brak dostępu do wydarzenia</option><option value="view">Tylko podgląd</option><option value="edit">Edycja konfiguracji</option><option value="run">Prowadzenie realizacji</option><option value="admin">Administrator modułu</option></select></label>)}</div>
        <div className="flex justify-end"><button type="button" onClick={() => void saveModuleAccess()} disabled={saving || !accessEmployeeId} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-2.5 text-sm font-bold text-[#151522]"><Save className="h-4 w-4" />Zapisz dostęp pracownika</button></div>
      </div> : <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm text-[#e5e4e2]/45">Najpierw dodaj pracowników do zespołu wydarzenia.</div>}
    </section>}

    <section className="rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-6"><div className="mb-4 flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#d3bb73]">Light Magic</p><h2 className="text-lg font-semibold text-[#e5e4e2]">Presety dostępne dla realizacji</h2></div><Cloud className="h-6 w-6 text-[#d3bb73]" /></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{presets.map((preset) => <article key={preset.id} className="rounded-lg border border-white/10 bg-[#111522] p-4"><div className="flex items-start gap-3"><Lightbulb className="h-5 w-5 shrink-0 text-[#d3bb73]" /><div><strong className="text-sm text-[#e5e4e2]">{preset.name}</strong><p className="mt-1 text-xs text-[#e5e4e2]/45">{preset.description || 'Bez opisu'}</p><small className="mt-2 block text-[10px] text-[#e5e4e2]/35">{new Date(preset.updated_at).toLocaleString('pl-PL')}</small></div></div></article>)}{presets.length === 0 && <div className="col-span-full rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-[#e5e4e2]/45">Presety wysłane z Mavinci LIVE pojawią się tutaj.</div>}</div></section>
  </div>;
}
