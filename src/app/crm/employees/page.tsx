'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, User, Lock, LayoutGrid, List, ListTree } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import AdminResetPasswordModal from '@/components/crm/AdminResetPasswordModal';
import { EmployeeCardsView, EmployeeListView, EmployeeDetailedView } from '@/components/crm/EmployeeViews';

interface Employee {
  id: string;
  name: string;
  surname: string;
  nickname: string | null;
  email: string;
  phone_number: string | null;
  avatar_url: string | null;
  avatar_metadata?: any;
  role: string;
  access_level: string;
  occupation: string | null;
  region: string | null;
  is_active: boolean;
  skills: string[] | null;
  order_index: number;
}

export default function EmployeesPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [resetPasswordEmployee, setResetPasswordEmployee] = useState<Employee | null>(null);

  const { canCreateInModule } = useCurrentEmployee();
  const canAddEmployee = canCreateInModule('employees');

  const { getViewMode, setViewMode } = useUserPreferences();
  const viewMode = getViewMode('employees');

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .order('order_index', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching employees:', error);
        return;
      }

      setEmployees(data || []);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredEmployees = employees.filter((emp) =>
    `${emp.name} ${emp.surname} ${emp.nickname || ''} ${emp.email} ${emp.occupation || ''}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase())
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


  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Pracownicy</h2>
          <p className="text-[#e5e4e2]/60 text-sm mt-1">
            Zarządzaj zespołem i uprawnieniami
          </p>
        </div>
        <div className="flex gap-3">
          {canAddEmployee && (
            <>
              <button
                onClick={() => router.push('/crm/settings/access-levels')}
                className="flex items-center gap-2 border border-[#d3bb73]/30 text-[#e5e4e2] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/10 transition-colors"
              >
                <Lock className="w-4 h-4" />
                Poziomy dostępu
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Dodaj pracownika
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
          <input
            type="text"
            placeholder="Szukaj pracowników..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg pl-12 pr-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
          />
        </div>

        <div className="flex items-center gap-1 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg p-1">
          <button
            onClick={() => setViewMode('employees', 'cards')}
            className={`p-2 rounded transition-colors ${
              viewMode === 'cards'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2] hover:bg-[#d3bb73]/10'
            }`}
            title="Widok kafelkowy"
          >
            <LayoutGrid className="w-5 h-5" />
          </button>
          <button
            onClick={() => setViewMode('employees', 'list')}
            className={`p-2 rounded transition-colors ${
              viewMode === 'list'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2] hover:bg-[#d3bb73]/10'
            }`}
            title="Widok listy"
          >
            <List className="w-5 h-5" />
          </button>
          <button
            onClick={() => setViewMode('employees', 'detailed')}
            className={`p-2 rounded transition-colors ${
              viewMode === 'detailed'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2] hover:bg-[#d3bb73]/10'
            }`}
            title="Widok szczegółowy"
          >
            <ListTree className="w-5 h-5" />
          </button>
        </div>
      </div>

      {filteredEmployees.length === 0 ? (
        <div className="text-center py-12">
          <User className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">
            {searchTerm ? 'Nie znaleziono pracowników' : 'Brak pracowników'}
          </p>
        </div>
      ) : (
        <>
          {viewMode === 'cards' && (
            <EmployeeCardsView
              employees={filteredEmployees}
              getRoleLabel={getRoleLabel}
              getAccessLevelLabel={getAccessLevelLabel}
              getAccessLevelColor={getAccessLevelColor}
              canAddEmployee={canAddEmployee}
            />
          )}
          {viewMode === 'list' && (
            <EmployeeListView
              employees={filteredEmployees}
              getRoleLabel={getRoleLabel}
              getAccessLevelLabel={getAccessLevelLabel}
              getAccessLevelColor={getAccessLevelColor}
              canAddEmployee={canAddEmployee}
            />
          )}
          {viewMode === 'detailed' && (
            <EmployeeDetailedView
              employees={filteredEmployees}
              getRoleLabel={getRoleLabel}
              getAccessLevelLabel={getAccessLevelLabel}
              getAccessLevelColor={getAccessLevelColor}
              canAddEmployee={canAddEmployee}
            />
          )}
        </>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 max-w-2xl w-full">
            <h3 className="text-xl font-medium text-[#e5e4e2] mb-4">
              Dodaj nowego pracownika
            </h3>
            <p className="text-[#e5e4e2]/70 mb-6">
              Użyj funkcji edge function "create-employee" w Supabase aby utworzyć nowego pracownika z kontem Auth.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 border border-[#d3bb73]/30 text-[#e5e4e2] rounded-lg hover:bg-[#d3bb73]/10 transition-colors"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}

      {resetPasswordEmployee && (
        <AdminResetPasswordModal
          employee={resetPasswordEmployee}
          onClose={() => {
            setResetPasswordEmployee(null);
            fetchEmployees();
          }}
        />
      )}
    </div>
  );
}
