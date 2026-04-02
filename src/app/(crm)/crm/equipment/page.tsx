import { getEmployeePreferences } from '@/lib/CRM/employees/getEmployeePreferences';
import EquipmentPageClient from './EquipmentPageClient';

export default async function EquipmentPage() {
  const preferences = await getEmployeePreferences();
  return <EquipmentPageClient viewMode={preferences.equipment?.viewMode} />;
}