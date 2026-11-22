import React, { useCallback, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography, glow, ink, shade, tone } from '../theme';
import { useContentWidth } from '../hooks/useTabletLayout';
import { useCrmCall } from '../hooks/useCrmCall';
import CallOutcomeModal from '../components/CallOutcomeModal';
import Client360Modal from '../components/Client360Modal';
import { supabase } from '../lib/supabase';
import { openPdf } from '../lib/driveApi';
import { contactInquiry, crmUrl, inquiryCrmUrl, offerPdfLink, updateInquiry } from '../lib/inquiriesApi';
import { INQUIRY_LOST_CATEGORIES, formatInquiryFull, formatInquiryMoney, isClosedStage, plannedAt, stageOf } from '../lib/inquiryFunnel';
import {
  NOTE_KINDS, acceptWorkspaceOffer, addWorkspaceNote, changeWorkspaceStage, convertWorkspace, createWorkspaceCalculation, createWorkspaceOffer, duplicateWorkspaceOffer,
  handOffWorkspace, loadWorkspace, newRequestId, normalizeBrief, preparesRealization, reopenWorkspace, saveWorkspaceBrief, saveWorkspaceTitle, workspaceNotes,
  type InquiryWorkspace, type WorkspaceBrief, type WorkspaceInfo, type WorkspaceOffer,
} from '../lib/inquiryWorkspace';
import { navigateToContactMessage, navigateToEmailMessage, navigateToEvent, openInCrmWeb } from '../navigation/navigationRef';
import { InquiryContactSheet, InquiryEditSheet, NoticeScope, SmallButton, afterModal, kit, useNotice } from '../components/Inquiries/InquiryKit';
import {
  AcceptOfferSheet, ActionMenu, BriefSheet, ClientSheet, ConvertSheet, HandoffSheet, ReasonSheet, StageSheet, TitleSheet, type MenuItem,
} from '../components/Inquiries/WorkspaceSheets';
import { TasksTab, TeamTab } from '../components/Inquiries/WorkspaceTabs';
import { CorrespondenceTab, EmailSheet } from '../components/Inquiries/WorkspaceMail';
import { AnalysisTab, GuestsReader } from '../components/Inquiries/WorkspaceAnalysis';
import { CalculationsList } from '../components/Inquiries/CalculationsList';
import type { InquiryCalculationParams } from './InquiryCalculationScreen';

/*
 * Karta zapytania na tablecie — jak `/crm/inquiries/[id]` w CRM i karta zapytania na Macu, z obsługą dotykiem. Nagłówek (nazwa,
 * etap, źródło) z czynnościami: przygotuj realizację, nowa oferta (konfigurator z katalogu albo pusty szkic), e-mail do klienta,
 * etap, telefon, „Więcej” (klient i organizacja, zadanie, wydarzenie, przekazanie, opiekun / wartość / termin, ponowne negocjacje,
 * analiza AI, CRM). Zakładki: Podsumowanie (treść, ustalenia z liczbą osób odczytaną przez AI, klient, prowadzenie sprzedaży),
 * Korespondencja, Analiza i AI, Oferty (PDF, kopia, akceptacja), Kalkulacje (lista i edytor — `InquiryCalculationScreen`), Zadania,
 * Notatki, Zespół, Historia. Uprawnienia z serwera
 * (`canLead`, `canManage`) — te same co w CRM. API: `lib/inquiryWorkspace.ts`.
 */

type Tab = 'overview' | 'correspondence' | 'analysis' | 'offers' | 'calculations' | 'tasks' | 'notes' | 'team' | 'history';
type Overlay = null | 'title' | 'stage' | 'handoff' | 'reopen' | 'client' | 'convert' | 'more' | 'contact' | 'newOffer' | 'email';
/** Czynność przerwana oknem klienta (oferta i wydarzenie wymagają klienta) — wraca po jego zapisaniu. */
type AfterClient = 'offer' | 'convert' | null;
type Client360Row = React.ComponentProps<typeof Client360Modal>['client'];

const money = formatInquiryMoney;
const SOURCE = /^\/crm\/messages\/([\da-f-]{36})\?type=(received|contact)$/i;

