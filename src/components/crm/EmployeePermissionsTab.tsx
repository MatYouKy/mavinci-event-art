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
}

interface PermissionCategory {
  key: string;
  label: string;
  permissions: {
    key: string;
    label: string;
    description?: string;
  }[];
}

const permissionCategories: PermissionCategory[] = [
  {
    key: 'equipment',
    label: 'Sprzęt',
    permissions: [
      { key: 'equipment_view', label: 'Przeglądanie', description: 'Może przeglądać listę sprzętu' },
      { key: 'equipment_create', label: 'Tworzenie', description: 'Może dodawać nowy sprzęt' },
      { key: 'equipment_manage', label: 'Zarządzanie', description: 'Może edytować i usuwać sprzęt' },
    ],
  },
  {
    key: 'employees',
    label: 'Pracownicy',
    permissions: [
      { key: 'employees_view', label: 'Przeglądanie', description: 'Może przeglądać listę pracowników' },
      { key: 'employees_create', label: 'Tworzenie', description: 'Może dodawać nowych pracowników' },
      { key: 'employees_manage', label: 'Zarządzanie', description: 'Może edytować i usuwać pracowników' },
      { key: 'employees_permissions', label: 'Uprawnienia', description: 'Może zmieniać uprawnienia pracowników' },
    ],
  },
  {
    key: 'clients',
    label: 'Klienci',
    permissions: [
      { key: 'clients_view', label: 'Przeglądanie', description: 'Może przeglądać listę klientów' },
      { key: 'clients_create', label: 'Tworzenie', description: 'Może dodawać nowych klientów' },
      { key: 'clients_manage', label: 'Zarządzanie', description: 'Może edytować i usuwać klientów' },
    ],
  },
  {
    key: 'events',
    label: 'Wydarzenia',
    permissions: [
      { key: 'events_view', label: 'Przeglądanie', description: 'Może przeglądać wydarzenia' },
      { key: 'events_create', label: 'Tworzenie', description: 'Może tworzyć nowe wydarzenia' },
      { key: 'events_manage', label: 'Zarządzanie', description: 'Może edytować i usuwać wydarzenia' },
    ],
  },
  {
    key: 'calendar',
    label: 'Kalendarz',
    permissions: [
      { key: 'calendar_view', label: 'Przeglądanie', description: 'Może przeglądać kalendarz' },
      { key: 'calendar_manage', label: 'Zarządzanie', description: 'Może zarządzać kalendarzem' },
    ],
  },
  {
    key: 'tasks',
    label: 'Zadania',
    permissions: [
      { key: 'tasks_view', label: 'Przeglądanie', description: 'Może przeglądać zadania' },
      { key: 'tasks_create', label: 'Tworzenie', description: 'Może tworzyć nowe zadania' },
      { key: 'tasks_manage', label: 'Zarządzanie', description: 'Może edytować i usuwać zadania' },
    ],
  },
  {
    key: 'offers',
    label: 'Oferty',
    permissions: [
      { key: 'offers_view', label: 'Przeglądanie', description: 'Może przeglądać oferty' },
      { key: 'offers_create', label: 'Tworzenie', description: 'Może tworzyć nowe oferty' },
      { key: 'offers_manage', label: 'Zarządzanie', description: 'Może edytować i usuwać oferty' },
    ],
  },
  {
    key: 'contracts',
    label: 'Umowy',
    permissions: [
      { key: 'contracts_view', label: 'Przeglądanie', description: 'Może przeglądać umowy' },
      { key: 'contracts_create', label: 'Tworzenie', description: 'Może tworzyć nowe umowy' },
      { key: 'contracts_manage', label: 'Zarządzanie', description: 'Może edytować i usuwać umowy' },
    ],
  },
  {
    key: 'attractions',
    label: 'Atrakcje',
    permissions: [
      { key: 'attractions_view', label: 'Przeglądanie', description: 'Może przeglądać atrakcje' },
      { key: 'attractions_create', label: 'Tworzenie', description: 'Może dodawać nowe atrakcje' },
      { key: 'attractions_manage', label: 'Zarządzanie', description: 'Może edytować i usuwać atrakcje' },
    ],
  },
  {
    key: 'messages',
    label: 'Wiadomości',
    permissions: [
      { key: 'messages_view', label: 'Przeglądanie', description: 'Może przeglądać wiadomości' },
      { key: 'messages_manage', label: 'Zarządzanie', description: 'Może zarządzać wiadomościami' },
      { key: 'messages_assign', label: 'Przypisywanie', description: 'Może przypisywać wiadomości do pracowników' },
    ],
  },
  {
    key: 'financials',
    label: 'Finanse',
    permissions: [
      { key: 'financials_view', label: 'Przeglądanie', description: 'Może przeglądać dane finansowe' },
      { key: 'financials_manage', label: 'Zarządzanie', description: 'Może zarządzać finansami' },
    ],
  },
];

