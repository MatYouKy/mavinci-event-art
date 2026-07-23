'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import {
  ArrowLeft,
  Save,
  Trash2,
  Calendar,
  MapPin,
  Users,
  FileText,
  Clock,
  Pencil,
  ChevronDown,
  Plus,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { utcToLocalDatetimeString, localDatetimeStringToUTC } from '@/lib/utils/dateTimeUtils';
import { useDialog } from '@/contexts/DialogContext';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import Link from 'next/link';

interface Meeting {
  event_id: any;
  events: any;
  id: string;
  title: string;
  location_id: string | null;
  location_text: string | null;
  datetime_start: string;
  datetime_end: string | null;
  notes: string | null;
  related_event_ids: string[] | null;
  created_by: string | null;
  color: string;
  is_all_day: boolean;

  alert_1_minutes: number | null;
  alert_2_minutes: number | null;
  alert_critical_minutes: number | null;

  location?: {
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
    employee_id: string | null;
    contact_id: string | null;
    employee?: {
      id: string;
      name: string;
      surname: string;
      avatar_url: string | null;
    };
    contact?: {
      id: string;
      first_name: string;
      last_name: string;
    };
  }>;
}
interface EmployeeOption {
  id: string;
  name: string;
  surname: string;
  nickname: string | null;
  avatar_url: string | null;
}

const ALERT_OPTIONS = [
  { value: 5, label: '5 minut wcześniej' },
  { value: 10, label: '10 minut wcześniej' },
  { value: 15, label: '15 minut wcześniej' },
  { value: 30, label: '30 minut wcześniej' },
  { value: 60, label: '1 godzinę wcześniej' },
  { value: 120, label: '2 godziny wcześniej' },
  { value: 180, label: '3 godziny wcześniej' },
  { value: 360, label: '6 godzin wcześniej' },
  { value: 720, label: '12 godzin wcześniej' },
  { value: 1440, label: '1 dzień wcześniej' },
  { value: 2880, label: '2 dni wcześniej' },
  { value: 4320, label: '3 dni wcześniej' },
  { value: 10080, label: '7 dni wcześniej' },
];

