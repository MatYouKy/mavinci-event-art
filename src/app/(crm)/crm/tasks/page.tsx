import { redirect } from 'next/navigation';
import { TasksPageClient } from './TaskPageClient';
import { fetchTasksServer } from '@/lib/CRM/tasks/tasksData.server';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';
import { canView } from '@/lib/permissions';

export default async function TasksPage() {
  const employee = await getCurrentEmployeeServerCached();
  if (!employee?.id || !employee.is_active) redirect('/login');
  if (!canView(employee, 'tasks')) redirect('/crm/tasks/mine');
  const initialTasks = await fetchTasksServer();
  return <TasksPageClient initialTasks={initialTasks} />;
}