export default function InquiryWorkspaceScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const inquiryId: string = route.params?.taskId || '';
  const wide = useContentWidth() >= 1000;
  const [data, setData] = useState<InquiryWorkspace | null>(null);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [brief, setBrief] = useState<WorkspaceBrief | null>(null);
  const [accepting, setAccepting] = useState<WorkspaceOffer | null>(null);
  /** Okna z danymi zapytania z chwili otwarcia (odświeżenie karty nie czyści formularza). */
  const [editTarget, setEditTarget] = useState<{ inquiry: WorkspaceInfo } | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<WorkspaceInfo | null>(null);
  const [afterClient, setAfterClient] = useState<AfterClient>(null);
  const [fullMessage, setFullMessage] = useState(false);
  const [noteKind, setNoteKind] = useState<string>('note');
  const [noteBody, setNoteBody] = useState('');
  const [noteRequest, setNoteRequest] = useState(newRequestId);
  const [creatingTask, setCreatingTask] = useState(false);
  const [tabKey, setTabKey] = useState(0);
  const [client360, setClient360] = useState<Client360Row>(null);
  const { notify, run, overlay: notice, scope } = useNotice();
  const { startCall, pendingCall, showOutcome, closeOutcome } = useCrmCall();
  const loadingRef = useRef(false);
  const reloadRef = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    if (!inquiryId) return;
    // Wczytywanie w toku — po nim jeszcze raz (zmiana zapisana w międzyczasie ma być widoczna).
    if (loadingRef.current) { reloadRef.current = true; return; }
    loadingRef.current = true;
    try {
      setData(await loadWorkspace(inquiryId));
      setLoadError('');
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Nie udało się wczytać zapytania.');
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
    }
    if (reloadRef.current) { reloadRef.current = false; await load(); }
  }, [inquiryId]);

  // Przy wejściu i po powrocie (np. z oferty albo zadania) — świeże dane karty.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /** Czynność z oknem ładowania i komunikatem; po sukcesie odświeża kartę. */
  const act = async <T,>(label: string, action: () => Promise<T>, success: string): Promise<T | null> => {
    const reply = await run(label, action, success);
    if (reply !== null) await load();
    return reply;
  };

  // Inne zapytanie w tym samym ekranie (np. z powiadomienia) — do czasu wczytania bez danych poprzedniego.
  if (!data || data.inquiry.id !== inquiryId) {
    return (
      <View style={styles.container}>
        <BackBar onBack={() => goBack(navigation)} />
        <View style={styles.center}>
          {loadError ? (
            <>
              <Feather name="alert-triangle" size={32} color={colors.status.warning} />
              <Text style={kit.text}>Nie udało się otworzyć zapytania</Text>
              <Text style={kit.muted}>{loadError}</Text>
              <TouchableOpacity onPress={() => void load()} style={kit.secondary}><Text style={kit.secondaryText}>Spróbuj ponownie</Text></TouchableOpacity>
            </>
          ) : (
            <><ActivityIndicator size="large" color={colors.primary.gold} /><Text style={kit.muted}>Wczytywanie zapytania…</Text></>
          )}
        </View>
      </View>
    );
  }

  const info = data.inquiry;
  const { canLead, canManage } = data.permissions;
  const stage = stageOf(info.stage);
  const open = !isClosedStage(info.stage);
  const hasClient = Boolean(info.contactId || info.organizationId);
  const notes = workspaceNotes(data);
  const realization = canLead && preparesRealization(data);

  const call = () => {
    if (!data.client.phone) return;
    void startCall({ phoneNumber: data.client.phone, displayName: data.client.name || info.titleLabel, inquiryId: info.id });
  };
  /** Napisz: ze skrzynki firmy (trafia do korespondencji zapytania) albo — bez uprawnień do zapytania — z poczty urządzenia. */
  const mail = () => {
    if (canManage) { setOverlay('email'); return; }
    void Linking.openURL(`mailto:${data.client.email}?subject=${encodeURIComponent(`Zapytanie: ${info.titleLabel}`)}`).catch(() => undefined);
  };
  /** Liczba osób z korespondencji → ustalenia zapytania (`save_inquiry_brief`). */
  const applyGuests = async (count: number) => Boolean(await act('Zapisuję liczbę osób…',
    () => saveWorkspaceBrief(info.id, normalizeBrief({ ...data.brief, guestCount: String(count) }), info.briefRevision), 'Liczba osób została zapisana w zapytaniu'));
  const openSource = () => {
    const href = data.message.sourceHref;
    if (!href) return;
    const match = SOURCE.exec(href);
    if (match) (match[2].toLowerCase() === 'received' ? navigateToEmailMessage : navigateToContactMessage)(match[1]);
    else openInCrmWeb(href);
  };
  const showClient360 = async () => {
    if (!info.contactId) return;
    const row = await run('Otwieram kartę klienta…', async () => {
      const { data: contact, error } = await supabase.from('contacts')
        .select('id, first_name, last_name, email, phone, mobile, status, last_contact_date').eq('id', info.contactId!).maybeSingle();
      if (error) throw new Error(error.message);
      if (!contact) throw new Error('Nie masz dostępu do karty tego klienta.');
      return contact as NonNullable<Client360Row>;
    });
    if (row) setClient360(row);
  };

  /** „Oferta”: najpierw klient (jak w CRM), potem wybór — konfigurator z katalogu albo pusty szkic z ustaleń. */
  const startOffer = () => {
    if (!hasClient) { setAfterClient('offer'); setOverlay('client'); return; }
    setOverlay('newOffer');
  };
  const offerFromCatalog = () => {
    const guests = Number(data.brief.guestCount);
    navigation.navigate('ShowcaseOffer', {
      inquiry: {
        id: info.id, title: info.titleLabel, organizationId: info.organizationId, organizationName: data.client.organizationName,
        contactId: info.contactId, contactName: data.client.contactName, guestCount: Number.isInteger(guests) && guests > 0 ? guests : null,
      },
    });
  };
  const emptyDraft = async () => {
    const reply = await act('Tworzę szkic oferty…', () => createWorkspaceOffer(info.id, newRequestId()), 'Szkic oferty został utworzony');
    if (reply?.offerId) { setTab('offers'); openInCrmWeb(`/crm/offers/${reply.offerId}`); }
  };
  /** Edytor kalkulacji z kontekstem zapytania (jak w CRM i na Macu); bez prawa zarządzania — tylko podgląd. */
  const openCalculation = (calculationId: string) => {
    const params: InquiryCalculationParams = {
      inquiryId: info.id, calculationId, eventId: info.eventId, readOnly: !canManage,
      context: {
        title: info.titleLabel, sourceLabel: info.sourceLabel, client: { name: data.client.name, email: data.client.email, phone: data.client.phone },
        items: [{ label: 'Termin', value: data.summary.schedule }, { label: 'Miejsce', value: data.summary.location }, { label: 'Zakres', value: data.summary.scope }]
          .filter((item) => item.value.trim()),
        message: (data.message.clean || data.message.full).trim(), sourceHref: data.message.sourceHref,
      },
    };
    navigation.navigate('InquiryCalculation', params);
  };
  /** Nowa kalkulacja otwiera się od razu w edytorze (jak `setActiveCalculationId` w CRM). */
  const createCalculation = async () => {
    const reply = await act('Tworzę kalkulację…', () => createWorkspaceCalculation(info.id), 'Kalkulacja została utworzona');
    if (reply?.calculationId) { setTab('calculations'); openCalculation(reply.calculationId); }
  };
  const startConvert = () => {
    if (!hasClient) { setAfterClient('convert'); setOverlay('client'); return; }
    setOverlay('convert');
  };
  const clientSaved = async () => {
    setOverlay(null);
    notify('Klient powiązany z zapytaniem');
    await load();
    setTabKey((value) => value + 1);
    const next = afterClient;
    setAfterClient(null);
    if (next === 'offer') afterModal(() => setOverlay('newOffer'));
    else if (next === 'convert') afterModal(() => setOverlay('convert'));
  };
  const contactDone = (next: string | null) => act('Zapisuję kontakt…', () => contactInquiry(info.id, next),
    next ? `Kontakt odnotowany — następny: ${formatInquiryFull(next)}` : 'Kontakt odnotowany');
  const showPdf = async (offer: WorkspaceOffer) => {
    const pdf = await run('Otwieram PDF oferty…', () => offerPdfLink(offer.id));
    if (pdf) openPdf(navigation, pdf.url, offer.number || pdf.name);
  };
  const addNote = async () => {
    const body = noteBody.trim();
    if (!body) return;
    const reply = await act('Zapisuję notatkę…', () => addWorkspaceNote(info.id, body, noteKind, noteRequest), 'Notatka została zapisana');
    if (reply) { setNoteBody(''); setNoteRequest(newRequestId()); }
  };

  const moreItems: MenuItem[] = [
    ...(canManage ? [{ key: 'client', label: hasClient ? 'Klient i organizacja…' : 'Dodaj lub powiąż klienta…', icon: 'user-plus' as const }] : []),
    ...(canManage ? [{ key: 'task', label: 'Nowe zadanie', icon: 'check-square' as const }] : []),
    ...(canLead && !info.eventId && !info.acceptedOfferId ? [{ key: 'convert', label: 'Utwórz wydarzenie…', icon: 'star' as const, detail: 'Robocze wydarzenie — sprzedaż pozostaje otwarta' }] : []),
    ...(canLead && info.ownerId && open ? [{ key: 'handoff', label: 'Przekaż / oddaj…', icon: 'share' as const }] : []),
    ...(canLead ? [{ key: 'edit', label: 'Opiekun, wartość i termin działania…', icon: 'sliders' as const }] : []),
    ...(canLead && info.acceptedOfferId ? [{ key: 'reopen', label: 'Otwórz negocjacje ponownie…', icon: 'rotate-ccw' as const }] : []),
    ...(info.eventId ? [{ key: 'event', label: 'Otwórz wydarzenie', icon: 'star' as const }] : []),
    ...(canManage ? [{ key: 'analysis', label: 'Analiza i rozmowa z AI', icon: 'zap' as const }] : []),
    { key: 'crm', label: 'Otwórz w CRM', icon: 'external-link' },
    { key: 'refresh', label: 'Odśwież', icon: 'refresh-cw' },
  ];
  const pickMore = (key: string) => {
    if (key === 'client') { setAfterClient(null); setOverlay('client'); }
    else if (key === 'task') { setTab('tasks'); setCreatingTask(true); }
    else if (key === 'convert') startConvert();
    else if (key === 'handoff') setOverlay('handoff');
    else if (key === 'edit') setEditTarget({ inquiry: info });
    else if (key === 'reopen') setOverlay('reopen');
    else if (key === 'event' && info.eventId) navigateToEvent(info.eventId);
    else if (key === 'analysis') setTab('analysis');
    else if (key === 'crm') void Linking.openURL(inquiryCrmUrl(info.id)).catch(() => undefined);
    else if (key === 'refresh') { setRefreshing(true); void load(); setTabKey((value) => value + 1); }
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Podsumowanie' },
    { id: 'correspondence', label: 'Korespondencja' },
    { id: 'analysis', label: 'Analiza i AI' },
    { id: 'offers', label: `Oferty (${data.offers.length})` },
    { id: 'calculations', label: `Kalkulacje (${data.calculations.length})` },
    { id: 'tasks', label: 'Zadania' },
    { id: 'notes', label: `Notatki (${notes.length})` },
    { id: 'team', label: data.teamCount > 0 ? `Zespół (${data.teamCount + 1})` : 'Zespół' },
    { id: 'history', label: `Historia (${data.activity.length + data.stageHistory.length})` },
  ];

  const header = (
    <View style={styles.header}>
      <BackBar onBack={() => goBack(navigation)} />
      <View style={styles.titleRow}>
        <View style={kit.flex}>
          <View style={styles.titleLine}>
            <Text style={styles.title} selectable numberOfLines={2}>{info.titleLabel}</Text>
            {canManage ? (
              <TouchableOpacity onPress={() => setOverlay('title')} style={styles.iconButton} accessibilityLabel="Edytuj nazwę zapytania">
                <Feather name="edit-2" size={17} color={colors.primary.gold} />
              </TouchableOpacity>
            ) : null}
            <View style={[styles.stagePill, { backgroundColor: shade(0.25) }]}>
              <View style={[kit.dot, { backgroundColor: tone(stage.color) }]} />
              <Text style={[styles.stageText, { color: tone(stage.color) }]}>{stage.label}</Text>
            </View>
          </View>
          <View style={styles.metaLine}>
            <Text style={kit.muted}>
              {[info.sourceLabel, `zapytanie #${info.id.slice(0, 8)}`, info.createdAt ? `utworzone ${formatInquiryFull(info.createdAt)}` : ''].filter(Boolean).join(' · ')}
            </Text>
            {info.typeLabels.map((label) => <Text key={label} style={styles.typeBadge}>{label}</Text>)}
            {info.archived ? <Text style={[styles.typeBadge, { color: colors.status.warning }]}>Zarchiwizowane</Text> : null}
          </View>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actions}>
        {realization ? <ActionButton label="Przygotuj realizację" icon="briefcase" primary onPress={startConvert} /> : null}
        {canManage ? <ActionButton label="Oferta" icon="file-text" primary={!realization} onPress={startOffer} /> : null}
        {canManage ? <ActionButton label="Kalkulacja" icon="percent" onPress={() => void createCalculation()} /> : null}
        {canLead ? <ActionButton label="Etap…" icon="columns" onPress={() => setOverlay('stage')} /> : null}
        {data.client.phone ? <ActionButton label="Zadzwoń" icon="phone" onPress={call} /> : null}
        {data.client.email ? <ActionButton label={canManage ? 'E-mail' : 'Napisz'} icon="mail" onPress={mail} /> : null}
        <ActionButton label="Więcej" icon="more-horizontal" onPress={() => setOverlay('more')} />
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {tabs.map((item) => (
          <TouchableOpacity key={item.id} onPress={() => setTab(item.id)} style={[styles.tab, tab === item.id && styles.tabActive]}
            accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }}>
            <Text style={[styles.tabText, tab === item.id && styles.tabTextActive]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  // MARK: Podsumowanie
  const message = data.message;
  const shownMessage = fullMessage || !message.trimmed ? message.full : message.clean;
  const summaryRow = (label: string, value: string) => (
    <View key={label} style={styles.summaryRow}>
      <Text style={[kit.muted, styles.summaryLabel]}>{label}</Text>
      <Text style={[kit.text, kit.flex]} selectable>{value || '—'}</Text>
    </View>
  );
  const next = info.nextActionAt ? Date.parse(info.nextActionAt) : NaN;
  const overdue = !Number.isNaN(next) && next < Date.now();
  const lostLabel = INQUIRY_LOST_CATEGORIES.find((item) => item.value === info.lostReasonCategory)?.label
    || data.lostCategories.find((item) => item.value === info.lostReasonCategory)?.label || '';

  const messageCard = (
    <Card title="Treść i potrzeby klienta">
      <Text style={shownMessage ? kit.text : kit.muted} selectable>{shownMessage || 'Brak treści zapytania.'}</Text>
      <View style={kit.row}>
        {message.trimmed ? <SmallButton label={fullMessage ? 'Pokaż tylko treść' : 'Pokaż całą wiadomość'} icon="align-left" onPress={() => setFullMessage((value) => !value)} /> : null}
        {message.sourceHref ? <SmallButton label="Wiadomość źródłowa" icon="inbox" onPress={openSource} /> : null}
      </View>
    </Card>
  );
  const briefCard = (
    <Card title="Ustalenia">
      {summaryRow('Termin', data.summary.schedule)}
      {summaryRow('Miejsce', data.summary.location)}
      {summaryRow('Liczba osób', data.summary.guests || 'Nie ustalono')}
      {summaryRow('Zakres', data.summary.scope)}
      {summaryRow('Budżet / wartość', data.summary.budget)}
      {data.summary.guestsHint ? <Text style={kit.warningText}>{data.summary.guestsHint}</Text> : null}
      {canManage ? <GuestsReader key={`guests-${tabKey}`} inquiryId={info.id} onApply={applyGuests} /> : null}
      {data.brief.conversationNotes ? (
        <View style={styles.block}><Text style={kit.fieldLabel}>Notatka z rozmowy</Text><Text style={kit.text} selectable>{data.brief.conversationNotes}</Text></View>
      ) : null}
      {data.brief.questions.length ? (
        <View style={styles.block}>
          <Text style={kit.fieldLabel}>Pytania do klienta</Text>
          {data.brief.questions.map((question, index) => (
            <View key={`${index}-${question.question}`} style={styles.question}>
              <Feather name={question.status === 'answered' ? 'check-circle' : 'help-circle'} size={16} color={question.status === 'answered' ? colors.status.success : colors.text.tertiary} />
              <View style={kit.flex}>
                <Text style={kit.text}>{question.question}</Text>
                {question.answer ? <Text style={kit.muted}>{question.answer}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {canManage ? <View style={kit.row}><SmallButton label="Uzupełnij / edytuj ustalenia" icon="edit-3" onPress={() => setBrief(data.brief)} /></View> : null}
    </Card>
  );
  const clientCard = (
    <Card title="Klient">
      <View style={styles.clientLine}><Feather name="user" size={16} color={colors.primary.gold} /><Text style={[kit.text, kit.flex, styles.strong]} selectable>{data.client.name}</Text></View>
      {data.client.organizationName ? <View style={styles.clientLine}><Feather name="briefcase" size={16} color={colors.text.tertiary} /><Text style={[kit.text, kit.flex]}>{data.client.organizationName}</Text></View> : null}
      {data.client.email ? (
        <View style={kit.between}><Text style={[kit.text, kit.flex]} selectable numberOfLines={1}>{data.client.email}</Text><SmallButton label="Napisz" icon="mail" onPress={mail} /></View>
      ) : null}
      {data.client.phone ? (
        <View style={kit.between}><Text style={[kit.text, kit.flex]} selectable>{data.client.phone}</Text><SmallButton label="Zadzwoń" icon="phone" onPress={call} /></View>
      ) : null}
      {!hasClient ? <Text style={kit.warningText}>Klient nie jest powiązany z bazą — oferta i wydarzenie go wymagają.</Text> : null}
      <View style={kit.row}>
        {info.contactId ? <SmallButton label="Karta klienta 360°" icon="user-check" onPress={() => void showClient360()} /> : null}
        {info.organizationId ? <SmallButton label="Organizacja w CRM" icon="external-link" onPress={() => openInCrmWeb(`/crm/contacts/${info.organizationId}`)} /> : null}
        {canManage ? (
          <SmallButton label={info.contactId ? 'Zmień klienta lub organizację…' : 'Dodaj lub powiąż klienta…'} icon="user-plus" primary={!hasClient}
            onPress={() => { setAfterClient(null); setOverlay('client'); }} />
        ) : null}
      </View>
    </Card>
  );
  const salesCard = (
    <Card title="Prowadzenie sprzedaży">
      {summaryRow('Opiekun', info.ownerName || 'Nieprzypisane')}
      <View style={styles.contactBox}>
        <View style={styles.clientLine}>
          <Feather name={info.lastContactAt ? 'check-circle' : 'phone'} size={16} color={info.lastContactAt ? colors.status.success : colors.text.tertiary} />
          <Text style={[kit.text, info.lastContactAt && { color: colors.status.success }]}>{info.lastContactAt ? 'Kontakt podjęty' : 'Kontakt jeszcze niepodjęty'}</Text>
        </View>
        {info.lastContactAt ? <Text style={kit.muted}>Ostatni kontakt: {formatInquiryFull(info.lastContactAt)}</Text> : null}
        {canManage && open ? (
          <SmallButton label={info.lastContactAt ? 'Odnotuj kontakt — zaplanuj dalej' : 'Kontakt podjęty — zaplanuj dalej'} icon="check" primary onPress={() => setOverlay('contact')} />
        ) : null}
      </View>
      <View style={styles.summaryRow}>
        <Text style={[kit.muted, styles.summaryLabel]}>Następne działanie</Text>
        <Text style={[kit.text, kit.flex, overdue && { color: '#fca5a5' }, !info.nextActionAt && open && { color: colors.status.warning }]}>
          {info.nextActionAt ? formatInquiryFull(info.nextActionAt) : open ? 'Brak — zaplanuj' : '—'}
        </Text>
      </View>
      {summaryRow('Prawdopodobieństwo', `${info.probability}%`)}
      {summaryRow('Szacowana wartość', info.estimatedValue != null ? money(info.estimatedValue) : '')}
      {info.stage === 'lost' ? summaryRow('Powód utraty', [lostLabel, info.lostReason].filter(Boolean).join(' — ')) : null}
      <View style={kit.row}>
        {canLead ? <SmallButton label="Opiekun, wartość i termin…" icon="sliders" onPress={() => setEditTarget({ inquiry: info })} /> : null}
        {canLead && info.ownerId && open ? <SmallButton label="Przekaż / oddaj…" icon="share" onPress={() => setOverlay('handoff')} /> : null}
      </View>
    </Card>
  );
  const overview = wide ? (
    <View style={styles.columns}>
      <View style={[kit.flex, kit.gapSm]}>{messageCard}{briefCard}</View>
      <View style={[styles.side, kit.gapSm]}>{clientCard}{salesCard}</View>
    </View>
  ) : (
    <View style={kit.gapSm}>{clientCard}{salesCard}{messageCard}{briefCard}</View>
  );

  // MARK: Oferty
  const offers = (
    <View style={kit.gapSm}>
      <View style={kit.between}>
        <Text style={[kit.muted, kit.flex]}>Każda oferta ma własny zakres i wycenę. Możesz skopiować wariant i zmienić jego treść. Akceptacja zapisuje wybór klienta.</Text>
        {canManage ? <SmallButton label="Nowa oferta" icon="plus" primary onPress={startOffer} /> : null}
      </View>
      {!data.offers.length ? <Text style={kit.muted}>Brak ofert dla tego zapytania.</Text> : null}
      {data.offers.map((offer) => {
        const selected = info.acceptedOfferId === offer.id;
        const packages = offer.packageMode ? offer.packages.filter((item) => !offer.acceptedPackageId || item.id === offer.acceptedPackageId) : [];
        return (
          <View key={offer.id} style={[styles.offer, selected && styles.offerSelected]}>
            <View style={kit.between}>
              <Text style={[kit.text, styles.strong, kit.flex]} numberOfLines={2}>{[offer.number, offer.title].filter(Boolean).join(' — ')}</Text>
              {selected ? <View style={styles.clientLine}><Feather name="award" size={15} color={colors.status.success} /><Text style={[kit.muted, { color: colors.status.success }]}>Wybrana przez klienta</Text></View> : null}
            </View>
            <View style={kit.row}>
              <Text style={styles.typeBadge}>{offer.statusLabel}</Text>
              {offer.total ? <Text style={kit.text}>{money(offer.total)}</Text> : null}
              {offer.guestCount ? <Text style={kit.muted}>{offer.guestCount} osób</Text> : null}
              {offer.validUntil ? <Text style={kit.muted}>ważna do {new Date(offer.validUntil).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' })}</Text> : null}
            </View>
            {packages.length ? <Text style={kit.muted}>{packages.map((item) => `${item.name}: ${money(item.priceNet)} netto`).join(' · ')}</Text> : null}
            <View style={kit.row}>
              <SmallButton label="PDF" icon="file" onPress={() => void showPdf(offer)} />
              {canManage ? (
                <SmallButton label="Duplikuj" icon="copy" onPress={() => void act('Kopiuję ofertę…', () => duplicateWorkspaceOffer(info.id, offer.id), 'Utworzono kopię oferty')} />
              ) : null}
              {canManage && !offer.eventId && !selected && !info.acceptedOfferId ? (
                <SmallButton label="Zapisz akceptację klienta…" icon="check-circle" onPress={() => setAccepting(offer)} />
              ) : null}
              <SmallButton label="Edytuj w CRM" icon="external-link" onPress={() => void Linking.openURL(crmUrl(`/crm/offers/${offer.id}`)).catch(() => undefined)} />
            </View>
          </View>
        );
      })}
      {info.acceptedOfferId ? (
        <Text style={kit.muted}>Aby zmienić zaakceptowaną ofertę, najpierw otwórz negocjacje ponownie, podając powód (Więcej → Otwórz negocjacje ponownie).</Text>
      ) : null}
    </View>
  );

  // MARK: Notatki i historia
  const entry = (key: string, title: string, body: string, at: string | null) => (
    <View key={key} style={styles.entry}>
      <Text style={kit.muted}>{[title, at ? formatInquiryFull(at) : ''].filter(Boolean).join(' · ')}</Text>
      {body ? <Text style={kit.text} selectable>{body}</Text> : null}
    </View>
  );
  const notesTab = (
    <View style={kit.gapSm}>
      {canLead ? (
        <View style={styles.composer}>
          <View style={kit.wrap}>
            {NOTE_KINDS.map((kind) => (
              <TouchableOpacity key={kind.id} onPress={() => setNoteKind(kind.id)} style={[kit.chip, noteKind === kind.id && kit.chipActive]}
                accessibilityRole="radio" accessibilityState={{ checked: noteKind === kind.id }}>
                <Text style={[kit.chipText, noteKind === kind.id && kit.chipTextActive]}>{kind.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput value={noteBody} onChangeText={setNoteBody} multiline style={[kit.input, kit.multiline]} placeholder="Treść wpisu" placeholderTextColor={ink(0.35)} maxLength={10000} />
          <View style={kit.between}>
            {data.client.phone ? <SmallButton label={`Zadzwoń: ${data.client.phone}`} icon="phone" onPress={call} /> : <View />}
            <SmallButton label="Dodaj wpis" icon="plus" primary disabled={!noteBody.trim()} onPress={() => void addNote()} />
          </View>
        </View>
      ) : null}
      {!notes.length ? <Text style={kit.muted}>Brak notatek do tego zapytania.</Text> : null}
      {notes.map((note) => entry(note.id, note.kindLabel, note.body, note.at))}
    </View>
  );
  const historyTab = (
    <View style={kit.gapSm}>
      {data.stageHistory.length ? <Text style={styles.sectionTitle}>Etapy</Text> : null}
      {data.stageHistory.map((change) => entry(change.id, `${change.from} → ${change.to}${change.by ? ` · ${change.by}` : ''}`, change.reason, change.at))}
      <Text style={styles.sectionTitle}>Aktywność</Text>
      {!data.activity.length ? <Text style={kit.muted}>Brak wpisów.</Text> : null}
      {data.activity.map((item) => entry(item.id, item.kindLabel, item.body, item.at))}
    </View>
  );

  const content: Record<Tab, ReactNode> = {
    overview,
    correspondence: <CorrespondenceTab key={`mail-${tabKey}`} inquiryId={info.id} canManage={canManage} canCompose={Boolean(data.client.email)} run={run}
      onCompose={() => setOverlay('email')} onAnalysis={() => setTab('analysis')} />,
    analysis: <AnalysisTab key={`ai-${tabKey}`} inquiryId={info.id} wide={wide} run={run} notify={notify} onChanged={() => void load()} />,
    offers,
    calculations: <CalculationsList inquiryId={info.id} calculations={data.calculations} canManage={canManage} run={run}
      onCreate={() => void createCalculation()} onOpen={openCalculation} onChanged={() => void load()} onPdf={(url, title) => openPdf(navigation, url, title)} />,
    tasks: <TasksTab key={`tasks-${tabKey}`} inquiryId={info.id} run={run} creating={creatingTask} setCreating={setCreatingTask}
      onOpenTask={(taskId) => navigation.navigate('InquiryTask', { taskId })} />,
    notes: notesTab,
    team: <TeamTab key={`team-${tabKey}`} inquiryId={info.id} run={run} onChanged={() => void load()} />,
    history: historyTab,
  };

  return (
    <NoticeScope value={scope}>
    <View style={styles.container}>
      {header}
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); setTabKey((value) => value + 1); }} tintColor={colors.primary.gold} />}>
        {content[tab]}
      </ScrollView>

      <TitleSheet visible={overlay === 'title'} title={info.title} onClose={() => setOverlay(null)}
        onSave={async (title) => Boolean(await act('Zapisuję nazwę…', () => saveWorkspaceTitle(info.id, title, info.title), 'Nazwa zapytania została zapisana'))} />
      <BriefSheet brief={brief} subtitle={info.titleLabel} onClose={() => setBrief(null)}
        onSave={async (value) => Boolean(await act('Zapisuję ustalenia…', () => saveWorkspaceBrief(info.id, value, info.briefRevision), 'Ustalenia i notatka zostały zapisane'))} />
      <StageSheet data={data} visible={overlay === 'stage'} onClose={() => setOverlay(null)}
        onSave={async (value, category, reason) => Boolean(await act('Zmieniam etap…', () => changeWorkspaceStage(info.id, value, info.stage, category, reason), 'Etap zapytania został zmieniony'))} />
      <HandoffSheet inquiryId={info.id} title={info.titleLabel} visible={overlay === 'handoff'} onClose={() => setOverlay(null)}
        onSave={async (owner) => Boolean(await act('Zmieniam opiekuna…', () => handOffWorkspace(info.id, owner),
          owner ? 'Zapytanie przekazano nowemu opiekunowi' : 'Zapytanie wróciło do wspólnej puli'))} />
      <ReasonSheet visible={overlay === 'reopen'} title="Otwórz negocjacje ponownie" prompt="Powód ponownego otwarcia negocjacji" action="Otwórz negocjacje"
        onClose={() => setOverlay(null)} onSave={async (reason) => Boolean(await act('Otwieram negocjacje…', () => reopenWorkspace(info.id, reason), 'Negocjacje otwarte ponownie'))} />
      <AcceptOfferSheet offer={accepting} onClose={() => setAccepting(null)}
        onSave={async (offer, packageId, note) => Boolean(await act('Zapisuję akceptację…', () => acceptWorkspaceOffer(info.id, offer.id, note, packageId), 'Zapisano akceptację klienta'))} />
      <ClientSheet inquiryId={info.id} visible={overlay === 'client'} onClose={() => { setOverlay(null); setAfterClient(null); }} onSaved={() => void clientSaved()} />
      <ConvertSheet inquiryId={info.id} visible={overlay === 'convert'} onClose={() => setOverlay(null)}
        onSave={async (form, prepare) => {
          const reply = await act(prepare ? 'Przygotowuję realizację…' : 'Tworzę wydarzenie…', () => convertWorkspace(info.id, form),
            prepare ? 'Realizacja przygotowana' : 'Wydarzenie zostało utworzone');
          if (reply?.eventId) afterModal(() => navigateToEvent(reply.eventId));
          return Boolean(reply);
        }} />
      <InquiryEditSheet target={editTarget} access={{ canAssign: data.permissions.canAssign }} onClose={() => setEditTarget(null)}
        onSave={async (_inquiry, value) => {
          const reply = await act('Zapisuję zapytanie…', () => updateInquiry(info.id, value), 'Zapytanie zostało zaktualizowane');
          if (reply) setEditTarget(null);
        }} />
      <InquiryContactSheet inquiry={scheduleTarget} title="Kontakt odnotowany — następny termin" onClose={() => setScheduleTarget(null)}
        onConfirm={async (_inquiry, value) => { if (await contactDone(value)) setScheduleTarget(null); }} />
      <ActionMenu visible={overlay === 'contact'} title={info.lastContactAt ? 'Odnotuj kontakt' : 'Kontakt podjęty'} subtitle="Zaplanuj następne działanie"
        onClose={() => setOverlay(null)}
        items={[
          { key: '1', label: 'Następny kontakt jutro o 9:00', icon: 'sunrise' },
          { key: '3', label: 'Następny kontakt za 3 dni', icon: 'calendar' },
          { key: '7', label: 'Następny kontakt za tydzień', icon: 'calendar' },
          { key: 'pick', label: 'Wybierz termin…', icon: 'clock' },
          { key: 'none', label: 'Bez kolejnego terminu', icon: 'slash' },
        ]}
        onPick={(key) => {
          if (key === 'pick') setScheduleTarget(info);
          else void contactDone(key === 'none' ? null : plannedAt(Number(key)));
        }} />
      <ActionMenu visible={overlay === 'newOffer'} title="Nowa oferta" subtitle={`Klient: ${data.client.organizationName || data.client.name}`} onClose={() => setOverlay(null)}
        items={[
          // Oferta z konfiguratora dopina się tylko do otwartego zapytania (jak oferta ze spotkania).
          ...(open ? [{ key: 'catalog', label: 'Oferta z katalogu i konfiguratora', icon: 'grid' as const,
            detail: 'Pozycje, warianty, scena i ekran LED, rabaty — wycena i PDF od razu na tablecie. Etap „Nowe” lub „Kontakt” zmieni się na „Zakwalifikowane”.' }] : []),
          { key: 'draft', label: 'Pusty szkic oferty', icon: 'file-plus', detail: 'Szkic z ustaleń zapytania (jak „Nowa oferta” w CRM) — pozycje uzupełnisz w CRM.' },
        ]}
        onPick={(key) => { if (key === 'catalog') offerFromCatalog(); else void emptyDraft(); }} />
      <EmailSheet inquiryId={info.id} visible={overlay === 'email'} onClose={() => setOverlay(null)}
        onSent={(scheduledAt) => {
          setOverlay(null);
          notify(scheduledAt ? `Wiadomość zostanie wysłana ${formatInquiryFull(scheduledAt)}` : 'Wiadomość została wysłana i zapisana jako kontakt');
          void load();
          setTabKey((value) => value + 1);
        }} />
      <ActionMenu visible={overlay === 'more'} title="Zapytanie" subtitle={info.titleLabel} items={moreItems} onClose={() => setOverlay(null)} onPick={pickMore} />
      <Client360Modal client={client360} visible={Boolean(client360)} onClose={() => setClient360(null)}
        onCall={(selected) => {
          const phone = selected.mobile || selected.phone;
          if (phone) void startCall({ phoneNumber: phone, displayName: `${selected.first_name} ${selected.last_name}`.trim() || phone, contactId: selected.id, inquiryId: info.id });
        }} />
      <CallOutcomeModal call={pendingCall} visible={showOutcome} onClose={closeOutcome} onSaved={() => void load()} />
      {notice}
    </View>
    </NoticeScope>
  );
}

const goBack = (navigation: { canGoBack: () => boolean; goBack: () => void; navigate: (name: string) => void }) => {
  if (navigation.canGoBack()) navigation.goBack();
  else navigation.navigate('InquiriesList');
};

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <TouchableOpacity onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Wróć do lejka zapytań">
      <Feather name="chevron-left" size={20} color={colors.primary.gold} />
      <Text style={kit.secondaryText}>Lejek zapytań</Text>
    </TouchableOpacity>
  );
}

function ActionButton({ label, icon, onPress, primary = false }: { label: string; icon: React.ComponentProps<typeof Feather>['name']; onPress: () => void; primary?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} style={primary ? kit.primary : kit.secondary} accessibilityRole="button">
      <Feather name={icon} size={17} color={primary ? colors.background.primary : colors.primary.gold} />
      <Text style={primary ? kit.primaryText : kit.secondaryText}>{label}</Text>
    </TouchableOpacity>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  header: { gap: spacing.xs, paddingTop: spacing.xs, borderBottomWidth: 1, borderBottomColor: glow(0.08) },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.md },
  titleLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.xxl, fontWeight: typography.fontWeights.semibold, flexShrink: 1 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  stagePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: borderRadius.full },
  stageText: { fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.medium },
  metaLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  typeBadge: {
    color: colors.text.secondary, fontSize: typography.fontSizes.xs, paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.full,
    backgroundColor: shade(0.25), overflow: 'hidden',
  },
  actions: { gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  tabs: { gap: spacing.xs, paddingHorizontal: spacing.md },
  tab: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary.gold },
  tabText: { color: colors.text.secondary, fontSize: typography.fontSizes.md },
  tabTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  body: { padding: spacing.md, paddingBottom: spacing.xxxl, gap: spacing.sm },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  side: { width: 380 },
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: glow(0.1), backgroundColor: glow(0.03) },
  cardTitle: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold },
  sectionTitle: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold, marginTop: spacing.xs },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  summaryLabel: { width: 150 },
  strong: { fontWeight: typography.fontWeights.semibold },
  block: { gap: 4 },
  question: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  clientLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  contactBox: { gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: glow(0.04) },
  offer: { gap: spacing.xs, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: glow(0.04), borderWidth: 1, borderColor: glow(0.06) },
  offerSelected: { borderColor: colors.status.success },
  composer: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: glow(0.04) },
  entry: { gap: 4, padding: spacing.sm + 2, borderRadius: borderRadius.md, backgroundColor: glow(0.04) },
});
