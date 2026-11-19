'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarDays, ChevronLeft, ChevronRight, Images, ListChecks, MessagesSquare, Plus, RefreshCw, Settings2, Sparkles,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { supabase } from '@/lib/supabase/browser';
import { SOCIAL_CHANNEL_LABELS, socialPostEditable, type SocialPostStatus } from '@/lib/social/socialShared';
import { socialGet, socialPost, type SocialHome, type SocialPostDetail, type SocialPostItem } from './socialApi';
import { PostStatusBadge, cardClass, dayKey, errorMessage, primaryButton, secondaryButton, timeLabel } from './socialUi';
import SocialLibrary from './SocialLibrary';
import SocialPostEditor from './SocialPostEditor';
import SocialSettingsModal from './SocialSettingsModal';
import SocialComments from './SocialComments';
import { MetaStatusBanner } from './SocialMetaPanel';

/*
 * Marketing → „Social media” w CRM (pełna szerokość): kalendarz publikacji z przeciąganiem terminu, lista postów
 * do akceptacji i z błędem publikacji, biblioteka zdjęć, komentarze Facebook i Instagram oraz kreator grafik. Dane i zapis
 * przez `/bridge/native/v1/social` (to samo API co Mac i telefon). Modal ładowania przy akcjach, snackbar po sukcesie lub błędzie.
 */

type Tab = 'calendar' | 'review' | 'library' | 'comments';
const WEEKDAYS = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'];

function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  const days: Date[] = [];
  for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) days.push(new Date(day));
  const to = new Date(end);
  to.setDate(end.getDate() + 1);
  return { days, from: start.toISOString(), to: to.toISOString() };
}

