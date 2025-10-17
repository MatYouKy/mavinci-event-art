import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { isAdmin as checkIsAdmin, canView, canManage, canCreate, canManagePermissions as checkCanManagePermissions, type Employee } from '@/lib/permissions';

interface CurrentEmployeeData {
  employee: Employee | null;
  currentEmployee: Employee | null;
  loading: boolean;
  isAdmin: boolean;
  canManagePermissions: boolean;
  hasScope: (scope: string) => boolean;
  canViewModule: (module: string) => boolean;
  canManageModule: (module: string) => boolean;
  canCreateInModule: (module: string) => boolean;
  refresh: () => Promise<void>;
}

let cachedEmployee: Employee | null = null;
let cachedUserId: string | null = null;

export function useCurrentEmployee(): CurrentEmployeeData {
  const [employee, setEmployee] = useState<Employee | null>(cachedEmployee);
  const [loading, setLoading] = useState(!cachedEmployee);

  const fetchEmployee = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setEmployee(null);
        cachedEmployee = null;
        cachedUserId = null;
        return;
      }

      if (cachedUserId === user.id && cachedEmployee) {
        setEmployee(cachedEmployee);
        setLoading(false);
        return;
      }

      const { data: employeeData, error } = await supabase
        .from('employees')
        .select('id, role, access_level, permissions')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        console.error('Error fetching employee:', error);
        setEmployee(null);
        cachedEmployee = null;
        cachedUserId = null;
        return;
      }

      cachedEmployee = employeeData;
      cachedUserId = user.id;
      setEmployee(employeeData);
    } catch (err) {
      console.error('Error in fetchEmployee:', err);
      setEmployee(null);
      cachedEmployee = null;
      cachedUserId = null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployee();
  }, []);

  const isAdmin = employee ? checkIsAdmin(employee) : false;

  const canManagePermissions = employee
    ? checkCanManagePermissions(employee)
    : false;

  const hasScope = (scope: string): boolean => {
    if (!employee) return false;
    return employee.permissions?.includes(scope) || false;
  };

  const canViewModule = (module: string): boolean => {
    if (!employee) return false;
    return checkIsAdmin(employee) || canView(employee, module);
  };

  const canManageModule = (module: string): boolean => {
    if (!employee) return false;
    return checkIsAdmin(employee) || canManage(employee, module);
  };

  const canCreateInModule = (module: string): boolean => {
    if (!employee) return false;
    return checkIsAdmin(employee) || canCreate(employee, module);
  };

  const refresh = async () => {
    cachedEmployee = null;
    cachedUserId = null;
    setLoading(true);
    await fetchEmployee();
  };

  return {
    employee,
    currentEmployee: employee,
    loading,
    isAdmin,
    canManagePermissions,
    hasScope,
    canViewModule,
    canManageModule,
    canCreateInModule,
    refresh,
  };
}
