import 'server-only';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import type { CookieStoreLike } from '@/lib/supabase/server.app';
import type { IEmployee } from '@/app/(crm)/crm/employees/type';
import type { ViewMode } from '@/app/(crm)/crm/settings/page';
import type { OrganizationRow } from '@/app/(crm)/crm/contacts/types';
import { ADMIN_EVENT_TABS, CREATOR_EVENT_TABS } from '@/lib/CRM/events/eventTabs';
import { parseEventAccess, type EventAccess } from '@/lib/events/access/eventAccess';
import { EVENT_FINANCIAL_FIELDS, fetchEventFinancials, type EventFinancials } from '@/lib/CRM/events/eventFinancials';
import { closedEventAccess, isMissingDatabaseFunction, legacyEventAccess } from '@/lib/CRM/events/eventAccessFallback';

export function getCookieStore(): CookieStoreLike {
  const store = cookies();
  return {
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    set: (name, value, options) => store.set({ name, value, ...options }),
  };
}

export type EventEmployeeAssignmentRow = {
  id: string;
  event_id: string;
  employee_id: string;
  role?: string | null;
  responsibilities?: string | null;
  status?: 'pending' | 'accepted' | 'rejected' | string | null;
  can_edit_event?: boolean | null;
  can_edit_agenda?: boolean | null;
  can_edit_tasks?: boolean | null;
  can_edit_files?: boolean | null;
  can_edit_equipment?: boolean | null;
  can_invite_members?: boolean | null;
  can_view_budget?: boolean | null;
  created_at?: string | null;
  employee: {
    id: string;
    name: string | null;
    surname: string | null;
    avatar_url: string | null;
    avatar_metadata?: any;
  } | null;
};

export type EventCategoryRow = {
  id: string;
  name: string;
  color: string | null;
};

export type EventPermissionContext = {
  canManageTeam: boolean;
  allowedEventTabs: string[];
  userAssignmentStatus: 'accepted' | 'pending' | 'rejected' | null;
  hasLimitedAccess: boolean;
  isAdmin: boolean;
  isCreator: boolean;
  /** Opiekun sprzedaży wydarzenia (właściciel zapytania, autor zaakceptowanej oferty, opiekun sprzedawcy z portalu). */
  sellsEvent?: boolean;
  /** Decyzja bazy: public.current_employee_can_manage_event — ta sama co w RLS agendy i wydarzenia. */
  canManageEvent?: boolean;
  currentUserId: string | null;
  /**
   * Obszary danych wydarzenia z bazy (get_event_access) — jedno źródło decyzji, które zakładki i sekcje widać.
   * `legacy`: funkcji jeszcze nie ma w bazie — obszary z dotychczasowych reguł; `closed`: przejściowy błąd —
   * tylko dane operacyjne.
   */
  access?: EventAccess;
  accessSource?: 'database' | 'legacy' | 'closed';
  /** Zakładki zawężone w ustawieniach pracownika / poziomu dostępu (null = bez zawężenia). */
  employeeEventTabs?: string[] | null;
};

export type EventRow = {
  id: string;
  name: string;
  event_date: string;
  event_end_date: string | null;
  planned_setup_at: string | null;
  planned_teardown_at: string | null;
  location: string | null;
  status: string;
  category_id: string | null;
  expected_revenue: number | null;
  created_by: string | null;
  created_at: string;
  location_id: string | null;
  contact_person_id: string | null;
  organization_id: string | null;
  billing_arrangement: 'direct' | 'hotel' | 'agency' | 'other' | null;
  billing_organization_id: string | null;
  purchase_order_number: string | null;
  contract_clause_overrides: unknown;

  organizations: { name: string | null; alias: string | null } | null;
  contacts: { first_name: string | null; last_name: string | null } | null;
  event_categories: { name: string | null; color: string | null } | null;
  locations: {
    name: string | null;
    formatted_address: string | null;
    address: string | null;
    city: string | null;
    postal_code: string | null;
  } | null;

  category: EventCategoryRow | null;
  viewMode: ViewMode | null;
  creator: IEmployee | null;
};

export type EventByIdServerResult = EventRow & {
  /** Kwoty z event_financials (tylko z obszarem „kwoty”; inaczej null). */
  financials: EventFinancials | null;
  category: EventCategoryRow | null;
  organization: OrganizationRow | null;
  creator: IEmployee | null;
  currentEmployee: IEmployee | null;
  permissionContext: EventPermissionContext;
  employees: EventEmployeeAssignmentRow[];
};

const ACCEPTED_FALLBACK_TABS = ['overview', 'team', 'agenda', 'files', 'tasks'];
const DEFAULT_FALLBACK_TABS = ['overview', 'phases', 'agenda', 'files', 'tasks'];

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  if (
    !trimmed ||
    trimmed.toLowerCase() === 'null' ||
    trimmed.toLowerCase() === 'undefined'
  ) {
    return null;
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidRegex.test(trimmed) ? trimmed : null;
}

