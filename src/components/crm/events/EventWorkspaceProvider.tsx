'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAppDispatch } from '@/store/hooks';
import { eventsApi } from '@/app/(crm)/crm/events/store/api/eventsApi';
import { eventPhasesApi } from '@/store/api/eventPhasesApi';

type WorkspaceStatus = 'connecting' | 'connected' | 'disconnected';

type EventWorkspaceContextValue = {
  eventId: string;
  status: WorkspaceStatus;
  lastChangeAt: string | null;
  refresh: (topic?: string, phaseId?: string | null) => void;
};

const EventWorkspaceContext = createContext<EventWorkspaceContextValue | null>(null);

const financeTopics = new Set([
  'event_costs',
  'event_commissions',
  'event_cash_transactions',
  'event_payment_milestones',
  'invoices',
  'time_entries',
]);

const subcontractorTopics = new Set([
  'subcontractor_tasks',
  'subcontractor_contracts',
  'event_subcontractor_assignments',
]);

export function EventWorkspaceProvider({
  eventId,
  children,
}: {
  eventId: string;
  children: ReactNode;
}) {
  const dispatch = useAppDispatch();
  const [status, setStatus] = useState<WorkspaceStatus>('connecting');
  const [lastChangeAt, setLastChangeAt] = useState<string | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const invalidate = useCallback(
    (topic = 'events', phaseId?: string | null) => {
      const eventTags: Array<{ type: any; id: string }> = [
        { type: 'EventDetails', id: eventId },
        { type: 'Events', id: eventId },
      ];

      if (topic === 'events') eventTags.push({ type: 'Events', id: 'LIST' });
      if (topic === 'offers') {
        eventTags.push(
          { type: 'EventOffers', id: `${eventId}_LIST` },
          { type: 'EventEquipment', id: eventId },
          { type: 'EventFinances', id: eventId },
        );
      }
      if (topic === 'event_equipment' || topic === 'event_phase_equipment') {
        eventTags.push({ type: 'EventEquipment', id: eventId });
      }
      if (topic === 'employee_assignments' || topic === 'event_phase_assignments') {
        eventTags.push({ type: 'EventEmployees', id: eventId });
      }
      if (topic === 'event_vehicles' || topic === 'event_phase_vehicles') {
        eventTags.push(
          { type: 'EventVehicles', id: eventId },
          { type: 'EventLogistics', id: eventId },
        );
      }
      if (topic === 'event_logistics_timeline' || topic === 'event_loading_checklist') {
        eventTags.push({ type: 'EventLogistics', id: eventId });
      }
      if (topic === 'tasks' || topic === 'task_assignees' || topic === 'task_comments') {
        eventTags.push({ type: 'EventTasks', id: eventId });
      }
      if (topic === 'event_files' || topic === 'event_folders') {
        eventTags.push({ type: 'EventFiles', id: eventId });
      }
      if (topic === 'contracts') eventTags.push({ type: 'EventContracts', id: eventId });
      if (topic === 'event_agendas' || topic === 'event_agenda_items') {
        eventTags.push({ type: 'EventAgenda', id: eventId });
      }
      if (financeTopics.has(topic)) eventTags.push({ type: 'EventFinances', id: eventId });
      if (subcontractorTopics.has(topic)) {
        eventTags.push(
          { type: 'EventSubcontractors', id: eventId },
          { type: 'EventFinances', id: eventId },
          { type: 'EventFiles', id: eventId },
        );
      }

      dispatch(eventsApi.util.invalidateTags(eventTags));

      if (topic === 'event_phases') {
        dispatch(eventPhasesApi.util.invalidateTags([{ type: 'Phases', id: eventId }]));
      }
      if (topic === 'event_phase_assignments') {
        dispatch(
          eventPhasesApi.util.invalidateTags(
            phaseId
              ? [{ type: 'PhaseAssignments', id: phaseId }]
              : ['PhaseAssignments'],
          ),
        );
      }
      if (topic === 'event_phase_equipment') {
        dispatch(
          eventPhasesApi.util.invalidateTags(
            phaseId ? [{ type: 'PhaseEquipment', id: phaseId }] : ['PhaseEquipment'],
          ),
        );
      }
      if (topic === 'event_phase_vehicles') {
        dispatch(
          eventPhasesApi.util.invalidateTags(
            phaseId ? [{ type: 'PhaseVehicles', id: phaseId }] : ['PhaseVehicles'],
          ),
        );
      }
    },
    [dispatch, eventId],
  );

  const refresh = useCallback(
    (topic = 'events', phaseId?: string | null) => {
      invalidate(topic, phaseId);
      const changedAt = new Date().toISOString();
      setLastChangeAt(changedAt);
      channelRef.current?.postMessage({ eventId, topic, phaseId: phaseId || null, changedAt });
    },
    [eventId, invalidate],
  );

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') {
      setStatus('connected');
      return;
    }

    const channel = new BroadcastChannel(`mavinci-event-workspace:${eventId}`);
    channelRef.current = channel;
    channel.onmessage = (message: MessageEvent) => {
      const payload = message.data as {
        eventId?: string;
        topic?: string;
        phaseId?: string | null;
        changedAt?: string;
      };
      if (payload?.eventId !== eventId) return;
      invalidate(payload.topic || 'events', payload.phaseId);
      setLastChangeAt(payload.changedAt || new Date().toISOString());
    };
    setStatus('connected');

    return () => {
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
      setStatus('disconnected');
    };
  }, [eventId, invalidate]);

  const value = useMemo(
    () => ({ eventId, status, lastChangeAt, refresh }),
    [eventId, lastChangeAt, refresh, status],
  );

  return <EventWorkspaceContext.Provider value={value}>{children}</EventWorkspaceContext.Provider>;
}

export function useEventWorkspace() {
  const context = useContext(EventWorkspaceContext);
  if (!context) throw new Error('useEventWorkspace must be used inside EventWorkspaceProvider');
  return context;
}
