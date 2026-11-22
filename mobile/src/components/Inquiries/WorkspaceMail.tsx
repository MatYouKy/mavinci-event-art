import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, glow, ink } from '../../theme';
import { formatInquiryFull, plannedAt } from '../../lib/inquiryFunnel';
import { pickMaterialDocuments, pickMaterialMedia, type PickedMaterial } from '../../lib/materialsApi';
import {
  MAX_ATTACHMENTS_BYTES, correspondenceThread, improveWorkspaceEmail, linkCorrespondence, loadCorrespondence, searchCorrespondence,
  sendWorkspaceEmail, workspaceEmailPreview, workspaceEmailSetup,
  type MailRef, type WorkspaceAttachment, type WorkspaceCorrespondence, type WorkspaceEmailSetup, type WorkspaceMail, type WorkspaceMailHit,
} from '../../lib/inquiryWorkspace';
import { navigateToEmailMessage, openInCrmWeb } from '../../navigation/navigationRef';
import { Chip, DateTimeField, Label, Segmented, SelectField, Sheet, SmallButton, kit } from './InquiryKit';

/*
 * Korespondencja zapytania i wiadomość do klienta na tablecie — jak `InquiryCorrespondencePanel` i `ComposeEmailModal` w CRM
 * oraz zakładka „Korespondencja” i okno e-maila na Macu: wiadomości od najstarszej (treść bez stopek i cytatów, „Pokaż całą
 * wiadomość”), dołączanie wiadomości lub całej konwersacji po temacie, wykluczanie i przywracanie; e-mail ze skrzynki firmy
 * z podglądem stopki, „Popraw z AI”, załącznikami (pliki, zdjęcia — do 25 MB) i wysyłką teraz albo o wybranej porze.
 */

type Run = <T>(label: string, action: () => Promise<T>, success?: string) => Promise<T | null>;

/** Wiadomość: odebrana — w aplikacji (Wiadomości), wysłana — w CRM (pełny podgląd z załącznikami). */
export function openMail(message: MailRef) {
  if (message.type === 'received') navigateToEmailMessage(message.id);
  else openInCrmWeb(`/crm/messages/${message.id}?type=sent`);
}

const mailDate = (value: string | null | undefined) => formatInquiryFull(value);
const timeOfDay = (value: Date) => new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(value);

