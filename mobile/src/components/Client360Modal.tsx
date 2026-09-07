import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { borderRadius, colors, spacing, typography } from '../theme';

type Client = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  status: string | null;
  last_contact_date: string | null;
};

type Activity = {
  id: string;
  type: 'call' | 'inquiry' | 'event';
  title: string;
  date: string;
  subtitle?: string | null;
};

const normalizeEmail = (value?: string | null) => value?.trim().toLowerCase() || '';
const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '').replace(/^48(?=\d{9}$)/, '');

export default function Client360Modal({
  client,
  visible,
  onClose,
  onCall,
}: {
  client: Client | null;
  visible: boolean;
  onClose: () => void;
  onCall: (client: Client) => void;
}) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !client) return;
    let active = true;

    const load = async () => {
      setLoading(true);
      const email = normalizeEmail(client.email);
      const phones = [normalizePhone(client.mobile), normalizePhone(client.phone)].filter(Boolean);

      const [callsResult, inquiriesResult, eventsResult, eventLinksResult] = await Promise.all([
        supabase.from('crm_call_activities').select('id, outcome, status, started_at, notes').eq('contact_id', client.id).order('started_at', { ascending: false }).limit(50),
        supabase.from('tasks').select('id, title, inquiry_stage, status, inquiry_details, created_at').eq('is_inquiry', true).order('created_at', { ascending: false }).limit(200),
        supabase.from('events').select('id, name, status, event_date').eq('contact_person_id', client.id).order('event_date', { ascending: false }).limit(50),
        supabase.from('event_contact_persons').select('event:events(id, name, status, event_date)').eq('contact_id', client.id),
      ]);

      const inquiries = (inquiriesResult.data || []).filter((item: any) => {
        const details = item.inquiry_details || {};
        const inquiryEmail = normalizeEmail(details.client_email || details.email);
        const inquiryPhone = normalizePhone(details.client_phone || details.phone);
        return (email && inquiryEmail === email) || (inquiryPhone && phones.includes(inquiryPhone));
      });
      const eventMap = new Map<string, any>();
      [...(eventsResult.data || []), ...(eventLinksResult.data || []).map((row: any) => row.event).filter(Boolean)]
        .forEach((event: any) => eventMap.set(event.id, event));

      const merged: Activity[] = [
        ...(callsResult.data || []).map((call: any) => ({ id: `call-${call.id}`, type: 'call' as const, title: call.outcome === 'connected' ? 'Rozmowa odbyta' : 'Próba połączenia', subtitle: call.notes || call.outcome || call.status, date: call.started_at })),
        ...inquiries.map((inquiry: any) => ({ id: `inquiry-${inquiry.id}`, type: 'inquiry' as const, title: inquiry.title, subtitle: inquiry.inquiry_stage || inquiry.status, date: inquiry.created_at })),
        ...[...eventMap.values()].map((event: any) => ({ id: `event-${event.id}`, type: 'event' as const, title: event.name || 'Wydarzenie', subtitle: event.status, date: event.event_date })),
      ].filter((item) => item.date).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      if (active) {
        setActivities(merged);
        setLoading(false);
      }
    };

    void load();
    return () => { active = false; };
  }, [client, visible]);

  const summary = useMemo(() => {
    const openInquiries = activities.filter((item) => item.type === 'inquiry' && !['won', 'lost'].includes(item.subtitle || '')).length;
    const upcomingEvents = activities.filter((item) => item.type === 'event' && new Date(item.date).getTime() >= Date.now()).length;
    return { openInquiries, upcomingEvents };
  }, [activities]);

  if (!client) return null;
  const phone = client.mobile || client.phone;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.avatar}><Text style={styles.initials}>{`${client.first_name[0] || ''}${client.last_name[0] || ''}`.toUpperCase()}</Text></View>
          <View style={styles.headerText}><Text style={styles.title}>{client.first_name} {client.last_name}</Text><Text style={styles.subtitle}>Klient 360°</Text></View>
          <TouchableOpacity onPress={onClose} style={styles.close}><Feather name="x" size={22} color={colors.text.primary} /></TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.actions}>
            <TouchableOpacity disabled={!phone} onPress={() => onCall(client)} style={[styles.action, !phone && styles.disabled]}><Feather name="phone" size={19} color={colors.background.primary} /><Text style={styles.actionText}>Zadzwoń</Text></TouchableOpacity>
            <TouchableOpacity disabled={!client.email} onPress={() => client.email && Linking.openURL(`mailto:${client.email}`)} style={[styles.action, styles.actionSecondary, !client.email && styles.disabled]}><Feather name="mail" size={19} color={colors.primary.gold} /><Text style={[styles.actionText, styles.actionTextSecondary]}>E-mail</Text></TouchableOpacity>
          </View>

          <View style={styles.metrics}><View style={styles.metric}><Text style={styles.metricValue}>{summary.openInquiries}</Text><Text style={styles.metricLabel}>Otwarte zapytania</Text></View><View style={styles.metric}><Text style={styles.metricValue}>{summary.upcomingEvents}</Text><Text style={styles.metricLabel}>Nadchodzące wydarzenia</Text></View></View>

          <View style={styles.contactCard}>{phone && <View style={styles.contactRow}><Feather name="phone" size={15} color={colors.primary.gold} /><Text style={styles.contactText}>{phone}</Text></View>}{client.email && <View style={styles.contactRow}><Feather name="mail" size={15} color={colors.primary.gold} /><Text style={styles.contactText}>{client.email}</Text></View>}{client.last_contact_date && <View style={styles.contactRow}><Feather name="clock" size={15} color={colors.primary.gold} /><Text style={styles.contactText}>Ostatni kontakt: {new Date(client.last_contact_date).toLocaleDateString('pl-PL')}</Text></View>}</View>

          <Text style={styles.sectionTitle}>Ostatnia aktywność</Text>
          {loading ? <ActivityIndicator color={colors.primary.gold} style={{ marginTop: spacing.xl }} /> : activities.length === 0 ? <View style={styles.empty}><Feather name="inbox" size={32} color={colors.text.tertiary} /><Text style={styles.emptyText}>Brak powiązanych aktywności</Text></View> : activities.map((item) => {
            const icon = item.type === 'call' ? 'phone-call' : item.type === 'inquiry' ? 'target' : 'calendar';
            return <View key={item.id} style={styles.timelineRow}><View style={styles.timelineIcon}><Feather name={icon as any} size={16} color={colors.primary.gold} /></View><View style={{ flex: 1 }}><Text style={styles.timelineTitle}>{item.title}</Text>{item.subtitle && <Text style={styles.timelineSubtitle}>{item.subtitle}</Text>}<Text style={styles.timelineDate}>{new Date(item.date).toLocaleString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text></View></View>;
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary.gold + '25' },
  initials: { color: colors.primary.gold, fontWeight: typography.fontWeights.bold },
  headerText: { flex: 1 },
  title: { fontFamily: 'MBFAtom', textTransform: 'uppercase', color: colors.text.primary, fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.bold },
  subtitle: { color: colors.text.secondary, fontSize: typography.fontSizes.sm, marginTop: 2 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.primary.gold },
  actionSecondary: { backgroundColor: colors.background.secondary, borderWidth: 1, borderColor: colors.primary.gold + '55' },
  actionText: { color: colors.background.primary, fontWeight: typography.fontWeights.bold },
  actionTextSecondary: { color: colors.primary.gold },
  disabled: { opacity: 0.4 },
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border.default, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary },
  metricValue: { color: colors.text.primary, fontSize: typography.fontSizes.xxl, fontWeight: typography.fontWeights.bold },
  metricLabel: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, marginTop: 3 },
  contactCard: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border.default, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  contactText: { flex: 1, color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  sectionTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.bold },
  timelineRow: { flexDirection: 'row', gap: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  timelineIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary.gold + '18' },
  timelineTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', color: colors.text.primary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold },
  timelineSubtitle: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, marginTop: 3 },
  timelineDate: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, marginTop: 4 },
  empty: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
});
