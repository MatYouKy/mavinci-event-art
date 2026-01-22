import { cookies } from 'next/headers';
import { fetchRecentActivityServer, fetchStatsServer } from '@/lib/CRM/dashboard/dashboardData';
import CRMDashboard from './CRMDashboard';

export default async function CRMPage() {
  const [stats, recentActivity] = await Promise.all([
    fetchStatsServer(),
    fetchRecentActivityServer(),
  ]);

  return <CRMDashboard stats={stats} recentActivity={recentActivity} />;
}