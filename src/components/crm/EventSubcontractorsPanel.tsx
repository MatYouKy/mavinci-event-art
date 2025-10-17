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
  const [showAddContractModal, setShowAddContractModal] = useState(false);

  useEffect(() => {
    if (eventId) {
      fetchData();
    }
  }, [eventId]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Pobierz zadania podwykonawców dla tego wydarzenia
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

      // Pobierz umowy podwykonawców dla tego wydarzenia
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

      // Pobierz listę wszystkich aktywnych podwykonawców
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

  // Grupuj zadania po podwykonawcach
  const tasksBySubcontractor = tasks.reduce((acc, task) => {
    const subId = task.subcontractor_id;
    if (!acc[subId]) {
      acc[subId] = [];
    }
    acc[subId].push(task);
    return acc;
  }, {} as Record<string, SubcontractorTask[]>);

  // Pobierz unikalnych podwykonawców z zadaniami lub umowami
  const uniqueSubcontractorIds = new Set([
    ...tasks.map(t => t.subcontractor_id),
    ...contracts.map(c => c.subcontractor_id)
  ]);

  const totalTasksCost = tasks.reduce((sum, task) => sum + (task.total_cost || 0), 0);
  const totalContractsValue = contracts.reduce((sum, contract) => sum + (contract.total_value || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Nagłówek z przyciskami */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#e5e4e2]">
            Podwykonawcy wydarzenia
          </h2>
          <p className="text-sm text-[#e5e4e2]/60 mt-1">
            Zarządzaj podwykonawcami, zadaniami i umowami dla tego wydarzenia
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowAddTaskModal(true)}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Dodaj zadanie
          </button>
          <button
            onClick={() => setShowAddContractModal(true)}
            className="flex items-center gap-2 bg-[#d3bb73]/20 text-[#d3bb73] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/30 transition-colors"
          >
            <FileText className="w-4 h-4" />
            Dodaj umowę
          </button>
        </div>
      </div>

      {/* Statystyki */}
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
            <span className="text-sm text-[#e5e4e2]/60">Wartość umów</span>
          </div>
          <div className="text-2xl font-bold text-[#d3bb73]">
            {totalContractsValue.toLocaleString('pl-PL')} zł
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
          {/* Lista podwykonawców z ich zadaniami */}
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
                {/* Nagłówek podwykonawcy */}
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

                {/* Zadania */}
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
                                Stawka/Kwota
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

                {/* Umowy */}
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
    </div>
  );
}
