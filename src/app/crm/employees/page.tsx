'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Mail, Phone, Briefcase, Shield, User } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';

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
}

export default function EmployeesPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('employees')
        .select('*')
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
    `${emp.name} ${emp.surname} ${emp.email} ${emp.occupation || ''}`
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
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Dodaj pracownika
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
        <input
          type="text"
          placeholder="Szukaj pracowników..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg pl-12 pr-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
        />
      </div>

      {filteredEmployees.length === 0 ? (
        <div className="text-center py-12">
          <User className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">
            {searchTerm ? 'Nie znaleziono pracowników' : 'Brak pracowników'}
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredEmployees.map((employee) => (
            <div
              key={employee.id}
              onClick={() => router.push(`/crm/employees/${employee.id}`)}
              className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all cursor-pointer"
            >
              <div className="flex flex-col items-center text-center mb-4">
                <div className="mb-4">
                  <EmployeeAvatar
                    avatarUrl={employee.avatar_url}
                    avatarMetadata={employee.avatar_metadata}
                    employeeName={`${employee.name} ${employee.surname}`}
                    size={80}
                    className="border-2 border-[#d3bb73]/20"
                  />
                </div>
                <h3 className="text-lg font-medium text-[#e5e4e2]">
                  {employee.name} {employee.surname}
                </h3>
                {employee.nickname && (
                  <p className="text-xs text-[#e5e4e2]/40 mb-1">
                    "{employee.nickname}"
                  </p>
                )}
                <p className="text-sm text-[#d3bb73] mb-2">
                  {employee.occupation || getRoleLabel(employee.role)}
                </p>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-3 py-1 rounded-full text-xs ${
                      employee.is_active
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {employee.is_active ? 'Aktywny' : 'Nieaktywny'}
                  </span>
                  <span
                    className={`px-3 py-1 rounded-full text-xs ${getAccessLevelColor(
                      employee.access_level
                    )}`}
                  >
                    <Shield className="w-3 h-3 inline mr-1" />
                    {getAccessLevelLabel(employee.access_level)}
                  </span>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                  <Mail className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{employee.email}</span>
                </div>
                {employee.phone_number && (
                  <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                    <Phone className="w-4 h-4 flex-shrink-0" />
                    {employee.phone_number}
                  </div>
                )}
                {employee.region && (
                  <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                    <Briefcase className="w-4 h-4 flex-shrink-0" />
                    {employee.region}
                  </div>
                )}
              </div>

              {employee.skills && Array.isArray(employee.skills) && employee.skills.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#d3bb73]/10">
                  <div className="flex flex-wrap gap-1">
                    {employee.skills.slice(0, 3).map((skill, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 bg-[#d3bb73]/10 text-[#d3bb73] rounded text-xs"
                      >
                        {skill}
                      </span>
                    ))}
                    {employee.skills.length > 3 && (
                      <span className="px-2 py-0.5 text-[#e5e4e2]/40 text-xs">
                        +{employee.skills.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <AddEmployeeModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onAdded={fetchEmployees}
        />
      )}
    </div>
  );
}

function AddEmployeeModal({
  isOpen,
  onClose,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    surname: '',
    email: '',
    phone_number: '',
    role: 'unassigned',
    access_level: 'unassigned',
    occupation: '',
    password: '', // Temporary password for first login
  });
  const [isCreating, setIsCreating] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!formData.name || !formData.surname || !formData.email || !formData.password) {
      alert('Wypełnij wszystkie wymagane pola (imię, nazwisko, email, hasło)');
      return;
    }

    setIsCreating(true);
    try {
      // Call Edge Function to create employee (uses Admin API)
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(`${supabaseUrl}/functions/v1/create-employee`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || supabaseAnonKey}`,
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (!response.ok || result.error) {
        console.error('Error creating employee:', result.error);
        alert(`Błąd podczas tworzenia pracownika: ${result.error}`);
        setIsCreating(false);
        return;
      }

      alert(`Pracownik ${formData.name} ${formData.surname} został dodany pomyślnie!\n\nEmail: ${formData.email}\nHasło tymczasowe: ${formData.password}\n\nPracownik może się teraz zalogować do CRM.`);
      onAdded();
      onClose();
    } catch (err: any) {
      console.error('Error:', err);
      alert(`Wystąpił błąd: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-light text-[#e5e4e2] mb-6">
          Dodaj nowego pracownika
        </h2>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Imię *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Nazwisko *
            </label>
            <input
              type="text"
              value={formData.surname}
              onChange={(e) =>
                setFormData({ ...formData, surname: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Email *
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Telefon
            </label>
            <input
              type="text"
              value={formData.phone_number}
              onChange={(e) =>
                setFormData({ ...formData, phone_number: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Hasło tymczasowe *
            </label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) =>
                setFormData({ ...formData, password: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              placeholder="Min. 6 znaków"
            />
            <p className="text-xs text-[#e5e4e2]/40 mt-1">
              Pracownik otrzyma to hasło do pierwszego logowania
            </p>
          </div>
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Rola</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="unassigned">Nieprzypisany</option>
              <option value="admin">Administrator</option>
              <option value="manager">Menedżer</option>
              <option value="event_manager">Menedżer eventów</option>
              <option value="sales">Sprzedaż</option>
              <option value="logistics">Logistyka</option>
              <option value="technician">Technik</option>
              <option value="dj">DJ</option>
              <option value="mc">Konferansjer</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Poziom dostępu
            </label>
            <select
              value={formData.access_level}
              onChange={(e) =>
                setFormData({ ...formData, access_level: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="unassigned">Nieprzypisany</option>
              <option value="admin">Pełny dostęp</option>
              <option value="manager">Menedżer</option>
              <option value="lead">Kierownik</option>
              <option value="operator">Operator</option>
              <option value="external">Zewnętrzny</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Stanowisko
            </label>
            <input
              type="text"
              value={formData.occupation}
              onChange={(e) =>
                setFormData({ ...formData, occupation: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              placeholder="np. Senior Event Manager"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={isCreating}
            className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? 'Tworzenie konta...' : 'Dodaj pracownika'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
