import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';
import { isAdmin } from '@/lib/permissions';

export default async function AccessSettingsLayout({ children }: { children: React.ReactNode }) {
  const employee = await getCurrentEmployeeServerCached();
  if (!employee?.is_active || !isAdmin(employee)) return <p className="p-6">Tylko administrator ma dostęp do ustawień uprawnień.</p>;
  return children;
}
