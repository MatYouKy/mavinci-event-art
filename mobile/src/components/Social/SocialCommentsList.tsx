import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { SOCIAL_LIMITS } from '../../lib/socialShared';
import { socialErrorMessage, socialGet, socialPost, type SocialComment, type SocialComments, type SocialCommentThread } from '../../lib/socialApi';

/*
 * Komentarze Facebook i Instagram w aplikacji (jak w CRM i na Macu): wątki posta albo skrzynka marki (filtr „Bez odpowiedzi”).
 * Odpowiedź publikuje serwer jako strona / profil marki — twórca treści z uprawnieniami Meta do komentarzy.
 */

type Props = { companyId?: string; postId?: string; onOpenPost?: (id: string) => void; refreshKey?: number };

export default function SocialCommentsList({ companyId, postId, onOpenPost, refreshKey = 0 }: Props) {
  const [data, setData] = useState<SocialComments | null>(null);
  const [filter, setFilter] = useState<'unanswered' | 'all'>(postId ? 'all' : 'unanswered');
  const [replying, setReplying] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await socialGet<SocialComments>('comments', postId ? { post: postId } : { company: companyId, filter }));
      setError('');
    } catch (cause) {
      setError(socialErrorMessage(cause, 'Nie udało się pobrać komentarzy.'));
    }
  }, [companyId, postId, filter]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const run = async (label: string, action: () => Promise<SocialComments>, success?: string) => {
    setBusy(label);
    try {
      setData(await action());
      if (success) Alert.alert('Komentarze', success);
      return true;
    } catch (cause) {
      Alert.alert('Komentarze', socialErrorMessage(cause, 'Operacja nie powiodła się.'));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const refresh = () => run('Pobieram komentarze z Meta', () => socialPost<SocialComments>('commentsRefresh',
    postId ? { postId } : { companyId: data?.companyId || companyId, filter }));

  const send = async (thread: SocialCommentThread) => {
    const message = draft.trim();
    if (!message) return;
    const ok = await run('Publikuję odpowiedź', () => socialPost<SocialComments>('reply', {
      commentId: thread.id, message, scope: postId ? 'post' : 'company', filter,
    }), thread.platform === 'facebook' ? 'Odpowiedź opublikowana na Facebooku.' : 'Odpowiedź opublikowana na Instagramie.');
    if (ok) { setDraft(''); setReplying(null); }
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.header}>
        <Text style={styles.title}>Komentarze{data?.unanswered ? ` · ${data.unanswered} bez odpowiedzi` : ''}</Text>
        <TouchableOpacity onPress={() => void refresh()} accessibilityRole="button" accessibilityLabel="Odśwież komentarze z Meta">
          <Feather name="refresh-cw" size={18} color={colors.primary.gold} />
        </TouchableOpacity>
      </View>
      {!postId && (
        <View style={styles.segments}>
          {([['unanswered', 'Bez odpowiedzi'], ['all', 'Wszystkie']] as const).map(([key, label]) => (
            <TouchableOpacity key={key} style={[styles.segment, filter === key && styles.segmentActive]} onPress={() => setFilter(key)}>
              <Text style={[styles.segmentText, filter === key && styles.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {error ? <Text style={styles.muted}>{error}</Text> : null}
      {!data && !error && <ActivityIndicator color={colors.primary.gold} />}
      {data && !data.threads.length && (
        <Text style={[styles.muted, { textAlign: 'center', padding: spacing.md }]}>
          {postId ? 'Brak komentarzy pod tym postem.' : filter === 'unanswered' ? 'Wszystkie komentarze mają odpowiedź.' : 'Brak komentarzy.'}
        </Text>
      )}
      {data?.threads.map((thread) => {
        const canReply = data.canReply && (thread.platform === 'facebook' ? data.replyChannels.facebook : data.replyChannels.instagram);
        return (
          <View key={thread.id} style={styles.thread}>
            {!postId && thread.post && (
              <TouchableOpacity style={styles.postLink} onPress={() => onOpenPost?.(thread.post!.id)}>
                {thread.post.thumbnailUrl ? <Image source={{ uri: thread.post.thumbnailUrl }} style={styles.postThumb} /> : <Feather name="image" size={14} color={colors.text.tertiary} />}
                <Text style={styles.muted} numberOfLines={1}>{thread.post.title}</Text>
              </TouchableOpacity>
            )}
            <CommentLine comment={thread} />
            {thread.replies.map((item) => (
              <View key={item.id} style={styles.reply}><Feather name="corner-down-right" size={12} color={colors.text.tertiary} /><CommentLine comment={item} /></View>
            ))}
            <View style={styles.actions}>
              {!thread.isOwn && !thread.answeredAt && <Text style={styles.unanswered}>Bez odpowiedzi</Text>}
              {thread.permalink && (
                <TouchableOpacity onPress={() => void Linking.openURL(thread.permalink!)}><Text style={styles.link}>{thread.platform === 'facebook' ? 'Facebook' : 'Instagram'} ↗</Text></TouchableOpacity>
              )}
              <View style={{ flex: 1 }} />
              {canReply && replying !== thread.id && (
                <TouchableOpacity onPress={() => { setReplying(thread.id); setDraft(''); }}><Text style={styles.link}>Odpowiedz</Text></TouchableOpacity>
              )}
            </View>
            {!canReply && data.canReply && <Text style={styles.muted}>Odpowiedzi wymagają uprawnień Meta do komentarzy.</Text>}
            {replying === thread.id && (
              <View style={{ gap: spacing.xs }}>
                <TextInput style={styles.input} multiline autoFocus value={draft} maxLength={SOCIAL_LIMITS.reply} onChangeText={setDraft}
                  placeholder={thread.platform === 'facebook' ? 'Odpowiedź jako strona marki…' : 'Odpowiedź jako profil marki…'} placeholderTextColor={colors.text.tertiary} />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => setReplying(null)}><Text style={styles.secondaryText}>Anuluj</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.primary, { flex: 1 }]} disabled={!draft.trim()} onPress={() => void send(thread)}><Text style={styles.primaryText}>Opublikuj</Text></TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        );
      })}
      <Modal visible={busy !== null} transparent animationType="fade">
        <View style={styles.backdrop}><View style={styles.modal}><ActivityIndicator color={colors.primary.gold} size="large" /><Text style={styles.body}>{busy}…</Text></View></View>
      </Modal>
    </View>
  );
}

function CommentLine({ comment }: { comment: SocialComment }) {
  const date = new Date(comment.commentedAt);
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={styles.meta}>
        <Text style={[styles.author, comment.isOwn && { color: colors.primary.gold }]}>{comment.isOwn ? `${comment.authorName} (marka)` : comment.authorName}</Text>
        {` · ${comment.platform === 'facebook' ? 'Facebook' : 'Instagram'} · ${Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
        {comment.likeCount ? ` · ♥ ${comment.likeCount}` : ''}
        {comment.repliedByName ? ` · z CRM: ${comment.repliedByName}` : ''}
      </Text>
      <Text style={styles.body}>{comment.message || '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.medium },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm, lineHeight: 20 },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, flexShrink: 1 },
  meta: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  author: { color: colors.text.primary, fontWeight: typography.fontWeights.semibold },
  segments: { flexDirection: 'row', gap: spacing.xs },
  segment: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.background.secondary },
  segmentActive: { backgroundColor: 'rgba(211,187,115,0.18)' },
  segmentText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  segmentTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  thread: { gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary },
  postLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  postThumb: { width: 22, height: 28, borderRadius: 3 },
  reply: { flexDirection: 'row', gap: 6, paddingLeft: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  unanswered: { color: colors.status.warning, fontSize: 11 },
  link: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  input: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md, padding: spacing.sm, color: colors.text.primary, backgroundColor: colors.background.tertiary, fontSize: typography.fontSizes.sm, minHeight: 70, textAlignVertical: 'top' },
  primary: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary.gold, paddingVertical: spacing.sm, borderRadius: borderRadius.md },
  primaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.sm },
  secondary: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.hover, paddingVertical: spacing.sm, borderRadius: borderRadius.md },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: { backgroundColor: colors.background.elevated, borderRadius: borderRadius.xl, padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
});
