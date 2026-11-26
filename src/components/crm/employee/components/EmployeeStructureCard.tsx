'use client';

import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Network, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { DEPARTMENTS, department, departmentLabel, type Department } from '@/lib/CRM/meetings/teamAvailability';

/*
 * Karta „Dział i przełożony” w profilu pracownika (docs/team-availability.md): dział wyznacza zakres planu w Spotkaniach
 * → „Pracownicy” (Zarząd — wszyscy; Sprzedaż i Biuro — Sprzedaż, Biuro, Magazyn; Magazyn — swój dział), przełożony —
 * piramidę (przełożony widzi plan podwładnych). Zmienia administrator albo „Zarządzanie pracownikami”
 * (`set_employee_structure`; baza pilnuje pętli w piramidzie).
 */

interface Row {
  id: string;
  name: string | null;
  surname: string | null;
  nickname: string | null;
  department: string | null;
  supervisor_id: string | null;
}

const label = (row: Pick<Row, 'name' | 'surname' | 'nickname'>) =>
  row.nickname?.trim() || `${row.name ?? ''} ${row.surname ?? ''}`.trim() || 'Pracownik';

function EmployeeStructureCard({ employeeId }: { employeeId: string }) {
  const { isAdmin, hasScope } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const canManage = isAdmin || hasScope('employees_manage') || hasScope('admin');
  const [people, setPeople] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftDepartment, setDraftDepartment] = useState<Department>('office');
  const [draftSupervisor, setDraftSupervisor] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('employees')
      .select('id, name, surname, nickname, department, supervisor_id')
      .eq('is_active', true)
      .order('name')
      .order('surname');
    if (!error) setPeople((data ?? []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const me = useMemo(() => people.find((row) => row.id === employeeId) ?? null, [people, employeeId]);
  const supervisor = useMemo(() => people.find((row) => row.id === me?.supervisor_id) ?? null, [people, me]);
  const subordinates = useMemo(() => people.filter((row) => row.supervisor_id === employeeId), [people, employeeId]);
  // Przełożonym nie może być ta osoba ani nikt z jej gałęzi w dół (pętla w piramidzie).
  const blocked = useMemo(() => {
    const result = new Set<string>([employeeId]);
    let added = true;
    while (added) {
      added = false;
      people.forEach((row) => {
        if (row.supervisor_id && result.has(row.supervisor_id) && !result.has(row.id)) {
          result.add(row.id);
          added = true;
        }
      });
    }
    return result;
  }, [people, employeeId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <Loader2 className="h-5 w-5 animate-spin text-[#d3bb73]" />
      </div>
    );
  }
  if (!me) return null;

  const startEditing = () => {
    setDraftDepartment(department(me.department));
    setDraftSupervisor(me.supervisor_id ?? '');
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.rpc('set_employee_structure', {
      p_employee_id: employeeId,
      p_department: draftDepartment,
      p_supervisor_id: draftSupervisor || null,
    });
    setSaving(false);
    if (error) {
      showSnackbar(error.message || 'Nie udało się zapisać działu', 'error');
      return;
    }
    showSnackbar('Zapisano dział i przełożonego', 'success');
    setEditing(false);
    void load();
  };

  const hint = DEPARTMENTS.find((option) => option.value === (editing ? draftDepartment : department(me.department)))?.hint;

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-light text-[#e5e4e2]">
          <Network className="h-5 w-5 text-[#d3bb73]" />
          Dział i przełożony
        </h3>
        {canManage && !editing && (
          <button
            type="button"
            onClick={startEditing}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
          >
            <Pencil className="h-3.5 w-3.5" />
            Zmień
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs text-[#e5e4e2]/55">Dział</p>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#0f1119] p-1 sm:grid-cols-4">
              {DEPARTMENTS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDraftDepartment(option.value)}
                  className={`rounded-md px-2 py-1.5 text-sm transition-colors ${
                    draftDepartment === option.value ? 'bg-[#d3bb73] font-medium text-[#0f1119]' : 'text-[#e5e4e2]/70 hover:bg-white/5'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {hint && <p className="mt-1.5 text-xs text-[#e5e4e2]/45">{hint}</p>}
          </div>
          <div>
            <p className="mb-1.5 text-xs text-[#e5e4e2]/55">Przełożony</p>
            <select
              value={draftSupervisor}
              onChange={(event) => setDraftSupervisor(event.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
            >
              <option value="">Brak przełożonego</option>
              {people
                .filter((row) => !blocked.has(row.id))
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {label(row)} · {departmentLabel(row.department)}
                  </option>
                ))}
            </select>
            <p className="mt-1.5 text-xs text-[#e5e4e2]/45">Przełożony widzi plan (z tytułami spotkań) swoich podwładnych.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/80 hover:bg-white/5"
            >
              Anuluj
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Zapisz
            </button>
          </div>
        </div>
      ) : (
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-[#e5e4e2]/55">Dział</dt>
            <dd className="text-[#e5e4e2]">{departmentLabel(me.department)}</dd>
            {hint && <p className="mt-0.5 text-xs text-[#e5e4e2]/45">{hint}</p>}
          </div>
          <div>
            <dt className="text-xs text-[#e5e4e2]/55">Przełożony</dt>
            <dd className="text-[#e5e4e2]">{supervisor ? label(supervisor) : 'Brak'}</dd>
          </div>
          {subordinates.length > 0 && (
            <div>
              <dt className="text-xs text-[#e5e4e2]/55">Podwładni</dt>
              <dd className="text-[#e5e4e2]">{subordinates.map(label).join(', ')}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

export default memo(EmployeeStructureCard);
