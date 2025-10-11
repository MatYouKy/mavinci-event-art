'use client';

import { useState, useEffect } from 'react';
import { Shield, Save, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Permissions {
  id?: string;
  employee_id: string;
  can_view_clients: boolean;
  can_edit_clients: boolean;
  can_delete_clients: boolean;
  can_view_events: boolean;
  can_edit_events: boolean;
  can_delete_events: boolean;
  can_view_offers: boolean;
  can_edit_offers: boolean;
  can_delete_offers: boolean;
  can_view_contracts: boolean;
  can_edit_contracts: boolean;
  can_delete_contracts: boolean;
  can_view_equipment: boolean;
  can_edit_equipment: boolean;
  can_delete_equipment: boolean;
  can_view_employees: boolean;
  can_edit_employees: boolean;
  can_delete_employees: boolean;
  can_view_attractions: boolean;
  can_edit_attractions: boolean;
  can_delete_attractions: boolean;
  can_view_tasks: boolean;
  can_edit_tasks: boolean;
  can_delete_tasks: boolean;
  can_view_calendar: boolean;
  can_edit_calendar: boolean;
  can_view_messages: boolean;
  can_edit_messages: boolean;
  can_delete_messages: boolean;
  can_view_financials: boolean;
  can_edit_financials: boolean;
  can_access_settings: boolean;
  can_manage_users: boolean;
}

interface Props {
  employeeId: string;
  isAdmin: boolean;
}

const modules = [
  { key: 'clients', label: 'Klienci' },
  { key: 'events', label: 'Wydarzenia' },
  { key: 'offers', label: 'Oferty' },
  { key: 'contracts', label: 'Umowy' },
  { key: 'equipment', label: 'Sprzęt' },
  { key: 'employees', label: 'Pracownicy' },
  { key: 'attractions', label: 'Atrakcje' },
  { key: 'tasks', label: 'Zadania' },
  { key: 'calendar', label: 'Kalendarz', actions: ['view', 'edit'] },
  { key: 'messages', label: 'Wiadomości' },
  { key: 'financials', label: 'Finanse', actions: ['view', 'edit'] },
];

const specialPermissions = [
  { key: 'can_access_settings', label: 'Dostęp do ustawień' },
  { key: 'can_manage_users', label: 'Zarządzanie użytkownikami' },
];

export default function EmployeePermissionsTab({ employeeId, isAdmin }: Props) {
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    fetchPermissions();
  }, [employeeId]);

  const fetchPermissions = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('employee_permissions')
        .select('*')
        .eq('employee_id', employeeId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setPermissions(data);
      } else {
        setPermissions({
          employee_id: employeeId,
          can_view_clients: false,
          can_edit_clients: false,
          can_delete_clients: false,
          can_view_events: false,
          can_edit_events: false,
          can_delete_events: false,
          can_view_offers: false,
          can_edit_offers: false,
          can_delete_offers: false,
          can_view_contracts: false,
          can_edit_contracts: false,
          can_delete_contracts: false,
          can_view_equipment: false,
          can_edit_equipment: false,
          can_delete_equipment: false,
          can_view_employees: false,
          can_edit_employees: false,
          can_delete_employees: false,
          can_view_attractions: false,
          can_edit_attractions: false,
          can_delete_attractions: false,
          can_view_tasks: false,
          can_edit_tasks: false,
          can_delete_tasks: false,
          can_view_calendar: false,
          can_edit_calendar: false,
          can_view_messages: false,
          can_edit_messages: false,
          can_delete_messages: false,
          can_view_financials: false,
          can_edit_financials: false,
          can_access_settings: false,
          can_manage_users: false,
        });
      }
    } catch (err) {
      console.error('Error fetching permissions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePermissionChange = (key: keyof Permissions, value: boolean) => {
    if (!isAdmin) return;

    setPermissions((prev) => {
      if (!prev) return prev;
      return { ...prev, [key]: value };
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!isAdmin || !permissions) {
      alert('Tylko administrator może zmieniać uprawnienia');
      return;
    }

    try {
      setSaving(true);

      const { id, ...permData } = permissions;

      if (id) {
        const { error } = await supabase
          .from('employee_permissions')
          .update(permData)
          .eq('id', id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('employee_permissions')
          .insert([permData]);

        if (error) throw error;
      }

      setHasChanges(false);
      await fetchPermissions();
      alert('Uprawnienia zostały zapisane');
    } catch (err) {
      console.error('Error saving permissions:', err);
      alert('Błąd podczas zapisywania uprawnień');
    } finally {
      setSaving(false);
    }
  };

  const setAllPermissions = (value: boolean) => {
    if (!isAdmin || !permissions) return;

    const updated = { ...permissions };
    Object.keys(updated).forEach((key) => {
      if (key.startsWith('can_')) {
        (updated as any)[key] = value;
      }
    });
    setPermissions(updated);
    setHasChanges(true);
  };

  if (loading) {
    return <div className="text-[#e5e4e2]/60 text-center py-8">Ładowanie...</div>;
  }

  if (!permissions) {
    return <div className="text-[#e5e4e2]/60 text-center py-8">Błąd ładowania uprawnień</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-light text-[#e5e4e2] flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#d3bb73]" />
            Uprawnienia dostępu
          </h3>
          <p className="text-sm text-[#e5e4e2]/60 mt-1">
            Kontroluj dostęp pracownika do poszczególnych modułów systemu
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAllPermissions(true)}
              className="text-sm text-green-400 hover:text-green-300 px-3 py-1 rounded border border-green-400/30 hover:border-green-400/50"
            >
              Zaznacz wszystkie
            </button>
            <button
              onClick={() => setAllPermissions(false)}
              className="text-sm text-red-400 hover:text-red-300 px-3 py-1 rounded border border-red-400/30 hover:border-red-400/50"
            >
              Odznacz wszystkie
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Zapisywanie...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Zapisz zmiany
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {!isAdmin && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
          <p className="text-yellow-400 text-sm">
            Tylko administrator może edytować uprawnienia pracowników
          </p>
        </div>
      )}

      <div className="space-y-6">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h4 className="text-[#e5e4e2] font-medium mb-4">Moduły systemu</h4>
          <div className="space-y-4">
            {modules.map((module) => {
              const actions = module.actions || ['view', 'edit', 'delete'];
              return (
                <div
                  key={module.key}
                  className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[#e5e4e2] font-medium">{module.label}</span>
                    <div className="flex items-center gap-4">
                      {actions.includes('view') && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={permissions[`can_view_${module.key}` as keyof Permissions] as boolean}
                            onChange={(e) =>
                              handlePermissionChange(
                                `can_view_${module.key}` as keyof Permissions,
                                e.target.checked
                              )
                            }
                            disabled={!isAdmin}
                            className="w-4 h-4"
                          />
                          <span className="text-sm text-[#e5e4e2]/70">Podgląd</span>
                        </label>
                      )}
                      {actions.includes('edit') && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={permissions[`can_edit_${module.key}` as keyof Permissions] as boolean}
                            onChange={(e) =>
                              handlePermissionChange(
                                `can_edit_${module.key}` as keyof Permissions,
                                e.target.checked
                              )
                            }
                            disabled={!isAdmin}
                            className="w-4 h-4"
                          />
                          <span className="text-sm text-[#e5e4e2]/70">Edycja</span>
                        </label>
                      )}
                      {actions.includes('delete') && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={permissions[`can_delete_${module.key}` as keyof Permissions] as boolean}
                            onChange={(e) =>
                              handlePermissionChange(
                                `can_delete_${module.key}` as keyof Permissions,
                                e.target.checked
                              )
                            }
                            disabled={!isAdmin}
                            className="w-4 h-4"
                          />
                          <span className="text-sm text-[#e5e4e2]/70">Usuwanie</span>
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h4 className="text-[#e5e4e2] font-medium mb-4">Uprawnienia specjalne</h4>
          <div className="space-y-3">
            {specialPermissions.map((perm) => (
              <label
                key={perm.key}
                className="flex items-center justify-between bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4 cursor-pointer"
              >
                <span className="text-[#e5e4e2]">{perm.label}</span>
                <input
                  type="checkbox"
                  checked={permissions[perm.key as keyof Permissions] as boolean}
                  onChange={(e) =>
                    handlePermissionChange(perm.key as keyof Permissions, e.target.checked)
                  }
                  disabled={!isAdmin}
                  className="w-5 h-5"
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      {hasChanges && isAdmin && (
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-4">
          <p className="text-orange-400 text-sm">
            Masz niezapisane zmiany. Kliknij "Zapisz zmiany" aby je zastosować.
          </p>
        </div>
      )}
    </div>
  );
}
