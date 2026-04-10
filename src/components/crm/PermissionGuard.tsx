'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { canView, isAdmin } from '@/lib/permissions';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface Props {
  children: React.ReactNode;
  module?: string;
  permission?: string;
  fallbackPath?: string;
}

export default function PermissionGuard({
  children,
  module,
  permission,
  fallbackPath = '/crm',
}: Props) {
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const router = useRouter();

  const { employee } = useCurrentEmployee();

  useEffect(() => {
    const checkPermission = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          router.push('/login');
          return;
        }

        // Czekamy aż employee będzie załadowany
        if (!employee) {
          return;
        }

        let hasPermissionCheck = false;

        if (permission) {
          hasPermissionCheck =
            isAdmin(employee) || employee.permissions?.includes(permission) || false;
        } else if (module) {
          hasPermissionCheck = isAdmin(employee) || canView(employee, module);
        } else {
          hasPermissionCheck = true;
        }

        if (!hasPermissionCheck) {
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
  }, [module, permission, router, fallbackPath, employee]);

  if (loading || !employee) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-[#d3bb73]" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center px-6">
        <ShieldAlert className="mb-4 h-16 w-16 text-red-400" />
        <h2 className="mb-2 text-2xl font-light text-[#e5e4e2]">Brak uprawnień</h2>
        <p className="max-w-md text-center text-[#e5e4e2]/60">
          Nie masz uprawnień do przeglądania tej strony. Za chwilę zostaniesz przekierowany...
        </p>
        {module && (
          <p className="mt-4 text-sm text-[#e5e4e2]/40">
            Wymagane uprawnienie: {module}_view lub {module}_manage
          </p>
        )}
        {permission && (
          <p className="mt-4 text-sm text-[#e5e4e2]/40">Wymagane uprawnienie: {permission}</p>
        )}
      </div>
    );
  }

  return <>{children}</>;
}