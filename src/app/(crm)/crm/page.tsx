import { cookies } from 'next/headers';
import {
  fetchDashboardAnalyticsServer,
  fetchDashboardPreferencesServer,
  fetchRecentActivityServer,
  fetchStatsServer,
} from '@/lib/CRM/dashboard/dashboardData';
import CRMDashboard from './CRMDashboard';

export default async function CRMPage() {
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
