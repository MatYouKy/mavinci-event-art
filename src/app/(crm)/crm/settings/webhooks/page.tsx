'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  ArrowLeft,
  Copy,
  Check,
  AlertTriangle,
  Eye,
  EyeOff,
  RefreshCw,
  ExternalLink,
  Webhook,
  Radio,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { Modal } from '@/components/UI/Modal';

interface WebhookSource {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  allowed_event_types: string[] | null;
  default_notify_permissions: string[];
  description: string | null;
  created_at: string;
}

interface InboundEvent {
  id: string;
  source_id: string;
  external_event_id: string;
  event_type: string;
  title: string;
  body: string | null;
  priority: string;
  detail_url: string | null;
  event_time: string | null;
  metadata: Record<string, unknown>;
  status: string;
  created_at: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-[#e5e4e2]/10 text-[#e5e4e2]/60',
  normal: 'bg-blue-500/15 text-blue-400',
  high: 'bg-amber-500/15 text-amber-400',
  critical: 'bg-red-500/15 text-red-400',
};

const STATUS_COLORS: Record<string, string> = {
  received: 'bg-amber-500/15 text-amber-400',
  processed: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
  ignored: 'bg-[#e5e4e2]/10 text-[#e5e4e2]/50',
};

const inputClass =
  'w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/60';
const labelClass = 'mb-1 block text-xs font-medium text-[#e5e4e2]/70';

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generateApiKey(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return 'whk_' + Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function WebhooksSettingsPage() {
  const router = useRouter();
  const { employee } = useCurrentEmployee();
  const { showConfirm } = useDialog();
  const { showSnackbar } = useSnackbar();

  const isAdmin = useMemo(
    () => employee?.role === 'admin' || employee?.access_level === 'admin',
    [employee],
  );

  const [sources, setSources] = useState<WebhookSource[]>([]);
  const [events, setEvents] = useState<InboundEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [tab, setTab] = useState<'sources' | 'events'>('sources');
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [srcRes, evtRes] = await Promise.all([
      supabase.from('webhook_sources').select('*').order('created_at', { ascending: false }),
      supabase.from('inbound_events').select('*').order('created_at', { ascending: false }).limit(100),
    ]);

    if (srcRes.error?.code === 'PGRST205' || evtRes.error?.code === 'PGRST205') {
      setSchemaMissing(true);
      setLoading(false);
      return;
    }
    setSchemaMissing(false);
    setSources(srcRes.data || []);
    setEvents(evtRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleSourceActive = useCallback(
    async (src: WebhookSource) => {
      const { error } = await supabase
        .from('webhook_sources')
        .update({ is_active: !src.is_active, updated_at: new Date().toISOString() })
        .eq('id', src.id);
      if (error) {
        showSnackbar('Nie udało się zmienić statusu', 'error');
        return;
      }
      showSnackbar(
        src.is_active ? 'Źródło zostało wyłączone' : 'Źródło zostało włączone',
        'success',
      );
      fetchData();
    },
    [showSnackbar, fetchData],
  );

  const deleteSource = useCallback(
    async (src: WebhookSource) => {
      const ok = await showConfirm({
        title: 'Usuń źródło',
        message: `Czy na pewno usunąć "${src.name}"? Wszystkie powiązane zdarzenia zostaną usunięte.`,
        confirmText: 'Usuń',
      });
      if (!ok) return;
      const { error } = await supabase.from('webhook_sources').delete().eq('id', src.id);
      if (error) {
        showSnackbar('Nie udało się usunąć źródła', 'error');
        return;
      }
      showSnackbar('Źródło zostało usunięte', 'success');
      fetchData();
    },
    [showConfirm, showSnackbar, fetchData],
  );

  const sourceNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sources) map.set(s.id, s.name);
    return map;
  }, [sources]);

