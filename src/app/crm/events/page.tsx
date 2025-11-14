'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Calendar, MapPin, Building2, Tag } from 'lucide-react';
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

export default function EventsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [events, setEvents] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('*')
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

    setEvents([
      {
        id: '1',
        name: 'Konferencja Tech Summit 2025',
        client: 'Tech Corp',
        event_date: '2025-10-15',
        location: 'Warszawa',
        status: 'in_preparation' as const,
        budget: 50000,
      },
      {
        id: '2',
        name: 'Integracja firmowa ABC',
        client: 'ABC Corporation',
        event_date: '2025-10-08',
        location: 'Gdańsk',
        status: 'offer_accepted' as const,
        budget: 25000,
      },
    ]);
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

      <div className="grid gap-4">
        {events.map((event) => (
          <div
            key={event.id}
            onClick={() => router.push(`/crm/events/${event.id}`)}
            className="cursor-pointer rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 transition-all hover:border-[#d3bb73]/30"
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">{event.name}</h3>
                <div className="flex flex-wrap gap-4 text-sm text-[#e5e4e2]/70">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    {event.client_id || 'Brak klienta'}
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {new Date(event.event_date).toLocaleDateString('pl-PL')}
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {event.location}
                  </div>
                </div>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs ${statusColors[event.status]}`}
              >
                {statusLabels[event.status]}
              </span>
            </div>

            <div className="flex items-center justify-between border-t border-[#d3bb73]/10 pt-4">
              <div className="text-sm text-[#e5e4e2]/70">
                Budżet:{' '}
                <span className="font-medium text-[#d3bb73]">
                  {event.budget ? event.budget.toLocaleString() : '0'} zł
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <NewEventModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveEvent}
      />
    </div>
  );
}
