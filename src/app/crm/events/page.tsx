'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  Grid,
  List,
} from 'lucide-react';
import EventWizard from '@/components/crm/EventWizard';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { Modal } from '@/components/UI/Modal';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';
import { EventStatusBadge } from './UI/EventStatusBadge';

const getOrgLabel = (org?: any) => org?.alias || org?.name || 'Brak klienta';

const getLocationLabel = (loc?: any, fallback?: string) => {
  if (!loc) return fallback || 'Brak lokalizacji';
  const city = loc.city ? ` — ${loc.city}` : '';
  return `${loc.name || 'Lokalizacja'}${city}`;
};

const getLocationLabelMobile = (
  locations?: {
    name?: string | null;
  } | null,
  locationFallback?: string | null,
) => {
  // 1️⃣ jeśli mamy relację locations → bierzemy TYLKO name
  if (locations?.name) {
    return locations.name;
  }

  // 2️⃣ fallback string → ucinamy do pierwszego przecinka
  if (typeof locationFallback === 'string' && locationFallback.length > 0) {
    return locationFallback.split(',')[0].trim();
  }

  return 'Brak lokalizacji';
};

const getLocationLabelDesktop = (loc?: any, fallback?: string) => {
  if (!loc) return fallback || 'Brak lokalizacji';
  const extra = loc.city ? ` — ${loc.city}` : '';
  return `${loc.name || 'Lokalizacja'}${extra}`;
};

const getMapsHref = (loc?: any, fallback?: string) => {
  const q = loc?.formatted_address || loc?.address || loc?.name || fallback || '';
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
};

