'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Calendar, MapPin, Building2, Tag, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import NewEventModal from '@/components/crm/NewEventModal';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

const statusColors = {
  offer_sent: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  offer_accepted: 'bg-green-500/20 text-green-400 border-green-500/30',
  in_preparation: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  in_progress: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  invoiced: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

const statusLabels = {
  offer_sent: 'Oferta wysłana',
  offer_accepted: 'Zaakceptowana',
  in_preparation: 'Przygotowanie',
  in_progress: 'W trakcie',
  completed: 'Zakończony',
  invoiced: 'Rozliczony',
};

type SortField = 'event_date' | 'name' | 'budget' | 'created_at';
type SortDirection = 'asc' | 'desc';

export default function EventsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [events, setEvents] = useState<any[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('event_date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [showPastEvents, setShowPastEvents] = useState<boolean>(false);

  useEffect(() => {
    fetchEvents();
  }, []);

  useEffect(() => {
    applyFiltersAndSort();
  }, [events, searchQuery, statusFilter, sortField, sortDirection, showPastEvents]);

  const fetchEvents = async () => {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('*, organizations(name), contacts(first_name, last_name)')
        .order('event_date', { ascending: true });

      if (error) {
        console.error('Error fetching events:', error);
        return;
      }

      if (data) {
        setEvents(data);
        return;
      }
    } catch (err) {
      console.error('Error:', err);
    }

    setEvents([]);
  };

  const applyFiltersAndSort = () => {
    let result = [...events];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Filtrowanie po wyszukiwaniu
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(event =>
        event.name?.toLowerCase().includes(query) ||
        event.location?.toLowerCase().includes(query) ||
        event.organizations?.name?.toLowerCase().includes(query) ||
        event.description?.toLowerCase().includes(query)
      );
    }

    // Filtrowanie po statusie
    if (statusFilter !== 'all') {
      result = result.filter(event => event.status === statusFilter);
    }

    // Filtrowanie przeszłych eventów (tylko jeśli showPastEvents jest false)
    if (!showPastEvents) {
      result = result.filter(event => {
        const eventDate = new Date(event.event_date);
        eventDate.setHours(0, 0, 0, 0);
        return eventDate >= today;
      });
    }

    // Sortowanie
    result.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      // Konwersja dat
      if (sortField === 'event_date' || sortField === 'created_at') {
        aVal = new Date(aVal || 0).getTime();
        bVal = new Date(bVal || 0).getTime();
      }

      // Konwersja liczb
      if (sortField === 'budget') {
        aVal = Number(aVal || 0);
        bVal = Number(bVal || 0);
      }

      // Konwersja stringów
      if (sortField === 'name') {
        aVal = String(aVal || '').toLowerCase();
        bVal = String(bVal || '').toLowerCase();
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    setFilteredEvents(result);
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleSaveEvent = async (eventData: any) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

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
            created_by: session?.user?.id || null,
          },
        ])
        .select();

      if (error) {
        console.error('Error saving event:', error);
        showSnackbar('Błąd podczas zapisywania eventu: ' + error.message, 'error');
        return;
      }

      // Automatycznie dodaj autora do zespołu wydarzenia
      if (data && data[0] && session?.user?.id) {
        const { error: assignmentError } = await supabase
          .from('employee_assignments')
          .insert([{
            event_id: data[0].id,
            employee_id: session.user.id,
            role: 'Autor/Koordynator'
          }]);

        if (assignmentError) {
          console.error('Error adding creator to team:', assignmentError);
        }
      }

      console.log('Event saved:', data);
      showSnackbar('Event zapisany pomyślnie!', 'success');
      setIsModalOpen(false);
      await fetchEvents();
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd podczas zapisywania eventu', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Eventy</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/crm/event-categories')}
            className="flex items-center gap-2 bg-[#1c1f33] text-[#e5e4e2] border border-[#d3bb73]/20 px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/10 transition-colors"
          >
            <Tag className="w-4 h-4" />
            Kategorie
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nowy event
          </button>
        </div>
      </div>

      {/* Filtry i sortowanie */}
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Wyszukiwanie */}
          <div className="flex-1 min-w-[250px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#e5e4e2]/50" />
              <input
                type="text"
                placeholder="Szukaj po nazwie, lokalizacji, kliencie..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/50"
              />
            </div>
          </div>

          {/* Filtr statusu */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/50"
          >
            <option value="all">Wszystkie statusy</option>
            <option value="offer_sent">Oferta wysłana</option>
            <option value="offer_accepted">Zaakceptowana</option>
            <option value="in_preparation">Przygotowanie</option>
            <option value="in_progress">W trakcie</option>
            <option value="completed">Zakończony</option>
            <option value="invoiced">Rozliczony</option>
          </select>

          {/* Sortowanie */}
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-[#e5e4e2]/50" />
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              className="px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/50"
            >
              <option value="event_date">Data eventu</option>
              <option value="created_at">Data utworzenia</option>
              <option value="name">Nazwa</option>
              <option value="budget">Budżet</option>
            </select>
            <button
              onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
              className="p-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg hover:bg-[#d3bb73]/10 transition-colors"
              title={sortDirection === 'asc' ? 'Rosnąco' : 'Malejąco'}
            >
              <ArrowUpDown className={`w-4 h-4 text-[#e5e4e2] transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {/* Dodatkowe opcje i podsumowanie */}
        <div className="flex items-center justify-between pt-4 border-t border-[#d3bb73]/10">
          <button
            onClick={() => setShowPastEvents(!showPastEvents)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              showPastEvents
                ? 'bg-[#d3bb73]/20 text-[#d3bb73] border border-[#d3bb73]/30'
                : 'bg-[#0f1117] text-[#e5e4e2]/70 border border-[#d3bb73]/20 hover:bg-[#d3bb73]/10'
            }`}
          >
            <Calendar className="w-4 h-4" />
            {showPastEvents ? 'Ukryj przeszłe eventy' : 'Pokaż przeszłe eventy'}
          </button>

          <div className="text-sm text-[#e5e4e2]/50">
            Znaleziono: <span className="text-[#d3bb73] font-medium">{filteredEvents.length}</span> z {events.length} eventów
            {!showPastEvents && (() => {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const pastEventsCount = events.filter(event => {
                const eventDate = new Date(event.event_date);
                eventDate.setHours(0, 0, 0, 0);
                return eventDate < today;
              }).length;
              return pastEventsCount > 0 ? (
                <span className="ml-2 text-[#e5e4e2]/40">
                  (ukryto {pastEventsCount} {pastEventsCount === 1 ? 'przeszły' : pastEventsCount < 5 ? 'przeszłe' : 'przeszłych'})
                </span>
              ) : null;
            })()}
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        {filteredEvents.map((event) => {
          const eventDate = new Date(event.event_date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          eventDate.setHours(0, 0, 0, 0);
          const isPast = eventDate < today;

          return (
            <div
              key={event.id}
              onClick={() => router.push(`/crm/events/${event.id}`)}
              className={`bg-[#1c1f33] border rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all cursor-pointer ${
                isPast ? 'border-[#e5e4e2]/5 opacity-60' : 'border-[#d3bb73]/10'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-medium text-[#e5e4e2]">
                      {event.name}
                    </h3>
                    {isPast && (
                      <span className="text-xs px-2 py-0.5 bg-[#e5e4e2]/10 text-[#e5e4e2]/50 rounded">
                        Przeszły
                      </span>
                    )}
                  </div>
                <div className="flex flex-wrap gap-4 text-sm text-[#e5e4e2]/70">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    {event.organizations?.name || 'Brak klienta'}
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {new Date(event.event_date).toLocaleDateString('pl-PL')}
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    {event.location || 'Brak lokalizacji'}
                  </div>
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

            <div className="flex items-center justify-between pt-4 border-t border-[#d3bb73]/10">
              <div className="text-sm text-[#e5e4e2]/70">
                Budżet: <span className="text-[#d3bb73] font-medium">{event.budget ? event.budget.toLocaleString() : '0'} zł</span>
              </div>
            </div>
          </div>
          );
        })}
      </div>

      <NewEventModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveEvent}
      />
    </div>
  );
}
