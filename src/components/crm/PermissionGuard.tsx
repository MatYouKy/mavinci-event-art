'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { canView, isAdmin, type Employee } from '@/lib/permissions';
import { RefreshCw, ShieldAlert } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  module: string;
  fallbackPath?: string;
}

export default function PermissionGuard({ children, module, fallbackPath = '/crm' }: Props) {
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const checkPermission = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          router.push('/crm/login');
          return;
        }

        const { data: employee } = await supabase
          .from('employees')
          .select('id, role, access_level, permissions')
          .eq('email', session.user.email)
          .maybeSingle();

        if (!employee) {
          router.push('/crm/login');
          return;
        }

        const hasPermission = isAdmin(employee) || canView(employee, module);

        if (!hasPermission) {
          setHasAccess(false);
          setLoading(false);
          setTimeout(() => {
            router.push(fallbackPath);
          }, 2000);
          return;
        }

        setHasAccess(true);
        setLoading(false);
      } catch (error) {
        console.error('Error checking permission:', error);
        router.push(fallbackPath);
      }
    };

    checkPermission();
  }, [module, router, fallbackPath]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="w-8 h-8 text-[#d3bb73] animate-spin" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] px-6">
        <ShieldAlert className="w-16 h-16 text-red-400 mb-4" />
        <h2 className="text-2xl font-light text-[#e5e4e2] mb-2">Brak uprawnień</h2>
        <p className="text-[#e5e4e2]/60 text-center max-w-md">
          Nie masz uprawnień do przeglądania tej strony. Za chwilę zostaniesz przekierowany...
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
