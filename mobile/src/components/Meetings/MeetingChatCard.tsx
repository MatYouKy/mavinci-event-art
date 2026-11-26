import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import {
  meetingChatFileSize,
  meetingChatMessagesLabel,
  meetingChatUnreadLabel,
  parseMeetingChat,
  type MeetingChatInfo,
} from '../../lib/meetingChat';
import { withOpacity } from '../../lib/scheduleTimeline';
import { colors, spacing } from '../../theme';

/*
 * Szczegóły spotkania → „Czat spotkania” (jak w CRM i na Macu, `docs/meeting-chat.md`): rozmowa organizatora i zaproszonych
 * pracowników w Komunikatorze — także przed odpowiedzią na zaproszenie (prośba o inny termin, ustalenia, agenda).
 * „Otwórz czat” zakłada rozmowę przy pierwszym otwarciu i otwiera ją (`onOpen` — ekran zamyka szczegóły i przechodzi
 * do rozmowy); pliki dodaje się w czacie, tu widać ostatnie z nich.
 */

const FILES_SHOWN = 5;
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
};

export default function MeetingChatCard({ meetingId, onOpen }: { meetingId: string; onOpen: (conversationId: string) => void }) {
  const [info, setInfo] = useState<MeetingChatInfo | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let active = true;
    setInfo(null);
    void supabase.rpc('meeting_chat', { p_meeting_id: meetingId, p_create: false }).then(({ data, error }) => {
      if (active && !error) setInfo(parseMeetingChat(data));
    });
    return () => { active = false; };
  }, [meetingId]);

  const open = async () => {
    setOpening(true);
    const { data, error } = await supabase.rpc('meeting_chat', { p_meeting_id: meetingId, p_create: true });
    setOpening(false);
    if (error) {
      Alert.alert('Czat spotkania', error.message || 'Nie udało się otworzyć czatu spotkania.');
      return;
    }
    const next = parseMeetingChat(data);
    setInfo(next);
    if (next.conversationId) onOpen(next.conversationId);
  };

  const messages = info?.member ? info.messages : 0;
  const unread = info?.member ? info.unread : 0;
  const files = info?.member ? info.files : [];

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <View style={styles.titleRow}>
            <Feather name="message-circle" size={14} color={colors.primary.gold} />
            <Text style={styles.title}>Czat spotkania</Text>
          </View>
          <Text style={styles.summary}>
            {messages > 0
              ? `${meetingChatMessagesLabel(messages)}${unread > 0 ? ` · ${meetingChatUnreadLabel(unread)}` : ''}`
              : 'Napisz do organizatora i uczestników — np. prośba o inny termin, ustalenia albo agenda (pliki dodasz w czacie).'}
          </Text>
        </View>
        <TouchableOpacity onPress={() => { void open(); }} disabled={opening} style={[styles.button, opening && styles.disabled]}
          accessibilityRole="button" accessibilityLabel={unread > 0 ? `Otwórz czat, ${meetingChatUnreadLabel(unread)}` : 'Otwórz czat'}>
          {opening ? <ActivityIndicator size="small" color={colors.primary.gold} /> : <Feather name="message-circle" size={15} color={colors.primary.gold} />}
          <Text style={styles.buttonText}>Otwórz czat</Text>
          {unread > 0 ? (
            <View style={styles.badge}><Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text></View>
          ) : null}
        </TouchableOpacity>
      </View>
      {files.length > 0 ? (
        <View style={styles.files}>
          <Text style={styles.filesLabel}>Pliki z czatu</Text>
          {files.slice(0, FILES_SHOWN).map((file) => (
            <TouchableOpacity key={file.id} onPress={() => { void Linking.openURL(file.url); }} style={styles.file} accessibilityRole="link"
              accessibilityLabel={`Otwórz plik ${file.name}`}>
              <Feather name="paperclip" size={14} color={colors.primary.gold} />
              <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">{file.name}</Text>
              <Text style={styles.fileMeta} numberOfLines={1}>
                {[meetingChatFileSize(file.size), file.sender, file.createdAt ? dateLabel(file.createdAt) : ''].filter(Boolean).join(' · ')}
              </Text>
            </TouchableOpacity>
          ))}
          {files.length > FILES_SHOWN ? <Text style={styles.more}>…i {files.length - FILES_SHOWN} więcej w czacie</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md, padding: spacing.md, borderRadius: 12, borderWidth: 1, borderColor: colors.border.default,
    backgroundColor: colors.background.secondary, gap: spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: colors.primary.gold, fontSize: 14, fontWeight: '600' },
  summary: { color: colors.text.secondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  button: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: withOpacity(colors.primary.gold, 0.15),
  },
  buttonText: { color: colors.primary.gold, fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.status.error, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  files: { gap: 4 },
  filesLabel: { color: colors.text.tertiary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: withOpacity(colors.text.primary, 0.05) },
  fileName: { flex: 1, color: colors.text.primary, fontSize: 13 },
  fileMeta: { color: colors.text.tertiary, fontSize: 11, maxWidth: '45%' },
  more: { color: colors.text.tertiary, fontSize: 12 },
});
