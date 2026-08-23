'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit,
  Plus,
  Save,
  Search,
  Shield,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import {
  ALL_PERMISSION_SCOPES,
  getPermissionDefinition,
  getPermissionLabel,
  PERMISSION_SCOPE_GROUPS,
} from '@/lib/permissionCatalog';
import { supabase } from '@/lib/supabase/browser';

type AccessConfig = Record<string, boolean>;

interface AccessLevel {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  config: AccessConfig;
  default_permissions: string[];
  event_tabs: string[];
  contact_tabs: string[];
  organization_tabs: string[];
  order_index: number;
}

interface AssignedEmployee {
  id: string;
  access_level_id: string | null;
  permissions: string[] | null;
  is_active: boolean | null;
  role: string | null;
}

interface TabDefinition {
  value: string;
  label: string;
  description: string;
}

const defaultAccessConfig: AccessConfig = {
  view_full_event: false,
  view_agenda: false,
  view_files: false,
  view_team: false,
  view_equipment: false,
  view_client_info: false,
  view_budget: false,
  edit_tasks: false,
  manage_equipment: false,
};

const accessConfigLabels: Record<string, { label: string; description: string }> = {
  view_full_event: {
    label: 'Pełny widok wydarzenia',
    description: 'Widzi komplet danych wydarzenia dostępny dla przypisanego członka zespołu.',
  },
  view_agenda: { label: 'Agenda wydarzenia', description: 'Widzi harmonogram i punkty agendy.' },
  view_files: {
    label: 'Pliki wydarzenia',
    description: 'Widzi dozwolone pliki wydarzenia; dokumenty poufne nadal chronią osobne reguły.',
  },
  view_team: { label: 'Zespół wydarzenia', description: 'Widzi osoby przypisane do realizacji.' },
  view_equipment: { label: 'Sprzęt wydarzenia', description: 'Widzi sprzęt przypisany do realizacji.' },
  view_client_info: { label: 'Dane klienta', description: 'Widzi dane kontaktowe klienta w wydarzeniu.' },
  view_budget: { label: 'Budżet wydarzenia', description: 'Widzi wartości finansowe wydarzenia.' },
  edit_tasks: { label: 'Edycja zadań wydarzenia', description: 'Może aktualizować zadania w ramach przypisanej realizacji.' },
  manage_equipment: { label: 'Obsługa sprzętu wydarzenia', description: 'Może zarządzać sprzętem przypisanym do realizacji.' },
};

const availableEventTabs: TabDefinition[] = [
  { value: 'overview', label: 'Przegląd', description: 'Podstawowe informacje o wydarzeniu.' },
  { value: 'details', label: 'Szczegóły', description: 'Pełne dane organizacyjne wydarzenia.' },
  { value: 'phases', label: 'Timeline', description: 'Fazy i przebieg przygotowań.' },
  { value: 'agenda', label: 'Agenda', description: 'Harmonogram realizacji wydarzenia.' },
  { value: 'offer', label: 'Oferta', description: 'Oferta i przypisane produkty.' },
  { value: 'finances', label: 'Finanse', description: 'Budżet, płatności i koszty.' },
  { value: 'contract', label: 'Umowa', description: 'Umowy i ich statusy.' },
  { value: 'equipment', label: 'Sprzęt', description: 'Sprzęt przypisany do wydarzenia.' },
  { value: 'team', label: 'Zespół', description: 'Pracownicy przypisani do wydarzenia.' },
  { value: 'logistics', label: 'Flota', description: 'Pojazdy, kierowcy i transport.' },
  { value: 'subcontractors', label: 'Podwykonawcy', description: 'Zewnętrzni wykonawcy i usługi.' },
  { value: 'files', label: 'Pliki', description: 'Dokumenty i załączniki.' },
  { value: 'tasks', label: 'Zadania', description: 'Zadania powiązane z wydarzeniem.' },
  { value: 'history', label: 'Historia', description: 'Dziennik zmian wydarzenia.' },
  { value: 'mavinci-live', label: 'Mavinci LIVE', description: 'Zawartość interaktywna wymagana przez produkty z oferty.' },
];

const availableContactTabs: TabDefinition[] = [
  { value: 'details', label: 'Szczegóły', description: 'Dane podstawowe i kontaktowe.' },
  { value: 'notes', label: 'Notatki', description: 'Notatki dotyczące kontaktu.' },
  { value: 'history', label: 'Historia', description: 'Historia relacji i zmian.' },
];

