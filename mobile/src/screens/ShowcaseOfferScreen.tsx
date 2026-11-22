import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute } from '@react-navigation/native';
import ReorderableList from '../components/ReorderableList';
import ShowcaseConfigurator, { type ShowcaseConfiguratorTarget } from '../components/ShowcaseConfigurator';
import SwipeableRow, { SWIPE_EDGE_WIDTH } from '../components/SwipeableRow';
import WheelPicker from '../components/WheelPicker';
import { crmThemeShowcaseAccent } from '../theme/crmThemePalette';
import { appPalette, colors, spacing, borderRadius, typography, glow, ink, shade } from '../theme';
import {
  showcaseBrand, showcaseOfferApproval, showcaseOfferClient, showcaseOfferClients, showcaseOfferCreate, showcaseOfferEmail, showcaseOfferEmailSend,
  showcaseOfferGeneratePdf, showcaseOfferLocations, showcaseOfferPdf, showcaseOfferPreview, showcaseOfferProduct, showcaseOfferStatus, showcaseProducts,
  type ShowcaseOfferFailure, type ShowcaseProductOption,
} from '../lib/showcaseApi';
import { presetShowcaseOfferDraft, useShowcaseOffer, type ShowcaseOfferChoice } from '../lib/showcaseOffer';
import {
  SHOWCASE_OFFER_DISCOUNT_DISPLAYS, SHOWCASE_OFFER_LIMITS, emptyShowcaseOfferClient, formatShowcaseAmount, formatShowcasePercent, isShowcaseOfferEmail,
  isShowcaseOfferPlaceholder, normalizeShowcaseOfferDraft, showcaseMediaKey, showcaseOfferApprovalHint, showcaseOfferConfiguredLine, showcaseOfferDiscount,
  showcaseOfferLineFor, showcaseOfferPrice, showcaseOfferProblem,
  type ShowcaseMedia, type ShowcaseOfferDiscountDisplay, type ShowcaseOfferApproval, type ShowcaseOfferClient, type ShowcaseOfferClientContext, type ShowcaseOfferClientHit, type ShowcaseOfferConfiguration,
  type ShowcaseOfferEmailSetup, type ShowcaseOfferInquiry, type ShowcaseOfferLine, type ShowcaseOfferLocation, type ShowcaseOfferPreview,
  type ShowcaseOfferResult, type ShowcaseProductView, type ShowcaseUrls,
} from '../lib/showcaseShared';

/*
 * „Oferta ze spotkania” w aplikacji (iPad i telefon) — ten sam przepływ co pokaz w CRM i na Macu: pozycje dodane „Do oferty”
 * na kartach albo „Dodaj pozycję” z katalogu (kolejność — przeciąganie za uchwyt ≡), klient z CRM albo nowy (bez duplikatów),
 * otwarte zapytanie klienta albo nowe (źródło „Rozmowa / spotkanie”), miejsce z bazy lokalizacji albo wpisane, liczba osób,
 * rabat w progach (powyżej progu — akceptacja przed wysłaniem), utworzenie oferty i PDF, PDF na ekranie, wysyłka e-mailem.
 * Rabat pozycji i rabat całej oferty — razem, z rabatem łącznym w podsumowaniu; jak klient widzi rabat w PDF (przy pozycjach,
 * rabat łączny, same ceny po rabacie) — wybór sprzedawcy zapamiętany na serwerze. Pozycje z miniaturą zdjęcia produktu; przesunięcie
 * pozycji w lewo (albo uchwyt ‹‹ przy prawej krawędzi) wsuwa akcje nad prawą część wiersza (zdjęcie, nazwa i ilości zostają na
 * miejscu): zmiana (inny wariant, pakiet albo konfiguracja), rabat pozycji (kółko jak wybór godziny), usunięcie. Osoba kontaktowa
 * firmy — lista wyboru. Scena i ekran LED — od
 * razu konfigurator (`ShowcaseConfigurator`, także z karty pokazu: „Skonfiguruj”). Klient może być roboczy (sama nazwa, bez
 * bazy) — przypisuje się go później w CRM. Ceny liczy serwer CRM; szkic zostaje na urządzeniu.
 */

/** Konfigurator otwarty z karty pokazu („Skonfiguruj” przy scenie albo ekranie LED). */
/** Klient i zapytanie z karty zapytania (tablet) — oferta jako kolejny wariant tego zapytania. */
export type ShowcaseOfferInquiryParam = {
  id: string; title: string; organizationId: string | null; organizationName: string; contactId: string | null; contactName: string; guestCount: number | null;
};
export type ShowcaseOfferRouteParams = {
  configure?: { productId: string; name: string; itemId?: string | null; itemTitle?: string };
  inquiry?: ShowcaseOfferInquiryParam;
} | undefined;

