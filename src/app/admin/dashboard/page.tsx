'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminDashboardPage() {
  const router = useRouter();

  useEffect(() => {
    router.push('/crm');
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
      <div className="text-lg text-[#d3bb73]">Przekierowywanie do CRM...</div>
    </div>
  );
}
