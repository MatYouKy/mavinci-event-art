import type { Metadata } from 'next';
import CrmSidebar from '../../../../components/crm/tenders/CrmSidebar';

export const metadata: Metadata = {
  title: 'CRM - Monitor Przetargów',
};

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <CrmSidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
