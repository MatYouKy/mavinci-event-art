'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarDays, ChevronDown, ChevronRight, Download, Eye, FolderInput, FolderOpen, FolderPlus, Home, LayoutGrid, List, Loader2,
  Pencil, RefreshCw, Search, Trash2, Upload, UploadCloud, X,
} from 'lucide-react';
import OverlayPortal from '@/components/UI/OverlayPortal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { useDialog } from '@/contexts/DialogContext';
import { supabase } from '@/lib/supabase/browser';
import {
  MATERIALS_MAX_BATCH, MATERIAL_KIND_LABELS, formatMaterialBytes, materialKind, type MaterialKind,
} from '@/lib/materials/materialsShared';
import {
  downloadMaterial, materialsGet, materialsPost, uploadMaterial, type EventFileHit, type MaterialBatchResult, type MaterialFile,
  type MaterialFolder, type MaterialItemRef, type MaterialsHome, type MaterialsListing, type MaterialsSearch, type UploadTarget,
} from './materialsApi';
import {
  ITEM_DRAG_TYPE, MaterialThumb, cardClass, dateLabel, dateTimeLabel, errorMessage, folderIcon, ghostButton, inputClass, isFileDrag,
  primaryButton, secondaryButton,
} from './materialsUi';
import { childrenOf, descendantIds, pathOf } from './materialsTree';
import MaterialsDetails from './MaterialsDetails';
import MaterialsFolderPicker from './MaterialsFolderPicker';
import MaterialsPreview, { type PreviewItem } from './MaterialsPreview';
import MaterialsTrash from './MaterialsTrash';

/*
 * Materiały — baza plików firmy w CRM (pełna szerokość): drzewo folderów marki, siatka / lista z miniaturami, podgląd zdjęć,
 * PDF-ów i wideo, przeciąganie plików i całych folderów z dysku, przenoszenie przeciąganiem, panel pliku (opis, tagi, wersje),
 * kosz na 30 dni i wyszukiwanie w Materiałach albo w plikach wydarzeń (z zapisem pliku wydarzenia w Materiałach).
 * Dane przez `/bridge/native/v1/materials` (to samo API dla Findera, Maca i telefonu w kolejnych etapach). Modal ładowania
 * przy akcjach, okno postępu przy wysyłce, snackbar po sukcesie lub błędzie.
 */

type View = 'grid' | 'list';
type Sort = 'name' | 'date' | 'size' | 'type';
type Scope = 'materials' | 'events';
type Notify = (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;

type UploadTask = {
  key: string;
  file: File;
  kind: MaterialKind;
  parentId: string | null;
  dirs: string[];
  replace?: { fileId: string; contentVersion: number };
};
type UploadRow = {
  key: string; name: string; size: number; loaded: number; place: string;
  status: 'waiting' | 'uploading' | 'done' | 'error' | 'cancelled'; error?: string;
};

const SORT_LABELS: Record<Sort, string> = { name: 'Nazwa', date: 'Data zmiany', size: 'Rozmiar', type: 'Rodzaj' };
const PURGE_KEY = 'mavinci.materials.purgeAt';
const VIEW_KEY = 'mavinci.materials.view';
const PURGE_EVERY_MS = 6 * 3600_000;
const fileKey = (id: string) => `f:${id}`;
const folderKey = (id: string) => `d:${id}`;

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Brak dostępu do pamięci przeglądarki — ustawienie tylko na tę wizytę.
  }
}

/** Pliki z przeciągnięcia: zwykłe pliki i całe foldery z dysku (z podfolderami), bez plików ukrytych. */
async function droppedFiles(entries: Array<FileSystemEntry | null>, plain: File[]) {
  if (!entries.some(Boolean)) return { files: plain.map((file) => ({ file, dirs: [] as string[] })), truncated: false };
  const files: Array<{ file: File; dirs: string[] }> = [];
  let truncated = false;
  const readFile = (entry: FileSystemFileEntry) => new Promise<File | null>((resolve) => entry.file(resolve, () => resolve(null)));
  const readAll = async (dir: FileSystemDirectoryEntry) => {
    const reader = dir.createReader();
    const all: FileSystemEntry[] = [];
    for (let i = 0; i < 100; i++) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
      if (!batch.length) break;
      all.push(...batch);
    }
    return all;
  };
  const walk = async (entry: FileSystemEntry, dirs: string[], depth: number): Promise<void> => {
    if (files.length >= MATERIALS_MAX_BATCH) {
      truncated = true;
      return;
    }
    if (entry.name.startsWith('.')) return;
    if (entry.isFile) {
      const file = await readFile(entry as FileSystemFileEntry);
      if (file) files.push({ file, dirs });
      return;
    }
    if (entry.isDirectory && depth < 10) {
      for (const child of await readAll(entry as FileSystemDirectoryEntry)) await walk(child, [...dirs, entry.name], depth + 1);
    }
  };
  for (const entry of entries) if (entry) await walk(entry, [], 0);
  return { files, truncated };
}

