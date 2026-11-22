import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Linking, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { UNSTABLE_usePreventRemove as usePreventRemove, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../theme';
import {
  MATERIALS_MAX_BATCH, MATERIALS_TRASH_DAYS, MATERIAL_KIND_LABELS, formatMaterialBytes, formatMaterialDuration, materialKind,
} from '../lib/materialsShared';
import {
  MaterialPhotosPermissionError, materialDescendants, materialFolderOrder, materialPath, materialUrl, materialsErrorMessage, materialsErrorStatus,
  materialsGet, materialsPost, pickMaterialDocuments, pickMaterialMedia, saveMaterialToPhotos, shareMaterial, uploadMaterial,
  type EventFileHit, type MaterialAlbum, type MaterialBatchResult, type MaterialFile, type MaterialFolder, type MaterialItemRef, type MaterialsHome,
  type MaterialsListing, type MaterialsSearch, type MaterialTrashItem, type PickedMaterial,
} from '../lib/materialsApi';
import ChatVideoPreview from '../components/ChatVideoPreview';
import DriveBrandStrip from '../components/DriveBrandStrip';
import { useContentWidth } from '../hooks/useTabletLayout';
import { openPdf } from '../lib/driveApi';

/*
 * Materiały w aplikacji (jak `/crm/materials`, Mac i Finder): marki z dostępem, foldery (domyślne foldery marki), pliki
 * z miniaturami, podgląd zdjęć, filmów i PDF-ów, udostępnianie i zapis w Zdjęciach, wyszukiwanie w Materiałach i w plikach
 * wydarzeń („Zapisz w Materiałach”). Z „Materiały — zarządzanie”: wgrywanie z aparatu, galerii i Plików (z postępem),
 * nowy folder, zmiana nazwy, przenoszenie, kosz na 30 dni (przywracanie, usuwanie na zawsze).
 * Albumy (główna baza zdjęć): przeglądanie, „Dodaj do albumu” (odnośnik, bez kopii), nowy album, usunięcie z albumu, okładka,
 * zmiana nazwy i usunięcie albumu. Kolejność plików w albumie ustawia się przeciąganiem w CRM i na Macu.
 */

type Entry = { type: 'folder'; folder: MaterialFolder } | { type: 'file'; file: MaterialFile } | { type: 'album'; album: MaterialAlbum };
type UploadRow = { key: string; name: string; size: number; sent: number; status: 'waiting' | 'uploading' | 'done' | 'error'; error?: string };
type NameDialog = { title: string; confirm: string; initial: string; submit: (name: string) => Promise<void> };
type FolderPicker = { title: string; confirm: string; exclude: Set<string>; initial: string | null; pick: (id: string | null) => void };

const FOLDER_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  brand: 'award', photos: 'image', video: 'film', presentations: 'layers', documents: 'file-text', social: 'share-2',
};
const KIND_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  image: 'image', video: 'film', audio: 'music', pdf: 'file-text', document: 'file-text', spreadsheet: 'grid', presentation: 'monitor',
  design: 'pen-tool', archive: 'archive', font: 'type', other: 'file',
};

