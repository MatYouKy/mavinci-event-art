'use client';

import { useState, useEffect, useMemo } from 'react';
import { Plus, UserCheck, Mail, Phone, Star, DollarSign, Clock, AlertCircle, FileText, Calendar, X, Send, ShieldCheck, UserPlus, Pencil, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { FileDropzone } from '@/components/UI/FileDropzone/FileDropzone';
import { useEventWorkspace } from '@/components/crm/events/EventWorkspaceProvider';

interface Subcontractor {
  id: string;
  company_name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  nip?: string | null;
  hourly_rate: number;
  rating: number | null;
  specialization: string[];
  entity_type?: 'company' | 'individual';
  is_registered_business?: boolean;
  default_settlement_type?: SettlementType;
  preferred_payment_method?: PaymentMethod;
}

interface SubcontractorCatalogService {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  unit_price: number | null;
  unit: string | null;
}

type SettlementType = 'invoice_vat' | 'invoice_no_vat' | 'cash' | 'civil_contract' | 'other';
type PaymentMethod = 'transfer' | 'cash' | 'card' | 'other';

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
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  scope_of_work?: string | null;
  deliverables?: string | null;
  guidelines?: string | null;
  operational_notes?: string | null;
  settlement_type?: SettlementType;
  payment_method?: PaymentMethod;
  currency?: string;
  agreed_cost?: number;
  contact_name_snapshot?: string | null;
  contact_email_snapshot?: string | null;
  contact_phone_snapshot?: string | null;
  guidelines_status?: 'draft' | 'sent' | 'confirmed' | 'declined' | 'expired';
  guidelines_sent_at?: string | null;
  confirmed_at?: string | null;
  declined_at?: string | null;
  reminder_week_sent_at?: string | null;
  reminder_day_sent_at?: string | null;
  task_type?: 'service' | 'equipment_rental' | 'other';
  event_equipment_id?: string;
  service_catalog_id?: string | null;
  subcontractors?: Subcontractor;
  event_equipment?: {
    id: string;
    quantity: number;
    equipment_id?: string;
    kit_id?: string;
    cable_id?: string;
    equipment_items?: { name: string; thumbnail_url?: string };
    equipment_kits?: { name: string; thumbnail_url?: string };
    cables?: { name: string };
  };
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
  const { refresh: refreshWorkspace } = useEventWorkspace();
  const [tasks, setTasks] = useState<SubcontractorTask[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [allSubcontractors, setAllSubcontractors] = useState<Subcontractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<SubcontractorTask | null>(null);
  const [sendingTaskId, setSendingTaskId] = useState<string | null>(null);

  const uniqueSubcontractors = useMemo(() => {
    const seen = new Set<string>();

    return allSubcontractors.filter((subcontractor) => {
      const normalizedNip = subcontractor.nip?.replace(/\D/g, '') || '';
      const normalizedEmail = subcontractor.email?.trim().toLowerCase() || '';
      const normalizedPhone = subcontractor.phone?.replace(/\D/g, '') || '';
      const normalizedName = subcontractor.company_name.trim().toLowerCase().replace(/\s+/g, ' ');
      const businessKeys = [
        normalizedNip ? `nip:${normalizedNip}` : '',
        normalizedEmail ? `email:${normalizedEmail}` : '',
        normalizedPhone ? `name-phone:${normalizedName}:${normalizedPhone}` : '',
      ].filter(Boolean);

      if (businessKeys.length === 0) businessKeys.push(`name:${normalizedName}`);
      if (businessKeys.some((key) => seen.has(key))) return false;
      businessKeys.forEach((key) => seen.add(key));
      return true;
    });
  }, [allSubcontractors]);

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
          ),
          event_equipment (
            id,
            quantity,
            equipment_id,
            kit_id,
            cable_id,
            equipment_items (name, thumbnail_url),
            equipment_kits (name, thumbnail_url),
            cables (name)
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
      sent: 'bg-blue-500/20 text-blue-300',
      confirmed: 'bg-green-500/20 text-green-300',
      declined: 'bg-red-500/20 text-red-300',
      expired: 'bg-orange-500/20 text-orange-300',
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
      sent: 'Wysłano do potwierdzenia',
      confirmed: 'Potwierdzone',
      declined: 'Odrzucone',
      expired: 'Wygasło',
    };
    return labels[status] || status;
  };

  const previewContract = async (contract: Contract) => {
    if (!contract.file_path) return;

    const { data, error } = await supabase.storage
      .from('event-files')
      .createSignedUrl(contract.file_path, 900);

    if (error || !data?.signedUrl) {
      showSnackbar('Nie udało się otworzyć podglądu umowy', 'error');
      return;
    }

    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const sendGuidelines = async (task: SubcontractorTask) => {
    const recipient = task.contact_email_snapshot || task.subcontractors?.email;
    if (!recipient) {
      showSnackbar('Uzupełnij adres e-mail podwykonawcy przed wysłaniem wytycznych', 'warning');
      return;
    }
    try {
      setSendingTaskId(task.id);
      const { error } = await supabase.functions.invoke('send-subcontractor-assignment', {
        body: { taskId: task.id },
      });
      if (error) throw error;
      showSnackbar('Wytyczne wysłane do podwykonawcy', 'success');
      await fetchData();
      refreshWorkspace('subcontractor_tasks');
    } catch (error) {
      console.error('Error sending subcontractor guidelines:', error);
      showSnackbar('Nie udało się wysłać wytycznych', 'error');
    } finally {
      setSendingTaskId(null);
    }
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

  const totalTasksCost = tasks.reduce(
    (sum, task) => sum + (task.agreed_cost || task.total_cost || 0),
    0,
  );
  const totalContractsValue = contracts.reduce(
    (sum, contract) => sum + (contract.total_value || 0),
    0,
  );

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
          <h2 className="text-xl font-bold text-[#e5e4e2]">Podwykonawcy wydarzenia</h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Jedno miejsce dla zakresu prac, godzin, rozliczeń, umów i potwierdzeń
          </p>
        </div>
        <button
          onClick={() => setShowAddTaskModal(true)}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj zlecenie
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

      {tasks.filter((t) => t.task_type === 'equipment_rental' && !t.subcontractor_id).length > 0 && (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-6">
          <div className="mb-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-400" />
            <h3 className="text-lg font-semibold text-[#e5e4e2]">
              Sprzęt do wynajęcia (bez podwykonawcy)
            </h3>
          </div>
          <div className="space-y-3">
            {tasks
              .filter((t) => t.task_type === 'equipment_rental' && !t.subcontractor_id)
              .map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4"
                >
                  {(task.event_equipment?.equipment_items?.thumbnail_url ||
                    task.event_equipment?.equipment_kits?.thumbnail_url) && (
                    <img
                      src={
                        task.event_equipment.equipment_items?.thumbnail_url ||
                        task.event_equipment.equipment_kits?.thumbnail_url
                      }
                      alt="Sprzęt"
                      className="h-14 w-14 rounded object-cover"
                    />
                  )}
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <h4 className="font-medium text-[#e5e4e2]">{task.task_name}</h4>
                      <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">
                        WYNAJEM
                      </span>
                    </div>
                    {task.event_equipment && (
                      <p className="text-sm text-[#e5e4e2]/60">
                        {task.event_equipment.equipment_items?.name ||
                          task.event_equipment.equipment_kits?.name ||
                          task.event_equipment.cables?.name}{' '}
                        - {task.event_equipment.quantity} szt.
                      </p>
                    )}
                    {task.description && (
                      <p className="mt-1 text-xs text-[#e5e4e2]/40">{task.description}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="mb-1 text-xs text-[#e5e4e2]/40">Status</div>
                    <span
                      className={`inline-block rounded px-2 py-1 text-xs ${getStatusColor(task.status)}`}
                    >
                      {getStatusLabel(task.status)}
                    </span>
                  </div>
                </div>
              ))}
          </div>
          <p className="mt-4 text-sm text-[#e5e4e2]/60">
            Wybierz podwykonawcę dla tych zadań aby móc dodać szczegóły wynajmu
          </p>
        </div>
      )}

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

            const subTotalCost = subTasks.reduce(
              (sum, task) => sum + (task.agreed_cost || task.total_cost || 0),
              0,
            );

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
                      Zlecenia ({subTasks.length})
                    </h4>
                    <div className="space-y-3">
                      {subTasks.map((task) => (
                        <div
                          key={task.id}
                          className="rounded-lg border border-[#d3bb73]/5 bg-[#0f1119] p-4"
                        >
                          <div className="mb-2 flex items-start justify-between">
                            <div className="flex-1">
                              <div className="mb-1 flex items-center gap-2">
                                <h5 className="font-medium text-[#e5e4e2]">{task.task_name}</h5>
                                {task.task_type === 'equipment_rental' && (
                                  <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">
                                    WYNAJEM SPRZĘTU
                                  </span>
                                )}
                              </div>
                              {(task.scope_of_work || task.description) && (
                                <p className="text-sm text-[#e5e4e2]/60">
                                  {task.scope_of_work || task.description}
                                </p>
                              )}
                              {task.event_equipment && (
                                <div className="mt-2 flex items-center gap-2 rounded border border-[#d3bb73]/10 bg-[#1c1f33] p-2">
                                  {(task.event_equipment.equipment_items?.thumbnail_url ||
                                    task.event_equipment.equipment_kits?.thumbnail_url) && (
                                    <img
                                      src={
                                        task.event_equipment.equipment_items?.thumbnail_url ||
                                        task.event_equipment.equipment_kits?.thumbnail_url
                                      }
                                      alt="Sprzęt"
                                      className="h-10 w-10 rounded object-cover"
                                    />
                                  )}
                                  <div className="flex-1">
                                    <div className="text-sm font-medium text-[#e5e4e2]">
                                      {task.event_equipment.equipment_items?.name ||
                                        task.event_equipment.equipment_kits?.name ||
                                        task.event_equipment.cables?.name ||
                                        'Sprzęt'}
                                    </div>
                                    <div className="text-xs text-[#e5e4e2]/60">
                                      Ilość: {task.event_equipment.quantity} szt.
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded px-2 py-1 text-xs ${getStatusColor(
                                  task.guidelines_status || 'draft',
                                )}`}
                              >
                                {getStatusLabel(task.guidelines_status || 'draft')}
                              </span>
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

                          <div className="mt-3 grid grid-cols-2 gap-4 text-sm lg:grid-cols-5">
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
                              <div className="mb-1 text-xs text-[#e5e4e2]/40">Forma</div>
                              <div className="text-[#e5e4e2]">
                                {task.settlement_type === 'cash'
                                  ? 'Gotówka'
                                  : task.settlement_type === 'civil_contract'
                                    ? 'Umowa cywilna'
                                    : task.settlement_type === 'invoice_no_vat'
                                      ? 'Faktura bez VAT'
                                      : task.settlement_type === 'invoice_vat'
                                        ? 'Faktura VAT'
                                        : 'Inne'}
                              </div>
                            </div>
                            <div>
                              <div className="mb-1 text-xs text-[#e5e4e2]/40">Koszt</div>
                              <div className="font-semibold text-[#d3bb73]">
                                {(task.agreed_cost || task.total_cost || 0).toLocaleString('pl-PL')}{' '}
                                {task.currency || 'PLN'}
                              </div>
                            </div>
                          </div>

                          {(task.deliverables || task.guidelines || task.operational_notes) && (
                            <div className="mt-3 grid gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]/60 p-3 text-sm md:grid-cols-3">
                              {task.deliverables && (
                                <div>
                                  <div className="mb-1 text-xs font-medium text-[#d3bb73]">Rezultat</div>
                                  <p className="whitespace-pre-wrap text-[#e5e4e2]/70">{task.deliverables}</p>
                                </div>
                              )}
                              {task.guidelines && (
                                <div>
                                  <div className="mb-1 text-xs font-medium text-[#d3bb73]">Wytyczne</div>
                                  <p className="whitespace-pre-wrap text-[#e5e4e2]/70">{task.guidelines}</p>
                                </div>
                              )}
                              {task.operational_notes && (
                                <div>
                                  <div className="mb-1 text-xs font-medium text-[#d3bb73]">Notatki wewnętrzne</div>
                                  <p className="whitespace-pre-wrap text-[#e5e4e2]/70">{task.operational_notes}</p>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#d3bb73]/5 pt-3 text-xs text-[#e5e4e2]/60">
                            <div className="flex flex-wrap items-center gap-4">
                              {(task.scheduled_start || task.start_date) && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  Od:{' '}
                                  {new Date(task.scheduled_start || task.start_date!).toLocaleString(
                                    'pl-PL',
                                    { dateStyle: 'short', timeStyle: task.scheduled_start ? 'short' : undefined },
                                  )}
                                </span>
                              )}
                              {(task.scheduled_end || task.end_date) && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  Do:{' '}
                                  {new Date(task.scheduled_end || task.end_date!).toLocaleString(
                                    'pl-PL',
                                    { dateStyle: 'short', timeStyle: task.scheduled_end ? 'short' : undefined },
                                  )}
                                </span>
                              )}
                              {task.confirmed_at && (
                                <span className="flex items-center gap-1 text-green-300">
                                  <ShieldCheck className="h-3 w-3" />
                                  Potwierdzono {new Date(task.confirmed_at).toLocaleDateString('pl-PL')}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingTask(task)}
                                className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 font-medium text-[#e5e4e2]/70 hover:bg-white/5"
                              >
                                <Pencil className="h-3.5 w-3.5" /> Edytuj
                              </button>
                              <button
                                type="button"
                                onClick={() => sendGuidelines(task)}
                                disabled={sendingTaskId === task.id}
                                className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-3 py-2 font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50"
                              >
                                <Send className="h-3.5 w-3.5" />
                                {sendingTaskId === task.id
                                  ? 'Wysyłanie...'
                                  : task.guidelines_status === 'sent'
                                    ? 'Wyślij ponownie'
                                    : 'Wyślij wytyczne'}
                              </button>
                            </div>
                          </div>
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
                            <button
                              type="button"
                              onClick={() => previewContract(contract)}
                              className="mt-3 flex w-full items-center gap-2 border-t border-[#d3bb73]/5 pt-3 text-left text-sm text-[#d3bb73] hover:text-[#e2ce91]"
                            >
                              <FileText className="h-4 w-4" />
                              <span>Podgląd umowy</span>
                              <ExternalLink className="ml-auto h-3.5 w-3.5" />
                            </button>
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
          subcontractors={uniqueSubcontractors}
          onClose={() => setShowAddTaskModal(false)}
          onSuccess={() => {
            setShowAddTaskModal(false);
            void fetchData();
            refreshWorkspace('subcontractor_tasks');
          }}
        />
      )}
      {editingTask && (
        <AddTaskModal
          eventId={eventId}
          subcontractors={uniqueSubcontractors}
          initialTask={editingTask}
          onClose={() => setEditingTask(null)}
          onSuccess={() => {
            setEditingTask(null);
            void fetchData();
            refreshWorkspace('subcontractor_tasks');
          }}
        />
      )}
    </div>
  );
}

function AddTaskModal({
  eventId,
  subcontractors,
  initialTask,
  onClose,
  onSuccess,
}: {
  eventId: string;
  subcontractors: Subcontractor[];
  initialTask?: SubcontractorTask;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [saving, setSaving] = useState(false);
  const [providerMode, setProviderMode] = useState<'existing' | 'quick'>('existing');
  const [catalogServices, setCatalogServices] = useState<SubcontractorCatalogService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [quickProvider, setQuickProvider] = useState({
    company_name: '',
    contact_person: '',
    email: '',
    phone: '',
    entity_type: 'individual' as 'company' | 'individual',
    is_registered_business: false,
  });
  const toLocalDateTime = (value?: string | null) => value
    ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000)
        .toISOString().slice(0, 16)
    : '';
  const [formData, setFormData] = useState({
    subcontractor_id: initialTask?.subcontractor_id || '',
    service_catalog_id: initialTask?.service_catalog_id || '',
    task_name: initialTask?.task_name || '',
    description: initialTask?.description || '',
    scope_of_work: initialTask?.scope_of_work || initialTask?.description || '',
    deliverables: initialTask?.deliverables || '',
    guidelines: initialTask?.guidelines || '',
    operational_notes: initialTask?.operational_notes || '',
    start_date: initialTask?.start_date || '',
    end_date: initialTask?.end_date || '',
    scheduled_start: toLocalDateTime(initialTask?.scheduled_start),
    scheduled_end: toLocalDateTime(initialTask?.scheduled_end),
    estimated_hours: initialTask?.estimated_hours || 0,
    actual_hours: initialTask?.actual_hours || 0,
    payment_type: initialTask?.payment_type || ('hourly' as 'hourly' | 'fixed' | 'mixed'),
    hourly_rate: initialTask?.hourly_rate || 0,
    fixed_price: initialTask?.fixed_price || 0,
    agreed_cost: initialTask?.agreed_cost || 0,
    settlement_type: initialTask?.settlement_type || ('invoice_vat' as SettlementType),
    payment_method: initialTask?.payment_method || ('transfer' as PaymentMethod),
    status: initialTask?.status || 'planned',
    payment_status: initialTask?.payment_status || 'pending',
  });
  const [createContract, setCreateContract] = useState(false);
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [contractData, setContractData] = useState({
    contract_number: '',
    title: '',
    description: '',
    total_value: 0,
    contract_type: 'project' as 'frame' | 'project',
  });

  const selectedSubcontractor = subcontractors.find((s) => s.id === formData.subcontractor_id);

  useEffect(() => {
    if (providerMode !== 'existing' || !formData.subcontractor_id) {
      setCatalogServices([]);
      setFormData((prev) => ({ ...prev, service_catalog_id: '' }));
      return;
    }

    let active = true;
    const loadCatalogServices = async () => {
      setServicesLoading(true);
      const { data, error } = await supabase
        .from('subcontractor_service_catalog')
        .select('id, name, description, category, unit_price, unit')
        .eq('subcontractor_id', formData.subcontractor_id)
        .eq('is_active', true)
        .order('name');

      if (!active) return;
      if (error) {
        console.error('Failed to load subcontractor services:', error);
        setCatalogServices([]);
      } else {
        setCatalogServices((data || []) as SubcontractorCatalogService[]);
      }
      setServicesLoading(false);
    };

    void loadCatalogServices();
    return () => {
      active = false;
    };
  }, [formData.subcontractor_id, providerMode]);

  const handleServiceSelect = (serviceId: string) => {
    const service = catalogServices.find((item) => item.id === serviceId);
    setFormData((prev) => ({
      ...prev,
      service_catalog_id: serviceId,
      task_name: service?.name || prev.task_name,
      description: service?.description || prev.description,
      scope_of_work: service?.description || prev.scope_of_work,
      payment_type: service?.unit_price ? 'fixed' : prev.payment_type,
      fixed_price: service?.unit_price ?? prev.fixed_price,
      agreed_cost: service?.unit_price ?? prev.agreed_cost,
    }));
  };

  useEffect(() => {
    if (selectedSubcontractor) {
      setFormData((prev) => ({
        ...prev,
        hourly_rate:
          prev.payment_type === 'hourly' && prev.hourly_rate === 0
            ? selectedSubcontractor.hourly_rate
            : prev.hourly_rate,
        settlement_type:
          selectedSubcontractor.default_settlement_type || prev.settlement_type,
        payment_method:
          selectedSubcontractor.preferred_payment_method || prev.payment_method,
      }));
    }
  }, [selectedSubcontractor, formData.payment_type]);

  const handleSubmit = async () => {
    if (
      (providerMode === 'existing' && !formData.subcontractor_id) ||
      (providerMode === 'quick' && !quickProvider.company_name) ||
      !formData.task_name
    ) {
      showSnackbar('Wybierz lub dodaj podwykonawcę i podaj nazwę zlecenia', 'warning');
      return;
    }
    if (formData.scheduled_start && formData.scheduled_end && formData.scheduled_end <= formData.scheduled_start) {
      showSnackbar('Termin zakończenia musi być późniejszy niż rozpoczęcia', 'warning');
      return;
    }
    if (!initialTask && createContract && !contractFile) {
      showSnackbar('Dodaj plik umowy podwykonawcy', 'warning');
      return;
    }
    if (contractFile && contractFile.size > 15 * 1024 * 1024) {
      showSnackbar('Plik umowy może mieć maksymalnie 15 MB', 'warning');
      return;
    }

    try {
      setSaving(true);

      const { data: user } = await supabase.auth.getUser();
      let subcontractorId = formData.subcontractor_id;
      let contactName = selectedSubcontractor?.contact_person || null;
      let contactEmail = selectedSubcontractor?.email || null;
      let contactPhone = selectedSubcontractor?.phone || null;

      if (providerMode === 'quick') {
        const { data: createdProvider, error: providerError } = await supabase
          .from('subcontractors')
          .insert({
            company_name: quickProvider.company_name,
            contact_person: quickProvider.contact_person || null,
            email: quickProvider.email || null,
            phone: quickProvider.phone || null,
            entity_type: quickProvider.entity_type,
            is_registered_business: quickProvider.is_registered_business,
            default_settlement_type: formData.settlement_type,
            preferred_payment_method: formData.payment_method,
            hourly_rate: formData.hourly_rate,
            specialization: [],
            status: 'active',
          })
          .select('id, contact_person, email, phone')
          .single();
        if (providerError) throw providerError;
        subcontractorId = createdProvider.id;
        contactName = createdProvider.contact_person;
        contactEmail = createdProvider.email;
        contactPhone = createdProvider.phone;
      }

      const calculatedCost = formData.payment_type === 'fixed'
        ? formData.fixed_price
        : formData.payment_type === 'hourly'
          ? formData.estimated_hours * formData.hourly_rate
          : formData.fixed_price + formData.estimated_hours * formData.hourly_rate;
      const taskPayload = {
        event_id: eventId,
        subcontractor_id: subcontractorId,
        service_catalog_id: formData.service_catalog_id || null,
        task_name: formData.task_name,
        description: formData.description || null,
        scope_of_work: formData.scope_of_work || formData.description || null,
        deliverables: formData.deliverables || null,
        guidelines: formData.guidelines || null,
        operational_notes: formData.operational_notes || null,
        scheduled_start: formData.scheduled_start || null,
        scheduled_end: formData.scheduled_end || null,
        start_date: formData.scheduled_start?.slice(0, 10) || formData.start_date || null,
        end_date: formData.scheduled_end?.slice(0, 10) || formData.end_date || null,
        estimated_hours: formData.estimated_hours,
        actual_hours: formData.actual_hours,
        payment_type: formData.payment_type,
        hourly_rate: formData.hourly_rate,
        fixed_price: formData.fixed_price,
        agreed_cost: formData.agreed_cost || calculatedCost,
        settlement_type: formData.settlement_type,
        payment_method: formData.payment_method,
        currency: 'PLN',
        contact_name_snapshot: contactName,
        contact_email_snapshot: contactEmail,
        contact_phone_snapshot: contactPhone,
        status: formData.status,
        payment_status: formData.payment_status,
      };
      const taskMutation = initialTask
        ? supabase.from('subcontractor_tasks').update(taskPayload).eq('id', initialTask.id)
        : supabase.from('subcontractor_tasks').insert([taskPayload]);
      const { data: taskData, error: taskError } = await taskMutation.select().single();

      if (taskError) throw taskError;

      // Umowa podwykonawcy jest jednym plikiem wydarzenia i rekordem umowy.
      if (!initialTask && createContract && contractFile) {
        const safeFileName = contractFile.name
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9._-]+/g, '-');
        const filePath = `${eventId}/umowy-podwykonawcow/${taskData.id}/${Date.now()}-${safeFileName}`;
        const { error: uploadError } = await supabase.storage
          .from('event-files')
          .upload(filePath, contractFile, {
            contentType: contractFile.type || 'application/octet-stream',
            upsert: false,
          });

        if (uploadError) {
          await supabase.from('subcontractor_tasks').delete().eq('id', taskData.id);
          throw uploadError;
        }

        const generatedNumber = `PODW/${new Date().getFullYear()}/${taskData.id.slice(0, 8).toUpperCase()}`;
        const { error: contractError } = await supabase.from('subcontractor_contracts').insert([
          {
            subcontractor_id: subcontractorId,
            subcontractor_task_id: taskData.id,
            event_id: eventId,
            contract_number: contractData.contract_number.trim() || generatedNumber,
            contract_type: contractData.contract_type,
            title: contractData.title.trim() || contractFile.name,
            description: contractData.description || null,
            total_value: contractData.total_value,
            file_path: filePath,
            status: 'draft',
            created_by: user?.user?.id,
          },
        ]);

        if (contractError) {
          await supabase.storage.from('event-files').remove([filePath]);
          await supabase.from('subcontractor_tasks').delete().eq('id', taskData.id);
          throw contractError;
        }
      }

      showSnackbar(
        initialTask ? 'Zlecenie podwykonawcze zostało zaktualizowane' : 'Zlecenie podwykonawcze zostało dodane',
        'success',
      );
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
          <h2 className="text-xl font-light text-[#e5e4e2]">
            {initialTask ? 'Edytuj zlecenie podwykonawcze' : 'Dodaj zlecenie podwykonawcze'}
          </h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6">
          {!initialTask && <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#1c1f33] p-1">
            <button
              type="button"
              onClick={() => setProviderMode('existing')}
              className={`rounded-md px-3 py-2 text-sm ${providerMode === 'existing' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/70'}`}
            >
              Z bazy
            </button>
            <button
              type="button"
              onClick={() => setProviderMode('quick')}
              className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm ${providerMode === 'quick' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/70'}`}
            >
              <UserPlus className="h-4 w-4" /> Jednorazowy / nowy
            </button>
          </div>}

          {/* Wybór podwykonawcy */}
          {providerMode === 'existing' ? (
          <div className="space-y-4">
            <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Podwykonawca *</label>
            <select
              value={formData.subcontractor_id}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  subcontractor_id: e.target.value,
                  service_catalog_id: '',
                })
              }
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

            {formData.subcontractor_id && (
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Usługa podwykonawcy
                </label>
                <select
                  value={formData.service_catalog_id}
                  onChange={(event) => handleServiceSelect(event.target.value)}
                  disabled={servicesLoading}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-60"
                >
                  <option value="">
                    {servicesLoading
                      ? 'Ładowanie usług...'
                      : 'Inna / niezdefiniowana usługa'}
                  </option>
                  {catalogServices.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                      {service.unit_price != null
                        ? ` — ${Number(service.unit_price).toLocaleString('pl-PL')} zł/${service.unit || 'szt.'}`
                        : ''}
                    </option>
                  ))}
                </select>
                {!servicesLoading && catalogServices.length === 0 && (
                  <p className="mt-2 text-xs text-[#e5e4e2]/45">
                    Ten podwykonawca nie ma jeszcze zdefiniowanych usług. Zlecenie zostanie zapisane
                    jako usługa niezdefiniowana.
                  </p>
                )}
              </div>
            )}
          </div>
          ) : (
            <div className="space-y-4 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setQuickProvider({ ...quickProvider, entity_type: 'individual', is_registered_business: false })}
                  className={`rounded-lg border px-3 py-2 text-sm ${quickProvider.entity_type === 'individual' ? 'border-[#d3bb73] text-[#d3bb73]' : 'border-white/10 text-[#e5e4e2]/60'}`}
                >
                  Osoba prywatna
                </button>
                <button
                  type="button"
                  onClick={() => setQuickProvider({ ...quickProvider, entity_type: 'company', is_registered_business: true })}
                  className={`rounded-lg border px-3 py-2 text-sm ${quickProvider.entity_type === 'company' ? 'border-[#d3bb73] text-[#d3bb73]' : 'border-white/10 text-[#e5e4e2]/60'}`}
                >
                  Firma / działalność
                </button>
              </div>
              <input
                value={quickProvider.company_name}
                onChange={(e) => setQuickProvider({ ...quickProvider, company_name: e.target.value })}
                placeholder={quickProvider.entity_type === 'individual' ? 'Imię i nazwisko *' : 'Nazwa firmy *'}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
              {quickProvider.entity_type === 'company' && (
                <input
                  value={quickProvider.contact_person}
                  onChange={(e) => setQuickProvider({ ...quickProvider, contact_person: e.target.value })}
                  placeholder="Osoba kontaktowa"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  type="email"
                  value={quickProvider.email}
                  onChange={(e) => setQuickProvider({ ...quickProvider, email: e.target.value })}
                  placeholder="E-mail (potrzebny do potwierdzeń)"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
                <input
                  value={quickProvider.phone}
                  onChange={(e) => setQuickProvider({ ...quickProvider, phone: e.target.value })}
                  placeholder="Telefon"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>
          )}

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

          {/* Zakres i wytyczne */}
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Zakres obowiązków</label>
            <textarea
              value={formData.scope_of_work}
              onChange={(e) => setFormData({ ...formData, scope_of_work: e.target.value })}
              rows={3}
              placeholder="Co dokładnie ma wykonać podwykonawca?"
              className="w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Oczekiwany rezultat</label>
              <textarea
                value={formData.deliverables}
                onChange={(e) => setFormData({ ...formData, deliverables: e.target.value })}
                rows={3}
                placeholder="Co ma zostać dostarczone i w jakim standardzie?"
                className="w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wytyczne wysyłane e-mailem</label>
              <textarea
                value={formData.guidelines}
                onChange={(e) => setFormData({ ...formData, guidelines: e.target.value })}
                rows={3}
                placeholder="Kontakt na miejscu, dress code, godzina gotowości, zasady techniczne..."
                className="w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Notatki wewnętrzne</label>
            <textarea
              value={formData.operational_notes}
              onChange={(e) => setFormData({ ...formData, operational_notes: e.target.value })}
              rows={2}
              placeholder="Informacje widoczne tylko w CRM"
              className="w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          {/* Daty */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Rozpoczęcie pracy</label>
              <input
                type="datetime-local"
                value={formData.scheduled_start}
                onChange={(e) => setFormData({ ...formData, scheduled_start: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Zakończenie pracy</label>
              <input
                type="datetime-local"
                value={formData.scheduled_end}
                onChange={(e) => setFormData({ ...formData, scheduled_end: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Dokument rozliczeniowy</label>
              <select
                value={formData.settlement_type}
                onChange={(e) => setFormData({ ...formData, settlement_type: e.target.value as SettlementType })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              >
                <option value="invoice_vat">Faktura VAT</option>
                <option value="invoice_no_vat">Faktura bez VAT</option>
                <option value="cash">Gotówka bez działalności</option>
                <option value="civil_contract">Umowa cywilnoprawna</option>
                <option value="other">Inna forma</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Sposób płatności</label>
              <select
                value={formData.payment_method}
                onChange={(e) => setFormData({ ...formData, payment_method: e.target.value as PaymentMethod })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              >
                <option value="transfer">Przelew</option>
                <option value="cash">Gotówka</option>
                <option value="card">Karta</option>
                <option value="other">Inny</option>
              </select>
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

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Uzgodniony koszt do prognozy wydarzenia (zł)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formData.agreed_cost}
              onChange={(e) => setFormData({ ...formData, agreed_cost: parseFloat(e.target.value) || 0 })}
              placeholder="Kwota, którą pokażemy w przyszłej rentowności wydarzenia"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

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
          {!initialTask && <div className="border-t border-[#d3bb73]/10 pt-6">
            <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-[#e5e4e2]">
              <input
                type="checkbox"
                checked={createContract}
                onChange={(e) => {
                  setCreateContract(e.target.checked);
                  if (!e.target.checked) setContractFile(null);
                }}
                className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
              />
              Dodaj umowę otrzymaną od podwykonawcy
            </label>

            {createContract && (
              <div className="space-y-4 border-l-2 border-[#d3bb73]/20 pl-6">
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Plik umowy *</label>
                  <FileDropzone file={contractFile} onChange={setContractFile} />
                  <p className="mt-2 text-xs text-[#e5e4e2]/45">
                    Przeciągnij PDF albo skan umowy. Plik trafi także do folderu „Umowy z podwykonawcami” w wydarzeniu.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Numer umowy (opcjonalnie)</label>
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
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Tytuł umowy (opcjonalnie)</label>
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
          </div>}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {saving ? 'Zapisywanie...' : initialTask ? 'Zapisz zmiany' : 'Dodaj zlecenie'}
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
