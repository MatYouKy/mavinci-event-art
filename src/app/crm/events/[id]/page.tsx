'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  Building2,
  DollarSign,
  CreditCard as Edit,
  Trash2,
  Plus,
  Package,
  Users,
  FileText,
  CheckSquare,
  Clock,
  X,
  User,
  Tag,
  ChevronDown,
  Mail,
  Edit as EditIcon,
  AlertCircle,
  History,
  UserCheck,
  Truck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

import EventTasksBoard from '@/app/crm/events/[id]/components/tabs/EventTasksBoard';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import EventFilesExplorer from '@/app/crm/events/[id]/components/tabs/EventFilesExplorer';
import EventSubcontractorsPanel from '@/app/crm/events/[id]/components/tabs/EventSubcontractorsPanel';
import EventLogisticsPanel from '@/app/crm/events/[id]/components/tabs/EventLogisticsPanel';
import OfferWizard from '@/components/crm/OfferWizard';
import EventFinancesTab from '@/app/crm/events/[id]/components/tabs/EventFinancesTab';
import EventAgendaTab from '@/app/crm/events/[id]/components/tabs/EventAgendaTab';
import EventStatusEditor from '@/components/crm/EventStatusEditor';

import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';

import EditEventModalNew from '@/components/crm/EditEventModalNew';
import EventTabOffer from './components/tabs/EventTabOffer';
import { EventsDetailsTab } from './components/tabs/EventsDetailsTab/EventsDetailsTab';
import { fetchAuditLog } from './helpers/fetchAuditLog';
import { EventContractTab } from './components/tabs/EventContractTab';
import { AddChecklistModal } from './components/Modals/AddChecklistModal';
import AddEmployeeModal from '@/components/crm/AddEmployeeModal';
import { AddEquipmentModal } from './components/Modals/AddEquipmentModal';

