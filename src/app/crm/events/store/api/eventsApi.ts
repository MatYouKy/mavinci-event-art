import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { supabase } from '@/lib/supabase';

export type EventsApiErrorStatus = 'CUSTOM_ERROR' | 'FETCH_ERROR' | 'NOT_FOUND';

export interface EventsApiError {
  status: EventsApiErrorStatus;
  message: string;
}

export type SelectedEquipment = {
  id: string;
  type: 'item' | 'kit';
  quantity: number;
  notes?: string;
};

export interface CalendarEvent {
  id: string;
  name: string;
  description?: string;
  event_date: string;
  event_end_date?: string | null;
  location?: string;
  status: string;
  budget?: number;
  final_cost?: number;
  notes?: string;
  category_id?: string | null;
  organization_id?: string | null;
  contact_person_id?: string | null;
  created_by?: string;
  created_at?: string;
  organization?: {
    id: string;
    name: string;
    alias?: string | null;
  } | null;
  contact_person?: {
    phone: any;
    email: any;
    id: string;
    first_name: string;
    last_name: string;
    full_name: string;
  } | null;
  category?: {
    id: string;
    name: string;
    color: string;
    custom_icon?: {
      id: string;
      name: string;
      svg_code: string;
    } | null;
  } | null;
  employees?: any[];
  vehicles?: any[];
}

export interface EventDetails extends CalendarEvent {
  client_type: string;
  requires_subcontractors: boolean;
  location_details: any;
  creator?: {
    id: string;
    name: string;
    surname: string;
    avatar_url?: string;
  } | null;
  equipment?: any[];
  offers?: any[];
}

export interface GetEventsListParams {
  start_date?: string | null;
  end_date?: string | null;
  status_filter?: string[] | null;
}

