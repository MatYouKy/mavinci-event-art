'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Bell,
  Building2,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  HelpCircle,
  Loader2,
  Lock,
  MapPin,
  Pencil,
  Plus,
  Repeat,
  Search,
  StickyNote,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { meetingRecurrenceLabel } from '@/lib/meetings/recurrence';
import { fetchPublicHolidays } from '@/lib/CRM/calendar/publicHolidays';
import {
  MEETING_RESPONSES,
  MEETING_STATUSES,
  isMeetingOrganizer,
  meetingKind,
  meetingKindLabel,
  meetingNeedsMyResponse,
  meetingResponseOption,
  meetingResponseSummaryText,
  meetingStatus,
  meetingStatusOption,
  myMeetingResponse,
  type MeetingKind,
  type MeetingResponse,
  type MeetingStatus,
} from '@/lib/CRM/meetings/meetingStatus';
import NewMeetingModal from '@/components/crm/NewMeetingModal';
import MeetingsTimeline, { isoDay, type TimelineMeeting } from '@/components/crm/meetings/MeetingsTimeline';

interface MeetingParticipant {
  id: string;
  employee_id: string | null;
  contact_id: string | null;
  response?: string | null;
  responded_at?: string | null;
  employee?: {
    id: string;
    name: string | null;
    surname: string | null;
    avatar_url: string | null;
    nickname: string | null;
  } | null;
  contact?: { id: string; first_name: string | null; last_name: string | null } | null;
}

interface Meeting {
  id: string;
  title: string;
  datetime_start: string;
  datetime_end: string | null;
  is_all_day: boolean | null;
  color: string | null;
  notes: string | null;
  series_id: string | null;
  recurrence_days: number;
  location_text: string | null;
  created_by: string | null;
  is_private: boolean | null;
  status: string | null;
  alert_1_minutes: number | null;
  alert_2_minutes: number | null;
  alert_critical_minutes: number | null;
  location?: { id: string; name: string | null } | null;
  creator?: { id: string; name: string | null; surname: string | null } | null;
  participants?: MeetingParticipant[];
}

type View = 'day' | 'workweek' | 'week' | 'list';
type ScopeFilter = 'mine' | 'all';
type KindFilter = 'all' | MeetingKind;

const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'day', label: 'Dzień' },
  { value: 'workweek', label: 'Tydzień roboczy' },
  { value: 'week', label: 'Tydzień' },
  { value: 'list', label: 'Lista' },
];

const PREFS_KEY = 'mavinci:meetings:view';

const dateTimeFormatter = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dateFormatter = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: 'long', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const shortDayFormatter = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' });
const monthFormatter = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' });

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const startOfWeek = (date: Date) => addDays(startOfDay(date), -((date.getDay() + 6) % 7));

function formatMeetingDate(meeting: Meeting): string {
  const start = new Date(meeting.datetime_start);
  if (meeting.is_all_day) return `${dateFormatter.format(start)} · Cały dzień`;
  return dateTimeFormatter.format(start);
}

