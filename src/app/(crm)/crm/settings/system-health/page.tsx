'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  Database,
  ExternalLink,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';

type ServiceHealth = { key: string; label: string; failed: number; pending: number };
type SystemHealth = { generated_at: string; services: ServiceHealth[] };
type DataQuality = {
  duplicate_contact_emails: number;
  duplicate_contact_phones: number;
  duplicate_organization_nips: number;
  upcoming_events_missing_contact: number;
  upcoming_events_missing_location: number;
  upcoming_events_missing_owner: number;
  inactive_employees_on_future_events: number;
};
type SecurityHealth = {
  tables_without_rls: number;
  public_storage_buckets: number;
  active_employees_without_auth_mapping: number;
  security_definer_without_fixed_search_path: number;
};
type HealthDetailItem = {
  id: string;
  title: string;
  subtitle?: string;
  href?: string;
  sql?: string;
  records?: HealthDetailItem[];
};
type HealthDetails = {
  generated_at: string;
  data_quality: Partial<Record<keyof DataQuality, HealthDetailItem[]>>;
  security: Partial<Record<keyof SecurityHealth, HealthDetailItem[]>>;
};
type AlertSettings = {
  id: string;
  reminder_days: number[];
  payment_reminder_days: number[];
  repeat_overdue_daily: boolean;
  alert_owner: boolean;
  alert_event_managers: boolean;
  alert_admins: boolean;
  is_active: boolean;
};

type IssueDefinition<T extends string> = {
  key: T;
  label: string;
  description: string;
  fix: string;
  actionHref?: string;
  actionLabel?: string;
};

const dataIssues: Array<IssueDefinition<keyof DataQuality>> = [
  { key: 'duplicate_contact_emails', label: 'Powielone adresy e-mail kontaktów', description: 'Kilka kart klienta używa tego samego adresu e-mail.', fix: 'Porównaj historię rekordów, wybierz kartę główną i scal dane albo popraw błędny adres.', actionHref: '/crm/contacts', actionLabel: 'Otwórz kontakty' },
  { key: 'duplicate_contact_phones', label: 'Powielone numery telefonów', description: 'Ten sam numer telefonu występuje na kilku kartach.', fix: 'Sprawdź, czy to duplikat tej samej osoby, numer wspólny firmy czy poprawne powiązanie rodzinne.', actionHref: '/crm/contacts', actionLabel: 'Otwórz kontakty' },
  { key: 'duplicate_organization_nips', label: 'Powielone numery NIP', description: 'Więcej niż jedna organizacja ma ten sam NIP.', fix: 'Zachowaj organizację posiadającą pełną historię i przenieś do niej kontakty oraz aktywności.', actionHref: '/crm/contacts', actionLabel: 'Otwórz organizacje' },
  { key: 'upcoming_events_missing_contact', label: 'Nadchodzące wydarzenia bez klienta', description: 'Wydarzenie w ciągu 60 dni nie ma osoby kontaktowej ani organizacji.', fix: 'Otwórz wydarzenie i przypisz klienta, aby dokumenty, wiadomości i rozliczenia miały właściciela.', actionHref: '/crm/events', actionLabel: 'Otwórz eventy' },
  { key: 'upcoming_events_missing_location', label: 'Nadchodzące wydarzenia bez miejsca', description: 'Wydarzenie w ciągu 60 dni nie ma uzupełnionej lokalizacji.', fix: 'Dodaj miejsce realizacji — jest potrzebne dla logistyki, floty, pracowników i sprzętu.', actionHref: '/crm/events', actionLabel: 'Otwórz eventy' },
  { key: 'upcoming_events_missing_owner', label: 'Nadchodzące wydarzenia bez opiekuna', description: 'Wydarzenie nie ma autora lub właściciela odpowiedzialnego za proces.', fix: 'Przypisz administratora albo właściwego opiekuna sprzedażowego.', actionHref: '/crm/events', actionLabel: 'Otwórz eventy' },
  { key: 'inactive_employees_on_future_events', label: 'Nieaktywni pracownicy w przyszłych wydarzeniach', description: 'Nieaktywny pracownik pozostaje przypisany do przyszłej realizacji.', fix: 'Zastąp go aktywnym pracownikiem i sprawdź zadania, flotę oraz odpowiedzialności.', actionHref: '/crm/employees', actionLabel: 'Otwórz pracowników' },
];

