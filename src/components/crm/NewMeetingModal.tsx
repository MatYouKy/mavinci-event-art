'use client';

import { useEffect, useState } from 'react';
import { Bell, BellRing, Clock, X } from 'lucide-react';
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

interface EmployeeOption {
  id: string;
  name: string;
  surname: string;
}

interface ContactOption {
  id: string;
  name: string;
}

interface AlertOption {
  value: number;
  label: string;
}

const ALERT_OPTIONS: AlertOption[] = [
  { value: 5, label: '5 minut przed' },
  { value: 10, label: '10 minut przed' },
  { value: 15, label: '15 minut przed' },
  { value: 30, label: '30 minut przed' },
  { value: 45, label: '45 minut przed' },
  { value: 60, label: '1 godzinę przed' },
  { value: 120, label: '2 godziny przed' },
  { value: 180, label: '3 godziny przed' },
  { value: 360, label: '6 godzin przed' },
  { value: 720, label: '12 godzin przed' },
  { value: 1440, label: '1 dzień przed' },
  { value: 2880, label: '2 dni przed' },
  { value: 4320, label: '3 dni przed' },
  { value: 10080, label: '7 dni przed' },
];

const DEFAULT_ALERTS = {
  alert1Enabled: true,
  alert1Minutes: 1440,
  alert2Enabled: true,
  alert2Minutes: 120,
  criticalAlertEnabled: true,
  criticalAlertMinutes: 30,
};

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
  const [color, setColor] = useState('#d3bb73');
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const [alert1Enabled, setAlert1Enabled] = useState(DEFAULT_ALERTS.alert1Enabled);
  const [alert1Minutes, setAlert1Minutes] = useState(DEFAULT_ALERTS.alert1Minutes);
  const [alert2Enabled, setAlert2Enabled] = useState(DEFAULT_ALERTS.alert2Enabled);
  const [alert2Minutes, setAlert2Minutes] = useState(DEFAULT_ALERTS.alert2Minutes);
  const [criticalAlertEnabled, setCriticalAlertEnabled] = useState(
    DEFAULT_ALERTS.criticalAlertEnabled,
  );
  const [criticalAlertMinutes, setCriticalAlertMinutes] = useState(
    DEFAULT_ALERTS.criticalAlertMinutes,
  );

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [showEmployeeList, setShowEmployeeList] = useState(false);
  const [showContactList, setShowContactList] = useState(false);
  const [participantSearch, setParticipantSearch] = useState('');

  const [createMeeting] = useCreateMeetingMutation();
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    if (!isOpen) return;

    const selectedDate = initialDate ?? new Date();
    const year = selectedDate.getFullYear();
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const day = String(selectedDate.getDate()).padStart(2, '0');
    const formattedDate = `${year}-${month}-${day}`;

    setDateStart(formattedDate);
    setDateEnd(formattedDate);

    void fetchEmployees();
    void fetchContacts();
  }, [isOpen, initialDate]);

  const fetchEmployees = async () => {
    const { data, error } = await supabase
      .from('employees')
      .select('id, name, surname')
      .order('name');

    if (error) {
      console.error('[NewMeetingModal] Employees error:', error);
      return;
    }

    setEmployees(data ?? []);
  };

  const fetchContacts = async () => {
    const { data, error } = await supabase.from('contacts').select('id, name').order('name');

    if (error) {
      console.error('[NewMeetingModal] Contacts error:', error);
      return;
    }

    setContacts(data ?? []);
  };

  const handleAddEmployee = (employee: EmployeeOption) => {
    setParticipants((current) => {
      const alreadyAdded = current.some(
        (participant) => participant.type === 'employee' && participant.id === employee.id,
      );

      if (alreadyAdded) return current;

      return [
        ...current,
        {
          type: 'employee',
          id: employee.id,
          name: `${employee.name} ${employee.surname}`.trim(),
        },
      ];
    });

    setShowEmployeeList(false);
    setParticipantSearch('');
  };

  const handleAddContact = (contact: ContactOption) => {
    setParticipants((current) => {
      const alreadyAdded = current.some(
        (participant) => participant.type === 'contact' && participant.id === contact.id,
      );

      if (alreadyAdded) return current;

      return [
        ...current,
        {
          type: 'contact',
          id: contact.id,
          name: contact.name,
        },
      ];
    });

    setShowContactList(false);
    setParticipantSearch('');
  };

  const handleRemoveParticipant = (index: number) => {
    setParticipants((current) =>
      current.filter((_, participantIndex) => participantIndex !== index),
    );
  };

  const resetForm = () => {
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
    setParticipantSearch('');
    setShowEmployeeList(false);
    setShowContactList(false);

    setAlert1Enabled(DEFAULT_ALERTS.alert1Enabled);
    setAlert1Minutes(DEFAULT_ALERTS.alert1Minutes);
    setAlert2Enabled(DEFAULT_ALERTS.alert2Enabled);
    setAlert2Minutes(DEFAULT_ALERTS.alert2Minutes);
    setCriticalAlertEnabled(DEFAULT_ALERTS.criticalAlertEnabled);
    setCriticalAlertMinutes(DEFAULT_ALERTS.criticalAlertMinutes);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!title.trim() || !dateStart) {
      showSnackbar('Podaj tytuł oraz datę rozpoczęcia', 'error');
      return;
    }

    setIsSaving(true);

    try {
      const datetimeStart = isAllDay
        ? `${dateStart}T00:00:00Z`
        : localDatetimeStringToUTC(`${dateStart}T${timeStart}`);

      if (!datetimeStart) {
        showSnackbar('Nie udało się przetworzyć daty i godziny rozpoczęcia', 'error');
        return;
      }

      const datetimeEnd = isAllDay
        ? `${dateEnd || dateStart}T23:59:59Z`
        : dateEnd
          ? localDatetimeStringToUTC(`${dateEnd}T${timeEnd}`)
          : null;

      if (datetimeEnd && new Date(datetimeEnd).getTime() < new Date(datetimeStart).getTime()) {
        showSnackbar('Data zakończenia nie może być wcześniejsza niż rozpoczęcie', 'error');
        return;
      }

      const participantsData = participants.map((participant) => ({
        employee_id: participant.type === 'employee' ? participant.id : undefined,
        contact_id: participant.type === 'contact' ? participant.id : undefined,
      }));

      await createMeeting({
        title: title.trim(),
        location_id: locationId,
        location_text: locationText.trim() || null,
        datetime_start: datetimeStart,
        datetime_end: datetimeEnd,
        is_all_day: isAllDay,
        notes: notes.trim() || null,
        related_event_ids: relatedEventIds.length > 0 ? relatedEventIds : null,
        color,
        participants: participantsData.length > 0 ? participantsData : undefined,

        alert_1_minutes: alert1Enabled ? alert1Minutes : null,
        alert_2_minutes: alert2Enabled ? alert2Minutes : null,
        alert_critical_minutes: criticalAlertEnabled ? criticalAlertMinutes : null,
      }).unwrap();

      showSnackbar('Spotkanie zostało utworzone pomyślnie', 'success');

      handleClose();

      window.setTimeout(() => {
        onSuccess?.();
      }, 300);
    } catch (error: unknown) {
      const message =
        error && typeof error === 'object' && ('error' in error || 'message' in error)
          ? String(
              'error' in error
                ? error.error
                : 'message' in error
                  ? error.message
                  : 'Błąd podczas tworzenia spotkania',
            )
          : 'Błąd podczas tworzenia spotkania';

      showSnackbar(message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const normalizedSearch = participantSearch.trim().toLowerCase();

  const filteredEmployees = employees.filter((employee) =>
    `${employee.name} ${employee.surname}`.toLowerCase().includes(normalizedSearch),
  );

  const filteredContacts = contacts.filter((contact) =>
    contact.name.toLowerCase().includes(normalizedSearch),
  );

  const AlertRow = ({
    title: alertTitle,
    description,
    enabled,
    minutes,
    critical = false,
    onEnabledChange,
    onMinutesChange,
  }: {
    title: string;
    description: string;
    enabled: boolean;
    minutes: number;
    critical?: boolean;
    onEnabledChange: (enabled: boolean) => void;
    onMinutesChange: (minutes: number) => void;
  }) => (
    <div
      className={`rounded-2xl border p-5 transition-colors ${
        critical
          ? 'border-red-500/20 bg-gradient-to-br from-red-500/[0.07] to-[#1c1f33]'
          : 'border-[#d3bb73]/10 bg-gradient-to-br from-[#20243a] to-[#1c1f33]'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              critical ? 'bg-red-500/10 text-red-400' : 'bg-[#d3bb73]/10 text-[#d3bb73]'
            }`}
          >
            {critical ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
          </div>

          <div>
            <p className={`text-sm font-semibold ${critical ? 'text-red-300' : 'text-[#e5e4e2]'}`}>
              {alertTitle}
            </p>

            <p className={`mt-1 text-xs ${critical ? 'text-red-300/65' : 'text-[#e5e4e2]/50'}`}>
              {description}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => onEnabledChange(!enabled)}
          className={`relative h-8 w-14 shrink-0 rounded-full border transition-all duration-200 ${
            enabled
              ? critical
                ? 'border-red-400/40 bg-gradient-to-r from-red-500 to-red-400 shadow-[0_0_16px_rgba(239,68,68,0.22)]'
                : 'border-[#e4cb78]/40 bg-gradient-to-r from-[#d3bb73] to-[#e4cb78] shadow-[0_0_16px_rgba(211,187,115,0.2)]'
              : 'border-white/10 bg-[#2a2e43]'
          }`}
        >
          <span
            className={`absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.35)] transition-all duration-200 ${
              enabled ? 'left-7' : 'left-1'
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="mt-5">
          <label className="mb-2 flex items-center gap-2 text-xs text-[#e5e4e2]/55">
            <Clock className="h-3.5 w-3.5" />
            Czas przed rozpoczęciem spotkania
          </label>

          <select
            value={minutes}
            onChange={(event) => onMinutesChange(Number(event.target.value))}
            className={`w-full appearance-none rounded-xl border bg-[#0f1119] px-4 py-3 text-sm text-[#e5e4e2] outline-none transition-colors ${
              critical
                ? 'border-red-500/20 focus:border-red-500/50'
                : 'border-[#d3bb73]/10 focus:border-[#d3bb73]/40'
            }`}
          >
            {ALERT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-[#0f1119]">
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#0f1119] p-6">
          <h2 className="text-2xl font-semibold text-[#e5e4e2]">Nowe spotkanie / Przypomnienie</h2>

          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-2 hover:bg-[#e5e4e2]/10"
          >
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
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
              placeholder="np. Spotkanie z klientem"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Lokalizacja</label>

            <LocationAutocomplete
              value={locationText}
              onChange={(textValue, selectedLocationId) => {
                setLocationText(textValue);
                setLocationId(selectedLocationId || null);
              }}
              placeholder="Wybierz lub wpisz lokalizację"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={isAllDay}
              onChange={(event) => setIsAllDay(event.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-[#e5e4e2]">Wydarzenie całodniowe</span>
          </label>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Data rozpoczęcia <span className="text-red-400">*</span>
              </label>

              <input
                type="date"
                value={dateStart}
                onChange={(event) => {
                  setDateStart(event.target.value);

                  if (!dateEnd || event.target.value > dateEnd) {
                    setDateEnd(event.target.value);
                  }
                }}
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
                  onChange={(event) => setTimeStart(event.target.value)}
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
                  min={dateStart}
                  value={dateEnd}
                  onChange={(event) => setDateEnd(event.target.value)}
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
                  onChange={(event) => setTimeEnd(event.target.value)}
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
              onChange={(event) => setColor(event.target.value)}
              className="h-10 w-32 cursor-pointer rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Uczestnicy</label>

            <div className="space-y-2">
              {participants.map((participant, index) => (
                <div
                  key={`${participant.type}-${participant.id}`}
                  className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-2"
                >
                  <span className="text-[#e5e4e2]">
                    {participant.name}{' '}
                    <span className="text-xs text-[#e5e4e2]/50">
                      ({participant.type === 'employee' ? 'Pracownik' : 'Kontakt'})
                    </span>
                  </span>

                  <button
                    type="button"
                    onClick={() => handleRemoveParticipant(index)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEmployeeList((current) => !current);
                    setShowContactList(false);
                    setParticipantSearch('');
                  }}
                  className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] hover:border-[#d3bb73]/30"
                >
                  + Dodaj pracownika
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowContactList((current) => !current);
                    setShowEmployeeList(false);
                    setParticipantSearch('');
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
                    onChange={(event) => setParticipantSearch(event.target.value)}
                    placeholder="Wpisz imię lub nazwę..."
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                    autoFocus
                  />

                  {normalizedSearch && (
                    <div className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] shadow-xl">
                      {showEmployeeList &&
                        filteredEmployees.map((employee) => (
                          <button
                            key={employee.id}
                            type="button"
                            onClick={() => handleAddEmployee(employee)}
                            className="w-full px-4 py-2 text-left text-[#e5e4e2] hover:bg-[#1c1f33]"
                          >
                            {employee.name} {employee.surname}
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
              Powiązane wydarzenia
            </label>

            <RelatedEventsSelector
              value={relatedEventIds}
              onChange={setRelatedEventIds}
              placeholder="Wyszukaj wydarzenia..."
            />
          </div>

          {/* Alerty */}
          <section className="space-y-4 rounded-xl border border-[#d3bb73]/10 bg-[#161829] p-4">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold text-[#e5e4e2]">
                <Bell className="h-4 w-4 text-[#d3bb73]" />
                Alerty
              </h3>

              <p className="mt-1 text-xs text-[#e5e4e2]/45">
                Ustaw przypomnienia wysyłane przed rozpoczęciem spotkania.
              </p>
            </div>

            <AlertRow
              title="Alert 1"
              description="Wczesne przypomnienie o zaplanowanym spotkaniu."
              enabled={alert1Enabled}
              minutes={alert1Minutes}
              onEnabledChange={setAlert1Enabled}
              onMinutesChange={setAlert1Minutes}
            />

            <AlertRow
              title="Alert 2"
              description="Dodatkowe przypomnienie bliżej rozpoczęcia."
              enabled={alert2Enabled}
              minutes={alert2Minutes}
              onEnabledChange={setAlert2Enabled}
              onMinutesChange={setAlert2Minutes}
            />

            <AlertRow
              title="Alert krytyczny"
              description="Pilne przypomnienie tuż przed spotkaniem."
              enabled={criticalAlertEnabled}
              minutes={criticalAlertMinutes}
              critical
              onEnabledChange={setCriticalAlertEnabled}
              onMinutesChange={setCriticalAlertMinutes}
            />
          </section>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Notatki</label>

            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
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
              disabled={isSaving || !title.trim() || !dateStart}
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
