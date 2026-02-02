'use client';

import { useState, useEffect } from 'react';
import { X, Calendar, MapPin, Users, FileText, Link, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import LocationAutocomplete from './LocationAutocomplete';
import RelatedEventsSelector from './RelatedEventsSelector';
import { useCreateMeetingMutation } from '@/store/api/calendarApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { localDatetimeStringToUTC } from '@/lib/utils/dateTimeUtils';

interface NewMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialDate?: Date;
}

interface MeetingParticipant {
  type: 'employee' | 'contact';
  id: string;
  name: string;
}

export default function NewMeetingModal({
  isOpen,
  onClose,
  onSuccess,
  initialDate,
}: NewMeetingModalProps) {
  const [title, setTitle] = useState('');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locationText, setLocationText] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [timeStart, setTimeStart] = useState('09:00');
  const [dateEnd, setDateEnd] = useState('');
  const [timeEnd, setTimeEnd] = useState('10:00');
  const [isAllDay, setIsAllDay] = useState(false);
  const [notes, setNotes] = useState('');
  const [relatedEventIds, setRelatedEventIds] = useState<string[]>([]);
  const [color, setColor] = useState('#FFFFFF');
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const [createMeeting] = useCreateMeetingMutation();
  const { showSnackbar } = useSnackbar();

  const [employees, setEmployees] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [showEmployeeList, setShowEmployeeList] = useState(false);
  const [showContactList, setShowContactList] = useState(false);
  const [participantSearch, setParticipantSearch] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (initialDate) {
        const year = initialDate.getFullYear();
        const month = String(initialDate.getMonth() + 1).padStart(2, '0');
        const day = String(initialDate.getDate()).padStart(2, '0');
        setDateStart(`${year}-${month}-${day}`);
        setDateEnd(`${year}-${month}-${day}`);
      } else {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        setDateStart(`${year}-${month}-${day}`);
        setDateEnd(`${year}-${month}-${day}`);
      }
      fetchEmployees();
      fetchContacts();
    }
  }, [isOpen, initialDate]);

  const fetchEmployees = async () => {
    const { data } = await supabase.from('employees').select('id, name, surname').order('name');
    if (data) setEmployees(data);
  };

  const fetchContacts = async () => {
    const { data } = await supabase.from('contacts').select('id, name').order('name');
    if (data) setContacts(data);
  };

  const handleAddEmployee = (emp: any) => {
    if (!participants.find((p) => p.type === 'employee' && p.id === emp.id)) {
      setParticipants([
        ...participants,
        {
          type: 'employee',
          id: emp.id,
          name: `${emp.name} ${emp.surname}`,
        },
      ]);
    }
    setShowEmployeeList(false);
    setParticipantSearch('');
  };

  const handleAddContact = (contact: any) => {
    if (!participants.find((p) => p.type === 'contact' && p.id === contact.id)) {
      setParticipants([
        ...participants,
        {
          type: 'contact',
          id: contact.id,
          name: contact.name,
        },
      ]);
    }
    setShowContactList(false);
    setParticipantSearch('');
  };

  const handleRemoveParticipant = (index: number) => {
    setParticipants(participants.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !dateStart) return;

    setIsSaving(true);

    try {
      // Konwertuj czas lokalny na UTC używając pomocniczej funkcji
      const datetimeStart = isAllDay
        ? `${dateStart}T00:00:00Z`
        : localDatetimeStringToUTC(`${dateStart}T${timeStart}`);

      const datetimeEnd =
        dateEnd && !isAllDay
          ? localDatetimeStringToUTC(`${dateEnd}T${timeEnd}`)
          : isAllDay
            ? `${dateEnd || dateStart}T23:59:59Z`
            : null;

      const participantsData = participants.map((p) => ({
        employee_id: p.type === 'employee' ? p.id : undefined,
        contact_id: p.type === 'contact' ? p.id : undefined,
      }));

      const result = await createMeeting({
        title,
        location_id: locationId,
        location_text: locationText || null,
        datetime_start: datetimeStart,
        datetime_end: datetimeEnd,
        is_all_day: isAllDay,
        notes: notes || null,
        related_event_ids: relatedEventIds.length > 0 ? relatedEventIds : null,
        color,
        participants: participantsData.length > 0 ? participantsData : undefined,
      }).unwrap();

      showSnackbar('Spotkanie zostało utworzone pomyślnie', 'success');

      handleClose();

      setTimeout(() => {
        onSuccess?.();
      }, 300);
    } catch (err: any) {
      showSnackbar(err?.error || err?.message || 'Błąd podczas tworzenia spotkania', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setTitle('');
    setLocationId(null);
    setLocationText('');
    setDateStart('');
    setTimeStart('09:00');
    setDateEnd('');
    setTimeEnd('10:00');
    setIsAllDay(false);
    setNotes('');
    setRelatedEventIds([]);
    setColor('#d3bb73');
    setParticipants([]);
    onClose();
  };

  if (!isOpen) return null;

  const filteredEmployees = employees.filter(
    (e) =>
      participantSearch &&
      `${e.name} ${e.surname}`.toLowerCase().includes(participantSearch.toLowerCase()),
  );

  const filteredContacts = contacts.filter(
    (c) => participantSearch && c.name.toLowerCase().includes(participantSearch.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-[#0f1119]">
        <div className="sticky top-0 flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#0f1119] p-6">
          <h2 className="text-2xl font-semibold text-[#e5e4e2]">Nowe spotkanie / Przypomnienie</h2>
          <button onClick={handleClose} className="rounded-lg p-2 hover:bg-[#e5e4e2]/10">
            <X className="h-5 w-5 text-[#e5e4e2]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Tytuł <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
              placeholder="np. Spotkanie z klientem, Przegląd sprzętu..."
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Lokalizacja</label>
            <LocationAutocomplete
              value={locationText}
              onChange={(textValue, locId) => {
                setLocationText(textValue);
                setLocationId(locId || null);
              }}
              placeholder="Wybierz lub wpisz lokalizację"
            />
            <p className="mt-1 text-xs text-[#e5e4e2]/50">
              Wybierz z listy lub wpisz dowolny adres
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isAllDay"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="isAllDay" className="text-[#e5e4e2]">
              Wydarzenie całodniowe
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Data rozpoczęcia <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                required
              />
            </div>
            {!isAllDay && (
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Godzina rozpoczęcia
                </label>
                <input
                  type="time"
                  value={timeStart}
                  onChange={(e) => setTimeStart(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                />
              </div>
            )}
          </div>

          {!isAllDay && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Data zakończenia
                </label>
                <input
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Godzina zakończenia
                </label>
                <input
                  type="time"
                  value={timeEnd}
                  onChange={(e) => setTimeEnd(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Kolor</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-32 cursor-pointer rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Uczestnicy</label>
            <div className="space-y-2">
              {participants.map((p, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-2"
                >
                  <span className="text-[#e5e4e2]">
                    {p.name}{' '}
                    <span className="text-xs text-[#e5e4e2]/50">
                      ({p.type === 'employee' ? 'Pracownik' : 'Kontakt'})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveParticipant(idx)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEmployeeList(!showEmployeeList);
                    setShowContactList(false);
                  }}
                  className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] hover:border-[#d3bb73]/30"
                >
                  + Dodaj pracownika
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowContactList(!showContactList);
                    setShowEmployeeList(false);
                  }}
                  className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] hover:border-[#d3bb73]/30"
                >
                  + Dodaj kontakt
                </button>
              </div>
              {(showEmployeeList || showContactList) && (
                <div className="relative">
                  <input
                    type="text"
                    value={participantSearch}
                    onChange={(e) => setParticipantSearch(e.target.value)}
                    placeholder="Wpisz imię..."
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                    autoFocus
                  />
                  {participantSearch && (
                    <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]">
                      {showEmployeeList &&
                        filteredEmployees.map((emp) => (
                          <button
                            key={emp.id}
                            type="button"
                            onClick={() => handleAddEmployee(emp)}
                            className="w-full px-4 py-2 text-left text-[#e5e4e2] hover:bg-[#1c1f33]"
                          >
                            {emp.name} {emp.surname}
                          </button>
                        ))}
                      {showContactList &&
                        filteredContacts.map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={() => handleAddContact(contact)}
                            className="w-full px-4 py-2 text-left text-[#e5e4e2] hover:bg-[#1c1f33]"
                          >
                            {contact.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Powiązane wydarzenia (opcjonalnie)
            </label>
            <RelatedEventsSelector
              value={relatedEventIds}
              onChange={setRelatedEventIds}
              placeholder="Wyszukaj wydarzenia..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Notatki</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
              placeholder="Dodatkowe informacje o spotkaniu..."
            />
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-[#d3bb73]/20 px-6 py-3 text-[#e5e4e2] hover:bg-[#e5e4e2]/5"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={isSaving || !title || !dateStart}
              className="rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#0f1119] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? 'Zapisywanie...' : 'Utwórz spotkanie'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
