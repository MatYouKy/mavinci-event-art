'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  MapPin,
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
  Save,
  X,
  User,
  Tag,
  ChevronDown,
  ChevronUp,
  Mail,
  Phone,
  Briefcase,
  Edit as EditIcon,
  AlertCircle,
  History,
  UserCheck,
  Truck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

// Helper function to convert UTC date to local datetime-local format
const toLocalDatetimeString = (utcDate: string | null): string => {
  if (!utcDate) return '';
  const date = new Date(utcDate);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
};
import EventTasksBoard from '@/components/crm/EventTasksBoard';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import EventFilesExplorer from '@/components/crm/EventFilesExplorer';
import EventSubcontractorsPanel from '@/components/crm/EventSubcontractorsPanel';
import EventLogisticsPanel from '@/components/crm/EventLogisticsPanel';
import OfferWizard from '@/components/crm/OfferWizard';
import EventFinancesTab from '@/components/crm/EventFinancesTab';
import EventStatusEditor from '@/components/crm/EventStatusEditor';
import { EventContractTab } from '@/components/crm/EventContractTab';
import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import LocationSelector from '@/components/crm/LocationSelector';
import EditEventClientModal from '@/components/crm/EditEventClientModal';
import ClientSelectorTabs from '@/components/crm/ClientSelectorTabs';
import EditEventModalNew from '@/components/crm/EditEventModalNew';
import EventTabOffer from './components/EventTabOffer';

interface Event {
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

