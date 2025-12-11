import { useCallback } from 'react';
import {
  useGetEventEmployeesQuery,
  useAddEventEmployeeMutation,
  useRemoveEventEmployeeMutation,
} from '@/store/api/eventsApi';
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
    async (employeeId: string, role?: string) => {
      try {
        await addEmployee({ eventId, employeeId, role }).unwrap();
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
