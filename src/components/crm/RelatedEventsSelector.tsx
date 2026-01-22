'use client';

import { useState, useEffect, useRef } from 'react';
import { Calendar, Plus, X, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

interface Event {
  id: string;
  name: string;
  event_date: string;
  location?: string;
  status: string;
  event_categories?: {
    name: string;
    color: string;
  };
}

interface RelatedEventsSelectorProps {
  value: string[];
  onChange: (eventIds: string[]) => void;
  currentEventId?: string;
  placeholder?: string;
  className?: string;
}

export default function RelatedEventsSelector({
  value,
  onChange,
  currentEventId,
  placeholder = 'Wyszukaj powiązane wydarzenia...',
  className = '',
}: RelatedEventsSelectorProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<Event[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchEvents();
  }, [currentEventId]);

  useEffect(() => {
    if (value.length > 0 && events.length > 0) {
      const selected = events.filter((e) => value.includes(e.id));
      setSelectedEvents(selected);
    } else {
      setSelectedEvents([]);
    }
  }, [value, events]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchEvents = async () => {
    let query = supabase
      .from('events')
      .select(
        `
        id,
        name,
        event_date,
        location,
        status,
        event_categories (
          name,
          color
        )
      `,
      )
      .order('event_date', { ascending: false })
      .limit(100);

    if (currentEventId) {
      query = query.neq('id', currentEventId);
    }

    const { data } = await query;
    if (data) setEvents(data);
  };

  const filteredEvents = events.filter((event) => {
    if (value.includes(event.id)) return false;

    const searchLower = inputValue.toLowerCase();
    return (
      event.name.toLowerCase().includes(searchLower) ||
      event.location?.toLowerCase().includes(searchLower) ||
      event.event_categories?.name?.toLowerCase().includes(searchLower)
    );
  });

  const handleSelectEvent = (event: Event) => {
    if (!value.includes(event.id)) {
      onChange([...value, event.id]);
    }
    setInputValue('');
    setShowDropdown(false);
  };

  const handleRemoveEvent = (eventId: string) => {
    onChange(value.filter((id) => id !== eventId));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setShowDropdown(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      inquiry: 'Zapytanie',
      offer_sent: 'Oferta wysłana',
      offer_accepted: 'Oferta zaakceptowana',
      contract_sent: 'Umowa wysłana',
      contract_signed: 'Umowa podpisana',
      in_preparation: 'W przygotowaniu',
      in_progress: 'W trakcie',
      completed: 'Zakończony',
      cancelled: 'Anulowany',
    };
    return statusMap[status] || status;
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="relative">
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/50" />
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowDropdown(true)}
            placeholder={placeholder}
            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] py-2 pl-10 pr-10 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
          />
          {inputValue && (
            <button
              type="button"
              onClick={() => {
                setInputValue('');
                setShowDropdown(false);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/50 transition-colors hover:text-[#e5e4e2]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {showDropdown && (
          <div
            ref={dropdownRef}
            className="absolute z-50 mt-2 max-h-96 w-full overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl"
          >
            {filteredEvents.length > 0 ? (
              filteredEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => handleSelectEvent(event)}
                  className="w-full border-b border-[#d3bb73]/10 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[#d3bb73]/10"
                >
                  <div className="flex items-start gap-3">
                    <Calendar className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-[#e5e4e2]">{event.name}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-[#e5e4e2]/60">
                        <span>{formatDate(event.event_date)}</span>
                        {event.location && (
                          <>
                            <span>•</span>
                            <span className="truncate">{event.location}</span>
                          </>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {event.event_categories && (
                          <span
                            className="rounded px-2 py-0.5 text-xs"
                            style={{
                              backgroundColor: `${event.event_categories.color}20`,
                              color: event.event_categories.color,
                            }}
                          >
                            {event.event_categories.name}
                          </span>
                        )}
                        <span className="text-xs text-[#e5e4e2]/50">
                          {getStatusLabel(event.status)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-sm text-[#e5e4e2]/50">
                {inputValue
                  ? `Brak wydarzeń pasujących do "${inputValue}"`
                  : 'Brak dostępnych wydarzeń do powiązania'}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedEvents.length > 0 && (
        <div className="space-y-2">
          {selectedEvents.map((event) => (
            <div
              key={event.id}
              className="flex items-center justify-between rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-3"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Calendar className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[#e5e4e2]">{event.name}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-[#e5e4e2]/60">
                    <span>{formatDate(event.event_date)}</span>
                    {event.location && (
                      <>
                        <span>•</span>
                        <span className="truncate">{event.location}</span>
                      </>
                    )}
                  </div>
                  {event.event_categories && (
                    <span
                      className="mt-1 inline-block rounded px-2 py-0.5 text-xs"
                      style={{
                        backgroundColor: `${event.event_categories.color}20`,
                        color: event.event_categories.color,
                      }}
                    >
                      {event.event_categories.name}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRemoveEvent(event.id)}
                className="ml-2 flex-shrink-0 rounded p-1 transition-colors hover:bg-red-500/20"
              >
                <X className="h-4 w-4 text-red-400" />
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedEvents.length === 0 && (
        <div className="py-4 text-center text-sm text-[#e5e4e2]/50">
          Brak powiązanych wydarzeń. Rozpocznij wpisywanie aby dodać.
        </div>
      )}
    </div>
  );
}
