import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography } from '../theme';
import {
  SOCIAL_CHANNEL_LABELS, socialConsentAllows, socialDateLabel, socialPostStatusLabel, type SocialChannel, type SocialPostStatus,
} from '../lib/socialShared';
import SocialCommentsList from '../components/Social/SocialCommentsList';
import SocialStatsView from '../components/Social/SocialStatsView';
import {
  pickSocialPhoto, socialCanvasLabel, socialErrorMessage, socialGet, socialManualChannel, socialPost, uploadSocialPhoto, type SocialAssetItem, type SocialHome,
  type SocialLibrary, type SocialPostDetail, type SocialPostItem,
} from '../lib/socialApi';
import { LibraryModal } from './SocialQuickPostScreen';

/*
 * Marketing → „Social media” w aplikacji: „Do akceptacji” (posty czekające na akceptującego, do poprawy u autora i z błędem
 * publikacji), „Plan” (posty z terminem i szkice), „Biblioteka” (zdjęcia marki i propozycje z wydarzeń) i „Komentarze”
 * (Facebook i Instagram, odpowiedzi jako marka) i „Statystyki” (wyniki z Meta, najlepsze pory, raport tygodniowy „Trendy
 * i rekomendacje”). Szybki post lub relacja z szablonu marki — ekran „Szybki post”; siatka profilu / panorama z wybranego zdjęcia
 * (przycisk siatki w nagłówku albo zdjęcie w bibliotece; kształt i układ — na karcie posta); post — karta
 * z grafikami z serwera (te same pliki co w CRM i na Macu). Dane i zapis przez `/bridge/native/v1/social` (uprawnienia jak w CRM).
 */

type Segment = 'review' | 'plan' | 'library' | 'comments' | 'stats';

export const POST_STATUS_COLORS: Record<SocialPostStatus, string> = {
  draft: colors.text.tertiary,
  in_review: colors.status.warning,
  changes_requested: '#fb923c',
  approved: colors.status.success,
  scheduled: colors.status.info,
  publishing: colors.status.info,
  failed: colors.status.error,
  published: colors.primary.gold,
  cancelled: colors.status.error,
};

export function SocialStatusBadge({ status }: { status: SocialPostStatus }) {
  const color = POST_STATUS_COLORS[status] || colors.text.tertiary;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{socialPostStatusLabel(status)}</Text>
    </View>
  );
}

