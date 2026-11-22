'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, BookOpen, Boxes, Briefcase, Building2, CalendarDays, ChevronRight, Download, ExternalLink, Eye, FileCode, FileSignature, FileText, FolderTree, HardDrive, Landmark,
  LayoutGrid, List, Loader2, Package, Percent, Receipt, RefreshCw, Search, Trash2, TrendingUp, Upload, UploadCloud, UserRound, X,
} from 'lucide-react';
import { useDialog } from '@/contexts/DialogContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { formatMaterialBytes, materialPreviewable, type MaterialKind } from '@/lib/materials/materialsShared';
import {
  DRIVE_RECORD_LABELS, DRIVE_TITLE, DRIVE_UPLOAD_LIMITS, driveRecordPath, parseDriveNode, type DriveFile, type DriveFinanceGroup, type DriveFolder, type DriveListing,
} from '@/lib/drive/driveShared';
import { MaterialThumb, cardClass, dateLabel, errorMessage, ghostButton, inputClass, isFileDrag, primaryButton, secondaryButton } from '../materials/materialsUi';
import type { PreviewItem } from '../materials/MaterialsPreview';
import { deleteDriveFile, downloadDriveFile, driveGet, uploadDriveFile } from './driveApi';

/*
 * Zawartość folderu Dysku poza Eventami i Materiałami: Finanse (firma → Księgowość → rok → miesiąc → Sprzedaż, Koszty, Bank,
 * Podatki i ZUS, XML z KSeF; Dokumenty spółki → kategoria; Umowy stałe → umowa), Oferty, Kalkulacje, Umowy (lata → miesiące →
 * PDF-y), Magazyn (kategorie → sprzęt → zdjęcia, pliki, instrukcja) i Pracownicy (pracownik → Zdjęcia, Dokumenty, Umowy). Podgląd (PDF,
 * zdjęcia), pobieranie, otwarcie rekordu w CRM; do sprzętu (prawo „Zarządzanie magazynem”) i do dokumentów pracownika (własne
 * albo „Pracownicy — zarządzanie”) — dodawanie plików przyciskiem albo przeciągnięciem z Findera.
 */

