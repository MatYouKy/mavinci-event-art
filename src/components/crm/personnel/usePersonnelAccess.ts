 'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
export function usePersonnelAccess() {
  const { employee } = useCurrentEmployee();
  const [access, setAccess] = useState({ loading: true, view: false, manage: false, error: '' });
  useEffect(() => {
    let live = true;
    if (!employee) return;
    setAccess({ loading: true, view: false, manage: false, error: '' });
    Promise.all([supabase.rpc('personnel_can_access'), supabase.rpc('personnel_can_access', { p_manage: true })]).then(([v,m]) => {
      if (!live) return;
      setAccess({ loading: false, view: v.data === true, manage: m.data === true, error: v.error || m.error ? 'Moduł zespołu jest niedostępny. Sprawdź, czy aktualizacja bazy została wdrożona.' : '' });
    }).catch(() => { if (live) setAccess({ loading: false, view: false, manage: false, error: 'Nie udało się sprawdzić dostępu.' }); });
    return () => { live = false; };
  }, [employee?.id]);
  return access;
}