const availableOrganizationTabs: TabDefinition[] = [
  { value: 'details', label: 'Szczegóły', description: 'Dane podstawowe organizacji.' },
  { value: 'contacts', label: 'Kontakty', description: 'Osoby kontaktowe organizacji.' },
  { value: 'invoices', label: 'Faktury', description: 'Faktury powiązane z organizacją.' },
  { value: 'events', label: 'Realizacje', description: 'Wydarzenia powiązane z organizacją.' },
  { value: 'notes', label: 'Notatki', description: 'Notatki dotyczące organizacji.' },
  { value: 'history', label: 'Historia', description: 'Historia relacji i zmian.' },
];

const emptyForm = () => ({
  name: '',
  slug: '',
  description: '',
  config: { ...defaultAccessConfig },
  default_permissions: [] as string[],
  event_tabs: ['overview'] as string[],
  contact_tabs: ['details'] as string[],
  organization_tabs: ['details'] as string[],
});

const sameScopeSet = (left: string[], right: string[]) => {
  const a = Array.from(new Set(left)).sort();
  const b = Array.from(new Set(right)).sort();
  return a.length === b.length && a.every((scope, index) => scope === b[index]);
};

const toggleArrayValue = (values: string[], value: string, enabled: boolean) =>
  enabled ? Array.from(new Set([...values, value])) : values.filter((item) => item !== value);

