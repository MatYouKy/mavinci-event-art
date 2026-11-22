import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, FlatList, Linking, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography, glow, ink, shade, tone } from '../theme';
import { useContentWidth } from '../hooks/useTabletLayout';
import { useCrmCall } from '../hooks/useCrmCall';
import CallOutcomeModal from '../components/CallOutcomeModal';
import InquiryBoard from '../components/InquiryBoard';
import NewInquiryModal from './NewInquiryModal';
import { Chip, InquiryContactSheet, InquiryEditSheet, NoticeScope, Sheet, SmallButton, afterModal } from '../components/Inquiries/InquiryKit';
import {
  claimInquiry, contactInquiry, inquiryCrmUrl, inquiryRemovalMode, loadFunnel, moveInquiry, removeInquiry, snoozeInquiry, updateInquiry,
} from '../lib/inquiriesApi';
import {
  INQUIRY_ATTENTION, INQUIRY_LOST_CATEGORIES, INQUIRY_STAGES, INQUIRY_STATUS_FILTERS, attentionMatches, availableScopes, canClaimInquiry,
  canManageInquiry, formatInquiryFull, formatInquiryMoney, formatInquiryShort, inScope, inquiryOverdue, inquirySearchText, inquiryWarnings,
  isOpenInquiry, stageOf, weightedValue,
  type FunnelInquiry, type InquiryAccess, type InquiryAttention, type InquiryScope, type InquiryStageId, type InquiryStatusFilter,
} from '../lib/inquiryFunnel';

/*
 * Zapytania na tablecie — jak lejek w CRM (`/crm/inquiries`) i na Macu, z obsługą dotykiem: zakresy (Moje, Współpracuję,
 * Nieprzypisane, Zespół, Wszystkie — wg uprawnień), status, „wymaga uwagi”, wyszukiwanie, ważona wartość; widok **lejka**
 * (kolumny etapów, przeciąganie karty za uchwyt ≡ do innego etapu; „Przegrane” — z powodem utraty) albo **listy**. Karta:
 * przejęcie, kontakt wykonany (z kolejnym terminem), odłożenie o godzinę, menu (karta zapytania, opiekun / etap / termin,
 * przeniesienie do etapu, usunięcie lub archiwizacja, CRM). Szczegóły z boku (szeroki ekran) albo w oknie. Dane i uprawnienia —
 * `/bridge/native/v1/inquiries` (to samo API co Mac, RLS jak w CRM).
 */

type Mode = 'pipeline' | 'list';
type Toast = { text: string; error: boolean } | null;

const money = formatInquiryMoney;

