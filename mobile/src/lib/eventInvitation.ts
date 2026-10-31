export function isEventOrganizer(
  createdBy: string | null | undefined,
  employeeId: string | null | undefined,
  authUserId: string | null | undefined,
): boolean {
  return Boolean(createdBy && (createdBy === employeeId || createdBy === authUserId));
}

export function showEventInvitation(
  createdBy: string | null | undefined,
  employeeId: string | null | undefined,
  authUserId: string | null | undefined,
  status: string | null | undefined,
): boolean {
  return status === 'pending' && !isEventOrganizer(createdBy, employeeId, authUserId);
}
