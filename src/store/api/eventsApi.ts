import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { supabase } from '@/lib/supabase';

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
  baseQuery: fakeBaseQuery(),
  tagTypes: ['Events', 'EventDetails'],
  endpoints: (builder) => ({
    // Pobierz listę wydarzeń (kalendarz)
    getEventsList: builder.query<CalendarEvent[], GetEventsListParams | void>({
      async queryFn(params = {}) {
        try {
          const { data, error } = await supabase.rpc('get_events_list', {
            start_date: params.start_date || null,
            end_date: params.end_date || null,
            status_filter: params.status_filter || null,
          });

          if (error) {
            console.error('Error fetching events list:', error);
            return { error: { status: 'CUSTOM_ERROR', error: error.message } };
          }

          // RPC zwraca JSON array, więc rzutujemy na array
          const events = (data || []) as CalendarEvent[];

          return { data: events };
        } catch (error: any) {
          console.error('Exception in getEventsList:', error);
          return { error: { status: 'FETCH_ERROR', error: error.message } };
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

    // Pobierz szczegóły wydarzenia
    getEventDetails: builder.query<EventDetails, string>({
      async queryFn(eventId) {
        try {
          const { data, error } = await supabase.rpc('get_event_details', {
            event_id: eventId,
          });

          if (error) {
            console.error('Error fetching event details:', error);
            return { error: { status: 'CUSTOM_ERROR', error: error.message } };
          }

          if (!data || data.error) {
            return { error: { status: 'NOT_FOUND', error: 'Event not found' } };
          }

          // Połącz event z relacjami
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
          return { error: { status: 'FETCH_ERROR', error: error.message } };
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
            return { error: { status: 'CUSTOM_ERROR', error: error.message } };
          }

          return { data: data as CalendarEvent };
        } catch (error: any) {
          return { error: { status: 'FETCH_ERROR', error: error.message } };
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
            return { error: { status: 'CUSTOM_ERROR', error: error.message } };
          }

          return { data: updated as CalendarEvent };
        } catch (error: any) {
          return { error: { status: 'FETCH_ERROR', error: error.message } };
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
            return { error: { status: 'CUSTOM_ERROR', error: error.message } };
          }

          return { data: undefined };
        } catch (error: any) {
          return { error: { status: 'FETCH_ERROR', error: error.message } };
        }
      },
      invalidatesTags: (result, error, id) => [
        { type: 'Events', id },
        { type: 'Events', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetEventsListQuery,
  useGetEventDetailsQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useDeleteEventMutation,
} = eventsApi;
