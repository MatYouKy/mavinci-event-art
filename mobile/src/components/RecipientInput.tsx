import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View,
  type NativeSyntheticEvent, type StyleProp, type TextInputSelectionChangeEventData, type TextStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../theme';
import { supabase } from '../lib/supabase';
import {
  RECIPIENT_KIND_LABELS, RECIPIENT_SUGGESTION_DELAY, RECIPIENT_SUGGESTION_LIMIT, insertRecipient, recipientDetail,
  recipientQueryReady, recipientSuggestionFromRow, recipientToken, type RecipientSuggestion, type RecipientSuggestionKind,
} from '../lib/recipientSuggestions';

/*
 * Pole adresatów („Do”, „DW”, „UDW”) z podpowiedziami jak w Thunderbirdzie — jak `RecipientInput` w CRM i `RecipientField`
 * na Macu: przy wpisywaniu imienia, nazwiska, fragmentu adresu albo nazwy firmy pod polem pojawiają się kontakty,
 * organizacje, pracownicy i osoby z korespondencji (funkcja bazy `email_recipient_suggestions`, uprawnienia osoby — RLS)
 * z organizacją i liczbą wiadomości. Dotknięcie podpowiedzi wstawia adres (z „, ” na następny). Kilka adresów po przecinku.
 */

const KIND_ICONS: Record<RecipientSuggestionKind, keyof typeof Feather.glyphMap> = {
  contact: 'user',
  organization: 'briefcase',
  employee: 'users',
  correspondence: 'clock',
};

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  style?: StyleProp<TextStyle>;
  placeholder?: string;
  placeholderTextColor?: string;
  accessibilityLabel?: string;
};

export default function RecipientInput({ value, onChangeText, style, placeholder, placeholderTextColor, accessibilityLabel }: Props) {
  const ticket = useRef(0);
  const [caret, setCaret] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  const token = recipientToken(value, caret);
  const query = token.query;

  useEffect(() => {
    if (!focused || !recipientQueryReady(query)) {
      ticket.current += 1;
      setSuggestions([]);
      setLoading(false);
      return undefined;
    }
    const current = ++ticket.current;
    const timer = setTimeout(() => {
      setLoading(true);
      void (async () => {
        const { data, error } = await supabase.rpc('email_recipient_suggestions', { p_query: query, p_limit: RECIPIENT_SUGGESTION_LIMIT });
        if (current !== ticket.current) return;
        setLoading(false);
        // Bez podpowiedzi (np. przed migracją bazy) pole działa jak zwykłe pole adresu.
        setSuggestions(error ? [] : ((data || []) as Array<Record<string, unknown>>)
          .map(recipientSuggestionFromRow)
          .filter((item): item is RecipientSuggestion => Boolean(item)));
      })();
    }, RECIPIENT_SUGGESTION_DELAY);
    return () => clearTimeout(timer);
  }, [query, focused]);

  const choose = (suggestion: RecipientSuggestion) => {
    const next = insertRecipient(value, token, suggestion.email);
    ticket.current += 1;
    setSuggestions([]);
    setCaret(next.caret);
    onChangeText(next.value);
  };

  return (
    <View>
      <TextInput
        value={value}
        onChangeText={(next: string) => { setCaret(null); onChangeText(next); }}
        onSelectionChange={(event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => setCaret(event.nativeEvent.selection.end)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (/[,;]\s*$/.test(value)) onChangeText(value.replace(/[\s,;]+$/, ''));
        }}
        style={style}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        accessibilityLabel={accessibilityLabel}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
      />
      {focused && loading && !suggestions.length ? <ActivityIndicator style={styles.loader} color={colors.primary.gold} size="small" /> : null}
      {focused && suggestions.length > 0 && (
        <View style={styles.list} accessibilityLabel="Podpowiedzi adresatów">
          {suggestions.map((suggestion, index) => {
            const detail = recipientDetail(suggestion);
            return (
              <TouchableOpacity key={suggestion.email} onPress={() => choose(suggestion)} accessibilityRole="button"
                style={[styles.row, index > 0 && styles.rowBorder]}>
                <Feather name={KIND_ICONS[suggestion.kind]} size={15} color={colors.primary.gold} style={styles.icon} />
                <View style={styles.texts}>
                  <Text style={styles.name} numberOfLines={1}>{suggestion.name || suggestion.email}</Text>
                  {suggestion.name ? <Text style={styles.email} numberOfLines={1}>{suggestion.email}</Text> : null}
                  {detail ? <Text style={styles.detail} numberOfLines={1}>{detail}</Text> : null}
                </View>
                <Text style={styles.kind}>{RECIPIENT_KIND_LABELS[suggestion.kind]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { position: 'absolute', right: spacing.sm, top: 12 },
  list: {
    marginTop: 4, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.hover,
    backgroundColor: colors.background.elevated, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.default },
  icon: { width: 18 },
  texts: { flex: 1, gap: 1 },
  name: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  email: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  detail: { color: colors.text.tertiary, fontSize: 11 },
  kind: { color: colors.primary.gold, fontSize: 10 },
});
