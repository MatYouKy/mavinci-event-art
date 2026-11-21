'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CalendarDays, ExternalLink, Images, Plus, RefreshCw, Search, Star } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { useDialog } from '@/contexts/DialogContext';
import { PORTFOLIO_STATUS_LABELS, type PortfolioStatus } from '@/lib/portfolio/portfolioShared';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../social/socialUi';
import { errorMessage, portfolioGet, portfolioPost, type PortfolioDetail, type PortfolioEvent, type PortfolioHome } from './portfolioApi';
import PortfolioEditor, { PortfolioStatusBadge } from './PortfolioEditor';

/*
 * Marketing → „Realizacje” w CRM (pełna szerokość): lista realizacji portfolio strony (szkice, opublikowane, zmiany
 * do opublikowania), wyszukiwanie i filtr, nowa realizacja (pusta albo z wydarzenia) i karta realizacji obok listy.
 * Odnośnik `/crm/marketing/portfolio?id=<realizacja>`. To samo API co Mac i telefon (`/bridge/native/v1/portfolio`).
 */

type Filter = 'all' | PortfolioStatus | 'attention';

export default function PortfolioWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const { showConfirm } = useDialog();
  const [home, setHome] = useState<PortfolioHome | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(searchParams?.get('id') || null);
  const [dirty, setDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [eventQuery, setEventQuery] = useState('');
  const [events, setEvents] = useState<PortfolioEvent[]>([]);

  const load = useCallback(async (silent = false) => {
    if (!silent) showLoader('Wczytuję realizacje', 'Kopie robocze i strona…');
    try {
      const data = await portfolioGet<PortfolioHome>('home');
      setHome(data);
      setError('');
    } catch (cause) {
      setError(errorMessage(cause, 'Nie udało się pobrać realizacji.'));
    } finally {
      if (!silent) hideLoader();
    }
  }, [showLoader, hideLoader]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!creating) return;
    let active = true;
    const timer = window.setTimeout(() => {
      portfolioGet<{ events: PortfolioEvent[] }>('events', { q: eventQuery }).then((data) => { if (active) setEvents(data.events); }).catch(() => undefined);
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [creating, eventQuery]);

  const open = async (id: string | null) => {
    if (id === openId) return;
    if (dirty && !(await showConfirm({ title: 'Niezapisane zmiany', message: 'Realizacja ma niezapisane zmiany. Przejść bez zapisu?', confirmText: 'Przejdź bez zapisu' }))) return;
    setDirty(false);
    setOpenId(id);
    router.replace(id ? `/crm/marketing/portfolio?id=${id}` : '/crm/marketing/portfolio', { scroll: false });
  };

  const create = async (body: { title?: string; eventId?: string }) => {
    setCreating(false);
    showLoader('Tworzę realizację');
    try {
      const detail = await portfolioPost<PortfolioDetail>('create', body);
      showSnackbar('Utworzono szkic realizacji', 'success');
      await load(true);
      setDirty(false);
      setOpenId(detail.item.id);
      router.replace(`/crm/marketing/portfolio?id=${detail.item.id}`, { scroll: false });
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się utworzyć realizacji.'), 'error');
    } finally {
      hideLoader();
      setNewTitle('');
    }
  };

  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pl');
    return (home?.items || [])
      .filter((item) => filter === 'all' || (filter === 'attention' ? item.status === 'changed' || item.status === 'conflict' : item.status === filter))
      .filter((item) => !needle || [item.title, item.category, item.location, item.eventName].some((value) => (value || '').toLocaleLowerCase('pl').includes(needle)))
      .sort((a, b) => (b.eventDate || '').localeCompare(a.eventDate || '') || a.title.localeCompare(b.title, 'pl'));
  }, [home, query, filter]);

  if (error && !home) {
    return <main className="min-h-screen bg-[#0f1119] p-6 text-[#e5e4e2]"><div className={`${cardClass} p-6 text-sm text-[#e5e4e2]/70`}>{error}</div></main>;
  }

  const filters: Array<[Filter, string]> = [
    ['all', `Wszystkie (${home?.items.length || 0})`],
    ['draft', `${PORTFOLIO_STATUS_LABELS.draft} (${home?.counts.draft || 0})`],
    ['published', `Na stronie (${home?.counts.published || 0})`],
    ['attention', `Do opublikowania (${home?.counts.changed || 0})`],
  ];

  return (
    <main className="min-h-screen bg-[#0f1119] p-4 text-[#e5e4e2] md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-light">Realizacje</h1>
          <p className="text-sm text-[#e5e4e2]/50">Portfolio na stronie mavinci.pl — kopie robocze, SEO i publikacja.</p>
        </div>
        {home?.siteUrl && <a href={home.siteUrl} target="_blank" rel="noreferrer" className={secondaryButton}><ExternalLink className="h-4 w-4" />Portfolio na stronie</a>}
        <button type="button" className={secondaryButton} onClick={() => void load()}><RefreshCw className="h-4 w-4" />Odśwież</button>
        <button type="button" className={primaryButton} onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Nowa realizacja</button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#e5e4e2]/40" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj realizacji" className={`${inputClass} pl-8`} />
          </label>
          <div className="flex flex-wrap gap-1">
            {filters.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setFilter(key)}
                className={`rounded-lg px-2.5 py-1 text-xs ${filter === key ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>{label}</button>
            ))}
          </div>
          <div className="space-y-2 xl:max-h-[calc(100vh-220px)] xl:overflow-y-auto xl:pr-1">
            {items.map((item) => (
              <button key={item.id} type="button" onClick={() => void open(item.id)}
                className={`${cardClass} flex w-full gap-3 p-2 text-left transition-colors ${openId === item.id ? 'border-[#d3bb73]/60' : 'hover:border-[#d3bb73]/30'}`}>
                {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="h-16 w-20 shrink-0 rounded object-cover" />
                  : <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded bg-[#0f1119]"><Images className="h-5 w-5 text-[#d3bb73]/30" /></div>}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                    {item.isFeatured && <Star className="h-3.5 w-3.5 shrink-0 text-[#d3bb73]" aria-label="Wyróżniona" />}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PortfolioStatusBadge status={item.status} />
                    {item.problems > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-200"><AlertTriangle className="h-3 w-3" />{item.problems}</span>}
                  </div>
                  <div className="truncate text-[11px] text-[#e5e4e2]/45">{[item.eventDate, item.category, `${item.photos} zdj.`].filter(Boolean).join(' · ')}</div>
                </div>
              </button>
            ))}
            {home && !items.length && <p className={`${cardClass} p-4 text-sm text-[#e5e4e2]/50`}>Brak realizacji w tym widoku.</p>}
          </div>
        </aside>

        <section className="min-w-0">
          {openId && home ? (
            <PortfolioEditor key={openId} id={openId} cities={home.cities} categories={home.categories}
              onChanged={() => void load(true)} onDirtyChange={setDirty}
              onDeleted={() => { setDirty(false); setOpenId(null); router.replace('/crm/marketing/portfolio', { scroll: false }); void load(true); }} />
          ) : (
            <div className={`${cardClass} flex min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center text-sm text-[#e5e4e2]/55`}>
              <Images className="h-10 w-10 text-[#d3bb73]/40" />
              Wybierz realizację z listy albo utwórz nową — z wydarzenia albo od zera.
              <button type="button" className={primaryButton} onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Nowa realizacja</button>
            </div>
          )}
        </section>
      </div>

      {creating && (
        <Modal open onClose={() => setCreating(false)} title="Nowa realizacja" scrollBody>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm">Z wydarzenia w CRM <span className="text-xs text-[#e5e4e2]/40">(tytuł, data, miejsce i zdjęcia z plików wydarzenia)</span></div>
              <input value={eventQuery} onChange={(event) => setEventQuery(event.target.value)} placeholder="Szukaj wydarzenia" className={inputClass} autoFocus />
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {events.map((event) => (
                  <button key={event.id} type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[#d3bb73]/10" onClick={() => void create({ eventId: event.id })}>
                    <CalendarDays className="h-4 w-4 shrink-0 text-[#d3bb73]" />
                    <span className="min-w-0 flex-1 truncate">{event.name}</span>
                    <span className="shrink-0 text-xs text-[#e5e4e2]/45">{event.date?.slice(0, 10)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2 border-t border-[#d3bb73]/10 pt-3">
              <div className="text-sm">Albo od zera</div>
              <div className="flex gap-2">
                <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Tytuł realizacji" className={inputClass}
                  onKeyDown={(event) => { if (event.key === 'Enter' && newTitle.trim()) void create({ title: newTitle.trim() }); }} />
                <button type="button" className={primaryButton} disabled={!newTitle.trim()} onClick={() => void create({ title: newTitle.trim() })}>Utwórz</button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
