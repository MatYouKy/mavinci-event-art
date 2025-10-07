'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../contexts/AuthContext';

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/admin/login');
      } else {
        router.push('/crm');
      }
    }
  }, [user, loading, router]);

  return (
    <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
      <div className="text-[#d3bb73] text-lg">
        {loading ? 'Ładowanie...' : 'Przekierowywanie...'}
      </div>
    </div>
  );
}
