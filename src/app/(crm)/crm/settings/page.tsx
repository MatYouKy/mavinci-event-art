/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Settings,
  Lock,
  Eye,
  Bell,
  LayoutGrid,
  LayoutList,
  Save,
  RefreshCw,
  Shield,
  Tag,
  ArrowRight,
  Mail,
  Plus,
  List,
  Table2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import ChangePasswordModal from '@/components/crm/ChangePasswordModal';
import AddSystemEmailModal from '@/components/crm/AddSystemEmailModal';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { CalendarSettings } from './calendar-icam/CalendarSettings';

export type ViewMode = 'list' | 'grid' | 'table' | 'timeline';

export interface ViewModePreference {
  viewMode: ViewMode;
}

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  soundEnabled: boolean;
  categories: {
    messages: boolean;
    events: boolean;
    tasks: boolean;
    clients: boolean;
    equipment: boolean;
  };
}

export interface Preferences {
  clients?: ViewModePreference;
  equipment?: ViewModePreference;
  events?: ViewModePreference;
  tasks?: ViewModePreference;
  offers?: ViewModePreference;
  contracts?: ViewModePreference;
  fleet?: ViewModePreference;
  employees?: ViewModePreference;
  notifications?: NotificationPreferences;
}

const modules = [
  { key: 'clients', label: 'Klienci' },
  { key: 'equipment', label: 'Sprzęt' },
  { key: 'events', label: 'Wydarzenia' },
  { key: 'tasks', label: 'Zadania' },
  { key: 'offers', label: 'Oferty' },
  { key: 'contracts', label: 'Umowy' },
  { key: 'fleet', label: 'Flota' },
  { key: 'employees', label: 'Pracownicy' },
];

