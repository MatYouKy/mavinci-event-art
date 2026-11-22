'use client';

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Calculator, CalendarDays, ChevronDown, ChevronRight, FileSignature, FileText, Folder, FolderOpen, FolderTree, HardDrive, Loader2, Package, RefreshCw,
  UserRound, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { DRIVE_TITLE, type DriveFolder, type DriveListing, type DriveRoot, type DriveSection } from '@/lib/drive/driveShared';
import MaterialsWorkspace from '../materials/MaterialsWorkspace';
import MaterialsPreview, { type PreviewItem } from '../materials/MaterialsPreview';
import { cardClass, errorMessage, secondaryButton } from '../materials/materialsUi';
import DriveBrowser from './DriveBrowser';
import DriveEvents, { NO_DATE, eventFolderName, eventYear, type DriveEvent } from './DriveEvents';
import { driveGet, eventFilesGet } from './driveApi';

/*
 * Dysk (`/crm/materials`) — ta sama chmura co w Finderze (Mavinci → …), na Macu i w telefonie: jedno drzewo z działami
 * Eventy, Materiały, Oferty, Kalkulacje, Umowy, Magazyn i Pracownicy (tylko działy, do których pracownik ma dostęp). Materiały mają
 * pełne zarządzanie (`MaterialsWorkspace`, jego drzewo folderów i albumów trafia pod pozycję „Materiały”), Eventy — przeglądanie
 * plików wydarzeń, pozostałe działy — `DriveBrowser`. Adres strony pamięta dział i folder (odnośniki do miejsca w Dysku).
 */

