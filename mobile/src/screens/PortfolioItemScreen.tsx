import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Switch, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography } from '../theme';
import {
  PORTFOLIO_ICONS, PORTFOLIO_LIMITS, normalizePortfolioContent, portfolioChecklist, portfolioSearchPreview, portfolioSlug,
  type PortfolioContent, type PortfolioFeature, type PortfolioPhoto,
} from '../lib/portfolioShared';
import {
  pickPortfolioPhotos, portfolioErrorMessage, portfolioGet, portfolioPost, uploadPortfolioPhoto, type PickedPortfolioPhoto, type PortfolioCity, type PortfolioDetail,
  type PortfolioEvent, type PortfolioHome, type PortfolioPhotoOption, type PortfolioPhotoSource,
} from '../lib/portfolioApi';
import PortfolioEventPicker, { portfolioEventSummary } from '../components/Portfolio/PortfolioEventPicker';
import PortfolioPhotoPicker from '../components/Portfolio/PortfolioPhotoPicker';
import PortfolioAssistantCard from '../components/Portfolio/PortfolioAssistantCard';
import { PortfolioStatusBadge, portfolioDateLabel } from './PortfolioScreen';
import { SOCIAL_CHANNELS, SOCIAL_CHANNEL_LABELS, SOCIAL_LIMITS, type SocialChannel } from '../lib/socialShared';

/*
 * Karta realizacji w aplikacji — ten sam zakres co CRM i Mac: podstawy i wydarzenie, zdjęcie główne i galeria (aparat,
 * galeria telefonu, pliki wydarzenia, Materiały, biblioteka social media; kolejność strzałkami, „Ustaw jako główne”, opisy alt),
 * opisy, elementy realizacji, SEO i miasta, lista kontrolna, podgląd w Google, asystent AI. „Zapisz” — kopia robocza,
 * „Opublikuj” — strona (przy zmianie także na stronie: wybór wersji), „Wersja ze strony”, „Usuń ze strony”, „Usuń”,
 * „Utwórz post” — szkic posta social media z karuzelą zdjęć realizacji (otwiera kartę posta).
 */

type Draft = { content: PortfolioContent; eventId: string | null; event: PortfolioEvent | null };
type IconName = keyof typeof Feather.glyphMap;

/** Ikony elementów realizacji (nazwy lucide na stronie) — odpowiedniki Feather w aplikacji. */
const ICON_GLYPHS: Record<string, IconName> = {
  Users: 'users', UserCheck: 'user-check', UsersRound: 'users', Clock: 'clock', Timer: 'watch', Calendar: 'calendar',
  Award: 'award', Star: 'star', BadgeCheck: 'check-circle', Target: 'target', Lightbulb: 'sun', Zap: 'zap', Radio: 'radio',
  Settings: 'settings', Mic: 'mic', CheckCircle2: 'check-circle', Package: 'package', Truck: 'truck', Wrench: 'tool',
  TrendingUp: 'trending-up', ThumbsUp: 'thumbs-up', Heart: 'heart', Sparkles: 'star',
};
const iconLabel = (name: string) => PORTFOLIO_ICONS.find((icon) => icon.name === name)?.label || 'Wyróżnienie';

const pad = (value: number) => String(value).padStart(2, '0');
const ymd = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseYmd = (value: string | null) => {
  if (!value) return new Date();
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12);
};
const momentLabel = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function addPhrases(text: string, values: string[], max: number, maxLength: number) {
  const next = [...values];
  for (const part of text.split(',')) {
    const clean = part.trim().replace(/\s+/g, ' ').slice(0, maxLength);
    if (!clean || next.length >= max) continue;
    if (next.some((item) => item.toLocaleLowerCase('pl') === clean.toLocaleLowerCase('pl'))) continue;
    next.push(clean);
  }
  return next;
}

function ChipsInput({ values, onChange, placeholder, max, maxLength }: {
  values: string[]; onChange: (values: string[]) => void; placeholder: string; max: number; maxLength: number;
}) {
  const [text, setText] = useState('');
  const add = (value: string) => {
    if (value.replace(/,/g, '').trim()) onChange(addPhrases(value, values, max, maxLength));
    setText('');
  };
  return (
    <View style={{ gap: 6 }}>
      {values.length > 0 && (
        <View style={styles.wrap}>
          {values.map((item) => (
            <TouchableOpacity key={item} style={styles.tag} onPress={() => onChange(values.filter((entry) => entry !== item))}>
              <Text style={styles.tagText}>{item}</Text>
              <Feather name="x" size={12} color={colors.primary.gold} />
            </TouchableOpacity>
          ))}
        </View>
      )}
      {values.length < max && (
        <TextInput style={styles.input} value={text} placeholder={placeholder} placeholderTextColor={colors.text.tertiary} autoCapitalize="none"
          onChangeText={(value) => { if (value.includes(',')) add(value); else setText(value); }}
          onSubmitEditing={() => add(text)} onBlur={() => add(text)} returnKeyType="done" />
      )}
    </View>
  );
}