export default function MeetingDetailPage() {
  const { showConfirm } = useDialog();
  const params = useParams();
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const meetingId = params.id as string;

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [formData, setFormData] = useState({
    title: '',
    location_id: null as string | null,
    location_text: '',
    datetime_start: '',
    datetime_end: '',
    notes: '',
    color: '#d3bb73',
    is_all_day: false,

    alert_1_minutes: null as number | null,
    alert_2_minutes: null as number | null,
    alert_critical_minutes: null as number | null,
  });

  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [participantToAdd, setParticipantToAdd] = useState('');

  const [participantSearch, setParticipantSearch] = useState('');
  const [isParticipantDropdownOpen, setIsParticipantDropdownOpen] = useState(false);

  useEffect(() => {
    fetchMeeting();
    fetchEmployees();
  }, [meetingId]);

  const fetchEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, surname, nickname, avatar_url')
        .eq('is_active', true)
        .order('name', { ascending: true })
        .order('surname', { ascending: true });

      if (error) throw error;

      setEmployees(data || []);
    } catch (error) {
      console.error('Error fetching employees:', error);
      showSnackbar('Nie udało się pobrać listy pracowników', 'error');
    }
  };

  const fetchMeeting = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('meetings')
        .select(
          `
          *,
          location:locations(id, name),
          creator:employees!meetings_created_by_fkey(id, name, surname),
          participants:meeting_participants(
            id,
            employee_id,
            contact_id,
            employee:employees(id, name, surname, avatar_url),
            contact:contacts(id, first_name, last_name)
          )
        `,
        )
        .eq('id', meetingId)
        .is('deleted_at', null)
        .single();

      if (error) throw error;

      setMeeting(data);
      setFormData({
        title: data.title,
        location_id: data.location_id,
        location_text: data.location_text || '',
        datetime_start: utcToLocalDatetimeString(data.datetime_start),
        datetime_end: data.datetime_end ? utcToLocalDatetimeString(data.datetime_end) : '',
        notes: data.notes || '',
        color: data.color || '#d3bb73',
        is_all_day: data.is_all_day,

        alert_1_minutes: data.alert_1_minutes ?? null,
        alert_2_minutes: data.alert_2_minutes ?? null,
        alert_critical_minutes: data.alert_critical_minutes ?? null,
      });

      if (data.participants) {
        const participantIds = data.participants
          .filter((p: any) => p.employee_id)
          .map((p: any) => p.employee_id as string);
        setSelectedParticipants(participantIds);
      }
    } catch (error: any) {
      console.error('Error fetching meeting:', error);
      showSnackbar('Błąd podczas pobierania spotkania', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.title.trim()) {
      showSnackbar('Podaj tytuł spotkania', 'error');
      return;
    }

    const datetimeStart = localDatetimeStringToUTC(formData.datetime_start);

    if (!datetimeStart) {
      showSnackbar('Podaj poprawną datę rozpoczęcia', 'error');
      return;
    }

    const datetimeEnd = formData.datetime_end
      ? localDatetimeStringToUTC(formData.datetime_end)
      : null;

    if (formData.datetime_end && !datetimeEnd) {
      showSnackbar('Podaj poprawną datę zakończenia', 'error');
      return;
    }

    if (datetimeEnd && new Date(datetimeEnd) < new Date(datetimeStart)) {
      showSnackbar('Data zakończenia nie może być wcześniejsza niż rozpoczęcie', 'error');
      return;
    }

    try {
      setSaving(true);

      const { error: updateError } = await supabase
        .from('meetings')
        .update({
          title: formData.title.trim(),
          location_id: formData.location_id,
          location_text: formData.location_text.trim() || null,
          datetime_start: datetimeStart,
          datetime_end: datetimeEnd,
          notes: formData.notes.trim() || null,
          color: formData.color,
          is_all_day: formData.is_all_day,

          alert_1_minutes: formData.alert_1_minutes,
          alert_2_minutes: formData.alert_2_minutes,
          alert_critical_minutes: formData.alert_critical_minutes,

          updated_at: new Date().toISOString(),
        })
        .eq('id', meetingId);

      if (updateError) throw updateError;

      const { error: deleteError } = await supabase
        .from('meeting_participants')
        .delete()
        .eq('meeting_id', meetingId)
        .not('employee_id', 'is', null);

      if (deleteError) throw deleteError;

      if (selectedParticipants.length > 0) {
        const participantsData = selectedParticipants.map((employeeId) => ({
          meeting_id: meetingId,
          employee_id: employeeId,
          contact_id: null,
        }));

        const { error: insertError } = await supabase
          .from('meeting_participants')
          .insert(participantsData);

        if (insertError) throw insertError;
      }

      showSnackbar('Spotkanie zostało zaktualizowane', 'success');
      setIsEditing(false);
      await fetchMeeting();
    } catch (error: any) {
      console.error('Error updating meeting:', error);
      showSnackbar(error?.message || 'Błąd podczas zapisywania spotkania', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddParticipant = () => {
    if (!participantToAdd) return;

    setSelectedParticipants((current) => {
      if (current.includes(participantToAdd)) {
        return current;
      }

      return [...current, participantToAdd];
    });

    setParticipantToAdd('');
  };

  const handleRemoveParticipant = (employeeId: string) => {
    setSelectedParticipants((current) => current.filter((id) => id !== employeeId));
  };

  const getEmployeeLabel = (employeeId: string) => {
    const employee = employees.find((item) => item.id === employeeId);

    if (!employee) return employeeId;

    return employee.nickname
      ? `${employee.nickname} (${employee.name} ${employee.surname})`
      : `${employee.name} ${employee.surname}`;
  };

  const handleDelete = async () => {
    if (!(await showConfirm('Czy na pewno chcesz usunąć to spotkanie?'))) return;
  
    try {
      const { error } = await supabase
        .from('meetings')
        .delete()
        .eq('id', meetingId);
  
      if (error) throw error;
  
      showSnackbar('Spotkanie zostało usunięte', 'success');
      router.replace('/crm/calendar');
      router.refresh();
    } catch (error: any) {
      console.error('Error deleting meeting:', error);
      showSnackbar(
        error?.message || 'Błąd podczas usuwania spotkania',
        'error',
      );
    }
  };

  const filteredEmployees = employees.filter((employee) => {
    if (selectedParticipants.includes(employee.id)) return false;

    const query = participantSearch.trim().toLowerCase();

    if (!query) return true;

    const fullName = `${employee.name} ${employee.surname}`.toLowerCase();
    const nickname = employee.nickname?.toLowerCase() || '';

    return fullName.includes(query) || nickname.includes(query);
  });

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#13161f]">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#13161f]">
        <div className="text-[#e5e4e2]">Spotkanie nie zostało znalezione</div>
      </div>
    );
  }

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

  return (
    <div className="min-h-screen bg-[#13161f] p-4 text-[#e5e4e2] md:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="space-y-6 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="flex items-center justify-between">
            <div className="flex cursor-pointer items-center gap-4 rounded-lg p-2 transition-colors hover:bg-[#1c1f33]">
              <Link href="/crm/calendar" className="flex items-center gap-2">
                <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
                <span className="hidden sm:inline">Powrót</span>
              </Link>
            </div>
            <ResponsiveActionBar
              actions={
                isEditing
                  ? [
                      {
                        label: saving ? 'Zapisywanie...' : 'Zapisz',
                        onClick: handleSave,
                        icon: <Save className="h-4 w-4" />,
                        variant: 'primary',
                        disabled: saving,
                      },
                      {
                        label: 'Anuluj',
                        onClick: () => {
                          if (!meeting) return;

                          setFormData({
                            title: meeting.title,
                            location_id: meeting.location_id,
                            location_text: meeting.location_text || '',
                            datetime_start: utcToLocalDatetimeString(meeting.datetime_start),
                            datetime_end: meeting.datetime_end
                              ? utcToLocalDatetimeString(meeting.datetime_end)
                              : '',
                            notes: meeting.notes || '',
                            color: meeting.color,
                            is_all_day: meeting.is_all_day,
                            alert_1_minutes: meeting.alert_1_minutes ?? null,
                            alert_2_minutes: meeting.alert_2_minutes ?? null,
                            alert_critical_minutes: meeting.alert_critical_minutes ?? null,
                          });

                          setIsEditing(false);
                        },
                        icon: <ArrowLeft className="h-4 w-4" />,
                      },
                    ]
                  : [
                      {
                        label: 'Edytuj',
                        onClick: () => setIsEditing(true),
                        icon: <Pencil className="h-4 w-4" />,
                      },
                      {
                        label: 'Usuń',
                        onClick: handleDelete,
                        icon: <Trash2 className="h-4 w-4" />,
                        variant: 'danger',
                      },
                    ]
              }
            />
          </div>
          <div
            className="h-2 w-full rounded-t-lg"
            style={{ backgroundColor: isEditing ? formData.color : meeting.color }}
          />

          <div>
            <label className="mb-2 block text-sm font-medium text-[#d3bb73]">Tytuł spotkania</label>
            {isEditing ? (
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#13161f] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            ) : (
              <h1 className="text-2xl font-semibold text-[#e5e4e2]">{meeting.title}</h1>
            )}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-[#d3bb73]">
                <Calendar size={16} />
                Data rozpoczęcia
              </label>
              {isEditing ? (
                <input
                  type="datetime-local"
                  value={formData.datetime_start}
                  onChange={(e) => setFormData({ ...formData, datetime_start: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#13161f] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              ) : (
                <p className="text-[#e5e4e2]">{formatDateTime(meeting.datetime_start)}</p>
              )}
            </div>

            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-[#d3bb73]">
                <Clock size={16} />
                Data zakończenia
              </label>
              {isEditing ? (
                <input
                  type="datetime-local"
                  value={formData.datetime_end || ''}
                  onChange={(e) => setFormData({ ...formData, datetime_end: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#13161f] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              ) : (
                <p className="text-[#e5e4e2]">
                  {meeting.datetime_end ? formatDateTime(meeting.datetime_end) : 'Nie określono'}
                </p>
              )}
            </div>
          </div>

          {(isEditing ||
            meeting.alert_1_minutes !== null ||
            meeting.alert_2_minutes !== null ||
            meeting.alert_critical_minutes !== null) && (
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-[#d3bb73]">
                <Clock size={16} />
                Alerty
              </label>

              {isEditing ? (
                <div className="grid gap-2 md:grid-cols-3">
                  {[
                    {
                      key: 'alert_1_minutes' as const,
                      label: 'Alert 1',
                      defaultValue: 60,
                      critical: false,
                    },
                    {
                      key: 'alert_2_minutes' as const,
                      label: 'Alert 2',
                      defaultValue: 120,
                      critical: false,
                    },
                    {
                      key: 'alert_critical_minutes' as const,
                      label: 'Krytyczny',
                      defaultValue: 30,
                      critical: true,
                    },
                  ].map((alert) => {
                    const value = formData[alert.key];
                    const enabled = value !== null;

                    return (
                      <div
                        key={alert.key}
                        className={`flex min-h-[54px] items-center gap-3 rounded-lg border px-3 py-2 ${
                          alert.critical
                            ? 'border-red-500/20 bg-red-500/[0.04]'
                            : 'border-[#d3bb73]/15 bg-[#13161f]'
                        }`}
                      >
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          onClick={() =>
                            setFormData((current) => ({
                              ...current,
                              [alert.key]: enabled ? null : alert.defaultValue,
                            }))
                          }
                          className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
                            enabled
                              ? alert.critical
                                ? 'border-red-400/40 bg-red-500'
                                : 'border-[#e4cb78]/40 bg-[#d3bb73]'
                              : 'border-white/10 bg-[#2a2e43]'
                          }`}
                        >
                          <span
                            className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow transition-all ${
                              enabled ? 'left-6' : 'left-1'
                            }`}
                          />
                        </button>

                        <div className="min-w-0 flex-1">
                          <p
                            className={`mb-1 text-xs font-medium ${
                              alert.critical ? 'text-red-400' : 'text-[#e5e4e2]'
                            }`}
                          >
                            {alert.label}
                          </p>

                          {enabled ? (
                            <select
                              value={value ?? ''}
                              onChange={(event) =>
                                setFormData((current) => ({
                                  ...current,
                                  [alert.key]: Number(event.target.value),
                                }))
                              }
                              className={`w-full border-0 bg-transparent p-0 text-sm text-[#e5e4e2] outline-none ${
                                alert.critical ? 'accent-red-400' : 'accent-[#d3bb73]'
                              }`}
                            >
                              {ALERT_OPTIONS.map((option) => (
                                <option
                                  key={option.value}
                                  value={option.value}
                                  className="bg-[#13161f] text-[#e5e4e2]"
                                >
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <p className="text-xs text-[#e5e4e2]/35">Wyłączony</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {meeting.alert_1_minutes !== null && (
                    <div className="rounded-md border border-[#d3bb73]/15 bg-[#13161f] px-3 py-2">
                      <span className="mr-2 text-xs text-[#e5e4e2]/50">Alert 1</span>
                      <span className="text-sm text-[#e5e4e2]">
                        {ALERT_OPTIONS.find((option) => option.value === meeting.alert_1_minutes)
                          ?.label || `${meeting.alert_1_minutes} minut wcześniej`}
                      </span>
                    </div>
                  )}

                  {meeting.alert_2_minutes !== null && (
                    <div className="rounded-md border border-[#d3bb73]/15 bg-[#13161f] px-3 py-2">
                      <span className="mr-2 text-xs text-[#e5e4e2]/50">Alert 2</span>
                      <span className="text-sm text-[#e5e4e2]">
                        {ALERT_OPTIONS.find((option) => option.value === meeting.alert_2_minutes)
                          ?.label || `${meeting.alert_2_minutes} minut wcześniej`}
                      </span>
                    </div>
                  )}

                  {meeting.alert_critical_minutes !== null && (
                    <div className="rounded-md border border-red-500/20 bg-red-500/[0.04] px-3 py-2">
                      <span className="mr-2 text-xs text-red-400/70">Krytyczny</span>
                      <span className="text-sm text-red-300">
                        {ALERT_OPTIONS.find(
                          (option) => option.value === meeting.alert_critical_minutes,
                        )?.label || `${meeting.alert_critical_minutes} minut wcześniej`}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-[#d3bb73]">
              <MapPin size={16} />
              Lokalizacja
            </label>
            {isEditing ? (
              <input
                type="text"
                value={formData.location_text}
                onChange={(e) =>
                  setFormData({ ...formData, location_text: e.target.value, location_id: null })
                }
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#13161f] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="Wpisz lokalizację..."
              />
            ) : (
              <p className="text-[#e5e4e2]">
                {meeting.location?.name || meeting.location_text || 'Nie określono'}
              </p>
            )}
          </div>
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-[#d3bb73]">
              <Users size={16} />
              Uczestnicy
            </label>

            {isEditing ? (
              <div className="space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    value={participantSearch}
                    onChange={(event) => {
                      setParticipantSearch(event.target.value);
                      setIsParticipantDropdownOpen(true);
                    }}
                    onFocus={() => setIsParticipantDropdownOpen(true)}
                    placeholder="Wyszukaj pracownika..."
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#13161f] px-4 py-2 pr-10 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/35 focus:border-[#d3bb73] focus:outline-none"
                  />

                  <button
                    type="button"
                    onClick={() => setIsParticipantDropdownOpen((current) => !current)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                    aria-label="Pokaż listę pracowników"
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        isParticipantDropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {isParticipantDropdownOpen && (
                    <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-60 overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#13161f] p-1 shadow-2xl">
                      {filteredEmployees.length > 0 ? (
                        filteredEmployees.map((employee) => (
                          <button
                            key={employee.id}
                            type="button"
                            onClick={() => {
                              setSelectedParticipants((current) =>
                                current.includes(employee.id) ? current : [...current, employee.id],
                              );

                              setParticipantSearch('');
                              setIsParticipantDropdownOpen(false);
                            }}
                            className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-[#d3bb73]/10"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm text-[#e5e4e2]">
                                {employee.name} {employee.surname}
                              </p>

                              {employee.nickname && (
                                <p className="truncate text-xs text-[#d3bb73]/70">
                                  {employee.nickname}
                                </p>
                              )}
                            </div>

                            <Plus className="h-4 w-4 shrink-0 text-[#d3bb73]" />
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-4 text-center text-sm text-[#e5e4e2]/45">
                          Nie znaleziono pracowników
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {selectedParticipants.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedParticipants.map((employeeId) => {
                      const employee = employees.find((item) => item.id === employeeId);

                      return (
                        <div
                          key={employeeId}
                          className="flex max-w-full items-center gap-2 rounded-full border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-3 py-1.5"
                        >
                          <span className="truncate text-sm text-[#e5e4e2]">
                            {employee
                              ? employee.nickname || `${employee.name} ${employee.surname}`
                              : employeeId}
                          </span>

                          <button
                            type="button"
                            onClick={() =>
                              setSelectedParticipants((current) =>
                                current.filter((id) => id !== employeeId),
                              )
                            }
                            className="shrink-0 text-red-400 transition-colors hover:text-red-300"
                            aria-label="Usuń pracownika"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-[#e5e4e2]/45">Nie dodano żadnego pracownika.</p>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {meeting.participants && meeting.participants.length > 0 ? (
                  meeting.participants.map((participant) => (
                    <div
                      key={participant.id}
                      className="rounded-full border border-[#d3bb73]/15 bg-[#d3bb73]/10 px-3 py-1.5 text-sm text-[#e5e4e2]"
                    >
                      {participant.employee
                        ? `${participant.employee.name} ${participant.employee.surname}`
                        : participant.contact
                          ? `${participant.contact.first_name} ${participant.contact.last_name}`
                          : 'Nieznany uczestnik'}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[#e5e4e2]/45">Brak uczestników</p>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-[#d3bb73]">
              <FileText size={16} />
              Notatki
            </label>
            {isEditing ? (
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={6}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#13161f] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="Dodaj notatki..."
              />
            ) : (
              <p className="whitespace-pre-wrap text-[#e5e4e2]">
                {meeting.notes || 'Brak notatek'}
              </p>
            )}
          </div>

          {isEditing && (
            <div>
              <label className="mb-2 block text-sm font-medium text-[#d3bb73]">Kolor</label>
              <input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="h-10 w-full cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-[#13161f]"
              />
            </div>
          )}

          {meeting.events && (
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#13161f] p-4">
              <p className="text-sm text-[#d3bb73]">Powiązane wydarzenie:</p>
              <button
                onClick={() => router.push(`/crm/events/${meeting.event_id}`)}
                className="mt-1 text-[#e5e4e2] hover:underline"
              >
                {meeting.events.name}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