export function CorrespondenceTab({ inquiryId, canManage, canCompose, run, onCompose, onAnalysis }: {
  inquiryId: string; canManage: boolean; canCompose: boolean; run: Run; onCompose: () => void; onAnalysis: () => void;
}) {
  const [data, setData] = useState<WorkspaceCorrespondence | null>(null);
  const [problem, setProblem] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [picking, setPicking] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [full, setFull] = useState<string[]>([]);
  const [showExcluded, setShowExcluded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadCorrespondence(inquiryId));
      setLoadedAt(new Date());
      setProblem('');
    } catch (cause) {
      // Po utracie dostępu do skrzynki nie pokazujemy wcześniej pobranych wiadomości.
      setData(null);
      setProblem(cause instanceof Error ? cause.message : 'Nie udało się odświeżyć korespondencji. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }, [inquiryId]);
  useEffect(() => { void load(); }, [load]);

  const change = async (message: MailRef, thread: boolean, excluded: boolean, success: string) => {
    const reply = await run('Zapisuję powiązanie…', () => linkCorrespondence(inquiryId, message, thread, excluded), success);
    if (reply) await load();
    return Boolean(reply);
  };
  const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key]);
  const keyOf = (message: MailRef) => `${message.type}:${message.id}`;

  const row = (message: WorkspaceMail) => {
    const key = keyOf(message);
    const open = expanded.includes(key);
    const showFull = full.includes(key) || !message.trimmed;
    const content = showFull ? message.body : message.clean;
    return (
      <View key={key} style={styles.mail}>
        <TouchableOpacity onPress={() => setExpanded((list) => toggle(list, key))} style={styles.mailHead} accessibilityRole="button" accessibilityState={{ expanded: open }}>
          <Feather name={message.type === 'received' ? 'arrow-down-left' : 'arrow-up-right'} size={16} color={message.type === 'received' ? colors.primary.gold : colors.status.success} />
          <View style={kit.flex}>
            <Text style={[kit.text, styles.strong]} numberOfLines={open ? 3 : 1}>{message.subject || '(bez tematu)'}</Text>
            <Text style={kit.muted} numberOfLines={1}>{[message.type === 'received' ? 'Odebrane' : 'Wysłane', mailDate(message.at)].filter(Boolean).join(' · ')}</Text>
          </View>
          <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.text.tertiary} />
        </TouchableOpacity>
        {open ? (
          <View style={styles.mailBody}>
            <Text style={kit.muted} selectable>{message.from} → {message.to}</Text>
            <Text style={content ? kit.text : kit.muted} selectable>{content || 'Brak treści wiadomości.'}</Text>
            <View style={kit.row}>
              {message.trimmed ? (
                <SmallButton label={showFull ? 'Pokaż tylko treść' : 'Pokaż całą wiadomość'} icon="align-left" onPress={() => setFull((list) => toggle(list, key))} />
              ) : null}
              <SmallButton label="Otwórz wiadomość" icon="external-link" onPress={() => openMail(message)} />
              {canManage ? (
                <SmallButton label="Wyklucz wiadomość" icon="slash" danger onPress={() => void change(message, true, true, 'Wiadomość wykluczona z korespondencji i analizy')} />
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={kit.gapSm}>
      <View style={kit.between}>
        <Text style={styles.title}>Korespondencja ({data?.messages.length ?? 0})</Text>
        <View style={kit.row}>
          <SmallButton label="Odśwież" icon="refresh-cw" disabled={loading} onPress={() => void load()} />
          {canManage ? <SmallButton label="Napisz e-mail" icon="mail" primary disabled={!canCompose} onPress={onCompose} /> : null}
          {canManage ? <SmallButton label="Dołącz wiadomość lub konwersację" icon="plus" onPress={() => setPicking((value) => !value)} /> : null}
          {canManage ? <SmallButton label="Otwórz analizę" icon="zap" disabled={loading || !data?.messages.length} onPress={onAnalysis} /> : null}
        </View>
      </View>
      <Text style={kit.muted}>
        Wiadomości są uporządkowane od najstarszej. Kolejne odpowiedzi pojawiają się po odświeżeniu. Powiązania pozostają przy zapytaniu również po
        utworzeniu wydarzenia. Analiza obejmuje treść maili, bez zawartości załączników.
      </Text>
      {!canCompose && canManage ? <Text style={kit.muted}>Klient nie ma adresu e-mail — uzupełnij go w kliencie zapytania, aby napisać wiadomość.</Text> : null}
      {loadedAt ? <Text style={kit.muted}>{loading ? 'Sprawdzam nowe wiadomości…' : `Ostatnia aktualizacja: ${timeOfDay(loadedAt)}`}</Text> : null}
      {problem ? (
        <View style={kit.between}><Text style={[kit.warningText, kit.flex]}>{problem}</Text><SmallButton label="Spróbuj ponownie" icon="refresh-cw" onPress={() => void load()} /></View>
      ) : null}
      {picking && canManage ? (
        <MailPicker inquiryId={inquiryId} onAttach={async (message, thread) => {
          const ok = await change(message, thread, false, 'Korespondencja została powiązana z zapytaniem');
          if (ok) setPicking(false);
        }} />
      ) : null}
      {data ? (
        <>
          {!data.messages.length ? <Text style={kit.muted}>Brak powiązanych wiadomości dostępnych w Twoich skrzynkach.</Text> : null}
          {data.messages.map(row)}
          {canManage && data.excluded.length ? (
            <View style={kit.gapSm}>
              <TouchableOpacity onPress={() => setShowExcluded((value) => !value)} style={styles.disclosure} accessibilityRole="button" accessibilityState={{ expanded: showExcluded }}>
                <Feather name={showExcluded ? 'chevron-down' : 'chevron-right'} size={16} color={colors.text.tertiary} />
                <Text style={kit.muted}>Wykluczone wiadomości ({data.excluded.length})</Text>
              </TouchableOpacity>
              {showExcluded ? data.excluded.map((message, index) => (
                <View key={keyOf(message)} style={kit.between}>
                  <SmallButton label={`Otwórz wykluczoną wiadomość ${index + 1}`} icon="external-link" onPress={() => openMail(message)} />
                  <SmallButton label="Przywróć" icon="rotate-ccw" onPress={() => void change(message, true, false, 'Wiadomość przywrócona do korespondencji')} />
                </View>
              )) : null}
            </View>
          ) : null}
        </>
      ) : !problem ? <ActivityIndicator color={colors.primary.gold} /> : null}
    </View>
  );
}

/** „Dołącz wiadomość lub konwersację” — wyszukiwanie po temacie, podgląd wątku, cała konwersacja albo jedna wiadomość. */
function MailPicker({ inquiryId, onAttach }: { inquiryId: string; onAttach: (message: WorkspaceMailHit, thread: boolean) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WorkspaceMailHit[]>([]);
  const [selected, setSelected] = useState<WorkspaceMailHit | null>(null);
  const [thread, setThread] = useState<WorkspaceMailHit[]>([]);
  const [wholeThread, setWholeThread] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const search = async () => {
    const text = query.trim();
    if (text.length < 3 || busy) return;
    setBusy(true); setProblem(''); setSelected(null); setResults([]);
    try {
      const reply = await searchCorrespondence(inquiryId, text);
      setResults(reply.results);
      if (!reply.results.length) setProblem('Nie znaleziono wiadomości o takim temacie w dostępnych skrzynkach.');
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Wyszukiwanie korespondencji jest chwilowo niedostępne. Spróbuj ponownie później.');
    } finally {
      setBusy(false);
    }
  };
  const choose = async (message: WorkspaceMailHit) => {
    setBusy(true); setProblem('');
    try {
      setThread((await correspondenceThread(inquiryId, message.type, message.id)).messages);
      setWholeThread(true);
      setSelected(message);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Nie udało się pobrać konwersacji. Spróbuj ponownie.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.picker}>
      <View style={kit.row}>
        <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} returnKeyType="search" style={[kit.input, kit.flex]}
          placeholder="Wyszukaj po temacie maila…" placeholderTextColor={ink(0.35)} autoCorrect={false} />
        <SmallButton label="Szukaj" icon="search" disabled={busy || query.trim().length < 3} onPress={() => void search()} />
      </View>
      {problem ? <Text style={kit.warningText}>{problem}</Text> : null}
      {busy ? <ActivityIndicator color={colors.primary.gold} /> : null}
      {selected ? (
        <View style={kit.gapSm}>
          <Text style={[kit.text, styles.strong]}>{selected.subject || '(bez tematu)'}</Text>
          <View style={kit.wrap}>
            <Chip label={`Cała konwersacja (${thread.length})`} active={wholeThread} onPress={() => setWholeThread(true)} />
            <Chip label="Tylko ta wiadomość" active={!wholeThread} onPress={() => setWholeThread(false)} />
          </View>
          <Text style={kit.muted}>
            Cała konwersacja obejmuje też kolejne odpowiedzi. Łączymy odpowiedzi w wątku oraz wiadomości o tym samym temacie i z tym samym rozmówcą
            w tej skrzynce. Prefiksy Re:, Odp: i Fwd: nie zmieniają tematu.
          </Text>
          {(wholeThread ? thread : [selected]).map((message) => (
            <Text key={`${message.type}:${message.id}`} style={kit.muted}>{mailDate(message.at)} · {message.subject || '(bez tematu)'}</Text>
          ))}
          <View style={kit.row}>
            <SmallButton label={wholeThread ? 'Dołącz konwersację' : 'Dołącz wiadomość'} icon="link" primary disabled={busy}
              onPress={async () => { setBusy(true); try { await onAttach(selected, wholeThread); } finally { setBusy(false); } }} />
            <SmallButton label="Wróć do wyników" icon="arrow-left" disabled={busy} onPress={() => setSelected(null)} />
          </View>
        </View>
      ) : results.map((message) => (
        <TouchableOpacity key={`${message.type}:${message.id}`} onPress={() => void choose(message)} disabled={busy} style={kit.selectRow} accessibilityRole="button">
          <Feather name={message.type === 'received' ? 'arrow-down-left' : 'arrow-up-right'} size={16} color={colors.text.tertiary} />
          <View style={kit.flex}>
            <Text style={kit.text} numberOfLines={1}>{message.subject || '(bez tematu)'}</Text>
            <Text style={kit.muted} numberOfLines={1}>
              {[message.type === 'received' ? 'Odebrane' : 'Wysłane', mailDate(message.at), `${message.from || ''} → ${message.to || ''}`].join(' · ')}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`);
/** Lista adresów oddzielonych przecinkiem lub średnikiem — każdy z „@” (także „Jan Nowak <jan@firma.pl>”). */
const addressList = (value: string) => {
  const parts = value.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => /[^\s@<]+@[^\s@>]+\.[^\s@>]+/.test(part));
};

/**
 * Wiadomość do klienta ze skrzynki firmy (`ComposeEmailModal`): od, do, DW, UDW, temat i treść (stopka i szablon skrzynki dodają się
 * same — „Podgląd”), „Popraw z AI”, załączniki, wysyłka teraz albo zaplanowana. Wysłana wiadomość trafia do korespondencji zapytania
 * i jest zapisana jako kontakt z klientem.
 */
export function EmailSheet({ inquiryId, visible, onClose, onSent }: {
  inquiryId: string; visible: boolean; onClose: () => void; onSent: (scheduledAt: string | null) => void;
}) {
  const [setup, setSetup] = useState<WorkspaceEmailSetup | null>(null);
  const [loadProblem, setLoadProblem] = useState('');
  const [accountId, setAccountId] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [copies, setCopies] = useState(false);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<PickedMaterial[]>([]);
  const [mode, setMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState(new Date(plannedAt(1, 8)));
  const [preview, setPreview] = useState<string | null>(null);
  const [working, setWorking] = useState<null | 'improve' | 'preview' | 'send' | 'files'>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setSetup(null); setLoadProblem(''); setProblem(''); setPreview(null); setFiles([]); setMode('now'); setScheduledAt(new Date(plannedAt(1, 8)));
    setCc(''); setBcc(''); setCopies(false); setWorking(null);
    workspaceEmailSetup(inquiryId).then((next) => {
      if (!active) return;
      setSetup(next); setAccountId(next.accountId); setTo(next.to); setSubject(next.subject); setText(next.text);
    }).catch((cause) => { if (active) setLoadProblem(cause instanceof Error ? cause.message : 'Nie udało się przygotować wiadomości.'); });
    return () => { active = false; };
  }, [visible, inquiryId]);

  if (!visible) return null;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const tooLarge = total > MAX_ATTACHMENTS_BYTES;
  const noAccounts = Boolean(setup && !setup.accounts.length);

  const addFiles = async (source: 'documents' | 'library') => {
    setWorking('files'); setProblem('');
    try {
      const picked = source === 'documents' ? await pickMaterialDocuments() : await pickMaterialMedia('library');
      setFiles((current) => {
        const known = new Set(current.map((file) => file.uri));
        return [...current, ...picked.filter((file) => !known.has(file.uri))].slice(0, 20);
      });
      if (files.length + picked.length > 20) setProblem('Do wiadomości można dołączyć najwyżej 20 plików.');
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Nie udało się dodać plików.');
    } finally {
      setWorking(null);
    }
  };
  const improve = async () => {
    setWorking('improve'); setProblem('');
    try {
      const improved = await improveWorkspaceEmail(inquiryId, subject, text);
      if (improved.text) setText(improved.text);
      if (improved.subject) setSubject(improved.subject);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Nie udało się poprawić wiadomości.');
    } finally {
      setWorking(null);
    }
  };
  const showPreview = async () => {
    setWorking('preview'); setProblem('');
    try {
      setPreview((await workspaceEmailPreview(inquiryId, accountId, subject, text)).html || '');
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Nie udało się przygotować podglądu.');
    } finally {
      setWorking(null);
    }
  };
  const send = async () => {
    if (!to.trim() || !subject.trim() || !text.trim()) { setProblem('Wypełnij wszystkie pola.'); return; }
    if (!addressList(to) || (cc.trim() && !addressList(cc)) || (bcc.trim() && !addressList(bcc))) { setProblem('Sprawdź adresy e-mail (kilka adresów oddziel przecinkiem).'); return; }
    if (!setup?.accounts.some((account) => account.id === accountId)) { setProblem('Wybierz konto, z którego chcesz wysłać wiadomość.'); return; }
    if (mode === 'later' && scheduledAt.getTime() < Date.now() + 30_000) { setProblem('Termin wysyłki musi przypadać w przyszłości.'); return; }
    if (tooLarge) { setProblem('Łączny rozmiar załączników przekracza 25 MB.'); return; }
    setWorking('send'); setProblem('');
    try {
      const attachments: WorkspaceAttachment[] = [];
      for (const file of files) {
        attachments.push({ filename: file.name, content: await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 }), contentType: file.mimeType });
      }
      const when = mode === 'later' ? scheduledAt.toISOString() : null;
      await sendWorkspaceEmail(inquiryId, { accountId, to: to.trim(), cc: cc.trim(), bcc: bcc.trim(), subject: subject.trim(), text, scheduledAt: when, attachments });
      onSent(when);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Nie udało się wysłać wiadomości.');
    } finally {
      setWorking(null);
    }
  };

  const progress = working === 'send' ? (mode === 'later' ? 'Planowanie wysyłki…' : 'Wysyłanie wiadomości…')
    : working === 'improve' ? 'AI poprawia wiadomość…' : working === 'preview' ? 'Przygotowywanie podglądu ze stopką…' : working === 'files' ? 'Dodawanie plików…' : '';
  return (
    <Sheet visible title={preview !== null ? 'Podgląd wiadomości' : 'Wiadomość do klienta'} onClose={() => { if (working !== 'send') onClose(); }} width={820}
      footer={preview !== null ? (
        <TouchableOpacity onPress={() => setPreview(null)} style={kit.secondary}><Feather name="edit-3" size={16} color={colors.primary.gold} /><Text style={kit.secondaryText}>Wróć do edycji</Text></TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity onPress={() => void showPreview()} disabled={Boolean(working) || !accountId} style={[kit.secondary, (Boolean(working) || !accountId) && kit.disabled]}>
            <Feather name="eye" size={16} color={colors.primary.gold} /><Text style={kit.secondaryText}>Podgląd</Text>
          </TouchableOpacity>
          <View style={kit.flex} />
          <TouchableOpacity onPress={onClose} disabled={working === 'send'} style={kit.secondary}><Text style={kit.secondaryText}>Anuluj</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => void send()} disabled={Boolean(working) || !setup || noAccounts} style={[kit.primary, (Boolean(working) || !setup || noAccounts) && kit.disabled]}>
            {working === 'send' ? <ActivityIndicator color={colors.background.primary} /> : <Feather name="send" size={16} color={colors.background.primary} />}
            <Text style={kit.primaryText}>{mode === 'later' ? 'Zaplanuj wysyłkę' : 'Wyślij'}</Text>
          </TouchableOpacity>
        </>
      )}>
      {!setup ? (loadProblem ? <Text style={kit.warningText}>{loadProblem}</Text> : <ActivityIndicator color={colors.primary.gold} />) : preview !== null ? (
        <View style={styles.preview}>
          <WebView originWhitelist={['*']} source={{ html: preview }} style={kit.flex} />
        </View>
      ) : (
        <>
          <Label>Od</Label>
          {noAccounts ? <Text style={kit.warningText}>Nie masz skrzynki, z której możesz wysyłać wiadomości.</Text> : (
            <SelectField value={accountId} onChange={setAccountId} placeholder="Wybierz skrzynkę" options={setup.accounts.map((account) => ({ id: account.id, label: account.label }))} />
          )}
          <Label>Do</Label>
          <TextInput value={to} onChangeText={setTo} style={kit.input} placeholder="email@example.com" placeholderTextColor={ink(0.35)} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
          {copies ? (
            <>
              <Label>DW</Label>
              <TextInput value={cc} onChangeText={setCc} style={kit.input} placeholder="Opcjonalnie" placeholderTextColor={ink(0.35)} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
              <Label>UDW</Label>
              <TextInput value={bcc} onChangeText={setBcc} style={kit.input} placeholder="Opcjonalnie" placeholderTextColor={ink(0.35)} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
            </>
          ) : <TouchableOpacity onPress={() => setCopies(true)}><Text style={kit.link}>Dodaj DW / UDW</Text></TouchableOpacity>}
          <Label>Temat</Label>
          <TextInput value={subject} onChangeText={setSubject} style={kit.input} placeholder="Temat wiadomości" placeholderTextColor={ink(0.35)} />
          <Label>Wiadomość</Label>
          <TextInput value={text} onChangeText={setText} multiline style={[kit.input, styles.message]} placeholder="Treść wiadomości" placeholderTextColor={ink(0.35)} />
          <View style={kit.between}>
            <Text style={[kit.muted, kit.flex]}>Stopka i szablon wybranej skrzynki zostaną dodane automatycznie — zobacz „Podgląd”.</Text>
            <SmallButton label="Popraw z AI" icon="zap" disabled={Boolean(working) || !text.trim()} onPress={() => void improve()} />
          </View>
          <Text style={kit.muted}>AI poprawi język i ton — bez dopisywania cen, terminów ani obietnic.</Text>
          <Label>Załączniki ({files.length})</Label>
          {files.map((file) => (
            <View key={file.uri} style={styles.file}>
              <Feather name="paperclip" size={16} color={colors.text.tertiary} />
              <Text style={[kit.text, kit.flex]} numberOfLines={1}>{file.name}</Text>
              <Text style={kit.muted}>{sizeLabel(file.size)}</Text>
              <TouchableOpacity onPress={() => setFiles((current) => current.filter((entry) => entry.uri !== file.uri))} style={kit.iconButton} accessibilityLabel={`Usuń załącznik ${file.name}`}>
                <Feather name="trash-2" size={16} color={colors.status.error} />
              </TouchableOpacity>
            </View>
          ))}
          <View style={kit.row}>
            <SmallButton label="Dodaj pliki…" icon="paperclip" disabled={Boolean(working)} onPress={() => void addFiles('documents')} />
            <SmallButton label="Zdjęcia…" icon="image" disabled={Boolean(working)} onPress={() => void addFiles('library')} />
          </View>
          {tooLarge ? <Text style={kit.warningText}>Łączny rozmiar załączników przekracza 25 MB.</Text> : null}
          <Label>Wysyłka</Label>
          <Segmented value={mode} onChange={setMode} options={[{ id: 'now', label: 'Wyślij teraz' }, { id: 'later', label: 'Zaplanuj wysyłkę' }]} />
          {mode === 'later' ? <DateTimeField value={scheduledAt} onChange={setScheduledAt} minimum={new Date()} /> : null}
          <Text style={kit.muted}>Wysłana wiadomość trafia do korespondencji zapytania i jest zapisywana jako kontakt z klientem.</Text>
        </>
      )}
      {progress ? <View style={kit.row}><ActivityIndicator color={colors.primary.gold} /><Text style={kit.muted}>{progress}</Text></View> : null}
      {problem ? <Text style={kit.warningText}>{problem}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold },
  strong: { fontWeight: typography.fontWeights.semibold },
  mail: { borderRadius: borderRadius.lg, backgroundColor: glow(0.04), borderWidth: 1, borderColor: glow(0.06), overflow: 'hidden' },
  mailHead: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  mailBody: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  disclosure: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  picker: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: glow(0.05) },
  preview: { height: 560, borderRadius: borderRadius.lg, overflow: 'hidden', backgroundColor: colors.white },
  message: { minHeight: 220, paddingTop: spacing.sm, textAlignVertical: 'top' },
  file: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.sm, borderRadius: borderRadius.md, backgroundColor: glow(0.04) },
});