  const [event, setEvent] = useState<Event | null>(null);
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
    | 'history'
  >('overview');

  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [editedDescription, setEditedDescription] = useState('');
  const [editedNotes, setEditedNotes] = useState('');
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
  const [showEditClientModal, setShowEditClientModal] = useState(false);
  const [offers, setOffers] = useState<any[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<any>(null);
  const [showCreateOfferModal, setShowCreateOfferModal] = useState(false);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [currentUser] = useState({
    id: '00000000-0000-0000-0000-000000000000',
    name: 'Administrator',
  });
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

  const fetchAuditLog = async () => {
    try {
      const { data, error } = await supabase
        .from('event_audit_log')
        .select(
          `
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
        `,
        )
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
      await logChange(
        'updated',
        'Zaktualizowano opis eventu',
        'description',
        event.description,
        editedDescription,
      );
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
      await logChange(
        'updated',
        'Zaktualizowano notatki eventu',
        'notes',
        event.notes,
        editedNotes,
      );
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
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
              {event.client_type === 'business' && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  {event.organization
                    ? event.organization.alias || event.organization.name
                    : 'Brak klienta'}
                </div>
              )}
              {event.contact_person && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span>
                    {event.contact_person.contact_type === 'individual' ? 'Klient: ' : 'Kontakt: '}
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

            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje podstawowe</h2>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Calendar className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
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
                    <Clock className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
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
                  <MapPin className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                  <div className="flex-1">
                    <p className="text-sm text-[#e5e4e2]/60">Lokalizacja</p>
                    {event.location_details ? (
                      <div className="group relative inline-block">
                        <button
                          onClick={() =>
                            event.location_details?.id &&
                            router.push(`/crm/locations/${event.location_details.id}`)
                          }
                          className="text-left text-[#e5e4e2] transition-colors hover:text-[#d3bb73]"
                        >
                          {event.location_details.name}
                        </button>
                        <div className="invisible absolute left-0 top-full z-50 mt-1 min-w-[300px] max-w-md rounded-xl border border-[#d3bb73]/30 bg-[#1c1f33] p-4 shadow-xl before:absolute before:-top-1 before:left-0 before:right-0 before:h-1 before:content-[''] group-hover:visible">
                          <p className="mb-2 text-sm font-medium text-[#e5e4e2]">
                            {event.location_details.name}
                          </p>
                          {event.location_details.formatted_address && (
                            <p className="mb-3 text-xs text-[#e5e4e2]/60">
                              {event.location_details.formatted_address}
                            </p>
                          )}
                          {event.location_details.google_maps_url && (
                            <a
                              href={event.location_details.google_maps_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-[#d3bb73] hover:underline"
                            >
                              Zobacz na mapie
                              <svg
                                className="h-3 w-3"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                />
                              </svg>
                            </a>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[#e5e4e2]">{event.location || 'Brak lokalizacji'}</p>
                    )}
                  </div>
                </div>

                {/* Zapotrzebowanie na podwykonawców */}
                {!hasLimitedAccess && (canManageTeam || isUserAdmin) && (
                  <div className="flex items-start gap-3">
                    <UserCheck className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                    <div className="flex-1">
                      <label className="group flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={event.requires_subcontractors}
                          onChange={async (e) => {
                            const newValue = e.target.checked;
                            try {
                              const { error } = await supabase
                                .from('events')
                                .update({ requires_subcontractors: newValue })
                                .eq('id', eventId);

                              if (error) throw error;

                              setEvent({ ...event, requires_subcontractors: newValue });
                              setHasSubcontractors(newValue);

                              await logChange(
                                'updated',
                                newValue
                                  ? 'Włączono zapotrzebowanie na podwykonawców'
                                  : 'Wyłączono zapotrzebowanie na podwykonawców',
                                'requires_subcontractors',
                                String(!newValue),
                                String(newValue),
                              );
                            } catch (err) {
                              console.error('Error updating requires_subcontractors:', err);
                              alert('Błąd podczas aktualizacji');
                            }
                          }}
                          className="h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-0"
                        />
                        <div>
                          <p className="text-sm text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
                            Wymaga podwykonawców
                          </p>
                          <p className="text-xs text-[#e5e4e2]/60">
                            Pokaż zakładkę "Podwykonawcy" w tym wydarzeniu
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {/* Ukryj klienta dla użytkowników z ograniczonym dostępem */}
                {!hasLimitedAccess && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-[#e5e4e2]">Informacje o kliencie</h3>
                      <button
                        onClick={() => setShowEditClientModal(true)}
                        className="flex items-center gap-1 text-xs text-[#d3bb73] hover:text-[#d3bb73]/80"
                      >
                        <EditIcon className="h-3 w-3" />
                        Edytuj
                      </button>
                    </div>
                    {event.client_type === 'business' && (
                      <div className="flex items-start gap-3">
                        <Building2 className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                        <div>
                          <p className="text-sm text-[#e5e4e2]/60">Klient</p>
                          <p className="text-[#e5e4e2]">
                            {event.organization
                              ? event.organization.alias || event.organization.name
                              : 'Brak klienta'}
                          </p>
                        </div>
                      </div>
                    )}
                    {event.contact_person && (
                      <div className="flex items-start gap-3">
                        <User className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                        <div>
                          <p className="text-sm text-[#e5e4e2]/60">
                            {event.contact_person.contact_type === 'individual'
                              ? 'Klient indywidualny'
                              : 'Osoba kontaktowa'}
                          </p>
                          <p className="text-[#e5e4e2]">
                            {event.contact_person.full_name ||
                              `${event.contact_person.first_name} ${event.contact_person.last_name}`}
                          </p>
                          {event.contact_person.email && (
                            <div className="mt-1 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                              <Mail className="h-3 w-3" />
                              <span>{event.contact_person.email}</span>
                            </div>
                          )}
                          {event.contact_person.phone && (
                            <div className="mt-1 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                              <Phone className="h-3 w-3" />
                              <span>{event.contact_person.phone}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-light text-[#e5e4e2]">Opis</h2>
                {!isEditingDescription && !hasLimitedAccess && (
                  <button
                    onClick={() => {
                      setEditedDescription(event.description || '');
                      setIsEditingDescription(true);
                    }}
                    className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                )}
              </div>
              {isEditingDescription ? (
                <div className="space-y-3">
                  <textarea
                    value={editedDescription}
                    onChange={(e) => setEditedDescription(e.target.value)}
                    className="min-h-[120px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="Dodaj opis eventu..."
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveDescription}
                      className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                    >
                      <Save className="h-4 w-4" />
                      Zapisz
                    </button>
                    <button
                      onClick={() => setIsEditingDescription(false)}
                      className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              ) : (
                <p className="leading-relaxed text-[#e5e4e2]/80">
                  {event.description || 'Brak opisu'}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-light text-[#e5e4e2]">Notatki</h2>
                {!isEditingNotes && (
                  <button
                    onClick={() => {
                      setEditedNotes(event.notes || '');
                      setIsEditingNotes(true);
                    }}
                    className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                )}
              </div>
              {isEditingNotes ? (
                <div className="space-y-3">
                  <textarea
                    value={editedNotes}
                    onChange={(e) => setEditedNotes(e.target.value)}
                    className="min-h-[120px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="Dodaj notatki..."
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveNotes}
                      className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                    >
                      <Save className="h-4 w-4" />
                      Zapisz
                    </button>
                    <button
                      onClick={() => setIsEditingNotes(false)}
                      className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              ) : (
                <p className="leading-relaxed text-[#e5e4e2]/80">{event.notes || 'Brak notatek'}</p>
              )}
            </div>
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
                          <div>
                            <p className="font-medium text-[#e5e4e2]">
                              <span className="text-[#d3bb73]">{displayName}</span>{' '}
                              {log.action === 'create' && 'utworzył'}
                              {log.action === 'update' && 'zaktualizował'}
                              {log.action === 'delete' && 'usunął'}{' '}
                              <span className="text-[#e5e4e2]/80">{log.entity_type}</span>
                            </p>
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

      {showEditClientModal && event && (
        <EditEventClientModal
          isOpen={showEditClientModal}
          onClose={() => setShowEditClientModal(false)}
          eventId={eventId}
          currentClientType={(event as any).client_type || 'business'}
          currentOrganizationId={event.organization_id}
          currentContactPersonId={event.contact_person_id}
          onSuccess={() => {
            setShowEditClientModal(false);
            fetchEventDetails();
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
  onAdd: (
    selectedItems: Array<{ id: string; quantity: number; notes: string; type: 'item' | 'kit' }>,
  ) => void;
  availableEquipment: any[];
  availableKits: any[];
}) {
  const [selectedItems, setSelectedItems] = useState<{
    [key: string]: { checked: boolean; quantity: number; notes: string; type: 'item' | 'kit' };
  }>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [showKits, setShowKits] = useState(true);
  const [showItems, setShowItems] = useState(true);

  if (!isOpen) return null;

  const handleToggle = (id: string, type: 'item' | 'kit') => {
    setSelectedItems((prev) => ({
      ...prev,
      [id]: {
        checked: !prev[id]?.checked,
        quantity: prev[id]?.quantity || 1,
        notes: prev[id]?.notes || '',
        type,
      },
    }));
  };

  const handleQuantityChange = (id: string, quantity: number, maxQuantity?: number) => {
    let finalQuantity = Math.max(1, quantity);
    if (maxQuantity !== undefined) {
      finalQuantity = Math.min(finalQuantity, maxQuantity);
    }

    setSelectedItems((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        quantity: finalQuantity,
      },
    }));
  };

  const handleNotesChange = (id: string, notes: string) => {
    setSelectedItems((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        notes,
      },
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
        const equipmentItem = availableEquipment.find((eq) => eq.id === item.id);
        if (equipmentItem && item.quantity > equipmentItem.total_quantity) {
          alert(
            `Nie można dodać ${item.quantity} jednostek sprzętu "${equipmentItem.name}". Dostępne są tylko ${equipmentItem.total_quantity} jednostek.`,
          );
          return;
        }
      }
    }

    onAdd(selected);
    setSelectedItems({});
    setSearchTerm('');
  };

  const filteredKits = availableKits.filter((kit) =>
    kit.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const filteredItems = availableEquipment.filter(
    (item) =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.category?.name?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const selectedCount = Object.values(selectedItems).filter((item) => item.checked).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj sprzęt</h2>
            {selectedCount > 0 && (
              <p className="mt-1 text-sm text-[#d3bb73]">Zaznaczono: {selectedCount}</p>
            )}
          </div>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Szukaj sprzętu lub zestawu..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          />
        </div>

        <div className="mb-4 flex gap-4">
          <button
            onClick={() => setShowKits(!showKits)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              showKits ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/60'
            }`}
          >
            Zestawy ({availableKits.length})
          </button>
          <button
            onClick={() => setShowItems(!showItems)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              showItems ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/60'
            }`}
          >
            Pojedynczy sprzęt ({availableEquipment.length})
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto pr-2">
          {showKits && filteredKits.length > 0 && (
            <div>
              <h3 className="sticky top-0 mb-3 bg-[#0f1119] py-2 text-sm font-medium text-[#e5e4e2]/80">
                🎁 Zestawy
              </h3>
              <div className="space-y-2">
                {filteredKits.map((kit) => (
                  <div
                    key={kit.id}
                    className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4"
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedItems[kit.id]?.checked || false}
                        onChange={() => handleToggle(kit.id, 'kit')}
                        className="mt-1 h-4 w-4 rounded border-[#d3bb73]/20 text-[#d3bb73] focus:ring-[#d3bb73]"
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-[#e5e4e2]">{kit.name}</div>
                          {kit.available_count !== undefined && (
                            <div className="text-right text-xs">
                              <div className="font-medium text-[#d3bb73]">
                                {kit.available_count > 0 ? 'Dostępny' : 'Niedostępny'}
                              </div>
                            </div>
                          )}
                        </div>
                        {kit.items && kit.items.length > 0 && (
                          <div className="mt-1 text-xs text-[#e5e4e2]/60">
                            Zawiera:{' '}
                            {kit.items
                              .map((item: any) => `${item.equipment.name} (${item.quantity})`)
                              .join(', ')}
                          </div>
                        )}
                      </div>
                    </label>
                    {selectedItems[kit.id]?.checked && (
                      <div className="ml-7 mt-3 space-y-3">
                        <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-3">
                          <label className="mb-2 block text-xs text-[#e5e4e2]/60">
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
                              className={`flex-1 rounded-lg border bg-[#1c1f33] px-4 py-2.5 text-base text-[#e5e4e2] focus:outline-none focus:ring-2 ${
                                kit.available_count &&
                                (selectedItems[kit.id]?.quantity || 1) > kit.available_count
                                  ? 'border-red-500 focus:ring-red-500/50'
                                  : 'border-[#d3bb73]/20 focus:ring-[#d3bb73]/50'
                              }`}
                            />
                            <div className="text-right">
                              <div
                                className={`text-sm font-medium ${
                                  kit.available_count &&
                                  (selectedItems[kit.id]?.quantity || 1) > kit.available_count
                                    ? 'text-red-500'
                                    : 'text-[#d3bb73]'
                                }`}
                              >
                                {selectedItems[kit.id]?.quantity || 1} / {kit.available_count || 1}
                              </div>
                              <div className="text-xs text-[#e5e4e2]/40">dostępne</div>
                            </div>
                          </div>
                          {kit.available_count &&
                            (selectedItems[kit.id]?.quantity || 1) > kit.available_count && (
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
                          className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
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
              <h3 className="sticky top-0 mb-3 bg-[#0f1119] py-2 text-sm font-medium text-[#e5e4e2]/80">
                📦 Pojedynczy sprzęt
              </h3>
              <div className="space-y-2">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4"
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedItems[item.id]?.checked || false}
                        onChange={() => handleToggle(item.id, 'item')}
                        className="mt-1 h-4 w-4 rounded border-[#d3bb73]/20 text-[#d3bb73] focus:ring-[#d3bb73]"
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-[#e5e4e2]">{item.name}</div>
                          {item.available_count !== undefined && (
                            <div className="text-right text-xs">
                              <div className="font-medium text-[#d3bb73]">
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
                        <div className="mt-1 text-xs text-[#e5e4e2]/60">
                          {item.category?.name || 'Brak kategorii'}
                        </div>
                      </div>
                    </label>
                    {selectedItems[item.id]?.checked && (
                      <div className="ml-7 mt-3 space-y-3">
                        <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-3">
                          <label className="mb-2 block text-xs text-[#e5e4e2]/60">
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
                                handleQuantityChange(
                                  item.id,
                                  val,
                                  item.total_quantity || item.available_count,
                                );
                              }}
                              placeholder="Ilość"
                              className={`flex-1 rounded-lg border bg-[#1c1f33] px-4 py-2.5 text-base text-[#e5e4e2] focus:outline-none focus:ring-2 ${
                                (selectedItems[item.id]?.quantity || 1) > item.total_quantity
                                  ? 'border-red-500 focus:ring-red-500/50'
                                  : item.available_count &&
                                      (selectedItems[item.id]?.quantity || 1) > item.available_count
                                    ? 'border-orange-500 focus:ring-orange-500/50'
                                    : 'border-[#d3bb73]/20 focus:ring-[#d3bb73]/50'
                              }`}
                            />
                            <div className="text-right">
                              <div
                                className={`text-sm font-medium ${
                                  (selectedItems[item.id]?.quantity || 1) > item.total_quantity
                                    ? 'text-red-500'
                                    : item.available_count &&
                                        (selectedItems[item.id]?.quantity || 1) >
                                          item.available_count
                                      ? 'text-orange-500'
                                      : 'text-[#d3bb73]'
                                }`}
                              >
                                {selectedItems[item.id]?.quantity || 1} /{' '}
                                {item.available_count || 0}
                              </div>
                              <div className="text-xs text-[#e5e4e2]/40">dostępne w terminie</div>
                              {item.total_quantity > 0 && (
                                <div className="mt-0.5 text-xs text-[#e5e4e2]/30">
                                  (Całkowita: {item.total_quantity})
                                </div>
                              )}
                            </div>
                          </div>
                          {(selectedItems[item.id]?.quantity || 1) > item.total_quantity && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-red-500">
                              <span>⚠️</span>
                              <span>
                                Przekroczono całkowitą ilość! Mamy tylko {item.total_quantity}{' '}
                                jednostek tego sprzętu.
                              </span>
                            </div>
                          )}
                          {(selectedItems[item.id]?.quantity || 1) <= item.total_quantity &&
                            item.available_count &&
                            (selectedItems[item.id]?.quantity || 1) > item.available_count && (
                              <div className="mt-2 flex items-center gap-2 text-xs text-orange-500">
                                <span>⚠️</span>
                                <span>
                                  W tym terminie dostępne są tylko {item.available_count} jednostek.{' '}
                                  {item.reserved_quantity} jest zarezerwowanych w innych
                                  wydarzeniach.
                                </span>
                              </div>
                            )}
                          {item.reserved_quantity > 0 && (
                            <div className="mt-2 text-xs text-[#e5e4e2]/40">
                              ℹ️ W tym terminie zarezerwowano już {item.reserved_quantity} jednostek
                              w innych wydarzeniach
                            </div>
                          )}
                        </div>
                        <input
                          type="text"
                          value={selectedItems[item.id]?.notes || ''}
                          onChange={(e) => handleNotesChange(item.id, e.target.value)}
                          placeholder="Notatki (opcjonalnie)"
                          className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredKits.length === 0 && filteredItems.length === 0 && (
            <div className="py-12 text-center text-[#e5e4e2]/60">Nie znaleziono sprzętu</div>
          )}
        </div>

        <div className="mt-4 flex gap-3 border-t border-[#d3bb73]/10 pt-4">
          <button
            onClick={handleSubmit}
            disabled={selectedCount === 0}
            className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Dodaj zaznaczone ({selectedCount})
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
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
  onAdd: (
    employeeId: string,
    role: string,
    responsibilities: string,
    accessLevelId: string,
    permissions: any,
  ) => void;
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
    const { data, error } = await supabase.from('access_levels').select('*').order('order_index');

    if (!error && data) {
      setAccessLevels(data);
      const defaultLevel = data.find((l) => l.slug === 'employee');
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

  const hasAnyPermission =
    canEditEvent ||
    canEditAgenda ||
    canEditTasks ||
    canEditFiles ||
    canEditEquipment ||
    canInviteMembers ||
    canViewBudget;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj osobę do zespołu</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Pracownik</label>
            <select
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
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
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Rola w evencie</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="np. Lead Audio, Technician..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Zakres odpowiedzialności</label>
            <textarea
              value={responsibilities}
              onChange={(e) => setResponsibilities(e.target.value)}
              className="min-h-[80px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Opisz zakres obowiązków..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Poziom dostępu</label>
            <select
              value={selectedAccessLevel}
              onChange={(e) => setSelectedAccessLevel(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            >
              {accessLevels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name} - {level.description}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[#e5e4e2]/40">
              Określa domyślny zakres widoczności dla tej osoby
            </p>
          </div>

          <div className="border-t border-[#d3bb73]/10 pt-4">
            <label className="mb-3 flex items-center gap-2 text-sm text-[#e5e4e2]/80">
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
                className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73] focus:ring-[#d3bb73]"
              />
              <span className="font-medium">Nadaj uprawnienia współpracownika</span>
            </label>

            {hasAnyPermission && (
              <div className="ml-6 space-y-2 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-3">
                <p className="mb-3 text-xs text-[#e5e4e2]/60">
                  Zaznacz uprawnienia które chcesz nadać:
                </p>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditEvent}
                    onChange={(e) => setCanEditEvent(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Edycja wydarzenia (nazwa, data, lokalizacja)
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditAgenda}
                    onChange={(e) => setCanEditAgenda(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Edycja agendy
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditTasks}
                    onChange={(e) => setCanEditTasks(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Zarządzanie zadaniami
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditFiles}
                    onChange={(e) => setCanEditFiles(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Zarządzanie plikami
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditEquipment}
                    onChange={(e) => setCanEditEquipment(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Zarządzanie sprzętem
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canInviteMembers}
                    onChange={(e) => setCanInviteMembers(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Zapraszanie członków zespołu
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canViewBudget}
                    onChange={(e) => setCanViewBudget(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Widok budżetu
                </label>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSubmit}
              className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Dodaj
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj zadanie</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Zadanie</label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className="min-h-[80px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Opisz zadanie do wykonania..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Priorytet</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            >
              <option value="low">Niski</option>
              <option value="medium">Średni</option>
              <option value="high">Wysoki</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSubmit}
              className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Dodaj
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
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
  const [removeModal, setRemoveModal] = useState<{
    isOpen: boolean;
    id: string;
    name: string;
  } | null>(null);
  const [permissionsModal, setPermissionsModal] = useState<{
    isOpen: boolean;
    assignment: any;
  } | null>(null);
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
          permissions_updated_at: new Date().toISOString(),
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
          responsibilities: editResponsibilities,
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
        return (
          <span className="rounded-full bg-green-500/20 px-2 py-1 text-xs text-green-400">
            Zaakceptowano
          </span>
        );
      case 'rejected':
        return (
          <span className="rounded-full bg-red-500/20 px-2 py-1 text-xs text-red-400">
            Odrzucono
          </span>
        );
      default:
        return (
          <span className="rounded-full bg-yellow-500/20 px-2 py-1 text-xs text-yellow-400">
            Oczekuje
          </span>
        );
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
              className={`overflow-hidden rounded-lg border bg-[#0f1119] ${
                item.status === 'rejected' ? 'border-red-500/30' : 'border-[#d3bb73]/10'
              }`}
            >
              <div
                onClick={() => !isEditing && toggleExpand(item.id)}
                className="flex cursor-pointer items-center gap-4 p-4 transition-colors hover:bg-[#d3bb73]/5"
              >
                <EmployeeAvatar
                  avatarUrl={item.employee.avatar_url}
                  avatarMetadata={item.employee.avatar_metadata}
                  employeeName={`${item.employee.name} ${item.employee.surname}`}
                  size={48}
                  className="flex-shrink-0"
                />

                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-[#e5e4e2]">
                    {item.employee.nickname || `${item.employee.name} ${item.employee.surname}`}
                  </h3>
                  {item.role && !isEditing && <p className="text-sm text-[#d3bb73]">{item.role}</p>}
                  <div className="mt-1 flex items-center gap-2">{getStatusBadge(item.status)}</div>
                </div>

                <div className="flex items-center gap-2">
                  {!isEditing && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(item);
                        }}
                        className="rounded p-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                      >
                        <EditIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRemoveModal({
                            isOpen: true,
                            id: item.id,
                            name:
                              item.employee.nickname ||
                              `${item.employee.name} ${item.employee.surname}`,
                          });
                        }}
                        className="rounded p-2 text-red-400 transition-colors hover:bg-red-400/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  {!isEditing &&
                    (isExpanded ? (
                      <ChevronUp className="h-5 w-5 text-[#e5e4e2]/60" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-[#e5e4e2]/60" />
                    ))}
                </div>
              </div>

              {isEditing && (
                <div className="space-y-3 border-t border-[#d3bb73]/10 p-4">
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Rola</label>
                    <input
                      type="text"
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      placeholder="np. Lead Audio, Technician..."
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                      Zakres odpowiedzialności
                    </label>
                    <textarea
                      value={editResponsibilities}
                      onChange={(e) => setEditResponsibilities(e.target.value)}
                      className="min-h-[80px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      placeholder="Opisz zakres obowiązków..."
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(item.id)}
                      className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
                    >
                      Zapisz
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              )}

              {isExpanded && !isEditing && (
                <div className="space-y-3 border-t border-[#d3bb73]/10 p-4">
                  {item.responsibilities && (
                    <div className="border-b border-[#d3bb73]/10 pb-3">
                      <div className="mb-1 text-xs text-[#e5e4e2]/60">
                        Zakres odpowiedzialności:
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-[#e5e4e2]/80">
                        {item.responsibilities}
                      </p>
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      onClick={() => openPermissionsModal(item)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
                    >
                      <User className="h-4 w-4" />
                      Zarządzaj uprawnieniami
                    </button>
                  </div>

                  {(item.can_edit_event ||
                    item.can_edit_agenda ||
                    item.can_edit_tasks ||
                    item.can_edit_files ||
                    item.can_edit_equipment ||
                    item.can_invite_members ||
                    item.can_view_budget) && (
                    <div className="border-t border-[#d3bb73]/10 pt-2">
                      <div className="mb-2 text-xs text-[#e5e4e2]/60">Nadane uprawnienia:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {item.can_edit_event && (
                          <span className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-xs text-blue-400">
                            Edycja wydarzenia
                          </span>
                        )}
                        {item.can_edit_agenda && (
                          <span className="rounded border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-xs text-purple-400">
                            Edycja agendy
                          </span>
                        )}
                        {item.can_edit_tasks && (
                          <span className="rounded border border-green-500/20 bg-green-500/10 px-2 py-1 text-xs text-green-400">
                            Zarządzanie zadaniami
                          </span>
                        )}
                        {item.can_edit_files && (
                          <span className="rounded border border-yellow-500/20 bg-yellow-500/10 px-2 py-1 text-xs text-yellow-400">
                            Zarządzanie plikami
                          </span>
                        )}
                        {item.can_edit_equipment && (
                          <span className="rounded border border-orange-500/20 bg-orange-500/10 px-2 py-1 text-xs text-orange-400">
                            Zarządzanie sprzętem
                          </span>
                        )}
                        {item.can_invite_members && (
                          <span className="rounded border border-pink-500/20 bg-pink-500/10 px-2 py-1 text-xs text-pink-400">
                            Zapraszanie członków
                          </span>
                        )}
                        {item.can_view_budget && (
                          <span className="rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-400">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <div className="mb-6 flex items-start gap-4">
              <div className="rounded-lg bg-red-500/10 p-3">
                <AlertCircle className="h-6 w-6 text-red-400" />
              </div>
              <div>
                <h2 className="mb-2 text-xl font-light text-[#e5e4e2]">Usuń z zespołu</h2>
                <p className="text-[#e5e4e2]/60">
                  Czy na pewno chcesz usunąć{' '}
                  <span className="text-[#d3bb73]">{removeModal.name}</span> z zespołu wydarzenia?
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  onRemove(removeModal.id);
                  setRemoveModal(null);
                }}
                className="flex-1 rounded-lg bg-red-500 px-4 py-2 font-medium text-white hover:bg-red-600"
              >
                Usuń
              </button>
              <button
                onClick={() => setRemoveModal(null)}
                className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

      {permissionsModal?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <div className="mb-6">
              <h2 className="mb-2 text-xl font-light text-[#e5e4e2]">Zarządzaj uprawnieniami</h2>
              <p className="text-sm text-[#e5e4e2]/60">
                {permissionsModal.assignment.employee?.nickname ||
                  `${permissionsModal.assignment.employee?.name} ${permissionsModal.assignment.employee?.surname}`}
              </p>
            </div>

            <div className="mb-6 space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_event}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_event: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Edycja wydarzenia</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może edytować podstawowe informacje o wydarzeniu
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_agenda}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_agenda: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Edycja agendy</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może edytować harmonogram i agendę
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_tasks}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_tasks: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Zarządzanie zadaniami</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może tworzyć, edytować i usuwać zadania
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_files}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_files: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Zarządzanie plikami</div>
                  <div className="text-xs text-[#e5e4e2]/60">Może dodawać i usuwać pliki</div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_equipment}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_equipment: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Zarządzanie sprzętem</div>
                  <div className="text-xs text-[#e5e4e2]/60">Może dodawać i usuwać sprzęt</div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_invite_members}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_invite_members: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Zapraszanie członków</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może zapraszać innych pracowników do zespołu
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_view_budget}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_view_budget: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Widok budżetu</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może przeglądać informacje finansowe
                  </div>
                </div>
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={savePermissions}
                className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
              >
                Zapisz
              </button>
              <button
                onClick={() => setPermissionsModal(null)}
                className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
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
  const [categories, setCategories] = useState<any[]>([]);
  const [clientData, setClientData] = useState({
    client_type: event.client_type || 'business',
    organization_id: event.organization_id,
    contact_person_id: event.contact_person_id,
  });
  const [formData, setFormData] = useState({
    name: event.name,
    category_id: event.category_id || '',
    event_date: event.event_date,
    event_end_date: event.event_end_date || '',
    location: event.location,
    location_id: event.location_id || null,
    budget: event.budget?.toString() || '',
    status: event.status,
  });

  useEffect(() => {
    if (isOpen) {
      fetchCategories();
    }
  }, [isOpen]);

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
      client_type: clientData.client_type,
      organization_id: clientData.organization_id || null,
      contact_person_id: clientData.contact_person_id || null,
      category_id: formData.category_id || null,
      event_date: formData.event_date ? new Date(formData.event_date).toISOString() : null,
      event_end_date: formData.event_end_date
        ? new Date(formData.event_end_date).toISOString()
        : null,
      location: formData.location,
      location_id: formData.location_id || null,
      budget: formData.budget ? parseFloat(formData.budget) : null,
      status: formData.status,
    };
    console.log('Form data to save:', dataToSave);
    onSave(dataToSave);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-2xl rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-light text-[#e5e4e2]">Edytuj event</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa eventu *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Nazwa eventu"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Organizacja (Firma)</label>
              <select
                value={formData.organization_id}
                onChange={(e) => setFormData({ ...formData, organization_id: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              >
                <option value="">Wybierz organizację</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.alias || org.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                Osoba kontaktowa / Klient indywidualny
              </label>
              <select
                value={showNewClientForm ? 'NEW_CLIENT' : formData.contact_person_id}
                onChange={(e) => handleContactChange(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              >
                <option value="">Wybierz osobę</option>
                <option value="NEW_CLIENT" className="font-medium text-[#d3bb73]">
                  + Nowy klient jednorazowy
                </option>
                {contacts.map((contact) => {
                  const displayName =
                    contact.full_name ||
                    `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
                  const suffix =
                    contact.contact_type === 'individual'
                      ? ' (Klient indywidualny)'
                      : contact.organization_name
                        ? ` (${contact.organization_name})`
                        : '';
                  return (
                    <option key={contact.id} value={contact.id}>
                      {displayName}
                      {suffix}
                    </option>
                  );
                })}
              </select>
              {formData.organization_id && !showNewClientForm && (
                <label className="mt-2 flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={sameAsOrganization}
                    onChange={(e) => handleSameAsOrganization(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73] focus:ring-[#d3bb73]"
                  />
                  <span className="text-sm text-[#e5e4e2]/60">
                    Osoba kontaktowa z wybranej firmy
                  </span>
                </label>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kategoria</label>
              <select
                value={formData.category_id}
                onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
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

          {/* Formularz nowego klienta */}
          {showNewClientForm && (
            <div className="space-y-3 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium text-[#e5e4e2]">Nowy klient jednorazowy</h3>
                <button
                  onClick={() => {
                    setShowNewClientForm(false);
                    setNewClientData({ first_name: '', last_name: '', email: '', phone: '' });
                  }}
                  className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Imię *</label>
                  <input
                    type="text"
                    value={newClientData.first_name}
                    onChange={(e) =>
                      setNewClientData({ ...newClientData, first_name: e.target.value })
                    }
                    className="w-full rounded border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="Jan"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Nazwisko *</label>
                  <input
                    type="text"
                    value={newClientData.last_name}
                    onChange={(e) =>
                      setNewClientData({ ...newClientData, last_name: e.target.value })
                    }
                    className="w-full rounded border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="Kowalski"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Email</label>
                  <input
                    type="email"
                    value={newClientData.email}
                    onChange={(e) => setNewClientData({ ...newClientData, email: e.target.value })}
                    className="w-full rounded border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="jan@example.com"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Telefon</label>
                  <input
                    type="tel"
                    value={newClientData.phone}
                    onChange={(e) => setNewClientData({ ...newClientData, phone: e.target.value })}
                    className="w-full rounded border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="+48 123 456 789"
                  />
                </div>
              </div>
              <button
                onClick={handleCreateNewClient}
                className="w-full rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
              >
                Dodaj klienta
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data rozpoczęcia *</label>
              <input
                type="datetime-local"
                value={toLocalDatetimeString(formData.event_date)}
                onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data zakończenia</label>
              <input
                type="datetime-local"
                value={toLocalDatetimeString(formData.event_end_date)}
                onChange={(e) => setFormData({ ...formData, event_end_date: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Lokalizacja *</label>
            <LocationSelector
              value={formData.location}
              onChange={(value, locationData) =>
                setFormData({
                  ...formData,
                  location: value,
                  location_id: locationData?.id || null,
                })
              }
              placeholder="Wybierz z listy lub wyszukaj nową lokalizację..."
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Budżet (PLN)</label>
              <input
                type="number"
                step="0.01"
                value={formData.budget}
                onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
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

          <div className="flex gap-3 border-t border-[#d3bb73]/10 pt-6">
            <button
              onClick={handleSubmit}
              className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Zapisz zmiany
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
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
    offer_number: '',
    valid_until: '',
    notes: '',
  });

  if (!isOpen) return null;

  const handleSubmit = async () => {
    try {
      const offerData: any = {
        event_id: eventId,
        client_id: clientId,
        valid_until: formData.valid_until || null,
        notes: formData.notes || null,
        status: 'draft',
        total_amount: 0,
      };

      if (formData.offer_number.trim()) {
        offerData.offer_number = formData.offer_number;
      }

      const { data, error } = await supabase.from('offers').insert([offerData]).select();

      if (error) {
        console.error('Error creating offer:', error);
        alert('Błąd podczas tworzenia oferty: ' + error.message);
        return;
      }

      if (data && data[0]) {
        alert(`Utworzono ofertę: ${data[0].offer_number}`);
      }

      onSuccess();
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd podczas tworzenia oferty');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-light text-[#e5e4e2]">Utwórz nową ofertę</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
            <p className="text-sm text-blue-400">
              Numer oferty zostanie wygenerowany automatycznie w formacie OF/RRRR/MM/NNN (np.
              OF/2025/10/001)
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Numer oferty</label>
            <input
              type="text"
              value={formData.offer_number}
              onChange={(e) => setFormData({ ...formData, offer_number: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Zostaw puste dla automatycznego numeru lub wpisz własny"
            />
            <p className="mt-1 text-xs text-[#e5e4e2]/40">
              System sprawdzi czy numer jest unikalny
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Ważna do</label>
            <input
              type="date"
              value={formData.valid_until}
              onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Notatki</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="min-h-[100px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Dodatkowe informacje o ofercie..."
            />
          </div>

          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
            <p className="text-sm text-blue-400">
              Po utworzeniu oferty będziesz mógł dodać do niej pozycje (atrakcje, usługi) i ustalić
              ceny.
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSubmit}
              className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Utwórz ofertę
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
