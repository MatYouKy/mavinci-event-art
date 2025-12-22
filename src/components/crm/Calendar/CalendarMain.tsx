'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  MapPin,
  Building2,
  Clock,
  X,
  Tag,
  Filter,
  Users,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { CalendarEvent, CalendarView } from './types';
import { STATUS_COLORS, STATUS_LABELS } from './constants';
import MonthView from './MonthView';
import WeekView from './WeekView';
import DayView from './DayView';
import EmployeeView from './EmployeeView';
import MobileCalendarView from './MobileCalendarView';
import EventWizard from '../EventWizard';
import NewMeetingModal from '../NewMeetingModal';
import EventTypeSelector from './EventTypeSelector';
import { useGetCalendarEventsQuery, useGetCalendarFilterOptionsQuery } from '@/store/api/calendarApi';

export default function CalendarMain() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([]);
  const [view, setView] = useState<CalendarView>('month');
  const [isMobile, setIsMobile] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMeetingModalOpen, setIsMeetingModalOpen] = useState(false);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [selectedClientType, setSelectedClientType] = useState<'business' | 'individual' | null>(
    null,
  );
  const [modalInitialDate, setModalInitialDate] = useState<Date | undefined>();
  const [hoveredEvent, setHoveredEvent] = useState<CalendarEvent | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showAllEventsModal, setShowAllEventsModal] = useState(false);
  const [allEventsModalDate, setAllEventsModalDate] = useState<Date | null>(null);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [showFilters, setShowFilters] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [currentEmployee, setCurrentEmployee] = useState<any>(null);
  const [filters, setFilters] = useState({
    statuses: [] as string[],
    categories: [] as string[],
    clients: [] as string[],
    employees: [] as string[],
    myEvents: false,
    assignedToMe: false,
  });

  const {
    data: calendarEvents = [],
    isLoading: eventsLoading,
    error: eventsError,
    refetch: refetchEvents,
  } = useGetCalendarEventsQuery();

  const {
    data: filterOptions,
    isLoading: filterOptionsLoading,
  } = useGetCalendarFilterOptionsQuery();

  useEffect(() => {
    fetchCurrentEmployee();

    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (filterOptions) {
      setCategories(filterOptions.categories);
      setClients(filterOptions.clients);
      setEmployees(filterOptions.employees);
    }
  }, [filterOptions]);

  const fetchCurrentEmployee = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const { data } = await supabase
          .from('employees')
          .select('id, name, surname, permissions, role')
          .eq('id', session.user.id)
          .single();
        setCurrentEmployee(data);
      }
    } catch (err) {
      console.error('Error fetching current employee:', err);
    }
  };

  const applyFilters = useCallback(() => {
    let filtered = [...allEvents];

    if (filters.statuses.length > 0) {
      filtered = filtered.filter((e) => filters.statuses.includes(e.status));
    }

    if (filters.categories.length > 0) {
      filtered = filtered.filter(
        (e) => e.category?.name && filters.categories.includes(e.category.name),
      );
    }

    if (filters.clients.length > 0) {
      filtered = filtered.filter(
        (e) => e.organization?.name && filters.clients.includes(e.organization.name),
      );
    }

    if (filters.myEvents && currentEmployee) {
      filtered = filtered.filter((e: any) => e.created_by === currentEmployee.id);
    }

    if (filters.assignedToMe && currentEmployee) {
      filtered = filtered.filter((e: any) => {
        if (e.is_meeting) {
          return e.meeting_data?.meeting_participants?.some(
            (p: any) => p.employee_id === currentEmployee.id
          );
        }
        return e.assigned_employees?.some((emp: any) => emp.id === currentEmployee.id);
      });
    }

    if (filters.employees.length > 0) {
      filtered = filtered.filter((e: any) => {
        if (e.is_meeting) {
          return e.meeting_data?.meeting_participants?.some(
            (p: any) => p.employee_id && filters.employees.includes(p.employee_id)
          );
        }
        return e.assigned_employees?.some((emp: any) => filters.employees.includes(emp.id));
      });
    }

    setEvents(filtered);
  }, [allEvents, filters, currentEmployee]);

  useEffect(() => {
    if (calendarEvents) {
      console.log('📅 Calendar events updated:', calendarEvents.length, 'events');
      console.log('Meetings:', calendarEvents.filter(e => e.is_meeting).length);
      console.log('Events:', calendarEvents.filter(e => !e.is_meeting).length);
      setAllEvents([...calendarEvents]);
    }
  }, [calendarEvents]);

  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  const toggleFilter = (type: string, value: any) => {
    setFilters((prev) => {
      const key = type as keyof typeof prev;
      if (typeof prev[key] === 'boolean') {
        return { ...prev, [key]: !prev[key] };
      }
      const arr = prev[key] as string[];
      const newArr = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      return { ...prev, [key]: newArr };
    });
  };

  const clearFilters = () => {
    setFilters({
      statuses: [],
      categories: [],
      clients: [],
      employees: [],
      myEvents: false,
      assignedToMe: false,
    });
  };

  const hasActiveFilters = () => {
    return (
      filters.statuses.length > 0 ||
      filters.categories.length > 0 ||
      filters.clients.length > 0 ||
      filters.employees.length > 0 ||
      filters.myEvents ||
      filters.assignedToMe
    );
  };

  const handleDateChange = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);

    switch (view) {
      case 'month':
        newDate.setMonth(currentDate.getMonth() + (direction === 'next' ? 1 : -1));
        break;
      case 'week':
        newDate.setDate(currentDate.getDate() + (direction === 'next' ? 7 : -7));
        break;
      case 'day':
        newDate.setDate(currentDate.getDate() + (direction === 'next' ? 1 : -1));
        break;
    }

    setCurrentDate(newDate);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const canCreateEvents = () => {
    if (!currentEmployee) return false;
    return (
      currentEmployee.role === 'admin' ||
      currentEmployee.permissions?.includes('calendar_manage')
    );
  };

  const handleNewEvent = (date?: Date) => {
    setModalInitialDate(date);
    const canCreate = canCreateEvents();

    if (!canCreate) {
      setIsMeetingModalOpen(true);
    } else {
      setShowTypeSelector(true);
    }
  };

  const handleEventTypeSelect = (type: 'business' | 'individual' | 'meeting') => {
    setShowTypeSelector(false);

    if (type === 'meeting') {
      setIsMeetingModalOpen(true);
    } else {
      setSelectedClientType(type);
      setIsModalOpen(true);
    }
  };

  const handleNewMeeting = (date?: Date) => {
    setModalInitialDate(date);
    setIsMeetingModalOpen(true);
  };

  const handleSaveEvent = async (eventData: any) => {
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        console.error('Session error:', sessionError);
        alert('Błąd sesji: ' + sessionError.message);
        return;
      }

      if (!session) {
        console.error('No active session');
        alert('Brak aktywnej sesji. Zaloguj się ponownie.');
        return;
      }

      const { error } = await supabase
        .from('events')
        .insert([
          {
            name: eventData.name,
            organization_id: eventData.organization_id || null,
            contact_person_id: eventData.contact_person_id || null,
            category_id: eventData.category_id || null,
            event_date: eventData.event_date,
            event_end_date: eventData.event_end_date || null,
            location: eventData.location,
            budget: eventData.budget ? parseFloat(eventData.budget) : null,
            description: eventData.description || null,
            status: eventData.status,
            attachments: eventData.attachments || [],
            created_by: session.user.id,
          },
        ])
        .select();

      if (error) {
        console.error('Error saving event:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        alert('Błąd podczas zapisywania wydarzenia: ' + error.message);
        return;
      }
      refetchEvents();
      setIsModalOpen(false);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd podczas zapisywania wydarzenia');
    }
  };

  const handleEventClick = (event: CalendarEvent) => {
    if ((event as any).is_meeting) {
      alert(
        `Spotkanie: ${event.name}\n\nData: ${new Date(event.event_date).toLocaleString('pl-PL')}\nLokalizacja: ${event.location || 'Brak'}\n\nNotatki: ${(event as any).meeting_data?.notes || 'Brak'}`,
      );
    } else {
      router.push(`/crm/events/${event.id}`);
    }
  };

  const handleEventHover = (event: CalendarEvent | null, position?: { x: number; y: number }) => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }

    if (event && position) {
      setTooltipPosition(position);
      setHoveredEvent(event);
    } else {
      tooltipTimeoutRef.current = setTimeout(() => {
        setHoveredEvent(null);
      }, 100);
    }
  };

  const getDateLabel = (): string => {
    switch (view) {
      case 'month':
        return currentDate.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
      case 'week': {
        const weekStart = new Date(currentDate);
        const weekEnd = new Date(currentDate);
        weekStart.setDate(currentDate.getDate() - currentDate.getDay() + 1);
        weekEnd.setDate(weekStart.getDate() + 6);
        return `${weekStart.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })} - ${weekEnd.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}`;
      }
      case 'day':
        return currentDate.toLocaleDateString('pl-PL', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
    }
  };

  const getEventsForDate = (date: Date): CalendarEvent[] => {
    return events.filter((event) => {
      const eventDate = new Date(event.event_date);
      return (
        eventDate.getDate() === date.getDate() &&
        eventDate.getMonth() === date.getMonth() &&
        eventDate.getFullYear() === date.getFullYear()
      );
    });
  };

  if (isMobile) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-light text-[#e5e4e2]">Kalendarz</h1>
          <div className="flex items-center gap-2">
            {canCreateEvents() && (
              <button
                onClick={() => handleNewMeeting()}
                className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-xs font-medium text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
              >
                <CalendarIcon className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => handleNewEvent()}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              {canCreateEvents() ? (
                <Plus className="h-4 w-4" />
              ) : (
                <>
                  <CalendarIcon className="h-4 w-4" />
                  <span>Spotkanie</span>
                </>
              )}
            </button>
          </div>
        </div>

        <MobileCalendarView
          events={events}
          currentDate={currentDate}
          onDateChange={handleDateChange}
        />

        <EventTypeSelector
          isOpen={showTypeSelector}
          onClose={() => setShowTypeSelector(false)}
          onSelectType={handleEventTypeSelect}
          canCreateEvents={canCreateEvents()}
        />

        <EventWizard
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedClientType(null);
          }}
          onSuccess={refetchEvents}
          initialDate={modalInitialDate}
          initialClientType={selectedClientType}
        />

        <NewMeetingModal
          isOpen={isMeetingModalOpen}
          onClose={() => setIsMeetingModalOpen(false)}
          onSuccess={() => {
            console.log('🔄 RefetchEvents called from NewMeetingModal');
            refetchEvents();
          }}
          initialDate={modalInitialDate}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-4">
          <button
            onClick={() => handleDateChange('prev')}
            className="rounded-lg p-2 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <h2 className="min-w-[200px] text-center text-xl font-light text-[#e5e4e2] md:text-2xl">
            {getDateLabel()}
          </h2>

          <button
            onClick={() => handleDateChange('next')}
            className="rounded-lg p-2 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <button
            onClick={handleToday}
            className="hidden rounded-lg px-3 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#1c1f33] md:block"
          >
            Dziś
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors md:px-4 md:text-sm ${
              hasActiveFilters()
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'border border-[#d3bb73]/10 bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#d3bb73]/10'
            }`}
          >
            <Filter className="h-4 w-4" />
            <span className="hidden md:inline">Filtry</span>
            {hasActiveFilters() && (
              <span className="rounded bg-[#1c1f33] px-1.5 py-0.5 text-xs text-[#d3bb73]">
                {filters.statuses.length +
                  filters.categories.length +
                  filters.clients.length +
                  filters.employees.length +
                  (filters.myEvents ? 1 : 0) +
                  (filters.assignedToMe ? 1 : 0)}
              </span>
            )}
          </button>

          <div className="flex overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]">
            {(['month', 'week', 'day', 'employee'] as CalendarView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-2 text-xs font-light transition-colors md:px-4 md:text-sm ${
                  view === v
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'text-[#e5e4e2] hover:bg-[#d3bb73]/10'
                }`}
              >
                {v === 'month'
                  ? 'Miesiąc'
                  : v === 'week'
                    ? 'Tydzień'
                    : v === 'day'
                      ? 'Dzień'
                      : 'Pracownicy'}
              </button>
            ))}
          </div>

          {canCreateEvents() && (
            <button
              onClick={() => handleNewMeeting()}
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-xs font-medium text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10 md:px-4 md:text-sm"
            >
              <CalendarIcon className="h-4 w-4" />
              <span className="hidden md:inline">Spotkanie</span>
            </button>
          )}

          <button
            onClick={() => handleNewEvent()}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 md:px-4 md:text-sm"
          >
            {canCreateEvents() ? (
              <>
                <Plus className="h-4 w-4" />
                <span className="hidden md:inline">Nowe wydarzenie</span>
              </>
            ) : (
              <>
                <CalendarIcon className="h-4 w-4" />
                <span className="hidden md:inline">Nowe spotkanie</span>
              </>
            )}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="space-y-6 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-light text-[#e5e4e2]">Filtry</h3>
            {hasActiveFilters() && (
              <button
                onClick={clearFilters}
                className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
              >
                Wyczyść wszystkie
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-3">
              <label className="block text-sm text-[#e5e4e2]/60">Szybkie filtry</label>
              <div className="space-y-2">
                <button
                  onClick={() => toggleFilter('myEvents', null)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    filters.myEvents
                      ? 'border border-[#d3bb73] bg-[#d3bb73]/20 text-[#d3bb73]'
                      : 'border border-[#d3bb73]/10 bg-[#0f1119] text-[#e5e4e2] hover:bg-[#d3bb73]/5'
                  }`}
                >
                  Moje wydarzenia
                </button>
                <button
                  onClick={() => toggleFilter('assignedToMe', null)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    filters.assignedToMe
                      ? 'border border-[#d3bb73] bg-[#d3bb73]/20 text-[#d3bb73]'
                      : 'border border-[#d3bb73]/10 bg-[#0f1119] text-[#e5e4e2] hover:bg-[#d3bb73]/5'
                  }`}
                >
                  Przypisane do mnie
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-sm text-[#e5e4e2]/60">Status</label>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {Object.entries(STATUS_LABELS).map(([status, label]) => (
                  <button
                    key={status}
                    onClick={() => toggleFilter('statuses', status)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      filters.statuses.includes(status)
                        ? 'border border-[#d3bb73] bg-[#d3bb73]/20 text-[#d3bb73]'
                        : 'border border-[#d3bb73]/10 bg-[#0f1119] text-[#e5e4e2] hover:bg-[#d3bb73]/5'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-sm text-[#e5e4e2]/60">Kategoria</label>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => toggleFilter('categories', cat.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      filters.categories.includes(cat.id)
                        ? 'border border-[#d3bb73] bg-[#d3bb73]/20 text-[#d3bb73]'
                        : 'border border-[#d3bb73]/10 bg-[#0f1119] text-[#e5e4e2] hover:bg-[#d3bb73]/5'
                    }`}
                  >
                    <div
                      className="h-3 w-3 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: cat.color }}
                    />
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-sm text-[#e5e4e2]/60">Pracownik</label>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {employees.map((emp) => (
                  <button
                    key={emp.id}
                    onClick={() => toggleFilter('employees', emp.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      filters.employees.includes(emp.id)
                        ? 'border border-[#d3bb73] bg-[#d3bb73]/20 text-[#d3bb73]'
                        : 'border border-[#d3bb73]/10 bg-[#0f1119] text-[#e5e4e2] hover:bg-[#d3bb73]/5'
                    }`}
                  >
                    {emp.nickname || `${emp.name} ${emp.surname}`}
                  </button>
                ))}
              </div>
            </div>

            {currentEmployee?.permissions?.includes('events_manage') && (
              <div className="space-y-3">
                <label className="block text-sm text-[#e5e4e2]/60">Klient</label>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {clients.map((client) => (
                    <button
                      key={client.id}
                      onClick={() => toggleFilter('clients', client.id)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        filters.clients.includes(client.id)
                          ? 'border border-[#d3bb73] bg-[#d3bb73]/20 text-[#d3bb73]'
                          : 'border border-[#d3bb73]/10 bg-[#0f1119] text-[#e5e4e2] hover:bg-[#d3bb73]/5'
                      }`}
                    >
                      {client.company_name || `${client.first_name} ${client.last_name}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-[#d3bb73]/10 pt-4 text-sm text-[#e5e4e2]/60">
            Pokazuje {events.length} z {allEvents.length} wydarzeń
          </div>
        </div>
      )}

      {view === 'month' && (
        <MonthView
          currentDate={currentDate}
          events={events}
          onDateClick={handleNewEvent}
          onEventClick={handleEventClick}
          onEventHover={handleEventHover}
          onShowAllEvents={(date) => {
            setAllEventsModalDate(date);
            setShowAllEventsModal(true);
          }}
        />
      )}

      {view === 'week' && (
        <WeekView
          currentDate={currentDate}
          events={events}
          onDateClick={handleNewEvent}
          onEventClick={handleEventClick}
          onEventHover={handleEventHover}
        />
      )}

      {view === 'day' && (
        <DayView
          currentDate={currentDate}
          events={events}
          onDateClick={handleNewEvent}
          onEventClick={handleEventClick}
          onEventHover={handleEventHover}
        />
      )}

      {view === 'employee' && (
        <EmployeeView
          currentDate={currentDate}
          events={events}
          onDateClick={handleNewEvent}
          onEventClick={handleEventClick}
          employees={employees}
        />
      )}

      {hoveredEvent && (
        <div
          className="fixed z-50 min-w-[280px] cursor-pointer rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] p-4 shadow-2xl transition-colors hover:border-[#d3bb73]/50"
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
          }}
          onClick={() => {
            handleEventClick(hoveredEvent);
          }}
          onMouseEnter={() => {
            if (tooltipTimeoutRef.current) {
              clearTimeout(tooltipTimeoutRef.current);
            }
          }}
          onMouseLeave={() => {
            setHoveredEvent(null);
          }}
        >
          <div className="space-y-2">
            <h4 className="mb-3 text-sm font-medium text-[#e5e4e2]">{hoveredEvent.name}</h4>

            <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
              <Building2 className="h-3 w-3" />
              <span>
                {hoveredEvent.organization?.name || 'Brak klienta'}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
              <Clock className="h-3 w-3" />
              <span>
                {new Date(hoveredEvent.event_date).toLocaleString('pl-PL', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
              <MapPin className="h-3 w-3" />
              <span>{hoveredEvent.location}</span>
            </div>

            <div className="border-t border-[#d3bb73]/10 pt-2">
              <span
                className={`inline-block rounded border px-2 py-1 text-xs ${
                  STATUS_COLORS[hoveredEvent.status]
                }`}
              >
                {STATUS_LABELS[hoveredEvent.status]}
              </span>
            </div>

            <div className="pt-2 text-xs text-[#d3bb73] hover:text-[#d3bb73]/80">
              Kliknij aby zobaczyć szczegóły →
            </div>
          </div>
        </div>
      )}

      {showAllEventsModal && allEventsModalDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
              <div>
                <h3 className="text-xl font-light text-[#e5e4e2]">
                  Wydarzenia -{' '}
                  {allEventsModalDate.toLocaleDateString('pl-PL', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </h3>
                <p className="mt-1 text-sm text-[#e5e4e2]/60">
                  {getEventsForDate(allEventsModalDate).length} wydarzeń
                </p>
              </div>
              <button
                onClick={() => setShowAllEventsModal(false)}
                className="rounded-lg p-2 transition-colors hover:bg-[#d3bb73]/10"
              >
                <X className="h-5 w-5 text-[#e5e4e2]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-3">
                {getEventsForDate(allEventsModalDate).map((event) => (
                  <div
                    key={event.id}
                    className="cursor-pointer rounded-lg bg-[#0f1119] p-4 transition-colors hover:bg-[#0f1119]/50"
                    onClick={() => {
                      handleEventClick(event);
                      setShowAllEventsModal(false);
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h4 className="mb-2 text-sm font-medium text-[#e5e4e2]">{event.name}</h4>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                            <Building2 className="h-3 w-3" />
                            <span>
                              {event.organization?.name || 'Brak klienta'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                            <Clock className="h-3 w-3" />
                            <span>
                              {new Date(event.event_date).toLocaleString('pl-PL', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                            <MapPin className="h-3 w-3" />
                            <span>{event.location}</span>
                          </div>
                        </div>
                      </div>
                      <span
                        className={`rounded border px-2 py-1 text-xs ${
                          STATUS_COLORS[event.status]
                        }`}
                      >
                        {STATUS_LABELS[event.status]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-[#d3bb73]/20 p-6">
              <button
                onClick={() => {
                  setShowAllEventsModal(false);
                  handleNewEvent(allEventsModalDate);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                {canCreateEvents() ? (
                  <>
                    <Plus className="h-4 w-4" />
                    Dodaj nowe wydarzenie tego dnia
                  </>
                ) : (
                  <>
                    <CalendarIcon className="h-4 w-4" />
                    Dodaj nowe spotkanie tego dnia
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <EventTypeSelector
        isOpen={showTypeSelector}
        onClose={() => setShowTypeSelector(false)}
        onSelectType={handleEventTypeSelect}
        canCreateEvents={canCreateEvents()}
      />

      <EventWizard
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedClientType(null);
        }}
        onSuccess={refetchEvents}
        initialDate={modalInitialDate}
        initialClientType={selectedClientType}
      />

      <NewMeetingModal
        isOpen={isMeetingModalOpen}
        onClose={() => setIsMeetingModalOpen(false)}
        onSuccess={() => {
          refetchEvents();
        }}
        initialDate={modalInitialDate}
      />
    </div>
  );
}
