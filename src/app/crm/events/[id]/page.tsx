'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Calendar, MapPin, Building2, DollarSign, CreditCard as Edit, Trash2, Plus, Package, Users, FileText, CheckSquare, Clock, Save, X, User, Tag } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Event {
  id: string;
  name: string;
  description: string;
  event_date: string;
  event_end_date: string;
  location: string;
  status: string;
  budget: number;
  final_cost: number;
  notes: string;
  attachments: any[];
  client_id: string;
  category_id: string;
  created_by: string;
  client?: {
    company_name: string;
  };
  category?: {
    id: string;
    name: string;
    color: string;
    icon?: {
      id: string;
      name: string;
      svg_code: string;
      preview_color: string;
    };
  };
  creator?: {
    id: string;
    name: string;
    surname: string;
    avatar_url: string;
  };
}

interface Equipment {
  id: string;
  equipment_id: string;
  quantity: number;
  notes: string;
  equipment: {
    name: string;
    category: string;
  };
}

interface Employee {
  id: string;
  employee_id: string;
  role: string;
  notes: string;
  employee: {
    name: string;
    surname: string;
    occupation: string;
  };
}

interface Checklist {
  id: string;
  title: string;
  items: ChecklistItem[];
}

interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  assigned_to?: string;
  due_date?: string;
  notes?: string;
}

const statusColors: Record<string, string> = {
  offer_sent: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  offer_accepted: 'bg-green-500/10 text-green-400 border-green-500/20',
  in_preparation: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  in_progress: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  completed: 'bg-green-500/10 text-green-400 border-green-500/20',
  cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
  invoiced: 'bg-[#d3bb73]/10 text-[#d3bb73] border-[#d3bb73]/20',
};

const statusLabels: Record<string, string> = {
  offer_sent: 'Oferta wysłana',
  offer_accepted: 'Oferta zaakceptowana',
  in_preparation: 'W przygotowaniu',
  in_progress: 'W trakcie',
  completed: 'Zakończony',
  cancelled: 'Anulowany',
  invoiced: 'Rozliczony',
};

