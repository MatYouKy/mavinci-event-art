import 'server-only';

import { getCurrentEmployeeServer } from '@/lib/CRM/auth/getCurrentEmployeeServer';

export async function getMarketingAccess(mode: 'view' | 'manage' = 'view') {
  const employee = await getCurrentEmployeeServer();
  const permissions = Array.isArray(employee?.permissions) ? employee.permissions : [];
  const admin =
    employee?.role === 'admin' ||
    employee?.access_level === 'admin' ||
    permissions.includes('admin');
  const canView =
    admin ||
    permissions.includes('marketing_campaigns_view') ||
    permissions.includes('marketing_campaigns_manage') ||
    permissions.includes('marketing_campaigns_approve');
  const canManage = admin || permissions.includes('marketing_campaigns_manage');

  return {
    employee,
    admin,
    canView,
    canManage,
    allowed:
      Boolean(employee?.id) && (mode === 'manage' ? canManage : canView),
    companyIds: Array.isArray(employee?.my_company_ids) ? employee.my_company_ids : [],
  };
}

export function canAccessMarketingCompany(
  access: Awaited<ReturnType<typeof getMarketingAccess>>,
  companyId: string,
) {
  return access.admin || access.companyIds.length === 0 || access.companyIds.includes(companyId);
}
