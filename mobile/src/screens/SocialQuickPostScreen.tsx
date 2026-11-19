import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography } from '../theme';
import { SOCIAL_LIMITS, socialDateLabel, type SocialChannel, type SocialFormat } from '../lib/socialShared';
import {
  pickSocialPhoto, socialErrorMessage, socialGet, socialPost, uploadSocialPhoto, type PickedPhoto, type SocialAssetItem,
  type SocialEventOption, type SocialLibrary, type SocialPostDetail,
} from '../lib/socialApi';

/*
 * Szybki post lub relacja z szablonu marki (telefon): zdjęcie (aparat, galeria albo biblioteka), wydarzenie, rodzaj
 * (post 4:5, relacja 9:16 albo oba), tytuł i podpis grafiki, termin. Serwer kadruje automatycznie (propozycja z analizy
 * zdjęcia) i generuje grafiki z szablonu marki — te same pliki co w CRM i na Macu. Opis (także AI) i wysłanie do akceptacji —
 * na karcie posta, która otwiera się po utworzeniu.
 */

type Kind = 'post' | 'story' | 'both';
const KIND_LABELS: Record<Kind, string> = { post: 'Post 4:5', story: 'Relacja 9:16', both: 'Post + relacja' };
const KIND_CHANNELS: Record<Kind, SocialChannel[]> = {
  post: ['instagram_feed', 'facebook_feed'],
  story: ['instagram_story'],
  both: ['instagram_feed', 'facebook_feed', 'instagram_story'],
};
const KIND_FORMATS: Record<Kind, SocialFormat[]> = { post: ['4:5'], story: ['9:16'], both: ['4:5', '9:16'] };

