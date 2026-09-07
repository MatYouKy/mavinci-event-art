import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { colors, spacing } from '../../../theme';
import { supabase } from '../../../lib/supabase';
import { isWeddingReceptionGame } from '../../../lib/weddingAttractions';

export interface WeddingCardAnswer {
  id: string;
  section: string;
  field_key: string;
  value: unknown;
}

export interface WeddingCardPerson {
  id: string;
  side: 'bride' | 'groom' | 'shared';
  role: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  instagram_handle: string | null;
  instagram_tag_consent: boolean | null;
  notes: string | null;
}

export interface WeddingScheduleItem {
  id: string;
  title: string;
  scheduled_at: string | null;
  category: string | null;
  location: string | null;
  responsible_person: string | null;
  notes: string | null;
  is_confirmed: boolean;
}

export interface WeddingMusicTrack {
  id: string;
  list_type: 'play' | 'do_not_play' | 'special';
  title: string;
  artist: string | null;
  notes: string | null;
}

export interface WeddingAttraction {
  id: string;
  attraction_key: string;
  attraction_name: string;
  choice: 'undecided' | 'interested' | 'selected' | 'rejected';
  notes: string | null;
}

export interface WeddingCardData {
  id: string;
  status: 'not_started' | 'in_progress' | 'submitted' | 'approved' | 'changes_requested';
  progress: number;
  updated_at: string | null;
  pdf_path: string | null;
  answers: WeddingCardAnswer[];
  people: WeddingCardPerson[];
  schedule: WeddingScheduleItem[];
  tracks: WeddingMusicTrack[];
  attractions: WeddingAttraction[];
}

const STATUS_LABELS: Record<WeddingCardData['status'], string> = {
  not_started: 'Nie rozpoczęto',
  in_progress: 'W trakcie uzupełniania',
  submitted: 'Przesłana do weryfikacji',
  approved: 'Zatwierdzona',
  changes_requested: 'Wymaga uzupełnienia',
};

const isExplicitlyFalse = (value: unknown) =>
  value === false || value === 'false' || value === 0 || value === '0';

const FIELD_LABELS: Record<string, string> = {
  ceremony_type: 'Rodzaj ceremonii',
  ceremony_time: 'Godzina ślubu',
  church_address: 'Adres kościoła',
  civil_ceremony_setting: 'Miejsce ceremonii cywilnej',
  ceremony_address: 'Adres ceremonii',
  church_wishes_enabled: 'Życzenia pod kościołem',
  guest_count: 'Liczba gości',
  ceremony: 'Informacje o ceremonii',
  venue_arrival_time: 'Przyjazd na salę',
  venue_access: 'Dostęp do sali',
  hot_vodka: 'Gorzka wódka',
  first_dance: 'Pierwszy taniec',
  special_toasts: 'Specjalne toasty',
  couple_wait_before_welcome: 'Para czeka przed powitaniem',
  bread_and_salt_enabled: 'Powitanie chlebem i solą',
  welcome_throwing: 'Czym witamy / rzucamy',
  welcome_glasses: 'Kieliszki powitalne',
  welcome_sequence: 'Kolejność powitania',
  cake_time: 'Godzina tortu',
  cake_presentation: 'Sposób podania tortu',
  cake_location: 'Miejsce podania tortu',
  parents_thanks_enabled: 'Podziękowania dla rodziców',
  parents_thanks_recipients: 'Osoby objęte podziękowaniami',
  parents_thanks_plan: 'Forma podziękowań',
  oczepiny_enabled: 'Oczepiny',
  oczepiny_notes: 'Ustalenia oczepinowe',
  spotify_playlist_url: 'Playlista Spotify',
  youtube_playlist_url: 'Playlista YouTube',
  general_notes: 'Uwagi dla zespołu',
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  ceremony_type: { church: 'Kościelna', civil: 'Cywilna', humanist: 'Humanistyczna' },
  civil_ceremony_setting: { registry_office: 'Urząd', outdoor: 'Plener' },
  welcome_throwing: {
    none: 'Bez rzucania',
    rice: 'Ryż',
    petals: 'Płatki kwiatów',
    confetti: 'Konfetti',
    coins: 'Monety',
    other: 'Inne',
  },
  welcome_glasses: {
    vodka: 'Kieliszki z wódką',
    champagne: 'Kieliszki do szampana',
    none: 'Bez kieliszków',
  },
};

