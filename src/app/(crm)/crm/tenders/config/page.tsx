'use client';

import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/browser';
import {
  Save,
  Plus,
  Trash2,
  Settings,
  Tag,
  MapPin,
  Gauge,
  Clock,
  FileX,
  FileCheck,
  X,
  ArrowLeft,
  RefreshCw,
  Lock,
} from 'lucide-react';
import {
  TENDER_FILTER_LIST_FIELDS,
  addTenderFilterValues,
  tenderFilterChanged,
  tenderFilterInput,
  validateTenderFilterInput,
  type TenderConfigState,
  type TenderFilterConfig,
  type TenderFilterListField,
} from '@/lib/tenders/tenderFilterConfig';

/*
 * Konfiguracja filtrów przetargów — to samo API co Mac (`TenderFilterConfigView`) i telefon (`TenderFilterConfigSheet`):
 * `/bridge/native/v1/tenders` (token sesji, `x-mavinci-client: web`, RLS `tender_filter_config`). Zmiany zapisuje
 * administrator; pozostali pracownicy z dostępem do przetargów widzą konfigurację do odczytu. Listy: Enter, przycisk „+”
 * albo wklejenie kilku pozycji naraz (nowe linie, przecinki, średniki, kropki) — powtórzenia są pomijane.
 */

const ENDPOINT = '/bridge/native/v1/tenders';

type ConfigReply = TenderConfigState & { selectedId?: string | null; message?: string | null };
type RecalculationReply = { checked: number; updated: number; message: string };

async function requestHeaders(json: boolean): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
  return { Authorization: `Bearer ${token}`, 'x-mavinci-client': 'web', ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error || `Operacja nie powiodła się (HTTP ${response.status}).`);
  return body;
}

const fetchState = async () =>
  parse<ConfigReply>(await fetch(`${ENDPOINT}?op=config`, { headers: await requestHeaders(false), cache: 'no-store' }));

const post = async <T,>(op: string, body: Record<string, unknown> = {}) =>
  parse<T>(await fetch(ENDPOINT, { method: 'POST', headers: await requestHeaders(true), body: JSON.stringify({ ...body, op }) }));

const LIST_STYLE: Record<TenderFilterListField, { icon: typeof Tag; iconClass: string; chip: string; button: string }> = {
  positive_keywords: {
    icon: Tag,
    iconClass: 'text-green-400',
    chip: 'border-green-500/20 bg-green-500/10 text-green-400',
    button: 'bg-green-500/20 text-green-400 hover:bg-green-500/30',
  },
  negative_keywords: {
    icon: Tag,
    iconClass: 'text-red-400',
    chip: 'border-red-500/20 bg-red-500/10 text-red-400',
    button: 'bg-red-500/20 text-red-400 hover:bg-red-500/30',
  },
  cpv_codes: {
    icon: Tag,
    iconClass: 'text-[#d3bb73]',
    chip: 'border-[#d3bb73]/20 bg-[#d3bb73]/10 text-[#d3bb73]',
    button: 'bg-[#d3bb73]/20 text-[#d3bb73] hover:bg-[#d3bb73]/30',
  },
  locations: {
    icon: MapPin,
    iconClass: 'text-blue-400',
    chip: 'border-blue-500/20 bg-blue-500/10 text-blue-400',
    button: 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30',
  },
};

const EMPTY_INPUTS: Record<TenderFilterListField, string> = { positive_keywords: '', negative_keywords: '', cpv_codes: '', locations: '' };
const numberValue = (value: number) => (Number.isFinite(value) ? value : '');
const numberInput = (value: string) => (value.trim() === '' ? NaN : Number(value));