type Notify = (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
type EventsNav = { year: string | null; eventId: string | null; folderId: string | null };

const SECTION_KEY = 'mavinci.drive.section';
const SECTION_ICONS: Record<DriveSection, LucideIcon> = {
  events: CalendarDays, materials: FolderOpen, offers: FileText, calculations: Calculator, contracts: FileSignature, warehouse: Package, employees: Users,
};
const SECTIONS: DriveSection[] = ['events', 'materials', 'offers', 'calculations', 'contracts', 'warehouse', 'employees'];
const isSection = (value: unknown): value is DriveSection => SECTIONS.includes(value as DriveSection);

function readSection(): string | null {
  try { return window.localStorage.getItem(SECTION_KEY); } catch { return null; }
}

export default function DriveWorkspace() {
  const router = useRouter();
  const pathname = usePathname() || '/crm/materials';
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const notify = useCallback<Notify>((message, type) => { if (message) showSnackbar(message, type); }, [showSnackbar]);

  const [root, setRoot] = useState<DriveRoot | null>(null);
  const [rootError, setRootError] = useState('');
  const [section, setSection] = useState<DriveSection | null>(() => {
    const value = searchParams?.get('section');
    if (isSection(value)) return value;
    if (searchParams?.get('company') || searchParams?.get('folder')) return 'materials';
    return null;
  });
  const [node, setNode] = useState<string | null>(() => searchParams?.get('node') || null);
  const [eventsNav, setEventsNav] = useState<EventsNav>(() => ({
    year: searchParams?.get('year') || null, eventId: searchParams?.get('event') || null, folderId: searchParams?.get('efolder') || null,
  }));
  const [events, setEvents] = useState<DriveEvent[] | null>(null);
  const [eventsError, setEventsError] = useState('');
  const [tree, setTree] = useState<Record<string, DriveFolder[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<{ items: PreviewItem[]; index: number } | null>(null);

  const loadRoot = useCallback(async () => {
    try {
      setRoot(await driveGet<DriveRoot>('root'));
      setRootError('');
    } catch (error) {
      setRootError(errorMessage(error, 'Nie udało się otworzyć Dysku.'));
    }
  }, []);

  useEffect(() => { void loadRoot(); }, [loadRoot]);

  const available = useMemo(() => (root?.sections || []).filter((entry) => entry.available), [root]);

  // Dział na start: z adresu, ostatnio otwarty, Materiały albo pierwszy dostępny.
  useEffect(() => {
    if (!root) return;
    if (section && available.some((entry) => entry.key === section)) return;
    const saved = readSection();
    const next = available.find((entry) => entry.key === saved)?.key
      || available.find((entry) => entry.key === 'materials')?.key || available[0]?.key || null;
    setSection(next);
  }, [available, root, section]);

  useEffect(() => {
    if (!section) return;
    try { window.localStorage.setItem(SECTION_KEY, section); } catch { /* bez pamięci przeglądarki */ }
  }, [section]);

  // Adres strony (Materiały ustawiają swój: marka i folder — z adresu znikają tylko parametry Dysku, żeby odświeżenie wracało do Materiałów).
  useEffect(() => {
    if (!section || typeof window === 'undefined') return;
    if (section === 'materials') {
      const current = new URLSearchParams(window.location.search);
      const own = ['section', 'node', 'year', 'event', 'efolder'];
      if (!own.some((key) => current.has(key))) return;
      own.forEach((key) => current.delete(key));
      const query = current.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      return;
    }
    const params = new URLSearchParams({ section });
    if (section === 'events') {
      if (eventsNav.year) params.set('year', eventsNav.year);
      if (eventsNav.eventId) params.set('event', eventsNav.eventId);
      if (eventsNav.folderId) params.set('efolder', eventsNav.folderId);
    } else if (node && node !== section) params.set('node', node);
    const next = `${pathname}?${params.toString()}`;
    if (`${window.location.pathname}${window.location.search}` !== next) router.replace(next, { scroll: false });
  }, [eventsNav, node, pathname, router, section]);

  const loadEvents = useCallback(async () => {
    try {
      const data = await eventFilesGet<{ events: DriveEvent[] }>('events');
      setEvents(data.events);
      setEventsError('');
    } catch (error) {
      setEventsError(errorMessage(error, 'Nie udało się pobrać eventów.'));
    }
  }, []);

  useEffect(() => {
    if (section === 'events' && !events) void loadEvents();
  }, [events, loadEvents, section]);

  // Drzewo Ofert, Kalkulacji, Umów, Magazynu i Pracowników: foldery wczytywane przy rozwinięciu (sprzęt — tylko w treści).
  const loadChildren = useCallback(async (id: string) => {
    try {
      const listing = await driveGet<DriveListing>('list', { node: id });
      setTree((current) => ({ ...current, [id]: listing.folders.filter((folder) => folder.kind !== 'equipment') }));
    } catch {
      setTree((current) => ({ ...current, [id]: [] }));
    }
  }, []);

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        if (!tree[id]) void loadChildren(id);
      }
      return next;
    });
  };

  const openSection = (key: DriveSection) => {
    setSection(key);
    if (key !== section) {
      setNode(null);
      setPreview(null);
      if (key !== 'events' && key !== 'materials' && !tree[key]) void loadChildren(key);
    }
  };

  useEffect(() => {
    if (section && section !== 'events' && section !== 'materials' && !tree[section]) void loadChildren(section);
  }, [loadChildren, section, tree]);

  const openNode = (id: string) => {
    setNode(id === section ? null : id);
    setPreview(null);
  };

  /** Folder otwarty w treści — jego ścieżka rozwija się w drzewie. */
  const onLoaded = useCallback((listing: DriveListing) => {
    const ids = listing.path.map((folder) => folder.id).filter((id) => !id.startsWith('warehouse:item:'));
    setExpanded((current) => {
      const missing = ids.filter((id) => !current.has(id));
      if (!missing.length) return current;
      return new Set([...current, ...missing]);
    });
    for (const id of ids) if (!tree[id]) void loadChildren(id);
  }, [loadChildren, tree]);

  const renderFolders = (parentId: string, depth: number): ReactElement[] => (tree[parentId] || []).flatMap((folder) => {
    const open = expanded.has(folder.id);
    const leaf = folder.kind === 'month' || folder.kind === 'group';
    const active = (node || section) === folder.id;
    const Icon = folder.kind === 'year' || folder.kind === 'month' ? CalendarDays : folder.kind === 'employee' ? UserRound : FolderTree;
    const row = (
      <div key={folder.id} className="flex items-center" style={{ paddingLeft: depth * 12 }}>
        <button type="button" aria-label={open ? 'Zwiń' : 'Rozwiń'} disabled={leaf}
          className="flex h-7 w-6 shrink-0 items-center justify-center text-[#e5e4e2]/40 hover:text-[#e5e4e2]" onClick={() => toggle(folder.id)}>
          {leaf ? null : open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <button type="button" onClick={() => { openNode(folder.id); if (!leaf && !open) toggle(folder.id); }} title={folder.name}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
            active ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/75 hover:bg-[#e5e4e2]/5 hover:text-[#e5e4e2]'}`}>
          <Icon className="h-4 w-4 shrink-0" /><span className="truncate">{folder.name}</span>
        </button>
      </div>
    );
    return open && !leaf ? [row, ...renderFolders(folder.id, depth + 1)] : [row];
  });

  const eventYears = useMemo(() => {
    const set = new Set((events || []).map(eventYear));
    return Array.from(set).sort((a, b) => (a === NO_DATE ? 1 : b === NO_DATE ? -1 : b.localeCompare(a)));
  }, [events]);

  const eventsTree = () => {
    const selected = eventsNav.eventId ? events?.find((entry) => entry.id === eventsNav.eventId) || null : null;
    const activeYear = selected ? eventYear(selected) : eventsNav.year;
    return eventYears.flatMap((year) => {
      const open = activeYear === year;
      const row = (
        <button key={year} type="button" onClick={() => setEventsNav({ year, eventId: null, folderId: null })}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
            open && !eventsNav.eventId ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/75 hover:bg-[#e5e4e2]/5 hover:text-[#e5e4e2]'}`}>
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{year}</span>
        </button>
      );
      if (!open) return [row];
      const list = (events || []).filter((entry) => eventYear(entry) === year).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return [row, ...list.map((entry) => (
        <button key={entry.id} type="button" onClick={() => setEventsNav({ year, eventId: entry.id, folderId: null })} title={eventFolderName(entry)}
          className={`ml-5 flex w-[calc(100%-1.25rem)] items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] ${
            eventsNav.eventId === entry.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/65 hover:bg-[#e5e4e2]/5 hover:text-[#e5e4e2]'}`}>
          <Folder className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{eventFolderName(entry)}</span>
        </button>
      ))];
    });
  };

  if (rootError && !root) {
    return (
      <main className="min-h-screen bg-[#0f1119] p-4 text-[#e5e4e2] md:p-6">
        <div className={`${cardClass} p-8 text-center`}>
          <p className="text-[#e5e4e2]/80">{rootError}</p>
          <button type="button" className={`${secondaryButton} mt-4`} onClick={() => void loadRoot()}><RefreshCw className="h-4 w-4" />Spróbuj ponownie</button>
        </div>
      </main>
    );
  }

  if (!root) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0f1119] text-[#e5e4e2]/60">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#d3bb73]" />Ładowanie Dysku…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#0f1119] p-4 text-[#e5e4e2] md:p-6">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-light md:text-3xl"><HardDrive className="h-7 w-7 text-[#d3bb73]" />{DRIVE_TITLE}</h1>
        <p className="mt-1 max-w-4xl text-sm text-[#e5e4e2]/50">
          Wszystkie pliki firmy w jednym miejscu — ten sam układ co w Finderze (Mavinci), na Macu i w telefonie: Eventy, Materiały, Oferty, Kalkulacje, Umowy, Magazyn i Pracownicy.
        </p>
      </header>

      {!available.length ? (
        <div className={`${cardClass} p-8 text-center text-sm text-[#e5e4e2]/70`}>Nie masz dostępu do żadnego działu Dysku. Uprawnienia nadaje administrator w Poziomach dostępu.</div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          <aside className="hidden w-72 shrink-0 lg:block">
            <nav className={`${cardClass} sticky top-4 max-h-[calc(100vh-2rem)] space-y-0.5 overflow-y-auto p-2`} aria-label="Dysk">
              {available.map((entry) => {
                const Icon = SECTION_ICONS[entry.key];
                const active = section === entry.key;
                return (
                  <div key={entry.key}>
                    <button type="button" onClick={() => openSection(entry.key)} title={entry.description}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${
                        active ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/80 hover:bg-[#e5e4e2]/5 hover:text-[#e5e4e2]'}`}>
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate">{entry.label}</span>
                      {active ? <ChevronDown className="h-3.5 w-3.5 opacity-60" /> : <ChevronRight className="h-3.5 w-3.5 opacity-40" />}
                    </button>
                    {active && (
                      <div className="mb-1 ml-2 border-l border-[#d3bb73]/10 pl-1.5 pt-0.5">
                        {entry.key === 'materials' && <div ref={setPortal} />}
                        {entry.key === 'events' && (events ? eventsTree() : <Loader2 className="m-2 h-4 w-4 animate-spin text-[#d3bb73]" />)}
                        {entry.key !== 'materials' && entry.key !== 'events' && (tree[entry.key] ? renderFolders(entry.key, 0)
                          : <Loader2 className="m-2 h-4 w-4 animate-spin text-[#d3bb73]" />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </aside>

          <section className="min-w-0 flex-1 space-y-3">
            {/* Mniejsze ekrany: działy jako przyciski nad treścią. */}
            <div className="flex flex-wrap gap-1.5 lg:hidden">
              {available.map((entry) => {
                const Icon = SECTION_ICONS[entry.key];
                return (
                  <button key={entry.key} type="button" onClick={() => openSection(entry.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${
                      section === entry.key ? 'border-[#d3bb73] bg-[#d3bb73]/15 text-[#d3bb73]' : 'border-[#d3bb73]/15 text-[#e5e4e2]/70'}`}>
                    <Icon className="h-3.5 w-3.5" />{entry.label}
                  </button>
                );
              })}
            </div>
            {section === 'materials' ? (
              <MaterialsWorkspace embedded sidebarPortal={portal} />
            ) : section === 'events' ? (
              <DriveEvents events={events} eventsError={eventsError} year={eventsNav.year} eventId={eventsNav.eventId} folderId={eventsNav.folderId}
                onNavigate={setEventsNav} onPreview={(items, index) => setPreview({ items, index })} onReload={() => void loadEvents()} notify={notify} />
            ) : section ? (
              <DriveBrowser key={section} nodeId={node || section} onOpen={openNode} onLoaded={onLoaded}
                onPreview={(items, index) => setPreview({ items, index })} notify={notify} />
            ) : null}
          </section>
        </div>
      )}

      {preview && (
        <MaterialsPreview items={preview.items} index={preview.index}
          onIndex={(index) => setPreview((current) => current && { ...current, index })}
          onClose={() => setPreview(null)}
          onError={(message) => notify(message, 'error')} />
      )}
    </main>
  );
}