function formatAlert(minutes: number | null): string | null {
  if (minutes == null) return null;
  if (minutes === 0) return 'W momencie rozpoczęcia';
  if (minutes < 60) return `${minutes} min przed`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} godz. przed`;
  const d = Math.round(minutes / 1440);
  return `${d} ${d === 1 ? 'dzień' : 'dni'} przed`;
}

function participantName(p: MeetingParticipant): string {
  if (p.employee) {
    const full = `${p.employee.name ?? ''} ${p.employee.surname ?? ''}`.trim();
    return p.employee.nickname || full || 'Pracownik';
  }
  if (p.contact) return `${p.contact.first_name ?? ''} ${p.contact.last_name ?? ''}`.trim() || 'Kontakt';
  return 'Kontakt';
}

function rangeLabel(view: View, days: Date[]): string {
  if (days.length === 0) return '';
  if (view === 'day') {
    return new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(days[0]);
  }
  const first = days[0];
  const last = days[days.length - 1];
  if (first.getMonth() === last.getMonth()) return `${first.getDate()}–${last.getDate()} ${monthFormatter.format(last)}`;
  return `${shortDayFormatter.format(first)} – ${shortDayFormatter.format(last)} ${last.getFullYear()}`;
}

function readPrefs(): { view?: View; scope?: ScopeFilter } {
  try {
    return JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}

function writePrefs(prefs: { view: View; scope: ScopeFilter }) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Pamięć przeglądarki niedostępna — widok wróci do domyślnego.
  }
}

function errorText(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message || fallback;
  }
  return fallback;
}

function MeetingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const meetingIdParam = searchParams.get('meetingId');

  const { employee, isAdmin, hasScope } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>('workweek');
  const [scope, setScope] = useState<ScopeFilter>('mine');
  const [kind, setKind] = useState<KindFilter>('all');
  const [statuses, setStatuses] = useState<Set<MeetingStatus>>(() => new Set(['confirmed', 'tentative', 'cancelled']));
  const [showDeclined, setShowDeclined] = useState(false);
  const [onlyPending, setOnlyPending] = useState(false);
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [prefsReady, setPrefsReady] = useState(false);
  const [holidays, setHolidays] = useState<Map<string, string>>(() => new Map());
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const [newMeeting, setNewMeeting] = useState<{ start?: Date; end?: Date } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const prefs = readPrefs();
    if (prefs.view && VIEWS.some((item) => item.value === prefs.view)) setView(prefs.view);
    else if (window.innerWidth < 768) setView('day');
    if (prefs.scope === 'all' || prefs.scope === 'mine') setScope(prefs.scope);
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (prefsReady) writePrefs({ view, scope });
  }, [prefsReady, view, scope]);

  const fetchMeetings = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const { data, error } = await supabase
      .from('meetings')
      .select(
        `
        id, title, datetime_start, datetime_end, is_all_day, color, notes, series_id, recurrence_days,
        location_text, created_by, is_private, status, alert_1_minutes, alert_2_minutes, alert_critical_minutes,
        location:locations(id, name),
        creator:employees!meetings_created_by_fkey(id, name, surname),
        participants:meeting_participants(
          id, employee_id, contact_id, response, responded_at,
          employee:employees(id, name, surname, avatar_url, nickname),
          contact:contacts(id, first_name, last_name)
        )
      `,
      )
      .is('deleted_at', null)
      .order('datetime_start', { ascending: true });

    if (error) {
      console.error('Error fetching meetings:', error);
      if (!quiet) showSnackbar('Nie udało się wczytać spotkań', 'error');
    } else {
      setMeetings((data as unknown as Meeting[]) ?? []);
    }
    if (!quiet) setLoading(false);
  }, [showSnackbar]);

  useEffect(() => {
    void fetchMeetings();
  }, [fetchMeetings]);

  // Zmiany z innych urządzeń: odśwież po powrocie do karty i co minutę.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void fetchMeetings(true);
    };
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(timer);
    };
  }, [fetchMeetings]);

  const days = useMemo(() => {
    if (view === 'day' || view === 'list') return [anchor];
    const monday = startOfWeek(anchor);
    return Array.from({ length: view === 'workweek' ? 5 : 7 }, (_, index) => addDays(monday, index));
  }, [anchor, view]);

  useEffect(() => {
    if (view === 'list' || days.length === 0) return;
    let cancelled = false;
    fetchPublicHolidays(supabase, isoDay(days[0]), isoDay(days[days.length - 1]))
      .then((list) => {
        if (!cancelled) setHolidays(new Map(list.map((holiday) => [holiday.date.slice(0, 10), holiday.name])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [days, view]);

  const selectedMeeting = useMemo(
    () => meetings.find((m) => m.id === meetingIdParam) ?? null,
    [meetings, meetingIdParam],
  );

  const openMeeting = useCallback((id: string) => router.push(`/crm/meetings?meetingId=${id}`), [router]);
  const closeMeeting = useCallback(() => router.push('/crm/meetings'), [router]);

  const isMine = useCallback(
    (m: Meeting): boolean => {
      if (!employee) return false;
      return m.created_by === employee.id || (m.participants?.some((p) => p.employee_id === employee.id) ?? false);
    },
    [employee],
  );

  const canManageCalendar = isAdmin || hasScope('calendar_manage') || hasScope('admin');
  const canEdit = useCallback(
    (m: { id: string; created_by?: string | null; participants?: Array<{ employee_id?: string | null }> | null }) => {
      if (!employee) return false;
      const participant = m.created_by === employee.id || (m.participants ?? []).some((p) => p.employee_id === employee.id);
      return participant && (m.created_by === employee.id || canManageCalendar);
    },
    [employee, canManageCalendar],
  );

  const pendingCount = useMemo(
    () =>
      meetings.filter(
        (m) => meetingNeedsMyResponse(m, employee?.id) && new Date(m.datetime_end ?? m.datetime_start).getTime() >= Date.now(),
      ).length,
    [meetings, employee?.id],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return meetings.filter((m) => {
      if (scope === 'mine' && !isMine(m)) return false;
      if (kind !== 'all' && meetingKind(m) !== kind) return false;
      if (!statuses.has(meetingStatus(m.status))) return false;
      const mine = myMeetingResponse(m, employee?.id);
      if (!showDeclined && mine === 'declined') return false;
      if (onlyPending && !meetingNeedsMyResponse(m, employee?.id)) return false;
      if (!q) return true;
      return [m.title, m.location?.name ?? '', m.location_text ?? '', m.notes ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [meetings, search, scope, kind, statuses, showDeclined, onlyPending, isMine, employee?.id]);

  const timelineMeetings = useMemo<TimelineMeeting[]>(
    () =>
      filtered.map((m) => ({
        id: m.id,
        title: m.title,
        datetime_start: m.datetime_start,
        datetime_end: m.datetime_end,
        is_all_day: m.is_all_day,
        color: m.color,
        is_private: m.is_private,
        status: m.status,
        series_id: m.series_id,
        created_by: m.created_by,
        location_label: m.location?.name || m.location_text,
        participants: m.participants,
      })),
    [filtered],
  );

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

  const step = (direction: -1 | 1) => {
    setAnchor((current) => addDays(current, direction * (view === 'day' ? 1 : 7)));
  };

  // Skróty jak w kalendarzu: ← → zmienia zakres, T wraca do dziś.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || selectedMeeting || newMeeting) return;
      if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight') step(1);
      else if (event.key === 't' || event.key === 'T') setAnchor(startOfDay(new Date()));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const setSaving = (id: string, saving: boolean) =>
    setSavingIds((current) => {
      const next = new Set(current);
      if (saving) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Zmiana jednego terminu przez save_meeting (z pełną listą uczestników, żeby nikogo nie usunąć). */
  const saveMeetingPatch = async (meeting: Meeting, patch: Record<string, unknown>) => {
    const { error } = await supabase.rpc('save_meeting', {
      p_id: meeting.id,
      p_data: patch,
      p_participants: (meeting.participants ?? []).map((p) =>
        p.employee_id ? { employee_id: p.employee_id } : { contact_id: p.contact_id },
      ),
      p_recurrence_days: meeting.series_id ? meeting.recurrence_days ?? 0 : 0,
      p_scope: 'single',
    });
    if (error) throw error;
  };

  const moveMeeting = async (item: TimelineMeeting, start: Date, end: Date) => {
    const meeting = meetings.find((m) => m.id === item.id);
    if (!meeting) return;
    const before = { datetime_start: meeting.datetime_start, datetime_end: meeting.datetime_end };
    const others = (meeting.participants ?? []).some((p) => p.employee_id && p.employee_id !== meeting.created_by);
    setMeetings((current) =>
      current.map((m) =>
        m.id === meeting.id ? { ...m, datetime_start: start.toISOString(), datetime_end: end.toISOString() } : m,
      ),
    );
    setSaving(meeting.id, true);
    try {
      await saveMeetingPatch(meeting, { datetime_start: start.toISOString(), datetime_end: end.toISOString() });
      showSnackbar(
        `Nowy termin: ${shortDayFormatter.format(start)}, ${timeFormatter.format(start)}–${timeFormatter.format(end)}` +
          (meeting.series_id ? ' (tylko ten termin cyklu)' : '') +
          (others ? '. Uczestnicy potwierdzą go ponownie.' : ''),
        'success',
      );
      void fetchMeetings(true);
    } catch (error) {
      setMeetings((current) => current.map((m) => (m.id === meeting.id ? { ...m, ...before } : m)));
      showSnackbar(errorText(error, 'Nie udało się zmienić terminu spotkania'), 'error');
    } finally {
      setSaving(meeting.id, false);
    }
  };

  const respond = async (meeting: Meeting, response: MeetingResponse) => {
    if (!employee) return;
    setBusy(`respond:${response}`);
    try {
      const { error } = await supabase.rpc('respond_to_meeting', { p_meeting_id: meeting.id, p_response: response });
      if (error) throw error;
      setMeetings((current) =>
        current.map((m) =>
          m.id === meeting.id
            ? {
                ...m,
                participants: (m.participants ?? []).map((p) =>
                  p.employee_id === employee.id ? { ...p, response, responded_at: new Date().toISOString() } : p,
                ),
              }
            : m,
        ),
      );
      showSnackbar(`Twoja odpowiedź: ${meetingResponseOption(response).action}`, 'success');
    } catch (error) {
      showSnackbar(errorText(error, 'Nie udało się zapisać odpowiedzi'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const changeStatus = async (meeting: Meeting, status: MeetingStatus) => {
    if (status === 'cancelled') {
      const confirmed = await showConfirm({
        title: 'Odwołaj spotkanie',
        message: `Spotkanie „${meeting.title}” zostanie oznaczone jako odwołane${meeting.series_id ? ' (tylko ten termin)' : ''}. Uczestnicy nie dostaną już przypomnień.`,
        confirmText: 'Odwołaj',
        cancelText: 'Anuluj',
      });
      if (!confirmed) return;
    }
    setBusy(`status:${status}`);
    setSaving(meeting.id, true);
    try {
      await saveMeetingPatch(meeting, { status });
      setMeetings((current) => current.map((m) => (m.id === meeting.id ? { ...m, status } : m)));
      showSnackbar(`Status spotkania: ${meetingStatusOption(status).label}`, 'success');
    } catch (error) {
      showSnackbar(errorText(error, 'Nie udało się zmienić statusu'), 'error');
    } finally {
      setBusy(null);
      setSaving(meeting.id, false);
    }
  };

  const handleDelete = async (meeting: Meeting) => {
    const confirmed = await showConfirm({
      title: 'Usuń spotkanie',
      message: `Czy na pewno chcesz usunąć ${meeting.series_id ? 'tylko ten termin spotkania' : 'spotkanie'} "${meeting.title}"?`,
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    });
    if (!confirmed) return;

    setDeleting(true);
    const { error } = await supabase.rpc('delete_meeting_occurrences', { p_id: meeting.id, p_scope: 'single' });
    setDeleting(false);

    if (error) {
      console.error('Error deleting meeting:', error);
      showSnackbar(errorText(error, 'Nie udało się usunąć spotkania'), 'error');
      return;
    }
    showSnackbar('Spotkanie zostało usunięte', 'success');
    closeMeeting();
    void fetchMeetings(true);
  };

  const toggleStatus = (status: MeetingStatus) =>
    setStatuses((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next.size === 0 ? new Set([status]) : next;
    });

  const renderCard = (m: Meeting) => {
    const now = Date.now();
    const start = new Date(m.datetime_start).getTime();
    const end = new Date(m.datetime_end ?? m.datetime_start).getTime();
    const status = meetingStatusOption(m.status);
    let timeLabel = 'Nadchodzące';
    let timeColor = '#d3bb73';
    if (now >= start && now <= end) {
      timeLabel = 'W trakcie';
      timeColor = '#4ade80';
    } else if (now > end) {
      timeLabel = 'Zakończone';
      timeColor = '#8a8f9c';
    }
    const location = m.location?.name || m.location_text;
    const participantsCount = m.participants?.length ?? 0;
    const mine = myMeetingResponse(m, employee?.id);
    const cancelled = status.value === 'cancelled';

    return (
      <button
        key={m.id}
        onClick={() => openMeeting(m.id)}
        className={`group flex w-full flex-col gap-3 rounded-xl bg-[#1c1f33] p-4 text-left transition-colors hover:bg-[#22263d] ${
          cancelled || mine === 'declined' ? 'opacity-60' : ''
        }`}
        style={{ boxShadow: `inset 3px 0 0 ${m.color || '#d3bb73'}` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {m.is_private && <Lock className="h-4 w-4 shrink-0 text-[#a8adba]" />}
            <h3 className={`truncate text-base font-semibold text-[#e5e4e2] ${cancelled ? 'line-through' : ''}`}>{m.title}</h3>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {meetingNeedsMyResponse(m, employee?.id) && (
              <span className="rounded-full bg-[#d3bb73]/15 px-2.5 py-1 text-xs font-medium text-[#d3bb73]">Odpowiedz</span>
            )}
            {status.value !== 'confirmed' && (
              <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ backgroundColor: `${status.color}1a`, color: status.color }}>
                {status.label}
              </span>
            )}
            <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ backgroundColor: `${timeColor}1a`, color: timeColor }}>
              {timeLabel}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#a8adba]">
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-[#d3bb73]" />
            {formatMeetingDate(m)}
            {m.series_id && <span className="text-xs text-[#d3bb73]">{meetingRecurrenceLabel(m.recurrence_days)}</span>}
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
              {participantsCount} {participantsCount === 1 ? 'uczestnik' : 'uczestników'}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-xs">
            {m.is_private ? <Lock className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
            {meetingKindLabel(m)}
          </span>
        </div>
      </button>
    );
  };

  const chip = (active: boolean) =>
    `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
      active ? 'bg-[#d3bb73]/15 text-[#e5e4e2]' : 'bg-[#1c1f33] text-[#8a8f9c] hover:text-[#e5e4e2]'
    }`;

  return (
    <div className="flex w-full flex-col px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#d3bb73]/10">
            <CalendarCheck className="h-6 w-6 text-[#d3bb73]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#e5e4e2]">Spotkania</h1>
            <p className="text-sm text-[#8a8f9c]">
              Plan spotkań — przeciągnij, aby zmienić termin; zaznacz wolny czas, aby dodać spotkanie
            </p>
          </div>
        </div>
        <button
          onClick={() => setNewMeeting({})}
          className="flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 font-medium text-[#13161f] transition-colors hover:bg-[#c4ac63]"
        >
          <Plus className="h-5 w-5" />
          Nowe spotkanie
        </button>
      </div>

      {/* Nawigacja i widok */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {view !== 'list' && (
          <>
            <button
              onClick={() => setAnchor(startOfDay(new Date()))}
              className="rounded-lg bg-[#1c1f33] px-3 py-2 text-sm font-medium text-[#e5e4e2] hover:bg-[#22263d]"
              title="Dziś (T)"
            >
              Dziś
            </button>
            <div className="flex rounded-lg bg-[#1c1f33]">
              <button onClick={() => step(-1)} className="rounded-l-lg px-2 py-2 text-[#a8adba] hover:bg-[#22263d] hover:text-[#e5e4e2]" aria-label="Wcześniej">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button onClick={() => step(1)} className="rounded-r-lg px-2 py-2 text-[#a8adba] hover:bg-[#22263d] hover:text-[#e5e4e2]" aria-label="Później">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <input
              type="date"
              value={isoDay(anchor)}
              onChange={(event) => {
                const [y, mo, d] = event.target.value.split('-').map(Number);
                if (y && mo && d) setAnchor(new Date(y, mo - 1, d));
              }}
              className="rounded-lg bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] outline-none [color-scheme:dark]"
              aria-label="Przejdź do dnia"
            />
            <h2 className="mx-1 text-base font-semibold capitalize text-[#e5e4e2]">{rangeLabel(view, days)}</h2>
          </>
        )}
        <div className="ml-auto flex rounded-lg bg-[#1c1f33] p-1">
          {VIEWS.map((item) => (
            <button
              key={item.value}
              onClick={() => setView(item.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                view === item.value ? 'bg-[#d3bb73] text-[#13161f]' : 'text-[#a8adba] hover:text-[#e5e4e2]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtry */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a8f9c]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj spotkań…"
            className="w-full rounded-lg bg-[#1c1f33] py-2 pl-10 pr-4 text-sm text-[#e5e4e2] placeholder-[#8a8f9c] outline-none focus:bg-[#22263d]"
          />
        </div>
        <div className="flex rounded-lg bg-[#1c1f33] p-1">
          {(['mine', 'all'] as ScopeFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                scope === s ? 'bg-[#d3bb73] text-[#13161f]' : 'text-[#a8adba] hover:text-[#e5e4e2]'
              }`}
            >
              {s === 'mine' ? 'Moje' : 'Wszystkie'}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg bg-[#1c1f33] p-1">
          {([
            { value: 'all', label: 'Firmowe i prywatne' },
            { value: 'company', label: 'Firmowe' },
            { value: 'private', label: 'Prywatne' },
          ] as Array<{ value: KindFilter; label: string }>).map((option) => (
            <button
              key={option.value}
              onClick={() => setKind(option.value)}
              className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                kind === option.value ? 'bg-[#d3bb73] text-[#13161f]' : 'text-[#a8adba] hover:text-[#e5e4e2]'
              }`}
            >
              {option.value === 'private' && <Lock className="h-3 w-3" />}
              {option.label}
            </button>
          ))}
        </div>
        {MEETING_STATUSES.map((option) => (
          <button key={option.value} onClick={() => toggleStatus(option.value)} className={chip(statuses.has(option.value))}>
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: statuses.has(option.value) ? option.color : 'rgba(138,143,156,0.5)' }}
            />
            {option.label}
          </button>
        ))}
        <button onClick={() => setShowDeclined((value) => !value)} className={chip(showDeclined)}>
          Odrzucone przeze mnie
        </button>
        <button onClick={() => setOnlyPending((value) => !value)} className={chip(onlyPending)}>
          <HelpCircle className="h-3.5 w-3.5 text-[#d3bb73]" />
          Czeka na moją odpowiedź{pendingCount > 0 ? ` (${pendingCount})` : ''}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" />
        </div>
      ) : view !== 'list' ? (
        <div className="h-[calc(100dvh-17rem)] min-h-[480px]">
          <MeetingsTimeline
            days={days}
            meetings={timelineMeetings}
            employeeId={employee?.id ?? null}
            savingIds={savingIds}
            holidays={holidays}
            canEdit={canEdit}
            onOpen={(meeting) => openMeeting(meeting.id)}
            onCreate={(start, end) => setNewMeeting({ start, end })}
            onMove={(meeting, start, end) => {
              void moveMeeting(meeting, start, end);
            }}
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-[#1c1f33]/60 py-16 text-center">
          <CalendarCheck className="mb-3 h-10 w-10 text-[#3a3f52]" />
          <p className="text-[#a8adba]">Brak spotkań do wyświetlenia</p>
          <button
            onClick={() => setNewMeeting({})}
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
          employeeId={employee?.id ?? null}
          canEdit={canEdit(selectedMeeting)}
          deleting={deleting}
          busy={busy}
          onClose={closeMeeting}
          onEdit={() => router.push(`/crm/calendar/meeting/${selectedMeeting.id}?from=meetings`)}
          onDelete={() => handleDelete(selectedMeeting)}
          onRespond={(response) => respond(selectedMeeting, response)}
          onStatus={(status) => changeStatus(selectedMeeting, status)}
        />
      )}

      <NewMeetingModal
        isOpen={!!newMeeting}
        initialDate={newMeeting?.start}
        initialEndDate={newMeeting?.end}
        onClose={() => setNewMeeting(null)}
        onSuccess={() => {
          setNewMeeting(null);
          void fetchMeetings(true);
        }}
      />
    </div>
  );
}

