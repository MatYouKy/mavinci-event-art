'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Plus, Filter, Calendar as CalendarIcon, MapPin, Building2, Clock, ChevronDown, ChevronUp, X, Layers } from 'lucide-react';
import NewEventModal from '@/components/crm/NewEventModal';
import { supabase } from '@/lib/supabase';

interface Event {
  id: string;
  name: string;
  client: string;
  event_date: string;
  event_end_date?: string;
  location: string;
  status: 'offer_sent' | 'offer_accepted' | 'in_preparation' | 'in_progress' | 'completed' | 'cancelled' | 'invoiced';
}

const statusColors = {
  offer_sent: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  offer_accepted: 'bg-green-500/20 text-green-400 border-green-500/30',
  in_preparation: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  in_progress: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  cancelled: 'bg-red-500/20 text-red-400 border-red-500/30',
  invoiced: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

const statusLabels = {
  offer_sent: 'Oferta wysłana',
  offer_accepted: 'Oferta zaakceptowana',
  in_preparation: 'W przygotowaniu',
  in_progress: 'W trakcie',
  completed: 'Zakończony',
  cancelled: 'Anulowany',
  invoiced: 'Rozliczony',
};

export default function CalendarPage() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInitialDate, setModalInitialDate] = useState<Date | undefined>();
  const [hoveredEvent, setHoveredEvent] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number; position: 'top' | 'bottom' }>({ x: 0, y: 0, position: 'bottom' });
  const [showAllEventsModal, setShowAllEventsModal] = useState(false);
  const [allEventsModalDate, setAllEventsModalDate] = useState<Date | null>(null);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetchEvents();
  }, [currentDate]);

  const fetchEvents = async () => {
    try {
      const { data, error } = await supabase
        .from('events')
        .select(`
          *,
          client:clients(company_name, first_name, last_name)
        `)
        .order('event_date', { ascending: true });

      if (error) {
        console.error('Error fetching events:', error);
        return;
      }

      if (data) {
        setEvents(data.map(event => ({
          id: event.id,
          name: event.name,
          client: event.client?.company_name || `${event.client?.first_name || ''} ${event.client?.last_name || ''}`.trim() || 'Brak klienta',
          event_date: event.event_date,
          event_end_date: event.event_end_date,
          location: event.location,
          status: event.status,
        })));
        return;
      }
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days: (Date | null)[] = [];

    for (let i = 0; i < (startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1); i++) {
      days.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }

    return days;
  };

  const getEventsForDate = (date: Date | null) => {
    if (!date) return [];
    return events.filter((event) => {
      const eventDate = new Date(event.event_date);
      return (
        eventDate.getDate() === date.getDate() &&
        eventDate.getMonth() === date.getMonth() &&
        eventDate.getFullYear() === date.getFullYear()
      );
    });
  };

  const previousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleNewEvent = (date?: Date) => {
    setModalInitialDate(date);
    setIsModalOpen(true);
  };

  const handleSaveEvent = async (eventData: any) => {
    try {
      const { data, error } = await supabase
        .from('events')
        .insert([
          {
            name: eventData.name,
            client_id: eventData.client_id || null,
            event_date: eventData.event_date,
            event_end_date: eventData.event_end_date || null,
            location: eventData.location,
            budget: eventData.budget ? parseFloat(eventData.budget) : null,
            description: eventData.description || null,
            status: eventData.status,
            attachments: eventData.attachments || [],
          },
        ])
        .select();

      if (error) {
        console.error('Error saving event:', error);
        alert('Błąd podczas zapisywania eventu: ' + error.message);
        return;
      }

      console.log('Event saved:', data);
      fetchEvents();
      setIsModalOpen(false);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd podczas zapisywania eventu');
    }
  };

  const openAllEventsModal = (date: Date, e: React.MouseEvent) => {
    e.stopPropagation();
    setAllEventsModalDate(date);
    setShowAllEventsModal(true);
  };

  const getPlusSize = (eventCount: number) => {
    if (eventCount === 0) return 'w-8 h-8';
    if (eventCount === 1) return 'w-6 h-6';
    if (eventCount === 2) return 'w-5 h-5';
    return 'w-4 h-4';
  };

  const handleEventHover = (e: React.MouseEvent, eventId: string) => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const position = spaceBelow < 250 && spaceAbove > 250 ? 'top' : 'bottom';

    setTooltipPosition({
      x: rect.left,
      y: position === 'top' ? rect.top - 10 : rect.bottom + 10,
      position
    });
    setHoveredEvent(eventId);
  };

  const today = new Date();
  const days = getDaysInMonth(currentDate);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={previousMonth}
            className="p-2 text-[#e5e4e2] hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-2xl font-light text-[#e5e4e2]">
            {currentDate.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })}
          </h2>
          <button
            onClick={nextMonth}
            className="p-2 text-[#e5e4e2] hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg overflow-hidden">
            {['month', 'week', 'day'].map((v) => (
              <button
                key={v}
                onClick={() => setView(v as any)}
                className={`px-4 py-2 text-sm font-light transition-colors ${
                  view === v
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'text-[#e5e4e2] hover:bg-[#d3bb73]/10'
                }`}
              >
                {v === 'month' ? 'Miesiąc' : v === 'week' ? 'Tydzień' : 'Dzień'}
              </button>
            ))}
          </div>

          <button
            onClick={() => handleNewEvent()}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nowy event
          </button>
        </div>
      </div>

      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl overflow-visible">
        <div className="grid grid-cols-7 gap-px bg-[#d3bb73]/10">
          {['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nie'].map((day) => (
            <div
              key={day}
              className="bg-[#1c1f33] p-3 text-center text-sm font-medium text-[#e5e4e2]/60"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px bg-[#d3bb73]/10">
          {days.map((date, index) => {
            const dayEvents = getEventsForDate(date);
            const isToday =
              date &&
              date.getDate() === today.getDate() &&
              date.getMonth() === today.getMonth() &&
              date.getFullYear() === today.getFullYear();
            const eventCount = dayEvents.length;
            const maxVisibleEvents = 2;

            return (
              <div
                key={index}
                className={`bg-[#1c1f33] h-[130px] p-2 relative ${
                  date ? 'hover:bg-[#1c1f33]/50 cursor-pointer' : ''
                } transition-colors flex flex-col`}
                onClick={() => date && handleNewEvent(date)}
              >
                {date && (
                  <>
                    <div className="flex items-start justify-between mb-2">
                      <div
                        className={`text-sm ${
                          isToday
                            ? 'w-7 h-7 flex items-center justify-center bg-[#d3bb73] text-[#1c1f33] rounded-full font-medium'
                            : 'text-[#e5e4e2]/60'
                        }`}
                      >
                        {date.getDate()}
                      </div>

                      {eventCount > 0 && (
                        <button
                          onClick={(e) => openAllEventsModal(date, e)}
                          className="flex items-center gap-1 px-2 py-0.5 bg-[#d3bb73]/20 hover:bg-[#d3bb73]/30 rounded-full transition-colors group"
                        >
                          <Layers className="w-3 h-3 text-[#d3bb73]" />
                          <span className="text-xs font-medium text-[#d3bb73]">
                            {eventCount}
                          </span>
                        </button>
                      )}
                    </div>

                    {eventCount === 0 && (
                      <div className="flex items-center justify-center flex-1">
                        <Plus className={`${getPlusSize(0)} text-[#e5e4e2]/20`} />
                      </div>
                    )}

                    {eventCount > 0 && (
                      <div className="relative flex-1 flex flex-col">
                        <div className="space-y-1 flex-1 overflow-hidden">
                          {dayEvents.slice(0, Math.min(maxVisibleEvents, eventCount)).map((event, idx) => {
                            const isLast = idx === Math.min(maxVisibleEvents, eventCount) - 1;
                            const remainingCount = eventCount - maxVisibleEvents;
                            const showStack = isLast && remainingCount > 0;

                            return (
                              <div
                                key={event.id}
                                className="relative"
                                style={{
                                  transform: showStack ? `translateY(-${remainingCount * 2}px)` : 'none',
                                }}
                              >
                                {showStack && remainingCount > 0 && (
                                  <>
                                    {[...Array(Math.min(remainingCount, 2))].map((_, stackIdx) => (
                                      <div
                                        key={`stack-${stackIdx}`}
                                        className="absolute inset-0 bg-[#0f1119] border border-[#d3bb73]/20 rounded"
                                        style={{
                                          transform: `translateY(-${(stackIdx + 1) * 2}px)`,
                                          zIndex: -(stackIdx + 1),
                                          opacity: 0.5 - stackIdx * 0.15,
                                        }}
                                      />
                                    ))}
                                  </>
                                )}

                                <div
                                  className={`text-xs p-1.5 rounded border ${
                                    statusColors[event.status]
                                  } truncate hover:opacity-80 transition-opacity relative z-10 bg-[#1c1f33] cursor-pointer`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    router.push(`/crm/events/${event.id}`);
                                  }}
                                  onMouseEnter={(e) => handleEventHover(e, event.id)}
                                  onMouseLeave={() => {
                                    tooltipTimeoutRef.current = setTimeout(() => {
                                      setHoveredEvent(null);
                                    }, 100);
                                  }}
                                >
                                  {event.name}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex items-center justify-center mt-auto pt-2">
                          <Plus className={`${getPlusSize(eventCount)} text-[#e5e4e2]/30 hover:text-[#e5e4e2]/50 transition-colors`} />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {hoveredEvent && (
        <div
          className="fixed bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg shadow-2xl p-4 min-w-[280px] cursor-pointer hover:border-[#d3bb73]/50 transition-colors"
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
            transform: tooltipPosition.position === 'top' ? 'translateY(-100%)' : 'translateY(0)',
            zIndex: 9999
          }}
          onClick={(e) => {
            e.stopPropagation();
            const event = events.find(ev => ev.id === hoveredEvent);
            if (event) router.push(`/crm/events/${event.id}`);
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
          {(() => {
            const event = events.find(ev => ev.id === hoveredEvent);
            if (!event) return null;

            return (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-[#e5e4e2] mb-3">
                  {event.name}
                </h4>
                <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                  <Building2 className="w-3 h-3" />
                  <span>{event.client || 'Brak klienta'}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                  <Clock className="w-3 h-3" />
                  <span>
                    {new Date(event.event_date).toLocaleString('pl-PL', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                  <MapPin className="w-3 h-3" />
                  <span>{event.location}</span>
                </div>
                <div className="pt-2 border-t border-[#d3bb73]/10">
                  <span
                    className={`inline-block px-2 py-1 rounded text-xs border ${
                      statusColors[event.status]
                    }`}
                  >
                    {statusLabels[event.status]}
                  </span>
                </div>
                <div className="pt-2 text-xs text-[#d3bb73] hover:text-[#d3bb73]/80 cursor-pointer">
                  Kliknij aby zobaczyć szczegóły →
                </div>
              </div>
            );
          })()}
        </div>
      )}

      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <h3 className="text-lg font-light text-[#e5e4e2] mb-4">
          Nadchodzące eventy
        </h3>
        <div className="space-y-3">
          {events
            .filter((event) => new Date(event.event_date) >= today)
            .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
            .slice(0, 5)
            .map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between p-4 bg-[#0f1119] rounded-lg hover:bg-[#0f1119]/50 transition-colors cursor-pointer"
                onClick={() => router.push(`/crm/events/${event.id}`)}
              >
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-[#e5e4e2] mb-1">
                    {event.name}
                  </h4>
                  <div className="flex items-center gap-4 text-xs text-[#e5e4e2]/60">
                    <span>{event.client}</span>
                    <span>•</span>
                    <span>{event.location}</span>
                    <span>•</span>
                    <span>
                      {new Date(event.event_date).toLocaleDateString('pl-PL', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs border ${
                    statusColors[event.status]
                  }`}
                >
                  {statusLabels[event.status]}
                </span>
              </div>
            ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h3 className="text-lg font-light text-[#e5e4e2] mb-4">
            Status eventów
          </h3>
          <div className="space-y-3">
            {Object.entries(statusLabels).map(([status, label]) => {
              const count = events.filter((e) => e.status === status).length;
              return (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        statusColors[status as keyof typeof statusColors].split(' ')[0]
                      }`}
                    />
                    <span className="text-sm text-[#e5e4e2]/70">{label}</span>
                  </div>
                  <span className="text-sm font-medium text-[#e5e4e2]">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h3 className="text-lg font-light text-[#e5e4e2] mb-4">
            Zarezerwowany sprzęt
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-[#0f1119] rounded-lg">
              <span className="text-sm text-[#e5e4e2]/70">Nagłośnienie</span>
              <span className="text-sm font-medium text-[#d3bb73]">12 / 20 sztuk</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-[#0f1119] rounded-lg">
              <span className="text-sm text-[#e5e4e2]/70">Oświetlenie</span>
              <span className="text-sm font-medium text-[#d3bb73]">8 / 15 sztuk</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-[#0f1119] rounded-lg">
              <span className="text-sm text-[#e5e4e2]/70">Scena</span>
              <span className="text-sm font-medium text-[#d3bb73]">3 / 5 sztuk</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-[#0f1119] rounded-lg">
              <span className="text-sm text-[#e5e4e2]/70">Projektor</span>
              <span className="text-sm font-medium text-[#d3bb73]">5 / 8 sztuk</span>
            </div>
          </div>
        </div>
      </div>

      <NewEventModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveEvent}
        initialDate={modalInitialDate}
      />

      {showAllEventsModal && allEventsModalDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-[#d3bb73]/20">
              <div>
                <h3 className="text-xl font-light text-[#e5e4e2]">
                  Wydarzenia - {allEventsModalDate.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}
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
                        <h4 className="text-sm font-medium text-[#e5e4e2] mb-2">
                          {event.name}
                        </h4>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                            <Building2 className="w-3 h-3" />
                            <span>{event.client}</span>
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
                          statusColors[event.status]
                        }`}
                      >
                        {statusLabels[event.status]}
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
    </div>
  );
}