export default function SettingsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { employee, loading: employeeLoading } = useCurrentEmployee();

  const [activeTab, setActiveTab] = useState<
    'general' | 'password' | 'notifications' | 'system-email' | 'admin'
  >('general');
  const [preferences, setPreferences] = useState<Preferences>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showAddEmailModal, setShowAddEmailModal] = useState(false);
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [systemEmail, setSystemEmail] = useState<string | null>(null);

  useEffect(() => {
    if (employee) {
      fetchPreferences();
      fetchEmailAccounts();
    }
  }, [employee]);

  const fetchPreferences = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('employees')
        .select('preferences')
        .eq('id', employee?.id)
        .single();

      if (error) throw error;

      setPreferences(data?.preferences || {});
    } catch (err) {
      console.error('Error fetching preferences:', err);
      showSnackbar('Błąd podczas wczytywania preferencji', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchEmailAccounts = async () => {
    try {
      const { data, error } = await supabase
        .from('employee_email_accounts')
        .select('id, email_address, account_name, from_name, is_system_account, is_active')
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (error) throw error;

      setEmailAccounts(data || []);
      const systemAccount = data?.find((acc) => acc.is_system_account);
      setSystemEmail(systemAccount?.id || null);
    } catch (err) {
      console.error('Error fetching email accounts:', err);
      showSnackbar('Błąd podczas wczytywania kont email', 'error');
    }
  };

  const saveSystemEmail = async () => {
    if (!systemEmail) {
      showSnackbar('Wybierz konto email', 'error');
      return;
    }

    try {
      setSaving(true);

      await supabase
        .from('employee_email_accounts')
        .update({ is_system_account: false })
        .neq('id', systemEmail);

      const { error } = await supabase
        .from('employee_email_accounts')
        .update({ is_system_account: true })
        .eq('id', systemEmail);

      if (error) throw error;

      showSnackbar('Konto systemowe zostało zaktualizowane', 'success');
      fetchEmailAccounts();
    } catch (err) {
      console.error('Error saving system email:', err);
      showSnackbar('Błąd podczas zapisywania konta systemowego', 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateViewMode = (module: string, viewMode: 'list' | 'grid' | 'table') => {
    setPreferences((prev) => ({
      ...prev,
      [module]: { viewMode },
    }));
  };

  const updateNotificationPreference = (key: keyof NotificationPreferences, value: boolean) => {
    setPreferences((prev) => ({
      ...prev,
      notifications: {
        ...((prev.notifications || {}) as NotificationPreferences),
        [key]: value,
      },
    }));
  };

  const updateNotificationCategory = (category: string, value: boolean) => {
    setPreferences((prev) => ({
      ...prev,
      notifications: {
        ...((prev.notifications || {}) as NotificationPreferences),
        categories: {
          ...((prev.notifications?.categories || {}) as any),
          [category]: value,
        },
      },
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      const { error } = await supabase
        .from('employees')
        .update({ preferences })
        .eq('id', employee?.id);

      if (error) throw error;

      showSnackbar('Ustawienia zostały zapisane', 'success');
    } catch (err) {
      console.error('Error saving preferences:', err);
      showSnackbar('Błąd podczas zapisywania ustawień', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      setSaving(true);

      const { error } = await supabase
        .from('employees')
        .update({ preferences: {} })
        .eq('id', employee?.id);

      if (error) throw error;

      setPreferences({});
      showSnackbar('Ustawienia zostały zresetowane', 'success');
    } catch (err) {
      console.error('Error resetting preferences:', err);
      showSnackbar('Błąd podczas resetowania ustawień', 'error');
    } finally {
      setSaving(false);
    }
  };

  console.log('preferences', preferences);
console.log('employee', employee);
  if (employeeLoading || loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-lg text-[#d3bb73]">Ładowanie ustawień...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#d3bb73]/10">
            <Settings className="h-6 w-6 text-[#d3bb73]" />
          </div>
          <div>
            <h1 className="text-3xl font-light text-[#e5e4e2]">Ustawienia</h1>
            <p className="text-[#e5e4e2]/60">Zarządzaj swoimi preferencjami i kontem</p>
          </div>
        </div>
      </div>

      <div className="mb-6 flex gap-4 border-b border-[#d3bb73]/10">
        <button
          onClick={() => setActiveTab('general')}
          className={`relative px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'general' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4" />
            Preferencje wyświetlania
          </div>
          {activeTab === 'general' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('password')}
          className={`relative px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'password' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
          Dostępy
          </div>
          {activeTab === 'password' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('notifications')}
          className={`relative px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'notifications'
              ? 'text-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Powiadomienia
          </div>
          {activeTab === 'notifications' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
          )}
        </button>

        {employee?.permissions?.includes('admin') && <button
          onClick={() => setActiveTab('system-email')}
          className={`relative px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'system-email'
              ? 'text-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Email systemowy
          </div>
          {activeTab === 'system-email' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
          )}
        </button>
        }
        {employee?.permissions?.includes('admin') && <button
          onClick={() => setActiveTab('admin')}
          className={`relative px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'admin' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Administracja
          </div>
          {activeTab === 'admin' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
          )}
        </button>
        }
      </div>

      {activeTab === 'general' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Domyślny widok list</h3>
            <p className="mb-6 text-sm text-[#e5e4e2]/60">
              Wybierz preferowany sposób wyświetlania dla każdego modułu. Zmiana ustawienia w jednym
              module nie wpłynie na pozostałe.
            </p>

            <div className="space-y-4">
              {modules.map((module) => (
                <div
                  key={module.key}
                  className="flex items-center justify-between rounded-lg bg-[#0f1119] p-4"
                >
                  <span className="text-sm font-medium text-[#e5e4e2]">{module.label}</span>

                  <div className="flex gap-2">
                    <button
                      onClick={() => updateViewMode(module.key, 'list')}
                      className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                        (preferences[module.key as keyof Preferences] as any)?.viewMode === 'list' ||
                        !(preferences[module.key as keyof Preferences] as any)?.viewMode
                          ? 'bg-[#d3bb73] text-[#1c1f33]'
                          : 'bg-[#1c1f33] text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                      }`}
                    >
                      <LayoutList className="h-4 w-4" />
                      Lista
                    </button>

                    <button
                      onClick={() => updateViewMode(module.key, 'grid')}
                      className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                        (preferences[module.key] as any)?.viewMode === 'grid'
                          ? 'bg-[#d3bb73] text-[#1c1f33]'
                          : 'bg-[#1c1f33] text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                      }`}
                    >
                      <LayoutGrid className="h-4 w-4" />
                      Kafelki
                    </button>
                    <button
                      onClick={() => updateViewMode(module.key, 'table')}
                      className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                        (preferences[module.key] as any)?.viewMode === 'table'
                          ? 'bg-[#d3bb73] text-[#1c1f33]'
                          : 'bg-[#1c1f33] text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                      }`}
                    >
                      <Table2 className="h-4 w-4" />
                      Tabela
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
            </button>

            <button
              onClick={handleReset}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-6 py-3 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33] disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              Przywróć domyślne
            </button>
          </div>
        </div>
      )}

      {activeTab === 'password' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Zmiana hasła</h3>
            <p className="mb-6 text-sm text-[#e5e4e2]/60">
              Chroń swoje konto zmieniając hasło regularnie. Twoje nowe hasło musi spełniać
              wymagania bezpieczeństwa.
            </p>

            <button
              onClick={() => setShowPasswordModal(true)}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              <Lock className="h-4 w-4" />
              Zmień hasło
            </button>
          </div>
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Preferencje kalendarza</h3>
            <p className="mb-6 text-sm text-[#e5e4e2]/60">
              Zarządzaj sposobem w jaki otrzymujesz powiadomienia z kalendarza.
            </p>

<CalendarSettings />
          </div>
        </div>
      )}

      {activeTab === 'notifications' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Preferencje powiadomień</h3>
            <p className="mb-6 text-sm text-[#e5e4e2]/60">
              Zarządzaj sposobem w jaki otrzymujesz powiadomienia z systemu
            </p>

            <div className="space-y-6">
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-[#e5e4e2]">Kanały powiadomień</h4>

                <label className="flex cursor-pointer items-center justify-between rounded-lg bg-[#0f1119] p-4 transition-colors hover:bg-[#0f1119]/70">
                  <div>
                    <p className="text-sm font-medium text-[#e5e4e2]">Powiadomienia email</p>
                    <p className="mt-1 text-xs text-[#e5e4e2]/60">
                      Otrzymuj powiadomienia na adres email
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.notifications?.email ?? true}
                    onChange={(e) => updateNotificationPreference('email', e.target.checked)}
                    className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50"
                  />
                </label>

                <label className="flex cursor-pointer items-center justify-between rounded-lg bg-[#0f1119] p-4 transition-colors hover:bg-[#0f1119]/70">
                  <div>
                    <p className="text-sm font-medium text-[#e5e4e2]">Powiadomienia push</p>
                    <p className="mt-1 text-xs text-[#e5e4e2]/60">
                      Otrzymuj powiadomienia w przeglądarce
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.notifications?.push ?? false}
                    onChange={(e) => updateNotificationPreference('push', e.target.checked)}
                    className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50"
                  />
                </label>

                <label className="flex cursor-pointer items-center justify-between rounded-lg bg-[#0f1119] p-4 transition-colors hover:bg-[#0f1119]/70">
                  <div>
                    <p className="text-sm font-medium text-[#e5e4e2]">Dźwięk powiadomień</p>
                    <p className="mt-1 text-xs text-[#e5e4e2]/60">
                      Odtwarzaj krótki dźwięk przy nowych powiadomieniach
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.notifications?.soundEnabled ?? true}
                    onChange={(e) => updateNotificationPreference('soundEnabled', e.target.checked)}
                    className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50"
                  />
                </label>
              </div>

              <div className="h-px bg-[#d3bb73]/10" />

              <div className="space-y-4">
                <h4 className="text-sm font-medium text-[#e5e4e2]">Kategorie powiadomień</h4>

                {[
                  { key: 'messages', label: 'Wiadomości', desc: 'Nowe wiadomości od klientów' },
                  { key: 'events', label: 'Wydarzenia', desc: 'Aktualizacje dotyczące wydarzeń' },
                  { key: 'tasks', label: 'Zadania', desc: 'Przypomnienia o zadaniach' },
                  { key: 'clients', label: 'Klienci', desc: 'Zmiany danych klientów' },
                  { key: 'equipment', label: 'Sprzęt', desc: 'Statusy i dostępność sprzętu' },
                ].map((category) => (
                  <label
                    key={category.key}
                    className="flex cursor-pointer items-center justify-between rounded-lg bg-[#0f1119] p-4 transition-colors hover:bg-[#0f1119]/70"
                  >
                    <div>
                      <p className="text-sm font-medium text-[#e5e4e2]">{category.label}</p>
                      <p className="mt-1 text-xs text-[#e5e4e2]/60">{category.desc}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={
                        preferences.notifications?.categories?.[
                          category.key as keyof NotificationPreferences['categories']
                        ] ?? true
                      }
                      onChange={(e) => updateNotificationCategory(category.key, e.target.checked)}
                      className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
            </button>

            <button
              onClick={handleReset}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-6 py-3 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33] disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              Przywróć domyślne
            </button>
          </div>
        </div>
      )}

      {activeTab === 'system-email' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-light text-[#e5e4e2]">Konto email systemowe</h3>
                <p className="mt-1 text-sm text-[#e5e4e2]/60">
                  Wybierz konto email, które będzie używane do wysyłania automatycznych wiadomości z
                  systemu
                </p>
              </div>
              <button
                onClick={() => setShowAddEmailModal(true)}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                <Plus className="h-4 w-4" />
                Dodaj konto email
              </button>
            </div>

            {emailAccounts.length === 0 ? (
              <div className="py-12 text-center">
                <Mail className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
                <p className="mb-4 text-[#e5e4e2]/60">Brak skonfigurowanych kont email</p>
                <button
                  onClick={() => setShowAddEmailModal(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj pierwsze konto
                </button>
              </div>
            ) : (
              <>
                <div className="mb-6 mt-6 space-y-3">
                  {emailAccounts.map((account) => (
                    <label
                      key={account.id}
                      className="flex cursor-pointer items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 transition-colors hover:bg-[#1c1f33]"
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="system-email"
                          value={account.id}
                          checked={systemEmail === account.id}
                          onChange={(e) => setSystemEmail(e.target.value)}
                          className="h-5 w-5 border-[#d3bb73]/30 text-[#d3bb73] focus:ring-[#d3bb73]/50"
                        />
                        <Mail
                          className={`h-5 w-5 ${systemEmail === account.id ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/40'}`}
                        />
                        <div>
                          <div className="font-medium text-[#e5e4e2]">{account.from_name}</div>
                          <div className="text-xs text-[#e5e4e2]/60">{account.email_address}</div>
                          {account.is_system_account && (
                            <div className="mt-1 text-xs text-[#d3bb73]">
                              Aktywne konto systemowe
                            </div>
                          )}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={saveSystemEmail}
                    disabled={saving || !systemEmail}
                    className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'admin' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Zarządzanie systemem</h3>
            <p className="mb-6 text-sm text-[#e5e4e2]/60">
              Ustawienia dostępne tylko dla administratorów
            </p>

            <div className="space-y-3">
              <button
                onClick={() => router.push('/crm/settings/access-levels')}
                className="flex w-full items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 transition-colors hover:bg-[#1c1f33]"
              >
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-[#d3bb73]" />
                  <div className="text-left">
                    <div className="font-medium text-[#e5e4e2]">Poziomy dostępu</div>
                    <div className="text-xs text-[#e5e4e2]/60">
                      Zarządzaj rolami i uprawnieniami
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-[#e5e4e2]/40" />
              </button>

              <button
                onClick={() => router.push('/crm/settings/skills')}
                className="flex w-full items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 transition-colors hover:bg-[#1c1f33]"
              >
                <div className="flex items-center gap-3">
                  <Tag className="h-5 w-5 text-[#d3bb73]" />
                  <div className="text-left">
                    <div className="font-medium text-[#e5e4e2]">Umiejętności pracowników</div>
                    <div className="text-xs text-[#e5e4e2]/60">
                      Zarządzaj listą umiejętności i kategoriami
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-[#e5e4e2]/40" />
              </button>

              <button
                onClick={() => router.push('/crm/equipment/categories')}
                className="flex w-full items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 transition-colors hover:bg-[#1c1f33]"
              >
                <div className="flex items-center gap-3">
                  <LayoutGrid className="h-5 w-5 text-[#d3bb73]" />
                  <div className="text-left">
                    <div className="font-medium text-[#e5e4e2]">Kategorie sprzętu</div>
                    <div className="text-xs text-[#e5e4e2]/60">
                      Zarządzaj hierarchią kategorii sprzętu
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-[#e5e4e2]/40" />
              </button>

              <button
                onClick={() => router.push('/crm/settings/email-accounts')}
                className="flex w-full items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 transition-colors hover:bg-[#1c1f33]"
              >
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-[#d3bb73]" />
                  <div className="text-left">
                    <div className="font-medium text-[#e5e4e2]">Wszystkie skrzynki email</div>
                    <div className="text-xs text-[#e5e4e2]/60">
                      Panel administratora - zarządzaj wszystkimi wiadomościami
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-[#e5e4e2]/40" />
              </button>

              <button
                onClick={() => router.push('/crm/event-categories')}
                className="flex w-full items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 transition-colors hover:bg-[#1c1f33]"
              >
                <div className="flex items-center gap-3">
                  <LayoutList className="h-5 w-5 text-[#d3bb73]" />
                  <div className="text-left">
                    <div className="font-medium text-[#e5e4e2]">Kategorie wydarzeń</div>
                    <div className="text-xs text-[#e5e4e2]/60">Zarządzaj typami wydarzeń</div>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-[#e5e4e2]/40" />
              </button>

              <button
                onClick={() => router.push('/crm/offers/categories')}
                className="flex w-full items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 transition-colors hover:bg-[#1c1f33]"
              >
                <div className="flex items-center gap-3">
                  <LayoutGrid className="h-5 w-5 text-[#d3bb73]" />
                  <div className="text-left">
                    <div className="font-medium text-[#e5e4e2]">Kategorie produktów ofertowych</div>
                    <div className="text-xs text-[#e5e4e2]/60">
                      Zarządzaj kategoriami produktów w ofercie
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-[#e5e4e2]/40" />
              </button>
            </div>
          </div>
        </div>
      )}

      <ChangePasswordModal isOpen={showPasswordModal} onClose={() => setShowPasswordModal(false)} />

      <AddSystemEmailModal
        isOpen={showAddEmailModal}
        onClose={() => setShowAddEmailModal(false)}
        onSuccess={() => {
          fetchEmailAccounts();
          setShowAddEmailModal(false);
        }}
      />
    </div>
  );
}
