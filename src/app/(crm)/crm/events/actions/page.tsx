import { redirect } from 'next/navigation';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';
import WorkflowActionsClient from './WorkflowActionsClient';
export default async function EventWorkflowActionsPage() {
  const employee = await getCurrentEmployeeServerCached();
  if (!employee?.is_active) redirect('/login');
  return <WorkflowActionsClient />;
}
