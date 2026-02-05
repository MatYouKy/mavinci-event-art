'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { ArrowLeft, Save, Trash2, Calendar, MapPin, Users, FileText, Clock } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { utcToLocalDatetimeString, localDatetimeStringToUTC } from '@/lib/utils/dateTimeUtils';
import { useDialog } from '@/contexts/DialogContext';

const getAccessToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.access_token;
};

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
  });

  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);

  const [icalUrl, setIcalUrl] = useState<string>('');
  const [icalLoading, setIcalLoading] = useState(false);

  const fetchIcalUrl = async () => {
    try {
      setIcalLoading(true);

      const accessToken = await getAccessToken();
      if (!accessToken) {
        showSnackbar('Brak sesji użytkownika – zaloguj się ponownie', 'error');
        return;
      }

      const res = await fetch('/bridge/calendar/ical-token', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const json = await res.json();
      if (!res.ok) throw json;

      const token = json.token as string;
      const origin = window.location.origin;
      const url = `${origin}/bridge/calendar/ical/${token}`;

      setIcalUrl(url);
    } catch (e: any) {
      console.error('fetchIcalUrl error', e);
      showSnackbar('Nie udało się wygenerować linku iCal', 'error');
    } finally {
      setIcalLoading(false);
    }
  };

  const copyIcalUrl = async () => {
    if (!icalUrl) return;
    await navigator.clipboard.writeText(icalUrl);
    showSnackbar('Link iCal skopiowany', 'success');
  };

  useEffect(() => {
    fetchMeeting();
    // dodatkowo:
    fetchIcalUrl();
  }, [meetingId]);

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
        datetime_end: utcToLocalDatetimeString(data.datetime_end) || '',
        notes: data.notes || '',
        color: data.color,
        is_all_day: data.is_all_day,
      });

      if (data.participants) {
        const participantIds = data.participants
          .filter((p) => p.employee_id)
          .map((p) => p.employee_id as string);
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
    const {
      data: { session },
    } = await supabase.auth.getSession();
    try {
      setSaving(true);

      const { error: updateError } = await supabase
        .from('meetings')
        .update({
          created_by: session?.user?.id,
          title: formData.title,
          location_id: formData.location_id,
          location_text: formData.location_text || null,
          datetime_start: localDatetimeStringToUTC(formData.datetime_start),
          datetime_end: formData.datetime_end
            ? localDatetimeStringToUTC(formData.datetime_end)
            : null,
          notes: formData.notes || null,
          color: formData.color,
          is_all_day: formData.is_all_day,
          updated_at: new Date().toISOString(),
        })
        .eq('id', meetingId);

      if (updateError) throw updateError;

      const { error: deleteError } = await supabase
        .from('meeting_participants')
        .delete()
        .eq('meeting_id', meetingId);

      if (deleteError) throw deleteError;

      if (selectedParticipants.length > 0) {
        const participantsData = selectedParticipants.map((empId) => ({
          meeting_id: meetingId,
          employee_id: empId,
        }));

        const { error: insertError } = await supabase
          .from('meeting_participants')
          .insert(participantsData);

        if (insertError) throw insertError;
      }

      showSnackbar('Spotkanie zostało zaktualizowane', 'success');
      setIsEditing(false);
      fetchMeeting();
    } catch (error: any) {
      console.error('Error updating meeting:', error);
      showSnackbar('Błąd podczas zapisywania spotkania', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!(await showConfirm('Czy na pewno chcesz usunąć to spotkanie?'))) return;

    try {
      const { error } = await supabase.from('meetings').delete().eq('id', meetingId);
      if (error) throw error;
      await fetchMeeting();
      showSnackbar('Spotkanie zostało usunięte', 'success');
      router.push('/crm/calendar');
    } catch (error: any) {
      console.error('Error deleting meeting:', error);
      showSnackbar('Błąd podczas usuwania spotkania', 'error');
    }
  };

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
        <div className="mb-6 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-[#e5e4e2]">
                Subskrypcja kalendarza (iPhone / Google)
              </p>
              <p className="text-xs text-[#e5e4e2]/60">
                Skopiuj link i dodaj jako „Subskrybowany kalendarz” (iOS) lub „From URL” (Google).
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={fetchIcalUrl}
                disabled={icalLoading}
                className="rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 disabled:opacity-50"
              >
                {icalLoading ? 'Generuję...' : 'Wygeneruj link'}
              </button>

              <button
                onClick={copyIcalUrl}
                disabled={!icalUrl}
                className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-50"
              >
                Skopiuj
              </button>

              {icalUrl && (
                <a
                  href={icalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/10"
                >
                  Otwórz
                </a>
              )}
            </div>
          </div>

          {icalUrl && (
            <div className="mt-3 break-all rounded-lg bg-[#13161f] p-3 text-xs text-[#e5e4e2]/80">
              {icalUrl}
            </div>
          )}
        </div>

        <div className="space-y-6 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
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
              <div className="space-y-2">
                {selectedParticipants.map((empId) => (
                  <div
                    key={empId}
                    className="flex items-center justify-between rounded-lg border border-[#d3bb73]/20 bg-[#13161f] px-3 py-2"
                  >
                    <span className="text-sm text-[#e5e4e2]">{empId}</span>
                    <button
                      onClick={() =>
                        setSelectedParticipants(selectedParticipants.filter((id) => id !== empId))
                      }
                      className="text-red-400 hover:text-red-300"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {meeting.participants && meeting.participants.length > 0 ? (
                  meeting.participants.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-full bg-[#d3bb73]/10 px-3 py-1 text-sm text-[#e5e4e2]"
                    >
                      {p.employee
                        ? `${p.employee.name} ${p.employee.surname}`
                        : p.contact
                          ? `${p.contact.first_name} ${p.contact.last_name}`
                          : 'Nieznany'}
                    </div>
                  ))
                ) : (
                  <p className="text-[#e5e4e2]/60">Brak uczestników</p>
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
