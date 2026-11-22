import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, glow, ink } from '../../theme';
import { formatInquiryFull } from '../../lib/inquiryFunnel';
import {
  approveAnalysis, askAssistant, loadAnalysis, newRequestId, readGuests,
  type AiItem, type WorkspaceAnalysis, type WorkspaceAnalysisData, type WorkspaceGuests,
} from '../../lib/inquiryWorkspace';
import { SmallButton, kit } from './InquiryKit';
import { openMail } from './WorkspaceMail';

/*
 * Analiza i rozmowa z AI na tablecie — jak `InquiryAnalysisPanel` w CRM i zakładka „Analiza i AI” na Macu (funkcja `assist-inquiry`):
 * aktualne podsumowanie przed ofertą / kalkulacją, zatwierdzenie do oferty i kalkulacji, zapisana rozmowa (ostatnie 30 tur),
 * pytanie albo pełna analiza zapytania i korespondencji. Odczyt liczby osób z korespondencji — z dosłownym cytatem.
 */

type Run = <T>(label: string, action: () => Promise<T>, success?: string) => Promise<T | null>;

const DEFAULT_HINT = 'Zostaw puste, aby przeanalizować zapytanie i całą korespondencję: założenia, potrzeby, pytania, propozycje oraz szacunkową kalkulację.';

export function AnalysisTab({ inquiryId, wide, run, notify, onChanged }: {
  inquiryId: string; wide: boolean; run: Run; notify: (text: string, error?: boolean) => void; onChanged: () => void;
}) {
  const [data, setData] = useState<WorkspaceAnalysisData | null>(null);
  const [problem, setProblem] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState(false);
  const request = useRef<{ text: string; id: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await loadAnalysis(inquiryId));
      setProblem('');
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Nie udało się pobrać analiz zapytania.');
    }
  }, [inquiryId]);
  useEffect(() => { void load(); }, [load]);

  const ask = async () => {
    const text = message.trim();
    if (text.length > 4000 || sending) return;
    // Ponowienie tego samego pytania po błędzie — ten sam identyfikator (AI nie zapisze tury dwa razy).
    if (request.current?.text !== text) request.current = { text, id: newRequestId() };
    setSending(true); setProblem('');
    try {
      setData(await askAssistant(inquiryId, text, request.current.id));
      setMessage('');
      request.current = null;
      notify(text ? 'AI odpowiedziało — rozmowa zapisana przy zapytaniu' : 'Analiza zapytania została zaktualizowana');
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Nie udało się uzyskać odpowiedzi. Spróbuj ponownie.');
    } finally {
      setSending(false);
    }
  };
  const approve = async (analysis: WorkspaceAnalysis) => {
    if (!data) return;
    const reply = await run('Zatwierdzam podsumowanie…', () => approveAnalysis(inquiryId, analysis.id, data.briefRevision),
      'Podsumowanie zostało zatwierdzone do oferty i kalkulacji');
    if (reply) { await load(); onChanged(); }
  };

  const latest = data?.analyses[0] || null;
  const text = message.trim();
  const action = text ? 'Wyślij do AI' : data?.analyses.length ? 'Odśwież analizę' : 'Przeanalizuj zapytanie';
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Analiza i rozmowa z AI</Text>
      <Text style={kit.muted}>Jedno miejsce na analizę zapytania, korespondencji i doprecyzowanie ustaleń. Rozmowa i kolejne podsumowania są zapisywane przy zapytaniu.</Text>
      {problem ? <Text style={kit.warningText}>{problem}</Text> : null}
      {data ? (
        <>
          {data.approved ? (
            <View style={[styles.approved, !data.approvedCurrent && styles.approvedOld]}>
              <View style={styles.inline}>
                <Feather name="award" size={16} color={data.approvedCurrent ? colors.status.success : colors.status.warning} />
                <Text style={[kit.text, { color: data.approvedCurrent ? colors.status.success : colors.status.warning }]}>
                  {data.approvedCurrent ? 'Zatwierdzone do oferty / kalkulacji' : 'Poprzednio zatwierdzone podsumowanie — sprawdź nowe ustalenia'}
                </Text>
              </View>
              <Text style={kit.text} selectable>{data.approved.summary}</Text>
              {data.approved.at ? <Text style={kit.muted}>{formatInquiryFull(data.approved.at)}</Text> : null}
            </View>
          ) : null}
          {latest ? (
            <>
              <Text style={styles.sectionTitle}>Aktualne podsumowanie przed ofertą / kalkulacją</Text>
              <AnalysisResult analysis={latest} wide={wide} />
              {data.canManage ? (
                <View style={kit.row}>
                  <SmallButton label={data.approvedCurrent ? 'Zatwierdzone' : 'Zatwierdź do oferty / kalkulacji'} icon="check-circle" primary
                    disabled={sending || data.approvedCurrent} onPress={() => void approve(latest)} />
                  <Text style={kit.muted}>Zatwierdzone podsumowanie trafia do nowej oferty i kalkulacji.</Text>
                </View>
              ) : null}
            </>
          ) : <Text style={kit.muted}>Nie ma jeszcze analizy. Rozpocznij od podsumowania dostępnych informacji.</Text>}
          {data.analyses.length ? (
            <View style={kit.gapSm}>
              <Disclosure open={history} onToggle={() => setHistory((value) => !value)}
                label={`Zapisana rozmowa i historia analiz (${data.analyses.length}${data.analyses.length === 30 ? ', ostatnie 30' : ''})`} />
              {history ? [...data.analyses].reverse().map((turn) => <Turn key={turn.id} turn={turn} wide={wide} />) : null}
            </View>
          ) : null}
          {data.canManage ? (
            <View style={styles.form}>
              <Text style={kit.text}>Doprecyzuj ustalenia lub zadaj pytanie (opcjonalnie)</Text>
              <TextInput value={message} onChangeText={setMessage} multiline editable={!sending} maxLength={4000} style={[kit.input, kit.multiline]}
                placeholder="np. Klient potwierdził 150 osób i scenę 8×6 m — zaktualizuj wycenę" placeholderTextColor={ink(0.35)} />
              <Text style={kit.muted}>{DEFAULT_HINT}</Text>
              <View style={kit.row}>
                <TouchableOpacity onPress={() => void ask()} disabled={sending} style={[kit.primary, sending && kit.disabled]} accessibilityRole="button">
                  {sending ? <ActivityIndicator color={colors.background.primary} /> : <Feather name="zap" size={16} color={colors.background.primary} />}
                  <Text style={kit.primaryText}>{sending ? (text ? 'AI przygotowuje odpowiedź…' : 'AI analizuje zapytanie i korespondencję…') : action}</Text>
                </TouchableOpacity>
                {data.messageCount > 0 ? <Text style={kit.muted}>Korespondencja: {data.messageCount} wiadomości</Text> : null}
              </View>
              {sending ? <Text style={kit.muted}>Analiza może potrwać do 2 minut — możesz przejść do innej zakładki, wynik zapisze się przy zapytaniu.</Text> : null}
            </View>
          ) : null}
        </>
      ) : !problem ? <ActivityIndicator color={colors.primary.gold} /> : null}
    </View>
  );
}