const securityIssues: Array<IssueDefinition<keyof SecurityHealth>> = [
  { key: 'tables_without_rls', label: 'Tabele publiczne bez RLS', description: 'Tabela w schemacie public nie ma włączonego Row Level Security.', fix: 'Najpierw przygotuj polityki dostępu, potem włącz RLS. Samo włączenie bez polityk może odciąć aplikację od danych.' },
  { key: 'public_storage_buckets', label: 'Publiczne buckety plików', description: 'Pliki można pobrać bez zalogowania, jeśli ktoś zna ich adres.', fix: 'Pozostaw publiczne tylko zasoby świadomie publikowane, np. logotypy. Dokumenty CRM przenieś do bucketów prywatnych.', actionHref: '/crm/settings/storage', actionLabel: 'Otwórz magazyn plików' },
  { key: 'active_employees_without_auth_mapping', label: 'Pracownicy bez powiązanego konta', description: 'Aktywny rekord pracownika nie jest jednoznacznie połączony z użytkownikiem logowania.', fix: 'Otwórz pracownika, połącz konto albo oznacz rekord jako nieaktywny, jeżeli nie powinien mieć dostępu.', actionHref: '/crm/employees', actionLabel: 'Otwórz pracowników' },
  { key: 'security_definer_without_fixed_search_path', label: 'Funkcje uprzywilejowane bez stałej ścieżki', description: 'Funkcja SECURITY DEFINER nie ma jawnie ustawionego search_path.', fix: 'Ustaw search_path dla każdej funkcji po sprawdzeniu, z jakich schematów korzysta. Gotowy SQL jest pokazany poniżej.' },
];

const parseDays = (value: string) =>
  Array.from(new Set(value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item >= 0)))
    .sort((a, b) => b - a);