function normalizeTabs(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value) && value.length > 0) {
    return value.filter((tab): tab is string => typeof tab === 'string' && !!tab.trim());
  }
  return fallback;
}

function explicitEventTabs(employee: any): string[] | null {
  const own = Array.isArray(employee?.event_tabs) ? employee.event_tabs : [];
  const level = Array.isArray(employee?.access_levels?.event_tabs) ? employee.access_levels.event_tabs : [];
  const source = own.length > 0 ? own : level;
  const tabs = source.filter((tab: unknown): tab is string => typeof tab === 'string' && !!tab.trim());
  return tabs.length > 0 ? tabs : null;
}

type QueryResult<T> = { data: T; error: null } | { data: null; error: null };

function emptyResult<T>(data: T = null as T): QueryResult<T> {
  return { data, error: null };
}

export async function fetchEventByIdServer(
  eventId: string,
): Promise<EventByIdServerResult | null> {
  const supabase = createSupabaseServerClient(getCookieStore());

  const normalizedEventId = normalizeUuid(eventId);
  if (!normalizedEventId) return null;

  const { data: auth, error: authError } = await supabase.auth.getUser();

  if (authError) {
    if (authError.name === 'AuthSessionMissingError') return null;
    console.error('[fetchEventByIdServer] auth.getUser error:', authError);
    return null;
  }

  const currentUserId = normalizeUuid(auth.user?.id);
  if (!currentUserId) return null;

  // Brak wiersza (RLS) = null — strona sprawdza wtedy, czy to podgląd wydarzenia innego sprzedawcy.
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('*')
    .eq('id', normalizedEventId)
    .maybeSingle();

  if (eventError) throw eventError;
  if (!event) return null;

  const categoryId = normalizeUuid((event as any).category_id);
  const creatorId = normalizeUuid((event as any).created_by);
  const organizationId = normalizeUuid((event as any).organization_id);
  const myCompanyId = normalizeUuid((event as any).my_company_id);

  const [
    { data: eventCategory, error: eventCategoryError },
    { data: creator, error: creatorError },
    { data: organization, error: organizationError },
    { data: myCompany, error: myCompanyError },
    { data: myCompanyBrandLogo, error: myCompanyBrandLogoError },
    { data: currentEmployee, error: currentEmployeeError },
    { data: assignment, error: assignmentError },
    { data: eventEmployees, error: eventEmployeesError },
  ] = await Promise.all([
    categoryId
      ? supabase.from('event_categories').select('*').eq('id', categoryId).maybeSingle()
      : Promise.resolve(emptyResult<EventCategoryRow | null>(null)),

    creatorId
      ? supabase
          .from('employees')
          .select(
            'id, name, surname, nickname, avatar_url, avatar_metadata, role, occupation, qualifications, is_active',
          )
          .eq('id', creatorId)
          .maybeSingle()
      : Promise.resolve(emptyResult<IEmployee | null>(null)),

    organizationId
      ? supabase
          .from('organizations')
          .select(
            'id, name, alias, business_type, primary_contact_id, legal_form, nip, address, city, postal_code, country, email, phone, website, status, notes',
          )
          .eq('id', organizationId)
          .maybeSingle()
      : Promise.resolve(emptyResult<OrganizationRow | null>(null)),
      myCompanyId
      ? supabase
          .from('my_companies')
          .select('id, name, legal_name, nip, email, phone, website, city, logo_url')
          .eq('id', myCompanyId)
          .maybeSingle()
      : Promise.resolve(emptyResult<any | null>(null)),
    
    myCompanyId
      ? supabase
          .from('company_brandbook_logos')
          .select('url')
          .eq('company_id', myCompanyId)
          .eq('label', 'signature')
          .maybeSingle()
      : Promise.resolve(emptyResult<any | null>(null)),

    supabase
      .from('employees')
      .select(
        `
        id,
        name,
        surname,
        nickname,
        avatar_url,
        avatar_metadata,
        role,
        access_level,
        occupation,
        is_active,
        permissions,
        event_tabs,
        access_level_id,
        access_levels(event_tabs)
      `,
      )
      .eq('auth_user_id', currentUserId)
      .maybeSingle(),

    supabase
      .from('employee_assignments')
      .select('can_invite_members, status')
      .eq('event_id', normalizedEventId)
      .eq('employee_id', currentUserId)
      .maybeSingle(),

    supabase
      .from('employee_assignments')
      .select(
        `
        *,
        employee:employees!employee_assignments_employee_id_fkey(
          id,
          name,
          surname,
          avatar_url,
          avatar_metadata
        )
      `,
      )
      .eq('event_id', normalizedEventId)
      .order('created_at', { ascending: true }),
  ]);

  if (eventCategoryError) throw eventCategoryError;
  if (creatorError) throw creatorError;
  if (organizationError) throw organizationError;
  if (currentEmployeeError) throw currentEmployeeError;
  if (assignmentError) throw assignmentError;
  if (eventEmployeesError) throw eventEmployeesError;

  const isAdmin =
    currentEmployee?.role === 'admin' ||
    (Array.isArray((currentEmployee as any)?.permissions) &&
      (currentEmployee as any).permissions.includes('admin'));

  const canManageEvents =
    !isAdmin &&
    Array.isArray((currentEmployee as any)?.permissions) &&
    (currentEmployee as any).permissions.includes('events_manage');

  const [sellsEventResult, manageEventResult, accessResult, financials] = await Promise.all([
    supabase.rpc('current_employee_sells_event', { p_event_id: normalizedEventId }),
    supabase.rpc('current_employee_can_manage_event', { p_event_id: normalizedEventId }),
    supabase.rpc('get_event_access', { p_event_id: normalizedEventId }),
    fetchEventFinancials(supabase, normalizedEventId),
  ]);
  const sellsEvent = !sellsEventResult.error && sellsEventResult.data === true;
  // Opiekun sprzedaży prowadzi wydarzenie tak jak jego autor (agenda, status, zespół).
  const isCreator = creatorId === currentUserId || sellsEvent;
  const canManageEvent = manageEventResult.error
    ? Boolean(isAdmin || canManageEvents || isCreator)
    : manageEventResult.data === true;

  const hasAcceptedOnlyCalendarView =
    !isAdmin &&
    Array.isArray((currentEmployee as any)?.permissions) &&
    (currentEmployee as any).permissions.includes('calendar_view_accepted_only');

  const hasPlanningEventView =
    !isAdmin &&
    Array.isArray((currentEmployee as any)?.permissions) &&
    (currentEmployee as any).permissions.includes('events_view_planning');

  const hasOperationalEventView =
    !isAdmin &&
    Array.isArray((currentEmployee as any)?.permissions) &&
    (currentEmployee as any).permissions.includes('events_view_operational');

  let permissionContext: EventPermissionContext = {
    canManageTeam: false,
    allowedEventTabs: [],
    userAssignmentStatus: null,
    hasLimitedAccess: false,
    isAdmin,
    isCreator,
    currentUserId,
  };

  if (isAdmin) {
    permissionContext = {
      canManageTeam: true,
      allowedEventTabs: ADMIN_EVENT_TABS,
      userAssignmentStatus:
        (assignment?.status as 'accepted' | 'pending' | 'rejected' | null) ?? null,
      hasLimitedAccess: false,
      isAdmin: true,
      isCreator,
      currentUserId,
    };
  } else if (canManageEvents) {
    const employeeTabs = (currentEmployee as any)?.event_tabs;
    const accessLevelTabs = (currentEmployee as any)?.access_levels?.event_tabs;

    permissionContext = {
      canManageTeam: true,
      allowedEventTabs: normalizeTabs(
        employeeTabs && employeeTabs.length > 0 ? employeeTabs : accessLevelTabs,
        CREATOR_EVENT_TABS,
      ),
      userAssignmentStatus: (assignment?.status as any) ?? null,
      hasLimitedAccess: false,
      isAdmin: false,
      isCreator,
      currentUserId,
    };
  } else if (
    (hasPlanningEventView || hasOperationalEventView || hasAcceptedOnlyCalendarView) &&
    !isCreator &&
    assignment?.status !== 'accepted'
  ) {
    const employeeTabs = (currentEmployee as any)?.event_tabs;
    const accessLevelTabs = (currentEmployee as any)?.access_levels?.event_tabs;

    permissionContext = {
      canManageTeam: false,
      allowedEventTabs: normalizeTabs(
        employeeTabs && employeeTabs.length > 0 ? employeeTabs : accessLevelTabs,
        ['overview'],
      ),
      userAssignmentStatus: (assignment?.status as any) ?? null,
      hasLimitedAccess: false,
      isAdmin: false,
      isCreator,
      currentUserId,
    };
  } else if (assignment?.status === 'accepted') {
    const employeeTabs = (currentEmployee as any)?.event_tabs;
    const accessLevelTabs = (currentEmployee as any)?.access_levels?.event_tabs;

    permissionContext = {
      canManageTeam: !!assignment.can_invite_members,
      allowedEventTabs: normalizeTabs(
        employeeTabs && employeeTabs.length > 0 ? employeeTabs : accessLevelTabs,
        ACCEPTED_FALLBACK_TABS,
      ),
      userAssignmentStatus: 'accepted',
      hasLimitedAccess: false,
      isAdmin: false,
      isCreator,
      currentUserId,
    };
  } else if (assignment?.status === 'pending') {
    permissionContext = {
      canManageTeam: false,
      allowedEventTabs: ['overview'],
      userAssignmentStatus: 'pending',
      hasLimitedAccess: true,
      isAdmin: false,
      isCreator,
      currentUserId,
    };
  } else if (assignment?.status === 'rejected') {
    permissionContext = {
      canManageTeam: false,
      allowedEventTabs: ['overview'],
      userAssignmentStatus: 'rejected',
      hasLimitedAccess: true,
      isAdmin: false,
      isCreator,
      currentUserId,
    };
  } else if (isCreator) {
    permissionContext = {
      canManageTeam: true,
      allowedEventTabs: CREATOR_EVENT_TABS,
      userAssignmentStatus: null,
      hasLimitedAccess: false,
      isAdmin: false,
      isCreator: true,
      currentUserId,
    };
  } else {
    const employeeTabs = (currentEmployee as any)?.event_tabs;
    const accessLevelTabs = (currentEmployee as any)?.access_levels?.event_tabs;

    permissionContext = {
      canManageTeam: false,
      allowedEventTabs: normalizeTabs(
        employeeTabs && employeeTabs.length > 0 ? employeeTabs : accessLevelTabs,
        DEFAULT_FALLBACK_TABS,
      ),
      userAssignmentStatus: null,
      hasLimitedAccess: false,
      isAdmin: false,
      isCreator: false,
      currentUserId,
    };
  }

  // Obszary danych: z bazy; przed wdrożeniem migracji — dotychczasowe reguły; przy przejściowym błędzie — tylko realizacja.
  const accessSource: 'database' | 'legacy' | 'closed' = !accessResult.error
    ? 'database'
    : isMissingDatabaseFunction(accessResult.error)
      ? 'legacy'
      : 'closed';
  let access: EventAccess;
  if (accessSource === 'database') {
    access = parseEventAccess(accessResult.data);
  } else if (accessSource === 'legacy') {
    const billingResult = isAdmin || isCreator
      ? null
      : await supabase.rpc('can_view_event_commercials', { p_event_id: normalizedEventId });
    access = legacyEventAccess({
      eventId: normalizedEventId,
      isAdmin,
      isCreator,
      role: (currentEmployee as any)?.role ?? null,
      accessLevel: (currentEmployee as any)?.access_level ?? null,
      permissions: (currentEmployee as any)?.permissions ?? [],
      billing: Boolean(isAdmin || isCreator || (billingResult && !billingResult.error && billingResult.data === true)),
    });
  } else {
    console.warn('[fetchEventByIdServer] get_event_access failed, operational data only:', accessResult.error?.message);
    access = closedEventAccess(normalizedEventId);
  }
  // Zawężenie zakładek: przed migracją dotychczasowa lista (allowedEventTabs), potem wyłącznie jawne ustawienia.
  const employeeEventTabs = isAdmin || isCreator
    ? null
    : accessSource === 'legacy'
      ? permissionContext.allowedEventTabs
      : explicitEventTabs(currentEmployee);

  // Bez obszaru „kwoty” żadna kwota nie trafia do danych strony (także stare kolumny events przed migracją).
  const canViewValues = access.areas.values === true;
  const visibleFinancials = canViewValues ? financials : null;
  const eventForViewer: Record<string, unknown> = { ...(event as Record<string, unknown>) };
  if (!canViewValues) for (const field of EVENT_FINANCIAL_FIELDS) eventForViewer[field] = null;

  const logoPath = myCompanyBrandLogo?.url || (myCompany as any)?.logo_url || null;

const resolvedCompanyLogoUrl =
  logoPath && !/^https?:\/\//i.test(logoPath) && !logoPath.startsWith('data:')
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${logoPath}`
    : logoPath;

const realizationCompany = myCompany
  ? {
      ...(myCompany as any),
      logo_url: resolvedCompanyLogoUrl,
    }
  : null;

  return {
    ...eventForViewer,
    my_company: realizationCompany,
    category: eventCategory ?? null,
    creator: (creator as unknown as IEmployee) ?? null,
    organization: (organization as OrganizationRow) ?? null,
    currentEmployee: (currentEmployee as unknown as IEmployee) ?? null,
    financials: visibleFinancials,
    permissionContext: {
      ...permissionContext,
      sellsEvent,
      canManageEvent,
      access,
      accessSource,
      employeeEventTabs,
    },
    employees: (eventEmployees as EventEmployeeAssignmentRow[]) ?? [],
  } as EventByIdServerResult;
}