export default function PortfolioItemScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const id: string = route.params?.id;
  const [detail, setDetail] = useState<PortfolioDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cities, setCities] = useState<PortfolioCity[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState<PortfolioPhotoSource | null>(null);
  const [eventPicker, setEventPicker] = useState(false);
  const [cityPicker, setCityPicker] = useState(false);
  const [cityQuery, setCityQuery] = useState('');
  const [referenceQuery, setReferenceQuery] = useState('');
  const [iconPicker, setIconPicker] = useState<number | null>(null);
  const [androidDate, setAndroidDate] = useState(false);
  const [socialOpen, setSocialOpen] = useState(false);
  const [socialPhotos, setSocialPhotos] = useState<string[]>([]);
  const [socialChannels, setSocialChannels] = useState<SocialChannel[]>(['instagram_feed', 'facebook_feed']);
  const leaving = useRef(false);

  const apply = useCallback((value: PortfolioDetail) => {
    setDetail(value);
    setDraft({ content: value.item.content, eventId: value.item.eventId, event: value.event });
  }, []);

  const load = useCallback(async () => {
    try {
      const [value, home] = await Promise.all([
        portfolioGet<PortfolioDetail>('item', { id }),
        portfolioGet<PortfolioHome>('home').catch(() => null),
      ]);
      apply(value);
      if (home) { setCities(home.cities); setCategories(home.categories); }
      setError('');
    } catch (cause) {
      setError(portfolioErrorMessage(cause, 'Nie udało się otworzyć realizacji.'));
    } finally {
      setRefreshing(false);
    }
  }, [id, apply]);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(() => Boolean(detail && draft && (
    JSON.stringify(draft.content) !== JSON.stringify(detail.item.content) || draft.eventId !== detail.item.eventId
  )), [detail, draft]);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // Wyjście z niezapisanymi zmianami — pytanie.
  useEffect(() => navigation.addListener('beforeRemove', (event: any) => {
    if (!dirtyRef.current || leaving.current) return;
    event.preventDefault();
    Alert.alert('Niezapisane zmiany', 'Realizacja ma niezapisane zmiany. Wyjść bez zapisu?', [
      { text: 'Zostań', style: 'cancel' },
      { text: 'Wyjdź bez zapisu', style: 'destructive', onPress: () => { leaving.current = true; navigation.dispatch(event.data.action); } },
    ]);
  }), [navigation]);

  const set = (patch: Partial<PortfolioContent>) => setDraft((current) => (current ? { ...current, content: { ...current.content, ...patch } } : current));

  const run = async (label: string, action: () => Promise<PortfolioDetail | null>, success?: string): Promise<PortfolioDetail | null> => {
    setBusy(label);
    try {
      const result = await action();
      if (result) apply(result);
      if (success) Alert.alert('Realizacje', success);
      return result;
    } catch (cause) {
      Alert.alert('Realizacje', portfolioErrorMessage(cause, 'Operacja nie powiodła się.'));
      return null;
    } finally {
      setBusy(null);
    }
  };

  if (error && !detail) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{error}</Text>
        <TouchableOpacity style={[styles.secondary, { marginTop: spacing.md, paddingHorizontal: spacing.lg }]} onPress={() => { void load(); }}>
          <Text style={styles.secondaryText}>Spróbuj ponownie</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!detail || !draft) return <View style={styles.center}><ActivityIndicator color={colors.primary.gold} size="large" /></View>;

  const { item } = detail;
  const content = draft.content;
  const onSite = item.status !== 'draft';
  const checks = portfolioChecklist(content);
  const missing = checks.filter((check) => check.required && !check.ok);
  const preview = portfolioSearchPreview(content);
  const metaLength = content.metaDescription.length;

  const save = (quiet = false) => run('Zapisuję realizację', () => portfolioPost<PortfolioDetail>('save', {
    id: item.id, version: item.version, content: normalizePortfolioContent(draft.content), eventId: draft.eventId,
  }), quiet ? undefined : 'Zapisano realizację.');

  const publish = async () => {
    let current = detail;
    if (dirty) {
      const saved = await save(true);
      if (!saved) return;
      current = saved;
    }
    const published = current.item.status !== 'draft';
    const doPublish = (overwrite: boolean) => run(published ? 'Publikuję zmiany' : 'Publikuję realizację',
      () => portfolioPost<PortfolioDetail>('publish', { id: current.item.id, version: current.item.version, overwrite }),
      published ? 'Zmiany są na stronie.' : 'Realizacja jest na stronie.');
    if (current.item.status === 'conflict') {
      Alert.alert('Zastąpić wersję na stronie?', 'Tę realizację zmieniono także bezpośrednio na stronie. Publikacja zastąpi tamte zmiany Twoją wersją.', [
        { text: 'Wróć', style: 'cancel' },
        { text: 'Opublikuj moją wersję', onPress: () => { void doPublish(true); } },
      ]);
      return;
    }
    await doPublish(false);
  };

  const discard = () => Alert.alert('Pobrać wersję ze strony?', 'Niezapisane i niepublikowane zmiany w kopii roboczej zostaną zastąpione wersją, która jest teraz na stronie.', [
    { text: 'Wróć', style: 'cancel' },
    { text: 'Pobierz ze strony', onPress: () => { void run('Pobieram wersję ze strony', () => portfolioPost<PortfolioDetail>('discard', { id: item.id }), 'Kopia robocza = wersja ze strony.'); } },
  ]);

  const unpublish = () => Alert.alert('Usunąć realizację ze strony?', 'Strona realizacji przestanie działać (link i pozycja w Google). Kopia robocza zostanie jako szkic — możesz ją opublikować ponownie.', [
    { text: 'Wróć', style: 'cancel' },
    { text: 'Usuń ze strony', style: 'destructive', onPress: () => { void run('Usuwam realizację ze strony', () => portfolioPost<PortfolioDetail>('unpublish', { id: item.id, version: item.version }), 'Realizacja zniknęła ze strony.'); } },
  ]);

  const remove = () => Alert.alert('Usunąć realizację?', onSite
    ? 'Realizacja zostanie usunięta ze strony i z „Realizacji”. Zdjęcia zostają w źródłach (Materiały, pliki wydarzenia). Tej operacji nie można cofnąć.'
    : 'Kopia robocza zostanie usunięta. Tej operacji nie można cofnąć.', [
    { text: 'Wróć', style: 'cancel' },
    {
      text: 'Usuń', style: 'destructive', onPress: async () => {
        setBusy('Usuwam realizację');
        try {
          await portfolioPost('delete', { id: item.id, version: item.version, removeFromSite: onSite });
          leaving.current = true;
          setBusy(null);
          Alert.alert('Realizacje', 'Usunięto realizację.');
          navigation.goBack();
        } catch (cause) {
          setBusy(null);
          Alert.alert('Realizacje', portfolioErrorMessage(cause, 'Nie udało się usunąć realizacji.'));
        }
      },
    },
  ]);

  const refresh = () => {
    if (!dirty) { setRefreshing(true); void load(); return; }
    Alert.alert('Odświeżyć realizację?', 'Niezapisane zmiany zostaną zastąpione wersją z serwera.', [
      { text: 'Wróć', style: 'cancel' },
      { text: 'Odśwież', style: 'destructive', onPress: () => { setRefreshing(true); void load(); } },
    ]);
  };

  // Zdjęcia ----------------------------------------------------------------------------------------------------------------
  const addPhotos = (photos: PortfolioPhoto[]) => setDraft((current) => {
    if (!current || !photos.length) return current;
    let image = current.content.image;
    const gallery = [...current.content.gallery];
    for (const photo of photos) {
      if (!image) image = photo;
      else if (gallery.length < PORTFOLIO_LIMITS.gallery) gallery.push(photo);
    }
    return { ...current, content: { ...current.content, image, gallery } };
  });

  const fromPhone = async (source: 'camera' | 'library') => {
    let picked: PickedPortfolioPhoto[];
    try {
      picked = await pickPortfolioPhotos(source);
    } catch (cause) {
      Alert.alert('Zdjęcia', portfolioErrorMessage(cause, 'Nie udało się wybrać zdjęć.'));
      return;
    }
    if (!picked.length) return;
    const added: PortfolioPhoto[] = [];
    try {
      for (let index = 0; index < picked.length; index += 1) {
        setBusy(`Wgrywam zdjęcia (${index + 1}/${picked.length})`);
        added.push(await uploadPortfolioPhoto(item.id, picked[index]));
      }
    } catch (cause) {
      Alert.alert('Zdjęcia', portfolioErrorMessage(cause, 'Nie udało się wgrać zdjęcia.'));
    } finally {
      setBusy(null);
      addPhotos(added);
    }
    if (added.length === picked.length) Alert.alert('Zdjęcia', `Dodano zdjęcia: ${added.length} — zapisz realizację.`);
  };

  const importPhotos = async (source: PortfolioPhotoSource, photos: PortfolioPhotoOption[]) => {
    setPicker(null);
    const added: PortfolioPhoto[] = [];
    try {
      for (let index = 0; index < photos.length; index += 1) {
        setBusy(`Dodaję zdjęcia (${index + 1}/${photos.length})`);
        const result = await portfolioPost<{ photo: PortfolioPhoto }>('import', { id: item.id, source, fileId: photos[index].id });
        added.push(result.photo);
      }
    } catch (cause) {
      Alert.alert('Zdjęcia', portfolioErrorMessage(cause, 'Nie udało się dodać zdjęcia.'));
    } finally {
      setBusy(null);
      addPhotos(added);
    }
    if (added.length && added.length === photos.length) Alert.alert('Zdjęcia', `Dodano zdjęcia: ${added.length} — zapisz realizację.`);
  };

  const moveGallery = (from: number, to: number) => {
    if (to < 0 || to >= content.gallery.length) return;
    const gallery = [...content.gallery];
    const [moved] = gallery.splice(from, 1);
    gallery.splice(to, 0, moved);
    set({ gallery });
  };

  const makeMain = (index: number) => {
    const gallery = [...content.gallery];
    const [photo] = gallery.splice(index, 1);
    if (content.image) gallery.splice(index, 0, content.image);
    set({ image: photo, gallery });
  };

  const setAlt = (index: number | 'hero', alt: string) => {
    const value = alt.slice(0, PORTFOLIO_LIMITS.alt);
    if (index === 'hero') { if (content.image) set({ image: { ...content.image, alt: value } }); return; }
    set({ gallery: content.gallery.map((photo, position) => (position === index ? { ...photo, alt: value } : photo)) });
  };

  const setFeature = (index: number, patch: Partial<PortfolioFeature>) =>
    set({ features: content.features.map((feature, position) => (position === index ? { ...feature, ...patch } : feature)) });
  const moveFeature = (from: number, to: number) => {
    if (to < 0 || to >= content.features.length) return;
    const features = [...content.features];
    [features[from], features[to]] = [features[to], features[from]];
    set({ features });
  };

  const allPhotos = [...(content.image ? [content.image] : []), ...content.gallery];
  const socialLimit = SOCIAL_LIMITS.slides + 1;
  const createSocial = async () => {
    let current = detail;
    if (dirty) {
      const saved = await save(true);
      if (!saved) return;
      current = saved;
    }
    setSocialOpen(false);
    setBusy('Tworzę post social media');
    try {
      const result = await portfolioPost<{ postId: string; photos: number }>('socialPost', { id: current.item.id, photos: socialPhotos, channels: socialChannels });
      setBusy(null);
      navigation.navigate('SocialPost', { postId: result.postId });
    } catch (cause) {
      setBusy(null);
      Alert.alert('Social media', portfolioErrorMessage(cause, 'Nie udało się utworzyć posta.'));
    }
  };

  const cityName = (slug: string | null) => (slug ? cities.find((city) => city.locality === slug)?.name || 'Dotychczas przypisane miasto' : 'Nie przypisano / inne miejsce');
  const filteredCities = cities.filter((city) => city.name.toLocaleLowerCase('pl').includes(cityQuery.trim().toLocaleLowerCase('pl')));
  const referenceCities = cities.filter((city) => city.name.toLocaleLowerCase('pl').includes(referenceQuery.trim().toLocaleLowerCase('pl')));
  const conference = content.conferenceReferenceEnabled === null ? 'inherit' : content.conferenceReferenceEnabled ? 'include' : 'exclude';

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 120 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary.gold} onRefresh={refresh} />}>
        <View style={styles.card}>
          <Text style={styles.title}>{content.title || 'Realizacja bez tytułu'}</Text>
          <View style={styles.wrap}>
            <PortfolioStatusBadge status={item.status} />
            <Text style={styles.muted}>{dirty ? 'niezapisane zmiany' : `zapisano${item.updatedByName ? ` · ${item.updatedByName}` : ''}`}</Text>
          </View>
          <View style={styles.wrap}>
            {item.siteUrl && (
              <TouchableOpacity style={styles.small} onPress={() => { void Linking.openURL(item.siteUrl as string); }}>
                <Feather name="external-link" size={14} color={colors.primary.gold} /><Text style={styles.smallText}>Zobacz na stronie</Text>
              </TouchableOpacity>
            )}
            {(item.status === 'changed' || item.status === 'conflict') && (
              <TouchableOpacity style={styles.small} onPress={discard}>
                <Feather name="rotate-ccw" size={14} color={colors.primary.gold} /><Text style={styles.smallText}>Wersja ze strony</Text>
              </TouchableOpacity>
            )}
            {onSite && (
              <TouchableOpacity style={styles.small} onPress={unpublish}>
                <Feather name="eye-off" size={14} color={colors.primary.gold} /><Text style={styles.smallText}>Usuń ze strony</Text>
              </TouchableOpacity>
            )}
            {allPhotos.length > 0 && (
              <TouchableOpacity style={styles.small} onPress={() => { setSocialPhotos(allPhotos.slice(0, socialLimit).map((photo) => photo.src)); setSocialOpen(true); }}>
                <Feather name="instagram" size={14} color={colors.primary.gold} /><Text style={styles.smallText}>Utwórz post</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.small, { borderColor: 'rgba(239,68,68,0.4)' }]} onPress={remove}>
              <Feather name="trash-2" size={14} color={colors.status.error} /><Text style={[styles.smallText, { color: colors.status.error }]}>Usuń</Text>
            </TouchableOpacity>
          </View>
        </View>

        {item.status === 'conflict' && (
          <View style={[styles.card, { borderColor: 'rgba(239,68,68,0.4)' }]}>
            <Text style={styles.body}>Tę realizację zmieniono także bezpośrednio na stronie (tryb edycji strony). Wybierz: pobierz wersję ze strony albo opublikuj swoją.</Text>
            <TouchableOpacity style={styles.secondary} onPress={discard}><Text style={styles.secondaryText}>Pobierz ze strony</Text></TouchableOpacity>
          </View>
        )}

        {/* Podstawy */}
        <View style={styles.card}>
          <Text style={styles.section}>Podstawy</Text>
          <Text style={styles.label}>Tytuł</Text>
          <TextInput style={styles.input} value={content.title} onChangeText={(value) => set({ title: value.slice(0, PORTFOLIO_LIMITS.title) })}
            placeholder="Jubileusz 30 lat marki" placeholderTextColor={colors.text.tertiary} />
          <Text style={styles.label}>Adres strony {onSite ? '(opublikowany adres się nie zmienia)' : ''}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Text style={styles.muted}>/portfolio/</Text>
            <TextInput style={[styles.input, { flex: 1 }, onSite && { opacity: 0.6 }]} value={content.slug} editable={!onSite} autoCapitalize="none" autoCorrect={false}
              onChangeText={(value) => set({ slug: value.toLowerCase().slice(0, PORTFOLIO_LIMITS.slug) })} onBlur={() => set({ slug: portfolioSlug(content.slug) })} />
            {!onSite && (
              <TouchableOpacity style={styles.iconButton} onPress={() => set({ slug: portfolioSlug(content.title) })}>
                <Feather name="refresh-cw" size={16} color={colors.primary.gold} />
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.label}>Kategoria</Text>
          <TextInput style={styles.input} value={content.category} onChangeText={(value) => set({ category: value.slice(0, PORTFOLIO_LIMITS.category) })}
            placeholder="Gala, Konferencja, Jubileusz…" placeholderTextColor={colors.text.tertiary} />
          {categories.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {categories.map((category) => (
                <TouchableOpacity key={category} style={[styles.chip, content.category === category && styles.chipActive]} onPress={() => set({ category })}>
                  <Text style={[styles.chipText, content.category === category && { color: colors.primary.gold }]}>{category}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          <Text style={styles.label}>Data wydarzenia</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Switch value={content.eventDate !== null} onValueChange={(on) => set({ eventDate: on ? content.eventDate || ymd(new Date()) : null })}
              trackColor={{ true: colors.primary.gold, false: colors.border.hover }} />
            {content.eventDate === null && <Text style={styles.muted}>bez daty</Text>}
            {content.eventDate !== null && Platform.OS === 'ios' && (
              <DateTimePicker value={parseYmd(content.eventDate)} mode="date" display="compact" locale="pl-PL" themeVariant="dark"
                onChange={(_event, selected) => { if (selected) set({ eventDate: ymd(selected) }); }} />
            )}
            {content.eventDate !== null && Platform.OS !== 'ios' && (
              <TouchableOpacity style={[styles.input, { flex: 1 }]} onPress={() => setAndroidDate(true)}>
                <Text style={styles.body}>{portfolioDateLabel(content.eventDate)}</Text>
              </TouchableOpacity>
            )}
          </View>
          {androidDate && Platform.OS !== 'ios' && (
            <DateTimePicker value={parseYmd(content.eventDate)} mode="date"
              onChange={(event, selected) => { setAndroidDate(false); if (event.type !== 'dismissed' && selected) set({ eventDate: ymd(selected) }); }} />
          )}
          <Text style={styles.label}>Miejsce (obiekt, miasto)</Text>
          <TextInput style={styles.input} value={content.location} onChangeText={(value) => set({ location: value.slice(0, PORTFOLIO_LIMITS.location) })}
            placeholder="Hotel Omega, Olsztyn" placeholderTextColor={colors.text.tertiary} />
          <Text style={styles.label}>Klient (opcjonalnie, do opisów)</Text>
          <TextInput style={styles.input} value={content.client} onChangeText={(value) => set({ client: value.slice(0, PORTFOLIO_LIMITS.client) })} />
          <Text style={styles.label}>Wydarzenie w CRM</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <TouchableOpacity style={[styles.input, { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={() => setEventPicker(true)}>
              <Feather name="calendar" size={14} color={colors.primary.gold} />
              <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>{draft.event?.name || 'Powiąż z wydarzeniem'}</Text>
            </TouchableOpacity>
            {draft.eventId && (
              <TouchableOpacity style={styles.iconButton} onPress={() => setDraft({ ...draft, eventId: null, event: null })}>
                <Feather name="x" size={16} color={colors.text.secondary} />
              </TouchableOpacity>
            )}
          </View>
          {draft.event && <Text style={styles.muted}>{portfolioEventSummary(draft.event)}</Text>}
          <View style={[styles.row, { marginTop: spacing.sm }]}>
            <Text style={[styles.body, { flex: 1 }]}>Wyróżniona realizacja</Text>
            <Switch value={content.isFeatured} onValueChange={(isFeatured) => set({ isFeatured })} trackColor={{ true: colors.primary.gold, false: colors.border.hover }} />
          </View>
          <View style={styles.row}>
            <Text style={[styles.body, { flex: 1 }]}>Kolejność na stronie</Text>
            <TouchableOpacity style={styles.iconButton} onPress={() => set({ orderIndex: Math.max(-9999, content.orderIndex - 1) })}>
              <Feather name="minus" size={16} color={colors.primary.gold} />
            </TouchableOpacity>
            <TextInput style={[styles.input, { width: 64, textAlign: 'center' }]} keyboardType="number-pad" value={String(content.orderIndex)}
              onChangeText={(value) => { const number = Number(value.replace(/[^0-9-]/g, '')); set({ orderIndex: Number.isFinite(number) ? Math.max(-9999, Math.min(9999, Math.round(number))) : 0 }); }} />
            <TouchableOpacity style={styles.iconButton} onPress={() => set({ orderIndex: Math.min(9999, content.orderIndex + 1) })}>
              <Feather name="plus" size={16} color={colors.primary.gold} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Zdjęcia */}
        <View style={styles.card}>
          <Text style={styles.section}>Zdjęcia ({(content.image ? 1 : 0) + content.gallery.length})</Text>
          <View style={styles.wrap}>
            <TouchableOpacity style={styles.small} onPress={() => { void fromPhone('camera'); }}><Feather name="camera" size={14} color={colors.primary.gold} /><Text style={styles.smallText}>Aparat</Text></TouchableOpacity>
            <TouchableOpacity style={styles.small} onPress={() => { void fromPhone('library'); }}><Feather name="image" size={14} color={colors.primary.gold} /><Text style={styles.smallText}>Galeria telefonu</Text></TouchableOpacity>
            <TouchableOpacity style={styles.small} onPress={() => setPicker('event')}><Feather name="folder" size={14} color={colors.primary.gold} /><Text style={styles.smallText}>Z wydarzenia</Text></TouchableOpacity>
            <TouchableOpacity style={styles.small} onPress={() => setPicker('material')}><Feather name="archive" size={14} color={colors.primary.gold} /><Text style={styles.smallText}>Z Materiałów</Text></TouchableOpacity>
            <TouchableOpacity style={styles.small} onPress={() => setPicker('social')}><Feather name="instagram" size={14} color={colors.primary.gold} /><Text style={styles.smallText}>Z biblioteki social</Text></TouchableOpacity>
          </View>
          <Text style={styles.label}>Zdjęcie główne</Text>
          {content.image ? (
            <View style={{ gap: 6 }}>
              <View>
                <Image source={{ uri: content.image.thumb }} style={styles.hero} />
                <TouchableOpacity style={styles.overlayButton} onPress={() => set({ image: null })}><Feather name="x" size={16} color={colors.white} /></TouchableOpacity>
              </View>
              <TextInput style={[styles.input, !content.image.alt && styles.warnBorder]} value={content.image.alt} onChangeText={(value) => setAlt('hero', value)}
                placeholder="Opis zdjęcia (alt)" placeholderTextColor={colors.text.tertiary} />
            </View>
          ) : (
            <View style={[styles.hero, styles.placeholder]}><Feather name="image" size={28} color={colors.text.tertiary} /></View>
          )}
          <Text style={styles.label}>Galeria</Text>
          {content.gallery.map((photo, index) => (
            <View key={`${photo.src}-${index}`} style={styles.galleryRow}>
              <Image source={{ uri: photo.thumb }} style={styles.galleryThumb} />
              <View style={{ flex: 1, gap: 6 }}>
                <TextInput style={[styles.input, { paddingVertical: 6 }, !photo.alt && styles.warnBorder]} value={photo.alt} onChangeText={(value) => setAlt(index, value)}
                  placeholder="Opis (alt)" placeholderTextColor={colors.text.tertiary} />
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  <TouchableOpacity style={styles.iconButton} disabled={index === 0} onPress={() => moveGallery(index, index - 1)}>
                    <Feather name="arrow-up" size={16} color={index === 0 ? colors.text.disabled : colors.primary.gold} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconButton} disabled={index === content.gallery.length - 1} onPress={() => moveGallery(index, index + 1)}>
                    <Feather name="arrow-down" size={16} color={index === content.gallery.length - 1 ? colors.text.disabled : colors.primary.gold} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconButton} onPress={() => makeMain(index)}><Feather name="star" size={16} color={colors.primary.gold} /></TouchableOpacity>
                  <TouchableOpacity style={styles.iconButton} onPress={() => set({ gallery: content.gallery.filter((_, position) => position !== index) })}>
                    <Feather name="trash-2" size={16} color={colors.status.error} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
          {!content.gallery.length && <Text style={styles.muted}>Dodaj 5–12 zdjęć: szerokie ujęcie sali, scena, detale, goście (bez portretów).</Text>}
        </View>

        {/* Opisy */}
        <View style={styles.card}>
          <Text style={styles.section}>Opisy</Text>
          <Text style={styles.label}>Krótki opis ({content.description.length}/{PORTFOLIO_LIMITS.description} — karta realizacji)</Text>
          <TextInput style={[styles.input, styles.multiline]} multiline value={content.description}
            onChangeText={(value) => set({ description: value.slice(0, PORTFOLIO_LIMITS.description) })} />
          <Text style={styles.label}>Szczegółowy opis ({content.detailedDescription.length} znaków, zalecane od {PORTFOLIO_LIMITS.detailedRecommended}; akapity oddziel pustą linią)</Text>
          <TextInput style={[styles.input, styles.multiline, { minHeight: 180 }]} multiline value={content.detailedDescription}
            onChangeText={(value) => set({ detailedDescription: value.slice(0, PORTFOLIO_LIMITS.detailedDescription) })} />
        </View>

        {/* Elementy realizacji */}
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={[styles.section, { flex: 1 }]}>Elementy realizacji ({content.features.length}/{PORTFOLIO_LIMITS.features})</Text>
            <TouchableOpacity style={styles.small} disabled={content.features.length >= PORTFOLIO_LIMITS.features}
              onPress={() => set({ features: [...content.features, { icon: 'Star', title: '', description: '' }] })}>
              <Feather name="plus" size={14} color={colors.primary.gold} /><Text style={styles.smallText}>Dodaj</Text>
            </TouchableOpacity>
          </View>
          {content.features.map((feature, index) => (
            <View key={index} style={styles.featureRow}>
              <View style={styles.row}>
                <TouchableOpacity style={[styles.small, { flex: 1 }]} onPress={() => setIconPicker(index)}>
                  <Feather name={ICON_GLYPHS[feature.icon] || 'star'} size={16} color={colors.primary.gold} />
                  <Text style={styles.smallText}>{iconLabel(feature.icon)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconButton} disabled={index === 0} onPress={() => moveFeature(index, index - 1)}>
                  <Feather name="arrow-up" size={16} color={index === 0 ? colors.text.disabled : colors.primary.gold} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconButton} disabled={index === content.features.length - 1} onPress={() => moveFeature(index, index + 1)}>
                  <Feather name="arrow-down" size={16} color={index === content.features.length - 1 ? colors.text.disabled : colors.primary.gold} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconButton} onPress={() => set({ features: content.features.filter((_, position) => position !== index) })}>
                  <Feather name="trash-2" size={16} color={colors.status.error} />
                </TouchableOpacity>
              </View>
              <TextInput style={styles.input} value={feature.title} onChangeText={(value) => setFeature(index, { title: value.slice(0, PORTFOLIO_LIMITS.featureTitle) })}
                placeholder="Np. Scena z ekranem LED" placeholderTextColor={colors.text.tertiary} />
              <TextInput style={styles.input} value={feature.description} onChangeText={(value) => setFeature(index, { description: value.slice(0, PORTFOLIO_LIMITS.featureDescription) })}
                placeholder="Krótki opis (opcjonalnie)" placeholderTextColor={colors.text.tertiary} />
            </View>
          ))}
        </View>

        {/* SEO i miasta */}
        <View style={styles.card}>
          <Text style={styles.section}>SEO i miasta</Text>
          <Text style={styles.label}>
            Opis w Google{' '}
            <Text style={{ color: metaLength >= PORTFOLIO_LIMITS.metaMin && metaLength <= PORTFOLIO_LIMITS.metaMax ? colors.status.success : colors.status.warning }}>
              {metaLength} znaków (zalecane {PORTFOLIO_LIMITS.metaMin}–{PORTFOLIO_LIMITS.metaMax})
            </Text>
          </Text>
          <TextInput style={[styles.input, styles.multiline, { minHeight: 70 }]} multiline value={content.metaDescription}
            onChangeText={(value) => set({ metaDescription: value.slice(0, PORTFOLIO_LIMITS.metaDescription) })} />
          <Text style={styles.label}>Słowa kluczowe (Enter albo przecinek)</Text>
          <ChipsInput values={content.keywords} onChange={(keywords) => set({ keywords })} placeholder="gala firmowa olsztyn" max={PORTFOLIO_LIMITS.keywords} maxLength={PORTFOLIO_LIMITS.keyword} />
          <Text style={styles.label}>Tagi (np. „konferencje” — strony konferencji)</Text>
          <ChipsInput values={content.tags} onChange={(tags) => set({ tags })} placeholder="konferencje" max={PORTFOLIO_LIMITS.tags} maxLength={PORTFOLIO_LIMITS.tag} />
          <Text style={styles.label}>Miasto realizacji</Text>
          <TouchableOpacity style={[styles.input, { flexDirection: 'row', alignItems: 'center' }]} onPress={() => { setCityQuery(''); setCityPicker(true); }}>
            <Text style={[styles.body, { flex: 1 }]}>{cityName(content.eventCitySlug)}</Text>
            <Feather name="chevron-down" size={16} color={colors.text.secondary} />
          </TouchableOpacity>
          <Text style={styles.label}>Na stronach konferencji</Text>
          <View style={{ gap: 6 }}>
            {([['inherit', 'Automatycznie — według tagu „konferencje”'], ['include', 'Pokazuj jako przykład obsługi konferencji'], ['exclude', 'Nie pokazuj na stronach konferencji']] as const).map(([key, label]) => (
              <TouchableOpacity key={key} style={[styles.chip, conference === key && styles.chipActive]}
                onPress={() => set({ conferenceReferenceEnabled: key === 'inherit' ? null : key === 'include' })}>
                <Text style={[styles.chipText, conference === key && { color: colors.primary.gold }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>Priorytetowe miasta (na których stronach usług pokazać realizację wyżej; nie zmieniają miejsca wydarzenia)</Text>
          <TextInput style={styles.input} value={referenceQuery} onChangeText={setReferenceQuery} placeholder="Szukaj miasta…" placeholderTextColor={colors.text.tertiary} />
          <View style={styles.wrap}>
            {referenceCities.map((city) => {
              const active = content.referenceCitySlugs.includes(city.locality);
              return (
                <TouchableOpacity key={city.locality} style={[styles.chip, active && styles.chipActive]}
                  onPress={() => set({ referenceCitySlugs: active ? content.referenceCitySlugs.filter((slug) => slug !== city.locality) : [...content.referenceCitySlugs, city.locality] })}>
                  {active && <Feather name="check" size={12} color={colors.primary.gold} />}
                  <Text style={[styles.chipText, active && { color: colors.primary.gold }]}>{city.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.label}>Film (adres https, opcjonalnie)</Text>
          <TextInput style={styles.input} value={content.videoUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url"
            onChangeText={(value) => set({ videoUrl: value.trim().slice(0, PORTFOLIO_LIMITS.videoUrl) })} placeholder="https://www.youtube.com/watch?v=…" placeholderTextColor={colors.text.tertiary} />
        </View>

        {/* Lista kontrolna i podgląd */}
        <View style={styles.card}>
          <Text style={styles.section}>Lista kontrolna</Text>
          {checks.map((check) => (
            <View key={check.key} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
              <Feather name={check.ok ? 'check-circle' : check.required ? 'alert-triangle' : 'circle'} size={16}
                color={check.ok ? colors.status.success : check.required ? colors.status.error : colors.status.warning} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.body, !check.ok && { color: check.required ? colors.status.error : colors.status.warning }]}>{check.label}{check.required && !check.ok ? ' (wymagane)' : ''}</Text>
                {!check.ok && <Text style={styles.muted}>{check.hint}</Text>}
              </View>
            </View>
          ))}
        </View>
        <View style={styles.card}>
          <Text style={styles.section}>Podgląd w Google</Text>
          <View style={styles.google}>
            <Text style={{ color: '#202124', fontSize: 12 }} numberOfLines={1}>{preview.url}</Text>
            <Text style={{ color: '#1a0dab', fontSize: 17 }} numberOfLines={1}>{preview.title}</Text>
            <Text style={{ color: '#4d5156', fontSize: 12 }} numberOfLines={2}>{preview.description || 'Dodaj opis w Google albo krótki opis.'}</Text>
          </View>
        </View>

        <PortfolioAssistantCard itemId={item.id} content={content} eventId={draft.eventId} onBusy={setBusy} onApply={set} />

        <View style={styles.card}>
          <Text style={styles.muted}>Utworzono {momentLabel(item.createdAt)}{item.createdByName ? ` · ${item.createdByName}` : ''}</Text>
          {item.publishedAt && <Text style={styles.muted}>Opublikowano {momentLabel(item.publishedAt)}{item.publishedByName ? ` · ${item.publishedByName}` : ''}</Text>}
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        {missing.length > 0 && (
          <Text style={[styles.muted, { color: colors.status.warning, textAlign: 'center' }]}>Uzupełnij przed publikacją: {missing.map((check) => check.label).join(', ')}</Text>
        )}
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TouchableOpacity style={[styles.secondary, { flex: 1 }, !dirty && { opacity: 0.5 }]} disabled={!dirty} onPress={() => { void save(); }}>
            <Feather name="save" size={16} color={colors.primary.gold} /><Text style={styles.secondaryText}>Zapisz</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primary, { flex: 1.4 }, (missing.length > 0 || (!dirty && item.status === 'published')) && { opacity: 0.5 }]}
            disabled={missing.length > 0 || (!dirty && item.status === 'published')}
            onPress={() => { void publish(); }}>
            <Feather name="send" size={16} color={colors.background.primary} />
            <Text style={styles.primaryText}>{onSite ? 'Opublikuj zmiany' : 'Opublikuj na stronie'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <PortfolioPhotoPicker visible={picker !== null} initialSource={picker || 'event'} eventId={draft.eventId} eventName={draft.event?.name || null}
        onClose={() => setPicker(null)} onPick={(source, photos) => { void importPhotos(source, photos); }} />

      <PortfolioEventPicker visible={eventPicker} title="Powiąż z wydarzeniem" onClose={() => setEventPicker(false)}
        onPick={(event) => { setDraft({ ...draft, eventId: event.id, event }); setEventPicker(false); }} />

      <Modal visible={cityPicker} transparent animationType="slide" onRequestClose={() => setCityPicker(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.row}>
              <Text style={[styles.title, { flex: 1 }]}>Miasto realizacji</Text>
              <TouchableOpacity onPress={() => setCityPicker(false)} hitSlop={10}><Feather name="x" size={22} color={colors.text.primary} /></TouchableOpacity>
            </View>
            <TextInput style={styles.input} value={cityQuery} onChangeText={setCityQuery} placeholder="Szukaj miasta…" placeholderTextColor={colors.text.tertiary} />
            <FlatList
              data={[{ locality: '', name: 'Nie przypisano / inne miejsce' }, ...filteredCities]}
              keyExtractor={(city) => city.locality || 'none'}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 380 }}
              renderItem={({ item: city }) => (
                <TouchableOpacity style={styles.listRow} onPress={() => { set({ eventCitySlug: city.locality || null }); setCityPicker(false); }}>
                  <Text style={[styles.body, { flex: 1 }]}>{city.name}</Text>
                  {(content.eventCitySlug || '') === city.locality && <Feather name="check" size={16} color={colors.primary.gold} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={iconPicker !== null} transparent animationType="slide" onRequestClose={() => setIconPicker(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.row}>
              <Text style={[styles.title, { flex: 1 }]}>Ikona elementu</Text>
              <TouchableOpacity onPress={() => setIconPicker(null)} hitSlop={10}><Feather name="x" size={22} color={colors.text.primary} /></TouchableOpacity>
            </View>
            <FlatList
              data={PORTFOLIO_ICONS}
              keyExtractor={(icon) => icon.name}
              style={{ maxHeight: 420 }}
              renderItem={({ item: icon }) => (
                <TouchableOpacity style={styles.listRow} onPress={() => { if (iconPicker !== null) setFeature(iconPicker, { icon: icon.name }); setIconPicker(null); }}>
                  <Feather name={ICON_GLYPHS[icon.name] || 'star'} size={18} color={colors.primary.gold} />
                  <Text style={[styles.body, { flex: 1 }]}>{icon.category} — {icon.label}</Text>
                  {iconPicker !== null && content.features[iconPicker]?.icon === icon.name && <Feather name="check" size={16} color={colors.primary.gold} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={socialOpen} transparent animationType="slide" onRequestClose={() => setSocialOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.row}>
              <Text style={[styles.title, { flex: 1 }]}>Utwórz post social media</Text>
              <TouchableOpacity onPress={() => setSocialOpen(false)} hitSlop={10}><Feather name="x" size={22} color={colors.text.primary} /></TouchableOpacity>
            </View>
            <Text style={styles.muted}>Zdjęcia trafią do biblioteki social media marki. Szkic posta: okładka z tytułem realizacji i napisem „Realizacja”, kolejne zdjęcia jako karuzela, opis z krótkiego opisu, hashtagi ze słów kluczowych.</Text>
            <Text style={styles.label}>Zdjęcia ({socialPhotos.length}/{socialLimit}) — pierwsze zaznaczone to okładka</Text>
            <ScrollView style={{ maxHeight: 260 }}>
              <View style={styles.wrap}>
                {allPhotos.map((photo) => {
                  const position = socialPhotos.indexOf(photo.src);
                  return (
                    <TouchableOpacity key={photo.src} style={{ width: 76, height: 76, borderRadius: borderRadius.md, overflow: 'hidden', borderWidth: 2, borderColor: position >= 0 ? colors.primary.gold : 'transparent', opacity: position >= 0 ? 1 : 0.55 }}
                      onPress={() => setSocialPhotos((current) => (position >= 0 ? current.filter((src) => src !== photo.src)
                        : current.length >= socialLimit ? current : allPhotos.map((item) => item.src).filter((src) => src === photo.src || current.includes(src))))}>
                      <Image source={{ uri: photo.thumb }} style={{ width: '100%', height: '100%' }} />
                      {position >= 0 && (
                        <View style={{ position: 'absolute', top: 2, right: 2, backgroundColor: colors.primary.gold, borderRadius: 9, paddingHorizontal: 5 }}>
                          <Text style={{ color: colors.background.primary, fontSize: 10, fontWeight: '700' }}>{position === 0 ? 'okł.' : position + 1}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
            <Text style={styles.label}>Kanały</Text>
            <View style={styles.wrap}>
              {SOCIAL_CHANNELS.map((channel) => {
                const active = socialChannels.includes(channel);
                return (
                  <TouchableOpacity key={channel} style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setSocialChannels((current) => (active ? current.filter((item) => item !== channel) : [...current, channel]))}>
                    {active && <Feather name="check" size={12} color={colors.primary.gold} />}
                    <Text style={[styles.chipText, active && { color: colors.primary.gold }]}>{SOCIAL_CHANNEL_LABELS[channel]}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={[styles.primary, (!socialPhotos.length || !socialChannels.length) && { opacity: 0.5 }]}
              disabled={!socialPhotos.length || !socialChannels.length} onPress={() => { void createSocial(); }}>
              <Feather name="instagram" size={16} color={colors.background.primary} /><Text style={styles.primaryText}>Utwórz szkic posta</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={busy !== null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modal, { alignItems: 'center' }]}>
            <ActivityIndicator color={colors.primary.gold} size="large" />
            <Text style={styles.body}>{busy}…</Text>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.primary, padding: spacing.lg },
  card: { gap: spacing.xs, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary, borderWidth: 1, borderColor: colors.border.default },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.medium },
  section: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.medium, marginBottom: spacing.xs },
  label: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, marginTop: spacing.sm },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm, lineHeight: 20 },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  input: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md, padding: spacing.sm, color: colors.text.primary, backgroundColor: colors.background.tertiary, fontSize: typography.fontSizes.sm },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  warnBorder: { borderColor: 'rgba(245,158,11,0.6)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.default },
  chipActive: { borderColor: colors.primary.gold, backgroundColor: 'rgba(211,187,115,0.12)' },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.border.hover, backgroundColor: 'rgba(211,187,115,0.1)' },
  tagText: { color: colors.primary.gold, fontSize: typography.fontSizes.xs },
  small: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.hover },
  smallText: { color: colors.primary.gold, fontSize: typography.fontSizes.xs },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.default },
  hero: { width: '100%', aspectRatio: 4 / 3, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary },
  placeholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border.hover },
  overlayButton: { position: 'absolute', top: 6, right: 6, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  galleryRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border.default },
  galleryThumb: { width: 96, height: 72, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary },
  featureRow: { gap: 6, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border.default },
  google: { gap: 2, padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.white },
  bottomBar: { gap: spacing.xs, padding: spacing.md, paddingBottom: spacing.lg, backgroundColor: colors.background.secondary, borderTopWidth: 1, borderTopColor: colors.border.default },
  primary: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary.gold, paddingVertical: spacing.md, borderRadius: borderRadius.md },
  primaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.sm },
  secondary: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.hover, paddingVertical: spacing.md, borderRadius: borderRadius.md },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background.elevated, borderTopLeftRadius: borderRadius.xl, borderTopRightRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.sm, maxHeight: '90%' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: { width: '100%', backgroundColor: colors.background.elevated, borderRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.sm },
});