function Turn({ turn, wide }: { turn: WorkspaceAnalysis; wide: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.turn}>
      {turn.at ? <Text style={kit.muted}>{formatInquiryFull(turn.at)}</Text> : null}
      <Text style={[kit.text, { color: colors.primary.gold }]} selectable>Ty: {turn.question}</Text>
      <Text style={kit.text} selectable>AI: {turn.reply}</Text>
      <Disclosure open={open} onToggle={() => setOpen((value) => !value)} label="Podsumowanie z tej analizy" />
      {open ? <AnalysisResult analysis={turn} wide={wide} /> : null}
    </View>
  );
}

function Disclosure({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <TouchableOpacity onPress={onToggle} style={styles.disclosure} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <Feather name={open ? 'chevron-down' : 'chevron-right'} size={16} color={colors.text.tertiary} />
      <Text style={kit.muted}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Wynik analizy jak `RecommendationView`: podsumowanie, założenia, potrzeby, pytania, szacunek, propozycje, działania, ustalenia ze źródłami, zasoby, ryzyka. */
export function AnalysisResult({ analysis, wide }: { analysis: WorkspaceAnalysis; wide: boolean }) {
  const [findings, setFindings] = useState(false);
  const [extras, setExtras] = useState(false);
  const half = wide ? styles.half : null;
  return (
    <View style={kit.gapSm}>
      <Block title="Podsumowanie zapytania i korespondencji">
        <Text style={kit.text} selectable>{analysis.summary}</Text>
        {analysis.eventGoal ? <Text style={kit.muted}>Cel wydarzenia: {analysis.eventGoal}</Text> : null}
      </Block>
      <View style={styles.grid}>
        <Block title="Założenia wydarzenia" style={half}><Items values={analysis.assumptions} /></Block>
        {analysis.clientNeeds.length ? <Block title="Potrzeby klienta" style={half}><Items values={analysis.clientNeeds} /></Block> : null}
        <Block title="Co trzeba doprecyzować" style={half}><Items values={analysis.missing} /></Block>
        <Block title="Szacunkowa kalkulacja" style={half}>
          <Text style={styles.estimate}>{analysis.estimate}</Text>
          {analysis.estimateSummary ? <Text style={kit.text}>{analysis.estimateSummary}</Text> : null}
          {analysis.estimateBasis.length ? <Items values={analysis.estimateBasis} /> : null}
          <Text style={kit.muted}>Wstępny szacunek na podstawie dostępnych cen i założeń. Wymaga doprecyzowania przed ofertą.</Text>
        </Block>
        <Block title="Co możemy zaproponować" style={half}><Items values={analysis.products} /></Block>
        <Block title="Następne działania" style={half}><Items values={analysis.nextActions} /></Block>
      </View>
      {analysis.findings.length ? (
        <>
          <Disclosure open={findings} onToggle={() => setFindings((value) => !value)} label={`Ustalenia i źródła (${analysis.findingsCount} wiadomości)`} />
          {findings ? <Items values={analysis.findings} /> : null}
        </>
      ) : null}
      <Disclosure open={extras} onToggle={() => setExtras((value) => !value)} label="Zasoby i ryzyka" />
      {extras ? (
        <View style={styles.grid}>
          <Block title="Sugerowane zasoby" style={half}><Items values={analysis.resources} /></Block>
          <Block title="Ryzyka" style={half}><Items values={analysis.risks} /></Block>
        </View>
      ) : null}
    </View>
  );
}

function Block({ title, children, style }: { title: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.block, style]}>
      <Text style={[kit.text, { fontWeight: typography.fontWeights.semibold }]}>{title}</Text>
      {children}
    </View>
  );
}