export default function SocialQuickPostScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [asset, setAsset] = useState<{ id: string; thumbnailUrl: string | null } | null>(
    route.params?.assetId ? { id: route.params.assetId, thumbnailUrl: route.params.assetThumb ?? null } : null,
  );
  const [event, setEvent] = useState<{ id: string; name: string } | null>(
    route.params?.eventId ? { id: route.params.eventId, name: route.params.eventName || 'Wydarzenie' } : null,
  );
  // Marka z ekranu Social media albo — dla zdjęcia z biblioteki — marka zdjęcia (serwer sprawdza zgodność).
  const [companyId, setCompanyId] = useState<string | null>(route.params?.companyId ?? null);
  const [kind, setKind] = useState<Kind>('post');
  const [headline, setHeadline] = useState('');
  const [subline, setSubline] = useState('');
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [eventModal, setEventModal] = useState(false);
  const [libraryModal, setLibraryModal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const choosePhoto = async (source: 'camera' | 'library') => {
    try {
      const picked = await pickSocialPhoto(source);
      if (picked) { setPhoto(picked); setAsset(null); }
    } catch (cause) {
      Alert.alert('Zdjęcie', socialErrorMessage(cause, 'Nie udało się wybrać zdjęcia.'));
    }
  };

  const create = async () => {
    if (!photo && !asset) { Alert.alert('Szybki post', 'Wybierz zdjęcie.'); return; }
    try {
      let assetId = asset?.id || null;
      let targetCompany = companyId;
      if (photo) {
        setBusy('Wgrywam zdjęcie');
        const uploaded = await uploadSocialPhoto(photo, { eventId: event?.id || null, companyId: companyId || null });
        assetId = uploaded.asset?.id || uploaded.duplicateOf || null;
        if (!assetId) throw new Error('Nie udało się dodać zdjęcia do biblioteki.');
        // Zdjęcie jest już w bibliotece — dalej pracujemy na nim (bez ponownego wgrywania przy kolejnej próbie).
        targetCompany = uploaded.asset?.companyId || targetCompany;
        setAsset({ id: assetId, thumbnailUrl: uploaded.asset?.thumbnailUrl ?? photo.uri });
        setCompanyId(targetCompany);
        setPhoto(null);
      }
      setBusy('Tworzę grafiki');
      const detail = await socialPost<SocialPostDetail>('createPost', {
        companyId: targetCompany || null,
        assetId,
        eventId: event?.id || null,
        channels: KIND_CHANNELS[kind],
        formats: KIND_FORMATS[kind],
        headline: headline.trim(),
        subline: subline.trim(),
        scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
      });
      navigation.replace('SocialPost', { postId: detail.post.id });
    } catch (cause) {
      Alert.alert('Szybki post', socialErrorMessage(cause, 'Nie udało się utworzyć posta.'));
    } finally {
      setBusy(null);
    }
  };

  const preview = photo?.uri || asset?.thumbnailUrl || null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl }}>
        <Text style={styles.label}>Zdjęcie</Text>
        {preview ? <Image source={{ uri: preview }} style={styles.preview} resizeMode="cover" /> : (
          <View style={[styles.preview, styles.placeholder]}><Feather name="image" size={32} color={colors.text.tertiary} /></View>
        )}
        <View style={styles.rowButtons}>
          <TouchableOpacity style={styles.secondary} onPress={() => void choosePhoto('camera')}><Feather name="camera" size={15} color={colors.primary.gold} /><Text style={styles.secondaryText}>Aparat</Text></TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => void choosePhoto('library')}><Feather name="image" size={15} color={colors.primary.gold} /><Text style={styles.secondaryText}>Galeria</Text></TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => setLibraryModal(true)}><Feather name="grid" size={15} color={colors.primary.gold} /><Text style={styles.secondaryText}>Biblioteka</Text></TouchableOpacity>
        </View>

        <Text style={styles.label}>Wydarzenie</Text>
        <TouchableOpacity style={styles.input} onPress={() => setEventModal(true)}>
          <Text style={{ color: event ? colors.text.primary : colors.text.tertiary }}>{event?.name || 'Wybierz wydarzenie (opcjonalnie)'}</Text>
        </TouchableOpacity>

        <Text style={styles.label}>Rodzaj</Text>
        <View style={styles.rowButtons}>
          {(Object.keys(KIND_LABELS) as Kind[]).map((value) => (
            <TouchableOpacity key={value} style={[styles.chip, kind === value && styles.chipActive]} onPress={() => setKind(value)}>
              <Text style={[styles.chipText, kind === value && styles.chipTextActive]}>{KIND_LABELS[value]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Tytuł na grafice ({headline.length}/{SOCIAL_LIMITS.headlineRecommended} zalecane)</Text>
        <TextInput style={styles.input} value={headline} onChangeText={setHeadline} maxLength={SOCIAL_LIMITS.headline} placeholder="Od koncepcji po ostatni akord" placeholderTextColor={colors.text.tertiary} />
        <Text style={styles.label}>Podpis (np. realizacja · miejsce)</Text>
        <TextInput style={styles.input} value={subline} onChangeText={setSubline} maxLength={SOCIAL_LIMITS.subline} placeholder="Jubileusz 30 lat · Hotel Marina" placeholderTextColor={colors.text.tertiary} />

        <Text style={styles.label}>Termin publikacji</Text>
        <View style={styles.rowButtons}>
          <TouchableOpacity style={[styles.input, { flex: 1 }]} onPress={() => setPicker('date')}>
            <Text style={{ color: scheduledAt ? colors.text.primary : colors.text.tertiary }}>{scheduledAt ? socialDateLabel(scheduledAt.toISOString()) : 'Bez terminu'}</Text>
          </TouchableOpacity>
          {scheduledAt && <TouchableOpacity style={styles.iconButton} onPress={() => setScheduledAt(null)}><Feather name="x" size={16} color={colors.text.secondary} /></TouchableOpacity>}
        </View>
        {picker && (
          <View>
            {Platform.OS === 'ios' && (
              <TouchableOpacity onPress={() => setPicker(picker === 'date' ? 'time' : null)}><Text style={[styles.secondaryText, { textAlign: 'right' }]}>{picker === 'date' ? 'Dalej: godzina' : 'Gotowe'}</Text></TouchableOpacity>
            )}
            <DateTimePicker
              value={scheduledAt || defaultDate()}
              mode={picker}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              is24Hour
              locale="pl-PL"
              minuteInterval={5}
              themeVariant="dark"
              onChange={(changeEvent, selected) => {
                if (Platform.OS === 'android') setPicker(picker === 'date' && changeEvent.type !== 'dismissed' ? 'time' : null);
                if (changeEvent.type === 'dismissed' || !selected) return;
                setScheduledAt(selected);
              }}
            />
          </View>
        )}

        <TouchableOpacity style={styles.primary} onPress={() => void create()} disabled={busy !== null}>
          <Text style={styles.primaryText}>Utwórz post z szablonu marki</Text>
        </TouchableOpacity>
        <Text style={styles.muted}>Kadr dobierze serwer (propozycja z analizy zdjęcia) — możesz go poprawić w CRM albo na Macu. Opis, opisy AI i wysłanie do akceptacji — na następnym ekranie.</Text>
      </ScrollView>

      <EventModal visible={eventModal} companyId={companyId} onClose={() => setEventModal(false)} onPick={(value) => { setEvent({ id: value.id, name: value.name }); setEventModal(false); }} />
      <LibraryModal visible={libraryModal} companyId={companyId} onClose={() => setLibraryModal(false)} onPick={(value) => {
        setAsset({ id: value.id, thumbnailUrl: value.thumbnailUrl });
        setCompanyId(value.companyId);
        setPhoto(null);
        if (!event && value.eventId) setEvent({ id: value.eventId, name: value.eventName || 'Wydarzenie' });
        setLibraryModal(false);
      }} />
      <Modal visible={busy !== null} transparent animationType="fade">
        <View style={styles.backdrop}><View style={styles.modalCard}><ActivityIndicator color={colors.primary.gold} size="large" /><Text style={styles.body}>{busy}…</Text></View></View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function defaultDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(18, 0, 0, 0);
  return date;
}

function EventModal({ visible, companyId, onClose, onPick }: {
  visible: boolean; companyId: string | null; onClose: () => void; onPick: (event: SocialEventOption) => void;
}) {
  const [query, setQuery] = useState('');
  const [events, setEvents] = useState<SocialEventOption[] | null>(null);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      socialGet<{ events: SocialEventOption[] }>('events', { company: companyId, q: query.trim() })
        .then((result) => setEvents(result.events))
        .catch(() => setEvents([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [visible, query, companyId]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: Platform.OS === 'ios' ? 50 : spacing.md }]}>
        <View style={styles.modalHeader}>
          <Text style={styles.title}>Wydarzenie</Text>
          <TouchableOpacity onPress={onClose}><Feather name="x" size={22} color={colors.text.primary} /></TouchableOpacity>
        </View>
        <TextInput style={[styles.input, { marginHorizontal: spacing.md }]} value={query} onChangeText={setQuery} placeholder="Szukaj wydarzenia" placeholderTextColor={colors.text.tertiary} />
        {!events ? <ActivityIndicator color={colors.primary.gold} style={{ marginTop: spacing.lg }} /> : (
          <FlatList data={events} keyExtractor={(item) => item.id} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
            ListEmptyComponent={<Text style={styles.muted}>Brak wydarzeń.</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.listRow} onPress={() => onPick(item)}>
                <Text style={styles.body}>{item.name}</Text>
                <Text style={styles.muted}>{[item.date ? new Date(item.date).toLocaleDateString('pl-PL') : null, item.location, item.organizationName].filter(Boolean).join(' · ')}</Text>
              </TouchableOpacity>
            )} />
        )}
      </View>
    </Modal>
  );
}