export default function EmployeePermissionsTab({ employeeId, isAdmin }: Props) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

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

  const togglePermission = (permissionKey: string) => {
    if (!isAdmin) return;

    setPermissions((prev) => {
      if (prev.includes(permissionKey)) {
        return prev.filter((p) => p !== permissionKey);
      } else {
        return [...prev, permissionKey];
      }
    });
    setHasChanges(true);
  };

  const toggleAllInCategory = (category: PermissionCategory, enable: boolean) => {
    if (!isAdmin) return;

    const categoryPermissions = category.permissions.map((p) => p.key);

    setPermissions((prev) => {
      if (enable) {
        const newPerms = new Set([...prev, ...categoryPermissions]);
        return Array.from(newPerms);
      } else {
        return prev.filter((p) => !categoryPermissions.includes(p));
      }
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!isAdmin) {
      showSnackbar('Tylko administrator może zmieniać uprawnienia', 'error');
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
    if (!isAdmin) return;

    if (value) {
      setPermissions(getAllScopes());
    } else {
      setPermissions([]);
    }
    setHasChanges(true);
  };

  const getCategoryStats = (category: PermissionCategory) => {
    const total = category.permissions.length;
    const enabled = category.permissions.filter((p) => permissions.includes(p.key)).length;
    return { total, enabled };
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
        {isAdmin && (
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

      {!isAdmin && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
          <p className="text-sm text-yellow-200">
            Tylko administrator może edytować uprawnienia pracowników
          </p>
        </div>
      )}

      {isAdmin && (
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
          const stats = getCategoryStats(category);

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
                    ({stats.enabled}/{stats.total})
                  </span>
                </div>
                {isAdmin && (
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleAllInCategory(category, true)}
                      className="text-xs px-2 py-1 bg-green-500/20 text-green-300 rounded hover:bg-green-500/30 transition-colors"
                    >
                      Wszystkie
                    </button>
                    <button
                      onClick={() => toggleAllInCategory(category, false)}
                      className="text-xs px-2 py-1 bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 transition-colors"
                    >
                      Żadne
                    </button>
                  </div>
                )}
              </div>

              {isExpanded && (
                <div className="border-t border-[#d3bb73]/10 p-4 space-y-3">
                  {category.permissions.map((permission) => (
                    <label
                      key={permission.key}
                      className="flex items-start gap-3 cursor-pointer group"
                    >
                      <input
                        type="checkbox"
                        checked={permissions.includes(permission.key)}
                        onChange={() => togglePermission(permission.key)}
                        disabled={!isAdmin}
                        className="mt-1 w-4 h-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 focus:ring-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-[#e5e4e2] group-hover:text-[#d3bb73] transition-colors">
                          {permission.label}
                        </div>
                        {permission.description && (
                          <div className="text-xs text-[#e5e4e2]/60 mt-0.5">
                            {permission.description}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasChanges && isAdmin && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
          <p className="text-sm text-blue-200">
            Masz niezapisane zmiany. Kliknij "Zapisz zmiany" aby je zachować.
          </p>
        </div>
      )}
    </div>
  );
}
