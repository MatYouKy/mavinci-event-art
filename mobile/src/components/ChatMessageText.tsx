import React, { memo, useMemo } from 'react';
import { Alert, Linking, StyleSheet, Text } from 'react-native';
import type { AlertButton, GestureResponderEvent, StyleProp, TextStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';

type Part = { text: string; url?: string };

function messageParts(content: string): Part[] {
  const parts: Part[] = [];
  const pattern = /\b(?:https?:\/\/|www\.)[^\s<>"'„”]+/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    // Avoid interpreting fragments inside another address as a separate link.
    if (match.index > 0 && /[\p{L}\p{N}_@/]/u.test(content[match.index - 1])) continue;
    let label = match[0];
    while (label) {
      const last = label.slice(-1);
      if (/[.,!?;:]/.test(last)) { label = label.slice(0, -1); continue; }
      const opening = ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[last];
      if (opening && label.split(last).length > label.split(opening).length) {
        label = label.slice(0, -1);
        continue;
      }
      break;
    }
    const target = /^www\./i.test(label) ? `https://${label}` : label;
    try {
      const url = new URL(target);
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) continue;
      if (match.index > cursor) parts.push({ text: content.slice(cursor, match.index) });
      parts.push({ text: label, url: url.href });
      cursor = match.index + label.length;
    } catch {
      // Keep malformed addresses visible as the original text.
    }
  }
  if (cursor < content.length) parts.push({ text: content.slice(cursor) });
  return parts;
}

async function copyMessage(content: string) {
  try {
    const copied = await Clipboard.setStringAsync(content);
    if (!copied) throw new Error('Clipboard unavailable');
    Alert.alert('Skopiowano', 'Treść wiadomości jest w schowku.');
  } catch {
    Alert.alert('Nie udało się skopiować', 'Spróbuj ponownie.');
  }
}

export function showChatMessageActions(content: string, onReact?: () => void) {
  const actions: AlertButton[] = [];
  if (content) actions.push({ text: 'Kopiuj treść', onPress: () => { void copyMessage(content); } });
  if (onReact) actions.push({ text: 'Dodaj reakcję', onPress: onReact });
  actions.push({ text: 'Anuluj', style: 'cancel' });
  Alert.alert('Wiadomość', undefined, actions);
}

async function openLink(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Nie udało się otworzyć linku', 'Przytrzymaj wiadomość, aby skopiować jej treść i wkleić adres w przeglądarce.');
  }
}

interface Props {
  content: string;
  style?: StyleProp<TextStyle>;
  onLongPress?: () => void;
  onSelect?: () => void;
}

// Use the same gestures for text and links. Selection mode must never open a URL.
function ChatMessageText({ content, style, onLongPress, onSelect }: Props) {
  const parts = useMemo(() => messageParts(content), [content]);
  const longPress = (event: GestureResponderEvent) => {
    event.stopPropagation();
    if (onSelect) onSelect();
    else if (onLongPress) onLongPress();
    else showChatMessageActions(content);
  };
  return (
    <Text
      style={style}
      onLongPress={longPress}
      onPress={onSelect ? (event) => { event.stopPropagation(); onSelect(); } : undefined}
      accessibilityHint={onSelect ? 'Dotknij, aby zmienić zaznaczenie' : 'Przytrzymaj, aby skopiować treść wiadomości'}
    >
      {onSelect ? content : parts.map((part, index) => part.url ? (
        <Text
          key={index}
          style={styles.link}
          accessibilityRole="link"
          accessibilityHint="Otwiera adres. Przytrzymaj, aby skopiować treść wiadomości."
          onLongPress={longPress}
          onPress={(event) => { event.stopPropagation(); void openLink(part.url!); }}
        >{part.text}</Text>
      ) : part.text)}
    </Text>
  );
}

const styles = StyleSheet.create({
  link: { textDecorationLine: 'underline', fontWeight: '600' },
});

export default memo(ChatMessageText);
