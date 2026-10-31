type OwnerCandidate = {
  role?: string | null;
  access_level?: string | null;
  access_levels?: { slug?: string | null } | { slug?: string | null }[] | null;
};

const ownerRoles = new Set(['sales', 'manager', 'admin']);
const ownerCompanyRoles = new Set([
  'sales-specialist', 'manager', 'event-manager', 'operations-director', 'admin', 'company-admin',
]);

// Company-role assignment can keep the technical employee role as "employee".
export function isEligibleContactOwner(employee: OwnerCandidate): boolean {
  if (ownerRoles.has(employee.role || '') || ownerRoles.has(employee.access_level || '')) return true;
  const levels = Array.isArray(employee.access_levels) ? employee.access_levels : [employee.access_levels];
  return levels.some(level => ownerCompanyRoles.has(level?.slug || ''));
}
