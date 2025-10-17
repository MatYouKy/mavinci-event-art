'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Users,
  Mail,
  Phone,
  MapPin,
  Star,
  DollarSign,
  Calendar,
  FileText,
  Plus,
  Edit,
  Save,
  X,
  CheckCircle,
  Clock,
  AlertCircle,
  Upload,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Subcontractor {
  id: string;
  company_name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  nip: string | null;
  address: string | null;
  specialization: string[];
  hourly_rate: number;
  payment_terms: string;
  bank_account: string | null;
  status: string;
  rating: number | null;
  notes: string | null;
  created_at: string;
}

interface Task {
  id: string;
  event_id: string;
  task_name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  estimated_hours: number;
  actual_hours: number;
  hourly_rate: number;
  fixed_price: number;
  payment_type: string;
  total_cost: number;
  status: string;
  invoice_number: string | null;
  payment_status: string;
  payment_date: string | null;
  events?: { name: string };
}

interface Contract {
  id: string;
  contract_number: string;
  contract_type: string;
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  total_value: number;
  payment_terms: string | null;
  file_path: string | null;
  status: string;
  signed_date: string | null;
  event_id: string | null;
  events?: { name: string } | null;
}

type TabType = 'details' | 'tasks' | 'contracts';

export default function SubcontractorDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const subcontractorId = params.id as string;

  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [subcontractor, setSubcontractor] = useState<Subcontractor | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editedData, setEditedData] = useState<Partial<Subcontractor>>({});
  const [saving, setSaving] = useState(false);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [showAddContractModal, setShowAddContractModal] = useState(false);

  useEffect(() => {
    if (subcontractorId) {
      fetchData();
    }
  }, [subcontractorId]);

  const fetchData = async () => {
    try {
      setLoading(true);

      const { data: subData, error: subError } = await supabase
        .from('subcontractors')
        .select('*')
        .eq('id', subcontractorId)
        .maybeSingle();

      if (subError) throw subError;
      if (!subData) {
        router.push('/crm/subcontractors');
        return;
      }

      setSubcontractor(subData);

      const { data: tasksData } = await supabase
        .from('subcontractor_tasks')
        .select('*, events(name)')
        .eq('subcontractor_id', subcontractorId)
        .order('start_date', { ascending: false });

      setTasks(tasksData || []);

      const { data: contractsData } = await supabase
        .from('subcontractor_contracts')
        .select('*, events(name)')
        .eq('subcontractor_id', subcontractorId)
        .order('created_at', { ascending: false });

      setContracts(contractsData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      showSnackbar('Błąd podczas ładowania danych', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = () => {
    setEditMode(true);
    setEditedData({ ...subcontractor });
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setEditedData({});
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      const { error } = await supabase
        .from('subcontractors')
        .update(editedData)
        .eq('id', subcontractorId);

      if (error) throw error;

      setSubcontractor({ ...subcontractor!, ...editedData });
      setEditMode(false);
      setEditedData({});
      showSnackbar('Dane zaktualizowane pomyślnie!', 'success');
    } catch (error) {
      console.error('Error updating subcontractor:', error);
      showSnackbar('Błąd podczas aktualizacji danych', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange = (field: keyof Subcontractor, value: any) => {
    setEditedData({ ...editedData, [field]: value });
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-500/20 text-green-400',
      inactive: 'bg-gray-500/20 text-gray-400',
      blacklisted: 'bg-red-500/20 text-red-400',
      planned: 'bg-blue-500/20 text-blue-400',
      in_progress: 'bg-yellow-500/20 text-yellow-400',
      completed: 'bg-green-500/20 text-green-400',
      cancelled: 'bg-red-500/20 text-red-400',
      pending: 'bg-yellow-500/20 text-yellow-400',
      paid: 'bg-green-500/20 text-green-400',
      overdue: 'bg-red-500/20 text-red-400',
      draft: 'bg-gray-500/20 text-gray-400',
    };
    return colors[status] || 'bg-gray-500/20 text-gray-400';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!subcontractor) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-400">Nie znaleziono podwykonawcy</div>
      </div>
    );
  }

  const totalTasksCost = tasks.reduce((sum, task) => sum + (task.total_cost || 0), 0);
  const totalContractsValue = contracts.reduce((sum, contract) => sum + (contract.total_value || 0), 0);

  return (
    <div className="min-h-screen bg-[#0a0b0f] p-6">
      <div className="max-w-7xl mx-auto">
        <button
          onClick={() => router.push('/crm/subcontractors')}
          className="mb-6 flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Powrót do listy podwykonawców</span>
        </button>

        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6 mb-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-blue-500/10 rounded-lg flex items-center justify-center">
                <Users className="w-8 h-8 text-blue-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#e5e4e2] mb-1">
                  {subcontractor.company_name}
                </h1>
                <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                  <span className={`px-2 py-1 rounded ${getStatusColor(subcontractor.status)}`}>
                    {subcontractor.status}
                  </span>
                  {subcontractor.rating && (
                    <span className="flex items-center gap-1">
                      <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                      {subcontractor.rating}/5
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-4 h-4" />
                    {subcontractor.hourly_rate} zł/h
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {activeTab === 'details' && !editMode && (
                <button
                  onClick={handleEdit}
                  className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  Edytuj
                </button>
              )}

              {activeTab === 'details' && editMode && (
                <>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? 'Zapisywanie...' : 'Zapisz'}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    disabled={saving}
                    className="flex items-center gap-2 bg-red-500/20 text-red-400 px-4 py-2 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50"
                  >
                    Anuluj
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setActiveTab('details')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'details'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
            }`}
          >
            Szczegóły
          </button>
          <button
            onClick={() => setActiveTab('tasks')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'tasks'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
            }`}
          >
            <div className="flex items-center gap-2">
              Zadania
              <span className="px-2 py-0.5 bg-[#d3bb73]/20 rounded text-xs">
                {tasks.length}
              </span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('contracts')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'contracts'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
            }`}
          >
            <div className="flex items-center gap-2">
              Umowy
              <span className="px-2 py-0.5 bg-[#d3bb73]/20 rounded text-xs">
                {contracts.length}
              </span>
            </div>
          </button>
        </div>

        {activeTab === 'details' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
              <h2 className="text-xl font-bold text-[#e5e4e2] mb-4">Informacje kontaktowe</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Osoba kontaktowa</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedData.contact_person || ''}
                      onChange={(e) => handleFieldChange('contact_person', e.target.value)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <span className="text-[#e5e4e2]">{subcontractor.contact_person || '-'}</span>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Email</label>
                  {editMode ? (
                    <input
                      type="email"
                      value={editedData.email || ''}
                      onChange={(e) => handleFieldChange('email', e.target.value)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <div className="flex items-center gap-3">
                      <Mail className="w-5 h-5 text-[#d3bb73]" />
                      <span className="text-[#e5e4e2]">{subcontractor.email || '-'}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Telefon</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedData.phone || ''}
                      onChange={(e) => handleFieldChange('phone', e.target.value)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <div className="flex items-center gap-3">
                      <Phone className="w-5 h-5 text-[#d3bb73]" />
                      <span className="text-[#e5e4e2]">{subcontractor.phone || '-'}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Adres</label>
                  {editMode ? (
                    <textarea
                      value={editedData.address || ''}
                      onChange={(e) => handleFieldChange('address', e.target.value)}
                      rows={2}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] resize-y"
                    />
                  ) : (
                    <span className="text-[#e5e4e2]">{subcontractor.address || '-'}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
              <h2 className="text-xl font-bold text-[#e5e4e2] mb-4">Dane finansowe</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">NIP</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedData.nip || ''}
                      onChange={(e) => handleFieldChange('nip', e.target.value)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <span className="text-[#e5e4e2]">{subcontractor.nip || '-'}</span>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Stawka godzinowa (zł)</label>
                  {editMode ? (
                    <input
                      type="number"
                      value={editedData.hourly_rate || 0}
                      onChange={(e) => handleFieldChange('hourly_rate', parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <span className="text-[#e5e4e2]">{subcontractor.hourly_rate} zł</span>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Warunki płatności</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedData.payment_terms || ''}
                      onChange={(e) => handleFieldChange('payment_terms', e.target.value)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <span className="text-[#e5e4e2]">{subcontractor.payment_terms}</span>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Numer konta</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedData.bank_account || ''}
                      onChange={(e) => handleFieldChange('bank_account', e.target.value)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <span className="text-[#e5e4e2] font-mono text-sm">{subcontractor.bank_account || '-'}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
              <h2 className="text-xl font-bold text-[#e5e4e2] mb-4">Specjalizacje</h2>
              <div className="flex flex-wrap gap-2">
                {subcontractor.specialization && subcontractor.specialization.length > 0 ? (
                  subcontractor.specialization.map((spec, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg"
                    >
                      {spec}
                    </span>
                  ))
                ) : (
                  <span className="text-[#e5e4e2]/60">Brak specjalizacji</span>
                )}
              </div>
            </div>

            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
              <h2 className="text-xl font-bold text-[#e5e4e2] mb-4">Statystyki</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#0f1119] rounded-lg p-4">
                  <div className="text-sm text-[#e5e4e2]/60 mb-1">Zadania</div>
                  <div className="text-2xl font-bold text-[#d3bb73]">{tasks.length}</div>
                </div>
                <div className="bg-[#0f1119] rounded-lg p-4">
                  <div className="text-sm text-[#e5e4e2]/60 mb-1">Umowy</div>
                  <div className="text-2xl font-bold text-[#d3bb73]">{contracts.length}</div>
                </div>
                <div className="bg-[#0f1119] rounded-lg p-4">
                  <div className="text-sm text-[#e5e4e2]/60 mb-1">Koszt zadań</div>
                  <div className="text-2xl font-bold text-[#d3bb73]">{totalTasksCost.toLocaleString('pl-PL')} zł</div>
                </div>
                <div className="bg-[#0f1119] rounded-lg p-4">
                  <div className="text-sm text-[#e5e4e2]/60 mb-1">Wartość umów</div>
                  <div className="text-2xl font-bold text-[#d3bb73]">{totalContractsValue.toLocaleString('pl-PL')} zł</div>
                </div>
              </div>
            </div>

            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6 lg:col-span-2">
              <h2 className="text-xl font-bold text-[#e5e4e2] mb-4">Notatki</h2>
              {editMode ? (
                <textarea
                  value={editedData.notes || ''}
                  onChange={(e) => handleFieldChange('notes', e.target.value)}
                  rows={5}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] resize-y"
                  placeholder="Dodaj notatki o podwykonawcy..."
                />
              ) : (
                <p className="text-[#e5e4e2]/80 whitespace-pre-wrap">{subcontractor.notes || 'Brak notatek'}</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[#e5e4e2]">Zadania</h2>
              <button
                onClick={() => setShowAddTaskModal(true)}
                className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Dodaj zadanie
              </button>
            </div>

            {tasks.length === 0 ? (
              <p className="text-[#e5e4e2]/60 text-center py-8">Brak zadań</p>
            ) : (
              <div className="space-y-4">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="text-lg font-semibold text-[#e5e4e2] mb-1">
                          {task.task_name}
                        </h3>
                        {task.events && (
                          <div className="text-sm text-[#e5e4e2]/60">
                            Wydarzenie: {task.events.name}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-xs ${getStatusColor(task.status)}`}>
                          {task.status}
                        </span>
                        <span className={`px-2 py-1 rounded text-xs ${getStatusColor(task.payment_status)}`}>
                          {task.payment_status}
                        </span>
                      </div>
                    </div>

                    {task.description && (
                      <p className="text-sm text-[#e5e4e2]/70 mb-3">{task.description}</p>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-[#e5e4e2]/60 mb-1">Typ rozliczenia</div>
                        <div className="text-[#e5e4e2]">{task.payment_type}</div>
                      </div>
                      <div>
                        <div className="text-[#e5e4e2]/60 mb-1">Godziny</div>
                        <div className="text-[#e5e4e2]">
                          {task.actual_hours} / {task.estimated_hours}h
                        </div>
                      </div>
                      <div>
                        <div className="text-[#e5e4e2]/60 mb-1">Stawka/Cena</div>
                        <div className="text-[#e5e4e2]">
                          {task.payment_type === 'fixed'
                            ? `${task.fixed_price} zł`
                            : `${task.hourly_rate} zł/h`}
                        </div>
                      </div>
                      <div>
                        <div className="text-[#e5e4e2]/60 mb-1">Całkowity koszt</div>
                        <div className="text-[#d3bb73] font-semibold">
                          {task.total_cost?.toLocaleString('pl-PL')} zł
                        </div>
                      </div>
                    </div>

                    {task.invoice_number && (
                      <div className="mt-3 pt-3 border-t border-[#d3bb73]/10 text-sm text-[#e5e4e2]/60">
                        Faktura: {task.invoice_number}
                        {task.payment_date && ` | Zapłacono: ${new Date(task.payment_date).toLocaleDateString('pl-PL')}`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'contracts' && (
          <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[#e5e4e2]">Umowy</h2>
              <button
                onClick={() => setShowAddContractModal(true)}
                className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Dodaj umowę
              </button>
            </div>

            {contracts.length === 0 ? (
              <p className="text-[#e5e4e2]/60 text-center py-8">Brak umów</p>
            ) : (
              <div className="space-y-4">
                {contracts.map((contract) => (
                  <div
                    key={contract.id}
                    className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <FileText className="w-5 h-5 text-[#d3bb73]" />
                          <h3 className="text-lg font-semibold text-[#e5e4e2]">
                            {contract.title}
                          </h3>
                        </div>
                        <div className="text-sm text-[#e5e4e2]/60">
                          {contract.contract_number}
                        </div>
                        {contract.events && (
                          <div className="text-sm text-[#e5e4e2]/60">
                            Wydarzenie: {contract.events.name}
                          </div>
                        )}
                      </div>
                      <span className={`px-2 py-1 rounded text-xs ${getStatusColor(contract.status)}`}>
                        {contract.status}
                      </span>
                    </div>

                    {contract.description && (
                      <p className="text-sm text-[#e5e4e2]/70 mb-3">{contract.description}</p>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                      <div>
                        <div className="text-[#e5e4e2]/60 mb-1">Typ</div>
                        <div className="text-[#e5e4e2]">
                          {contract.contract_type === 'frame' ? 'Ramowa' : 'Projektowa'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[#e5e4e2]/60 mb-1">Wartość</div>
                        <div className="text-[#d3bb73] font-semibold">
                          {contract.total_value.toLocaleString('pl-PL')} zł
                        </div>
                      </div>
                      <div>
                        <div className="text-[#e5e4e2]/60 mb-1">Data rozpoczęcia</div>
                        <div className="text-[#e5e4e2]">
                          {contract.start_date
                            ? new Date(contract.start_date).toLocaleDateString('pl-PL')
                            : '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[#e5e4e2]/60 mb-1">Data zakończenia</div>
                        <div className="text-[#e5e4e2]">
                          {contract.end_date
                            ? new Date(contract.end_date).toLocaleDateString('pl-PL')
                            : '-'}
                        </div>
                      </div>
                    </div>

                    {contract.file_path && (
                      <div className="flex items-center gap-2 text-sm text-[#d3bb73]">
                        <FileText className="w-4 h-4" />
                        <span>Umowa dostępna w plikach</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
