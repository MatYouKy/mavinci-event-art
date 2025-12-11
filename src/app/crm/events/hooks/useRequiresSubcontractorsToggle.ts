// useRequiresSubcontractorsToggle.ts
import { useCallback, ChangeEvent } from 'react';
import { EventDetails, useUpdateEventMutation } from '@/app/crm/events/store/api/eventsApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { logChange } from '../[id]/helpers/logChange';

interface UseRequiresSubcontractorsToggleProps {
  eventId: string;
  currentValue: boolean;
}

export function useRequiresSubcontractorsToggle({
  eventId,
  currentValue,
}: UseRequiresSubcontractorsToggleProps) {
  const { showSnackbar } = useSnackbar();
  const [updateEvent, { isLoading }] = useUpdateEventMutation();

  const handleToggle = useCallback(
    async (checked: boolean) => {
      try {
        const oldValue = currentValue;

        await updateEvent({
          id: eventId,
          data: { requires_subcontractors: checked } as Partial<EventDetails>,
        }).unwrap();

        await logChange(
          eventId,
          'updated',
          checked
            ? 'Włączono zapotrzebowanie na podwykonawców'
            : 'Wyłączono zapotrzebowanie na podwykonawców',
          'requires_subcontractors',
          String(oldValue),
          String(checked),
        );

        showSnackbar('Zaktualizowano zapotrzebowanie na podwykonawców', 'success');
      } catch (err) {
        console.error('Error updating requires_subcontractors:', err);
        showSnackbar('Błąd podczas aktualizacji zapotrzebowania na podwykonawców', 'error');
      }
    },
    [eventId, currentValue, updateEvent, showSnackbar],
  );

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      handleToggle(e.target.checked);
    },
    [handleToggle],
  );

  return {
    isUpdatingRequiresSubcontractors: isLoading,
    handleToggle,
    inputProps: {
      checked: currentValue,
      disabled: isLoading,
      onChange,
    },
  };
}