export default function MaterialsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const { showConfirm } = useDialog();
  const notify = useCallback<Notify>((message, type) => { if (message) showSnackbar(message, type); }, [showSnackbar]);

  const [companyId, setCompanyId] = useState<string | null>(() => searchParams?.get('company') || null);
  const [folderId, setFolderId] = useState<string | null>(() => searchParams?.get('folder') || null);
  const [home, setHome] = useState<MaterialsHome | null>(null);
  const [homeError, setHomeError] = useState('');
  const [listing, setListing] = useState<MaterialsListing | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [view, setView] = useState<View>('grid');
  const [sort, setSort] = useState<Sort>('name');
  const [mode, setMode] = useState<'browse' | 'trash'>('browse');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('materials');
  const [search, setSearch] = useState<MaterialsSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [preview, setPreview] = useState<{ items: PreviewItem[]; index: number } | null>(null);
  const [nameDialog, setNameDialog] = useState<{ title: string; label: string; initial: string; confirm: string; submit: (name: string) => Promise<boolean> } | null>(null);
  const [picker, setPicker] = useState<{ title: string; confirm: string; exclude: string[]; initial: string | null; pick: (id: string | null) => void } | null>(null);
  const [uploads, setUploads] = useState<{ rows: UploadRow[]; running: boolean } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const reloadTimer = useRef<number | null>(null);
  const listRequest = useRef(0);
  const homeRequest = useRef(0);
  const foldersRef = useRef<MaterialFolder[]>([]);

  const access = home?.access;
  const canManage = access?.manage === true;
  const folders = useMemo(() => home?.folders || [], [home]);
  foldersRef.current = folders;
  const searchActive = query.trim().length >= 2;

  useEffect(() => {
    const saved = readStorage(VIEW_KEY);
    if (saved === 'list' || saved === 'grid') setView(saved);
  }, []);

  const run = useCallback(async <T,>(title: string, action: () => Promise<T>, success?: string): Promise<T | null> => {
    showLoader(title, 'Proszę chwilę poczekać...');
    try {
      const result = await action();
      if (success) showSnackbar(success, 'success');
      return result;
    } catch (error) {
      showSnackbar(errorMessage(error, 'Operacja nie powiodła się.'), 'error');
      return null;
    } finally {
      hideLoader();
    }
  }, [hideLoader, showLoader, showSnackbar]);

  // MARK: Dane

  const loadHome = useCallback(async (silent = false) => {
    const request = ++homeRequest.current;
    try {
      const data = await materialsGet<MaterialsHome>('home', { company: companyId });
      if (request !== homeRequest.current) return data;
      // Marka z adresu bez dostępu → serwer podaje pierwszą dostępną.
      if (companyId && data.company.id !== companyId) setCompanyId(data.company.id);
      setHome(data);
      setHomeError('');
      if (!silent && data.access.manage) {
        const last = Number(readStorage(PURGE_KEY) || 0);
        if (Date.now() - last > PURGE_EVERY_MS) {
          writeStorage(PURGE_KEY, String(Date.now()));
          void materialsPost('purge').catch(() => undefined);
        }
      }
      return data;
    } catch (error) {
      if (!silent && request === homeRequest.current) setHomeError(errorMessage(error, 'Nie udało się pobrać Materiałów.'));
      return null;
    }
  }, [companyId]);

  const homeCompanyId = home?.company.id || null;

  const loadList = useCallback(async (silent = false) => {
    // Po zmianie marki lista czeka na dane nowej marki (folder z adresu należy do niej).
    if (!homeCompanyId || (companyId && homeCompanyId !== companyId)) return;
    const request = ++listRequest.current;
    if (!silent) setListLoading(true);
    try {
      const data = await materialsGet<MaterialsListing>('list', { company: homeCompanyId, folder: folderId, sort, limit: 500 });
      if (request === listRequest.current) setListing(data);
    } catch (error) {
      if (request !== listRequest.current) return;
      if ((error as { status?: number })?.status === 404 && folderId) {
        setFolderId(null);
        return;
      }
      if (!silent) showSnackbar(errorMessage(error, 'Nie udało się pobrać plików.'), 'error');
    } finally {
      if (request === listRequest.current) setListLoading(false);
    }
  }, [companyId, folderId, homeCompanyId, showSnackbar, sort]);

  useEffect(() => { void loadHome(); }, [loadHome]);
  useEffect(() => { void loadList(); }, [loadList]);

  const loadMore = async () => {
    if (!listing || !home) return;
    try {
      const data = await materialsGet<MaterialsListing>('list', {
        company: home.company.id, folder: folderId, sort, limit: 500, offset: listing.files.length,
      });
      setListing((current) => current && { ...current, files: [...current.files, ...data.files], total: data.total });
    } catch (error) {
      showSnackbar(errorMessage(error, 'Nie udało się pobrać plików.'), 'error');
    }
  };

  const refresh = useCallback(() => {
    void loadHome(true);
    void loadList(true);
  }, [loadHome, loadList]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Zmiany innych osób (Realtime z RLS) — odświeżenie listy i drzewa folderów (w trakcie wysyłki — po jej końcu).
  useEffect(() => {
    if (!homeCompanyId) return;
    const filter = `company_id=eq.${homeCompanyId}`;
    const schedule = () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => { if (!uploadAbort.current) refreshRef.current(); }, 700);
    };
    const channel = supabase.channel(`materials-${homeCompanyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_files', filter }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_folders', filter }, schedule)
      .subscribe();
    return () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [homeCompanyId]);

  // Plik upuszczony poza strefą wysyłki nie może otworzyć się w karcie zamiast CRM.
  useEffect(() => {
    const block = (event: globalThis.DragEvent) => {
      if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);

  // Adres strony: marka i folder (odnośnik do miejsca w Materiałach).
  useEffect(() => {
    if (!home) return;
    const params = new URLSearchParams();
    params.set('company', home.company.id);
    if (folderId) params.set('folder', folderId);
    const next = `/crm/materials?${params.toString()}`;
    if (typeof window !== 'undefined' && `${window.location.pathname}${window.location.search}` !== next) router.replace(next, { scroll: false });
  }, [folderId, home, router]);

  // Rozwinięta ścieżka bieżącego folderu w drzewie.
  useEffect(() => {
    if (!folderId) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const f of pathOf(folders, folderId)) next.add(f.id);
      return next;
    });
  }, [folderId, folders]);

  // Wyszukiwanie (z opóźnieniem po wpisaniu).
  useEffect(() => {
    if (!searchActive) {
      setSearch(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const data = await materialsGet<MaterialsSearch>('search', { q: query.trim(), scope });
        if (!cancelled) setSearch(data);
      } catch (error) {
        if (!cancelled) showSnackbar(errorMessage(error, 'Nie udało się wyszukać.'), 'error');
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, scope, searchActive, showSnackbar]);

  // MARK: Nawigacja i zaznaczenie

  const openFolder = useCallback((id: string | null) => {
    setMode('browse');
    setQuery('');
    if (id !== folderId) setListing(null);
    setFolderId(id);
    setSelection(new Set());
    setAnchor(null);
    setDetailsId(null);
  }, [folderId]);

  const switchCompany = (id: string) => {
    if (id === (home?.company.id || companyId)) return;
    setCompanyId(id);
    setFolderId(null);
    setListing(null);
    setSelection(new Set());
    setDetailsId(null);
    setMode('browse');
  };

  const files = useMemo(() => listing?.files || [], [listing]);
  const childFolders = useMemo(() => listing?.folders || [], [listing]);
  const orderedKeys = useMemo(() => [...childFolders.map((f) => folderKey(f.id)), ...files.map((f) => fileKey(f.id))], [childFolders, files]);
  const detailsFile = detailsId ? files.find((f) => f.id === detailsId) || null : null;

  const select = (key: string, event: ReactMouseEvent) => {
    if (event.shiftKey && anchor) {
      const a = orderedKeys.indexOf(anchor);
      const b = orderedKeys.indexOf(key);
      if (a >= 0 && b >= 0) {
        const range = orderedKeys.slice(Math.min(a, b), Math.max(a, b) + 1);
        setSelection((prev) => new Set([...(event.metaKey || event.ctrlKey ? Array.from(prev) : []), ...range]));
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      setSelection((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
    } else {
      setSelection(new Set([key]));
      setDetailsId(key.startsWith('f:') ? key.slice(2) : null);
    }
    setAnchor(key);
  };

  const selectedRefs = useCallback((): MaterialItemRef[] => {
    const refs: MaterialItemRef[] = [];
    for (const key of Array.from(selection)) {
      const id = key.slice(2);
      if (key.startsWith('d:')) {
        const folder = childFolders.find((f) => f.id === id);
        if (folder) refs.push({ kind: 'folder', id, name: folder.name });
      } else {
        const file = files.find((f) => f.id === id);
        if (file) refs.push({ kind: 'file', id, name: file.name });
      }
    }
    return refs;
  }, [childFolders, files, selection]);

  const previewFiles = useCallback((file: MaterialFile) => {
    const list: PreviewItem[] = files.map((f) => ({
      source: 'material', id: f.id, name: f.name, kind: f.kind, mime: f.mime, size: f.size, thumbnailUrl: f.thumbnailUrl,
    }));
    setPreview({ items: list, index: Math.max(0, files.findIndex((f) => f.id === file.id)) });
  }, [files]);

  // MARK: Akcje

  const createFolder = () => {
    if (!home) return;
    const parent = folderId;
    setNameDialog({
      title: 'Nowy folder', label: 'Nazwa folderu', initial: '', confirm: 'Utwórz',
      submit: async (name) => {
        const result = await run('Tworzę folder', () => materialsPost<{ item: MaterialFolder }>('createFolder', {
          companyId: home.company.id, parentId: parent, name,
        }), 'Utworzono folder');
        if (!result) return false;
        refresh();
        return true;
      },
    });
  };

  const renameItem = (ref: MaterialItemRef) => {
    setNameDialog({
      title: ref.kind === 'folder' ? 'Zmień nazwę folderu' : 'Zmień nazwę pliku',
      label: 'Nowa nazwa', initial: ref.name, confirm: 'Zapisz',
      submit: async (name) => {
        if (name === ref.name) return true;
        const result = await run('Zmieniam nazwę', () => materialsPost('rename', { kind: ref.kind, id: ref.id, name }), 'Zmieniono nazwę');
        if (!result) return false;
        refresh();
        return true;
      },
    });
  };

  const moveItems = (refs: MaterialItemRef[]) => {
    if (!home || !refs.length) return;
    setPicker({
      title: refs.length === 1 ? `Przenieś „${refs[0].name}”` : `Przenieś zaznaczone (${refs.length})`,
      confirm: 'Przenieś tutaj',
      exclude: refs.filter((r) => r.kind === 'folder').map((r) => r.id),
      initial: folderId,
      pick: (target) => {
        setPicker(null);
        void moveTo(refs, target);
      },
    });
  };

  const moveTo = async (refs: MaterialItemRef[], target: string | null) => {
    if (!home || !refs.length) return;
    const blocked = new Set<string>();
    for (const ref of refs) if (ref.kind === 'folder') for (const id of Array.from(descendantIds(folders, ref.id))) blocked.add(id);
    if (target && blocked.has(target)) {
      showSnackbar('Nie można przenieść folderu do niego samego ani do jego podfolderu.', 'warning');
      return;
    }
    const result = await run('Przenoszę', () => materialsPost<MaterialBatchResult>('move', { companyId: home.company.id, items: refs, targetFolderId: target }));
    if (!result) return;
    if (result.failed.length) {
      showSnackbar(`${result.moved ? `Przeniesiono: ${result.moved}. ` : ''}Nie przeniesiono: ${result.failed.map((f) => `${f.name} — ${f.error}`).join('; ')}`, 'warning');
    } else {
      showSnackbar(result.moved === 1 ? 'Przeniesiono' : `Przeniesiono: ${result.moved}`, 'success');
    }
    setSelection(new Set());
    setDetailsId(null);
    refresh();
  };

  const removeItems = async (refs: MaterialItemRef[]) => {
    if (!refs.length) return;
    const folderCount = refs.filter((r) => r.kind === 'folder').length;
    const ok = await showConfirm({
      title: refs.length === 1 ? `Usunąć „${refs[0].name}”?` : `Usunąć zaznaczone (${refs.length})?`,
      message: folderCount
        ? 'Elementy trafią do kosza na 30 dni — folder razem z całą zawartością. Do tego czasu można je przywrócić.'
        : 'Elementy trafią do kosza na 30 dni. Do tego czasu można je przywrócić.',
      confirmText: 'Przenieś do kosza',
    });
    if (!ok) return;
    const result = await run('Przenoszę do kosza', () => materialsPost<MaterialBatchResult>('remove', { items: refs }));
    if (!result) return;
    if (result.failed.length) {
      showSnackbar(`${result.removed ? `Usunięto: ${result.removed}. ` : ''}Nie usunięto: ${result.failed.map((f) => `${f.name} — ${f.error}`).join('; ')}`, 'warning');
    } else {
      showSnackbar(result.removed === 1 ? 'Przeniesiono do kosza' : `Przeniesiono do kosza: ${result.removed}`, 'success');
    }
    setSelection(new Set());
    setDetailsId(null);
    refresh();
  };

  // MARK: Wysyłka

  /** Folder docelowy dla pliku z przeciągniętego folderu (tworzy brakujące podfoldery, jak na dysku). */
  const ensureFolders = async (parentId: string | null, dirs: string[], cache: Map<string, string | null>) => {
    if (!home) return parentId;
    let current = parentId;
    for (let i = 0; i < dirs.length; i++) {
      const key = `${parentId || ''}/${dirs.slice(0, i + 1).join('/')}`;
      if (cache.has(key)) {
        current = cache.get(key) ?? null;
        continue;
      }
      const name = dirs[i].trim().slice(0, 255) || 'Folder';
      const find = () => foldersRef.current.find((f) => f.parentId === current && f.name.toLowerCase() === name.toLowerCase());
      let folder = find();
      if (!folder) {
        try {
          const created = await materialsPost<{ item: MaterialFolder }>('createFolder', { companyId: home.company.id, parentId: current, name });
          folder = created.item;
          foldersRef.current = [...foldersRef.current, created.item];
        } catch (error) {
          if ((error as { status?: number })?.status !== 409) throw error;
          const fresh = await loadHome(true);
          if (fresh) foldersRef.current = fresh.folders;
          folder = find();
          if (!folder) throw error;
        }
      }
      cache.set(key, folder.id);
      current = folder.id;
    }
    return current;
  };

  const startUploads = async (tasks: UploadTask[]) => {
    if (!home || !tasks.length || uploadAbort.current) return;
    const limit = home.maxBytes;
    const placeOf = (task: UploadTask) => {
      const base = pathOf(foldersRef.current, task.parentId).map((f) => f.name);
      return [home.company.name, ...base, ...task.dirs].join(' / ');
    };
    const rows: UploadRow[] = tasks.map((task) => ({
      key: task.key, name: task.file.name, size: task.file.size, loaded: 0, place: placeOf(task),
      status: task.file.size > limit ? 'error' : 'waiting',
      error: task.file.size > limit ? 'Plik jest większy niż 2 GB.' : undefined,
    }));
    const patch = (key: string, change: Partial<UploadRow>) =>
      setUploads((current) => current && { ...current, rows: current.rows.map((row) => (row.key === key ? { ...row, ...change } : row)) });
    setUploads({ rows, running: true });
    const controller = new AbortController();
    uploadAbort.current = controller;
    const cache = new Map<string, string | null>();
    let done = 0;
    let failed = rows.filter((row) => row.status === 'error').length;
    for (const task of tasks) {
      if (task.file.size > limit) continue;
      if (controller.signal.aborted) {
        patch(task.key, { status: 'cancelled' });
        continue;
      }
      patch(task.key, { status: 'uploading' });
      try {
        let target: UploadTarget;
        if (task.replace) {
          target = { replaceId: task.replace.fileId, baseContentVersion: task.replace.contentVersion };
        } else {
          const folder = await ensureFolders(task.parentId, task.dirs, cache);
          target = { companyId: home.company.id, folderId: folder };
        }
        let last = 0;
        await uploadMaterial(task.file, task.kind, target, (loaded) => {
          const now = Date.now();
          if (now - last > 150 || loaded >= task.file.size) {
            last = now;
            patch(task.key, { loaded });
          }
        }, controller.signal);
        patch(task.key, { status: 'done', loaded: task.file.size });
        done += 1;
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          patch(task.key, { status: 'cancelled' });
        } else {
          failed += 1;
          patch(task.key, { status: 'error', error: errorMessage(error, 'Nie udało się wysłać pliku.') });
        }
      }
    }
    uploadAbort.current = null;
    setUploads((current) => current && { ...current, running: false });
    refresh();
    if (controller.signal.aborted) {
      showSnackbar(done ? `Wysyłkę przerwano — wgrano: ${done}.` : 'Wysyłkę przerwano.', 'warning');
    } else if (failed) {
      showSnackbar(`Wgrano: ${done}. Nie udało się: ${failed} — szczegóły w oknie wysyłki.`, 'error');
    } else {
      showSnackbar(done === 1 ? (tasks[0].replace ? 'Podmieniono plik' : 'Wgrano plik') : `Wgrano pliki: ${done}`, 'success');
      setUploads(null);
    }
  };

  const uploadFiles = (list: Array<{ file: File; dirs: string[] }>, parentId: string | null, truncated = false) => {
    if (!canManage) {
      showSnackbar('Nie masz uprawnień do dodawania plików w Materiałach tej marki.', 'warning');
      return;
    }
    if (!list.length) return;
    if (truncated || list.length > MATERIALS_MAX_BATCH) {
      showSnackbar(`Naraz można wgrać najwyżej ${MATERIALS_MAX_BATCH} plików — wgrywam pierwsze ${MATERIALS_MAX_BATCH}.`, 'warning');
    }
    void startUploads(list.slice(0, MATERIALS_MAX_BATCH).map(({ file, dirs }, index) => ({
      key: `${Date.now()}-${index}`, file, kind: materialKind(file.type, file.name), parentId, dirs,
    })));
  };

  const replaceFile = (file: MaterialFile, input: File) => {
    void startUploads([{
      key: `${Date.now()}-replace`, file: input, kind: materialKind(input.type, input.name), parentId: file.folderId, dirs: [],
      replace: { fileId: file.id, contentVersion: file.contentVersion },
    }]);
  };

  const handleDrop = (event: DragEvent, target: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    if (isFileDrag(event)) {
      const entries = Array.from(event.dataTransfer.items || []).map((item) => (item.kind === 'file' ? item.webkitGetAsEntry?.() ?? null : null));
      const plain = Array.from(event.dataTransfer.files || []);
      void droppedFiles(entries, plain).then(({ files: list, truncated }) => uploadFiles(list, target, truncated));
      return;
    }
    const raw = event.dataTransfer.getData(ITEM_DRAG_TYPE);
    if (!raw || !canManage) return;
    try {
      const refs = (JSON.parse(raw) as MaterialItemRef[]).filter((ref) => ref.kind !== 'folder' || ref.id !== target);
      if (refs.length) void moveTo(refs, target);
    } catch {
      // Nieznane dane przeciągania — pomijamy.
    }
  };

  const dropProps = (target: string | null, key: string) => ({
    onDragOver: (event: DragEvent) => {
      const files = isFileDrag(event);
      const items = Array.from(event.dataTransfer.types || []).includes(ITEM_DRAG_TYPE);
      if (!files && !items) return;
      event.preventDefault();
      if (!canManage) {
        event.dataTransfer.dropEffect = 'none';
        return;
      }
      event.stopPropagation();
      event.dataTransfer.dropEffect = files ? 'copy' : 'move';
      if (dropTarget !== key) setDropTarget(key);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget((current) => (current === key ? null : current));
    },
    onDrop: (event: DragEvent) => handleDrop(event, target),
  });

  const dragStart = (event: DragEvent, ref: MaterialItemRef, key: string) => {
    if (!canManage) return;
    const refs = selection.has(key) ? selectedRefs() : [ref];
    event.dataTransfer.setData(ITEM_DRAG_TYPE, JSON.stringify(refs));
    event.dataTransfer.effectAllowed = 'move';
  };

  // MARK: Pliki wydarzeń

  const saveEventFile = (hit: EventFileHit) => {
    if (!home || !canManage) return;
    setPicker({
      title: `Zapisz „${hit.name}” w Materiałach`,
      confirm: 'Zapisz tutaj',
      exclude: [],
      initial: folderId ?? folders.find((f) => f.systemKey === (hit.kind === 'video' ? 'video' : 'photos'))?.id ?? null,
      pick: (target) => {
        setPicker(null);
        void (async () => {
          const result = await run('Zapisuję w Materiałach', () => materialsPost<{ file: MaterialFile; existing: boolean }>('copyFromEvent', {
            eventFileId: hit.id, companyId: home.company.id, folderId: target,
          }));
          if (!result) return;
          showSnackbar(result.existing ? 'Ten plik jest już w Materiałach tej marki.' : `Zapisano „${result.file.name}” w Materiałach`, result.existing ? 'info' : 'success');
          refresh();
        })();
      },
    });
  };

  // MARK: Klawiatura

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (preview || nameDialog || picker || uploads || mode !== 'browse' || searchActive) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && canManage && selection.size) {
        event.preventDefault();
        void removeItems(selectedRefs());
      } else if (event.key === 'Escape' && selection.size) {
        setSelection(new Set());
        setDetailsId(null);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelection(new Set(orderedKeys));
      } else if (event.key === 'Enter' && selection.size === 1) {
        const key = Array.from(selection)[0];
        if (key.startsWith('d:')) openFolder(key.slice(2));
        else {
          const file = files.find((f) => f.id === key.slice(2));
          if (file) previewFiles(file);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // MARK: Widok

  if (homeError && !home) {
    return (
      <main className="min-h-screen bg-[#0f1119] p-4 text-[#e5e4e2] md:p-6">
        <div className={`${cardClass} p-8 text-center`}>
          <p className="text-[#e5e4e2]/80">{homeError}</p>
          <button type="button" className={`${secondaryButton} mt-4`} onClick={() => void loadHome()}><RefreshCw className="h-4 w-4" />Spróbuj ponownie</button>
        </div>
      </main>
    );
  }

  if (!home) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0f1119] text-[#e5e4e2]/60">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#d3bb73]" />Ładowanie Materiałów…
      </main>
    );
  }

  const path = pathOf(folders, folderId);
  const selectedList = selectedRefs();
  const selectedFile = selectedList.length === 1 && selectedList[0].kind === 'file'
    ? files.find((f) => f.id === selectedList[0].id) || null
    : null;
  const selectedFolder = selectedList.length === 1 && selectedList[0].kind === 'folder'
    ? childFolders.find((f) => f.id === selectedList[0].id) || null
    : null;

  const renderTree = (parentId: string | null, depth: number): ReactElement[] =>
    childrenOf(folders, parentId).flatMap((folder) => {
      const Icon = folderIcon(folder.systemKey);
      const kids = childrenOf(folders, folder.id);
      const open = expanded.has(folder.id);
      const active = mode === 'browse' && !searchActive && folderId === folder.id;
      const key = `tree:${folder.id}`;
      const row = (
        <div key={folder.id} {...dropProps(folder.id, key)}
          className={`flex items-center rounded-lg ${dropTarget === key ? 'bg-[#d3bb73]/20 ring-1 ring-[#d3bb73]/50' : ''}`}
          style={{ paddingLeft: depth * 14 }}>
          <button type="button" aria-label={open ? 'Zwiń' : 'Rozwiń'} disabled={!kids.length}
            className="flex h-7 w-6 shrink-0 items-center justify-center text-[#e5e4e2]/40 hover:text-[#e5e4e2]"
            onClick={() => setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id);
              return next;
            })}>
            {kids.length ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
          </button>
          <button type="button" onClick={() => openFolder(folder.id)} title={folder.name}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
              active ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/75 hover:bg-[#e5e4e2]/5 hover:text-[#e5e4e2]'
            }`}>
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{folder.name}</span>
          </button>
        </div>
      );
      return open ? [row, ...renderTree(folder.id, depth + 1)] : [row];
    });

  const breadcrumb = (
    <nav className="flex min-w-0 flex-wrap items-center gap-1 text-sm" aria-label="Ścieżka folderu">
      <button type="button" {...dropProps(null, 'crumb:root')} onClick={() => openFolder(null)}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-[#e5e4e2]/5 ${dropTarget === 'crumb:root' ? 'bg-[#d3bb73]/20' : ''} ${path.length ? 'text-[#e5e4e2]/60' : 'text-[#e5e4e2]'}`}>
        <Home className="h-3.5 w-3.5" />{home.company.name}
      </button>
      {path.map((folder, index) => (
        <span key={folder.id} className="inline-flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-[#e5e4e2]/30" />
          <button type="button" {...dropProps(folder.id, `crumb:${folder.id}`)} onClick={() => openFolder(folder.id)}
            className={`rounded-md px-2 py-1 hover:bg-[#e5e4e2]/5 ${dropTarget === `crumb:${folder.id}` ? 'bg-[#d3bb73]/20' : ''} ${index === path.length - 1 ? 'text-[#e5e4e2]' : 'text-[#e5e4e2]/60'}`}>
            {folder.name}
          </button>
        </span>
      ))}
    </nav>
  );

  const folderTile = (folder: MaterialFolder) => {
    const key = folderKey(folder.id);
    const Icon = folderIcon(folder.systemKey);
    const selected = selection.has(key);
    return (
      <div key={key} role="button" tabIndex={0} draggable={canManage && !folder.systemKey}
        {...dropProps(folder.id, `tile:${folder.id}`)}
        onDragStart={(event) => dragStart(event, { kind: 'folder', id: folder.id, name: folder.name }, key)}
        onClick={(event) => select(key, event)}
        onDoubleClick={() => openFolder(folder.id)}
        className={`group flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 transition-colors ${
          dropTarget === `tile:${folder.id}` ? 'border-[#d3bb73] bg-[#d3bb73]/20'
            : selected ? 'border-[#d3bb73]/60 bg-[#d3bb73]/10' : 'border-[#d3bb73]/10 bg-[#1c1f33] hover:border-[#d3bb73]/30'
        }`}>
        <Icon className="h-6 w-6 shrink-0 text-[#d3bb73]/80" />
        <span className="min-w-0 flex-1 truncate text-sm">{folder.name}</span>
      </div>
    );
  };

  const fileTile = (file: MaterialFile) => {
    const key = fileKey(file.id);
    const selected = selection.has(key);
    return (
      <div key={key} role="button" tabIndex={0} draggable={canManage}
        onDragStart={(event) => dragStart(event, { kind: 'file', id: file.id, name: file.name }, key)}
        onClick={(event) => select(key, event)}
        onDoubleClick={() => previewFiles(file)}
        className={`group flex cursor-pointer flex-col overflow-hidden rounded-xl border transition-colors ${
          selected ? 'border-[#d3bb73]/70 ring-1 ring-[#d3bb73]/40' : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/30'
        } bg-[#1c1f33]`}>
        <MaterialThumb url={file.thumbnailUrl} kind={file.kind} name={file.name} className="aspect-square w-full" />
        <div className="space-y-0.5 px-2.5 py-2">
          <p className="truncate text-xs text-[#e5e4e2]" title={file.name}>{file.name}</p>
          <p className="truncate text-[11px] text-[#e5e4e2]/40">{formatMaterialBytes(file.size)} · {dateLabel(file.updatedAt)}</p>
        </div>
      </div>
    );
  };

  const listRows = (
    <div className={`${cardClass} overflow-hidden`}>
      <table className="w-full text-sm">
        <thead className="border-b border-[#d3bb73]/10 text-left text-xs uppercase tracking-wide text-[#e5e4e2]/40">
          <tr>
            <th className="px-3 py-2">Nazwa</th>
            <th className="hidden px-3 py-2 md:table-cell">Rodzaj</th>
            <th className="hidden px-3 py-2 sm:table-cell">Rozmiar</th>
            <th className="hidden px-3 py-2 lg:table-cell">Zmieniono</th>
          </tr>
        </thead>
        <tbody>
          {childFolders.map((folder) => {
            const key = folderKey(folder.id);
            const Icon = folderIcon(folder.systemKey);
            return (
              <tr key={key} draggable={canManage && !folder.systemKey} {...dropProps(folder.id, `row:${folder.id}`)}
                onDragStart={(event) => dragStart(event, { kind: 'folder', id: folder.id, name: folder.name }, key)}
                onClick={(event) => select(key, event)} onDoubleClick={() => openFolder(folder.id)}
                className={`cursor-pointer border-b border-[#d3bb73]/5 ${dropTarget === `row:${folder.id}` ? 'bg-[#d3bb73]/20' : selection.has(key) ? 'bg-[#d3bb73]/10' : 'hover:bg-[#e5e4e2]/[0.03]'}`}>
                <td className="px-3 py-2"><span className="flex items-center gap-3"><Icon className="h-5 w-5 shrink-0 text-[#d3bb73]/80" /><span className="truncate">{folder.name}</span></span></td>
                <td className="hidden px-3 py-2 text-[#e5e4e2]/50 md:table-cell">Folder</td>
                <td className="hidden px-3 py-2 text-[#e5e4e2]/50 sm:table-cell">—</td>
                <td className="hidden px-3 py-2 text-[#e5e4e2]/50 lg:table-cell">{dateLabel(folder.updatedAt)}</td>
              </tr>
            );
          })}
          {files.map((file) => {
            const key = fileKey(file.id);
            return (
              <tr key={key} draggable={canManage}
                onDragStart={(event) => dragStart(event, { kind: 'file', id: file.id, name: file.name }, key)}
                onClick={(event) => select(key, event)} onDoubleClick={() => previewFiles(file)}
                className={`cursor-pointer border-b border-[#d3bb73]/5 last:border-0 ${selection.has(key) ? 'bg-[#d3bb73]/10' : 'hover:bg-[#e5e4e2]/[0.03]'}`}>
                <td className="px-3 py-1.5">
                  <span className="flex min-w-0 items-center gap-3">
                    <MaterialThumb url={file.thumbnailUrl} kind={file.kind} name={file.name} className="h-9 w-9 shrink-0 rounded-md" />
                    <span className="truncate">{file.name}</span>
                  </span>
                </td>
                <td className="hidden px-3 py-1.5 text-[#e5e4e2]/50 md:table-cell">{MATERIAL_KIND_LABELS[file.kind]}</td>
                <td className="hidden px-3 py-1.5 text-[#e5e4e2]/50 sm:table-cell">{formatMaterialBytes(file.size)}</td>
                <td className="hidden px-3 py-1.5 text-[#e5e4e2]/50 lg:table-cell">{dateTimeLabel(file.updatedAt)}{file.updatedBy ? ` · ${file.updatedBy}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const emptyFolder = !listLoading && listing && !childFolders.length && !files.length;

  const browseContent = (
    <div {...dropProps(folderId, 'main')} className={`relative min-h-[60vh] rounded-xl ${dropTarget === 'main' ? 'ring-2 ring-[#d3bb73]/60' : ''}`}
      onClick={(event) => { if (event.target === event.currentTarget) { setSelection(new Set()); setDetailsId(null); } }}>
      {listLoading && !listing ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>
      ) : emptyFolder ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center text-sm text-[#e5e4e2]/50">
          <UploadCloud className="h-10 w-10 text-[#d3bb73]/50" />
          <p>{canManage ? 'Ten folder jest pusty. Przeciągnij tu pliki albo całe foldery z dysku.' : 'Ten folder jest pusty.'}</p>
        </div>
      ) : view === 'grid' ? (
        <div className="space-y-4" onClick={(event) => { if (event.target === event.currentTarget) { setSelection(new Set()); setDetailsId(null); } }}>
          {!!childFolders.length && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">{childFolders.map(folderTile)}</div>
          )}
          {!!files.length && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">{files.map(fileTile)}</div>
          )}
        </div>
      ) : listRows}
      {listing && listing.files.length < listing.total && (
        <div className="mt-4 flex justify-center">
          <button type="button" className={secondaryButton} onClick={() => void loadMore()}>
            Wczytaj więcej ({listing.total - listing.files.length})
          </button>
        </div>
      )}
      {dropTarget === 'main' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-[#0f1119]/70">
          <p className="rounded-lg bg-[#1c1f33] px-4 py-3 text-sm text-[#d3bb73]">Upuść, aby dodać do: {path.length ? path[path.length - 1].name : home.company.name}</p>
        </div>
      )}
    </div>
  );

  const searchContent = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] p-0.5 text-sm">
          {([['materials', 'Materiały'], ...(home.eventsAccess ? [['events', 'Pliki wydarzeń']] : [])] as Array<[Scope, string]>).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setScope(value)}
              className={`rounded-md px-3 py-1.5 ${scope === value ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/70 hover:text-[#e5e4e2]'}`}>{label}</button>
          ))}
        </div>
        {searching && <Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" />}
        <p className="text-xs text-[#e5e4e2]/40">
          {scope === 'materials' ? 'Wszystkie marki z dostępem · nazwa, opis i tagi' : 'Wydarzenia, które widzisz w CRM · nazwa pliku, wydarzenia i folderu'}
        </p>
      </div>
      {scope === 'materials' && search?.scope === 'materials' && (
        search.materials.length ? (
          <div className={`${cardClass} divide-y divide-[#d3bb73]/5 overflow-hidden`}>
            {search.materials.map((hit, index) => (
              <div key={hit.id} className="flex items-center gap-3 px-3 py-2 hover:bg-[#e5e4e2]/[0.03]">
                <MaterialThumb url={hit.thumbnailUrl} kind={hit.kind} name={hit.name} className="h-11 w-11 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{hit.name}</p>
                  <p className="truncate text-xs text-[#e5e4e2]/40">
                    {[hit.companyName, ...hit.path.map((p) => p.name)].join(' / ')} · {formatMaterialBytes(hit.size)}{hit.tags.length ? ` · ${hit.tags.join(', ')}` : ''}
                  </p>
                </div>
                <button type="button" className={ghostButton} title="Podgląd"
                  onClick={() => setPreview({
                    items: search.materials.map((h) => ({ source: 'material', id: h.id, name: h.name, kind: h.kind, mime: h.mime, size: h.size, thumbnailUrl: h.thumbnailUrl, subtitle: h.companyName })),
                    index,
                  })}><Eye className="h-4 w-4" /></button>
                <button type="button" className={ghostButton} title="Pobierz"
                  onClick={() => void downloadMaterial('material', hit.id).catch((error) => showSnackbar(errorMessage(error, 'Nie udało się pobrać pliku.'), 'error'))}>
                  <Download className="h-4 w-4" />
                </button>
                <button type="button" className={secondaryButton}
                  onClick={() => {
                    if (hit.companyId !== home.company.id) switchCompany(hit.companyId);
                    openFolder(hit.folderId);
                    setSelection(new Set([fileKey(hit.id)]));
                    setDetailsId(hit.id);
                  }}>
                  <FolderOpen className="h-4 w-4" />Pokaż w folderze
                </button>
              </div>
            ))}
          </div>
        ) : !searching && <div className={`${cardClass} py-16 text-center text-sm text-[#e5e4e2]/50`}>Nic nie znaleziono w Materiałach.</div>
      )}
      {scope === 'events' && search?.scope === 'events' && (
        search.events.length ? (
          <div className={`${cardClass} divide-y divide-[#d3bb73]/5 overflow-hidden`}>
            {search.events.map((hit, index) => (
              <div key={hit.id} className="flex items-center gap-3 px-3 py-2 hover:bg-[#e5e4e2]/[0.03]">
                <MaterialThumb url={hit.thumbnailUrl} kind={hit.kind} name={hit.name} className="h-11 w-11 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{hit.name}</p>
                  <p className="truncate text-xs text-[#e5e4e2]/40">
                    {hit.eventName}{hit.eventDate ? ` (${dateLabel(hit.eventDate)})` : ''}{hit.folderName ? ` / ${hit.folderName}` : ''} · {formatMaterialBytes(hit.size)}
                  </p>
                </div>
                <button type="button" className={ghostButton} title="Podgląd"
                  onClick={() => setPreview({
                    items: search.events.map((h) => ({ source: 'event', id: h.id, name: h.name, kind: h.kind, mime: h.mime, size: h.size, thumbnailUrl: h.thumbnailUrl, subtitle: h.eventName })),
                    index,
                  })}><Eye className="h-4 w-4" /></button>
                <button type="button" className={ghostButton} title="Pobierz"
                  onClick={() => void downloadMaterial('event', hit.id).catch((error) => showSnackbar(errorMessage(error, 'Nie udało się pobrać pliku.'), 'error'))}>
                  <Download className="h-4 w-4" />
                </button>
                <Link href={`/crm/events/${hit.eventId}?tab=files`} className={ghostButton} title="Otwórz wydarzenie"><CalendarDays className="h-4 w-4" /></Link>
                {canManage && (
                  <button type="button" className={secondaryButton} onClick={() => saveEventFile(hit)}>
                    <FolderInput className="h-4 w-4" />Zapisz w Materiałach
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : !searching && <div className={`${cardClass} py-16 text-center text-sm text-[#e5e4e2]/50`}>Nic nie znaleziono w plikach wydarzeń.</div>
      )}
    </div>
  );

  return (
    <main className="flex min-h-screen flex-col bg-[#0f1119] p-4 text-[#e5e4e2] md:p-6">
      <header className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-light md:text-3xl">Materiały</h1>
          <p className="mt-1 max-w-3xl text-sm text-[#e5e4e2]/50">
            Logotypy, zdjęcia, wideo, prezentacje i dokumenty marki w jednym miejscu. Wyszukiwanie obejmuje też pliki wydarzeń.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {home.companies.length > 1 && (
            <select value={home.company.id} onChange={(event) => switchCompany(event.target.value)} aria-label="Marka"
              className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm">
              {home.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/30" />
            <input value={query} onChange={(event) => { setQuery(event.target.value); if (mode === 'trash') setMode('browse'); }}
              placeholder="Szukaj plików…" aria-label="Szukaj plików"
              className={`${inputClass} w-64 pl-9 pr-8`} />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Wyczyść wyszukiwanie"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#e5e4e2]/40 hover:text-[#e5e4e2]"><X className="h-4 w-4" /></button>
            )}
          </div>
          {canManage && (
            <>
              <button type="button" className={secondaryButton} onClick={createFolder} disabled={mode !== 'browse' || searchActive}>
                <FolderPlus className="h-4 w-4" />Nowy folder
              </button>
              <label className={`${primaryButton} cursor-pointer ${mode !== 'browse' || searchActive ? 'pointer-events-none opacity-40' : ''}`}>
                <Upload className="h-4 w-4" />Wgraj pliki
                <input type="file" multiple className="hidden"
                  onChange={(event) => {
                    const list = Array.from(event.target.files || []).map((file) => ({ file, dirs: [] as string[] }));
                    event.target.value = '';
                    uploadFiles(list, folderId);
                  }} />
              </label>
              <button type="button" onClick={() => { setQuery(''); setMode(mode === 'trash' ? 'browse' : 'trash'); setSelection(new Set()); setDetailsId(null); }}
                className={mode === 'trash' ? primaryButton : secondaryButton}>
                <Trash2 className="h-4 w-4" />Kosz{home.trashCount ? ` (${home.trashCount})` : ''}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className={`${cardClass} sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto p-2`}>
            <button type="button" {...dropProps(null, 'tree:root')} onClick={() => openFolder(null)}
              className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                dropTarget === 'tree:root' ? 'bg-[#d3bb73]/20' : mode === 'browse' && !searchActive && !folderId ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/80 hover:bg-[#e5e4e2]/5'
              }`}>
              <Home className="h-4 w-4" /><span className="truncate">{home.company.name}</span>
            </button>
            {renderTree(null, 0)}
          </div>
        </aside>

        <section className="min-w-0 flex-1 space-y-3">
          {mode === 'trash' ? (
            <>
              <div className="flex items-center gap-2">
                <button type="button" className={ghostButton} onClick={() => setMode('browse')}><ChevronRight className="h-4 w-4 rotate-180" />Wróć do plików</button>
                <h2 className="text-lg font-light">Kosz — {home.company.name}</h2>
              </div>
              <MaterialsTrash companyId={home.company.id} run={run} notify={notify}
                onChanged={refresh}
                onPreview={(items, index) => setPreview({ items, index })} />
            </>
          ) : searchActive ? searchContent : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">{breadcrumb}</div>
                <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Sortowanie"
                  className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-2 py-1.5 text-sm">
                  {(Object.keys(SORT_LABELS) as Sort[]).map((value) => <option key={value} value={value}>{SORT_LABELS[value]}</option>)}
                </select>
                <div className="inline-flex rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] p-0.5">
                  {([['grid', LayoutGrid, 'Siatka'], ['list', List, 'Lista']] as const).map(([value, Icon, label]) => (
                    <button key={value} type="button" title={label} aria-label={label}
                      onClick={() => { setView(value); writeStorage(VIEW_KEY, value); }}
                      className={`rounded-md p-1.5 ${view === value ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
                <button type="button" className={ghostButton} onClick={refresh} title="Odśwież"><RefreshCw className="h-4 w-4" /></button>
              </div>

              {selection.size > 0 && (
                <div className={`${cardClass} flex flex-wrap items-center gap-2 px-3 py-2 text-sm`}>
                  <span className="mr-auto text-[#e5e4e2]/70">Zaznaczono: {selection.size}</span>
                  {selectedFolder && (
                    <button type="button" className={ghostButton} onClick={() => openFolder(selectedFolder.id)}><FolderOpen className="h-4 w-4" />Otwórz</button>
                  )}
                  {selectedFile && (
                    <>
                      <button type="button" className={ghostButton} onClick={() => previewFiles(selectedFile)}><Eye className="h-4 w-4" />Podgląd</button>
                      <button type="button" className={ghostButton}
                        onClick={() => void downloadMaterial('material', selectedFile.id).catch((error) => showSnackbar(errorMessage(error, 'Nie udało się pobrać pliku.'), 'error'))}>
                        <Download className="h-4 w-4" />Pobierz
                      </button>
                    </>
                  )}
                  {canManage && selectedList.length === 1 && (selectedFolder || selectedFile) && (
                    <button type="button" className={ghostButton} onClick={() => renameItem(selectedList[0])}><Pencil className="h-4 w-4" />Zmień nazwę</button>
                  )}
                  {canManage && !selectedList.some((ref) => ref.kind === 'folder' && childFolders.find((f) => f.id === ref.id)?.systemKey) && (
                    <>
                      <button type="button" className={ghostButton} onClick={() => moveItems(selectedList)}><FolderInput className="h-4 w-4" />Przenieś</button>
                      <button type="button" className={ghostButton} onClick={() => void removeItems(selectedList)}><Trash2 className="h-4 w-4 text-red-300" />Usuń</button>
                    </>
                  )}
                  <button type="button" className={ghostButton} onClick={() => { setSelection(new Set()); setDetailsId(null); }}><X className="h-4 w-4" />Wyczyść</button>
                </div>
              )}
              {browseContent}
            </>
          )}
        </section>

        {mode === 'browse' && !searchActive && detailsFile && (
          <div className="sticky top-4 hidden max-h-[calc(100vh-2rem)] w-[360px] shrink-0 overflow-hidden rounded-xl xl:block">
            <MaterialsDetails file={detailsFile} canManage={canManage} notify={notify}
              onClose={() => setDetailsId(null)}
              onPreview={() => previewFiles(detailsFile)}
              onRename={() => renameItem({ kind: 'file', id: detailsFile.id, name: detailsFile.name })}
              onMove={() => moveItems([{ kind: 'file', id: detailsFile.id, name: detailsFile.name }])}
              onDelete={() => void removeItems([{ kind: 'file', id: detailsFile.id, name: detailsFile.name }])}
              onReplace={(input) => replaceFile(detailsFile, input)}
              onUpdated={(updated) => setListing((current) => current && { ...current, files: current.files.map((f) => (f.id === updated.id ? updated : f)) })} />
          </div>
        )}
      </div>

      {preview && (
        <MaterialsPreview items={preview.items} index={preview.index}
          onIndex={(index) => setPreview((current) => current && { ...current, index })}
          onClose={() => setPreview(null)}
          onError={(message) => showSnackbar(message, 'error')} />
      )}
      {nameDialog && <NameDialog {...nameDialog} onClose={() => setNameDialog(null)} />}
      {picker && (
        <MaterialsFolderPicker title={picker.title} confirmText={picker.confirm} companyName={home.company.name} folders={folders}
          initialFolderId={picker.initial} excludeIds={picker.exclude} onPick={picker.pick} onClose={() => setPicker(null)} />
      )}
      {uploads && (
        <UploadDialog rows={uploads.rows} running={uploads.running}
          onCancel={() => uploadAbort.current?.abort()}
          onClose={() => setUploads(null)} />
      )}
    </main>
  );
}

function NameDialog({ title, label, initial, confirm, submit, onClose }: {
  title: string; label: string; initial: string; confirm: string; submit: (name: string) => Promise<boolean>; onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.focus();
    const dot = initial.lastIndexOf('.');
    element.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const ok = !!name && name !== '.' && name !== '..' && name.length <= 255;

  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    const closed = await submit(name);
    setBusy(false);
    if (closed) onClose();
  };

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title}
        onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
        <form className="w-full max-w-md space-y-4 rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-5 text-[#e5e4e2] shadow-2xl"
          onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <h2 className="text-lg font-light">{title}</h2>
          <label className="block space-y-1 text-sm">
            <span className="text-[#e5e4e2]/60">{label}</span>
            <input ref={input} className={inputClass} value={value} maxLength={255} onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose(); }} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>Anuluj</button>
            <button type="submit" className={primaryButton} disabled={!ok || busy}>{confirm}</button>
          </div>
        </form>
      </div>
    </OverlayPortal>
  );
}

function UploadDialog({ rows, running, onCancel, onClose }: {
  rows: UploadRow[]; running: boolean; onCancel: () => void; onClose: () => void;
}) {
  const total = rows.reduce((sum, row) => sum + (row.status === 'error' && !row.loaded ? 0 : row.size), 0);
  const loaded = rows.reduce((sum, row) => sum + (row.status === 'done' ? row.size : row.loaded), 0);
  const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  const finished = rows.filter((row) => row.status === 'done').length;
  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Wysyłanie plików">
        <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] text-[#e5e4e2] shadow-2xl">
          <div className="space-y-2 border-b border-[#d3bb73]/10 px-5 py-4">
            <div className="flex items-center gap-2">
              {running ? <Loader2 className="h-5 w-5 animate-spin text-[#d3bb73]" /> : <UploadCloud className="h-5 w-5 text-[#d3bb73]" />}
              <h2 className="text-lg font-light">{running ? 'Wysyłam pliki' : 'Wysyłka zakończona'}</h2>
              <span className="ml-auto text-sm text-[#e5e4e2]/60">{finished} z {rows.length}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#0f1119]">
              <div className="h-full rounded-full bg-[#d3bb73] transition-all" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-xs text-[#e5e4e2]/40">{formatMaterialBytes(loaded)} z {formatMaterialBytes(total)} · nie zamykaj tej karty do końca wysyłki</p>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-[#d3bb73]/5 overflow-y-auto">
            {rows.map((row) => (
              <li key={row.key} className="px-5 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={row.name}>{row.name}</span>
                  <span className={`shrink-0 text-xs ${
                    row.status === 'done' ? 'text-emerald-300' : row.status === 'error' ? 'text-red-300' : row.status === 'cancelled' ? 'text-[#e5e4e2]/40' : 'text-[#e5e4e2]/60'
                  }`}>
                    {row.status === 'done' ? 'Gotowe' : row.status === 'error' ? 'Błąd' : row.status === 'cancelled' ? 'Anulowano'
                      : row.status === 'uploading' ? `${row.size ? Math.round((row.loaded / row.size) * 100) : 0}%` : 'Czeka'}
                  </span>
                </div>
                <p className="truncate text-xs text-[#e5e4e2]/40">{row.error || `${formatMaterialBytes(row.size)} · ${row.place}`}</p>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 border-t border-[#d3bb73]/10 px-5 py-4">
            {running
              ? <button type="button" className={secondaryButton} onClick={onCancel}>Anuluj wysyłkę</button>
              : <button type="button" className={primaryButton} onClick={onClose}>Zamknij</button>}
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}