function Items({ values }: { values: AiItem[] }) {
  if (!values.length) return <Text style={kit.muted}>Brak</Text>;
  return (
    <View style={kit.gapSm}>
      {values.map((item, index) => (
        <View key={index} style={styles.item}>
          <Text style={kit.muted}>•</Text>
          <View style={[kit.flex, { gap: 2 }]}>
            {item.label ? <Text style={[kit.muted, { color: colors.primary.gold }]}>{item.label}</Text> : null}
            <Text style={kit.text} selectable>{item.text}</Text>
            {item.sources.length ? (
              <View style={kit.row}>
                {item.sources.map((source, position) => (
                  <TouchableOpacity key={`${source.type}:${source.id}`} onPress={() => openMail(source)} hitSlop={6} accessibilityRole="link">
                    <Text style={kit.link}>{source.type === 'received' ? 'E-mail odebrany' : 'E-mail wysłany'}{item.sources.length > 1 ? ` (${position + 1})` : ''}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** „Odczytaj liczbę osób z korespondencji (AI)” — cytat ze źródła; przedziału ani szacunku nie przyjmujemy automatycznie. */
export function GuestsReader({ inquiryId, onApply }: { inquiryId: string; onApply: (count: number) => Promise<boolean> }) {
  const [result, setResult] = useState<WorkspaceGuests | null>(null);
  const [problem, setProblem] = useState('');
  const [reading, setReading] = useState(false);
  const read = async () => {
    setReading(true); setProblem(''); setResult(null);
    try {
      setResult(await readGuests(inquiryId));
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Nie udało się odczytać liczby osób. Spróbuj ponownie.');
    } finally {
      setReading(false);
    }
  };
  return (
    <View style={kit.gapSm}>
      <View style={kit.row}>
        <SmallButton label={reading ? 'Odczytuję liczbę osób z korespondencji…' : 'Odczytaj liczbę osób z korespondencji (AI)'} icon="users" disabled={reading} onPress={() => void read()} />
        {reading ? <ActivityIndicator color={colors.primary.gold} /> : null}
      </View>
      {problem ? <Text style={kit.warningText}>{problem}</Text> : null}
      {result ? (
        <View style={styles.guests}>
          <Text style={kit.text}>{result.kind === 'unknown' ? 'Nie znaleziono jednoznacznej liczby uczestników. Wpisz ją ręcznie po ustaleniu z klientem.' : `Znaleziono: ${result.text}`}</Text>
          {result.evidence ? <Text style={[kit.muted, { fontStyle: 'italic' }]}>„{result.evidence}”</Text> : null}
          {result.kind === 'approximate' ? <Text style={kit.muted}>To liczba przybliżona. Możesz przyjąć ją do wyceny.</Text> : null}
          {result.kind === 'range' ? <Text style={kit.muted}>Klient podał przedział. Wpisz ustaloną liczbę do wyceny — nie wybieramy automatycznie średniej ani maksimum.</Text> : null}
          {result.count && result.kind !== 'range' && result.kind !== 'unknown' ? (
            <View style={kit.row}>
              <SmallButton label={`Użyj ${result.count} osób w zapytaniu`} icon="check" primary onPress={() => void onApply(result.count!).then((ok) => { if (ok) setResult(null); })} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: glow(0.1), backgroundColor: glow(0.03) },
  cardTitle: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold },
  sectionTitle: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold, marginTop: spacing.xs },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  approved: { gap: spacing.xs, padding: spacing.sm + 2, borderRadius: borderRadius.md, backgroundColor: 'rgba(34,197,94,0.08)' },
  approvedOld: { backgroundColor: 'rgba(245,158,11,0.08)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  half: { width: '48.5%' },
  block: { gap: spacing.xs, padding: spacing.sm + 2, borderRadius: borderRadius.md, backgroundColor: glow(0.04), width: '100%' },
  estimate: { color: colors.primary.gold, fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.semibold },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  turn: { gap: spacing.xs, padding: spacing.sm + 2, borderRadius: borderRadius.md, backgroundColor: glow(0.04) },
  disclosure: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  form: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: glow(0.08) },
  guests: { gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: glow(0.05) },
});
