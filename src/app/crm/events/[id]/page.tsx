'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Calendar, MapPin, Building2, DollarSign, CreditCard as Edit, Trash2, Plus, Package, Users, FileText, CheckSquare, Clock, Save, X, User, Tag, ChevronDown, ChevronUp, Mail, Phone, Briefcase, Edit as EditIcon, AlertCircle, History, UserCheck, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import EventTasksBoard from '@/components/crm/EventTasksBoard';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import EventFilesExplorer from '@/components/crm/EventFilesExplorer';
import EventSubcontractorsPanel from '@/components/crm/EventSubcontractorsPanel';
import EventLogisticsPanel from '@/components/crm/EventLogisticsPanel';
import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';

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
  organization_id: string | null;
  contact_person_id: string | null;
  category_id: string;
  created_by: string;
  organization?: {
    id: string;
    name: string;
    alias: string | null;
  } | null;
  contact_person?: {
    id: string;
    first_name: string;
    last_name: string;
    
  } | null;
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
  responsibilities: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  invited_at: string;
  responded_at: string | null;
  notes: string;
  employee: {
    id: string;
    name: string;
    surname: string;
    nickname: string | null;
    occupation: string;
    avatar_url: string | null;
    avatar_metadata: any;
    email: string;
    phone_number: string | null;
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
  const { showConfirm } = useDialog();
  const { showSnackbar } = useSnackbar();

  const [event, setEvent] = useState<Event | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'equipment' | 'team' | 'files' | 'tasks' | 'offer' | 'subcontractors' | 'logistics'>('overview');

  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [editedDescription, setEditedDescription] = useState('');
  const [editedNotes, setEditedNotes] = useState('');
  const [categories, setCategories] = useState<any[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [canManageTeam, setCanManageTeam] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userAssignmentStatus, setUserAssignmentStatus] = useState<'pending' | 'accepted' | 'rejected' | null>(null);
  const [hasLimitedAccess, setHasLimitedAccess] = useState(false);

  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false);
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);
  const [availableEquipment, setAvailableEquipment] = useState<any[]>([]);
  const [availableKits, setAvailableKits] = useState<any[]>([]);
  const [availableEmployees, setAvailableEmployees] = useState<any[]>([]);
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());
  const [editingQuantity, setEditingQuantity] = useState<string | null>(null);
  const [equipmentAvailability, setEquipmentAvailability] = useState<{[key: string]: {available: number, reserved: number}}>({});

  const [showAddChecklistModal, setShowAddChecklistModal] = useState(false);
  const [showEditEventModal, setShowEditEventModal] = useState(false);
  const [offers, setOffers] = useState<any[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<any>(null);
  const [showCreateOfferModal, setShowCreateOfferModal] = useState(false);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [currentUser] = useState({ id: '00000000-0000-0000-0000-000000000000', name: 'Administrator' });
  const [error, setError] = useState<string | null>(null);
  const [hoveredEmployee, setHoveredEmployee] = useState<string | null>(null);

  useEffect(() => {
    if (eventId) {
      fetchEventDetails();
      fetchAuditLog();
      fetchOffers();
      fetchCategories();
      checkTeamManagementPermission();
    }
  }, [eventId]);

  useEffect(() => {
    if (event && equipment.length > 0) {
      fetchEquipmentAvailability();
    }
  }, [event, equipment.length]);

  const checkTeamManagementPermission = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        setCanManageTeam(false);
        return;
      }

      setCurrentUserId(session.user.id);

      // Sprawdź czy użytkownik jest adminem
      const { data: employee } = await supabase
        .from('employees')
        .select('permissions, role')
        .eq('id', session.user.id)
        .single();

      const userIsAdmin = employee?.role === 'admin' || employee?.permissions?.includes('events_manage');
      setIsAdmin(userIsAdmin);

      // Jeśli admin, może zarządzać
      if (userIsAdmin) {
        setCanManageTeam(true);
        return;
      }

      // Sprawdź czy jest creatorem lub ma uprawnienia
      const { data: eventData } = await supabase
        .from('events')
        .select('created_by')
        .eq('id', eventId)
        .single();

      if (eventData?.created_by === session.user.id) {
        setCanManageTeam(true);
        return;
      }

      // Sprawdź czy jest członkiem z uprawnieniem can_invite_members
      const { data: assignment } = await supabase
        .from('employee_assignments')
        .select('can_invite_members, status')
        .eq('event_id', eventId)
        .eq('employee_id', session.user.id)
        .single();

      if (assignment?.status === 'accepted' && assignment?.can_invite_members) {
        setCanManageTeam(true);
        return;
      }

      setCanManageTeam(false);
    } catch (err) {
      console.error('Error checking team management permission:', err);
      setCanManageTeam(false);
    }
  };

  const fetchEventDetails = async () => {
    try {
      setLoading(true);

      // Sprawdź status przypisania użytkownika do wydarzenia
      const { data: { session } } = await supabase.auth.getSession();
      let assignmentStatus: 'pending' | 'accepted' | 'rejected' | null = null;
      let limitedAccess = false;

      if (session?.user?.id) {
        const { data: assignment } = await supabase
          .from('employee_assignments')
          .select('status')
          .eq('event_id', eventId)
          .eq('employee_id', session.user.id)
          .maybeSingle();

        if (assignment) {
          assignmentStatus = assignment.status;
          limitedAccess = assignment.status === 'pending';
        }
      }

      setUserAssignmentStatus(assignmentStatus);
      setHasLimitedAccess(limitedAccess);

      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select(`
          *,
          organization:organizations(id, name, alias),
          contact_person:contact_persons(id, first_name, last_name),
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
        setError(`Błąd pobierania wydarzenia: ${eventError.message || JSON.stringify(eventError)}`);
        setEvent(null);
        setLoading(false);
        return;
      }

      if (!eventData) {
        console.log('Event not found');
        setError('Wydarzenie nie zostało znalezione lub nie masz dostępu do tego wydarzenia');
        setEvent(null);
        setLoading(false);
        return;
      }

      setEvent(eventData);

      // Jeśli użytkownik ma ograniczony dostęp (pending), nie pobieraj szczegółów
      if (limitedAccess) {
        setEquipment([]);
        setEmployees([]);
        setChecklists([]);
        setLoading(false);
        return;
      }

      const { data: equipmentData, error: equipmentError } = await supabase
        .from('event_equipment')
        .select(`
          *,
          equipment:equipment_items(
            name,
            brand,
            model,
            cable_specs,
            thumbnail_url,
            category:warehouse_categories(name)
          ),
          kit:equipment_kits(
            name,
            items:equipment_kit_items(
              quantity,
              equipment:equipment_items(
                name,
                brand,
                model,
                cable_specs,
                thumbnail_url,
                category:warehouse_categories(name)
              )
            )
          )
        `)
        .eq('event_id', eventId);

      if (!equipmentError && equipmentData) {
        setEquipment(equipmentData);
      } else {
        setEquipment([]);
      }

      const { data: employeesData, error: employeesError } = await supabase
        .from('employee_assignments')
        .select(`
          id,
          employee_id,
          role,
          responsibilities,
          status,
          invited_at,
          responded_at,
          notes,
          employee:employee_id(id, name, surname, nickname, occupation, avatar_url, avatar_metadata, email, phone_number)
        `)
        .eq('event_id', eventId);

      if (!employeesError && employeesData) {
        setEmployees(employeesData as any);
      } else {
        setEmployees([]);
      }

      setChecklists([]);
    } catch (error) {
      console.error('Error fetching event details:', error);
      setEvent(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchEquipmentAvailability = async () => {
    if (!event?.event_date) return;

    try {
      const availability: {[key: string]: {available: number, reserved: number}} = {};

      for (const eq of equipment) {
        if (eq.equipment_id) {
          const { data, error } = await supabase.rpc('get_available_equipment_count', {
            p_equipment_id: eq.equipment_id,
            p_event_date: event.event_date,
            p_exclude_event_id: eventId
          });

          if (!error && data !== null) {
            availability[eq.equipment_id] = {
              available: data,
              reserved: eq.quantity
            };
          }
        }
      }

      setEquipmentAvailability(availability);
    } catch (error) {
      console.error('Error fetching availability:', error);
    }
  };

  const handleUpdateQuantity = async (eventEquipmentId: string, equipmentId: string, newQuantity: number) => {
    try {
      const avail = equipmentAvailability[equipmentId];
      if (avail && newQuantity > avail.available + avail.reserved) {
        alert(`Dostępna ilość: ${avail.available + avail.reserved} szt.`);
        return;
      }

      const { error } = await supabase
        .from('event_equipment')
        .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
        .eq('id', eventEquipmentId);

      if (error) {
        console.error('Error updating quantity:', error);
        alert('Błąd podczas aktualizacji ilości');
        return;
      }

      setEditingQuantity(null);
      await fetchEventDetails();
      await fetchEquipmentAvailability();
      await logChange('equipment_updated', `Zaktualizowano ilość sprzętu na ${newQuantity}`);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  const fetchAuditLog = async () => {
    try {
      const { data, error } = await supabase
        .from('event_audit_log')
        .select(`
          *,
          employee:employees!event_audit_log_user_id_fkey(
            id,
            name,
            surname,
            nickname,
            avatar_url,
            avatar_metadata,
            occupation,
            email
          )
        `)
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setAuditLog(data);
      } else if (error) {
        console.error('Error fetching audit log:', error);
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

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('event_categories')
        .select(`
          id,
          name,
          color,
          icon:custom_icons(id, name, svg_code, preview_color)
        `)
        .eq('is_active', true)
        .order('name');

      if (!error && data) {
        setCategories(data);
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const handleUpdateCategory = async (categoryId: string) => {
    if (!event) return;

    try {
      const { error } = await supabase
        .from('events')
        .update({ category_id: categoryId || null })
        .eq('id', eventId);

      if (error) throw error;

      await fetchEventDetails();
      setIsEditingCategory(false);
    } catch (err) {
      console.error('Error updating category:', err);
      alert('Błąd podczas aktualizacji kategorii');
    }
  };

  const logChange = async (action: string, description: string, fieldName?: string, oldValue?: string, newValue?: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;

      const { data: employee } = await supabase
        .from('employees')
        .select('id, name, surname, nickname')
        .eq('id', session.user.id)
        .single();

      if (!employee) {
        console.warn('Employee not found for user:', session.user.id);
        return;
      }

      await supabase
        .from('event_audit_log')
        .insert([
          {
            event_id: eventId,
            user_id: employee.id,
            user_name: employee.nickname || `${employee.name} ${employee.surname}`,
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

  const handleDeleteEvent = async () => {
    if (!event) return;

    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć to wydarzenie?',
      `Wydarzenie "${event.name}" zostanie trwale usunięte wraz z całą historią, przypisaniami i plikami. Tej operacji nie można cofnąć.`
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('events')
        .delete()
        .eq('id', eventId);

      if (error) {
        console.error('Error deleting event:', error);
        showSnackbar('Błąd podczas usuwania wydarzenia', 'error');
        return;
      }

      showSnackbar('Wydarzenie zostało usunięte', 'success');
      router.push('/crm/events');
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd podczas usuwania', 'error');
    }
  };

  const fetchAvailableEquipment = async () => {
    try {
      let availability = null;

      // Jeśli wydarzenie ma daty, sprawdź dostępność w zakresie dat
      if (event.event_date && event.event_end_date) {
        const { data: availData, error: availError } = await supabase.rpc(
          'check_equipment_availability_for_event',
          {
            p_event_id: eventId,
            p_start_date: event.event_date,
            p_end_date: event.event_end_date
          }
        );

        if (availError) {
          console.error('Error checking availability:', availError);
          return;
        }

        availability = availData;
      } else {
        // Brak dat - pokaż całą dostępność (wszystkie jednostki)
        const { data: items } = await supabase
          .from('equipment_items')
          .select('id, name');

        const { data: kits } = await supabase
          .from('equipment_kits')
          .select('id, name');

        // Utwórz syntetyczną listę dostępności pokazującą całą ilość
        const itemAvail = await Promise.all((items || []).map(async (item: any) => {
          const { count } = await supabase
            .from('equipment_units')
            .select('*', { count: 'exact', head: true })
            .eq('equipment_id', item.id)
            .in('status', ['available', 'reserved', 'in_use']);

          return {
            item_id: item.id,
            item_type: 'item',
            item_name: item.name,
            total_quantity: count || 0,
            reserved_quantity: 0,
            available_quantity: count || 0
          };
        }));

        const kitAvail = (kits || []).map((kit: any) => ({
          item_id: kit.id,
          item_type: 'kit',
          item_name: kit.name,
          total_quantity: 1,
          reserved_quantity: 0,
          available_quantity: 1
        }));

        availability = [...itemAvail, ...kitAvail];
      }

      console.log('Availability data:', availability);

      // Stwórz mapę dostępności
      const availabilityMap = new Map(
        (availability || []).map((item: any) => [
          `${item.item_type}-${item.item_id}`,
          item
        ])
      );

      console.log('Availability map:', availabilityMap);

      // Pobierz wszystkie items
      const { data: items, error: itemsError } = await supabase
        .from('equipment_items')
        .select(`
          *,
          category:warehouse_categories(name)
        `)
        .order('name');

      if (!itemsError && items) {
        // Filtruj sprzęt który jest już dodany do wydarzenia
        const alreadyAddedIds = equipment
          .filter(eq => eq.equipment_id)
          .map(eq => eq.equipment_id);

        const availableItems = items
          .filter(item => !alreadyAddedIds.includes(item.id))
          .map(item => {
            const avail = availabilityMap.get(`item-${item.id}`);
            return {
              ...item,
              available_count: avail?.available_quantity || 0,
              total_quantity: avail?.total_quantity || 0,
              reserved_quantity: avail?.reserved_quantity || 0
            };
          })
          .filter(item => item.available_count > 0);

        setAvailableEquipment(availableItems);
      }

      // Pobierz zestawy
      const { data: kits, error: kitsError } = await supabase
        .from('equipment_kits')
        .select(`
          *,
          items:equipment_kit_items(
            equipment_id,
            quantity,
            equipment:equipment_items(
              id,
              name,
              category:warehouse_categories(name)
            )
          )
        `)
        .order('name');

      if (!kitsError && kits) {
        const alreadyAddedKitIds = equipment
          .filter(eq => eq.kit_id)
          .map(eq => eq.kit_id);

        const availableKitsWithAvail = kits
          .filter(kit => !alreadyAddedKitIds.includes(kit.id))
          .map(kit => {
            const avail = availabilityMap.get(`kit-${kit.id}`);
            return {
              ...kit,
              available_count: avail?.available_quantity || 0
            };
          })
          .filter(kit => kit.available_count > 0);

        setAvailableKits(availableKitsWithAvail);
      }
    } catch (error) {
      console.error('Error fetching available equipment:', error);
    }
  };

  const fetchAvailableEmployees = async () => {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('name');

    if (!error && data) {
      // Odfiltruj pracowników którzy są już w zespole
      const alreadyAddedIds = employees.map(emp => emp.employee_id);
      const availableEmp = data.filter(emp => !alreadyAddedIds.includes(emp.id));
      setAvailableEmployees(availableEmp);
    }
  };

  const handleAddEquipment = async (selectedItems: Array<{id: string, quantity: number, notes: string, type: 'item' | 'kit'}>) => {
    try {
      const itemsToInsert: any[] = [];

      for (const selected of selectedItems) {
        if (selected.type === 'kit') {
          itemsToInsert.push({
            event_id: eventId,
            kit_id: selected.id,
            equipment_id: null,
            quantity: selected.quantity,
            notes: selected.notes,
          });
        } else {
          itemsToInsert.push({
            event_id: eventId,
            kit_id: null,
            equipment_id: selected.id,
            quantity: selected.quantity,
            notes: selected.notes,
          });
        }
      }

      const { error } = await supabase
        .from('event_equipment')
        .insert(itemsToInsert);

      if (error) {
        console.error('Error adding equipment:', error);
        alert('Błąd podczas dodawania sprzętu');
        return;
      }

      setShowAddEquipmentModal(false);
      fetchEventDetails();
      await logChange('equipment_added', `Dodano ${itemsToInsert.length} pozycji sprzętu`);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  const handleAddEmployee = async (
    employeeId: string,
    role: string,
    responsibilities: string,
    accessLevelId: string,
    permissions: any
  ) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      const { error } = await supabase
        .from('employee_assignments')
        .insert([
          {
            event_id: eventId,
            employee_id: employeeId,
            role: role,
            responsibilities: responsibilities || null,
            invited_by: session?.user?.id || null,
            status: 'pending',
            access_level_id: accessLevelId || null,
            can_edit_event: permissions.can_edit_event || false,
            can_edit_agenda: permissions.can_edit_agenda || false,
            can_edit_tasks: permissions.can_edit_tasks || false,
            can_edit_files: permissions.can_edit_files || false,
            can_edit_equipment: permissions.can_edit_equipment || false,
            can_invite_members: permissions.can_invite_members || false,
            can_view_budget: permissions.can_view_budget || false,
            granted_by: session?.user?.id || null,
            permissions_updated_at: new Date().toISOString(),
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
        .from('employee_assignments')
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
    console.log('Checklist functionality disabled - table does not exist');
  };

  const handleAddChecklist = async (task: string, priority: string) => {
    console.log('Checklist functionality disabled - table does not exist');
    setShowAddChecklistModal(false);
  };

  const handleRemoveChecklist = async (checklistId: string) => {
    console.log('Checklist functionality disabled - table does not exist');
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
        <div className="text-red-400 text-lg font-medium">
          {error || 'Event nie został znaleziony'}
        </div>
        {error && (
          <div className="text-[#e5e4e2]/60 text-sm max-w-md text-center">
            Sprawdź konsolę przeglądarki (F12) aby zobaczyć więcej szczegółów
          </div>
        )}
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
              {!isEditingCategory && event.category && (
                <button
                  onClick={() => setIsEditingCategory(true)}
                  className="flex items-center gap-2 px-3 py-1 rounded-lg border hover:opacity-80 transition-opacity"
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
                </button>
              )}
              {!isEditingCategory && !event.category && (
                <button
                  onClick={() => setIsEditingCategory(true)}
                  className="flex items-center gap-2 px-3 py-1 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 text-[#d3bb73] hover:bg-[#d3bb73]/20 transition-colors"
                >
                  <Tag className="w-4 h-4" />
                  <span className="text-sm font-medium">Dodaj kategorię</span>
                </button>
              )}
              {isEditingCategory && (
                <div className="flex items-center gap-2">
                  <select
                    value={event.category_id || ''}
                    onChange={(e) => handleUpdateCategory(e.target.value)}
                    className="px-3 py-1 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] text-sm focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50"
                    autoFocus
                  >
                    <option value="">Bez kategorii</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setIsEditingCategory(false)}
                    className="p-1 text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                {event.organization ? (event.organization.alias || event.organization.name) : 'Brak klienta'}
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
          {isAdmin && (
            <button
              onClick={handleDeleteEvent}
              className="flex items-center gap-2 bg-red-500/10 text-red-400 border border-red-500/20 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Usuń
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b border-[#d3bb73]/10 overflow-x-auto">
        {[
          { id: 'overview', label: 'Przegląd', icon: FileText },
          { id: 'offer', label: 'Oferta', icon: DollarSign },
          { id: 'equipment', label: 'Sprzęt', icon: Package },
          { id: 'team', label: 'Zespół', icon: Users },
          { id: 'logistics', label: 'Logistyka', icon: Truck },
          { id: 'subcontractors', label: 'Podwykonawcy', icon: UserCheck },
          { id: 'files', label: 'Pliki', icon: FileText },
          { id: 'tasks', label: 'Zadania', icon: CheckSquare },
          { id: 'history', label: 'Historia', icon: History },
        ]
        .filter((tab) => {
          // Jeśli użytkownik ma ograniczony dostęp, pokaż tylko przegląd
          if (hasLimitedAccess) {
            return tab.id === 'overview';
          }
          return true;
        })
        .map((tab) => {
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
            {/* Banner z zaproszeniem dla użytkowników z ograniczonym dostępem */}
            {hasLimitedAccess && userAssignmentStatus === 'pending' && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <AlertCircle className="w-6 h-6 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-lg font-medium text-blue-400 mb-2">
                      Zaproszenie do zespołu wydarzenia
                    </h3>
                    <p className="text-[#e5e4e2]/80 mb-4">
                      Zostałeś zaproszony do udziału w tym wydarzeniu. Po akceptacji zaproszenia
                      uzyskasz dostęp do pełnych szczegółów wydarzenia, w tym sprzętu, zadań i plików.
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={async () => {
                          const { data: { session } } = await supabase.auth.getSession();
                          if (!session?.user?.id) return;

                          const { data: assignment } = await supabase
                            .from('employee_assignments')
                            .select('id')
                            .eq('event_id', eventId)
                            .eq('employee_id', session.user.id)
                            .single();

                          if (assignment) {
                            await supabase
                              .from('employee_assignments')
                              .update({ status: 'accepted', responded_at: new Date().toISOString() })
                              .eq('id', assignment.id);

                            await fetchEventDetails();
                          }
                        }}
                        className="px-4 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 rounded-lg transition-colors"
                      >
                        Akceptuj zaproszenie
                      </button>
                      <button
                        onClick={async () => {
                          const { data: { session } } = await supabase.auth.getSession();
                          if (!session?.user?.id) return;

                          const { data: assignment } = await supabase
                            .from('employee_assignments')
                            .select('id')
                            .eq('event_id', eventId)
                            .eq('employee_id', session.user.id)
                            .single();

                          if (assignment) {
                            await supabase
                              .from('employee_assignments')
                              .update({ status: 'rejected', responded_at: new Date().toISOString() })
                              .eq('id', assignment.id);

                            router.push('/crm/events');
                          }
                        }}
                        className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-lg transition-colors"
                      >
                        Odrzuć zaproszenie
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

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

                {/* Ukryj klienta dla użytkowników z ograniczonym dostępem */}
                {!hasLimitedAccess && (
                  <div className="flex items-start gap-3">
                    <Building2 className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Klient</p>
                      <p className="text-[#e5e4e2]">
                        {event.organization ? (event.organization.alias || event.organization.name) : 'Brak klienta'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-light text-[#e5e4e2]">Opis</h2>
                {!isEditingDescription && !hasLimitedAccess && (
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
            <div className="space-y-2">
              {equipment.map((item) => {
                const isExpanded = expandedKits.has(item.id);
                const isKit = !!item.kit;

                return (
                  <div key={item.id}>
                    <div className="flex items-center gap-3 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2.5 hover:border-[#d3bb73]/20 transition-colors">
                      {isKit && (
                        <button
                          onClick={() => {
                            const newExpanded = new Set(expandedKits);
                            if (isExpanded) {
                              newExpanded.delete(item.id);
                            } else {
                              newExpanded.add(item.id);
                            }
                            setExpandedKits(newExpanded);
                          }}
                          className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
                        >
                          <ChevronDown
                            className={`w-4 h-4 transition-transform ${
                              isExpanded ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                      )}

                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {isKit ? (
                          <span className="text-base">🎁</span>
                        ) : item.equipment?.thumbnail_url ? (
                          <img
                            src={item.equipment.thumbnail_url}
                            alt={item.equipment.name}
                            className="w-10 h-10 rounded object-cover border border-[#d3bb73]/20"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded bg-[#1c1f33] border border-[#d3bb73]/20 flex items-center justify-center">
                            <Package className="w-5 h-5 text-[#e5e4e2]/30" />
                          </div>
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="text-[#e5e4e2] font-medium truncate">
                            {item.kit ? item.kit.name : item.equipment?.name || 'Nieznany'}
                          </span>
                          {!isKit && item.equipment && (
                            <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                              {item.equipment.brand && (
                                <span>{item.equipment.brand}</span>
                              )}
                              {item.equipment.model && (
                                <>
                                  {item.equipment.brand && <span>•</span>}
                                  <span>{item.equipment.model}</span>
                                </>
                              )}
                              {item.equipment.cable_specs && (
                                <>
                                  {(item.equipment.brand || item.equipment.model) && <span>•</span>}
                                  {item.equipment.cable_specs.connector_in && item.equipment.cable_specs.connector_out ? (
                                    <span>{item.equipment.cable_specs.connector_in} → {item.equipment.cable_specs.connector_out}</span>
                                  ) : item.equipment.cable_specs.type && (
                                    <span>{item.equipment.cable_specs.type}</span>
                                  )}
                                  {item.equipment.cable_specs.length_meters && (
                                    <span>{item.equipment.cable_specs.length_meters}m</span>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                        {!isKit && item.equipment?.category && (
                          <span className="hidden md:inline">{item.equipment.category.name}</span>
                        )}
                        {!isKit && item.equipment_id && equipmentAvailability[item.equipment_id] && (
                          <div className="hidden lg:flex flex-col items-end text-xs">
                            <span className="text-[#d3bb73]">
                              {equipmentAvailability[item.equipment_id].available + equipmentAvailability[item.equipment_id].reserved} dostępne
                            </span>
                          </div>
                        )}
                        {editingQuantity === item.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="1"
                              defaultValue={item.quantity}
                              className="w-16 bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-[#e5e4e2] text-sm"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const newQuantity = parseInt((e.target as HTMLInputElement).value);
                                  if (newQuantity > 0) {
                                    handleUpdateQuantity(item.id, item.equipment_id, newQuantity);
                                  }
                                } else if (e.key === 'Escape') {
                                  setEditingQuantity(null);
                                }
                              }}
                              onBlur={(e) => {
                                const newQuantity = parseInt(e.target.value);
                                if (newQuantity > 0 && newQuantity !== item.quantity) {
                                  handleUpdateQuantity(item.id, item.equipment_id, newQuantity);
                                } else {
                                  setEditingQuantity(null);
                                }
                              }}
                              autoFocus
                            />
                            <span className="text-[#e5e4e2]/60">szt.</span>
                          </div>
                        ) : (
                          <button
                            onClick={() => !isKit && setEditingQuantity(item.id)}
                            className={`font-medium text-[#e5e4e2] ${!isKit ? 'hover:text-[#d3bb73] cursor-pointer' : ''}`}
                            disabled={isKit}
                          >
                            {item.quantity} szt.
                          </button>
                        )}
                      </div>

                      <button
                        onClick={() => handleRemoveEquipment(item.id)}
                        className="text-red-400/60 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {isKit && isExpanded && item.kit?.items && (
                      <div className="ml-9 mt-1 space-y-1">
                        {item.kit.items.map((kitItem: any, idx: number) => (
                          <div
                            key={idx}
                            className="flex items-center gap-3 bg-[#0f1119]/50 border border-[#d3bb73]/5 rounded px-4 py-2 text-sm"
                          >
                            {kitItem.equipment.thumbnail_url ? (
                              <img
                                src={kitItem.equipment.thumbnail_url}
                                alt={kitItem.equipment.name}
                                className="w-8 h-8 rounded object-cover border border-[#d3bb73]/10"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded bg-[#1c1f33] border border-[#d3bb73]/10 flex items-center justify-center">
                                <Package className="w-4 h-4 text-[#e5e4e2]/30" />
                              </div>
                            )}
                            <div className="flex flex-col flex-1 min-w-0">
                              <span className="text-[#e5e4e2]/80">
                                {kitItem.equipment.name}
                              </span>
                              <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/40">
                                {kitItem.equipment.brand && (
                                  <span>{kitItem.equipment.brand}</span>
                                )}
                                {kitItem.equipment.model && (
                                  <>
                                    {kitItem.equipment.brand && <span>•</span>}
                                    <span>{kitItem.equipment.model}</span>
                                  </>
                                )}
                                {kitItem.equipment.cable_specs && (
                                  <>
                                    {(kitItem.equipment.brand || kitItem.equipment.model) && <span>•</span>}
                                    {kitItem.equipment.cable_specs.connector_in && kitItem.equipment.cable_specs.connector_out ? (
                                      <span>{kitItem.equipment.cable_specs.connector_in} → {kitItem.equipment.cable_specs.connector_out}</span>
                                    ) : kitItem.equipment.cable_specs.type && (
                                      <span>{kitItem.equipment.cable_specs.type}</span>
                                    )}
                                    {kitItem.equipment.cable_specs.length_meters && (
                                      <span>{kitItem.equipment.cable_specs.length_meters}m</span>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                            <span className="text-[#e5e4e2]/50 text-xs hidden md:inline">
                              {kitItem.equipment.category?.name}
                            </span>
                            <span className="text-[#e5e4e2]/60 font-medium">
                              {kitItem.quantity * item.quantity} szt.
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {item.notes && (
                      <div className="ml-9 mt-1 text-xs text-[#e5e4e2]/40 italic px-4">
                        {item.notes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'team' && (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-light text-[#e5e4e2]">Zespół</h2>
            {canManageTeam && (
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
            )}
          </div>

          {employees.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
              <p className="text-[#e5e4e2]/60">Brak przypisanych pracowników</p>
            </div>
          ) : (
            <TeamMembersList
              employees={employees}
              onRemove={handleRemoveEmployee}
            />
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
        <EventFilesExplorer eventId={eventId} />
      )}

      {activeTab === 'logistics' && event && (
        <EventLogisticsPanel
          eventId={event.id}
          eventLocation={event.location}
          eventDate={event.event_date}
          canManage={canManageTeam}
        />
      )}

      {activeTab === 'subcontractors' && (
        <EventSubcontractorsPanel eventId={eventId} />
      )}

      {activeTab === 'tasks' && event && (
        <EventTasksBoard eventId={event.id} canManage={canManageTeam} />
      )}

      {activeTab === 'history' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-light text-[#e5e4e2]">Historia zmian</h2>
            <div className="text-sm text-[#e5e4e2]/60">
              {auditLog.length} {auditLog.length === 1 ? 'wpis' : 'wpisów'}
            </div>
          </div>

          {auditLog.length === 0 ? (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-8 text-center">
              <History className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-3" />
              <p className="text-[#e5e4e2]/60">Brak historii zmian</p>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute left-[27px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-[#d3bb73]/20 via-[#d3bb73]/10 to-transparent"></div>

              <div className="space-y-6">
                {auditLog.map((log, index) => {
                  const employee = log.employee;
                  const displayName = employee
                    ? (employee.nickname || `${employee.name} ${employee.surname}`)
                    : 'System';

                  return (
                    <div key={log.id} className="relative pl-16">
                      <div className="absolute left-0 top-0">
                        <div className="relative group">
                          {employee ? (
                            <button
                              onClick={() => router.push(`/crm/employees/${employee.id}`)}
                              onMouseEnter={() => setHoveredEmployee(log.id)}
                              onMouseLeave={() => setHoveredEmployee(null)}
                              className="relative"
                            >
                              <EmployeeAvatar
                                employee={employee}
                                size={56}
                                className="ring-4 ring-[#0f1119] hover:ring-[#d3bb73]/30 transition-all cursor-pointer"
                              />
                              <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center ring-2 ring-[#0f1119] ${
                                log.action === 'create' ? 'bg-green-500/90' :
                                log.action === 'update' ? 'bg-blue-500/90' :
                                'bg-red-500/90'
                              }`}>
                                {log.action === 'create' && <Plus className="w-3 h-3 text-white" />}
                                {log.action === 'update' && <EditIcon className="w-3 h-3 text-white" />}
                                {log.action === 'delete' && <Trash2 className="w-3 h-3 text-white" />}
                              </div>

                              {hoveredEmployee === log.id && (
                                <div className="absolute left-full ml-4 top-0 z-50 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-xl p-4 shadow-xl min-w-[280px] animate-in fade-in slide-in-from-left-2">
                                  <div className="flex items-start gap-3">
                                    <EmployeeAvatar employee={employee} size={48} />
                                    <div>
                                      <p className="text-[#e5e4e2] font-medium">{displayName}</p>
                                      {employee.occupation && (
                                        <p className="text-sm text-[#e5e4e2]/60">{employee.occupation}</p>
                                      )}
                                      {employee.email && (
                                        <div className="flex items-center gap-1 mt-2 text-xs text-[#e5e4e2]/50">
                                          <Mail className="w-3 h-3" />
                                          <span>{employee.email}</span>
                                        </div>
                                      )}
                                      <div className="mt-3 pt-3 border-t border-[#d3bb73]/10">
                                        <p className="text-xs text-[#d3bb73]">Kliknij aby przejść do profilu</p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </button>
                          ) : (
                            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#d3bb73]/20 to-[#d3bb73]/5 flex items-center justify-center ring-4 ring-[#0f1119]">
                              <User className="w-6 h-6 text-[#d3bb73]/60" />
                              <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center ring-2 ring-[#0f1119] ${
                                log.action === 'create' ? 'bg-green-500/90' :
                                log.action === 'update' ? 'bg-blue-500/90' :
                                'bg-red-500/90'
                              }`}>
                                {log.action === 'create' && <Plus className="w-3 h-3 text-white" />}
                                {log.action === 'update' && <EditIcon className="w-3 h-3 text-white" />}
                                {log.action === 'delete' && <Trash2 className="w-3 h-3 text-white" />}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-4 hover:border-[#d3bb73]/40 transition-all hover:shadow-lg">
                        <div className="flex items-start justify-between gap-4 mb-2">
                          <div>
                            <p className="text-[#e5e4e2] font-medium">
                              <span className="text-[#d3bb73]">{displayName}</span>
                              {' '}
                              {log.action === 'create' && 'utworzył'}
                              {log.action === 'update' && 'zaktualizował'}
                              {log.action === 'delete' && 'usunął'}
                              {' '}
                              <span className="text-[#e5e4e2]/80">{log.entity_type}</span>
                            </p>
                            {log.field_name && (
                              <p className="text-sm text-[#e5e4e2]/60 mt-1">
                                Pole: <span className="text-[#d3bb73]/80">{log.field_name}</span>
                              </p>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="flex items-center gap-1.5 text-xs text-[#e5e4e2]/40">
                              <Clock className="w-3 h-3" />
                              <span>{new Date(log.created_at).toLocaleString('pl-PL', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}</span>
                            </div>
                          </div>
                        </div>

                        {log.metadata?.table && (
                          <div className="mt-3 pt-3 border-t border-[#d3bb73]/10">
                            <div className="flex items-center gap-2">
                              <Tag className="w-3 h-3 text-[#e5e4e2]/40" />
                              <span className="text-xs text-[#e5e4e2]/40">
                                Tabela: {log.metadata.table}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {showAddEquipmentModal && (
        <AddEquipmentModal
          isOpen={showAddEquipmentModal}
          onClose={() => setShowAddEquipmentModal(false)}
          onAdd={handleAddEquipment}
          availableEquipment={availableEquipment}
          availableKits={availableKits}
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
              console.log('Updating event with data:', updatedData);
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
          organizationId={event.organization_id}
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
  availableKits,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (selectedItems: Array<{id: string, quantity: number, notes: string, type: 'item' | 'kit'}>) => void;
  availableEquipment: any[];
  availableKits: any[];
}) {
  const [selectedItems, setSelectedItems] = useState<{[key: string]: {checked: boolean, quantity: number, notes: string, type: 'item' | 'kit'}}>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [showKits, setShowKits] = useState(true);
  const [showItems, setShowItems] = useState(true);

  if (!isOpen) return null;

  const handleToggle = (id: string, type: 'item' | 'kit') => {
    setSelectedItems(prev => ({
      ...prev,
      [id]: {
        checked: !prev[id]?.checked,
        quantity: prev[id]?.quantity || 1,
        notes: prev[id]?.notes || '',
        type,
      }
    }));
  };

  const handleQuantityChange = (id: string, quantity: number, maxQuantity?: number) => {
    let finalQuantity = Math.max(1, quantity);
    if (maxQuantity !== undefined) {
      finalQuantity = Math.min(finalQuantity, maxQuantity);
    }

    setSelectedItems(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        quantity: finalQuantity,
      }
    }));
  };

  const handleNotesChange = (id: string, notes: string) => {
    setSelectedItems(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        notes,
      }
    }));
  };

  const handleSubmit = () => {
    const selected = Object.entries(selectedItems)
      .filter(([_, value]) => value.checked)
      .map(([id, value]) => ({
        id,
        quantity: value.quantity,
        notes: value.notes,
        type: value.type,
      }));

    if (selected.length === 0) {
      alert('Zaznacz przynajmniej jedną pozycję');
      return;
    }

    // Walidacja - sprawdź czy nie przekraczamy całkowitej dostępności
    for (const item of selected) {
      if (item.type === 'item') {
        const equipmentItem = availableEquipment.find(eq => eq.id === item.id);
        if (equipmentItem && item.quantity > equipmentItem.total_quantity) {
          alert(`Nie można dodać ${item.quantity} jednostek sprzętu "${equipmentItem.name}". Dostępne są tylko ${equipmentItem.total_quantity} jednostek.`);
          return;
        }
      }
    }

    onAdd(selected);
    setSelectedItems({});
    setSearchTerm('');
  };

  const filteredKits = availableKits.filter(kit =>
    kit.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredItems = availableEquipment.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.category?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedCount = Object.values(selectedItems).filter(item => item.checked).length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj sprzęt</h2>
            {selectedCount > 0 && (
              <p className="text-sm text-[#d3bb73] mt-1">Zaznaczono: {selectedCount}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Szukaj sprzętu lub zestawu..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
          />
        </div>

        <div className="flex gap-4 mb-4">
          <button
            onClick={() => setShowKits(!showKits)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              showKits ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/60'
            }`}
          >
            Zestawy ({availableKits.length})
          </button>
          <button
            onClick={() => setShowItems(!showItems)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              showItems ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/60'
            }`}
          >
            Pojedynczy sprzęt ({availableEquipment.length})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {showKits && filteredKits.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-[#e5e4e2]/80 mb-3 sticky top-0 bg-[#0f1119] py-2">
                🎁 Zestawy
              </h3>
              <div className="space-y-2">
                {filteredKits.map((kit) => (
                  <div key={kit.id} className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedItems[kit.id]?.checked || false}
                        onChange={() => handleToggle(kit.id, 'kit')}
                        className="mt-1 w-4 h-4 rounded border-[#d3bb73]/20 text-[#d3bb73] focus:ring-[#d3bb73]"
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <div className="text-[#e5e4e2] font-medium">{kit.name}</div>
                          {kit.available_count !== undefined && (
                            <div className="text-xs text-right">
                              <div className="text-[#d3bb73] font-medium">
                                {kit.available_count > 0 ? 'Dostępny' : 'Niedostępny'}
                              </div>
                            </div>
                          )}
                        </div>
                        {kit.items && kit.items.length > 0 && (
                          <div className="text-xs text-[#e5e4e2]/60 mt-1">
                            Zawiera: {kit.items.map((item: any) => `${item.equipment.name} (${item.quantity})`).join(', ')}
                          </div>
                        )}
                      </div>
                    </label>
                    {selectedItems[kit.id]?.checked && (
                      <div className="mt-3 ml-7 space-y-3">
                        <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg p-3">
                          <label className="block text-xs text-[#e5e4e2]/60 mb-2">
                            Ilość zestawów
                          </label>
                          <div className="flex items-center gap-3">
                            <input
                              type="number"
                              min="1"
                              max={kit.available_count || 1}
                              value={selectedItems[kit.id]?.quantity || 1}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 1;
                                handleQuantityChange(kit.id, val, kit.available_count || 1);
                              }}
                              placeholder="Ilość zestawów"
                              className={`flex-1 bg-[#1c1f33] border rounded-lg px-4 py-2.5 text-base text-[#e5e4e2] focus:outline-none focus:ring-2 ${
                                kit.available_count && (selectedItems[kit.id]?.quantity || 1) > kit.available_count
                                  ? 'border-red-500 focus:ring-red-500/50'
                                  : 'border-[#d3bb73]/20 focus:ring-[#d3bb73]/50'
                              }`}
                            />
                            <div className="text-right">
                              <div className={`text-sm font-medium ${
                                kit.available_count && (selectedItems[kit.id]?.quantity || 1) > kit.available_count
                                  ? 'text-red-500'
                                  : 'text-[#d3bb73]'
                              }`}>
                                {selectedItems[kit.id]?.quantity || 1} / {kit.available_count || 1}
                              </div>
                              <div className="text-xs text-[#e5e4e2]/40">
                                dostępne
                              </div>
                            </div>
                          </div>
                          {kit.available_count && (selectedItems[kit.id]?.quantity || 1) > kit.available_count && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-red-500">
                              <span>⚠️</span>
                              <span>Ten zestaw jest już zarezerwowany w tym terminie!</span>
                            </div>
                          )}
                        </div>
                        <input
                          type="text"
                          value={selectedItems[kit.id]?.notes || ''}
                          onChange={(e) => handleNotesChange(kit.id, e.target.value)}
                          placeholder="Notatki (opcjonalnie)"
                          className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {showItems && filteredItems.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-[#e5e4e2]/80 mb-3 sticky top-0 bg-[#0f1119] py-2">
                📦 Pojedynczy sprzęt
              </h3>
              <div className="space-y-2">
                {filteredItems.map((item) => (
                  <div key={item.id} className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedItems[item.id]?.checked || false}
                        onChange={() => handleToggle(item.id, 'item')}
                        className="mt-1 w-4 h-4 rounded border-[#d3bb73]/20 text-[#d3bb73] focus:ring-[#d3bb73]"
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <div className="text-[#e5e4e2] font-medium">{item.name}</div>
                          {item.available_count !== undefined && (
                            <div className="text-xs text-right">
                              <div className="text-[#d3bb73] font-medium">
                                {item.available_count} dostępne
                              </div>
                              {item.reserved_quantity > 0 && (
                                <div className="text-[#e5e4e2]/40">
                                  {item.reserved_quantity} zarezerwowane
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-[#e5e4e2]/60 mt-1">
                          {item.category?.name || 'Brak kategorii'}
                        </div>
                      </div>
                    </label>
                    {selectedItems[item.id]?.checked && (
                      <div className="mt-3 ml-7 space-y-3">
                        <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg p-3">
                          <label className="block text-xs text-[#e5e4e2]/60 mb-2">
                            Ilość jednostek
                          </label>
                          <div className="flex items-center gap-3">
                            <input
                              type="number"
                              min="1"
                              max={item.available_count || undefined}
                              value={selectedItems[item.id]?.quantity || 1}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 1;
                                handleQuantityChange(item.id, val, item.total_quantity || item.available_count);
                              }}
                              placeholder="Ilość"
                              className={`flex-1 bg-[#1c1f33] border rounded-lg px-4 py-2.5 text-base text-[#e5e4e2] focus:outline-none focus:ring-2 ${
                                (selectedItems[item.id]?.quantity || 1) > item.total_quantity
                                  ? 'border-red-500 focus:ring-red-500/50'
                                  : (item.available_count && (selectedItems[item.id]?.quantity || 1) > item.available_count)
                                  ? 'border-orange-500 focus:ring-orange-500/50'
                                  : 'border-[#d3bb73]/20 focus:ring-[#d3bb73]/50'
                              }`}
                            />
                            <div className="text-right">
                              <div className={`text-sm font-medium ${
                                (selectedItems[item.id]?.quantity || 1) > item.total_quantity
                                  ? 'text-red-500'
                                  : (item.available_count && (selectedItems[item.id]?.quantity || 1) > item.available_count)
                                  ? 'text-orange-500'
                                  : 'text-[#d3bb73]'
                              }`}>
                                {selectedItems[item.id]?.quantity || 1} / {item.available_count || 0}
                              </div>
                              <div className="text-xs text-[#e5e4e2]/40">
                                dostępne w terminie
                              </div>
                              {item.total_quantity > 0 && (
                                <div className="text-xs text-[#e5e4e2]/30 mt-0.5">
                                  (Całkowita: {item.total_quantity})
                                </div>
                              )}
                            </div>
                          </div>
                          {(selectedItems[item.id]?.quantity || 1) > item.total_quantity && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-red-500">
                              <span>⚠️</span>
                              <span>Przekroczono całkowitą ilość! Mamy tylko {item.total_quantity} jednostek tego sprzętu.</span>
                            </div>
                          )}
                          {(selectedItems[item.id]?.quantity || 1) <= item.total_quantity && item.available_count && (selectedItems[item.id]?.quantity || 1) > item.available_count && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-orange-500">
                              <span>⚠️</span>
                              <span>W tym terminie dostępne są tylko {item.available_count} jednostek. {item.reserved_quantity} jest zarezerwowanych w innych wydarzeniach.</span>
                            </div>
                          )}
                          {item.reserved_quantity > 0 && (
                            <div className="mt-2 text-xs text-[#e5e4e2]/40">
                              ℹ️ W tym terminie zarezerwowano już {item.reserved_quantity} jednostek w innych wydarzeniach
                            </div>
                          )}
                        </div>
                        <input
                          type="text"
                          value={selectedItems[item.id]?.notes || ''}
                          onChange={(e) => handleNotesChange(item.id, e.target.value)}
                          placeholder="Notatki (opcjonalnie)"
                          className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredKits.length === 0 && filteredItems.length === 0 && (
            <div className="text-center py-12 text-[#e5e4e2]/60">
              Nie znaleziono sprzętu
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-4 border-t border-[#d3bb73]/10 mt-4">
          <button
            onClick={handleSubmit}
            disabled={selectedCount === 0}
            className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Dodaj zaznaczone ({selectedCount})
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

function AddEmployeeModal({
  isOpen,
  onClose,
  onAdd,
  availableEmployees,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (employeeId: string, role: string, responsibilities: string, accessLevelId: string, permissions: any) => void;
  availableEmployees: any[];
}) {
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [role, setRole] = useState('');
  const [responsibilities, setResponsibilities] = useState('');
  const [accessLevels, setAccessLevels] = useState<any[]>([]);
  const [selectedAccessLevel, setSelectedAccessLevel] = useState('');
  const [canEditEvent, setCanEditEvent] = useState(false);
  const [canEditAgenda, setCanEditAgenda] = useState(false);
  const [canEditTasks, setCanEditTasks] = useState(false);
  const [canEditFiles, setCanEditFiles] = useState(false);
  const [canEditEquipment, setCanEditEquipment] = useState(false);
  const [canInviteMembers, setCanInviteMembers] = useState(false);
  const [canViewBudget, setCanViewBudget] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchAccessLevels();
    }
  }, [isOpen]);

  const fetchAccessLevels = async () => {
    const { data, error } = await supabase
      .from('access_levels')
      .select('*')
      .order('order_index');

    if (!error && data) {
      setAccessLevels(data);
      const defaultLevel = data.find(l => l.slug === 'employee');
      if (defaultLevel) {
        setSelectedAccessLevel(defaultLevel.id);
      }
    }
  };

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!selectedEmployee) {
      alert('Wybierz pracownika');
      return;
    }
    const permissions = {
      can_edit_event: canEditEvent,
      can_edit_agenda: canEditAgenda,
      can_edit_tasks: canEditTasks,
      can_edit_files: canEditFiles,
      can_edit_equipment: canEditEquipment,
      can_invite_members: canInviteMembers,
      can_view_budget: canViewBudget,
    };
    onAdd(selectedEmployee, role, responsibilities, selectedAccessLevel, permissions);
    setSelectedEmployee('');
    setRole('');
    setResponsibilities('');
    setCanEditEvent(false);
    setCanEditAgenda(false);
    setCanEditTasks(false);
    setCanEditFiles(false);
    setCanEditEquipment(false);
    setCanInviteMembers(false);
    setCanViewBudget(false);
  };

  const hasAnyPermission = canEditEvent || canEditAgenda || canEditTasks || canEditFiles || canEditEquipment || canInviteMembers || canViewBudget;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-md w-full my-8 max-h-[90vh] overflow-y-auto">
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
                  {emp.name} {emp.surname} {emp.occupation ? `- ${emp.occupation}` : ''}
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
              Zakres odpowiedzialności
            </label>
            <textarea
              value={responsibilities}
              onChange={(e) => setResponsibilities(e.target.value)}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] min-h-[80px] focus:outline-none focus:border-[#d3bb73]"
              placeholder="Opisz zakres obowiązków..."
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Poziom dostępu
            </label>
            <select
              value={selectedAccessLevel}
              onChange={(e) => setSelectedAccessLevel(e.target.value)}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              {accessLevels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name} - {level.description}
                </option>
              ))}
            </select>
            <p className="text-xs text-[#e5e4e2]/40 mt-1">
              Określa domyślny zakres widoczności dla tej osoby
            </p>
          </div>

          <div className="border-t border-[#d3bb73]/10 pt-4">
            <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/80 mb-3">
              <input
                type="checkbox"
                checked={hasAnyPermission}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (!checked) {
                    setCanEditEvent(false);
                    setCanEditAgenda(false);
                    setCanEditTasks(false);
                    setCanEditFiles(false);
                    setCanEditEquipment(false);
                    setCanInviteMembers(false);
                    setCanViewBudget(false);
                  }
                }}
                className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73] focus:ring-[#d3bb73]"
              />
              <span className="font-medium">Nadaj uprawnienia współpracownika</span>
            </label>

            {hasAnyPermission && (
              <div className="ml-6 space-y-2 bg-[#1c1f33]/50 rounded-lg p-3 border border-[#d3bb73]/10">
                <p className="text-xs text-[#e5e4e2]/60 mb-3">
                  Zaznacz uprawnienia które chcesz nadać:
                </p>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditEvent}
                    onChange={(e) => setCanEditEvent(e.target.checked)}
                    className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Edycja wydarzenia (nazwa, data, lokalizacja)
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditAgenda}
                    onChange={(e) => setCanEditAgenda(e.target.checked)}
                    className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Edycja agendy
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditTasks}
                    onChange={(e) => setCanEditTasks(e.target.checked)}
                    className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Zarządzanie zadaniami
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditFiles}
                    onChange={(e) => setCanEditFiles(e.target.checked)}
                    className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Zarządzanie plikami
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditEquipment}
                    onChange={(e) => setCanEditEquipment(e.target.checked)}
                    className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Zarządzanie sprzętem
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canInviteMembers}
                    onChange={(e) => setCanInviteMembers(e.target.checked)}
                    className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Zapraszanie członków zespołu
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canViewBudget}
                    onChange={(e) => setCanViewBudget(e.target.checked)}
                    className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Widok budżetu
                </label>
              </div>
            )}
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

function TeamMembersList({
  employees,
  onRemove,
}: {
  employees: Employee[];
  onRemove: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editResponsibilities, setEditResponsibilities] = useState('');
  const [removeModal, setRemoveModal] = useState<{isOpen: boolean, id: string, name: string} | null>(null);
  const [permissionsModal, setPermissionsModal] = useState<{isOpen: boolean, assignment: any} | null>(null);
  const [permissionsForm, setPermissionsForm] = useState({
    can_edit_event: false,
    can_edit_agenda: false,
    can_edit_tasks: false,
    can_edit_files: false,
    can_edit_equipment: false,
    can_invite_members: false,
    can_view_budget: false,
  });

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const openPermissionsModal = (assignment: any) => {
    setPermissionsForm({
      can_edit_event: assignment.can_edit_event || false,
      can_edit_agenda: assignment.can_edit_agenda || false,
      can_edit_tasks: assignment.can_edit_tasks || false,
      can_edit_files: assignment.can_edit_files || false,
      can_edit_equipment: assignment.can_edit_equipment || false,
      can_invite_members: assignment.can_invite_members || false,
      can_view_budget: assignment.can_view_budget || false,
    });
    setPermissionsModal({ isOpen: true, assignment });
  };

  const savePermissions = async () => {
    if (!permissionsModal) return;

    try {
      const { error } = await supabase
        .from('employee_assignments')
        .update({
          ...permissionsForm,
          permissions_updated_at: new Date().toISOString()
        })
        .eq('id', permissionsModal.assignment.id);

      if (error) throw error;

      setPermissionsModal(null);
      window.location.reload();
    } catch (error) {
      console.error('Error updating permissions:', error);
      alert('Błąd podczas aktualizacji uprawnień');
    }
  };

  const startEdit = (item: Employee) => {
    setEditingId(item.id);
    setEditRole(item.role || '');
    setEditResponsibilities(item.responsibilities || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditRole('');
    setEditResponsibilities('');
  };

  const saveEdit = async (id: string) => {
    try {
      const { error } = await supabase
        .from('employee_assignments')
        .update({
          role: editRole,
          responsibilities: editResponsibilities
        })
        .eq('id', id);

      if (error) throw error;

      setEditingId(null);
      window.location.reload();
    } catch (error) {
      console.error('Error updating assignment:', error);
      alert('Błąd podczas aktualizacji');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'accepted':
        return <span className="px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400">Zaakceptowano</span>;
      case 'rejected':
        return <span className="px-2 py-1 rounded-full text-xs bg-red-500/20 text-red-400">Odrzucono</span>;
      default:
        return <span className="px-2 py-1 rounded-full text-xs bg-yellow-500/20 text-yellow-400">Oczekuje</span>;
    }
  };

  return (
    <>
      <div className="space-y-3">
        {employees.map((item) => {
          const isEditing = editingId === item.id;
          const isExpanded = expandedId === item.id;

          return (
            <div
              key={item.id}
              className={`bg-[#0f1119] border rounded-lg overflow-hidden ${
                item.status === 'rejected' ? 'border-red-500/30' : 'border-[#d3bb73]/10'
              }`}
            >
              <div
                onClick={() => !isEditing && toggleExpand(item.id)}
                className="flex items-center gap-4 p-4 cursor-pointer hover:bg-[#d3bb73]/5 transition-colors"
              >
                <EmployeeAvatar
                  avatarUrl={item.employee.avatar_url}
                  avatarMetadata={item.employee.avatar_metadata}
                  employeeName={`${item.employee.name} ${item.employee.surname}`}
                  size={48}
                  className="flex-shrink-0"
                />

                <div className="flex-1 min-w-0">
                  <h3 className="text-[#e5e4e2] font-medium">
                    {item.employee.nickname || `${item.employee.name} ${item.employee.surname}`}
                  </h3>
                  {item.role && !isEditing && (
                    <p className="text-sm text-[#d3bb73]">{item.role}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    {getStatusBadge(item.status)}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!isEditing && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(item);
                        }}
                        className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors"
                      >
                        <EditIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRemoveModal({
                            isOpen: true,
                            id: item.id,
                            name: item.employee.nickname || `${item.employee.name} ${item.employee.surname}`
                          });
                        }}
                        className="p-2 text-red-400 hover:bg-red-400/10 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  {!isEditing && (isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-[#e5e4e2]/60" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-[#e5e4e2]/60" />
                  ))}
                </div>
              </div>

              {isEditing && (
                <div className="border-t border-[#d3bb73]/10 p-4 space-y-3">
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                      Rola
                    </label>
                    <input
                      type="text"
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                      placeholder="np. Lead Audio, Technician..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                      Zakres odpowiedzialności
                    </label>
                    <textarea
                      value={editResponsibilities}
                      onChange={(e) => setEditResponsibilities(e.target.value)}
                      className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] min-h-[80px] focus:outline-none focus:border-[#d3bb73]"
                      placeholder="Opisz zakres obowiązków..."
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(item.id)}
                      className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
                    >
                      Zapisz
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33] rounded-lg"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              )}

              {isExpanded && !isEditing && (
                <div className="border-t border-[#d3bb73]/10 p-4 space-y-3">
                  {item.responsibilities && (
                    <div className="pb-3 border-b border-[#d3bb73]/10">
                      <div className="text-xs text-[#e5e4e2]/60 mb-1">Zakres odpowiedzialności:</div>
                      <p className="text-sm text-[#e5e4e2]/80 whitespace-pre-wrap">{item.responsibilities}</p>
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      onClick={() => openPermissionsModal(item)}
                      className="w-full flex items-center justify-center gap-2 bg-[#d3bb73]/10 text-[#d3bb73] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/20 transition-colors"
                    >
                      <User className="w-4 h-4" />
                      Zarządzaj uprawnieniami
                    </button>
                  </div>

                  {(item.can_edit_event || item.can_edit_agenda || item.can_edit_tasks || item.can_edit_files || item.can_edit_equipment || item.can_invite_members || item.can_view_budget) && (
                    <div className="pt-2 border-t border-[#d3bb73]/10">
                      <div className="text-xs text-[#e5e4e2]/60 mb-2">Nadane uprawnienia:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {item.can_edit_event && (
                          <span className="px-2 py-1 bg-blue-500/10 text-blue-400 text-xs rounded border border-blue-500/20">
                            Edycja wydarzenia
                          </span>
                        )}
                        {item.can_edit_agenda && (
                          <span className="px-2 py-1 bg-purple-500/10 text-purple-400 text-xs rounded border border-purple-500/20">
                            Edycja agendy
                          </span>
                        )}
                        {item.can_edit_tasks && (
                          <span className="px-2 py-1 bg-green-500/10 text-green-400 text-xs rounded border border-green-500/20">
                            Zarządzanie zadaniami
                          </span>
                        )}
                        {item.can_edit_files && (
                          <span className="px-2 py-1 bg-yellow-500/10 text-yellow-400 text-xs rounded border border-yellow-500/20">
                            Zarządzanie plikami
                          </span>
                        )}
                        {item.can_edit_equipment && (
                          <span className="px-2 py-1 bg-orange-500/10 text-orange-400 text-xs rounded border border-orange-500/20">
                            Zarządzanie sprzętem
                          </span>
                        )}
                        {item.can_invite_members && (
                          <span className="px-2 py-1 bg-pink-500/10 text-pink-400 text-xs rounded border border-pink-500/20">
                            Zapraszanie członków
                          </span>
                        )}
                        {item.can_view_budget && (
                          <span className="px-2 py-1 bg-cyan-500/10 text-cyan-400 text-xs rounded border border-cyan-500/20">
                            Widok budżetu
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {removeModal?.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-md w-full">
            <div className="flex items-start gap-4 mb-6">
              <div className="p-3 bg-red-500/10 rounded-lg">
                <AlertCircle className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h2 className="text-xl font-light text-[#e5e4e2] mb-2">Usuń z zespołu</h2>
                <p className="text-[#e5e4e2]/60">
                  Czy na pewno chcesz usunąć <span className="text-[#d3bb73]">{removeModal.name}</span> z zespołu wydarzenia?
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  onRemove(removeModal.id);
                  setRemoveModal(null);
                }}
                className="flex-1 bg-red-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-600"
              >
                Usuń
              </button>
              <button
                onClick={() => setRemoveModal(null)}
                className="px-4 py-2 rounded-lg text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

      {permissionsModal?.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="mb-6">
              <h2 className="text-xl font-light text-[#e5e4e2] mb-2">Zarządzaj uprawnieniami</h2>
              <p className="text-sm text-[#e5e4e2]/60">
                {permissionsModal.assignment.employee?.nickname || `${permissionsModal.assignment.employee?.name} ${permissionsModal.assignment.employee?.surname}`}
              </p>
            </div>

            <div className="space-y-3 mb-6">
              <label className="flex items-start gap-3 p-3 bg-[#1c1f33] rounded-lg cursor-pointer hover:bg-[#1c1f33]/80 transition-colors">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_event}
                  onChange={(e) => setPermissionsForm({ ...permissionsForm, can_edit_event: e.target.checked })}
                  className="mt-1 w-4 h-4 bg-[#0f1119] border-[#d3bb73]/30 rounded text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="text-[#e5e4e2] font-medium">Edycja wydarzenia</div>
                  <div className="text-xs text-[#e5e4e2]/60">Może edytować podstawowe informacje o wydarzeniu</div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 bg-[#1c1f33] rounded-lg cursor-pointer hover:bg-[#1c1f33]/80 transition-colors">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_agenda}
                  onChange={(e) => setPermissionsForm({ ...permissionsForm, can_edit_agenda: e.target.checked })}
                  className="mt-1 w-4 h-4 bg-[#0f1119] border-[#d3bb73]/30 rounded text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="text-[#e5e4e2] font-medium">Edycja agendy</div>
                  <div className="text-xs text-[#e5e4e2]/60">Może edytować harmonogram i agendę</div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 bg-[#1c1f33] rounded-lg cursor-pointer hover:bg-[#1c1f33]/80 transition-colors">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_tasks}
                  onChange={(e) => setPermissionsForm({ ...permissionsForm, can_edit_tasks: e.target.checked })}
                  className="mt-1 w-4 h-4 bg-[#0f1119] border-[#d3bb73]/30 rounded text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="text-[#e5e4e2] font-medium">Zarządzanie zadaniami</div>
                  <div className="text-xs text-[#e5e4e2]/60">Może tworzyć, edytować i usuwać zadania</div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 bg-[#1c1f33] rounded-lg cursor-pointer hover:bg-[#1c1f33]/80 transition-colors">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_files}
                  onChange={(e) => setPermissionsForm({ ...permissionsForm, can_edit_files: e.target.checked })}
                  className="mt-1 w-4 h-4 bg-[#0f1119] border-[#d3bb73]/30 rounded text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="text-[#e5e4e2] font-medium">Zarządzanie plikami</div>
                  <div className="text-xs text-[#e5e4e2]/60">Może dodawać i usuwać pliki</div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 bg-[#1c1f33] rounded-lg cursor-pointer hover:bg-[#1c1f33]/80 transition-colors">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_equipment}
                  onChange={(e) => setPermissionsForm({ ...permissionsForm, can_edit_equipment: e.target.checked })}
                  className="mt-1 w-4 h-4 bg-[#0f1119] border-[#d3bb73]/30 rounded text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="text-[#e5e4e2] font-medium">Zarządzanie sprzętem</div>
                  <div className="text-xs text-[#e5e4e2]/60">Może dodawać i usuwać sprzęt</div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 bg-[#1c1f33] rounded-lg cursor-pointer hover:bg-[#1c1f33]/80 transition-colors">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_invite_members}
                  onChange={(e) => setPermissionsForm({ ...permissionsForm, can_invite_members: e.target.checked })}
                  className="mt-1 w-4 h-4 bg-[#0f1119] border-[#d3bb73]/30 rounded text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="text-[#e5e4e2] font-medium">Zapraszanie członków</div>
                  <div className="text-xs text-[#e5e4e2]/60">Może zapraszać innych pracowników do zespołu</div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 bg-[#1c1f33] rounded-lg cursor-pointer hover:bg-[#1c1f33]/80 transition-colors">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_view_budget}
                  onChange={(e) => setPermissionsForm({ ...permissionsForm, can_view_budget: e.target.checked })}
                  className="mt-1 w-4 h-4 bg-[#0f1119] border-[#d3bb73]/30 rounded text-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="text-[#e5e4e2] font-medium">Widok budżetu</div>
                  <div className="text-xs text-[#e5e4e2]/60">Może przeglądać informacje finansowe</div>
                </div>
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={savePermissions}
                className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90"
              >
                Zapisz
              </button>
              <button
                onClick={() => setPermissionsModal(null)}
                className="px-4 py-2 rounded-lg text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
    organization_id: event.organization_id || '',
    category_id: event.category_id || '',
    event_date: event.event_date,
    event_end_date: event.event_end_date || '',
    location: event.location,
    budget: event.budget?.toString() || '',
    status: event.status,
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
    const { data, error } = await supabase
      .from('event_categories')
      .select('id, name, color')
      .eq('is_active', true)
      .order('name');
    console.log('Fetched categories:', data, 'Error:', error);
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

    const dataToSave = {
      name: formData.name,
      client_id: formData.client_id || null,
      category_id: formData.category_id || null,
      event_date: formData.event_date,
      event_end_date: formData.event_end_date || null,
      location: formData.location,
      budget: formData.budget ? parseFloat(formData.budget) : null,
      status: formData.status,
    };
    console.log('Form data to save:', dataToSave);
    onSave(dataToSave);
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

