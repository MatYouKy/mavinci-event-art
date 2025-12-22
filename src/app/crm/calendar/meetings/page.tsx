'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Calendar, MapPin, Users, Plus, Search, Filter, Clock } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import NewMeetingModal from '@/components/crm/NewMeetingModal';

interface Meeting {
  id: string;
  title: string;
  location_id: string | null;
  location_text: string | null;
  datetime_start: string;
  datetime_end: string | null;
  notes: string | null;
  color: string;
  is_all_day: boolean;
  location?: {
    id: string;
    name: string;
  };
  event?: {
    id: string;
    name: string;
  };
  creator?: {
    id: string;
    name: string;
    surname: string;
  };
  participants?: Array<{
    id: string;
    employee?: {
      id: string;
      name: string;
      surname: string;
      avatar_url: string | null;
    };
  }>;
}

export default function MeetingsListPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [filteredMeetings, setFilteredMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'upcoming' | 'past'>('all');

  useEffect(() => {
    fetchMeetings();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [meetings, searchQuery, filterType]);

  const fetchMeetings = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('meetings')
        .select(`
          *,
          location:locations(id, name),
          creator:employees!meetings_created_by_fkey(id, name, surname),
          participants:meeting_participants(
            id,
            employee:employees(id, name, surname, avatar_url)
          )
        `)
        .is('deleted_at', null)
        .order('datetime_start', { ascending: true });

      if (error) throw error;

      setMeetings(data || []);
    } catch (error: any) {
      console.error('Error fetching meetings:', error);
      showSnackbar('Błąd podczas pobierania spotkań', 'error');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...meetings];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.title.toLowerCase().includes(query) ||
          m.location?.name?.toLowerCase().includes(query) ||
          m.location_text?.toLowerCase().includes(query) ||
          m.notes?.toLowerCase().includes(query)
      );
    }

    const now = new Date();
    if (filterType === 'upcoming') {
      filtered = filtered.filter((m) => new Date(m.datetime_start) >= now);
    } else if (filterType === 'past') {
      filtered = filtered.filter((m) => new Date(m.datetime_start) < now);
    }

    setFilteredMeetings(filtered);
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDateShort = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('pl-PL', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatTimeShort = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTimeStatus = (startDate: string, endDate: string | null) => {
    const now = new Date();
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : null;

    if (end && now >= start && now <= end) {
      return { label: 'W trakcie', color: 'text-green-400' };
    } else if (now < start) {
      return { label: 'Nadchodzące', color: 'text-blue-400' };
    } else {
      return { label: 'Zakończone', color: 'text-gray-400' };
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#13161f]">
        <div className="text-[#e5e4e2]">Ładowanie spotkań...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#13161f] p-4 text-[#e5e4e2] md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#e5e4e2] md:text-3xl">Wszystkie spotkania</h1>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              {filteredMeetings.length} {filteredMeetings.length === 1 ? 'spotkanie' : 'spotkań'}
            </p>
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#c4ac63]"
          >
            <Plus size={16} />
            Nowe spotkanie
          </button>
        </div>

        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#d3bb73]/60" size={18} />
            <input
              type="text"
              placeholder="Szukaj spotkań..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] py-2 pl-10 pr-4 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div className="flex gap-2">
            {(['all', 'upcoming', 'past'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  filterType === type
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'border border-[#d3bb73]/20 text-[#e5e4e2] hover:bg-[#d3bb73]/10'
                }`}
              >
                {type === 'all' ? 'Wszystkie' : type === 'upcoming' ? 'Nadchodzące' : 'Przeszłe'}
              </button>
            ))}
          </div>
        </div>

        {filteredMeetings.length === 0 ? (
          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
            <Calendar className="mx-auto mb-4 text-[#d3bb73]/40" size={48} />
            <p className="text-lg text-[#e5e4e2]/60">
              {searchQuery
                ? 'Nie znaleziono spotkań spełniających kryteria wyszukiwania'
                : 'Brak spotkań'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredMeetings.map((meeting) => {
              const timeStatus = getTimeStatus(meeting.datetime_start, meeting.datetime_end);

              return (
                <div
                  key={meeting.id}
                  onClick={() => router.push(`/crm/calendar/meeting/${meeting.id}`)}
                  className="group cursor-pointer rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4 transition-all hover:border-[#d3bb73]/30 hover:shadow-lg"
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="h-full w-1 rounded-full"
                      style={{ backgroundColor: meeting.color }}
                    />

                    <div className="flex-1">
                      <div className="mb-3 flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="mb-1 text-lg font-semibold text-[#e5e4e2] group-hover:text-[#d3bb73]">
                            {meeting.title}
                          </h3>
                          <p className={`text-xs font-medium ${timeStatus.color}`}>
                            {timeStatus.label}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="text-sm font-medium text-[#d3bb73]">
                            {formatDateShort(meeting.datetime_start)}
                          </p>
                          <p className="text-xs text-[#e5e4e2]/60">
                            {formatTimeShort(meeting.datetime_start)}
                            {meeting.datetime_end && ` - ${formatTimeShort(meeting.datetime_end)}`}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {(meeting.location?.name || meeting.location_text) && (
                          <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/80">
                            <MapPin size={14} className="text-[#d3bb73]" />
                            {meeting.location?.name || meeting.location_text}
                          </div>
                        )}

                        {meeting.participants && meeting.participants.length > 0 && (
                          <div className="flex items-center gap-2">
                            <Users size={14} className="text-[#d3bb73]" />
                            <div className="flex flex-wrap gap-1">
                              {meeting.participants.slice(0, 3).map((p) => (
                                <span
                                  key={p.id}
                                  className="rounded-full bg-[#d3bb73]/10 px-2 py-0.5 text-xs text-[#e5e4e2]"
                                >
                                  {p.employee ? `${p.employee.name} ${p.employee.surname}` : 'Nieznany'}
                                </span>
                              ))}
                              {meeting.participants.length > 3 && (
                                <span className="rounded-full bg-[#d3bb73]/10 px-2 py-0.5 text-xs text-[#e5e4e2]">
                                  +{meeting.participants.length - 3} więcej
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {meeting.notes && (
                          <p className="line-clamp-2 text-sm text-[#e5e4e2]/60">
                            {meeting.notes}
                          </p>
                        )}

                        {meeting.event && (
                          <div className="mt-2 inline-flex items-center gap-1 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 px-2 py-1 text-xs text-[#d3bb73]">
                            <Calendar size={12} />
                            {meeting.event.name}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {isModalOpen && (
          <NewMeetingModal
            isOpen={isModalOpen}
            onClose={() => {
              setIsModalOpen(false);
              fetchMeetings();
            }}
          />
        )}
      </div>
    </div>
  );
}
