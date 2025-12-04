'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  Calendar,
  MapPin,
  Building2,
  Tag,
  SlidersHorizontal,
  ArrowUpDown,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import EventWizard from '@/components/crm/EventWizard';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { Modal } from '@/components/UI/Modal';

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
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<any>(null);

  useEffect(() => {
    fetchEvents();

    const channel = supabase
      .channel('events-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
        },
        () => {
          fetchEvents();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    applyFiltersAndSort();
  }, [events, searchQuery, statusFilter, sortField, sortDirection, showPastEvents]);

  const fetchEvents = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        setEvents([]);
        return;
      }

      const currentUserId = session.user.id;

      // Sprawdź czy użytkownik jest adminem
      const { data: employee } = await supabase
        .from('employees')
        .select('permissions, role')
        .eq('id', currentUserId)
        .maybeSingle();

      const isAdmin = employee?.role === 'admin' || employee?.permissions?.includes('events_manage');

      let query = supabase
        .from('events')
        .select(
          `
          *,
          organizations(name),
          contacts(first_name, last_name),
          event_categories(name, color),
          locations(name, formatted_address, address, city, postal_code)
        `,
        );

      // Jeśli użytkownik nie jest adminem, pokaż tylko eventy do których jest przypisany
      if (!isAdmin) {
        const { data: assignedEvents } = await supabase
          .from('employee_assignments')
          .select('event_id')
          .eq('employee_id', currentUserId);

        const eventIds = assignedEvents?.map((a) => a.event_id) || [];

        // Dodaj też eventy utworzone przez użytkownika
        const { data: createdEvents } = await supabase
          .from('events')
          .select('id')
          .eq('created_by', currentUserId);

        const createdEventIds = createdEvents?.map((e) => e.id) || [];
        const allEventIds = [...new Set([...eventIds, ...createdEventIds])];

        if (allEventIds.length === 0) {
          setEvents([]);
          return;
        }

        query = query.in('id', allEventIds);
      }

      const { data, error } = await query.order('event_date', { ascending: true });

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

  const handleDeleteClick = (e: React.MouseEvent, event: any) => {
    e.stopPropagation();
    setEventToDelete(event);
    setDeleteModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!eventToDelete) return;

    try {
      const { error } = await supabase.from('events').delete().eq('id', eventToDelete.id);

      if (error) throw error;

      showSnackbar('Event został usunięty', 'success');
      setDeleteModalOpen(false);
      setEventToDelete(null);
      fetchEvents();
    } catch (err: any) {
      console.error('Error deleting event:', err);
      showSnackbar(err.message || 'Błąd podczas usuwania eventu', 'error');
    }
  };

  const applyFiltersAndSort = () => {
    let result = [...events];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Filtrowanie po wyszukiwaniu
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (event) =>
          event.name?.toLowerCase().includes(query) ||
          event.location?.toLowerCase().includes(query) ||
          event.locations?.name?.toLowerCase().includes(query) ||
          event.locations?.address?.toLowerCase().includes(query) ||
          event.locations?.city?.toLowerCase().includes(query) ||
          event.organizations?.name?.toLowerCase().includes(query) ||
          event.description?.toLowerCase().includes(query),
      );
    }

    // Filtrowanie po statusie
    if (statusFilter !== 'all') {
      result = result.filter((event) => event.status === statusFilter);
    }

    // Filtrowanie przeszłych eventów (tylko jeśli showPastEvents jest false)
    if (!showPastEvents) {
      result = result.filter((event) => {
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
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const { data, error } = await supabase
        .from('events')
        .insert([
          {
            name: eventData.name,
            client_id:
              eventData.client_id && eventData.client_id.trim() !== '' ? eventData.client_id : null,
            category_id:
              eventData.category_id && eventData.category_id.trim() !== ''
                ? eventData.category_id
                : null,
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
        const { error: assignmentError } = await supabase.from('employee_assignments').insert([
          {
            event_id: data[0].id,
            employee_id: session.user.id,
            role: 'Autor/Koordynator',
          },
        ]);

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
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-sm font-medium text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
          >
            <Tag className="h-4 w-4" />
            Kategorie
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Nowy event
          </button>
        </div>
      </div>

      {/* Filtry i sortowanie */}
      <div className="space-y-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Wyszukiwanie */}
          <div className="min-w-[250px] flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/50" />
              <input
                type="text"
                placeholder="Szukaj po nazwie, lokalizacji, kliencie..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] py-2 pl-10 pr-4 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              />
            </div>
          </div>

          {/* Filtr statusu */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
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
            <SlidersHorizontal className="h-4 w-4 text-[#e5e4e2]/50" />
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
            >
              <option value="event_date">Data eventu</option>
              <option value="created_at">Data utworzenia</option>
              <option value="name">Nazwa</option>
              <option value="budget">Budżet</option>
            </select>
            <button
              onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
              className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] p-2 transition-colors hover:bg-[#d3bb73]/10"
              title={sortDirection === 'asc' ? 'Rosnąco' : 'Malejąco'}
            >
              <ArrowUpDown
                className={`h-4 w-4 text-[#e5e4e2] transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        </div>

        {/* Dodatkowe opcje i podsumowanie */}
        <div className="flex items-center justify-between border-t border-[#d3bb73]/10 pt-4">
          <button
            onClick={() => setShowPastEvents(!showPastEvents)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              showPastEvents
                ? 'border border-[#d3bb73]/30 bg-[#d3bb73]/20 text-[#d3bb73]'
                : 'border border-[#d3bb73]/20 bg-[#0f1117] text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10'
            }`}
          >
            <Calendar className="h-4 w-4" />
            {showPastEvents ? 'Ukryj przeszłe eventy' : 'Pokaż przeszłe eventy'}
          </button>

          <div className="text-sm text-[#e5e4e2]/50">
            Znaleziono: <span className="font-medium text-[#d3bb73]">{filteredEvents.length}</span>{' '}
            z {events.length} eventów
            {!showPastEvents &&
              (() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const pastEventsCount = events.filter((event) => {
                  const eventDate = new Date(event.event_date);
                  eventDate.setHours(0, 0, 0, 0);
                  return eventDate < today;
                }).length;
                return pastEventsCount > 0 ? (
                  <span className="ml-2 text-[#e5e4e2]/40">
                    (ukryto {pastEventsCount}{' '}
                    {pastEventsCount === 1
                      ? 'przeszły'
                      : pastEventsCount < 5
                        ? 'przeszłe'
                        : 'przeszłych'}
                    )
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
              className={`relative rounded-xl border bg-[#1c1f33] p-6 transition-all hover:border-[#d3bb73]/30 ${
                isPast ? 'border-[#e5e4e2]/5 opacity-60' : 'border-[#d3bb73]/10'
              }`}
            >
              <div
                onClick={() => router.push(`/crm/events/${event.id}`)}
                className="cursor-pointer"
              >
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="text-lg font-medium text-[#e5e4e2]">{event.name}</h3>
                      {isPast && (
                        <span className="rounded bg-[#e5e4e2]/10 px-2 py-0.5 text-xs text-[#e5e4e2]/50">
                          Przeszły
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-[#e5e4e2]/70">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        {event.organizations?.name || 'Brak klienta'}
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        {new Date(event.event_date).toLocaleDateString('pl-PL')}
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        {event.locations ? (
                          <span>
                            <span className="font-medium">{event.locations.name}</span>
                            {(event.locations.formatted_address || event.locations.address) && (
                              <span className="text-[#e5e4e2]/50">
                                {' '}
                                - {event.locations.formatted_address || event.locations.address}
                              </span>
                            )}
                          </span>
                        ) : (
                          event.location || 'Brak lokalizacji'
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 rounded-lg p-2 min-w-fit">
                    <div
                      className={`rounded-full border px-3 py-1 text-xs ${
                        statusColors[event.status]
                      }`}
                    >
                      {statusLabels[event.status]}
                    </div>
                    {event.event_categories && (
                      <div className="flex items-center gap-1 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-3 py-1 text-xs text-[#d3bb73]">
                        <Tag className="h-3 w-3" />
                        {event.event_categories.name}
                      </div>
                    )}
                    <div className="flex items-center justify-end">
                    <button
                      onClick={(e) => handleDeleteClick(e, event)}
                      className="top-4 rounded-lg bg-red-500/10 p-2 text-red-500 transition-colors hover:bg-red-500/20"
                      title="Usuń event"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-[#d3bb73]/10 pt-4">
                <div className="text-sm text-[#e5e4e2]/70">
                  Budżet:{' '}
                  <span className="font-medium text-[#d3bb73]">
                    {event.expected_revenue ? event.expected_revenue.toLocaleString() : '0'} zł
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <EventWizard
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={fetchEvents}
      />

      <Modal open={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Usuń event">
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-red-500/10 p-3">
              <AlertTriangle className="h-6 w-6 text-red-500" />
            </div>
            <div>
              <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">
                Czy na pewno chcesz usunąć ten event?
              </h3>
              <p className="mb-2 text-[#e5e4e2]/70">
                Event: <strong className="text-[#d3bb73]">{eventToDelete?.name}</strong>
              </p>
              <p className="text-sm text-[#e5e4e2]/60">
                Ta operacja jest nieodwracalna. Wszystkie powiązane dane (oferty, zadania, pliki)
                również zostaną usunięte.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 pt-4">
            <button
              onClick={() => setDeleteModalOpen(false)}
              className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/5"
            >
              Anuluj
            </button>
            <button
              onClick={handleDeleteConfirm}
              className="rounded-lg bg-red-500 px-4 py-2 text-white transition-colors hover:bg-red-600"
            >
              Usuń event
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
