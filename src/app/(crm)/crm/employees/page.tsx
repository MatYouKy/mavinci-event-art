import { getEmployeesCached } from '@/lib/CRM/employees/getEmployees';
import { IEmployee } from './type';
import EmployeesPageClient from './EmployeesPageClient';
import { getEmployeePreferences } from '@/lib/CRM/employees/getEmployeePreferences';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';

export const revalidate = 0; // CRM zwykle bez ISR

export default async function EmployeesPage() {
  const employee = await getCurrentEmployeeServerCached();
  const preferences = await getEmployeePreferences(employee?.id);
  const employees = await getEmployeesCached();
  return <EmployeesPageClient employees={employees} viewMode={preferences.employees?.viewMode} />;
}
