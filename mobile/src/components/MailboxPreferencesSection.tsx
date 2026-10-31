import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Switch, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { canView } from '../lib/permissions';
import { readMailboxViewPreferences } from '../lib/mailboxPreferences';
import { colors, spacing, typography, borderRadius } from '../theme';

/*
 * Ustawienia → Skrzynki pocztowe — to samo co w CRM (Ustawienia → Powiadomienia → Skrzynki pocztowe).
 * Zapis do employees.preferences.messages.hiddenMailboxIds / mutedMailboxIds; tę samą regułę stosują
 * Wiadomości w CRM i w aplikacji oraz wyzwalacz powiadomień o nowych mailach.
 */

type Mailbox = { id: string; account_name: string; email_address: string; account_type: string };
type Key = 'hiddenMailboxIds' | 'mutedMailboxIds';

const typeLabel: Record<string, string> = { personal: 'Twoja skrzynka', shared: 'Wspólna', system: 'Systemowa' };

export default function MailboxPreferencesSection() {
  const { employee } = useAuth();
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!employee?.id) return;
    setLoading(true);
    setError(null);
    try {
      const fields = 'id, account_name, email_address, account_type';
      const [personal, assignments, prefs] = await Promise.all([
        supabase.from('employee_email_accounts').select(fields).eq('employee_id', employee.id).eq('is_active', true),
        supabase.from('employee_email_account_assignments').select('email_account_id').eq('employee_id', employee.id),
        supabase.from('employees').select('preferences').eq('id', employee.id).maybeSingle(),
      ]);
      if (personal.error) throw personal.error;
      if (assignments.error) throw assignments.error;
      const own = (personal.data || []) as Mailbox[];
      const assignedIds = (assignments.data || [])
        .map((row: { email_account_id: string }) => row.email_account_id)
        .filter((id) => !own.some((mailbox) => mailbox.id === id));
      let assigned: Mailbox[] = [];
      if (assignedIds.length > 0) {
        const result = await supabase.from('employee_email_accounts').select(fields).in('id', assignedIds).eq('is_active', true);
        if (result.error) throw result.error;
        assigned = (result.data || []) as Mailbox[];
      }
      const order: Record<string, number> = { personal: 0, shared: 1, system: 2 };
      setMailboxes([...own, ...assigned].sort((a, b) =>
        (order[a.account_type] ?? 9) - (order[b.account_type] ?? 9) || a.account_name.localeCompare(b.account_name)));
      const view = readMailboxViewPreferences(prefs.data?.preferences);
      setHidden(view.hidden);
      setMuted(view.muted);
    } catch {
      setError('Nie udało się wczytać skrzynek.');
    } finally {
      setLoading(false);
    }
  }, [employee?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (accountId: string, key: Key, enabled: boolean) => {
    if (!employee?.id || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Świeży odczyt preferencji: nie nadpisujemy zmian zapisanych w CRM w międzyczasie.
      const { data, error: readError } = await supabase.from('employees').select('preferences').eq('id', employee.id).single();
      if (readError) throw readError;
      const preferences = (data?.preferences || {}) as Record<string, any>;
      const messages = (preferences.messages || {}) as Record<string, any>;
      const ids = new Set<string>(Array.isArray(messages[key]) ? messages[key] : []);
      if (enabled) ids.add(accountId);
      else ids.delete(accountId);
      const next = { ...preferences, messages: { ...messages, [key]: Array.from(ids) } };
      const { error: saveError } = await supabase.from('employees').update({ preferences: next }).eq('id', employee.id);
      if (saveError) throw saveError;
      const view = readMailboxViewPreferences(next);
      setHidden(view.hidden);
      setMuted(view.muted);
    } catch {
      setError('Nie udało się zapisać zmiany. Spróbuj ponownie.');
    } finally {
      setSaving(false);
    }
  };

  if (!canView(employee, 'messages')) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Skrzynki pocztowe</Text>
      <Text style={styles.description}>
        Wybierz, które skrzynki widzisz w Wiadomościach i z których dostajesz powiadomienia. Ukryta skrzynka znika z listy;
        wyciszona zostaje, ale nie powiadamia. Ustawienie obowiązuje także w CRM.
      </Text>
      {loading ? (
        <ActivityIndicator color={colors.primary.gold} style={{ marginVertical: spacing.md }} />
      ) : mailboxes.length === 0 ? (
        <Text style={styles.description}>Nie masz własnych ani przypisanych skrzynek.</Text>
      ) : mailboxes.map((mailbox) => {
        const isHidden = hidden.has(mailbox.id);
        const isMuted = muted.has(mailbox.id);
        return (
          <View key={mailbox.id} style={styles.card}>
            <Text style={styles.name} numberOfLines={1}>{mailbox.account_name}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {mailbox.email_address} · {typeLabel[mailbox.account_type] || 'Skrzynka'}
            </Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>W Wiadomościach</Text>
              <Switch value={!isHidden} disabled={saving}
                onValueChange={(value) => void toggle(mailbox.id, 'hiddenMailboxIds', !value)}
                trackColor={{ false: colors.background.tertiary, true: `${colors.primary.gold}55` }}
                thumbColor={!isHidden ? colors.primary.gold : colors.text.tertiary}
                accessibilityLabel={`Pokazuj ${mailbox.email_address} w Wiadomościach`} />
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isHidden && styles.disabled]}>Powiadomienia</Text>
              <Switch value={!isHidden && !isMuted} disabled={saving || isHidden}
                onValueChange={(value) => void toggle(mailbox.id, 'mutedMailboxIds', !value)}
                trackColor={{ false: colors.background.tertiary, true: `${colors.primary.gold}55` }}
                thumbColor={!isHidden && !isMuted ? colors.primary.gold : colors.text.tertiary}
                accessibilityLabel={`Powiadomienia z ${mailbox.email_address}`} />
            </View>
          </View>
        );
      })}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { padding: spacing.md, gap: spacing.sm },
  title: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text.secondary,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  description: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary, lineHeight: 18 },
  card: { padding: spacing.md, borderRadius: borderRadius.md, backgroundColor: colors.background.secondary, gap: 6 },
  name: { fontSize: typography.fontSizes.sm, color: colors.text.primary, fontWeight: typography.fontWeights.semibold },
  meta: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  rowLabel: { fontSize: typography.fontSizes.sm, color: colors.text.primary },
  disabled: { color: colors.text.tertiary },
  error: { fontSize: typography.fontSizes.xs, color: colors.status.error },
});
