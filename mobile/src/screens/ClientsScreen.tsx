import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '../theme';
import { supabase } from '../lib/supabase';
import { syncAvailableCrmContacts, type SyncableCrmContact } from '../services/crmContactSync';
import { useCrmCall } from '../hooks/useCrmCall';
import CallOutcomeModal from '../components/CallOutcomeModal';
import Client360Modal from '../components/Client360Modal';
import { useAuth } from '../contexts/AuthContext';
import { canView } from '../lib/permissions';

type ContactRow = SyncableCrmContact & {
  status: string | null;
  last_contact_date: string | null;
  tags: string[] | null;
};

type CallRow = {
  id: string;
  phone_number: string;
  status: string;
  outcome: string | null;
  started_at: string;
  next_action_at: string | null;
  notes: string | null;
  contact_id: string | null;
  contact: { first_name: string; last_name: string } | null;
};

const OUTCOME_LABELS: Record<string, string> = {
  connected: 'Rozmowa odbyta', no_answer: 'Brak odpowiedzi', busy: 'Zajęte',
  voicemail: 'Poczta głosowa', wrong_number: 'Błędny numer',
};

export default function ClientsScreen() {
  const { employee } = useAuth();
  const hasContactAccess = canView(employee, 'contacts');
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [view, setView] = useState<'contacts' | 'calls'>('contacts');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedContact, setSelectedContact] = useState<ContactRow | null>(null);
  const { startCall, pendingCall, showOutcome, closeOutcome } = useCrmCall();

  const fetchContacts = useCallback(async () => {
    if (!hasContactAccess) {
      setContacts([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const [contactsResult, callsResult] = await Promise.all([
      supabase.from('contacts').select('id, first_name, last_name, phone, mobile, email, status, last_contact_date, tags').eq('status', 'active').order('last_name'),
      supabase.from('crm_call_activities').select('id, phone_number, status, outcome, started_at, next_action_at, notes, contact_id, contact:contacts(first_name, last_name)').order('started_at', { ascending: false }).limit(100),
    ]);
    if (contactsResult.error) Alert.alert('Błąd', 'Nie udało się pobrać kontaktów.');
    else setContacts((contactsResult.data || []) as ContactRow[]);
    if (!callsResult.error) setCalls((callsResult.data || []) as unknown as CallRow[]);
    setLoading(false);
    setRefreshing(false);
  }, [hasContactAccess]);

  useEffect(() => { void fetchContacts(); }, [fetchContacts]);

  const filtered = useMemo(() => {
    const phrase = search.trim().toLocaleLowerCase('pl-PL');
    const withPhone = contacts.filter((contact) => contact.phone || contact.mobile);
    if (!phrase) return withPhone;
    return withPhone.filter((contact) => [contact.first_name, contact.last_name, contact.phone, contact.mobile, contact.email]
      .some((value) => String(value || '').toLocaleLowerCase('pl-PL').includes(phrase)));
  }, [contacts, search]);

  const syncContacts = async () => {
    if (!hasContactAccess) return;
    setSyncing(true);
    try {
      const result = await syncAvailableCrmContacts();
      Alert.alert('Kontakty zsynchronizowane', `${result.total} kontaktów Mavinci CRM jest aktualnych w telefonie.\nNowe: ${result.created}, zaktualizowane: ${result.updated}.`);
    } catch (error: any) {
      Alert.alert('Nie udało się zsynchronizować', error?.message || 'Sprawdź uprawnienia aplikacji.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View style={styles.container}>
      {!hasContactAccess ? <View style={styles.center}><Feather name="lock" color={colors.text.tertiary} size={40} /><Text style={styles.empty}>Nie masz dostępu do kontaktów CRM.</Text></View> : <>
      <View style={styles.header}>
        <View style={{ flex: 1 }}><Text style={styles.title}>Kontakty</Text><Text style={styles.subtitle}>Numery dostępne w CRM</Text></View>
        <TouchableOpacity onPress={() => void syncContacts()} disabled={syncing || loading} style={styles.syncButton}>{syncing ? <ActivityIndicator size="small" color={colors.background.primary} /> : <Feather name="refresh-cw" size={17} color={colors.background.primary} />}<Text style={styles.syncText}>{syncing ? 'Synchronizacja…' : 'Do telefonu'}</Text></TouchableOpacity>
      </View>
      <View style={styles.search}><Feather name="search" size={18} color={colors.text.tertiary} /><TextInput value={search} onChangeText={setSearch} placeholder="Szukaj po nazwie, numerze lub e-mailu…" placeholderTextColor={colors.text.tertiary} style={styles.searchInput} /></View>
      <View style={styles.switcher}><TouchableOpacity onPress={() => setView('contacts')} style={[styles.switchButton, view === 'contacts' && styles.switchButtonActive]}><Feather name="users" size={15} color={view === 'contacts' ? colors.background.primary : colors.text.secondary} /><Text style={[styles.switchText, view === 'contacts' && styles.switchTextActive]}>Kontakty ({filtered.length})</Text></TouchableOpacity><TouchableOpacity onPress={() => setView('calls')} style={[styles.switchButton, view === 'calls' && styles.switchButtonActive]}><Feather name="phone-call" size={15} color={view === 'calls' ? colors.background.primary : colors.text.secondary} /><Text style={[styles.switchText, view === 'calls' && styles.switchTextActive]}>Historia ({calls.length})</Text></TouchableOpacity></View>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.primary.gold} /></View> : (
        view === 'contacts' ? <FlatList data={filtered} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void fetchContacts(); }} tintColor={colors.primary.gold} />} ListEmptyComponent={<View style={styles.center}><Feather name="users" color={colors.text.tertiary} size={40} /><Text style={styles.empty}>Brak kontaktów z numerem telefonu</Text></View>} renderItem={({ item }) => {
          const phone = item.mobile || item.phone;
          return <TouchableOpacity onPress={() => setSelectedContact(item)} activeOpacity={0.75} style={styles.card}><View style={styles.avatar}><Text style={styles.initials}>{`${item.first_name[0] || ''}${item.last_name[0] || ''}`.toUpperCase()}</Text></View><View style={styles.details}><Text style={styles.name}>{item.first_name} {item.last_name}</Text>{phone && <Text style={styles.phone}>{phone}</Text>}{item.email && <Text style={styles.email} numberOfLines={1}>{item.email}</Text>}{item.last_contact_date && <Text style={styles.lastContact}>Ostatni kontakt: {new Date(item.last_contact_date).toLocaleDateString('pl-PL')}</Text>}</View>{phone && <TouchableOpacity onPress={() => void startCall({ phoneNumber: phone, displayName: `${item.first_name} ${item.last_name}`, contactId: item.id })} style={styles.callButton}><Feather name="phone" size={20} color={colors.background.primary} /></TouchableOpacity>}<Feather name="chevron-right" size={18} color={colors.text.tertiary} /></TouchableOpacity>;
        }} /> : <FlatList data={calls} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void fetchContacts(); }} tintColor={colors.primary.gold} />} ListEmptyComponent={<View style={styles.center}><Feather name="phone-off" color={colors.text.tertiary} size={40} /><Text style={styles.empty}>Brak zapisanych połączeń</Text></View>} renderItem={({ item }) => {
          const displayName = item.contact ? `${item.contact.first_name} ${item.contact.last_name}` : item.phone_number;
          return <View style={styles.card}><View style={[styles.avatar, item.outcome === 'connected' && { backgroundColor: '#10b98125' }]}><Feather name={item.outcome === 'connected' ? 'phone-call' : 'phone-missed'} size={19} color={item.outcome === 'connected' ? '#10b981' : colors.primary.gold} /></View><View style={styles.details}><Text style={styles.name}>{displayName}</Text><Text style={styles.phone}>{item.phone_number}</Text><Text style={styles.lastContact}>{item.outcome ? OUTCOME_LABELS[item.outcome] || item.outcome : 'Brak zapisanego wyniku'} · {new Date(item.started_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</Text>{item.next_action_at && <Text style={styles.nextAction}>Następny kontakt: {new Date(item.next_action_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</Text>}</View><TouchableOpacity onPress={() => void startCall({ phoneNumber: item.phone_number, displayName, contactId: item.contact_id })} style={styles.callButton}><Feather name="phone" size={20} color={colors.background.primary} /></TouchableOpacity></View>;
        }} />
      )}
      <CallOutcomeModal call={pendingCall} visible={showOutcome} onClose={closeOutcome} onSaved={() => void fetchContacts()} />
      <Client360Modal
        client={selectedContact}
        visible={Boolean(selectedContact)}
        onClose={() => setSelectedContact(null)}
        onCall={(selected) => {
          const phone = selected.mobile || selected.phone;
          if (phone) void startCall({ phoneNumber: phone, displayName: `${selected.first_name} ${selected.last_name}`, contactId: selected.id });
        }}
      />
      </>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.md },
  title: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: typography.fontSizes.xxl, fontWeight: typography.fontWeights.bold, color: colors.text.primary },
  subtitle: { fontSize: typography.fontSizes.sm, color: colors.text.secondary, marginTop: 3 },
  syncButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.primary.gold, borderRadius: borderRadius.md, paddingHorizontal: spacing.md },
  syncText: { color: colors.background.primary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.bold },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.md, paddingHorizontal: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.default, backgroundColor: colors.background.secondary },
  searchInput: { flex: 1, minHeight: 46, color: colors.text.primary },
  switcher: { flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.md },
  switchButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.border.default },
  switchButtonActive: { backgroundColor: colors.primary.gold, borderColor: colors.primary.gold },
  switchText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  switchTextActive: { color: colors.background.primary, fontWeight: typography.fontWeights.bold },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.border.default, backgroundColor: colors.background.secondary },
  avatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.primary.gold + '25' },
  initials: { color: colors.primary.gold, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.bold },
  details: { flex: 1, minWidth: 0 },
  name: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  phone: { color: colors.primary.gold, fontSize: typography.fontSizes.sm, marginTop: 3 },
  email: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, marginTop: 2 },
  lastContact: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, marginTop: 4 },
  nextAction: { color: colors.status.warning, fontSize: typography.fontSizes.xs, marginTop: 4 },
  callButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.primary.gold },
  center: { flex: 1, minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  empty: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
});
