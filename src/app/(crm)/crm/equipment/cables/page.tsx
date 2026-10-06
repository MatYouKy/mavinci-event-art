import { getEmployeePreferences } from '@/lib/CRM/employees/getEmployeePreferences';
import CablesPageClient from './CablesPageClient';

export default async function CablesPage() {
  const preferences = await getEmployeePreferences();
  return <CablesPageClient initialViewMode={preferences.cables?.viewMode} />;
}