function MeetingDetailModal({
  meeting,
  employeeId,
  canEdit,
  deleting,
  busy,
  onClose,
  onEdit,
  onDelete,
  onRespond,
  onStatus,
}: {
  meeting: Meeting;
  employeeId: string | null;
  canEdit: boolean;
  deleting: boolean;
  busy: string | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRespond: (response: MeetingResponse) => void;
  onStatus: (status: MeetingStatus) => void;
}) {
  const location = meeting.location?.name || meeting.location_text;
  const alerts = [meeting.alert_1_minutes, meeting.alert_2_minutes, meeting.alert_critical_minutes]
    .map(formatAlert)
    .filter((a): a is string => a !== null);
  const participants = [...(meeting.participants ?? [])].sort((a, b) => {
    if (a.employee_id === meeting.created_by) return -1;
    if (b.employee_id === meeting.created_by) return 1;
    return participantName(a).localeCompare(participantName(b), 'pl');
  });
  const status = meetingStatusOption(meeting.status);
  const mine = myMeetingResponse(meeting, employeeId);
  const organizer = isMeetingOrganizer(meeting, employeeId);
  const summary = meetingResponseSummaryText(meeting);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-[#1c1f33] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5" style={{ boxShadow: `inset 0 3px 0 ${meeting.color || '#d3bb73'}` }}>
          <div className="min-w-0">
            <h2 className={`text-lg font-bold text-[#e5e4e2] ${status.value === 'cancelled' ? 'line-through' : ''}`}>{meeting.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                style={{ backgroundColor: `${status.color}1f`, color: status.color }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
                {status.label}
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-[#e5e4e2]/80">
                {meeting.is_private ? <Lock className="h-3 w-3" /> : <Building2 className="h-3 w-3" />}
                {meetingKindLabel(meeting)}
              </span>
              {meeting.series_id && (
                <span className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-[#e5e4e2]/80">
                  <Repeat className="h-3 w-3" />
                  {meetingRecurrenceLabel(meeting.recurrence_days)}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[#8a8f9c] transition-colors hover:bg-white/5 hover:text-[#e5e4e2]"
            aria-label="Zamknij"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {mine && !organizer && status.value !== 'cancelled' && (
          <div className="mx-5 mb-2 rounded-xl bg-[#d3bb73]/[0.07] p-3">
            <p className="mb-2 text-sm text-[#e5e4e2]/80">
              {mine === 'pending' ? 'Czy będziesz na spotkaniu?' : `Twoja odpowiedź: ${meetingResponseOption(mine).label}`}
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {MEETING_RESPONSES.filter((option) => option.value !== 'pending').map((option) => (
                <button
                  key={option.value}
                  disabled={busy !== null}
                  onClick={() => onRespond(option.value)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
                    mine === option.value ? 'font-semibold text-[#13161f]' : 'bg-white/[0.06] text-[#e5e4e2] hover:bg-white/10'
                  }`}
                  style={mine === option.value ? { backgroundColor: option.color } : undefined}
                >
                  {busy === `respond:${option.value}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {option.action}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4 p-5">
          <DetailRow icon={<Clock className="h-4 w-4" />} label="Termin">
            {formatMeetingDate(meeting)}
            {meeting.datetime_end && !meeting.is_all_day && <> – {timeFormatter.format(new Date(meeting.datetime_end))}</>}
          </DetailRow>

          {location && (
            <DetailRow icon={<MapPin className="h-4 w-4" />} label="Lokalizacja">
              {location}
            </DetailRow>
          )}

          {participants.length > 0 && (
            <DetailRow icon={<Users className="h-4 w-4" />} label={summary ? `Uczestnicy · ${summary}` : 'Uczestnicy'}>
              <div className="mt-1 space-y-1">
                {participants.map((p) => {
                  const isOrganizer = p.employee_id && p.employee_id === meeting.created_by;
                  const response = meetingResponseOption(isOrganizer ? 'accepted' : p.response);
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-1.5">
                      <span className="flex min-w-0 items-center gap-2 truncate">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: p.employee_id ? response.color : 'rgba(138,143,156,0.5)' }}
                        />
                        <span className="truncate">{participantName(p)}</span>
                      </span>
                      <span className={`shrink-0 text-xs ${isOrganizer ? 'text-[#d3bb73]' : 'text-[#8a8f9c]'}`}>
                        {isOrganizer ? 'Organizator' : p.employee_id ? response.label : 'Kontakt'}
                      </span>
                    </div>
                  );
                })}
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

          {canEdit && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[#8a8f9c]">Status spotkania</p>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#13161f] p-1">
                {MEETING_STATUSES.map((option) => (
                  <button
                    key={option.value}
                    disabled={busy !== null || option.value === status.value}
                    onClick={() => onStatus(option.value)}
                    className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
                      option.value === status.value
                        ? 'bg-[#d3bb73] font-semibold text-[#13161f]'
                        : 'text-[#e5e4e2]/75 hover:bg-white/5 disabled:opacity-50'
                    }`}
                  >
                    {busy === `status:${option.value}` ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: option.color }} />
                    )}
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {canEdit && (
          <div className="flex items-center justify-end gap-3 p-5 pt-0">
            <button
              onClick={onDelete}
              disabled={deleting}
              className="flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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
        )}
      </div>
    </div>
  );
}

function DetailRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#d3bb73]/10 text-[#d3bb73]">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-[#8a8f9c]">{label}</p>
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
