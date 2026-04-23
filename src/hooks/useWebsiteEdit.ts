import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { canEditWebsite } from '@/lib/permissions';

interface WebsiteEditEmployee {
  id: string;
  name: string;
  surname: string;
  nickname: string | null;
  email: string;
  role: string;
  access_level: string;
  permissions: string[] | null;
}

export function useWebsiteEdit() {
  const [canEdit, setCanEdit] = useState(false);
  const [employee, setEmployee] = useState<WebsiteEditEmployee | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkPermissions();

    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      checkPermissions();
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  const checkPermissions = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        setCanEdit(false);
        setEmployee(null);
        setLoading(false);
        return;
      }

      const { data: employeeData, error } = await supabase
        .from('employees')
        .select('id, name, surname, nickname, email, role, access_level, permissions')
        .eq('email', session.user.email)
        .maybeSingle();

      if (error || !employeeData) {
        setCanEdit(false);
        setEmployee(null);
        setLoading(false);
        return;
      }

      setEmployee(employeeData as WebsiteEditEmployee);
      setCanEdit(canEditWebsite(employeeData));
      setLoading(false);
    } catch (error) {
      console.error('Error checking website edit permissions:', error);
      setCanEdit(false);
      setEmployee(null);
      setLoading(false);
    }
  };

  return { canEdit, employee, loading };
}
