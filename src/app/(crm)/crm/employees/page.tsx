import { getEmployeesCached } from '@/lib/CRM/employees/getEmployees';
import { IEmployee } from './type';
import EmployeesPageClient from './EmployeesPageClient';

export const revalidate = 0; // CRM zwykle bez ISR

export default async function EmployeesPage() {
  const employees = await getEmployeesCached();
  return <EmployeesPageClient employees={employees} />;
}
