import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { appPalette, colors, spacing, borderRadius, typography } from '../theme';
import ReorderableList from '../components/ReorderableList';
import { useContentWidth } from '../hooks/useTabletLayout';
import {
  SOCIAL_CHANNEL_LABELS, SOCIAL_FORMAT_INFO, SOCIAL_GRAPHIC_STYLES, SOCIAL_GRAPHIC_STYLE_HINTS, SOCIAL_GRAPHIC_STYLE_LIST, SOCIAL_KICKER_SUGGESTIONS,
  SOCIAL_LIMITS, SOCIAL_POST_ACTION_LABELS, SOCIAL_POST_ACTION_SUCCESS, SOCIAL_SLIDE_FORMATS,
  SOCIAL_METRICS, SOCIAL_METRIC_LABELS, SOCIAL_PUBLICATION_STATUS_LABELS, formatSocialNumber, formatSocialPercent, normalizeHashtags, socialConsentAllows, socialDateLabel, socialPostEditable, socialPublicationText,
  type SocialFormat, type SocialGraphicStyle, type SocialPostAction,
} from '../lib/socialShared';
import SocialAssistantCard from '../components/Social/SocialAssistantCard';
import SocialCommentsList from '../components/Social/SocialCommentsList';
import {
  sameSocialCanvas, socialCanvasOf, socialErrorMessage, socialGet, socialManualChannel, socialPost, type SocialCanvasShape, type SocialPostDetail,
} from '../lib/socialApi';
import { LibraryModal } from './SocialQuickPostScreen';
import { PhotoPermissionError, saveChatPhoto } from '../services/saveChatPhoto';
import { SocialStatusBadge } from './SocialMediaScreen';

/*
 * Karta posta social media w aplikacji: grafiki wygenerowane na serwerze (te same pliki co w CRM i na Macu), opis
 * i hashtagi, braki (grafiki, zgoda klienta), uwagi akceptującego. Twórca: styl grafiki, napis nad tytułem, tytuł i podpis
 * grafiki (nowa grafika po zapisie), opis, hashtagi,
 * asystent AI (opisy, poprawki, hashtagi), „Wyślij do akceptacji”. Akceptujący: „Zatwierdź” (nie własny post) i „Do poprawy”. Publikujący: „Opublikuj teraz”,
 * „Zaplanuj publikację”, „Wstrzymaj publikację”, „Ponów publikację” (Meta, LinkedIn) i „Oznacz jako opublikowany”. Wyniki kanałów
 * (link albo błąd) i komentarze Facebook / Instagram / LinkedIn z odpowiedzią marki. Do ręcznej publikacji: zapis grafiki w Zdjęciach
 * i kopiowanie opisu. Karuzela: kolejne zdjęcia z biblioteki, kolejność i usuwanie (kadr — propozycja albo z CRM / Maca).
 * Siatka profilu / panorama: kształt i gotowy układ, zdjęcie z biblioteki, kafelki z serwera (siatka — tak, jak złożą się w profilu,
 * z kolejnością publikacji; panorama — slajdy), zapis kafelków w Zdjęciach i stan publikacji każdego kafelka.
 * Bez edycji kadru (kadr z propozycji).
 */

/** Domyślny termin planowania: zapisany termin w przyszłości albo jutro 18:00. */
function defaultScheduleDate(value: string | null) {
  const saved = value ? new Date(value) : null;
  if (saved && saved.getTime() > Date.now() + 5 * 60_000) return saved;
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(18, 0, 0, 0);
  return date;
}

