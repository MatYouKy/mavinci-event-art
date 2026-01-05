import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { supabase } from '@/lib/supabase';

import { IEvent } from '../../type';

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
    'EventLogistics',
  ],
  endpoints: (builder) => ({
    // Pobierz listę wydarzeń (kalendarz)
    getEventsList: builder.query<IEvent[], GetEventsListParams | void>({
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
          const events = (data || []) as IEvent[];

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

    getEventById: builder.query<IEvent, string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq('id', eventId)
            .single();
          if (error) throw error;
          return { data: data as IEvent };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      providesTags: (result, error, id) => [{ type: 'EventDetails', id }],
    }),

    // Pobierz szczegóły wydarzenia
    getEventDetails: builder.query<IEvent, string>({
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

          const eventDetails: IEvent = {
            ...data.event,
            organization: data.organization || null,
            contact_person: data.contact_person || null,
            category: data.category || null,
            creator: data.creator || null,
            employees: data.employees || [],
            equipment: data.equipment || [],
            vehicles: data.vehicles || [],
            offers: data.offers || [],
            event_attachments: data.event_attachments || [],
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
    createEvent: builder.mutation<IEvent, Partial<IEvent>>({
      async queryFn(newEvent) {
        try {
          const { data, error } = await supabase.from('events').insert(newEvent).select().single();

          if (error) {
            return {
              error: { status: 'CUSTOM_ERROR', error: error.message } as unknown as EventsApiError,
            };
          }

          return { data: data as IEvent };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      invalidatesTags: [{ type: 'Events', id: 'LIST' }],
    }),

    // Zaktualizuj wydarzenie
    updateEvent: builder.mutation<IEvent, { id: string; data: Partial<IEvent> }>({
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

          return { data: updated as IEvent };
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
        { type: 'EventAuditLog', id },
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
                thumbnail_url,
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
    // ============ EMPLOYEES ENDPOINTS ============
    getEventEmployees: builder.query<any[], string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase
            .from('employee_assignments')
            .select(
              `
              *,
              employee:employees!employee_assignments_employee_id_fkey(
                id,
                name,
                surname,
                avatar_url,
                avatar_metadata
              )
            `,
            )
            .eq('event_id', eventId)
            .order('created_at', { ascending: true });

          if (error) throw error;
          return { data: data || [] };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', message: error.message },
          } as any;
        }
      },
      providesTags: (_result, _error, eventId) => [{ type: 'EventEmployees', id: eventId }],
    }),

    addEventEmployee: builder.mutation<
      any,
      {
        eventId: string;
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
      }
    >({
      async queryFn({ eventId, employeeId, role, responsibilities, access_level_id, permissions }) {
        try {
          const payload = {
            event_id: eventId,
            employee_id: employeeId,
            role: role ?? '',
            responsibilities: responsibilities ?? null,
            access_level_id: access_level_id ?? null,

            can_edit_event: !!permissions?.can_edit_event,
            can_edit_agenda: !!permissions?.can_edit_agenda,
            can_edit_tasks: !!permissions?.can_edit_tasks,
            can_edit_files: !!permissions?.can_edit_files,
            can_edit_equipment: !!permissions?.can_edit_equipment,
            can_invite_members: !!permissions?.can_invite_members,
            can_view_budget: !!permissions?.can_view_budget,
          };

          const { data, error } = await supabase
            .from('employee_assignments')
            .insert(payload)
            .select()
            .single();

          if (error) throw error;

          if (data?.id) {
            try {
              const result = await supabase.functions.invoke('send-event-invitation', {
                body: { assignmentId: data.id },
              });

              if (result.error) {
                console.error('[addEventEmployee] Email function error:', result.error);
              }
            } catch (emailError) {
              console.error('[addEventEmployee] Failed to send invitation email:', emailError);
            }
          }

          return { data };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      invalidatesTags: (_res, _err, { eventId }) => [{ type: 'EventEmployees', id: eventId }],
    }),

    removeEventEmployee: builder.mutation<void, { eventId: string; employeeId: string }>({
      async queryFn({ eventId, employeeId }) {
        try {
          const { error } = await supabase
            .from('employee_assignments')
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
      invalidatesTags: (_res, _err, { eventId }) => [{ type: 'EventEmployees', id: eventId }],
    }),

    deleteEventOffer: builder.mutation<{ success: true }, { eventId: string; offerId: string }>({
      async queryFn({ offerId }) {
        try {
          const { error } = await supabase.from('offers').delete().eq('id', offerId);
          if (error) throw error;
          return { data: { success: true } };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      invalidatesTags: (_res, _err, { eventId, offerId }) => [
        { type: 'EventOffers', id: `${eventId}_LIST` },
        { type: 'EventOffers', id: offerId },
        { type: 'EventDetails', id: eventId },
        { type: 'Events', id: eventId },
        { type: 'Events', id: 'LIST' },
        { type: 'EventEquipment', id: eventId },
      ],
    }),

    createEventOffer: builder.mutation<any, { eventId: string; offerData: any }>({
      async queryFn({ eventId, offerData }) {
        try {
          const { data, error } = await supabase
            .from('offers')
            .insert([{ ...offerData, event_id: eventId }])
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
      invalidatesTags: (_res, _err, { eventId }) => [
        { type: 'EventOffers', id: `${eventId}_LIST` },
        { type: 'EventDetails', id: eventId },
        { type: 'Events', id: eventId },
        { type: 'Events', id: 'LIST' },
      ],
    }),

    updateEventOffer: builder.mutation<any, { eventId: string; offerId: string; data: any }>({
      async queryFn({ offerId, data }) {
        try {
          const { data: updated, error } = await supabase
            .from('offers')
            .update(data)
            .eq('id', offerId)
            .select()
            .single();

          if (error) throw error;
          return { data: updated };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', error: error.message } as unknown as EventsApiError,
          };
        }
      },
      invalidatesTags: (_res, _err, { eventId, offerId }) => [
        { type: 'EventOffers', id: `${eventId}_LIST` },
        { type: 'EventOffers', id: offerId },
        { type: 'EventDetails', id: eventId },
        { type: 'Events', id: eventId },
        { type: 'Events', id: 'LIST' },
      ],
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
      providesTags: (result, _error, eventId) => [
        { type: 'EventOffers', id: `${eventId}_LIST` },
        ...(result || []).map((offer: any) => ({ type: 'EventOffers' as const, id: offer.id })),
      ],
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
              employee:employees!event_audit_log_employee_id_fkey(
                id,
                name,
                surname,
                nickname,
                avatar_url,
                avatar_metadata,
                occupation,
                email
              )
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
    getEventLogistics: builder.query<
      { vehicles: any[]; timeline: any[]; loadingItems: any[] },
      { eventId: string; canManage: boolean; employeeId?: string | null }
    >({
      async queryFn({ eventId, canManage, employeeId }) {
        try {
          const [vehiclesRes, conflictsRes, timelineRes, loadingRes] = await Promise.all([
            supabase
              .from('event_vehicles')
              .select(
                `
            *,
            vehicles!event_vehicles_vehicle_id_fkey(name, registration_number, fuel_type,thumb_url ),
            trailer:vehicles!event_vehicles_trailer_vehicle_id_fkey(name, registration_number, fuel_type),
            driver:employees!event_vehicles_driver_id_fkey(id, name, surname)
          `,
              )
              .eq('event_id', eventId)
              .order('created_at', { ascending: true }),

            supabase
              .from('vehicle_reservation_conflicts')
              .select('*')
              .or(`event_id_1.eq.${eventId},event_id_2.eq.${eventId}`),

            supabase
              .from('event_logistics_timeline')
              .select(`*, responsible_employee:employees(name, surname)`)
              .eq('event_id', eventId)
              .order('sort_order', { ascending: true }),

            supabase
              .from('event_loading_checklist')
              .select(`*, vehicles(name)`)
              .eq('event_id', eventId)
              .order('sort_order', { ascending: true }),
          ]);

          if (vehiclesRes.error) throw vehiclesRes.error;
          if (conflictsRes.error) throw conflictsRes.error;
          if (timelineRes.error) throw timelineRes.error;
          if (loadingRes.error) throw loadingRes.error;

          const conflictCounts: Record<string, number> = {};
          (conflictsRes.data || []).forEach((conflict: any) => {
            const key = conflict.reservation_id;
            conflictCounts[key] = (conflictCounts[key] || 0) + 1;
          });

          let vehiclesWithConflicts = (vehiclesRes.data || []).map((v: any) => ({
            ...v,
            conflicts_count: conflictCounts[v.id] || 0,
          }));

          if (!canManage && employeeId) {
            vehiclesWithConflicts = vehiclesWithConflicts.filter(
              (v: any) => v.driver_id === employeeId,
            );
          }

          return {
            data: {
              vehicles: vehiclesWithConflicts,
              timeline: timelineRes.data || [],
              loadingItems: loadingRes.data || [],
            },
          };
        } catch (error: any) {
          return {
            error: { status: 'FETCH_ERROR', message: error?.message ?? 'Unknown error' } as any,
          };
        }
      },
      providesTags: (_res, _err, arg) => [{ type: 'EventLogistics', id: arg.eventId }],
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
  useCreateEventOfferMutation,
  useDeleteEventOfferMutation,
  useUpdateEventOfferMutation,
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
  useGetEventLogisticsQuery,
  useLazyGetEventLogisticsQuery,
} = eventsApi;
