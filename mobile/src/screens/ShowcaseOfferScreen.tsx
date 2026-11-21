import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { WebView } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import ReorderableList from '../components/ReorderableList';
import { colors, spacing, borderRadius, typography } from '../theme';
import {
  showcaseBrand, showcaseOfferApproval, showcaseOfferClient, showcaseOfferClients, showcaseOfferCreate, showcaseOfferEmail, showcaseOfferEmailSend,
  showcaseOfferGeneratePdf, showcaseOfferPdf, showcaseOfferPreview, showcaseOfferStatus, type ShowcaseOfferFailure,
} from '../lib/showcaseApi';
import { useShowcaseOffer } from '../lib/showcaseOffer';
import {
  SHOWCASE_OFFER_LIMITS, emptyShowcaseOfferClient, formatShowcaseAmount, formatShowcasePercent, isShowcaseOfferEmail, normalizeShowcaseOfferDraft,
  showcaseOfferApprovalHint, showcaseOfferDiscount, showcaseOfferPrice, showcaseOfferProblem,
  type ShowcaseOfferApproval, type ShowcaseOfferClient, type ShowcaseOfferClientContext, type ShowcaseOfferClientHit, type ShowcaseOfferEmailSetup,
  type ShowcaseOfferInquiry, type ShowcaseOfferLine, type ShowcaseOfferPreview, type ShowcaseOfferResult,
} from '../lib/showcaseShared';

/*
 * „Oferta ze spotkania” w aplikacji (iPad i telefon) — ten sam przepływ co pokaz w CRM i na Macu: pozycje dodane „Do oferty”
 * na kartach (kolejność — przeciąganie za uchwyt ≡), klient z CRM albo nowy (bez duplikatów), otwarte zapytanie klienta albo
 * nowe (źródło „Rozmowa / spotkanie”), liczba osób, rabat w progach (powyżej progu — akceptacja przed wysłaniem), utworzenie
 * oferty i PDF, PDF na ekranie, wysyłka e-mailem. Ceny liczy serwer CRM; szkic zostaje na urządzeniu.
 */

type Picker = 'date' | 'time' | null;
const PRESETS = [0, 5, 10, 15];

