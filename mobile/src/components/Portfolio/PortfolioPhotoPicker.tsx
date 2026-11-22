import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, FlatList, Image, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { portfolioErrorMessage, portfolioGet, type PortfolioPhotoOption, type PortfolioPhotoSource } from '../../lib/portfolioApi';

/*
 * Zdjęcia do realizacji (jak w CRM i na Macu): pliki powiązanego wydarzenia, Materiały albo biblioteka social media
 * (wyszukiwanie po nazwie), zaznaczanie wielu. Zaznaczone serwer zamienia na wersje strony (WebP); oryginały zostają w źródle.
 */

const SOURCES: Array<[PortfolioPhotoSource, string, keyof typeof Feather.glyphMap]> = [
  ['event', 'Event', 'folder'],
  ['material', 'Materiały', 'archive'],
  ['social', 'Social media', 'image'],
];

export default function PortfolioPhotoPicker({ visible, initialSource, eventId, eventName, onClose, onPick }: {
  visible: boolean;
  initialSource: PortfolioPhotoSource;
  eventId: string | null;
  eventName: string | null;
  onClose: () => void;
  onPick: (source: PortfolioPhotoSource, photos: PortfolioPhotoOption[]) => void;
}) {
  const [source, setSource] = useState<PortfolioPhotoSource>(initialSource);
  const [query, setQuery] = useState('');
  const [photos, setPhotos] = useState<PortfolioPhotoOption[]>([]);
  const [problem, setProblem] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const size = Math.floor((Dimensions.get('window').width - spacing.lg * 2 - spacing.xs * 2) / 3);

  useEffect(() => {
    if (visible) { setSource(initialSource); setSelected([]); setQuery(''); }
  }, [visible, initialSource]);

  useEffect(() => {
    if (!visible) return;
    if (source === 'event' && !eventId) {
      setPhotos([]);
      setProblem('Powiąż realizację z eventem, żeby wybrać zdjęcia z jego plików.');
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await portfolioGet<{ photos: PortfolioPhotoOption[]; problem?: string }>('photos', {
          source, event: eventId, q: source === 'event' ? null : query.trim(),
        });
        if (!active) return;
        setPhotos(data.photos);
        setProblem(data.problem || (data.photos.length ? '' : source === 'event' ? 'Event nie ma zdjęć w plikach (JPEG, PNG, WebP).' : 'Brak zdjęć.'));
      } catch (cause) {
        if (active) { setPhotos([]); setProblem(portfolioErrorMessage(cause, 'Nie udało się pobrać zdjęć.')); }
      } finally {
        if (active) setLoading(false);
      }
    }, source === 'event' || !query ? 0 : 300);
    return () => { active = false; clearTimeout(timer); };
  }, [visible, source, query, eventId]);

  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Dodaj zdjęcia</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}><Feather name="x" size={22} color={colors.text.primary} /></TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {SOURCES.map(([key, label, icon]) => (
              <TouchableOpacity key={key} onPress={() => { setSource(key); setSelected([]); }} style={[styles.chip, source === key && styles.chipActive]}>
                <Feather name={icon} size={14} color={source === key ? colors.primary.gold : colors.text.secondary} />
                <Text style={[styles.chipText, source === key && { color: colors.primary.gold }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {source === 'event'
            ? (eventName ? <Text style={styles.muted}>Event: {eventName}</Text> : null)
            : <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="Szukaj po nazwie" placeholderTextColor={colors.text.tertiary} />}
          {loading && <ActivityIndicator color={colors.primary.gold} />}
          {!!problem && !loading && <Text style={styles.muted}>{problem}</Text>}
          <FlatList
            data={photos}
            keyExtractor={(photo) => photo.id}
            numColumns={3}
            columnWrapperStyle={{ gap: spacing.xs }}
            contentContainerStyle={{ gap: spacing.xs }}
            style={{ flexGrow: 0, maxHeight: Dimensions.get('window').height * 0.5 }}
            renderItem={({ item }) => {
              const active = selected.includes(item.id);
              return (
                <TouchableOpacity onPress={() => toggle(item.id)} style={[styles.tile, { width: size, height: size }, active && { borderColor: colors.primary.gold }]}>
                  {item.thumbnailUrl
                    ? <Image source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} />
                    : <Feather name="image" size={20} color={colors.text.tertiary} />}
                  {active && <View style={styles.check}><Feather name="check" size={14} color={colors.background.primary} /></View>}
                </TouchableOpacity>
              );
            }}
          />
          <Text style={styles.muted}>Zdjęcia trafią na stronę w trzech rozmiarach (WebP). Oryginały zostają w źródle.</Text>
          <TouchableOpacity style={[styles.primary, !selected.length && { opacity: 0.5 }]} disabled={!selected.length}
            onPress={() => onPick(source, selected.map((id) => photos.find((photo) => photo.id === id)).filter((photo): photo is PortfolioPhotoOption => Boolean(photo)))}>
            <Text style={styles.primaryText}>Dodaj zaznaczone ({selected.length})</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background.elevated, borderTopLeftRadius: borderRadius.xl, borderTopRightRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.sm, maxHeight: '92%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.medium },
  input: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md, padding: spacing.sm, color: colors.text.primary, backgroundColor: colors.background.tertiary, fontSize: typography.fontSizes.sm },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.default },
  chipActive: { borderColor: colors.primary.gold, backgroundColor: 'rgba(211,187,115,0.12)' },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  tile: { borderRadius: borderRadius.md, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.tertiary },
  check: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary.gold, alignItems: 'center', justifyContent: 'center' },
  primary: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary.gold, paddingVertical: spacing.md, borderRadius: borderRadius.md },
  primaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.sm },
});
