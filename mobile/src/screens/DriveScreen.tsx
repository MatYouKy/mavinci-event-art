import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Linking, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../theme';
import BrandHeading from '../components/BrandHeading';
import ChatVideoPreview from '../components/ChatVideoPreview';
import { useContentWidth } from '../hooks/useTabletLayout';
import {
  DRIVE_RECORD_LABELS, DRIVE_TITLE, DRIVE_UPLOAD_LIMITS, driveRecordPath,
  type DriveFile, type DriveFolder, type DriveListing, type DriveRoot, type DriveSection, type DriveSectionInfo,
} from '../lib/driveShared';
import {
  driveErrorMessage, driveTargetOf, driveTargetUrl, eventTargetOf, fetchDriveEventListing, fetchDriveEvents, fetchDriveListing,
  fetchDriveRoot, openPdf, shareDriveTarget, uploadDriveFile,
  type DriveEvent, type DriveEventFile, type DriveEventFolder, type DriveEventListing, type DriveTarget,
} from '../lib/driveApi';
import { pickMaterialDocuments, pickMaterialMedia, type PickedMaterial } from '../lib/materialsApi';
import { signalFilesProvider } from '../lib/filesProvider';
import { formatMaterialBytes, materialKind } from '../lib/materialsShared';
import { navigateToEvent, navigateToInquiry, navigationRef, openInCrmWeb } from '../navigation/navigationRef';

/*
 * Dysk w aplikacji (jak `/crm/materials` w CRM, ekran „Dysk” na Macu i Mavinci w Finderze): działy z dostępem — Eventy
 * (rok → wydarzenie → foldery i pliki z zakładki Pliki), Materiały (osobny ekran), Oferty, Kalkulacje, Umowy (PDF-y: rok →
 * miesiąc), Magazyn (kategoria → sprzęt → zdjęcia, pliki, instrukcja; dodawanie plików z prawem „Zarządzanie magazynem”)
 * i Pracownicy (pracownik → Zdjęcia, Dokumenty, Umowy — foldery według uprawnień; dokumenty dodaje sam pracownik i „Pracownicy —
 * zarządzanie”). Podgląd (zdjęcia, PDF, filmy), udostępnianie, przejście do rekordu. Na tablecie w poziomie — działy z lewej, treść obok.
 */

type Location =
  | { section: 'events'; year: string | null; eventId: string | null; folderId: string | null }
  | { section: Exclude<DriveSection, 'events' | 'materials'>; node: string };
type Crumb = { key: string; label: string; go: () => void };
type UploadRow = { key: string; name: string; size: number; sent: number; status: 'waiting' | 'uploading' | 'done' | 'error'; error?: string };
type Toast = { text: string; error: boolean };

const NO_DATE = 'Bez daty';
const eventYear = (event: DriveEvent) => (event.date ? event.date.slice(0, 4) : NO_DATE);
const eventLabel = (event: DriveEvent) => `${event.date || NO_DATE} ${event.name}`.trim();
const WIDE = 860;

const SECTION_ICONS: Record<DriveSection, keyof typeof Feather.glyphMap> = {
  events: 'calendar', materials: 'archive', offers: 'file-text', calculations: 'percent', contracts: 'edit-3', warehouse: 'package', employees: 'users',
};
const KIND_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  image: 'image', video: 'film', audio: 'music', pdf: 'file-text', document: 'file-text', spreadsheet: 'grid', presentation: 'monitor',
  design: 'pen-tool', archive: 'archive', font: 'type', other: 'file',
};
const FOLDER_ICONS: Record<DriveFolder['kind'], keyof typeof Feather.glyphMap> = {
  section: 'folder', year: 'folder', month: 'folder', category: 'folder', equipment: 'package', brand: 'award', employee: 'user', group: 'folder',
};

/** Dokąd trafiają pliki dodane w folderze (sprzęt albo dokumenty pracownika) — komunikaty wysyłki. */
const uploadPlace = (node: string) => (node.startsWith('employees:') ? 'dokumentów pracownika' : 'sprzętu');

const dateLabel = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const locationOf = (section: DriveSection, node?: string | null): Location | null => {
  if (section === 'materials') return null;
  if (section === 'events') return { section, year: null, eventId: null, folderId: null };
  return { section, node: node && node.split(':')[0] === section ? node : section };
};

