import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../theme';
import ReorderableList from '../components/ReorderableList';
import {
  DRIVE_SCAN_LIMITS, driveFinanceNodeId, driveMonthName, parseDriveNode, type DriveFolder, type DriveListing,
} from '../lib/driveShared';
import { driveErrorMessage, fetchDriveListing, uploadDriveScan } from '../lib/driveApi';

/*
 * Skaner dokumentów (Dysk → „Skanuj dokument”): zdjęcia stron z aparatu albo z galerii (kolejność zmienia się przeciąganiem),
 * wybór folderu w całej strukturze Finansów i zapis. Serwer składa ze zdjęć PDF i zapisuje go w folderze: Koszty miesiąca —
 * dokument spoza KSeF (AI odczytuje sprzedawcę, numer, datę i kwoty; teczkę wyznacza data dokumentu), kategoria Dokumentów
 * spółki albo umowa stała. Zapisywać może osoba z poziomem „Finanse — zarządzanie” w firmie (pozostali widzą foldery bez
 * przycisku wyboru). Ostatnio wybrany folder pamięta telefon (Koszty — zawsze bieżący miesiąc).
 */

type Page = { key: string; uri: string; mimeType: string; size: number };
type Target = { node: string; label: string; company: string };
type Toast = { text: string; error: boolean };
type Saving = { text: string; done: number; total: number };

const TARGET_KEY = 'mavinci.financeScan.target';
const PAGE_TYPES = new Set(['image/jpeg', 'image/png']);

/** Bieżący miesiąc w Polsce (teczka Kosztów, do której trafiają nowe skany). */
function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value) || new Date().getFullYear();
  const month = Number(parts.find((part) => part.type === 'month')?.value) || new Date().getMonth() + 1;
  return { year, month };
}

/** Koszty bieżącego miesiąca firmy. */
function costsTarget(companyId: string, company: string): Target {
  const { year, month } = currentMonth();
  return { node: driveFinanceNodeId(companyId, { year, month, group: 'costs' }), label: `${company} › Koszty — ${driveMonthName(month).slice(5)} ${year}`, company };
}

const isCosts = (node: string) => {
  const parsed = parseDriveNode(node);
  return parsed?.section === 'finance' && parsed.group === 'costs';
};

/** Folder w wyborze: z Księgowości tylko Koszty (Sprzedaż, Bank, Podatki i XML powstają w CRM); bez Majątku i Do wyjaśnienia (raporty). */
const pickable = (folder: DriveFolder) => {
  if (folder.kind === 'assets' || folder.kind === 'clarify') return false;
  if (folder.kind !== 'ledger') return true;
  const parsed = parseDriveNode(folder.id);
  return parsed?.section === 'finance' && parsed.group === 'costs';
};

const FOLDER_ICONS: Partial<Record<DriveFolder['kind'], keyof typeof Feather.glyphMap>> = {
  company: 'briefcase', books: 'book', year: 'calendar', month: 'calendar', ledger: 'file-plus', corporate: 'briefcase', docgroup: 'folder',
  agreements: 'edit-3', agreement: 'file-text', assets: 'package',
};

async function sizeOf(uri: string, known?: number | null): Promise<number> {
  if (known && known > 0) return known;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && 'size' in info ? Number(info.size) || 0 : 0;
  } catch {
    return 0;
  }
}