export default function AccessLevelsPage() {
  const [accessLevels, setAccessLevels] = useState<AccessLevel[]>([]);
  const [assignedEmployees, setAssignedEmployees] = useState<AssignedEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingLevel, setEditingLevel] = useState<AccessLevel | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [permissionSearch, setPermissionSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(PERMISSION_SCOPE_GROUPS.map((group) => group.key)),
  );
  const [formData, setFormData] = useState(emptyForm);
  const { showSnackbar } = useSnackbar();
  const { employee, loading: employeeLoading } = useCurrentEmployee();

  const isAdmin = employee?.role === 'admin' || employee?.access_level === 'admin';

  const fetchAccessLevels = async () => {
    try {
      setLoading(true);
      const [levelsResult, employeesResult] = await Promise.all([
        supabase.from('access_levels').select('*').order('order_index'),
        supabase.from('employees').select('id, access_level_id, permissions, is_active, role').eq('is_active', true),
      ]);

      if (levelsResult.error) throw levelsResult.error;
      setAccessLevels(
        (levelsResult.data || []).map((level) => ({
          ...level,
          config: { ...defaultAccessConfig, ...(level.config || {}) },
          default_permissions: level.default_permissions || [],
          event_tabs: level.event_tabs || ['overview'],
          contact_tabs: level.contact_tabs || ['details'],
          organization_tabs: level.organization_tabs || ['details'],
        })) as AccessLevel[],
      );

      if (employeesResult.error) {
        console.error('Error fetching assigned employees:', employeesResult.error);
        setAssignedEmployees([]);
      } else {
        setAssignedEmployees((employeesResult.data || []) as AssignedEmployee[]);
      }
    } catch (error) {
      console.error('Error fetching access levels:', error);
      showSnackbar('Nie udało się pobrać poziomów dostępu', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAccessLevels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const levelStats = useMemo(() => new Map(accessLevels.map((level) => {
    const employees = assignedEmployees.filter((item) => item.access_level_id === level.id);
    const individuallyChanged = employees.filter((item) =>
      item.role !== 'admin' && !sameScopeSet(item.permissions || [], level.default_permissions),
    ).length;
    return [level.id, { assigned: employees.length, individuallyChanged }] as const;
  })), [accessLevels, assignedEmployees]);

  const filteredPermissionGroups = useMemo(() => {
    const query = permissionSearch.trim().toLocaleLowerCase('pl');
    if (!query) return PERMISSION_SCOPE_GROUPS;
    return PERMISSION_SCOPE_GROUPS.map((group) => ({
      ...group,
      scopes: group.scopes.filter((scope) =>
        `${scope.label} ${scope.description} ${scope.key}`.toLocaleLowerCase('pl').includes(query),
      ),
    })).filter((group) => group.scopes.length > 0);
  }, [permissionSearch]);

  const openModal = (level?: AccessLevel) => {
    if (level) {
      setEditingLevel(level);
      setFormData({
        name: level.name,
        slug: level.slug,
        description: level.description || '',
        config: { ...defaultAccessConfig, ...(level.config || {}) },
        default_permissions: [...(level.default_permissions || [])],
        event_tabs: [...(level.event_tabs || ['overview'])],
        contact_tabs: [...(level.contact_tabs || ['details'])],
        organization_tabs: [...(level.organization_tabs || ['details'])],
      });
    } else {
      setEditingLevel(null);
      setFormData(emptyForm());
    }
    setPermissionSearch('');
    setShowModal(true);
  };

  const closeModal = () => {
    if (saving) return;
    setShowModal(false);
    setEditingLevel(null);
  };

  const handleSave = async () => {
    const normalizedName = formData.name.trim();
    const normalizedSlug = formData.slug.trim().toLowerCase();
    if (!normalizedName || !normalizedSlug) {
      showSnackbar('Uzupełnij nazwę i slug poziomu dostępu', 'warning');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(normalizedSlug)) {
      showSnackbar('Slug może zawierać tylko małe litery, cyfry i myślniki', 'warning');
      return;
    }

    const payload = {
      name: normalizedName,
      slug: normalizedSlug,
      description: formData.description.trim() || null,
      config: formData.config,
      default_permissions: Array.from(new Set(formData.default_permissions)),
      event_tabs: Array.from(new Set(formData.event_tabs)),
      contact_tabs: Array.from(new Set(formData.contact_tabs)),
      organization_tabs: Array.from(new Set(formData.organization_tabs)),
    };

    try {
      setSaving(true);
      if (editingLevel) {
        const { error } = await supabase.from('access_levels').update(payload).eq('id', editingLevel.id);
        if (error) throw error;
        showSnackbar('Poziom dostępu został zaktualizowany', 'success');
      } else {
        const { error } = await supabase.from('access_levels').insert({
          ...payload,
          order_index: Math.max(0, ...accessLevels.map((level) => level.order_index || 0)) + 1,
        });
        if (error) throw error;
        showSnackbar('Poziom dostępu został utworzony', 'success');
      }
      setShowModal(false);
      setEditingLevel(null);
      await fetchAccessLevels();
    } catch (error) {
      console.error('Error saving access level:', error);
      showSnackbar('Nie udało się zapisać poziomu dostępu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (level: AccessLevel) => {
    const stats = levelStats.get(level.id);
    if ((stats?.assigned || 0) > 0) {
      showSnackbar('Najpierw przypisz pracownikom inny poziom dostępu', 'warning');
      return;
    }
    if (!window.confirm(`Usunąć poziom „${level.name}”?`)) return;

    const { error } = await supabase.from('access_levels').delete().eq('id', level.id);
    if (error) {
      console.error('Error deleting access level:', error);
      showSnackbar('Nie udało się usunąć poziomu dostępu', 'error');
      return;
    }
    showSnackbar('Poziom dostępu został usunięty', 'success');
    await fetchAccessLevels();
  };

  const togglePermission = (scope: string, enabled: boolean) => {
    setFormData((current) => ({
      ...current,
      default_permissions: toggleArrayValue(current.default_permissions, scope, enabled),
    }));
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderTabSelector = (
    title: string,
    description: string,
    definitions: TabDefinition[],
    field: 'event_tabs' | 'contact_tabs' | 'organization_tabs',
  ) => (
    <section className="rounded-xl border border-[#d3bb73]/15 bg-[#0f1119]/55 p-4">
      <h3 className="text-sm font-medium text-[#e5e4e2]">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/45">{description}</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {definitions.map((tab) => {
          const checked = formData[field].includes(tab.value);
          return (
            <label key={tab.value} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${checked ? 'border-blue-400/35 bg-blue-400/10' : 'border-[#d3bb73]/10 bg-[#0f1119]'}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => setFormData((current) => ({
                  ...current,
                  [field]: toggleArrayValue(current[field], tab.value, event.target.checked),
                }))}
                className="mt-0.5 h-4 w-4"
              />
              <span><span className="block text-sm text-[#e5e4e2]">{tab.label}</span><span className="mt-1 block text-xs leading-4 text-[#e5e4e2]/40">{tab.description}</span></span>
            </label>
          );
        })}
      </div>
    </section>
  );

  if (employeeLoading || loading) {
    return <div className="flex min-h-[45vh] items-center justify-center text-[#e5e4e2]/60">Ładowanie poziomów dostępu…</div>;
  }

  if (!employee || !isAdmin) {
    return <div className="flex min-h-[45vh] items-center justify-center text-[#e5e4e2]/60">Brak dostępu</div>;
  }

  return (
    <main className="min-h-screen bg-[#0f1119] p-4 text-[#e5e4e2] md:p-6">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-[#d3bb73]"><Shield className="h-4 w-4" /> Bezpieczeństwo i dostęp</div>
            <h1 className="text-2xl font-light md:text-3xl">Poziomy dostępu</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#e5e4e2]/50">
              Poziom jest szablonem zakresów i widoczności zakładek. Faktyczny dostęp pracownika wynika z jego zapisanych uprawnień, a administrator zawsze ma pełny dostęp.
            </p>
          </div>
          <ResponsiveActionBar disabledBackground actions={[{ label: 'Dodaj poziom', icon: <Plus className="h-4 w-4" />, onClick: () => openModal(), variant: 'primary' }]} />
        </header>

        <div className="rounded-xl border border-blue-400/20 bg-blue-400/10 p-4 text-sm text-blue-100/80">
          <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" /><div><strong className="font-medium text-blue-100">Zakres bazowy i wyjątki indywidualne</strong><p className="mt-1 leading-5">Zmiana poziomu nie ukrywa indywidualnych różnic pracowników. Licznik na każdej karcie pokazuje, ilu pracowników ma zapisany zakres inny niż szablon poziomu.</p></div></div>
        </div>

        <section className="grid gap-4">
          {accessLevels.map((level) => {
            const stats = levelStats.get(level.id) || { assigned: 0, individuallyChanged: 0 };
            const enabledConfig = Object.entries(level.config || {}).filter(([, enabled]) => enabled);
            const knownPermissions = level.default_permissions.filter((scope) => getPermissionDefinition(scope));
            const unknownPermissions = level.default_permissions.filter((scope) => !getPermissionDefinition(scope));

            return (
              <article key={level.id} className="rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-4 md:p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-medium">{level.name}</h2><code className="rounded bg-[#0f1119] px-2 py-1 text-[11px] text-[#d3bb73]">{level.slug}</code></div>
                    <p className="mt-2 max-w-3xl text-sm leading-5 text-[#e5e4e2]/50">{level.description || 'Brak opisu poziomu.'}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d3bb73]/15 bg-[#0f1119] px-2.5 py-1 text-[#e5e4e2]/65"><Users className="h-3.5 w-3.5" /> {stats.assigned} {stats.assigned === 1 ? 'pracownik' : 'pracowników'}</span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${stats.individuallyChanged > 0 ? 'border-amber-400/25 bg-amber-400/10 text-amber-300' : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'}`}>{stats.individuallyChanged > 0 ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{stats.individuallyChanged > 0 ? `${stats.individuallyChanged} z indywidualnym zakresem` : 'Zakresy zgodne z szablonem'}</span>
                    </div>
                  </div>
                  <ResponsiveActionBar disabledBackground compact actions={[
                    { label: 'Edytuj', icon: <Edit className="h-4 w-4" />, onClick: () => openModal(level) },
                    { label: 'Usuń', icon: <Trash2 className="h-4 w-4" />, onClick: () => void handleDelete(level), variant: 'danger', disabled: stats.assigned > 0 },
                  ]} />
                </div>

                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]/55 p-4">
                    <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/50">Bazowe zakresy systemowe</h3><span className="text-xs text-[#d3bb73]">{level.default_permissions.length}</span></div>
                    {level.default_permissions.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{knownPermissions.map((scope) => <span key={scope} title={getPermissionDefinition(scope)?.description} className="rounded-md border border-[#d3bb73]/15 bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73]">{getPermissionLabel(scope)}</span>)}{unknownPermissions.map((scope) => <span key={scope} title="Zakres istnieje w danych, ale nie ma opisu w aktualnym katalogu" className="rounded-md border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-xs text-amber-300">{scope}</span>)}</div> : <p className="mt-3 text-sm text-[#e5e4e2]/35">Brak bazowych zakresów systemowych.</p>}
                  </div>

                  <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]/55 p-4">
                    <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/50">Widoczność w wydarzeniu</h3><span className="text-xs text-blue-300">{level.event_tabs.length} zakładek</span></div>
                    {enabledConfig.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{enabledConfig.map(([key]) => <span key={key} title={accessConfigLabels[key]?.description} className="rounded-md border border-emerald-400/15 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-300">{accessConfigLabels[key]?.label || key.replace(/_/g, ' ')}</span>)}</div>}
                    <div className="mt-3 flex flex-wrap gap-2">{level.event_tabs.map((tab) => <span key={tab} className="rounded-md border border-blue-400/15 bg-blue-400/10 px-2 py-1 text-xs text-blue-300">{availableEventTabs.find((item) => item.value === tab)?.label || tab}</span>)}</div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div><div className="mb-2 text-xs text-[#e5e4e2]/40">Zakładki kontaktu</div><div className="flex flex-wrap gap-2">{level.contact_tabs.map((tab) => <span key={tab} className="rounded bg-violet-400/10 px-2 py-1 text-xs text-violet-300">{availableContactTabs.find((item) => item.value === tab)?.label || tab}</span>)}</div></div>
                  <div><div className="mb-2 text-xs text-[#e5e4e2]/40">Zakładki organizacji</div><div className="flex flex-wrap gap-2">{level.organization_tabs.map((tab) => <span key={tab} className="rounded bg-sky-400/10 px-2 py-1 text-xs text-sky-300">{availableOrganizationTabs.find((item) => item.value === tab)?.label || tab}</span>)}</div></div>
                </div>
              </article>
            );
          })}
          {accessLevels.length === 0 && <div className="rounded-xl border border-dashed border-[#d3bb73]/20 p-10 text-center text-sm text-[#e5e4e2]/40">Nie utworzono jeszcze poziomów dostępu.</div>}
        </section>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 md:p-6">
          <div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-xl border border-[#d3bb73]/25 bg-[#1c1f33] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#d3bb73]/15 bg-[#1c1f33] p-4 md:p-6">
              <div><h2 className="text-xl font-light">{editingLevel ? 'Edytuj poziom dostępu' : 'Nowy poziom dostępu'}</h2><p className="mt-1 text-xs text-[#e5e4e2]/45">Zakresy odpowiadają kluczom faktycznie używanym przez CRM.</p></div>
              <button type="button" onClick={closeModal} disabled={saving} className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-white/5 hover:text-[#e5e4e2] disabled:opacity-40" aria-label="Zamknij"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-6 p-4 md:p-6">
              <section className="grid gap-4 md:grid-cols-2">
                <label><span className="mb-2 block text-xs text-[#e5e4e2]/50">Nazwa poziomu</span><input value={formData.name} onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2.5 text-sm outline-none focus:border-[#d3bb73]/50" /></label>
                <label><span className="mb-2 block text-xs text-[#e5e4e2]/50">Slug techniczny</span><input value={formData.slug} onChange={(event) => setFormData((current) => ({ ...current, slug: event.target.value }))} placeholder="np. sales-manager" className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2.5 text-sm outline-none focus:border-[#d3bb73]/50" /></label>
                <label className="md:col-span-2"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Opis</span><textarea value={formData.description} onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))} rows={3} className="w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2.5 text-sm outline-none focus:border-[#d3bb73]/50" /></label>
              </section>

              <section className="rounded-xl border border-[#d3bb73]/15 bg-[#0f1119]/55 p-4">
                <div><h3 className="text-sm font-medium">Widoczność i czynności w przypisanym wydarzeniu</h3><p className="mt-1 text-xs leading-5 text-[#e5e4e2]/45">Te ustawienia uzupełniają zakresy systemowe dla pracownika przypisanego do konkretnego wydarzenia.</p></div>
                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{Object.keys(formData.config).map((key) => { const definition = accessConfigLabels[key]; const checked = Boolean(formData.config[key]); return <label key={key} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${checked ? 'border-emerald-400/25 bg-emerald-400/10' : 'border-[#d3bb73]/10 bg-[#0f1119]'}`}><input type="checkbox" checked={checked} onChange={(event) => setFormData((current) => ({ ...current, config: { ...current.config, [key]: event.target.checked } }))} className="mt-0.5 h-4 w-4" /><span><span className="block text-sm">{definition?.label || key.replace(/_/g, ' ')}</span><span className="mt-1 block text-xs leading-4 text-[#e5e4e2]/40">{definition?.description || 'Dodatkowe ustawienie widoczności.'}</span></span></label>; })}</div>
              </section>

              <section className="rounded-xl border border-[#d3bb73]/15 bg-[#0f1119]/55 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div><h3 className="text-sm font-medium">Bazowe zakresy systemowe</h3><p className="mt-1 text-xs leading-5 text-[#e5e4e2]/45">Wybrano {formData.default_permissions.length} z {ALL_PERMISSION_SCOPES.length} opisanych zakresów.</p></div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <label className="relative block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/35" /><input value={permissionSearch} onChange={(event) => setPermissionSearch(event.target.value)} placeholder="Szukaj zakresu…" className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] py-2 pl-9 pr-3 text-sm outline-none focus:border-[#d3bb73]/45 sm:w-64" /></label>
                    <button type="button" onClick={() => setFormData((current) => ({ ...current, default_permissions: [...ALL_PERMISSION_SCOPES] }))} className="rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10">Zaznacz wszystkie</button>
                    <button type="button" onClick={() => setFormData((current) => ({ ...current, default_permissions: [] }))} className="rounded-lg border border-[#d3bb73]/10 px-3 py-2 text-xs text-[#e5e4e2]/55 hover:bg-white/5">Wyczyść</button>
                  </div>
                </div>

                <div className="mt-4 space-y-2">{filteredPermissionGroups.map((group) => { const expanded = Boolean(permissionSearch.trim()) || expandedGroups.has(group.key); const selectedCount = group.scopes.filter((scope) => formData.default_permissions.includes(scope.key)).length; return <div key={group.key} className="overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]"><button type="button" onClick={() => toggleGroup(group.key)} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"><span className="flex min-w-0 items-center gap-3">{expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-[#d3bb73]" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[#d3bb73]" />}<span><span className="block text-sm">{group.label}</span><span className="mt-0.5 block text-xs text-[#e5e4e2]/40">{group.description}</span></span></span><span className="shrink-0 rounded-full bg-[#d3bb73]/10 px-2 py-1 text-[11px] text-[#d3bb73]">{selectedCount}/{group.scopes.length}</span></button>{expanded && <div className="grid gap-2 border-t border-[#d3bb73]/10 p-3 md:grid-cols-2">{group.scopes.map((scope) => { const checked = formData.default_permissions.includes(scope.key); return <label key={scope.key} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${checked ? 'border-[#d3bb73]/30 bg-[#d3bb73]/10' : 'border-[#d3bb73]/10'}`}><input type="checkbox" checked={checked} onChange={(event) => togglePermission(scope.key, event.target.checked)} className="mt-0.5 h-4 w-4" /><span className="min-w-0"><span className="block text-sm">{scope.label}</span><span className="mt-1 block text-xs leading-4 text-[#e5e4e2]/40">{scope.description}</span><code className="mt-1.5 block truncate text-[10px] text-[#d3bb73]/55">{scope.key}</code></span></label>; })}</div>}</div>; })}{filteredPermissionGroups.length === 0 && <div className="py-8 text-center text-sm text-[#e5e4e2]/40">Nie znaleziono takiego zakresu.</div>}</div>

                {formData.default_permissions.some((scope) => !getPermissionDefinition(scope)) && <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-200"><strong className="font-medium">Nieopisane starsze zakresy:</strong> {formData.default_permissions.filter((scope) => !getPermissionDefinition(scope)).join(', ')}. Zostaną zachowane przy zapisie.</div>}
              </section>

              {renderTabSelector('Zakładki wydarzenia', 'Widoczne w szczegółach wydarzenia, o ile dodatkowe reguły bezpieczeństwa nie ograniczają danych.', availableEventTabs, 'event_tabs')}
              <div className="grid gap-4 xl:grid-cols-2">
                {renderTabSelector('Zakładki kontaktu', 'Domyślna widoczność na karcie osoby kontaktowej.', availableContactTabs, 'contact_tabs')}
                {renderTabSelector('Zakładki organizacji', 'Domyślna widoczność na karcie organizacji.', availableOrganizationTabs, 'organization_tabs')}
              </div>
            </div>

            <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-[#d3bb73]/15 bg-[#1c1f33] p-4 sm:flex-row sm:justify-end md:px-6">
              <button type="button" onClick={closeModal} disabled={saving} className="rounded-lg border border-[#d3bb73]/15 px-5 py-2.5 text-sm text-[#e5e4e2]/70 hover:bg-white/5 disabled:opacity-40">Anuluj</button>
              <button type="button" onClick={() => void handleSave()} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-2.5 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-40"><Save className="h-4 w-4" /> {saving ? 'Zapisywanie…' : 'Zapisz poziom'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