export default function SocialPostScreen() {
  // Szerokość treści (na tablecie w poziomie — obok paska bocznego) dla siatki i podglądu slajdów.
  const width = useContentWidth();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const postId: string = route.params?.postId;
  const [detail, setDetail] = useState<SocialPostDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [headline, setHeadline] = useState('');
  const [subline, setSubline] = useState('');
  const [style, setStyle] = useState<SocialGraphicStyle>('classic');
  const [kicker, setKicker] = useState('');
  const [dirty, setDirty] = useState(false);
  const [noteModal, setNoteModal] = useState<'request_changes' | 'publish' | null>(null);
  const [note, setNote] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(() => new Date());
  const [schedulePicker, setSchedulePicker] = useState<'date' | 'time' | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [commentsY, setCommentsY] = useState<number | null>(null);
  const scrolledToComments = useRef(false);
  /** Karuzela: kolejne zdjęcia (grafika w formacie feedu albo miniatura zdjęcia); `slidesChanged` — do zapisu. */
  const [slides, setSlides] = useState<Array<{ assetId: string; image: string | null }>>([]);
  const [slidesChanged, setSlidesChanged] = useState(false);
  /** Przeciąganie zdjęcia karuzeli — przewijanie ekranu i paska wyłączone. */
  const [slideDragging, setSlideDragging] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** Układ grafiki (`null` — styl) i zdjęcia kolażu w miejscach 1–3; wybór zdjęcia z biblioteki: karuzela albo miejsce kolażu. */
  const [layoutChoice, setLayoutChoice] = useState<{ id: string | null; key: string | null } | null>(null);
  const [layoutChanged, setLayoutChanged] = useState(false);
  /** Ten sam układ w aktualnej wersji (zmieniony w edytorze układów po zapisaniu posta) — zapis z `refresh`. */
  const [layoutRefresh, setLayoutRefresh] = useState(false);
  const [collage, setCollage] = useState<Array<{ slot: number; assetId: string; image: string | null }>>([]);
  const [collageChanged, setCollageChanged] = useState(false);
  /** Wybór z biblioteki: zdjęcie karuzeli, miejsce kolażu albo zdjęcie posta (siatka profilu / panorama). */
  const [libraryTarget, setLibraryTarget] = useState<'slide' | 'main' | number>('slide');
  /** Zdjęcie dużej grafiki (siatka / panorama) — zmiana z biblioteki; kadr — propozycja serwera w proporcjach miejsca. */
  const [mainAsset, setMainAsset] = useState<{ id: string; image: string | null } | null>(null);
  const [mainChanged, setMainChanged] = useState(false);

  const apply = (value: SocialPostDetail) => {
    setDetail(value);
    setCaption(value.post.caption);
    setHashtags(value.post.hashtags.join(' '));
    setHeadline(value.variants[0]?.headline || '');
    setSubline(value.variants[0]?.subline || '');
    setStyle(value.variants[0] ? value.variants[0].style || 'classic' : value.template?.defaultStyle || 'classic');
    setKicker(value.variants[0]?.kicker || '');
    const feed = value.channelFormats?.instagram_feed || value.channelFormats?.facebook_feed
      || value.variants.map((variant) => variant.format).find((format) => SOCIAL_SLIDE_FORMATS.includes(format)) || null;
    setSlides([...(value.slides || [])].sort((a, b) => a.position - b.position).map((slide) => ({
      assetId: slide.assetId,
      image: (feed ? slide.formats.find((item) => item.format === feed)?.renderedUrl : null) || slide.asset?.thumbnailUrl || null,
    })));
    setSlidesChanged(false);
    setLayoutChoice(value.layout ? { id: value.layout.id, key: value.layout.key } : null);
    setLayoutChanged(false);
    setLayoutRefresh(false);
    setCollage([...(value.slots || [])].sort((a, b) => a.slot - b.slot).map((item) => ({
      slot: item.slot, assetId: item.assetId, image: item.asset?.thumbnailUrl || null,
    })));
    setCollageChanged(false);
    const main = value.variants.find((variant) => variant.format === '4:5') || value.variants[0];
    setMainAsset(main?.assetId ? { id: main.assetId, image: main.asset?.thumbnailUrl || null } : null);
    setMainChanged(false);
    setDirty(false);
  };

  const load = useCallback(async () => {
    try {
      apply(await socialGet<SocialPostDetail>('post', { id: postId }));
      setError('');
    } catch (cause) {
      setError(socialErrorMessage(cause, 'Nie udało się otworzyć posta.'));
    }
  }, [postId]);

  // Odświeżenie przy powrocie na ekran — bez nadpisywania niezapisanych zmian (ref, żeby zapis nie wywoływał drugiego pobrania).
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useFocusEffect(useCallback(() => { if (!dirtyRef.current) void load(); }, [load]));

  // Publikacja z harmonogramu trwa na serwerze — odświeżamy kartę co 5 s, aż się skończy.
  const publishing = detail?.post.status === 'publishing';
  useEffect(() => {
    if (!publishing) return;
    const timer = setInterval(() => { if (!dirtyRef.current) void load(); }, 5000);
    return () => clearInterval(timer);
  }, [publishing, load]);

  // Powiadomienie o komentarzach — przewinięcie do komentarzy.
  useEffect(() => {
    if (!route.params?.comments || commentsY === null || scrolledToComments.current) return;
    scrolledToComments.current = true;
    setTimeout(() => scrollRef.current?.scrollTo({ y: commentsY, animated: true }), 200);
  }, [route.params?.comments, commentsY]);

  const run = async (label: string, action: () => Promise<SocialPostDetail | null>, success?: string) => {
    setBusy(label);
    try {
      const result = await action();
      if (result) apply(result);
      if (success) Alert.alert('Social media', success);
    } catch (cause) {
      Alert.alert('Social media', socialErrorMessage(cause, 'Operacja nie powiodła się.'));
    } finally {
      setBusy(null);
    }
  };

  const save = async (quiet = false): Promise<SocialPostDetail | null> => {
    if (!detail) return null;
    // Grafiki zmieniamy tylko przy innym tytule, podpisie, napisie albo stylu — kadry ustawione w CRM albo na Macu zostają.
    const textChanged = detail.variants.some((variant) => variant.headline !== headline.trim() || variant.subline !== subline.trim()
      || (variant.style || 'classic') !== style || (variant.kicker || '') !== kicker.trim());
    // Nowe zdjęcie dużej grafiki: kadr od nowa (propozycja serwera w proporcjach miejsca na całej grafice).
    const baseVariants: Array<{ format: SocialFormat; assetId: string | null; crop: unknown }> = detail.variants.length
      ? detail.variants : [{ format: '4:5', assetId: null, crop: null }];
    const result = await socialPost<SocialPostDetail>('savePost', {
      id: detail.post.id,
      updatedAt: detail.post.updatedAt,
      caption,
      hashtags: normalizeHashtags(hashtags),
      ...(textChanged || mainChanged ? {
        variants: baseVariants.map((variant) => ({
          format: variant.format, assetId: mainChanged ? mainAsset?.id || null : variant.assetId, crop: mainChanged ? null : variant.crop,
          headline, subline, style, kicker,
        })),
      } : {}),
      // Karuzela: kolejność zdjęć (kadry zapisane w CRM albo na Macu zostają; nowe zdjęcia — propozycja kadru).
      ...(slidesChanged ? { slides: slides.map((slide) => ({ assetId: slide.assetId })) } : {}),
      // Układ i kolaż (kadry zapisane w CRM albo na Macu zostają; nowe zdjęcia — propozycja kadru w proporcjach miejsca).
      ...(layoutChanged ? { layout: layoutChoice ? { ...layoutChoice, ...(layoutRefresh ? { refresh: true } : {}) } : null } : {}),
      ...(layoutChanged || collageChanged ? { slots: collage.map((item) => ({ slot: item.slot, assetId: item.assetId })) } : {}),
    });
    if (!quiet) Alert.alert('Social media', detail.canvas ? 'Zapisano post i pocięto grafikę na kafelki.' : 'Zapisano post i wygenerowano grafiki.');
    return result;
  };

  const transition = (action: SocialPostAction, extra: { note?: string; url?: string } = {}) => run(SOCIAL_POST_ACTION_LABELS[action], async () => {
    let current = detail!;
    if (dirty && current.access.create && socialPostEditable(current.post.status)) current = await save(true) || current;
    return socialPost<SocialPostDetail>('transition', {
      id: current.post.id, action, revision: current.post.revision, note: extra.note || null, url: extra.url || null,
    });
  }, SOCIAL_POST_ACTION_SUCCESS[action]);

  const publishNow = () => {
    if (!detail) return;
    const retry = detail.post.status === 'failed';
    Alert.alert(retry ? 'Ponowić publikację?' : 'Opublikować teraz?', retry
      ? 'Kanały, które już się opublikowały, zostaną pominięte.'
      : `Post trafi teraz na: ${detail.post.channels.map((channel) => SOCIAL_CHANNEL_LABELS[channel]).join(', ')}.`, [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: retry ? 'Ponów' : 'Opublikuj',
        onPress: async () => {
          setBusy(retry ? 'Ponawiam publikację' : 'Publikuję');
          try {
            const result = await socialPost<SocialPostDetail>('publishNow', { id: detail.post.id, revision: detail.post.revision });
            apply(result);
            if (result.publishResult?.status === 'published') Alert.alert('Social media', 'Post opublikowany.');
            else if (result.publishResult?.status === 'failed') Alert.alert('Publikacja', result.publishResult.error || 'Publikacja nie powiodła się.');
            else Alert.alert('Social media', 'Publikacja trwa — karta odświeży się sama.');
          } catch (cause) {
            Alert.alert('Publikacja', socialErrorMessage(cause, 'Nie udało się opublikować posta.'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const schedule = () => {
    if (!detail) return;
    setScheduleOpen(false);
    void run('Planuję publikację', () => socialPost<SocialPostDetail>('schedulePublication', {
      id: detail.post.id, revision: detail.post.revision, scheduledAt: scheduleDate.toISOString(),
    }), detail.post.status === 'scheduled' ? 'Zmieniono termin publikacji.' : SOCIAL_POST_ACTION_SUCCESS.schedule);
  };

  const saveImage = async (url: string | null) => {
    if (!url) return;
    setBusy('Zapisuję grafikę');
    try {
      await saveChatPhoto(url);
      Alert.alert('Zapisano', 'Grafika jest w Zdjęciach. Opis skopiujesz przyciskiem „Kopiuj opis”.');
    } catch (cause) {
      Alert.alert('Zapis grafiki', cause instanceof PhotoPermissionError ? 'Zezwól aplikacji na zapis zdjęć w ustawieniach.' : socialErrorMessage(cause, 'Nie udało się zapisać grafiki.'));
    } finally {
      setBusy(null);
    }
  };

  /** Kafelki do ręcznej publikacji (po kolei 1…N); siatkę publikuje się od ostatniego kafelka. */
  const saveTiles = async (urls: string[], grid: boolean) => {
    setBusy('Zapisuję kafelki');
    try {
      for (const url of urls) await saveChatPhoto(url);
      Alert.alert('Zapisano', grid
        ? `Kafelki (${urls.length}) są w Zdjęciach. Publikuj od kafelka ${urls.length} do 1 — kafelek 1 na końcu, z opisem („Kopiuj opis”); pozostałe z hashtagami.`
        : `Slajdy (${urls.length}) są w Zdjęciach w kolejności 1–${urls.length} — dodaj je jako jedną karuzelę.`);
    } catch (cause) {
      Alert.alert('Zapis kafelków', cause instanceof PhotoPermissionError ? 'Zezwól aplikacji na zapis zdjęć w ustawieniach.' : socialErrorMessage(cause, 'Nie udało się zapisać kafelków.'));
    } finally {
      setBusy(null);
    }
  };

  if (!detail) {
    return (
      <View style={styles.center}>
        {error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color={colors.primary.gold} size="large" />}
      </View>
    );
  }

  const editable = detail.access.create && socialPostEditable(detail.post.status);
  const problems = Array.from(new Set([...detail.problems.submit, ...detail.problems.publish]));
  const assets = Array.from(new Map([
    ...detail.variants.filter((variant) => variant.asset).map((variant) => [variant.asset!.id, variant.asset!] as const),
    ...(detail.slides || []).filter((slide) => slide.asset).map((slide) => [slide.asset!.id, slide.asset!] as const),
    ...(detail.slots || []).filter((item) => item.asset).map((item) => [item.asset!.id, item.asset!] as const),
  ]).values());
  const layoutOptions = detail.layouts || [];
  // Siatka profilu / panorama: gotowe układy dużej grafiki (kształt w `definition.canvas`); zwykły post ↔ siatka — bez zamiany.
  const canvas = detail.canvas || null;
  const canvasOptions = detail.canvasLayouts || [];
  const allLayouts = [...layoutOptions, ...canvasOptions];
  const sameChoice = (a: { id: string | null; key: string | null } | null, b: { id: string | null; key: string | null } | null) =>
    Boolean(a) === Boolean(b) && (a?.id || null) === (b?.id || null) && (a?.key || null) === (b?.key || null);
  const savedLayout = detail.layout ? { id: detail.layout.id, key: detail.layout.key } : null;
  const chosenLayout = layoutChoice ? allLayouts.find((option) => sameChoice(option, layoutChoice)) || null : null;
  // Ten sam układ co w poście (bez „nowej wersji”) — liczba zdjęć z zapisanej migawki; inny — z aktualnej wersji układu.
  const layoutSlots = !layoutChoice ? 1
    : detail.layout && sameChoice(layoutChoice, savedLayout) && !layoutRefresh ? detail.layout.slots : chosenLayout?.slots || detail.layout?.slots || 1;
  const pickLayout = (choice: { id: string | null; key: string | null } | null, refresh = false) => {
    const option = choice ? allLayouts.find((item) => sameChoice(item, choice)) : null;
    const count = !choice ? 1 : detail.layout && sameChoice(choice, savedLayout) && !refresh ? detail.layout.slots : option?.slots || 1;
    setLayoutChoice(choice);
    setLayoutRefresh(refresh);
    setLayoutChanged(true);
    setCollage((current) => current.filter((item) => item.slot < count));
    setDirty(true);
  };
  const text = socialPublicationText(caption, normalizeHashtags(hashtags));
  const canvasShape: SocialCanvasShape | null = canvas
    ? socialCanvasOf(canvasOptions.find((option) => sameChoice(option, layoutChoice))?.definition) || socialCanvasOf(detail.layout?.definition)
    : null;
  const canvasShapes = canvasOptions.reduce<SocialCanvasShape[]>((list, option) => {
    const shape = socialCanvasOf(option.definition);
    if (shape && !list.some((item) => sameSocialCanvas(item, shape))) list.push(shape);
    return list;
  }, []);
  /** Rodzaj układu bez liczby (np. `preset-grid-photo` dla `preset-grid-2-photo`) — przy zmianie kształtu zostaje ten sam rodzaj. */
  const canvasKind = (key: string | null | undefined) => (key || '').replace(/-\d+(-|$)/, '$1');
  const pickCanvasShape = (shape: SocialCanvasShape) => {
    const list = canvasOptions.filter((option) => sameSocialCanvas(socialCanvasOf(option.definition), shape));
    const next = list.find((option) => canvasKind(option.key) === canvasKind(layoutChoice?.key)) || list[0];
    if (next) pickLayout({ id: next.id, key: next.key });
  };
  const tiles = [...(detail.tiles || [])].sort((a, b) => a.position - b.position);
  const tilesReady = Boolean(canvas) && tiles.length === (canvas?.tiles || 0) && tiles.every((tile) => tile.upToDate && tile.renderedUrl);
  const tileTotal = canvas?.mode === 'grid' ? canvas.tiles : 0;
  const gridCell = Math.floor((width - spacing.md * 2 - 8) / 3);
  const gridCellHeight = Math.round((gridCell * 4) / 3);
  const tileWidth = gridCellHeight * 0.8;
  const slideWidth = width - spacing.md * 2;
  const outdatedNote = detail.layout?.outdated && sameChoice(layoutChoice, savedLayout) ? (
    <View style={[styles.note, { marginHorizontal: 0, borderColor: layoutRefresh ? colors.primary.gold : colors.status.warning }]}>
      <Text style={styles.body}>
        {layoutRefresh
          ? `Nowa wersja układu „${detail.layout.name}” — zapisz post, żeby ją zastosować.`
          : `Układ „${detail.layout.name}” zmieniono po zapisaniu tego posta — post ma dotychczasową wersję.`}
      </Text>
      {(layoutRefresh || editable) && (
        <TouchableOpacity style={styles.link} onPress={() => pickLayout(layoutChoice, !layoutRefresh)}>
          <Text style={styles.linkText}>{layoutRefresh ? 'Zostaw dotychczasową' : 'Wczytaj nową wersję'}</Text>
        </TouchableOpacity>
      )}
    </View>
  ) : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={{ paddingBottom: spacing.xxl }} scrollEnabled={!slideDragging}>
        {canvas ? (
          <View style={styles.section}>
            <Text style={styles.muted}>{canvas.label} · po 1080×1350 px{tilesReady ? '' : ' · kafelki nieaktualne — zapisz post'}</Text>
            {canvas.mode === 'grid' ? (
              <View style={styles.gridBox}>
                {Array.from({ length: canvas.tiles }, (_, index) => index + 1).map((position) => {
                  const tile = tiles.find((item) => item.position === position);
                  return (
                    <View key={position} style={{ width: gridCell, height: gridCellHeight, overflow: 'hidden', backgroundColor: colors.background.tertiary }}>
                      {tile?.renderedUrl
                        ? <Image source={{ uri: tile.renderedUrl }} style={{ width: tileWidth, height: gridCellHeight, marginLeft: (gridCell - tileWidth) / 2 }} />
                        : null}
                      <View style={styles.tileBadge}><Text style={styles.tileBadgeText}>{position} · publikacja {canvas.tiles - position + 1}.</Text></View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -spacing.md }}>
                {Array.from({ length: canvas.tiles }, (_, index) => index + 1).map((position) => {
                  const tile = tiles.find((item) => item.position === position);
                  return (
                    <View key={position} style={{ width, paddingHorizontal: spacing.md, gap: spacing.xs }}>
                      {tile?.renderedUrl
                        ? <Image source={{ uri: tile.renderedUrl }} style={{ width: slideWidth, height: Math.min(slideWidth * 1.25, 560), borderRadius: borderRadius.md }} resizeMode="contain" />
                        : <View style={[styles.placeholder, { width: slideWidth, height: Math.min(slideWidth * 1.25, 560) }]}><Feather name="image" size={28} color={colors.text.tertiary} /></View>}
                      <Text style={styles.muted}>Slajd {position}/{canvas.tiles} — przesuń, żeby zobaczyć kolejne</Text>
                    </View>
                  );
                })}
              </ScrollView>
            )}
            <Text style={styles.muted}>
              {canvas.mode === 'grid'
                ? `Tak kafelki złożą się w profilu (siatka przycina je do 3:4). Publikacja od kafelka ${canvas.tiles} do 1.`
                : 'Jedno zdjęcie przez wszystkie slajdy karuzeli (Instagram — przesuwane bez przerw, Facebook i LinkedIn — post z kilkoma zdjęciami).'}
            </Text>
            {tilesReady && (
              <TouchableOpacity style={styles.link} onPress={() => void saveTiles(tiles.map((tile) => tile.renderedUrl!), canvas.mode === 'grid')}>
                <Feather name="download" size={14} color={colors.primary.gold} />
                <Text style={styles.linkText}>{canvas.mode === 'grid' ? 'Zapisz kafelki w Zdjęciach' : 'Zapisz slajdy w Zdjęciach'}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          {detail.variants.map((variant) => {
            const info = SOCIAL_FORMAT_INFO[variant.format];
            const imageWidth = width - spacing.md * 2;
            return (
              <View key={variant.id} style={{ width, padding: spacing.md, gap: spacing.xs }}>
                <Text style={styles.muted}>{info.label}{variant.upToDate ? '' : ' · grafika nieaktualna — zapisz post'}</Text>
                {variant.renderedUrl
                  ? <Image source={{ uri: variant.renderedUrl }} style={{ width: imageWidth, height: Math.min(imageWidth * info.height / info.width, 560), borderRadius: borderRadius.md }} resizeMode="contain" />
                  : <View style={[styles.placeholder, { width: imageWidth, height: imageWidth * info.height / info.width }]}><Feather name="image" size={28} color={colors.text.tertiary} /></View>}
                {variant.renderedUrl && (
                  <TouchableOpacity style={styles.link} onPress={() => void saveImage(variant.renderedUrl)}>
                    <Feather name="download" size={14} color={colors.primary.gold} /><Text style={styles.linkText}>Zapisz grafikę w Zdjęciach</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </ScrollView>
        )}

        <View style={styles.section}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <SocialStatusBadge status={detail.post.status} />
            <Text style={styles.muted}>{socialDateLabel(detail.post.scheduledAt)}</Text>
          </View>
          <Text style={styles.title}>{detail.post.title || 'Post bez tytułu'}</Text>
          <Text style={styles.muted}>{detail.post.channels.map((channel) => SOCIAL_CHANNEL_LABELS[channel]).join(' · ')}{detail.post.authorName ? ` · autor: ${detail.post.authorName}` : ''}</Text>
          {detail.event && <Text style={styles.muted}>Wydarzenie: {detail.event.name}{detail.event.location ? ` · ${detail.event.location}` : ''}</Text>}
        </View>

        {detail.post.reviewNote && (detail.post.status === 'changes_requested' || detail.post.status === 'approved') && (
          <View style={[styles.note, { borderColor: detail.post.status === 'approved' ? colors.status.success : colors.status.warning }]}>
            <Text style={styles.noteTitle}>{detail.post.status === 'approved' ? 'Zatwierdził(a)' : 'Do poprawy'}{detail.post.reviewedByName ? ` — ${detail.post.reviewedByName}` : ''}</Text>
            <Text style={styles.body}>{detail.post.reviewNote}</Text>
          </View>
        )}

        {(detail.meta || (detail.publications || []).length > 0 || ['scheduled', 'publishing', 'failed'].includes(detail.post.status)) && (
          <View style={styles.section}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.label}>Publikacja</Text>
              {(detail.publications || []).some((item) => item.status === 'published') && (
                <TouchableOpacity onPress={() => void run('Pobieram wyniki z Meta', () => socialPost<SocialPostDetail>('metricsRefresh', { postId: detail.post.id }), 'Odświeżono wyniki posta.')}
                  accessibilityRole="button" accessibilityLabel="Odśwież wyniki z Meta">
                  <Text style={styles.linkText}>↻ Wyniki</Text>
                </TouchableOpacity>
              )}
            </View>
            {detail.post.status === 'scheduled' && (
              <Text style={[styles.body, { color: colors.status.info }]}>Zaplanowano na {socialDateLabel(detail.post.scheduledAt)}{detail.post.scheduledByName ? ` — ${detail.post.scheduledByName}` : ''}. Post opublikuje się automatycznie.</Text>
            )}
            {detail.post.status === 'publishing' && <Text style={[styles.body, { color: colors.status.info }]}>Trwa publikacja…</Text>}
            {detail.post.status === 'failed' && detail.post.publishError ? <Text style={[styles.body, { color: colors.status.error }]}>{detail.post.publishError}</Text> : null}
            {detail.post.channels.map((channel) => {
              // Siatka profilu: osobny post Instagram na kafelek — stan zbiorczy i lista kafelków (jak w CRM i na Macu).
              const tileRows = tileTotal
                ? (detail.publications || []).filter((item) => item.channel === channel && (item.tile || 0) > 0).sort((a, b) => (a.tile || 0) - (b.tile || 0)) : [];
              const tilesPublished = tileRows.filter((item) => item.status === 'published').length;
              const firstTile = tileRows.find((item) => item.status !== 'published') || tileRows[0];
              const publication = tileTotal
                ? (firstTile ? {
                  ...firstTile,
                  status: tilesPublished === tileTotal ? 'published' : tileRows.some((item) => item.status === 'failed') ? 'failed'
                    : tileRows.some((item) => item.status === 'sending') ? 'sending' : 'pending',
                } : undefined)
                : (detail.publications || []).find((item) => item.channel === channel);
              const problem = detail.meta?.channels[channel]?.problem;
              const manual = socialManualChannel(detail.meta, channel);
              return (
                <View key={channel} style={{ gap: 2 }}>
                  <Text style={styles.body}>
                    {publication?.status === 'published' ? '✓' : publication?.status === 'failed' ? '✗' : manual ? '○' : problem ? '!' : '•'} {SOCIAL_CHANNEL_LABELS[channel]} — {publication ? SOCIAL_PUBLICATION_STATUS_LABELS[publication.status] || publication.status : manual ? 'publikacja ręczna' : problem ? 'niegotowy' : 'gotowy'}
                    {tileTotal ? ` · ${tilesPublished}/${tileTotal} kafelków` : ''}
                  </Text>
                  {!tileTotal && publication?.permalink ? (
                    <TouchableOpacity onPress={() => void Linking.openURL(publication.permalink!)}><Text style={styles.linkText}>Otwórz post ↗</Text></TouchableOpacity>
                  ) : null}
                  {tileRows.length > 0 && (
                    <View style={styles.chips}>
                      {tileRows.map((item) => (item.permalink ? (
                        <TouchableOpacity key={item.tile} style={[styles.chip, { borderColor: colors.status.success }]} onPress={() => void Linking.openURL(item.permalink!)}>
                          <Text style={[styles.chipText, { color: colors.status.success }]}>Kafelek {item.tile} ↗</Text>
                        </TouchableOpacity>
                      ) : (
                        <View key={item.tile} style={[styles.chip, item.status === 'failed' && { borderColor: colors.status.error }]}>
                          <Text style={[styles.chipText, item.status === 'failed' && { color: colors.status.error }]}>
                            Kafelek {item.tile}: {SOCIAL_PUBLICATION_STATUS_LABELS[item.status] || item.status}
                          </Text>
                        </View>
                      )))}
                    </View>
                  )}
                  {publication?.error && publication.status !== 'published' ? <Text style={[styles.muted, { color: colors.status.error }]}>{publication.error}</Text> : null}
                  {!publication && problem ? <Text style={[styles.muted, manual ? null : { color: colors.status.warning }]}>{problem}</Text> : null}
                  {publication?.status === 'published' && channel === 'linkedin_page' ? (
                    <Text style={styles.muted}>Wyniki postów LinkedIn nie są jeszcze pobierane do CRM.</Text>
                  ) : publication?.status === 'published' ? (
                    SOCIAL_METRICS.some((key) => publication.metrics?.[key] != null) ? (
                      <View style={{ gap: 2 }}>
                        <Text style={styles.muted}>
                          {SOCIAL_METRICS.filter((key) => publication.metrics?.[key] != null)
                            .map((key) => `${SOCIAL_METRIC_LABELS[key]}: ${formatSocialNumber(publication.metrics?.[key])}`).join(' · ')}
                        </Text>
                        <Text style={styles.muted}>
                          {publication.rate != null ? `Zaangażowanie ${formatSocialPercent(publication.rate)}` : ''}
                          {publication.metricsSyncedAt ? `${publication.rate != null ? ' · ' : ''}pobrano ${socialDateLabel(publication.metricsSyncedAt)}` : ''}
                          {publication.metricsError ? ` · ${publication.metricsError}` : ''}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.muted}>{publication.metricsError || (publication.metricsSyncedAt ? 'Meta nie podała jeszcze wyników.' : 'Wyniki pojawią się w ciągu godziny od publikacji.')}</Text>
                    )
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        {!canvas && (slides.length > 0 || (editable && detail.variants.some((variant) => variant.assetId && SOCIAL_SLIDE_FORMATS.includes(variant.format)))) && (
          <View style={styles.section}>
            <Text style={styles.label}>Karuzela — {1 + slides.length}/{SOCIAL_LIMITS.slides + 1} zdjęć (Instagram — przesuwane zdjęcia, Facebook i LinkedIn — post z kilkoma zdjęciami)</Text>
            {editable && slides.length > 1 && <Text style={styles.muted}>Przeciągnij zdjęcie za uchwyt ≡, żeby zmienić kolejność.</Text>}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }} scrollEnabled={!slideDragging}>
              <ReorderableList horizontal items={slides} keyOf={(slide, index) => `${slide.assetId}-${index}`} gap={spacing.sm} disabled={!editable}
                onDragChange={setSlideDragging}
                onMove={(from, to) => {
                  setSlides((current) => { const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next; });
                  setSlidesChanged(true);
                  setDirty(true);
                }}
                renderItem={(slide, index, handle) => (
                <View style={{ width: 112, gap: 4 }}>
                  {slide.image
                    ? <Image source={{ uri: slide.image }} style={{ width: 112, height: 140, borderRadius: borderRadius.md }} />
                    : <View style={[styles.placeholder, { width: 112, height: 140 }]}><Feather name="image" size={20} color={colors.text.tertiary} /></View>}
                  <Text style={styles.muted}>Zdjęcie {index + 2}</Text>
                  {editable && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <TouchableOpacity disabled={index === 0} hitSlop={8}
                        onPress={() => { setSlides((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; }); setSlidesChanged(true); setDirty(true); }}>
                        <Feather name="chevron-left" size={20} color={index === 0 ? colors.text.disabled : colors.primary.gold} />
                      </TouchableOpacity>
                      <TouchableOpacity disabled={index === slides.length - 1} hitSlop={8}
                        onPress={() => { setSlides((current) => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; }); setSlidesChanged(true); setDirty(true); }}>
                        <Feather name="chevron-right" size={20} color={index === slides.length - 1 ? colors.text.disabled : colors.primary.gold} />
                      </TouchableOpacity>
                      {handle}
                      <TouchableOpacity hitSlop={8} onPress={() => { setSlides((current) => current.filter((_, position) => position !== index)); setSlidesChanged(true); setDirty(true); }}>
                        <Feather name="trash-2" size={18} color={colors.status.error} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )} />
              {editable && slides.length < SOCIAL_LIMITS.slides && (
                <TouchableOpacity style={[styles.placeholder, { width: 112, height: 140, gap: 6 }]} onPress={() => { setLibraryTarget('slide'); setLibraryOpen(true); }}>
                  <Feather name="plus" size={22} color={colors.primary.gold} />
                  <Text style={[styles.muted, { textAlign: 'center' }]}>Dodaj z biblioteki</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
            {slidesChanged && <Text style={styles.muted}>Zapisz post — serwer wygeneruje grafiki karuzeli (ten sam styl co okładka, bez tekstów).</Text>}
          </View>
        )}

        {canvas && (
          <View style={styles.section}>
            <Text style={styles.label}>Siatka profilu / panorama</Text>
            <View style={styles.chips}>
              {canvasShapes.map((shape) => {
                const active = sameSocialCanvas(shape, canvasShape);
                return (
                  <TouchableOpacity key={shape.mode === 'grid' ? `grid-${shape.rows}` : `pano-${shape.slides}`} disabled={!editable}
                    accessibilityRole="button" accessibilityState={{ selected: active, disabled: !editable }}
                    style={[styles.chip, active && styles.chipActive]} onPress={() => pickCanvasShape(shape)}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{shape.mode === 'grid' ? `Siatka ${shape.rows * 3}` : `Panorama ${shape.slides}`}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.chips}>
              {canvasOptions.filter((option) => sameSocialCanvas(socialCanvasOf(option.definition), canvasShape)).map((option) => {
                const choice = { id: option.id, key: option.key };
                const active = sameChoice(choice, layoutChoice);
                return (
                  <TouchableOpacity key={option.id || option.key || option.name} disabled={!editable}
                    accessibilityRole="button" accessibilityState={{ selected: active, disabled: !editable }}
                    style={[styles.chip, active && styles.chipActive]} onPress={() => pickLayout(choice, active && layoutRefresh)}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{active ? '✓ ' : ''}{option.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {outdatedNote}
            <Text style={styles.label}>Zdjęcie</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              {mainAsset?.image
                ? <Image source={{ uri: mainAsset.image }} style={{ width: 64, height: 80, borderRadius: borderRadius.md }} />
                : <View style={[styles.placeholder, { width: 64, height: 80 }]}><Feather name="image" size={20} color={colors.text.tertiary} /></View>}
              {editable && (
                <TouchableOpacity style={styles.link} onPress={() => { setLibraryTarget('main'); setLibraryOpen(true); }}>
                  <Feather name="image" size={14} color={colors.primary.gold} />
                  <Text style={styles.linkText}>{mainAsset ? 'Zmień zdjęcie' : 'Wybierz zdjęcie z biblioteki'}</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.muted}>
              {canvasShape?.mode === 'grid'
                ? 'Każdy kafelek to osobny post (tylko feed Instagram) — zasięg rozkłada się na kafelki; całość widać po wejściu na profil. Przypięte posty przesuwają siatkę; kolejne posty publikuj po 3.'
                : 'Panorama to jeden post — karuzela na Instagramie, Facebooku i LinkedIn (bez relacji).'}
              {' '}Kadr — propozycja; ustawisz go w CRM albo na Macu (z liniami cięcia).
            </Text>
            {(layoutChanged || mainChanged) && <Text style={styles.muted}>Zapisz post — serwer pocięje grafikę na kafelki.</Text>}
          </View>
        )}

        {!canvas && (layoutOptions.length > 0 || detail.layout) && (
          <View style={styles.section}>
            <Text style={styles.label}>Układ grafiki</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {[null, ...layoutOptions].map((option) => {
                const choice = option ? { id: option.id, key: option.key } : null;
                const active = sameChoice(choice, layoutChoice);
                return (
                  <TouchableOpacity key={option ? option.id || option.key || option.name : 'style'} disabled={!editable}
                    style={[styles.chip, active && styles.chipActive]} onPress={() => pickLayout(choice, active && layoutRefresh)}>
                    <Text style={[styles.chipText, active && { color: colors.primary.gold }]}>
                      {option ? `${option.name}${option.slots > 1 ? ` · ${option.slots} zdjęcia` : ''}` : 'Styl grafiki'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {outdatedNote}
            {layoutChoice && <Text style={styles.muted}>Układ zastępuje styl na okładce (styl dotyczy kolejnych zdjęć karuzeli). Kadry ustawisz w CRM albo na Macu — tu propozycja.</Text>}
            {layoutSlots > 1 && (
              <>
                <Text style={styles.label}>Kolaż — {layoutSlots} zdjęcia</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                  {Array.from({ length: layoutSlots - 1 }, (_, index) => index + 1).map((slot) => {
                    const item = collage.find((entry) => entry.slot === slot);
                    return (
                      <View key={slot} style={{ width: 96, gap: 4 }}>
                        {item ? (
                          item.image
                            ? <Image source={{ uri: item.image }} style={{ width: 96, height: 120, borderRadius: borderRadius.md }} />
                            : <View style={[styles.placeholder, { width: 96, height: 120 }]}><Feather name="image" size={20} color={colors.text.tertiary} /></View>
                        ) : (
                          <TouchableOpacity disabled={!editable} style={[styles.placeholder, { width: 96, height: 120, gap: 6 }]}
                            onPress={() => { setLibraryTarget(slot); setLibraryOpen(true); }}>
                            <Feather name="plus" size={22} color={colors.primary.gold} />
                            <Text style={[styles.muted, { textAlign: 'center' }]}>Zdjęcie {slot + 1}</Text>
                          </TouchableOpacity>
                        )}
                        <Text style={styles.muted}>Zdjęcie {slot + 1}</Text>
                        {editable && item && (
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                            <TouchableOpacity hitSlop={8} onPress={() => { setLibraryTarget(slot); setLibraryOpen(true); }}>
                              <Feather name="refresh-cw" size={18} color={colors.primary.gold} />
                            </TouchableOpacity>
                            <TouchableOpacity hitSlop={8} onPress={() => { setCollage((current) => current.filter((entry) => entry.slot !== slot)); setCollageChanged(true); setDirty(true); }}>
                              <Feather name="trash-2" size={18} color={colors.status.error} />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
              </>
            )}
            {(layoutChanged || collageChanged) && <Text style={styles.muted}>Zapisz post — serwer wygeneruje grafiki w wybranym układzie.</Text>}
          </View>
        )}

        {problems.length > 0 && (
          <View style={[styles.note, { borderColor: colors.status.warning }]}>
            <Text style={styles.noteTitle}>Do uzupełnienia</Text>
            {problems.map((problem) => <Text key={problem} style={styles.body}>• {problem}</Text>)}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.label}>Zgoda klienta</Text>
          {assets.map((asset) => (
            <Text key={asset.id} style={[styles.body, { color: socialConsentAllows(asset.consent.status) ? colors.status.success : colors.status.warning }]}>
              {socialConsentAllows(asset.consent.status) ? '✓' : '?'} {asset.title || asset.originalName || 'Zdjęcie'}
            </Text>
          ))}
          {!assets.length && <Text style={styles.muted}>Post nie ma jeszcze zdjęcia.</Text>}
        </View>

        <View style={styles.section}>
          {canvas ? (
            <>
              <Text style={styles.label}>Teksty na dużej grafice</Text>
              <Text style={styles.muted}>Logo, kolory i fonty — z księgi znaku marki. Nowe kafelki zobaczysz po zapisie.</Text>
            </>
          ) : (
          <>
          <Text style={styles.label}>Styl grafiki</Text>
          <View style={styles.chips}>
            {SOCIAL_GRAPHIC_STYLE_LIST.map((item) => (
              <TouchableOpacity key={item} style={[styles.chip, style === item && styles.chipActive]} disabled={!editable}
                accessibilityRole="button" accessibilityState={{ selected: style === item, disabled: !editable }}
                onPress={() => { setStyle(item); setDirty(true); }}>
                <Text style={[styles.chipText, style === item && styles.chipTextActive]}>
                  {style === item ? '✓ ' : ''}{SOCIAL_GRAPHIC_STYLES[item]}{detail.template?.defaultStyle === item ? ' ★' : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.muted}>{SOCIAL_GRAPHIC_STYLE_HINTS[style]}{editable ? ' Nową grafikę zobaczysz po zapisie.' : ''}</Text>
          </>
          )}
          <Text style={styles.label}>Napis nad tytułem (opcjonalnie)</Text>
          <TextInput style={styles.input} value={kicker} editable={editable} maxLength={SOCIAL_LIMITS.kicker} placeholder="np. Realizacja" placeholderTextColor={colors.text.tertiary}
            onChangeText={(value) => { setKicker(value); setDirty(true); }} />
          {editable && (
            <View style={styles.chips}>
              {SOCIAL_KICKER_SUGGESTIONS.map((item) => (
                <TouchableOpacity key={item} style={[styles.chip, kicker === item && styles.chipActive]} accessibilityRole="button"
                  onPress={() => { setKicker(kicker === item ? '' : item); setDirty(true); }}>
                  <Text style={[styles.chipText, kicker === item && styles.chipTextActive]}>{item}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Text style={styles.label}>Tytuł na grafice ({headline.length}/{SOCIAL_LIMITS.headlineRecommended} zalecane)</Text>
          <TextInput style={styles.input} value={headline} editable={editable} maxLength={SOCIAL_LIMITS.headline} placeholder="Od koncepcji po ostatni akord" placeholderTextColor={colors.text.tertiary}
            onChangeText={(value) => { setHeadline(value); setDirty(true); }} />
          <Text style={styles.label}>Podpis na grafice</Text>
          <TextInput style={styles.input} value={subline} editable={editable} maxLength={SOCIAL_LIMITS.subline} placeholder="Realizacja · miejsce" placeholderTextColor={colors.text.tertiary}
            onChangeText={(value) => { setSubline(value); setDirty(true); }} />
          <Text style={styles.label}>Opis ({caption.length}/{SOCIAL_LIMITS.caption})</Text>
          <TextInput style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]} multiline value={caption} editable={editable} maxLength={SOCIAL_LIMITS.caption}
            onChangeText={(value) => { setCaption(value); setDirty(true); }} />
          {canvas?.mode === 'grid' && (
            <Text style={styles.muted}>Opis z hashtagami trafia do kafelka 1 (lewy górny, publikowany na końcu); pozostałe kafelki dostają same hashtagi.</Text>
          )}
          <Text style={styles.label}>Hashtagi ({normalizeHashtags(hashtags).length}/{SOCIAL_LIMITS.hashtags})</Text>
          <TextInput style={styles.input} value={hashtags} editable={editable} autoCapitalize="none" placeholder="#mavinci #eventy" placeholderTextColor={colors.text.tertiary}
            onChangeText={(value) => { setHashtags(value); setDirty(true); }} />
          <TouchableOpacity style={styles.link} onPress={() => { void Clipboard.setStringAsync(text).then(() => Alert.alert('Skopiowano', 'Opis z hashtagami jest w schowku.')); }}>
            <Feather name="copy" size={14} color={colors.primary.gold} /><Text style={styles.linkText}>Kopiuj opis</Text>
          </TouchableOpacity>
        </View>

        {editable && (
          <View style={styles.section}>
            <SocialAssistantCard detail={detail}
              draft={{
                caption, hashtags, headline, subline, eventId: detail.post.eventId,
                assetId: detail.variants.find((variant) => variant.assetId)?.assetId || null, channels: detail.post.channels,
              }}
              onBusy={setBusy}
              onUse={(suggestion, withGraphic) => {
                setCaption(suggestion.caption);
                if (suggestion.hashtags.length) setHashtags(suggestion.hashtags.join(' '));
                if (withGraphic) {
                  if (suggestion.headline) setHeadline(suggestion.headline);
                  if (suggestion.subline) setSubline(suggestion.subline);
                }
                setDirty(true);
              }}
              onHashtags={(tags) => { setHashtags(tags.join(' ')); setDirty(true); }}
              onEnabled={() => setDetail((current) => (current ? { ...current, settings: { ...current.settings, aiCaptionsEnabled: true } } : current))} />
          </View>
        )}

        <View style={[styles.section, { gap: spacing.sm }]}>
          {editable && dirty && (
            <TouchableOpacity style={styles.primary} onPress={() => void run('Zapisuję', () => save())}><Text style={styles.primaryText}>Zapisz zmiany</Text></TouchableOpacity>
          )}
          {detail.actions.includes('submit') && (
            <TouchableOpacity style={styles.primary} onPress={() => void transition('submit')}><Text style={styles.primaryText}>Wyślij do akceptacji</Text></TouchableOpacity>
          )}
          {detail.actions.includes('approve') && (
            <TouchableOpacity style={styles.primary} onPress={() => void transition('approve')}><Text style={styles.primaryText}>Zatwierdź</Text></TouchableOpacity>
          )}
          {detail.actions.includes('request_changes') && (
            <TouchableOpacity style={styles.secondary} onPress={() => { setNote(''); setNoteModal('request_changes'); }}><Text style={styles.secondaryText}>Do poprawy</Text></TouchableOpacity>
          )}
          {detail.canPublishNow && (
            <TouchableOpacity style={[styles.primary, dirty && { opacity: 0.5 }]} disabled={dirty} onPress={publishNow}>
              <Text style={styles.primaryText}>{detail.post.status === 'failed' ? 'Ponów publikację' : 'Opublikuj teraz'}</Text>
            </TouchableOpacity>
          )}
          {(detail.actions.includes('schedule') || (detail.post.status === 'scheduled' && detail.access.publish)) && (
            <TouchableOpacity style={[styles.secondary, dirty && { opacity: 0.5 }]} disabled={dirty}
              onPress={() => { setScheduleDate(defaultScheduleDate(detail.post.scheduledAt)); setSchedulePicker(Platform.OS === 'ios' ? null : 'date'); setScheduleOpen(true); }}>
              <Feather name="calendar" size={16} color={colors.primary.gold} />
              <Text style={styles.secondaryText}>{detail.post.status === 'scheduled' ? 'Zmień termin publikacji' : 'Zaplanuj publikację'}</Text>
            </TouchableOpacity>
          )}
          {detail.actions.includes('unschedule') && (
            <TouchableOpacity style={styles.secondary} onPress={() => void transition('unschedule')}><Text style={styles.secondaryText}>Wstrzymaj publikację</Text></TouchableOpacity>
          )}
          {detail.actions.includes('publish') && (
            <TouchableOpacity style={styles.secondary} onPress={() => { setNote(''); setNoteModal('publish'); }}><Text style={styles.secondaryText}>Oznacz jako opublikowany</Text></TouchableOpacity>
          )}
          {detail.actions.includes('reopen') && (
            <TouchableOpacity style={styles.secondary} onPress={() => void transition('reopen')}><Text style={styles.secondaryText}>Przywróć do szkicu</Text></TouchableOpacity>
          )}
          <TouchableOpacity style={styles.link} onPress={() => navigation.goBack()}><Text style={styles.linkText}>Wróć do listy</Text></TouchableOpacity>
        </View>

        {((detail.publications || []).some((item) => item.status === 'published' && item.channel !== 'instagram_story') || (detail.comments?.total || 0) > 0) && (
          <View style={[styles.section, { paddingTop: spacing.lg }]} onLayout={(event) => setCommentsY(event.nativeEvent.layout.y)}>
            <SocialCommentsList postId={detail.post.id} />
          </View>
        )}
      </ScrollView>

      <Modal visible={scheduleOpen} transparent animationType="fade" onRequestClose={() => setScheduleOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.title}>{detail.post.status === 'scheduled' ? 'Zmień termin publikacji' : 'Zaplanuj publikację'}</Text>
            <Text style={styles.muted}>W tym terminie serwer opublikuje post: {detail.post.channels.map((channel) => SOCIAL_CHANNEL_LABELS[channel]).join(', ')}.</Text>
            {Platform.OS === 'ios' ? (
              <DateTimePicker value={scheduleDate} mode="datetime" display="spinner" locale="pl-PL" minuteInterval={5} themeVariant={appPalette().scheme}
                minimumDate={new Date(Date.now() + 60_000)} onChange={(_event, selected) => { if (selected) setScheduleDate(selected); }} />
            ) : (
              <TouchableOpacity style={styles.input} onPress={() => setSchedulePicker('date')}><Text style={styles.body}>{socialDateLabel(scheduleDate.toISOString())}</Text></TouchableOpacity>
            )}
            {Platform.OS === 'android' && schedulePicker && (
              <DateTimePicker value={scheduleDate} mode={schedulePicker} is24Hour minimumDate={schedulePicker === 'date' ? new Date() : undefined}
                onChange={(event, selected) => {
                  const step = schedulePicker;
                  setSchedulePicker(step === 'date' && event.type !== 'dismissed' ? 'time' : null);
                  if (event.type === 'dismissed' || !selected) return;
                  setScheduleDate(selected);
                }} />
            )}
            {(detail.problems.meta || []).map((problem) => <Text key={problem} style={[styles.muted, { color: colors.status.warning }]}>• {problem}</Text>)}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => setScheduleOpen(false)}><Text style={styles.secondaryText}>Anuluj</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.primary, { flex: 1 }]} onPress={schedule}><Text style={styles.primaryText}>Zaplanuj</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={noteModal !== null} transparent animationType="fade" onRequestClose={() => setNoteModal(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.title}>{noteModal === 'publish' ? 'Oznacz jako opublikowany' : 'Do poprawy'}</Text>
            <Text style={styles.muted}>{noteModal === 'publish' ? 'Gdy post opublikowano ręcznie (bez Meta lub LinkedIn) — wklej link do posta (opcjonalnie).' : 'Co poprawić? Autor dostanie powiadomienie.'}</Text>
            <TextInput style={[styles.input, noteModal === 'request_changes' && { minHeight: 90, textAlignVertical: 'top' }]} value={note} onChangeText={setNote}
              multiline={noteModal === 'request_changes'} autoCapitalize="none" placeholder={noteModal === 'publish' ? 'https://www.instagram.com/p/…' : 'Uwagi'} placeholderTextColor={colors.text.tertiary} />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => setNoteModal(null)}><Text style={styles.secondaryText}>Anuluj</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.primary, { flex: 1 }]} disabled={noteModal === 'request_changes' && !note.trim()}
                onPress={() => {
                  const kind = noteModal;
                  setNoteModal(null);
                  if (kind === 'publish') void transition('publish', { url: note.trim() });
                  else if (kind === 'request_changes') void transition('request_changes', { note: note.trim() });
                }}>
                <Text style={styles.primaryText}>{noteModal === 'publish' ? 'Opublikowany' : 'Odeślij'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <LibraryModal visible={libraryOpen} companyId={detail.post.companyId} onClose={() => { setLibraryOpen(false); setLibraryTarget('slide'); }} onPick={(asset) => {
        setLibraryOpen(false);
        if (libraryTarget === 'main') {
          setMainAsset({ id: asset.id, image: asset.thumbnailUrl });
          setMainChanged(true);
          setDirty(true);
          setLibraryTarget('slide');
          return;
        }
        if (libraryTarget !== 'slide') {
          const slot = libraryTarget;
          setCollage((current) => [...current.filter((entry) => entry.slot !== slot), { slot, assetId: asset.id, image: asset.thumbnailUrl }].sort((a, b) => a.slot - b.slot));
          setCollageChanged(true);
          setDirty(true);
          setLibraryTarget('slide');
          return;
        }
        if (slides.length >= SOCIAL_LIMITS.slides) return;
        setSlides((current) => [...current, { assetId: asset.id, image: asset.thumbnailUrl }]);
        setSlidesChanged(true);
        setDirty(true);
      }} />

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
  section: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.xs },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.medium },
  label: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, marginTop: spacing.sm },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm, lineHeight: 20 },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  input: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md, padding: spacing.sm, color: colors.text.primary, backgroundColor: colors.background.tertiary, fontSize: typography.fontSizes.sm },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.tertiary, borderRadius: borderRadius.md },
  note: { marginHorizontal: spacing.md, marginTop: spacing.md, borderWidth: 1, borderRadius: borderRadius.lg, padding: spacing.md, gap: 4, backgroundColor: colors.background.secondary },
  noteTitle: { color: colors.text.primary, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.sm },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.xs },
  linkText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  primary: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary.gold, paddingVertical: spacing.md, borderRadius: borderRadius.md },
  primaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.sm },
  secondary: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.hover, paddingVertical: spacing.md, borderRadius: borderRadius.md },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipActive: { borderColor: colors.primary.gold, backgroundColor: `${colors.primary.gold}33` },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  chipTextActive: { color: colors.primary.gold },
  gridBox: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, padding: 2, alignSelf: 'center', backgroundColor: '#000', borderRadius: borderRadius.md },
  tileBadge: { position: 'absolute', top: 3, left: 3, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  tileBadgeText: { color: colors.white, fontSize: 9 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: { width: '100%', backgroundColor: colors.background.elevated, borderRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.sm },
});
