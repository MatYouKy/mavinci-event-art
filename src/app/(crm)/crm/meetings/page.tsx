'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Plus,
  Search,
  CalendarCheck,
  MapPin,
  Users,
  Clock,
  Bell,
  StickyNote,
  Pencil,
  Trash2,
  X,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import NewMeetingModal from '@/components/crm/NewMeetingModal';

interface MeetingParticipant {
  id: string;
  employee_id: string | null;
  contact_id: string | null;
  employee?: {
    id: string;
    name: string | null;
    surname: string | null;
    avatar_url: string | null;
    nickname: string | null;
  } | null;
}

interface Meeting {
  id: string;
  title: string;
  datetime_start: string;
  datetime_end: string | null;
  is_all_day: boolean | null;
  color: string | null;
  notes: string | null;
  location_text: string | null;
  created_by: string | null;
  alert_1_minutes: number | null;
  alert_2_minutes: number | null;
  alert_critical_minutes: number | null;
  location?: { id: string; name: string | null } | null;
  creator?: { id: string; name: string | null; surname: string | null } | null;
  participants?: MeetingParticipant[];
}

type ScopeFilter = 'mine' | 'all';

const dateTimeFormatter = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

function formatMeetingDate(meeting: Meeting): string {
  const start = new Date(meeting.datetime_start);
  if (meeting.is_all_day) {
    return `${dateFormatter.format(start)} · Cały dzień`;
  }
  return dateTimeFormatter.format(start);
}

function formatAlert(minutes: number | null): string | null {
  if (minutes == null) return null;
  if (minutes === 0) return 'W momencie rozpoczęcia';
  if (minutes < 60) return `${minutes} min przed`;
  if (minutes < 1440) {
    const h = Math.round(minutes / 60);
    return `${h} godz. przed`;
  }
  const d = Math.round(minutes / 1440);
  return `${d} ${d === 1 ? 'dzień' : 'dni'} przed`;
}

function participantName(p: MeetingParticipant): string {
  if (p.employee) {
    const full = `${p.employee.name ?? ''} ${p.employee.surname ?? ''}`.trim();
    return p.employee.nickname || full || 'Pracownik';
  }
  return 'Kontakt';
}

function MeetingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const meetingIdParam = searchParams.get('meetingId');

  const { employee } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<ScopeFilter>('mine');
  const [showNewModal, setShowNewModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('meetings')
      .select(
        `
        id, title, datetime_start, datetime_end, is_all_day, color, notes,
        location_text, created_by, alert_1_minutes, alert_2_minutes, alert_critical_minutes,
        location:locations(id, name),
        creator:employees!meetings_created_by_fkey(id, name, surname),
        participants:meeting_participants(
          id, employee_id, contact_id,
          employee:employees(id, name, surname, avatar_url, nickname)
        )
      `,
      )
      .is('deleted_at', null)
      .order('datetime_start', { ascending: true });

    if (error) {
      console.error('Error fetching meetings:', error);
      showSnackbar('Nie udało się wczytać spotkań', 'error');
      setMeetings([]);
    } else {
      setMeetings((data as unknown as Meeting[]) ?? []);
    }
    setLoading(false);
  }, [showSnackbar]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  const selectedMeeting = useMemo(
    () => meetings.find((m) => m.id === meetingIdParam) ?? null,
    [meetings, meetingIdParam],
  );

  const openMeeting = (id: string) => {
    router.push(`/crm/meetings?meetingId=${id}`);
  };

  const closeMeeting = () => {
    router.push('/crm/meetings');
  };

  const isMine = useCallback(
    (m: Meeting): boolean => {
      if (!employee) return false;
      if (m.created_by === employee.id) return true;
      return (
        m.participants?.some((p) => p.employee_id === employee.id) ?? false
      );
    },
    [employee],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return meetings.filter((m) => {
      if (scope === 'mine' && !isMine(m)) return false;
      if (!q) return true;
      const haystack = [
        m.title,
        m.location?.name ?? '',
        m.location_text ?? '',
        m.notes ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [meetings, search, scope, isMine]);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const up: Meeting[] = [];
    const pa: Meeting[] = [];
    filtered.forEach((m) => {
      const end = new Date(m.datetime_end ?? m.datetime_start).getTime();
      if (end >= now) up.push(m);
      else pa.push(m);
    });
    pa.reverse();
    return { upcoming: up, past: pa };
  }, [filtered]);

  const handleDelete = async (meeting: Meeting) => {
    const confirmed = await showConfirm({
      title: 'Usuń spotkanie',
      message: `Czy na pewno chcesz usunąć spotkanie "${meeting.title}"?`,
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    });
    if (!confirmed) return;

    setDeleting(true);
    const { error } = await supabase
      .from('meetings')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', meeting.id);
    setDeleting(false);

    if (error) {
      console.error('Error deleting meeting:', error);
      showSnackbar('Nie udało się usunąć spotkania', 'error');
      return;
    }
    showSnackbar('Spotkanie zostało usunięte', 'success');
    closeMeeting();
    fetchMeetings();
  };

  const renderCard = (m: Meeting) => {
    const now = Date.now();
    const start = new Date(m.datetime_start).getTime();
    const end = new Date(m.datetime_end ?? m.datetime_start).getTime();
    let statusLabel = 'Nadchodzące';
    let statusColor = '#d3bb73';
    if (now >= start && now <= end) {
      statusLabel = 'W trakcie';
      statusColor = '#4ade80';
    } else if (now > end) {
      statusLabel = 'Zakończone';
      statusColor = '#8a8f9c';
    }
    const location = m.location?.name || m.location_text;
    const participantsCount = m.participants?.length ?? 0;

    return (
      <button
        key={m.id}
        onClick={() => openMeeting(m.id)}
        className="group flex w-full flex-col gap-3 rounded-xl border border-[#2a2e42] bg-[#1c1f33] p-4 text-left transition-all hover:border-[#d3bb73]/60 hover:bg-[#20233a]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span
              className="mt-1 h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: m.color || '#d3bb73' }}
            />
            <h3 className="text-base font-semibold text-[#e5e4e2]">
              {m.title}
            </h3>
          </div>
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ backgroundColor: `${statusColor}1a`, color: statusColor }}
          >
            {statusLabel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#a8adba]">
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-[#d3bb73]" />
            {formatMeetingDate(m)}
          </span>
          {location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-[#d3bb73]" />
              {location}
            </span>
          )}
          {participantsCount > 0 && (
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-[#d3bb73]" />
              {participantsCount}{' '}
              {participantsCount === 1 ? 'uczestnik' : 'uczestników'}
            </span>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#d3bb73]/10">
            <CalendarCheck className="h-6 w-6 text-[#d3bb73]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#e5e4e2]">Spotkania</h1>
            <p className="text-sm text-[#8a8f9c]">
              Lista spotkań i szybkie dodawanie
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 font-medium text-[#13161f] transition-colors hover:bg-[#c4ac63]"
        >
          <Plus className="h-5 w-5" />
          Nowe spotkanie
        </button>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a8f9c]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj po tytule, lokalizacji, notatkach…"
            className="w-full rounded-lg border border-[#2a2e42] bg-[#1c1f33] py-2.5 pl-10 pr-4 text-sm text-[#e5e4e2] placeholder-[#8a8f9c] outline-none focus:border-[#d3bb73]"
          />
        </div>
        <div className="flex rounded-lg border border-[#2a2e42] bg-[#1c1f33] p-1">
          {(['mine', 'all'] as ScopeFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                scope === s
                  ? 'bg-[#d3bb73] text-[#13161f]'
                  : 'text-[#a8adba] hover:text-[#e5e4e2]'
              }`}
            >
              {s === 'mine' ? 'Moje' : 'Wszystkie'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#2a2e42] py-16 text-center">
          <CalendarCheck className="mb-3 h-10 w-10 text-[#3a3f52]" />
          <p className="text-[#a8adba]">Brak spotkań do wyświetlenia</p>
          <button
            onClick={() => setShowNewModal(true)}
            className="mt-4 flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#13161f] transition-colors hover:bg-[#c4ac63]"
          >
            <Plus className="h-4 w-4" />
            Dodaj spotkanie
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#8a8f9c]">
                Nadchodzące ({upcoming.length})
              </h2>
              <div className="space-y-3">{upcoming.map(renderCard)}</div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#8a8f9c]">
                Zakończone ({past.length})
              </h2>
              <div className="space-y-3">{past.map(renderCard)}</div>
            </section>
          )}
        </div>
      )}

      {selectedMeeting && (
        <MeetingDetailModal
          meeting={selectedMeeting}
          deleting={deleting}
          onClose={closeMeeting}
          onEdit={() =>
            router.push(`/crm/calendar/meeting/${selectedMeeting.id}`)
          }
          onDelete={() => handleDelete(selectedMeeting)}
        />
      )}

      <NewMeetingModal
        isOpen={showNewModal}
        onClose={() => setShowNewModal(false)}
        onSuccess={() => {
          setShowNewModal(false);
          fetchMeetings();
        }}
      />
    </div>
  );
}

function MeetingDetailModal({
  meeting,
  deleting,
  onClose,
  onEdit,
  onDelete,
}: {
  meeting: Meeting;
  deleting: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const location = meeting.location?.name || meeting.location_text;
  const alerts = [
    meeting.alert_1_minutes,
    meeting.alert_2_minutes,
    meeting.alert_critical_minutes,
  ]
    .map(formatAlert)
    .filter((a): a is string => a !== null);
  const participants = meeting.participants ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#2a2e42] bg-[#1c1f33] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#2a2e42] p-5">
          <div className="flex items-start gap-3">
            <span
              className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: meeting.color || '#d3bb73' }}
            />
            <h2 className="text-lg font-bold text-[#e5e4e2]">
              {meeting.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[#8a8f9c] transition-colors hover:bg-[#2a2e42] hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <DetailRow icon={<Clock className="h-4 w-4" />} label="Termin">
            {formatMeetingDate(meeting)}
            {meeting.datetime_end && !meeting.is_all_day && (
              <>
                {' – '}
                {new Intl.DateTimeFormat('pl-PL', {
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(meeting.datetime_end))}
              </>
            )}
          </DetailRow>

          {location && (
            <DetailRow icon={<MapPin className="h-4 w-4" />} label="Lokalizacja">
              {location}
            </DetailRow>
          )}

          {participants.length > 0 && (
            <DetailRow icon={<Users className="h-4 w-4" />} label="Uczestnicy">
              <div className="flex flex-wrap gap-1.5">
                {participants.map((p) => (
                  <span
                    key={p.id}
                    className="rounded-full bg-[#2a2e42] px-2.5 py-1 text-xs text-[#e5e4e2]"
                  >
                    {participantName(p)}
                  </span>
                ))}
              </div>
            </DetailRow>
          )}

          {alerts.length > 0 && (
            <DetailRow icon={<Bell className="h-4 w-4" />} label="Przypomnienia">
              <div className="flex flex-col gap-0.5">
                {alerts.map((a, i) => (
                  <span key={i}>{a}</span>
                ))}
              </div>
            </DetailRow>
          )}

          {meeting.notes && (
            <DetailRow icon={<StickyNote className="h-4 w-4" />} label="Notatki">
              <p className="whitespace-pre-wrap">{meeting.notes}</p>
            </DetailRow>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#2a2e42] p-5">
          <button
            onClick={onDelete}
            disabled={deleting}
            className="flex items-center gap-2 rounded-lg border border-red-500/40 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Usuń
          </button>
          <button
            onClick={onEdit}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#13161f] transition-colors hover:bg-[#c4ac63]"
          >
            <Pencil className="h-4 w-4" />
            Edytuj
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#d3bb73]/10 text-[#d3bb73]">
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-[#8a8f9c]">
          {label}
        </p>
        <div className="mt-0.5 text-sm text-[#e5e4e2]">{children}</div>
      </div>
    </div>
  );
}

export default function MeetingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" />
        </div>
      }
    >
      <MeetingsContent />
    </Suspense>
  );
}
