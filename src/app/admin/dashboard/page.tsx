'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminDashboardPage() {
  const router = useRouter();

  useEffect(() => {
    router.push('/crm');
  }, [router]);

  return (
    <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
      <div className="text-[#d3bb73] text-lg">Przekierowywanie do CRM...</div>
    </div>
  );
}