export default function EventDetailPage() {
  const router = useRouter();
  const params = useParams();
  const eventId = params.id as string;

  const [event, setEvent] = useState<Event | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'equipment' | 'team' | 'files' | 'checklist' | 'offer'>('overview');

  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [editedDescription, setEditedDescription] = useState('');
  const [editedNotes, setEditedNotes] = useState('');

  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false);
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);
  const [availableEquipment, setAvailableEquipment] = useState<any[]>([]);
  const [availableEmployees, setAvailableEmployees] = useState<any[]>([]);

  const [showAddChecklistModal, setShowAddChecklistModal] = useState(false);
  const [showEditEventModal, setShowEditEventModal] = useState(false);
  const [offers, setOffers] = useState<any[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<any>(null);
  const [showCreateOfferModal, setShowCreateOfferModal] = useState(false);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [currentUser] = useState({ id: '00000000-0000-0000-0000-000000000000', name: 'Administrator' });

  useEffect(() => {
    if (eventId) {
      fetchEventDetails();
      fetchAuditLog();
      fetchOffers();
    }
  }, [eventId]);

  const fetchEventDetails = async () => {
    try {
      setLoading(true);

      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select(`
          *,
          client:clients(company_name),
          category:event_categories(
            id,
            name,
            color,
            icon:custom_icons(id, name, svg_code, preview_color)
          ),
          creator:employees!events_created_by_fkey(id, name, surname, avatar_url)
        `)
        .eq('id', eventId)
        .maybeSingle();

      if (eventError) {
        console.error('Error fetching event:', eventError);
        setEvent(null);
        setLoading(false);
        return;
      }

      if (!eventData) {
        console.log('Event not found');
        setEvent(null);
        setLoading(false);
        return;
      }

      setEvent(eventData);

      const { data: equipmentData, error: equipmentError } = await supabase
        .from('event_equipment')
        .select(`
          *,
          equipment:equipment_items(name, category)
        `)
        .eq('event_id', eventId);

      if (!equipmentError && equipmentData) {
        setEquipment(equipmentData);
      } else {
        setEquipment([]);
      }

      const { data: employeesData, error: employeesError } = await supabase
        .from('event_employees')
        .select(`
          *,
          employee:employees(name, surname, occupation)
        `)
        .eq('event_id', eventId);

      if (!employeesError && employeesData) {
        setEmployees(employeesData);
      } else {
        setEmployees([]);
      }

      const { data: checklistsData, error: checklistsError } = await supabase
        .from('event_checklists')
        .select('*')
        .eq('event_id', eventId);

      if (!checklistsError && checklistsData) {
        setChecklists(checklistsData);
      } else {
        setChecklists([]);
      }
    } catch (error) {
      console.error('Error fetching event details:', error);
      setEvent(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchAuditLog = async () => {
    try {
      const { data, error } = await supabase
        .from('event_audit_log')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setAuditLog(data);
      }
    } catch (err) {
      console.error('Error fetching audit log:', err);
    }
  };

  const fetchOffers = async () => {
    try {
      const { data, error } = await supabase
        .from('offers')
        .select(`
          *,
          client:clients!client_id(company_name, first_name, last_name)
        `)
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      console.log('Fetched offers for event:', data);

      if (!error && data) {
        setOffers(data);
      } else if (error) {
        console.error('Error fetching offers:', error);
      }
    } catch (err) {
      console.error('Error fetching offers:', err);
    }
  };

  const logChange = async (action: string, description: string, fieldName?: string, oldValue?: string, newValue?: string) => {
    try {
      await supabase
        .from('event_audit_log')
        .insert([
          {
            event_id: eventId,
            user_id: currentUser.id,
            user_name: currentUser.name,
            action,
            field_name: fieldName,
            old_value: oldValue,
            new_value: newValue,
            description,
          },
        ]);

      fetchAuditLog();
    } catch (err) {
      console.error('Error logging change:', err);
    }
  };

  const handleSaveDescription = async () => {
    if (!event) return;

    try {
      const { error } = await supabase
        .from('events')
        .update({ description: editedDescription })
        .eq('id', eventId);

      if (error) {
        console.error('Error updating description:', error);
        alert('Błąd podczas zapisywania opisu');
        return;
      }

      setEvent({ ...event, description: editedDescription });
      setIsEditingDescription(false);
      await logChange('updated', 'Zaktualizowano opis eventu', 'description', event.description, editedDescription);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  const handleSaveNotes = async () => {
    if (!event) return;

    try {
      const { error } = await supabase
        .from('events')
        .update({ notes: editedNotes })
        .eq('id', eventId);

      if (error) {
        console.error('Error updating notes:', error);
        alert('Błąd podczas zapisywania notatek');
        return;
      }

      setEvent({ ...event, notes: editedNotes });
      setIsEditingNotes(false);
      await logChange('updated', 'Zaktualizowano notatki eventu', 'notes', event.notes, editedNotes);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  const fetchAvailableEquipment = async () => {
    const { data, error } = await supabase
      .from('equipment_items')
      .select('*')
      .order('name');

    if (!error && data) {
      setAvailableEquipment(data);
    }
  };

  const fetchAvailableEmployees = async () => {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('name');

    if (!error && data) {
      setAvailableEmployees(data);
    }
  };

  const handleAddEquipment = async (equipmentId: string, quantity: number, notes: string) => {
    try {
      const { error } = await supabase
        .from('event_equipment')
        .insert([
          {
            event_id: eventId,
            equipment_id: equipmentId,
            quantity: quantity,
            notes: notes,
          },
        ]);

      if (error) {
        console.error('Error adding equipment:', error);
        alert('Błąd podczas dodawania sprzętu');
        return;
      }

      setShowAddEquipmentModal(false);
      fetchEventDetails();
      await logChange('equipment_added', `Dodano sprzęt (ID: ${equipmentId}, ilość: ${quantity})`);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  const handleAddEmployee = async (employeeId: string, role: string, notes: string) => {
    try {
      const { error } = await supabase
        .from('event_employees')
        .insert([
          {
            event_id: eventId,
            employee_id: employeeId,
            role: role,
            notes: notes,
          },
        ]);

      if (error) {
        console.error('Error adding employee:', error);
        alert('Błąd podczas dodawania pracownika');
        return;
      }

      setShowAddEmployeeModal(false);
      fetchEventDetails();
      await logChange('employee_added', `Dodano pracownika do zespołu (ID: ${employeeId}, rola: ${role})`);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  const handleRemoveEquipment = async (equipmentId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten sprzęt z eventu?')) return;

    try {
      const { error } = await supabase
        .from('event_equipment')
        .delete()
        .eq('id', equipmentId);

      if (error) {
        console.error('Error removing equipment:', error);
        alert('Błąd podczas usuwania sprzętu');
        return;
      }

      fetchEventDetails();
      await logChange('equipment_removed', `Usunięto sprzęt z eventu (ID: ${equipmentId})`);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  const handleRemoveEmployee = async (employeeId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tego pracownika z eventu?')) return;

    try {
      const { error } = await supabase
        .from('event_employees')
        .delete()
        .eq('id', employeeId);

      if (error) {
        console.error('Error removing employee:', error);
        alert('Błąd podczas usuwania pracownika');
        return;
      }

      fetchEventDetails();
      await logChange('employee_removed', `Usunięto pracownika z eventu (ID: ${employeeId})`);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  const handleToggleChecklist = async (checklistId: string, completed: boolean) => {
    try {
      const { error } = await supabase
        .from('event_checklists')
        .update({
          completed,
          completed_at: completed ? new Date().toISOString() : null,
          completed_by: completed ? currentUser.id : null,
        })
        .eq('id', checklistId);

      if (error) {
        console.error('Error toggling checklist:', error);
        return;
      }

      fetchEventDetails();
      await logChange('checklist_updated', completed ? 'Zaznaczono element checklisty jako wykonany' : 'Odznaczono element checklisty');
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const handleAddChecklist = async (task: string, priority: string) => {
    try {
      const { error } = await supabase
        .from('event_checklists')
        .insert([{ event_id: eventId, task, priority, completed: false }]);

      if (error) {
        console.error('Error adding checklist:', error);
        return;
      }

      setShowAddChecklistModal(false);
      fetchEventDetails();
      await logChange('checklist_added', `Dodano nowe zadanie do checklisty: ${task}`);
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const handleRemoveChecklist = async (checklistId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć to zadanie?')) return;

    try {
      const { error } = await supabase
        .from('event_checklists')
        .delete()
        .eq('id', checklistId);

      if (error) {
        console.error('Error removing checklist:', error);
        return;
      }

      fetchEventDetails();
      await logChange('checklist_removed', 'Usunięto zadanie z checklisty');
    } catch (err) {
      console.error('Error:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex flex-col items-center justify-center h-screen space-y-4">
        <div className="text-[#e5e4e2] text-lg">Event nie został znaleziony</div>
        <button
          onClick={() => router.back()}
          className="bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
        >
          Wróć
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 text-[#e5e4e2] hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-light text-[#e5e4e2]">{event.name}</h1>
              {event.category && (
                <div
                  className="flex items-center gap-2 px-3 py-1 rounded-lg border"
                  style={{
                    backgroundColor: `${event.category.color}20`,
                    borderColor: `${event.category.color}50`,
                    color: event.category.color
                  }}
                >
                  {event.category.icon ? (
                    <div
                      className="w-4 h-4"
                      style={{ color: event.category.color }}
                      dangerouslySetInnerHTML={{ __html: event.category.icon.svg_code }}
                    />
                  ) : (
                    <Tag className="w-4 h-4" />
                  )}
                  <span className="text-sm font-medium">{event.category.name}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                {event.client?.company_name || 'Brak klienta'}
              </div>
              {event.creator && (
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  <span>Autor: {event.creator.name} {event.creator.surname}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`px-4 py-2 rounded-lg text-sm border ${
              statusColors[event.status] || 'bg-gray-500/10 text-gray-400 border-gray-500/20'
            }`}
          >
            {statusLabels[event.status] || event.status || 'Nieznany status'}
          </span>
          <button
            onClick={() => setShowEditEventModal(true)}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Edit className="w-4 h-4" />
            Edytuj
          </button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-[#d3bb73]/10">
        {[
          { id: 'overview', label: 'Przegląd', icon: FileText },
          { id: 'offer', label: 'Oferta', icon: DollarSign },
          { id: 'equipment', label: 'Sprzęt', icon: Package },
          { id: 'team', label: 'Zespół', icon: Users },
          { id: 'files', label: 'Pliki', icon: FileText },
          { id: 'checklist', label: 'Checklist', icon: CheckSquare },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
                Informacje podstawowe
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Data rozpoczęcia</p>
                    <p className="text-[#e5e4e2]">
                      {new Date(event.event_date).toLocaleString('pl-PL', {
                        dateStyle: 'full',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                </div>

                {event.event_end_date && (
                  <div className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Data zakończenia</p>
                      <p className="text-[#e5e4e2]">
                        {new Date(event.event_end_date).toLocaleString('pl-PL', {
                          dateStyle: 'full',
                          timeStyle: 'short',
                        })}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Lokalizacja</p>
                    <p className="text-[#e5e4e2]">{event.location}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Building2 className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Klient</p>
                    <p className="text-[#e5e4e2]">
                      {event.client?.company_name || 'Brak klienta'}
                    </p>
                  </div>
                </div>

                {event.category && (
                  <div className="flex items-start gap-3">
                    <div
                      className="w-5 h-5 rounded mt-0.5"
                      style={{ backgroundColor: event.category.color }}
                    />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Kategoria</p>
                      <p className="text-[#e5e4e2]">{event.category.name}</p>
                    </div>
                  </div>
                )}

                {event.creator && (
                  <div className="flex items-start gap-3">
                    <Users className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Utworzył</p>
                      <p className="text-[#e5e4e2]">
                        {event.creator.name} {event.creator.surname}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-light text-[#e5e4e2]">Opis</h2>
                {!isEditingDescription && (
                  <button
                    onClick={() => {
                      setEditedDescription(event.description || '');
                      setIsEditingDescription(true);
                    }}
                    className="text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                )}
              </div>
              {isEditingDescription ? (
                <div className="space-y-3">
                  <textarea
                    value={editedDescription}
                    onChange={(e) => setEditedDescription(e.target.value)}
                    className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg p-3 text-[#e5e4e2] min-h-[120px] focus:outline-none focus:border-[#d3bb73]"
                    placeholder="Dodaj opis eventu..."
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveDescription}
                      className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
                    >
                      <Save className="w-4 h-4" />
                      Zapisz
                    </button>
                    <button
                      onClick={() => setIsEditingDescription(false)}
                      className="px-4 py-2 rounded-lg text-sm text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[#e5e4e2]/80 leading-relaxed">
                  {event.description || 'Brak opisu'}
                </p>
              )}
            </div>

            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-light text-[#e5e4e2]">Notatki</h2>
                {!isEditingNotes && (
                  <button
                    onClick={() => {
                      setEditedNotes(event.notes || '');
                      setIsEditingNotes(true);
                    }}
                    className="text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                )}
              </div>
              {isEditingNotes ? (
                <div className="space-y-3">
                  <textarea
                    value={editedNotes}
                    onChange={(e) => setEditedNotes(e.target.value)}
                    className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg p-3 text-[#e5e4e2] min-h-[120px] focus:outline-none focus:border-[#d3bb73]"
                    placeholder="Dodaj notatki..."
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveNotes}
                      className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
                    >
                      <Save className="w-4 h-4" />
                      Zapisz
                    </button>
                    <button
                      onClick={() => setIsEditingNotes(false)}
                      className="px-4 py-2 rounded-lg text-sm text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[#e5e4e2]/80 leading-relaxed">
                  {event.notes || 'Brak notatek'}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Budżet</h2>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-[#e5e4e2]/60">Planowany budżet</p>
                  <p className="text-2xl font-light text-[#d3bb73]">
                    {event.budget ? event.budget.toLocaleString('pl-PL') : '0'} zł
                  </p>
                </div>
                {event.final_cost && event.final_cost > 0 && (
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Koszt końcowy</p>
                    <p className="text-2xl font-light text-[#e5e4e2]">
                      {event.final_cost.toLocaleString('pl-PL')} zł
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
                Szybkie statystyki
              </h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#e5e4e2]/60">Sprzęt</span>
                  <span className="text-[#e5e4e2] font-medium">
                    {equipment.length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#e5e4e2]/60">Zespół</span>
                  <span className="text-[#e5e4e2] font-medium">
                    {employees.length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#e5e4e2]/60">Pliki</span>
                  <span className="text-[#e5e4e2] font-medium">
                    {event.attachments?.length || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#e5e4e2]/60">Checklisty</span>
                  <span className="text-[#e5e4e2] font-medium">
                    {checklists.length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'equipment' && (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-light text-[#e5e4e2]">Sprzęt</h2>
            <button
              onClick={() => {
                fetchAvailableEquipment();
                setShowAddEquipmentModal(true);
              }}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Dodaj sprzęt
            </button>
          </div>

          {equipment.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
              <p className="text-[#e5e4e2]/60">Brak przypisanego sprzętu</p>
            </div>
          ) : (
            <div className="space-y-3">
              {equipment.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4"
                >
                  <div className="flex-1">
                    <h3 className="text-[#e5e4e2] font-medium">
                      {item.equipment.name}
                    </h3>
                    <p className="text-sm text-[#e5e4e2]/60">
                      {item.equipment.category} • Ilość: {item.quantity}
                    </p>
                    {item.notes && (
                      <p className="text-sm text-[#e5e4e2]/40 mt-1">{item.notes}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveEquipment(item.id)}
                    className="text-red-400 hover:text-red-300 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'team' && (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-light text-[#e5e4e2]">Zespół</h2>
            <button
              onClick={() => {
                fetchAvailableEmployees();
                setShowAddEmployeeModal(true);
              }}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Dodaj osobę
            </button>
          </div>

          {employees.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
              <p className="text-[#e5e4e2]/60">Brak przypisanych pracowników</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {employees.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4"
                >
                  <div className="flex-1">
                    <h3 className="text-[#e5e4e2] font-medium">
                      {item.employee.first_name} {item.employee.last_name}
                    </h3>
                    <p className="text-sm text-[#e5e4e2]/60">
                      {item.employee.position}
                    </p>
                    {item.role && (
                      <p className="text-sm text-[#d3bb73] mt-1">Rola: {item.role}</p>
                    )}
                    {item.notes && (
                      <p className="text-sm text-[#e5e4e2]/40 mt-1">{item.notes}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveEmployee(item.id)}
                    className="text-red-400 hover:text-red-300 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'offer' && (
        <div className="space-y-6">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-light text-[#e5e4e2]">Oferty</h2>
                <p className="text-sm text-[#e5e4e2]/60 mt-1">
                  Zarządzaj ofertami dla tego eventu
                </p>
              </div>
              <button
                onClick={() => setShowCreateOfferModal(true)}
                className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Nowa oferta
              </button>
            </div>

            {offers.length === 0 ? (
              <div className="text-center py-12">
                <DollarSign className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
                <p className="text-[#e5e4e2]/60">Brak ofert dla tego eventu</p>
                <button
                  onClick={() => setShowCreateOfferModal(true)}
                  className="mt-4 text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
                >
                  Utwórz pierwszą ofertę
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {offers.map((offer) => (
                  <div
                    key={offer.id}
                    className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-6 hover:border-[#d3bb73]/30 transition-colors cursor-pointer"
                    onClick={() => router.push(`/crm/offers/${offer.id}`)}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-medium text-[#e5e4e2]">
                            {offer.offer_number || 'Brak numeru'}
                          </h3>
                          <span
                            className={`px-2 py-1 rounded text-xs border ${
                              offer.status === 'draft'
                                ? 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                                : offer.status === 'sent'
                                ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                                : offer.status === 'accepted'
                                ? 'bg-green-500/20 text-green-400 border-green-500/30'
                                : offer.status === 'rejected'
                                ? 'bg-red-500/20 text-red-400 border-red-500/30'
                                : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                            }`}
                          >
                            {offer.status === 'draft'
                              ? 'Szkic'
                              : offer.status === 'sent'
                              ? 'Wysłana'
                              : offer.status === 'accepted'
                              ? 'Zaakceptowana'
                              : offer.status === 'rejected'
                              ? 'Odrzucona'
                              : offer.status}
                          </span>
                        </div>
                        <p className="text-sm text-[#e5e4e2]/60">
                          Klient: {offer.client?.company_name || `${offer.client?.first_name || ''} ${offer.client?.last_name || ''}`.trim() || 'Brak klienta'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-light text-[#d3bb73]">
                          {offer.total_amount ? offer.total_amount.toLocaleString('pl-PL') : '0'} zł
                        </p>
                        {offer.valid_until && (
                          <p className="text-xs text-[#e5e4e2]/40 mt-1">
                            Ważna do: {new Date(offer.valid_until).toLocaleDateString('pl-PL')}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-[#e5e4e2]/40 pt-4 border-t border-[#d3bb73]/10">
                      <span>
                        Utworzona: {new Date(offer.created_at).toLocaleDateString('pl-PL')}
                      </span>
                      {offer.updated_at && offer.updated_at !== offer.created_at && (
                        <>
                          <span>•</span>
                          <span>
                            Zaktualizowana: {new Date(offer.updated_at).toLocaleDateString('pl-PL')}
                          </span>
                        </>
                      )}
                    </div>

                    {offer.notes && (
                      <div className="mt-3 pt-3 border-t border-[#d3bb73]/10">
                        <p className="text-sm text-[#e5e4e2]/60">{offer.notes}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'files' && (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-light text-[#e5e4e2]">
              Pliki i załączniki
            </h2>
            <button className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors">
              <Plus className="w-4 h-4" />
              Dodaj plik
            </button>
          </div>

          {(!event.attachments || event.attachments.length === 0) ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
              <p className="text-[#e5e4e2]/60">Brak załączników</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {event.attachments.map((file: any, index: number) => (
                <div
                  key={index}
                  className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4 hover:border-[#d3bb73]/30 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <FileText className="w-8 h-8 text-[#d3bb73]" />
                    <button className="text-red-400 hover:text-red-300 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <h3 className="text-[#e5e4e2] text-sm font-medium truncate">
                    {file.name}
                  </h3>
                  <p className="text-xs text-[#e5e4e2]/40 mt-1">
                    {(file.size / 1024).toFixed(2)} KB
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'checklist' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-light text-[#e5e4e2]">Zadania</h2>
              <button
                onClick={() => setShowAddChecklistModal(true)}
                className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Nowe zadanie
              </button>
            </div>

            {checklists.length === 0 ? (
              <div className="text-center py-12">
                <CheckSquare className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
                <p className="text-[#e5e4e2]/60">Brak zadań</p>
              </div>
            ) : (
              <div className="space-y-3">
                {checklists.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4"
                  >
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={(e) => handleToggleChecklist(item.id, e.target.checked)}
                      className="mt-1 w-4 h-4 rounded border-[#d3bb73]/30 bg-[#1c1f33] text-[#d3bb73] focus:ring-[#d3bb73] cursor-pointer"
                    />
                    <div className="flex-1">
                      <p className={`${item.completed ? 'text-[#e5e4e2]/40 line-through' : 'text-[#e5e4e2]'}`}>
                        {item.task}
                      </p>
                      {item.priority && (
                        <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded ${
                          item.priority === 'high' ? 'bg-red-500/20 text-red-400' :
                          item.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-green-500/20 text-green-400'
                        }`}>
                          {item.priority === 'high' ? 'Wysoki' : item.priority === 'medium' ? 'Średni' : 'Niski'}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveChecklist(item.id)}
                      className="text-red-400 hover:text-red-300 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h2 className="text-lg font-light text-[#e5e4e2] mb-6">Historia zmian</h2>
            {auditLog.length === 0 ? (
              <div className="text-center py-12">
                <Clock className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
                <p className="text-[#e5e4e2]/60">Brak historii zmian</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[600px] overflow-y-auto">
                {auditLog.map((log) => (
                  <div key={log.id} className="border-l-2 border-[#d3bb73]/30 pl-4 pb-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-[#e5e4e2] text-sm">{log.description}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[#d3bb73] text-xs">{log.user_name}</span>
                          <span className="text-[#e5e4e2]/40 text-xs">•</span>
                          <span className="text-[#e5e4e2]/40 text-xs">
                            {new Date(log.created_at).toLocaleString('pl-PL', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {showAddEquipmentModal && (
        <AddEquipmentModal
          isOpen={showAddEquipmentModal}
          onClose={() => setShowAddEquipmentModal(false)}
          onAdd={handleAddEquipment}
          availableEquipment={availableEquipment}
        />
      )}

      {showAddEmployeeModal && (
        <AddEmployeeModal
          isOpen={showAddEmployeeModal}
          onClose={() => setShowAddEmployeeModal(false)}
          onAdd={handleAddEmployee}
          availableEmployees={availableEmployees}
        />
      )}

      {showAddChecklistModal && (
        <AddChecklistModal
          isOpen={showAddChecklistModal}
          onClose={() => setShowAddChecklistModal(false)}
          onAdd={handleAddChecklist}
        />
      )}

      {showEditEventModal && event && (
        <EditEventModal
          isOpen={showEditEventModal}
          onClose={() => setShowEditEventModal(false)}
          event={event}
          onSave={async (updatedData) => {
            try {
              const { error } = await supabase
                .from('events')
                .update(updatedData)
                .eq('id', eventId);

              if (error) {
                console.error('Error updating event:', error);
                alert('Błąd podczas aktualizacji eventu');
                return;
              }

              setShowEditEventModal(false);
              fetchEventDetails();
              await logChange('updated', 'Zaktualizowano podstawowe informacje eventu');
            } catch (err) {
              console.error('Error:', err);
              alert('Wystąpił błąd');
            }
          }}
        />
      )}

      {showCreateOfferModal && event && (
        <CreateOfferModal
          isOpen={showCreateOfferModal}
          onClose={() => setShowCreateOfferModal(false)}
          eventId={eventId}
          clientId={event.client_id}
          onSuccess={() => {
            setShowCreateOfferModal(false);
            fetchOffers();
            setActiveTab('offer');
          }}
        />
      )}
    </div>
  );
}

function AddEquipmentModal({
  isOpen,
  onClose,
  onAdd,
  availableEquipment,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (equipmentId: string, quantity: number, notes: string) => void;
  availableEquipment: any[];
}) {
  const [selectedEquipment, setSelectedEquipment] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!selectedEquipment) {
      alert('Wybierz sprzęt');
      return;
    }
    onAdd(selectedEquipment, quantity, notes);
    setSelectedEquipment('');
    setQuantity(1);
    setNotes('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-md w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj sprzęt</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Sprzęt
            </label>
            <select
              value={selectedEquipment}
              onChange={(e) => setSelectedEquipment(e.target.value)}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="">Wybierz sprzęt...</option>
              {availableEquipment.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.name} ({eq.category})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Ilość
            </label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Notatki
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] min-h-[80px] focus:outline-none focus:border-[#d3bb73]"
              placeholder="Dodatkowe informacje..."
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSubmit}
              className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90"
            >
              Dodaj
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
    </div>
  );
}

function AddEmployeeModal({
  isOpen,
  onClose,
  onAdd,
  availableEmployees,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (employeeId: string, role: string, notes: string) => void;
  availableEmployees: any[];
}) {
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [role, setRole] = useState('');
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!selectedEmployee) {
      alert('Wybierz pracownika');
      return;
    }
    onAdd(selectedEmployee, role, notes);
    setSelectedEmployee('');
    setRole('');
    setNotes('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-md w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj osobę do zespołu</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Pracownik
            </label>
            <select
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="">Wybierz pracownika...</option>
              {availableEmployees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.first_name} {emp.last_name} - {emp.position}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Rola w evencie
            </label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              placeholder="np. Lead Audio, Technician..."
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Notatki
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] min-h-[80px] focus:outline-none focus:border-[#d3bb73]"
              placeholder="Dodatkowe informacje..."
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSubmit}
              className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90"
            >
              Dodaj
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
    </div>
  );
}


function AddChecklistModal({
  isOpen,
  onClose,
  onAdd,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (task: string, priority: string) => void;
}) {
  const [task, setTask] = useState('');
  const [priority, setPriority] = useState('medium');

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!task.trim()) {
      alert('Wpisz treść zadania');
      return;
    }
    onAdd(task, priority);
    setTask('');
    setPriority('medium');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-md w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj zadanie</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Zadanie
            </label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] min-h-[80px] focus:outline-none focus:border-[#d3bb73]"
              placeholder="Opisz zadanie do wykonania..."
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Priorytet
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="low">Niski</option>
              <option value="medium">Średni</option>
              <option value="high">Wysoki</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSubmit}
              className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90"
            >
              Dodaj
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
    </div>
  );
}

function EditEventModal({
  isOpen,
  onClose,
  event,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  event: Event;
  onSave: (data: any) => void;
}) {
  const [clients, setClients] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    name: event.name,
    client_id: event.client_id || '',
    category_id: event.category_id || '',
    event_date: event.event_date,
    event_end_date: event.event_end_date || '',
    location: event.location,
    budget: event.budget?.toString() || '',
    status: event.status,
    event_type: (event as any).event_type || 'general',
  });

  useEffect(() => {
    if (isOpen) {
      fetchClients();
      fetchCategories();
    }
  }, [isOpen]);

  const fetchClients = async () => {
    const { data } = await supabase
      .from('clients')
      .select('id, company_name')
      .order('company_name');
    if (data) setClients(data);
  };

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('event_categories')
      .select('id, name, color')
      .eq('is_active', true)
      .order('name');
    if (data) setCategories(data);
  };

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      alert('Nazwa eventu jest wymagana');
      return;
    }
    if (!formData.event_date) {
      alert('Data rozpoczęcia jest wymagana');
      return;
    }
    if (!formData.location.trim()) {
      alert('Lokalizacja jest wymagana');
      return;
    }

    onSave({
      name: formData.name,
      client_id: formData.client_id || null,
      category_id: formData.category_id || null,
      event_date: formData.event_date,
      event_end_date: formData.event_end_date || null,
      location: formData.location,
      budget: formData.budget ? parseFloat(formData.budget) : null,
      status: formData.status,
      event_type: formData.event_type,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-2xl w-full my-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">Edytuj event</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Nazwa eventu *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              placeholder="Nazwa eventu"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Klient
              </label>
              <select
                value={formData.client_id}
                onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              >
                <option value="">Wybierz klienta</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.company_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Kategoria
              </label>
              <select
                value={formData.category_id}
                onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              >
                <option value="">Wybierz kategorię</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Data rozpoczęcia *
              </label>
              <input
                type="datetime-local"
                value={formData.event_date ? new Date(formData.event_date).toISOString().slice(0, 16) : ''}
                onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Data zakończenia
              </label>
              <input
                type="datetime-local"
                value={formData.event_end_date ? new Date(formData.event_end_date).toISOString().slice(0, 16) : ''}
                onChange={(e) => setFormData({ ...formData, event_end_date: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Lokalizacja *
            </label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              placeholder="Miejsce wydarzenia"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Typ eventu
            </label>
            <select
              value={formData.event_type}
              onChange={(e) => setFormData({ ...formData, event_type: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="general">Ogólny</option>
              <option value="conference">Konferencja</option>
              <option value="integration">Integracja</option>
              <option value="wedding">Wesele</option>
              <option value="corporate">Firmowy</option>
              <option value="private">Prywatny</option>
              <option value="festival">Festiwal</option>
            </select>
            <p className="text-xs text-[#e5e4e2]/40 mt-1">
              Typ eventu wpływa na numerację ofert (np. KONF/2025/10/001)
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Budżet (PLN)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.budget}
                onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              >
                <option value="offer_sent">Oferta wysłana</option>
                <option value="offer_accepted">Oferta zaakceptowana</option>
                <option value="in_preparation">W przygotowaniu</option>
                <option value="in_progress">W trakcie</option>
                <option value="completed">Zakończony</option>
                <option value="cancelled">Anulowany</option>
                <option value="invoiced">Rozliczony</option>
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-6 border-t border-[#d3bb73]/10">
            <button
              onClick={handleSubmit}
              className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90"
            >
              Zapisz zmiany
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
    </div>
  );
}


function CreateOfferModal({
  isOpen,
  onClose,
  eventId,
  clientId,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  clientId: string;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    offer_number: "",
    valid_until: "",
    notes: "",
  });

  if (!isOpen) return null;

  const handleSubmit = async () => {
    try {
      const offerData: any = {
        event_id: eventId,
        client_id: clientId,
        valid_until: formData.valid_until || null,
        notes: formData.notes || null,
        status: "draft",
        total_amount: 0,
      };

      if (formData.offer_number.trim()) {
        offerData.offer_number = formData.offer_number;
      }

      const { data, error } = await supabase
        .from("offers")
        .insert([offerData])
        .select();

      if (error) {
        console.error("Error creating offer:", error);
        alert("Błąd podczas tworzenia oferty: " + error.message);
        return;
      }

      if (data && data[0]) {
        alert(`Utworzono ofertę: ${data[0].offer_number}`);
      }

      onSuccess();
    } catch (err) {
      console.error("Error:", err);
      alert("Wystąpił błąd podczas tworzenia oferty");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-lg w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">Utwórz nową ofertę</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <p className="text-sm text-blue-400">
              Numer oferty zostanie wygenerowany automatycznie w formacie OF/RRRR/MM/NNN (np. OF/2025/10/001)
            </p>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Numer oferty
            </label>
            <input
              type="text"
              value={formData.offer_number}
              onChange={(e) => setFormData({ ...formData, offer_number: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              placeholder="Zostaw puste dla automatycznego numeru lub wpisz własny"
            />
            <p className="text-xs text-[#e5e4e2]/40 mt-1">
              System sprawdzi czy numer jest unikalny
            </p>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Ważna do
            </label>
            <input
              type="date"
              value={formData.valid_until}
              onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Notatki
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] min-h-[100px] focus:outline-none focus:border-[#d3bb73]"
              placeholder="Dodatkowe informacje o ofercie..."
            />
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <p className="text-sm text-blue-400">
              Po utworzeniu oferty będziesz mógł dodać do niej pozycje (atrakcje, usługi) i ustalić ceny.
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSubmit}
              className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90"
            >
              Utwórz ofertę
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
    </div>
  );
}

