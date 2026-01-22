'use client';

import { useState, useEffect } from 'react';
import { Shield, Save, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { getAllScopes } from '@/lib/permissions';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';

interface Props {
  employeeId: string;
  isAdmin: boolean;
  targetEmployeeRole?: string;
  currentEmployeeId?: string;
}

interface ExtraPermission {
  key: string;
  label: string;
  description: string;
}

interface PermissionCategory {
  key: string;
  label: string;
  extraPermissions?: ExtraPermission[];
}

const availableEventTabs = [
  { value: 'overview', label: 'Przegląd', description: 'Podstawowe informacje o wydarzeniu' },
  { value: 'offer', label: 'Oferta', description: 'Tworzenie i zarządzanie ofertami' },
  { value: 'finances', label: 'Finanse', description: 'Budżet i koszty wydarzenia' },
  { value: 'contract', label: 'Umowa', description: 'Zarządzanie umowami' },
  { value: 'equipment', label: 'Sprzęt', description: 'Lista sprzętu przypisanego do wydarzenia' },
  { value: 'team', label: 'Zespół', description: 'Pracownicy przypisani do wydarzenia' },
  { value: 'agenda', label: 'Agenda', description: 'Zarządzanie agenda wydarzenia' },
  { value: 'logistics', label: 'Logistyka', description: 'Pojazdy i transport' },
  { value: 'subcontractors', label: 'Podwykonawcy', description: 'Zewnętrzni wykonawcy' },
  { value: 'files', label: 'Pliki', description: 'Dokumenty i załączniki' },
  { value: 'tasks', label: 'Zadania', description: 'Zarządzanie zadaniami' },
  { value: 'history', label: 'Historia', description: 'Dziennik zmian wydarzenia' },
];

const availableContactTabs = [
  { value: 'details', label: 'Szczegóły', description: 'Podstawowe informacje o kontakcie' },
  { value: 'notes', label: 'Notatki', description: 'Notatki i uwagi dotyczące kontaktu' },
  { value: 'history', label: 'Historia', description: 'Historia kontaktów i zmian' },
];

const availableOrganizationTabs = [
  { value: 'details', label: 'Szczegóły', description: 'Podstawowe informacje o organizacji' },
  { value: 'contacts', label: 'Kontakty', description: 'Osoby kontaktowe w organizacji' },
  { value: 'invoices', label: 'Faktury', description: 'Faktury powiązane z organizacją' },
  { value: 'events', label: 'Realizacje', description: 'Wydarzenia powiązane z organizacją' },
  { value: 'notes', label: 'Notatki', description: 'Notatki dotyczące organizacji' },
  { value: 'history', label: 'Historia', description: 'Historia zmian i kontaktów' },
];

const permissionCategories: PermissionCategory[] = [
  {
    key: 'equipment',
    label: 'Sprzęt',
  },
  {
    key: 'employees',
    label: 'Pracownicy',
    extraPermissions: [
      {
        key: 'employees_permissions',
        label: 'Uprawnienia',
        description: 'Może zmieniać uprawnienia pracowników',
      },
    ],
  },
  {
    key: 'clients',
    label: 'Klienci',
  },
  {
    key: 'events',
    label: 'Wydarzenia',
    extraPermissions: [
      {
        key: 'event_categories_manage',
        label: 'Zarządzanie kategoriami wydarzeń',
        description: 'Może dodawać, edytować i usuwać kategorie wydarzeń',
      },
    ],
  },
  {
    key: 'calendar',
    label: 'Kalendarz',
  },
  {
    key: 'tasks',
    label: 'Zadania',
  },
  {
    key: 'offers',
    label: 'Oferty',
  },
  {
    key: 'contracts',
    label: 'Umowy',
  },
  {
    key: 'messages',
    label: 'Wiadomości',
    extraPermissions: [
      {
        key: 'messages_assign',
        label: 'Przypisywanie wiadomości',
        description: 'Może przypisywać wiadomości do pracowników',
      },
    ],
  },
  {
    key: 'fleet',
    label: 'Flota',
  },
  {
    key: 'time_tracking',
    label: 'Czas pracy',
  },
  {
    key: 'finances',
    label: 'Faktury',
  },
  {
    key: 'page',
    label: 'Zarządzanie stroną',
  },
  {
    key: 'locations',
    label: 'Lokalizacje',
  },
  {
    key: 'website',
    label: 'Edycja strony WWW',
    extraPermissions: [
      {
        key: 'website_edit',
        label: 'Edycja treści strony',
        description: 'Może edytować zawartość strony publicznej (portfolio, usługi, zespół)',
      },
    ],
  },
];

export default function EmployeePermissionsTab({
  employeeId,
  isAdmin,
  targetEmployeeRole,
  currentEmployeeId,
}: Props) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [eventTabs, setEventTabs] = useState<string[]>([]);
  const [contactTabs, setContactTabs] = useState<string[]>([]);
  const [organizationTabs, setOrganizationTabs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const targetIsAdmin = targetEmployeeRole === 'admin';
  const canEditThisEmployee = isAdmin || (!targetIsAdmin && employeeId !== currentEmployeeId);

  useEffect(() => {
    fetchPermissions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const fetchPermissions = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('employees')
        .select('permissions, event_tabs, contact_tabs, organization_tabs')
        .eq('id', employeeId)
        .maybeSingle();

      if (error) throw error;

      setPermissions(data?.permissions || []);
      setEventTabs(data?.event_tabs || []);
      setContactTabs(data?.contact_tabs || []);
      setOrganizationTabs(data?.organization_tabs || []);
    } catch (err) {
      console.error('Error fetching permissions:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (categoryKey: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(categoryKey)) {
        newSet.delete(categoryKey);
      } else {
        newSet.add(categoryKey);
      }
      return newSet;
    });
  };

  const getPermissionLevel = (module: string): 'none' | 'view' | 'manage' => {
    if (permissions.includes(`${module}_manage`)) return 'manage';
    if (permissions.includes(`${module}_view`)) return 'view';
    return 'none';
  };

  const setPermissionLevel = (module: string, level: 'none' | 'view' | 'manage') => {
    if (!canEditThisEmployee) return;

    setPermissions((prev) => {
      const filtered = prev.filter((p) => p !== `${module}_view` && p !== `${module}_manage`);

      if (level === 'view') {
        return [...filtered, `${module}_view`];
      } else if (level === 'manage') {
        return [...filtered, `${module}_manage`];
      }
      return filtered;
    });
    setHasChanges(true);
  };

  const toggleExtraPermission = (permissionKey: string) => {
    if (!canEditThisEmployee) return;

    setPermissions((prev) => {
      if (prev.includes(permissionKey)) {
        return prev.filter((p) => p !== permissionKey);
      } else {
        return [...prev, permissionKey];
      }
    });
    setHasChanges(true);
  };

  const toggleEventTab = (tabValue: string) => {
    if (!canEditThisEmployee) return;

    setEventTabs((prev) => {
      if (prev.includes(tabValue)) {
        return prev.filter((t) => t !== tabValue);
      } else {
        return [...prev, tabValue];
      }
    });
    setHasChanges(true);
  };

  const toggleContactTab = (tabValue: string) => {
    if (!canEditThisEmployee) return;

    setContactTabs((prev) => {
      if (prev.includes(tabValue)) {
        return prev.filter((t) => t !== tabValue);
      } else {
        return [...prev, tabValue];
      }
    });
    setHasChanges(true);
  };

  const toggleOrganizationTab = (tabValue: string) => {
    if (!canEditThisEmployee) return;

    setOrganizationTabs((prev) => {
      if (prev.includes(tabValue)) {
        return prev.filter((t) => t !== tabValue);
      } else {
        return [...prev, tabValue];
      }
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!canEditThisEmployee) {
      if (targetIsAdmin) {
        showSnackbar('Nie możesz edytować uprawnień administratora', 'error');
      } else {
        showSnackbar('Nie masz uprawnień do edycji', 'error');
      }
      return;
    }

    const confirmed = await showConfirm({
      title: 'Zapisać zmiany?',
      message: 'Czy na pewno chcesz zapisać zmiany w uprawnieniach tego pracownika?',
      confirmText: 'Zapisz',
      cancelText: 'Anuluj',
    });

    if (!confirmed) return;

    try {
      setSaving(true);

      const { error } = await supabase
        .from('employees')
        .update({
          permissions,
          event_tabs: eventTabs.length > 0 ? eventTabs : null,
          contact_tabs: contactTabs.length > 0 ? contactTabs : null,
          organization_tabs: organizationTabs.length > 0 ? organizationTabs : null,
        })
        .eq('id', employeeId);

      if (error) throw error;

      setHasChanges(false);
      showSnackbar('Uprawnienia zostały zapisane', 'success');
    } catch (err) {
      console.error('Error saving permissions:', err);
      showSnackbar('Błąd podczas zapisywania uprawnień', 'error');
    } finally {
      setSaving(false);
    }
  };

  const setAllPermissions = (value: boolean) => {
    if (!canEditThisEmployee) return;

    if (value) {
      setPermissions(getAllScopes());
    } else {
      setPermissions([]);
    }
    setHasChanges(true);
  };

  const getCategoryStatus = (category: PermissionCategory): string => {
    const level = getPermissionLevel(category.key);

    if (level === 'none') return 'Brak';
    if (level === 'view') return 'Przeglądanie';
    if (level === 'manage') {
      if (category.extraPermissions) {
        const extraCount = category.extraPermissions.filter((ep) =>
          permissions.includes(ep.key),
        ).length;
        if (extraCount > 0) {
          return `Zarządzanie + ${extraCount}`;
        }
      }
      return 'Zarządzanie';
    }

    return 'Brak';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-[#d3bb73]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-[#d3bb73]" />
          <h3 className="text-xl font-light text-[#e5e4e2]">Uprawnienia pracownika</h3>
        </div>
        {canEditThisEmployee && (
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
          </button>
        )}
      </div>

      {!canEditThisEmployee && targetIsAdmin && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
          <p className="text-sm text-red-200">
            Nie możesz edytować uprawnień administratora. Tylko inny administrator może to zrobić.
          </p>
        </div>
      )}

      {!canEditThisEmployee && !targetIsAdmin && (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
          <p className="text-sm text-yellow-200">
            Nie masz uprawnień do edycji uprawnień tego pracownika
          </p>
        </div>
      )}

      {canEditThisEmployee && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#e5e4e2]">Szybkie akcje</span>
            <div className="flex gap-2">
              <button
                onClick={() => setAllPermissions(true)}
                className="rounded bg-green-500/20 px-3 py-1 text-sm text-green-300 transition-colors hover:bg-green-500/30"
              >
                Zaznacz wszystko
              </button>
              <button
                onClick={() => setAllPermissions(false)}
                className="rounded bg-red-500/20 px-3 py-1 text-sm text-red-300 transition-colors hover:bg-red-500/30"
              >
                Odznacz wszystko
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {permissionCategories.map((category) => {
          const isExpanded = expandedCategories.has(category.key);
          const level = getPermissionLevel(category.key);
          const hasManageLevel = level === 'manage';

          return (
            <div
              key={category.key}
              className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]"
            >
              <div
                onClick={() => toggleCategory(category.key)}
                className="flex cursor-pointer items-center justify-between p-4 transition-colors hover:bg-[#0f1119]/50"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5 text-[#d3bb73]" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-[#d3bb73]" />
                  )}
                  <span className="font-medium text-[#e5e4e2]">{category.label}</span>
                  <span className="text-sm text-[#e5e4e2]/60">{getCategoryStatus(category)}</span>
                </div>
              </div>

              {isExpanded && (
                <div className="space-y-4 border-t border-[#d3bb73]/10 p-4">
                  <div>
                    <label className="mb-2 block">
                      <span className="text-sm font-medium text-[#e5e4e2]/80">Poziom dostępu</span>
                    </label>
                    <select
                      value={level}
                      onChange={(e) =>
                        setPermissionLevel(
                          category.key,
                          e.target.value as 'none' | 'view' | 'manage',
                        )
                      }
                      disabled={!canEditThisEmployee}
                      className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="none">Brak</option>
                      <option value="view">Przeglądanie</option>
                      <option value="manage">Zarządzanie</option>
                    </select>
                  </div>

                  {category.key === 'events' && level !== 'none' && (
                    <div className="space-y-3 border-t border-[#d3bb73]/10 pt-3">
                      <div className="mb-2 text-sm font-medium text-[#e5e4e2]/80">
                        Dostępne zakładki w wydarzeniach
                        <span className="mt-1 block text-xs font-normal text-[#e5e4e2]/60">
                          Wybierz zakładki, które będą widoczne dla tego pracownika
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        {availableEventTabs.map((tab) => (
                          <label
                            key={tab.value}
                            className="group flex cursor-pointer items-start gap-3 rounded border border-[#d3bb73]/20 bg-[#0f1119] p-2 transition-colors hover:border-[#d3bb73]/40"
                          >
                            <input
                              type="checkbox"
                              checked={eventTabs.includes(tab.value)}
                              onChange={() => toggleEventTab(tab.value)}
                              disabled={!canEditThisEmployee}
                              className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
                                {tab.label}
                              </div>
                              <div className="mt-0.5 text-xs text-[#e5e4e2]/60">
                                {tab.description}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {category.key === 'clients' && level !== 'none' && (
                    <>
                      <div className="space-y-3 border-t border-[#d3bb73]/10 pt-3">
                        <div className="mb-2 text-sm font-medium text-[#e5e4e2]/80">
                          Dostępne zakładki dla kontaktów indywidualnych
                          <span className="mt-1 block text-xs font-normal text-[#e5e4e2]/60">
                            Wybierz zakładki, które będą widoczne w profilu kontaktu
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {availableContactTabs.map((tab) => (
                            <label
                              key={tab.value}
                              className="group flex cursor-pointer items-start gap-3 rounded border border-[#d3bb73]/20 bg-[#0f1119] p-2 transition-colors hover:border-[#d3bb73]/40"
                            >
                              <input
                                type="checkbox"
                                checked={contactTabs.includes(tab.value)}
                                onChange={() => toggleContactTab(tab.value)}
                                disabled={!canEditThisEmployee}
                                className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
                              />
                              <div className="flex-1">
                                <div className="text-sm font-medium text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
                                  {tab.label}
                                </div>
                                <div className="mt-0.5 text-xs text-[#e5e4e2]/60">
                                  {tab.description}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3 border-t border-[#d3bb73]/10 pt-3">
                        <div className="mb-2 text-sm font-medium text-[#e5e4e2]/80">
                          Dostępne zakładki dla organizacji (firm)
                          <span className="mt-1 block text-xs font-normal text-[#e5e4e2]/60">
                            Wybierz zakładki, które będą widoczne w profilu organizacji
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {availableOrganizationTabs.map((tab) => (
                            <label
                              key={tab.value}
                              className="group flex cursor-pointer items-start gap-3 rounded border border-[#d3bb73]/20 bg-[#0f1119] p-2 transition-colors hover:border-[#d3bb73]/40"
                            >
                              <input
                                type="checkbox"
                                checked={organizationTabs.includes(tab.value)}
                                onChange={() => toggleOrganizationTab(tab.value)}
                                disabled={!canEditThisEmployee}
                                className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
                              />
                              <div className="flex-1">
                                <div className="text-sm font-medium text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
                                  {tab.label}
                                </div>
                                <div className="mt-0.5 text-xs text-[#e5e4e2]/60">
                                  {tab.description}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {hasManageLevel &&
                    category.extraPermissions &&
                    category.extraPermissions.length > 0 && (
                      <div className="space-y-3 border-t border-[#d3bb73]/10 pt-3">
                        <div className="mb-2 text-sm font-medium text-[#e5e4e2]/80">
                          Dodatkowe uprawnienia
                        </div>
                        {category.extraPermissions.map((extra) => (
                          <label
                            key={extra.key}
                            className="group flex cursor-pointer items-start gap-3"
                          >
                            <input
                              type="checkbox"
                              checked={permissions.includes(extra.key)}
                              onChange={() => toggleExtraPermission(extra.key)}
                              disabled={!canEditThisEmployee}
                              className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
                                {extra.label}
                              </div>
                              <div className="mt-0.5 text-xs text-[#e5e4e2]/60">
                                {extra.description}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasChanges && canEditThisEmployee && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
          <p className="text-sm text-blue-200">
            Masz niezapisane zmiany. Kliknij &quot;Zapisz zmiany&quot; aby je zachować.
          </p>
        </div>
      )}
    </div>
  );
}
