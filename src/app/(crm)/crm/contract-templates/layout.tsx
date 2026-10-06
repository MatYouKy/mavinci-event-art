import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';
import { canView, canManage } from '@/lib/permissions';

export default async function TemplateAccessLayout({ children }: { children: React.ReactNode }) {
  const employee = await getCurrentEmployeeServerCached();
  if (!employee?.is_active || !canView(employee, 'contracts')) return <p className="p-6">Brak uprawnień do tej sekcji umów.</p>;
  return children;
}