  if (!isAdmin) {
    return (
      <div className="py-20 text-center text-[#e5e4e2]/50">
        Brak dostępu. Ta strona jest dostępna tylko dla administratorów.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => router.push('/crm/settings')}
          className="rounded-lg border border-[#d3bb73]/20 p-2 text-[#e5e4e2]/70 hover:text-[#e5e4e2]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-light text-[#e5e4e2]">Webhooki i integracje</h1>
          <p className="text-sm text-[#e5e4e2]/50">
            Zarządzaj zewnętrznymi źródłami zdarzeń i przeglądaj przychodzące powiadomienia
          </p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => setTab('sources')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'sources'
                ? 'bg-[#d3bb73] text-[#0a0d1a]'
                : 'bg-[#1c1f33] text-[#e5e4e2]/70 hover:text-[#e5e4e2]'
            }`}
          >
            <Webhook className="h-4 w-4" />
            Źródła ({sources.length})
          </button>
          <button
            onClick={() => setTab('events')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'events'
                ? 'bg-[#d3bb73] text-[#0a0d1a]'
                : 'bg-[#1c1f33] text-[#e5e4e2]/70 hover:text-[#e5e4e2]'
            }`}
          >
            <Radio className="h-4 w-4" />
            Zdarzenia ({events.length})
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-sm text-[#e5e4e2]/70 hover:text-[#e5e4e2]"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          {tab === 'sources' && !schemaMissing && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0a0d1a] hover:bg-[#d3bb73]/90"
            >
              <Plus className="h-4 w-4" />
              Dodaj źródło
            </button>
          )}
        </div>
      </div>

      {schemaMissing ? (
        <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] px-6 py-12 text-center">
          <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-[#d3bb73]" />
          <h3 className="mb-2 text-lg font-semibold text-[#e5e4e2]">
            Tabele webhoków nie zostały jeszcze utworzone
          </h3>
          <p className="mx-auto max-w-xl text-sm leading-relaxed text-[#e5e4e2]/60">
            Uruchom migrację SQL, aby włączyć system webhoków.
          </p>
        </div>
      ) : loading ? (
        <div className="py-16 text-center text-[#e5e4e2]/50">Ładowanie...</div>
      ) : tab === 'sources' ? (
        <SourcesList
          sources={sources}
          onToggle={toggleSourceActive}
          onDelete={deleteSource}
        />
      ) : (
        <EventsLog
          events={events}
          sourceNameMap={sourceNameMap}
          expandedEvent={expandedEvent}
          onToggleExpand={(id) => setExpandedEvent(expandedEvent === id ? null : id)}
        />
      )}

      {showAddModal && (
        <AddSourceModal
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            fetchData();
          }}
          employeeId={employee?.id}
        />
      )}
    </div>
  );
}

