'use client';

import { useState, useEffect } from 'react';
import { Shield, Save, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
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
    key: 'attractions',
    label: 'Atrakcje',
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
    key: 'email',
    label: 'Email',
  },
  {
    key: 'mailing',
    label: 'Mailing',
  },
  {
    key: 'subcontractors',
    label: 'Podwykonawcy',
  },
  {
    key: 'fleet',
    label: 'Flota',
  },
  {
    key: 'time_tracking',
    label: 'Śledzenie czasu',
  },
  {
    key: 'financials',
    label: 'Finanse',
  },
  {
    key: 'website',
    label: 'Strona WWW',
    extraPermissions: [
      {
        key: 'website_edit',
        label: 'Edycja strony WWW',
        description: 'Może edytować zawartość strony publicznej (portfolio, usługi, zespół)',
      },
    ],
  },
];

export default function EmployeePermissionsTab({ employeeId, isAdmin, targetEmployeeRole, currentEmployeeId }: Props) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const targetIsAdmin = targetEmployeeRole === 'admin';
  const canEditThisEmployee = isAdmin || (!targetIsAdmin && employeeId !== currentEmployeeId);

  useEffect(() => {
    fetchPermissions();
  }, [employeeId]);

  const fetchPermissions = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('employees')
        .select('permissions')
        .eq('id', employeeId)
        .maybeSingle();

      if (error) throw error;

      setPermissions(data?.permissions || []);
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
      const filtered = prev.filter(
        (p) =>
          p !== `${module}_view` &&
          p !== `${module}_manage`
      );

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
        .update({ permissions })
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
        const extraCount = category.extraPermissions.filter(
          (ep) => permissions.includes(ep.key)
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
        <RefreshCw className="w-6 h-6 text-[#d3bb73] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-[#d3bb73]" />
          <h3 className="text-xl font-light text-[#e5e4e2]">
            Uprawnienia pracownika
          </h3>
        </div>
        {canEditThisEmployee && (
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
          </button>
        )}
      </div>

      {!canEditThisEmployee && targetIsAdmin && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-sm text-red-200">
            Nie możesz edytować uprawnień administratora. Tylko inny administrator może to zrobić.
          </p>
        </div>
      )}

      {!canEditThisEmployee && !targetIsAdmin && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
          <p className="text-sm text-yellow-200">
            Nie masz uprawnień do edycji uprawnień tego pracownika
          </p>
        </div>
      )}

      {canEditThisEmployee && (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#e5e4e2]">Szybkie akcje</span>
            <div className="flex gap-2">
              <button
                onClick={() => setAllPermissions(true)}
                className="text-sm px-3 py-1 bg-green-500/20 text-green-300 rounded hover:bg-green-500/30 transition-colors"
              >
                Zaznacz wszystko
              </button>
              <button
                onClick={() => setAllPermissions(false)}
                className="text-sm px-3 py-1 bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 transition-colors"
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
              className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl overflow-hidden"
            >
              <div
                onClick={() => toggleCategory(category.key)}
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-[#0f1119]/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="w-5 h-5 text-[#d3bb73]" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-[#d3bb73]" />
                  )}
                  <span className="font-medium text-[#e5e4e2]">
                    {category.label}
                  </span>
                  <span className="text-sm text-[#e5e4e2]/60">
                    {getCategoryStatus(category)}
                  </span>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-[#d3bb73]/10 p-4 space-y-4">
                  <div>
                    <label className="block mb-2">
                      <span className="text-sm font-medium text-[#e5e4e2]/80">
                        Poziom dostępu
                      </span>
                    </label>
                    <select
                      value={level}
                      onChange={(e) =>
                        setPermissionLevel(
                          category.key,
                          e.target.value as 'none' | 'view' | 'manage'
                        )
                      }
                      disabled={!canEditThisEmployee}
                      className="w-full px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] text-sm focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="none">Brak</option>
                      <option value="view">Przeglądanie</option>
                      <option value="manage">Zarządzanie</option>
                    </select>
                  </div>

                  {hasManageLevel && category.extraPermissions && category.extraPermissions.length > 0 && (
                    <div className="pt-3 border-t border-[#d3bb73]/10 space-y-3">
                      <div className="text-sm font-medium text-[#e5e4e2]/80 mb-2">
                        Dodatkowe uprawnienia
                      </div>
                      {category.extraPermissions.map((extra) => (
                        <label
                          key={extra.key}
                          className="flex items-start gap-3 cursor-pointer group"
                        >
                          <input
                            type="checkbox"
                            checked={permissions.includes(extra.key)}
                            onChange={() => toggleExtraPermission(extra.key)}
                            disabled={!canEditThisEmployee}
                            className="mt-1 w-4 h-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 focus:ring-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-[#e5e4e2] group-hover:text-[#d3bb73] transition-colors">
                              {extra.label}
                            </div>
                            <div className="text-xs text-[#e5e4e2]/60 mt-0.5">
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
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
          <p className="text-sm text-blue-200">
            Masz niezapisane zmiany. Kliknij "Zapisz zmiany" aby je zachować.
          </p>
        </div>
      )}
    </div>
  );
}
