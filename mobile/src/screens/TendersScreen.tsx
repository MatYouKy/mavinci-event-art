import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Modal, Linking, ScrollView, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import PermissionGate from '../components/PermissionGate';
import { useNotice } from '../components/Inquiries/InquiryKit';
import { canView } from '../lib/permissions';
import { navigateToInquiry } from '../navigation/navigationRef';
import TenderFilterConfigSheet from '../components/Tenders/TenderFilterConfigSheet';
import { colors, spacing, typography, borderRadius, withAlpha } from '../theme';

/*
 * Przetargi — jak /crm/tenders i Przetargi na Macu: zakres (Aktywne, Moje, Do 7 dni, Obserwowane, Dopasowane), status,
 * „Także przeszłe i ukryte”, wyszukiwanie; szczegóły z oceną dopasowania, opiekunem („Przypisz do mnie” / „Zwolnij” —
 * assign_tender), zapytaniem (create_inquiry_from_tender), obserwowaniem, statusem i notatkami, oceną manualną i ukrywaniem.
 * Domyślnie wszystkie aktywne przetargi (otwarty termin, nieukryte, niezakończone). Dostęp: tenders_view (RLS).
 * „Konfiguracja” — konfiguracja filtrów i przeliczenie ocen (`TenderFilterConfigSheet`, jak /crm/tenders/config i Mac).
 */

const LIST_FIELDS = 'id, title, contracting_authority, submission_deadline, publication_date, estimated_value, currency, status, assigned_to, inquiry_id, source_url, location, is_matched, is_watched, is_hidden, manual_relevance, relevance_score';
/** Przeszłe i ukryte — najwyżej tyle najnowszych (wyszukiwanie przeszukuje wszystkie). */
const ARCHIVE_LIMIT = 300;

type Tender = {
  id: string;
  title: string;
  contracting_authority: string | null;
  submission_deadline: string | null;
  publication_date: string | null;
  estimated_value: number | null;
  currency: string | null;
  status: string;
  assigned_to: string | null;
  inquiry_id: string | null;
  source_url: string | null;
  location: string | null;
  is_matched: boolean | null;
  is_watched: boolean | null;
  is_hidden: boolean | null;
  manual_relevance: string | null;
  relevance_score: number | null;
};
type TenderDetail = Tender & { description: string | null; cpv_codes: string[] | null; notes: string | null };
type Scope = 'active' | 'mine' | 'soon' | 'watched' | 'matched';

const STATUS_OPTIONS: Array<[string, string]> = [
  ['new', 'Nowy'], ['reviewing', 'W analizie'], ['interested', 'Zainteresowany'], ['preparing', 'Przygotowywanie oferty'],
  ['submitted', 'Oferta złożona'], ['won', 'Wygrana'], ['lost', 'Przegrana'], ['ignored', 'Zignorowany'],
];
const STATUS_LABELS: Record<string, string> = Object.fromEntries(STATUS_OPTIONS);
const CLOSED_STATUSES = ['won', 'lost', 'ignored', 'cancelled', 'archived'];
const SCOPES: Array<[Scope, string]> = [['active', 'Aktywne'], ['mine', 'Moje'], ['soon', 'Do 7 dni'], ['watched', 'Obserwowane'], ['matched', 'Dopasowane']];