const dateLabel = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export default function MaterialsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  // Szerokość treści (na tablecie w poziomie — obok paska bocznego).
  const width = useContentWidth();
  const columns = width >= 1000 ? 6 : width >= 700 ? 4 : 3;
  const tile = Math.floor((width - spacing.md * 2 - spacing.sm * (columns - 1)) / columns);

  const [companyId, setCompanyId] = useState<string | null>(route.params?.company || null);
  const [folderId, setFolderId] = useState<string | null>(route.params?.folder || null);
  const [home, setHome] = useState<MaterialsHome | null>(null);
  const [listing, setListing] = useState<MaterialsListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'materials' | 'events'>('materials');
  const [search, setSearch] = useState<MaterialsSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [trashMode, setTrashMode] = useState(false);
  const [trash, setTrash] = useState<MaterialTrashItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<Entry | null>(null);
  const [uploadMenu, setUploadMenu] = useState(false);
  const [uploads, setUploads] = useState<{ rows: UploadRow[]; running: boolean } | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [picker, setPicker] = useState<FolderPicker | null>(null);
  const [pickerChoice, setPickerChoice] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [albumsMode, setAlbumsMode] = useState(false);
  const [albums, setAlbums] = useState<MaterialAlbum[]>([]);
  const [openAlbum, setOpenAlbum] = useState<{ album: MaterialAlbum; files: MaterialFile[] } | null>(null);
  const [albumPick, setAlbumPick] = useState<string[] | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const homeRequest = useRef(0);
  const listRequest = useRef(0);

  const canManage = home?.access.manage === true;
  const folders = useMemo(() => home?.folders || [], [home]);
  const searchActive = query.trim().length >= 2;

  // MARK: Dane

  const loadHome = useCallback(async () => {
    const request = ++homeRequest.current;
    try {
      const data = await materialsGet<MaterialsHome>('home', { company: companyId });
      if (request !== homeRequest.current) return;
      if (companyId !== data.company.id) setCompanyId(data.company.id);
      setHome(data);
      setError('');
    } catch (cause) {
      if (request === homeRequest.current) setError(materialsErrorMessage(cause, 'Nie udało się pobrać Materiałów.'));
    } finally {
      if (request === homeRequest.current) setLoading(false);
    }
  }, [companyId]);

  const homeCompany = home?.company.id || null;

  const loadList = useCallback(async () => {
    if (!homeCompany || (companyId && companyId !== homeCompany)) return;
    const request = ++listRequest.current;
    try {
      const data = await materialsGet<MaterialsListing>('list', { company: homeCompany, folder: folderId, sort: 'name', limit: 500 });
      if (request === listRequest.current) setListing(data);
    } catch (cause) {
      if (request !== listRequest.current) return;
      if (materialsErrorStatus(cause) === 404 && folderId) { setFolderId(null); return; }
      Alert.alert('Materiały', materialsErrorMessage(cause, 'Nie udało się pobrać plików.'));
    } finally {
      if (request === listRequest.current) setRefreshing(false);
    }
  }, [companyId, folderId, homeCompany]);

  const loadTrash = useCallback(async () => {
    if (!homeCompany) return;
    try {
      const data = await materialsGet<{ items: MaterialTrashItem[] }>('trash', { company: homeCompany });
      setTrash(data.items);
    } catch (cause) {
      Alert.alert('Kosz', materialsErrorMessage(cause, 'Nie udało się pobrać kosza.'));
    } finally {
      setRefreshing(false);
    }
  }, [homeCompany]);

  // Albumy marki (bez migracji albumów na serwerze — pusta lista) i otwarty album.
  const loadAlbums = useCallback(async () => {
    if (!homeCompany) return;
    try {
      const data = await materialsGet<{ albums: MaterialAlbum[] }>('albums', { company: homeCompany });
      setAlbums(data.albums);
    } catch {
      setAlbums([]);
    } finally {
      setRefreshing(false);
    }
  }, [homeCompany]);

  const loadAlbum = useCallback(async (id: string) => {
    try {
      const data = await materialsGet<{ album: MaterialAlbum; files: MaterialFile[] }>('album', { id });
      setOpenAlbum({ album: data.album, files: data.files });
    } catch (cause) {
      if (materialsErrorStatus(cause) === 404) setOpenAlbum(null);
      else Alert.alert('Album', materialsErrorMessage(cause, 'Nie udało się otworzyć albumu.'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadHome(); }, [loadHome]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (trashMode) void loadTrash(); }, [trashMode, loadTrash]);
  useEffect(() => { setOpenAlbum(null); void loadAlbums(); }, [loadAlbums]);

  const refresh = useCallback(async () => {
    await loadHome();
    await loadList();
    if (trashMode) await loadTrash();
    await loadAlbums();
    if (openAlbum) await loadAlbum(openAlbum.album.id);
  }, [loadHome, loadList, loadTrash, trashMode, loadAlbums, loadAlbum, openAlbum]);

  // Wyszukiwanie z opóźnieniem po wpisaniu.
  useEffect(() => {
    if (!searchActive) { setSearch(null); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await materialsGet<MaterialsSearch>('search', { q: query.trim(), scope });
        if (!cancelled) setSearch(data);
      } catch (cause) {
        if (!cancelled) Alert.alert('Szukaj', materialsErrorMessage(cause, 'Nie udało się wyszukać.'));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, scope, searchActive]);

  // Wstecz (gest, przycisk): z kosza do folderów, z albumu do albumów, z podfolderu — folder wyżej. `usePreventRemove` zamiast
  // `beforeRemove`: native-stack wtedy sam blokuje gest i przycisk systemowy (zamiast usunąć ekran natywnie — błąd „removed
  // natively but didn't get removed from JS state”), a wstecz trafia tutaj. Menu (pasek boczny tabletu) zawsze wychodzi.
  const nested = trashMode || (!searchActive && (Boolean(openAlbum) || albumsMode || Boolean(folderId)));
  usePreventRemove(nested, ({ data }) => {
    if (data.action.type !== 'GO_BACK' && data.action.type !== 'POP') { navigation.dispatch(data.action); return; }
    if (trashMode) { setTrashMode(false); return; }
    if (openAlbum && !searchActive) { setOpenAlbum(null); return; }
    if (albumsMode && !searchActive) { setAlbumsMode(false); return; }
    if (folderId && !searchActive) setFolderId(folders.find((f) => f.id === folderId)?.parentId ?? null);
  });

  // MARK: Nawigacja

  const openFolder = (id: string | null) => {
    setTrashMode(false);
    setAlbumsMode(false);
    setOpenAlbum(null);
    setQuery('');
    if (id !== folderId) setListing(null);
    setFolderId(id);
  };

  const switchCompany = (id: string) => {
    if (id === homeCompany) return;
    setCompanyId(id);
    setFolderId(null);
    setListing(null);
    setTrashMode(false);
  };

  const path = useMemo(() => materialPath(folders, folderId), [folders, folderId]);
  const entries = useMemo<Entry[]>(() => {
    if (albumsMode) {
      if (openAlbum) return openAlbum.files.map((file) => ({ type: 'file' as const, file }));
      return albums.map((album) => ({ type: 'album' as const, album }));
    }
    return [
      ...[...(listing?.folders || [])].sort(materialFolderOrder).map((folder) => ({ type: 'folder' as const, folder })),
      ...(listing?.files || []).map((file) => ({ type: 'file' as const, file })),
    ];
  }, [listing, albumsMode, openAlbum, albums]);

  // MARK: Czynności

  const run = async <T,>(title: string, action: () => Promise<T>, success?: string): Promise<T | null> => {
    setBusy(title);
    try {
      const result = await action();
      if (success) Alert.alert('Materiały', success);
      return result;
    } catch (cause) {
      Alert.alert('Materiały', materialsErrorMessage(cause, 'Operacja nie powiodła się.'));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const preview = async (file: { id: string; name: string; mime: string }, kind: 'material' | 'event' = 'material') => {
    const fileKind = materialKind(file.mime, file.name);
    setBusy('Otwieram');
    try {
      const { url } = await materialUrl(kind, file.id);
      if (fileKind === 'image') setPhoto({ url, name: file.name });
      else if (fileKind === 'video') setVideo(url);
      else if (fileKind === 'pdf') openPdf(navigation, url, file.name);
      else await Linking.openURL(url);
    } catch (cause) {
      Alert.alert('Podgląd', materialsErrorMessage(cause, 'Nie udało się otworzyć pliku.'));
    } finally {
      setBusy(null);
    }
  };

  const createFolder = () => {
    if (!homeCompany) return;
    const parent = folderId;
    setNameValue('');
    setNameDialog({
      title: 'Nowy folder', confirm: 'Utwórz', initial: '',
      submit: async (name) => {
        if (await run('Tworzę folder', () => materialsPost('createFolder', { companyId: homeCompany, parentId: parent, name }))) await refresh();
      },
    });
  };

  // MARK: Albumy

  const createAlbum = (fileIds: string[]) => {
    if (!homeCompany) return;
    setNameValue('');
    setNameDialog({
      title: fileIds.length ? 'Nowy album z pliku' : 'Nowy album', confirm: 'Utwórz', initial: '',
      submit: async (name) => {
        const result = await run('Tworzę album', () => materialsPost<{ album: MaterialAlbum; added: number }>('createAlbum', { companyId: homeCompany, name, fileIds }));
        if (!result) return;
        Alert.alert('Album', result.added ? `Utworzono album „${result.album.name}” — plik został na swoim miejscu.` : `Utworzono album „${result.album.name}”.`);
        await loadAlbums();
      },
    });
  };

  const addToAlbum = async (album: MaterialAlbum, fileIds: string[]) => {
    setAlbumPick(null);
    const result = await run('Dodaję do albumu', () => materialsPost<{ added: number; skipped: number }>('albumAdd', { id: album.id, fileIds }));
    if (!result) return;
    Alert.alert('Album', result.added ? `Dodano do albumu „${album.name}” — bez kopiowania pliku.` : `Album „${album.name}” ma już ten plik.`);
    await loadAlbums();
  };

  const removeFromAlbum = async (file: MaterialFile) => {
    if (!openAlbum) return;
    if (await run('Usuwam z albumu', () => materialsPost('albumRemove', { id: openAlbum.album.id, fileIds: [file.id] }), 'Usunięto z albumu — plik został w Materiałach.')) {
      await loadAlbum(openAlbum.album.id);
      await loadAlbums();
    }
  };

  const setAlbumCover = async (file: MaterialFile) => {
    if (!openAlbum) return;
    if (await run('Ustawiam okładkę', () => materialsPost('updateAlbum', { id: openAlbum.album.id, coverFileId: file.id }), 'Ustawiono okładkę albumu.')) {
      await loadAlbum(openAlbum.album.id);
      await loadAlbums();
    }
  };

  const renameAlbum = (album: MaterialAlbum) => {
    setNameValue(album.name);
    setNameDialog({
      title: 'Zmień nazwę albumu', confirm: 'Zapisz', initial: album.name,
      submit: async (name) => {
        if (name === album.name) return;
        if (await run('Zapisuję album', () => materialsPost('updateAlbum', { id: album.id, name }))) {
          await loadAlbums();
          if (openAlbum?.album.id === album.id) await loadAlbum(album.id);
        }
      },
    });
  };

  const deleteAlbum = (album: MaterialAlbum) => {
    Alert.alert(`Usunąć album „${album.name}”?`, 'Pliki zostaną w Materiałach — usuwamy tylko album.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń album', style: 'destructive',
        onPress: () => {
          void (async () => {
            if (await run('Usuwam album', () => materialsPost('deleteAlbum', { id: album.id }), 'Usunięto album.')) {
              if (openAlbum?.album.id === album.id) setOpenAlbum(null);
              await loadAlbums();
            }
          })();
        },
      },
    ]);
  };

  const rename = (ref: MaterialItemRef) => {
    setNameValue(ref.name);
    setNameDialog({
      title: ref.kind === 'folder' ? 'Zmień nazwę folderu' : 'Zmień nazwę pliku', confirm: 'Zapisz', initial: ref.name,
      submit: async (name) => {
        if (name === ref.name) return;
        if (await run('Zmieniam nazwę', () => materialsPost('rename', { kind: ref.kind, id: ref.id, name }))) await refresh();
      },
    });
  };

  const openPicker = (next: FolderPicker) => {
    setPickerChoice(next.initial);
    setPicker(next);
  };

  const move = (ref: MaterialItemRef) => {
    if (!homeCompany) return;
    openPicker({
      title: `Przenieś „${ref.name}”`, confirm: 'Przenieś tutaj', initial: folderId,
      exclude: ref.kind === 'folder' ? materialDescendants(folders, ref.id) : new Set(),
      pick: (target) => {
        void (async () => {
          const result = await run('Przenoszę', () => materialsPost<MaterialBatchResult>('move', { companyId: homeCompany, items: [ref], targetFolderId: target }));
          if (result?.failed.length) Alert.alert('Nie przeniesiono', result.failed.map((f) => `${f.name} — ${f.error}`).join('\n'));
          await refresh();
        })();
      },
    });
  };

  const remove = (ref: MaterialItemRef) => {
    Alert.alert(`Usunąć „${ref.name}”?`,
      ref.kind === 'folder'
        ? `Folder razem z zawartością trafi do kosza na ${MATERIALS_TRASH_DAYS} dni — do tego czasu można go przywrócić.`
        : `Plik trafi do kosza na ${MATERIALS_TRASH_DAYS} dni — do tego czasu można go przywrócić.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Przenieś do kosza', style: 'destructive',
          onPress: () => {
            void (async () => {
              const result = await run('Przenoszę do kosza', () => materialsPost<MaterialBatchResult>('remove', { items: [ref] }));
              if (result?.failed.length) Alert.alert('Nie usunięto', result.failed.map((f) => `${f.name} — ${f.error}`).join('\n'));
              await refresh();
            })();
          },
        },
      ]);
  };

  const saveEventFile = (hit: EventFileHit) => {
    if (!homeCompany) return;
    openPicker({
      title: `Zapisz „${hit.name}” w Materiałach`, confirm: 'Zapisz tutaj', exclude: new Set(),
      initial: folderId ?? folders.find((f) => f.systemKey === (hit.kind === 'video' ? 'video' : 'photos'))?.id ?? null,
      pick: (target) => {
        void (async () => {
          const result = await run('Zapisuję w Materiałach', () => materialsPost<{ file: MaterialFile; existing: boolean }>('copyFromEvent', {
            eventFileId: hit.id, companyId: homeCompany, folderId: target,
          }));
          if (result) Alert.alert('Materiały', result.existing ? 'Ten plik jest już w Materiałach tej marki.' : `Zapisano „${result.file.name}” w Materiałach.`);
          await refresh();
        })();
      },
    });
  };

  const share = async (file: MaterialFile) => {
    setBusy('Przygotowuję plik');
    try {
      await shareMaterial(file);
    } catch (cause) {
      Alert.alert('Udostępnij', materialsErrorMessage(cause, 'Nie udało się udostępnić pliku.'));
    } finally {
      setBusy(null);
    }
  };

  const toPhotos = async (file: MaterialFile) => {
    setBusy('Zapisuję w Zdjęciach');
    try {
      await saveMaterialToPhotos(file);
      Alert.alert('Zdjęcia', 'Zapisano w Zdjęciach.');
    } catch (cause) {
      Alert.alert('Zdjęcia', cause instanceof MaterialPhotosPermissionError
        ? 'Zezwól aplikacji na dodawanie zdjęć w ustawieniach telefonu.'
        : materialsErrorMessage(cause, 'Nie udało się zapisać w Zdjęciach.'));
    } finally {
      setBusy(null);
    }
  };

  // MARK: Wgrywanie

  const startUploads = async (files: PickedMaterial[]) => {
    if (!homeCompany || !home || !files.length) return;
    let list = files;
    if (list.length > MATERIALS_MAX_BATCH) {
      Alert.alert('Materiały', `Naraz można wgrać najwyżej ${MATERIALS_MAX_BATCH} plików — wgrywam pierwsze ${MATERIALS_MAX_BATCH}.`);
      list = list.slice(0, MATERIALS_MAX_BATCH);
    }
    const target = { companyId: homeCompany, folderId };
    const rows: UploadRow[] = list.map((file, index) => ({
      key: `${Date.now()}-${index}`, name: file.name, size: file.size, sent: 0,
      status: file.size > home.maxBytes ? 'error' : 'waiting', error: file.size > home.maxBytes ? 'Plik jest większy niż 2 GB.' : undefined,
    }));
    const patch = (key: string, change: Partial<UploadRow>) =>
      setUploads((current) => current && { ...current, rows: current.rows.map((row) => (row.key === key ? { ...row, ...change } : row)) });
    setUploads({ rows, running: true });
    let done = 0;
    let failed = rows.filter((row) => row.status === 'error').length;
    for (const [index, file] of list.entries()) {
      const row = rows[index];
      if (row.status === 'error') continue;
      patch(row.key, { status: 'uploading' });
      try {
        let last = 0;
        await uploadMaterial(file, target, (sent) => {
          const now = Date.now();
          if (now - last > 200) { last = now; patch(row.key, { sent }); }
        });
        patch(row.key, { status: 'done', sent: file.size });
        done += 1;
      } catch (cause) {
        failed += 1;
        patch(row.key, { status: 'error', error: materialsErrorMessage(cause, 'Nie udało się wysłać pliku.') });
      }
    }
    setUploads((current) => current && { ...current, running: false });
    await refresh();
    if (!failed) {
      setUploads(null);
      Alert.alert('Materiały', done === 1 ? 'Wgrano plik.' : `Wgrano pliki: ${done}.`);
    }
  };

  const pickAndUpload = async (source: 'camera' | 'library' | 'files') => {
    setUploadMenu(false);
    try {
      const files = source === 'files' ? await pickMaterialDocuments() : await pickMaterialMedia(source);
      await startUploads(files);
    } catch (cause) {
      Alert.alert('Materiały', materialsErrorMessage(cause, 'Nie udało się wybrać plików.'));
    }
  };

  // MARK: Kosz

  const restore = async (item: MaterialTrashItem) => {
    if (await run('Przywracam', () => materialsPost('restore', { ids: [item.id] }), `Przywrócono „${item.name}”.`)) await refresh();
  };

  const deleteForever = (item: MaterialTrashItem) => {
    Alert.alert(`Usunąć „${item.name}” na zawsze?`, 'Tego nie można cofnąć.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń na zawsze', style: 'destructive',
        onPress: () => { void (async () => { if (await run('Usuwam', () => materialsPost('deleteForever', { ids: [item.id] }))) await refresh(); })(); },
      },
    ]);
  };

  const emptyTrash = () => {
    if (!homeCompany) return;
    Alert.alert('Opróżnić kosz?', 'Wszystkie elementy z kosza tej marki znikną na zawsze.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Opróżnij', style: 'destructive',
        onPress: () => { void (async () => { if (await run('Opróżniam kosz', () => materialsPost('deleteForever', { companyId: homeCompany, all: true }))) await refresh(); })(); },
      },
    ]);
  };

  /** Krótki komunikat na dole ekranu (np. skopiowany kolor z księgi znaku); błąd zostaje dłużej. */
  const notify = (text: string, isError = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, error: isError });
    toastTimer.current = setTimeout(() => setToast(null), isError ? 5000 : 2500);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // MARK: Widok

  if (loading && !home) return <View style={styles.center}><ActivityIndicator color={colors.primary.gold} size="large" /></View>;
  if (error && !home) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{error}</Text>
        <TouchableOpacity style={[styles.secondary, { marginTop: spacing.md, paddingHorizontal: spacing.lg }]} onPress={() => { setLoading(true); void loadHome(); }}>
          <Text style={styles.secondaryText}>Spróbuj ponownie</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const folderIcon = (folder: MaterialFolder) => (folder.systemKey && FOLDER_ICONS[folder.systemKey]) || 'folder';

  const header = (
    <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
      {(home?.companies.length || 0) > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {home!.companies.map((company) => (
            <TouchableOpacity key={company.id} onPress={() => switchCompany(company.id)} style={[styles.chip, company.id === homeCompany && styles.chipActive]}>
              <Text style={[styles.chipText, company.id === homeCompany && { color: colors.primary.gold }]}>{company.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      <View style={styles.searchRow}>
        <Feather name="search" size={16} color={colors.text.tertiary} />
        <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder={scope === 'events' ? 'Szukaj w plikach eventów' : 'Szukaj w Materiałach'}
          placeholderTextColor={colors.text.tertiary} returnKeyType="search" />
        {searching ? <ActivityIndicator size="small" color={colors.primary.gold} /> : !!query && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="x-circle" size={16} color={colors.text.tertiary} /></TouchableOpacity>
        )}
      </View>
      {home?.eventsAccess && searchActive && (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {(['materials', 'events'] as const).map((value) => (
            <TouchableOpacity key={value} onPress={() => setScope(value)} style={[styles.chip, scope === value && styles.chipActive]}>
              <Text style={[styles.chipText, scope === value && { color: colors.primary.gold }]}>{value === 'materials' ? 'Materiały' : 'Pliki eventów'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {!searchActive && !trashMode && (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity onPress={() => { setAlbumsMode(false); setOpenAlbum(null); }} style={[styles.chip, !albumsMode && styles.chipActive]}>
            <Text style={[styles.chipText, !albumsMode && { color: colors.primary.gold }]}>Foldery</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setAlbumsMode(true); setOpenAlbum(null); }} style={[styles.chip, albumsMode && styles.chipActive]}>
            <Text style={[styles.chipText, albumsMode && { color: colors.primary.gold }]}>{albums.length ? `Albumy (${albums.length})` : 'Albumy'}</Text>
          </TouchableOpacity>
        </View>
      )}
      {!searchActive && !trashMode && !albumsMode && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: 4 }}>
          <TouchableOpacity onPress={() => openFolder(null)}><Text style={styles.crumb}>{home?.company.name}</Text></TouchableOpacity>
          {path.map((folder) => (
            <View key={folder.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Feather name="chevron-right" size={12} color={colors.text.tertiary} />
              <TouchableOpacity onPress={() => openFolder(folder.id)}><Text style={styles.crumb}>{folder.name}</Text></TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
      {/* „Logotypy i księga znaku” — logotypy, fonty i kolory z księgi znaku marki (jak w CRM i na Macu). */}
      {!searchActive && !trashMode && !albumsMode && homeCompany && listing?.folder?.systemKey === 'brand'
        ? <DriveBrandStrip companyId={homeCompany} onPhoto={setPhoto} onMessage={notify} />
        : null}
      {!searchActive && !trashMode && albumsMode && (
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <TouchableOpacity onPress={() => setOpenAlbum(null)}><Text style={styles.crumb}>Albumy</Text></TouchableOpacity>
            {openAlbum && (
              <>
                <Feather name="chevron-right" size={12} color={colors.text.tertiary} />
                <Text style={[styles.crumb, { flexShrink: 1 }]} numberOfLines={1}>{openAlbum.album.name}</Text>
              </>
            )}
          </View>
          <Text style={styles.muted}>
            {openAlbum ? `${openAlbum.album.count} pl. · odnośniki do Materiałów, bez kopii${openAlbum.album.description ? ` · ${openAlbum.album.description}` : ''}`
              : 'Album zbiera pliki z różnych folderów bez kopiowania.'}
          </Text>
          {canManage && (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {openAlbum ? (
                <>
                  <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => renameAlbum(openAlbum.album)}>
                    <Feather name="edit-2" size={16} color={colors.primary.gold} />
                    <Text style={styles.secondaryText}>Zmień nazwę</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.secondary, { paddingHorizontal: spacing.md }]} onPress={() => deleteAlbum(openAlbum.album)}>
                    <Feather name="trash-2" size={16} color={colors.status.error} />
                    <Text style={[styles.secondaryText, { color: colors.status.error }]}>Usuń album</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={[styles.primary, { flex: 1 }]} onPress={() => createAlbum([])}>
                  <Feather name="plus" size={16} color={colors.background.primary} />
                  <Text style={styles.primaryText}>Nowy album</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}
      {canManage && !searchActive && !albumsMode && (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {trashMode ? (
            <>
              <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => setTrashMode(false)}>
                <Feather name="arrow-left" size={16} color={colors.primary.gold} />
                <Text style={styles.secondaryText}>Wróć do folderów</Text>
              </TouchableOpacity>
              {trash.length > 0 && (
                <TouchableOpacity style={[styles.secondary, { paddingHorizontal: spacing.md }]} onPress={emptyTrash}>
                  <Feather name="trash" size={16} color={colors.status.error} />
                  <Text style={[styles.secondaryText, { color: colors.status.error }]}>Opróżnij</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <>
              <TouchableOpacity style={[styles.primary, { flex: 1 }]} onPress={() => setUploadMenu(true)} disabled={uploads?.running}>
                <Feather name="upload" size={16} color={colors.background.primary} />
                <Text style={styles.primaryText}>Wgraj</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondary, { paddingHorizontal: spacing.md }]} onPress={createFolder}>
                <Feather name="folder-plus" size={16} color={colors.primary.gold} />
                <Text style={styles.secondaryText}>Folder</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondary, { paddingHorizontal: spacing.md }]} onPress={() => setTrashMode(true)}>
                <Feather name="trash-2" size={16} color={colors.primary.gold} />
                <Text style={styles.secondaryText}>{home?.trashCount ? `Kosz (${home.trashCount})` : 'Kosz'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );

  const renderEntry = ({ item }: { item: Entry }) => {
    if (item.type === 'album') {
      const album = item.album;
      return (
        <TouchableOpacity style={[styles.tile, { width: tile }]} onPress={() => { setOpenAlbum({ album, files: [] }); void loadAlbum(album.id); }}
          onLongPress={() => { if (canManage) setMenu(item); }}>
          <View style={[styles.tileThumb, { width: tile - 12, height: tile - 12 }]}>
            {album.coverUrl
              ? <Image source={{ uri: album.coverUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              : <Feather name="layers" size={Math.min(40, tile / 3)} color={colors.primary.gold} />}
          </View>
          <Text style={styles.tileName} numberOfLines={2}>{album.name}</Text>
          <Text style={styles.tileMeta}>{album.count} pl.</Text>
        </TouchableOpacity>
      );
    }
    if (item.type === 'folder') {
      const folder = item.folder;
      return (
        <TouchableOpacity style={[styles.tile, { width: tile }]} onPress={() => openFolder(folder.id)} onLongPress={() => setMenu(item)}>
          <View style={[styles.tileThumb, { width: tile - 12, height: tile - 12 }]}>
            <Feather name={folderIcon(folder)} size={Math.min(40, tile / 3)} color={colors.primary.gold} />
          </View>
          <Text style={styles.tileName} numberOfLines={2}>{folder.name}</Text>
        </TouchableOpacity>
      );
    }
    const file = item.file;
    return (
      <TouchableOpacity style={[styles.tile, { width: tile }]} onPress={() => { void preview(file); }} onLongPress={() => setMenu(item)}>
        <View style={[styles.tileThumb, { width: tile - 12, height: tile - 12 }]}>
          {file.thumbnailUrl
            ? <Image source={{ uri: file.thumbnailUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            : <Feather name={KIND_ICONS[file.kind] || 'file'} size={Math.min(36, tile / 3)} color={colors.text.tertiary} />}
          {file.kind === 'video' && file.duration != null && (
            <View style={styles.duration}><Text style={styles.durationText}>{formatMaterialDuration(file.duration)}</Text></View>
          )}
        </View>
        <Text style={styles.tileName} numberOfLines={2}>{file.name}</Text>
        <Text style={styles.tileMeta}>{formatMaterialBytes(file.size)}</Text>
      </TouchableOpacity>
    );
  };

  const body = () => {
    if (searchActive) {
      if (!search) return <ActivityIndicator style={{ marginTop: spacing.lg }} color={colors.primary.gold} />;
      if (scope === 'events') {
        if (!search.events.length) return <Text style={[styles.muted, { padding: spacing.md }]}>Nic nie znaleziono.</Text>;
        return search.events.map((hit) => (
          <View key={hit.id} style={styles.row}>
            <TouchableOpacity style={{ flexDirection: 'row', flex: 1, gap: spacing.sm, alignItems: 'center' }} onPress={() => { void preview(hit, 'event'); }}>
              {hit.thumbnailUrl ? <Image source={{ uri: hit.thumbnailUrl }} style={styles.rowThumb} /> : (
                <View style={[styles.rowThumb, styles.placeholder]}><Feather name={KIND_ICONS[hit.kind] || 'file'} size={18} color={colors.text.tertiary} /></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.body} numberOfLines={1}>{hit.name}</Text>
                <Text style={styles.muted} numberOfLines={1}>{[hit.eventName, dateLabel(hit.eventDate), hit.folderName, formatMaterialBytes(hit.size)].filter(Boolean).join(' · ')}</Text>
              </View>
            </TouchableOpacity>
            {canManage && (
              <TouchableOpacity style={styles.rowAction} onPress={() => saveEventFile(hit)} accessibilityLabel="Zapisz w Materiałach">
                <Feather name="download" size={18} color={colors.primary.gold} />
              </TouchableOpacity>
            )}
          </View>
        ));
      }
      if (!search.materials.length) return <Text style={[styles.muted, { padding: spacing.md }]}>Nic nie znaleziono.</Text>;
      return search.materials.map((hit) => (
        <TouchableOpacity key={hit.id} style={styles.row} onPress={() => { void preview(hit); }}
          onLongPress={() => { if (hit.companyId !== homeCompany) switchCompany(hit.companyId); openFolder(hit.folderId); }}>
          {hit.thumbnailUrl ? <Image source={{ uri: hit.thumbnailUrl }} style={styles.rowThumb} /> : (
            <View style={[styles.rowThumb, styles.placeholder]}><Feather name={KIND_ICONS[hit.kind] || 'file'} size={18} color={colors.text.tertiary} /></View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.body} numberOfLines={1}>{hit.name}</Text>
            <Text style={styles.muted} numberOfLines={1}>{[hit.companyName, ...hit.path.map((p) => p.name)].join(' / ')} · {formatMaterialBytes(hit.size)}</Text>
          </View>
        </TouchableOpacity>
      ));
    }
    if (trashMode) {
      const items = trash.filter((item) => !item.insideFolder);
      if (!items.length) return <Text style={[styles.muted, { padding: spacing.md }]}>Kosz jest pusty. Usunięte elementy czekają tu {MATERIALS_TRASH_DAYS} dni.</Text>;
      return items.map((item) => (
        <View key={item.id} style={styles.row}>
          {item.kind === 'folder'
            ? <View style={[styles.rowThumb, styles.placeholder]}><Feather name="folder" size={18} color={colors.primary.gold} /></View>
            : item.thumbnailUrl ? <Image source={{ uri: item.thumbnailUrl }} style={styles.rowThumb} />
              : <View style={[styles.rowThumb, styles.placeholder]}><Feather name={KIND_ICONS[item.fileKind] || 'file'} size={18} color={colors.text.tertiary} /></View>}
          <View style={{ flex: 1 }}>
            <Text style={styles.body} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.muted} numberOfLines={2}>
              {[item.kind === 'folder' ? `folder${item.contains ? ` · ${item.contains} el.` : ''}` : formatMaterialBytes(item.size),
                item.location === '' ? 'główny folder marki' : item.location, `usunięto ${dateLabel(item.deletedAt)}`, item.deletedBy].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <TouchableOpacity style={styles.rowAction} onPress={() => { void restore(item); }} accessibilityLabel="Przywróć">
            <Feather name="rotate-ccw" size={18} color={colors.primary.gold} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.rowAction} onPress={() => deleteForever(item)} accessibilityLabel="Usuń na zawsze">
            <Feather name="x" size={18} color={colors.status.error} />
          </TouchableOpacity>
        </View>
      ));
    }
    return null;
  };

  const special = searchActive || trashMode;
  const menuFile = menu?.type === 'file' ? menu.file : null;
  const menuFolder = menu?.type === 'folder' ? menu.folder : null;
  const menuAlbum = menu?.type === 'album' ? menu.album : null;
  const pickerRows = (() => {
    const rows: Array<{ folder: MaterialFolder; level: number }> = [];
    const visit = (parent: string | null, level: number) => {
      for (const folder of folders.filter((f) => f.parentId === parent).sort(materialFolderOrder)) {
        rows.push({ folder, level });
        visit(folder.id, level + 1);
      }
    };
    visit(null, 1);
    return rows;
  })();

  return (
    <View style={styles.container}>
      <FlatList
        key={special ? 'list' : `grid-${columns}`}
        data={special ? [] : entries}
        keyExtractor={(item) => (item.type === 'folder' ? `d:${item.folder.id}` : item.type === 'album' ? `a:${item.album.id}` : `f:${item.file.id}`)}
        renderItem={renderEntry}
        numColumns={special ? 1 : columns}
        columnWrapperStyle={special ? undefined : { gap: spacing.sm }}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary.gold} onRefresh={() => { setRefreshing(true); void refresh(); }} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListFooterComponent={special ? <View style={{ gap: spacing.sm }}>{body()}</View> : null}
        ListEmptyComponent={special ? null : albumsMode
          ? <Text style={[styles.muted, { padding: spacing.md }]}>
              {openAlbum ? (canManage ? 'Album jest pusty — przytrzymaj plik w folderze i wybierz „Dodaj do albumu”.' : 'Album jest pusty.')
                : (canManage ? 'Ta marka nie ma albumów — utwórz pierwszy album.' : 'Ta marka nie ma albumów.')}
            </Text>
          : listing
            ? <Text style={[styles.muted, { padding: spacing.md }]}>{canManage ? 'Ten folder jest pusty — wgraj zdjęcia, filmy albo pliki.' : 'Ten folder jest pusty.'}</Text>
            : <ActivityIndicator style={{ marginTop: spacing.lg }} color={colors.primary.gold} />}
      />

      {/* Czynności elementu (przytrzymanie) */}
      <Modal visible={menu !== null} transparent animationType="fade" onRequestClose={() => setMenu(null)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setMenu(null)}>
          <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
            <Text style={styles.sheetTitle} numberOfLines={2}>{menuFile?.name || menuFolder?.name || menuAlbum?.name}</Text>
            {menuAlbum && canManage && (
              <>
                <SheetButton icon="edit-2" label="Zmień nazwę albumu" onPress={() => { setMenu(null); renameAlbum(menuAlbum); }} />
                <SheetButton icon="trash-2" label="Usuń album (pliki zostaną)" danger onPress={() => { setMenu(null); deleteAlbum(menuAlbum); }} />
              </>
            )}
            {menuFile && (
              <Text style={styles.muted}>
                {[MATERIAL_KIND_LABELS[menuFile.kind], formatMaterialBytes(menuFile.size), menuFile.width && menuFile.height ? `${menuFile.width} × ${menuFile.height}` : '',
                  dateLabel(menuFile.updatedAt), menuFile.updatedBy].filter(Boolean).join(' · ')}
              </Text>
            )}
            {!!menuFile?.description && <Text style={styles.body}>{menuFile.description}</Text>}
            {menuFolder && <SheetButton icon="folder" label="Otwórz" onPress={() => { setMenu(null); openFolder(menuFolder.id); }} />}
            {menuFile && <SheetButton icon="eye" label="Podgląd" onPress={() => { setMenu(null); void preview(menuFile); }} />}
            {menuFile && <SheetButton icon="share" label="Udostępnij" onPress={() => { setMenu(null); void share(menuFile); }} />}
            {menuFile && (menuFile.kind === 'image' || menuFile.kind === 'video') && (
              <SheetButton icon="download" label="Zapisz w Zdjęciach" onPress={() => { setMenu(null); void toPhotos(menuFile); }} />
            )}
            {menuFile && openAlbum && albumsMode && (
              <SheetButton icon="folder" label="Pokaż w folderze" onPress={() => {
                setMenu(null);
                if (menuFile.companyId !== homeCompany) switchCompany(menuFile.companyId);
                openFolder(menuFile.folderId);
              }} />
            )}
            {canManage && menuFile && openAlbum && albumsMode && (
              <>
                {menuFile.kind === 'image' && <SheetButton icon="image" label="Okładka albumu" onPress={() => { setMenu(null); void setAlbumCover(menuFile); }} />}
                <SheetButton icon="minus-circle" label="Usuń z albumu (plik zostanie)" danger onPress={() => { setMenu(null); void removeFromAlbum(menuFile); }} />
              </>
            )}
            {canManage && menuFile && !albumsMode && (
              <SheetButton icon="layers" label="Dodaj do albumu" onPress={() => { setMenu(null); setAlbumPick([menuFile.id]); }} />
            )}
            {canManage && menu && !menuAlbum && !(albumsMode && openAlbum) && (
              <>
                <SheetButton icon="edit-2" label="Zmień nazwę" onPress={() => {
                  setMenu(null);
                  rename(menuFile ? { kind: 'file', id: menuFile.id, name: menuFile.name } : { kind: 'folder', id: menuFolder!.id, name: menuFolder!.name });
                }} />
                {(menuFile || (menuFolder && !menuFolder.systemKey)) && (
                  <>
                    <SheetButton icon="corner-up-right" label="Przenieś" onPress={() => {
                      setMenu(null);
                      move(menuFile ? { kind: 'file', id: menuFile.id, name: menuFile.name } : { kind: 'folder', id: menuFolder!.id, name: menuFolder!.name });
                    }} />
                    <SheetButton icon="trash-2" label="Usuń" danger onPress={() => {
                      setMenu(null);
                      remove(menuFile ? { kind: 'file', id: menuFile.id, name: menuFile.name } : { kind: 'folder', id: menuFolder!.id, name: menuFolder!.name });
                    }} />
                  </>
                )}
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Dodaj do albumu: wybór albumu albo nowy album */}
      <Modal visible={albumPick !== null} transparent animationType="fade" onRequestClose={() => setAlbumPick(null)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setAlbumPick(null)}>
          <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
            <Text style={styles.sheetTitle}>Dodaj do albumu</Text>
            <Text style={styles.muted}>Album trzyma odnośnik — plik zostaje w swoim folderze.</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {albums.map((album) => (
                <SheetButton key={album.id} icon="layers" label={`${album.name} (${album.count})`} onPress={() => { void addToAlbum(album, albumPick || []); }} />
              ))}
            </ScrollView>
            <SheetButton icon="plus" label="Nowy album…" onPress={() => { const ids = albumPick || []; setAlbumPick(null); createAlbum(ids); }} />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Wgrywanie: źródło */}
      <Modal visible={uploadMenu} transparent animationType="fade" onRequestClose={() => setUploadMenu(false)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setUploadMenu(false)}>
          <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
            <Text style={styles.sheetTitle}>Wgraj do „{path[path.length - 1]?.name || home?.company.name}”</Text>
            <SheetButton icon="camera" label="Zrób zdjęcie albo film" onPress={() => { void pickAndUpload('camera'); }} />
            <SheetButton icon="image" label="Zdjęcia i filmy z galerii" onPress={() => { void pickAndUpload('library'); }} />
            <SheetButton icon="file" label="Pliki" onPress={() => { void pickAndUpload('files'); }} />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Postęp wgrywania */}
      <Modal visible={uploads !== null} transparent animationType="fade" onRequestClose={() => { if (!uploads?.running) setUploads(null); }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.sheetTitle}>
              {uploads?.running ? 'Wgrywanie' : 'Wgrywanie zakończone'} ({uploads?.rows.filter((r) => r.status === 'done').length || 0}/{uploads?.rows.length || 0})
            </Text>
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: spacing.sm }}>
              {uploads?.rows.map((row) => (
                <View key={row.key} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Feather name={row.status === 'done' ? 'check-circle' : row.status === 'error' ? 'alert-triangle' : row.status === 'uploading' ? 'upload' : 'clock'} size={14}
                      color={row.status === 'done' ? colors.status.success : row.status === 'error' ? colors.status.error : colors.primary.gold} />
                    <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>{row.name}</Text>
                    <Text style={styles.muted}>{formatMaterialBytes(row.size)}</Text>
                  </View>
                  {row.status === 'uploading' && (
                    <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${row.size ? Math.min(100, (row.sent / row.size) * 100) : 0}%` }]} /></View>
                  )}
                  {!!row.error && <Text style={[styles.muted, { color: colors.status.error }]}>{row.error}</Text>}
                </View>
              ))}
            </ScrollView>
            {uploads?.running
              ? <ActivityIndicator color={colors.primary.gold} />
              : <TouchableOpacity style={styles.primary} onPress={() => setUploads(null)}><Text style={styles.primaryText}>Zamknij</Text></TouchableOpacity>}
          </View>
        </View>
      </Modal>

      {/* Nazwa (nowy folder, zmiana nazwy) */}
      <Modal visible={nameDialog !== null} transparent animationType="fade" onRequestClose={() => setNameDialog(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.sheetTitle}>{nameDialog?.title}</Text>
            <TextInput style={styles.input} value={nameValue} onChangeText={(value) => setNameValue(value.slice(0, 255))} autoFocus
              placeholder="Nazwa" placeholderTextColor={colors.text.tertiary} />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => setNameDialog(null)}><Text style={styles.secondaryText}>Anuluj</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.primary, { flex: 1 }]} disabled={!nameValue.trim()} onPress={() => {
                const dialog = nameDialog;
                const name = nameValue.trim();
                setNameDialog(null);
                if (dialog && name) void dialog.submit(name);
              }}>
                <Text style={styles.primaryText}>{nameDialog?.confirm}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Wybór folderu (przenoszenie, zapis pliku wydarzenia) */}
      <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modal, { maxHeight: '80%' }]}>
            <Text style={styles.sheetTitle}>{picker?.title}</Text>
            <ScrollView contentContainerStyle={{ gap: 2 }}>
              <TouchableOpacity style={[styles.pickRow, pickerChoice === null && styles.pickRowActive]} onPress={() => setPickerChoice(null)}>
                <Feather name="home" size={16} color={colors.primary.gold} />
                <Text style={styles.body}>{home?.company.name}</Text>
              </TouchableOpacity>
              {pickerRows.map(({ folder, level }) => {
                const blocked = picker?.exclude.has(folder.id) ?? false;
                return (
                  <TouchableOpacity key={folder.id} disabled={blocked} onPress={() => setPickerChoice(folder.id)}
                    style={[styles.pickRow, { paddingLeft: spacing.sm + level * 14, opacity: blocked ? 0.4 : 1 }, pickerChoice === folder.id && styles.pickRowActive]}>
                    <Feather name={folderIcon(folder)} size={16} color={colors.primary.gold} />
                    <Text style={styles.body} numberOfLines={1}>{folder.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => setPicker(null)}><Text style={styles.secondaryText}>Anuluj</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.primary, { flex: 1 }]} onPress={() => {
                const current = picker;
                setPicker(null);
                current?.pick(pickerChoice);
              }}>
                <Text style={styles.primaryText}>{picker?.confirm}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Zdjęcie na pełnym ekranie */}
      <Modal visible={photo !== null} animationType="fade" onRequestClose={() => setPhoto(null)}>
        <View style={[styles.photo, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.photoHeader}>
            <Text style={styles.photoTitle} numberOfLines={1}>{photo?.name}</Text>
            <TouchableOpacity onPress={() => setPhoto(null)} style={{ padding: 12 }} accessibilityLabel="Zamknij"><Feather name="x" size={26} color="#fff" /></TouchableOpacity>
          </View>
          {photo && <Image source={{ uri: photo.url }} style={{ flex: 1 }} resizeMode="contain" />}
        </View>
      </Modal>

      {video && <ChatVideoPreview uri={video} onClose={() => setVideo(null)} />}

      {toast && (
        <View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + spacing.lg }, toast.error && { borderColor: colors.status.error }]}>
          <Feather name={toast.error ? 'alert-circle' : 'check-circle'} size={18} color={toast.error ? colors.status.error : colors.primary.gold} />
          <Text style={[styles.body, { flex: 1 }]}>{toast.text}</Text>
        </View>
      )}

      <Modal visible={busy !== null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modal, { alignItems: 'center' }]}>
            <ActivityIndicator color={colors.primary.gold} size="large" />
            <Text style={styles.body}>{busy}…</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SheetButton({ icon, label, onPress, danger }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <TouchableOpacity style={styles.sheetButton} onPress={onPress}>
      <Feather name={icon} size={18} color={danger ? colors.status.error : colors.primary.gold} />
      <Text style={[styles.body, danger && { color: colors.status.error }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.primary, padding: spacing.lg },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  crumb: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md, paddingHorizontal: spacing.sm, backgroundColor: colors.background.tertiary },
  searchInput: { flex: 1, paddingVertical: spacing.sm, color: colors.text.primary, fontSize: typography.fontSizes.sm },
  input: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md, padding: spacing.sm, color: colors.text.primary, backgroundColor: colors.background.tertiary, fontSize: typography.fontSizes.sm },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.default },
  chipActive: { borderColor: colors.primary.gold, backgroundColor: 'rgba(211,187,115,0.12)' },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  tile: { alignItems: 'center', gap: 4, padding: 6, borderRadius: borderRadius.lg, backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: colors.border.default },
  tileThumb: { alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.md, backgroundColor: colors.background.secondary, overflow: 'hidden' },
  tileName: { color: colors.text.primary, fontSize: 12, textAlign: 'center' },
  tileMeta: { color: colors.text.tertiary, fontSize: 11 },
  duration: { position: 'absolute', right: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  durationText: { color: '#fff', fontSize: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: colors.border.default },
  rowThumb: { width: 48, height: 48, borderRadius: borderRadius.md, backgroundColor: colors.background.secondary },
  rowAction: { padding: spacing.sm },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  primary: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary.gold, paddingVertical: spacing.sm + 2, borderRadius: borderRadius.md },
  primaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.sm },
  secondary: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.hover, paddingVertical: spacing.sm + 2, borderRadius: borderRadius.md },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background.elevated, borderTopLeftRadius: borderRadius.xl, borderTopRightRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.sm },
  sheetTitle: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  sheetButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: { width: '100%', maxWidth: 520, backgroundColor: colors.background.elevated, borderRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.sm },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: borderRadius.md },
  pickRowActive: { backgroundColor: 'rgba(211,187,115,0.18)' },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.background.secondary, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: colors.primary.gold },
  photo: { flex: 1, backgroundColor: '#000' },
  photoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  photoTitle: { color: '#fff', fontSize: 16, flex: 1 },
  toast: {
    position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    borderRadius: borderRadius.lg, backgroundColor: colors.background.elevated, borderWidth: 1, borderColor: colors.border.hover,
  },
});