export default function SystemHealthPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { isAdmin, loading: employeeLoading } = useCurrentEmployee();
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [system, setSystem] = useState<SystemHealth | null>(null);
  const [quality, setQuality] = useState<DataQuality | null>(null);
  const [security, setSecurity] = useState<SecurityHealth | null>(null);
  const [details, setDetails] = useState<HealthDetails | null>(null);
  const [detailsAvailable, setDetailsAvailable] = useState(true);
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [eventDays, setEventDays] = useState('30, 14, 7, 3, 1, 0');
  const [paymentDays, setPaymentDays] = useState('14, 7, 3, 1, 0');

  const load = useCallback(async () => {
    setLoading(true);
    const [systemResult, qualityResult, securityResult, settingsResult, detailsResult] = await Promise.all([
      supabase.rpc('get_crm_system_health'),
      supabase.rpc('get_crm_data_quality'),
      supabase.rpc('get_crm_security_health'),
      supabase.from('event_operational_alert_settings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.rpc('get_crm_health_details'),
    ]);

    const firstError = systemResult.error || qualityResult.error || securityResult.error || settingsResult.error;
    if (firstError) {
      if (['42883', '42P01', 'PGRST202', 'PGRST205'].includes(firstError.code ?? '')) setAvailable(false);
      else showSnackbar(`Nie udało się pobrać stanu systemu: ${firstError.message}`, 'error');
      setLoading(false);
      return;
    }

    setSystem(systemResult.data as unknown as SystemHealth);
    setQuality(qualityResult.data as unknown as DataQuality);
    setSecurity(securityResult.data as unknown as SecurityHealth);
    setDetails(detailsResult.error ? null : detailsResult.data as unknown as HealthDetails);
    setDetailsAvailable(!detailsResult.error);
    const alertSettings = settingsResult.data as AlertSettings | null;
    setSettings(alertSettings);
    if (alertSettings) {
      setEventDays(alertSettings.reminder_days.join(', '));
      setPaymentDays(alertSettings.payment_reminder_days.join(', '));
    }
    setLoading(false);
  }, [showSnackbar]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const totalProblems = useMemo(() => {
    const integration = system?.services.reduce((sum, item) => sum + Number(item.failed) + Number(item.pending), 0) ?? 0;
    const data = quality ? Object.values(quality).reduce((sum, item) => sum + Number(item), 0) : 0;
    const securityProblems = security ? Object.values(security).reduce((sum, item) => sum + Number(item), 0) : 0;
    return integration + data + securityProblems;
  }, [quality, security, system]);

  const saveSettings = async () => {
    if (!settings) return;
    const reminderDays = parseDays(eventDays);
    const paymentReminderDays = parseDays(paymentDays);
    if (!reminderDays.length || !paymentReminderDays.length) {
      showSnackbar('Podaj przynajmniej jeden poprawny dzień przypomnienia', 'error');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('event_operational_alert_settings').update({
      reminder_days: reminderDays,
      payment_reminder_days: paymentReminderDays,
      repeat_overdue_daily: settings.repeat_overdue_daily,
      alert_owner: true,
      alert_event_managers: false,
      alert_admins: settings.alert_admins,
      is_active: settings.is_active,
      updated_at: new Date().toISOString(),
    }).eq('id', settings.id);
    setSaving(false);
    if (error) showSnackbar(`Nie udało się zapisać ustawień: ${error.message}`, 'error');
    else {
      showSnackbar('Ustawienia alertów zostały zapisane', 'success');
      void load();
    }
  };

  const supabaseProjectRef = (process.env.NEXT_PUBLIC_SUPABASE_URL || '')
    .replace(/^https?:\/\//, '')
    .split('.')[0];
  const securityAdvisorHref = supabaseProjectRef
    ? `https://supabase.com/dashboard/project/${supabaseProjectRef}/advisors/security`
    : undefined;

  if (employeeLoading) return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>;
  if (!isAdmin) return <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-red-200">Ten obszar jest dostępny wyłącznie dla administratora.</div>;

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/crm/settings?tab=admin')} className="rounded-lg p-2 text-[#e5e4e2]/55 hover:bg-[#1c1f33]"><ArrowLeft className="h-5 w-5" /></button>
          <div><h1 className="text-2xl font-light text-[#e5e4e2]">Stan systemu i jakość danych</h1><p className="text-sm text-[#e5e4e2]/50">Integracje, dane, bezpieczeństwo i alerty operacyjne w jednym miejscu</p></div>
        </div>
        <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#1c1f33] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Odśwież</button>
      </div>

      {!available ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-6 text-amber-100"><h2 className="font-medium">Najpierw wykonaj migrację kontroli operacyjnej</h2><p className="mt-2 text-sm text-amber-100/65">Plik: 20260828130000_complete_event_operational_controls.sql</p></div>
      ) : loading ? (
        <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>
      ) : (
        <>
          <div className={`flex items-center gap-4 rounded-xl border p-5 ${totalProblems ? 'border-amber-500/20 bg-amber-500/5' : 'border-green-500/20 bg-green-500/5'}`}>
            {totalProblems ? <AlertTriangle className="h-8 w-8 text-amber-300" /> : <CheckCircle2 className="h-8 w-8 text-green-400" />}
            <div><div className="text-lg font-medium text-[#e5e4e2]">{totalProblems ? `${totalProblems} obszarów wymaga uwagi` : 'System nie wykrył bieżących problemów'}</div><div className="text-sm text-[#e5e4e2]/50">Krytyczne awarie integracji generują osobne powiadomienie dla administratorów.</div></div>
          </div>

          <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
            <h2 className="mb-4 flex items-center gap-2 font-medium text-[#e5e4e2]"><RefreshCw className="h-5 w-5 text-[#d3bb73]" />Integracje — ostatnie 24 godziny</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {system?.services.map((service) => {
                const healthy = Number(service.failed) === 0 && Number(service.pending) === 0;
                return <div key={service.key} className="rounded-lg border border-[#e5e4e2]/8 bg-[#0f1119] p-4"><div className="flex items-center justify-between gap-2"><span className="text-sm text-[#e5e4e2]">{service.label}</span><span className={`h-2.5 w-2.5 rounded-full ${healthy ? 'bg-green-400' : service.failed ? 'bg-red-400' : 'bg-amber-300'}`} /></div><div className="mt-3 text-xs text-[#e5e4e2]/50">Błędy: <span className={service.failed ? 'text-red-300' : 'text-green-300'}>{service.failed}</span> · Zablokowane: <span className={service.pending ? 'text-amber-300' : 'text-green-300'}>{service.pending}</span></div></div>;
              })}
            </div>
          </section>

          {!detailsAvailable && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-100/75">
              Liczniki działają, ale szczegółowe listy wymagają migracji <span className="font-medium text-amber-100">20260828170000_add_system_health_drilldowns.sql</span>.
            </div>
          )}

          <div className="grid items-start gap-6 xl:grid-cols-2">
            <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <h2 className="mb-4 flex items-center gap-2 font-medium text-[#e5e4e2]"><Database className="h-5 w-5 text-[#d3bb73]" />Jakość danych</h2>
              <div className="space-y-2">
                {quality && dataIssues.map((issue) => (
                  <HealthIssueRow
                    key={issue.key}
                    issue={issue}
                    count={quality[issue.key]}
                    details={details?.data_quality?.[issue.key] || []}
                    severity="warning"
                  />
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <h2 className="mb-4 flex items-center gap-2 font-medium text-[#e5e4e2]"><ShieldCheck className="h-5 w-5 text-[#d3bb73]" />Bezpieczeństwo</h2>
              <div className="space-y-2">
                {security && securityIssues.map((issue) => (
                  <HealthIssueRow
                    key={issue.key}
                    issue={{
                      ...issue,
                      actionHref: issue.actionHref || securityAdvisorHref,
                      actionLabel: issue.actionLabel || (securityAdvisorHref ? 'Otwórz Security Advisor' : undefined),
                    }}
                    count={security[issue.key]}
                    details={details?.security?.[issue.key] || []}
                    severity="danger"
                  />
                ))}
              </div>
            </section>
          </div>

          {settings && <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5"><h2 className="mb-1 font-medium text-[#e5e4e2]">Automatyczne alerty</h2><p className="mb-5 text-sm text-[#e5e4e2]/50">Dni liczone przed wydarzeniem lub terminem płatności. Alert zawsze trafia do autora/opiekuna sprzedażowego wydarzenia.</p><div className="grid gap-4 md:grid-cols-2"><label className="text-sm text-[#e5e4e2]/65">Gotowość wydarzenia<input value={eventDays} onChange={(event) => setEventDays(event.target.value)} className="mt-2 w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50" /></label><label className="text-sm text-[#e5e4e2]/65">Terminy płatności<input value={paymentDays} onChange={(event) => setPaymentDays(event.target.value)} className="mt-2 w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50" /></label></div><div className="mt-4 flex flex-wrap gap-5"><label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70"><input type="checkbox" checked={settings.repeat_overdue_daily} onChange={(event) => setSettings({ ...settings, repeat_overdue_daily: event.target.checked })} />Przypominaj codziennie o zaległych płatnościach</label><label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70"><input type="checkbox" checked={settings.alert_admins} onChange={(event) => setSettings({ ...settings, alert_admins: event.target.checked })} />Powiadamiaj również administratorów</label><label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70"><input type="checkbox" checked={settings.is_active} onChange={(event) => setSettings({ ...settings, is_active: event.target.checked })} />Automatyczne alerty aktywne</label></div><button onClick={saveSettings} disabled={saving} className="mt-5 flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Zapisz ustawienia</button></section>}
        </>
      )}
    </div>
  );
}

function HealthIssueRow({
  issue,
  count,
  details,
  severity,
}: {
  issue: IssueDefinition<string>;
  count: number;
  details: HealthDetailItem[];
  severity: 'warning' | 'danger';
}) {
  const [open, setOpen] = useState(false);
  const [copiedSql, setCopiedSql] = useState<string | null>(null);
  const hasProblem = Number(count) > 0;
  const problemColors = severity === 'danger'
    ? 'bg-red-500/15 text-red-300'
    : 'bg-amber-500/15 text-amber-300';

  const copySql = async (item: HealthDetailItem) => {
    if (!item.sql) return;
    await navigator.clipboard.writeText(item.sql);
    setCopiedSql(item.id);
    window.setTimeout(() => setCopiedSql((current) => current === item.id ? null : current), 1800);
  };

  return (
    <div className={`overflow-hidden rounded-lg border transition-colors ${open ? 'border-[#d3bb73]/20 bg-[#0f1119]' : 'border-transparent bg-[#0f1119]'}`}>
      <button
        type="button"
        onClick={() => hasProblem && setOpen((current) => !current)}
        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${hasProblem ? 'cursor-pointer hover:bg-[#151829]' : 'cursor-default'}`}
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 text-sm text-[#e5e4e2]/70">{issue.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${hasProblem ? problemColors : 'bg-green-500/10 text-green-300'}`}>
          {count}
        </span>
        {hasProblem && <ChevronDown className={`h-4 w-4 text-[#e5e4e2]/35 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>

      {open && (
        <div className="space-y-4 border-t border-[#d3bb73]/10 px-3 pb-4 pt-3">
          <div className="grid gap-3 text-xs sm:grid-cols-2">
            <div className="rounded-lg bg-[#151829] p-3">
              <div className="mb-1 font-medium text-[#e5e4e2]/75">Co wykryto</div>
              <p className="leading-5 text-[#e5e4e2]/50">{issue.description}</p>
            </div>
            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#d3bb73]/5 p-3">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-[#d3bb73]"><Wrench className="h-3.5 w-3.5" />Jak poprawić</div>
              <p className="leading-5 text-[#e5e4e2]/55">{issue.fix}</p>
            </div>
          </div>

          {issue.actionHref && issue.actionLabel && (
            <a
              href={issue.actionHref}
              target={issue.actionHref.startsWith('http') ? '_blank' : undefined}
              rel={issue.actionHref.startsWith('http') ? 'noreferrer' : undefined}
              className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
            >
              {issue.actionLabel}<ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}

          <div className="space-y-2">
            {details.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#d3bb73]/15 px-3 py-5 text-center text-xs text-[#e5e4e2]/35">
                Szczegółowa lista nie jest jeszcze dostępna. Wykonaj migrację drill-down i odśwież ekran.
              </div>
            ) : details.map((item) => (
              <div key={item.id} className="rounded-lg border border-[#e5e4e2]/8 bg-[#151829] p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-sm text-[#e5e4e2]/80">{item.title}</div>
                    {item.subtitle && <div className="mt-1 text-xs leading-5 text-[#e5e4e2]/40">{item.subtitle}</div>}
                  </div>
                  {item.href && (
                    <a href={item.href} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#d3bb73]/15 px-2.5 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10">
                      Otwórz<ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                {item.records && item.records.length > 0 && (
                  <div className="mt-3 divide-y divide-[#e5e4e2]/5 rounded-md border border-[#e5e4e2]/5 bg-[#0f1119]">
                    {item.records.map((record) => (
                      <div key={record.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs text-[#e5e4e2]/70">{record.title}</div>
                          {record.subtitle && <div className="mt-0.5 truncate text-[11px] text-[#e5e4e2]/35">{record.subtitle}</div>}
                        </div>
                        {record.href && <a href={record.href} className="shrink-0 text-[11px] text-[#d3bb73] hover:underline">Sprawdź</a>}
                      </div>
                    ))}
                  </div>
                )}

                {item.sql && (
                  <div className="mt-3 rounded-md border border-[#e5e4e2]/5 bg-[#0a0d1a] p-2.5">
                    <div className="flex items-start gap-2">
                      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-[11px] leading-5 text-[#e5e4e2]/55">{item.sql}</code>
                      <button data-crm-action="secondary" type="button" onClick={() => void copySql(item)} className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] text-[#d3bb73] hover:bg-[#d3bb73]/10">
                        <ClipboardCopy className="h-3 w-3" />{copiedSql === item.id ? 'Skopiowano' : 'Kopiuj SQL'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