function LibraryModal({ visible, companyId, onClose, onPick }: {
  visible: boolean; companyId: string | null; onClose: () => void; onPick: (asset: SocialAssetItem) => void;
}) {
  const [library, setLibrary] = useState<SocialLibrary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!visible) return;
    socialGet<SocialLibrary>('library', { company: companyId, status: 'ready', limit: '60' })
      .then((result) => { setLibrary(result); setError(''); })
      .catch((cause) => setError(socialErrorMessage(cause, 'Nie udało się pobrać biblioteki.')));
  }, [visible, companyId]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: Platform.OS === 'ios' ? 50 : spacing.md }]}>
        <View style={styles.modalHeader}>
          <Text style={styles.title}>Biblioteka</Text>
          <TouchableOpacity onPress={onClose}><Feather name="x" size={22} color={colors.text.primary} /></TouchableOpacity>
        </View>
        {error ? <Text style={[styles.muted, { padding: spacing.md }]}>{error}</Text> : !library ? <ActivityIndicator color={colors.primary.gold} style={{ marginTop: spacing.lg }} /> : (
          <FlatList data={library.assets} numColumns={3} keyExtractor={(item) => item.id} contentContainerStyle={{ padding: spacing.sm }}
            ListEmptyComponent={<Text style={styles.muted}>Biblioteka jest pusta.</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={{ width: '33.33%', padding: 3 }} onPress={() => onPick(item)}>
                {item.thumbnailUrl ? <Image source={{ uri: item.thumbnailUrl }} style={{ width: '100%', aspectRatio: 0.8, borderRadius: borderRadius.sm }} /> : <View style={{ width: '100%', aspectRatio: 0.8, backgroundColor: colors.background.tertiary }} />}
              </TouchableOpacity>
            )} />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  label: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, marginBottom: -spacing.sm },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.medium },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  preview: { width: '100%', aspectRatio: 0.8, borderRadius: borderRadius.lg },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.tertiary },
  rowButtons: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md, padding: spacing.sm, color: colors.text.primary, backgroundColor: colors.background.tertiary, fontSize: typography.fontSizes.sm, minHeight: 42, justifyContent: 'center' },
  iconButton: { padding: spacing.sm },
  secondary: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.hover, paddingVertical: spacing.sm, borderRadius: borderRadius.md },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  chip: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.background.secondary },
  chipActive: { backgroundColor: 'rgba(211,187,115,0.18)' },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  chipTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  primary: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary.gold, paddingVertical: spacing.md, borderRadius: borderRadius.md },
  primaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { backgroundColor: colors.background.elevated, borderRadius: borderRadius.xl, padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md },
  listRow: { padding: spacing.md, borderRadius: borderRadius.md, backgroundColor: colors.background.secondary, gap: 4 },
});