export default function FilterConfigPage() {
  const [state, setState] = useState<TenderConfigState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TenderFilterConfig | null>(null);
  const [inputs, setInputs] = useState<Record<TenderFilterListField, string>>(EMPTY_INPUTS);
  const [duplicates, setDuplicates] = useState<Partial<Record<TenderFilterListField, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const duplicateTimers = useRef<Partial<Record<TenderFilterListField, number>>>({});

  const saved = state?.configs.find((config) => config.id === selectedId) ?? null;
  const canEdit = state?.canEdit === true;
  const dirty = !!saved && !!draft && draft.id === saved.id && tenderFilterChanged(saved, draft);

  /** Nowy stan z serwera: zostaje wybrana konfiguracja (albo wskazana w odpowiedzi), formularz — jej zapisana wersja. */
  const apply = useCallback((reply: ConfigReply, prefer: string | null) => {
    const next: TenderConfigState = { configs: reply.configs, canEdit: reply.canEdit, canRecalculate: reply.canRecalculate };
    const chosen = next.configs.find((config) => config.id === (reply.selectedId ?? prefer)) ?? next.configs[0] ?? null;
    setState(next);
    setSelectedId(chosen?.id ?? null);
    setDraft(chosen ? { ...chosen } : null);
    setInputs(EMPTY_INPUTS);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const reply = await fetchState();
        if (!cancelled) { apply(reply, null); setLoadError(null); }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Nie udało się wczytać konfiguracji filtrów.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apply]);

  useEffect(() => {
    const timers = duplicateTimers.current;
    return () => { Object.values(timers).forEach((timer) => window.clearTimeout(timer)); };
  }, []);

  // Niezapisane zmiany: przeglądarka pyta przed zamknięciem karty lub odświeżeniem strony.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const discardAllowed = () => !dirty || window.confirm('Masz niezapisane zmiany w konfiguracji. Odrzucić je?');

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Operacja nie powiodła się.' });
    } finally {
      setBusy(null);
    }
  };

  const selectConfig = (config: TenderFilterConfig) => {
    if (config.id === selectedId || !discardAllowed()) return;
    setSelectedId(config.id);
    setDraft({ ...config });
    setInputs(EMPTY_INPUTS);
    setMessage(null);
  };

  const handleSave = () => {
    if (!draft || !saved || !canEdit) return;
    const input = tenderFilterInput(draft as unknown as Record<string, unknown>);
    const problem = validateTenderFilterInput(input);
    if (problem) { setMessage({ type: 'error', text: problem }); return; }
    void run('Zapisywanie konfiguracji…', async () => {
      const reply = await post<ConfigReply>('configSave', { id: draft.id, config: input, updatedAt: saved.updated_at });
      apply(reply, draft.id);
      setMessage({ type: 'success', text: reply.message || 'Konfiguracja zapisana.' });
    });
  };

  const handleCreate = () => {
    if (!canEdit || !discardAllowed()) return;
    void run('Dodawanie konfiguracji…', async () => {
      const reply = await post<ConfigReply>('configCreate');
      apply(reply, null);
      setMessage({ type: 'success', text: reply.message || 'Dodano konfigurację.' });
    });
  };

  const handleDelete = () => {
    if (!saved || !canEdit || saved.is_active) return;
    if (!window.confirm(`Usunąć konfigurację „${saved.name}”? Tej operacji nie można cofnąć.`)) return;
    void run('Usuwanie konfiguracji…', async () => {
      const reply = await post<ConfigReply>('configDelete', { id: saved.id });
      apply(reply, null);
      setMessage({ type: 'success', text: reply.message || 'Konfiguracja usunięta.' });
    });
  };

  const handleRecalculate = () => {
    if (!state?.canRecalculate) return;
    if (dirty) {
      setMessage({ type: 'error', text: 'Najpierw zapisz zmiany — przeliczenie używa zapisanej aktywnej konfiguracji.' });
      return;
    }
    void run('Przeliczanie przetargów', async () => {
      const reply = await post<RecalculationReply>('recalculate');
      setMessage({ type: 'success', text: reply.message });
    });
  };

  const flashDuplicates = (field: TenderFilterListField) => {
    setDuplicates((current) => ({ ...current, [field]: true }));
    window.clearTimeout(duplicateTimers.current[field]);
    duplicateTimers.current[field] = window.setTimeout(() => {
      setDuplicates((current) => ({ ...current, [field]: false }));
    }, 1800);
  };

  const addValues = (field: TenderFilterListField, value: string) => {
    if (!draft || !canEdit || !value.trim()) return;
    const result = addTenderFilterValues(draft[field], value);
    if (result.duplicates) flashDuplicates(field);
    if (result.added) setDraft({ ...draft, [field]: result.list });
  };

  const submitInput = (field: TenderFilterListField) => {
    addValues(field, inputs[field]);
    setInputs((current) => ({ ...current, [field]: '' }));
  };

  // Wklejona lista (z separatorami) trafia od razu do tej samej listy; tekst wpisany w polu zostaje.
  const pasteValues = (field: TenderFilterListField) => (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (!/[\r\n,;.]/.test(pasted)) return;
    event.preventDefault();
    addValues(field, pasted);
  };

  const removeValue = (field: TenderFilterListField, index: number) => {
    if (!draft || !canEdit) return;
    setDraft({ ...draft, [field]: draft[field].filter((_, i) => i !== index) });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#d3bb73] border-t-transparent" />
      </div>
    );
  }

  const inputClass =
    'w-full rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none disabled:opacity-60';

  return (
    <div className="p-6 lg:p-8">
      {busy && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" role="alertdialog" aria-live="polite" aria-label={busy}>
          <div className="w-full max-w-sm rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10">
              <RefreshCw className="h-7 w-7 animate-spin text-[#d3bb73]" />
            </div>
            <h2 className="text-lg font-medium text-[#e5e4e2]">{busy}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#e5e4e2]/50">
              {busy === 'Przeliczanie przetargów'
                ? 'Aktualizuję ocenę trafności na podstawie aktywnej konfiguracji. Proszę nie zamykać okna.'
                : 'Czekamy na potwierdzenie serwera.'}
            </p>
          </div>
        </div>
      )}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/crm/tenders"
            className="mb-2 inline-flex items-center gap-1.5 text-xs text-[#e5e4e2]/40 hover:text-[#e5e4e2]/70"
          >
            <ArrowLeft className="h-3 w-3" /> Wróć do przetargów
          </Link>
          <h1 className="text-2xl font-light text-[#e5e4e2]">Konfiguracja filtrów</h1>
          <p className="mt-1 text-sm text-[#e5e4e2]/50">
            Definiuj kryteria dopasowania przetargów do profilu firmy
          </p>
        </div>
        {canEdit && (
          <button
            onClick={handleCreate}
            disabled={!!busy}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Nowa konfiguracja
          </button>
        )}
      </div>

      {loadError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <FileX className="h-4 w-4" /> {loadError}
        </div>
      )}

      {state && !canEdit && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 px-4 py-3 text-sm text-[#e5e4e2]/70">
          <Lock className="h-4 w-4 text-[#d3bb73]" /> Podgląd konfiguracji — zmiany zapisuje administrator CRM.
        </div>
      )}

      {message && (
        <div
          role="status"
          className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-green-500/30 bg-green-500/10 text-green-400'
              : 'border-red-500/30 bg-red-500/10 text-red-400'
          }`}
        >
          {message.type === 'success' ? <FileCheck className="h-4 w-4" /> : <FileX className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {state && state.configs.length === 0 && (
        <p className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 text-sm text-[#e5e4e2]/60">
          Brak konfiguracji filtrów.{canEdit ? ' Dodaj pierwszą przyciskiem „Nowa konfiguracja”.' : ''}
        </p>
      )}

      <div className="flex gap-6">
        {state && state.configs.length > 0 && (
          <div className="w-64 flex-shrink-0 space-y-2">
            {state.configs.map((cfg) => (
              <button
                key={cfg.id}
                onClick={() => selectConfig(cfg)}
                className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                  selectedId === cfg.id
                    ? 'border-[#d3bb73]/40 bg-[#d3bb73]/10'
                    : 'border-[#d3bb73]/10 bg-[#1c1f33] hover:border-[#d3bb73]/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-[#e5e4e2]">
                    {cfg.name}
                    {selectedId === cfg.id && dirty && <span className="ml-1 text-[#d3bb73]" title="Niezapisane zmiany">•</span>}
                  </span>
                  {cfg.is_active && (
                    <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] text-green-400">
                      Aktywna
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {draft && (
          <div className="flex-1 space-y-5">
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <div className="mb-4 flex items-center gap-3">
                <Settings className="h-5 w-5 text-[#d3bb73]" />
                <h2 className="text-base font-medium text-[#e5e4e2]">Ustawienia podstawowe</h2>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-[#e5e4e2]/50">Nazwa konfiguracji</label>
                  <input
                    type="text"
                    value={draft.name}
                    disabled={!canEdit}
                    maxLength={120}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs text-[#e5e4e2]/50">
                    <Gauge className="h-3 w-3" /> Minimalna ocena trafności
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={numberValue(draft.min_relevance_score)}
                    disabled={!canEdit}
                    onChange={(e) => setDraft({ ...draft, min_relevance_score: numberInput(e.target.value) })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs text-[#e5e4e2]/50">
                    <Clock className="h-3 w-3" /> Max dni do terminu
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={numberValue(draft.max_days_to_deadline)}
                    disabled={!canEdit}
                    onChange={(e) => setDraft({ ...draft, max_days_to_deadline: numberInput(e.target.value) })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs text-[#e5e4e2]/50">
                    <Gauge className="h-3 w-3" /> Powiadom od oceny
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={numberValue(draft.notification_score_threshold)}
                    disabled={!canEdit}
                    onChange={(e) => setDraft({ ...draft, notification_score_threshold: numberInput(e.target.value) })}
                    className={inputClass}
                  />
                  <p className="mt-1 text-[11px] text-[#e5e4e2]/35">
                    Dla nowych przetargów z taką oceną CRM utworzy powiadomienie i banner push.
                  </p>
                </div>
                <div className="col-span-2">
                  <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                    <input
                      type="checkbox"
                      checked={draft.is_active}
                      disabled={!canEdit}
                      onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                      className="rounded border-[#d3bb73]/30 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73]/30"
                    />
                    Konfiguracja aktywna
                  </label>
                  <p className="mt-1 text-[11px] text-[#e5e4e2]/35">
                    Pobieranie przetargów i przeliczenie ocen używają jednej konfiguracji — zapis aktywnej wyłącza pozostałe.
                  </p>
                </div>
              </div>
            </div>

            {TENDER_FILTER_LIST_FIELDS.map((field) => {
              const style = LIST_STYLE[field.key];
              const Icon = style.icon;
              return (
                <div key={field.key} className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <Icon className={`h-5 w-5 ${style.iconClass}`} />
                    <h2 className="text-base font-medium text-[#e5e4e2]">{field.label}</h2>
                    <span className="text-xs text-[#e5e4e2]/40">{draft[field.key].length}</span>
                  </div>
                  {canEdit && (
                    <div className="mb-3 flex gap-2">
                      <input
                        type="text"
                        value={inputs[field.key]}
                        onChange={(e) => setInputs((current) => ({ ...current, [field.key]: e.target.value }))}
                        onPaste={pasteValues(field.key)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            submitInput(field.key);
                          }
                        }}
                        placeholder={field.placeholder}
                        aria-label={field.label}
                        className={`flex-1 rounded-lg border bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:outline-none ${
                          duplicates[field.key]
                            ? 'border-red-500/80 focus:border-red-500'
                            : 'border-[#d3bb73]/15 focus:border-[#d3bb73]/40'
                        }`}
                      />
                      <button
                        onClick={() => submitInput(field.key)}
                        aria-label={`Dodaj: ${field.label}`}
                        className={`rounded-lg px-3 py-2 text-sm ${style.button}`}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  {duplicates[field.key] && <p className="mb-2 text-xs text-red-400">Pominięto pozycje, które już są na liście.</p>}
                  <div className="flex flex-wrap gap-1.5">
                    {draft[field.key].map((value, i) => (
                      <span key={`${value}-${i}`} className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${style.chip}`}>
                        {value}
                        {canEdit && (
                          <button onClick={() => removeValue(field.key, i)} className="ml-1 hover:text-white" aria-label={`Usuń „${value}”`}>
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    ))}
                    {draft[field.key].length === 0 && <span className="text-xs text-[#e5e4e2]/35">Brak pozycji.</span>}
                  </div>
                </div>
              );
            })}

            {(canEdit || state?.canRecalculate) && (
              <div className="flex items-center justify-between">
                {canEdit ? (
                  <button
                    onClick={handleDelete}
                    disabled={!!busy || !saved || saved.is_active}
                    title={saved?.is_active ? 'Aktywnej konfiguracji nie można usunąć — najpierw zapisz inną jako aktywną.' : undefined}
                    className="flex items-center gap-2 rounded-lg border border-red-500/20 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" /> Usuń konfigurację
                  </button>
                ) : <span />}
                <div className="flex gap-2">
                  {state?.canRecalculate && (
                    <button data-crm-action="secondary"
                      onClick={handleRecalculate}
                      disabled={!!busy}
                      className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 ${busy === 'Przeliczanie przetargów' ? 'animate-spin' : ''}`} />
                      Przelicz przetargi
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={handleSave}
                      disabled={!!busy || !dirty}
                      className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      {busy === 'Zapisywanie konfiguracji…' ? 'Zapisywanie...' : 'Zapisz konfigurację'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
