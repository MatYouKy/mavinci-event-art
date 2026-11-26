import React from 'react';
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import BrandHeading from '../BrandHeading';
import { SmallButton } from '../Inquiries/InquiryKit';
import {
  PURCHASE_COST_STATUS_LABELS, PURCHASE_STATUS_COLORS, PURCHASE_STATUS_LABELS, purchaseDay, purchaseKindLabel, purchaseMethodLabel,
  purchaseMoney, purchaseMonthEditable, purchaseSettlementStatus, purchaseTotals, purchaseTotalsText,
  type PurchaseDocument, type PurchaseMonth, type PurchaseMonthCompany, type PurchaseSettlementStatus,
} from '../../lib/purchaseShared';
import type { PurchaseAsset } from '../../lib/purchasesApi';
import { borderRadius, colors, glow, spacing, tone, typography, withAlpha } from '../../theme';

/*
 * Wspólne elementy Zakupów w telefonie: znacznik stanu rozliczenia (kolory jak w CRM i na Macu), miesiąc pracownika
 * (rozliczenie każdej działalności z czynnościami i dokumenty — jak `PurchaseMonthView` w CRM), wybór zdjęć / pliku
 * (aparat, galeria, Pliki) i podgląd pliku dokumentu.
 */

export function PurchaseStatusBadge({ status }: { status: PurchaseSettlementStatus }) {
  const color = PURCHASE_STATUS_COLORS[status];
  return <Text style={[pui.badge, { color: tone(color), backgroundColor: withAlpha(color, 0.15) }]}>{PURCHASE_STATUS_LABELS[status]}</Text>;
}