const statusColors = {
  offer_sent: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  offer_accepted: 'bg-green-500/20 text-green-400 border-green-500/30',
  in_preparation: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  in_progress: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  invoiced: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

const stop = (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

type SortField = 'event_date' | 'name' | 'budget' | 'created_at';
type SortDirection = 'asc' | 'desc';

export default function EventsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const { getViewMode, setViewMode } = useUserPreferences();

  useEffect(() => {
    const error = searchParams.get('error');
    const info = searchParams.get('info');
    const eventName = searchParams.get('event');

    if (error === 'invalid_token') {
      showSnackbar('Nieprawidłowy lub nieważny token zaproszenia', 'error');
      router.replace('/crm/events');
    } else if (error === 'token_expired') {
      showSnackbar(
        'Token zaproszenia wygasł. Zaloguj się do systemu aby potwierdzić udział.',
        'error',
      );
      router.replace('/crm/events');
    } else if (info === 'invitation_rejected') {
      showSnackbar(`Zaproszenie do wydarzenia "${eventName}" zostało odrzucone`, 'info');
      router.replace('/crm/events');
    } else if (error === 'update_failed') {
      showSnackbar('Nie udało się zaktualizować statusu zaproszenia', 'error');
      router.replace('/crm/events');
    }
  }, [searchParams, router, showSnackbar]);
  const [events, setEvents] = useState<any[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('event_date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [showPastEvents, setShowPastEvents] = useState<boolean>(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<any>(null);
  const [viewMode, setLocalViewMode] = useState<'list' | 'grid'>(
    getViewMode('events') === 'grid' ? 'grid' : 'list',
  );
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const handleViewModeChange = async (mode: 'list' | 'grid') => {
    setLocalViewMode(mode);
    await setViewMode('events', mode);
  };

  useEffect(() => {
    fetchEvents();
    fetchCategories();

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
  }, [events, searchQuery, statusFilter, categoryFilter, sortField, sortDirection, showPastEvents]);

  const fetchEvents = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
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

      const isAdmin =
        employee?.role === 'admin' || employee?.permissions?.includes('events_manage');

      let query = supabase.from('events').select(
        `
          *,
          organizations(name, alias),
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

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase.from('event_categories').select('*').order('name');

      if (error) throw error;
      if (data) setCategories(data);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
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

    // Filtrowanie po kategorii
    if (categoryFilter !== 'all') {
      result = result.filter((event) => event.category_id === categoryFilter);
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
      showSnackbar('Event zapisany pomyślnie!', 'success');
      setIsModalOpen(false);
      await fetchEvents();
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd podczas zapisywania eventu', 'error');
    }
  };

  const actions = useMemo<Action[]>(() => {
    return [
      {
        label: 'Kategorie',
        onClick: () => router.push('/crm/event-categories'),
        icon: <Tag className="h-4 w-4" />,
        variant: 'default',
      },
      {
        label: 'Nowy event',
        onClick: () => setIsModalOpen(true),
        icon: <Plus className="h-4 w-4" />,
        variant: 'primary',
      },
    ];
  }, [router, setIsModalOpen]);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="mt-3 text-2xl font-light text-[#e5e4e2]">Eventy</h2>
        <div className="mt-3 flex items-center gap-3">
          <ResponsiveActionBar actions={actions} />
        </div>
      </div>

      {/* Filtry i sortowanie */}
      {/* Filtry i sortowanie */}
      <div className="space-y-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-2 md:p-4">
        {/* MOBILE toolbar */}
        <div className="flex items-center justify-between gap-2 md:hidden">
          <div className="flex items-center gap-2">
            {/* 🔍 Search */}
            <button
              onClick={() => setShowMobileSearch(true)}
              className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1117] p-2 text-[#e5e4e2]/70 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
              title="Szukaj"
            >
              <Search className="h-4 w-4" />
            </button>

            {/* 🎛️ Filters */}
            <button
              onClick={() => setShowMobileFilters(true)}
              className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1117] p-2 text-[#e5e4e2]/70 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
              title="Filtry"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>

            {/* ↕️ sort dir */}
            <button
              onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
              className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1117] p-2 text-[#e5e4e2]/70 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
              title={sortDirection === 'asc' ? 'Rosnąco' : 'Malejąco'}
            >
              <ArrowUpDown
                className={`h-4 w-4 transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`}
              />
            </button>

            {/* 📅 past toggle */}
            <button
              onClick={() => setShowPastEvents(!showPastEvents)}
              className={`rounded-lg border border-[#d3bb73]/10 p-2 transition-colors ${
                showPastEvents
                  ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                  : 'bg-[#0f1117] text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]'
              }`}
              title={showPastEvents ? 'Ukryj przeszłe' : 'Pokaż przeszłe'}
            >
              <Calendar className="h-4 w-4" />
            </button>
          </div>

          {/* view mode */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleViewModeChange('list')}
              className={`rounded-lg p-2 transition-colors ${
                viewMode === 'list'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1117] text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok listy"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleViewModeChange('grid')}
              className={`rounded-lg p-2 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1117] text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok siatki"
            >
              <Grid className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* MOBILE summary */}
        <div className="flex items-center justify-between text-xs text-[#e5e4e2]/50 md:hidden">
          <div>
            Znaleziono: <span className="font-medium text-[#d3bb73]">{filteredEvents.length}</span>{' '}
            / {events.length}
          </div>
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
                <span className="text-[#e5e4e2]/40">(ukryto {pastEventsCount})</span>
              ) : null;
            })()}
        </div>

        {/* DESKTOP content (Twoje 1:1) */}
        <div className="hidden flex-wrap items-center gap-4 md:flex">
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

          {/* Filtr kategorii */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
          >
            <option value="all">Wszystkie kategorie</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
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

          {/* Przełącznik widoku */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleViewModeChange('list')}
              className={`rounded-lg p-2 transition-colors ${
                viewMode === 'list'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1117] text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok listy"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleViewModeChange('grid')}
              className={`rounded-lg p-2 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1117] text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok siatki"
            >
              <Grid className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* DESKTOP footer (Twoje 1:1) */}
        <div className="hidden items-center justify-between border-t border-[#d3bb73]/10 pt-4 md:flex">
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

        {/* MOBILE SEARCH MODAL */}
        {showMobileSearch && (
          <div className="fixed inset-0 z-[9999]">
            <div className="absolute left-1/2 top-20 w-[92%] -translate-x-1/2 rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium text-[#e5e4e2]">Szukaj</div>
                <button
                  onClick={() => setShowMobileSearch(false)}
                  className="rounded-lg p-2 text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
                >
                  ✕
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/50" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Szukaj po nazwie, lokalizacji, kliencie..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] py-2.5 pl-10 pr-4 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* MOBILE FILTERS MODAL */}
        {showMobileFilters && (
          <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm md:hidden">
            <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl border-t border-[#d3bb73]/20 bg-[#1c1f33] p-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-medium text-[#e5e4e2]">Filtry</div>
                <button
                  onClick={() => setShowMobileFilters(false)}
                  className="rounded-lg p-2 text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                >
                  <option value="all">Wszystkie statusy</option>
                  <option value="offer_sent">Oferta wysłana</option>
                  <option value="offer_accepted">Zaakceptowana</option>
                  <option value="in_preparation">Przygotowanie</option>
                  <option value="in_progress">W trakcie</option>
                  <option value="completed">Zakończony</option>
                  <option value="invoiced">Rozliczony</option>
                </select>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                >
                  <option value="all">Wszystkie kategorie</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>

                <select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as SortField)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                >
                  <option value="event_date">Data eventu</option>
                  <option value="created_at">Data utworzenia</option>
                  <option value="name">Nazwa</option>
                  <option value="budget">Budżet</option>
                </select>

                <div className="text-xs text-[#e5e4e2]/50">
                  Kierunek sortowania: <span className="text-[#d3bb73]">{sortDirection}</span>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => {
                    setStatusFilter('all');
                    setCategoryFilter('all');
                    setSortField('event_date');
                    setSortDirection('asc');
                  }}
                  className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] py-2.5 text-sm text-[#e5e4e2]/80 hover:bg-[#d3bb73]/10"
                >
                  Reset
                </button>
                <button
                  onClick={() => setShowMobileFilters(false)}
                  className="flex-1 rounded-lg bg-[#d3bb73] py-2.5 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                >
                  Zastosuj
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        className={
          viewMode === 'grid'
            ? 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'
            : 'grid gap-4'
        }
      >
        {filteredEvents.map((event) => {
          const eventDate = new Date(event.event_date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          eventDate.setHours(0, 0, 0, 0);
          const isPast = eventDate < today;

          // MOBILE + GRID (jedna karta, przyjazna dotykowo)
          if (viewMode === 'grid') {
            return (
              <div
                key={event.id}
                onClick={() => router.push(`/crm/events/${event.id}`)}
                className={`relative flex cursor-pointer flex-col rounded-xl border bg-[#1c1f33] p-4 transition-all hover:border-[#d3bb73]/30 md:p-6 ${
                  isPast ? 'border-[#e5e4e2]/5 opacity-70' : 'border-[#d3bb73]/10'
                }`}
              >
                {/* Header: title + menu */}
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h3 className="line-clamp-2 flex-1 text-base font-medium text-[#e5e4e2]">
                    {event.name}
                  </h3>

                  {/* Desktop: delete button, Mobile: 3-dot */}
                  <div className="flex items-center gap-2">
                    <div className="hidden md:block">
                      <button
                        onClick={(e) => {
                          stop(e);
                          handleDeleteClick(e, event);
                        }}
                        className="flex-shrink-0 rounded-lg bg-red-500/10 p-2 text-red-500 transition-colors hover:bg-red-500/20"
                        title="Usuń event"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="md:hidden">
                      <ResponsiveActionBar
                        actions={[
                          {
                            label: 'Usuń',
                            onClick: () => handleDeleteClick(null, event),
                            icon: <Trash2 className="h-4 w-4" />,
                            variant: 'danger',
                          },
                        ]}
                        disabledBackground
                      />
                    </div>
                  </div>
                </div>

                {/* Meta: klient + data */}
                <div className="flex flex-col gap-2 text-sm text-[#e5e4e2]/70">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">{getOrgLabel(event.organizations)}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">
                      {new Date(event.event_date).toLocaleDateString('pl-PL')}
                      {isPast && <span className="ml-2 text-xs text-[#e5e4e2]/40">(przeszły)</span>}
                    </span>
                  </div>

                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span className="line-clamp-2">
                      {getLocationLabel(event.locations, event.location)}
                    </span>
                  </div>
                </div>

                {/* Pills */}
                <div className="mt-4 flex flex-wrap items-center gap-2 ">
                  <div
                  >
                    <EventStatusBadge status={event.status} />
                  </div>

                  {event.event_categories && (
                    <div className="rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73]">
                      {event.event_categories.name}
                    </div>
                  )}
                </div>

                {/* Budget */}
                <div className="mt-3 text-sm text-[#e5e4e2]/70">
                  Budżet:{' '}
                  <span className="font-medium text-[#d3bb73]">
                    {event.expected_revenue ? event.expected_revenue.toLocaleString() : '0'} zł
                  </span>
                </div>

                {/* Editor – na mobile często zjada miejsce, więc chowamy i pokazujemy od md */}
                <div className="mt-3 hidden md:block">
                  <EventStatusBadge status={event.status} />
                </div>
              </div>
            );
          }

          // LIST VIEW (mobile-friendly + desktop-friendly)
          return (
            <div
              key={event.id}
              className={`relative cursor-pointer rounded-xl border bg-[#1c1f33] p-2 transition-all hover:border-[#d3bb73]/30 sm:p-4 md:p-6 ${
                isPast ? 'border-[#e5e4e2]/5 opacity-70' : 'border-[#d3bb73]/10'
              }`}
              onClick={() => router.push(`/crm/events/${event.id}`)}
            >
              {/* Top row */}
              <div className="flex items-start justify-between gap-1 sm:gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="max-w-[240px] truncate text-base font-medium text-[#e5e4e2] md:text-lg">
                      {event.name}
                    </h3>
                    {isPast && (
                      <span className="hidden rounded bg-[#e5e4e2]/10 px-2 py-0.5 text-xs text-[#e5e4e2]/50 md:inline">
                        Przeszły
                      </span>
                    )}
                  </div>

                  {/* compact meta line for mobile */}
                  <div className="mt-2 flex flex-col gap-1 text-sm text-[#e5e4e2]/70 md:flex-row md:flex-wrap md:gap-4">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 flex-shrink-0" />
                      <span className="max-w-[250px] truncate">
                        {getOrgLabel(event.organizations)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">
                        {new Date(event.event_date).toLocaleDateString('pl-PL')}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <MapPin className="h-4 w-4 flex-shrink-0" />

                      <div className="min-w-0 flex-1 truncate">
                        <a
                          href={getMapsHref(event.locations, event.location)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={stop}
                          className="block min-w-0 cursor-pointer truncate text-[#e5e4e2]/70 hover:text-[#d3bb73]"
                          title="Otwórz w mapach"
                        >
                          {/* MOBILE: minimum */}
                          <span className="block max-w-[calc(100vw-140px)] truncate whitespace-nowrap sm:hidden">
                            {getLocationLabelMobile(event.locations, event.location)}
                          </span>

                          {/* >= SM: więcej info */}
                          <span className="hidden sm:inline">
                            {getLocationLabelDesktop(event.locations, event.location)}
                          </span>
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: pills + actions */}
                <div className="flex items-center gap-2">
                  {/* pills (na mobile mogą być pod spodem, więc tu chowamy) */}
                  <div className="hidden items-center gap-2 md:flex">
                    <div
                    >
                     <EventStatusBadge status={event.status} />
                    </div>
                    {event.event_categories && (
                      <div className="flex items-center gap-1 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-3 py-1 text-xs text-[#d3bb73]">
                        <Tag className="h-3 w-3" />
                        {event.event_categories.name}
                      </div>
                    )}
                  </div>

                  {/* actions */}
                  <div className="hidden md:block">
                    <button
                      onClick={(e) => {
                        stop(e);
                        handleDeleteClick(e, event);
                      }}
                      className="rounded-lg bg-red-500/10 p-2 text-red-500 transition-colors hover:bg-red-500/20"
                      title="Usuń event"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="md:hidden" onClick={stop}>
                    <ResponsiveActionBar
                      actions={[
                        {
                          label: 'Usuń',
                          onClick: () => handleDeleteClick(null, event),
                          icon: <Trash2 className="h-4 w-4" />,
                          variant: 'danger',
                        },
                      ]}
                      disabledBackground
                    />
                  </div>
                </div>
              </div>

              {/* Mobile pills under content */}
              <div className="mt-3 flex flex-wrap items-center gap-2 md:hidden">
                <div
                  className={`rounded-full border px-2 py-1 text-xs ${statusColors[event.status]}`}
                >
                  <EventStatusBadge status={event.status} />
                </div>
                {event.event_categories && (
                  <div className="rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73]">
                    {event.event_categories.name}
                  </div>
                )}
                {isPast && (
                  <span className="rounded bg-[#e5e4e2]/10 px-2 py-0.5 text-xs text-[#e5e4e2]/50">
                    Przeszły
                  </span>
                )}
              </div>

              {/* Footer */}
              <div className="mt-4 flex items-center justify-between border-t border-[#d3bb73]/10 pt-4">
                <div className="text-sm text-[#e5e4e2]/70">
                  Budżet:{' '}
                  <span className="font-medium text-[#d3bb73]">
                    {event.expected_revenue ? event.expected_revenue.toLocaleString() : '0'} zł
                  </span>
                </div>

                {/* opcjonalnie: jakiś chevron / CTA (mobile) */}
                <div className="text-xs text-[#e5e4e2]/40 md:hidden">Szczegóły →</div>
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
