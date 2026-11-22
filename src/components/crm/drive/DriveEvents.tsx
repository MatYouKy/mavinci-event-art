'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, ChevronRight, Download, ExternalLink, Eye, Folder, HardDrive, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { DRIVE_TITLE } from '@/lib/drive/driveShared';
import { formatMaterialBytes, materialKind, materialPreviewable } from '@/lib/materials/materialsShared';
import { MaterialThumb, cardClass, dateLabel, errorMessage, ghostButton, inputClass, secondaryButton } from '../materials/materialsUi';
import { downloadMaterial } from '../materials/materialsApi';
import type { PreviewItem } from '../materials/MaterialsPreview';
import { eventFilesGet } from './driveApi';

/*
 * Dysk → Eventy: to samo drzewo co w Finderze (Mavinci → Eventy → rok → „RRRR-MM-DD Nazwa” → foldery i pliki z zakładki
 * Pliki). Przeglądanie, podgląd i pobieranie; zmiany w plikach wydarzenia — w zakładce Pliki wydarzenia albo w Finderze.
 */

export type DriveEvent = { id: string; name: string; date: string | null; endDate: string | null; status: string | null };
type EventFolder = { id: string; eventId: string; parentId: string | null; name: string; formal: boolean; system: boolean };
type EventFile = { id: string; eventId: string; parentId: string | null; name: string; size: number; mime: string; updatedAt: string | null; createdAt: string | null };
type EventListing = { event: DriveEvent; folders: EventFolder[]; files: EventFile[] };
type Notify = (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;

export const NO_DATE = 'Bez daty';
export const eventYear = (event: DriveEvent) => (event.date ? event.date.slice(0, 4) : NO_DATE);
export const eventFolderName = (event: DriveEvent) => `${event.date || NO_DATE} ${event.name}`.trim();

export default function DriveEvents({ events, eventsError, year, eventId, folderId, onNavigate, onPreview, onReload, notify }: {
  events: DriveEvent[] | null;
  eventsError: string;
  year: string | null;
  eventId: string | null;
  folderId: string | null;
  onNavigate: (target: { year: string | null; eventId: string | null; folderId: string | null }) => void;
  onPreview: (items: PreviewItem[], index: number) => void;
  onReload: () => void;
  notify: Notify;
}) {
  const [listing, setListing] = useState<EventListing | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    setListing(null);
    setError('');
    if (!eventId) return;
    let active = true;
    eventFilesGet<EventListing>('list', { event: eventId })
      .then((data) => { if (active) setListing(data); })
      .catch((cause) => { if (active) setError(errorMessage(cause, 'Nie udało się otworzyć plików wydarzenia.')); });
    return () => { active = false; };
  }, [eventId]);

  useEffect(() => { setFilter(''); }, [year, eventId, folderId]);

  const needle = filter.trim().toLocaleLowerCase('pl-PL');
  const event = listing?.event || events?.find((entry) => entry.id === eventId) || null;
  const currentYear = event ? eventYear(event) : year;

  const years = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of events || []) counts.set(eventYear(entry), (counts.get(eventYear(entry)) || 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => (a[0] === NO_DATE ? 1 : b[0] === NO_DATE ? -1 : b[0].localeCompare(a[0])));
  }, [events]);

  const yearEvents = useMemo(() => (events || []).filter((entry) => eventYear(entry) === currentYear)
    .filter((entry) => !needle || eventFolderName(entry).toLocaleLowerCase('pl-PL').includes(needle))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name, 'pl')), [currentYear, events, needle]);

  const folderPath = useMemo(() => {
    const chain: EventFolder[] = [];
    const byId = new Map((listing?.folders || []).map((folder) => [folder.id, folder] as const));
    for (let id = folderId, guard = 0; id && guard < 40; guard += 1) {
      const folder = byId.get(id);
      if (!folder) break;
      chain.unshift(folder);
      id = folder.parentId;
    }
    return chain;
  }, [folderId, listing]);

  const childFolders = (listing?.folders || []).filter((folder) => (folder.parentId || null) === (folderId || null))
    .filter((folder) => !needle || folder.name.toLocaleLowerCase('pl-PL').includes(needle))
    .sort((a, b) => Number(b.system) - Number(a.system) || a.name.localeCompare(b.name, 'pl'));
  const files = (listing?.files || []).filter((file) => (file.parentId || null) === (folderId || null))
    .filter((file) => !needle || file.name.toLocaleLowerCase('pl-PL').includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));

  const previewItem = (file: EventFile): PreviewItem => ({
    source: 'event', id: file.id, name: file.name, kind: materialKind(file.mime, file.name), mime: file.mime, size: file.size, thumbnailUrl: null,
    subtitle: event?.name,
  });
  const preview = (file: EventFile) => {
    const list = files.filter((entry) => materialPreviewable(materialKind(entry.mime, entry.name), entry.mime, entry.name));
    const index = list.findIndex((entry) => entry.id === file.id);
    if (index < 0) {
      void download(file);
      return;
    }
    onPreview(list.map(previewItem), index);
  };
  const download = async (file: EventFile) => {
    try {
      await downloadMaterial('event', file.id);
    } catch (cause) {
      notify(errorMessage(cause, 'Nie udało się pobrać pliku.'), 'error');
    }
  };

  const crumb = (label: string, onClick: (() => void) | null, last = false) => (
    <span className="inline-flex items-center gap-1">
      <ChevronRight className="h-3.5 w-3.5 text-[#e5e4e2]/30" />
      {onClick ? (
        <button type="button" onClick={onClick} className={`rounded-md px-2 py-1 hover:bg-[#e5e4e2]/5 ${last ? 'text-[#e5e4e2]' : 'text-[#e5e4e2]/60'}`}>{label}</button>
      ) : <span className="px-2 py-1 text-[#e5e4e2]">{label}</span>}
    </span>
  );

  if (eventsError && !events) {
    return (
      <div className={`${cardClass} p-8 text-center`}>
        <p className="text-sm text-[#e5e4e2]/80">{eventsError}</p>
        <button type="button" className={`${secondaryButton} mt-4`} onClick={onReload}><RefreshCw className="h-4 w-4" />Spróbuj ponownie</button>
      </div>
    );
  }

  const tile = (key: string, label: string, sub: string, onClick: () => void, Icon = Folder) => (
    <button key={key} type="button" onClick={onClick}
      className="flex items-center gap-3 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-3 text-left transition-colors hover:border-[#d3bb73]/30">
      <Icon className="h-6 w-6 shrink-0 text-[#d3bb73]/80" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm" title={label}>{label}</span>
        {sub && <span className="block truncate text-[11px] text-[#e5e4e2]/40">{sub}</span>}
      </span>
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm" aria-label="Ścieżka w Dysku">
          <span className="inline-flex items-center gap-1 px-2 py-1 text-[#e5e4e2]/50"><HardDrive className="h-3.5 w-3.5" />{DRIVE_TITLE}</span>
          {crumb('Eventy', () => onNavigate({ year: null, eventId: null, folderId: null }), !currentYear)}
          {currentYear && crumb(currentYear, () => onNavigate({ year: currentYear, eventId: null, folderId: null }), !event)}
          {event && crumb(eventFolderName(event), () => onNavigate({ year: currentYear, eventId: event.id, folderId: null }), !folderPath.length)}
          {folderPath.map((folder, index) => (
            <span key={folder.id}>{crumb(folder.name, () => onNavigate({ year: currentYear, eventId: event?.id || null, folderId: folder.id }), index === folderPath.length - 1)}</span>
          ))}
        </nav>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/30" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtruj…" aria-label="Filtruj" className={`${inputClass} w-56 pl-9 pr-8`} />
          {filter && (
            <button type="button" onClick={() => setFilter('')} aria-label="Wyczyść filtr"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#e5e4e2]/40 hover:text-[#e5e4e2]"><X className="h-4 w-4" /></button>
          )}
        </div>
        {event && <Link href={`/crm/events/${event.id}`} className={secondaryButton}><ExternalLink className="h-4 w-4" />Otwórz wydarzenie</Link>}
      </div>

      {!events ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>
      ) : !currentYear ? (
        years.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
            {years.map(([label, count]) => tile(label, label, `${count} ${count === 1 ? 'wydarzenie' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'wydarzenia' : 'wydarzeń'}`,
              () => onNavigate({ year: label, eventId: null, folderId: null }), CalendarDays))}
          </div>
        ) : <p className="py-24 text-center text-sm text-[#e5e4e2]/50">Nie masz dostępu do żadnego wydarzenia.</p>
      ) : !event ? (
        yearEvents.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
            {yearEvents.map((entry) => tile(entry.id, eventFolderName(entry), '', () => onNavigate({ year: currentYear, eventId: entry.id, folderId: null })))}
          </div>
        ) : <p className="py-24 text-center text-sm text-[#e5e4e2]/50">{needle ? 'Nic nie pasuje do filtra.' : 'Brak wydarzeń w tym roku.'}</p>
      ) : error ? (
        <div className={`${cardClass} p-8 text-center text-sm text-[#e5e4e2]/80`}>{error}</div>
      ) : !listing ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>
      ) : !childFolders.length && !files.length ? (
        <p className="py-24 text-center text-sm text-[#e5e4e2]/50">{needle ? 'Nic nie pasuje do filtra.' : 'Ten folder jest pusty. Pliki dodasz w zakładce Pliki wydarzenia albo w Finderze.'}</p>
      ) : (
        <div className="space-y-4">
          {!!childFolders.length && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
              {childFolders.map((folder) => tile(folder.id, folder.name, folder.formal ? 'Dokumenty formalne' : '',
                () => onNavigate({ year: currentYear, eventId: event.id, folderId: folder.id })))}
            </div>
          )}
          {!!files.length && (
            <div className={`${cardClass} divide-y divide-[#d3bb73]/10`}>
              {files.map((file) => {
                const kind = materialKind(file.mime, file.name);
                const previewable = materialPreviewable(kind, file.mime, file.name);
                return (
                  <div key={file.id} onDoubleClick={() => preview(file)} className="group flex items-center gap-3 px-3 py-2 hover:bg-[#e5e4e2]/5">
                    <MaterialThumb url={null} kind={kind} name={file.name} className="h-10 w-10 shrink-0 rounded-md" />
                    <p className="min-w-0 flex-1 truncate text-sm" title={file.name}>{file.name}</p>
                    <span className="hidden w-24 shrink-0 text-right text-xs text-[#e5e4e2]/50 md:block">{formatMaterialBytes(file.size)}</span>
                    <span className="hidden w-24 shrink-0 text-right text-xs text-[#e5e4e2]/50 md:block">{dateLabel(file.updatedAt || file.createdAt)}</span>
                    {previewable && <button type="button" className={ghostButton} onClick={() => preview(file)} aria-label={`Podgląd: ${file.name}`}><Eye className="h-4 w-4" /></button>}
                    <button type="button" className={ghostButton} onClick={() => void download(file)} aria-label={`Pobierz: ${file.name}`}><Download className="h-4 w-4" /></button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