export default function FinanceScanScreen() {
  const insets = useSafeAreaInsets();
  const [pages, setPages] = useState<Page[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [title, setTitle] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [saving, setSaving] = useState<Saving | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [preview, setPreview] = useState<Page | null>(null);
  const [picker, setPicker] = useState(false);
  const [pickerNode, setPickerNode] = useState('finance');
  const [listing, setListing] = useState<DriveListing | null>(null);
  const [listingError, setListingError] = useState('');
  const [listingLoading, setListingLoading] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);

  const notify = useCallback((text: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, error });
    toastTimer.current = setTimeout(() => setToast(null), error ? 6000 : 7000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Ostatnio wybrany folder (Koszty — przeniesione na bieżący miesiąc).
  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(TARGET_KEY);
        const saved = raw ? JSON.parse(raw) as Partial<Target> : null;
        if (!saved?.node || !saved.label) return;
        const parsed = parseDriveNode(saved.node);
        if (parsed?.section !== 'finance' || !parsed.companyId) return;
        setTarget(parsed.group === 'costs' ? costsTarget(parsed.companyId, saved.company || '') : { node: saved.node, label: saved.label, company: saved.company || '' });
      } catch { /* bez zapamiętanego folderu */ }
    })();
  }, []);

  const choose = (next: Target) => {
    setTarget(next);
    setPicker(false);
    AsyncStorage.setItem(TARGET_KEY, JSON.stringify(next)).catch(() => undefined);
  };

  // MARK: Strony

  const capture = async (source: 'camera' | 'library') => {
    const room = DRIVE_SCAN_LIMITS.pages - pages.length;
    if (room <= 0) { notify(`Skan może mieć najwyżej ${DRIVE_SCAN_LIMITS.pages} stron.`, true); return; }
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { notify('Aby zrobić zdjęcie, zezwól aplikacji na dostęp do aparatu w ustawieniach.', true); return; }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'], quality: 0.6, exif: false,
        allowsMultipleSelection: source === 'library', selectionLimit: source === 'library' ? room : 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets?.length) return;
      const added: Page[] = [];
      let skipped = 0;
      for (const asset of result.assets) {
        const extension = (asset.uri.split('?')[0].split('.').pop() || '').toLowerCase();
        const mimeType = asset.mimeType || (extension === 'png' ? 'image/png' : 'image/jpeg');
        const size = await sizeOf(asset.uri, asset.fileSize);
        if (!PAGE_TYPES.has(mimeType) || !size || size > DRIVE_SCAN_LIMITS.page) { skipped += 1; continue; }
        added.push({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, uri: asset.uri, mimeType, size });
      }
      setPages((current) => [...current, ...added].slice(0, DRIVE_SCAN_LIMITS.pages));
      if (skipped) notify(skipped === 1 ? 'Pominięto zdjęcie: tylko JPG i PNG do 15 MB.' : `Pominięto zdjęcia (${skipped}): tylko JPG i PNG do 15 MB.`, true);
    } catch (cause) {
      notify(driveErrorMessage(cause, 'Nie udało się dodać zdjęcia.'), true);
    }
  };

  const move = (from: number, to: number) => setPages((current) => {
    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  });

  // MARK: Wybór folderu

  const loadNode = useCallback(async (node: string) => {
    const id = ++request.current;
    setPickerNode(node);
    setListingLoading(true);
    setListingError('');
    try {
      const data = await fetchDriveListing(node);
      if (id !== request.current) return;
      setListing(data);
    } catch (cause) {
      if (id !== request.current) return;
      setListing(null);
      setListingError(driveErrorMessage(cause, 'Nie udało się otworzyć folderu.'));
    } finally {
      if (id === request.current) setListingLoading(false);
    }
  }, []);

  const openPicker = () => {
    setPicker(true);
    const parsed = target ? parseDriveNode(target.node) : null;
    void loadNode(parsed?.section === 'finance' && parsed.companyId ? driveFinanceNodeId(parsed.companyId) : 'finance');
  };

  const pathLabel = (data: DriveListing) => data.path.filter((folder) => folder.id !== 'finance').map((folder) => folder.name).join(' › ');
  const companyName = (data: DriveListing) => data.path.find((folder) => folder.kind === 'company')?.name || '';

  const pickCurrentCosts = async (companyId: string, company: string) => {
    const next = costsTarget(companyId, company);
    setListingLoading(true);
    try {
      const data = await fetchDriveListing(next.node);
      if (!data.canUpload) { notify('Dokumenty kosztowe dodaje osoba z poziomem „Finanse — zarządzanie” w tej firmie.', true); return; }
      choose(next);
    } catch (cause) {
      notify(driveErrorMessage(cause, 'Nie udało się sprawdzić folderu.'), true);
    } finally {
      setListingLoading(false);
    }
  };

  // MARK: Zapis

  const save = async () => {
    if (!target || !pages.length || saving) return;
    const costs = isCosts(target.node);
    setSaving({ text: 'Wysyłam strony', done: 0, total: pages.length });
    try {
      const result = await uploadDriveScan(target.node, pages, costs ? '' : title.trim(), (done, total, stage) => setSaving({
        text: stage === 'pages' ? `Wysyłam stronę ${Math.min(done + 1, total)} z ${total}` : costs ? 'Składam PDF i odczytuję dane dokumentu' : 'Składam PDF i zapisuję',
        done, total,
      }));
      setPages([]);
      setTitle('');
      notify(result.notice ? `Zapisano skan. ${result.notice}` : 'Zapisano skan.');
    } catch (cause) {
      notify(driveErrorMessage(cause, 'Nie udało się zapisać skanu.'), true);
    } finally {
      setSaving(null);
    }
  };

  const costs = target ? isCosts(target.node) : false;
  const parsedNode = listing ? parseDriveNode(listing.node.id) : null;
  const atCompany = listing?.node.kind === 'company' && parsedNode?.section === 'finance' && parsedNode.companyId;
  const leaf = listing ? ['ledger', 'docgroup', 'agreement'].includes(listing.node.kind) : false;
  const parentId = listing && listing.path.length > 1 ? listing.path[listing.path.length - 2].id : null;

  return (
    <View style={styles.container}>
      <ScrollView scrollEnabled={scrollEnabled} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={styles.muted}>
          Zrób zdjęcia stron dokumentu spoza KSeF (paragon, faktura zagraniczna, polisa, uchwała, aneks…) i od razu wybierz folder
          w Finansach. Ze zdjęć powstaje jeden PDF.
        </Text>

        <Text style={styles.heading}>STRONY</Text>
        {pages.length ? (
          <ReorderableList items={pages} keyOf={(page) => page.key} gap={spacing.sm} onMove={move} disabled={!!saving}
            onDragChange={(active) => setScrollEnabled(!active)}
            renderItem={(page, index, handle) => (
              <View style={styles.row}>
                {handle}
                <TouchableOpacity onPress={() => setPreview(page)} accessibilityRole="imagebutton" accessibilityLabel={`Podgląd strony ${index + 1}`}>
                  <Image source={{ uri: page.uri }} style={styles.thumb} />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={styles.body}>Strona {index + 1}</Text>
                  <Text style={styles.muted}>{(page.size / (1024 * 1024)).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB</Text>
                </View>
                <TouchableOpacity onPress={() => setPages((current) => current.filter((entry) => entry.key !== page.key))} style={styles.rowAction}
                  accessibilityRole="button" accessibilityLabel={`Usuń stronę ${index + 1}`} disabled={!!saving}>
                  <Feather name="trash-2" size={18} color={colors.status.error} />
                </TouchableOpacity>
              </View>
            )} />
        ) : (
          <View style={[styles.row, styles.empty]}>
            <Feather name="camera" size={20} color={colors.text.tertiary} />
            <Text style={[styles.muted, { flex: 1 }]}>Brak stron — zrób zdjęcie albo wybierz zdjęcia z galerii. Kolejność zmienisz, przeciągając za ≡.</Text>
          </View>
        )}
        <View style={styles.buttons}>
          <TouchableOpacity style={[styles.primary, { flex: 1 }]} onPress={() => void capture('camera')} disabled={!!saving} accessibilityRole="button">
            <Feather name="camera" size={16} color={colors.background.primary} />
            <Text style={styles.primaryText}>{pages.length ? 'Kolejna strona' : 'Zrób zdjęcie'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => void capture('library')} disabled={!!saving} accessibilityRole="button">
            <Feather name="image" size={16} color={colors.primary.gold} />
            <Text style={styles.secondaryText}>Z galerii</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.heading}>FOLDER</Text>
        <TouchableOpacity style={styles.row} onPress={openPicker} disabled={!!saving} accessibilityRole="button">
          <View style={[styles.icon, styles.center]}><Feather name="folder" size={20} color={colors.primary.gold} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.body} numberOfLines={3}>{target ? target.label : 'Wybierz folder w Finansach'}</Text>
            <Text style={styles.muted} numberOfLines={2}>
              {!target ? 'Koszty miesiąca, Dokumenty spółki albo umowa stała.'
                : costs ? 'Dokument spoza KSeF: AI odczyta dane, a dokument trafi do teczki miesiąca z jego daty.' : 'Zmień folder'}
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.text.tertiary} />
        </TouchableOpacity>

        {target && !costs ? (
          <>
            <Text style={styles.heading}>NAZWA (OPCJONALNIE)</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="np. Uchwała nr 3/2026 albo Aneks nr 2" placeholderTextColor={colors.text.tertiary}
              style={styles.input} maxLength={150} editable={!saving} />
          </>
        ) : null}

        <TouchableOpacity style={[styles.primary, styles.save, (!target || !pages.length || !!saving) && styles.disabled]} onPress={() => void save()}
          disabled={!target || !pages.length || !!saving} accessibilityRole="button">
          <Feather name="upload-cloud" size={18} color={colors.background.primary} />
          <Text style={styles.primaryText}>Zapisz skan{pages.length > 1 ? ` (${pages.length} str.)` : ''}</Text>
        </TouchableOpacity>
      </ScrollView>

      {toast ? (
        <View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + spacing.lg }, toast.error && styles.toastError]}>
          <Feather name={toast.error ? 'alert-circle' : 'check-circle'} size={18} color={toast.error ? colors.status.error : colors.primary.gold} />
          <Text style={[styles.body, { flex: 1 }]}>{toast.text}</Text>
        </View>
      ) : null}

      <Modal visible={picker} animationType="slide" onRequestClose={() => setPicker(false)} supportedOrientations={['portrait', 'landscape']}>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.pickerHeader}>
            <TouchableOpacity onPress={() => (parentId ? void loadNode(parentId) : setPicker(false))} style={styles.rowAction} accessibilityRole="button"
              accessibilityLabel={parentId ? 'Wstecz' : 'Zamknij'}>
              <Feather name={parentId ? 'chevron-left' : 'x'} size={22} color={colors.text.primary} />
            </TouchableOpacity>
            <Text style={styles.pickerTitle} numberOfLines={2}>{listing ? pathLabel(listing) || 'Finanse' : 'Finanse'}</Text>
            <TouchableOpacity onPress={() => setPicker(false)} style={styles.rowAction} accessibilityRole="button" accessibilityLabel="Zamknij">
              <Feather name="x" size={22} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}>
            {listingLoading && !listing ? <ActivityIndicator color={colors.primary.gold} style={{ marginTop: spacing.xl }} /> : null}
            {listingError ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={styles.body}>{listingError}</Text>
                <TouchableOpacity style={styles.secondary} onPress={() => void loadNode(pickerNode)} accessibilityRole="button">
                  <Feather name="refresh-cw" size={16} color={colors.primary.gold} /><Text style={styles.secondaryText}>Spróbuj ponownie</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {listing && atCompany ? (
              <TouchableOpacity style={[styles.row, styles.shortcut]} onPress={() => void pickCurrentCosts(String(parsedNode?.companyId), companyName(listing))}
                accessibilityRole="button">
                <View style={[styles.icon, styles.center]}><Feather name="zap" size={20} color={colors.primary.gold} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.body}>Koszty — {driveMonthName(currentMonth().month).slice(5)} {currentMonth().year}</Text>
                  <Text style={styles.muted}>Paragon, faktura zagraniczna, polisa — dokument spoza KSeF</Text>
                </View>
                <Feather name="check" size={16} color={colors.primary.gold} />
              </TouchableOpacity>
            ) : null}
            {listing ? listing.folders.filter(pickable).map((folder) => (
              <TouchableOpacity key={folder.id} style={styles.row} onPress={() => void loadNode(folder.id)} accessibilityRole="button">
                <View style={[styles.icon, styles.center]}><Feather name={FOLDER_ICONS[folder.kind] || 'folder'} size={20} color={colors.primary.gold} /></View>
                <Text style={[styles.body, { flex: 1 }]} numberOfLines={2}>{folder.name}</Text>
                <Feather name="chevron-right" size={16} color={colors.text.tertiary} />
              </TouchableOpacity>
            )) : null}
            {listing && leaf && !listing.canUpload ? (
              <Text style={styles.muted}>Do tego folderu dodaje pliki osoba z poziomem „Finanse — zarządzanie” w tej firmie.</Text>
            ) : null}
            {listing && !leaf && !listing.folders.filter(pickable).length && !atCompany ? <Text style={styles.muted}>Ten folder jest pusty.</Text> : null}
          </ScrollView>
          {listing?.canUpload ? (
            <View style={[styles.pickerFooter, { paddingBottom: insets.bottom + spacing.md }]}>
              <TouchableOpacity style={styles.primary} accessibilityRole="button"
                onPress={() => choose({ node: listing.node.id, label: pathLabel(listing), company: companyName(listing) })}>
                <Feather name="check" size={16} color={colors.background.primary} />
                <Text style={styles.primaryText} numberOfLines={1}>Wybierz: {listing.node.name}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {listingLoading && listing ? <View style={styles.pickerBusy}><ActivityIndicator color={colors.primary.gold} /></View> : null}
        </View>
      </Modal>

      <Modal visible={preview !== null} animationType="fade" onRequestClose={() => setPreview(null)} supportedOrientations={['portrait', 'landscape']}>
        <View style={[styles.photo, { paddingTop: insets.top }]}>
          <TouchableOpacity onPress={() => setPreview(null)} style={[styles.rowAction, { alignSelf: 'flex-end' }]} accessibilityRole="button" accessibilityLabel="Zamknij">
            <Feather name="x" size={24} color="#fff" />
          </TouchableOpacity>
          {preview ? <Image source={{ uri: preview.uri }} style={{ flex: 1 }} resizeMode="contain" /> : null}
        </View>
      </Modal>

      <Modal visible={saving !== null} transparent animationType="fade" supportedOrientations={['portrait', 'landscape']}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modal, { alignItems: 'center' }]}>
            <ActivityIndicator color={colors.primary.gold} size="large" />
            <Text style={styles.body}>{saving?.text}…</Text>
            {saving ? (
              <View style={[styles.progressTrack, { alignSelf: 'stretch' }]}>
                <View style={[styles.progressFill, { width: `${Math.round((saving.done / Math.max(1, saving.total)) * 100)}%` }]} />
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  content: { padding: spacing.md, gap: spacing.sm, width: '100%', maxWidth: 760, alignSelf: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  heading: {
    marginTop: spacing.md, color: colors.text.secondary, fontFamily: typography.fontFamilies.heading, fontSize: typography.fontSizes.xs,
    fontWeight: '400', letterSpacing: 0.4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.lg,
    backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: colors.border.default,
  },
  empty: { paddingVertical: spacing.md },
  shortcut: { borderColor: colors.primary.gold + '60', backgroundColor: colors.primary.gold + '14' },
  thumb: { width: 56, height: 72, borderRadius: borderRadius.sm, backgroundColor: colors.background.secondary },
  icon: { width: 44, height: 44, borderRadius: borderRadius.md, backgroundColor: colors.background.secondary },
  rowAction: { padding: spacing.sm },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  primary: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary.gold,
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md, borderRadius: borderRadius.md,
  },
  primaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.sm },
  secondary: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.hover,
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md, borderRadius: borderRadius.md,
  },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  save: { marginTop: spacing.lg, paddingVertical: spacing.md },
  disabled: { opacity: 0.45 },
  input: {
    borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    color: colors.text.primary, fontSize: typography.fontSizes.sm, backgroundColor: colors.background.tertiary,
  },
  toast: {
    position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    borderRadius: borderRadius.lg, backgroundColor: colors.background.elevated, borderWidth: 1, borderColor: colors.primary.gold + '50',
  },
  toastError: { borderColor: colors.status.error + '70' },
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border.default, backgroundColor: colors.background.secondary,
  },
  pickerTitle: { flex: 1, color: colors.text.primary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold },
  pickerFooter: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border.default, backgroundColor: colors.background.secondary,
  },
  pickerBusy: { position: 'absolute', top: 80, alignSelf: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: { width: '100%', maxWidth: 520, backgroundColor: colors.background.elevated, borderRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.sm },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.background.secondary, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: colors.primary.gold },
  photo: { flex: 1, backgroundColor: '#000' },
});
