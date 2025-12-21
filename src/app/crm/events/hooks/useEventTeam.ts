import { useCallback } from 'react';
import {
  useGetEventEmployeesQuery,
  useAddEventEmployeeMutation,
  useRemoveEventEmployeeMutation,
} from '@/app/crm/events/store/api/eventsApi';
import { useSnackbar } from '@/contexts/SnackbarContext';

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


  const [addEmployee, { isLoading: isAdding }] = useAddEventEmployeeMutation();
  const [removeEmployee, { isLoading: isRemoving }] = useRemoveEventEmployeeMutation();

  const handleAddEmployee = useCallback(
    async (payload: {
      employeeId: string;
      role?: string;
      responsibilities?: string | null;
      access_level_id?: string | null;
      permissions?: {
        can_edit_event?: boolean;
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
        showSnackbar('Pracownik dodany do zespołu', 'success');
        return true;
      } catch (error: any) {
        showSnackbar(`Błąd: ${error.message}`, 'error');
        return false;
      }
    },
    [eventId, addEmployee, showSnackbar],
  );

  const handleRemoveEmployee = useCallback(
    async (employeeId: string) => {
      try {
        await removeEmployee({ eventId, employeeId }).unwrap();
        showSnackbar('Pracownik usunięty z zespołu', 'success');
        return true;
      } catch (error: any) {
        showSnackbar(`Błąd: ${error.message}`, 'error');
        return false;
      }
    },
    [eventId, removeEmployee, showSnackbar],
  );

  return {
    employees,
    isLoading,
    error,
    refetch,
    addEmployee: handleAddEmployee,
    removeEmployee: handleRemoveEmployee,
    isAdding,
    isRemoving,
  };
}