export default function SocialMediaWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const [tab, setTab] = useState<Tab>(searchParams?.get('tab') === 'comments' && !searchParams?.get('post') ? 'comments' : 'calendar');
  const focusComments = searchParams?.get('tab') === 'comments';
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [home, setHome] = useState<SocialHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openPostId, setOpenPostId] = useState<string | null>(searchParams?.get('post') || null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const grid = useMemo(() => monthGrid(month), [month]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await socialGet<SocialHome>('home', { company: companyId, from: grid.from, to: grid.to });
      setHome(data);
      setCompanyId((current) => current || data.company.id);
      setError('');
    } catch (cause) {
      setError(errorMessage(cause, 'Nie udało się pobrać social media.'));
    } finally {
      setLoading(false);
    }
  }, [companyId, grid.from, grid.to]);

  useEffect(() => { void load(); }, [load]);

  // Zmiany postów w innych oknach i na innych urządzeniach (Realtime z RLS).
  useEffect(() => {
    if (!home?.company.id) return;
    const channel = supabase.channel(`social-posts-${home.company.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'social_posts', filter: `company_id=eq.${home.company.id}` }, () => { void load(true); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [home?.company.id, load]);

  const openPost = (id: string | null) => {
    setOpenPostId(id);
    const params = new URLSearchParams(searchParams?.toString() || '');
    if (id) params.set('post', id); else params.delete('post');
    if (!id) params.delete('tab');
    router.replace(`/crm/marketing/social${params.toString() ? `?${params.toString()}` : ''}`, { scroll: false });
  };

  const run = async <T,>(title: string, action: () => Promise<T>, success?: string): Promise<T | null> => {
    showLoader(title, 'Proszę chwilę poczekać...');
    try {
      const result = await action();
      if (success) showSnackbar(success, 'success');
      return result;
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Operacja nie powiodła się.'), 'error');
      return null;
    } finally {
      hideLoader();
    }
  };

  const createPost = async (scheduledAt?: string | null) => {
    if (!home) return;
    const detail = await run('Tworzę post', () => socialPost<SocialPostDetail>('createPost', {
      companyId: home.company.id, scheduledAt: scheduledAt || null, channels: ['instagram_feed', 'facebook_feed'],
    }), 'Utworzono szkic posta');
    if (detail) {
      openPost(detail.post.id);
      void load(true);
    }
  };

  const reschedule = async (post: SocialPostItem, day: Date) => {
    const base = post.scheduledAt ? new Date(post.scheduledAt) : null;
    const target = new Date(day);
    target.setHours(base ? base.getHours() : 18, base ? base.getMinutes() : 0, 0, 0);
    if (base && dayKey(base) === dayKey(target)) return;
    await run('Zmieniam termin', () => socialPost('schedule', { id: post.id, updatedAt: post.updatedAt, scheduledAt: target.toISOString() }), 'Zmieniono termin publikacji');
    void load(true);
  };

  const byDay = useMemo(() => {
    const map = new Map<string, SocialPostItem[]>();
    for (const post of home?.posts || []) {
      if (!post.scheduledAt) continue;
      const key = dayKey(new Date(post.scheduledAt));
      map.set(key, [...(map.get(key) || []), post].sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt))));
    }
    return map;
  }, [home?.posts]);
  const undated = (home?.posts || []).filter((post) => !post.scheduledAt && post.status !== 'published' && post.status !== 'cancelled');
  const review = (home?.posts || []).filter((post) => ['in_review', 'changes_requested', 'failed'].includes(post.status));
  const access = home?.access;
  const today = dayKey(new Date());

  const postChip = (post: SocialPostItem) => (
    <button key={post.id} type="button" draggable={Boolean(access?.create && socialPostEditable(post.status) && (post.status !== 'scheduled' || access?.publish))}
      onDragStart={(event) => { setDragId(post.id); event.dataTransfer.setData('text/plain', post.id); event.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => setDragId(null)}
      onClick={() => openPost(post.id)}
      className={`group flex w-full items-center gap-2 rounded-md border border-[#d3bb73]/10 bg-[#0f1119]/80 p-1 text-left hover:border-[#d3bb73]/35 ${dragId === post.id ? 'opacity-40' : ''}`}>
      {post.thumbnailUrl
        ? <img src={post.thumbnailUrl} alt="" className="h-9 w-7 shrink-0 rounded object-cover" />
        : <span className="flex h-9 w-7 shrink-0 items-center justify-center rounded bg-[#1c1f33] text-[#d3bb73]/50"><Images className="h-3.5 w-3.5" /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-[#e5e4e2]">{timeLabel(post.scheduledAt)} {post.title || post.captionPreview || 'Post bez tytułu'}</span>
        <span className="mt-0.5 block"><PostStatusBadge status={post.status} title={post.publishError} /></span>
      </span>
    </button>
  );

  if (error && !home) {
    return (
      <main className="min-h-screen bg-[#0f1119] p-4 text-[#e5e4e2] md:p-6">
        <div className={`${cardClass} p-8 text-center`}>
          <p className="text-[#e5e4e2]/80">{error}</p>
          <button type="button" className={`${secondaryButton} mt-4`} onClick={() => void load()}><RefreshCw className="h-4 w-4" />Spróbuj ponownie</button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f1119] p-4 text-[#e5e4e2] md:p-6">
      <div className="w-full space-y-5">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-[#d3bb73]"><Sparkles className="h-4 w-4" />Marketing</div>
            <h1 className="text-2xl font-light md:text-3xl">Social media</h1>
            <p className="mt-1 max-w-3xl text-sm text-[#e5e4e2]/50">Grafiki z szablonu marki (księga znaku), kalendarz publikacji z akceptacją i biblioteka zdjęć z realizacji ze zgodą klienta.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {home && home.companies.length > 1 && (
              <select value={home.company.id} onChange={(event) => { setCompanyId(event.target.value); openPost(null); }}
                className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm" aria-label="Marka">
                {home.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            )}
            <button type="button" className={secondaryButton} onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Odśwież</button>
            {access?.approve && <button type="button" className={secondaryButton} onClick={() => setSettingsOpen(true)}><Settings2 className="h-4 w-4" />Szablony i AI</button>}
            {access?.create && <button type="button" className={primaryButton} onClick={() => void createPost()}><Plus className="h-4 w-4" />Nowy post</button>}
          </div>
        </header>

        <nav className="flex flex-wrap gap-2" aria-label="Widoki social media">
          {([
            ['calendar', 'Kalendarz', CalendarDays, 0],
            ['review', 'Do akceptacji', ListChecks, (home?.counts.inReview || 0) + (home?.counts.changesRequested || 0) + (home?.counts.failed || 0)],
            ['library', 'Biblioteka', Images, home?.counts.proposals || 0],
            ['comments', 'Komentarze', MessagesSquare, home?.counts.unansweredComments || 0],
          ] as const).map(([key, label, Icon, count]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm ${tab === key ? 'border-[#d3bb73]/50 bg-[#d3bb73]/15 text-[#d3bb73]' : 'border-[#d3bb73]/10 bg-[#1c1f33] text-[#e5e4e2]/70 hover:text-[#e5e4e2]'}`}>
              <Icon className="h-4 w-4" />{label}
              {count > 0 && <span className="rounded-full bg-[#d3bb73] px-1.5 text-[11px] font-semibold text-[#1c1f33]">{count}</span>}
            </button>
          ))}
        </nav>

        {home && <MetaStatusBanner meta={home.meta} companyId={home.company.id} access={home.access} />}

        {tab === 'calendar' && (
          <section className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className={`${cardClass} p-3 md:p-4`}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button type="button" className={secondaryButton} aria-label="Poprzedni miesiąc" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" className={secondaryButton} aria-label="Następny miesiąc" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></button>
                  <button type="button" className={secondaryButton} onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Dziś</button>
                </div>
                <h2 className="text-lg font-light capitalize">{month.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })}</h2>
              </div>
              <div className="overflow-x-auto">
                <div className="grid min-w-[760px] grid-cols-7 gap-1">
                  {WEEKDAYS.map((day) => <div key={day} className="px-2 pb-1 text-[11px] uppercase tracking-wide text-[#e5e4e2]/40">{day}</div>)}
                  {grid.days.map((day) => {
                    const key = dayKey(day);
                    const inMonth = day.getMonth() === month.getMonth();
                    const posts = byDay.get(key) || [];
                    return (
                      <div key={key}
                        onDragOver={(event) => { if (dragId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const id = event.dataTransfer.getData('text/plain') || dragId;
                          const post = home?.posts.find((item) => item.id === id);
                          setDragId(null);
                          if (post) void reschedule(post, day);
                        }}
                        onDoubleClick={() => { if (access?.create) { const at = new Date(day); at.setHours(18, 0, 0, 0); void createPost(at.toISOString()); } }}
                        className={`min-h-[118px] rounded-lg border p-1.5 ${key === today ? 'border-[#d3bb73]/50' : 'border-[#d3bb73]/5'} ${inMonth ? 'bg-[#0f1119]/50' : 'bg-[#0f1119]/20 opacity-60'}`}>
                        <div className={`mb-1 text-right text-xs ${key === today ? 'font-semibold text-[#d3bb73]' : 'text-[#e5e4e2]/45'}`}>{day.getDate()}</div>
                        <div className="space-y-1">{posts.map(postChip)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="mt-3 text-xs text-[#e5e4e2]/40">Przeciągnij post na inny dzień, żeby zmienić termin (godzina zostaje; zaplanowaną publikację przenosi osoba z uprawnieniem „Publikacja”). Dwuklik na dniu — nowy post na ten dzień.</p>
            </div>
            <aside className="space-y-5">
              <div className={`${cardClass} p-4`}>
                <h3 className="mb-3 text-sm font-medium">Szkice bez terminu</h3>
                <div className="space-y-1.5">{undated.length ? undated.map(postChip) : <p className="text-sm text-[#e5e4e2]/40">Brak szkiców bez terminu.</p>}</div>
              </div>
              <div className={`${cardClass} p-4`}>
                <h3 className="mb-3 text-sm font-medium">Wymaga uwagi</h3>
                <div className="space-y-1.5">{review.length ? review.map(postChip) : <p className="text-sm text-[#e5e4e2]/40">Nic nie czeka.</p>}</div>
              </div>
            </aside>
          </section>
        )}

        {tab === 'review' && (
          <section className={`${cardClass} p-4`}>
            {review.length === 0 && <p className="p-6 text-center text-sm text-[#e5e4e2]/45">Żaden post nie czeka na akceptację ani poprawę i nie ma błędów publikacji.</p>}
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {review.map((post) => (
                <button key={post.id} type="button" onClick={() => openPost(post.id)} className="flex gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]/60 p-3 text-left hover:border-[#d3bb73]/35">
                  {post.thumbnailUrl ? <img src={post.thumbnailUrl} alt="" className="h-28 w-[90px] shrink-0 rounded-md object-cover" /> : <span className="flex h-28 w-[90px] shrink-0 items-center justify-center rounded-md bg-[#1c1f33] text-[#d3bb73]/40"><Images className="h-6 w-6" /></span>}
                  <span className="min-w-0 flex-1 space-y-1.5">
                    <PostStatusBadge status={post.status as SocialPostStatus} title={post.publishError} />
                    {post.status === 'failed' && post.publishError && <span className="line-clamp-2 block text-xs text-red-200/80">{post.publishError}</span>}
                    <span className="block truncate font-medium">{post.title || 'Post bez tytułu'}</span>
                    <span className="block text-xs text-[#e5e4e2]/50">{post.channels.map((channel) => SOCIAL_CHANNEL_LABELS[channel]).join(' · ')}</span>
                    <span className="line-clamp-2 block text-xs text-[#e5e4e2]/60">{post.captionPreview || 'Bez opisu'}</span>
                    <span className="block text-[11px] text-[#e5e4e2]/40">{post.authorName ? `Autor: ${post.authorName}` : ''}{post.scheduledAt ? ` · ${new Date(post.scheduledAt).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {tab === 'comments' && home && (
          <SocialComments key={home.company.id} companyId={home.company.id} onOpenPost={(id) => openPost(id)} onChanged={() => void load(true)} />
        )}

        {tab === 'library' && home && (
          <SocialLibrary key={`${home.company.id}-${libraryVersion}`} companyId={home.company.id} access={home.access}
            onCreatePost={async (assetId) => {
              const detail = await run('Tworzę post', () => socialPost<SocialPostDetail>('createPost', {
                companyId: home.company.id, assetId, channels: ['instagram_feed', 'facebook_feed'],
              }), 'Utworzono szkic posta ze zdjęciem');
              if (detail) { openPost(detail.post.id); void load(true); }
            }}
            onChanged={() => void load(true)} />
        )}
      </div>

      {openPostId && (
        <SocialPostEditor postId={openPostId} focusComments={focusComments} onClose={() => { openPost(null); void load(true); }}
          onChanged={() => { void load(true); setLibraryVersion((value) => value + 1); }} onOpenPost={(id) => openPost(id)} />
      )}
      {settingsOpen && home && (
        <SocialSettingsModal companyId={home.company.id} settings={home.settings} templates={home.templates}
          onClose={() => setSettingsOpen(false)} onSaved={() => void load(true)} />
      )}
    </main>
  );
}
