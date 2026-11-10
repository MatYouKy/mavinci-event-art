import { redirect } from 'next/navigation';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';
import PrivateTasksBoardTab from '@/components/crm/employee/tabs/PrivateTasksBoardTab';

export default async function MyTasksPage() {
  const employee = await getCurrentEmployeeServerCached();
  if (!employee?.id || !employee.is_active) redirect('/login');

  // The shortcut uses the same private board as the employee profile.
  return (
    <div className="h-full min-h-0 w-full">
      <PrivateTasksBoardTab
        employeeId={employee.id}
        isOwnProfile
        tasksState={[]}
      />
    </div>
  );
}