const deadlineOf = (tender: Tender) => (tender.submission_deadline ? Date.parse(tender.submission_deadline) : null);
const isPast = (tender: Tender, now: number) => { const deadline = deadlineOf(tender); return deadline !== null && deadline <= now; };
/** Przeszły, ukryty albo zakończony (jak „archiwalne” na Macu). */
const isArchived = (tender: Tender, now: number) => tender.is_hidden === true || CLOSED_STATUSES.includes(tender.status) || isPast(tender, now);
const formatDate = (value: string | null, withTime = true) => (value
  ? new Date(value).toLocaleString('pl-PL', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' })
  : '—');
/** Pozostały czas jak na Macu: „3 dni 4 godz.”, „5 godz. 10 min”, „Termin minął”, „Bez terminu”. */
const remaining = (value: string | null, now: number) => {
  if (!value) return 'Bez terminu';
  const seconds = (Date.parse(value) - now) / 1000;
  if (seconds <= 0) return 'Termin minął';
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days} dni ${hours} godz.`;
  if (hours > 0) return `${hours} godz. ${minutes % 60} min`;
  return `${minutes} min`;
};
const formatValue = (tender: Tender) => (tender.estimated_value && tender.estimated_value > 0
  ? `${tender.estimated_value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${tender.currency || 'PLN'}`
  : null);
const scoreColor = (score: number) => (score >= 70 ? colors.status.success : score >= 40 ? colors.status.warning : colors.text.tertiary);
/** Wartość filtra PostgREST w cudzysłowie (przecinki i nawiasy w wyszukiwanej frazie). */
const quoted = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const matches = (tender: Tender, term: string) => [tender.title, tender.contracting_authority, tender.location]
  .some((field) => (field || '').toLocaleLowerCase('pl-PL').includes(term));

function Score({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <Text style={styles.meta}>Brak oceny</Text>;
  const score = Math.max(0, Math.min(100, value));
  return (
    <View style={styles.score}>
      <Text style={[styles.scoreText, { color: scoreColor(score) }]}>{Math.round(score)}/100</Text>
      <View style={styles.scoreTrack}><View style={[styles.scoreFill, { width: `${score}%`, backgroundColor: scoreColor(score) }]} /></View>
    </View>
  );
}

function TendersContent() {
  const route = useRoute<any>();
  const { employee } = useAuth();
  const notice = useNotice();
  const canInquire = canView(employee, 'inquiries');
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [scope, setScope] = useState<Scope>('active');
  const [status, setStatus] = useState('');
  const [archive, setArchive] = useState(false);
  const [search, setSearch] = useState('');
  const [serverTerm, setServerTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [configOpen, setConfigOpen] = useState(false);
  const request = useRef(0);

  // Przeszłe i ukryte: wyszukiwanie w bazie (po chwili od wpisania), aktywne — na liście w telefonie.
  useEffect(() => {
    const term = archive ? search.trim() : '';
    const timer = setTimeout(() => setServerTerm(term.length >= 2 ? term : ''), 400);
    return () => clearTimeout(timer);
  }, [archive, search]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    const id = ++request.current;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    let query = supabase.from('tenders').select(LIST_FIELDS);
    if (archive) {
      if (serverTerm) query = query.or(['title', 'contracting_authority', 'location'].map((column) => `${column}.ilike.${quoted(`%${serverTerm}%`)}`).join(','));
      query = query.order('submission_deadline', { ascending: false, nullsFirst: false }).limit(ARCHIVE_LIMIT);
    } else {
      query = query
        .not('is_hidden', 'is', true)
        .or(`submission_deadline.gt.${new Date().toISOString()},submission_deadline.is.null`)
        .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
        .order('submission_deadline', { ascending: true, nullsFirst: false })
        .limit(1000);
    }
    const { data, error: loadError } = await query;
    if (id !== request.current) return;
    if (loadError) setError('Nie udało się wczytać przetargów. Pociągnij w dół, aby spróbować ponownie.');
    else { setTenders((data || []) as Tender[]); setError(null); }
    setNow(Date.now());
    setLoading(false);
    setRefreshing(false);
  }, [archive, serverTerm]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pl-PL');
    return tenders.filter((tender) => {
      if (!archive && isArchived(tender, now)) return false;
      if (status && tender.status !== status) return false;
      if (scope === 'mine' && tender.assigned_to !== employee?.id) return false;
      if (scope === 'soon') { const deadline = deadlineOf(tender); if (deadline === null || deadline <= now || deadline - now > 7 * 86_400_000) return false; }
      if (scope === 'watched' && tender.is_watched !== true) return false;
      if (scope === 'matched' && tender.is_matched !== true && tender.manual_relevance !== 'relevant') return false;
      return !term || matches(tender, term);
    }).sort((a, b) => {
      // Najpierw otwarte terminy (najbliższe na górze), potem minione (najnowsze na górze); bez terminu — na końcu grupy.
      const aOpen = !isPast(a, now);
      const bOpen = !isPast(b, now);
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      const ad = deadlineOf(a);
      const bd = deadlineOf(b);
      if (ad !== bd) {
        if (ad === null) return 1;
        if (bd === null) return -1;
        return aOpen ? ad - bd : bd - ad;
      }
      return (b.relevance_score ?? 0) - (a.relevance_score ?? 0);
    });
  }, [tenders, archive, status, scope, search, now, employee?.id]);

  // MARK: Szczegóły

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TenderDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('');
  const [notes, setNotes] = useState('');
  const [editStatus, setEditStatus] = useState('new');
  const lastDetail = useRef<TenderDetail | null>(null);

  const fetchDetail = useCallback(async (id: string) => {
    const { data, error: fetchError } = await supabase.from('tenders').select('*').eq('id', id).maybeSingle();
    if (fetchError || !data) { setDetailError('Nie udało się wczytać przetargu.'); return null; }
    setDetail(data as TenderDetail);
    setDetailError(null);
    return data as TenderDetail;
  }, []);

  const patchList = (row: Tender) => setTenders((list) => list.map((item) => (item.id === row.id ? { ...item, ...row } : item)));

  useEffect(() => {
    if (!detailId) { setDetail(null); setDetailError(null); return; }
    setDetail(null);
    void fetchDetail(detailId);
  }, [detailId, fetchDetail]);

  // Pola edycji — z wczytanego przetargu; po odświeżeniu zostają zmiany jeszcze niezapisane.
  useEffect(() => {
    const previous = lastDetail.current;
    lastDetail.current = detail;
    if (!detail) return;
    if (!previous || previous.id !== detail.id) {
      setNotes(detail.notes ?? '');
      setEditStatus(detail.status);
      return;
    }
    setNotes((value) => (value === (previous.notes ?? '') ? detail.notes ?? '' : value));
    setEditStatus((value) => (value === previous.status ? detail.status : value));
  }, [detail]);

  useEffect(() => {
    setAssignee('');
    const owner = detail?.assigned_to;
    if (!owner || owner === employee?.id) return;
    let cancelled = false;
    void supabase.from('employees').select('name, surname').eq('id', owner).maybeSingle().then(({ data }) => {
      if (!cancelled && data) setAssignee([data.name, data.surname].filter(Boolean).join(' '));
    });
    return () => { cancelled = true; };
  }, [detail?.assigned_to, employee?.id]);

  // Otwarcie z powiadomienia: /crm/tenders?tender=<id> (także przetarg spoza listy — przeszły lub ukryty).
  const requestedId = route.params?.tenderId as string | undefined;
  useEffect(() => {
    if (requestedId) setDetailId(requestedId);
  }, [requestedId, route.params?.requestId]);

  const update = async (values: Partial<TenderDetail>, label: string, success: string) => {
    if (!detail) return;
    const reply = await notice.run(label, async () => {
      const { data, error: saveError } = await supabase.from('tenders').update(values).eq('id', detail.id).select('*').maybeSingle();
      if (saveError) throw new Error(saveError.message || 'Nie udało się zapisać przetargu.');
      if (!data) throw new Error('Nie udało się zapisać przetargu — brak dostępu.');
      return data as TenderDetail;
    }, success);
    if (reply) { setDetail(reply); patchList(reply); }
  };

  const assign = async (release: boolean) => {
    if (!detail || !employee?.id) return;
    const id = detail.id;
    const done = await notice.run(release ? 'Zwalniam przetarg…' : 'Przypisuję przetarg…', async () => {
      const { error: assignError } = await supabase.rpc('assign_tender', { p_tender_id: id, p_employee_id: release ? null : employee.id });
      if (assignError) throw new Error(assignError.message || 'Nie udało się zmienić opiekuna przetargu.');
      return true;
    }, release ? 'Przetarg zwolniony.' : 'Przetarg przypisany do Ciebie.');
    if (done) { const row = await fetchDetail(id); if (row) patchList(row); }
  };

  const createInquiry = async () => {
    if (!detail) return;
    const id = detail.id;
    const inquiryId = await notice.run('Tworzę zapytanie…', async () => {
      const { data, error: createError } = await supabase.rpc('create_inquiry_from_tender', { p_tender_id: id });
      if (createError || !data) throw new Error(createError?.message || 'Nie udało się utworzyć zapytania.');
      return data as string;
    });
    if (!inquiryId) return;
    setDetailId(null);
    void load(true);
    navigateToInquiry(inquiryId);
  };

  const renderItem = ({ item }: { item: Tender }) => {
    const deadline = deadlineOf(item);
    const urgent = deadline !== null && deadline > now && deadline - now <= 172_800_000;
    const archived = isArchived(item, now);
    return (
      <TouchableOpacity style={[styles.row, archived && styles.rowArchived]} onPress={() => setDetailId(item.id)} activeOpacity={0.7}>
        <View style={styles.rowHeader}>
          <Text style={[styles.deadline, urgent && styles.urgent]}>
            {item.submission_deadline ? `${formatDate(item.submission_deadline)} · ${remaining(item.submission_deadline, now)}` : 'Bez terminu'}
          </Text>
          <Text style={styles.status}>{STATUS_LABELS[item.status] || 'Inny status'}</Text>
        </View>
        <View style={styles.titleRow}>
          {item.is_watched ? <Feather name="star" size={14} color={colors.status.warning} style={styles.star} /> : null}
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        </View>
        {!!item.contracting_authority && <Text style={styles.meta} numberOfLines={1}>{item.contracting_authority}</Text>}
        <View style={styles.badges}>
          <Score value={item.relevance_score} />
          {item.assigned_to === employee?.id && <Text style={styles.badge}>Mój</Text>}
          {!!item.inquiry_id && <Text style={styles.badge}>Zapytanie</Text>}
          {item.is_hidden ? <Text style={styles.badge}>Ukryty</Text> : null}
          {!!item.location && <Text style={styles.meta} numberOfLines={1}>{item.location}</Text>}
          {!!formatValue(item) && <Text style={styles.meta}>{formatValue(item)}</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  const empty = scope === 'mine'
    ? 'Nie masz przypisanych przetargów. Przypisz się w szczegółach przetargu, aby dostawać przypomnienia o terminie.'
    : archive ? 'Brak przetargów dla wybranych filtrów.' : 'Brak aktywnych przetargów dla wybranych filtrów. Zaznacz „Także przeszłe i ukryte”, aby zobaczyć wcześniejsze.';
  const deadlinePassed = detail ? isPast(detail, Date.now()) : false;
  const mine = !!detail && detail.assigned_to === employee?.id;

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        <View style={styles.searchBox}>
          <Feather name="search" size={16} color={colors.text.tertiary} />
          <TextInput style={styles.search} value={search} onChangeText={setSearch} placeholder="Tytuł, zamawiający lub miejscowość"
            placeholderTextColor={colors.text.tertiary} returnKeyType="search" autoCorrect={false} clearButtonMode="while-editing" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {SCOPES.map(([value, label]) => (
            <TouchableOpacity key={value} onPress={() => setScope(value)} style={[styles.chip, scope === value && styles.chipActive]}
              accessibilityRole="button" accessibilityState={{ selected: scope === value }}>
              <Text style={[styles.chipText, scope === value && styles.chipTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <TouchableOpacity onPress={() => setConfigOpen(true)} style={styles.chip} accessibilityRole="button"
            accessibilityLabel="Konfiguracja filtrów przetargów">
            <Feather name="sliders" size={13} color={colors.text.secondary} />
            <Text style={styles.chipText}>Konfiguracja</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setArchive((value) => !value)} style={[styles.chip, archive && styles.chipActive]}
            accessibilityRole="checkbox" accessibilityState={{ checked: archive }}>
            <Feather name={archive ? 'check-square' : 'square'} size={13} color={archive ? colors.primary.gold : colors.text.secondary} />
            <Text style={[styles.chipText, archive && styles.chipTextActive]}>Także przeszłe i ukryte</Text>
          </TouchableOpacity>
          {[['', 'Wszystkie statusy'] as [string, string], ...STATUS_OPTIONS].map(([value, label]) => (
            <TouchableOpacity key={value || 'all'} onPress={() => setStatus(value)} style={[styles.chip, status === value && styles.chipActive]}
              accessibilityRole="button" accessibilityState={{ selected: status === value }}>
              <Text style={[styles.chipText, status === value && styles.chipTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={styles.count}>
          {loading ? 'Wczytywanie…' : `${visible.length} ${visible.length === 1 ? 'pozycja' : visible.length % 10 >= 2 && visible.length % 10 <= 4 && (visible.length % 100 < 12 || visible.length % 100 > 14) ? 'pozycje' : 'pozycji'}`}
          {archive && !serverTerm && tenders.length >= ARCHIVE_LIMIT ? ` · ${ARCHIVE_LIMIT} ostatnich — wpisz frazę, aby przeszukać wszystkie` : ''}
        </Text>
      </View>
      {loading && !refreshing && tenders.length === 0 ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.gold} /></View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary.gold} />}
          contentContainerStyle={visible.length === 0 ? styles.emptyContent : styles.listContent}
          ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="briefcase" size={44} color={colors.text.tertiary} />
              <Text style={[styles.meta, styles.emptyText]}>{empty}</Text>
            </View>
          }
        />
      )}

      <Modal visible={!!detailId} transparent animationType="slide" onRequestClose={() => setDetailId(null)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetHeading}>Szczegóły przetargu</Text>
              <TouchableOpacity onPress={() => setDetailId(null)} style={styles.closeButton} accessibilityLabel="Zamknij szczegóły przetargu">
                <Feather name="x" size={20} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>
            {!detail ? (
              detailError ? <Text style={styles.error}>{detailError}</Text> : <ActivityIndicator style={styles.sheetLoader} color={colors.primary.gold} />
            ) : (
              <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
                <Text selectable style={styles.sheetTitle}>{detail.title}</Text>
                <Score value={detail.relevance_score} />
                <Text style={styles.meta}>Stan: {STATUS_LABELS[detail.status] || 'Inny status'}</Text>
                <Field label="Zamawiający" value={detail.contracting_authority} />
                <Field label="Lokalizacja" value={detail.location} />
                <Field label="Data publikacji" value={formatDate(detail.publication_date, false)} />
                <Field label="Termin składania ofert" value={formatDate(detail.submission_deadline)} />
                <Text style={[styles.remaining, deadlinePassed && styles.remainingPast]}>{remaining(detail.submission_deadline, now)}</Text>
                {!!formatValue(detail) && <Field label="Szacowana wartość" value={formatValue(detail)} />}
                {!!detail.cpv_codes?.length && <Field label="Kody CPV" value={detail.cpv_codes.join(', ')} />}
                {!!detail.description && <Field label="Opis" value={detail.description} />}

                <View style={styles.box}>
                  <Text style={styles.fieldLabel}>Opiekun przetargu</Text>
                  <Text style={styles.fieldValue}>
                    {!detail.assigned_to ? 'Brak — przypisz się, aby dostawać przypomnienia o terminie' : mine ? 'Ty' : assignee || 'Przypisany pracownik'}
                  </Text>
                  <View style={styles.buttons}>
                    <TouchableOpacity style={mine ? styles.secondary : styles.primary} onPress={() => void assign(mine)}>
                      <Feather name={mine ? 'user-minus' : 'user-check'} size={16} color={mine ? colors.primary.gold : colors.background.primary} />
                      <Text style={mine ? styles.secondaryText : styles.primaryText}>{mine ? 'Zwolnij' : 'Przypisz do mnie'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.secondary}
                      onPress={() => void update({ is_watched: !detail.is_watched }, 'Zapisuję…', detail.is_watched ? 'Przestano obserwować przetarg.' : 'Obserwujesz przetarg.')}>
                      <Feather name="star" size={16} color={detail.is_watched ? colors.status.warning : colors.primary.gold} />
                      <Text style={styles.secondaryText}>{detail.is_watched ? 'Obserwowany' : 'Obserwuj'}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.hint}>
                    {detail.inquiry_id
                      ? 'Przetarg prowadzisz w zapytaniu. Status przetargu aktualizuje się z etapu zapytania.'
                      : 'Zapytanie przejmie zamawiającego, termin składania, wartość i opis. Dalej: kalkulacja i oferta w zapytaniu.'}
                  </Text>
                  {detail.inquiry_id ? (
                    <TouchableOpacity style={[styles.primary, !canInquire && styles.disabled]} disabled={!canInquire}
                      onPress={() => { const id = detail.inquiry_id!; setDetailId(null); navigateToInquiry(id); }}>
                      <Feather name="phone-call" size={16} color={colors.background.primary} />
                      <Text style={styles.primaryText}>Otwórz zapytanie</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={[styles.primary, (deadlinePassed || !canInquire) && styles.disabled]} disabled={deadlinePassed || !canInquire}
                      onPress={() => void createInquiry()}>
                      <Feather name="plus" size={16} color={colors.background.primary} />
                      <Text style={styles.primaryText}>{deadlinePassed ? 'Termin składania ofert minął' : 'Utwórz zapytanie'}</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {!!detail.source_url && /^https?:\/\//i.test(detail.source_url) && (
                  <TouchableOpacity style={styles.secondary} onPress={() => void Linking.openURL(detail.source_url!)}>
                    <Feather name="external-link" size={16} color={colors.primary.gold} />
                    <Text style={styles.secondaryText}>Otwórz ogłoszenie źródłowe</Text>
                  </TouchableOpacity>
                )}

                <Text style={styles.fieldLabel}>Status</Text>
                <View style={styles.statusWrap}>
                  {STATUS_OPTIONS.map(([value, label]) => (
                    <TouchableOpacity key={value} disabled={!!detail.inquiry_id} onPress={() => setEditStatus(value)}
                      style={[styles.chip, editStatus === value && styles.chipActive, !!detail.inquiry_id && styles.disabled]}
                      accessibilityRole="radio" accessibilityState={{ selected: editStatus === value, disabled: !!detail.inquiry_id }}>
                      <Text style={[styles.chipText, editStatus === value && styles.chipTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.fieldLabel}>Notatki</Text>
                <TextInput style={styles.notes} value={notes} onChangeText={setNotes} multiline placeholder="Dodaj notatki…"
                  placeholderTextColor={colors.text.tertiary} maxLength={10000} />
                <TouchableOpacity style={styles.primary}
                  onPress={() => void update({ notes: notes.trim() ? notes : null, ...(detail.inquiry_id ? {} : { status: editStatus }) }, 'Zapisuję zmiany…', 'Zapisano zmiany.')}>
                  <Feather name="check" size={16} color={colors.background.primary} />
                  <Text style={styles.primaryText}>Zapisz status i notatki</Text>
                </TouchableOpacity>

                <Text style={styles.fieldLabel}>Ocena manualna</Text>
                <View style={styles.buttons}>
                  <TouchableOpacity style={[styles.secondary, detail.manual_relevance === 'relevant' && styles.selectedGood]}
                    onPress={() => void update({ manual_relevance: detail.manual_relevance === 'relevant' ? null : 'relevant' }, 'Zapisuję…', 'Zapisano ocenę.')}>
                    <Feather name="thumbs-up" size={16} color={detail.manual_relevance === 'relevant' ? colors.status.success : colors.primary.gold} />
                    <Text style={styles.secondaryText}>Trafny</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.secondary, detail.manual_relevance === 'irrelevant' && styles.selectedBad]}
                    onPress={() => void update({ manual_relevance: detail.manual_relevance === 'irrelevant' ? null : 'irrelevant' }, 'Zapisuję…', 'Zapisano ocenę.')}>
                    <Feather name="thumbs-down" size={16} color={detail.manual_relevance === 'irrelevant' ? colors.status.error : colors.primary.gold} />
                    <Text style={styles.secondaryText}>Nietrafny</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.secondary}
                  onPress={() => void update({ is_hidden: !detail.is_hidden }, 'Zapisuję…', detail.is_hidden ? 'Przetarg przywrócony na listę.' : 'Przetarg ukryty.')}>
                  <Feather name={detail.is_hidden ? 'eye' : 'eye-off'} size={16} color={colors.primary.gold} />
                  <Text style={styles.secondaryText}>{detail.is_hidden ? 'Przywróć na listę' : 'Ukryj przetarg'}</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
          {notice.overlay}
        </KeyboardAvoidingView>
      </Modal>
      <TenderFilterConfigSheet visible={configOpen} onClose={() => setConfigOpen(false)} onRecalculated={() => void load(true)} />
      {notice.overlay}
    </View>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text selectable style={styles.fieldValue}>{value || '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  filters: { backgroundColor: colors.background.secondary, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.xs, paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md, backgroundColor: colors.layer.well,
  },
  search: { flex: 1, paddingVertical: 9, fontSize: 14, color: colors.text.primary },
  chips: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: borderRadius.full,
    borderWidth: 1, borderColor: colors.border.default,
  },
  chipActive: { backgroundColor: withAlpha(colors.primary.gold, 0.15), borderColor: colors.primary.gold },
  chipText: { color: colors.text.secondary, fontSize: 13 },
  chipTextActive: { color: colors.primary.gold, fontWeight: '600' },
  count: { marginHorizontal: spacing.md, marginTop: 2, fontSize: 11, color: colors.text.tertiary },
  listContent: { padding: spacing.md, gap: spacing.sm },
  emptyContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  empty: { alignItems: 'center', gap: spacing.sm },
  emptyText: { textAlign: 'center' },
  error: { color: colors.status.error, marginBottom: spacing.sm, paddingHorizontal: spacing.md },
  row: {
    backgroundColor: colors.background.secondary, borderRadius: borderRadius.lg, padding: spacing.md, gap: 4,
    borderWidth: 1, borderColor: colors.border.default,
  },
  rowArchived: { opacity: 0.6 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  deadline: { flex: 1, color: colors.primary.gold, fontSize: 12, fontWeight: '600' },
  urgent: { color: colors.status.error },
  status: { color: colors.text.tertiary, fontSize: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  star: { marginTop: 2 },
  title: { flex: 1, color: colors.text.primary, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.text.secondary, fontSize: 13 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center', marginTop: 4 },
  badge: {
    color: colors.primary.gold, fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: borderRadius.full, backgroundColor: withAlpha(colors.primary.gold, 0.12), overflow: 'hidden',
  },
  score: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scoreText: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  scoreTrack: { width: 48, height: 4, borderRadius: 2, backgroundColor: colors.layer.well, overflow: 'hidden' },
  scoreFill: { height: '100%', borderRadius: 2 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    maxHeight: '92%', backgroundColor: colors.background.elevated, borderTopLeftRadius: borderRadius.xl, borderTopRightRadius: borderRadius.xl,
    paddingBottom: spacing.lg,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border.default,
  },
  sheetHeading: { fontFamily: typography.fontFamilies.heading, fontSize: 14, color: colors.text.secondary, textTransform: 'uppercase', fontWeight: '400' },
  closeButton: { padding: spacing.sm },
  sheetLoader: { margin: spacing.xl },
  sheetContent: { padding: spacing.lg, gap: spacing.sm },
  sheetTitle: { color: colors.text.primary, fontSize: 18, fontWeight: '600' },
  fieldLabel: { color: colors.text.tertiary, fontSize: 12, marginTop: spacing.xs },
  fieldValue: { color: colors.text.primary, fontSize: 14, lineHeight: 20 },
  remaining: { color: colors.primary.gold, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  remainingPast: { color: colors.text.tertiary },
  box: { padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.layer.well, gap: spacing.sm, marginTop: spacing.sm },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  hint: { color: colors.text.tertiary, fontSize: 12, lineHeight: 17 },
  statusWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  notes: {
    minHeight: 80, textAlignVertical: 'top', padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.layer.well,
    color: colors.text.primary, fontSize: 14,
  },
  primary: {
    flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary.gold,
    paddingVertical: 12, paddingHorizontal: spacing.md, borderRadius: borderRadius.md,
  },
  primaryText: { color: colors.background.primary, fontWeight: '700' },
  secondary: {
    flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: 12,
    paddingHorizontal: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.hover,
  },
  secondaryText: { color: colors.primary.gold, fontWeight: '600' },
  selectedGood: { borderColor: colors.status.success, backgroundColor: withAlpha(colors.status.success, 0.12) },
  selectedBad: { borderColor: colors.status.error, backgroundColor: withAlpha(colors.status.error, 0.12) },
  disabled: { opacity: 0.45 },
});

export default function TendersScreen() {
  return (
    <PermissionGate module="tenders">
      <TendersContent />
    </PermissionGate>
  );
}
