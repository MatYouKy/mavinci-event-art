'use client';

import { useState, useEffect } from 'react';
import { Shield, Save, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { MODULES, getAllScopes } from '@/lib/permissions';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';

interface Props {
  employeeId: string;
  isAdmin: boolean;
}

interface Module {
  key: string;
  label: string;
}

const modules: Module[] = [
  { key: 'equipment', label: 'Sprzęt' },
  { key: 'employees', label: 'Pracownicy' },
  { key: 'clients', label: 'Klienci' },
  { key: 'events', label: 'Wydarzenia' },
  { key: 'calendar', label: 'Kalendarz' },
  { key: 'tasks', label: 'Zadania' },
  { key: 'offers', label: 'Oferty' },
  { key: 'contracts', label: 'Umowy' },
  { key: 'attractions', label: 'Atrakcje' },
  { key: 'messages', label: 'Wiadomości' },
  { key: 'financials', label: 'Finanse' },
];

export default function EmployeePermissionsTab({ employeeId, isAdmin }: Props) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const [permissions, setPermissions] = useState<string[]>([]);
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

  const hasScope = (scope: string): boolean => {
    return permissions.includes(scope);
  };

  const getPermissionLevel = (module: string): 'none' | 'view' | 'manage' => {
    if (permissions.includes(`${module}_manage`)) return 'manage';
    if (permissions.includes(`${module}_view`)) return 'view';
    return 'none';
  };

  const setPermissionLevel = (module: string, level: 'none' | 'view' | 'manage') => {
    if (!isAdmin) return;

    setPermissions(prev => {
      const filtered = prev.filter(
        p => p !== `${module}_view` && p !== `${module}_manage`
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map((module) => (
          <div
            key={module.key}
            className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4"
          >
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-[#e5e4e2]">
                {module.label}
              </span>
              <select
                value={getPermissionLevel(module.key)}
                onChange={(e) => setPermissionLevel(module.key, e.target.value as 'none' | 'view' | 'manage')}
                disabled={!isAdmin}
                className="px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] text-sm focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="none">Brak</option>
                <option value="view">Przeglądanie</option>
                <option value="manage">Zarządzanie</option>
              </select>
            </label>
          </div>
        ))}

        <div className="bg-[#1c1f33] border border-yellow-500/20 rounded-xl p-4">
          <label className="flex flex-col gap-2">
            <div>
              <div className="text-sm font-medium text-[#e5e4e2]">
                Zarządzanie uprawnieniami
              </div>
              <div className="text-xs text-[#e5e4e2]/60 mt-1">
                Pozwala edytować uprawnienia pracowników
              </div>
            </div>
            <select
              value={hasScope('employees_permissions') ? 'yes' : 'no'}
              onChange={(e) => {
                if (e.target.value === 'yes') {
                  setPermissions(prev => [...prev.filter(p => p !== 'employees_permissions'), 'employees_permissions']);
                } else {
                  setPermissions(prev => prev.filter(p => p !== 'employees_permissions'));
                }
                setHasChanges(true);
              }}
              disabled={!isAdmin}
              className="px-3 py-2 bg-[#0f1119] border border-yellow-500/30 rounded-lg text-[#e5e4e2] text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="no">Nie</option>
              <option value="yes">Tak</option>
            </select>
          </label>
        </div>
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