export default function DriveScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const width = useContentWidth();
  const wide = width >= WIDE;

  const [root, setRoot] = useState<DriveRoot | null>(null);
  const [rootError, setRootError] = useState('');
  const [location, setLocation] = useState<Location | null>(null);
  const [listings, setListings] = useState<Record<string, DriveListing>>({});
  const [listErrors, setListErrors] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<DriveEvent[] | null>(null);
  const [eventsError, setEventsError] = useState('');
  const [eventListing, setEventListing] = useState<DriveEventListing | null>(null);
  const [eventError, setEventError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ target: DriveTarget; file: DriveFile | null; eventId: string | null } | null>(null);
  const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [uploadMenu, setUploadMenu] = useState(false);
  const [uploads, setUploads] = useState<{ rows: UploadRow[]; running: boolean } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const listRequest = useRef(0);
  const eventRequest = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initial = useRef<{ section?: DriveSection; node?: string } | null>(route.params || null);

  const available = useMemo(() => (root?.sections || []).filter((entry) => entry.available), [root]);

  const notify = useCallback((text: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, error });
    toastTimer.current = setTimeout(() => setToast(null), error ? 5000 : 3000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // MARK: Dane

  const loadRoot = useCallback(async () => {
    try {
      const data = await fetchDriveRoot();
      setRoot(data);
      setRootError('');
    } catch (cause) {
      setRootError(driveErrorMessage(cause, 'Nie udało się otworzyć Dysku.'));
    }
  }, []);

  useEffect(() => { void loadRoot(); }, [loadRoot]);

  // Dział na start: z parametrów ekranu, a na tablecie w poziomie — pierwszy dostępny (poza Materiałami, które mają osobny ekran).
  useEffect(() => {
    if (!root || location) return;
    const wanted = initial.current;
    initial.current = null;
    const pick = wanted?.section && available.some((entry) => entry.key === wanted.section) ? wanted.section : null;
    if (pick) { setLocation(locationOf(pick, wanted?.node)); return; }
    if (wide) {
      const first = available.find((entry) => entry.key !== 'materials');
      if (first) setLocation(locationOf(first.key));
    }
  }, [available, location, root, wide]);

  const node = location && location.section !== 'events' ? location.node : null;

  const loadListing = useCallback(async (value: string) => {
    const request = ++listRequest.current;
    try {
      const data = await fetchDriveListing(value);
      setListings((current) => ({ ...current, [value]: data }));
      setListErrors((current) => { const next = { ...current }; delete next[value]; return next; });
    } catch (cause) {
      if (request !== listRequest.current) return;
      setListErrors((current) => ({ ...current, [value]: driveErrorMessage(cause, 'Nie udało się otworzyć folderu.') }));
    }
  }, []);

  useEffect(() => { if (node) void loadListing(node); }, [loadListing, node]);

  const loadEvents = useCallback(async () => {
    try {
      const data = await fetchDriveEvents();
      setEvents(data.events);
      setEventsError('');
    } catch (cause) {
      setEventsError(driveErrorMessage(cause, 'Nie udało się pobrać eventów.'));
    }
  }, []);

  const inEvents = location?.section === 'events';
  useEffect(() => { if (inEvents && events === null) void loadEvents(); }, [events, inEvents, loadEvents]);

  const eventId = location?.section === 'events' ? location.eventId : null;
  const loadEventListing = useCallback(async (id: string) => {
    const request = ++eventRequest.current;
    try {
      const data = await fetchDriveEventListing(id);
      if (request !== eventRequest.current) return;
      setEventListing(data);
      setEventError('');
    } catch (cause) {
      if (request === eventRequest.current) setEventError(driveErrorMessage(cause, 'Nie udało się otworzyć plików eventu.'));
    }
  }, []);

  useEffect(() => {
    setEventListing(null);
    setEventError('');
    if (eventId) void loadEventListing(eventId);
  }, [eventId, loadEventListing]);

  useEffect(() => { setFilter(''); }, [location]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadRoot();
      if (node) await loadListing(node);
      if (inEvents) await loadEvents();
      if (eventId) await loadEventListing(eventId);
    } finally {
      setRefreshing(false);
    }
  };

  // MARK: Nawigacja

  const openSection = (info: DriveSectionInfo) => {
    if (info.key === 'materials') { navigation.navigate('Materials'); return; }
    setLocation(locationOf(info.key));
  };
  const openNode = (value: string) => {
    if (!location || location.section === 'events') return;
    setLocation({ section: location.section, node: value });
  };
  const openEvents = (patch: Partial<{ year: string | null; eventId: string | null; folderId: string | null }>) => {
    setLocation((current) => (current?.section === 'events' ? { ...current, ...patch } : { section: 'events', year: null, eventId: null, folderId: null, ...patch }));
  };

  const sectionInfo = location ? available.find((entry) => entry.key === location.section) || null : null;
  const listing = node ? listings[node] || null : null;
  const listError = node ? listErrors[node] || '' : '';
  const event = eventListing?.event || (eventId ? events?.find((entry) => entry.id === eventId) || null : null);

  const eventFolderPath = useMemo(() => {
    if (location?.section !== 'events' || !eventListing) return [] as DriveEventFolder[];
    const byId = new Map(eventListing.folders.map((folder) => [folder.id, folder] as const));
    const chain: DriveEventFolder[] = [];
    for (let id = location.folderId, guard = 0; id && guard < 40; guard += 1) {
      const folder = byId.get(id);
      if (!folder) break;
      chain.unshift(folder);
      id = folder.parentId;
    }
    return chain;
  }, [eventListing, location]);

  const crumbs: Crumb[] = [];
  if (!wide) crumbs.push({ key: 'root', label: DRIVE_TITLE, go: () => setLocation(null) });
  if (location && sectionInfo) {
    if (location.section === 'events') {
      crumbs.push({ key: 'events', label: sectionInfo.label, go: () => openEvents({ year: null, eventId: null, folderId: null }) });
      const year = event ? eventYear(event) : location.year;
      if (year) crumbs.push({ key: `year:${year}`, label: year, go: () => openEvents({ year, eventId: null, folderId: null }) });
      if (event) crumbs.push({ key: `event:${event.id}`, label: event.name, go: () => openEvents({ eventId: event.id, folderId: null }) });
      for (const folder of eventFolderPath) crumbs.push({ key: folder.id, label: folder.name, go: () => openEvents({ folderId: folder.id }) });
    } else if (listing) {
      for (const folder of listing.path) crumbs.push({ key: folder.id, label: folder.name, go: () => openNode(folder.id) });
    } else {
      crumbs.push({ key: location.section, label: sectionInfo.label, go: () => openNode(location.section) });
    }
  }

  // MARK: Pliki

  const preview = async (target: DriveTarget) => {
    const kind = materialKind(target.mime, target.name);
    setBusy('Otwieram');
    try {
      const url = await driveTargetUrl(target);
      if (kind === 'image') setPhoto({ url, name: target.name });
      else if (kind === 'video') setVideo(url);
      else if (kind === 'pdf') openPdf(navigation, url, target.name);
      else await Linking.openURL(url);
    } catch (cause) {
      notify(driveErrorMessage(cause, 'Nie udało się otworzyć pliku.'), true);
    } finally {
      setBusy(null);
    }
  };

  const share = async (target: DriveTarget) => {
    setBusy('Przygotowuję plik');
    try {
      await shareDriveTarget(target);
    } catch (cause) {
      notify(driveErrorMessage(cause, 'Nie udało się udostępnić pliku.'), true);
    } finally {
      setBusy(null);
    }
  };

  /** Rekord w CRM: wydarzenie, zapytanie i sprzęt — w aplikacji; oferta, umowa i księga znaku — w CRM w przeglądarce. */
  const openRecord = (file: DriveFile) => {
    const record = file.record;
    if (!record) return;
    if (record.type === 'event') { navigateToEvent(record.id); return; }
    if (record.type === 'inquiry') { navigateToInquiry(record.id); return; }
    if (record.type === 'equipment' && navigationRef.isReady()) {
      navigationRef.navigate('Main', { screen: 'Equipment', params: { equipmentId: record.id } });
      return;
    }
    const path = driveRecordPath(record);
    if (path) openInCrmWeb(path);
  };

  // MARK: Dodawanie plików do sprzętu

  const startUpload = async (source: 'camera' | 'library' | 'files') => {
    setUploadMenu(false);
    if (!listing?.canUpload || !node) return;
    const parentId = node;
    let picked: PickedMaterial[];
    // Okno wyboru (aparat, galeria, Pliki) dopiero po zamknięciu arkusza — iOS pokazuje jedno okno naraz.
    await new Promise<void>((resolve) => { setTimeout(() => resolve(), 350); });
    try {
      picked = source === 'files' ? await pickMaterialDocuments() : await pickMaterialMedia(source);
    } catch (cause) {
      notify(driveErrorMessage(cause, 'Nie udało się wybrać plików.'), true);
      return;
    }
    if (!picked.length) return;
    const place = uploadPlace(parentId);
    const rows: UploadRow[] = picked.map((file, index) => ({
      key: `${Date.now()}-${index}`, name: file.name, size: file.size, sent: 0,
      status: file.size > DRIVE_UPLOAD_LIMITS.file ? 'error' : 'waiting',
      error: file.size > DRIVE_UPLOAD_LIMITS.file ? `Plik przekracza 50 MB — limit plików ${place}.` : undefined,
    }));
    setUploads({ rows, running: true });
    const update = (key: string, patch: Partial<UploadRow>) =>
      setUploads((current) => (current ? { ...current, rows: current.rows.map((row) => (row.key === key ? { ...row, ...patch } : row)) } : current));
    let added = 0;
    for (const [index, file] of picked.entries()) {
      const row = rows[index];
      if (row.status === 'error') continue;
      update(row.key, { status: 'uploading' });
      try {
        await uploadDriveFile(parentId, file, (sent) => update(row.key, { sent }));
        update(row.key, { status: 'done', sent: file.size });
        added += 1;
      } catch (cause) {
        update(row.key, { status: 'error', error: driveErrorMessage(cause, 'Nie udało się wysłać pliku.') });
      }
    }
    setUploads((current) => (current ? { ...current, running: false } : current));
    // „Mavinci” w aplikacji Pliki wczyta Dysk od nowa (jak Finder po dodaniu pliku w aplikacji na Macu).
    if (added) signalFilesProvider(true);
    await loadListing(parentId);
    const failed = rows.length - added;
    if (!failed) {
      setUploads(null);
      notify(added === 1 ? `Dodano plik do ${place}.` : `Dodano pliki do ${place}: ${added}.`);
    } else {
      notify(added ? `Dodano ${added}, nie udało się ${failed} — szczegóły na liście.` : 'Nie udało się dodać plików — szczegóły na liście.', true);
    }
  };

  // MARK: Widok

  if (!root) {
    return (
      <View style={styles.center}>
        {rootError ? (
          <>
            <Text style={styles.muted}>{rootError}</Text>
            <TouchableOpacity style={[styles.secondary, { marginTop: spacing.md, paddingHorizontal: spacing.lg }]} onPress={() => { setRootError(''); void loadRoot(); }}>
              <Text style={styles.secondaryText}>Spróbuj ponownie</Text>
            </TouchableOpacity>
          </>
        ) : <ActivityIndicator color={colors.primary.gold} size="large" />}
      </View>
    );
  }

  const needle = filter.trim().toLocaleLowerCase('pl-PL');
  const matches = (name: string) => !needle || name.toLocaleLowerCase('pl-PL').includes(needle);

  const sectionRow = (info: DriveSectionInfo) => {
    const active = location?.section === info.key;
    return (
      <TouchableOpacity key={info.key} style={[styles.sectionRow, active && styles.sectionRowActive]} onPress={() => openSection(info)}
        accessibilityRole="button" accessibilityState={{ selected: active }}>
        <Feather name={SECTION_ICONS[info.key]} size={20} color={active ? colors.primary.gold : colors.text.secondary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.sectionLabel, active && { color: colors.primary.gold }]}>{info.label}</Text>
          {!wide || active ? <Text style={styles.muted} numberOfLines={2}>{info.description}</Text> : null}
        </View>
        <Feather name={info.key === 'materials' ? 'arrow-up-right' : 'chevron-right'} size={16} color={colors.text.tertiary} />
      </TouchableOpacity>
    );
  };

  const sectionList = (
    <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: insets.bottom + spacing.lg }}
      refreshControl={!wide ? <RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.primary.gold} /> : undefined}>
      {!wide ? <Text style={styles.muted}>Ta sama chmura co w CRM, na Macu i w Finderze — działy, do których masz dostęp.</Text> : null}
      {available.length ? available.map(sectionRow) : <Text style={styles.muted}>Nie masz dostępu do żadnego działu Dysku.</Text>}
    </ScrollView>
  );

  const folderRow = (key: string, icon: keyof typeof Feather.glyphMap, name: string, detail: string, onPress: () => void) => (
    <TouchableOpacity key={key} style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={[styles.rowThumb, styles.placeholder]}><Feather name={icon} size={20} color={colors.primary.gold} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.body} numberOfLines={2}>{name}</Text>
        {detail ? <Text style={styles.muted} numberOfLines={1}>{detail}</Text> : null}
      </View>
      <Feather name="chevron-right" size={16} color={colors.text.tertiary} />
    </TouchableOpacity>
  );

  const fileRow = (key: string, target: DriveTarget, detail: string, thumbnail: string | null, file: DriveFile | null, owner: string | null) => {
    const kind = materialKind(target.mime, target.name);
    return (
      <View key={key} style={styles.row}>
        <TouchableOpacity style={styles.rowMain} onPress={() => { void preview(target); }} onLongPress={() => setMenu({ target, file, eventId: owner })}
          accessibilityRole="button" accessibilityHint="Podgląd pliku">
          {thumbnail && kind === 'image'
            ? <Image source={{ uri: thumbnail }} style={styles.rowThumb} resizeMode="cover" />
            : <View style={[styles.rowThumb, styles.placeholder]}><Feather name={KIND_ICONS[kind] || 'file'} size={20} color={colors.text.secondary} /></View>}
          <View style={{ flex: 1 }}>
            <Text style={styles.body} numberOfLines={2}>{target.name}</Text>
            {detail ? <Text style={styles.muted} numberOfLines={2}>{detail}</Text> : null}
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.rowAction} onPress={() => setMenu({ target, file, eventId: owner })} accessibilityLabel={`Więcej: ${target.name}`}>
          <Feather name="more-vertical" size={18} color={colors.text.secondary} />
        </TouchableOpacity>
      </View>
    );
  };

  const placeholderText = (text: string) => <Text style={[styles.muted, { textAlign: 'center', paddingVertical: spacing.lg }]}>{text}</Text>;
  const loader = <ActivityIndicator color={colors.primary.gold} style={{ paddingVertical: spacing.lg }} />;

  let content: React.ReactNode = null;
  let headerActions: React.ReactNode = null;
  if (location?.section === 'events') {
    if (eventsError && !events) content = placeholderText(eventsError);
    else if (!events) content = loader;
    else if (!location.eventId && !location.year) {
      const counts = new Map<string, number>();
      for (const entry of events) counts.set(eventYear(entry), (counts.get(eventYear(entry)) || 0) + 1);
      const years = Array.from(counts.entries()).sort((a, b) => (a[0] === NO_DATE ? 1 : b[0] === NO_DATE ? -1 : b[0].localeCompare(a[0])));
      const shown = years.filter(([year]) => matches(year));
      content = shown.length
        ? shown.map(([year, count]) => folderRow(`year:${year}`, 'folder', year, `${count} wydarz.`, () => openEvents({ year })))
        : placeholderText(years.length ? 'Nic nie pasuje do filtra.' : 'Brak eventów z dostępem.');
    } else if (!location.eventId) {
      const list = events.filter((entry) => eventYear(entry) === location.year && matches(eventLabel(entry)))
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name, 'pl'));
      content = list.length
        ? list.map((entry) => folderRow(entry.id, 'calendar', eventLabel(entry), entry.status || '', () => openEvents({ eventId: entry.id, folderId: null })))
        : placeholderText(needle ? 'Brak eventów o tej nazwie.' : 'Brak eventów w tym roku.');
    } else {
      const currentEvent = location.eventId;
      headerActions = (
        <TouchableOpacity style={[styles.secondary, { paddingHorizontal: spacing.md }]} onPress={() => navigateToEvent(currentEvent, 'files')}>
          <Feather name="external-link" size={16} color={colors.primary.gold} />
          <Text style={styles.secondaryText}>Otwórz event</Text>
        </TouchableOpacity>
      );
      if (eventError && !eventListing) content = placeholderText(eventError);
      else if (!eventListing) content = loader;
      else {
        const folders = eventListing.folders.filter((folder) => folder.parentId === location.folderId && matches(folder.name))
          .sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }));
        const files = eventListing.files.filter((file) => file.parentId === location.folderId && matches(file.name))
          .sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }));
        content = folders.length || files.length ? (
          <>
            {folders.map((folder) => folderRow(folder.id, 'folder', folder.name, '', () => openEvents({ folderId: folder.id })))}
            {files.map((file: DriveEventFile) => fileRow(file.id, eventTargetOf(file),
              [formatMaterialBytes(file.size), dateLabel(file.updatedAt || file.createdAt)].filter(Boolean).join(' · '), null, null, currentEvent))}
          </>
        ) : placeholderText(needle ? 'Nic nie pasuje do filtra.' : 'Ten folder jest pusty — pliki dodasz w zakładce Pliki eventu.');
      }
    }
  } else if (location) {
    if (listError && !listing) content = placeholderText(listError);
    else if (!listing) content = loader;
    else {
      const folders = listing.folders.filter((folder) => matches(folder.name));
      const files = listing.files.filter((file) => matches(file.name) || matches(file.detail));
      if (listing.canUpload) {
        headerActions = (
          <TouchableOpacity style={[styles.primary, { paddingHorizontal: spacing.md }]} onPress={() => setUploadMenu(true)} disabled={uploads?.running}>
            <Feather name="upload" size={16} color={colors.background.primary} />
            <Text style={styles.primaryText}>Dodaj pliki</Text>
          </TouchableOpacity>
        );
      }
      content = folders.length || files.length ? (
        <>
          {folders.map((folder) => folderRow(folder.id, FOLDER_ICONS[folder.kind] || 'folder', folder.name,
            folder.count === null ? '' : folder.kind === 'category' ? `${folder.count} poz.` : `${folder.count} pl.`, () => openNode(folder.id)))}
          {files.map((file) => fileRow(file.id, driveTargetOf(file),
            [file.detail, formatMaterialBytes(file.size), dateLabel(file.updatedAt)].filter(Boolean).join(' · '), file.thumbnailUrl, file, null))}
        </>
      ) : placeholderText(needle ? 'Nic nie pasuje do filtra.'
        : listing.node.kind === 'equipment' ? (listing.canUpload ? 'Sprzęt nie ma jeszcze plików — dodaj zdjęcia albo pliki.' : 'Sprzęt nie ma jeszcze plików.')
          : employeeEmpty(listing.node.id, listing.canUpload));
    }
  }

  const title = (location?.section === 'events'
    ? (eventFolderPath[eventFolderPath.length - 1]?.name || event?.name || location.year)
    : listing?.node.name) || sectionInfo?.label || DRIVE_TITLE;

  const browser = location ? (
    <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: insets.bottom + spacing.xl }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.primary.gold} />}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: 4 }}>
        {crumbs.map((crumb, index) => (
          <View key={crumb.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {index > 0 ? <Feather name="chevron-right" size={12} color={colors.text.tertiary} /> : null}
            <TouchableOpacity onPress={crumb.go} disabled={index === crumbs.length - 1} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
              <Text style={[styles.crumb, index === crumbs.length - 1 && { color: colors.text.secondary }]} numberOfLines={1}>{crumb.label}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
      <View style={styles.titleRow}>
        <BrandHeading style={styles.title} numberOfLines={2}>{title}</BrandHeading>
        {headerActions}
      </View>
      <View style={styles.searchRow}>
        <Feather name="filter" size={16} color={colors.text.tertiary} />
        <TextInput style={styles.searchInput} value={filter} onChangeText={setFilter} placeholder="Filtruj ten folder" placeholderTextColor={colors.text.tertiary}
          returnKeyType="done" autoCorrect={false} />
        {filter ? (
          <TouchableOpacity onPress={() => setFilter('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Wyczyść filtr">
            <Feather name="x-circle" size={16} color={colors.text.tertiary} />
          </TouchableOpacity>
        ) : null}
      </View>
      {listError && listing ? <Text style={[styles.muted, { color: colors.status.error }]}>{listError}</Text> : null}
      {content}
    </ScrollView>
  ) : null;

  const menuTarget = menu?.target || null;
  const menuRecord = menu?.file?.record || null;
  const uploadDone = uploads?.rows.filter((row) => row.status === 'done').length || 0;

  return (
    <View style={styles.container}>
      {wide ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={styles.sidePanel}>{sectionList}</View>
          <View style={{ flex: 1 }}>{browser || <View style={styles.center}><Text style={styles.muted}>Wybierz dział Dysku.</Text></View>}</View>
        </View>
      ) : (browser || sectionList)}

      {toast ? (
        <View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + spacing.lg }, toast.error && styles.toastError]}>
          <Feather name={toast.error ? 'alert-circle' : 'check-circle'} size={18} color={toast.error ? colors.status.error : colors.primary.gold} />
          <Text style={[styles.body, { flex: 1 }]}>{toast.text}</Text>
        </View>
      ) : null}

      {/* Akcje pliku */}
      <Modal visible={menu !== null} transparent animationType="fade" onRequestClose={() => setMenu(null)} supportedOrientations={['portrait', 'landscape']}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setMenu(null)}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Text style={styles.sheetTitle} numberOfLines={2}>{menuTarget?.name}</Text>
            {menuTarget ? <SheetButton icon="eye" label="Podgląd" onPress={() => { setMenu(null); void preview(menuTarget); }} /> : null}
            {menuTarget ? <SheetButton icon="share" label="Udostępnij" onPress={() => { setMenu(null); void share(menuTarget); }} /> : null}
            {menuRecord && menu?.file ? (
              <SheetButton icon="external-link" label={DRIVE_RECORD_LABELS[menuRecord.type]} onPress={() => { const file = menu.file!; setMenu(null); openRecord(file); }} />
            ) : null}
            {menu?.eventId ? (
              <SheetButton icon="external-link" label="Otwórz event" onPress={() => { const id = menu.eventId!; setMenu(null); navigateToEvent(id, 'files'); }} />
            ) : null}
            <SheetButton icon="x" label="Anuluj" onPress={() => setMenu(null)} />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Dodawanie plików do sprzętu */}
      <Modal visible={uploadMenu} transparent animationType="fade" onRequestClose={() => setUploadMenu(false)} supportedOrientations={['portrait', 'landscape']}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setUploadMenu(false)}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Text style={styles.sheetTitle}>{node?.startsWith('employees:') ? 'Dodaj do dokumentów pracownika' : 'Dodaj do sprzętu'}</Text>
            <Text style={styles.muted}>{node?.startsWith('employees:')
              ? 'Pliki do 50 MB trafią do dokumentów pracownika pod nazwą pliku (rodzaj i termin ważności — przy dodawaniu w profilu pracownika w CRM i na Macu).'
              : 'Zdjęcia do 10 MB trafiają do galerii sprzętu, pozostałe pliki (do 50 MB) — do plików sprzętu, jak w CRM.'}</Text>
            <SheetButton icon="camera" label="Zrób zdjęcie" onPress={() => { void startUpload('camera'); }} />
            <SheetButton icon="image" label="Zdjęcia i filmy z galerii" onPress={() => { void startUpload('library'); }} />
            <SheetButton icon="paperclip" label="Pliki" onPress={() => { void startUpload('files'); }} />
            <SheetButton icon="x" label="Anuluj" onPress={() => setUploadMenu(false)} />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Postęp wysyłki */}
      <Modal visible={uploads !== null} transparent animationType="fade" onRequestClose={() => { if (!uploads?.running) setUploads(null); }}
        supportedOrientations={['portrait', 'landscape']}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.sheetTitle}>{uploads?.running ? `Wysyłam pliki (${uploadDone}/${uploads.rows.length})` : 'Wysyłka zakończona'}</Text>
            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: spacing.sm }}>
              {uploads?.rows.map((row) => (
                <View key={row.key} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Feather name={row.status === 'done' ? 'check-circle' : row.status === 'error' ? 'alert-circle' : 'upload'} size={16}
                      color={row.status === 'error' ? colors.status.error : colors.primary.gold} />
                    <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>{row.name}</Text>
                    <Text style={styles.muted}>{formatMaterialBytes(row.size)}</Text>
                  </View>
                  {row.status === 'uploading' ? (
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${row.size ? Math.min(100, Math.round((row.sent / row.size) * 100)) : 0}%` }]} />
                    </View>
                  ) : null}
                  {row.error ? <Text style={[styles.muted, { color: colors.status.error }]}>{row.error}</Text> : null}
                </View>
              ))}
            </ScrollView>
            {!uploads?.running ? (
              <TouchableOpacity style={styles.primary} onPress={() => setUploads(null)}><Text style={styles.primaryText}>Zamknij</Text></TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Zdjęcie na pełnym ekranie */}
      <Modal visible={photo !== null} animationType="fade" onRequestClose={() => setPhoto(null)} supportedOrientations={['portrait', 'landscape']}>
        <View style={[styles.photo, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.photoHeader}>
            <Text style={styles.photoTitle} numberOfLines={1}>{photo?.name}</Text>
            <TouchableOpacity onPress={() => setPhoto(null)} style={{ padding: 12 }} accessibilityLabel="Zamknij"><Feather name="x" size={26} color="#fff" /></TouchableOpacity>
          </View>
          {photo ? <Image source={{ uri: photo.url }} style={{ flex: 1 }} resizeMode="contain" /> : null}
        </View>
      </Modal>

      {video ? <ChatVideoPreview uri={video} onClose={() => setVideo(null)} /> : null}

      <Modal visible={busy !== null} transparent animationType="fade" supportedOrientations={['portrait', 'landscape']}>
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

/** Pusty folder działu Pracownicy (pozostałe działy — „Ten folder jest pusty.”). */
function employeeEmpty(id: string, canUpload: boolean) {
  if (id === 'employees') return 'Brak aktywnych pracowników.';
  if (!id.startsWith('employees:')) return 'Ten folder jest pusty.';
  if (id.endsWith(':photos')) return 'Pracownik nie ma jeszcze zdjęcia profilowego ani zdjęcia w tle.';
  if (id.endsWith(':contracts')) return 'Brak dokumentów umów — dokument powstaje w CRM: profil pracownika → „Umowy i rozliczenia”.';
  if (id.endsWith(':documents')) return canUpload ? 'Brak dokumentów — dodaj skany albo pliki.' : 'Brak dokumentów pracownika.';
  return 'Ten folder jest pusty.';
}

function SheetButton({ icon, label, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.sheetButton} onPress={onPress} accessibilityRole="button">
      <Feather name={icon} size={18} color={colors.primary.gold} />
      <Text style={styles.body}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.primary, padding: spacing.lg },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  crumb: { color: colors.primary.gold, fontSize: typography.fontSizes.sm, maxWidth: 220 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  title: { flex: 1, minWidth: 160, color: colors.text.primary, fontFamily: typography.fontFamilies.heading, fontSize: typography.fontSizes.lg },
  sidePanel: { width: 280, borderRightWidth: 1, borderRightColor: colors.border.default, backgroundColor: colors.background.secondary },
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: borderRadius.lg,
    backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: colors.border.default,
  },
  sectionRowActive: { borderColor: colors.primary.gold + '60', backgroundColor: colors.primary.gold + '18' },
  sectionLabel: {
    color: colors.text.primary, fontFamily: typography.fontFamilies.heading, fontSize: typography.fontSizes.sm, fontWeight: '400',
    textTransform: 'uppercase', letterSpacing: 0.35,
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm, backgroundColor: colors.background.tertiary,
  },
  searchInput: { flex: 1, paddingVertical: spacing.sm, color: colors.text.primary, fontSize: typography.fontSizes.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.lg,
    backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: colors.border.default,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowThumb: { width: 48, height: 48, borderRadius: borderRadius.md, backgroundColor: colors.background.secondary },
  rowAction: { padding: spacing.sm },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  primary: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary.gold,
    paddingVertical: spacing.sm + 2, borderRadius: borderRadius.md,
  },
  primaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.sm },
  secondary: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.hover,
    paddingVertical: spacing.sm + 2, borderRadius: borderRadius.md,
  },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  toast: {
    position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    borderRadius: borderRadius.lg, backgroundColor: colors.background.elevated, borderWidth: 1, borderColor: colors.primary.gold + '50',
  },
  toastError: { borderColor: colors.status.error + '70' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background.elevated, borderTopLeftRadius: borderRadius.xl, borderTopRightRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.sm },
  sheetTitle: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  sheetButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: { width: '100%', maxWidth: 520, backgroundColor: colors.background.elevated, borderRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.sm },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.background.secondary, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: colors.primary.gold },
  photo: { flex: 1, backgroundColor: '#000' },
  photoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  photoTitle: { color: '#fff', fontSize: 16, flex: 1 },
});
