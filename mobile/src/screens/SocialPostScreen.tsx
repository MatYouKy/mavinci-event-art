import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, Image, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography } from '../theme';
import {
  SOCIAL_CHANNEL_LABELS, SOCIAL_FORMAT_INFO, SOCIAL_LIMITS, SOCIAL_POST_ACTION_LABELS, SOCIAL_POST_ACTION_SUCCESS,
  SOCIAL_PUBLICATION_STATUS_LABELS, normalizeHashtags, socialConsentAllows, socialDateLabel, socialPostEditable, socialPublicationText,
  type SocialPostAction,
} from '../lib/socialShared';
import SocialCommentsList from '../components/Social/SocialCommentsList';
import { socialErrorMessage, socialGet, socialPost, type SocialAiSuggestion, type SocialPostDetail } from '../lib/socialApi';
import { PhotoPermissionError, saveChatPhoto } from '../services/saveChatPhoto';
import { SocialStatusBadge } from './SocialMediaScreen';

/*
 * Karta posta social media w aplikacji: grafiki wygenerowane na serwerze (te same pliki co w CRM i na Macu), opis
 * i hashtagi, braki (grafiki, zgoda klienta), uwagi akceptującego. Twórca: tytuł i podpis grafiki, opis, hashtagi,
 * opisy AI, „Wyślij do akceptacji”. Akceptujący: „Zatwierdź” (nie własny post) i „Do poprawy”. Publikujący: „Opublikuj teraz”,
 * „Zaplanuj publikację”, „Wstrzymaj publikację”, „Ponów publikację” (Meta) i „Oznacz jako opublikowany”. Wyniki kanałów
 * (link albo błąd) i komentarze Facebook / Instagram z odpowiedzią marki. Do ręcznej publikacji: zapis grafiki w Zdjęciach
 * i kopiowanie opisu. Bez edycji kadru (kadr z propozycji).
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

const width = Dimensions.get('window').width;

export default function SocialPostScreen() {
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
  const [dirty, setDirty] = useState(false);
  const [noteModal, setNoteModal] = useState<'request_changes' | 'publish' | null>(null);
  const [note, setNote] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(() => new Date());
  const [schedulePicker, setSchedulePicker] = useState<'date' | 'time' | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [commentsY, setCommentsY] = useState<number | null>(null);
  const scrolledToComments = useRef(false);

  const apply = (value: SocialPostDetail) => {
    setDetail(value);
    setCaption(value.post.caption);
    setHashtags(value.post.hashtags.join(' '));
    setHeadline(value.variants[0]?.headline || '');
    setSubline(value.variants[0]?.subline || '');
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
    // Grafiki zmieniamy tylko przy innym tytule lub podpisie — kadry ustawione w CRM albo na Macu zostają.
    const textChanged = detail.variants.some((variant) => variant.headline !== headline.trim() || variant.subline !== subline.trim());
    const result = await socialPost<SocialPostDetail>('savePost', {
      id: detail.post.id,
      updatedAt: detail.post.updatedAt,
      caption,
      hashtags: normalizeHashtags(hashtags),
      ...(textChanged ? {
        variants: detail.variants.map((variant) => ({ format: variant.format, assetId: variant.assetId, crop: variant.crop, headline, subline })),
      } : {}),
    });
    if (!quiet) Alert.alert('Social media', 'Zapisano post i wygenerowano grafiki.');
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
          setBusy(retry ? 'Ponawiam publikację' : 'Publikuję w Meta');
          try {
            const result = await socialPost<SocialPostDetail>('publishNow', { id: detail.post.id, revision: detail.post.revision });
            apply(result);
            if (result.publishResult?.status === 'published') Alert.alert('Social media', 'Post opublikowany w Meta.');
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

  const suggest = () => run('Opisy AI', async () => {
    let current = detail!;
    if (dirty) current = await save(true) || current;
    return socialPost<SocialPostDetail>('suggest', { id: current.post.id });
  });

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

  if (!detail) {
    return (
      <View style={styles.center}>
        {error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color={colors.primary.gold} size="large" />}
      </View>
    );
  }

  const editable = detail.access.create && socialPostEditable(detail.post.status);
  const problems = Array.from(new Set([...detail.problems.submit, ...detail.problems.publish]));
  const assets = Array.from(new Map(detail.variants.filter((variant) => variant.asset).map((variant) => [variant.asset!.id, variant.asset!])).values());
  const text = socialPublicationText(caption, normalizeHashtags(hashtags));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
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
            <Text style={styles.label}>Publikacja w Meta</Text>
            {detail.post.status === 'scheduled' && (
              <Text style={[styles.body, { color: colors.status.info }]}>Zaplanowano na {socialDateLabel(detail.post.scheduledAt)}{detail.post.scheduledByName ? ` — ${detail.post.scheduledByName}` : ''}. Post opublikuje się automatycznie.</Text>
            )}
            {detail.post.status === 'publishing' && <Text style={[styles.body, { color: colors.status.info }]}>Trwa publikacja w Meta…</Text>}
            {detail.post.status === 'failed' && detail.post.publishError ? <Text style={[styles.body, { color: colors.status.error }]}>{detail.post.publishError}</Text> : null}
            {detail.post.channels.map((channel) => {
              const publication = (detail.publications || []).find((item) => item.channel === channel);
              const problem = detail.meta?.channels[channel]?.problem;
              return (
                <View key={channel} style={{ gap: 2 }}>
                  <Text style={styles.body}>
                    {publication?.status === 'published' ? '✓' : publication?.status === 'failed' ? '✗' : problem ? '!' : '•'} {SOCIAL_CHANNEL_LABELS[channel]} — {publication ? SOCIAL_PUBLICATION_STATUS_LABELS[publication.status] || publication.status : problem ? 'niegotowy' : 'gotowy'}
                  </Text>
                  {publication?.permalink ? (
                    <TouchableOpacity onPress={() => void Linking.openURL(publication.permalink!)}><Text style={styles.linkText}>Otwórz post ↗</Text></TouchableOpacity>
                  ) : null}
                  {publication?.error && publication.status !== 'published' ? <Text style={[styles.muted, { color: colors.status.error }]}>{publication.error}</Text> : null}
                  {!publication && problem ? <Text style={[styles.muted, { color: colors.status.warning }]}>{problem}</Text> : null}
                </View>
              );
            })}
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
          <Text style={styles.label}>Tytuł na grafice ({headline.length}/{SOCIAL_LIMITS.headlineRecommended} zalecane)</Text>
          <TextInput style={styles.input} value={headline} editable={editable} maxLength={SOCIAL_LIMITS.headline} placeholder="Od koncepcji po ostatni akord" placeholderTextColor={colors.text.tertiary}
            onChangeText={(value) => { setHeadline(value); setDirty(true); }} />
          <Text style={styles.label}>Podpis na grafice</Text>
          <TextInput style={styles.input} value={subline} editable={editable} maxLength={SOCIAL_LIMITS.subline} placeholder="Realizacja · miejsce" placeholderTextColor={colors.text.tertiary}
            onChangeText={(value) => { setSubline(value); setDirty(true); }} />
          <Text style={styles.label}>Opis ({caption.length}/{SOCIAL_LIMITS.caption})</Text>
          <TextInput style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]} multiline value={caption} editable={editable} maxLength={SOCIAL_LIMITS.caption}
            onChangeText={(value) => { setCaption(value); setDirty(true); }} />
          <Text style={styles.label}>Hashtagi ({normalizeHashtags(hashtags).length}/{SOCIAL_LIMITS.hashtags})</Text>
          <TextInput style={styles.input} value={hashtags} editable={editable} autoCapitalize="none" placeholder="#mavinci #eventy" placeholderTextColor={colors.text.tertiary}
            onChangeText={(value) => { setHashtags(value); setDirty(true); }} />
          <TouchableOpacity style={styles.link} onPress={() => { void Clipboard.setStringAsync(text).then(() => Alert.alert('Skopiowano', 'Opis z hashtagami jest w schowku.')); }}>
            <Feather name="copy" size={14} color={colors.primary.gold} /><Text style={styles.linkText}>Kopiuj opis</Text>
          </TouchableOpacity>
        </View>

        {editable && detail.settings.aiCaptionsEnabled && (
          <View style={styles.section}>
            <TouchableOpacity style={styles.secondary} onPress={() => void suggest()}>
              <Feather name="zap" size={16} color={colors.primary.gold} /><Text style={styles.secondaryText}>{detail.post.aiSuggestions.length ? 'Nowe propozycje opisu (AI)' : 'Zaproponuj opis (AI)'}</Text>
            </TouchableOpacity>
            {detail.post.aiSuggestions.map((suggestion: SocialAiSuggestion, index) => (
              <View key={index} style={styles.suggestion}>
                {(suggestion.headline || suggestion.subline) ? <Text style={[styles.body, { color: colors.primary.gold }]}>{suggestion.headline}{suggestion.subline ? ` · ${suggestion.subline}` : ''}</Text> : null}
                <Text style={styles.body}>{suggestion.caption}</Text>
                <Text style={styles.muted}>{suggestion.hashtags.join(' ')}</Text>
                <TouchableOpacity onPress={() => {
                  setCaption(suggestion.caption); setHashtags(suggestion.hashtags.join(' '));
                  if (suggestion.headline) setHeadline(suggestion.headline);
                  if (suggestion.subline) setSubline(suggestion.subline);
                  setDirty(true);
                }}>
                  <Text style={styles.linkText}>Użyj tej wersji</Text>
                </TouchableOpacity>
              </View>
            ))}
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
            <Text style={styles.muted}>W tym terminie serwer opublikuje post w Meta: {detail.post.channels.map((channel) => SOCIAL_CHANNEL_LABELS[channel]).join(', ')}.</Text>
            {Platform.OS === 'ios' ? (
              <DateTimePicker value={scheduleDate} mode="datetime" display="spinner" locale="pl-PL" minuteInterval={5} themeVariant="dark"
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
            <Text style={styles.muted}>{noteModal === 'publish' ? 'Gdy post opublikowano ręcznie (bez Meta) — wklej link do posta (opcjonalnie).' : 'Co poprawić? Autor dostanie powiadomienie.'}</Text>
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
  suggestion: { borderRadius: borderRadius.md, backgroundColor: colors.background.secondary, padding: spacing.sm, gap: 4 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: { width: '100%', backgroundColor: colors.background.elevated, borderRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.sm },
});
