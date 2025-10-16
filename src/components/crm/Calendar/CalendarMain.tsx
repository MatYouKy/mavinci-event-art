'use client';

import { useState, useEffect, useRef } from 'react';
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
import NewEventModal from '../NewEventModal';

export default function CalendarMain() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([]);
  const [view, setView] = useState<CalendarView>('month');
  const [isModalOpen, setIsModalOpen] = useState(false);
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

  useEffect(() => {
    fetchCurrentEmployee();
    fetchEvents();
    fetchFilterOptions();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [filters, allEvents]);

  const fetchEvents = async () => {
    try {
      console.log('Fetching events...');
      const { data, error } = await supabase
        .from('events')
        .select(`
          *,
          client:clients(company_name, first_name, last_name),
          category:event_categories(
            id,
            name,
            color
          ),
          employees:employee_assignments(
            id,
            employee_id,
            role,
            status
          )
        `)
        .order('event_date', { ascending: true });

      if (error) {
        console.error('Error fetching events:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        return;
      }

      console.log('Events fetched successfully:', data?.length || 0);
      if (data) {
        setAllEvents(data as CalendarEvent[]);
        setEvents(data as CalendarEvent[]);
      }
    } catch (err) {
      console.error('Error in fetchEvents:', err);
    }
  };

  const fetchCurrentEmployee = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const { data } = await supabase
          .from('employees')
          .select('id, name, surname, permissions')
          .eq('id', session.user.id)
          .single();
        setCurrentEmployee(data);
      }
    } catch (err) {
      console.error('Error fetching current employee:', err);
    }
  };

  const fetchFilterOptions = async () => {
    try {
      const [categoriesRes, clientsRes, employeesRes] = await Promise.all([
        supabase.from('event_categories').select('id, name, color').eq('is_active', true),
        supabase.from('clients').select('id, company_name, first_name, last_name').order('company_name'),
        supabase.from('employees').select('id, name, surname, nickname').order('name'),
      ]);

      if (categoriesRes.data) setCategories(categoriesRes.data);
      if (clientsRes.data) setClients(clientsRes.data);
      if (employeesRes.data) setEmployees(employeesRes.data);
    } catch (err) {
      console.error('Error fetching filter options:', err);
    }
  };

  const applyFilters = () => {
    let filtered = [...allEvents];

    if (filters.statuses.length > 0) {
      filtered = filtered.filter(e => filters.statuses.includes(e.status));
    }

    if (filters.categories.length > 0) {
      filtered = filtered.filter(e => e.category_id && filters.categories.includes(e.category_id));
    }

    if (filters.clients.length > 0) {
      filtered = filtered.filter(e => e.client_id && filters.clients.includes(e.client_id));
    }

    if (filters.myEvents && currentEmployee) {
      filtered = filtered.filter(e => e.created_by === currentEmployee.id);
    }

    if (filters.assignedToMe && currentEmployee) {
      filtered = filtered.filter(e =>
        e.employees?.some((emp: any) => emp.employee_id === currentEmployee.id)
      );
    }

    if (filters.employees.length > 0) {
      filtered = filtered.filter(e =>
        e.employees?.some((emp: any) => filters.employees.includes(emp.employee_id))
      );
    }

    setEvents(filtered);
  };

  const toggleFilter = (type: string, value: any) => {
    setFilters(prev => {
      const key = type as keyof typeof prev;
      if (typeof prev[key] === 'boolean') {
        return { ...prev, [key]: !prev[key] };
      }
      const arr = prev[key] as string[];
      const newArr = arr.includes(value)
        ? arr.filter(v => v !== value)
        : [...arr, value];
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

  const handleNewEvent = (date?: Date) => {
    setModalInitialDate(date);
    setIsModalOpen(true);
  };

  const handleSaveEvent = async (eventData: any) => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

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

      console.log('Saving event with data:', eventData);

      const { data, error } = await supabase
        .from('events')
        .insert([
          {
            name: eventData.name,
            client_id: eventData.client_id || null,
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

      console.log('Event saved successfully:', data);
      fetchEvents();
      setIsModalOpen(false);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd podczas zapisywania wydarzenia');
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => handleDateChange('prev')}
            className="p-2 text-[#e5e4e2] hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <h2 className="text-xl md:text-2xl font-light text-[#e5e4e2] min-w-[200px] text-center">
            {getDateLabel()}
          </h2>

          <button
            onClick={() => handleDateChange('next')}
            className="p-2 text-[#e5e4e2] hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          <button
            onClick={handleToday}
            className="px-3 py-2 text-sm text-[#e5e4e2] hover:bg-[#1c1f33] rounded-lg transition-colors hidden md:block"
          >
            Dziś
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-colors ${
              hasActiveFilters()
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#d3bb73]/10 border border-[#d3bb73]/10'
            }`}
          >
            <Filter className="w-4 h-4" />
            <span className="hidden md:inline">Filtry</span>
            {hasActiveFilters() && (
              <span className="bg-[#1c1f33] text-[#d3bb73] px-1.5 py-0.5 rounded text-xs">
                {filters.statuses.length + filters.categories.length + filters.clients.length + filters.employees.length + (filters.myEvents ? 1 : 0) + (filters.assignedToMe ? 1 : 0)}
              </span>
            )}
          </button>

          <div className="flex bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg overflow-hidden">
            {(['month', 'week', 'day', 'employee'] as CalendarView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 md:px-4 py-2 text-xs md:text-sm font-light transition-colors ${
                  view === v
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'text-[#e5e4e2] hover:bg-[#d3bb73]/10'
                }`}
              >
                {v === 'month' ? 'Miesiąc' : v === 'week' ? 'Tydzień' : v === 'day' ? 'Dzień' : 'Pracownicy'}
              </button>
            ))}
          </div>

          <button
            onClick={() => handleNewEvent()}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden md:inline">Nowe wydarzenie</span>
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 space-y-6">
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

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-3">
              <label className="block text-sm text-[#e5e4e2]/60">Szybkie filtry</label>
              <div className="space-y-2">
                <button
                  onClick={() => toggleFilter('myEvents', null)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    filters.myEvents
                      ? 'bg-[#d3bb73]/20 text-[#d3bb73] border border-[#d3bb73]'
                      : 'bg-[#0f1119] text-[#e5e4e2] border border-[#d3bb73]/10 hover:bg-[#d3bb73]/5'
                  }`}
                >
                  Moje wydarzenia
                </button>
                <button
                  onClick={() => toggleFilter('assignedToMe', null)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    filters.assignedToMe
                      ? 'bg-[#d3bb73]/20 text-[#d3bb73] border border-[#d3bb73]'
                      : 'bg-[#0f1119] text-[#e5e4e2] border border-[#d3bb73]/10 hover:bg-[#d3bb73]/5'
                  }`}
                >
                  Przypisane do mnie
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-sm text-[#e5e4e2]/60">Status</label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {Object.entries(STATUS_LABELS).map(([status, label]) => (
                  <button
                    key={status}
                    onClick={() => toggleFilter('statuses', status)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      filters.statuses.includes(status)
                        ? 'bg-[#d3bb73]/20 text-[#d3bb73] border border-[#d3bb73]'
                        : 'bg-[#0f1119] text-[#e5e4e2] border border-[#d3bb73]/10 hover:bg-[#d3bb73]/5'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-sm text-[#e5e4e2]/60">Kategoria</label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => toggleFilter('categories', cat.id)}
                    className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      filters.categories.includes(cat.id)
                        ? 'bg-[#d3bb73]/20 text-[#d3bb73] border border-[#d3bb73]'
                        : 'bg-[#0f1119] text-[#e5e4e2] border border-[#d3bb73]/10 hover:bg-[#d3bb73]/5'
                    }`}
                  >
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-sm text-[#e5e4e2]/60">Pracownik</label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {employees.map((emp) => (
                  <button
                    key={emp.id}
                    onClick={() => toggleFilter('employees', emp.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      filters.employees.includes(emp.id)
                        ? 'bg-[#d3bb73]/20 text-[#d3bb73] border border-[#d3bb73]'
                        : 'bg-[#0f1119] text-[#e5e4e2] border border-[#d3bb73]/10 hover:bg-[#d3bb73]/5'
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
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {clients.map((client) => (
                    <button
                      key={client.id}
                      onClick={() => toggleFilter('clients', client.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        filters.clients.includes(client.id)
                          ? 'bg-[#d3bb73]/20 text-[#d3bb73] border border-[#d3bb73]'
                          : 'bg-[#0f1119] text-[#e5e4e2] border border-[#d3bb73]/10 hover:bg-[#d3bb73]/5'
                      }`}
                    >
                      {client.company_name || `${client.first_name} ${client.last_name}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-[#d3bb73]/10 text-sm text-[#e5e4e2]/60">
            Pokazuje {events.length} z {allEvents.length} wydarzeń
          </div>
        </div>
      )}

      {view === 'month' && (
        <MonthView
          currentDate={currentDate}
          events={events}
          onDateClick={handleNewEvent}
          onEventClick={(event) => router.push(`/crm/events/${event.id}`)}
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
          onEventClick={(event) => router.push(`/crm/events/${event.id}`)}
          onEventHover={handleEventHover}
        />
      )}

      {view === 'day' && (
        <DayView
          currentDate={currentDate}
          events={events}
          onDateClick={handleNewEvent}
          onEventClick={(event) => router.push(`/crm/events/${event.id}`)}
          onEventHover={handleEventHover}
        />
      )}

      {view === 'employee' && (
        <EmployeeView
          currentDate={currentDate}
          events={events}
          onDateClick={handleNewEvent}
          onEventClick={(event) => router.push(`/crm/events/${event.id}`)}
          employees={employees}
        />
      )}

      {hoveredEvent && (
        <div
          className="fixed bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg shadow-2xl p-4 min-w-[280px] cursor-pointer hover:border-[#d3bb73]/50 transition-colors z-50"
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
          }}
          onClick={() => {
            router.push(`/crm/events/${hoveredEvent.id}`);
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
            <h4 className="text-sm font-medium text-[#e5e4e2] mb-3">{hoveredEvent.name}</h4>

            <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
              <Building2 className="w-3 h-3" />
              <span>
                {hoveredEvent.client?.company_name ||
                  `${hoveredEvent.client?.first_name || ''} ${hoveredEvent.client?.last_name || ''}`.trim() ||
                  'Brak klienta'}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
              <Clock className="w-3 h-3" />
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
              <MapPin className="w-3 h-3" />
              <span>{hoveredEvent.location}</span>
            </div>

            <div className="pt-2 border-t border-[#d3bb73]/10">
              <span
                className={`inline-block px-2 py-1 rounded text-xs border ${
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
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-[#d3bb73]/20">
              <div>
                <h3 className="text-xl font-light text-[#e5e4e2]">
                  Wydarzenia -{' '}
                  {allEventsModalDate.toLocaleDateString('pl-PL', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </h3>
                <p className="text-sm text-[#e5e4e2]/60 mt-1">
                  {getEventsForDate(allEventsModalDate).length} wydarzeń
                </p>
              </div>
              <button
                onClick={() => setShowAllEventsModal(false)}
                className="p-2 hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[#e5e4e2]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-3">
                {getEventsForDate(allEventsModalDate).map((event) => (
                  <div
                    key={event.id}
                    className="p-4 bg-[#0f1119] rounded-lg hover:bg-[#0f1119]/50 transition-colors cursor-pointer"
                    onClick={() => {
                      router.push(`/crm/events/${event.id}`);
                      setShowAllEventsModal(false);
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-[#e5e4e2] mb-2">{event.name}</h4>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                            <Building2 className="w-3 h-3" />
                            <span>
                              {event.client?.company_name ||
                                `${event.client?.first_name || ''} ${event.client?.last_name || ''}`.trim() ||
                                'Brak klienta'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                            <Clock className="w-3 h-3" />
                            <span>
                              {new Date(event.event_date).toLocaleString('pl-PL', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                            <MapPin className="w-3 h-3" />
                            <span>{event.location}</span>
                          </div>
                        </div>
                      </div>
                      <span
                        className={`px-2 py-1 rounded text-xs border ${
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

            <div className="p-6 border-t border-[#d3bb73]/20">
              <button
                onClick={() => {
                  setShowAllEventsModal(false);
                  handleNewEvent(allEventsModalDate);
                }}
                className="w-full flex items-center justify-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-3 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Dodaj nowe wydarzenie tego dnia
              </button>
            </div>
          </div>
        </div>
      )}

      <NewEventModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveEvent}
        initialDate={modalInitialDate}
      />
    </div>
  );
}
