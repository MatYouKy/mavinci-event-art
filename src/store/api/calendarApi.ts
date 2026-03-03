import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { supabase } from '@/lib/supabase/browser';

export interface CalendarEvent {
  id: string;
  name: string;
  event_date: string;
  event_end_date: string | null;
  status: string;
  color?: string;
  location?: string;
  organization?: { name: string } | null;
  category?: { name: string; color?: string } | null;
  is_meeting?: boolean;
  meeting_data?: any;
  assigned_employees?: { id: string; name: string; surname: string }[];
  event_vehicles?: any[];
  event_equipment?: any[];
}

export interface CalendarFilters {
  start_date?: string;
  end_date?: string;
  statuses?: string[];
  categories?: string[];
  clients?: string[];
  employees?: string[];
  current_user_id?: string;
}

export interface CalendarFilterOptions {
  categories: Array<{ id: string; name: string; color: string }>;
  clients: Array<{ id: string; name: string; type: string }>;
  employees: Array<{ id: string; name: string; surname: string }>;
}

export const calendarApi = createApi({
  reducerPath: 'calendarApi',
  baseQuery: fakeBaseQuery(),
  tagTypes: ['CalendarEvents', 'CalendarFilters', 'Meetings', 'TimelineResources'],
  keepUnusedDataFor: 30,
  refetchOnMountOrArgChange: 30,
  endpoints: (builder) => ({
    getCalendarEvents: builder.query<CalendarEvent[], CalendarFilters | void>({
      async queryFn(filters) {
        try {
          const params = filters || {};

          // Fetch events and meetings directly - RLS will handle security
          const [eventsResult, meetingsResult] = await Promise.all([
            supabase.from('events').select(`
                id,
                name,
                description,
                event_date,
                event_end_date,
                location,
                status,
                budget,
                final_cost,
                notes,
                category_id,
                organization_id,
                contact_person_id,
                created_by,
                created_at,
                organizations:organization_id(id, name, alias),
                contacts:contact_person_id(id, first_name, last_name, full_name),
                event_categories:category_id(
                  id,
                  name,
                  color,
                  custom_icons:icon_id(id, name, svg_code)
                )
              `),
            supabase
              .from('meetings')
              .select(
                `
                id,
                title,
                notes,
                datetime_start,
                datetime_end,
                location_text,
                created_by,
                created_at,
                locations:location_id(id, name),
                meeting_participants(
                  employee_id,
                  employees:employee_id(id, name, surname)
                )
              `,
              )
              .is('deleted_at', null),
          ]);

          if (eventsResult.error) {
            console.error('Error fetching events:', eventsResult.error);
            console.error('Full error details:', JSON.stringify(eventsResult.error, null, 2));
          }

          if (meetingsResult.error) {
            console.error('Error fetching meetings:', meetingsResult.error);
          }

          // Map events
          const events: CalendarEvent[] = (eventsResult.data || []).map((event: any) => ({
            id: event.id,
            name: event.name,
            event_date: event.event_date,
            event_end_date: event.event_end_date,
            status: event.status,
            color: event.event_categories?.color,
            location: event.location || '',
            organization: event.organizations ? { name: event.organizations.name } : null,
            category: event.event_categories
              ? {
                  name: event.event_categories.name,
                  color: event.event_categories.color,
                }
              : null,
            is_meeting: false,
            assigned_employees: [],
            event_vehicles: [],
            event_equipment: [],
          }));

          // Map meetings
          const meetings: CalendarEvent[] = meetingsResult.error
            ? []
            : (meetingsResult.data || []).map((meeting: any) => ({
                id: meeting.id,
                name: meeting.title,
                event_date: meeting.datetime_start,
                event_end_date: meeting.datetime_end || meeting.datetime_start,
                status: 'meeting',
                color: '#d3bb73',
                location: meeting.locations?.name || meeting.location_text || '',
                organization: null,
                category: { name: 'Spotkanie', color: '#d3bb73' },
                is_meeting: true,
                meeting_data: meeting,
                assigned_employees:
                  meeting.meeting_participants
                    ?.map((p: any) => ({
                      id: p.employees?.id,
                      name: p.employees?.name,
                      surname: p.employees?.surname,
                    }))
                    .filter((e: any) => e.id) || [],
              }));

          const allEvents = [...events, ...meetings];

          let filteredEvents = allEvents;

          if (params.categories && params.categories.length > 0) {
            filteredEvents = filteredEvents.filter(
              (event) => event.category && params.categories!.includes(event.category.name),
            );
          }

          if (params.clients && params.clients.length > 0) {
            filteredEvents = filteredEvents.filter(
              (event) => event.organization && params.clients!.includes(event.organization.name),
            );
          }

          if (params.employees && params.employees.length > 0) {
            filteredEvents = filteredEvents.filter((event) => {
              if (event.is_meeting && event.meeting_data?.meeting_participants) {
                return event.meeting_data.meeting_participants.some(
                  (p: any) => p.employee_id && params.employees!.includes(p.employee_id),
                );
              }
              return event.assigned_employees?.some((emp) => params.employees!.includes(emp.id));
            });
          }

          return { data: filteredEvents };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      providesTags: ['CalendarEvents'],
    }),

    getCalendarFilterOptions: builder.query<CalendarFilterOptions, void>({
      async queryFn() {
        try {
          const [categoriesResult, clientsResult, employeesResult] = await Promise.all([
            supabase
              .from('event_categories')
              .select('id, name, color')
              .eq('is_active', true)
              .order('name'),

            supabase.from('contacts').select('id, name, type').order('name'),

            supabase
              .from('employees')
              .select('id, name, surname')
              .eq('is_active', true)
              .order('name'),
          ]);

          return {
            data: {
              categories: categoriesResult.data || [],
              clients: clientsResult.data || [],
              employees: employeesResult.data || [],
            },
          };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      providesTags: ['CalendarFilters'],
    }),

    createMeeting: builder.mutation<
      any,
      {
        title: string;
        datetime_start: string;
        datetime_end?: string | null;
        is_all_day?: boolean;
        color?: string;
        notes?: string | null;
        location_id?: string | null;
        location_text?: string | null;
        related_event_ids?: string[] | null;
        participants?: Array<{ employee_id?: string; contact_id?: string }>;
      }
    >({
      async queryFn(meetingData) {
        try {
          const { participants, ...meeting } = meetingData;

          const { data, error } = await supabase.from('meetings').insert(meeting).select().single();

          if (error) return { error: { status: 'CUSTOM_ERROR', error: error.message } };

          if (participants && participants.length > 0) {
            const participantsData = participants.map((p) => ({
              meeting_id: data.id,
              employee_id: p.employee_id || null,
              contact_id: p.contact_id || null,
            }));

            const { error: participantsError } = await supabase
              .from('meeting_participants')
              .insert(participantsData);

            if (participantsError) {
              console.error('Error adding participants:', participantsError);
            }
          }

          return { data };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      invalidatesTags: ['CalendarEvents', 'Meetings'],
    }),

    updateMeeting: builder.mutation<
      any,
      {
        id: string;
        title?: string;
        datetime_start?: string;
        datetime_end?: string;
        is_all_day?: boolean;
        color?: string;
        notes?: string;
        location_id?: string;
        location_text?: string;
      }
    >({
      async queryFn({ id, ...updates }) {
        try {
          const { error } = await supabase.from('meetings').update(updates).eq('id', id);

          if (error) return { error: { status: 'CUSTOM_ERROR', error: error.message } };

          return { data: { ok: true } };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      invalidatesTags: ['CalendarEvents', 'Meetings'],
    }),

    deleteMeeting: builder.mutation<void, string>({
      async queryFn(meetingId) {
        try {
          const { error } = await supabase
            .from('meetings')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', meetingId);

          if (error) return { error: { status: 'CUSTOM_ERROR', error: error.message } };

          return { data: undefined };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      invalidatesTags: ['CalendarEvents', 'Meetings'],
    }),

    getTimelineResources: builder.query<
      {
        vehicles: any[];
        employees: any[];
        equipment: any[];
        eventsWithAssignments: any[];
      },
      void
    >({
      async queryFn() {
        try {
          const now = new Date();
          const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          const endDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

          const { data: timelineData, error: timelineError } = await supabase.rpc(
            'get_calendar_timeline_resources',
            {
              p_start_date: startDate.toISOString(),
              p_end_date: endDate.toISOString(),
            },
          );

          if (timelineError) {
            console.error('Error fetching timeline resources:', timelineError);
            return {
              data: {
                vehicles: [],
                employees: [],
                equipment: [],
                eventsWithAssignments: [],
              },
            };
          }

          const vehicles = new Map();
          const employees = new Map();
          const equipment = new Map();
          const eventsMap = new Map();

          (timelineData || []).forEach((row: any) => {
            if (row.resource_type === 'vehicle' && !vehicles.has(row.resource_id)) {
              vehicles.set(row.resource_id, {
                id: row.resource_id,
                name: row.resource_name,
                registration_number: row.resource_metadata?.registration_number,
                vehicle_type: row.resource_metadata?.vehicle_type,
                status: row.resource_metadata?.status,
              });
            } else if (row.resource_type === 'employee' && !employees.has(row.resource_id)) {
              const fullName = row.resource_name || '';
              const nameParts = fullName.split(' ');
              const surname = nameParts.length > 1 ? nameParts.pop() : '';
              const firstName = nameParts.join(' ');

              employees.set(row.resource_id, {
                id: row.resource_id,
                name: firstName || fullName,
                surname: surname,
                nickname: row.resource_metadata?.nickname,
                role: row.resource_metadata?.role,
              });
            } else if (row.resource_type === 'equipment' && !equipment.has(row.resource_id)) {
              equipment.set(row.resource_id, {
                id: row.resource_id,
                name: row.resource_name,
                category_id: row.resource_metadata?.category_id,
                status: row.resource_metadata?.status,
              });
            }

            if (row.event_id && !eventsMap.has(row.event_id)) {
              eventsMap.set(row.event_id, {
                id: row.event_id,
                name: row.event_name,
                event_date: row.event_start,
                event_end_date: row.event_end,
                status: row.event_status,
                event_vehicles: [],
                event_equipment: [],
                employee_assignments: [],
              });
            }

            if (row.event_id) {
              const event = eventsMap.get(row.event_id);
              if (row.resource_type === 'vehicle') {
                event.event_vehicles.push({
                  vehicle_id: row.resource_id,
                  status: row.assignment_status,
                });
              } else if (row.resource_type === 'employee') {
                event.employee_assignments.push({
                  employee_id: row.resource_id,
                  invitation_status: row.assignment_status,
                });
              } else if (row.resource_type === 'equipment') {
                event.event_equipment.push({
                  equipment_id: row.resource_id,
                  status: row.assignment_status,
                });
              }
            }
          });

          const vehiclesArray = Array.from(vehicles.values());
          const employeesArray = Array.from(employees.values());
          const equipmentArray = Array.from(equipment.values());
          const eventsArray = Array.from(eventsMap.values());

          console.log('Timeline resources loaded:', {
            vehicles: vehiclesArray.length,
            employees: employeesArray.length,
            equipment: equipmentArray.length,
            eventsWithAssignments: eventsArray.length,
            sampleEvent: eventsArray[0],
          });

          return {
            data: {
              vehicles: vehiclesArray,
              employees: employeesArray,
              equipment: equipmentArray,
              eventsWithAssignments: eventsArray,
            },
          };
        } catch (error: any) {
          console.error('Error fetching timeline resources:', error);
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      providesTags: ['TimelineResources'],
    }),
  }),
});

export const {
  useGetCalendarEventsQuery,
  useGetCalendarFilterOptionsQuery,
  useCreateMeetingMutation,
  useUpdateMeetingMutation,
  useDeleteMeetingMutation,
  useGetTimelineResourcesQuery,
} = calendarApi;
