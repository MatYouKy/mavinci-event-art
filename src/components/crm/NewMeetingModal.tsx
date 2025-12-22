'use client';

import { useState, useEffect } from 'react';
import { X, Calendar, MapPin, Users, FileText, Link, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import LocationAutocomplete from './LocationAutocomplete';
import RelatedEventsSelector from './RelatedEventsSelector';
import { useCreateMeetingMutation } from '@/store/api/calendarApi';
import { useSnackbar } from '@/contexts/SnackbarContext';

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

export default function NewMeetingModal({ isOpen, onClose, onSuccess, initialDate }: NewMeetingModalProps) {
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
    const { data } = await supabase
      .from('employees')
      .select('id, name, surname')
      .order('name');
    if (data) setEmployees(data);
  };

  const fetchContacts = async () => {
    const { data } = await supabase
      .from('contacts')
      .select('id, name')
      .order('name');
    if (data) setContacts(data);
  };

  const handleAddEmployee = (emp: any) => {
    if (!participants.find(p => p.type === 'employee' && p.id === emp.id)) {
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
    if (!participants.find(p => p.type === 'contact' && p.id === contact.id)) {
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
      const datetimeStart = isAllDay
        ? `${dateStart}T00:00:00Z`
        : `${dateStart}T${timeStart}:00Z`;

      const datetimeEnd =
        dateEnd && !isAllDay
          ? `${dateEnd}T${timeEnd}:00Z`
          : isAllDay
          ? `${dateEnd || dateStart}T23:59:59Z`
          : null;

      const participantsData = participants.map(p => ({
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

      console.log('✅ Meeting created successfully:', result.id, result.title);

      showSnackbar('Spotkanie zostało utworzone pomyślnie', 'success');

      handleClose();

      setTimeout(() => {
        console.log('🔄 Calling onSuccess callback');
        onSuccess?.();
      }, 300);
    } catch (err: any) {
      console.error('Error creating meeting:', err);
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
    e =>
      participantSearch &&
      `${e.name} ${e.surname}`.toLowerCase().includes(participantSearch.toLowerCase())
  );

  const filteredContacts = contacts.filter(
    c => participantSearch && c.name.toLowerCase().includes(participantSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#0f1119] border-b border-[#d3bb73]/10 p-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-[#e5e4e2]">Nowe spotkanie / Przypomnienie</h2>
          <button onClick={handleClose} className="p-2 hover:bg-[#e5e4e2]/10 rounded-lg">
            <X className="w-5 h-5 text-[#e5e4e2]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Tytuł <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
              placeholder="np. Spotkanie z klientem, Przegląd sprzętu..."
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Lokalizacja</label>
            <LocationAutocomplete
              value={locationText}
              onChange={(textValue, locId) => {
                setLocationText(textValue);
                setLocationId(locId || null);
              }}
              placeholder="Wybierz lub wpisz lokalizację"
            />
            <p className="text-xs text-[#e5e4e2]/50 mt-1">
              Wybierz z listy lub wpisz dowolny adres
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isAllDay"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="isAllDay" className="text-[#e5e4e2]">
              Wydarzenie całodniowe
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Data rozpoczęcia <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                required
              />
            </div>
            {!isAllDay && (
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Godzina rozpoczęcia</label>
                <input
                  type="time"
                  value={timeStart}
                  onChange={(e) => setTimeStart(e.target.value)}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              </div>
            )}
          </div>

          {!isAllDay && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Data zakończenia</label>
                <input
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Godzina zakończenia</label>
                <input
                  type="time"
                  value={timeEnd}
                  onChange={(e) => setTimeEnd(e.target.value)}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Kolor</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-32 h-10 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg cursor-pointer"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Uczestnicy</label>
            <div className="space-y-2">
              {participants.map((p, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2"
                >
                  <span className="text-[#e5e4e2]">
                    {p.name} <span className="text-xs text-[#e5e4e2]/50">({p.type === 'employee' ? 'Pracownik' : 'Kontakt'})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveParticipant(idx)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <X className="w-4 h-4" />
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
                  className="px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2] hover:border-[#d3bb73]/30"
                >
                  + Dodaj pracownika
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowContactList(!showContactList);
                    setShowEmployeeList(false);
                  }}
                  className="px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2] hover:border-[#d3bb73]/30"
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
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                    autoFocus
                  />
                  {participantSearch && (
                    <div className="absolute z-10 w-full mt-1 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg max-h-48 overflow-y-auto">
                      {showEmployeeList &&
                        filteredEmployees.map(emp => (
                          <button
                            key={emp.id}
                            type="button"
                            onClick={() => handleAddEmployee(emp)}
                            className="w-full text-left px-4 py-2 text-[#e5e4e2] hover:bg-[#1c1f33]"
                          >
                            {emp.name} {emp.surname}
                          </button>
                        ))}
                      {showContactList &&
                        filteredContacts.map(contact => (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={() => handleAddContact(contact)}
                            className="w-full text-left px-4 py-2 text-[#e5e4e2] hover:bg-[#1c1f33]"
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
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Powiązane wydarzenia (opcjonalnie)</label>
            <RelatedEventsSelector
              value={relatedEventIds}
              onChange={setRelatedEventIds}
              placeholder="Wyszukaj wydarzenia..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Notatki</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
              placeholder="Dodatkowe informacje o spotkaniu..."
            />
          </div>

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="px-6 py-3 border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] hover:bg-[#e5e4e2]/5"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={isSaving || !title || !dateStart}
              className="px-6 py-3 bg-[#d3bb73] text-[#0f1119] rounded-lg font-medium hover:bg-[#d3bb73]/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Zapisywanie...' : 'Utwórz spotkanie'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