type Notify = (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
type UploadRow = { name: string; size: number; loaded: number; status: 'waiting' | 'sending' | 'done' | 'error'; error?: string };

const VIEW_KEY = 'mavinci.drive.view';
const folderIcons: Record<DriveFolder['kind'], typeof CalendarDays> = {
  section: HardDrive, year: CalendarDays, month: CalendarDays, category: FolderTree, equipment: Package, brand: FolderTree, employee: UserRound, group: FolderTree,
  company: Building2, books: BookOpen, ledger: FolderTree, corporate: Briefcase, docgroup: FolderTree, agreements: FileSignature, agreement: FileText,
  assets: Boxes, clarify: AlertTriangle,
};
const ledgerIcons: Record<DriveFinanceGroup, typeof CalendarDays> = { sales: TrendingUp, costs: Receipt, bank: Landmark, taxes: Percent, ksef: FileCode };
const folderIcon = (folder: DriveFolder) => {
  const node = folder.kind === 'ledger' ? parseDriveNode(folder.id) : null;
  return (node?.section === 'finance' && node.group ? ledgerIcons[node.group] : folderIcons[folder.kind]) || FolderTree;
};

/** Dokąd trafiają pliki dodane w tym folderze (sprzęt, dokumenty pracownika, Koszty, Dokumenty spółki, umowa stała) — komunikaty wysyłki. */
const uploadPlace = (node: DriveFolder) => {
  if (node.kind === 'group') return 'dokumentów pracownika';
  if (node.kind === 'ledger') return 'kosztów';
  if (node.kind === 'docgroup') return 'dokumentów spółki';
  if (node.kind === 'agreement') return 'umowy';
  return 'sprzętu';
};

/** Pusty folder, do którego można dodawać pliki. */
const uploadEmptyText = (node: DriveFolder) => {
  if (node.kind === 'group') return 'Brak dokumentów. Przeciągnij tu skany i pliki z Findera albo użyj „Dodaj pliki”.';
  if (node.kind === 'ledger') {
    return 'Brak dokumentów kosztowych z tego miesiąca. Przeciągnij tu skan albo plik dokumentu spoza KSeF (faktura zagraniczna, paragon, polisa) — AI odczyta dane, a dokument trafi do teczki miesiąca z jego daty.';
  }
  if (node.kind === 'docgroup') return 'Brak dokumentów w tej kategorii. Przeciągnij tu skany i pliki z Findera albo użyj „Dodaj pliki”.';
  if (node.kind === 'agreement') return 'Ta umowa nie ma jeszcze plików. Przeciągnij tu umowę, aneksy albo harmonogram płatności albo użyj „Dodaj pliki”.';
  return 'Ten sprzęt nie ma jeszcze plików. Przeciągnij tu zdjęcia, instrukcje albo inne pliki z Findera.';
};

export const drivePreviewItem = (file: DriveFile): PreviewItem => ({
  source: 'drive', id: file.id, name: file.name, kind: file.kind as MaterialKind, mime: file.mime, size: file.size || 0,
  thumbnailUrl: file.thumbnailUrl, subtitle: file.detail,
});

export default function DriveBrowser({ nodeId, onOpen, onPreview, onLoaded, notify }: {
  nodeId: string;
  onOpen: (nodeId: string) => void;
  onPreview: (items: PreviewItem[], index: number) => void;
  /** Wczytany folder (drzewo Dysku rozwija jego ścieżkę). */
  onLoaded?: (listing: DriveListing) => void;
  notify: Notify;
}) {
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  const { showConfirm } = useDialog();
  const { showLoader, hideLoader } = useGlobalLoader();
  const [listing, setListing] = useState<DriveListing | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [dropping, setDropping] = useState(false);
  const [uploads, setUploads] = useState<UploadRow[] | null>(null);
  const abort = useRef<AbortController | null>(null);
  const request = useRef(0);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === 'grid' || saved === 'list') setView(saved);
    } catch { /* bez pamięci przeglądarki */ }
  }, []);

  const load = useCallback(async (silent = false) => {
    const id = ++request.current;
    if (!silent) setLoading(true);
    try {
      const data = await driveGet<DriveListing>('list', { node: nodeId });
      if (id !== request.current) return;
      setListing(data);
      setError('');
      loaded.current?.(data);
    } catch (cause) {
      if (id === request.current) setError(errorMessage(cause, 'Nie udało się otworzyć folderu Dysku.'));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [nodeId]);

  useEffect(() => {
    setListing(null);
    setFilter('');
    void load();
  }, [load]);

  const needle = filter.trim().toLocaleLowerCase('pl-PL');
  const folders = useMemo(() => (listing?.folders || []).filter((folder) => !needle || folder.name.toLocaleLowerCase('pl-PL').includes(needle)), [listing, needle]);
  const files = useMemo(() => (listing?.files || []).filter((file) => !needle || `${file.name} ${file.detail}`.toLocaleLowerCase('pl-PL').includes(needle)), [listing, needle]);
  const canUpload = listing?.canUpload === true;

  const preview = (file: DriveFile) => {
    const list = files.filter((entry) => materialPreviewable(entry.kind as MaterialKind, entry.mime, entry.name));
    const index = list.findIndex((entry) => entry.id === file.id);
    if (index < 0) {
      void download(file);
      return;
    }
    onPreview(list.map(drivePreviewItem), index);
  };

  const download = async (file: DriveFile) => {
    try {
      await downloadDriveFile(file.id);
    } catch (cause) {
      notify(errorMessage(cause, 'Nie udało się pobrać pliku.'), 'error');
    }
  };

  /** Dokument spółki albo plik umowy stałej („Finanse — zarządzanie”); znika też z Findera i Maca. */
  const remove = async (file: DriveFile) => {
    const confirmed = await showConfirm({
      title: 'Usuń plik', message: `Usunąć „${file.name}”? Plik zniknie z Dysku, Findera i Maca — tej operacji nie można cofnąć.`,
      confirmText: 'Usuń', cancelText: 'Anuluj',
    });
    if (!confirmed) return;
    showLoader('Usuwam plik', 'Proszę chwilę poczekać...');
    try {
      await deleteDriveFile(file.id);
      notify('Usunięto plik.', 'success');
      await load(true);
    } catch (cause) {
      notify(errorMessage(cause, 'Nie udało się usunąć pliku.'), 'error');
    } finally {
      hideLoader();
    }
  };

  const upload = async (list: File[]) => {
    if (!listing || !canUpload || !list.length || uploads?.some((row) => row.status === 'sending' || row.status === 'waiting')) return;
    const rows: UploadRow[] = list.map((file) => ({
      name: file.name, size: file.size, loaded: 0,
      status: file.size > DRIVE_UPLOAD_LIMITS.file ? 'error' : 'waiting',
      error: file.size > DRIVE_UPLOAD_LIMITS.file ? 'Plik przekracza 50 MB.' : undefined,
    }));
    setUploads(rows);
    const controller = new AbortController();
    abort.current = controller;
    const parentId = listing.node.id;
    let added = 0;
    const notices: string[] = [];
    for (let i = 0; i < list.length; i += 1) {
      if (rows[i].status === 'error') continue;
      if (controller.signal.aborted) break;
      const update = (patch: Partial<UploadRow>) => setUploads((current) => current && current.map((row, index) => (index === i ? { ...row, ...patch } : row)));
      update({ status: 'sending' });
      try {
        const result = await uploadDriveFile(parentId, list[i], (loaded) => update({ loaded }), controller.signal);
        if (result.notice && !notices.includes(result.notice)) notices.push(result.notice);
        update({ status: 'done', loaded: list[i].size });
        added += 1;
      } catch (cause) {
        update({ status: 'error', error: errorMessage(cause, 'Nie udało się dodać pliku.') });
        if ((cause as Error)?.name === 'AbortError') break;
      }
    }
    abort.current = null;
    if (added) {
      const done = added === 1 ? `Dodano plik do ${uploadPlace(listing.node)}.` : `Dodano pliki do ${uploadPlace(listing.node)}: ${added}.`;
      notify([done, ...notices.slice(0, 3)].join(' '), 'success');
    }
    await load(true);
  };

  const dropProps = canUpload ? {
    onDragOver: (event: DragEvent) => { if (isFileDrag(event)) { event.preventDefault(); setDropping(true); } },
    onDragLeave: (event: DragEvent) => { if (event.currentTarget === event.target) setDropping(false); },
    onDrop: (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      setDropping(false);
      void upload(Array.from(event.dataTransfer.files || []));
    },
  } : {};

  if (error && !listing) {
    return (
      <div className={`${cardClass} p-8 text-center`}>
        <p className="text-sm text-[#e5e4e2]/80">{error}</p>
        <button type="button" className={`${secondaryButton} mt-4`} onClick={() => void load()}><RefreshCw className="h-4 w-4" />Spróbuj ponownie</button>
      </div>
    );
  }

  const path = listing?.path || [];
  const recordNode = listing?.node.kind === 'group' ? listing.path.find((folder) => folder.kind === 'employee') : listing?.node;
  const record = listing?.node.kind === 'equipment' ? { type: 'equipment' as const, id: listing.node.id.split(':')[2] }
    : recordNode?.kind === 'employee' ? { type: 'employee' as const, id: recordNode.id.split(':')[1] }
      : listing?.node.id.startsWith('finance') ? { type: 'finance' as const, id: '' } : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm" aria-label="Ścieżka w Dysku">
          <span className="inline-flex items-center gap-1 px-2 py-1 text-[#e5e4e2]/50"><HardDrive className="h-3.5 w-3.5" />{DRIVE_TITLE}</span>
          {path.map((folder, index) => (
            <span key={folder.id} className="inline-flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-[#e5e4e2]/30" />
              <button type="button" onClick={() => onOpen(folder.id)}
                className={`rounded-md px-2 py-1 hover:bg-[#e5e4e2]/5 ${index === path.length - 1 ? 'text-[#e5e4e2]' : 'text-[#e5e4e2]/60'}`}>{folder.name}</button>
            </span>
          ))}
        </nav>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/30" />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtruj w tym folderze…" aria-label="Filtruj w tym folderze"
            className={`${inputClass} w-56 pl-9 pr-8`} />
          {filter && (
            <button type="button" onClick={() => setFilter('')} aria-label="Wyczyść filtr"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#e5e4e2]/40 hover:text-[#e5e4e2]"><X className="h-4 w-4" /></button>
          )}
        </div>
        {record && driveRecordPath(record) && (
          <Link href={driveRecordPath(record)!} className={secondaryButton}><ExternalLink className="h-4 w-4" />{DRIVE_RECORD_LABELS[record.type]}</Link>
        )}
        {canUpload && (
          <label className={`${primaryButton} cursor-pointer`}>
            <Upload className="h-4 w-4" />Dodaj pliki
            <input type="file" multiple className="hidden" onChange={(event) => {
              const list = Array.from(event.target.files || []);
              event.target.value = '';
              void upload(list);
            }} />
          </label>
        )}
        <div className="inline-flex rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] p-0.5">
          {([['grid', LayoutGrid, 'Siatka'], ['list', List, 'Lista']] as const).map(([value, Icon, label]) => (
            <button key={value} type="button" title={label} aria-label={label}
              onClick={() => { setView(value); try { window.localStorage.setItem(VIEW_KEY, value); } catch { /* bez pamięci */ } }}
              className={`rounded-md p-1.5 ${view === value ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
        <button type="button" className={ghostButton} onClick={() => void load()} title="Odśwież" aria-label="Odśwież"><RefreshCw className="h-4 w-4" /></button>
      </div>

      <div {...dropProps} className={`relative min-h-[60vh] rounded-xl ${dropping ? 'ring-2 ring-[#d3bb73]/60' : ''}`}>
        {!listing || (loading && !listing) ? (
          <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>
        ) : !folders.length && !files.length ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center text-sm text-[#e5e4e2]/50">
            {canUpload ? <UploadCloud className="h-10 w-10 text-[#d3bb73]/50" /> : <FolderTree className="h-10 w-10 text-[#d3bb73]/40" />}
            <p>{needle ? 'Nic nie pasuje do filtra.' : canUpload ? uploadEmptyText(listing.node) : emptyText(listing.node)}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {!!folders.length && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
                {folders.map((folder) => {
                  const Icon = folderIcon(folder);
                  return (
                    <button key={folder.id} type="button" onClick={() => onOpen(folder.id)}
                      className="flex items-center gap-3 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-3 text-left transition-colors hover:border-[#d3bb73]/30">
                      <Icon className="h-6 w-6 shrink-0 text-[#d3bb73]/80" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{folder.name}</span>
                        {folder.count !== null && <span className="block text-[11px] text-[#e5e4e2]/40">{countLabel(folder)}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {!!files.length && (view === 'grid' ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                {files.map((file) => (
                  <div key={file.id} role="button" tabIndex={0} onDoubleClick={() => preview(file)}
                    onKeyDown={(event) => { if (event.key === 'Enter') preview(file); }}
                    className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] transition-colors hover:border-[#d3bb73]/30">
                    <div className="relative">
                      <MaterialThumb url={file.thumbnailUrl} kind={file.kind as MaterialKind} name={file.name} className="aspect-[4/3] w-full"
                        contain={file.type === 'brand-logo' || file.type === 'company-logo'} />
                      <FileActions file={file} onPreview={() => preview(file)} onDownload={() => void download(file)} onDelete={() => void remove(file)} overlay />
                    </div>
                    <div className="space-y-0.5 p-2">
                      <p className="line-clamp-2 break-words text-[13px] leading-tight" title={file.name}>{file.name}</p>
                      <p className="truncate text-[11px] text-[#e5e4e2]/40">{[file.detail, dateLabel(file.updatedAt)].filter(Boolean).join(' · ')}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`${cardClass} divide-y divide-[#d3bb73]/10`}>
                {files.map((file) => (
                  <div key={file.id} onDoubleClick={() => preview(file)} className="group flex items-center gap-3 px-3 py-2 hover:bg-[#e5e4e2]/5">
                    <MaterialThumb url={file.thumbnailUrl} kind={file.kind as MaterialKind} name={file.name} className="h-10 w-10 shrink-0 rounded-md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm" title={file.name}>{file.name}</p>
                      <p className="truncate text-[11px] text-[#e5e4e2]/40">{file.detail}</p>
                    </div>
                    <span className="hidden w-24 shrink-0 text-right text-xs text-[#e5e4e2]/50 md:block">{file.size ? formatMaterialBytes(file.size) : ''}</span>
                    <span className="hidden w-24 shrink-0 text-right text-xs text-[#e5e4e2]/50 md:block">{dateLabel(file.updatedAt)}</span>
                    <FileActions file={file} onPreview={() => preview(file)} onDownload={() => void download(file)} onDelete={() => void remove(file)} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {dropping && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-[#0f1119]/70">
            <p className="rounded-lg bg-[#1c1f33] px-4 py-3 text-sm text-[#d3bb73]">Upuść, aby dodać do: {listing?.node.name}</p>
          </div>
        )}
      </div>

      {uploads && (
        <div className={`${cardClass} fixed bottom-4 right-4 z-40 w-80 space-y-2 p-3 shadow-2xl`} role="status">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm">Dodawanie plików do {listing ? uploadPlace(listing.node) : 'sprzętu'}</p>
            {uploads.some((row) => row.status === 'sending' || row.status === 'waiting')
              ? <button type="button" className={ghostButton} onClick={() => abort.current?.abort()}>Anuluj</button>
              : <button type="button" className={ghostButton} onClick={() => setUploads(null)} aria-label="Zamknij"><X className="h-4 w-4" /></button>}
          </div>
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {uploads.map((row, index) => (
              <div key={`${row.name}-${index}`} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  <span className={row.status === 'error' ? 'text-red-300' : row.status === 'done' ? 'text-emerald-300' : 'text-[#e5e4e2]/50'}>
                    {row.status === 'done' ? 'Dodano' : row.status === 'error' ? 'Błąd' : row.status === 'waiting' ? 'Czeka' : `${Math.round((row.loaded / Math.max(1, row.size)) * 100)}%`}
                  </span>
                </div>
                {row.error && <p className="text-red-300/80">{row.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FileActions({ file, onPreview, onDownload, onDelete, overlay = false }: {
  file: DriveFile; onPreview: () => void; onDownload: () => void; onDelete: () => void; overlay?: boolean;
}) {
  const path = driveRecordPath(file.record);
  const previewable = materialPreviewable(file.kind as MaterialKind, file.mime, file.name);
  const button = 'rounded-md bg-[#0f1119]/85 p-1.5 text-[#e5e4e2]/80 hover:bg-[#0f1119] hover:text-[#d3bb73]';
  return (
    <div className={overlay ? 'absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100' : 'flex shrink-0 gap-1'}>
      {previewable && <button type="button" className={button} onClick={onPreview} title="Podgląd" aria-label={`Podgląd: ${file.name}`}><Eye className="h-4 w-4" /></button>}
      <button type="button" className={button} onClick={onDownload} title="Pobierz" aria-label={`Pobierz: ${file.name}`}><Download className="h-4 w-4" /></button>
      {path && file.record && (
        <Link href={path} className={button} title={DRIVE_RECORD_LABELS[file.record.type]} aria-label={`${DRIVE_RECORD_LABELS[file.record.type]}: ${file.name}`}>
          <ExternalLink className="h-4 w-4" />
        </Link>
      )}
      {file.canDelete && (
        <button type="button" className={button} onClick={onDelete} title="Usuń" aria-label={`Usuń: ${file.name}`}><Trash2 className="h-4 w-4" /></button>
      )}
    </div>
  );
}

function countLabel(folder: DriveFolder) {
  const n = folder.count || 0;
  if (folder.id.startsWith('finance:')) return `${n} ${n === 1 ? 'dokument' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'dokumenty' : 'dokumentów'}`;
  if (folder.kind === 'category') return `${n} ${n === 1 ? 'pozycja' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'pozycje' : 'pozycji'}`;
  return `${n} ${n === 1 ? 'plik' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'pliki' : 'plików'}`;
}

const FINANCE_EMPTY: Record<DriveFinanceGroup, string> = {
  sales: 'Brak faktur sprzedaży z tego miesiąca (proformy, szkice i anulowane nie trafiają do księgowości).',
  costs: 'Brak dokumentów kosztowych z tego miesiąca — faktur odebranych w KSeF ani dokumentów spoza KSeF.',
  bank: 'Brak wyciągów bankowych z tego miesiąca. Wyciągi dodaje się w Centrum finansów.',
  taxes: 'Brak deklaracji i dokumentów podatkowych z tego miesiąca. Dodaje się je w Centrum finansów.',
  ksef: 'Brak plików XML z KSeF z tego miesiąca.',
};

function emptyText(node: DriveFolder) {
  const finance = parseDriveNode(node.id);
  if (finance?.section === 'finance') {
    if (finance.group) return FINANCE_EMPTY[finance.group];
    if (finance.category) return 'Brak dokumentów w tej kategorii. Dodaje je osoba z poziomem „Finanse — zarządzanie”.';
    if (finance.contractId) return 'Ta umowa nie ma jeszcze plików. Dodaje je osoba z poziomem „Finanse — zarządzanie”.';
    if (finance.area === 'agreements') return 'Brak umów stałych. Umowy zakłada się w Centrum finansów (najem, leasing, abonamenty, ubezpieczenia, kredyty).';
    if (finance.books) return 'Brak dokumentów księgowych tej firmy.';
    return finance.companyId ? 'Ten folder jest pusty.' : 'Nie masz dostępu do finansów żadnej firmy.';
  }
  if (node.id.startsWith('offers')) return 'Brak ofert z PDF-em. PDF oferty powstaje w CRM, w ofercie.';
  if (node.id.startsWith('calculations')) return 'Brak kalkulacji z PDF-em. PDF powstaje w kalkulacji eventu albo zapytania.';
  if (node.id.startsWith('contracts')) return 'Brak umów z PDF-em. PDF umowy powstaje w CRM, w umowie.';
  if (node.kind === 'equipment') return 'Ten sprzęt nie ma jeszcze zdjęć ani plików.';
  if (node.id.startsWith('employees:') && node.id.endsWith(':photos')) return 'Pracownik nie ma jeszcze zdjęcia profilowego ani zdjęcia w tle.';
  if (node.id.startsWith('employees:') && node.id.endsWith(':contracts')) {
    return 'Brak dokumentów umów. Dokument powstaje w profilu pracownika: „Umowy i rozliczenia” → „Generuj dokument”.';
  }
  if (node.id.startsWith('employees:') && node.id.endsWith(':documents')) return 'Brak dokumentów pracownika.';
  if (node.id === 'employees') return 'Brak aktywnych pracowników.';
  return 'Ten folder jest pusty.';
}
