'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  UserCheck,
  Mail,
  Phone,
  Star,
  DollarSign,
  Clock,
  CheckCircle,
  AlertCircle,
  FileText,
  Edit,
  Trash2,
  Calendar,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Subcontractor {
  id: string;
  company_name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  hourly_rate: number;
  rating: number | null;
  specialization: string[];
}

interface SubcontractorTask {
  id: string;
  subcontractor_id: string;
  task_name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  estimated_hours: number;
  actual_hours: number;
  hourly_rate: number;
  fixed_price: number;
  payment_type: 'hourly' | 'fixed' | 'mixed';
  total_cost: number;
  status: string;
  invoice_number: string | null;
  payment_status: string;
  payment_date: string | null;
  subcontractors?: Subcontractor;
}

interface Contract {
  id: string;
  subcontractor_id: string;
  contract_number: string;
  title: string;
  total_value: number;
  status: string;
  file_path: string | null;
  subcontractors?: Subcontractor;
}

interface EventSubcontractorsPanelProps {
  eventId: string;
}

export default function EventSubcontractorsPanel({ eventId }: EventSubcontractorsPanelProps) {
  const { showSnackbar } = useSnackbar();
  const [tasks, setTasks] = useState<SubcontractorTask[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [allSubcontractors, setAllSubcontractors] = useState<Subcontractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);

  useEffect(() => {
    if (eventId) {
      fetchData();
    }
  }, [eventId]);

  const fetchData = async () => {
    try {
      setLoading(true);

      const { data: tasksData, error: tasksError } = await supabase
        .from('subcontractor_tasks')
        .select(`
          *,
          subcontractors (
            id,
            company_name,
            contact_person,
            email,
            phone,
            hourly_rate,
            rating,
            specialization
          )
        `)
        .eq('event_id', eventId)
        .order('start_date', { ascending: false });

      if (tasksError) throw tasksError;
      setTasks(tasksData || []);

      const { data: contractsData, error: contractsError } = await supabase
        .from('subcontractor_contracts')
        .select(`
          *,
          subcontractors (
            id,
            company_name,
            contact_person,
            email,
            phone,
            hourly_rate,
            rating,
            specialization
          )
        `)
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (contractsError) throw contractsError;
      setContracts(contractsData || []);

      const { data: subcontractorsData, error: subError } = await supabase
        .from('subcontractors')
        .select('*')
        .eq('status', 'active')
        .order('company_name', { ascending: true });

      if (subError) throw subError;
      setAllSubcontractors(subcontractorsData || []);
    } catch (error) {
      console.error('Error fetching subcontractors data:', error);
      showSnackbar('Błąd podczas ładowania danych podwykonawców', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      planned: 'bg-blue-500/20 text-blue-400',
      in_progress: 'bg-yellow-500/20 text-yellow-400',
      completed: 'bg-green-500/20 text-green-400',
      cancelled: 'bg-red-500/20 text-red-400',
      pending: 'bg-yellow-500/20 text-yellow-400',
      paid: 'bg-green-500/20 text-green-400',
      overdue: 'bg-red-500/20 text-red-400',
      draft: 'bg-gray-500/20 text-gray-400',
      active: 'bg-green-500/20 text-green-400',
      terminated: 'bg-red-500/20 text-red-400',
    };
    return colors[status] || 'bg-gray-500/20 text-gray-400';
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      planned: 'Zaplanowane',
      in_progress: 'W trakcie',
      completed: 'Zakończone',
      cancelled: 'Anulowane',
      pending: 'Oczekuje',
      paid: 'Zapłacone',
      overdue: 'Opóźnione',
      draft: 'Szkic',
      active: 'Aktywna',
      terminated: 'Rozwiązana',
    };
    return labels[status] || status;
  };

  const tasksBySubcontractor = tasks.reduce((acc, task) => {
    const subId = task.subcontractor_id;
    if (!acc[subId]) {
      acc[subId] = [];
    }
    acc[subId].push(task);
    return acc;
  }, {} as Record<string, SubcontractorTask[]>);

  const uniqueSubcontractorIds = new Set([
    ...tasks.map(t => t.subcontractor_id),
    ...contracts.map(c => c.subcontractor_id)
  ]);

  const totalTasksCost = tasks.reduce((sum, task) => sum + (task.total_cost || 0), 0);
  const totalContractsValue = contracts.reduce((sum, contract) => sum + (contract.total_value || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#e5e4e2]">
            Podwykonawcy wydarzenia
          </h2>
          <p className="text-sm text-[#e5e4e2]/60 mt-1">
            Zarządzaj zadaniami podwykonawców dla tego wydarzenia
          </p>
        </div>
        <button
          onClick={() => setShowAddTaskModal(true)}
          className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Dodaj zadanie
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center gap-3 mb-2">
            <UserCheck className="w-5 h-5 text-blue-400" />
            <span className="text-sm text-[#e5e4e2]/60">Podwykonawcy</span>
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">
            {uniqueSubcontractorIds.size}
          </div>
        </div>

        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center gap-3 mb-2">
            <Clock className="w-5 h-5 text-yellow-400" />
            <span className="text-sm text-[#e5e4e2]/60">Zadania</span>
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">{tasks.length}</div>
        </div>

        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center gap-3 mb-2">
            <DollarSign className="w-5 h-5 text-green-400" />
            <span className="text-sm text-[#e5e4e2]/60">Koszt zadań</span>
          </div>
          <div className="text-2xl font-bold text-[#d3bb73]">
            {totalTasksCost.toLocaleString('pl-PL')} zł
          </div>
        </div>

        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-5 h-5 text-purple-400" />
            <span className="text-sm text-[#e5e4e2]/60">Umowy</span>
          </div>
          <div className="text-2xl font-bold text-[#d3bb73]">
            {contracts.length}
          </div>
        </div>
      </div>

      {uniqueSubcontractorIds.size === 0 ? (
        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-12 text-center">
          <UserCheck className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60 mb-4">
            Brak przypisanych podwykonawców do tego wydarzenia
          </p>
          <button
            onClick={() => setShowAddTaskModal(true)}
            className="bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            Dodaj pierwsze zadanie
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(uniqueSubcontractorIds).map((subId) => {
            const subTasks = tasksBySubcontractor[subId] || [];
            const subContracts = contracts.filter(c => c.subcontractor_id === subId);
            const sub = subTasks[0]?.subcontractors || subContracts[0]?.subcontractors;

            if (!sub) return null;

            const subTotalCost = subTasks.reduce((sum, task) => sum + (task.total_cost || 0), 0);

            return (
              <div
                key={subId}
                className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-6"
              >
                <div className="flex items-start justify-between mb-6 pb-4 border-b border-[#d3bb73]/10">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                      <UserCheck className="w-6 h-6 text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-[#e5e4e2] mb-1">
                        {sub.company_name}
                      </h3>
                      {sub.contact_person && (
                        <p className="text-sm text-[#e5e4e2]/60 mb-2">
                          {sub.contact_person}
                        </p>
                      )}
                      <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                        {sub.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="w-4 h-4" />
                            {sub.email}
                          </span>
                        )}
                        {sub.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-4 h-4" />
                            {sub.phone}
                          </span>
                        )}
                        {sub.rating && (
                          <span className="flex items-center gap-1">
                            <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                            {sub.rating}/5
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-sm text-[#e5e4e2]/60 mb-1">
                      Całkowity koszt
                    </div>
                    <div className="text-2xl font-bold text-[#d3bb73]">
                      {subTotalCost.toLocaleString('pl-PL')} zł
                    </div>
                    <div className="text-xs text-[#e5e4e2]/40 mt-1">
                      {subTasks.length} zadań | {subContracts.length} umów
                    </div>
                  </div>
                </div>

                {subTasks.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-[#e5e4e2] mb-3 flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Zadania ({subTasks.length})
                    </h4>
                    <div className="space-y-3">
                      {subTasks.map((task) => (
                        <div
                          key={task.id}
                          className="bg-[#0f1119] rounded-lg p-4 border border-[#d3bb73]/5"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <h5 className="font-medium text-[#e5e4e2] mb-1">
                                {task.task_name}
                              </h5>
                              {task.description && (
                                <p className="text-sm text-[#e5e4e2]/60">
                                  {task.description}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-1 rounded text-xs ${getStatusColor(
                                  task.status
                                )}`}
                              >
                                {getStatusLabel(task.status)}
                              </span>
                              <span
                                className={`px-2 py-1 rounded text-xs ${getStatusColor(
                                  task.payment_status
                                )}`}
                              >
                                {getStatusLabel(task.payment_status)}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-4 gap-4 text-sm mt-3">
                            <div>
                              <div className="text-[#e5e4e2]/40 text-xs mb-1">
                                Rozliczenie
                              </div>
                              <div className="text-[#e5e4e2]">
                                {task.payment_type === 'fixed'
                                  ? 'Ryczałt'
                                  : task.payment_type === 'hourly'
                                  ? 'Godzinowe'
                                  : 'Mieszane'}
                              </div>
                            </div>
                            <div>
                              <div className="text-[#e5e4e2]/40 text-xs mb-1">
                                Godziny
                              </div>
                              <div className="text-[#e5e4e2]">
                                {task.actual_hours}h / {task.estimated_hours}h
                              </div>
                            </div>
                            <div>
                              <div className="text-[#e5e4e2]/40 text-xs mb-1">
                                Stawka/Cena
                              </div>
                              <div className="text-[#e5e4e2]">
                                {task.payment_type === 'fixed'
                                  ? `${task.fixed_price} zł`
                                  : `${task.hourly_rate} zł/h`}
                              </div>
                            </div>
                            <div>
                              <div className="text-[#e5e4e2]/40 text-xs mb-1">
                                Koszt
                              </div>
                              <div className="text-[#d3bb73] font-semibold">
                                {task.total_cost?.toLocaleString('pl-PL')} zł
                              </div>
                            </div>
                          </div>

                          {(task.start_date || task.end_date) && (
                            <div className="mt-3 pt-3 border-t border-[#d3bb73]/5 flex items-center gap-4 text-xs text-[#e5e4e2]/60">
                              {task.start_date && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  Od: {new Date(task.start_date).toLocaleDateString('pl-PL')}
                                </span>
                              )}
                              {task.end_date && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  Do: {new Date(task.end_date).toLocaleDateString('pl-PL')}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {subContracts.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-[#e5e4e2] mb-3 flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Umowy ({subContracts.length})
                    </h4>
                    <div className="space-y-3">
                      {subContracts.map((contract) => (
                        <div
                          key={contract.id}
                          className="bg-[#0f1119] rounded-lg p-4 border border-[#d3bb73]/5"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <h5 className="font-medium text-[#e5e4e2] mb-1">
                                {contract.title}
                              </h5>
                              <p className="text-sm text-[#e5e4e2]/60">
                                {contract.contract_number}
                              </p>
                            </div>
                            <div className="text-right">
                              <span
                                className={`px-2 py-1 rounded text-xs ${getStatusColor(
                                  contract.status
                                )}`}
                              >
                                {getStatusLabel(contract.status)}
                              </span>
                              <div className="text-[#d3bb73] font-semibold mt-2">
                                {contract.total_value.toLocaleString('pl-PL')} zł
                              </div>
                            </div>
                          </div>
                          {contract.file_path && (
                            <div className="mt-3 pt-3 border-t border-[#d3bb73]/5 flex items-center gap-2 text-sm text-[#d3bb73]">
                              <FileText className="w-4 h-4" />
                              <span>Umowa dostępna w plikach wydarzenia</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAddTaskModal && (
        <AddTaskModal
          eventId={eventId}
          subcontractors={allSubcontractors}
          onClose={() => setShowAddTaskModal(false)}
          onSuccess={() => {
            setShowAddTaskModal(false);
            fetchData();
          }}
        />
      )}
    </div>
  );
}

function AddTaskModal({
  eventId,
  subcontractors,
  onClose,
  onSuccess,
}: {
  eventId: string;
  subcontractors: Subcontractor[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    subcontractor_id: '',
    task_name: '',
    description: '',
    start_date: '',
    end_date: '',
    estimated_hours: 0,
    actual_hours: 0,
    payment_type: 'hourly' as 'hourly' | 'fixed' | 'mixed',
    hourly_rate: 0,
    fixed_price: 0,
    status: 'planned',
    payment_status: 'pending',
  });
  const [createContract, setCreateContract] = useState(false);
  const [contractData, setContractData] = useState({
    contract_number: '',
    title: '',
    description: '',
    total_value: 0,
    contract_type: 'project' as 'frame' | 'project',
  });

  const selectedSubcontractor = subcontractors.find(s => s.id === formData.subcontractor_id);

  useEffect(() => {
    if (selectedSubcontractor && formData.payment_type === 'hourly' && formData.hourly_rate === 0) {
      setFormData(prev => ({ ...prev, hourly_rate: selectedSubcontractor.hourly_rate }));
    }
  }, [selectedSubcontractor, formData.payment_type]);

  const handleSubmit = async () => {
    if (!formData.subcontractor_id || !formData.task_name) {
      showSnackbar('Wybierz podwykonawcę i podaj nazwę zadania', 'warning');
      return;
    }

    try {
      setSaving(true);

      const { data: user } = await supabase.auth.getUser();

      // Dodaj zadanie
      const { data: taskData, error: taskError } = await supabase
        .from('subcontractor_tasks')
        .insert([
          {
            event_id: eventId,
            subcontractor_id: formData.subcontractor_id,
            task_name: formData.task_name,
            description: formData.description || null,
            start_date: formData.start_date || null,
            end_date: formData.end_date || null,
            estimated_hours: formData.estimated_hours,
            actual_hours: formData.actual_hours,
            payment_type: formData.payment_type,
            hourly_rate: formData.hourly_rate,
            fixed_price: formData.fixed_price,
            status: formData.status,
            payment_status: formData.payment_status,
          },
        ])
        .select()
        .single();

      if (taskError) throw taskError;

      // Jeśli trzeba utworzyć umowę
      if (createContract && contractData.contract_number && contractData.title) {
        const { error: contractError } = await supabase
          .from('subcontractor_contracts')
          .insert([
            {
              subcontractor_id: formData.subcontractor_id,
              event_id: eventId,
              contract_number: contractData.contract_number,
              contract_type: contractData.contract_type,
              title: contractData.title,
              description: contractData.description || null,
              total_value: contractData.total_value,
              status: 'draft',
              created_by: user?.user?.id,
            },
          ]);

        if (contractError) throw contractError;
      }

      showSnackbar('Zadanie dodane pomyślnie!', 'success');
      onSuccess();
    } catch (error) {
      console.error('Error adding task:', error);
      showSnackbar('Błąd podczas dodawania zadania', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-3xl w-full my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj zadanie dla podwykonawcy</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6">
          {/* Wybór podwykonawcy */}
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Podwykonawca *
            </label>
            <select
              value={formData.subcontractor_id}
              onChange={(e) => setFormData({ ...formData, subcontractor_id: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="">Wybierz podwykonawcę...</option>
              {subcontractors.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.company_name} {sub.hourly_rate > 0 && `(${sub.hourly_rate} zł/h)`}
                </option>
              ))}
            </select>
          </div>

          {/* Nazwa zadania */}
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Nazwa zadania *
            </label>
            <input
              type="text"
              value={formData.task_name}
              onChange={(e) => setFormData({ ...formData, task_name: e.target.value })}
              placeholder="np. Obsługa nagłośnienia"
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          {/* Opis */}
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              placeholder="Szczegóły zadania..."
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] resize-y"
            />
          </div>

          {/* Daty */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Data rozpoczęcia
              </label>
              <input
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Data zakończenia
              </label>
              <input
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
            </div>
          </div>

          {/* Typ rozliczenia */}
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Typ rozliczenia
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(['hourly', 'fixed', 'mixed'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setFormData({ ...formData, payment_type: type })}
                  className={`px-4 py-2 rounded-lg border transition-colors ${
                    formData.payment_type === type
                      ? 'bg-[#d3bb73] text-[#1c1f33] border-[#d3bb73]'
                      : 'bg-[#1c1f33] text-[#e5e4e2] border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                >
                  {type === 'hourly' ? 'Godzinowe' : type === 'fixed' ? 'Ryczałt' : 'Mieszane'}
                </button>
              ))}
            </div>
          </div>

          {/* Godziny i stawki */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Szacowane godziny
              </label>
              <input
                type="number"
                value={formData.estimated_hours}
                onChange={(e) => setFormData({ ...formData, estimated_hours: parseFloat(e.target.value) || 0 })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Rzeczywiste godziny
              </label>
              <input
                type="number"
                value={formData.actual_hours}
                onChange={(e) => setFormData({ ...formData, actual_hours: parseFloat(e.target.value) || 0 })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
            </div>
          </div>

          {(formData.payment_type === 'hourly' || formData.payment_type === 'mixed') && (
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Stawka godzinowa (zł)
              </label>
              <input
                type="number"
                value={formData.hourly_rate}
                onChange={(e) => setFormData({ ...formData, hourly_rate: parseFloat(e.target.value) || 0 })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
            </div>
          )}

          {(formData.payment_type === 'fixed' || formData.payment_type === 'mixed') && (
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Cena ryczałtowa (zł)
              </label>
              <input
                type="number"
                value={formData.fixed_price}
                onChange={(e) => setFormData({ ...formData, fixed_price: parseFloat(e.target.value) || 0 })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
            </div>
          )}

          {/* Statusy */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Status zadania
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              >
                <option value="planned">Zaplanowane</option>
                <option value="in_progress">W trakcie</option>
                <option value="completed">Zakończone</option>
                <option value="cancelled">Anulowane</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Status płatności
              </label>
              <select
                value={formData.payment_status}
                onChange={(e) => setFormData({ ...formData, payment_status: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              >
                <option value="pending">Oczekuje</option>
                <option value="paid">Zapłacone</option>
                <option value="overdue">Opóźnione</option>
              </select>
            </div>
          </div>

          {/* Opcjonalna umowa */}
          <div className="pt-6 border-t border-[#d3bb73]/10">
            <label className="flex items-center gap-2 text-sm text-[#e5e4e2] mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={createContract}
                onChange={(e) => setCreateContract(e.target.checked)}
                className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
              />
              Utwórz umowę dla tego zadania
            </label>

            {createContract && (
              <div className="space-y-4 pl-6 border-l-2 border-[#d3bb73]/20">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                      Numer umowy *
                    </label>
                    <input
                      type="text"
                      value={contractData.contract_number}
                      onChange={(e) => setContractData({ ...contractData, contract_number: e.target.value })}
                      placeholder="np. UMW/2025/001"
                      className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                      Typ umowy
                    </label>
                    <select
                      value={contractData.contract_type}
                      onChange={(e) => setContractData({ ...contractData, contract_type: e.target.value as 'frame' | 'project' })}
                      className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    >
                      <option value="project">Projektowa</option>
                      <option value="frame">Ramowa</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                    Tytuł umowy *
                  </label>
                  <input
                    type="text"
                    value={contractData.title}
                    onChange={(e) => setContractData({ ...contractData, title: e.target.value })}
                    placeholder="np. Umowa o świadczenie usług nagłośnienia"
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                    Wartość umowy (zł)
                  </label>
                  <input
                    type="number"
                    value={contractData.total_value}
                    onChange={(e) => setContractData({ ...contractData, total_value: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                    Opis umowy
                  </label>
                  <textarea
                    value={contractData.description}
                    onChange={(e) => setContractData({ ...contractData, description: e.target.value })}
                    rows={2}
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] resize-y"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {saving ? 'Zapisywanie...' : 'Dodaj zadanie'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-[#e5e4e2]/60 hover:bg-[#1c1f33] disabled:opacity-50"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
