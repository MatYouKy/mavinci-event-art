import { useCallback } from 'react';
import {
  useGetEventAgendaQuery,
  useAddAgendaItemMutation,
  useUpdateAgendaItemMutation,
  useDeleteAgendaItemMutation,
} from '@/app/(crm)/crm/events/store/api/eventsApi';
import { useSnackbar } from '@/contexts/SnackbarContext';

export function useEventAgenda(eventId: string) {
  const { showSnackbar } = useSnackbar();

  const {
    data: agendaItems = [],
    isLoading,
    error,
    refetch,
  } = useGetEventAgendaQuery(eventId, {
    skip: !eventId,
  });

  const [addItem, { isLoading: isAdding }] = useAddAgendaItemMutation();
  const [updateItem, { isLoading: isUpdating }] = useUpdateAgendaItemMutation();
  const [deleteItem, { isLoading: isDeleting }] = useDeleteAgendaItemMutation();

  const handleAddItem = useCallback(
    async (agendaData: any) => {
      try {
        await addItem({ eventId, agendaData }).unwrap();
        showSnackbar('Pozycja agendy dodana', 'success');
        return true;
      } catch (error: any) {
        showSnackbar(`Błąd: ${error.message}`, 'error');
        return false;
      }
    },
    [eventId, addItem, showSnackbar],
  );

  const handleUpdateItem = useCallback(
    async (id: string, data: any) => {
      try {
        await updateItem({ id, eventId, data }).unwrap();
        showSnackbar('Pozycja agendy zaktualizowana', 'success');
        return true;
      } catch (error: any) {
        showSnackbar(`Błąd: ${error.message}`, 'error');
        return false;
      }
    },
    [eventId, updateItem, showSnackbar],
  );

  const handleDeleteItem = useCallback(
    async (id: string) => {
      try {
        await deleteItem({ id, eventId }).unwrap();
        showSnackbar('Pozycja agendy usunięta', 'success');
        return true;
      } catch (error: any) {
        showSnackbar(`Błąd: ${error.message}`, 'error');
        return false;
      }
    },
    [eventId, deleteItem, showSnackbar],
  );

  return {
    agendaItems,
    isLoading,
    error,
    refetch,
    addItem: handleAddItem,
    updateItem: handleUpdateItem,
    deleteItem: handleDeleteItem,
    isAdding,
    isUpdating,
    isDeleting,
  };
}
