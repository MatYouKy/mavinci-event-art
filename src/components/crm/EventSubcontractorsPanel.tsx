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
        .select(
          `
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
        `,
        )
        .eq('event_id', eventId)
        .order('start_date', { ascending: false });

      if (tasksError) throw tasksError;
      setTasks(tasksData || []);

      const { data: contractsData, error: contractsError } = await supabase
        .from('subcontractor_contracts')
        .select(
          `
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
        `,
        )
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

  const tasksBySubcontractor = tasks.reduce(
    (acc, task) => {
      const subId = task.subcontractor_id;
      if (!acc[subId]) {
        acc[subId] = [];
      }
      acc[subId].push(task);
      return acc;
    },
    {} as Record<string, SubcontractorTask[]>,
  );

  const uniqueSubcontractorIds = new Set([
    ...tasks.map((t) => t.subcontractor_id),
    ...contracts.map((c) => c.subcontractor_id),
  ]);

  const totalTasksCost = tasks.reduce((sum, task) => sum + (task.total_cost || 0), 0);
  const totalContractsValue = contracts.reduce(
    (sum, contract) => sum + (contract.total_value || 0),
    0,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#e5e4e2]">Podwykonawcy wydarzenia</h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Zarządzaj zadaniami podwykonawców dla tego wydarzenia
          </p>
        </div>
        <button
          onClick={() => setShowAddTaskModal(true)}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj zadanie
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <div className="mb-2 flex items-center gap-3">
            <UserCheck className="h-5 w-5 text-blue-400" />
            <span className="text-sm text-[#e5e4e2]/60">Podwykonawcy</span>
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">{uniqueSubcontractorIds.size}</div>
        </div>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <div className="mb-2 flex items-center gap-3">
            <Clock className="h-5 w-5 text-yellow-400" />
            <span className="text-sm text-[#e5e4e2]/60">Zadania</span>
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">{tasks.length}</div>
        </div>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <div className="mb-2 flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-green-400" />
            <span className="text-sm text-[#e5e4e2]/60">Koszt zadań</span>
          </div>
          <div className="text-2xl font-bold text-[#d3bb73]">
            {totalTasksCost.toLocaleString('pl-PL')} zł
          </div>
        </div>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <div className="mb-2 flex items-center gap-3">
            <FileText className="h-5 w-5 text-purple-400" />
            <span className="text-sm text-[#e5e4e2]/60">Umowy</span>
          </div>
          <div className="text-2xl font-bold text-[#d3bb73]">{contracts.length}</div>
        </div>
      </div>

      {uniqueSubcontractorIds.size === 0 ? (
        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
          <UserCheck className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="mb-4 text-[#e5e4e2]/60">
            Brak przypisanych podwykonawców do tego wydarzenia
          </p>
          <button
            onClick={() => setShowAddTaskModal(true)}
            className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            Dodaj pierwsze zadanie
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(uniqueSubcontractorIds).map((subId) => {
            const subTasks = tasksBySubcontractor[subId] || [];
            const subContracts = contracts.filter((c) => c.subcontractor_id === subId);
            const sub = subTasks[0]?.subcontractors || subContracts[0]?.subcontractors;

            if (!sub) return null;

            const subTotalCost = subTasks.reduce((sum, task) => sum + (task.total_cost || 0), 0);

            return (
              <div key={subId} className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
                <div className="mb-6 flex items-start justify-between border-b border-[#d3bb73]/10 pb-4">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/20">
                      <UserCheck className="h-6 w-6 text-blue-400" />
                    </div>
                    <div>
                      <h3 className="mb-1 text-lg font-semibold text-[#e5e4e2]">
                        {sub.company_name}
                      </h3>
                      {sub.contact_person && (
                        <p className="mb-2 text-sm text-[#e5e4e2]/60">{sub.contact_person}</p>
                      )}
                      <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                        {sub.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-4 w-4" />
                            {sub.email}
                          </span>
                        )}
                        {sub.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-4 w-4" />
                            {sub.phone}
                          </span>
                        )}
                        {sub.rating && (
                          <span className="flex items-center gap-1">
                            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                            {sub.rating}/5
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="mb-1 text-sm text-[#e5e4e2]/60">Całkowity koszt</div>
                    <div className="text-2xl font-bold text-[#d3bb73]">
                      {subTotalCost.toLocaleString('pl-PL')} zł
                    </div>
                    <div className="mt-1 text-xs text-[#e5e4e2]/40">
                      {subTasks.length} zadań | {subContracts.length} umów
                    </div>
                  </div>
                </div>

                {subTasks.length > 0 && (
                  <div className="mb-4">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
                      <Clock className="h-4 w-4" />
                      Zadania ({subTasks.length})
                    </h4>
                    <div className="space-y-3">
                      {subTasks.map((task) => (
                        <div
                          key={task.id}
                          className="rounded-lg border border-[#d3bb73]/5 bg-[#0f1119] p-4"
                        >
                          <div className="mb-2 flex items-start justify-between">
                            <div>
                              <h5 className="mb-1 font-medium text-[#e5e4e2]">{task.task_name}</h5>
                              {task.description && (
                                <p className="text-sm text-[#e5e4e2]/60">{task.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded px-2 py-1 text-xs ${getStatusColor(
                                  task.status,
                                )}`}
                              >
                                {getStatusLabel(task.status)}
                              </span>
                              <span
                                className={`rounded px-2 py-1 text-xs ${getStatusColor(
                                  task.payment_status,
                                )}`}
                              >
                                {getStatusLabel(task.payment_status)}
                              </span>
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-4 gap-4 text-sm">
                            <div>
                              <div className="mb-1 text-xs text-[#e5e4e2]/40">Rozliczenie</div>
                              <div className="text-[#e5e4e2]">
                                {task.payment_type === 'fixed'
                                  ? 'Ryczałt'
                                  : task.payment_type === 'hourly'
                                    ? 'Godzinowe'
                                    : 'Mieszane'}
                              </div>
                            </div>
                            <div>
                              <div className="mb-1 text-xs text-[#e5e4e2]/40">Godziny</div>
                              <div className="text-[#e5e4e2]">
                                {task.actual_hours}h / {task.estimated_hours}h
                              </div>
                            </div>
                            <div>
                              <div className="mb-1 text-xs text-[#e5e4e2]/40">Stawka/Cena</div>
                              <div className="text-[#e5e4e2]">
                                {task.payment_type === 'fixed'
                                  ? `${task.fixed_price} zł`
                                  : `${task.hourly_rate} zł/h`}
                              </div>
                            </div>
                            <div>
                              <div className="mb-1 text-xs text-[#e5e4e2]/40">Koszt</div>
                              <div className="font-semibold text-[#d3bb73]">
                                {task.total_cost?.toLocaleString('pl-PL')} zł
                              </div>
                            </div>
                          </div>

                          {(task.start_date || task.end_date) && (
                            <div className="mt-3 flex items-center gap-4 border-t border-[#d3bb73]/5 pt-3 text-xs text-[#e5e4e2]/60">
                              {task.start_date && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  Od: {new Date(task.start_date).toLocaleDateString('pl-PL')}
                                </span>
                              )}
                              {task.end_date && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
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
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
                      <FileText className="h-4 w-4" />
                      Umowy ({subContracts.length})
                    </h4>
                    <div className="space-y-3">
                      {subContracts.map((contract) => (
                        <div
                          key={contract.id}
                          className="rounded-lg border border-[#d3bb73]/5 bg-[#0f1119] p-4"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <h5 className="mb-1 font-medium text-[#e5e4e2]">{contract.title}</h5>
                              <p className="text-sm text-[#e5e4e2]/60">
                                {contract.contract_number}
                              </p>
                            </div>
                            <div className="text-right">
                              <span
                                className={`rounded px-2 py-1 text-xs ${getStatusColor(
                                  contract.status,
                                )}`}
                              >
                                {getStatusLabel(contract.status)}
                              </span>
                              <div className="mt-2 font-semibold text-[#d3bb73]">
                                {contract.total_value.toLocaleString('pl-PL')} zł
                              </div>
                            </div>
                          </div>
                          {contract.file_path && (
                            <div className="mt-3 flex items-center gap-2 border-t border-[#d3bb73]/5 pt-3 text-sm text-[#d3bb73]">
                              <FileText className="h-4 w-4" />
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

  const selectedSubcontractor = subcontractors.find((s) => s.id === formData.subcontractor_id);

  useEffect(() => {
    if (selectedSubcontractor && formData.payment_type === 'hourly' && formData.hourly_rate === 0) {
      setFormData((prev) => ({ ...prev, hourly_rate: selectedSubcontractor.hourly_rate }));
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
        const { error: contractError } = await supabase.from('subcontractor_contracts').insert([
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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj zadanie dla podwykonawcy</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6">
          {/* Wybór podwykonawcy */}
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Podwykonawca *</label>
            <select
              value={formData.subcontractor_id}
              onChange={(e) => setFormData({ ...formData, subcontractor_id: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
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
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa zadania *</label>
            <input
              type="text"
              value={formData.task_name}
              onChange={(e) => setFormData({ ...formData, task_name: e.target.value })}
              placeholder="np. Obsługa nagłośnienia"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          {/* Opis */}
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              placeholder="Szczegóły zadania..."
              className="w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          {/* Daty */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data rozpoczęcia</label>
              <input
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data zakończenia</label>
              <input
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
          </div>

          {/* Typ rozliczenia */}
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Typ rozliczenia</label>
            <div className="grid grid-cols-3 gap-3">
              {(['hourly', 'fixed', 'mixed'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setFormData({ ...formData, payment_type: type })}
                  className={`rounded-lg border px-4 py-2 transition-colors ${
                    formData.payment_type === type
                      ? 'border-[#d3bb73] bg-[#d3bb73] text-[#1c1f33]'
                      : 'border-[#d3bb73]/20 bg-[#1c1f33] text-[#e5e4e2] hover:border-[#d3bb73]/40'
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
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Szacowane godziny</label>
              <input
                type="number"
                value={formData.estimated_hours}
                onChange={(e) =>
                  setFormData({ ...formData, estimated_hours: parseFloat(e.target.value) || 0 })
                }
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Rzeczywiste godziny</label>
              <input
                type="number"
                value={formData.actual_hours}
                onChange={(e) =>
                  setFormData({ ...formData, actual_hours: parseFloat(e.target.value) || 0 })
                }
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
          </div>

          {(formData.payment_type === 'hourly' || formData.payment_type === 'mixed') && (
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Stawka godzinowa (zł)</label>
              <input
                type="number"
                value={formData.hourly_rate}
                onChange={(e) =>
                  setFormData({ ...formData, hourly_rate: parseFloat(e.target.value) || 0 })
                }
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
          )}

          {(formData.payment_type === 'fixed' || formData.payment_type === 'mixed') && (
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Cena ryczałtowa (zł)</label>
              <input
                type="number"
                value={formData.fixed_price}
                onChange={(e) =>
                  setFormData({ ...formData, fixed_price: parseFloat(e.target.value) || 0 })
                }
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
          )}

          {/* Statusy */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status zadania</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              >
                <option value="planned">Zaplanowane</option>
                <option value="in_progress">W trakcie</option>
                <option value="completed">Zakończone</option>
                <option value="cancelled">Anulowane</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status płatności</label>
              <select
                value={formData.payment_status}
                onChange={(e) => setFormData({ ...formData, payment_status: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              >
                <option value="pending">Oczekuje</option>
                <option value="paid">Zapłacone</option>
                <option value="overdue">Opóźnione</option>
              </select>
            </div>
          </div>

          {/* Opcjonalna umowa */}
          <div className="border-t border-[#d3bb73]/10 pt-6">
            <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-[#e5e4e2]">
              <input
                type="checkbox"
                checked={createContract}
                onChange={(e) => setCreateContract(e.target.checked)}
                className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
              />
              Utwórz umowę dla tego zadania
            </label>

            {createContract && (
              <div className="space-y-4 border-l-2 border-[#d3bb73]/20 pl-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Numer umowy *</label>
                    <input
                      type="text"
                      value={contractData.contract_number}
                      onChange={(e) =>
                        setContractData({ ...contractData, contract_number: e.target.value })
                      }
                      placeholder="np. UMW/2025/001"
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Typ umowy</label>
                    <select
                      value={contractData.contract_type}
                      onChange={(e) =>
                        setContractData({
                          ...contractData,
                          contract_type: e.target.value as 'frame' | 'project',
                        })
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    >
                      <option value="project">Projektowa</option>
                      <option value="frame">Ramowa</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Tytuł umowy *</label>
                  <input
                    type="text"
                    value={contractData.title}
                    onChange={(e) => setContractData({ ...contractData, title: e.target.value })}
                    placeholder="np. Umowa o świadczenie usług nagłośnienia"
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wartość umowy (zł)</label>
                  <input
                    type="number"
                    value={contractData.total_value}
                    onChange={(e) =>
                      setContractData({
                        ...contractData,
                        total_value: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis umowy</label>
                  <textarea
                    value={contractData.description}
                    onChange={(e) =>
                      setContractData({ ...contractData, description: e.target.value })
                    }
                    rows={2}
                    className="w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {saving ? 'Zapisywanie...' : 'Dodaj zadanie'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33] disabled:opacity-50"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
