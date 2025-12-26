'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
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
  Mail,
  Edit as EditIcon,
  AlertCircle,
  History,
  UserCheck,
  Truck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

import EventTasksBoard from '@/app/crm/events/[id]/components/tabs/EventTasksBoard';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import EventFilesExplorer from '@/app/crm/events/[id]/components/tabs/EventFilesExplorer';
import EventSubcontractorsPanel from '@/app/crm/events/[id]/components/tabs/EventSubcontractorsPanel';
import EventLogisticsPanel from '@/app/crm/events/[id]/components/tabs/EventLogisticsPanel';
import OfferWizard from '@/app/crm/offers/[id]/components/OfferWizzard/OfferWizard';
import EventFinancesTab from '@/app/crm/events/[id]/components/tabs/EventFinancesTab';
import EventAgendaTab from '@/app/crm/events/[id]/components/tabs/EventAgendaTab';
import EventStatusEditor from '@/components/crm/EventStatusEditor';

import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';

import EditEventModalNew from '@/components/crm/EditEventModalNew';
import EventTabOffer from './components/tabs/EventTabOffer';
import { EventsDetailsTab } from './components/tabs/EventsDetailsTab/EventsDetailsTab';
import { EventContractTab } from './components/tabs/EventContractTab';
import { AddChecklistModal } from './components/Modals/AddChecklistModal';
import { TeamMembersList } from './components/AddMembersList';
import { EventEquipmentTab } from './components/tabs/EventEquipmentTab';
import { useGetEventByIdQuery, useGetEventEmployeesQuery } from '../store/api/eventsApi';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useOfferActions } from '../../offers/hooks/useOfferById';
import { useEventEquipment, useEventOffers, useEventTeam, useEventAuditLog } from '../hooks';
import { IEventCategory } from '../../event-categories/types';
import { IEmployee } from '../../employees/type';
import {
  useGetContactByIdQuery,
  useGetOrganizationByIdQuery,
} from '../../contacts/store/clientsApi';
import { useLocations } from '../../locations/useLocations';
import { ILocation } from '../../locations/type';
import { AddEventEmployeeModal } from './components/Modals/AddEventEmployeeModal';
import { useEmployees } from '../../employees/hooks/useEmployees';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';

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
  const searchParams = useSearchParams();
  const eventId = params.id as string;
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { deleteOfferById } = useOfferActions();
  const { hasScope, isAdmin: isUserAdmin } = useCurrentEmployee();
  const { offers, refetch: refetchOffers } = useEventOffers(eventId);
  const { equipment } = useEventEquipment(eventId);
  const { employees } = useEventTeam(eventId);
  const [teamEmployees, setTeamEmployees] = useState<any[]>([]);

  useEffect(() => {
    setTeamEmployees(employees || []);
  }, [employees]);

  useEffect(() => {
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    const info = searchParams.get('info');
    const eventName = searchParams.get('event');

    if (success === 'invitation_accepted') {
      showSnackbar(`Zaproszenie do wydarzenia "${eventName}" zostało zaakceptowane`, 'success');
      router.replace(`/crm/events/${eventId}`);
    } else if (error === 'invalid_token') {
      showSnackbar('Nieprawidłowy lub nieważny token zaproszenia', 'error');
      router.replace(`/crm/events/${eventId}`);
    } else if (error === 'token_expired') {
      showSnackbar(
        'Token zaproszenia wygasł. Zaloguj się do systemu aby potwierdzić udział.',
        'error',
      );
      router.replace(`/crm/events/${eventId}`);
    } else if (info === 'already_responded') {
      showSnackbar('Już odpowiedziałeś na to zaproszenie', 'info');
      router.replace(`/crm/events/${eventId}`);
    } else if (error === 'update_failed') {
      showSnackbar('Nie udało się zaktualizować statusu zaproszenia', 'error');
      router.replace(`/crm/events/${eventId}`);
    }
  }, [searchParams, eventId, router, showSnackbar]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('employee_assignments')
        .select('*')
        .eq('event_id', eventId);

      console.log('[direct select employee_assignments]', { data, error });
    })();
  }, [eventId]);

  const {
    data: event,
    isLoading,
    error,
  } = useGetEventByIdQuery(eventId, {
    refetchOnMountOrArgChange: false, // ⬅️ tylko 1 fetch, bez refetch przy każdym wejściu
  });

  const { data: contact } = useGetContactByIdQuery(event?.contact_person_id);
  const { getById } = useLocations();

  const [location, setLocation] = useState<ILocation | null>(null);
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);

  useEffect(() => {
    console.log('event-effect', event);
    const fetchLocations = async () => {
      if (event?.location_id && event?.location_id !== null) {
        const location = await getById(event.location_id);
        console.log('location-effect', location);
        setLocation(location);
      }
    };
    fetchLocations();
  }, [getById, event?.location_id]);

  const { data: organization } = useGetOrganizationByIdQuery(event?.organization_id);

  const [isConfirmed, setIsConfirmed] = useState(false);
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

  const [categories, setCategories] = useState<IEventCategory[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [canManageTeam, setCanManageTeam] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userAssignmentStatus, setUserAssignmentStatus] = useState<
    'pending' | 'accepted' | 'rejected' | null
  >(null);
  const [hasLimitedAccess, setHasLimitedAccess] = useState(false);
  const [allowedEventTabs, setAllowedEventTabs] = useState<string[]>([]);
  const [hasSubcontractors, setHasSubcontractors] = useState(false);

  const [showAddChecklistModal, setShowAddChecklistModal] = useState(false);
  const [showEditEventModal, setShowEditEventModal] = useState(false);
  const [showCreateOfferModal, setShowCreateOfferModal] = useState(false);

  const [hoveredEmployee, setHoveredEmployee] = useState<string | null>(null);

  const { auditLog } = useEventAuditLog(eventId as string);

  useEffect(() => {
    if (eventId) {
      fetchCategories();
      checkTeamManagementPermission();
    }
  }, [eventId]);

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

      // Sprawdź czy użytkownik jest przypisany do wydarzenia
      const { data: assignment } = await supabase
        .from('employee_assignments')
        .select('can_invite_members, status')
        .eq('event_id', eventId)
        .eq('employee_id', session.user.id)
        .maybeSingle();

      // Jeśli jest przypisany i zaakceptował zaproszenie, użyj jego uprawnień z access_level lub indywidualnych
      if (assignment?.status === 'accepted') {
        setUserAssignmentStatus('accepted');
        setHasLimitedAccess(false);

        // Sprawdź indywidualne uprawnienia pracownika lub użyj event_tabs z access_level
        let eventTabs: string[] = ['overview', 'team', 'agenda', 'files', 'tasks'];

        if (employee?.event_tabs && employee.event_tabs.length > 0) {
          eventTabs = employee.event_tabs;
        } else if (
          employee?.access_levels?.event_tabs &&
          employee.access_levels.event_tabs.length > 0
        ) {
          eventTabs = employee.access_levels.event_tabs;
        }

        setAllowedEventTabs(eventTabs);

        if (assignment.can_invite_members) {
          setCanManageTeam(true);
        }
        return;
      } else if (assignment?.status === 'pending') {
        setUserAssignmentStatus('pending');
        setHasLimitedAccess(true);
        setAllowedEventTabs(['overview']);
        return;
      } else if (assignment?.status === 'rejected') {
        setUserAssignmentStatus('rejected');
        setHasLimitedAccess(true);
        setAllowedEventTabs(['overview']);
        return;
      }

      // Sprawdź czy jest creatorem
      const { data: eventData } = await supabase
        .from('events')
        .select('created_by')
        .eq('id', eventId)
        .single();

      if (eventData?.created_by === session.user.id) {
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

      // Dla pozostałych użytkowników użyj event_tabs z access_level
      let eventTabs: string[] = ['overview'];
      if (employee?.event_tabs && employee.event_tabs.length > 0) {
        eventTabs = employee.event_tabs;
      } else if ((employee?.access_levels as any)?.event_tabs) {
        eventTabs = (employee.access_levels as any).event_tabs;
      }
      setAllowedEventTabs(eventTabs);
      setCanManageTeam(false);
    } catch (err) {
      console.error('Error checking team management permission:', err);
      setCanManageTeam(false);
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
        setCategories(data as unknown as IEventCategory[]);
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

      setIsEditingCategory(false);
    } catch (err) {
      console.error('Error updating category:', err);
      alert('Błąd podczas aktualizacji kategorii');
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

  // const handleAddEmployee = async (
  //   employeeId: string,
  //   role: string,
  //   responsibilities: string,
  //   accessLevelId: string,
  //   permissions: any,
  // ) => {
  //   try {
  //     const {
  //       data: { session },
  //     } = await supabase.auth.getSession();

  //     const { error } = await supabase.from('employee_assignments').insert([
  //       {
  //         event_id: eventId,
  //         employee_id: employeeId,
  //         role: role,
  //         responsibilities: responsibilities || null,
  //         invited_by: session?.user?.id || null,
  //         status: 'pending',
  //         access_level_id: accessLevelId || null,
  //         can_edit_event: permissions.can_edit_event || false,
  //         can_edit_agenda: permissions.can_edit_agenda || false,
  //         can_edit_tasks: permissions.can_edit_tasks || false,
  //         can_edit_files: permissions.can_edit_files || false,
  //         can_edit_equipment: permissions.can_edit_equipment || false,
  //         can_invite_members: permissions.can_invite_members || false,
  //         can_view_budget: permissions.can_view_budget || false,
  //         granted_by: session?.user?.id || null,
  //         permissions_updated_at: new Date().toISOString(),
  //       },
  //     ]);

  //     if (error) {
  //       console.error('Error adding employee:', error);
  //       alert('Błąd podczas dodawania pracownika');
  //       return;
  //     }

  //     setShowAddEmployeeModal(false);

  //     // await logChange(
  //     //   'employee_added',
  //     //   `Dodano pracownika do zespołu (ID: ${employeeId}, rola: ${role})`,
  //     // );
  //   } catch (err) {
  //     console.error('Error:', err);
  //     alert('Wystąpił błąd');
  //   }
  // };

  const handleRemoveEmployee = async (assignmentId: string) => {
    const ok = await showConfirm('Czy na pewno chcesz usunąć tego pracownika z eventu?');
    if (!ok) return;

    try {
      const { error } = await supabase.from('employee_assignments').delete().eq('id', assignmentId);

      if (error) {
        console.error('Error removing employee:', error);
        showSnackbar('Błąd podczas usuwania pracownika', 'error');
        return;
      }

      setTeamEmployees((prev) => prev.filter((a) => a.id !== assignmentId));
      showSnackbar('Pracownik został usunięty z eventu', 'success');
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd', 'error');
    }
  };

  const handleToggleChecklist = async (checklistId: string, completed: boolean) => {
    console.log('Checklist functionality disabled - table does not exist');
  };

  const handleAddChecklist = async (task: string, priority: string) => {
    console.log('Checklist functionality disabled - table does not exist');
    setShowAddChecklistModal(false);
  };

  const handleDeleteOffer = useCallback(
    async (offerId: string) => {
      setIsConfirmed(true);
      const confirmed = await showConfirm(
        'Czy na pewno chcesz usunąć tę ofertę?',
        'Tej operacji nie można cofnąć.',
      );

      if (!confirmed) return;
      setIsConfirmed(false);
      try {
        await deleteOfferById(offerId);
        showSnackbar('Oferta została usunięta', 'success');
        refetchOffers();
      } catch (err) {
        console.error('Error deleting offer:', err);
        showSnackbar('Błąd podczas usuwania oferty', 'error');
      }
    },
    [deleteOfferById, showConfirm, showSnackbar, refetchOffers],
  );

  const actions = useMemo<Action[]>(() => {
    return [
      {
        label: 'Edytuj',
        onClick: () => setShowEditEventModal(true),
        icon: <Edit className="h-4 w-4" />,
        variant: 'primary',
        show: canManageTeam,
      },
      {
        label: 'Usuń',
        onClick: handleDeleteEvent,
        icon: <Trash2 className="h-4 w-4" />,
        variant: 'danger',
        show: isAdmin,
      },
    ];
  }, [setShowEditEventModal, handleDeleteEvent, isAdmin, canManageTeam]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  {
    error && <div className="p-4 text-sm text-red-400">{error.message}</div>;
  }

  if (!event) {
    return (
      <div className="flex h-screen flex-col items-center justify-center space-y-4">
        <div className="text-lg font-medium text-red-400">
          {error.message || 'Event nie został znaleziony'}
        </div>
        {error.message && (
          <div className="max-w-md text-center text-sm text-[#e5e4e2]/60">
            Sprawdź konsolę przeglądarki (F12), aby zobaczyć więcej szczegółów.
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
                  {event.category?.icon ? (
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
            </div>

            <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
              {event.client_type === 'business' && organization && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  {organization.alias || organization.name}
                </div>
              )}
              {event.client_type === 'individual' && contact && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span>
                    Klient: {contact.full_name || `${contact.first_name} ${contact.last_name}`}
                  </span>
                </div>
              )}
              {event.client_type === 'business' && contact && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span>
                    Kontakt: {contact.full_name || `${contact.first_name} ${contact.last_name}`}
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
          <ResponsiveActionBar actions={actions} />
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

                            showSnackbar('Zaproszenie zostało zaakceptowane', 'success');
                            window.location.reload();
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
              location={location}
              organization={organization}
              contact={contact}
              hasLimitedAccess={hasLimitedAccess}
              canManageTeam={canManageTeam}
              isUserAdmin={isUserAdmin}
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
                  {/* <span className="font-medium text-[#e5e4e2]">{employees.length}</span> */}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#e5e4e2]/60">Pliki</span>
                  <span className="font-medium text-[#e5e4e2]">
                    {event.attachments?.length || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#e5e4e2]/60">Checklisty</span>
                  {/* <span className="font-medium text-[#e5e4e2]">{checklists.length}</span> */}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'equipment' && <EventEquipmentTab />}

      {activeTab === 'team' && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-light text-[#e5e4e2]">Zespół</h2>
            {canManageTeam && (
              <ResponsiveActionBar
                actions={[
                  {
                    label: 'Dodaj osobę',
                    onClick: () => setShowAddEmployeeModal(true),
                    icon: <Plus className="h-4 w-4" />,
                    variant: 'primary',
                  },
                ]}
                disabledBackground
              />
            )}
          </div>

          {teamEmployees?.length === 0 ? (
            <div className="py-12 text-center">
              <Users className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
              <p className="text-[#e5e4e2]/60">Brak przypisanych pracowników</p>
            </div>
          ) : (
            <TeamMembersList
              employees={teamEmployees}
              onRemove={handleRemoveEmployee}
              canManageTeam={canManageTeam}
              currentUserId={currentUserId}
              eventCreatorId={event?.created_by}
            />
          )}
        </div>
      )}

      {activeTab === 'offer' && (
        <EventTabOffer
          offers={offers}
          isConfirmed={isConfirmed}
          setShowCreateOfferModal={setShowCreateOfferModal}
          handleDeleteOffer={handleDeleteOffer}
        />
      )}

      {activeTab === 'files' && <EventFilesExplorer eventId={eventId} />}

      {activeTab === 'logistics' && event && (
        <EventLogisticsPanel
          eventId={event.id}
          eventLocation={event.location.name}
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
          contact={contact}
          organization={organization}
          eventId={eventId}
          eventName={event?.name ?? ''}
          eventDate={event?.event_date ?? ''}
          startTime={event?.event_date ?? ''}
          endTime={event?.event_end_date ?? ''}
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

      {showAddEmployeeModal && (
        <AddEventEmployeeModal
          isOpen={showAddEmployeeModal}
          onClose={() => setShowAddEmployeeModal(false)}
          eventId={eventId}
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
          location={location}
          isOpen={showEditEventModal}
          onClose={() => setShowEditEventModal(false)}
          event={event}
          onSave={async (updatedData) => {
            try {
              console.log('Updating event with data:', updatedData);
              const { error } = await supabase.from('events').update(updatedData).eq('id', eventId);

              if (error) {
                console.error('Error updating event:', error);
                showSnackbar('Błąd podczas aktualizacji eventu', 'error');
                return;
              }

              setShowEditEventModal(false);
              showSnackbar('Wydarzenie zaktualizowane', 'success');
            } catch (err) {
              console.error('Error:', err);
              showSnackbar('Wystąpił błąd', 'error');
            }
          }}
        />
      )}

      {showCreateOfferModal && event && (
        <OfferWizard
          isOpen={showCreateOfferModal}
          onClose={() => {
            setShowCreateOfferModal(false);
          }}
          eventId={eventId}
          organizationId={event.organization_id}
          contactId={event.contact_person_id}
          clientType={event?.client_type || 'business'}
          onSuccess={() => {
            setShowCreateOfferModal(false);
            refetchOffers();
            setActiveTab('offer'); // Odśwież dane eventu aby zaktualizować budżet
          }}
        />
      )}
    </div>
  );
}
