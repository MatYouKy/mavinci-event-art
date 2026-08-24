'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
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

const dataLabels: Array<[keyof DataQuality, string]> = [
  ['duplicate_contact_emails', 'Powielone adresy e-mail kontaktów'],
  ['duplicate_contact_phones', 'Powielone numery telefonów'],
  ['duplicate_organization_nips', 'Powielone numery NIP'],
  ['upcoming_events_missing_contact', 'Nadchodzące wydarzenia bez klienta'],
  ['upcoming_events_missing_location', 'Nadchodzące wydarzenia bez miejsca'],
  ['upcoming_events_missing_owner', 'Nadchodzące wydarzenia bez opiekuna'],
  ['inactive_employees_on_future_events', 'Nieaktywni pracownicy w przyszłych wydarzeniach'],
];

const securityLabels: Array<[keyof SecurityHealth, string]> = [
  ['tables_without_rls', 'Tabele publiczne bez RLS'],
  ['public_storage_buckets', 'Publiczne buckety plików'],
  ['active_employees_without_auth_mapping', 'Pracownicy bez powiązanego konta'],
  ['security_definer_without_fixed_search_path', 'Funkcje uprzywilejowane bez stałej ścieżki'],
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
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [eventDays, setEventDays] = useState('30, 14, 7, 3, 1, 0');
  const [paymentDays, setPaymentDays] = useState('14, 7, 3, 1, 0');

  const load = useCallback(async () => {
    setLoading(true);
    const [systemResult, qualityResult, securityResult, settingsResult] = await Promise.all([
      supabase.rpc('get_crm_system_health'),
      supabase.rpc('get_crm_data_quality'),
      supabase.rpc('get_crm_security_health'),
      supabase.from('event_operational_alert_settings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
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
    return integration + data;
  }, [quality, system]);

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

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <h2 className="mb-4 flex items-center gap-2 font-medium text-[#e5e4e2]"><Database className="h-5 w-5 text-[#d3bb73]" />Jakość danych</h2>
              <div className="space-y-2">{quality && dataLabels.map(([key, label]) => <div key={key} className="flex items-center justify-between rounded-lg bg-[#0f1119] px-3 py-2.5"><span className="text-sm text-[#e5e4e2]/70">{label}</span><span className={`rounded-full px-2 py-0.5 text-xs ${quality[key] ? 'bg-amber-500/15 text-amber-300' : 'bg-green-500/10 text-green-300'}`}>{quality[key]}</span></div>)}</div>
            </section>
            <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <h2 className="mb-4 flex items-center gap-2 font-medium text-[#e5e4e2]"><ShieldCheck className="h-5 w-5 text-[#d3bb73]" />Bezpieczeństwo</h2>
              <div className="space-y-2">{security && securityLabels.map(([key, label]) => <div key={key} className="flex items-center justify-between rounded-lg bg-[#0f1119] px-3 py-2.5"><span className="text-sm text-[#e5e4e2]/70">{label}</span><span className={`rounded-full px-2 py-0.5 text-xs ${security[key] ? 'bg-red-500/15 text-red-300' : 'bg-green-500/10 text-green-300'}`}>{security[key]}</span></div>)}</div>
            </section>
          </div>

          {settings && <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5"><h2 className="mb-1 font-medium text-[#e5e4e2]">Automatyczne alerty</h2><p className="mb-5 text-sm text-[#e5e4e2]/50">Dni liczone przed wydarzeniem lub terminem płatności. Alert zawsze trafia do autora/opiekuna sprzedażowego wydarzenia.</p><div className="grid gap-4 md:grid-cols-2"><label className="text-sm text-[#e5e4e2]/65">Gotowość wydarzenia<input value={eventDays} onChange={(event) => setEventDays(event.target.value)} className="mt-2 w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50" /></label><label className="text-sm text-[#e5e4e2]/65">Terminy płatności<input value={paymentDays} onChange={(event) => setPaymentDays(event.target.value)} className="mt-2 w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50" /></label></div><div className="mt-4 flex flex-wrap gap-5"><label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70"><input type="checkbox" checked={settings.repeat_overdue_daily} onChange={(event) => setSettings({ ...settings, repeat_overdue_daily: event.target.checked })} />Przypominaj codziennie o zaległych płatnościach</label><label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70"><input type="checkbox" checked={settings.alert_admins} onChange={(event) => setSettings({ ...settings, alert_admins: event.target.checked })} />Powiadamiaj również administratorów</label><label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70"><input type="checkbox" checked={settings.is_active} onChange={(event) => setSettings({ ...settings, is_active: event.target.checked })} />Automatyczne alerty aktywne</label></div><button onClick={saveSettings} disabled={saving} className="mt-5 flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Zapisz ustawienia</button></section>}
        </>
      )}
    </div>
  );
}