export interface IEvent {
  location_id: null;
  expected_revenue: any;
  location_details: any;
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
  client_type: 'individual' | 'business';
  category_id: string;
  created_by: string;
  requires_subcontractors: boolean;
  organization?: {
    id: string;
    name: string;
    alias: string | null;
  } | null;
  contact_person?: {
    id: string;
    first_name: string;
    last_name: string;
    full_name: string;
    contact_type: string;
    email: string;
    phone: string;
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
  kit_id: unknown;
  id: string;
  equipment_id: string;
  quantity: number;
  notes: string;
  auto_added: boolean;
  equipment: {
    model: any;
    cable_specs: any;
    brand: any;
    thumbnail_url: any;
    name: string;
    category: string;
  };
  kit?: any;
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
  const { hasScope, isAdmin: isUserAdmin } = useCurrentEmployee();

  const [event, setEvent] = useState<IEvent | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    | 'overview'
    | 'equipment'
    | 'team'
    | 'files'
    | 'tasks'
    | 'offer'
    | 'subcontractors'
    | 'logistics'
    | 'finances'
    | 'contract'
    | 'agenda'
    | 'history'
  >('overview');


  const [isEditingCategory, setIsEditingCategory] = useState(false);

  const [categories, setCategories] = useState<any[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [canManageTeam, setCanManageTeam] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userAssignmentStatus, setUserAssignmentStatus] = useState<
    'pending' | 'accepted' | 'rejected' | null
  >(null);
  const [hasLimitedAccess, setHasLimitedAccess] = useState(false);
  const [allowedEventTabs, setAllowedEventTabs] = useState<string[]>([]);
  const [hasSubcontractors, setHasSubcontractors] = useState(false);

  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false);
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);
  const [availableEquipment, setAvailableEquipment] = useState<any[]>([]);
  const [availableKits, setAvailableKits] = useState<any[]>([]);
  const [availableEmployees, setAvailableEmployees] = useState<any[]>([]);
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());
  const [editingQuantity, setEditingQuantity] = useState<string | null>(null);
  const [equipmentAvailability, setEquipmentAvailability] = useState<{
    [key: string]: { available: number; reserved: number };
  }>({});

  const [showAddChecklistModal, setShowAddChecklistModal] = useState(false);
  const [showEditEventModal, setShowEditEventModal] = useState(false);
  const [offers, setOffers] = useState<any[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<any>(null);
  const [showCreateOfferModal, setShowCreateOfferModal] = useState(false);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hoveredEmployee, setHoveredEmployee] = useState<string | null>(null);

  useEffect(() => {
    if (eventId) {
      fetchEventDetails();
      fetchAuditLog(eventId);
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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        setCanManageTeam(false);
        setAllowedEventTabs([]);
        return;
      }

      setCurrentUserId(session.user.id);

      // Sprawdź czy użytkownik jest adminem oraz pobierz access_level i indywidualne event_tabs
      const { data: employee } = await supabase
        .from('employees')
        .select('permissions, role, access_level_id, event_tabs, access_levels(event_tabs)')
        .eq('id', session.user.id)
        .single();

      const userIsAdmin =
        employee?.role === 'admin' || employee?.permissions?.includes('events_manage');
      setIsAdmin(userIsAdmin);

      // Admin widzi wszystkie zakładki
      if (userIsAdmin) {
        setCanManageTeam(true);
        setAllowedEventTabs([
          'overview',
          'offer',
          'finances',
          'contract',
          'equipment',
          'team',
          'logistics',
          'subcontractors',
          'files',
          'tasks',
          'history',
        ]);
        return;
      }

      // Ustaw dozwolone zakładki:
      // 1. Jeśli pracownik ma indywidualne event_tabs - użyj ich
      // 2. Jeśli nie, użyj event_tabs z access_level
      // 3. Jeśli nic nie ma, domyślnie tylko 'overview'
      let eventTabs: string[] = ['overview'];
      if (employee?.event_tabs && employee.event_tabs.length > 0) {
        eventTabs = employee.event_tabs;
      } else if ((employee?.access_levels as any)?.event_tabs) {
        eventTabs = (employee.access_levels as any).event_tabs;
      }
      setAllowedEventTabs(eventTabs);

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
      const {
        data: { session },
      } = await supabase.auth.getSession();
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
        .select(
          `
          *,
          organization:organizations(id, name, alias),
          contact_person:contacts(
            id,
            first_name,
            last_name,
            full_name,
            contact_type,
            email,
            phone
          ),
          category:event_categories(
            id,
            name,
            color,
            icon:custom_icons(id, name, svg_code, preview_color)
          ),
          creator:employees!events_created_by_fkey(id, name, surname, avatar_url),
          location_details:locations!location_id(
            id,
            name,
            address,
            city,
            postal_code,
            country,
            formatted_address,
            latitude,
            longitude,
            google_maps_url
          )
        `,
        )
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

      // Ustaw czy pokazać zakładkę podwykonawców na podstawie pola requires_subcontractors
      setHasSubcontractors(eventData?.requires_subcontractors || false);

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
        .select(
          `
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
        `,
        )
        .eq('event_id', eventId);

      if (!equipmentError && equipmentData) {
        setEquipment(equipmentData);
      } else {
        setEquipment([]);
      }

      const { data: employeesData, error: employeesError } = await supabase
        .from('employee_assignments')
        .select(
          `
          id,
          employee_id,
          role,
          responsibilities,
          status,
          invited_at,
          responded_at,
          notes,
          employee:employee_id(id, name, surname, nickname, occupation, avatar_url, avatar_metadata, email, phone_number)
        `,
        )
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
      const availability: { [key: string]: { available: number; reserved: number } } = {};

      for (const eq of equipment) {
        if (eq.equipment_id) {
          const { data, error } = await supabase.rpc('get_available_equipment_count', {
            p_equipment_id: eq.equipment_id,
            p_event_date: event.event_date,
            p_exclude_event_id: eventId,
          });

          if (!error && data !== null) {
            availability[eq.equipment_id] = {
              available: data,
              reserved: eq.quantity,
            };
          }
        }
      }

      setEquipmentAvailability(availability);
    } catch (error) {
      console.error('Error fetching availability:', error);
    }
  };

  const handleUpdateQuantity = async (
    eventEquipmentId: string,
    equipmentId: string,
    newQuantity: number,
  ) => {
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

  const fetchOffers = async () => {
    try {
      const { data, error } = await supabase
        .from('offers')
        .select(
          `
          *,
          organization:organizations!organization_id(name)
        `,
        )
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
        .select(
          `
          id,
          name,
          color,
          icon:custom_icons(id, name, svg_code, preview_color)
        `,
        )
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

  const logChange = async (
    action: string,
    description: string,
    fieldName?: string,
    oldValue?: string,
    newValue?: string,
  ) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
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

      await supabase.from('event_audit_log').insert([
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

      fetchAuditLog(eventId);
    } catch (err) {
      console.error('Error logging change:', err);
    }
  };



  const handleDeleteEvent = async () => {
    if (!event) return;

    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć to wydarzenie?',
      `Wydarzenie "${event.name}" zostanie trwale usunięte wraz z całą historią, przypisaniami i plikami. Tej operacji nie można cofnąć.`,
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase.from('events').delete().eq('id', eventId);

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
            p_end_date: event.event_end_date,
          },
        );

        if (availError) {
          console.error('Error checking availability:', availError);
          return;
        }

        availability = availData;
      } else {
        // Brak dat - pokaż całą dostępność (wszystkie jednostki)
        const { data: items } = await supabase.from('equipment_items').select('id, name');

        const { data: kits } = await supabase.from('equipment_kits').select('id, name');

        // Utwórz syntetyczną listę dostępności pokazującą całą ilość
        const itemAvail = await Promise.all(
          (items || []).map(async (item: any) => {
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
              available_quantity: count || 0,
            };
          }),
        );

        const kitAvail = (kits || []).map((kit: any) => ({
          item_id: kit.id,
          item_type: 'kit',
          item_name: kit.name,
          total_quantity: 1,
          reserved_quantity: 0,
          available_quantity: 1,
        }));

        availability = [...itemAvail, ...kitAvail];
      }

      console.log('Availability data:', availability);

      // Stwórz mapę dostępności
      const availabilityMap = new Map(
        (availability || []).map((item: any) => [`${item.item_type}-${item.item_id}`, item]),
      );

      console.log('Availability map:', availabilityMap);

      // Pobierz wszystkie items
      const { data: items, error: itemsError } = await supabase
        .from('equipment_items')
        .select(
          `
          *,
          category:warehouse_categories(name)
        `,
        )
        .order('name');

      if (!itemsError && items) {
        // Filtruj sprzęt który jest już dodany do wydarzenia
        const alreadyAddedIds = equipment
          .filter((eq) => eq.equipment_id)
          .map((eq) => eq.equipment_id);

        const availableItems = items
          .filter((item) => !alreadyAddedIds.includes(item.id))
          .map((item) => {
            const avail = availabilityMap.get(`item-${item.id}`);
            return {
              ...item,
              available_count: avail?.available_quantity || 0,
              total_quantity: avail?.total_quantity || 0,
              reserved_quantity: avail?.reserved_quantity || 0,
            };
          })
          .filter((item) => item.available_count > 0);

        setAvailableEquipment(availableItems);
      }

      // Pobierz zestawy
      const { data: kits, error: kitsError } = await supabase
        .from('equipment_kits')
        .select(
          `
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
        `,
        )
        .order('name');

      if (!kitsError && kits) {
        const alreadyAddedKitIds = equipment.filter((eq) => eq.kit_id).map((eq) => eq.kit_id);

        const availableKitsWithAvail = kits
          .filter((kit) => !alreadyAddedKitIds.includes(kit.id))
          .map((kit) => {
            const avail = availabilityMap.get(`kit-${kit.id}`);
            return {
              ...kit,
              available_count: avail?.available_quantity || 0,
            };
          })
          .filter((kit) => kit.available_count > 0);

        setAvailableKits(availableKitsWithAvail);
      }
    } catch (error) {
      console.error('Error fetching available equipment:', error);
    }
  };

  const fetchAvailableEmployees = async () => {
    const { data, error } = await supabase.from('employees').select('*').order('name');

    if (!error && data) {
      // Odfiltruj pracowników którzy są już w zespole
      const alreadyAddedIds = employees.map((emp) => emp.employee_id);
      const availableEmp = data.filter((emp) => !alreadyAddedIds.includes(emp.id));
      setAvailableEmployees(availableEmp);
    }
  };

  const handleAddEquipment = async (
    selectedItems: Array<{ id: string; quantity: number; notes: string; type: 'item' | 'kit' }>,
  ) => {
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

      const { error } = await supabase.from('event_equipment').insert(itemsToInsert);

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
    permissions: any,
  ) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const { error } = await supabase.from('employee_assignments').insert([
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
      await logChange(
        'employee_added',
        `Dodano pracownika do zespołu (ID: ${employeeId}, rola: ${role})`,
      );
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  const handleRemoveEquipment = async (equipmentId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten sprzęt z eventu?')) return;

    try {
      const { error } = await supabase.from('event_equipment').delete().eq('id', equipmentId);

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

  console.log('event', event);
  console.log('event.created_by', event?.created_by);

  const handleRemoveEmployee = async (employeeId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tego pracownika z eventu?')) return;

    try {
      const { error } = await supabase.from('employee_assignments').delete().eq('id', employeeId);

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
      <div className="flex h-screen items-center justify-center">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex h-screen flex-col items-center justify-center space-y-4">
        <div className="text-lg font-medium text-red-400">
          {error || 'Event nie został znaleziony'}
        </div>
        {error && (
          <div className="max-w-md text-center text-sm text-[#e5e4e2]/60">
            Sprawdź konsolę przeglądarki (F12) aby zobaczyć więcej szczegółów
          </div>
        )}
        <button
          onClick={() => router.back()}
          className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
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
            className="rounded-lg p-2 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="mb-2 flex items-center gap-3">
              <h1 className="text-2xl font-light text-[#e5e4e2]">{event.name}</h1>
              {!isEditingCategory && event.category && (
                <button
                  onClick={() => setIsEditingCategory(true)}
                  className="flex items-center gap-2 rounded-lg border px-3 py-1 transition-opacity hover:opacity-80"
                  style={{
                    backgroundColor: `${event.category.color}20`,
                    borderColor: `${event.category.color}50`,
                    color: event.category.color,
                  }}
                >
                  {event.category.icon ? (
                    <div
                      className="h-4 w-4"
                      style={{ color: event.category.color }}
                      dangerouslySetInnerHTML={{ __html: event.category.icon.svg_code }}
                    />
                  ) : (
                    <Tag className="h-4 w-4" />
                  )}
                  <span className="text-sm font-medium">{event.category.name}</span>
                </button>
              )}
              {!isEditingCategory && !event.category && (
                <button
                  onClick={() => setIsEditingCategory(true)}
                  className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-3 py-1 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
                >
                  <Tag className="h-4 w-4" />
                  <span className="text-sm font-medium">Dodaj kategorię</span>
                </button>
              )}
              {isEditingCategory && (
                <div className="flex items-center gap-2">
                  <select
                    value={event.category_id || ''}
                    onChange={(e) => handleUpdateCategory(e.target.value)}
                    className="rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-1 text-sm text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50"
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
                    className="p-1 text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
              {event.client_type === 'business' && event.organization && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  {event.organization.alias || event.organization.name}
                </div>
              )}
              {event.client_type === 'individual' && event.contact_person && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span>
                    Klient:{' '}
                    {event.contact_person.full_name ||
                      `${event.contact_person.first_name} ${event.contact_person.last_name}`}
                  </span>
                </div>
              )}
              {event.client_type === 'business' && event.contact_person && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span>
                    Kontakt:{' '}
                    {event.contact_person.full_name ||
                      `${event.contact_person.first_name} ${event.contact_person.last_name}`}
                  </span>
                </div>
              )}
              {event.creator && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span>
                    Autor: {event.creator.name} {event.creator.surname}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <EventStatusEditor
            eventId={event.id}
            currentStatus={event.status}
            onStatusChange={(newStatus) => {
              setEvent((prev) => (prev ? { ...prev, status: newStatus } : null));
            }}
          />
          <button
            onClick={() => setShowEditEventModal(true)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Edit className="h-4 w-4" />
            Edytuj
          </button>
          {isAdmin && (
            <button
              onClick={handleDeleteEvent}
              className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
            >
              <Trash2 className="h-4 w-4" />
              Usuń
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto border-b border-[#d3bb73]/10">
        {[
          { id: 'overview', label: 'Przegląd', icon: FileText },
          { id: 'offer', label: 'Oferta', icon: DollarSign },
          { id: 'finances', label: 'Finanse', icon: DollarSign },
          { id: 'contract', label: 'Umowa', icon: FileText },
          { id: 'agenda', label: 'Agenda', icon: ClipboardList },
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

            // Zakładka "Podwykonawcy" pokazuje się tylko gdy jest wskazane zapotrzebowanie
            if (tab.id === 'subcontractors' && !hasSubcontractors) {
              return false;
            }

            // Admin widzi wszystko
            if (isUserAdmin) {
              return true;
            }

            // Autor eventu widzi wszystko
            const isAuthor = event?.created_by === currentUserId;
            if (isAuthor) {
              return true;
            }

            // Dla pozostałych użytkowników sprawdź uprawnienia z access_level
            return allowedEventTabs.includes(tab.id);
          })
          .map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-[#d3bb73] text-[#d3bb73]'
                    : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Banner z zaproszeniem dla użytkowników z ograniczonym dostępem */}
            {hasLimitedAccess && userAssignmentStatus === 'pending' && (
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-6">
                <div className="flex items-start gap-4">
                  <AlertCircle className="mt-0.5 h-6 w-6 flex-shrink-0 text-blue-400" />
                  <div className="flex-1">
                    <h3 className="mb-2 text-lg font-medium text-blue-400">
                      Zaproszenie do zespołu wydarzenia
                    </h3>
                    <p className="mb-4 text-[#e5e4e2]/80">
                      Zostałeś zaproszony do udziału w tym wydarzeniu. Po akceptacji zaproszenia
                      uzyskasz dostęp do pełnych szczegółów wydarzenia, w tym sprzętu, zadań i
                      plików.
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={async () => {
                          const {
                            data: { session },
                          } = await supabase.auth.getSession();
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
                              .update({
                                status: 'accepted',
                                responded_at: new Date().toISOString(),
                              })
                              .eq('id', assignment.id);

                            await fetchEventDetails();
                          }
                        }}
                        className="rounded-lg border border-green-500/30 bg-green-500/20 px-4 py-2 text-green-400 transition-colors hover:bg-green-500/30"
                      >
                        Akceptuj zaproszenie
                      </button>
                      <button
                        onClick={async () => {
                          const {
                            data: { session },
                          } = await supabase.auth.getSession();
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
                              .update({
                                status: 'rejected',
                                responded_at: new Date().toISOString(),
                              })
                              .eq('id', assignment.id);

                            router.push('/crm/events');
                          }
                        }}
                        className="rounded-lg border border-red-500/30 bg-red-500/20 px-4 py-2 text-red-400 transition-colors hover:bg-red-500/30"
                      >
                        Odrzuć zaproszenie
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <EventsDetailsTab
              event={event}
              hasLimitedAccess={hasLimitedAccess}
              canManageTeam={canManageTeam}
              isUserAdmin={isUserAdmin}
              setEvent={setEvent}
              setHasSubcontractors={setHasSubcontractors}
              fetchEventDetails={fetchEventDetails}
            />


          </div>

          <div className="space-y-6">
            {(isUserAdmin || hasScope('finances_manage') || hasScope('finances_view')) && (
              <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
                <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Budżet</h2>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Przychód planowany</p>
                    <p className="text-2xl font-light text-[#d3bb73]">
                      {event.expected_revenue
                        ? event.expected_revenue.toLocaleString('pl-PL')
                        : '0'}{' '}
                      zł
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Przychód faktyczny</p>
                    <p className="text-2xl font-light text-[#e5e4e2]">
                      {event.actual_revenue ? event.actual_revenue.toLocaleString('pl-PL') : '0'} zł
                    </p>
                  </div>
                  {event.expected_revenue && event.expected_revenue > 0 && event.actual_revenue && (
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Marża realizacji</p>
                      <p className="text-xl font-light text-[#e5e4e2]">
                        {((event.actual_revenue / event.expected_revenue) * 100).toFixed(1)}%
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Szybkie statystyki</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#e5e4e2]/60">Sprzęt</span>
                  <span className="font-medium text-[#e5e4e2]">{equipment.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#e5e4e2]/60">Zespół</span>
                  <span className="font-medium text-[#e5e4e2]">{employees.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#e5e4e2]/60">Pliki</span>
                  <span className="font-medium text-[#e5e4e2]">
                    {event.attachments?.length || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#e5e4e2]/60">Checklisty</span>
                  <span className="font-medium text-[#e5e4e2]">{checklists.length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'equipment' && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-light text-[#e5e4e2]">Sprzęt</h2>
            <button
              onClick={() => {
                fetchAvailableEquipment();
                setShowAddEquipmentModal(true);
              }}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              <Plus className="h-4 w-4" />
              Dodaj sprzęt
            </button>
          </div>

          {equipment.length === 0 ? (
            <div className="py-12 text-center">
              <Package className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
              <p className="text-[#e5e4e2]/60">Brak przypisanego sprzętu</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Ręcznie dodany sprzęt */}
              {equipment.filter((item) => !item.auto_added).length > 0 && (
                <div className="space-y-2">
                  {equipment
                    .filter((item) => !item.auto_added)
                    .map((item) => {
                      const isExpanded = expandedKits.has(item.id);
                      const isKit = !!item.kit;

                      return (
                        <div key={item.id}>
                          <div className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2.5 transition-colors hover:border-[#d3bb73]/20">
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
                                className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
                              >
                                <ChevronDown
                                  className={`h-4 w-4 transition-transform ${
                                    isExpanded ? 'rotate-180' : ''
                                  }`}
                                />
                              </button>
                            )}

                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              {isKit ? (
                                <span className="text-base">🎁</span>
                              ) : item.equipment?.thumbnail_url ? (
                                <img
                                  src={item.equipment.thumbnail_url}
                                  alt={item.equipment.name}
                                  className="h-10 w-10 rounded border border-[#d3bb73]/20 object-cover"
                                />
                              ) : (
                                <div className="flex h-10 w-10 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
                                  <Package className="h-5 w-5 text-[#e5e4e2]/30" />
                                </div>
                              )}
                              <div className="flex min-w-0 flex-col">
                                <span className="truncate font-medium text-[#e5e4e2]">
                                  {item.kit ? item.kit.name : item.equipment?.name || 'Nieznany'}
                                </span>
                                {!isKit && item.equipment && (
                                  <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                                    {item.equipment.brand && <span>{item.equipment.brand}</span>}
                                    {item.equipment.model && (
                                      <>
                                        {item.equipment.brand && <span>•</span>}
                                        <span>{item.equipment.model}</span>
                                      </>
                                    )}
                                    {item.equipment.cable_specs && (
                                      <>
                                        {(item.equipment.brand || item.equipment.model) && (
                                          <span>•</span>
                                        )}
                                        {item.equipment.cable_specs.connector_in &&
                                        item.equipment.cable_specs.connector_out ? (
                                          <span>
                                            {item.equipment.cable_specs.connector_in} →{' '}
                                            {item.equipment.cable_specs.connector_out}
                                          </span>
                                        ) : (
                                          item.equipment.cable_specs.type && (
                                            <span>{item.equipment.cable_specs.type}</span>
                                          )
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
                                <span className="hidden md:inline">
                                  {item.equipment.category.name}
                                </span>
                              )}
                              {!isKit &&
                                item.equipment_id &&
                                equipmentAvailability[item.equipment_id] && (
                                  <div className="hidden flex-col items-end text-xs lg:flex">
                                    <span className="text-[#d3bb73]">
                                      {equipmentAvailability[item.equipment_id].available +
                                        equipmentAvailability[item.equipment_id].reserved}{' '}
                                      dostępne
                                    </span>
                                  </div>
                                )}
                              {editingQuantity === item.id ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    min="1"
                                    defaultValue={item.quantity}
                                    className="w-16 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2]"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        const newQuantity = parseInt(
                                          (e.target as HTMLInputElement).value,
                                        );
                                        if (newQuantity > 0) {
                                          handleUpdateQuantity(
                                            item.id,
                                            item.equipment_id,
                                            newQuantity,
                                          );
                                        }
                                      } else if (e.key === 'Escape') {
                                        setEditingQuantity(null);
                                      }
                                    }}
                                    onBlur={(e) => {
                                      const newQuantity = parseInt(e.target.value);
                                      if (newQuantity > 0 && newQuantity !== item.quantity) {
                                        handleUpdateQuantity(
                                          item.id,
                                          item.equipment_id,
                                          newQuantity,
                                        );
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
                                  className={`font-medium text-[#e5e4e2] ${!isKit ? 'cursor-pointer hover:text-[#d3bb73]' : ''}`}
                                  disabled={isKit}
                                >
                                  {item.quantity} szt.
                                </button>
                              )}
                            </div>

                            <button
                              onClick={() => handleRemoveEquipment(item.id)}
                              className="text-red-400/60 transition-colors hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>

                          {isKit && isExpanded && item.kit?.items && (
                            <div className="ml-9 mt-1 space-y-1">
                              {item.kit.items.map((kitItem: any, idx: number) => (
                                <div
                                  key={idx}
                                  className="flex items-center gap-3 rounded border border-[#d3bb73]/5 bg-[#0f1119]/50 px-4 py-2 text-sm"
                                >
                                  {kitItem.equipment.thumbnail_url ? (
                                    <img
                                      src={kitItem.equipment.thumbnail_url}
                                      alt={kitItem.equipment.name}
                                      className="h-8 w-8 rounded border border-[#d3bb73]/10 object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-8 w-8 items-center justify-center rounded border border-[#d3bb73]/10 bg-[#1c1f33]">
                                      <Package className="h-4 w-4 text-[#e5e4e2]/30" />
                                    </div>
                                  )}
                                  <div className="flex min-w-0 flex-1 flex-col">
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
                                          {(kitItem.equipment.brand || kitItem.equipment.model) && (
                                            <span>•</span>
                                          )}
                                          {kitItem.equipment.cable_specs.connector_in &&
                                          kitItem.equipment.cable_specs.connector_out ? (
                                            <span>
                                              {kitItem.equipment.cable_specs.connector_in} →{' '}
                                              {kitItem.equipment.cable_specs.connector_out}
                                            </span>
                                          ) : (
                                            kitItem.equipment.cable_specs.type && (
                                              <span>{kitItem.equipment.cable_specs.type}</span>
                                            )
                                          )}
                                          {kitItem.equipment.cable_specs.length_meters && (
                                            <span>
                                              {kitItem.equipment.cable_specs.length_meters}m
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  <span className="hidden text-xs text-[#e5e4e2]/50 md:inline">
                                    {kitItem.equipment.category?.name}
                                  </span>
                                  <span className="font-medium text-[#e5e4e2]/60">
                                    {kitItem.quantity * item.quantity} szt.
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Separator między ręcznie dodanym a automatycznym */}
              {equipment.filter((item) => !item.auto_added).length > 0 &&
                equipment.filter((item) => item.auto_added).length > 0 && (
                  <div className="my-6 flex items-center gap-4">
                    <div className="h-px flex-1 bg-[#d3bb73]/10"></div>
                    <span className="text-xs uppercase tracking-wider text-[#e5e4e2]/40">
                      Z produktów oferty
                    </span>
                    <div className="h-px flex-1 bg-[#d3bb73]/10"></div>
                  </div>
                )}

              {/* Automatycznie dodany sprzęt z oferty */}
              {equipment.filter((item) => item.auto_added).length > 0 && (
                <div className="space-y-2">
                  {equipment
                    .filter((item) => item.auto_added)
                    .map((item) => {
                      const isExpanded = expandedKits.has(item.id);
                      const isKit = !!item.kit;

                      return (
                        <div key={item.id}>
                          <div className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2.5 transition-colors hover:border-[#d3bb73]/20">
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
                                className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
                              >
                                <ChevronDown
                                  className={`h-4 w-4 transition-transform ${
                                    isExpanded ? 'rotate-180' : ''
                                  }`}
                                />
                              </button>
                            )}

                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              {isKit ? (
                                <span className="text-base">🎁</span>
                              ) : item.equipment?.thumbnail_url ? (
                                <img
                                  src={item.equipment.thumbnail_url}
                                  alt={item.equipment.name}
                                  className="h-10 w-10 rounded border border-[#d3bb73]/20 object-cover"
                                />
                              ) : (
                                <div className="flex h-10 w-10 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
                                  <Package className="h-5 w-5 text-[#e5e4e2]/30" />
                                </div>
                              )}
                              <div className="flex min-w-0 flex-col">
                                <span className="truncate font-medium text-[#e5e4e2]">
                                  {item.kit ? item.kit.name : item.equipment?.name || 'Nieznany'}
                                </span>
                                {!isKit && item.equipment && (
                                  <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                                    {item.equipment.brand && <span>{item.equipment.brand}</span>}
                                    {item.equipment.model && (
                                      <>
                                        {item.equipment.brand && <span>•</span>}
                                        <span>{item.equipment.model}</span>
                                      </>
                                    )}
                                    {item.equipment.cable_specs && (
                                      <>
                                        {(item.equipment.brand || item.equipment.model) && (
                                          <span>•</span>
                                        )}
                                        {item.equipment.cable_specs.connector_in &&
                                        item.equipment.cable_specs.connector_out ? (
                                          <span>
                                            {item.equipment.cable_specs.connector_in} →{' '}
                                            {item.equipment.cable_specs.connector_out}
                                          </span>
                                        ) : (
                                          item.equipment.cable_specs.type && (
                                            <span>{item.equipment.cable_specs.type}</span>
                                          )
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
                                <span className="hidden md:inline">
                                  {item.equipment.category.name}
                                </span>
                              )}
                              {!isKit &&
                                item.equipment_id &&
                                equipmentAvailability[item.equipment_id] && (
                                  <div className="hidden flex-col items-end text-xs lg:flex">
                                    <span className="text-[#d3bb73]">
                                      {equipmentAvailability[item.equipment_id].available +
                                        equipmentAvailability[item.equipment_id].reserved}{' '}
                                      dostępne
                                    </span>
                                  </div>
                                )}
                              {editingQuantity === item.id ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    min="1"
                                    defaultValue={item.quantity}
                                    className="w-16 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2]"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        const newQuantity = parseInt(
                                          (e.target as HTMLInputElement).value,
                                        );
                                        if (newQuantity > 0) {
                                          handleUpdateQuantity(
                                            item.id,
                                            item.equipment_id,
                                            newQuantity,
                                          );
                                        }
                                      } else if (e.key === 'Escape') {
                                        setEditingQuantity(null);
                                      }
                                    }}
                                    onBlur={(e) => {
                                      const newQuantity = parseInt(e.target.value);
                                      if (newQuantity > 0 && newQuantity !== item.quantity) {
                                        handleUpdateQuantity(
                                          item.id,
                                          item.equipment_id,
                                          newQuantity,
                                        );
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
                                  className={`font-medium text-[#e5e4e2] ${!isKit ? 'cursor-pointer hover:text-[#d3bb73]' : ''}`}
                                  disabled={isKit}
                                >
                                  {item.quantity} szt.
                                </button>
                              )}
                            </div>

                            <button
                              onClick={() => handleRemoveEquipment(item.id)}
                              className="text-red-400/60 transition-colors hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>

                          {isKit && isExpanded && item.kit?.items && (
                            <div className="ml-9 mt-1 space-y-1">
                              {item.kit.items.map((kitItem: any, idx: number) => (
                                <div
                                  key={idx}
                                  className="flex items-center gap-3 rounded border border-[#d3bb73]/5 bg-[#0f1119]/50 px-4 py-2 text-sm"
                                >
                                  {kitItem.equipment.thumbnail_url ? (
                                    <img
                                      src={kitItem.equipment.thumbnail_url}
                                      alt={kitItem.equipment.name}
                                      className="h-8 w-8 rounded border border-[#d3bb73]/10 object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-8 w-8 items-center justify-center rounded border border-[#d3bb73]/10 bg-[#1c1f33]">
                                      <Package className="h-4 w-4 text-[#e5e4e2]/30" />
                                    </div>
                                  )}
                                  <div className="flex min-w-0 flex-1 flex-col">
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
                                          {(kitItem.equipment.brand || kitItem.equipment.model) && (
                                            <span>•</span>
                                          )}
                                          {kitItem.equipment.cable_specs.connector_in &&
                                          kitItem.equipment.cable_specs.connector_out ? (
                                            <span>
                                              {kitItem.equipment.cable_specs.connector_in} →{' '}
                                              {kitItem.equipment.cable_specs.connector_out}
                                            </span>
                                          ) : (
                                            kitItem.equipment.cable_specs.type && (
                                              <span>{kitItem.equipment.cable_specs.type}</span>
                                            )
                                          )}
                                          {kitItem.equipment.cable_specs.length_meters && (
                                            <span>
                                              {kitItem.equipment.cable_specs.length_meters}m
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  <span className="hidden text-xs text-[#e5e4e2]/50 md:inline">
                                    {kitItem.equipment.category?.name}
                                  </span>
                                  <span className="font-medium text-[#e5e4e2]/60">
                                    {kitItem.quantity * item.quantity} szt.
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'team' && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-light text-[#e5e4e2]">Zespół</h2>
            {canManageTeam && (
              <button
                onClick={() => {
                  fetchAvailableEmployees();
                  setShowAddEmployeeModal(true);
                }}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                <Plus className="h-4 w-4" />
                Dodaj osobę
              </button>
            )}
          </div>

          {employees.length === 0 ? (
            <div className="py-12 text-center">
              <Users className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
              <p className="text-[#e5e4e2]/60">Brak przypisanych pracowników</p>
            </div>
          ) : (
            <TeamMembersList employees={employees} onRemove={handleRemoveEmployee} />
          )}
        </div>
      )}

      {activeTab === 'offer' && (
        <EventTabOffer offers={offers} setShowCreateOfferModal={setShowCreateOfferModal} />
      )}

      {activeTab === 'files' && <EventFilesExplorer eventId={eventId} />}

      {activeTab === 'logistics' && event && (
        <EventLogisticsPanel
          eventId={event.id}
          eventLocation={event.location}
          eventDate={event.event_date}
          canManage={canManageTeam}
        />
      )}

      {activeTab === 'subcontractors' && <EventSubcontractorsPanel eventId={eventId} />}

      {activeTab === 'tasks' && event && (
        <EventTasksBoard eventId={event.id} canManage={canManageTeam} />
      )}

      {activeTab === 'finances' && <EventFinancesTab eventId={eventId} />}

      {activeTab === 'contract' && <EventContractTab eventId={eventId} />}

      {activeTab === 'agenda' && (
        <EventAgendaTab
          contactName={event?.contact_person?.full_name ?? ''}
          contactNumber={event?.contact_person?.phone ?? ''}
          eventId={eventId}
          eventName={event?.name ?? ''}
          eventDate={event?.event_date ?? ''}
          startTime={event?.event_date ?? ''}
          endTime={event?.event_end_date ?? ''}
          clientContact={(event?.organization?.alias || event?.organization?.name) ?? ''}
          createdById={event?.created_by ?? ''}
        />
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
            <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-8 text-center">
              <History className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/20" />
              <p className="text-[#e5e4e2]/60">Brak historii zmian</p>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute bottom-4 left-[27px] top-4 w-0.5 bg-gradient-to-b from-[#d3bb73]/20 via-[#d3bb73]/10 to-transparent"></div>

              <div className="space-y-6">
                {auditLog.map((log, index) => {
                  const employee = log.employee;
                  const displayName = employee
                    ? employee.nickname || `${employee.name} ${employee.surname}`
                    : 'System';

                  return (
                    <div key={log.id} className="relative pl-16">
                      <div className="absolute left-0 top-0">
                        <div className="group relative">
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
                                className="cursor-pointer ring-4 ring-[#0f1119] transition-all hover:ring-[#d3bb73]/30"
                              />
                              <div
                                className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-[#0f1119] ${
                                  log.action === 'create'
                                    ? 'bg-green-500/90'
                                    : log.action === 'update'
                                      ? 'bg-blue-500/90'
                                      : 'bg-red-500/90'
                                }`}
                              >
                                {log.action === 'create' && <Plus className="h-3 w-3 text-white" />}
                                {log.action === 'update' && (
                                  <EditIcon className="h-3 w-3 text-white" />
                                )}
                                {log.action === 'delete' && (
                                  <Trash2 className="h-3 w-3 text-white" />
                                )}
                              </div>

                              {hoveredEmployee === log.id && (
                                <div className="animate-in fade-in slide-in-from-left-2 absolute left-full top-0 z-50 ml-4 min-w-[280px] rounded-xl border border-[#d3bb73]/30 bg-[#1c1f33] p-4 shadow-xl">
                                  <div className="flex items-start gap-3">
                                    <EmployeeAvatar employee={employee} size={48} />
                                    <div>
                                      <p className="font-medium text-[#e5e4e2]">{displayName}</p>
                                      {employee.occupation && (
                                        <p className="text-sm text-[#e5e4e2]/60">
                                          {employee.occupation}
                                        </p>
                                      )}
                                      {employee.email && (
                                        <div className="mt-2 flex items-center gap-1 text-xs text-[#e5e4e2]/50">
                                          <Mail className="h-3 w-3" />
                                          <span>{employee.email}</span>
                                        </div>
                                      )}
                                      <div className="mt-3 border-t border-[#d3bb73]/10 pt-3">
                                        <p className="text-xs text-[#d3bb73]">
                                          Kliknij aby przejść do profilu
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </button>
                          ) : (
                            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#d3bb73]/20 to-[#d3bb73]/5 ring-4 ring-[#0f1119]">
                              <User className="h-6 w-6 text-[#d3bb73]/60" />
                              <div
                                className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-[#0f1119] ${
                                  log.action === 'create'
                                    ? 'bg-green-500/90'
                                    : log.action === 'update'
                                      ? 'bg-blue-500/90'
                                      : 'bg-red-500/90'
                                }`}
                              >
                                {log.action === 'create' && <Plus className="h-3 w-3 text-white" />}
                                {log.action === 'update' && (
                                  <EditIcon className="h-3 w-3 text-white" />
                                )}
                                {log.action === 'delete' && (
                                  <Trash2 className="h-3 w-3 text-white" />
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-4 transition-all hover:border-[#d3bb73]/40 hover:shadow-lg">
                        <div className="mb-2 flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <p className="font-medium text-[#e5e4e2]">
                              <span className="text-[#d3bb73]">{displayName}</span>{' '}
                              {log.action === 'create' && 'utworzył'}
                              {log.action === 'update' && 'zaktualizował'}
                              {log.action === 'delete' && 'usunął'}{' '}
                              <span className="text-[#e5e4e2]/80">
                                {log.entity_type === 'events' && 'wydarzenie'}
                                {log.entity_type === 'event_equipment' && 'sprzęt wydarzenia'}
                                {log.entity_type === 'employee_assignments' &&
                                  'przypisanie pracownika'}
                                {log.entity_type === 'event_vehicles' && 'pojazd wydarzenia'}
                                {log.entity_type === 'tasks' && 'zadanie'}
                                {log.entity_type === 'offers' && 'ofertę'}
                                {log.entity_type === 'contracts' && 'umowę'}
                                {log.entity_type === 'event_files' && 'plik'}
                                {log.entity_type === 'event_subcontractors' && 'podwykonawcę'}
                                {![
                                  'events',
                                  'event_equipment',
                                  'employee_assignments',
                                  'event_vehicles',
                                  'tasks',
                                  'offers',
                                  'contracts',
                                  'event_files',
                                  'event_subcontractors',
                                ].includes(log.entity_type) && log.entity_type}
                              </span>
                            </p>
                            {log.description && (
                              <p className="mt-1 text-sm text-[#e5e4e2]/70">{log.description}</p>
                            )}
                            {log.field_name && (
                              <p className="mt-1 text-sm text-[#e5e4e2]/60">
                                Pole: <span className="text-[#d3bb73]/80">{log.field_name}</span>
                              </p>
                            )}
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <div className="flex items-center gap-1.5 text-xs text-[#e5e4e2]/40">
                              <Clock className="h-3 w-3" />
                              <span>
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

                        {log.action === 'update' && (log.old_value || log.new_value) && (
                          <div className="mt-3 space-y-2 border-t border-[#d3bb73]/10 pt-3">
                            {(() => {
                              const oldVal = log.old_value || {};
                              const newVal = log.new_value || {};
                              const changedFields = Object.keys(newVal).filter(
                                (key) =>
                                  JSON.stringify(oldVal[key]) !== JSON.stringify(newVal[key]),
                              );

                              if (changedFields.length === 0) return null;

                              return changedFields.map((field) => {
                                if (['id', 'created_at', 'updated_at'].includes(field)) return null;

                                const fieldLabels: Record<string, string> = {
                                  name: 'Nazwa',
                                  description: 'Opis',
                                  status: 'Status',
                                  budget: 'Budżet',
                                  event_date: 'Data wydarzenia',
                                  location: 'Lokalizacja',
                                  quantity: 'Ilość',
                                  notes: 'Notatki',
                                  organization_id: 'Organizacja',
                                  contact_person_id: 'Osoba kontaktowa',
                                  category_id: 'Kategoria',
                                  expected_revenue: 'Przewidywany przychód',
                                  estimated_costs: 'Szacowane koszty',
                                };

                                const formatValue = (val: any) => {
                                  if (val === null || val === undefined) return 'brak';
                                  if (typeof val === 'boolean') return val ? 'tak' : 'nie';
                                  if (typeof val === 'number') return val.toLocaleString('pl-PL');
                                  if (typeof val === 'string' && val.length > 100)
                                    return val.substring(0, 100) + '...';
                                  return String(val);
                                };

                                return (
                                  <div key={field} className="text-sm">
                                    <span className="text-[#e5e4e2]/60">
                                      {fieldLabels[field] || field}:
                                    </span>
                                    <div className="mt-1 flex items-center gap-2">
                                      <span className="rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">
                                        {formatValue(oldVal[field])}
                                      </span>
                                      <ArrowRight className="h-3 w-3 text-[#e5e4e2]/40" />
                                      <span className="rounded bg-green-500/10 px-2 py-1 text-xs text-green-400">
                                        {formatValue(newVal[field])}
                                      </span>
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        )}

                        {log.metadata?.table && (
                          <div className="mt-3 border-t border-[#d3bb73]/10 pt-3">
                            <div className="flex items-center gap-2">
                              <Tag className="h-3 w-3 text-[#e5e4e2]/40" />
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
        <EditEventModalNew
          isOpen={showEditEventModal}
          onClose={() => setShowEditEventModal(false)}
          event={event}
          onSave={async (updatedData) => {
            try {
              console.log('Updating event with data:', updatedData);
              const { error } = await supabase.from('events').update(updatedData).eq('id', eventId);

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
        <OfferWizard
          isOpen={showCreateOfferModal}
          onClose={() => setShowCreateOfferModal(false)}
          eventId={eventId}
          organizationId={event.organization_id}
          contactId={event.contact_person_id}
          clientType={event.client_type}
          onSuccess={() => {
            setShowCreateOfferModal(false);
            fetchOffers();
            setActiveTab('offer');
            fetchEventDetails(); // Odśwież dane eventu aby zaktualizować budżet
          }}
        />
      )}
    </div>
  );
}