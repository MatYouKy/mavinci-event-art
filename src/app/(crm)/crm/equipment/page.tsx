import { getEmployeePreferences } from '@/lib/CRM/employees/getEmployeePreferences';
import EquipmentPageClient from './EquipmentPageClient';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';

export default async function EquipmentPage() {
  const employee = await getCurrentEmployeeServerCached();
  const preferences = await getEmployeePreferences(employee?.id);
  return <EquipmentPageClient viewMode={preferences.equipment?.viewMode} />;
}