const SECTIONS = [
  { id: 'ceremony', title: 'Ceremonia', icon: 'heart' },
  { id: 'technical', title: 'Przebieg i logistyka', icon: 'settings' },
  { id: 'welcome', title: 'Przyjazd i powitanie', icon: 'home' },
  { id: 'cake', title: 'Tort weselny', icon: 'gift' },
  { id: 'parents_thanks', title: 'Podziękowania dla rodziców', icon: 'users' },
  { id: 'oczepiny', title: 'Oczepiny', icon: 'star' },
  { id: 'notes', title: 'Dodatkowe ustalenia', icon: 'file-text' },
] as const;

const ROLE_LABELS: Record<string, string> = {
  bride: 'Panna Młoda',
  groom: 'Pan Młody',
  witness: 'Świadek / Świadkowa',
  mother: 'Mama',
  father: 'Tata',
  guardian: 'Opiekun / Opiekunka',
  godparent: 'Chrzestny / Chrzestna',
  venue_contact: 'Kontakt po stronie sali',
  subcontractor: 'Podwykonawca',
  other: 'Inna osoba',
};

const SIDE_LABELS: Record<WeddingCardPerson['side'], string> = {
  bride: 'Strona Panny Młodej',
  groom: 'Strona Pana Młodego',
  shared: 'Osoby wspólne i organizacyjne',
};

const TRACK_LABELS: Record<WeddingMusicTrack['list_type'], string> = {
  special: 'Momenty specjalne',
  play: 'Utwory do zagrania',
  do_not_play: 'Lista „nie grać”',
};

const isFilled = (value: unknown) => {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(isFilled);
  return true;
};

const formatValue = (fieldKey: string, value: unknown) => {
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(', ');
  if (typeof value === 'object' && value) {
    return Object.values(value as Record<string, unknown>).map(String).filter(Boolean).join(' · ');
  }
  const normalized = String(value ?? '').trim();
  return VALUE_LABELS[fieldKey]?.[normalized] || normalized;
};