export default function InquiryFunnelScreen() {
  const navigation = useNavigation<any>();
  const contentWidth = useContentWidth();
  const wide = contentWidth >= 1000;
  const [items, setItems] = useState<FunnelInquiry[]>([]);
  const [access, setAccess] = useState<InquiryAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState<Mode>('pipeline');
  const [scope, setScope] = useState<InquiryScope>('pool');
  const [status, setStatus] = useState<InquiryStatusFilter>('open');
  const [attention, setAttention] = useState<InquiryAttention | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [editing, setEditing] = useState<{ inquiry: FunnelInquiry; stage?: InquiryStageId } | null>(null);
  const [contactTarget, setContactTarget] = useState<FunnelInquiry | null>(null);
  const [menuTarget, setMenuTarget] = useState<FunnelInquiry | null>(null);
  const [removal, setRemoval] = useState<{ inquiry: FunnelInquiry; mode: 'deleted' | 'archived' } | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { startCall, pendingCall, showOutcome, closeOutcome } = useCrmCall();
  const loadingRef = useRef(false);
  const draggingRef = useRef(false);
  draggingRef.current = dragging;

  const notify = (text: string, error = false) => setToast({ text, error });
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 6000 : 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const load = useCallback(async (force = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const result = await loadFunnel(force);
      setItems(result.items);
      setAccess(result.access);
      setLoadError('');
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Nie udało się pobrać zapytań.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Odświeżanie przy wejściu na ekran i co minutę (zmiany innych osób; serwer odpowiada skrótem, gdy nic się nie zmieniło).
  useFocusEffect(useCallback(() => {
    void load();
    const timer = setInterval(() => { if (!draggingRef.current) void load(); }, 60_000);
    return () => clearInterval(timer);
  }, [load]));

  const scopes = availableScopes(access);
  const activeScope: InquiryScope = scopes.some((item) => item.key === scope) ? scope : scopes.some((item) => item.key === 'pool') ? 'pool' : 'mine';
  const now = Date.now();
  const visible = useMemo(() => {
    const at = Date.now();
    const query = search.trim().toLocaleLowerCase('pl-PL');
    return items.filter((inquiry) => {
      if (!inScope(inquiry, activeScope, access)) return false;
      if (status === 'open' && !isOpenInquiry(inquiry)) return false;
      if (status === 'completed' && isOpenInquiry(inquiry)) return false;
      if (attention && !attentionMatches(inquiry, attention, at)) return false;
      return !query || inquirySearchText(inquiry).includes(query);
    });
  }, [items, activeScope, access, status, attention, search]);
  const selected = items.find((inquiry) => inquiry.id === selectedId) || null;
  const weighted = visible.reduce((sum, inquiry) => sum + weightedValue(inquiry), 0);

  /** Czynność na serwerze z oknem ładowania, komunikatem i odświeżeniem listy. */
  const run = async (label: string, action: () => Promise<unknown>, success: string) => {
    setBusy(label);
    try {
      await action();
      notify(success);
      await load(true);
      return true;
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Operacja nie powiodła się.', true);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const canManage = (inquiry: FunnelInquiry) => canManageInquiry(access, inquiry);
  const canClaim = (inquiry: FunnelInquiry) => canClaimInquiry(access, inquiry);
  const claim = (inquiry: FunnelInquiry) => void run('Przejmuję zapytanie…', () => claimInquiry(inquiry.id), 'Zapytanie jest Twoje').then((ok) => { if (ok) setScope('mine'); });
  const snooze = (inquiry: FunnelInquiry) => void run('Odkładam przypomnienie…', () => snoozeInquiry(inquiry.id, 60), 'Przypomnienie odłożone o godzinę');
  const drop = (inquiry: FunnelInquiry, stage: InquiryStageId) => {
    if (stage === stageOf(inquiry.stage).id) return;
    if (!canManage(inquiry)) { notify('Najpierw przejmij zapytanie lub poproś menedżera o przypisanie.', true); return; }
    if (stage === 'lost') { setEditing({ inquiry, stage: 'lost' }); return; }
    // Od razu w lejku (jak na Macu), potwierdzenie z serwera odświeża listę.
    setItems((current) => current.map((entry) => (entry.id === inquiry.id ? { ...entry, stage, probability: stageOf(stage).probability } : entry)));
    void run('Przenoszę zapytanie…', () => moveInquiry(inquiry.id, stage), `Przeniesiono do etapu „${stageOf(stage).label}”`)
      .then((ok) => { if (!ok) void load(true); });
  };
  const askRemoval = async (inquiry: FunnelInquiry) => {
    setBusy('Sprawdzam powiązania zapytania…');
    try {
      const { mode: removalMode } = await inquiryRemovalMode(inquiry.id);
      setRemoval({ inquiry, mode: removalMode });
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Nie udało się sprawdzić powiązań zapytania.', true);
    } finally {
      setBusy(null);
    }
  };
  /** Karta zapytania (na tablecie jak w CRM `/crm/inquiries/[id]` i na Macu — `InquiryWorkspaceScreen`). */
  const openWorkspace = (inquiry: FunnelInquiry) => navigation.navigate('InquiryDetail', { taskId: inquiry.id });
  const call = (inquiry: FunnelInquiry) => {
    if (!inquiry.clientPhone) return;
    void startCall({ phoneNumber: inquiry.clientPhone, displayName: inquiry.clientText || inquiry.titleLabel, inquiryId: inquiry.id });
  };

  const menuAction = (action: MenuAction, inquiry: FunnelInquiry, stage?: InquiryStageId) => {
    if (action === 'work') openWorkspace(inquiry);
    else if (action === 'details') setSelectedId(inquiry.id);
    else if (action === 'claim') claim(inquiry);
    else if (action === 'edit') setEditing({ inquiry });
    else if (action === 'move' && stage) drop(inquiry, stage);
    else if (action === 'contact') setContactTarget(inquiry);
    else if (action === 'snooze') snooze(inquiry);
    else if (action === 'remove') void askRemoval(inquiry);
    else if (action === 'browser') void Linking.openURL(inquiryCrmUrl(inquiry.id));
  };

  const card = (inquiry: FunnelInquiry, grip: ReactNode | null) => (
    <InquiryCard inquiry={inquiry} grip={grip} selected={selectedId === inquiry.id} canManage={canManage(inquiry)} canClaim={canClaim(inquiry)}
      onPress={() => setSelectedId(inquiry.id)} onClaim={() => claim(inquiry)} onContact={() => setContactTarget(inquiry)} onSnooze={() => snooze(inquiry)}
      onMenu={() => setMenuTarget(inquiry)} />
  );

  const header = (
    <View style={styles.header}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {scopes.map((item) => {
          const count = items.filter((inquiry) => inScope(inquiry, item.key, access)).length;
          return <Chip key={item.key} label={`${item.label} ${count}`} active={activeScope === item.key} onPress={() => setScope(item.key)} />;
        })}
        <View style={styles.divider} />
        {INQUIRY_STATUS_FILTERS.map((item) => {
          const count = items.filter((inquiry) => (item.key === 'open' ? isOpenInquiry(inquiry) : item.key === 'completed' ? !isOpenInquiry(inquiry) : true)).length;
          return <Chip key={item.key} label={`${item.label} ${count}`} active={status === item.key} onPress={() => setStatus(item.key)} />;
        })}
      </ScrollView>
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Feather name="search" size={16} color={colors.text.tertiary} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Szukaj: klient, telefon, e-mail, miejsce…" placeholderTextColor={ink(0.35)}
            style={styles.searchInput} autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />
        </View>
        <View style={styles.segment}>
          {(['pipeline', 'list'] as const).map((item) => (
            <TouchableOpacity key={item} onPress={() => setMode(item)} style={[styles.segmentItem, mode === item && styles.segmentActive]}
              accessibilityRole="tab" accessibilityState={{ selected: mode === item }}>
              <Feather name={item === 'pipeline' ? 'columns' : 'list'} size={16} color={mode === item ? colors.background.primary : colors.text.secondary} />
              <Text style={[styles.segmentText, mode === item && styles.segmentTextActive]}>{item === 'pipeline' ? 'Lejek' : 'Lista'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => { setRefreshing(true); void load(true); }} style={styles.iconButton} accessibilityLabel="Odśwież zapytania">
          {refreshing ? <ActivityIndicator size="small" color={colors.primary.gold} /> : <Feather name="refresh-cw" size={18} color={colors.primary.gold} />}
        </TouchableOpacity>
        {access?.canCreate ? (
          <TouchableOpacity onPress={() => setAdding(true)} style={styles.primary} accessibilityRole="button">
            <Feather name="plus" size={18} color={colors.background.primary} /><Text style={styles.primaryText}>Nowe zapytanie</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        <Text style={styles.weighted}>Ważona wartość <Text style={styles.weightedValue}>{money(weighted) || '0 zł'}</Text></Text>
        {INQUIRY_ATTENTION.map((item) => {
          const count = items.filter((inquiry) => attentionMatches(inquiry, item.key, now)).length;
          if (!count && attention !== item.key) return null;
          return <Chip key={item.key} label={`${item.label} ${count}`} active={attention === item.key} dot={item.color}
            onPress={() => setAttention((current) => (current === item.key ? null : item.key))} />;
        })}
      </ScrollView>
    </View>
  );

  const body = loading && !items.length ? (
    <View style={styles.center}><ActivityIndicator size="large" color={colors.primary.gold} /><Text style={styles.muted}>Ładowanie zapytań…</Text></View>
  ) : loadError && !items.length ? (
    <View style={styles.center}>
      <Feather name="alert-triangle" size={32} color={colors.status.warning} />
      <Text style={styles.text}>{loadError}</Text>
      <TouchableOpacity onPress={() => { setLoading(true); void load(true); }} style={styles.secondary}><Text style={styles.secondaryText}>Spróbuj ponownie</Text></TouchableOpacity>
    </View>
  ) : mode === 'pipeline' ? (
    <InquiryBoard inquiries={visible} canDrag={canManage} renderCard={card} onDrop={drop} onDragChange={setDragging} />
  ) : (
    <FlatList
      data={visible}
      keyExtractor={(inquiry) => inquiry.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor={colors.primary.gold} />}
      ListEmptyComponent={<View style={styles.center}><Feather name="inbox" size={32} color={colors.text.tertiary} /><Text style={styles.muted}>Brak zapytań w tym widoku. Zmień filtr lub wyszukiwaną frazę.</Text></View>}
      renderItem={({ item }) => (
        <InquiryRow inquiry={item} selected={selectedId === item.id} onPress={() => setSelectedId(item.id)} onMenu={() => setMenuTarget(item)} />
      )}
    />
  );

  const inspector = selected ? (
    <InquiryInspector inquiry={selected} canManage={canManage(selected)} canClaim={canClaim(selected)}
      onClose={() => setSelectedId(null)} onClaim={() => claim(selected)} onContact={() => setContactTarget(selected)} onSnooze={() => snooze(selected)}
      onEdit={() => setEditing({ inquiry: selected })} onRemove={() => void askRemoval(selected)} onWork={() => openWorkspace(selected)}
      onCall={() => call(selected)} onMail={() => void Linking.openURL(`mailto:${selected.clientEmail}`)}
      onBrowser={() => void Linking.openURL(inquiryCrmUrl(selected.id))} />
  ) : null;

  return (
    <NoticeScope value={{ busy, toast }}>
    <View style={styles.container}>
      {header}
      <View style={styles.content}>
        <View style={styles.flex}>{body}</View>
        {wide && inspector ? <View style={styles.inspector}>{inspector}</View> : null}
      </View>

      {!wide ? (
        <Modal visible={Boolean(inspector)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedId(null)}
          supportedOrientations={['portrait', 'landscape']}>
          <View style={[styles.flex, { backgroundColor: colors.background.elevated }]}>{inspector}</View>
        </Modal>
      ) : null}

      <InquiryEditSheet target={editing} access={access} onClose={() => setEditing(null)}
        onSave={async (inquiry, data) => {
          const ok = await run('Zapisuję zapytanie…', () => updateInquiry(inquiry.id, data), 'Zapytanie zostało zaktualizowane');
          if (ok) setEditing(null);
        }} />
      <InquiryContactSheet inquiry={contactTarget} onClose={() => setContactTarget(null)}
        onConfirm={async (inquiry, next) => {
          const ok = await run('Zapisuję kontakt…', () => contactInquiry(inquiry.id, next), 'Kontakt zapisany');
          if (ok) setContactTarget(null);
        }} />
      <InquiryMenuSheet inquiry={menuTarget} canManage={menuTarget ? canManage(menuTarget) : false} canClaim={menuTarget ? canClaim(menuTarget) : false}
        onClose={() => setMenuTarget(null)}
        onAction={(action, inquiry, stage) => {
          setMenuTarget(null);
          // Okna otwierane z menu — po zamknięciu menu (iOS nie pokaże dwóch okien naraz).
          if (action !== 'work' && action !== 'browser') { afterModal(() => menuAction(action, inquiry, stage)); return; }
          menuAction(action, inquiry, stage);
        }} />
      <InquiryRemovalSheet target={removal} onClose={() => setRemoval(null)}
        onConfirm={async (inquiry, removalMode, reason) => {
          const ok = await run(removalMode === 'deleted' ? 'Usuwam zapytanie…' : 'Archiwizuję zapytanie…', () => removeInquiry(inquiry.id, removalMode, reason),
            removalMode === 'deleted' ? 'Zapytanie usunięte' : 'Zapytanie zarchiwizowane');
          if (ok) { setRemoval(null); if (selectedId === inquiry.id) setSelectedId(null); }
        }} />
      <NewInquiryModal visible={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); notify('Zapytanie dodane'); void load(true); }} />
      <CallOutcomeModal call={pendingCall} visible={showOutcome} onClose={closeOutcome} onSaved={() => void load(true)} />

      {busy ? (
        <View style={styles.busy} pointerEvents="auto" accessibilityViewIsModal accessibilityLiveRegion="polite">
          <View style={styles.busyCard}><ActivityIndicator color={colors.primary.gold} /><Text style={styles.text}>{busy}</Text></View>
        </View>
      ) : null}
      {toast ? (
        <View pointerEvents="none" style={[styles.toast, toast.error && styles.toastError]} accessibilityLiveRegion="polite">
          <Feather name={toast.error ? 'alert-circle' : 'check-circle'} size={18} color={toast.error ? colors.status.error : colors.status.success} />
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      ) : null}
    </View>
    </NoticeScope>
  );
}

/** Odznaki: rodzaj zapytania, etap i szansa wygranej (jak na karcie w CRM). */
function Badges({ inquiry }: { inquiry: FunnelInquiry }) {
  const stage = stageOf(inquiry.stage);
  return (
    <View style={styles.badges}>
      {inquiry.typeLabels.slice(0, 2).map((label) => <Text key={label} style={[styles.badge, { color: colors.primary.gold, backgroundColor: glow(0.06) }]} numberOfLines={1}>{label}</Text>)}
      <Text style={[styles.badge, { color: tone(stage.color), backgroundColor: shade(0.25) }]}>{stage.shortLabel}</Text>
      <Text style={[styles.badge, { color: colors.text.secondary, backgroundColor: shade(0.25) }]}>{inquiry.probability}%</Text>
    </View>
  );
}

function InquiryCard({ inquiry, grip, selected, canManage, canClaim, onPress, onClaim, onContact, onSnooze, onMenu }: {
  inquiry: FunnelInquiry; grip: ReactNode | null; selected: boolean; canManage: boolean; canClaim: boolean;
  onPress: () => void; onClaim: () => void; onContact: () => void; onSnooze: () => void; onMenu: () => void;
}) {
  const warnings = inquiryWarnings(inquiry);
  const overdue = inquiryOverdue(inquiry);
  const followUp = canManage && Boolean(inquiry.ownerId) && isOpenInquiry(inquiry);
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[styles.card, selected && styles.cardSelected]}
      accessibilityLabel={`${inquiry.titleLabel}, ${stageOf(inquiry.stage).label}`}>
      <View style={styles.cardHead}>
        <View style={styles.flex}>
          <Text style={styles.cardTitle} numberOfLines={2}>{inquiry.titleLabel}</Text>
          <Text style={styles.muted} numberOfLines={1}>{inquiry.sourceLabel}</Text>
        </View>
        <TouchableOpacity onPress={onMenu} style={styles.iconButtonSmall} hitSlop={6} accessibilityLabel="Czynności zapytania">
          <Feather name="more-horizontal" size={18} color={colors.text.secondary} />
        </TouchableOpacity>
        {grip}
      </View>
      <Badges inquiry={inquiry} />
      <View style={styles.cardLines}>
        {inquiry.clientPhone ? <Line icon="phone" text={inquiry.clientPhone} /> : null}
        {inquiry.clientEmail ? <Line icon="mail" text={inquiry.clientEmail} /> : null}
        {inquiry.ownerName ? <Line icon="user" text={inquiry.ownerName} /> : null}
        {inquiry.estimatedValue ? <Line icon="credit-card" text={money(inquiry.estimatedValue)} /> : null}
        {inquiry.nextActionAt ? <Line icon="clock" text={`${overdue ? 'Zaległy kontakt' : 'Następny kontakt'}: ${formatInquiryShort(inquiry.nextActionAt)}`} warn={overdue} /> : null}
      </View>
      {warnings.length ? (
        <View style={styles.warning}><Feather name="alert-triangle" size={13} color="#fde68a" /><Text style={styles.warningText} numberOfLines={2}>{warnings.slice(0, 2).join(' · ')}</Text></View>
      ) : null}
      {canClaim || followUp ? (
        <View style={styles.cardActions}>
          {canClaim ? <SmallButton label="Przejmij" icon="user-check" primary onPress={onClaim} /> : null}
          {followUp ? <SmallButton label="Kontakt wykonany" icon="check" onPress={onContact} /> : null}
          {followUp ? <SmallButton label="Odłóż 1h" icon="clock" onPress={onSnooze} /> : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function Line({ icon, text, warn = false }: { icon: React.ComponentProps<typeof Feather>['name']; text: string; warn?: boolean }) {
  return (
    <View style={styles.line}>
      <Feather name={icon} size={13} color={warn ? '#fca5a5' : colors.text.tertiary} />
      <Text style={[styles.muted, warn && { color: '#fca5a5' }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

function InquiryRow({ inquiry, selected, onPress, onMenu }: { inquiry: FunnelInquiry; selected: boolean; onPress: () => void; onMenu: () => void }) {
  const stage = stageOf(inquiry.stage);
  const warnings = inquiryWarnings(inquiry);
  return (
    <TouchableOpacity onPress={onPress} style={[styles.row, selected && styles.cardSelected]} accessibilityLabel={`${inquiry.titleLabel}, ${stage.label}`}>
      <View style={styles.rowMain}>
        <Text style={styles.cardTitle} numberOfLines={1}>{inquiry.titleLabel}</Text>
        <Text style={styles.muted} numberOfLines={1}>{[inquiry.sourceLabel, inquiry.clientLabel || inquiry.clientText].filter(Boolean).join(' · ')}</Text>
        {warnings.length ? <Text style={styles.warningText} numberOfLines={1}>{warnings.join(' · ')}</Text> : null}
      </View>
      <View style={styles.rowStage}><View style={[styles.dotSmall, { backgroundColor: tone(stage.color) }]} /><Text style={styles.text} numberOfLines={1}>{stage.label}</Text></View>
      <Text style={[styles.rowCell, !inquiry.ownerName && styles.muted]} numberOfLines={1}>{inquiry.ownerName || 'Bez opiekuna'}</Text>
      <Text style={styles.rowCellNarrow}>{inquiry.estimatedValue ? money(inquiry.estimatedValue) : '—'}</Text>
      <Text style={styles.rowCellTiny}>{inquiry.probability}%</Text>
      <Text style={[styles.rowCellNarrow, inquiryOverdue(inquiry) && { color: '#fca5a5' }]}>{inquiry.nextActionAt ? formatInquiryShort(inquiry.nextActionAt) : '—'}</Text>
      <TouchableOpacity onPress={onMenu} style={styles.iconButtonSmall} hitSlop={6} accessibilityLabel="Czynności zapytania">
        <Feather name="more-horizontal" size={18} color={colors.text.secondary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function InquiryInspector({ inquiry, canManage, canClaim, onClose, onClaim, onContact, onSnooze, onEdit, onRemove, onWork, onCall, onMail, onBrowser }: {
  inquiry: FunnelInquiry; canManage: boolean; canClaim: boolean;
  onClose: () => void; onClaim: () => void; onContact: () => void; onSnooze: () => void; onEdit: () => void; onRemove: () => void; onWork: () => void;
  onCall: () => void; onMail: () => void; onBrowser: () => void;
}) {
  const [fullMessage, setFullMessage] = useState(false);
  useEffect(() => setFullMessage(false), [inquiry.id]);
  const stage = stageOf(inquiry.stage);
  const warnings = inquiryWarnings(inquiry);
  const full = inquiry.message || inquiry.description;
  const clean = inquiry.messageClean || full;
  const trimmed = Boolean(inquiry.message) && clean !== full;
  const followUp = canManage && Boolean(inquiry.ownerId) && isOpenInquiry(inquiry);
  const field = (label: string, value: string) => (value ? (
    <View style={styles.field} key={label}><Text style={styles.fieldLabel}>{label}</Text><Text style={styles.text} selectable>{value}</Text></View>
  ) : null);
  return (
    <View style={styles.flex}>
      <View style={styles.inspectorHead}>
        <View style={styles.flex}>
          <Text style={styles.inspectorTitle} selectable>{inquiry.titleLabel}</Text>
          <Text style={styles.muted}>{inquiry.sourceLabel}</Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.iconButton} accessibilityLabel="Zamknij szczegóły"><Feather name="x" size={20} color={colors.text.secondary} /></TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.inspectorBody}>
        <Badges inquiry={inquiry} />
        <TouchableOpacity onPress={onWork} style={styles.primaryWide} accessibilityRole="button">
          <Feather name="layout" size={18} color={colors.background.primary} /><Text style={styles.primaryText}>Obsługa zapytania</Text>
        </TouchableOpacity>
        {canClaim || followUp ? (
          <View style={styles.cardActions}>
            {canClaim ? <SmallButton label="Przejmij" icon="user-check" primary onPress={onClaim} /> : null}
            {followUp ? <SmallButton label="Kontakt wykonany…" icon="check" onPress={onContact} /> : null}
            {followUp ? <SmallButton label="Odłóż 1h" icon="clock" onPress={onSnooze} /> : null}
          </View>
        ) : null}
        {warnings.length ? <View style={styles.warning}><Feather name="alert-triangle" size={13} color="#fde68a" /><Text style={styles.warningText}>{warnings.join(' · ')}</Text></View> : null}
        <Text style={styles.group}>Klient</Text>
        {field('Klient', inquiry.clientText)}
        {field('Firma', inquiry.clientCompany)}
        {inquiry.clientPhone ? (
          <View style={styles.fieldRow}>{field('Telefon', inquiry.clientPhone)}<SmallButton label="Zadzwoń" icon="phone" onPress={onCall} /></View>
        ) : null}
        {inquiry.clientEmail ? (
          <View style={styles.fieldRow}>{field('E-mail', inquiry.clientEmail)}<SmallButton label="Napisz" icon="mail" onPress={onMail} /></View>
        ) : null}
        <Text style={styles.group}>Sprzedaż</Text>
        {field('Opiekun', inquiry.ownerName || 'Bez opiekuna')}
        {field('Etap', stage.label)}
        {field('Szacowana wartość', inquiry.estimatedValue ? money(inquiry.estimatedValue) : '')}
        {field('Prawdopodobieństwo wygranej', `${inquiry.probability}%`)}
        {field('Następne działanie', formatInquiryFull(inquiry.nextActionAt))}
        {field('Ostatni kontakt', formatInquiryFull(inquiry.lastContactAt))}
        {field('Pierwszy kontakt', formatInquiryFull(inquiry.firstContactAt))}
        {!inquiry.firstContactAt ? field('Termin pierwszego kontaktu (SLA)', formatInquiryFull(inquiry.slaDueAt)) : null}
        {inquiry.stage === 'lost' ? field('Kategoria utraty', INQUIRY_LOST_CATEGORIES.find((item) => item.value === inquiry.lostReasonCategory)?.label || '') : null}
        {inquiry.stage === 'lost' ? field('Powód utraty', inquiry.lostReason) : null}
        <Text style={styles.group}>Wydarzenie</Text>
        {field('Termin', inquiry.termin || '')}
        {field('Miejsce', inquiry.locationText)}
        {field('Zakres', inquiry.scope)}
        {full ? (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Treść zapytania</Text>
            <Text style={styles.text} selectable>{trimmed && !fullMessage ? clean : full}</Text>
            {trimmed ? (
              <TouchableOpacity onPress={() => setFullMessage((value) => !value)} hitSlop={6}>
                <Text style={styles.link}>{fullMessage ? 'Pokaż tylko treść' : 'Pokaż całą wiadomość'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        <View style={styles.cardActions}>
          {canManage ? <SmallButton label="Opiekun, etap i termin" icon="sliders" onPress={onEdit} /> : null}
          <SmallButton label="Otwórz w CRM" icon="external-link" onPress={onBrowser} />
          {canManage ? <SmallButton label="Usuń…" icon="trash-2" danger onPress={onRemove} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

type MenuAction = 'work' | 'details' | 'claim' | 'edit' | 'move' | 'contact' | 'snooze' | 'remove' | 'browser';

/** Czynności zapytania (jak menu kontekstowe na Macu) — duże wiersze do dotyku. */
function InquiryMenuSheet({ inquiry, canManage, canClaim, onClose, onAction }: {
  inquiry: FunnelInquiry | null; canManage: boolean; canClaim: boolean; onClose: () => void;
  onAction: (action: MenuAction, inquiry: FunnelInquiry, stage?: InquiryStageId) => void;
}) {
  const [moving, setMoving] = useState(false);
  useEffect(() => setMoving(false), [inquiry]);
  if (!inquiry) return null;
  const followUp = canManage && Boolean(inquiry.ownerId) && isOpenInquiry(inquiry);
  const item = (key: MenuAction, label: string, icon: React.ComponentProps<typeof Feather>['name'], danger = false) => (
    <TouchableOpacity key={key} onPress={() => (key === 'move' ? setMoving(true) : onAction(key, inquiry))} style={styles.menuItem} accessibilityRole="button">
      <Feather name={icon} size={18} color={danger ? colors.status.error : colors.primary.gold} />
      <Text style={[styles.text, danger && { color: colors.status.error }]}>{label}</Text>
      {key === 'move' ? <Feather name="chevron-right" size={18} color={colors.text.tertiary} style={styles.menuChevron} /> : null}
    </TouchableOpacity>
  );
  return (
    <Sheet visible title={moving ? 'Przenieś do etapu' : 'Zapytanie'} subtitle={inquiry.titleLabel} onClose={onClose} width={460}
      footer={<TouchableOpacity onPress={moving ? () => setMoving(false) : onClose} style={styles.secondary}><Text style={styles.secondaryText}>{moving ? 'Wróć' : 'Zamknij'}</Text></TouchableOpacity>}>
      {moving ? INQUIRY_STAGES.map((stage) => {
        const current = stageOf(inquiry.stage).id === stage.id;
        return (
          <TouchableOpacity key={stage.id} disabled={current} onPress={() => onAction('move', inquiry, stage.id)} style={[styles.menuItem, current && styles.disabled]}>
            <View style={[styles.dotSmall, { backgroundColor: tone(stage.color) }]} />
            <Text style={styles.text}>{stage.label}{current ? ' (obecny)' : ''}</Text>
          </TouchableOpacity>
        );
      }) : (
        <>
          {item('work', 'Obsługa zapytania', 'layout')}
          {item('details', 'Pokaż szczegóły', 'info')}
          {canClaim ? item('claim', 'Przejmij', 'user-check') : null}
          {canManage ? item('edit', 'Opiekun, etap i termin…', 'sliders') : null}
          {canManage ? item('move', 'Przenieś do etapu', 'columns') : null}
          {followUp ? item('contact', 'Kontakt wykonany…', 'check') : null}
          {followUp ? item('snooze', 'Odłóż o godzinę', 'clock') : null}
          {item('browser', 'Otwórz w CRM', 'external-link')}
          {canManage ? item('remove', 'Usuń lub archiwizuj…', 'trash-2', true) : null}
        </>
      )}
    </Sheet>
  );
}

/** Usunięcie (bez powiązań) albo archiwizacja z powodem (zapytanie z powiązanymi danymi) — jak `remove_inquiry`. */
function InquiryRemovalSheet({ target, onClose, onConfirm }: {
  target: { inquiry: FunnelInquiry; mode: 'deleted' | 'archived' } | null; onClose: () => void;
  onConfirm: (inquiry: FunnelInquiry, mode: 'deleted' | 'archived', reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setReason(''), [target]);
  if (!target) return null;
  const archive = target.mode === 'archived';
  const valid = !archive || Boolean(reason.trim());
  return (
    <Sheet visible title={archive ? 'Archiwizuj zapytanie' : 'Usuń zapytanie'} subtitle={target.inquiry.titleLabel} onClose={onClose} width={520}
      footer={(
        <>
          <TouchableOpacity onPress={onClose} style={styles.secondary}><Text style={styles.secondaryText}>Anuluj</Text></TouchableOpacity>
          <TouchableOpacity disabled={!valid || saving} style={[styles.danger, (!valid || saving) && styles.disabled]}
            onPress={async () => { setSaving(true); try { await onConfirm(target.inquiry, target.mode, reason.trim()); } finally { setSaving(false); } }}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.dangerText}>{archive ? 'Archiwizuj' : 'Usuń zapytanie'}</Text>}
          </TouchableOpacity>
        </>
      )}>
      <Text style={styles.text}>
        {archive ? 'Zapytanie ma powiązane dane, dlatego zostanie zarchiwizowane. Historia i dokumenty pozostaną.' : 'Zapytanie nie ma powiązanych danych i zostanie usunięte. Tej operacji nie można cofnąć.'}
      </Text>
      {archive ? (
        <>
          <Text style={styles.fieldLabel}>Powód archiwizacji</Text>
          <TextInput value={reason} onChangeText={setReason} multiline style={[styles.input, styles.multiline]} placeholder="Np. duplikat, klient zrezygnował przed kontaktem" placeholderTextColor={ink(0.35)} />
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  flex: { flex: 1 },
  content: { flex: 1, flexDirection: 'row' },
  header: { gap: spacing.xs, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  chipRow: { gap: spacing.xs, paddingHorizontal: spacing.md, alignItems: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  divider: { width: 1, height: 24, backgroundColor: glow(0.12), marginHorizontal: spacing.xs },
  chip: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: borderRadius.full, borderWidth: 1,
    borderColor: glow(0.15),
  },
  chipActive: { borderColor: colors.primary.gold, backgroundColor: glow(0.08) },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  chipTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  dotSmall: { width: 9, height: 9, borderRadius: 5 },
  search: {
    flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: borderRadius.lg,
    backgroundColor: shade(0.25), borderWidth: 1, borderColor: glow(0.08),
  },
  searchInput: { flex: 1, color: colors.text.primary, fontSize: typography.fontSizes.md, paddingVertical: spacing.sm },
  segment: { flexDirection: 'row', padding: 3, borderRadius: borderRadius.full, borderWidth: 1, borderColor: glow(0.15) },
  segmentItem: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: spacing.md, borderRadius: borderRadius.full },
  segmentActive: { backgroundColor: colors.primary.gold },
  segmentText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  segmentTextActive: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  iconButtonSmall: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  primary: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: borderRadius.lg, backgroundColor: colors.primary.gold,
  },
  primaryWide: {
    minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: borderRadius.lg,
    backgroundColor: colors.primary.gold,
  },
  primaryText: { color: colors.background.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: glow(0.15) },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.md },
  danger: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.status.error },
  dangerText: { color: colors.white, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  disabled: { opacity: 0.45 },
  weighted: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm, marginRight: spacing.sm },
  weightedValue: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  text: { color: colors.text.primary, fontSize: typography.fontSizes.md },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm },
  link: { color: colors.primary.gold, fontSize: typography.fontSizes.sm, marginTop: 4 },
  list: { padding: spacing.md, gap: spacing.xs },
  card: { gap: spacing.xs, padding: spacing.sm + 2, borderRadius: borderRadius.lg, backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: glow(0.06) },
  cardSelected: { borderColor: colors.primary.gold, backgroundColor: glow(0.06) },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  cardTitle: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  cardLines: { gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  badge: { fontSize: typography.fontSizes.xs, paddingHorizontal: 7, paddingVertical: 2, borderRadius: borderRadius.full, overflow: 'hidden', maxWidth: 160 },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: spacing.xs + 2, borderRadius: borderRadius.md, backgroundColor: 'rgba(251,191,36,0.08)' },
  warningText: { flex: 1, color: '#fde68a', fontSize: typography.fontSizes.xs },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  smallButton: {
    minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm + 2, borderRadius: borderRadius.full, borderWidth: 1,
    borderColor: glow(0.15),
  },
  smallPrimary: { backgroundColor: colors.primary.gold, borderColor: colors.primary.gold },
  smallText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 60, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg, backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: glow(0.06),
  },
  rowMain: { flex: 3, gap: 2 },
  rowStage: { flex: 1.3, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowCell: { flex: 1.2, color: colors.text.primary, fontSize: typography.fontSizes.sm },
  rowCellNarrow: { width: 100, color: colors.text.primary, fontSize: typography.fontSizes.sm, textAlign: 'right' },
  rowCellTiny: { width: 44, color: colors.text.secondary, fontSize: typography.fontSizes.sm, textAlign: 'right' },
  inspector: { width: 380, borderLeftWidth: 1, borderLeftColor: glow(0.08), backgroundColor: colors.background.secondary },
  inspectorHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: glow(0.08) },
  inspectorTitle: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold },
  inspectorBody: { gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.xxl },
  group: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textTransform: 'uppercase', marginTop: spacing.sm, fontWeight: typography.fontWeights.semibold },
  field: { gap: 2, flexShrink: 1 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  fieldLabel: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textTransform: 'uppercase', marginTop: spacing.xs },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  sheet: {
    width: '100%', maxHeight: '90%', gap: spacing.sm, padding: spacing.lg, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: glow(0.1),
    backgroundColor: colors.background.elevated,
  },
  sheetTitle: { color: colors.text.primary, fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.semibold },
  sheetScroll: { flexGrow: 0 },
  sheetBody: { gap: spacing.sm, paddingVertical: spacing.xs },
  sheetFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, paddingTop: spacing.xs },
  input: {
    minHeight: 48, color: colors.text.primary, fontSize: typography.fontSizes.md, paddingHorizontal: spacing.md, borderRadius: borderRadius.lg,
    backgroundColor: shade(0.25), borderWidth: 1, borderColor: glow(0.1),
  },
  multiline: { minHeight: 96, paddingTop: spacing.sm, textAlignVertical: 'top' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  gapSm: { gap: spacing.sm },
  dateButton: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: borderRadius.lg,
    backgroundColor: shade(0.25), borderWidth: 1, borderColor: glow(0.1),
  },
  pickerPanel: { alignItems: 'center', gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: shade(0.2) },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: glow(0.15) },
  progressTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: shade(0.3), overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary.gold },
  menuItem: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: borderRadius.lg },
  menuChevron: { marginLeft: 'auto' },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  busyCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: borderRadius.xl,
    backgroundColor: colors.background.elevated, borderWidth: 1, borderColor: glow(0.1),
  },
  toast: {
    position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.elevated, borderWidth: 1, borderColor: glow(0.12), alignSelf: 'center', maxWidth: 640,
  },
  toastError: { borderColor: colors.status.error },
  toastText: { flex: 1, color: colors.text.primary, fontSize: typography.fontSizes.md },
});
