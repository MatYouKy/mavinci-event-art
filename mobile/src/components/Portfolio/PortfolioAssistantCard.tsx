import React, { useState } from 'react';
import { Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { portfolioWithAlts, portfolioWithTitle, type PortfolioContent } from '../../lib/portfolioShared';
import { portfolioErrorMessage, portfolioPost, type PortfolioAiResult } from '../../lib/portfolioApi';

/*
 * Asystent AI realizacji (jak w CRM i na Macu): z notatki (wspólnej z przyciskami AI przy sekcjach) i danych realizacji
 * przygotowuje naraz kilka pól — tytuł, opisy, opis w Google, słowa kluczowe, elementy realizacji i opisy zdjęć. Propozycje nie
 * zmieniają realizacji, dopóki ich nie użyjesz.
 */

type Field = 'title' | 'description' | 'detailedDescription' | 'metaDescription' | 'keywords' | 'features' | 'alts';
const FIELDS: Array<[Field, string]> = [
  ['title', 'Tytuł'], ['description', 'Krótki opis'], ['detailedDescription', 'Szczegółowy opis'], ['metaDescription', 'Opis w Google'],
  ['keywords', 'Słowa kluczowe'], ['features', 'Elementy realizacji'], ['alts', 'Opisy zdjęć (alt)'],
];

export function portfolioAiPatch(field: Field, value: PortfolioAiResult, content: PortfolioContent, onSite = true): Partial<PortfolioContent> | null {
  switch (field) {
    case 'title': return value.title ? portfolioWithTitle(content, value.title, onSite) : null;
    case 'description': return value.description ? { description: value.description } : null;
    case 'detailedDescription': return value.detailedDescription ? { detailedDescription: value.detailedDescription } : null;
    case 'metaDescription': return value.metaDescription ? { metaDescription: value.metaDescription } : null;
    case 'keywords': return value.keywords?.length ? { keywords: value.keywords } : null;
    case 'features': return value.features?.length ? { features: value.features } : null;
    case 'alts': return value.alts?.length ? portfolioWithAlts(content, value.alts, true).patch : null;
    default: return null;
  }
}

export default function PortfolioAssistantCard({ itemId, content, eventId, onSite, brief, onBrief, onBusy, onApply }: {
  itemId: string;
  content: PortfolioContent;
  eventId: string | null;
  /** Realizacja na stronie — adres strony nie idzie za nowym tytułem. */
  onSite: boolean;
  brief: string;
  onBrief: (value: string) => void;
  onBusy: (label: string | null) => void;
  onApply: (patch: Partial<PortfolioContent>) => void;
}) {
  const [fields, setFields] = useState<Field[]>(['description', 'detailedDescription', 'metaDescription', 'keywords']);
  const [usePhotos, setUsePhotos] = useState(false);
  const [result, setResult] = useState<PortfolioAiResult | null>(null);
  const photos = (content.image ? 1 : 0) + content.gallery.length;

  const ask = async () => {
    onBusy('Asystent AI pisze');
    try {
      const ordered = FIELDS.map(([field]) => field).filter((field) => fields.includes(field));
      setResult(await portfolioPost<PortfolioAiResult>('assist', { id: itemId, content, eventId, brief, fields: ordered, usePhotos: usePhotos && photos > 0 }));
    } catch (cause) {
      Alert.alert('Asystent AI', portfolioErrorMessage(cause, 'Asystent AI nie odpowiedział. Spróbuj ponownie.'));
    } finally {
      onBusy(null);
    }
  };

  const preview = (field: Field): string => {
    if (!result) return '';
    switch (field) {
      case 'keywords': return (result.keywords || []).join(', ');
      case 'features': return (result.features || []).map((item) => `${item.title}${item.description ? ` — ${item.description}` : ''}`).join('\n');
      case 'alts': return result.alts?.length ? `${result.alts.length} opisów zdjęć` : '';
      default: return String(result[field] || '');
    }
  };

  const use = (field: Field) => {
    if (!result) return;
    const patch = portfolioAiPatch(field, result, content, onSite);
    if (patch) { onApply(patch); Alert.alert('Asystent AI', 'Wstawiono propozycję — zapisz realizację.'); }
  };

  const useAll = () => {
    if (!result) return;
    const patch = FIELDS.reduce<Partial<PortfolioContent>>((all, [field]) => ({ ...all, ...(portfolioAiPatch(field, result, content, onSite) || {}) }), {});
    onApply(patch);
    Alert.alert('Asystent AI', 'Wstawiono wszystkie propozycje — zapisz realizację.');
  };

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Feather name="star" size={16} color={colors.primary.gold} />
        <Text style={styles.title}>Asystent AI</Text>
      </View>
      <Text style={styles.muted}>Kilka pól naraz. Pojedyncze sekcje — przyciski AI przy tytule, opisach, elementach, SEO i zdjęciach.</Text>
      <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]} value={brief} onChangeText={(value) => onBrief(value.slice(0, 1500))} multiline
        placeholder="Notatka dla asystenta (ta sama co w „Podstawach”): dla kogo, co przygotowaliśmy, co było wyjątkowe." placeholderTextColor={colors.text.tertiary} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {FIELDS.map(([field, label]) => {
          const active = fields.includes(field);
          return (
            <TouchableOpacity key={field} style={[styles.chip, active && styles.chipActive]}
              onPress={() => setFields((current) => (active ? current.filter((item) => item !== field) : [...current, field]))}>
              {active && <Feather name="check" size={12} color={colors.primary.gold} />}
              <Text style={[styles.chipText, active && { color: colors.primary.gold }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Switch value={usePhotos && photos > 0} disabled={!photos} onValueChange={setUsePhotos}
          trackColor={{ true: colors.primary.gold, false: colors.border.hover }} />
        <Text style={[styles.muted, { flex: 1 }]}>Uwzględnij zdjęcia (opis tego, co na nich widać; przy opisach zdjęć — zawsze)</Text>
      </View>
      <TouchableOpacity style={[styles.secondary, !fields.length && { opacity: 0.5 }]} disabled={!fields.length} onPress={() => { void ask(); }}>
        <Feather name="edit-3" size={16} color={colors.primary.gold} />
        <Text style={styles.secondaryText}>Przygotuj teksty</Text>
      </TouchableOpacity>
      {result && (
        <View style={{ gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border.default, paddingTop: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={styles.muted}>Propozycje{result.usedPhotos ? ' (ze zdjęciami)' : ''}</Text>
            <TouchableOpacity onPress={useAll}><Text style={styles.link}>Użyj wszystkich</Text></TouchableOpacity>
          </View>
          {FIELDS.filter(([field]) => preview(field)).map(([field, label]) => (
            <View key={field} style={styles.proposal}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[styles.muted, { color: colors.primary.gold }]}>{label}</Text>
                <TouchableOpacity onPress={() => use(field)}><Text style={styles.link}>Użyj</Text></TouchableOpacity>
              </View>
              <Text style={styles.body} selectable>{preview(field)}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={styles.muted}>Do AI trafia treść realizacji, rodzaj, miejsce i data eventu oraz — gdy zaznaczysz — zdjęcia ze strony. Bez danych osobowych.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary, borderWidth: 1, borderColor: colors.border.default },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.medium },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm, lineHeight: 20 },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  link: { color: colors.primary.gold, fontSize: typography.fontSizes.xs },
  input: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md, padding: spacing.sm, color: colors.text.primary, backgroundColor: colors.background.tertiary, fontSize: typography.fontSizes.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.border.default },
  chipActive: { borderColor: colors.primary.gold, backgroundColor: 'rgba(211,187,115,0.15)' },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  secondary: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.hover, paddingVertical: spacing.sm + 2, borderRadius: borderRadius.md },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  proposal: { gap: 4, padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary },
});
