'use client';

import { useState, useEffect } from 'react';
import { Shield, Save, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { MODULES, getAllScopes } from '@/lib/permissions';

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

  const toggleScope = (scope: string) => {
    if (!isAdmin) return;

    setPermissions(prev => {
      if (prev.includes(scope)) {
        return prev.filter(s => s !== scope);
      } else {
        return [...prev, scope];
      }
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!isAdmin) {
      alert('Tylko administrator może zmieniać uprawnienia');
      return;
    }

    try {
      setSaving(true);

      const { error } = await supabase
        .from('employees')
        .update({ permissions })
        .eq('id', employeeId);

      if (error) throw error;

      setHasChanges(false);
      alert('Uprawnienia zostały zapisane');
    } catch (err) {
      console.error('Error saving permissions:', err);
      alert('Błąd podczas zapisywania uprawnień');
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

      <div className="space-y-4">
        {modules.map((module) => (
          <div
            key={module.key}
            className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6"
          >
            <h4 className="text-lg font-medium text-[#e5e4e2] mb-4">
              {module.label}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={hasScope(`${module.key}_view`)}
                  onChange={() => toggleScope(`${module.key}_view`)}
                  disabled={!isAdmin}
                  className="w-5 h-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-2 focus:ring-[#d3bb73]/20 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="text-sm text-[#e5e4e2] group-hover:text-[#d3bb73] transition-colors">
                  Przeglądanie
                </span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={hasScope(`${module.key}_manage`)}
                  onChange={() => toggleScope(`${module.key}_manage`)}
                  disabled={!isAdmin}
                  className="w-5 h-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-2 focus:ring-[#d3bb73]/20 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="text-sm text-[#e5e4e2] group-hover:text-[#d3bb73] transition-colors">
                  Zarządzanie (edycja i usuwanie)
                </span>
              </label>
            </div>
          </div>
        ))}

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h4 className="text-lg font-medium text-[#e5e4e2] mb-4">
            Specjalne uprawnienia
          </h4>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={hasScope('employees_permissions')}
                onChange={() => toggleScope('employees_permissions')}
                disabled={!isAdmin}
                className="w-5 h-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-2 focus:ring-[#d3bb73]/20 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <div>
                <div className="text-sm text-[#e5e4e2] group-hover:text-[#d3bb73] transition-colors">
                  Zarządzanie uprawnieniami pracowników
                </div>
                <div className="text-xs text-[#e5e4e2]/60">
                  Pozwala na edycję uprawnień innych pracowników
                </div>
              </div>
            </label>
          </div>
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
