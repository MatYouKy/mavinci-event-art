import { createApi } from '@reduxjs/toolkit/query/react';
import { supabaseTableBaseQuery } from '@/lib/rtkq/supabaseTableBaseQuery';

// Types
export interface EventPhaseType {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  default_duration_hours: number;
  is_active: boolean;
  sequence_priority: number;
  created_at: string;
  updated_at: string;
}

export interface EventPhase {
  id: string;
  event_id: string;
  phase_type_id: string;
  name: string;
  description: string | null;
  start_time: string;
  end_time: string;
  sequence_order: number;
  color: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  phase_type?: EventPhaseType;
}

export interface EventPhaseAssignment {
  id: string;
  phase_id: string;
  employee_id: string;
  assignment_start: string;
  assignment_end: string;
  phase_work_start: string;
  phase_work_end: string;
  invitation_status: 'pending' | 'accepted' | 'rejected';
  invitation_sent_at: string;
  invitation_responded_at: string | null;
  role: string | null;
  travel_to_notes: string | null;
  travel_from_notes: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface EventPhaseEquipment {
  id: string;
  phase_id: string;
  equipment_item_id: string | null;
  equipment_kit_id: string | null;
  cable_id: string | null;
  assigned_start: string;
  assigned_end: string;
  quantity: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface EventPhaseVehicle {
  id: string;
  phase_id: string;
  vehicle_id: string;
  driver_id: string | null;
  assigned_start: string;
  assigned_end: string;
  purpose: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface PhaseConflict {
  phase_id: string;
  event_id: string;
  event_name: string;
  phase_name: string;
  assignment_start?: string;
  assignment_end?: string;
  assigned_start?: string;
  assigned_end?: string;
}

export interface AlternativeEquipment {
  item_id: string;
  name: string;
  model: string;
  category_name: string;
  is_available: boolean;
}

export interface CreatePhaseInput {
  event_id: string;
  phase_type_id: string;
  name: string;
  description?: string;
  start_time: string;
  end_time: string;
  sequence_order: number;
  color?: string;
  notes?: string;
}

export interface UpdatePhaseInput {
  id: string;
  name?: string;
  description?: string;
  start_time?: string;
  end_time?: string;
  sequence_order?: number;
  color?: string;
  notes?: string;
}

export interface CreatePhaseAssignmentInput {
  phase_id: string;
  employee_id: string;
  assignment_start: string;
  assignment_end: string;
  phase_work_start: string;
  phase_work_end: string;
  role?: string;
  travel_to_notes?: string;
  travel_from_notes?: string;
  notes?: string;
}

export interface UpdatePhaseAssignmentInput {
  id: string;
  assignment_start?: string;
  assignment_end?: string;
  phase_work_start?: string;
  phase_work_end?: string;
  invitation_status?: 'pending' | 'accepted' | 'rejected';
  role?: string;
  travel_to_notes?: string;
  travel_from_notes?: string;
  notes?: string;
}

export const eventPhasesApi = createApi({
  reducerPath: 'eventPhasesApi',
  baseQuery: supabaseTableBaseQuery,
  tagTypes: ['PhaseTypes', 'Phases', 'PhaseAssignments', 'PhaseEquipment', 'PhaseVehicles'],
  endpoints: (builder) => ({
    // Phase Types
    getPhaseTypes: builder.query<EventPhaseType[], void>({
      query: () => ({
        table: 'event_phase_types',
        select: '*',
        order: { column: 'sequence_priority', ascending: true },
        filters: [{ column: 'is_active', operator: 'eq', value: true }],
      }),
      providesTags: ['PhaseTypes'],
    }),

    createPhaseType: builder.mutation<EventPhaseType, Partial<EventPhaseType>>({
      query: (data) => ({
        table: 'event_phase_types',
        method: 'insert',
        data,
      }),
      invalidatesTags: ['PhaseTypes'],
    }),

    updatePhaseType: builder.mutation<EventPhaseType, { id: string; data: Partial<EventPhaseType> }>({
      query: ({ id, data }) => ({
        table: 'event_phase_types',
        method: 'update',
        id,
        data,
      }),
      invalidatesTags: ['PhaseTypes'],
    }),

    // Event Phases
    getEventPhases: builder.query<EventPhase[], string>({
      query: (eventId) => ({
        table: 'event_phases',
        select: '*, phase_type:event_phase_types(*)',
        filters: [{ column: 'event_id', operator: 'eq', value: eventId }],
        order: { column: 'sequence_order', ascending: true },
      }),
      providesTags: (result, error, eventId) => [{ type: 'Phases', id: eventId }],
    }),

    createPhase: builder.mutation<EventPhase, CreatePhaseInput>({
      query: (data) => ({
        table: 'event_phases',
        method: 'insert',
        data,
      }),
      invalidatesTags: (result, error, arg) => [{ type: 'Phases', id: arg.event_id }],
    }),

    updatePhase: builder.mutation<EventPhase, UpdatePhaseInput>({
      query: ({ id, ...data }) => ({
        table: 'event_phases',
        method: 'update',
        id,
        data,
      }),
      invalidatesTags: (result) => result ? [{ type: 'Phases', id: result.event_id }] : [],
    }),

    deletePhase: builder.mutation<void, string>({
      query: (id) => ({
        table: 'event_phases',
        method: 'delete',
        id,
      }),
      invalidatesTags: ['Phases'],
    }),

    // Phase Assignments
    getPhaseAssignments: builder.query<EventPhaseAssignment[], string>({
      query: (phaseId) => ({
        table: 'event_phase_assignments',
        select: '*',
        filters: [{ column: 'phase_id', operator: 'eq', value: phaseId }],
      }),
      providesTags: (result, error, phaseId) => [{ type: 'PhaseAssignments', id: phaseId }],
    }),

    createPhaseAssignment: builder.mutation<EventPhaseAssignment, CreatePhaseAssignmentInput>({
      query: (data) => ({
        table: 'event_phase_assignments',
        method: 'insert',
        data,
      }),
      invalidatesTags: (result, error, arg) => [{ type: 'PhaseAssignments', id: arg.phase_id }],
    }),

    updatePhaseAssignment: builder.mutation<EventPhaseAssignment, UpdatePhaseAssignmentInput>({
      query: ({ id, ...data }) => ({
        table: 'event_phase_assignments',
        method: 'update',
        id,
        data: {
          ...data,
          invitation_responded_at: data.invitation_status ? new Date().toISOString() : undefined,
        },
      }),
      invalidatesTags: (result) => result ? [{ type: 'PhaseAssignments', id: result.phase_id }] : [],
    }),

    deletePhaseAssignment: builder.mutation<void, string>({
      query: (id) => ({
        table: 'event_phase_assignments',
        method: 'delete',
        id,
      }),
      invalidatesTags: ['PhaseAssignments'],
    }),

    // Phase Equipment
    getPhaseEquipment: builder.query<EventPhaseEquipment[], string>({
      query: (phaseId) => ({
        table: 'event_phase_equipment',
        select: '*',
        filters: [{ column: 'phase_id', operator: 'eq', value: phaseId }],
      }),
      providesTags: (result, error, phaseId) => [{ type: 'PhaseEquipment', id: phaseId }],
    }),

    createPhaseEquipment: builder.mutation<EventPhaseEquipment, Partial<EventPhaseEquipment>>({
      query: (data) => ({
        table: 'event_phase_equipment',
        method: 'insert',
        data,
      }),
      invalidatesTags: (result, error, arg) =>
        arg.phase_id ? [{ type: 'PhaseEquipment', id: arg.phase_id }] : [],
    }),

    deletePhaseEquipment: builder.mutation<void, string>({
      query: (id) => ({
        table: 'event_phase_equipment',
        method: 'delete',
        id,
      }),
      invalidatesTags: ['PhaseEquipment'],
    }),

    // Phase Vehicles
    getPhaseVehicles: builder.query<EventPhaseVehicle[], string>({
      query: (phaseId) => ({
        table: 'event_phase_vehicles',
        select: '*',
        filters: [{ column: 'phase_id', operator: 'eq', value: phaseId }],
      }),
      providesTags: (result, error, phaseId) => [{ type: 'PhaseVehicles', id: phaseId }],
    }),

    createPhaseVehicle: builder.mutation<EventPhaseVehicle, Partial<EventPhaseVehicle>>({
      query: (data) => ({
        table: 'event_phase_vehicles',
        method: 'insert',
        data,
      }),
      invalidatesTags: (result, error, arg) =>
        arg.phase_id ? [{ type: 'PhaseVehicles', id: arg.phase_id }] : [],
    }),

    deletePhaseVehicle: builder.mutation<void, string>({
      query: (id) => ({
        table: 'event_phase_vehicles',
        method: 'delete',
        id,
      }),
      invalidatesTags: ['PhaseVehicles'],
    }),

    // Conflict Detection
    getEmployeeConflicts: builder.query<PhaseConflict[], {
      employeeId: string;
      startTime: string;
      endTime: string;
      excludeAssignmentId?: string;
    }>({
      queryFn: async ({ employeeId, startTime, endTime, excludeAssignmentId }) => {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();

        const { data, error } = await supabase.rpc('get_employee_phase_conflicts', {
          p_employee_id: employeeId,
          p_start_time: startTime,
          p_end_time: endTime,
          p_exclude_assignment_id: excludeAssignmentId || null,
        });

        if (error) return { error };
        return { data: data || [] };
      },
    }),

    getEquipmentConflicts: builder.query<PhaseConflict[], {
      equipmentItemId: string;
      startTime: string;
      endTime: string;
      excludeAssignmentId?: string;
    }>({
      queryFn: async ({ equipmentItemId, startTime, endTime, excludeAssignmentId }) => {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();

        const { data, error } = await supabase.rpc('get_equipment_phase_conflicts', {
          p_equipment_item_id: equipmentItemId,
          p_start_time: startTime,
          p_end_time: endTime,
          p_exclude_assignment_id: excludeAssignmentId || null,
        });

        if (error) return { error };
        return { data: data || [] };
      },
    }),

    getAlternativeEquipment: builder.query<AlternativeEquipment[], {
      equipmentItemId: string;
      startTime: string;
      endTime: string;
    }>({
      queryFn: async ({ equipmentItemId, startTime, endTime }) => {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();

        const { data, error } = await supabase.rpc('get_alternative_equipment', {
          p_equipment_item_id: equipmentItemId,
          p_start_time: startTime,
          p_end_time: endTime,
        });

        if (error) return { error };
        return { data: data || [] };
      },
    }),
  }),
});

export const {
  useGetPhaseTypesQuery,
  useCreatePhaseTypeMutation,
  useUpdatePhaseTypeMutation,
  useGetEventPhasesQuery,
  useCreatePhaseMutation,
  useUpdatePhaseMutation,
  useDeletePhaseMutation,
  useGetPhaseAssignmentsQuery,
  useCreatePhaseAssignmentMutation,
  useUpdatePhaseAssignmentMutation,
  useDeletePhaseAssignmentMutation,
  useGetPhaseEquipmentQuery,
  useCreatePhaseEquipmentMutation,
  useDeletePhaseEquipmentMutation,
  useGetPhaseVehiclesQuery,
  useCreatePhaseVehicleMutation,
  useDeletePhaseVehicleMutation,
  useGetEmployeeConflictsQuery,
  useLazyGetEmployeeConflictsQuery,
  useGetEquipmentConflictsQuery,
  useLazyGetEquipmentConflictsQuery,
  useGetAlternativeEquipmentQuery,
  useLazyGetAlternativeEquipmentQuery,
} = eventPhasesApi;
