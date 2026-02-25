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
  phase_work_start: string | null;
  phase_work_end: string | null;
  invitation_status: 'pending' | 'accepted' | 'rejected';
  invitation_sent_at: string;
  invitation_responded_at: string | null;
  role: string | null;
  travel_to_notes: string | null;
  travel_from_notes: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  employee?: {
    id: string;
    name: string;
    surname: string;
    email?: string;
    phone?: string;
  };
}

export interface EventPhaseEquipment {
  id: string;
  phase_id: string;
  equipment_item_id: string | null;
  kit_id: string | null;
  cable_id: string | null;
  assigned_start: string;
  assigned_end: string;
  quantity: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventPhaseVehicle {
  id: string;
  phase_id: string;
  vehicle_id: string;
  assigned_start: string;
  assigned_end: string;
  driver_id: string | null;
  purpose: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PhaseConflict {
  phase_id: string;
  phase_name: string;
  event_id: string;
  event_name: string;
  start_time: string;
  end_time: string;
}

export interface AlternativeEquipment {
  equipment_item_id: string;
  equipment_name: string;
  available: boolean;
}

// Input types
export interface CreatePhaseInput {
  event_id: string;
  phase_type_id: string;
  name: string;
  description?: string;
  start_time: string;
  end_time: string;
  sequence_order?: number;
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
  phase_work_start: string | null;
  phase_work_end: string | null;
  invitation_status?: 'pending' | 'accepted' | 'rejected';
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
  baseQuery: supabaseTableBaseQuery(),
  tagTypes: ['PhaseTypes', 'Phases', 'PhaseAssignments', 'PhaseEquipment', 'PhaseVehicles'],
  endpoints: (builder) => ({
    // Phase Types
    getPhaseTypes: builder.query<EventPhaseType[], void>({
      query: () => ({
        table: 'event_phase_types',
        method: 'select',
        select: '*',
        match: { is_active: true },
        order: { column: 'sequence_priority', ascending: true },
      }),
      providesTags: ['PhaseTypes'],
    }),

    createPhaseType: builder.mutation<EventPhaseType, Partial<EventPhaseType>>({
      query: (data) => ({
        table: 'event_phase_types',
        method: 'insert',
        data,
        select: '*',
      }),
      invalidatesTags: ['PhaseTypes'],
    }),

    updatePhaseType: builder.mutation<EventPhaseType, { id: string; data: Partial<EventPhaseType> }>({
      query: ({ id, data }) => ({
        table: 'event_phase_types',
        method: 'update',
        match: { id },
        data,
        select: '*',
      }),
      invalidatesTags: ['PhaseTypes'],
    }),

    // Event Phases
    getEventPhases: builder.query<EventPhase[], string>({
      query: (eventId) => ({
        table: 'event_phases',
        method: 'select',
        select: '*, phase_type:event_phase_types(*)',
        match: { event_id: eventId },
        order: { column: 'sequence_order', ascending: true },
      }),
      providesTags: (result, error, eventId) => [{ type: 'Phases', id: eventId }],
    }),

    createPhase: builder.mutation<EventPhase, CreatePhaseInput>({
      query: (data) => ({
        table: 'event_phases',
        method: 'insert',
        data,
        select: '*',
      }),
      invalidatesTags: (result, error, arg) => [{ type: 'Phases', id: arg.event_id }],
    }),

    updatePhase: builder.mutation<EventPhase, UpdatePhaseInput>({
      query: ({ id, ...data }) => ({
        table: 'event_phases',
        method: 'update',
        match: { id },
        data,
        select: '*',
      }),
      invalidatesTags: (result) => result ? [{ type: 'Phases', id: result.event_id }] : [],
    }),

    deletePhase: builder.mutation<void, string>({
      query: (id) => ({
        table: 'event_phases',
        method: 'delete',
        match: { id },
      }),
      invalidatesTags: ['Phases'],
    }),

    // Phase Assignments

    // Phase Assignments
    getPhaseAssignments: builder.query<EventPhaseAssignment[], string>({
      query: (phaseId) => ({
        table: 'event_phase_assignments',
        method: 'select',
        // ✅ NIE embedujemy employees — bo masz więcej niż 1 relację i PostgREST nie wie którą wybrać
        // ✅ bierzemy tylko pola z tabeli assignments
        select: `*,
        employee:employees!event_phase_assignments_employee_id_fkey(*),
        created_by_employee:employees!event_phase_assignments_created_by_fkey(id,name,surname,avatar_url)
        `,
        match: { phase_id: phaseId },
      }),
      providesTags: (result, error, phaseId) => [{ type: 'PhaseAssignments', id: phaseId }],
    }),

    createPhaseAssignment: builder.mutation<EventPhaseAssignment, CreatePhaseAssignmentInput>({
      query: (data) => ({
        table: 'event_phase_assignments',
        method: 'insert',
        data,
        // ✅ też bez embed — inaczej insert potrafi wywalić tym samym błędem relacji
        select: `*,
        employee:employees!event_phase_assignments_employee_id_fkey(*),
        created_by_employee:employees!event_phase_assignments_created_by_fkey(id,name,surname,avatar_url)
        `,
      }),
      invalidatesTags: (result, error, arg) => [{ type: 'PhaseAssignments', id: arg.phase_id }],
    }),

    updatePhaseAssignment: builder.mutation<EventPhaseAssignment, UpdatePhaseAssignmentInput>({
      query: ({ id, ...data }) => ({
        table: 'event_phase_assignments',
        method: 'update',
        match: { id },
        data,
        select: '*',
      }),
      invalidatesTags: (result) => (result ? [{ type: 'PhaseAssignments', id: result.phase_id }] : []),
    }),

    // ✅ WAŻNE: delete przyjmuje też phase_id, żeby odświeżyć właściwą listę
    deletePhaseAssignment: builder.mutation<void, { id: string; phase_id: string }>({
      query: ({ id }) => ({
        table: 'event_phase_assignments',
        method: 'delete',
        match: { id },
      }),
      invalidatesTags: (_res, _err, arg) => [{ type: 'PhaseAssignments', id: arg.phase_id }],
    }),

    // Phase Equipment
    getPhaseEquipment: builder.query<EventPhaseEquipment[], string>({
      query: (phaseId) => ({
        table: 'event_phase_equipment',
        method: 'select',
        select: '*',
        match: { phase_id: phaseId },
      }),
      providesTags: (result, error, phaseId) => [{ type: 'PhaseEquipment', id: phaseId }],
    }),

    createPhaseEquipment: builder.mutation<EventPhaseEquipment, Partial<EventPhaseEquipment>>({
      query: (data) => ({
        table: 'event_phase_equipment',
        method: 'insert',
        data,
        select: '*',
      }),
      invalidatesTags: (result, error, arg) => [{ type: 'PhaseEquipment', id: arg.phase_id }],
    }),

    deletePhaseEquipment: builder.mutation<void, string>({
      query: (id) => ({
        table: 'event_phase_equipment',
        method: 'delete',
        match: { id },
      }),
      invalidatesTags: ['PhaseEquipment'],
    }),

    // Phase Vehicles
    getPhaseVehicles: builder.query<EventPhaseVehicle[], string>({
      query: (phaseId) => ({
        table: 'event_phase_vehicles',
        method: 'select',
        select: '*',
        match: { phase_id: phaseId },
      }),
      providesTags: (result, error, phaseId) => [{ type: 'PhaseVehicles', id: phaseId }],
    }),

    createPhaseVehicle: builder.mutation<EventPhaseVehicle, Partial<EventPhaseVehicle>>({
      query: (data) => ({
        table: 'event_phase_vehicles',
        method: 'insert',
        data,
        select: '*',
      }),
      invalidatesTags: (result, error, arg) => [{ type: 'PhaseVehicles', id: arg.phase_id }],
    }),

    deletePhaseVehicle: builder.mutation<void, string>({
      query: (id) => ({
        table: 'event_phase_vehicles',
        method: 'delete',
        match: { id },
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
        const { supabase } = await import('@/lib/supabase/client');

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
        const { supabase } = await import('@/lib/supabase/client');

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
        const { supabase } = await import('@/lib/supabase/client');

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
  useLazyGetEmployeeConflictsQuery,
  useLazyGetEquipmentConflictsQuery,
  useLazyGetAlternativeEquipmentQuery,
} = eventPhasesApi;
