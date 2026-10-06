import WarehouseDashboard from '@/components/crm/dashboard/WarehouseDashboard';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';
import { usesOperationalStages } from '@/lib/CRM/events/operationalStages';
import { redirect } from 'next/navigation';
import {
  fetchDashboardAnalyticsServer,
  fetchDashboardPreferencesServer,
  fetchRecentActivityServer,
  fetchStatsServer,
} from '@/lib/CRM/dashboard/dashboardData';
import CRMDashboard from './CRMDashboard';

export default async function CRMPage() {
  // The layout already authenticates this employee in the same server request.
  const employee = await getCurrentEmployeeServerCached();
  if (!employee?.id) redirect('/login');
  if (employee.is_active && employee.permissions?.includes('equipment_manage') && usesOperationalStages(employee)) {
    return <WarehouseDashboard employeeId={employee.id} />;
  }

  const [stats, recentActivity, analytics, dashboardPreferences] = await Promise.all([
    fetchStatsServer(),
    fetchRecentActivityServer(),
    fetchDashboardAnalyticsServer(),
    fetchDashboardPreferencesServer(),
  ]);

  return (
    <CRMDashboard
      stats={stats}
      recentActivity={recentActivity}
      analytics={analytics}
      dashboardPreferences={dashboardPreferences}
    />
  );
}
