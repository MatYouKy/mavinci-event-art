import React, { type ReactNode } from 'react';
import { Alert, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import BrandHeading from '../BrandHeading';
import { RENTAL_STATUS_LABELS, rentalDateTime, type RentalConflict, type RentalStatus, type RentalVehicleConflict } from '../../lib/rental';
import type { RentalAsset } from '../../lib/rentalApi';
import { borderRadius, colors, glow, shade, spacing, tone, typography, withAlpha } from '../../theme';

/*
 * Wspólne elementy Rentalu w telefonie: znacznik statusu (kolory jak w CRM i na Macu), karta sekcji z nagłówkiem fontem marki,
 * liczby z przecinkiem, opis konfliktu terminu, wybór zdjęcia / pliku (aparat, galeria, Pliki) i otwarcie pliku z magazynu.
 */

export const RENTAL_STATUS_COLORS: Record<RentalStatus, string> = {
  draft: '#9ca3af', reserved: '#7dd3fc', issued: '#d3bb73', returned: '#6ee7b7', settled: '#34d399', cancelled: '#fca5a5',
};

export function RentalStatusBadge({ status }: { status: RentalStatus }) {
  const color = tone(RENTAL_STATUS_COLORS[status]);
  return <Text style={[ui.badge, { color, backgroundColor: withAlpha(RENTAL_STATUS_COLORS[status], 0.15) }]}>{RENTAL_STATUS_LABELS[status]}</Text>;
}

export function RentalPill({ label, color }: { label: string; color: string }) {
  return <Text style={[ui.badge, { color: tone(color), backgroundColor: withAlpha(color, 0.15) }]}>{label}</Text>;
}

/** Karta sekcji karty wypożyczenia (nagłówek wersalikami, krój regularny — jak w CRM). */
export function RentalCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={ui.card}>
      <View style={ui.cardHeader}>
        <BrandHeading style={ui.cardTitle}>{title}</BrandHeading>
        {action ?? null}
      </View>
      {children}
    </View>
  );
}

/** Liczba wpisana z przecinkiem albo kropką; puste pole — `null`. */
export function rentalNumber(text: string): number | null {
  const clean = text.replace(/\s/g, '').replace(',', '.');
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

/** Liczba całkowita ≥ 0 z pola (puste — 0). */
export const rentalCount = (text: string) => Math.max(0, Math.floor(rentalNumber(text) ?? 0));

/** Liczba do pola edycji (bez zbędnych zer, z przecinkiem). */
export function rentalPlain(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '';
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace('.', ',');
}

/** Konflikt terminu (sprzętu albo pojazdu): „Event: nazwa · od – do · N szt.”. */
export function rentalConflictText(conflict: RentalConflict | RentalVehicleConflict, openEnd: string) {
  const qty = 'qty' in conflict && conflict.qty ? ` · ${conflict.qty} szt.` : '';
  const end = conflict.ends_at ? ` – ${rentalDateTime(conflict.ends_at)}` : openEnd;
  return `${conflict.type === 'event' ? 'Event' : 'Wypożyczenie'}: ${conflict.name} · ${rentalDateTime(conflict.starts_at)}${end}${qty}`;
}

export type RentalPickSource = 'camera' | 'library' | 'files';

/** Zdjęcia z aparatu / galerii albo pliki (PDF, zdjęcia) z „Plików”; brak zgody — błąd z prośbą o dostęp. */
export async function pickRentalAssets(source: RentalPickSource, limit = 10): Promise<RentalAsset[]> {
  if (source === 'files') {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], multiple: limit > 1, copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return [];
    return result.assets.slice(0, limit).map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? null }));
  }
  const permission = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error(source === 'camera' ? 'Zezwól aplikacji na dostęp do aparatu.' : 'Zezwól aplikacji na dostęp do zdjęć.');
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, exif: false })
    : await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, allowsMultipleSelection: limit > 1, selectionLimit: limit,
    });
  if (result.canceled || !result.assets?.length) return [];
  return result.assets.slice(0, limit).map((asset) => ({ uri: asset.uri, fileName: asset.fileName ?? null, mimeType: asset.mimeType ?? null }));
}

/** Pytanie o źródło: aparat, galeria, opcjonalnie Pliki. */
export function chooseRentalSource(title: string, onPick: (source: RentalPickSource) => void, files = false) {
  Alert.alert(title, 'Wybierz źródło.', [
    { text: 'Zrób zdjęcie', onPress: () => onPick('camera') },
    { text: 'Wybierz z galerii', onPress: () => onPick('library') },
    ...(files ? [{ text: 'Wybierz plik', onPress: () => onPick('files') }] : []),
    { text: 'Anuluj', style: 'cancel' as const },
  ]);
}

/** Plik z magazynu (podpisany adres): PDF i zdjęcia w podglądzie (iOS), inne — w przeglądarce. */
export function openRentalUrl(navigation: { navigate: (screen: string, params?: object) => void }, url: string, title: string, mime: string | null) {
  const previewable = !mime || mime === 'application/pdf' || mime.startsWith('image/');
  if (Platform.OS === 'ios' && previewable) navigation.navigate('PdfViewer', { url, title });
  else void Linking.openURL(url).catch(() => undefined);
}

export const ui = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.full,
    fontSize: 11, fontWeight: typography.fontWeights.semibold,
  },
  card: {
    gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary,
    borderWidth: 1, borderColor: colors.border.default,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' },
  cardTitle: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontFamily: typography.fontFamilies.heading },
  text: { color: colors.text.primary, fontSize: typography.fontSizes.md },
  textSm: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm },
  mutedXs: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  gold: { color: colors.primary.gold },
  warning: { color: tone('#f59e0b'), fontSize: typography.fontSizes.sm },
  danger: { color: tone('#fca5a5'), fontSize: typography.fontSizes.sm },
  success: { color: tone('#34d399'), fontSize: typography.fontSizes.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  between: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  flex: { flex: 1 },
  line: { gap: 2, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: glow(0.1) },
  well: { gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: shade(0.2) },
  warnWell: { gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: withAlpha('#f59e0b', 0.1) },
  okWell: { gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: withAlpha('#34d399', 0.12) },
  link: { color: colors.primary.gold, fontSize: typography.fontSizes.sm, textDecorationLine: 'underline' },
  label: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textTransform: 'uppercase' },
  money: { color: colors.text.primary, fontSize: typography.fontSizes.sm, fontVariant: ['tabular-nums'] },
});