export default function SocialMediaScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [segment, setSegment] = useState<Segment>(
    route.params?.segment === 'comments' ? 'comments' : route.params?.segment === 'stats' ? 'stats' : 'review',
  );
  const [statsVersion, setStatsVersion] = useState(0);
  // Powiadomienie (komentarze, raport tygodniowy) przy otwartym już ekranie — zmiana zakładki z nowych parametrów.
  useEffect(() => {
    if (route.params?.segment === 'comments' || route.params?.segment === 'stats') setSegment(route.params.segment);
  }, [route.params?.segment, route.params?.report]);
  const [commentsVersion, setCommentsVersion] = useState(0);
  const [home, setHome] = useState<SocialHome | null>(null);
  const [library, setLibrary] = useState<SocialLibrary | null>(null);
  const [libraryStatus, setLibraryStatus] = useState<'ready' | 'proposed'>('ready');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Wybór zdjęcia do nowej siatki profilu / panoramy. */
  const [canvasPicking, setCanvasPicking] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const from = new Date();
      from.setDate(from.getDate() - 14);
      const to = new Date();
      to.setDate(to.getDate() + 90);
      const data = await socialGet<SocialHome>('home', { from: from.toISOString(), to: to.toISOString() });
      if (signal?.aborted) return;
      setHome(data);
      setError('');
      const assets = await socialGet<SocialLibrary>('library', { company: data.company.id, status: libraryStatus, limit: '60' });
      if (signal?.aborted) return;
      setLibrary(assets);
    } catch (cause) {
      if (!signal?.aborted) setError(socialErrorMessage(cause, 'Nie udało się pobrać social media.'));
    } finally {
      if (!signal?.aborted) { setLoading(false); setRefreshing(false); }
    }
  }, [libraryStatus]);

  // Odświeżenie przy każdym wejściu na ekran (także po powrocie z karty posta).
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]));

  const addPhoto = async (source: 'camera' | 'library') => {
    if (!home) return;
    try {
      const photo = await pickSocialPhoto(source);
      if (!photo) return;
      setBusy(true);
      const result = await uploadSocialPhoto(photo, { companyId: home.company.id });
      Alert.alert('Biblioteka', result.duplicateOf ? 'To zdjęcie jest już w bibliotece.' : 'Zdjęcie dodane do biblioteki.');
      await load();
    } catch (cause) {
      Alert.alert('Biblioteka', socialErrorMessage(cause, 'Nie udało się dodać zdjęcia.'));
    } finally {
      setBusy(false);
    }
  };

  /** Siatka profilu (domyślnie baner z 3 kafelków; kształt i układ zmienisz na karcie posta) z wybranego zdjęcia — jak w CRM i na Macu. */
  const createCanvas = async (asset: SocialAssetItem) => {
    if (!home) return;
    try {
      setBusy(true);
      const detail = await socialPost<SocialPostDetail>('createPost', {
        companyId: asset.companyId || home.company.id, channels: ['instagram_feed'], layout: { id: null, key: 'preset-grid-1-photo' },
        title: 'Siatka profilu', assetId: asset.id,
      });
      navigation.navigate('SocialPost', { postId: detail.post.id });
      Alert.alert('Social media', 'Utworzono szkic siatki — wybierz kształt i układ, potem zapisz post.');
      void load();
    } catch (cause) {
      Alert.alert('Social media', socialErrorMessage(cause, 'Nie udało się utworzyć siatki.'));
    } finally {
      setBusy(false);
    }
  };

  const openAsset = (asset: SocialAssetItem) => {
    if (!home?.access.create) return;
    const actions: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [
      { text: 'Szybki post z tego zdjęcia', onPress: () => navigation.navigate('SocialQuickPost', { companyId: asset.companyId, assetId: asset.id, assetThumb: asset.thumbnailUrl, eventId: asset.eventId, eventName: asset.eventName }) },
    ];
    if (asset.status === 'ready') actions.push({ text: 'Siatka profilu / panorama z tego zdjęcia', onPress: () => void createCanvas(asset) });
    if (asset.status === 'proposed') {
      actions.push({
        text: 'Przyjmij do biblioteki',
        onPress: async () => {
          try {
            setBusy(true);
            await socialPost('assetUpdate', { id: asset.id, updatedAt: asset.updatedAt, status: 'ready' });
            await load();
          } catch (cause) {
            Alert.alert('Biblioteka', socialErrorMessage(cause, 'Nie udało się przyjąć zdjęcia.'));
          } finally {
            setBusy(false);
          }
        },
      });
    }
    actions.push({ text: 'Anuluj', style: 'cancel' });
    Alert.alert(asset.title || asset.originalName || 'Zdjęcie', asset.eventName ? `Event: ${asset.eventName}` : undefined, actions);
  };

  if (loading && !home) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary.gold} size="large" /></View>;
  }
  if (!home) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{error || 'Brak dostępu do social media.'}</Text>
        <TouchableOpacity style={styles.retry} onPress={() => { setLoading(true); void load(); }}><Text style={styles.retryText}>Spróbuj ponownie</Text></TouchableOpacity>
      </View>
    );
  }

  const review = home.posts.filter((post) => ['in_review', 'changes_requested', 'failed'].includes(post.status));
  const unanswered = home.counts.unansweredComments || 0;
  // Ostrzeżenie tylko dla kanałów z automatyczną publikacją (LinkedIn bez połączenia — publikacja ręczna, bez ostrzeżenia).
  const meta = home.meta;
  const metaProblem = home.access.publish && meta
    ? (Object.keys(meta.channels) as SocialChannel[]).filter((channel) => !socialManualChannel(meta, channel))
      .map((channel) => meta.channels[channel]?.problem).find(Boolean) || null
    : null;
  const plan = [...home.posts]
    .filter((post) => post.status !== 'cancelled')
    .sort((a, b) => String(a.scheduledAt || '9999').localeCompare(String(b.scheduledAt || '9999')));

  const postRow = ({ item }: { item: SocialPostItem }) => (
    <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('SocialPost', { postId: item.id })}>
      {item.thumbnailUrl
        ? <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} />
        : <View style={[styles.thumb, styles.thumbEmpty]}><Feather name="image" size={20} color={colors.text.tertiary} /></View>}
      <View style={{ flex: 1, gap: 4 }}>
        <SocialStatusBadge status={item.status} />
        <Text style={styles.rowTitle} numberOfLines={1}>{item.title || item.captionPreview || 'Post bez tytułu'}</Text>
        {item.canvas ? <Text style={[styles.muted, { color: colors.primary.gold }]} numberOfLines={1}>{socialCanvasLabel(item.canvas.mode, item.canvas.tiles)}</Text> : null}
        <Text style={styles.muted} numberOfLines={1}>{item.channels.map((channel) => SOCIAL_CHANNEL_LABELS[channel]).join(' · ')}</Text>
        <Text style={styles.muted} numberOfLines={1}>{socialDateLabel(item.scheduledAt)}{item.authorName ? ` · ${item.authorName}` : ''}</Text>
        {item.status === 'failed' && item.publishError ? <Text style={[styles.muted, { color: colors.status.error }]} numberOfLines={2}>{item.publishError}</Text> : null}
      </View>
      <Feather name="chevron-right" size={18} color={colors.text.tertiary} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>{home.company.name}</Text>
          <Text style={styles.muted}>
            Do akceptacji: {home.counts.inReview} · do poprawy: {home.counts.changesRequested}{home.counts.failed ? ` · błędy publikacji: ${home.counts.failed}` : ''}
          </Text>
          {metaProblem ? <Text style={[styles.muted, { color: colors.status.warning }]} numberOfLines={2}>Publikacja: {metaProblem}</Text> : null}
        </View>
        {home.access.create && (
          <TouchableOpacity style={styles.iconButton} onPress={() => setCanvasPicking(true)}
            accessibilityRole="button" accessibilityLabel="Siatka profilu / panorama — wybierz zdjęcie">
            <Feather name="grid" size={18} color={colors.primary.gold} />
          </TouchableOpacity>
        )}
        {home.access.create && (
          <TouchableOpacity style={styles.primary} onPress={() => navigation.navigate('SocialQuickPost', { companyId: home.company.id })}>
            <Feather name="plus" size={16} color={colors.background.primary} />
            <Text style={styles.primaryText}>Szybki post</Text>
          </TouchableOpacity>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.tabs}>
        {([
          ['review', `Akceptacja${review.length ? ` (${review.length})` : ''}`],
          ['plan', 'Plan'],
          ['library', `Biblioteka${home.counts.proposals ? ` (${home.counts.proposals})` : ''}`],
          ['comments', `Komentarze${unanswered ? ` (${unanswered})` : ''}`],
          ['stats', 'Statystyki'],
        ] as const).map(([key, label]) => (
          <TouchableOpacity key={key} style={[styles.tab, segment === key && styles.segmentActive]} onPress={() => setSegment(key)}>
            <Text style={[styles.segmentText, segment === key && styles.segmentTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <LibraryModal visible={canvasPicking} companyId={home.company.id} onClose={() => setCanvasPicking(false)}
        onPick={(asset) => { setCanvasPicking(false); void createCanvas(asset); }} />
      {busy && <View style={styles.busy}><ActivityIndicator color={colors.primary.gold} /><Text style={styles.muted}>Proszę chwilę poczekać…</Text></View>}

      {segment === 'stats' ? (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary.gold} onRefresh={() => { setRefreshing(true); setStatsVersion((value) => value + 1); void load(); }} />}>
          <SocialStatsView key={`${home.company.id}-${route.params?.report || ''}`} companyId={home.company.id} initialReportId={route.params?.report || null}
            refreshKey={statsVersion} onOpenPost={(id) => navigation.navigate('SocialPost', { postId: id })} />
        </ScrollView>
      ) : segment === 'comments' ? (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary.gold} onRefresh={() => { setRefreshing(true); setCommentsVersion((value) => value + 1); void load(); }} />}>
          <SocialCommentsList companyId={home.company.id} refreshKey={commentsVersion} onOpenPost={(id) => navigation.navigate('SocialPost', { postId: id, comments: true })} />
        </ScrollView>
      ) : segment !== 'library' ? (
        <FlatList
          data={segment === 'review' ? review : plan}
          keyExtractor={(item) => item.id}
          renderItem={postRow}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary.gold} onRefresh={() => { setRefreshing(true); void load(); }} />}
          ListEmptyComponent={<Text style={[styles.muted, { textAlign: 'center', marginTop: spacing.xl }]}>{segment === 'review' ? 'Nic nie czeka na akceptację ani nie ma błędów publikacji.' : 'Brak zaplanowanych postów.'}</Text>}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary.gold} onRefresh={() => { setRefreshing(true); void load(); }} />}>
          <View style={styles.segments}>
            {(['ready', 'proposed'] as const).map((value) => (
              <TouchableOpacity key={value} style={[styles.segment, libraryStatus === value && styles.segmentActive]} onPress={() => setLibraryStatus(value)}>
                <Text style={[styles.segmentText, libraryStatus === value && styles.segmentTextActive]}>{value === 'ready' ? 'W bibliotece' : `Propozycje${library?.proposals ? ` (${library.proposals})` : ''}`}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {home.access.create && (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity style={styles.secondary} onPress={() => void addPhoto('camera')}><Feather name="camera" size={16} color={colors.primary.gold} /><Text style={styles.secondaryText}>Zrób zdjęcie</Text></TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => void addPhoto('library')}><Feather name="image" size={16} color={colors.primary.gold} /><Text style={styles.secondaryText}>Z galerii</Text></TouchableOpacity>
            </View>
          )}
          <View style={styles.grid}>
            {(library?.assets || []).map((asset) => (
              <TouchableOpacity key={asset.id} style={styles.tile} onPress={() => openAsset(asset)}>
                {asset.thumbnailUrl ? <Image source={{ uri: asset.thumbnailUrl }} style={styles.tileImage} /> : <View style={[styles.tileImage, styles.thumbEmpty]} />}
                <View style={[styles.consent, { backgroundColor: socialConsentAllows(asset.consent.status) ? 'rgba(34,197,94,0.85)' : 'rgba(245,158,11,0.85)' }]}>
                  <Text style={styles.consentText}>{socialConsentAllows(asset.consent.status) ? 'Zgoda ✓' : 'Zgoda ?'}</Text>
                </View>
                <Text style={styles.tileTitle} numberOfLines={1}>{asset.eventName || asset.title || asset.originalName || 'Zdjęcie'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {library && library.assets.length === 0 && <Text style={[styles.muted, { textAlign: 'center' }]}>Brak zdjęć w tym widoku.</Text>}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.primary, padding: spacing.lg, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.sm },
  brand: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontFamily: typography.fontFamilies.heading, textTransform: 'uppercase' },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  primary: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary.gold, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: borderRadius.md },
  primaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.sm },
  iconButton: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.hover, padding: spacing.sm, borderRadius: borderRadius.md },
  secondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.border.hover, paddingVertical: spacing.sm, borderRadius: borderRadius.md },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  segments: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md },
  tabs: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md },
  tab: { alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: borderRadius.md, backgroundColor: colors.background.secondary },
  segment: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.background.secondary },
  segmentActive: { backgroundColor: 'rgba(211,187,115,0.18)' },
  segmentText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  segmentTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  busy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center', padding: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary },
  thumb: { width: 64, height: 80, borderRadius: borderRadius.md },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.tertiary },
  rowTitle: { color: colors.text.primary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.medium },
  badge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: borderRadius.full, paddingHorizontal: 8, paddingVertical: 1 },
  badgeText: { fontSize: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '31%', gap: 4 },
  tileImage: { width: '100%', aspectRatio: 0.8, borderRadius: borderRadius.md },
  tileTitle: { color: colors.text.secondary, fontSize: 11 },
  consent: { position: 'absolute', top: 4, left: 4, borderRadius: borderRadius.full, paddingHorizontal: 6, paddingVertical: 1 },
  consentText: { color: colors.white, fontSize: 10, fontWeight: typography.fontWeights.semibold },
  retry: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  retryText: { color: colors.primary.gold },
});
