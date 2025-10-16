/**
 * Event Access Control System
 *
 * Helper functions for checking and managing event permissions
 */

import { supabase } from './supabase';

export type EventPermission =
  | 'edit_event'
  | 'edit_agenda'
  | 'edit_tasks'
  | 'edit_files'
  | 'edit_equipment'
  | 'invite_members'
  | 'view_budget';

export interface EventMemberPermissions {
  assignment_id: string;
  event_id: string;
  employee_id: string;
  event_creator_id: string;
  is_creator: boolean;
  role: string;
  status: 'pending' | 'accepted' | 'rejected';
  access_level_name: string;
  access_level_slug: string;
  access_level_config: {
    view_full_event: boolean;
    view_agenda: boolean;
    view_files: boolean;
    view_team: boolean;
    view_equipment: boolean;
    view_client_info: boolean;
    view_budget: boolean;
    edit_tasks: boolean;
    manage_equipment: boolean;
  };
  can_edit_event: boolean;
  can_edit_agenda: boolean;
  can_edit_tasks: boolean;
  can_edit_files: boolean;
  can_edit_equipment: boolean;
  can_invite_members: boolean;
  can_view_budget: boolean;
  granted_by: string | null;
  permissions_updated_at: string | null;
  employee_name: string;
  employee_surname: string;
  employee_nickname: string | null;
}

/**
 * Check if current user can perform specific action on event
 */
export async function canUserPerformAction(
  eventId: string,
  userId: string,
  action: EventPermission
): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_user_perform_action', {
    p_event_id: eventId,
    p_user_id: userId,
    p_action: action
  });

  if (error) {
    console.error('Error checking permission:', error);
    return false;
  }

  return data === true;
}

/**
 * Get member's permissions for an event
 */
export async function getMemberPermissions(
  eventId: string,
  employeeId: string
): Promise<EventMemberPermissions | null> {
  const { data, error } = await supabase
    .from('event_member_permissions')
    .select('*')
    .eq('event_id', eventId)
    .eq('employee_id', employeeId)
    .single();

  if (error) {
    console.error('Error fetching member permissions:', error);
    return null;
  }

  return data;
}

/**
 * Get all members with their permissions for an event
 */
export async function getEventMembers(
  eventId: string
): Promise<EventMemberPermissions[]> {
  const { data, error } = await supabase
    .from('event_member_permissions')
    .select('*')
    .eq('event_id', eventId)
    .eq('status', 'accepted')
    .order('is_creator', { ascending: false });

  if (error) {
    console.error('Error fetching event members:', error);
    return [];
  }

  return data || [];
}

/**
 * Grant collaborator permissions to a member
 */
export async function grantCollaboratorPermissions(
  assignmentId: string,
  permissions: Partial<{
    can_edit_event: boolean;
    can_edit_agenda: boolean;
    can_edit_tasks: boolean;
    can_edit_files: boolean;
    can_edit_equipment: boolean;
    can_invite_members: boolean;
    can_view_budget: boolean;
  }>,
  grantedBy: string
) {
  const { data, error } = await supabase
    .from('employee_assignments')
    .update({
      ...permissions,
      granted_by: grantedBy,
      permissions_updated_at: new Date().toISOString()
    })
    .eq('id', assignmentId)
    .select()
    .single();

  if (error) {
    console.error('Error granting permissions:', error);
    throw error;
  }

  return data;
}

/**
 * Revoke all collaborator permissions from a member
 */
export async function revokeCollaboratorPermissions(assignmentId: string) {
  const { data, error } = await supabase
    .from('employee_assignments')
    .update({
      can_edit_event: false,
      can_edit_agenda: false,
      can_edit_tasks: false,
      can_edit_files: false,
      can_edit_equipment: false,
      can_invite_members: false,
      can_view_budget: false,
      granted_by: null,
      permissions_updated_at: new Date().toISOString()
    })
    .eq('id', assignmentId)
    .select()
    .single();

  if (error) {
    console.error('Error revoking permissions:', error);
    throw error;
  }

  return data;
}

/**
 * Get audit log for an event
 */
export async function getEventAuditLog(
  eventId: string,
  limit: number = 100
) {
  const { data, error } = await supabase
    .from('event_audit_log')
    .select(`
      *,
      employee:employees(
        id,
        name,
        surname,
        nickname
      )
    `)
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching audit log:', error);
    return [];
  }

  return data || [];
}

/**
 * Check if user is event creator
 */
export async function isEventCreator(
  eventId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('events')
    .select('created_by')
    .eq('id', eventId)
    .single();

  if (error || !data) {
    return false;
  }

  return data.created_by === userId;
}

/**
 * Check if member is a collaborator (has any elevated permissions)
 */
export function isCollaborator(permissions: EventMemberPermissions): boolean {
  return (
    permissions.can_edit_event ||
    permissions.can_edit_agenda ||
    permissions.can_edit_tasks ||
    permissions.can_edit_files ||
    permissions.can_edit_equipment ||
    permissions.can_invite_members ||
    permissions.can_view_budget
  );
}

/**
 * Get permission label in Polish
 */
export function getPermissionLabel(permission: EventPermission): string {
  const labels: Record<EventPermission, string> = {
    edit_event: 'Edycja wydarzenia',
    edit_agenda: 'Edycja agendy',
    edit_tasks: 'Zarządzanie zadaniami',
    edit_files: 'Zarządzanie plikami',
    edit_equipment: 'Zarządzanie sprzętem',
    invite_members: 'Zapraszanie członków',
    view_budget: 'Widok budżetu'
  };

  return labels[permission];
}

/**
 * Get action label in Polish for audit log
 */
export function getActionLabel(action: string): string {
  const labels: Record<string, string> = {
    create: 'Utworzono',
    update: 'Zaktualizowano',
    delete: 'Usunięto',
    invite: 'Zaproszono',
    accept: 'Zaakceptowano',
    reject: 'Odrzucono',
    grant_permission: 'Nadano uprawnienia',
    revoke_permission: 'Odebrano uprawnienia'
  };

  return labels[action] || action;
}

/**
 * Get entity type label in Polish for audit log
 */
export function getEntityTypeLabel(entityType: string): string {
  const labels: Record<string, string> = {
    event: 'Wydarzenie',
    events: 'Wydarzenie',
    task: 'Zadanie',
    tasks: 'Zadanie',
    file: 'Plik',
    equipment: 'Sprzęt',
    member: 'Członek zespołu',
    employee_assignments: 'Członek zespołu',
    permission: 'Uprawnienie'
  };

  return labels[entityType] || entityType;
}