const dateLabel = (value: string | null) => {
  if (!value) return '';
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}${time ? `, ${time}` : ''}`;
};
const pad = (value: number) => String(value).padStart(2, '0');
const dayOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const timeOf = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const parseDraftDate = (value: string) => {
  const [day, time] = value.split('T');
  const [year, month, date] = (day || '').split('-').map(Number);
  const [hour, minute] = (time || '19:00').split(':').map(Number);
  const parsed = new Date(year || new Date().getFullYear(), (month || 1) - 1, date || 1, hour || 0, minute || 0);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

export default function ShowcaseOfferScreen() {
  const navigation = useNavigation<any>();
  const offer = useShowcaseOffer();
  const { draft, update, setup } = offer;
  const brand = showcaseBrand();
  const accent = brand?.accent || colors.primary.gold;
  const surface = brand?.surface || '#1c1f33';

  const [preview, setPreview] = useState<ShowcaseOfferPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ShowcaseOfferClientHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [newClient, setNewClient] = useState(false);
  const [context, setContext] = useState<ShowcaseOfferClientContext | null>(null);
  const [newPerson, setNewPerson] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ShowcaseOfferResult | null>(null);
  const [pdfReady, setPdfReady] = useState(false);
  const [approval, setApproval] = useState<ShowcaseOfferApproval | null>(null);
  const [approvalNote, setApprovalNote] = useState('');
  const [email, setEmail] = useState<ShowcaseOfferEmailSetup | null>(null);
  const [emailForm, setEmailForm] = useState({ to: '', subject: '', text: '', accountId: '' });
  const [sent, setSent] = useState(false);
  const [customDiscount, setCustomDiscount] = useState('');
  const [picker, setPicker] = useState<Picker>(null);
  const [dragging, setDragging] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const scroll = useRef<ScrollView>(null);

  const client = draft.client;
  const chosen = Boolean(client.organizationId || client.contactId);
  const setClient = (patch: Partial<ShowcaseOfferClient>) => update((current) => ({ ...current, client: { ...current.client, ...patch } }));
  const notify = (text: string, error = false) => setMessage({ text, error });

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), message.error ? 7000 : 3500);
    return () => clearTimeout(timer);
  }, [message]);

  // Własny rabat po wczytaniu szkicu.
  useEffect(() => {
    setCustomDiscount(PRESETS.includes(draft.discountPercent) ? '' : String(draft.discountPercent).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);

  // Podgląd cen z serwera.
  const previewKey = JSON.stringify({ lines: draft.lines, discount: draft.discountPercent, guests: draft.event.guestCount });
  useEffect(() => {
    if (result) return;
    if (!draft.lines.length) { setPreview(null); setPreviewError(''); return; }
    let active = true;
    setPreviewing(true);
    const timer = setTimeout(() => {
      showcaseOfferPreview(normalizeShowcaseOfferDraft(draft))
        .then((value) => { if (active) { setPreview(value); setPreviewError(''); } })
        .catch((cause) => { if (active) setPreviewError(cause instanceof Error ? cause.message : 'Nie udało się przeliczyć oferty.'); })
        .finally(() => { if (active) setPreviewing(false); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, result]);

  // Wyszukiwanie klienta w CRM.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2 || chosen) { setHits([]); return; }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      showcaseOfferClients(term)
        .then((value) => { if (active) setHits(value.clients); })
        .catch(() => { if (active) setHits([]); })
        .finally(() => { if (active) setSearching(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query, chosen]);

  // Osoby firmy i otwarte zapytania klienta.
  useEffect(() => {
    if (!chosen) { setContext(null); return; }
    let active = true;
    showcaseOfferClient({ organization: client.organizationId, contact: client.contactId })
      .then((value) => { if (active) setContext(value); })
      .catch(() => { if (active) setContext({ persons: [], inquiries: [] }); });
    return () => { active = false; };
  }, [chosen, client.organizationId, client.contactId]);

  const normalized = useMemo(() => normalizeShowcaseOfferDraft(draft), [draft]);
  const problem = showcaseOfferProblem(normalized) || preview?.problem || previewError || null;
  const hint = showcaseOfferApprovalHint(setup, preview?.discountPercent ?? draft.discountPercent);
  const canCreate = offer.canOffer && !problem && !previewing && Boolean(preview) && !busy;
  const selectedInquiry = context?.inquiries.find((entry) => entry.id === draft.inquiryId) || null;
  const lineView = (key: string) => preview?.lines.find((entry) => entry.key === key) || null;

  const choose = (hit: ShowcaseOfferClientHit) => {
    update((current) => ({
      ...current, inquiryId: null, inquiryTitle: '',
      client: { ...emptyShowcaseOfferClient(), organizationId: hit.organizationId, organizationName: hit.organizationName,
        contactId: hit.kind === 'contact' ? hit.id : null, contactName: hit.kind === 'contact' ? hit.name : '' },
    }));
    setQuery(''); setHits([]); setNewPerson(false);
  };
  const clearClient = () => { update((current) => ({ ...current, inquiryId: null, inquiryTitle: '', client: emptyShowcaseOfferClient() })); setContext(null); setNewPerson(false); };
  const chooseInquiry = (inquiry: ShowcaseOfferInquiry | null) => update((current) => ({
    ...current, inquiryId: inquiry?.id || null, inquiryTitle: inquiry?.title || '',
    event: inquiry && current.event.guestCount == null && inquiry.guestCount ? { ...current.event, guestCount: inquiry.guestCount } : current.event,
  }));
  const setLine = (key: string, patch: Partial<ShowcaseOfferLine>) => update((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }));
  const moveLine = (from: number, to: number) => update((current) => {
    const lines = [...current.lines];
    const [moved] = lines.splice(from, 1);
    if (!moved) return current;
    lines.splice(to, 0, moved);
    return { ...current, lines };
  });

  const generatePdf = async (created: ShowcaseOfferResult) => {
    setBusy('Generuję PDF oferty… (do kilku minut)');
    try {
      await showcaseOfferGeneratePdf(created.offerId);
      setPdfReady(true);
    } catch (cause) {
      setPdfReady(false);
      notify(`Oferta ${created.number} jest zapisana, ale PDF się nie wygenerował: ${cause instanceof Error ? cause.message : 'spróbuj ponownie.'}`, true);
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!canCreate) return;
    setBusy('Tworzę ofertę i zapytanie…');
    let created: ShowcaseOfferResult;
    try {
      created = await showcaseOfferCreate(normalized);
    } catch (cause) {
      const saved = cause as ShowcaseOfferFailure;
      if (saved?.inquiryId) {
        // Zapytanie i klient już są w CRM — ponowna próba dopina do nich ofertę.
        update((current) => ({
          ...current,
          inquiryId: saved.inquiryId!,
          inquiryTitle: current.inquiryTitle || 'Zapytanie ze spotkania',
          client: saved.organizationId || saved.contactId
            ? { ...current.client, organizationId: saved.organizationId || null, contactId: saved.contactId || null, company: '', nip: '', firstName: '', lastName: '' }
            : current.client,
        }));
      }
      setBusy(null);
      notify(cause instanceof Error ? cause.message : 'Nie udało się utworzyć oferty.', true);
      return;
    }
    setResult(created);
    setApproval(created.approval);
    setPdfReady(false);
    setSent(false);
    setEmail(null);
    offer.reset();
    scroll.current?.scrollTo({ y: 0, animated: false });
    await generatePdf(created);
  };

  const showPdf = async () => {
    if (!result) return;
    setBusy('Otwieram PDF…');
    try {
      const pdf = await showcaseOfferPdf(result.offerId);
      // iOS pokazuje PDF w aplikacji; Android — w przeglądarce lub aplikacji do PDF.
      if (Platform.OS === 'ios') setPdfUrl(pdf.url);
      else await Linking.openURL(pdf.url);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Nie udało się otworzyć PDF.', true);
    } finally {
      setBusy(null);
    }
  };

  const openEmail = async () => {
    if (!result) return;
    setBusy('Przygotowuję wiadomość…');
    try {
      const value = await showcaseOfferEmail(result.offerId);
      setEmail(value);
      setEmailForm({ to: value.to || result.clientEmail, subject: value.subject, text: value.text, accountId: value.accounts[0]?.id || '' });
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Nie udało się przygotować wiadomości.', true);
    } finally {
      setBusy(null);
    }
  };

  const sendEmail = async () => {
    if (!result || !email) return;
    setBusy('Wysyłam ofertę…');
    try {
      const value = await showcaseOfferEmailSend({ id: result.offerId, ...emailForm, recipientName: email.recipientName });
      setSent(true);
      setEmail(null);
      notify(value.warning || `Oferta ${result.number} wysłana do ${emailForm.to}.`, Boolean(value.warning));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Nie udało się wysłać oferty.', true);
    } finally {
      setBusy(null);
    }
  };

  const requestApproval = async () => {
    if (!result) return;
    setBusy('Wysyłam prośbę o akceptację…');
    try {
      setApproval(await showcaseOfferApproval(result.offerId, approvalNote));
      notify('Prośba o akceptację rabatu wysłana — dostaniesz powiadomienie po decyzji.');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Nie udało się wysłać prośby o akceptację.', true);
    } finally {
      setBusy(null);
    }
  };

  const refreshStatus = async () => {
    if (!result) return;
    try {
      const status = await showcaseOfferStatus(result.offerId);
      setApproval(status.approval);
      setPdfReady(status.pdfReady);
      if (status.approval.required && status.approval.canSend) notify('Rabat zaakceptowany — możesz wysłać ofertę.');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Nie udało się odświeżyć oferty.', true);
    }
  };

  const newOffer = () => { setResult(null); setApproval(null); setEmail(null); setSent(false); setPreview(null); setApprovalNote(''); setCustomDiscount(''); };

  const datePart = draft.event.date.split('T')[0] || '';
  const timePart = draft.event.date.includes('T') ? draft.event.date.split('T')[1] : '';
  const setDate = (day: string, time: string) => update((current) => ({ ...current, event: { ...current.event, date: day ? (time ? `${day}T${time}` : day) : '' } }));
  const recipientsValid = emailForm.to.split(/[,;]/).map((value) => value.trim()).filter(Boolean).length > 0
    && emailForm.to.split(/[,;]/).map((value) => value.trim()).filter(Boolean).every(isShowcaseOfferEmail);

  const chip = (label: string, active: boolean, onPress: () => void, key?: string) => (
    <TouchableOpacity key={key || label} onPress={onPress} style={[styles.chip, active && { borderColor: accent, backgroundColor: 'rgba(255,255,255,0.08)' }]} accessibilityState={{ selected: active }}>
      <Text style={[styles.chipText, active && { color: accent }]}>{label}</Text>
    </TouchableOpacity>
  );
  const input = (value: string, onChange: (value: string) => void, placeholder: string, extra: Partial<React.ComponentProps<typeof TextInput>> = {}) => (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="rgba(229,228,226,0.35)" style={styles.input} autoCorrect={false} {...extra} />
  );
  const inquiryRow = (active: boolean, title: string, detail: string, onPress: () => void, key: string) => (
    <TouchableOpacity key={key} onPress={onPress} style={[styles.inquiry, active && { borderColor: accent, backgroundColor: 'rgba(255,255,255,0.06)' }]} accessibilityState={{ selected: active }}>
      <Feather name={active ? 'check-circle' : 'circle'} size={18} color={active ? accent : colors.text.tertiary} />
      <View style={styles.flex}>
        <Text style={styles.text} numberOfLines={1}>{title}</Text>
        {detail ? <Text style={styles.muted} numberOfLines={1}>{detail}</Text> : null}
      </View>
    </TouchableOpacity>
  );

  const primary = [styles.primary, { backgroundColor: accent }];

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: surface }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" scrollEnabled={!dragging}>
        {result ? (
          <View style={styles.gap}>
            <View style={styles.card}>
              <Feather name="check-circle" size={28} color={accent} />
              <Text style={styles.heading}>Oferta {result.number} jest gotowa</Text>
              <Text style={styles.muted}>{result.clientName}{result.inquiryCreated ? ' · nowe zapytanie w CRM' : ' · dopięta do zapytania klienta'}</Text>
              <Text style={[styles.total, { color: accent }]}>{formatShowcaseAmount(result.gross)} brutto</Text>
              <Text style={styles.muted}>{formatShowcaseAmount(result.net)} netto</Text>
            </View>
            {approval?.required && !approval.canSend ? (
              <View style={[styles.card, styles.warning]}>
                <Text style={styles.text}>{approval.reasons.join(' · ') || 'Rabat przekracza próg.'}</Text>
                <Text style={styles.muted}>{approval.status === 'pending' ? 'Prośba o akceptację czeka na decyzję. Ofertę możesz już pokazać klientowi.' : 'Ofertę możesz pokazać klientowi od razu — wyślesz ją po akceptacji rabatu.'}</Text>
                {approval.status !== 'pending' ? input(approvalNote, setApprovalNote, 'Uzasadnienie (opcjonalnie), np. stały klient', { maxLength: 1000 }) : null}
                <View style={styles.row}>
                  {approval.status !== 'pending' ? (
                    <TouchableOpacity onPress={requestApproval} disabled={Boolean(busy)} style={[styles.button, { backgroundColor: accent }]}><Text style={[styles.buttonText, { color: surface }]}>Poproś o akceptację</Text></TouchableOpacity>
                  ) : null}
                  <TouchableOpacity onPress={refreshStatus} style={styles.button}><Text style={[styles.buttonText, { color: accent }]}>Sprawdź decyzję</Text></TouchableOpacity>
                </View>
              </View>
            ) : null}
            {pdfReady ? (
              <TouchableOpacity onPress={showPdf} style={primary}><Feather name="file-text" size={18} color={surface} /><Text style={[styles.primaryText, { color: surface }]}>Pokaż PDF klientowi</Text></TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => void generatePdf(result)} disabled={Boolean(busy)} style={primary}><Feather name="refresh-cw" size={18} color={surface} /><Text style={[styles.primaryText, { color: surface }]}>Wygeneruj PDF</Text></TouchableOpacity>
            )}
            <TouchableOpacity onPress={openEmail} disabled={!pdfReady || Boolean(busy) || sent || approval?.canSend === false}
              style={[styles.secondary, (!pdfReady || sent || approval?.canSend === false) && styles.disabled]}>
              <Feather name="mail" size={18} color={accent} /><Text style={[styles.primaryText, { color: accent }]}>{sent ? 'Wysłano e-mailem' : 'Wyślij e-mailem'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={newOffer} style={styles.secondary}><Feather name="plus" size={18} color={accent} /><Text style={[styles.primaryText, { color: accent }]}>Nowa oferta</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.secondary}><Feather name="arrow-left" size={18} color={accent} /><Text style={[styles.primaryText, { color: accent }]}>Wróć do pokazu</Text></TouchableOpacity>
            {email ? (
              <View style={styles.card}>
                <Text style={styles.heading}>Wyślij ofertę {email.number}</Text>
                {email.accounts.length ? (
                  <>
                    <Text style={styles.label}>Z adresu</Text>
                    <View style={styles.wrap}>{email.accounts.map((account) => chip(account.label, emailForm.accountId === account.id, () => setEmailForm((form) => ({ ...form, accountId: account.id })), account.id))}</View>
                    <Text style={styles.label}>Do (kilka adresów oddziel przecinkiem)</Text>
                    {input(emailForm.to, (to) => setEmailForm((form) => ({ ...form, to })), 'adres@klienta.pl', { keyboardType: 'email-address', autoCapitalize: 'none' })}
                    <Text style={styles.label}>Temat</Text>
                    {input(emailForm.subject, (subject) => setEmailForm((form) => ({ ...form, subject })), 'Temat')}
                    <Text style={styles.label}>Treść</Text>
                    {input(emailForm.text, (text) => setEmailForm((form) => ({ ...form, text })), 'Treść', { multiline: true, style: [styles.input, styles.multiline] })}
                    <Text style={styles.muted}>Stopka firmy dołączy się jak w CRM. PDF oferty w załączniku.</Text>
                    <View style={styles.row}>
                      <TouchableOpacity onPress={() => setEmail(null)} style={styles.button}><Text style={[styles.buttonText, { color: accent }]}>Anuluj</Text></TouchableOpacity>
                      <TouchableOpacity onPress={sendEmail} disabled={Boolean(busy) || !emailForm.accountId || !emailForm.subject.trim() || !emailForm.text.trim() || !recipientsValid}
                        style={[styles.button, { backgroundColor: accent }, (!emailForm.accountId || !emailForm.subject.trim() || !emailForm.text.trim() || !recipientsValid) && styles.disabled]}>
                        <Text style={[styles.buttonText, { color: surface }]}>Wyślij</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : <Text style={styles.muted}>Nie masz skrzynki do wysyłki. Dodaj ją w CRM (Wiadomości → Skrzynki) albo wyślij ofertę z CRM.</Text>}
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.gap}>
            {setup && !setup.canOffer ? <Text style={[styles.card, styles.warning, styles.text]}>{setup.reason}</Text> : null}

            {/* Klient */}
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Klient</Text>
                {!chosen ? <TouchableOpacity onPress={() => setNewClient((value) => !value)} hitSlop={8}><Text style={{ color: accent }}>{newClient ? 'Szukaj w CRM' : 'Nowy klient'}</Text></TouchableOpacity> : null}
              </View>
              {chosen ? (
                <View style={styles.gapSm}>
                  <View style={styles.chosen}>
                    <Feather name={client.organizationId ? 'briefcase' : 'user'} size={20} color={accent} />
                    <View style={styles.flex}>
                      <Text style={styles.text}>{client.organizationName || client.contactName || 'Klient z CRM'}</Text>
                      {client.organizationId && client.contactName ? <Text style={styles.muted}>{client.contactName}</Text> : null}
                    </View>
                    <TouchableOpacity onPress={clearClient} hitSlop={8}><Text style={{ color: accent }}>Zmień</Text></TouchableOpacity>
                  </View>
                  {client.organizationId && context ? (
                    <>
                      <Text style={styles.label}>Osoba kontaktowa</Text>
                      <View style={styles.wrap}>
                        {context.persons.map((person) => chip(person.name, client.contactId === person.id, () => {
                          const active = client.contactId === person.id;
                          setNewPerson(false);
                          setClient({ contactId: active ? null : person.id, contactName: active ? '' : person.name, firstName: '', lastName: '', email: '', phone: '' });
                        }, person.id))}
                        {chip('+ Nowa osoba', newPerson, () => { setNewPerson((value) => !value); setClient({ contactId: null, contactName: '' }); }, 'new-person')}
                      </View>
                      {newPerson ? (
                        <View style={styles.gapSm}>
                          {input(client.firstName, (firstName) => setClient({ firstName }), 'Imię')}
                          {input(client.lastName, (lastName) => setClient({ lastName }), 'Nazwisko')}
                          {input(client.email, (value) => setClient({ email: value }), 'E-mail', { keyboardType: 'email-address', autoCapitalize: 'none' })}
                          {input(client.phone, (phone) => setClient({ phone }), 'Telefon', { keyboardType: 'phone-pad' })}
                        </View>
                      ) : null}
                    </>
                  ) : null}
                  {context ? (
                    <>
                      <Text style={styles.label}>Zapytanie</Text>
                      {inquiryRow(!draft.inquiryId, 'Nowe zapytanie', 'Źródło: rozmowa na spotkaniu · etap „Zakwalifikowane”', () => chooseInquiry(null), 'new')}
                      {context.inquiries.map((inquiry) => inquiryRow(draft.inquiryId === inquiry.id, inquiry.title,
                        [inquiry.stageLabel, dateLabel(inquiry.date), inquiry.location].filter(Boolean).join(' · '), () => chooseInquiry(inquiry), inquiry.id))}
                      {draft.inquiryId && !selectedInquiry ? inquiryRow(true, draft.inquiryTitle || 'Zapytanie klienta', 'Oferta trafi do tego zapytania', () => undefined, 'saved') : null}
                    </>
                  ) : null}
                </View>
              ) : newClient ? (
                <View style={styles.gapSm}>
                  {input(client.company, (company) => setClient({ company }), 'Firma (opcjonalnie)')}
                  {input(client.nip, (nip) => setClient({ nip }), 'NIP', { keyboardType: 'number-pad' })}
                  {input(client.firstName, (firstName) => setClient({ firstName }), 'Imię')}
                  {input(client.lastName, (lastName) => setClient({ lastName }), 'Nazwisko')}
                  {input(client.email, (value) => setClient({ email: value }), 'E-mail', { keyboardType: 'email-address', autoCapitalize: 'none' })}
                  {input(client.phone, (phone) => setClient({ phone }), 'Telefon', { keyboardType: 'phone-pad' })}
                  <Text style={styles.muted}>Bez duplikatów: istniejąca firma (NIP, nazwa) i osoba (e-mail, telefon) zostaną użyte zamiast nowych.</Text>
                </View>
              ) : (
                <View style={styles.gapSm}>
                  {input(query, setQuery, 'Firma, NIP, osoba, e-mail albo telefon', { autoCapitalize: 'none', returnKeyType: 'search' })}
                  {searching ? <ActivityIndicator color={accent} /> : null}
                  {hits.map((hit) => (
                    <TouchableOpacity key={`${hit.kind}:${hit.id}`} onPress={() => choose(hit)} style={styles.hit}>
                      <Feather name={hit.kind === 'organization' ? 'briefcase' : 'user'} size={18} color={accent} />
                      <View style={styles.flex}>
                        <Text style={styles.text} numberOfLines={1}>{hit.name}</Text>
                        {hit.detail ? <Text style={styles.muted} numberOfLines={1}>{hit.detail}</Text> : null}
                      </View>
                    </TouchableOpacity>
                  ))}
                  {query.trim().length >= 2 && !searching && !hits.length ? (
                    <TouchableOpacity onPress={() => setNewClient(true)}><Text style={styles.muted}>Brak wyników. <Text style={{ color: accent }}>Dodaj nowego klienta</Text></Text></TouchableOpacity>
                  ) : null}
                </View>
              )}
            </View>

            {/* Wydarzenie */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Wydarzenie</Text>
              {draft.inquiryId ? (
                <Text style={styles.muted}>
                  Termin, miejsce i ustalenia z zapytania „{selectedInquiry?.title || draft.inquiryTitle || 'klienta'}”
                  {selectedInquiry && (selectedInquiry.date || selectedInquiry.location) ? ` (${[dateLabel(selectedInquiry.date), selectedInquiry.location].filter(Boolean).join(', ')})` : ''}.
                </Text>
              ) : (
                <View style={styles.gapSm}>
                  {input(draft.event.name, (name) => update((current) => ({ ...current, event: { ...current.event, name } })), 'Nazwa wydarzenia (np. Gala firmowa 2027)')}
                  <View style={styles.row}>
                    <TouchableOpacity onPress={() => setPicker('date')} style={[styles.input, styles.flex, styles.pickerButton]}>
                      <Feather name="calendar" size={16} color={accent} />
                      <Text style={datePart ? styles.text : styles.placeholder}>{datePart ? dateLabel(datePart) : 'Termin'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => datePart && setPicker('time')} disabled={!datePart} style={[styles.input, styles.flex, styles.pickerButton, !datePart && styles.disabled]}>
                      <Feather name="clock" size={16} color={accent} />
                      <Text style={timePart ? styles.text : styles.placeholder}>{timePart || 'Godzina (opcjonalnie)'}</Text>
                    </TouchableOpacity>
                    {datePart ? <TouchableOpacity onPress={() => setDate('', '')} hitSlop={8} accessibilityLabel="Wyczyść termin"><Feather name="x" size={18} color={colors.text.tertiary} /></TouchableOpacity> : null}
                  </View>
                  {input(draft.event.location, (location) => update((current) => ({ ...current, event: { ...current.event, location } })), 'Miejsce (np. hotel, miasto)')}
                </View>
              )}
              <Text style={styles.label}>Liczba osób</Text>
              {input(draft.event.guestCount == null ? '' : String(draft.event.guestCount), (value) => {
                const digits = value.replace(/\D/g, '').slice(0, 6);
                update((current) => ({ ...current, event: { ...current.event, guestCount: digits ? Math.min(100000, Number(digits)) || null : null } }));
              }, 'np. 120', { keyboardType: 'number-pad' })}
              <Text style={styles.muted}>Ceny „na osobę” i „na stół” liczą się z tej liczby.</Text>
            </View>

            {/* Pozycje */}
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Pozycje ({draft.lines.length})</Text>
                {previewing ? <ActivityIndicator color={accent} size="small" /> : null}
              </View>
              {!draft.lines.length ? <Text style={styles.muted}>Dodaj warianty i pakiety przyciskiem „Do oferty” na kartach pokazu — trafią tutaj.</Text> : null}
              {draft.lines.length > 1 ? <Text style={styles.muted}>Przeciągnij pozycję za uchwyt ≡, żeby zmienić kolejność w ofercie.</Text> : null}
              <ReorderableList items={draft.lines} keyOf={(line) => line.key} onMove={moveLine} onDragChange={setDragging} gap={spacing.sm}
                renderItem={(line, _, handle) => {
                  const view = lineView(line.key);
                  return (
                    <View style={styles.line}>
                      <View style={styles.row}>
                        {handle}
                        <View style={styles.flex}>
                          <Text style={styles.text}>{view?.name || line.label}</Text>
                          {line.itemTitle ? <Text style={styles.muted}>z karty „{line.itemTitle}”</Text> : null}
                        </View>
                        <View style={styles.alignEnd}>
                          <Text style={[styles.text, { color: accent }]}>{view && !view.error ? formatShowcaseAmount(view.subtotal) : '—'}</Text>
                          {view && !view.error ? <Text style={styles.muted}>{view.quantity} × {formatShowcaseAmount(view.unitPrice)}{view.days > 1 ? ` × ${view.days} dni` : ''}</Text> : null}
                        </View>
                      </View>
                      <View style={[styles.row, styles.wrapRow]}>
                        {view?.quantityFromAudience
                          ? <Text style={styles.muted}>{view.quantity} {view.unit === 'stół' ? 'stołów' : 'osób'} (z liczby osób)</Text>
                          : <Stepper value={line.quantity} min={1} max={SHOWCASE_OFFER_LIMITS.quantity} suffix="szt." accent={accent} onChange={(quantity) => setLine(line.key, { quantity })} />}
                        <Stepper value={line.days} min={1} max={SHOWCASE_OFFER_LIMITS.days} suffix={line.days === 1 ? 'dzień' : 'dni'} accent={accent} onChange={(days) => setLine(line.key, { days })} />
                        <TouchableOpacity onPress={() => update((current) => ({ ...current, lines: current.lines.filter((entry) => entry.key !== line.key) }))} hitSlop={8}
                          style={styles.iconButton} accessibilityLabel={`Usuń: ${line.label}`}>
                          <Feather name="trash-2" size={16} color={colors.text.secondary} />
                        </TouchableOpacity>
                      </View>
                      {line.priceOnRequest ? (
                        <TextInput defaultValue={line.agreedPrice == null ? '' : String(line.agreedPrice).replace('.', ',')} onChangeText={(value) => setLine(line.key, { agreedPrice: showcaseOfferPrice(value) })}
                          placeholder="Uzgodniona cena netto (zł)" placeholderTextColor="rgba(229,228,226,0.35)" keyboardType="decimal-pad" style={styles.input} />
                      ) : null}
                      {view?.error ? <Text style={styles.error}>{view.error}</Text> : null}
                    </View>
                  );
                }} />
            </View>

            {/* Rabat */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Rabat</Text>
              <View style={styles.wrap}>
                {PRESETS.map((value) => chip(`${value}%`, draft.discountPercent === value && !customDiscount, () => { setCustomDiscount(''); update((current) => ({ ...current, discountPercent: value })); }, `p${value}`))}
                <TextInput value={customDiscount} placeholder="Inny %" placeholderTextColor="rgba(229,228,226,0.35)" keyboardType="decimal-pad" style={[styles.input, styles.discountInput]}
                  onChangeText={(value) => {
                    const clean = value.replace(/[^\d.,]/g, '').slice(0, 6);
                    setCustomDiscount(clean);
                    update((current) => ({ ...current, discountPercent: showcaseOfferDiscount(clean) }));
                  }} />
              </View>
              {hint ? <Text style={styles.hint}>{hint}</Text> : null}
            </View>

            {/* Notatka */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Notatka ze spotkania</Text>
              {input(draft.note, (note) => update((current) => ({ ...current, note: note.slice(0, SHOWCASE_OFFER_LIMITS.note) })), 'Co ustaliliście? (zostaje w CRM, nie trafia do PDF)', { multiline: true, style: [styles.input, styles.multiline] })}
            </View>

            {/* Podsumowanie */}
            <View style={styles.section}>
              {preview ? (
                <View style={styles.gapXs}>
                  {preview.discountAmount > 0 ? (
                    <>
                      <View style={styles.totalRow}><Text style={styles.muted}>Wartość pozycji netto</Text><Text style={styles.muted}>{formatShowcaseAmount(preview.listNet)}</Text></View>
                      <View style={styles.totalRow}><Text style={styles.muted}>Rabat {formatShowcasePercent(preview.discountPercent)}</Text><Text style={styles.muted}>−{formatShowcaseAmount(preview.discountAmount)}</Text></View>
                    </>
                  ) : null}
                  <View style={styles.totalRow}><Text style={styles.text}>Netto · VAT {preview.taxPercent}% {formatShowcaseAmount(preview.tax)}</Text><Text style={styles.text}>{formatShowcaseAmount(preview.net)}</Text></View>
                  <View style={styles.totalRow}><Text style={[styles.total, { color: accent }]}>Brutto</Text><Text style={[styles.total, { color: accent }]}>{formatShowcaseAmount(preview.gross)}</Text></View>
                </View>
              ) : null}
              {problem && draft.lines.length ? <Text style={styles.hint}>{problem}</Text> : null}
              <TouchableOpacity onPress={create} disabled={!canCreate} style={[primary, !canCreate && styles.disabled]}>
                <Feather name="file-text" size={18} color={surface} /><Text style={[styles.primaryText, { color: surface }]}>Utwórz ofertę i PDF</Text>
              </TouchableOpacity>
              <Text style={[styles.muted, styles.center]}>Oferta ważna {setup?.validDays ?? SHOWCASE_OFFER_LIMITS.validDays} dni · szkic zapisuje się na tym urządzeniu</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {picker ? (
        <View style={[styles.pickerPanel, { backgroundColor: surface }]}>
          {Platform.OS === 'ios' ? (
            <View style={styles.pickerHead}>
              <Text style={styles.text}>{picker === 'date' ? 'Wybierz datę' : 'Wybierz godzinę'}</Text>
              <TouchableOpacity onPress={() => setPicker(null)} hitSlop={8}><Text style={{ color: accent }}>Gotowe</Text></TouchableOpacity>
            </View>
          ) : null}
          <DateTimePicker
            value={parseDraftDate(draft.event.date || dayOf(new Date()))}
            mode={picker}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            is24Hour
            locale="pl-PL"
            minuteInterval={5}
            themeVariant="dark"
            onChange={(event, selected) => {
              if (Platform.OS === 'android') setPicker(null);
              if (event.type === 'dismissed' || !selected) return;
              if (picker === 'date') setDate(dayOf(selected), timePart);
              else setDate(datePart || dayOf(selected), timeOf(selected));
            }}
          />
        </View>
      ) : null}

      {message ? (
        <View style={[styles.toast, { backgroundColor: surface }, message.error && styles.toastError]} pointerEvents="none">
          <Feather name={message.error ? 'alert-triangle' : 'check-circle'} size={18} color={message.error ? colors.status.error : accent} />
          <Text style={[styles.text, styles.flex]}>{message.text}</Text>
        </View>
      ) : null}

      {busy ? (
        <View style={styles.busy}>
          <View style={[styles.busyBox, { backgroundColor: surface }]}>
            <ActivityIndicator color={accent} size="large" />
            <Text style={[styles.text, styles.center]}>{busy}</Text>
          </View>
        </View>
      ) : null}

      <Modal visible={Boolean(pdfUrl)} animationType="slide" onRequestClose={() => setPdfUrl(null)} supportedOrientations={['portrait', 'landscape']}>
        <View style={[styles.flex, { backgroundColor: '#000' }]}>
          <View style={styles.pdfHead}>
            <Text style={[styles.text, styles.flex]} numberOfLines={1}>{result ? `Oferta ${result.number}` : 'Oferta'}</Text>
            <TouchableOpacity onPress={() => setPdfUrl(null)} hitSlop={10} style={styles.iconButton} accessibilityLabel="Zamknij PDF"><Feather name="x" size={22} color={accent} /></TouchableOpacity>
          </View>
          {pdfUrl ? <WebView source={{ uri: pdfUrl }} style={styles.flex} startInLoadingState /> : null}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Stepper({ value, min, max, suffix, accent, onChange }: { value: number; min: number; max: number; suffix: string; accent: string; onChange: (value: number) => void }) {
  return (
    <View style={styles.stepper}>
      <TouchableOpacity onPress={() => onChange(Math.max(min, value - 1))} disabled={value <= min} style={styles.stepperButton} accessibilityLabel={`Mniej (${suffix})`}>
        <Feather name="minus" size={16} color={value <= min ? colors.text.disabled : accent} />
      </TouchableOpacity>
      <Text style={styles.stepperValue}>{value} {suffix}</Text>
      <TouchableOpacity onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} style={styles.stepperButton} accessibilityLabel={`Więcej (${suffix})`}>
        <Feather name="plus" size={16} color={value >= max ? colors.text.disabled : accent} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl * 2 },
  gap: { gap: spacing.md },
  gapSm: { gap: spacing.sm },
  gapXs: { gap: spacing.xs },
  section: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.xl, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.text.primary, fontSize: typography.fontSizes.lg },
  card: { gap: spacing.xs, padding: spacing.md, borderRadius: borderRadius.xl, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  warning: { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.35)', overflow: 'hidden' },
  heading: { color: colors.text.primary, fontSize: typography.fontSizes.lg },
  text: { color: colors.text.primary, fontSize: typography.fontSizes.md },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm },
  placeholder: { color: 'rgba(229,228,226,0.35)', fontSize: typography.fontSizes.md },
  label: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textTransform: 'uppercase', marginTop: spacing.xs },
  hint: { color: colors.status.warning, fontSize: typography.fontSizes.sm },
  error: { color: colors.status.error, fontSize: typography.fontSizes.sm },
  input: {
    minHeight: 46, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.text.primary,
    fontSize: typography.fontSizes.md, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  discountInput: { minWidth: 96, minHeight: 40, paddingVertical: 6 },
  pickerButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wrapRow: { flexWrap: 'wrap', marginTop: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: borderRadius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  chipText: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  chosen: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: 'rgba(0,0,0,0.25)' },
  hit: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: 'rgba(0,0,0,0.2)' },
  inquiry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  line: { padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: spacing.xs },
  alignEnd: { alignItems: 'flex-end' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: borderRadius.full, backgroundColor: 'rgba(0,0,0,0.3)' },
  stepperButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { minWidth: 64, textAlign: 'center', color: colors.text.primary, fontSize: typography.fontSizes.sm },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  total: { fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.semibold },
  primary: { minHeight: 52, borderRadius: borderRadius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm },
  primaryText: { fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  secondary: { minHeight: 52, borderRadius: borderRadius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  button: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  buttonText: { fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold },
  disabled: { opacity: 0.4 },
  center: { textAlign: 'center' },
  pickerPanel: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: spacing.lg, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  pickerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md },
  toast: {
    position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  toastError: { borderColor: colors.status.error },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  busyBox: { gap: spacing.md, alignItems: 'center', padding: spacing.lg, borderRadius: borderRadius.xl, maxWidth: 360 },
  pdfHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: 52, paddingBottom: spacing.sm },
});
