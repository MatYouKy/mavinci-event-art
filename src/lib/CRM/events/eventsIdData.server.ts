import 'server-only';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import type { CookieStoreLike } from '@/lib/supabase/server.app';
import type { IEmployee } from '@/app/(crm)/crm/employees/type';
import { ViewMode } from '@/app/(crm)/crm/settings/page';
import { OrganizationRow } from '@/app/(crm)/crm/contacts/types';
import { ADMIN_EVENT_TABS, CREATOR_EVENT_TABS } from '@/app/(crm)/crm/events/[id]/EventDetailPageClient';

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
  currentUserId: string | null;

};

export type EventRow = {
  id: string;
  name: string;
  event_date: string;
  event_end_date: string | null;
  location: string | null;
  status: string;
  category_id: string | null;
  expected_revenue: number | null;
  created_by: string | null;
  created_at: string;
  location_id: string | null;
  contact_person_id: string | null;

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
  category: EventCategoryRow | null;
  organization: OrganizationRow | null;
  creator: IEmployee | null;
  currentEmployee: IEmployee | null;
  permissionContext: EventPermissionContext;
  employees: EventEmployeeAssignmentRow[];
};


const ACCEPTED_FALLBACK_TABS = ['overview', 'team', 'agenda', 'files', 'tasks'];
const DEFAULT_FALLBACK_TABS = ['overview', 'phases', 'agenda', 'files', 'tasks'];

function normalizeTabs(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value) && value.length > 0) {
    return value.filter((tab): tab is string => typeof tab === 'string' && !!tab.trim());
  }
  return fallback;
}

export async function fetchEventByIdServer(
  eventId: string,
): Promise<EventByIdServerResult | null> {
  const supabase = createSupabaseServerClient(getCookieStore());

  const { data: auth, error: authError } = await supabase.auth.getUser();

  if (authError) {
    if (authError.name === 'AuthSessionMissingError') return null;
    console.error('[fetchEventByIdServer] auth.getUser error:', authError);
    return null;
  }

  const currentUserId = auth.user?.id ?? null;
  if (!currentUserId) return null;

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single();

  if (eventError) throw eventError;
  if (!event) return null;

  const [
    { data: eventCategory, error: eventCategoryError },
    { data: creator, error: creatorError },
    { data: organization, error: organizationError },
    { data: currentEmployee, error: currentEmployeeError },
    { data: assignment, error: assignmentError },
    { data: eventEmployees, error: eventEmployeesError },
  ] = await Promise.all([
    supabase.from('event_categories').select('*').eq('id', event.category_id).maybeSingle(),
  
    supabase
      .from('employees')
      .select(
        'id, name, surname, nickname, avatar_url, avatar_metadata, role, occupation, qualifications, is_active',
      )
      .eq('id', event.created_by)
      .maybeSingle(),
  
    supabase
      .from('organizations')
      .select(
        'id, name, alias, business_type, primary_contact_id, legal_form, nip, address, city, postal_code, country, email, phone, website, status, notes',
      )
      .eq('id', event.organization_id)
      .maybeSingle(),
  
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
        occupation,
        is_active,
        permissions,
        event_tabs,
        access_level_id,
        access_levels(event_tabs)
      `,
      )
      .eq('id', currentUserId)
      .maybeSingle(),
  
    supabase
      .from('employee_assignments')
      .select('can_invite_members, status')
      .eq('event_id', eventId)
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
      .eq('event_id', eventId)
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
      (currentEmployee as any).permissions.includes('events_manage'));

  const isCreator = event.created_by === currentUserId;

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

  return {
    ...event,
    category: eventCategory ?? null,
    creator: (creator as IEmployee) ?? null,
    organization: (organization as unknown as OrganizationRow) ?? null,
    currentEmployee: (currentEmployee as unknown as IEmployee) ?? null,
    permissionContext,
    employees: eventEmployees ?? [],
  } as EventByIdServerResult;
}