export const eventsApi = createApi({
  reducerPath: 'eventsApi',
  baseQuery: fakeBaseQuery<EventsApiError>(),
  tagTypes: [
    'Events',
    'EventDetails',
    'EventEquipment',
    'EventEmployees',
    'EventOffers',
    'EventFiles',
    'EventTasks',
    'EventChecklists',
    'EventAuditLog',
    'EventSubcontractors',
    'EventVehicles',
    'EventAgenda',
    'EventFinances',
    'EventContracts',
  ],
  endpoints: (builder) => ({
    // Pobierz listę wydarzeń (kalendarz)
    getEventsList: builder.query<CalendarEvent[], GetEventsListParams | void>({
      async queryFn(params) {
        try {
          const parameters = params || {};
          const { data, error } = await supabase.rpc('get_events_list', {
            start_date: parameters.start_date || null,
            end_date: parameters.end_date || null,
            status_filter: parameters.status_filter || null,
          });

          if (error) {
            console.error('Error fetching events list:', error);
            return {
              error: { status: 'CUSTOM_ERROR', error: error.message } as unknown as EventsApiError,
            };
          }

          // RPC zwraca JSON array, więc rzutujemy na array
          const events = (data || []) as CalendarEvent[];

          return { data: events };
        } catch (error: any) {
          console.error('Exception in getEventsList:', error);
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'Events' as const, id })),
              { type: 'Events', id: 'LIST' },
            ]
          : [{ type: 'Events', id: 'LIST' }],
    }),

    getEventById: builder.query<EventDetails, string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq('id', eventId)
            .single();
          if (error) throw error;
          return { data: data as EventDetails };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      providesTags: (result, error, id) => [{ type: 'EventDetails', id }],
    }),

    // Pobierz szczegóły wydarzenia
    getEventDetails: builder.query<EventDetails, string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase.rpc('get_event_details', {
            event_id: eventId,
          });

          if (error) {
            console.error('Error fetching event details:', error);
            return {
              error: {
                status: 'CUSTOM_ERROR',
                error: error.message,
              } as unknown as EventsApiError,
            };
          }

          if (!data || (data as any).error) {
            return {
              error: {
                status: 'NOT_FOUND',
                error: 'Event not found',
              } as unknown as EventsApiError,
            };
          }

          const eventDetails: EventDetails = {
            ...data.event,
            organization: data.organization || null,
            contact_person: data.contact_person || null,
            category: data.category || null,
            creator: data.creator || null,
            employees: data.employees || [],
            equipment: data.equipment || [],
            vehicles: data.vehicles || [],
            offers: data.offers || [],
          };

          return { data: eventDetails };
        } catch (error: any) {
          console.error('Exception in getEventDetails:', error);
          return {
            error: {
              status: 'FETCH_EXCEPTION',
              error: error?.message ?? 'Unexpected error',
            } as unknown as EventsApiError,
          };
        }
      },
      providesTags: (result, error, id) => [{ type: 'EventDetails', id }],
    }),

    // Utwórz nowe wydarzenie
    createEvent: builder.mutation<CalendarEvent, Partial<CalendarEvent>>({
      async queryFn(newEvent) {
        try {
          const { data, error } = await supabase.from('events').insert(newEvent).select().single();

          if (error) {
            return {
              error: { status: 'CUSTOM_ERROR', error: error.message } as unknown as EventsApiError,
            };
          }

          return { data: data as CalendarEvent };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      invalidatesTags: [{ type: 'Events', id: 'LIST' }],
    }),

    // Zaktualizuj wydarzenie
    updateEvent: builder.mutation<CalendarEvent, { id: string; data: Partial<CalendarEvent> }>({
      async queryFn({ id, data }) {
        try {
          const { data: updated, error } = await supabase
            .from('events')
            .update(data)
            .eq('id', id)
            .select()
            .single();

          if (error) {
            return {
              error: { status: 'CUSTOM_ERROR', error: error.message } as unknown as EventsApiError,
            };
          }

          return { data: updated as CalendarEvent };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      invalidatesTags: (result, error, { id }) => [
        { type: 'Events', id },
        { type: 'EventDetails', id },
        { type: 'Events', id: 'LIST' },
      ],
    }),

    // Usuń wydarzenie
    deleteEvent: builder.mutation<void, string>({
      async queryFn(id) {
        try {
          const { error } = await supabase.from('events').delete().eq('id', id);

          if (error) {
            return {
              error: { status: 'CUSTOM_ERROR', error: error.message } as unknown as EventsApiError,
            };
          }

          return { data: undefined };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      invalidatesTags: (result, error, id) => [
        { type: 'Events', id },
        { type: 'Events', id: 'LIST' },
      ],
    }),

    // ============ EQUIPMENT ENDPOINTS ============
    getEventEquipment: builder.query<any[], string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase
            .from('event_equipment')
            .select(
              `
              *,
              equipment:equipment_items(
                name,
                brand,
                model,
                cable_specs,
                thumbnail_url,
                category:warehouse_categories(name)
              ),
              kit:equipment_kits(
                name,
                items:equipment_kit_items(
                  quantity,
                  equipment:equipment_items(
                    name,
                    brand,
                    model,
                    cable_specs,
                    thumbnail_url,
                    category:warehouse_categories(name)
                  )
                )
              )
            `,
            )
            .eq('event_id', eventId)
            .order('created_at', { ascending: true });

          if (error) {
            return {
              error: {
                status: 'CUSTOM_ERROR',
                error: error.message,
              } as unknown as EventsApiError,
            };
          }

          return { data: (data || []) as any[] };
        } catch (error: any) {
          console.error('[getEventEquipment] exception', error);
          return {
            error: {
              status: 'FETCH_ERROR',
              error: error.message ?? 'Unknown error',
            } as unknown as EventsApiError,
          };
        }
      },
      providesTags: (result, error, eventId) => [{ type: 'EventEquipment', id: eventId }],
    }),

    addEventEquipment: builder.mutation<
      any[], // zwrócone wiersze
      { eventId: string; items: SelectedEquipment[] }
    >({
      async queryFn({ eventId, items }) {
        try {
          // 🔧 przygotuj dokładne rekordy pod strukturę tabeli event_equipment
          const rowsToInsert = items.map((item) => ({
            event_id: eventId,
            equipment_id: item.type === 'item' ? item.id : null,
            kit_id: item.type === 'kit' ? item.id : null,
            quantity: item.quantity,
            notes: item.notes ?? null,
          }));

          const { data, error } = await supabase
            .from('event_equipment')
            .insert(rowsToInsert)
            .select(); // ⬅️ bez .single(), bo wstawiasz wiele

          console.log('[addEventEquipment] rowsToInsert', rowsToInsert);
          console.log('[addEventEquipment] data', data);
          console.log('[addEventEquipment] error', error);

          if (error) {
            return {
              error: {
                status: 'FETCH_ERROR',
                error: error.message,
              } as unknown as EventsApiError,
            };
          }

          return { data: (data || []) as any[] };
        } catch (error: any) {
          console.error('[addEventEquipment] exception', error);
          return {
            error: {
              status: 'FETCH_ERROR',
              error: error.message ?? 'Unknown error',
            } as unknown as EventsApiError,
          };
        }
      },
      invalidatesTags: (result, error, { eventId }) => [{ type: 'EventEquipment', id: eventId }],
    }),

    updateEventEquipment: builder.mutation<
      any, // zaktualizowany rekord
      { id: string; eventId: string; data: any }
    >({
      async queryFn({ id, eventId, data }) {
        try {
          // Uważaj, żeby nie nadpisywać event_id na coś dziwnego
          const payload = { ...data };

          const { data: updated, error } = await supabase
            .from('event_equipment')
            .update(payload)
            .eq('id', id)
            .select()
            .single();

          console.log('[updateEventEquipment] id', id);
          console.log('[updateEventEquipment] payload', payload);
          console.log('[updateEventEquipment] updated', updated);
          console.log('[updateEventEquipment] error', error);

          if (error) {
            return {
              error: {
                status: 'FETCH_ERROR',
                error: error.message,
              } as unknown as EventsApiError,
            };
          }

          return { data: updated };
        } catch (error: any) {
          console.error('[updateEventEquipment] exception', error);
          return {
            error: {
              status: 'FETCH_ERROR',
              error: error.message ?? 'Unknown error',
            } as unknown as EventsApiError,
          };
        }
      },
      invalidatesTags: (result, error, { eventId }) => [{ type: 'EventEquipment', id: eventId }],
    }),

    removeEventEquipment: builder.mutation<
      { success: true }, // albo void – jak wolisz
      { id: string; eventId: string }
    >({
      async queryFn({ id, eventId }) {
        try {
          const { error } = await supabase.from('event_equipment').delete().eq('id', id);

          console.log('[removeEventEquipment] id', id);
          console.log('[removeEventEquipment] error', error);

          if (error) {
            return {
              error: {
                status: 'FETCH_ERROR',
                error: error.message,
              } as unknown as EventsApiError,
            };
          }

          return { data: { success: true } };
        } catch (error: any) {
          console.error('[removeEventEquipment] exception', error);
          return {
            error: {
              status: 'FETCH_ERROR',
              error: error.message ?? 'Unknown error',
            } as unknown as EventsApiError,
          };
        }
      },
      invalidatesTags: (result, error, { eventId }) => [{ type: 'EventEquipment', id: eventId }],
    }),

    // ============ EMPLOYEES ENDPOINTS ============
    getEventEmployees: builder.query<any[], string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase
            .from('event_employee_assignments')
            .select(
              `
              *,
              employee:employees(id, name, surname, avatar_url, avatar_position)
            `,
            )
            .eq('event_id', eventId)
            .order('created_at', { ascending: true });

          if (error) throw error;
          return { data: data || [] };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      providesTags: (result, error, eventId) => [{ type: 'EventEmployees', id: eventId }],
    }),

    addEventEmployee: builder.mutation<any, { eventId: string; employeeId: string; role?: string }>(
      {
        async queryFn({ eventId, employeeId, role }) {
          try {
            const { data, error } = await supabase
              .from('event_employee_assignments')
              .insert({ event_id: eventId, employee_id: employeeId, role })
              .select()
              .single();

            if (error) throw error;
            return { data };
          } catch (error: any) {
            return {
              error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
            };
          }
        },
        invalidatesTags: (result, error, { eventId }) => [{ type: 'EventEmployees', id: eventId }],
      },
    ),

    removeEventEmployee: builder.mutation<void, { eventId: string; employeeId: string }>({
      async queryFn({ eventId, employeeId }) {
        try {
          const { error } = await supabase
            .from('event_employee_assignments')
            .delete()
            .eq('event_id', eventId)
            .eq('employee_id', employeeId);

          if (error) throw error;
          return { data: undefined };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      invalidatesTags: (result, error, { eventId }) => [{ type: 'EventEmployees', id: eventId }],
    }),

    // ============ OFFERS ENDPOINTS ============
    getEventOffers: builder.query<any[], string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase
            .from('offers')
            .select(
              `
              *,
              organization:organizations!organization_id(name),
              contact:contacts!contact_id(first_name, last_name, full_name),
              creator:employees!created_by(name, surname)
            `,
            )
            .eq('event_id', eventId)
            .order('created_at', { ascending: false });

          if (error) throw error;
          return { data: data || [] };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      providesTags: (result, error, eventId) => [{ type: 'EventOffers', id: eventId }],
    }),

    // ============ AUDIT LOG ENDPOINTS ============
    getEventAuditLog: builder.query<any[], string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase
            .from('event_audit_log')
            .select(
              `
              *,
              user:employees!user_id(name, surname, avatar_url)
            `,
            )
            .eq('event_id', eventId)
            .order('created_at', { ascending: false })
            .limit(100);

          if (error) throw error;
          return { data: data || [] };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      providesTags: (result, error, eventId) => [{ type: 'EventAuditLog', id: eventId }],
    }),

    // ============ TASKS ENDPOINTS ============
    getEventTasks: builder.query<any[], string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase
            .from('tasks')
            .select(
              `
              *,
              creator:employees!created_by(name, surname, avatar_url),
              assignees:task_assignees(
                id,
                employee:employees(id, name, surname, avatar_url)
              )
            `,
            )
            .eq('event_id', eventId)
            .order('created_at', { ascending: false });

          if (error) throw error;
          return { data: data || [] };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      providesTags: (result, error, eventId) => [{ type: 'EventTasks', id: eventId }],
    }),

    // ============ FILES ENDPOINTS ============
    getEventFiles: builder.query<any[], string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase
            .from('event_files')
            .select(
              `
              *,
              uploaded_by_employee:employees!uploaded_by(name, surname)
            `,
            )
            .eq('event_id', eventId)
            .order('created_at', { ascending: false });

          if (error) throw error;
          return { data: data || [] };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      providesTags: (result, error, eventId) => [{ type: 'EventFiles', id: eventId }],
    }),

    // ============ VEHICLES ENDPOINTS ============
    getEventVehicles: builder.query<any[], string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase
            .from('event_vehicles')
            .select(
              `
              *,
              vehicle:vehicles(*),
              driver:employees!driver_id(id, name, surname, avatar_url),
              trailer:vehicles!trailer_id(*)
            `,
            )
            .eq('event_id', eventId)
            .order('created_at', { ascending: true });

          if (error) throw error;
          return { data: data || [] };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      providesTags: (result, error, eventId) => [{ type: 'EventVehicles', id: eventId }],
    }),

    // ============ SUBCONTRACTORS ENDPOINTS ============
    getEventSubcontractors: builder.query<any[], string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase
            .from('event_subcontractor_assignments')
            .select(
              `
              *,
              subcontractor:subcontractors(*)
            `,
            )
            .eq('event_id', eventId)
            .order('created_at', { ascending: true });

          if (error) throw error;
          return { data: data || [] };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      providesTags: (result, error, eventId) => [{ type: 'EventSubcontractors', id: eventId }],
    }),

    // ============ AGENDA ENDPOINTS ============
    getEventAgenda: builder.query<any[], string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase
            .from('event_agendas')
            .select('*')
            .eq('event_id', eventId)
            .order('start_time', { ascending: true });

          if (error) throw error;
          return { data: data || [] };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      providesTags: (result, error, eventId) => [{ type: 'EventAgenda', id: eventId }],
    }),

    addAgendaItem: builder.mutation<any, { eventId: string; agendaData: any }>({
      async queryFn({ eventId, agendaData }) {
        try {
          const { data, error } = await supabase
            .from('event_agendas')
            .insert({ event_id: eventId, ...agendaData })
            .select()
            .single();

          if (error) throw error;
          return { data };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      invalidatesTags: (result, error, { eventId }) => [{ type: 'EventAgenda', id: eventId }],
    }),

    updateAgendaItem: builder.mutation<any, { id: string; eventId: string; data: any }>({
      async queryFn({ id, eventId, data }) {
        try {
          const { error } = await supabase.from('event_agendas').update(data).eq('id', id);

          if (error) throw error;
          return { data: null };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      invalidatesTags: (result, error, { eventId }) => [{ type: 'EventAgenda', id: eventId }],
    }),

    deleteAgendaItem: builder.mutation<void, { id: string; eventId: string }>({
      async queryFn({ id, eventId }) {
        try {
          const { error } = await supabase.from('event_agendas').delete().eq('id', id);

          if (error) throw error;
          return { data: undefined };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      invalidatesTags: (result, error, { eventId }) => [{ type: 'EventAgenda', id: eventId }],
    }),

    // ============ CONTRACTS ENDPOINTS ============
    getEventContracts: builder.query<any[], string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase
            .from('contracts')
            .select(
              `
              *,
              event:events(name),
              organization:organizations(name, alias),
              contact:contacts(first_name, last_name, full_name),
              creator:employees!created_by(name, surname)
            `,
            )
            .eq('event_id', eventId)
            .order('created_at', { ascending: false });

          if (error) throw error;
          return { data: data || [] };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      providesTags: (result, error, eventId) => [{ type: 'EventContracts', id: eventId }],
    }),
  }),
});

export const {
  useGetEventsListQuery,
  useGetEventDetailsQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useDeleteEventMutation,
  useGetEventEquipmentQuery,
  useAddEventEquipmentMutation,
  useUpdateEventEquipmentMutation,
  useRemoveEventEquipmentMutation,
  useGetEventEmployeesQuery,
  useAddEventEmployeeMutation,
  useRemoveEventEmployeeMutation,
  useGetEventOffersQuery,
  useGetEventAuditLogQuery,
  useGetEventTasksQuery,
  useGetEventFilesQuery,
  useGetEventVehiclesQuery,
  useGetEventSubcontractorsQuery,
  useGetEventAgendaQuery,
  useAddAgendaItemMutation,
  useUpdateAgendaItemMutation,
  useDeleteAgendaItemMutation,
  useGetEventContractsQuery,
  useGetEventByIdQuery,
  useLazyGetEventByIdQuery,
} = eventsApi;