const formatDateTime = (value: string | null) => {
  if (!value) return 'Bez godziny';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pl-PL', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function WeddingCardTab({ card }: { card: WeddingCardData | null }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [openingPdf, setOpeningPdf] = useState(false);

  if (!card) {
    return (
      <View style={styles.emptyState}>
        <Feather name="heart" size={42} color={colors.primary.gold} />
        <Text style={styles.emptyTitle}>Karta weselna nie została jeszcze utworzona</Text>
        <Text style={styles.emptyText}>
          To wesele korzysta z Karty Weselnej zamiast klasycznej agendy. Dane pojawią się tutaj po rozpoczęciu jej uzupełniania.
        </Text>
      </View>
    );
  }

  const openPdf = async () => {
    if (!card.pdf_path || openingPdf) return;
    setOpeningPdf(true);
    const { data, error } = await supabase.storage
      .from('event-files')
      .createSignedUrl(card.pdf_path, 60 * 60);
    setOpeningPdf(false);
    if (!error && data?.signedUrl) setPdfUrl(data.signedUrl);
  };

  const selectedAttractions = card.attractions.filter((item) =>
    ['selected', 'interested'].includes(item.choice),
  );
  const weddingGameChoices = selectedAttractions.filter((item) =>
    item.choice === 'selected' && isWeddingReceptionGame(item),
  );
  const additionalAttractions = selectedAttractions.filter((item) => !isWeddingReceptionGame(item));
  const noParentsThanks = isExplicitlyFalse(
    card.answers.find((answer) => answer.field_key === 'parents_thanks_enabled')?.value,
  );

  return (
    <View style={styles.container}>
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryIcon}>
            <Feather name="heart" size={20} color={colors.primary.gold} />
          </View>
          <View style={styles.summaryText}>
            <Text style={styles.summaryTitle}>Karta weselna</Text>
            <Text style={styles.summaryStatus}>{STATUS_LABELS[card.status]}</Text>
          </View>
          <Text style={styles.progressValue}>{card.progress}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, card.progress))}%` }]} />
        </View>
        {Boolean(card.pdf_path) && (
          <TouchableOpacity style={styles.pdfButton} onPress={() => void openPdf()} disabled={openingPdf}>
            {openingPdf ? (
              <ActivityIndicator size="small" color={colors.background.primary} />
            ) : (
              <Feather name="file-text" size={15} color={colors.background.primary} />
            )}
            <Text style={styles.pdfButtonText}>Otwórz Kartę Weselną PDF</Text>
          </TouchableOpacity>
        )}
      </View>

      {(['bride', 'groom', 'shared'] as const).map((side) => {
        const people = card.people.filter((person) => person.side === side);
        if (!people.length) return null;
        return (
          <View key={side} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name="users" size={15} color={colors.primary.gold} />
              <Text style={styles.sectionTitle}>{SIDE_LABELS[side]}</Text>
            </View>
            {people.map((person) => (
              <View key={person.id} style={styles.personRow}>
                <View style={styles.personMain}>
                  <Text style={styles.personName}>
                    {[person.first_name, person.last_name].filter(Boolean).join(' ')}
                  </Text>
                  <Text style={styles.personRole}>{ROLE_LABELS[person.role] || person.role}</Text>
                </View>
                {Boolean(person.phone || person.email) && (
                  <Text style={styles.personDetail}>{[person.phone, person.email].filter(Boolean).join(' · ')}</Text>
                )}
                {Boolean(person.instagram_handle) && (
                  <Text style={styles.personDetail}>
                    @{person.instagram_handle?.replace(/^@+/, '')} · {person.instagram_tag_consent ? 'zgoda na oznaczanie' : 'bez zgody na oznaczanie'}
                  </Text>
                )}
                {Boolean(person.notes) && <Text style={styles.personNote}>{person.notes}</Text>}
              </View>
            ))}
          </View>
        );
      })}

      {SECTIONS.map((section) => {
        if (section.id === 'parents_thanks' && noParentsThanks) {
          return (
            <View key={section.id} style={[styles.section, styles.criticalSection]}>
              <Text style={styles.criticalText}>Bez podziękowań dla rodziców</Text>
            </View>
          );
        }
        const answers = card.answers.filter(
          (answer) => answer.section === section.id && FIELD_LABELS[answer.field_key] && isFilled(answer.value),
        );
        if (!answers.length) return null;
        return (
          <View key={section.id} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name={section.icon as any} size={15} color={colors.primary.gold} />
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
            {answers.map((answer) => (
              <View key={answer.id} style={styles.answerRow}>
                <Text style={styles.answerLabel}>{FIELD_LABELS[answer.field_key]}</Text>
                <Text style={styles.answerValue}>{formatValue(answer.field_key, answer.value)}</Text>
              </View>
            ))}
          </View>
        );
      })}

      {card.schedule.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Feather name="clock" size={15} color={colors.primary.gold} />
            <Text style={styles.sectionTitle}>Harmonogram wesela i posiłków</Text>
          </View>
          {card.schedule.map((item) => (
            <View key={item.id} style={styles.scheduleRow}>
              <View style={styles.scheduleTimeWrap}>
                <Text style={styles.scheduleTime}>{formatDateTime(item.scheduled_at)}</Text>
                {item.is_confirmed && <Feather name="check-circle" size={12} color={colors.status.success} />}
              </View>
              <Text style={styles.scheduleTitle}>{item.title}</Text>
              {Boolean(item.location || item.responsible_person) && (
                <Text style={styles.scheduleMeta}>
                  {[item.location, item.responsible_person].filter(Boolean).join(' · ')}
                </Text>
              )}
              {Boolean(item.notes) && <Text style={styles.scheduleNotes}>{item.notes}</Text>}
            </View>
          ))}
        </View>
      )}

      {weddingGameChoices.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Feather name="award" size={15} color={colors.primary.gold} />
            <Text style={styles.sectionTitle}>Wybrane zabawy oczepinowe</Text>
          </View>
          {weddingGameChoices.map((item) => (
            <View key={item.id} style={styles.answerRow}>
              <Text style={styles.answerValue}>{item.attraction_name}</Text>
              {Boolean(item.notes) && <Text style={styles.scheduleNotes}>{item.notes}</Text>}
            </View>
          ))}
        </View>
      )}

      {additionalAttractions.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Feather name="star" size={15} color={colors.primary.gold} />
            <Text style={styles.sectionTitle}>Atrakcje i dodatki</Text>
          </View>
          {additionalAttractions.map((item) => (
            <View key={item.id} style={styles.answerRow}>
              <Text style={styles.answerValue}>{item.attraction_name}</Text>
              <Text style={styles.answerLabel}>{item.choice === 'selected' ? 'Wybrano' : 'Rozważane'}</Text>
              {Boolean(item.notes) && <Text style={styles.scheduleNotes}>{item.notes}</Text>}
            </View>
          ))}
        </View>
      )}

      {(['special', 'play', 'do_not_play'] as const).map((listType) => {
        const tracks = card.tracks.filter((track) => track.list_type === listType);
        if (!tracks.length) return null;
        return (
          <View key={listType} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name="music" size={15} color={colors.primary.gold} />
              <Text style={styles.sectionTitle}>{TRACK_LABELS[listType]}</Text>
            </View>
            {tracks.map((track) => (
              <View key={track.id} style={styles.answerRow}>
                <Text style={styles.answerValue}>
                  {track.artist ? `${track.artist} — ${track.title}` : track.title}
                </Text>
                {Boolean(track.notes) && <Text style={styles.scheduleNotes}>{track.notes}</Text>}
              </View>
            ))}
          </View>
        );
      })}

      <Modal visible={Boolean(pdfUrl)} animationType="slide" onRequestClose={() => setPdfUrl(null)}>
        <View style={styles.pdfModal}>
          <View style={styles.pdfHeader}>
            <Text style={styles.pdfTitle}>Karta weselna PDF</Text>
            <Pressable onPress={() => setPdfUrl(null)}>
              <Feather name="x" size={24} color={colors.text.primary} />
            </Pressable>
          </View>
          {pdfUrl ? <WebView source={{ uri: pdfUrl }} style={styles.pdfViewer} startInLoadingState /> : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, gap: spacing.md },
  emptyState: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 16, fontWeight: '700', color: colors.text.primary, textAlign: 'center' },
  emptyText: { fontSize: 13, lineHeight: 20, color: colors.text.secondary, textAlign: 'center' },
  summaryCard: { borderWidth: 1, borderColor: `${colors.primary.gold}55`, borderRadius: 14, padding: spacing.md, backgroundColor: colors.background.secondary },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  summaryIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.primary.gold}18` },
  summaryText: { flex: 1 },
  summaryTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 16, fontWeight: '700', color: colors.text.primary },
  summaryStatus: { marginTop: 2, fontSize: 11, color: colors.text.secondary },
  progressValue: { fontSize: 16, fontWeight: '700', color: colors.primary.gold },
  progressTrack: { height: 6, marginTop: spacing.md, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.background.tertiary },
  progressFill: { height: '100%', backgroundColor: colors.primary.gold },
  pdfButton: { marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: 9, paddingVertical: 10, backgroundColor: colors.primary.gold },
  pdfButtonText: { fontSize: 12, fontWeight: '700', color: colors.background.primary },
  section: { borderWidth: 1, borderColor: colors.border.default, borderRadius: 12, padding: spacing.md, backgroundColor: colors.background.secondary },
  criticalSection: { borderWidth: 2, borderColor: colors.status.error, backgroundColor: `${colors.status.error}16` },
  criticalText: { color: colors.status.error, fontSize: 16, fontWeight: '800' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', flex: 1, fontSize: 13, fontWeight: '700', color: colors.primary.gold },
  personRow: { paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border.default },
  personMain: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  personName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text.primary },
  personRole: { fontSize: 10, color: colors.text.tertiary, textAlign: 'right' },
  personDetail: { marginTop: 3, fontSize: 11, color: colors.text.secondary },
  personNote: { marginTop: 3, fontSize: 11, fontStyle: 'italic', color: colors.primary.gold },
  answerRow: { paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border.default },
  answerLabel: { fontSize: 10, color: colors.text.tertiary, marginBottom: 3 },
  answerValue: { fontSize: 13, lineHeight: 19, color: colors.text.primary, fontWeight: '500' },
  scheduleRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border.default },
  scheduleTimeWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  scheduleTime: { fontSize: 11, fontWeight: '700', color: colors.primary.gold },
  scheduleTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', marginTop: 3, fontSize: 13, fontWeight: '600', color: colors.text.primary },
  scheduleMeta: { marginTop: 3, fontSize: 11, color: colors.text.secondary },
  scheduleNotes: { marginTop: 3, fontSize: 11, lineHeight: 16, color: colors.text.tertiary },
  pdfModal: { flex: 1, backgroundColor: colors.background.primary },
  pdfHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.default, backgroundColor: colors.background.secondary },
  pdfTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 15, fontWeight: '700', color: colors.text.primary },
  pdfViewer: { flex: 1 },
});
