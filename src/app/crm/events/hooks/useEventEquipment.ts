import { useCallback } from 'react';
import {
  useGetEventEquipmentQuery,
  useAddEventEquipmentMutation,
  useUpdateEventEquipmentMutation,
  useRemoveEventEquipmentMutation,
} from '@/app/crm/events/store/api/eventsApi';
import { useSnackbar } from '@/contexts/SnackbarContext';

export function useEventEquipment(eventId: string) {
  const { showSnackbar } = useSnackbar();

  const {
    data: equipment = [],
    isLoading,
    error,
    refetch,
  } = useGetEventEquipmentQuery(eventId, {
    skip: !eventId,
  });

  const [addEquipment, { isLoading: isAdding }] = useAddEventEquipmentMutation();
  const [updateEquipment, { isLoading: isUpdating }] = useUpdateEventEquipmentMutation();
  const [removeEquipment, { isLoading: isRemoving }] = useRemoveEventEquipmentMutation();

  const handleAddEquipment = useCallback(
    async (equipmentData: any) => {
      try {
        await addEquipment({ eventId, equipmentData }).unwrap();
        showSnackbar('Sprzęt dodany', 'success');
        return true;
      } catch (error: any) {
        showSnackbar(`Błąd: ${error.message}`, 'error');
        return false;
      }
    },
    [eventId, addEquipment, showSnackbar],
  );

  const handleUpdateEquipment = useCallback(
    async (id: string, data: any) => {
      try {
        await updateEquipment({ id, eventId, data }).unwrap();
        showSnackbar('Sprzęt zaktualizowany', 'success');
        return true;
      } catch (error: any) {
        showSnackbar(`Błąd: ${error.message}`, 'error');
        return false;
      }
    },
    [eventId, updateEquipment, showSnackbar],
  );

  const handleRemoveEquipment = useCallback(
    async (id: string) => {
      try {
        await removeEquipment({ id, eventId }).unwrap();
        showSnackbar('Sprzęt usunięty', 'success');
        return true;
      } catch (error: any) {
        showSnackbar(`Błąd: ${error.message}`, 'error');
        return false;
      }
    },
    [eventId, removeEquipment, showSnackbar],
  );

  return {
    equipment,
    isLoading,
    error,
    refetch,
    addEquipment: handleAddEquipment,
    updateEquipment: handleUpdateEquipment,
    removeEquipment: handleRemoveEquipment,
    isAdding,
    isUpdating,
    isRemoving,
  };
}
