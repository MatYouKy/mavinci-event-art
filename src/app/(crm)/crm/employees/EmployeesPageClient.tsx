'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, User, Lock, LayoutGrid, List, ListTree, Clock } from 'lucide-react';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import AdminResetPasswordModal from '@/components/crm/AdminResetPasswordModal';
import AddEmployeeModal from '@/components/crm/AddEmployeeModal';
import {
  EmployeeCardsView,
  EmployeeListView,
  EmployeeDetailedView,
} from '@/components/crm/EmployeeViews';
import EmployeesTimelineView from '@/components/crm/EmployeesTimelineView';
import { IEmployee } from './type';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { ViewMode } from '../settings/page';

export default function EmployeesPageClient({ employees, viewMode }: { employees: IEmployee[], viewMode: ViewMode }) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [resetPasswordEmployee, setResetPasswordEmployee] = useState<IEmployee | null>(null);

  const { canCreateInModule, employee: currentEmployee } = useCurrentEmployee();
  const canAddEmployee = canCreateInModule('employees');
  const isAdmin = currentEmployee?.access_level === 'admin' ||
                  currentEmployee?.permissions?.includes('admin') ||
                  currentEmployee?.permissions?.includes('employees_manage');

  const { setViewMode } = useUserPreferences();
  const [localViewMode, setLocalViewMode] = useState<ViewMode>(viewMode);

  const handleViewModeChange = async (mode: ViewMode) => {
    setLocalViewMode(mode);
    await setViewMode('employees', mode);
  };

  const filteredEmployees = employees.filter((emp) =>
    `${emp.name} ${emp.surname} ${emp.nickname || ''} ${emp.email} ${emp.occupation || ''}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase()),
  );

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      admin: 'Administrator',
      manager: 'Menedżer',
      event_manager: 'Menedżer eventów',
      sales: 'Sprzedaż',
      logistics: 'Logistyka',
      technician: 'Technik',
      support: 'Wsparcie',
      freelancer: 'Freelancer',
      dj: 'DJ',
      mc: 'Konferansjer',
      assistant: 'Asystent',
      unassigned: 'Nieprzypisany',
    };
    return labels[role] || role;
  };

  const getAccessLevelLabel = (level: string) => {
    const labels: Record<string, string> = {
      admin: 'Pełny dostęp',
      manager: 'Menedżer',
      lead: 'Kierownik',
      operator: 'Operator',
      external: 'Zewnętrzny',
      guest: 'Gość',
      unassigned: 'Nieprzypisany',
      instructor: 'Instruktor',
    };
    return labels[level] || level;
  };

  const getAccessLevelColor = (level: string) => {
    const colors: Record<string, string> = {
      admin: 'bg-purple-500/20 text-purple-400',
      manager: 'bg-blue-500/20 text-blue-400',
      lead: 'bg-cyan-500/20 text-cyan-400',
      operator: 'bg-green-500/20 text-green-400',
      external: 'bg-orange-500/20 text-orange-400',
      guest: 'bg-gray-500/20 text-gray-400',
      unassigned: 'bg-gray-500/20 text-gray-400',
      instructor: 'bg-teal-500/20 text-teal-400',
    };
    return colors[level] || 'bg-gray-500/20 text-gray-400';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="mt-3">
          <h2 className="text-2xl font-light text-[#e5e4e2]">Pracownicy</h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">Zarządzaj zespołem i uprawnieniami</p>
        </div>
        <div className="flex gap-3 ">
          {canAddEmployee && (
            <ResponsiveActionBar
              actions={[
                {
                  label: 'Poziomy dostępu',
                  onClick: () => router.push('/crm/settings/access-levels'),
                  icon: <Lock className="h-4 w-4" />,
                },
                {
                  label: 'Dodaj pracownika',
                  onClick: () => setShowAddModal(true),
                  icon: <Plus className="h-4 w-4" />,
                },
              ]}
            />  
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
          <input
            type="text"
            placeholder="Szukaj pracowników..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] py-3 pl-12 pr-4 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73]/30 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-1">
          <button
            onClick={() => handleViewModeChange('grid')}
            className={`rounded p-2 transition-colors ${
              localViewMode === 'grid'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]'
            }`}
            title="Widok kafelkowy"
          >
            <LayoutGrid className="h-5 w-5" />
          </button>
          <button
            onClick={() => handleViewModeChange('list')}
            className={`rounded p-2 transition-colors ${
              localViewMode === 'list'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]'
            }`}
            title="Widok listy"
          >
            <List className="h-5 w-5" />
          </button>
          <button
            onClick={() => handleViewModeChange('table')}
            className={`rounded p-2 transition-colors ${
              localViewMode === 'table'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]'
            }`}
            title="Widok szczegółowy"
          >
            <ListTree className="h-5 w-5" />
          </button>
          <button
            onClick={() => handleViewModeChange('timeline')}
            className={`rounded p-2 transition-colors ${
              localViewMode === 'timeline'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]'
            }`}
            title="Oś czasu"
          >
            <Clock className="h-5 w-5" />
          </button>
        </div>
      </div>

      {filteredEmployees.length === 0 ? (
        <div className="py-12 text-center">
          <User className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">
            {searchTerm ? 'Nie znaleziono pracowników' : 'Brak pracowników'}
          </p>
        </div>
      ) : (
        <>
          {localViewMode === 'grid' && (
            <EmployeeCardsView
            
              employees={filteredEmployees}
              getRoleLabel={getRoleLabel}
              getAccessLevelLabel={getAccessLevelLabel}
              getAccessLevelColor={getAccessLevelColor}
              canAddEmployee={canAddEmployee}
              isAdmin={isAdmin}
              onResetPassword={setResetPasswordEmployee}
            />
          )}
          {localViewMode === 'list' && (
            <EmployeeListView
              employees={filteredEmployees}
              getRoleLabel={getRoleLabel}
              getAccessLevelLabel={getAccessLevelLabel}
              getAccessLevelColor={getAccessLevelColor}
              canAddEmployee={canAddEmployee}
              isAdmin={isAdmin}
              onResetPassword={setResetPasswordEmployee}
            />
          )}
          {localViewMode === 'table' && (
            <EmployeeDetailedView
              employees={filteredEmployees}
              getRoleLabel={getRoleLabel}
              getAccessLevelLabel={getAccessLevelLabel}
              getAccessLevelColor={getAccessLevelColor}
              canAddEmployee={canAddEmployee}
              isAdmin={isAdmin}
              onResetPassword={setResetPasswordEmployee}
            />
          )}
          {localViewMode === 'timeline' && (
            <EmployeesTimelineView employees={filteredEmployees} />
          )}
        </>
      )}

      {showAddModal && (
        <AddEmployeeModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
          }}
        />
      )}

      {resetPasswordEmployee && (
        <AdminResetPasswordModal
          employeeId={resetPasswordEmployee.id}
          employeeName={resetPasswordEmployee.name}
          employeeEmail={resetPasswordEmployee.email}
          onClose={() => {
            setResetPasswordEmployee(null);
          }}
          isOpen={resetPasswordEmployee !== null}
        />
      )}
    </div>
  );
}
