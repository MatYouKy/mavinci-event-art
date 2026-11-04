'use client';
import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  eventStepActionNeedsForm,
  eventStepErrorMessage,
  type EventStep,
  type EventStepAction,
  type EventStepsSnapshot,
} from '@/lib/events/steps/eventSteps';

export type EventStepActionRequest = { step: EventStep; action: EventStepAction };
export type EventStepActionInput = { note: string; payload: Record<string, unknown> };

const SUCCESS_MESSAGES: Record<EventStepAction, string> = {
  take: 'Krok jest teraz przypisany do Ciebie.',
  start: 'Zapisano rozpoczęcie kroku.',
  done: 'Krok zamknięty.',
  problem: 'Zgłoszono problem. Kierownik i prowadzący dostaną powiadomienie.',
  reopen: 'Krok otwarty ponownie.',
  skip: 'Krok pominięty.',
};

/**
 * Wykonanie czynności na kroku (RPC update_event_step). Czynności z notatką wymaganą albo z polami zamówienia
 * otwierają okno (`dialog` → EventStepActionDialog), pozostałe wykonują się od razu.
 */
export function useEventStepActions(onSnapshot: (snapshot: EventStepsSnapshot) => void | Promise<void>) {
  const { showSnackbar } = useSnackbar();
  const [pending, setPending] = useState<EventStepActionRequest | null>(null);
  const [request, setRequest] = useState<EventStepActionRequest | null>(null);
  const [formError, setFormError] = useState('');
  const runningRef = useRef(false);
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;

  const execute = useCallback(
    async (target: EventStepActionRequest, input: EventStepActionInput, fromForm: boolean) => {
      if (runningRef.current) return false;
      runningRef.current = true;
      setPending(target);
      if (fromForm) setFormError('');
      try {
        const { data, error } = await supabase.rpc('update_event_step', {
          p_step_id: target.step.id,
          p_action: target.action,
          p_note: input.note.trim() || null,
          p_payload: input.payload,
        });
        if (error) throw error;
        await onSnapshotRef.current(data as EventStepsSnapshot);
        showSnackbar(SUCCESS_MESSAGES[target.action], 'success');
        return true;
      } catch (error) {
        const message = eventStepErrorMessage(error);
        if (fromForm) setFormError(message);
        else showSnackbar(message, 'error');
        return false;
      } finally {
        runningRef.current = false;
        setPending(null);
      }
    },
    [showSnackbar],
  );

  const trigger = useCallback(
    (step: EventStep, action: EventStepAction) => {
      if (runningRef.current) return;
      if (eventStepActionNeedsForm(step, action)) {
        setFormError('');
        setRequest({ step, action });
        return;
      }
      void execute({ step, action }, { note: '', payload: {} }, false);
    },
    [execute],
  );

  const submit = useCallback(
    async (input: EventStepActionInput) => {
      if (!request) return;
      const ok = await execute(request, input, true);
      if (ok) setRequest(null);
    },
    [execute, request],
  );

  const cancel = useCallback(() => {
    if (runningRef.current) return;
    setRequest(null);
    setFormError('');
  }, []);

  return {
    pending,
    trigger,
    dialog: {
      request,
      busy: Boolean(pending && request),
      error: formError,
      onCancel: cancel,
      onSubmit: submit,
    },
  };
}