function SourcesList({
  sources,
  onToggle,
  onDelete,
}: {
  sources: WebhookSource[];
  onToggle: (s: WebhookSource) => void;
  onDelete: (s: WebhookSource) => void;
}) {
  if (sources.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#d3bb73]/20 py-16 text-center text-[#e5e4e2]/50">
        Brak zarejestrowanych źródeł. Dodaj pierwsze, aby zacząć otrzymywać zdarzenia.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {sources.map((src) => (
        <div
          key={src.id}
          className={`rounded-xl border bg-[#1c1f33] p-4 ${
            src.is_active ? 'border-[#d3bb73]/10' : 'border-red-500/20 opacity-70'
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[#e5e4e2]">{src.name}</span>
                <code className="rounded bg-[#0a0d1a] px-2 py-0.5 text-xs text-[#d3bb73]">
                  {src.slug}
                </code>
                {src.is_active ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                    Aktywne
                  </span>
                ) : (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-400">
                    Wyłączone
                  </span>
                )}
              </div>
              {src.description && (
                <p className="mt-1 text-sm text-[#e5e4e2]/50">{src.description}</p>
              )}
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#e5e4e2]/50">
                <span>
                  Wymagane uprawnienia:{' '}
                  {src.default_notify_permissions.join(', ') || 'brak'}
                </span>
                {src.allowed_event_types && src.allowed_event_types.length > 0 && (
                  <span>Dozwolone typy: {src.allowed_event_types.join(', ')}</span>
                )}
                <span>Utworzono: {new Date(src.created_at).toLocaleDateString('pl-PL')}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onToggle(src)}
                title={src.is_active ? 'Wyłącz' : 'Włącz'}
                className="rounded-lg border border-[#d3bb73]/20 p-2 text-[#e5e4e2]/70 hover:text-[#d3bb73]"
              >
                {src.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                onClick={() => onDelete(src)}
                title="Usuń"
                className="rounded-lg border border-red-500/20 p-2 text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EventsLog({
  events,
  sourceNameMap,
  expandedEvent,
  onToggleExpand,
}: {
  events: InboundEvent[];
  sourceNameMap: Map<string, string>;
  expandedEvent: string | null;
  onToggleExpand: (id: string) => void;
}) {
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#d3bb73]/20 py-16 text-center text-[#e5e4e2]/50">
        Brak odebranych zdarzeń.
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {events.map((evt) => {
        const isExpanded = expandedEvent === evt.id;
        return (
          <div
            key={evt.id}
            className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4"
          >
            <div
              className="flex cursor-pointer items-center gap-3"
              onClick={() => onToggleExpand(evt.id)}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
              ) : (
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-[#e5e4e2]/40" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[#e5e4e2]">{evt.title}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${PRIORITY_COLORS[evt.priority] || PRIORITY_COLORS.normal}`}
                  >
                    {evt.priority}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[evt.status] || STATUS_COLORS.received}`}
                  >
                    {evt.status}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 text-xs text-[#e5e4e2]/50">
                  <span>{sourceNameMap.get(evt.source_id) ?? evt.source_id}</span>
                  <span>Typ: {evt.event_type}</span>
                  <span>{new Date(evt.created_at).toLocaleString('pl-PL')}</span>
                </div>
              </div>
              {evt.detail_url && (
                <a
                  href={evt.detail_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-lg border border-[#d3bb73]/20 p-2 text-[#e5e4e2]/70 hover:text-[#d3bb73]"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>

            {isExpanded && (
              <div className="mt-3 border-t border-[#d3bb73]/10 pt-3">
                {evt.body && (
                  <p className="mb-2 whitespace-pre-wrap text-sm text-[#e5e4e2]/70">{evt.body}</p>
                )}
                <div className="grid gap-2 text-xs text-[#e5e4e2]/50 sm:grid-cols-2">
                  <div>
                    <span className="text-[#e5e4e2]/30">ID zdarzenia:</span> {evt.external_event_id}
                  </div>
                  <div>
                    <span className="text-[#e5e4e2]/30">Czas zdarzenia:</span>{' '}
                    {evt.event_time
                      ? new Date(evt.event_time).toLocaleString('pl-PL')
                      : '—'}
                  </div>
                </div>
                {evt.metadata && Object.keys(evt.metadata).length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-[#d3bb73]/70 hover:text-[#d3bb73]">
                      Metadane
                    </summary>
                    <pre className="mt-1 overflow-x-auto rounded-lg bg-[#0a0d1a] p-3 text-xs text-[#e5e4e2]/60">
                      {JSON.stringify(evt.metadata, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AddSourceModal({
  onClose,
  onSaved,
  employeeId,
}: {
  onClose: () => void;
  onSaved: () => void;
  employeeId?: string;
}) {
  const { showSnackbar } = useSnackbar();
  const [saving, setSaving] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    allowed_event_types: '',
    default_notify_permissions: 'messages_view, messages_manage',
  });

  const slugify = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  const submit = async () => {
    const slug = form.slug.trim() || slugify(form.name);
    if (!form.name.trim() || !slug) {
      showSnackbar('Podaj nazwę i slug źródła', 'error');
      return;
    }
    setSaving(true);

    const apiKey = generateApiKey();
    const keyHash = await sha256Hex(apiKey);

    const allowedTypes = form.allowed_event_types
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const notifyPerms = form.default_notify_permissions
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const { error } = await supabase.from('webhook_sources').insert({
      name: form.name.trim(),
      slug,
      api_key_hash: keyHash,
      is_active: true,
      allowed_event_types: allowedTypes,
      default_notify_permissions: notifyPerms.length > 0 ? notifyPerms : ['messages_view', 'messages_manage'],
      description: form.description.trim() || null,
      created_by: employeeId || null,
    });

    setSaving(false);
    if (error) {
      showSnackbar(
        error.code === '23505'
          ? 'Źródło z takim slugiem już istnieje'
          : 'Nie udało się utworzyć źródła',
        'error',
      );
      return;
    }

    setGeneratedKey(apiKey);
    showSnackbar('Źródło zostało utworzone', 'success');
  };

  const copyKey = async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (generatedKey) {
    return (
      <Modal open onClose={onSaved} title="Klucz API">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            Skopiuj klucz teraz — nie będzie już widoczny!
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg bg-[#0a0d1a] px-3 py-2 text-sm text-[#d3bb73]">
              {generatedKey}
            </code>
            <button
              onClick={copyKey}
              className="flex-shrink-0 rounded-lg border border-[#d3bb73]/20 p-2 text-[#e5e4e2]/70 hover:text-[#d3bb73]"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="mt-4 rounded-lg bg-[#0a0d1a] p-4">
          <p className="mb-2 text-xs font-medium text-[#e5e4e2]/70">Przykład żądania:</p>
          <pre className="overflow-x-auto text-xs leading-relaxed text-[#e5e4e2]/60">{`curl -X POST \\
  ${typeof window !== 'undefined' ? window.location.origin : 'https://your-project.supabase.co'}/functions/v1/receive-webhook \\
  -H "Authorization: Bearer ${generatedKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "source_id": "${form.slug.trim() || slugify(form.name)}",
    "event_type": "contact_form",
    "title": "Nowe zapytanie ze strony",
    "body": "Jan Kowalski (jan@example.com) - Zapytanie o event firmowy",
    "priority": "normal",
    "external_event_id": "form-12345",
    "metadata": { "name": "Jan Kowalski", "email": "jan@example.com" }
  }'`}</pre>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onSaved}
            className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0a0d1a] hover:bg-[#d3bb73]/90"
          >
            Gotowe
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Dodaj nowe źródło">
      <div className="grid gap-4">
        <div>
          <label className={labelClass}>Nazwa źródła *</label>
          <input
            className={inputClass}
            placeholder="np. eventrulers.pl"
            value={form.name}
            onChange={(e) => {
              setForm({
                ...form,
                name: e.target.value,
                slug: form.slug || '',
              });
            }}
          />
        </div>
        <div>
          <label className={labelClass}>Slug (identyfikator maszynowy) *</label>
          <input
            className={inputClass}
            placeholder={slugify(form.name) || 'np. eventrulers-pl'}
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })}
          />
          <p className="mt-1 text-xs text-[#e5e4e2]/40">
            Używany w polu source_id w żądaniach. Tylko małe litery, cyfry i myślniki.
          </p>
        </div>
        <div>
          <label className={labelClass}>Opis (opcjonalnie)</label>
          <textarea
            className={inputClass}
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Dozwolone typy zdarzeń (opcjonalnie, oddzielone przecinkiem)</label>
          <input
            className={inputClass}
            placeholder="np. contact_form, order, payment — puste = wszystkie"
            value={form.allowed_event_types}
            onChange={(e) => setForm({ ...form, allowed_event_types: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Uprawnienia wymagane do dostępu (oddzielone przecinkiem)</label>
          <input
            className={inputClass}
            value={form.default_notify_permissions}
            onChange={(e) => setForm({ ...form, default_notify_permissions: e.target.value })}
          />
          <p className="mt-1 text-xs text-[#e5e4e2]/40">
            To ograniczenie dostępu do danych. Samą subskrypcję dla pracownika i źródła ustawisz
            w profilu pracownika → Uprawnienia. Domyślnie: messages_view, messages_manage
          </p>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={onClose}
          className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]/70 hover:text-[#e5e4e2]"
        >
          Anuluj
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0a0d1a] hover:bg-[#d3bb73]/90 disabled:opacity-50"
        >
          {saving ? 'Tworzenie...' : 'Utwórz i pokaż klucz API'}
        </button>
      </div>
    </Modal>
  );
}