/** Miesiąc pracownika: rozliczenie każdej działalności (stan, sumy, uwagi, czynności) i dokumenty. */
export function PurchaseMonthSections({ month, futureMonth, onDocument, onSubmit, onDecide }: {
  month: PurchaseMonth;
  futureMonth: boolean;
  /** Dotknięcie dokumentu (plik, poprawka, usunięcie — według stanu miesiąca). */
  onDocument: (document: PurchaseDocument, editable: boolean) => void;
  onSubmit?: (company: PurchaseMonthCompany) => void;
  onDecide?: (company: PurchaseMonthCompany, approve: boolean) => void;
}) {
  const companies = month.companies.filter((company) => company.can_record || company.can_approve || company.settlement
    || month.documents.some((document) => document.company_id === company.id));
  if (!companies.length) return <Text style={pui.muted}>Brak działalności, w których możesz rozliczać zakupy.</Text>;
  return (
    <View style={pui.gap}>
      {companies.map((company) => {
        const documents = month.documents.filter((document) => document.company_id === company.id);
        const status = purchaseSettlementStatus(company);
        const editable = purchaseMonthEditable(status);
        const missing = documents.filter((document) => !document.has_file).length;
        const settlement = company.settlement;
        const summary = [
          `${documents.length} dok. · razem ${purchaseTotalsText(purchaseTotals(documents))}`,
          settlement?.submitted_at ? `wysłane ${purchaseDay(settlement.submitted_at)}` : '',
          settlement?.decided_at && status !== 'submitted'
            ? `decyzja ${purchaseDay(settlement.decided_at)}${settlement.decided_by_name ? ` (${settlement.decided_by_name})` : ''}` : '',
        ].filter(Boolean).join(' · ');
        return (
          <View key={company.id} style={pui.card}>
            <View style={pui.between}>
              <BrandHeading style={[pui.cardTitle, pui.flex]}>{company.name}</BrandHeading>
              <PurchaseStatusBadge status={status} />
            </View>
            <Text style={pui.muted}>{summary}</Text>
            {settlement?.employee_note ? <Text style={pui.muted}>Uwaga pracownika: {settlement.employee_note}</Text> : null}
            {settlement?.decision_note ? (
              <View style={status === 'returned' ? pui.warnWell : pui.well}>
                <Text style={status === 'returned' ? pui.warning : pui.textSm}>{status === 'returned' ? 'Do poprawy: ' : 'Uwaga: '}{settlement.decision_note}</Text>
              </View>
            ) : null}
            {month.self && editable && missing > 0 ? (
              <Text style={pui.warning}>Bez pliku: {missing} dok. — dodaj zdjęcie albo skan, zanim wyślesz rozliczenie.</Text>
            ) : null}
            {month.self && onSubmit && company.can_record && editable ? (
              <SmallButton label={status === 'returned' ? 'Wyślij ponownie' : 'Wyślij rozliczenie'} icon="send" primary
                disabled={futureMonth || documents.length === 0 || missing > 0} onPress={() => onSubmit(company)} />
            ) : null}
            {!month.self && onDecide && company.can_approve && settlement && status === 'submitted' ? (
              <View style={pui.wrap}>
                <SmallButton label="Zatwierdź" icon="check-circle" primary onPress={() => onDecide(company, true)} />
                <SmallButton label="Zwróć do poprawy" icon="corner-up-left" onPress={() => onDecide(company, false)} />
              </View>
            ) : null}
            {!month.self && onDecide && company.can_approve && settlement && status === 'approved' ? (
              <SmallButton label="Cofnij zatwierdzenie" icon="corner-up-left" onPress={() => onDecide(company, false)} />
            ) : null}
            {documents.length === 0 ? <Text style={pui.muted}>Brak zakupów w tym miesiącu.</Text> : documents.map((document) => (
              <PurchaseDocumentRow key={document.id} document={document} onPress={() => onDocument(document, month.self && editable)} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function PurchaseDocumentRow({ document, onPress }: { document: PurchaseDocument; onPress: () => void }) {
  const event = document.event;
  return (
    <TouchableOpacity style={pui.line} onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${purchaseKindLabel(document.kind)} ${document.number}, ${document.seller_name}`}>
      <View style={pui.between}>
        <Text style={[pui.textSm, pui.bold, pui.flex]} numberOfLines={1}>{purchaseKindLabel(document.kind)} {document.number}</Text>
        <Text style={pui.money}>{purchaseMoney(document.gross, document.currency)}</Text>
      </View>
      <Text style={pui.textSm} numberOfLines={1}>{document.seller_name}{document.seller_nip ? ` · NIP ${document.seller_nip}` : ''}</Text>
      <Text style={pui.mutedXs} numberOfLines={2}>
        {[purchaseDay(document.date), document.label, document.category_name].filter(Boolean).join(' · ')}
      </Text>
      {event ? (
        <View style={pui.row}>
          <Feather name="calendar" size={13} color={colors.primary.gold} />
          <Text style={[pui.mutedXs, pui.flex]} numberOfLines={2}>
            <Text style={pui.textXs}>{event.name}</Text>
            {` · ${purchaseMoney(event.amount)}${event.category_name ? ` · ${event.category_name}` : ''}`}
            {event.status ? ` · ${PURCHASE_COST_STATUS_LABELS[event.status] || event.status}` : ''}
          </Text>
        </View>
      ) : null}
      <View style={pui.wrap}>
        <Feather name="credit-card" size={12} color={colors.text.tertiary} />
        <Text style={pui.mutedXs}>{purchaseMethodLabel(document.payment_method)}</Text>
        <Text style={document.bank_matched ? pui.successXs : pui.mutedXs}>· {document.bank_matched ? 'Powiązany z wyciągiem' : 'Czeka na wyciąg'}</Text>
        {!document.has_file ? <Text style={pui.warningXs}>· bez pliku</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

// MARK: Zdjęcia i pliki

export type PurchasePickSource = 'camera' | 'library' | 'files';

const MIME_BY_EXTENSION: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

async function sizeOf(uri: string, known?: number | null): Promise<number> {
  if (known && known > 0) return known;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && 'size' in info ? Number(info.size) || 0 : 0;
  } catch {
    return 0;
  }
}

/**
 * Zdjęcia z aparatu (jedno) / galerii (do `room`) albo plik z „Plików” (PDF lub zdjęcie). Zdjęcia w formacie zgodnym (JPEG) —
 * jak w skanerze dokumentów. `skipped` — pominięte pliki w innym formacie.
 */
export async function pickPurchaseAssets(source: PurchasePickSource, room: number): Promise<{ assets: PurchaseAsset[]; skipped: number }> {
  const raw: Array<{ uri: string; name?: string | null; mimeType?: string | null; size?: number | null }> = [];
  if (source === 'files') {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], multiple: false, copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return { assets: [], skipped: 0 };
    raw.push(...result.assets.slice(0, 1).map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? null, size: asset.size ?? null })));
  } else {
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new Error(source === 'camera' ? 'Aby zrobić zdjęcie, zezwól aplikacji na dostęp do aparatu w ustawieniach.' : 'Zezwól aplikacji na dostęp do zdjęć w ustawieniach.');
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'], quality: 0.6, exif: false,
      allowsMultipleSelection: source === 'library' && room > 1, selectionLimit: source === 'library' ? room : 1,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.length) return { assets: [], skipped: 0 };
    raw.push(...result.assets.slice(0, room).map((asset) => ({ uri: asset.uri, name: asset.fileName ?? null, mimeType: asset.mimeType ?? null, size: asset.fileSize ?? null })));
  }
  const assets: PurchaseAsset[] = [];
  let skipped = 0;
  for (const [index, item] of raw.entries()) {
    const fileName = item.name || item.uri.split('?')[0].split('/').pop() || '';
    const extension = fileName.includes('.') ? (fileName.split('.').pop() || '').toLowerCase() : '';
    const mimeType = item.mimeType || MIME_BY_EXTENSION[extension] || '';
    const size = await sizeOf(item.uri, item.size);
    if (!ACCEPTED.has(mimeType) || !size) { skipped += 1; continue; }
    const name = extension ? fileName : `${mimeType === 'application/pdf' ? 'dokument' : `strona-${index + 1}`}.${mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg'}`;
    assets.push({ uri: item.uri, name, mimeType, size });
  }
  return { assets, skipped };
}

/** Plik dokumentu (podpisany adres): PDF i zdjęcia w podglądzie (iOS), na Androidzie — w przeglądarce. */
export function openPurchaseUrl(navigation: { navigate: (screen: string, params?: object) => void }, url: string, title: string) {
  if (Platform.OS === 'ios') navigation.navigate('PdfViewer', { url, title });
  else void Linking.openURL(url).catch(() => undefined);
}

export const pui = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.full,
    fontSize: 11, fontWeight: typography.fontWeights.semibold,
  },
  card: {
    gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary,
    borderWidth: 1, borderColor: colors.border.default,
  },
  cardTitle: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontFamily: typography.fontFamilies.heading },
  gap: { gap: spacing.md },
  flex: { flex: 1 },
  bold: { fontWeight: typography.fontWeights.semibold },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  between: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  line: { gap: 3, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glow(0.12) },
  text: { color: colors.text.primary, fontSize: typography.fontSizes.md },
  textSm: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  textXs: { color: colors.text.primary, fontSize: typography.fontSizes.xs },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm },
  mutedXs: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  money: { color: colors.text.primary, fontSize: typography.fontSizes.sm, fontVariant: ['tabular-nums'] },
  warning: { color: tone('#f59e0b'), fontSize: typography.fontSizes.sm },
  warningXs: { color: tone('#f59e0b'), fontSize: typography.fontSizes.xs },
  successXs: { color: tone('#34d399'), fontSize: typography.fontSizes.xs },
  well: { padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: glow(0.05) },
  warnWell: { gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: withAlpha('#f59e0b', 0.1) },
  label: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textTransform: 'uppercase' },
});