type Picker = 'date' | 'time' | null;
const PRESETS = [0, 5, 10, 15];
/** Rabat na kółku: 0–100% co 1 punkt. */
const DISCOUNT_STEPS = Array.from({ length: 101 }, (_, index) => index);
/** Kółko rabatu: cała oferta, jedna pozycja albo ten sam rabat dla wszystkich pozycji (tryb „na pozycje”). */
type DiscountTarget = { kind: 'offer' } | { kind: 'all' } | { kind: 'line'; key: string; label: string };

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
  const route = useRoute<any>();
  const offer = useShowcaseOffer();
  const { draft, update, setup } = offer;
  const brand = showcaseBrand();
  // Pokaz w kolorach motywu CRM na tym urządzeniu (jak w CRM i na Macu), akcent z księgi znaku (w jasnym motywie — motywu).
  const accent = crmThemeShowcaseAccent(appPalette(), brand?.accent);
  const surface = colors.background.elevated;

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
  const [discountTarget, setDiscountTarget] = useState<DiscountTarget | null>(null);
  const [personPicker, setPersonPicker] = useState(false);
  const [discountValue, setDiscountValue] = useState(0);
  const [picker, setPicker] = useState<Picker>(null);
  const [dragging, setDragging] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationHits, setLocationHits] = useState<ShowcaseOfferLocation[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [addingLine, setAddingLine] = useState(false);
  /** Edytowana pozycja (inny wariant albo pakiet) — okno katalogu od razu na produkcie. */
  const [replacing, setReplacing] = useState<ShowcaseOfferLine | null>(null);
  const [configTarget, setConfigTarget] = useState<ShowcaseConfiguratorTarget | null>(null);
  const scroll = useRef<ScrollView>(null);
  const configureParam = (route.params as ShowcaseOfferRouteParams)?.configure;

  // „Skonfiguruj” na karcie pokazu — konfigurator od razu po wejściu na ekran oferty.
  useEffect(() => {
    if (!configureParam?.productId) return;
    setConfigTarget({
      productId: configureParam.productId, productName: configureParam.name, snapshot: null, quantity: 1, lineKey: null,
      item: configureParam.itemId ? { id: configureParam.itemId, title: configureParam.itemTitle || '' } : null,
    });
    navigation.setParams({ configure: undefined });
  }, [configureParam, navigation]);

  const client = draft.client;
  const chosen = Boolean(client.organizationId || client.contactId);
  /** Klient roboczy (sama nazwa, bez bazy). */
  const placeholderChosen = !chosen && isShowcaseOfferPlaceholder(client);
  const setClient = (patch: Partial<ShowcaseOfferClient>) => update((current) => ({ ...current, client: { ...current.client, ...patch } }));
  const notify = (text: string, error = false) => setMessage({ text, error });

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), message.error ? 7000 : 3500);
    return () => clearTimeout(timer);
  }, [message]);

  // „Nowa oferta” z karty zapytania (tablet): klient i zapytanie od razu w szkicu, pozycje i rabaty szkicu zostają.
  const inquiryParam = (route.params as ShowcaseOfferRouteParams)?.inquiry;
  useEffect(() => {
    if (!inquiryParam?.id) return;
    const target = inquiryParam;
    navigation.setParams({ inquiry: undefined });
    setResult(null); setApproval(null); setEmail(null); setSent(false); setApprovalNote('');
    setQuery(''); setHits([]); setNewClient(false); setNewPerson(false);
    void presetShowcaseOfferDraft((current) => ({
      ...current,
      inquiryId: target.id,
      inquiryTitle: target.title,
      client: {
        ...emptyShowcaseOfferClient(), organizationId: target.organizationId, organizationName: target.organizationName,
        contactId: target.contactId, contactName: target.contactName,
      },
      event: current.event.guestCount == null && target.guestCount ? { ...current.event, guestCount: target.guestCount } : current.event,
    })).then(() => notify(`Oferta do zapytania „${target.title}” — dodaj pozycje z katalogu albo konfiguratora.`));
  }, [inquiryParam, navigation]);

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

  // Podpowiedzi miejsca z bazy lokalizacji (jak w CRM i na Macu).
  useEffect(() => {
    if (!locationOpen) return;
    let active = true;
    setLocationLoading(true);
    const timer = setTimeout(() => {
      showcaseOfferLocations(draft.event.location)
        .then((value) => { if (active) setLocationHits(value.locations); })
        .catch(() => { if (active) setLocationHits([]); })
        .finally(() => { if (active) setLocationLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [locationOpen, draft.event.location]);

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
  // Próg akceptacji liczy rabat łączny (rabaty pozycji i rabat całej oferty).
  const hint = showcaseOfferApprovalHint(setup, preview?.effectiveDiscountPercent ?? draft.discountPercent);
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
  /** Klient roboczy: oferta bez klienta w bazie — sama nazwa, klienta przypisuje się później w CRM. */
  const choosePlaceholder = (name: string) => {
    const placeholder = name.trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!placeholder) return;
    update((current) => ({ ...current, inquiryId: null, inquiryTitle: '', client: { ...emptyShowcaseOfferClient(), placeholder } }));
    setQuery(''); setHits([]); setNewClient(false); setNewPerson(false);
  };
  const removeLine = (line: ShowcaseOfferLine) => {
    update((current) => ({ ...current, lines: current.lines.filter((entry) => entry.key !== line.key) }));
    notify(`Usunięto z oferty: ${line.label}`);
  };
  const openDiscount = (target: DiscountTarget) => {
    const shared = draft.lines.length && draft.lines.every((entry) => entry.discountPercent === draft.lines[0].discountPercent) ? draft.lines[0].discountPercent : 0;
    setDiscountValue(target.kind === 'line' ? draft.lines.find((entry) => entry.key === target.key)?.discountPercent ?? 0
      : target.kind === 'all' ? shared : draft.discountPercent);
    setDiscountTarget(target);
  };
  const applyDiscount = (value: number) => {
    const target = discountTarget;
    setDiscountTarget(null);
    if (!target) return;
    const percent = showcaseOfferDiscount(value);
    if (target.kind === 'line') setLine(target.key, { discountPercent: percent });
    else if (target.kind === 'all') update((current) => ({ ...current, lines: current.lines.map((line) => ({ ...line, discountPercent: percent })) }));
    else update((current) => ({ ...current, discountPercent: percent }));
  };
  /** Jak klient widzi rabat w PDF (preferencja sprzedawcy, zapamiętana na serwerze dla kolejnych ofert). */
  const changeDiscountDisplay = (display: ShowcaseOfferDiscountDisplay) => {
    if (display === draft.discountDisplay) return;
    void offer.setDiscountDisplay(display).then((saved) => {
      if (!saved) notify('Nie udało się zapamiętać ustawienia na serwerze — obowiązuje w tej ofercie.', true);
    });
  };
  const chosenPerson = context?.persons.find((person) => person.id === client.contactId) || null;
  const choosePerson = (personId: string | null) => {
    setPersonPicker(false);
    if (personId === 'new') { setNewPerson(true); setClient({ contactId: null, contactName: '' }); return; }
    const person = context?.persons.find((entry) => entry.id === personId) || null;
    setNewPerson(false);
    setClient({ contactId: person?.id || null, contactName: person?.name || '', firstName: '', lastName: '', email: '', phone: '' });
  };
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

  const setLocation = (location: string, locationId: string | null) => update((current) => ({ ...current, event: { ...current.event, location, locationId } }));
  const typedLocation = draft.event.location.trim();
  const exactLocation = locationHits.some((hit) => hit.label.toLocaleLowerCase('pl-PL') === typedLocation.toLocaleLowerCase('pl-PL'));
  const addLine = (product: ShowcaseProductView, choice: ShowcaseOfferChoice) => {
    const outcome = offer.add(product, choice, null);
    if (outcome.result === 'added') notify(`Dodano do oferty: ${outcome.label}`);
    else if (outcome.result === 'exists') notify(`${outcome.label} jest już w ofercie.`);
    else if (outcome.result === 'full') notify(`Oferta ma już ${SHOWCASE_OFFER_LIMITS.lines} pozycji.`, true);
    else if (product.configurable) { configureProduct(product); return false; }
    else notify(`${product.name} jest wycofany z katalogu.`, true);
    return outcome.result === 'added';
  };

  /** Edycja pozycji z katalogu: inny wariant albo pakiet tego produktu (ilość i dni zostają). */
  const replaceWith = (product: ShowcaseProductView, choice: ShowcaseOfferChoice) => {
    if (!replacing) return false;
    const line = showcaseOfferLineFor(product, choice, replacing.itemId ? { id: replacing.itemId, title: replacing.itemTitle } : null);
    if (!line) { notify(`${product.name} jest wycofany z katalogu.`, true); return false; }
    const outcome = offer.replaceLine(replacing.key, line);
    if (outcome === 'replaced') notify(line.key === replacing.key ? `Bez zmian: ${line.label}` : `Zmieniono pozycję: ${line.label}`);
    else if (outcome === 'exists') { notify(`${line.label} jest już w ofercie.`, true); return false; }
    else notify('Tej pozycji nie ma już w ofercie.', true);
    return true;
  };

  /** Scena albo ekran LED z okna katalogu — konfigurator po zamknięciu okna (iOS pokazuje jedno okno naraz). */
  const configureProduct = (product: ShowcaseProductView) => {
    setAddingLine(false);
    setReplacing(null);
    setTimeout(() => setConfigTarget({ productId: product.id, productName: product.name, snapshot: null, quantity: 1, lineKey: null, item: null }), 400);
  };

  const editLine = (line: ShowcaseOfferLine) => {
    if (line.kind === 'configured' && line.modular) {
      setConfigTarget({
        productId: line.productId, productName: line.label, snapshot: line.modular, quantity: line.quantity, lineKey: line.key,
        item: line.itemId ? { id: line.itemId, title: line.itemTitle } : null,
      });
      return;
    }
    setReplacing(line);
    setAddingLine(true);
  };

  /** Konfiguracja gotowa: nowa pozycja albo zmiana zapisanej (to samo miejsce na liście, ilość i dni bez zmian). */
  const saveConfiguration = (configuration: ShowcaseOfferConfiguration, target: ShowcaseConfiguratorTarget) => {
    const existing = target.lineKey ? draft.lines.find((entry) => entry.key === target.lineKey) || null : null;
    const line = showcaseOfferConfiguredLine({ id: target.productId, name: target.productName }, configuration.snapshot, configuration.view.title,
      target.item, existing?.optionId || undefined);
    if (!line) { notify('Konfiguracja jest za duża albo nieprawidłowa — uprość ją i spróbuj ponownie.', true); return; }
    if (existing) {
      const outcome = offer.replaceLine(existing.key, line);
      notify(outcome === 'replaced' ? `Zapisano konfigurację: ${line.label}` : 'Tej pozycji nie ma już w ofercie.', outcome !== 'replaced');
    } else {
      const outcome = offer.addLine(line);
      if (outcome === 'added') notify(`Dodano do oferty: ${line.label}`);
      else if (outcome === 'full') notify(`Oferta ma już ${SHOWCASE_OFFER_LIMITS.lines} pozycji.`, true);
      else notify(`${line.label} jest już w ofercie.`);
    }
    setConfigTarget(null);
  };

  const newOffer = () => { setResult(null); setApproval(null); setEmail(null); setSent(false); setPreview(null); setApprovalNote(''); };

  const datePart = draft.event.date.split('T')[0] || '';
  const timePart = draft.event.date.includes('T') ? draft.event.date.split('T')[1] : '';
  const setDate = (day: string, time: string) => update((current) => ({ ...current, event: { ...current.event, date: day ? (time ? `${day}T${time}` : day) : '' } }));
  const recipientsValid = emailForm.to.split(/[,;]/).map((value) => value.trim()).filter(Boolean).length > 0
    && emailForm.to.split(/[,;]/).map((value) => value.trim()).filter(Boolean).every(isShowcaseOfferEmail);

  const chip = (label: string, active: boolean, onPress: () => void, key?: string) => (
    <TouchableOpacity key={key || label} onPress={onPress} style={[styles.chip, active && { borderColor: accent, backgroundColor: glow(0.08) }]} accessibilityState={{ selected: active }}>
      <Text style={[styles.chipText, active && { color: accent }]}>{label}</Text>
    </TouchableOpacity>
  );
  const input = (value: string, onChange: (value: string) => void, placeholder: string, extra: Partial<React.ComponentProps<typeof TextInput>> = {}) => (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={ink(0.35)} style={styles.input} autoCorrect={false} {...extra} />
  );
  const inquiryRow = (active: boolean, title: string, detail: string, onPress: () => void, key: string) => (
    <TouchableOpacity key={key} onPress={onPress} style={[styles.inquiry, active && { borderColor: accent, backgroundColor: glow(0.06) }]} accessibilityState={{ selected: active }}>
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
              {result.clientPlaceholder ? <Text style={styles.hint}>Klient roboczy — przypisz klienta w CRM (oferta → Klient) przed wysłaniem oferty.</Text> : null}
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
                {!chosen && !placeholderChosen ? <TouchableOpacity onPress={() => setNewClient((value) => !value)} hitSlop={8}><Text style={{ color: accent }}>{newClient ? 'Szukaj w CRM' : 'Nowy klient'}</Text></TouchableOpacity> : null}
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
                      <TouchableOpacity onPress={() => setPersonPicker(true)} style={styles.select} accessibilityRole="button"
                        accessibilityLabel={`Osoba kontaktowa: ${newPerson ? 'nowa osoba' : chosenPerson?.name || client.contactName || 'bez osoby kontaktowej'}`}>
                        <Feather name={newPerson ? 'user-plus' : 'user'} size={18} color={chosenPerson || newPerson ? accent : colors.text.tertiary} />
                        <View style={styles.flex}>
                          <Text style={chosenPerson || newPerson || client.contactName ? styles.text : styles.placeholder} numberOfLines={1}>
                            {newPerson ? 'Nowa osoba kontaktowa' : chosenPerson?.name || client.contactName || 'Wybierz osobę (opcjonalnie)'}
                          </Text>
                          {chosenPerson && (chosenPerson.email || chosenPerson.phone) ? (
                            <Text style={styles.muted} numberOfLines={1}>{[chosenPerson.email, chosenPerson.phone].filter(Boolean).join(' · ')}</Text>
                          ) : null}
                        </View>
                        <Feather name="chevron-down" size={18} color={colors.text.tertiary} />
                      </TouchableOpacity>
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
              ) : placeholderChosen ? (
                <View style={styles.chosen}>
                  <Feather name="edit-3" size={20} color={accent} />
                  <View style={styles.flex}>
                    <Text style={styles.text}>{client.placeholder}</Text>
                    <Text style={styles.muted}>Klient roboczy — bez dodawania do bazy. Klienta przypiszesz w CRM, zanim wyślesz ofertę.</Text>
                  </View>
                  <TouchableOpacity onPress={() => { setQuery(client.placeholder); clearClient(); }} hitSlop={8}><Text style={{ color: accent }}>Zmień</Text></TouchableOpacity>
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
                  {query.trim().length >= 2 && !searching ? (
                    <TouchableOpacity onPress={() => choosePlaceholder(query)} style={styles.hit} accessibilityRole="button">
                      <Feather name="edit-3" size={18} color={accent} />
                      <View style={styles.flex}>
                        <Text style={styles.text} numberOfLines={1}>Bez bazy: „{query.trim()}”</Text>
                        <Text style={styles.muted} numberOfLines={2}>Klient roboczy — oferta bez klienta w CRM, przypiszesz go później.</Text>
                      </View>
                    </TouchableOpacity>
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
                  <View style={styles.gapXs}>
                    <View style={[styles.input, styles.pickerButton]}>
                      <Feather name="map-pin" size={16} color={accent} />
                      <TextInput value={draft.event.location} onChangeText={(value) => { setLocation(value, null); setLocationOpen(true); }}
                        onFocus={() => setLocationOpen(true)} onBlur={() => setTimeout(() => setLocationOpen(false), 200)}
                        placeholder="Miejsce (np. Hotel Omega, Olsztyn)" placeholderTextColor={ink(0.35)} style={[styles.text, styles.flex, styles.bareInput]} autoCorrect={false} />
                      {draft.event.locationId ? <Feather name="check-circle" size={16} color={accent} accessibilityLabel="Z bazy lokalizacji" /> : null}
                    </View>
                    {locationOpen && (locationHits.length > 0 || locationLoading || (typedLocation && !exactLocation)) ? (
                      <View style={styles.suggestions}>
                        {locationLoading && !locationHits.length ? <Text style={styles.muted}>Szukam w bazie lokalizacji…</Text> : null}
                        {locationHits.slice(0, 6).map((hit) => (
                          <TouchableOpacity key={hit.id} onPress={() => { setLocation(hit.label, hit.id); setLocationOpen(false); }} style={styles.hit}>
                            <Feather name="map-pin" size={16} color={accent} />
                            <View style={styles.flex}>
                              <Text style={styles.text} numberOfLines={1}>{hit.label}</Text>
                              {hit.address ? <Text style={styles.muted} numberOfLines={1}>{hit.address}</Text> : null}
                            </View>
                          </TouchableOpacity>
                        ))}
                        {typedLocation && !exactLocation ? (
                          <TouchableOpacity onPress={() => { setLocation(typedLocation, null); setLocationOpen(false); }} style={styles.hit}>
                            <Feather name="plus" size={16} color={colors.text.tertiary} />
                            <Text style={[styles.muted, styles.flex]} numberOfLines={1}>Użyj wpisanego: „{typedLocation}”</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : null}
                    <Text style={styles.muted}>
                      {draft.event.locationId ? 'Z bazy lokalizacji — zapytanie i oferta będą powiązane z obiektem.'
                        : typedLocation ? 'Własne miejsce — zapisze się jako tekst.' : 'Zacznij pisać — podpowiemy obiekty z bazy lokalizacji.'}
                    </Text>
                  </View>
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
                <View style={styles.row}>
                  {previewing ? <ActivityIndicator color={accent} size="small" /> : null}
                  <TouchableOpacity onPress={() => setAddingLine(true)} disabled={draft.lines.length >= SHOWCASE_OFFER_LIMITS.lines} hitSlop={8}
                    style={[styles.addLine, { borderColor: accent }, draft.lines.length >= SHOWCASE_OFFER_LIMITS.lines && styles.disabled]} accessibilityRole="button">
                    <Feather name="plus" size={16} color={accent} /><Text style={[styles.buttonText, { color: accent }]}>Dodaj pozycję</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {!draft.lines.length ? <Text style={styles.muted}>Dodaj pozycję z katalogu („Dodaj pozycję”) albo przyciskiem „Do oferty” przy wariancie i pakiecie na kartach pokazu.</Text> : null}
              {draft.lines.length ? (
                <Text style={styles.muted}>
                  {draft.lines.length > 1 ? 'Przeciągnij pozycję za uchwyt ≡, żeby zmienić kolejność. ' : ''}Przesuń pozycję w lewo (albo dotknij ‹‹ z prawej), żeby ją zmienić, dać rabat albo usunąć.
                </Text>
              ) : null}
              <ReorderableList items={draft.lines} keyOf={(line) => line.key} onMove={moveLine} onDragChange={setDragging} gap={spacing.sm}
                renderItem={(line, _, handle) => {
                  const view = lineView(line.key);
                  const priced = Boolean(view && !view.error);
                  const discounted = line.discountPercent > 0;
                  return (
                    <SwipeableRow edgeHint reveal="overlay" containerStyle={styles.swipe} rowStyle={{ backgroundColor: surface }}
                      actions={[
                        {
                          key: 'edit', label: line.kind === 'configured' ? 'Konfiguruj' : 'Zmień', icon: line.kind === 'configured' ? 'sliders' : 'edit-2',
                          color: accent, foreground: surface, onPress: () => editLine(line),
                        },
                        { key: 'discount', label: 'Rabat', icon: 'percent', color: '#475569', onPress: () => openDiscount({ kind: 'line', key: line.key, label: view?.name || line.label }) },
                        { key: 'delete', label: 'Usuń', icon: 'trash-2', color: '#DC2626', onPress: () => removeLine(line) },
                      ]}>
                      <View style={[styles.line, { paddingRight: SWIPE_EDGE_WIDTH + spacing.xs }]}>
                        <View style={styles.row}>
                          {handle}
                          {view?.thumbnailUrl ? <Image source={{ uri: view.thumbnailUrl }} style={styles.lineThumb} accessibilityIgnoresInvertColors />
                            : <View style={[styles.lineThumb, styles.catalogEmpty]}><Feather name={line.kind === 'configured' ? 'sliders' : 'package'} size={18} color={colors.text.tertiary} /></View>}
                          <View style={styles.flex}>
                            <Text style={styles.text}>{view?.name || line.label}</Text>
                            {line.kind === 'configured' ? <Text style={styles.muted}>Z konfiguratora</Text> : null}
                            {line.itemTitle ? <Text style={styles.muted}>z karty „{line.itemTitle}”</Text> : null}
                          </View>
                          <View style={styles.alignEnd}>
                            <Text style={[styles.text, { color: accent }]}>{priced ? formatShowcaseAmount(view!.subtotal) : '—'}</Text>
                            {priced && discounted ? <Text style={[styles.muted, styles.strike]}>{formatShowcaseAmount(view!.listSubtotal)}</Text> : null}
                            {priced ? <Text style={styles.muted}>{view!.quantity} × {formatShowcaseAmount(view!.unitPrice)}{view!.days > 1 ? ` × ${view!.days} dni` : ''}</Text> : null}
                          </View>
                        </View>
                        <View style={[styles.row, styles.wrapRow]}>
                          {view?.quantityFromAudience
                            ? <Text style={styles.muted}>{view.quantity} {view.unit === 'stół' ? 'stołów' : 'osób'} (z liczby osób)</Text>
                            : <Stepper value={line.quantity} min={1} max={SHOWCASE_OFFER_LIMITS.quantity} suffix="szt." accent={accent} onChange={(quantity) => setLine(line.key, { quantity })} />}
                          <Stepper value={line.days} min={1} max={SHOWCASE_OFFER_LIMITS.days} suffix={line.days === 1 ? 'dzień' : 'dni'} accent={accent} onChange={(days) => setLine(line.key, { days })} />
                          <TouchableOpacity onPress={() => openDiscount({ kind: 'line', key: line.key, label: view?.name || line.label })}
                            style={[styles.discountChip, discounted && { borderColor: accent, backgroundColor: glow(0.08) }]}
                            accessibilityRole="button" accessibilityLabel={`Rabat pozycji: ${formatShowcasePercent(line.discountPercent)}`}>
                            <Feather name="percent" size={14} color={discounted ? accent : colors.text.tertiary} />
                            <Text style={[styles.chipText, discounted && { color: accent }]}>{discounted ? `Rabat −${formatShowcasePercent(line.discountPercent)}` : 'Rabat'}</Text>
                          </TouchableOpacity>
                        </View>
                        {line.priceOnRequest ? (
                          <TextInput defaultValue={line.agreedPrice == null ? '' : String(line.agreedPrice).replace('.', ',')} onChangeText={(value) => setLine(line.key, { agreedPrice: showcaseOfferPrice(value) })}
                            placeholder="Uzgodniona cena netto (zł)" placeholderTextColor={ink(0.35)} keyboardType="decimal-pad" style={styles.input} />
                        ) : null}
                        {view?.error ? <Text style={styles.error}>{view.error}</Text> : null}
                      </View>
                    </SwipeableRow>
                  );
                }} />
            </View>

            {/* Rabat — pozycji i całej oferty razem; jak klient widzi rabat w PDF (preferencja sprzedawcy) */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Rabat</Text>
              <Text style={styles.label}>Rabat pozycji</Text>
              <Text style={styles.muted}>„Rabat” pod pozycją albo przesunięcie pozycji w lewo.</Text>
              {draft.lines.length > 1 ? (
                <TouchableOpacity onPress={() => openDiscount({ kind: 'all' })} style={[styles.chip, styles.selfStart]} accessibilityRole="button">
                  <Text style={[styles.chipText, { color: accent }]}>Ten sam rabat na wszystkie pozycje…</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.label}>Rabat na całą ofertę</Text>
              <View style={styles.wrap}>
                {PRESETS.map((value) => chip(`${value}%`, draft.discountPercent === value, () => update((current) => ({ ...current, discountPercent: value })), `p${value}`))}
                {chip(PRESETS.includes(draft.discountPercent) ? 'Inny…' : `Inny: ${formatShowcasePercent(draft.discountPercent)}`, !PRESETS.includes(draft.discountPercent),
                  () => openDiscount({ kind: 'offer' }), 'custom')}
              </View>
              <Text style={styles.muted}>Liczy się od wartości pozycji po ich rabatach.</Text>
              {preview && preview.effectiveDiscountPercent > 0 ? (
                <Text style={styles.text}>Rabat łączny: <Text style={{ color: accent }}>{formatShowcasePercent(preview.effectiveDiscountPercent)}</Text> · −{formatShowcaseAmount(preview.lineDiscountAmount + preview.discountAmount)} netto</Text>
              ) : null}
              <Text style={styles.label}>Rabat w PDF dla klienta</Text>
              <View style={[styles.segment, { borderColor: glow(0.15) }]} accessibilityRole="tablist">
                {SHOWCASE_OFFER_DISCOUNT_DISPLAYS.map((display) => {
                  const active = draft.discountDisplay === display.key;
                  return (
                    <TouchableOpacity key={display.key} onPress={() => changeDiscountDisplay(display.key)} style={[styles.segmentItem, active && { backgroundColor: accent }]}
                      accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityHint={display.hint}>
                      <Text style={[styles.chipText, active && { color: surface, fontWeight: typography.fontWeights.semibold }]} numberOfLines={1}>{display.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.muted}>{SHOWCASE_OFFER_DISCOUNT_DISPLAYS.find((display) => display.key === draft.discountDisplay)?.hint} Wybór zapamiętujemy — także w CRM i na Macu.</Text>
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
                  {preview.discountAmount > 0 || preview.lineDiscountAmount > 0 ? (
                    <>
                      <View style={styles.totalRow}><Text style={styles.muted}>Wartość pozycji netto</Text><Text style={styles.muted}>{formatShowcaseAmount(preview.listNet + preview.lineDiscountAmount)}</Text></View>
                      {preview.lineDiscountAmount > 0 ? (
                        <View style={styles.totalRow}><Text style={styles.muted}>Rabaty pozycji</Text><Text style={styles.muted}>−{formatShowcaseAmount(preview.lineDiscountAmount)}</Text></View>
                      ) : null}
                      {preview.discountAmount > 0 ? (
                        <View style={styles.totalRow}><Text style={styles.muted}>Rabat na ofertę {formatShowcasePercent(preview.discountPercent)}</Text><Text style={styles.muted}>−{formatShowcaseAmount(preview.discountAmount)}</Text></View>
                      ) : null}
                      {preview.lineDiscountAmount > 0 && preview.discountAmount > 0 ? (
                        <View style={styles.totalRow}><Text style={styles.muted}>Rabat łączny {formatShowcasePercent(preview.effectiveDiscountPercent)}</Text><Text style={styles.muted}>−{formatShowcaseAmount(preview.lineDiscountAmount + preview.discountAmount)}</Text></View>
                      ) : null}
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
            themeVariant={appPalette().scheme}
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

      <DiscountSheet target={discountTarget} value={discountValue} onValue={setDiscountValue} accent={accent} surface={surface}
        base={discountTarget?.kind === 'line' ? lineView(discountTarget.key)?.listSubtotal ?? null
          : discountTarget?.kind === 'all' ? (preview ? preview.listNet + preview.lineDiscountAmount : null) : preview?.listNet ?? null}
        onCancel={() => setDiscountTarget(null)} onApply={applyDiscount} />

      <PersonSheet visible={personPicker} persons={context?.persons || []} selected={newPerson ? 'new' : client.contactId} accent={accent} surface={surface}
        onClose={() => setPersonPicker(false)} onChoose={choosePerson} />

      <AddLineModal visible={addingLine} accent={accent} surface={surface} replacing={replacing}
        onClose={() => { setAddingLine(false); setReplacing(null); }} onAdd={replacing ? replaceWith : addLine} onConfigure={configureProduct} />

      <ShowcaseConfigurator target={configTarget} accent={accent} surface={surface} onClose={() => setConfigTarget(null)} onSave={saveConfiguration} />

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

/** Wybór osoby kontaktowej firmy (lista na całej szerokości, dotyk): bez osoby, osoby firmy, nowa osoba. */
function PersonSheet({ visible, persons, selected, accent, surface, onClose, onChoose }: {
  visible: boolean; persons: ShowcaseOfferClientContext['persons']; selected: string | null; accent: string; surface: string;
  onClose: () => void; onChoose: (personId: string | null) => void;
}) {
  const option = (key: string, title: string, detail: string, active: boolean, icon: React.ComponentProps<typeof Feather>['name'], value: string | null) => (
    <TouchableOpacity key={key} onPress={() => onChoose(value)} style={[styles.inquiry, active && { borderColor: accent, backgroundColor: glow(0.06) }]}
      accessibilityRole="button" accessibilityState={{ selected: active }}>
      <Feather name={icon} size={18} color={active ? accent : colors.text.tertiary} />
      <View style={styles.flex}>
        <Text style={styles.text} numberOfLines={1}>{title}</Text>
        {detail ? <Text style={styles.muted} numberOfLines={1}>{detail}</Text> : null}
      </View>
      {active ? <Feather name="check" size={18} color={accent} /> : null}
    </TouchableOpacity>
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.sheetBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Zamknij wybór osoby" />
        <View style={[styles.sheet, styles.personSheet, { backgroundColor: surface }]}>
          <Text style={styles.heading}>Osoba kontaktowa</Text>
          <ScrollView style={styles.personList} contentContainerStyle={styles.gapSm}>
            {option('none', 'Bez osoby kontaktowej', 'Oferta na firmę', !selected, 'slash', null)}
            {persons.map((person) => option(person.id, person.name, [person.email, person.phone].filter(Boolean).join(' · '), selected === person.id, 'user', person.id))}
            {option('new', 'Nowa osoba kontaktowa', 'Imię, nazwisko, e-mail, telefon — bez duplikatów', selected === 'new', 'user-plus', 'new')}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Rabat na kółku (jak wybór godziny): pozycji, wszystkich pozycji naraz albo całej oferty. `base` — wartość netto przed
 * rabatem (pozycji albo wszystkich pozycji), do podglądu ceny po rabacie.
 */
function DiscountSheet({ target, value, onValue, base, accent, surface, onCancel, onApply }: {
  target: DiscountTarget | null; value: number; onValue: (value: number) => void; base: number | null; accent: string; surface: string;
  onCancel: () => void; onApply: (value: number) => void;
}) {
  const after = base != null ? Math.round(base * (1 - value / 100) * 100) / 100 : null;
  return (
    <Modal visible={Boolean(target)} transparent animationType="fade" onRequestClose={onCancel} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.sheetBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Zamknij wybór rabatu" />
        <View style={[styles.sheet, { backgroundColor: surface }]}>
          <Text style={styles.heading}>{target?.kind === 'line' ? 'Rabat pozycji' : target?.kind === 'all' ? 'Rabat na każdą pozycję' : 'Rabat na całą ofertę'}</Text>
          <Text style={styles.muted} numberOfLines={2}>
            {target?.kind === 'line' ? target.label : target?.kind === 'all' ? 'Ten sam rabat przy każdej pozycji — zastąpi rabaty ustawione wcześniej.' : 'Liczy się od wartości wszystkich pozycji.'}
          </Text>
          <View style={styles.wheel}>
            {target ? (
              <WheelPicker values={DISCOUNT_STEPS} value={value} onChange={onValue} format={formatShowcasePercent} accent={accent}
                label={target.kind === 'line' ? 'Rabat pozycji w procentach' : target.kind === 'all' ? 'Rabat każdej pozycji w procentach' : 'Rabat całej oferty w procentach'} width={200} />
            ) : null}
          </View>
          {base != null && after != null ? (
            <Text style={[styles.text, styles.center]}>
              {value > 0 ? `${formatShowcaseAmount(base)} → ` : ''}<Text style={{ color: accent }}>{formatShowcaseAmount(after)}</Text> netto
            </Text>
          ) : null}
          <View style={styles.row}>
            <TouchableOpacity onPress={() => onApply(0)} style={[styles.button, styles.flex]} accessibilityRole="button">
              <Text style={[styles.buttonText, { color: accent }]}>Bez rabatu</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onApply(value)} style={[styles.button, styles.flex, { backgroundColor: accent }]} accessibilityRole="button">
              <Text style={[styles.buttonText, { color: surface }]}>Gotowe</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * „Dodaj pozycję”: produkt z katalogu (wyszukiwanie), potem wariant, pakiet albo sam produkt — jak „Do oferty” na kartach
 * (CRM, Mac); scena i ekran LED — od razu konfigurator. `replacing` — edycja pozycji: od razu jej produkt.
 */

function AddLineModal({ visible, accent, surface, replacing, onClose, onAdd, onConfigure }: {
  visible: boolean; accent: string; surface: string; replacing: ShowcaseOfferLine | null; onClose: () => void;
  onAdd: (product: ShowcaseProductView, choice: ShowcaseOfferChoice) => boolean;
  onConfigure: (product: ShowcaseProductView) => void;
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ShowcaseProductOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState('');
  const [product, setProduct] = useState<{ view: ShowcaseProductView; urls: ShowcaseUrls } | null>(null);

  useEffect(() => { if (!visible) { setProduct(null); setQuery(''); setProblem(''); } }, [visible]);
  // Edycja pozycji — od razu warianty i pakiety jej produktu.
  useEffect(() => {
    if (!visible || !replacing) return;
    let active = true;
    setLoading(true);
    showcaseOfferProduct(replacing.productId)
      .then((data) => { if (active) setProduct({ view: data.product, urls: data.urls }); })
      .catch((cause) => { if (active) setProblem(cause instanceof Error ? cause.message : 'Nie udało się pobrać produktu.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [visible, replacing]);
  useEffect(() => {
    if (!visible || product || replacing) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      showcaseProducts(query)
        .then((data) => { if (active) { setOptions(data.products); setProblem(data.products.length ? '' : 'Brak produktów pasujących do wyszukiwania.'); } })
        .catch((cause) => { if (active) { setOptions([]); setProblem(cause instanceof Error ? cause.message : 'Nie udało się pobrać katalogu.'); } })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [visible, query, product]);

  const open = async (id: string) => {
    setLoading(true);
    try {
      const data = await showcaseOfferProduct(id);
      // Scena albo ekran LED — od razu konfigurator (bez okna pośredniego); bez wariantów i pakietów — od razu sam produkt.
      if (data.product.configurable) { onConfigure(data.product); return; }
      if (!data.product.variants.length && !data.product.packages.length) { if (onAdd(data.product, { kind: 'product' })) onClose(); return; }
      setProduct({ view: data.product, urls: data.urls });
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Nie udało się pobrać produktu.');
    } finally {
      setLoading(false);
    }
  };
  const thumb = (media: ShowcaseMedia | null) => (media && product ? product.urls[showcaseMediaKey(media)]?.thumb || null : null);
  const choose = (choice: ShowcaseOfferChoice) => { if (product && onAdd(product.view, choice)) onClose(); };
  /** Wybrany wariant albo pakiet edytowanej pozycji. */
  const current = (kind: string, id: string) => Boolean(replacing && replacing.kind === kind && replacing.optionId === id);
  const optionRow = (key: string, title: string, detail: string, image: string | null, price: string, onPress: () => void, disabled = false) => (
    <TouchableOpacity key={key} onPress={onPress} disabled={disabled} style={[styles.catalogRow, disabled && styles.disabled]}>
      {image ? <Image source={{ uri: image }} style={styles.catalogThumb} /> : <View style={[styles.catalogThumb, styles.catalogEmpty]}><Feather name="package" size={18} color={colors.text.tertiary} /></View>}
      <View style={styles.flex}>
        <Text style={styles.text} numberOfLines={1}>{title}</Text>
        {detail ? <Text style={styles.muted} numberOfLines={1}>{detail}</Text> : null}
      </View>
      {price ? <Text style={[styles.text, { color: accent }]}>{price}</Text> : null}
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']} presentationStyle="pageSheet">
      <View style={[styles.flex, { backgroundColor: surface }]}>
        <View style={styles.modalHead}>
          {product && !replacing ? (
            <TouchableOpacity onPress={() => setProduct(null)} hitSlop={10} style={styles.iconButton} accessibilityLabel="Wróć do katalogu"><Feather name="chevron-left" size={22} color={accent} /></TouchableOpacity>
          ) : null}
          <Text style={[styles.heading, styles.flex]} numberOfLines={1}>{replacing ? `Zmień: ${product?.view.name || replacing.label}` : product ? product.view.name : 'Dodaj pozycję z katalogu'}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.iconButton} accessibilityLabel="Zamknij"><Feather name="x" size={22} color={accent} /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          {!product && !replacing ? (
            <>
              <TextInput value={query} onChangeText={setQuery} placeholder="Szukaj produktu w katalogu" placeholderTextColor={ink(0.35)} style={styles.input}
                autoCorrect={false} returnKeyType="search" />
              {options.map((option) => optionRow(option.id, option.name,
                [option.category, option.priceNet != null ? `${formatShowcaseAmount(option.priceNet)} netto${option.unit ? ` / ${option.unit}` : ''}` : ''].filter(Boolean).join(' · '),
                option.thumbnailUrl, '', () => void open(option.id)))}
            </>
          ) : product ? (
            <>
              {product.view.configurable ? (
                <View style={[styles.card, styles.gapSm]}>
                  <Text style={styles.text}>Produkt z konfiguratorem: rozmiar, wysokość albo układ ekranu, warianty sprzętu i cena zestawu.</Text>
                  <TouchableOpacity onPress={() => onConfigure(product.view)} style={[styles.primary, { backgroundColor: accent }]} accessibilityRole="button">
                    <Feather name="sliders" size={18} color={surface} /><Text style={[styles.primaryText, { color: surface }]}>Skonfiguruj</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {replacing && !product.view.configurable && !product.view.packages.length && !product.view.variants.length ? (
                <Text style={styles.muted}>Ten produkt nie ma wariantów ani pakietów — ilość i dni zmienisz na liście pozycji.</Text>
              ) : null}
              {!product.view.configurable && product.view.packages.length ? <Text style={styles.label}>Pakiety</Text> : null}
              {!product.view.configurable ? product.view.packages.map((pack) => optionRow(pack.id, `${pack.name}${current('package', pack.id) ? ' · w ofercie' : ''}`, pack.scope, thumb(pack.image),
                pack.priceOnRequest ? 'wycena indywidualna' : pack.priceNet != null ? formatShowcaseAmount(pack.priceNet) : '',
                () => choose({ kind: 'package', optionId: pack.id }))) : null}
              {!product.view.configurable && product.view.variants.length ? <Text style={styles.label}>Warianty</Text> : null}
              {!product.view.configurable ? product.view.variants.map((variant) => optionRow(variant.id,
                `${variant.name}${variant.recommended ? ' · polecany' : ''}${current('variant', variant.id) ? ' · w ofercie' : ''}`, variant.shortDescription, thumb(variant.image),
                variant.priceNet != null ? formatShowcaseAmount(variant.priceNet) : '', () => choose({ kind: 'variant', optionId: variant.id }))) : null}
            </>
          ) : null}
          {loading ? <ActivityIndicator color={accent} /> : problem ? <Text style={styles.muted}>{problem}</Text> : null}
        </ScrollView>
      </View>
    </Modal>
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
  section: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.xl, backgroundColor: shade(0.22), borderWidth: 1, borderColor: glow(0.08) },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.text.primary, fontSize: typography.fontSizes.lg },
  card: { gap: spacing.xs, padding: spacing.md, borderRadius: borderRadius.xl, backgroundColor: shade(0.25), borderWidth: 1, borderColor: glow(0.08) },
  warning: { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.35)', overflow: 'hidden' },
  heading: { color: colors.text.primary, fontSize: typography.fontSizes.lg },
  text: { color: colors.text.primary, fontSize: typography.fontSizes.md },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm },
  placeholder: { color: ink(0.35), fontSize: typography.fontSizes.md },
  label: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textTransform: 'uppercase', marginTop: spacing.xs },
  hint: { color: colors.status.warning, fontSize: typography.fontSizes.sm },
  error: { color: colors.status.error, fontSize: typography.fontSizes.sm },
  input: {
    minHeight: 46, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.text.primary,
    fontSize: typography.fontSizes.md, backgroundColor: shade(0.3), borderWidth: 1, borderColor: glow(0.1),
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  discountChip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: borderRadius.full, borderWidth: 1, borderColor: glow(0.15) },
  strike: { textDecorationLine: 'line-through' },
  swipe: { borderRadius: borderRadius.lg },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  sheet: { width: '100%', maxWidth: 420, gap: spacing.sm, padding: spacing.lg, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: glow(0.1) },
  wheel: { alignItems: 'center', paddingVertical: spacing.sm },
  pickerButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wrapRow: { flexWrap: 'wrap', marginTop: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: borderRadius.full, borderWidth: 1, borderColor: glow(0.15) },
  segment: { flexDirection: 'row', borderRadius: borderRadius.full, borderWidth: 1, padding: 3, gap: 3 },
  selfStart: { alignSelf: 'flex-start' },
  select: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: glow(0.15), backgroundColor: shade(0.2) },
  personSheet: { width: '100%', maxWidth: 560, maxHeight: '80%' },
  personList: { flexGrow: 0 },
  segmentItem: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: borderRadius.full },
  chipText: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  chosen: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: shade(0.25) },
  hit: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: shade(0.2) },
  inquiry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: glow(0.08) },
  line: { padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: shade(0.25), borderWidth: 1, borderColor: glow(0.08), gap: spacing.xs },
  alignEnd: { alignItems: 'flex-end' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: borderRadius.full, backgroundColor: shade(0.3) },
  stepperButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { minWidth: 64, textAlign: 'center', color: colors.text.primary, fontSize: typography.fontSizes.sm },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: shade(0.3) },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  total: { fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.semibold },
  primary: { minHeight: 52, borderRadius: borderRadius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm },
  primaryText: { fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  secondary: { minHeight: 52, borderRadius: borderRadius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: shade(0.3), borderWidth: 1, borderColor: glow(0.1) },
  button: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: shade(0.3) },
  buttonText: { fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold },
  disabled: { opacity: 0.4 },
  center: { textAlign: 'center' },
  pickerPanel: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: spacing.lg, borderTopWidth: 1, borderTopColor: glow(0.1) },
  pickerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md },
  toast: {
    position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: glow(0.12),
  },
  toastError: { borderColor: colors.status.error },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  busyBox: { gap: spacing.md, alignItems: 'center', padding: spacing.lg, borderRadius: borderRadius.xl, maxWidth: 360 },
  pdfHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: 52, paddingBottom: spacing.sm },
  bareInput: { paddingVertical: 0, minHeight: 0 },
  suggestions: { gap: spacing.xs, padding: spacing.xs, borderRadius: borderRadius.lg, backgroundColor: shade(0.35), borderWidth: 1, borderColor: glow(0.1) },
  addLine: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: borderRadius.full, borderWidth: 1 },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: glow(0.1) },
  modalContent: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  catalogRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 64, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: shade(0.25), borderWidth: 1, borderColor: glow(0.08) },
  catalogThumb: { width: 64, height: 48, borderRadius: borderRadius.md, backgroundColor: shade(0.3) },
  catalogEmpty: { alignItems: 'center', justifyContent: 'center' },
  lineThumb: { width: 56, height: 42, borderRadius: borderRadius.md, backgroundColor: shade(0.3) },
});
