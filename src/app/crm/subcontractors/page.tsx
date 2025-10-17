'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  Users,
  Mail,
  Phone,
  Star,
  TrendingUp,
  DollarSign,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Subcontractor {
  id: string;
  company_name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  specialization: string[];
  hourly_rate: number;
  status: 'active' | 'inactive' | 'blacklisted';
  rating: number | null;
  payment_terms: string;
  created_at: string;
}

export default function SubcontractorsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [searchTerm, setSearchTerm] = useState('');
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  useEffect(() => {
    fetchSubcontractors();
  }, []);

  const fetchSubcontractors = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('subcontractors')
        .select('*')
        .order('company_name', { ascending: true });

      if (error) throw error;
      setSubcontractors(data || []);
    } catch (err) {
      console.error('Error fetching subcontractors:', err);
      showSnackbar('Błąd podczas ładowania podwykonawców', 'error');
    } finally {
      setLoading(false);
    }
  };

  const filteredSubcontractors = subcontractors.filter((sub) => {
    const matchesSearch =
      `${sub.company_name} ${sub.contact_person || ''} ${sub.email || ''}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase());

    const matchesStatus = filterStatus === 'all' || sub.status === filterStatus;

    return matchesSearch && matchesStatus;
  });

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      active: 'Aktywny',
      inactive: 'Nieaktywny',
      blacklisted: 'Czarna lista',
    };
    return labels[status] || status;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-500/20 text-green-400',
      inactive: 'bg-gray-500/20 text-gray-400',
      blacklisted: 'bg-red-500/20 text-red-400',
    };
    return colors[status] || 'bg-gray-500/20 text-gray-400';
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
          <h2 className="text-2xl font-light text-[#e5e4e2]">Podwykonawcy</h2>
          <p className="text-[#e5e4e2]/60 text-sm mt-1">
            Zarządzaj podwykonawcami, zadaniami i umowami
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Dodaj podwykonawcę
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
          <input
            type="text"
            placeholder="Szukaj podwykonawców..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg pl-12 pr-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
        >
          <option value="all">Wszystkie statusy</option>
          <option value="active">Aktywny</option>
          <option value="inactive">Nieaktywny</option>
          <option value="blacklisted">Czarna lista</option>
        </select>
      </div>

      {filteredSubcontractors.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">
            {searchTerm ? 'Nie znaleziono podwykonawców' : 'Brak podwykonawców'}
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSubcontractors.map((sub) => (
            <div
              key={sub.id}
              onClick={() => router.push(`/crm/subcontractors/${sub.id}`)}
              className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all cursor-pointer"
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-blue-500/20">
                  <Users className="w-6 h-6 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-medium text-[#e5e4e2] truncate">
                    {sub.company_name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${getStatusColor(
                        sub.status
                      )}`}
                    >
                      {getStatusLabel(sub.status)}
                    </span>
                    {sub.rating && (
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                        <span className="text-xs text-[#e5e4e2]/60">
                          {sub.rating}/5
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {sub.contact_person && (
                <div className="text-sm text-[#e5e4e2]/70 mb-2">
                  {sub.contact_person}
                </div>
              )}

              <div className="space-y-2 text-sm mb-4">
                {sub.email && (
                  <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                    <Mail className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">{sub.email}</span>
                  </div>
                )}
                {sub.phone && (
                  <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                    <Phone className="w-4 h-4 flex-shrink-0" />
                    {sub.phone}
                  </div>
                )}
              </div>

              {sub.specialization && sub.specialization.length > 0 && (
                <div className="mb-4">
                  <div className="flex flex-wrap gap-1">
                    {sub.specialization.slice(0, 3).map((spec, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 bg-[#d3bb73]/10 text-[#d3bb73] rounded text-xs"
                      >
                        {spec}
                      </span>
                    ))}
                    {sub.specialization.length > 3 && (
                      <span className="px-2 py-0.5 text-[#e5e4e2]/40 text-xs">
                        +{sub.specialization.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-[#d3bb73]/10 flex items-center justify-between text-xs text-[#e5e4e2]/60">
                <span className="flex items-center gap-1">
                  <DollarSign className="w-3 h-3" />
                  {sub.hourly_rate} zł/h
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {sub.payment_terms}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <AddSubcontractorModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onAdded={fetchSubcontractors}
        />
      )}
    </div>
  );
}

function AddSubcontractorModal({
  isOpen,
  onClose,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [formData, setFormData] = useState({
    company_name: '',
    contact_person: '',
    email: '',
    phone: '',
    nip: '',
    address: '',
    hourly_rate: 0,
    payment_terms: '14 dni',
    bank_account: '',
    specialization: [] as string[],
    status: 'active',
    notes: '',
  });
  const [newSpecialization, setNewSpecialization] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!formData.company_name) {
      showSnackbar('Nazwa firmy jest wymagana', 'warning');
      return;
    }

    try {
      const { error } = await supabase.from('subcontractors').insert([formData]);

      if (error) throw error;

      showSnackbar('Podwykonawca dodany pomyślnie!', 'success');
      onAdded();
      onClose();
    } catch (err) {
      console.error('Error adding subcontractor:', err);
      showSnackbar('Wystąpił błąd podczas dodawania podwykonawcy', 'error');
    }
  };

  const addSpecialization = () => {
    if (newSpecialization.trim() && !formData.specialization.includes(newSpecialization.trim())) {
      setFormData({
        ...formData,
        specialization: [...formData.specialization, newSpecialization.trim()],
      });
      setNewSpecialization('');
    }
  };

  const removeSpecialization = (spec: string) => {
    setFormData({
      ...formData,
      specialization: formData.specialization.filter((s) => s !== spec),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-light text-[#e5e4e2] mb-6">
          Dodaj nowego podwykonawcę
        </h2>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="col-span-2">
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Nazwa firmy *
            </label>
            <input
              type="text"
              value={formData.company_name}
              onChange={(e) =>
                setFormData({ ...formData, company_name: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Osoba kontaktowa
            </label>
            <input
              type="text"
              value={formData.contact_person}
              onChange={(e) =>
                setFormData({ ...formData, contact_person: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Telefon</label>
            <input
              type="text"
              value={formData.phone}
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">NIP</label>
            <input
              type="text"
              value={formData.nip}
              onChange={(e) =>
                setFormData({ ...formData, nip: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Stawka godzinowa (zł)
            </label>
            <input
              type="number"
              value={formData.hourly_rate}
              onChange={(e) =>
                setFormData({ ...formData, hourly_rate: parseFloat(e.target.value) || 0 })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Warunki płatności
            </label>
            <input
              type="text"
              value={formData.payment_terms}
              onChange={(e) =>
                setFormData({ ...formData, payment_terms: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              placeholder="np. 14 dni, 30 dni"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Specjalizacje
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={newSpecialization}
                onChange={(e) => setNewSpecialization(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addSpecialization()}
                className="flex-1 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                placeholder="Dodaj specjalizację..."
              />
              <button
                onClick={addSpecialization}
                className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
              >
                Dodaj
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {formData.specialization.map((spec, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg flex items-center gap-2"
                >
                  {spec}
                  <button
                    onClick={() => removeSpecialization(spec)}
                    className="hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="col-span-2">
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Notatki</label>
            <textarea
              value={formData.notes}
              onChange={(e) =>
                setFormData({ ...formData, notes: e.target.value })
              }
              rows={3}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] resize-y"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90"
          >
            Dodaj podwykonawcę
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
