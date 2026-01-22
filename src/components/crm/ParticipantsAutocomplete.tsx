'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { Users, X, User, Plus, Trash2 } from 'lucide-react';
import { useEmployees } from '@/app/(crm)/crm/employees/hooks/useEmployees';
import { useEventTeam } from '@/app/(crm)/crm/events/hooks/useEventTeam';

interface EmployeesPickerProps {
  eventId: string;
  eventCreatorId?: string | null;
  value: string[]; // pending employeeIds
  onChange: (ids: string[]) => void;
  placeholder?: string;
  className?: string;
}

export default function ParticipantsAutocomplete({
  eventId,
  eventCreatorId,
  value,
  onChange,
  placeholder = 'Dodaj pracownika do zespołu...',
  className = '',
}: EmployeesPickerProps) {
  const { list: employeesList, loading: employeesLoading } = useEmployees({ activeOnly: true });
  const { employees: eventTeam } = useEventTeam(eventId); // tylko po to, żeby odfiltrować już przypisanych

  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // już przypisani w bazie
  const assignedEmployeeIds = useMemo(() => {
    const ids = new Set<string>();
    (eventTeam || []).forEach((a: any) => {
      if (a?.employee_id) ids.add(a.employee_id);
      if (a?.employee?.id) ids.add(a.employee.id);
    });
    return ids;
  }, [eventTeam]);

  // pending w UI
  const pendingIds = useMemo(() => new Set(value || []), [value]);

  const availableEmployees = useMemo(() => {
    return (employeesList || []).filter((emp: any) => {
      if (!emp?.id) return false;
      if (eventCreatorId && emp.id === eventCreatorId) return false; // autor
      if (assignedEmployeeIds.has(emp.id)) return false; // już w bazie
      if (pendingIds.has(emp.id)) return false; // już dodany do pending
      return true;
    });
  }, [employeesList, eventCreatorId, assignedEmployeeIds, pendingIds]);

  const filteredEmployees = useMemo(() => {
    const q = inputValue.toLowerCase().trim();
    const base = !q
      ? availableEmployees
      : availableEmployees.filter((emp: any) => {
          const full = `${emp.name ?? ''} ${emp.surname ?? ''}`.toLowerCase();
          const email = (emp.email ?? '').toLowerCase();
          const occupation = (emp.occupation ?? '').toLowerCase();
          return full.includes(q) || email.includes(q) || occupation.includes(q);
        });

    return base.slice(0, 20);
  }, [availableEmployees, inputValue]);

  const handlePick = (employeeId: string) => {
    onChange([...(value || []), employeeId]);
    setInputValue('');
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  const removePending = (employeeId: string) => {
    onChange((value || []).filter((id) => id !== employeeId));
  };

  const pendingEmployees = useMemo(() => {
    const map = new Map((employeesList || []).map((e: any) => [e.id, e]));
    return (value || []).map((id) => map.get(id)).filter(Boolean);
  }, [employeesList, value]);

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="relative">
        <Users className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/50" />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowDropdown(false);
          }}
          placeholder={placeholder}
          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] py-2 pl-10 pr-10 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
        />
        {inputValue && (
          <button
            type="button"
            onClick={() => {
              setInputValue('');
              setShowDropdown(false);
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/50 hover:text-[#e5e4e2]"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {showDropdown && (
          <div
            ref={dropdownRef}
            className="absolute z-50 mt-2 max-h-80 w-full overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl"
          >
            <div className="max-h-80 overflow-y-auto">
              {employeesLoading ? (
                <div className="px-4 py-8 text-center text-sm text-[#e5e4e2]/50">
                  Ładowanie pracowników...
                </div>
              ) : filteredEmployees.length > 0 ? (
                filteredEmployees.map((emp: any) => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => handlePick(emp.id)}
                    className="w-full border-b border-[#d3bb73]/10 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[#d3bb73]/10"
                  >
                    <div className="flex items-start gap-3">
                      <User className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-[#e5e4e2]">
                          {emp.name} {emp.surname}
                        </div>
                        {(emp.occupation || emp.email) && (
                          <div className="mt-0.5 truncate text-xs text-[#e5e4e2]/60">
                            {[emp.occupation, emp.email].filter(Boolean).join(' • ')}
                          </div>
                        )}
                      </div>
                      <Plus className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-sm text-[#e5e4e2]/50">
                  {inputValue
                    ? `Brak pracowników pasujących do "${inputValue}"`
                    : 'Brak pracowników do dodania'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pending lista (to jeszcze NIE zapisane) */}
      {pendingEmployees.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-[#e5e4e2]/50">Do dodania po zapisaniu:</div>
          {pendingEmployees.map((emp: any) => (
            <div
              key={emp.id}
              className="flex items-center justify-between rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2"
            >
              <div className="flex items-center gap-3">
                <User className="h-4 w-4 text-[#d3bb73]" />
                <div>
                  <div className="text-sm font-medium text-[#e5e4e2]">
                    {emp.name} {emp.surname}
                  </div>
                  {(emp.occupation || emp.email) && (
                    <div className="text-xs text-[#e5e4e2]/60">
                      {[emp.occupation, emp.email].filter(Boolean).join(' • ')}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => removePending(emp.id)}
                className="rounded p-2 transition-colors hover:bg-red-500/20"
                title="Usuń z listy"
              >
                <Trash2 className="h-4 w-4 text-red-400" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
