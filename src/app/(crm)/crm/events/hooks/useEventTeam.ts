import { useCallback, useEffect, useState } from 'react';
import {
  useGetEventEmployeesQuery,
  useAddEventEmployeeMutation,
  useRemoveEventEmployeeMutation,
} from '@/app/(crm)/crm/events/store/api/eventsApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';

export function useEventTeam(eventId: string) {
  const { showSnackbar } = useSnackbar();

  const {
    data: employees = [],
    isLoading,
    error,
    refetch,
  } = useGetEventEmployeesQuery(eventId, {
    skip: !eventId,
  });

  const [responsibilityTeam, setResponsibilityTeam] = useState<any[]>([]);
  const loadResponsibilities = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_event_responsibility_team', { p_event_id: eventId });
    if (!error) setResponsibilityTeam(data || []);
  }, [eventId]);
  useEffect(() => {
    void loadResponsibilities();
    const refresh = () => void loadResponsibilities();
    window.addEventListener('focus', refresh);
    window.addEventListener('realization-manager-changed', refresh);
    const timer = setInterval(refresh, 60000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('realization-manager-changed', refresh);
    };
  }, [loadResponsibilities]);
  const mergedTeam: any[] = employees.map((member: any) => ({
    ...member,
    responsibility_roles: responsibilityTeam.find(person => person.employee_id === member.employee_id)?.responsibility_roles || [],
  }));
  for (const member of responsibilityTeam) {
    if (!mergedTeam.some(person => person.employee_id === member.employee_id)) mergedTeam.push(member);
  }

  const [addEmployee, { isLoading: isAdding }] = useAddEventEmployeeMutation();
  const [removeEmployee, { isLoading: isRemoving }] = useRemoveEventEmployeeMutation();

  const handleAddEmployee = useCallback(
    async (payload: {
      employeeId: string;
      role?: string;
      responsibilities?: string | null;
      access_level_id?: string | null;
      sendInvitation?: boolean;
      includePhases?: boolean;
      permissions?: {
        can_edit_event?: boolean;
        can_edit_phases?: boolean;
        can_edit_agenda?: boolean;
        can_edit_tasks?: boolean;
        can_edit_files?: boolean;
        can_edit_equipment?: boolean;
        can_invite_members?: boolean;
        can_view_budget?: boolean;
      };
    }) => {
      try {
        await addEmployee({ eventId, ...payload }).unwrap();
        await refetch();
        showSnackbar('Pracownik dodany do zespołu', 'success');
        return true;
      } catch (error: any) {
        showSnackbar(`Błąd: ${error.message}`, 'error');
        return false;
      }
    },
    [eventId, addEmployee, refetch, showSnackbar],
  );

  const handleRemoveEmployee = useCallback(
    async (employeeId: string) => {
      try {
        await removeEmployee({ eventId, employeeId }).unwrap();
        await refetch();
        showSnackbar('Pracownik usunięty z zespołu', 'success');
        return true;
      } catch (error: any) {
        showSnackbar(`Błąd: ${error.message}`, 'error');
        return false;
      }
    },
    [eventId, refetch, removeEmployee, showSnackbar],
  );

  // Realtime subscription - auto-refresh przy zmianach w employee_assignments
  useEffect(() => {
    if (!eventId) return;

    // Strona i modal używają tego hooka równocześnie. Każdy efekt musi
    // posiadać własny kanał, również podczas ponownego montowania w StrictMode.
    const channel = supabase
      .channel(`event_team_${eventId}_${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'employee_assignments',
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          void refetch();
          void loadResponsibilities();
        }
      );
    for (const table of ['event_vehicles', 'event_realizations', 'event_warehouse_handoffs', 'offers']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `event_id=eq.${eventId}` }, () => void loadResponsibilities());
    }
    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [eventId, refetch, loadResponsibilities]);

  return {
    employees: mergedTeam,
    isLoading,
    error,
    refetch,
    addEmployee: handleAddEmployee,
    removeEmployee: handleRemoveEmployee,
    isAdding,
    isRemoving,
  };
}
