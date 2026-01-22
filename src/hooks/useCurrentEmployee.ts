import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import {
  isAdmin as checkIsAdmin,
  canView,
  canManage,
  canCreate,
  canManagePermissions as checkCanManagePermissions,
} from '@/lib/permissions';
import { IEmployee } from '@/app/(crm)/crm/employees/type';

interface CurrentEmployeeData {
  employee: IEmployee | null;
  currentEmployee: IEmployee | null;
  loading: boolean;

  // ✅ NEW
  sessionUserId: string | null;
  refreshSession: () => Promise<string | null>;

  isAdmin: boolean;
  canManagePermissions: boolean;
  hasScope: (scope: string) => boolean;
  canViewModule: (module: string) => boolean;
  canManageModule: (module: string) => boolean;
  canCreateInModule: (module: string) => boolean;
  refresh: () => Promise<void>;
}

let cachedEmployee: IEmployee | null = null;
let cachedUserId: string | null = null;

export function useCurrentEmployee(): CurrentEmployeeData {
  const [employee, setEmployee] = useState<IEmployee | null>(cachedEmployee);
  const [loading, setLoading] = useState(!cachedEmployee);

  // ✅ NEW: sessionUserId trzymamy osobno
  const [sessionUserId, setSessionUserId] = useState<string | null>(cachedUserId);

  // ✅ NEW: jeśli potrzebujesz "twardo" odświeżyć sesję przed mutacją
  const refreshSession = async (): Promise<string | null> => {
    try {
      const {
        data: { session },
        error,
      } = await supabase.auth.refreshSession();

      if (error || !session?.user?.id) {
        setSessionUserId(null);
        return null;
      }

      setSessionUserId(session.user.id);
      return session.user.id;
    } catch (err) {
      console.error('Error in refreshSession:', err);
      setSessionUserId(null);
      return null;
    }
  };

  const fetchEmployee = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setEmployee(null);
        cachedEmployee = null;

        // ✅ NEW
        setSessionUserId(null);
        cachedUserId = null;

        return;
      }

      // ✅ NEW
      setSessionUserId(user.id);

      if (cachedUserId === user.id && cachedEmployee) {
        setEmployee(cachedEmployee);
        setLoading(false);
        return;
      }

      const { data: employeeData, error } = await supabase
        .from('employees')
        .select(
          'id, name, surname, nickname, email, phone_number, phone_private, avatar_url, role, access_level, permissions, occupation, region',
        )
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        console.error('Error fetching employee:', error);
        setEmployee(null);
        cachedEmployee = null;

        // ✅ NEW
        setSessionUserId(user.id);
        cachedUserId = user.id;

        return;
      }

      cachedEmployee = employeeData as unknown as IEmployee;
      cachedUserId = user.id;

      // ✅ NEW
      setSessionUserId(user.id);

      setEmployee(employeeData as unknown as IEmployee);
    } catch (err) {
      console.error('Error in fetchEmployee:', err);
      setEmployee(null);
      cachedEmployee = null;

      // ✅ NEW
      setSessionUserId(null);
      cachedUserId = null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployee();
  }, []);

  const isAdmin = employee ? checkIsAdmin(employee as unknown as IEmployee) : false;

  const canManagePermissions = employee
    ? checkCanManagePermissions(employee as unknown as IEmployee)
    : false;

  const hasScope = (scope: string): boolean => {
    if (!employee) return false;
    return employee.permissions?.includes(scope) || false;
  };

  const canViewModule = (module: string): boolean => {
    if (!employee) return false;
    return (
      checkIsAdmin(employee as unknown as IEmployee) ||
      canView(employee as unknown as IEmployee, module)
    );
  };

  const canManageModule = (module: string): boolean => {
    if (!employee) return false;
    return (
      checkIsAdmin(employee as unknown as IEmployee) ||
      canManage(employee as unknown as IEmployee, module)
    );
  };

  const canCreateInModule = (module: string): boolean => {
    if (!employee) return false;
    return (
      checkIsAdmin(employee as unknown as IEmployee) ||
      canCreate(employee as unknown as IEmployee, module)
    );
  };

  const refresh = async () => {
    cachedEmployee = null;
    cachedUserId = null;

    // ✅ NEW
    setSessionUserId(null);

    setLoading(true);
    await fetchEmployee();
  };

  return {
    employee,
    currentEmployee: employee,
    loading,

    // ✅ NEW
    sessionUserId,
    refreshSession,

    isAdmin,
    canManagePermissions,
    hasScope,
    canViewModule,
    canManageModule,
    canCreateInModule,
    refresh,
  };
}
