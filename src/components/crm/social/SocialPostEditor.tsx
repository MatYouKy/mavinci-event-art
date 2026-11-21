'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CalendarClock, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCopy, Copy, Download, History,
  Images, LayoutTemplate, Link2, PauseCircle, Plus, RefreshCw, RotateCcw, Save, Send, Trash2, Undo2, X, XCircle, Zap,
} from 'lucide-react';
import OverlayPortal from '@/components/UI/OverlayPortal';
import { Modal } from '@/components/UI/Modal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { useDialog } from '@/contexts/DialogContext';
import {
  SOCIAL_CHANNELS, SOCIAL_CHANNEL_LABELS, SOCIAL_FORMATS, SOCIAL_FORMAT_INFO, SOCIAL_KICKER_SUGGESTIONS, SOCIAL_LIMITS,
  SOCIAL_POST_ACTION_LABELS, SOCIAL_POST_ACTION_SUCCESS, SOCIAL_SLIDE_FORMATS, channelFormat, effectiveCrop, isSocialCrop, isSocialSlideFormat, normalizeHashtags,
  socialPostEditable, socialPublicationText, type SocialChannel, type SocialCrop, type SocialFormat, type SocialGraphicStyle,
  type SocialPostAction,
} from '@/lib/social/socialShared';
import {
  downloadSocialPackage, socialGet, socialPost, type SocialAsset, type SocialEventOption, type SocialPostDetail,
} from './socialApi';
import SocialCropEditor from './SocialCropEditor';
import SocialStylePicker from './SocialStylePicker';
import SocialLayoutPicker, { CanvasPicker, sameLayoutChoice, type SocialLayoutChoice } from './SocialLayoutPicker';
import SocialLayoutEditor from './SocialLayoutEditor';
import {
  socialAspectCrop, socialCanvasCrossings, socialCanvasTiles, socialCropFitsAspect, socialLayoutSlotAspect, socialLayoutSlots,
  type SocialCanvas, type SocialLayoutDefinition,
} from '@/lib/social/socialLayout';
import SocialAssistant from './SocialAssistant';
import SocialComments from './SocialComments';
import { MetaPublishPanel } from './SocialMetaPanel';
import SocialLibrary, { EventPicker } from './SocialLibrary';
import {
  CanvasGridPreview, CanvasPreview, FacebookPreview, GraphicView, InstagramFeedPreview, LinkedInPreview, ProfileGridPreview, StoryPreview, useAccountName,
  type GraphicSource,
} from './SocialPreviews';
import {
  ConsentBadge, PostStatusBadge, cardClass, dangerButton, dateTimeLabel, errorMessage, fromLocalInput, inputClass, primaryButton,
  secondaryButton, toLocalInput,
} from './socialUi';

/*
 * Kreator posta (pełny ekran): kanały, termin, wydarzenie, formaty grafik 4:5 / 1:1 / 9:16 / 1,91:1 ze zdjęciem z biblioteki,
 * styl grafiki (miniatury), edytor kadru z polami stylu i szablonu, napis nad tytułem, tytuł i podpis grafiki, opis i hashtagi,
 * karuzela (Instagram do 10 zdjęć, Facebook — kilka zdjęć: kolejne zdjęcia z kadrem w każdym formacie feedu, kolejność
 * przeciąganiem), asystent AI, podglądy (feed, siatka profilu, relacja, Facebook, LinkedIn), braki przed akceptacją i publikacją, historia oraz akcje statusu. Zapis renderuje grafiki na serwerze
 * (ten sam plik dla CRM, Maca i telefonu).
 */

type VariantDraft = { enabled: boolean; asset: SocialAsset | null; crop: SocialCrop | null; touched: boolean };
/** Kolejne zdjęcie karuzeli: kadr w formatach feedu (`null` — propozycja zdjęcia); `touched` — kadr zmieniony w kreatorze. */
type SlideDraft = { asset: SocialAsset; crops: Partial<Record<SocialFormat, SocialCrop | null>>; touched: Partial<Record<SocialFormat, boolean>> };
/** Zdjęcie kolażu w miejscu 1–3 układu (miejsce 0 — zdjęcie wariantu): kadr w każdym formacie w proporcjach miejsca. */
type SlotDraft = { slot: number; asset: SocialAsset; crops: Partial<Record<SocialFormat, SocialCrop | null>>; touched: Partial<Record<SocialFormat, boolean>> };
type Draft = {
  title: string;
  channels: SocialChannel[];
  scheduledAt: string;
  caption: string;
  hashtags: string;
  templateId: string | null;
  eventId: string | null;
  eventName: string | null;
  headline: string;
  subline: string;
  /** Styl grafiki i napis nad tytułem — wspólne dla wszystkich formatów posta. */
  style: SocialGraphicStyle;
  kicker: string;
  variants: Record<SocialFormat, VariantDraft>;
  slides: SlideDraft[];
  /** Układ jako dane (`null` — styl grafiki) i zdjęcia kolażu. */
  layout: SocialLayoutChoice;
  /** Ten sam układ, ale w aktualnej wersji (zmieniony w edytorze układów po zapisaniu posta) — zapis z `refresh`. */
  layoutRefresh: boolean;
  slots: SlotDraft[];
};
type PreviewTab = 'feed' | 'grid' | 'story' | 'facebook' | 'linkedin';

const HISTORY_LABELS: Record<string, string> = {
  created: 'Utworzono', submitted: 'Wysłano do akceptacji', approved: 'Zatwierdzono', changes_requested: 'Do poprawy',
  reopened: 'Przywrócono do szkicu', edited_after_approval: 'Zmiana po zatwierdzeniu', cancelled: 'Anulowano', published: 'Opublikowano',
  scheduled: 'Zaplanowano publikację', unscheduled: 'Wstrzymano publikację', publish_failed: 'Błąd publikacji',
};

/** Domyślny termin planowania: zapisany termin w przyszłości albo jutro 18:00. */
function defaultScheduleInput(value: string | null) {
  const saved = value ? new Date(value) : null;
  if (saved && saved.getTime() > Date.now() + 5 * 60_000) return toLocalInput(saved.toISOString());
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(18, 0, 0, 0);
  return toLocalInput(date.toISOString());
}

function draftFrom(detail: SocialPostDetail): Draft {
  const variants = Object.fromEntries(SOCIAL_FORMATS.map((format) => {
    const variant = detail.variants.find((item) => item.format === format);
    return [format, { enabled: Boolean(variant), asset: variant?.asset || null, crop: variant?.crop || null, touched: false }];
  })) as Record<SocialFormat, VariantDraft>;
  const first = detail.variants[0];
  return {
    title: detail.post.title,
    channels: detail.post.channels,
    scheduledAt: toLocalInput(detail.post.scheduledAt),
    caption: detail.post.caption,
    hashtags: detail.post.hashtags.join(' '),
    templateId: detail.post.templateId,
    eventId: detail.event?.id || detail.post.eventId,
    eventName: detail.event?.name || null,
    headline: first?.headline || '',
    subline: first?.subline || '',
    style: first?.style || detail.template?.defaultStyle || 'classic',
    kicker: first?.kicker || '',
    variants,
    slides: [...(detail.slides || [])].sort((a, b) => a.position - b.position).filter((slide) => slide.asset).map((slide) => ({
      asset: slide.asset as SocialAsset,
      crops: Object.fromEntries(slide.formats.map((item) => [item.format, item.crop])) as SlideDraft['crops'],
      touched: {},
    })),
    layout: detail.layout ? { id: detail.layout.id, key: detail.layout.key } : null,
    layoutRefresh: false,
    slots: [...(detail.slots || [])].sort((a, b) => a.slot - b.slot).filter((item) => item.asset).map((item) => ({
      slot: item.slot,
      asset: item.asset as SocialAsset,
      crops: Object.fromEntries(item.formats.map((entry) => [entry.format, entry.crop])) as SlotDraft['crops'],
      touched: {},
    })),
  };
}

/** Definicja wybranego układu: migawka zapisana w poście (ten sam wybór) albo aktualna z listy układów. */
function layoutDefinitionOf(detail: SocialPostDetail | null, choice: SocialLayoutChoice, refresh = false): SocialLayoutDefinition | null {
  if (!detail || !choice) return null;
  if (!refresh && detail.layout && sameLayoutChoice(choice, { id: detail.layout.id, key: detail.layout.key })) return detail.layout.definition;
  return (detail.layouts || []).find((option) => sameLayoutChoice(choice, { id: option.id, key: option.key }))?.definition || null;
}

export default function SocialPostEditor({ postId, onClose, onChanged, onOpenPost, focusComments = false }: {
  postId: string; onClose: () => void; onChanged: () => void; onOpenPost: (id: string) => void; focusComments?: boolean;
}) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const { showConfirm } = useDialog();
  const [detail, setDetail] = useState<SocialPostDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [active, setActive] = useState<SocialFormat>('4:5');
  const [preview, setPreview] = useState<PreviewTab>('feed');
  const [picker, setPicker] = useState<SocialFormat | 'all' | null>(null);
  /** Karuzela: wybrane zdjęcie (`null` — okładka), okno wyboru zdjęć („dodaj” albo wymiana zdjęcia na pozycji), przeciąganie. */
  const [slideIndex, setSlideIndex] = useState<number | null>(null);
  const [slidePicker, setSlidePicker] = useState<'add' | number | null>(null);
  const [dragSlide, setDragSlide] = useState<number | null>(null);
  /** Kolaż: edytowane miejsce (1–3; `null` — zdjęcie wariantu) i okno wyboru zdjęcia do miejsca. */
  const [slotEdit, setSlotEdit] = useState<number | null>(null);
  const [slotPicker, setSlotPicker] = useState<number | null>(null);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  /** Szerokość kolumny na podgląd całej dużej grafiki (siatka, panorama). */
  const [canvasBox, setCanvasBox] = useState<HTMLDivElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(640);
  useEffect(() => {
    if (!canvasBox) return;
    const measure = () => setCanvasWidth(Math.max(280, Math.floor(canvasBox.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvasBox);
    return () => observer.disconnect();
  }, [canvasBox]);
  const [eventPicker, setEventPicker] = useState(false);
  const [noteAction, setNoteAction] = useState<SocialPostAction | null>(null);
  const [note, setNote] = useState('');
  const [publishUrl, setPublishUrl] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');

  const apply = useCallback((value: SocialPostDetail) => {
    setDetail(value);
    const next = draftFrom(value);
    setDraft(next);
    setDirty(false);
    setActive((current) => (next.variants[current].enabled ? current : SOCIAL_FORMATS.find((format) => next.variants[format].enabled) || '4:5'));
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await socialGet<SocialPostDetail>('post', { id: postId }));
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się otworzyć posta.'), 'error');
      onClose();
    }
  }, [apply, postId, showSnackbar, onClose]);

  useEffect(() => { void load(); }, [load]);

  // Publikacja z harmonogramu trwa na serwerze — odświeżamy kartę, aż się skończy.
  const publishing = detail?.post.status === 'publishing';
  useEffect(() => {
    if (!publishing || dirty) return;
    const timer = window.setInterval(() => {
      void socialGet<SocialPostDetail>('post', { id: postId }).then(apply).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [publishing, dirty, postId, apply]);

  useEffect(() => {
    if (!focusComments || !detail) return;
    window.setTimeout(() => document.getElementById('social-post-comments')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }, [focusComments, detail?.post.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const account = useAccountName(detail?.company.name || '');
  const editable = Boolean(detail && draft && detail.access.create && socialPostEditable(detail.post.status));

  const change = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  };
  const changeVariant = (format: SocialFormat, patch: Partial<VariantDraft>) => {
    setDraft((current) => current ? { ...current, variants: { ...current.variants, [format]: { ...current.variants[format], ...patch } } } : current);
    setDirty(true);
  };
  const changeSlides = (update: (slides: SlideDraft[]) => SlideDraft[]) => {
    setDraft((current) => (current ? { ...current, slides: update(current.slides) } : current));
    setDirty(true);
  };
  const moveSlide = (from: number, to: number) => changeSlides((slides) => {
    if (from === to || to < 0 || to >= slides.length) return slides;
    const next = [...slides];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  });

  const run = async <T,>(title: string, action: () => Promise<T>, success?: string, description = 'Proszę chwilę poczekać...'): Promise<T | null> => {
    showLoader(title, description);
    try {
      const result = await action();
      if (success) showSnackbar(success, 'success');
      return result;
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Operacja nie powiodła się.'), 'error');
      return null;
    } finally {
      hideLoader();
    }
  };

  const payload = () => {
    if (!draft || !detail) return null;
    return {
      id: detail.post.id,
      updatedAt: detail.post.updatedAt,
      title: draft.title,
      channels: draft.channels,
      scheduledAt: fromLocalInput(draft.scheduledAt),
      caption: draft.caption,
      hashtags: normalizeHashtags(draft.hashtags),
      templateId: draft.templateId,
      eventId: draft.eventId,
      variants: SOCIAL_FORMATS.filter((format) => draft.variants[format].enabled).map((format) => ({
        format,
        assetId: draft.variants[format].asset?.id || null,
        crop: draft.variants[format].touched ? draft.variants[format].crop : (detail.variants.find((item) => item.format === format)?.crop || null),
        headline: draft.headline,
        subline: draft.subline,
        style: draft.style,
        kicker: draft.kicker,
      })),
      // Karuzela: kolejność = pozycje; kadr tylko w zmienionych formatach (pozostałe — zapisane kadry tego zdjęcia).
      slides: draft.slides.map((slide) => ({
        assetId: slide.asset.id,
        crops: Object.fromEntries(SOCIAL_SLIDE_FORMATS.filter((format) => slide.touched[format]).map((format) => [format, slide.crops[format] ?? null])),
      })),
      // Układ (ten sam co w poście — serwer zostawia zapisaną migawkę) i zdjęcia kolażu z kadrami zmienionymi w kreatorze.
      layout: draft.layout ? { id: draft.layout.id, key: draft.layout.key, ...(draft.layoutRefresh ? { refresh: true } : {}) } : null,
      slots: draft.slots.map((item) => ({
        slot: item.slot,
        assetId: item.asset.id,
        crops: Object.fromEntries(SOCIAL_FORMATS.filter((format) => item.touched[format]).map((format) => [format, item.crops[format] ?? null])),
      })),
    };
  };

  const save = async (silentSuccess = false): Promise<SocialPostDetail | null> => {
    const body = payload();
    if (!body) return null;
    if (!body.variants.length) { showSnackbar('Włącz co najmniej jeden format grafiki.', 'warning'); return null; }
    if (!body.channels.length) { showSnackbar('Wybierz co najmniej jeden kanał publikacji.', 'warning'); return null; }
    const result = await run('Zapisuję post', () => socialPost<SocialPostDetail>('savePost', body), silentSuccess ? undefined : 'Zapisano post i wygenerowano grafiki', 'Zapis treści i render grafik na serwerze…');
    if (result) { apply(result); onChanged(); }
    return result;
  };

  const transition = async (action: SocialPostAction, extra: { note?: string; url?: string } = {}) => {
    if (!detail) return;
    let current = detail;
    if (dirty && editable) {
      const saved = await save(true);
      if (!saved) return;
      current = saved;
    }
    const result = await run(SOCIAL_POST_ACTION_LABELS[action], () => socialPost<SocialPostDetail>('transition', {
      id: current.post.id, action, revision: current.post.revision, note: extra.note || null, url: extra.url || null,
    }), SOCIAL_POST_ACTION_SUCCESS[action]);
    if (result) { apply(result); onChanged(); }
  };

  // „Opublikuj teraz” / „Ponów publikację” — publikacja w Meta i na LinkedIn od razu, wynik w odpowiedzi serwera.
  const publishNow = async () => {
    if (!detail) return;
    const retry = detail.post.status === 'failed';
    const confirmed = await showConfirm({
      title: retry ? 'Ponowić publikację?' : 'Opublikować teraz?',
      message: retry
        ? 'Kanały, które już się opublikowały, zostaną pominięte. Pozostałe zostaną opublikowane teraz.'
        : `Post trafi teraz na: ${detail.post.channels.map((channel) => SOCIAL_CHANNEL_LABELS[channel]).join(', ')}.`,
      confirmText: retry ? 'Ponów publikację' : 'Opublikuj teraz',
    });
    if (!confirmed) return;
    const result = await run(retry ? 'Ponawiam publikację' : 'Publikuję', () => socialPost<SocialPostDetail>('publishNow', {
      id: detail.post.id, revision: detail.post.revision,
    }), undefined, 'Wysyłam grafiki i opis do Facebooka i Instagrama…');
    if (!result) return;
    apply(result);
    onChanged();
    if (result.publishResult?.status === 'published') showSnackbar('Post opublikowany', 'success');
    else if (result.publishResult?.status === 'failed') showSnackbar(result.publishResult.error || 'Publikacja nie powiodła się.', 'error');
    else showSnackbar('Publikacja trwa — karta odświeży się sama.', 'info');
  };

  // Wyniki kanałów z Meta (Etap 3) — treść opublikowanego posta jest zablokowana, więc odświeżenie nie gubi zmian.
  const refreshMetrics = async () => {
    if (!detail) return;
    const result = await run('Pobieram wyniki z Meta', () => socialPost<SocialPostDetail>('metricsRefresh', { postId: detail.post.id }), 'Odświeżono wyniki posta');
    if (result) apply(result);
  };

  const schedule = async () => {
    if (!detail) return;
    const when = fromLocalInput(scheduleAt);
    if (!when) { showSnackbar('Ustaw termin publikacji.', 'warning'); return; }
    setScheduleOpen(false);
    const result = await run('Planuję publikację', () => socialPost<SocialPostDetail>('schedulePublication', {
      id: detail.post.id, revision: detail.post.revision, scheduledAt: when,
    }), detail.post.status === 'scheduled' ? 'Zmieniono termin publikacji' : SOCIAL_POST_ACTION_SUCCESS.schedule);
    if (result) { apply(result); onChanged(); }
  };

  const close = async () => {
    if (dirty && !(await showConfirm({ title: 'Niezapisane zmiany', message: 'Post ma niezapisane zmiany. Zamknąć bez zapisu?', confirmText: 'Zamknij bez zapisu' }))) return;
    onClose();
  };

  const layoutDefinition = useMemo(() => layoutDefinitionOf(detail, draft?.layout || null, draft?.layoutRefresh), [detail, draft?.layout, draft?.layoutRefresh]);
  const layoutSlots = layoutDefinition ? socialLayoutSlots(layoutDefinition) : 1;

  /** Kadr zdjęcia: własny (w proporcjach formatu albo miejsca układu), propozycja z biblioteki albo środek — jak na serwerze. */
  const cropFor = useCallback((asset: SocialAsset, own: SocialCrop | null | undefined, format: SocialFormat, slot = 0): SocialCrop => {
    const width = asset.width || 1;
    const height = asset.height || 1;
    if (!layoutDefinition) return own && isSocialCrop(own) ? own : effectiveCrop(null, asset.crops, width, height, format);
    const aspect = socialLayoutSlotAspect(layoutDefinition, slot, format);
    if (own && isSocialCrop(own) && socialCropFitsAspect(own, width, height, aspect)) return own;
    const proposal = asset.crops?.[format];
    if (proposal && isSocialCrop(proposal) && socialCropFitsAspect(proposal, width, height, aspect)) return proposal;
    return socialAspectCrop(width, height, aspect);
  }, [layoutDefinition]);

  /** Zdjęcia kolażu w formacie (indeks = miejsce) do podglądu na żywo. */
  const slotPhotos = useCallback((format: SocialFormat) => {
    const photos: Array<{ src: string; crop: SocialCrop } | null> = [];
    if (!draft || !layoutDefinition) return photos;
    for (const item of draft.slots) {
      if (item.slot >= layoutSlots || !item.asset.workUrl || !item.asset.width || !item.asset.height) continue;
      photos[item.slot] = { src: item.asset.workUrl, crop: cropFor(item.asset, item.crops[format], format, item.slot) };
    }
    return photos;
  }, [draft, layoutDefinition, layoutSlots, cropFor]);

  const variantSource = useCallback((format: SocialFormat): GraphicSource | null => {
    if (!detail || !draft) return null;
    const saved = detail.variants.find((item) => item.format === format);
    const local = draft.variants[format];
    if (!local.enabled) return null;
    const asset = local.asset;
    const unchanged = !dirty && saved?.upToDate;
    // Duża grafika: plik wariantu to tylko kafelek 1 — podgląd całości zawsze na żywo (ten sam HTML co render).
    if (unchanged && saved?.renderedUrl && !layoutDefinition?.canvas) return { format, renderedUrl: saved.renderedUrl, live: null };
    if (!asset?.workUrl || !asset.width || !asset.height || !detail.spec?.ready) {
      return { format, renderedUrl: saved?.renderedUrl || null, live: null };
    }
    const crop = cropFor(asset, local.crop, format);
    return {
      format, renderedUrl: null,
      live: {
        spec: detail.spec, photoUrl: asset.workUrl, crop, headline: draft.headline, subline: draft.subline, style: draft.style, kicker: draft.kicker,
        layout: layoutDefinition, photos: slotPhotos(format),
      },
    };
  }, [detail, draft, dirty, cropFor, layoutDefinition, slotPhotos]);

  /** Siatka profilu / panorama: duża grafika z migawki albo wybranego układu. */
  const canvas: SocialCanvas | null = layoutDefinition?.canvas || null;
  /** Kafelki do podglądów: pliki z serwera (bez zmian, aktualne) albo wycinki podglądu na żywo całej grafiki. */
  const tileSources = useMemo((): GraphicSource[] => {
    if (!canvas || !detail || !draft) return [];
    const tiles = socialCanvasTiles(canvas);
    const saved = detail.tiles || [];
    if (!dirty && saved.length === tiles.length && saved.every((tile) => tile.upToDate && tile.renderedUrl)) {
      return tiles.map((tile) => ({ format: '4:5' as SocialFormat, renderedUrl: saved.find((item) => item.position === tile.position)?.renderedUrl || null, live: null }));
    }
    const whole = variantSource('4:5');
    return tiles.map((tile) => (whole?.live
      ? { ...whole, viewport: { x: tile.x, y: tile.y, width: tile.width, height: tile.height } }
      : { format: '4:5' as SocialFormat, renderedUrl: null, live: null }));
  }, [canvas, detail, draft, dirty, variantSource]);

  /** Wybór układu dużej grafiki; siatka — tylko feed Instagram, panorama — bez relacji. */
  const changeCanvasLayout = (choice: SocialLayoutChoice) => {
    const definition = layoutDefinitionOf(detail, choice);
    changeLayout(choice);
    const next = definition?.canvas;
    if (!next || !draft) return;
    const channels: SocialChannel[] = next.mode === 'grid' ? ['instagram_feed']
      : draft.channels.filter((channel) => channel !== 'instagram_story');
    change({ channels: channels.length ? channels : ['instagram_feed', 'facebook_feed'] });
  };

  /**
   * Zmiana układu (albo `refresh` — aktualna wersja tego samego układu): kadry niepasujące do nowych proporcji wracają do
   * propozycji, zdjęcia kolażu ponad liczbę miejsc znikają.
   */
  const changeLayout = (choice: SocialLayoutChoice, refresh = false) => {
    const definition = layoutDefinitionOf(detail, choice, refresh);
    const count = definition ? socialLayoutSlots(definition) : 1;
    setDraft((current) => {
      if (!current) return current;
      const variants = { ...current.variants };
      for (const format of SOCIAL_FORMATS) {
        const item = variants[format];
        const asset = item.asset;
        if (!item.crop || !asset?.width || !asset.height) continue;
        if (!socialCropFitsAspect(item.crop, asset.width, asset.height, socialLayoutSlotAspect(definition, 0, format))) {
          variants[format] = { ...item, crop: null, touched: true };
        }
      }
      const slots = current.slots.filter((item) => item.slot < count).map((item) => ({
        ...item, crops: {}, touched: Object.fromEntries(SOCIAL_FORMATS.map((format) => [format, true])) as SlotDraft['touched'],
      }));
      return { ...current, layout: choice, layoutRefresh: refresh, variants, slots };
    });
    setSlotEdit(null);
    setDirty(true);
  };
  const changeSlot = (slot: number, update: (item: SlotDraft | null) => SlotDraft | null) => {
    setDraft((current) => {
      if (!current) return current;
      const existing = current.slots.find((item) => item.slot === slot) || null;
      const next = update(existing);
      const others = current.slots.filter((item) => item.slot !== slot);
      return { ...current, slots: (next ? [...others, next] : others).sort((a, b) => a.slot - b.slot) };
    });
    setDirty(true);
  };

  /** Grafika zdjęcia karuzeli: plik z serwera (bez zmian) albo podgląd na żywo — styl okładki bez tekstów. */
  const slideSource = useCallback((index: number, format: SocialFormat): GraphicSource | null => {
    if (!detail || !draft) return null;
    const slide = draft.slides[index];
    if (!slide) return null;
    const saved = (detail.slides || []).find((item) => item.position === index + 1);
    const savedFormat = saved?.formats.find((item) => item.format === format);
    if (!dirty && saved?.assetId === slide.asset.id && savedFormat?.upToDate && savedFormat.renderedUrl) {
      return { format, renderedUrl: savedFormat.renderedUrl, live: null };
    }
    const asset = slide.asset;
    if (!asset.workUrl || !asset.width || !asset.height || !detail.spec?.ready) return { format, renderedUrl: savedFormat?.renderedUrl || null, live: null };
    const local = slide.crops[format];
    const crop = local && isSocialCrop(local) ? local : effectiveCrop(null, asset.crops, asset.width, asset.height, format);
    return { format, renderedUrl: null, live: { spec: detail.spec, photoUrl: asset.workUrl, crop, headline: '', subline: '', style: draft.style, kicker: '' } };
  }, [detail, draft, dirty]);

  const enabledFormats = useMemo(() => (draft ? SOCIAL_FORMATS.filter((format) => draft.variants[format].enabled && draft.variants[format].asset) : []), [draft]);
  const feedFormat = draft ? channelFormat('instagram_feed', enabledFormats) || enabledFormats[0] : null;
  const fbFormat = draft ? channelFormat('facebook_feed', enabledFormats) || enabledFormats[0] : null;
  const linkedinFormat = draft ? channelFormat('linkedin_page', enabledFormats) || enabledFormats[0] : null;
  const storyFormat = draft ? channelFormat('instagram_story', enabledFormats) : null;
  const publicationText = draft ? socialPublicationText(draft.caption, normalizeHashtags(draft.hashtags)) : '';
  const hashtagCount = draft ? normalizeHashtags(draft.hashtags).length : 0;

  if (!detail || !draft) {
    return (
      <OverlayPortal>
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0f1119]/95 text-[#e5e4e2]">Ładowanie posta…</div>
      </OverlayPortal>
    );
  }

  const activeVariant = draft.variants[active];
  const activeAsset = activeVariant.asset;
  const activeCrop = activeAsset?.width && activeAsset.height ? cropFor(activeAsset, activeVariant.crop, active) : null;
  const consentAssets = Array.from(new Map([
    ...SOCIAL_FORMATS.map((format) => draft.variants[format]).filter((item) => item.enabled && item.asset).map((item) => [item.asset!.id, item.asset!] as const),
    ...draft.slides.map((slide) => [slide.asset.id, slide.asset] as const),
    ...draft.slots.filter((item) => item.slot < layoutSlots).map((item) => [item.asset.id, item.asset] as const),
  ]).values());
  // Kolaż: edytowane miejsce w aktywnym formacie (kadr w proporcjach miejsca).
  const collageOn = Boolean(layoutDefinition) && layoutSlots > 1 && activeVariant.enabled && Boolean(activeAsset);
  const slotDraft = collageOn && slotEdit !== null && slotEdit < layoutSlots ? draft.slots.find((item) => item.slot === slotEdit) || null : null;
  const slotAsset = slotDraft?.asset || null;
  const slotCrop = slotDraft && slotAsset?.width && slotAsset.height ? cropFor(slotAsset, slotDraft.crops[active], active, slotDraft.slot) : null;
  const carouselOn = !canvas && isSocialSlideFormat(active) && activeVariant.enabled && Boolean(activeAsset);
  const canvasWarnings = canvas && layoutDefinition && socialCanvasCrossings(layoutDefinition).length
    ? ['Część logo albo tekstów wypada na styku kafelków — w feedzie będzie przecięta.'] : [];
  const previewTabs: Array<[PreviewTab, string]> = canvas
    ? canvas.mode === 'grid' ? [['grid', 'Siatka profilu'], ['feed', 'Feed Instagram']] : [['feed', 'Feed Instagram'], ['facebook', 'Facebook'], ['linkedin', 'LinkedIn']]
    : [['feed', 'Feed Instagram'], ['grid', 'Siatka profilu'], ['story', 'Relacja'], ['facebook', 'Facebook'], ['linkedin', 'LinkedIn']];
  const previewTab: PreviewTab = previewTabs.some(([key]) => key === preview) ? preview : previewTabs[0][0];
  const slide = carouselOn && slideIndex !== null ? draft.slides[slideIndex] || null : null;
  const slideAsset = slide?.asset || null;
  const slideCrop = slide && slideAsset?.width && slideAsset.height
    ? (slide.crops[active] && isSocialCrop(slide.crops[active]) ? slide.crops[active] as SocialCrop : effectiveCrop(null, slideAsset.crops, slideAsset.width, slideAsset.height, active))
    : null;
  const feedSlides = feedFormat && isSocialSlideFormat(feedFormat) ? draft.slides.map((_, index) => slideSource(index, feedFormat)) : [];
  const fbSlides = fbFormat && isSocialSlideFormat(fbFormat) ? draft.slides.map((_, index) => slideSource(index, fbFormat)) : [];
  const linkedinSlides = linkedinFormat && isSocialSlideFormat(linkedinFormat) ? draft.slides.map((_, index) => slideSource(index, linkedinFormat)) : [];
  const actions = detail.actions;

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-40 flex flex-col bg-[#0f1119] text-[#e5e4e2]" data-app-overlay="true">
        <header className="flex flex-wrap items-center gap-3 border-b border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3">
          <button type="button" className={secondaryButton} onClick={() => void close()}><ArrowLeft className="h-4 w-4" />Kalendarz</button>
          <input value={draft.title} disabled={!editable} maxLength={SOCIAL_LIMITS.title} onChange={(e) => change({ title: e.target.value })}
            placeholder="Nazwa posta (wewnętrzna)" className={`${inputClass} max-w-md flex-1`} />
          <PostStatusBadge status={detail.post.status} />
          <span className="text-xs text-[#e5e4e2]/40">wersja {detail.post.revision}{dirty ? ' · niezapisane zmiany' : ''}</span>
          <span className="flex-1" />
          {editable && <button type="button" className={primaryButton} onClick={() => void save()}><Save className="h-4 w-4" />Zapisz</button>}
          {actions.includes('submit') && <button type="button" className={primaryButton} onClick={() => void transition('submit')}><Send className="h-4 w-4" />Wyślij do akceptacji</button>}
          {actions.includes('approve') && <button type="button" className={primaryButton} disabled={dirty} title={dirty ? 'Najpierw zapisz zmiany' : ''} onClick={() => void transition('approve')}><CheckCircle2 className="h-4 w-4" />Zatwierdź</button>}
          {actions.includes('request_changes') && <button type="button" className={secondaryButton} onClick={() => { setNote(''); setNoteAction('request_changes'); }}><XCircle className="h-4 w-4" />Do poprawy</button>}
          {detail.canPublishNow && (
            <button type="button" className={primaryButton} disabled={dirty} title={dirty ? 'Najpierw zapisz zmiany' : 'Publikacja teraz (Meta, LinkedIn)'} onClick={() => void publishNow()}>
              <Zap className="h-4 w-4" />{detail.post.status === 'failed' ? 'Ponów publikację' : 'Opublikuj teraz'}
            </button>
          )}
          {(actions.includes('schedule') || (detail.post.status === 'scheduled' && detail.access.publish)) && (
            <button type="button" className={secondaryButton} disabled={dirty} title={dirty ? 'Najpierw zapisz zmiany' : ''}
              onClick={() => { setScheduleAt(defaultScheduleInput(detail.post.scheduledAt)); setScheduleOpen(true); }}>
              <CalendarClock className="h-4 w-4" />{detail.post.status === 'scheduled' ? 'Zmień termin publikacji' : 'Zaplanuj publikację'}
            </button>
          )}
          {actions.includes('unschedule') && <button type="button" className={secondaryButton} onClick={() => void transition('unschedule')}><PauseCircle className="h-4 w-4" />Wstrzymaj publikację</button>}
          {actions.includes('publish') && <button type="button" className={secondaryButton} onClick={() => { setPublishUrl(''); setNoteAction('publish'); }}><Check className="h-4 w-4" />Oznacz jako opublikowany</button>}
          <button type="button" className={secondaryButton} disabled={!detail.variants.some((item) => item.renderedUrl)}
            onClick={() => void run('Przygotowuję paczkę', () => downloadSocialPackage(detail.post.id, 'post.zip'), 'Pobrano paczkę: grafiki i opis')}><Download className="h-4 w-4" />Pobierz paczkę</button>
          <button type="button" className={secondaryButton} onClick={() => { void navigator.clipboard.writeText(publicationText).then(() => showSnackbar('Skopiowano opis z hashtagami', 'success')); }}><ClipboardCopy className="h-4 w-4" />Kopiuj opis</button>
          <button type="button" className={secondaryButton} onClick={() => setHistoryOpen(true)}><History className="h-4 w-4" />Historia</button>
          <button type="button" className={secondaryButton} aria-label="Zamknij" onClick={() => void close()}><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-4 p-4 xl:grid-cols-[320px_minmax(0,1fr)_400px]">
            <aside className="space-y-4">
              {detail.post.reviewNote && (detail.post.status === 'changes_requested' || detail.post.status === 'approved') && (
                <div className={`rounded-xl border p-3 text-sm ${detail.post.status === 'approved' ? 'border-emerald-400/30 bg-emerald-400/10' : 'border-orange-400/30 bg-orange-500/10'}`}>
                  <div className="mb-1 font-medium">{detail.post.status === 'approved' ? 'Zatwierdził(a)' : 'Do poprawy'}{detail.post.reviewedByName ? ` — ${detail.post.reviewedByName}` : ''}</div>
                  <p className="whitespace-pre-wrap text-[#e5e4e2]/80">{detail.post.reviewNote}</p>
                </div>
              )}
              <MetaPublishPanel detail={detail} onRefreshMetrics={() => void refreshMetrics()} />
              <section className={`${cardClass} space-y-3 p-4`}>
                <h3 className="text-sm font-medium">Publikacja</h3>
                <div className="space-y-1.5">
                  {SOCIAL_CHANNELS.filter((channel) => !canvas || (canvas.mode === 'grid' ? channel === 'instagram_feed' : channel !== 'instagram_story')).map((channel) => (
                    <label key={channel} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" disabled={!editable || canvas?.mode === 'grid'} checked={draft.channels.includes(channel)}
                        onChange={(e) => change({ channels: e.target.checked ? [...draft.channels, channel] : draft.channels.filter((item) => item !== channel) })} />
                      {SOCIAL_CHANNEL_LABELS[channel]}
                      {draft.channels.includes(channel) && <span className="text-[11px] text-[#e5e4e2]/40">→ {channelFormat(channel, enabledFormats) || 'brak grafiki'}</span>}
                    </label>
                  ))}
                </div>
                {canvas?.mode === 'grid' && <p className="text-[11px] text-[#e5e4e2]/45">Siatka profilu trafia tylko na Instagram — każdy kafelek to osobny post (publikacja od ostatniego kafelka).</p>}
                {canvas?.mode === 'panorama' && <p className="text-[11px] text-[#e5e4e2]/45">Panorama to karuzela: na Instagramie przesuwana bez przerw, na Facebooku i LinkedIn — post z kilkoma zdjęciami.</p>}
                <label className="block text-sm">Termin publikacji
                  <input type="datetime-local" disabled={!editable || (detail.post.status === 'scheduled' && !detail.access.publish)} value={draft.scheduledAt}
                    onChange={(e) => change({ scheduledAt: e.target.value })} className={`${inputClass} mt-1`} />
                </label>
                {detail.post.status === 'scheduled' && <p className="text-[11px] text-[#e5e4e2]/40">Zmiana treści cofnie zaplanowany post do szkicu (wymaga ponownej akceptacji).</p>}
                <div className="text-sm">
                  <div className="mb-1">Wydarzenie</div>
                  <div className="flex gap-2">
                    <button type="button" disabled={!editable} className={`${secondaryButton} flex-1 justify-start truncate`} onClick={() => setEventPicker(true)}>
                      <CalendarDays className="h-4 w-4 shrink-0" /><span className="truncate">{draft.eventName || 'Wybierz wydarzenie'}</span>
                    </button>
                    {draft.eventId && editable && <button type="button" className={secondaryButton} aria-label="Bez wydarzenia" onClick={() => change({ eventId: null, eventName: null })}><X className="h-4 w-4" /></button>}
                  </div>
                  {detail.event && <p className="mt-1 text-xs text-[#e5e4e2]/45">{[detail.event.location, detail.event.organizationName].filter(Boolean).join(' · ')}</p>}
                </div>
                <label className="block text-sm">Szablon grafiki
                  <select disabled={!editable} value={draft.templateId || ''} onChange={(e) => change({ templateId: e.target.value || null })} className={`${inputClass} mt-1`}>
                    {detail.templates.map((template) => <option key={template.id} value={template.id}>{template.name}{template.isDefault ? ' (domyślny)' : ''}{template.ready ? '' : ' — niegotowy'}</option>)}
                  </select>
                </label>
                {detail.template && !detail.template.ready && (
                  <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-100">{detail.template.problems.join(' ')}</p>
                )}
              </section>

              {canvas ? (
                <section className={`${cardClass} space-y-3 p-4`}>
                  <h3 className="text-sm font-medium">Siatka profilu / panorama</h3>
                  <CanvasPicker options={detail.canvasLayouts || []} value={draft.layout} canvas={canvas} colors={detail.spec?.colors || null}
                    disabled={!editable} onChange={changeCanvasLayout} />
                  {canvas.mode === 'grid' ? (
                    <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[#e5e4e2]/50">
                      <li>Każdy kafelek to osobny post — zasięg rozkłada się na kafelki; całość widać po wejściu na profil.</li>
                      <li>Publikacja od ostatniego kafelka do pierwszego (kafelek 1 ląduje w lewym górnym rogu).</li>
                      <li>Przypięte posty przesuwają siatkę; kolejne posty publikuj po 3, żeby została równa (kolejność poprawisz też w profilu Instagram).</li>
                    </ul>
                  ) : (
                    <p className="text-[11px] text-[#e5e4e2]/50">Jedno zdjęcie przez wszystkie slajdy — jeden post, całe zaangażowanie w jednym miejscu.</p>
                  )}
                </section>
              ) : (
              <section className={`${cardClass} space-y-3 p-4`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">Układ grafiki</h3>
                  {detail.access.approve && (
                    <button type="button" className="flex items-center gap-1 text-xs text-[#d3bb73] hover:underline" onClick={() => setLayoutsOpen(true)}>
                      <LayoutTemplate className="h-3.5 w-3.5" />Edytuj układy
                    </button>
                  )}
                </div>
                <SocialLayoutPicker options={detail.layouts || []} value={draft.layout} format={activeVariant.enabled ? active : (enabledFormats[0] || '4:5')}
                  colors={detail.spec?.colors || null} disabled={!editable}
                  onChange={(choice) => changeLayout(choice, sameLayoutChoice(choice, draft.layout) && draft.layoutRefresh)} />
                {detail.layout?.outdated && sameLayoutChoice(draft.layout, { id: detail.layout.id, key: detail.layout.key }) && (
                  draft.layoutRefresh ? (
                    <p className="flex flex-wrap items-center gap-2 rounded-lg border border-[#d3bb73]/25 bg-[#d3bb73]/10 p-2 text-xs">
                      Nowa wersja układu „{detail.layout.name}” — zapisz post, żeby ją zastosować.
                      <button type="button" className="text-[#d3bb73] hover:underline" onClick={() => changeLayout(draft.layout, false)}>Zostaw dotychczasową</button>
                    </p>
                  ) : (
                    <p className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-100">
                      Układ „{detail.layout.name}” zmieniono po zapisaniu tego posta — post ma dotychczasową wersję.
                      {editable && <button type="button" className="text-[#d3bb73] hover:underline" onClick={() => changeLayout(draft.layout, true)}>Wczytaj nową wersję</button>}
                    </p>
                  )
                )}
                {layoutDefinition && layoutSlots > 1 && (
                  <p className="text-[11px] text-[#e5e4e2]/45">Kolaż: {layoutSlots} zdjęcia — kolejne zdjęcia wybierasz w pasku „Kolaż” nad edytorem kadru.</p>
                )}
              </section>
              )}

              {!canvas && (
              <section className={`${cardClass} space-y-3 p-4`}>
                <h3 className="text-sm font-medium">Styl grafiki</h3>
                {layoutDefinition && <p className="text-[11px] text-[#e5e4e2]/45">Wybrany układ zastępuje styl na okładce — styl dotyczy kolejnych zdjęć karuzeli.</p>}
                <SocialStylePicker spec={detail.spec} format={activeVariant.enabled ? active : (enabledFormats[0] || '4:5')}
                  photoUrl={activeAsset?.workUrl || null} crop={activeCrop} headline={draft.headline} subline={draft.subline} kicker={draft.kicker}
                  value={draft.style} defaultStyle={detail.template?.defaultStyle || null} disabled={!editable} onChange={(style) => change({ style })} />
              </section>
              )}

              <section className={`${cardClass} space-y-3 p-4`}>
                <h3 className="text-sm font-medium">Tekst na grafice</h3>
                <div className="text-sm">
                  <label className="block">Napis nad tytułem <span className="text-xs text-[#e5e4e2]/40">(opcjonalnie, w kolorze akcentu)</span>
                    <input disabled={!editable} value={draft.kicker} maxLength={SOCIAL_LIMITS.kicker} onChange={(e) => change({ kicker: e.target.value })}
                      className={`${inputClass} mt-1`} placeholder="np. Realizacja" />
                  </label>
                  {editable && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {SOCIAL_KICKER_SUGGESTIONS.map((item) => (
                        <button key={item} type="button" onClick={() => change({ kicker: draft.kicker === item ? '' : item })}
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${draft.kicker === item ? 'border-[#d3bb73]/70 bg-[#d3bb73]/20 text-[#d3bb73]' : 'border-[#d3bb73]/15 text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>
                          {item}
                        </button>
                      ))}
                    </div>
                  )}
                  {draft.kicker.length > SOCIAL_LIMITS.kickerRecommended && <p className="mt-1 text-xs text-amber-200">Krótki napis wygląda najlepiej (do {SOCIAL_LIMITS.kickerRecommended} znaków).</p>}
                </div>
                <label className="block text-sm">Tytuł <span className="text-xs text-[#e5e4e2]/40">({draft.headline.length}/{SOCIAL_LIMITS.headlineRecommended} zalecane)</span>
                  <input disabled={!editable} value={draft.headline} maxLength={SOCIAL_LIMITS.headline} onChange={(e) => change({ headline: e.target.value })} className={`${inputClass} mt-1`} placeholder="Od koncepcji po ostatni akord" />
                </label>
                {draft.headline.length > SOCIAL_LIMITS.headlineRecommended && <p className="text-xs text-amber-200">Dłuższy tytuł zostanie zmniejszony, żeby zmieścił się w marginesach. Mniej tekstu = więcej klasy.</p>}
                <label className="block text-sm">Podpis <span className="text-xs text-[#e5e4e2]/40">(np. nazwa realizacji · miejsce)</span>
                  <input disabled={!editable} value={draft.subline} maxLength={SOCIAL_LIMITS.subline} onChange={(e) => change({ subline: e.target.value })} className={`${inputClass} mt-1`} placeholder="Jubileusz 30 lat · Hotel Marina" />
                </label>
              </section>

              <section className={`${cardClass} space-y-2 p-4`}>
                <h3 className="text-sm font-medium">Zgoda klienta</h3>
                {consentAssets.length === 0 ? <p className="text-xs text-[#e5e4e2]/45">Dodaj zdjęcie, żeby sprawdzić zgodę.</p> : consentAssets.map((asset) => (
                  <div key={asset.id} className="flex items-center gap-2 text-xs">
                    {asset.thumbnailUrl && <img src={asset.thumbnailUrl} alt="" className="h-8 w-8 rounded object-cover" />}
                    <span className="min-w-0 flex-1 truncate">{asset.title || asset.originalName || 'Zdjęcie'}</span>
                    <ConsentBadge consent={asset.consent} compact />
                  </div>
                ))}
                <p className="text-[11px] text-[#e5e4e2]/40">Zgodę ustawisz w Bibliotece (zdjęcie, wydarzenie albo klient).</p>
              </section>

              {(detail.problems.submit.length > 0 || detail.problems.publish.length > 0) && (
                <section className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
                  <div className="mb-1 flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" />Do uzupełnienia</div>
                  <ul className="list-disc space-y-0.5 pl-4">{Array.from(new Set([...detail.problems.submit, ...detail.problems.publish])).map((problem) => <li key={problem}>{problem}</li>)}</ul>
                  {dirty && <p className="mt-1 text-amber-200/70">Lista z ostatniego zapisu.</p>}
                </section>
              )}

              <section className="flex flex-wrap gap-2">
                {actions.includes('reopen') && <button type="button" className={secondaryButton} onClick={async () => { if (await showConfirm({ title: 'Przywrócić szkic?', message: 'Post wróci do szkicu i będzie wymagał ponownej akceptacji.', confirmText: 'Przywróć' })) void transition('reopen'); }}><Undo2 className="h-4 w-4" />Przywróć do szkicu</button>}
                {detail.access.create && <button type="button" className={secondaryButton} onClick={async () => {
                  const copy = await run('Kopiuję post', () => socialPost<SocialPostDetail>('duplicate', { id: detail.post.id }), 'Utworzono kopię posta');
                  if (copy) { onChanged(); onOpenPost(copy.post.id); }
                }}><Copy className="h-4 w-4" />Kopia</button>}
                {actions.includes('cancel') && <button type="button" className={dangerButton} onClick={async () => { if (await showConfirm({ title: 'Anulować post?', message: 'Post nie zostanie opublikowany. Możesz go później przywrócić do szkicu.', confirmText: 'Anuluj post' })) void transition('cancel'); }}><XCircle className="h-4 w-4" />Anuluj post</button>}
                {detail.access.create && (detail.post.status === 'draft' || detail.post.status === 'cancelled') && (
                  <button type="button" className={dangerButton} onClick={async () => {
                    if (!(await showConfirm({ title: 'Usunąć post?', message: 'Post i jego grafiki zostaną trwale usunięte. Zdjęcia zostają w bibliotece. Tej operacji nie można cofnąć.', confirmText: 'Usuń trwale' }))) return;
                    const done = await run('Usuwam post', () => socialPost('deletePost', { id: detail.post.id }), 'Usunięto post');
                    if (done) { onChanged(); onClose(); }
                  }}><Trash2 className="h-4 w-4" />Usuń</button>
                )}
              </section>
            </aside>

            <section className={`${cardClass} min-w-0 space-y-4 p-4`}>
              {canvas ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-[#d3bb73]">{detail.canvasLayouts?.find((item) => item.key === draft.layout?.key)?.name || 'Duża grafika'}</span>
                  <span className="text-xs text-[#e5e4e2]/45">
                    {canvas.mode === 'grid' ? `${canvas.rows * 3} ${canvas.rows === 1 ? 'kafelki' : 'kafelków'} po 1080×1350 px (siatka 3:4 w profilu)` : `${canvas.slides} ${canvas.slides === 5 ? 'slajdów' : 'slajdy'} po 1080×1350 px`}
                  </span>
                </div>
              ) : (<>
              <div className="flex flex-wrap items-center gap-2">
                {SOCIAL_FORMATS.map((format) => {
                  const variant = draft.variants[format];
                  return (
                    <div key={format} className={`flex items-center overflow-hidden rounded-lg border ${active === format ? 'border-[#d3bb73]/60' : 'border-[#d3bb73]/15'}`}>
                      <label className="flex items-center px-2" title={variant.enabled ? 'Wyłącz format' : 'Włącz format'}>
                        <input type="checkbox" disabled={!editable} checked={variant.enabled} onChange={(e) => {
                          const first = SOCIAL_FORMATS.map((item) => draft.variants[item].asset).find(Boolean) || null;
                          changeVariant(format, { enabled: e.target.checked, asset: variant.asset || first });
                          if (e.target.checked) setActive(format);
                        }} />
                      </label>
                      <button type="button" onClick={() => setActive(format)} disabled={!variant.enabled}
                        className={`px-3 py-1.5 text-sm ${active === format ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/70'} disabled:opacity-40`}>
                        {SOCIAL_FORMAT_INFO[format].label}
                      </button>
                    </div>
                  );
                })}
                <span className="flex-1" />
                {editable && <button type="button" className={secondaryButton} onClick={() => setPicker('all')}><Images className="h-4 w-4" />Zdjęcie dla wszystkich formatów</button>}
              </div>
              <p className="text-xs text-[#e5e4e2]/45">{SOCIAL_FORMAT_INFO[active].hint} · {SOCIAL_FORMAT_INFO[active].width}×{SOCIAL_FORMAT_INFO[active].height} px</p>
              </>)}

              {collageOn && (
                <div className="space-y-2 rounded-lg border border-[#d3bb73]/10 p-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">Kolaż</span>
                    <span className="text-[#e5e4e2]/45">{layoutSlots} zdjęcia w układzie · kadr każdego zdjęcia ustawiasz osobno w każdym formacie, w proporcjach jego miejsca.</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => { setSlotEdit(null); setSlideIndex(null); }}
                      className={`relative h-16 w-14 overflow-hidden rounded border ${slotEdit === null ? 'border-[#d3bb73]' : 'border-[#d3bb73]/15'}`} title="Zdjęcie 1 (zdjęcie formatu)">
                      {activeAsset?.thumbnailUrl ? <img src={activeAsset.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <Images className="m-auto h-5 w-5 text-[#d3bb73]/40" />}
                      <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[10px] text-white">1</span>
                    </button>
                    {Array.from({ length: layoutSlots - 1 }, (_, index) => index + 1).map((slot) => {
                      const item = draft.slots.find((entry) => entry.slot === slot) || null;
                      return item ? (
                        <button key={slot} type="button" onClick={() => { setSlotEdit(slot); setSlideIndex(null); }}
                          className={`relative h-16 w-14 overflow-hidden rounded border ${slotEdit === slot ? 'border-[#d3bb73]' : 'border-[#d3bb73]/15'}`} title={`Zdjęcie ${slot + 1} kolażu`}>
                          {item.asset.thumbnailUrl ? <img src={item.asset.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <Images className="m-auto h-5 w-5 text-[#d3bb73]/40" />}
                          <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[10px] text-white">{slot + 1}</span>
                        </button>
                      ) : (
                        <button key={slot} type="button" disabled={!editable} onClick={() => setSlotPicker(slot)}
                          className="flex h-16 w-14 flex-col items-center justify-center gap-0.5 rounded border border-dashed border-amber-400/50 text-[10px] text-amber-100 disabled:opacity-50" title={`Wybierz zdjęcie ${slot + 1} kolażu`}>
                          <Plus className="h-4 w-4" />Zdjęcie {slot + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {carouselOn && (
                <div className="space-y-2 rounded-lg border border-[#d3bb73]/10 p-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">Karuzela</span>
                    <span className="text-[#e5e4e2]/45">{1 + draft.slides.length}/{SOCIAL_LIMITS.slides + 1} zdjęć · Instagram — przesuwane zdjęcia, Facebook i LinkedIn — post z kilkoma zdjęciami, relacja — tylko okładka. Kolejne zdjęcia: ten sam styl, bez tekstów.</span>
                    <span className="flex-1" />
                    {editable && draft.slides.length < SOCIAL_LIMITS.slides && (
                      <button type="button" className={secondaryButton} onClick={() => setSlidePicker('add')}><Plus className="h-4 w-4" />Dodaj zdjęcia</button>
                    )}
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    <button type="button" onClick={() => { setSlideIndex(null); setSlotEdit(null); }}
                      className={`relative shrink-0 overflow-hidden rounded-md border-2 ${slide === null ? 'border-[#d3bb73]' : 'border-transparent hover:border-[#d3bb73]/40'}`}>
                      {activeAsset?.thumbnailUrl ? <img src={activeAsset.thumbnailUrl} alt="" className="h-16 w-14 object-cover" /> : <span className="flex h-16 w-14 items-center justify-center bg-[#0f1119]"><Images className="h-4 w-4" /></span>}
                      <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[10px]">1 · okładka</span>
                    </button>
                    {draft.slides.map((item, index) => (
                      <button key={`${item.asset.id}-${index}`} type="button" draggable={editable} title={editable ? 'Przeciągnij, żeby zmienić kolejność' : ''}
                        onDragStart={() => setDragSlide(index)} onDragEnd={() => setDragSlide(null)} onDragOver={(event) => event.preventDefault()}
                        onDrop={() => { if (dragSlide !== null) moveSlide(dragSlide, index); setDragSlide(null); setSlideIndex(index); setSlotEdit(null); }}
                        onClick={() => { setSlideIndex(index); setSlotEdit(null); }}
                        className={`relative shrink-0 overflow-hidden rounded-md border-2 ${slideIndex === index ? 'border-[#d3bb73]' : 'border-transparent hover:border-[#d3bb73]/40'} ${dragSlide === index ? 'opacity-50' : ''}`}>
                        {item.asset.thumbnailUrl ? <img src={item.asset.thumbnailUrl} alt="" className="h-16 w-14 object-cover" /> : <span className="flex h-16 w-14 items-center justify-center bg-[#0f1119]"><Images className="h-4 w-4" /></span>}
                        <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[10px]">{index + 2}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {slotDraft && slotEdit !== null ? (
                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="min-w-0">
                    {slotAsset?.workUrl && slotAsset.width && slotAsset.height && slotCrop ? (
                      <SocialCropEditor imageUrl={slotAsset.workUrl} imageWidth={slotAsset.width} imageHeight={slotAsset.height}
                        format={active} crop={slotCrop} proposal={slotAsset.crops[active] || null} guides={null}
                        aspect={socialLayoutSlotAspect(layoutDefinition, slotDraft.slot, active)} disabled={!editable}
                        onChange={(crop) => changeSlot(slotDraft.slot, (item) => (item ? { ...item, crops: { ...item.crops, [active]: crop }, touched: { ...item.touched, [active]: true } } : item))} />
                    ) : <p className="text-sm text-[#e5e4e2]/50">Zdjęcie nie ma jeszcze wersji roboczej.</p>}
                    {editable && (
                      <div className="mt-3 flex flex-wrap justify-center gap-2">
                        <button type="button" className={secondaryButton} onClick={() => setSlotPicker(slotDraft.slot)}><Images className="h-4 w-4" />Inne zdjęcie</button>
                        {slotDraft.crops[active] && <button type="button" className={secondaryButton} onClick={() => changeSlot(slotDraft.slot, (item) => (item
                          ? { ...item, crops: { ...item.crops, [active]: null }, touched: { ...item.touched, [active]: true } } : item))}><RotateCcw className="h-4 w-4" />Kadr z propozycji</button>}
                        <button type="button" className={dangerButton} onClick={() => { changeSlot(slotDraft.slot, () => null); setSlotEdit(null); }}><Trash2 className="h-4 w-4" />Usuń z kolażu</button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[#e5e4e2]/50">Zdjęcie {slotDraft.slot + 1} kolażu — {SOCIAL_FORMAT_INFO[active].label}</div>
                    <GraphicView source={variantSource(active)} width={300} className="rounded-lg" />
                    <p className="text-[11px] text-[#e5e4e2]/40">Kadr ustawiasz osobno w każdym formacie — w proporcjach miejsca tego zdjęcia w układzie.</p>
                  </div>
                </div>
              ) : slide && slideIndex !== null ? (
                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="min-w-0">
                    {slideAsset?.workUrl && slideAsset.width && slideAsset.height && slideCrop ? (
                      <SocialCropEditor imageUrl={slideAsset.workUrl} imageWidth={slideAsset.width} imageHeight={slideAsset.height}
                        format={active} crop={slideCrop} proposal={slideAsset.crops[active] || null}
                        guides={detail.spec?.styleGuides?.[draft.style]?.[active] || detail.spec?.guides[active] || null}
                        disabled={!editable} onChange={(crop) => changeSlides((slides) => slides.map((item, position) => (position === slideIndex
                          ? { ...item, crops: { ...item.crops, [active]: crop }, touched: { ...item.touched, [active]: true } } : item)))} />
                    ) : <p className="text-sm text-[#e5e4e2]/50">Zdjęcie nie ma jeszcze wersji roboczej.</p>}
                    {editable && (
                      <div className="mt-3 flex flex-wrap justify-center gap-2">
                        <button type="button" className={secondaryButton} disabled={slideIndex === 0} onClick={() => { moveSlide(slideIndex, slideIndex - 1); setSlideIndex(slideIndex - 1); }}><ChevronLeft className="h-4 w-4" />Wcześniej</button>
                        <button type="button" className={secondaryButton} disabled={slideIndex >= draft.slides.length - 1} onClick={() => { moveSlide(slideIndex, slideIndex + 1); setSlideIndex(slideIndex + 1); }}>Dalej<ChevronRight className="h-4 w-4" /></button>
                        <button type="button" className={secondaryButton} onClick={() => setSlidePicker(slideIndex)}><Images className="h-4 w-4" />Inne zdjęcie</button>
                        {slide.crops[active] && <button type="button" className={secondaryButton} onClick={() => changeSlides((slides) => slides.map((item, position) => (position === slideIndex
                          ? { ...item, crops: { ...item.crops, [active]: null }, touched: { ...item.touched, [active]: true } } : item)))}><RotateCcw className="h-4 w-4" />Kadr z propozycji</button>}
                        <button type="button" className={dangerButton} onClick={() => { changeSlides((slides) => slides.filter((_, position) => position !== slideIndex)); setSlideIndex(null); }}><Trash2 className="h-4 w-4" />Usuń z karuzeli</button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[#e5e4e2]/50">Zdjęcie {slideIndex + 2} karuzeli — {SOCIAL_FORMAT_INFO[active].label}</div>
                    <GraphicView source={slideSource(slideIndex, active)} width={300} className="rounded-lg" />
                    <p className="text-[11px] text-[#e5e4e2]/40">Kadr ustawiasz osobno w każdym formacie feedu (4:5, 1:1, 1,91:1).</p>
                  </div>
                </div>
              ) : !activeVariant.enabled ? (
                <p className="p-10 text-center text-sm text-[#e5e4e2]/45">Ten format jest wyłączony.</p>
              ) : !activeAsset ? (
                <div className="flex flex-col items-center gap-3 p-10 text-center text-sm text-[#e5e4e2]/50">
                  <Images className="h-10 w-10 text-[#d3bb73]/40" />Wybierz zdjęcie z biblioteki.
                  {editable && <button type="button" className={primaryButton} onClick={() => setPicker(active)}>Wybierz zdjęcie</button>}
                </div>
              ) : canvas ? (
                <div className="space-y-4">
                  {activeAsset.workUrl && activeAsset.width && activeAsset.height && activeCrop ? (
                    <SocialCropEditor imageUrl={activeAsset.workUrl} imageWidth={activeAsset.width} imageHeight={activeAsset.height}
                      format={active} crop={activeCrop} proposal={activeAsset.crops[active] || null} guides={null}
                      aspect={socialLayoutSlotAspect(layoutDefinition, 0, active)}
                      disabled={!editable} onChange={(crop) => changeVariant(active, { crop, touched: true })} />
                  ) : <p className="text-sm text-[#e5e4e2]/50">Zdjęcie nie ma jeszcze wersji roboczej.</p>}
                  {editable && (
                    <div className="flex flex-wrap justify-center gap-2">
                      <button type="button" className={secondaryButton} onClick={() => setPicker(active)}><Images className="h-4 w-4" />Inne zdjęcie</button>
                      {activeVariant.crop && <button type="button" className={secondaryButton} onClick={() => changeVariant(active, { crop: null, touched: true })}><RotateCcw className="h-4 w-4" />Kadr z propozycji</button>}
                    </div>
                  )}
                  <div ref={setCanvasBox} className="space-y-2">
                    <div className="text-xs text-[#e5e4e2]/50">Cała grafika — podgląd na żywo (ten sam szablon co render); serwer tnie ją na kafelki po zapisie</div>
                    <CanvasPreview source={variantSource(active)} canvas={canvas} width={canvasWidth} warnings={canvasWarnings} />
                    {!dirty && detail.variants.some((item) => item.assetId && !item.upToDate) && detail.access.create && socialPostEditable(detail.post.status) && (
                      <button type="button" className={secondaryButton} onClick={async () => {
                        const result = await run('Generuję kafelki', () => socialPost<SocialPostDetail>('renderPost', { id: detail.post.id }), 'Kafelki są aktualne');
                        if (result) apply(result);
                      }}><RefreshCw className="h-4 w-4" />Odśwież kafelki</button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="min-w-0">
                    {activeAsset.workUrl && activeAsset.width && activeAsset.height && activeCrop ? (
                      <SocialCropEditor imageUrl={activeAsset.workUrl} imageWidth={activeAsset.width} imageHeight={activeAsset.height}
                        format={active} crop={activeCrop} proposal={activeAsset.crops[active] || null}
                        guides={layoutDefinition ? null : detail.spec?.styleGuides?.[draft.style]?.[active] || detail.spec?.guides[active] || null}
                        aspect={layoutDefinition ? socialLayoutSlotAspect(layoutDefinition, 0, active) : null}
                        disabled={!editable} onChange={(crop) => changeVariant(active, { crop, touched: true })} />
                    ) : <p className="text-sm text-[#e5e4e2]/50">Zdjęcie nie ma jeszcze wersji roboczej.</p>}
                    {editable && (
                      <div className="mt-3 flex flex-wrap justify-center gap-2">
                        <button type="button" className={secondaryButton} onClick={() => setPicker(active)}><Images className="h-4 w-4" />Inne zdjęcie</button>
                        {activeVariant.crop && <button type="button" className={secondaryButton} onClick={() => changeVariant(active, { crop: null, touched: true })}><RotateCcw className="h-4 w-4" />Kadr z propozycji</button>}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[#e5e4e2]/50">{dirty || !detail.variants.find((item) => item.format === active)?.upToDate ? 'Podgląd na żywo (ten sam szablon co render)' : 'Grafika z serwera'}</div>
                    <GraphicView source={variantSource(active)} width={300} className="rounded-lg" />
                    {!dirty && detail.variants.find((item) => item.format === active)?.renderedAt && (
                      <p className="text-[11px] text-[#e5e4e2]/40">Wygenerowano {dateTimeLabel(detail.variants.find((item) => item.format === active)?.renderedAt)}</p>
                    )}
                    {!dirty && detail.variants.some((item) => item.assetId && !item.upToDate) && detail.access.create && socialPostEditable(detail.post.status) && (
                      <button type="button" className={secondaryButton} onClick={async () => {
                        const result = await run('Generuję grafiki', () => socialPost<SocialPostDetail>('renderPost', { id: detail.post.id }), 'Grafiki są aktualne');
                        if (result) apply(result);
                      }}><RefreshCw className="h-4 w-4" />Odśwież grafiki</button>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-3 border-t border-[#d3bb73]/10 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Opis posta</h3>
                  <span className={`text-xs ${draft.caption.length > SOCIAL_LIMITS.caption * 0.9 ? 'text-amber-200' : 'text-[#e5e4e2]/40'}`}>{draft.caption.length}/{SOCIAL_LIMITS.caption}</span>
                </div>
                <textarea disabled={!editable} value={draft.caption} maxLength={SOCIAL_LIMITS.caption} rows={6} onChange={(e) => change({ caption: e.target.value })} className={inputClass}
                  placeholder="Krótko i z klasą: co się wydarzyło, dla kogo, co nas wyróżnia." />
                {canvas?.mode === 'grid' && <p className="text-[11px] text-[#e5e4e2]/45">Opis z hashtagami trafia do kafelka 1 (lewy górny, publikowany na końcu); pozostałe kafelki dostają same hashtagi.</p>}
                <label className="block text-sm">Hashtagi <span className={`text-xs ${hashtagCount > SOCIAL_LIMITS.hashtags ? 'text-red-300' : 'text-[#e5e4e2]/40'}`}>({hashtagCount}/{SOCIAL_LIMITS.hashtags})</span>
                  <input disabled={!editable} value={draft.hashtags} onChange={(e) => change({ hashtags: e.target.value })} className={`${inputClass} mt-1`} placeholder="#mavinci #eventy #gala" />
                </label>
                {editable && (
                  <SocialAssistant detail={detail} run={run}
                    draft={{
                      caption: draft.caption, hashtags: draft.hashtags, headline: draft.headline, subline: draft.subline, eventId: draft.eventId,
                      assetId: draft.variants[active].asset?.id || SOCIAL_FORMATS.map((format) => draft.variants[format].asset?.id).find(Boolean) || null,
                      channels: draft.channels,
                    }}
                    onUse={(suggestion, withGraphic) => change({
                      caption: suggestion.caption,
                      hashtags: suggestion.hashtags.length ? suggestion.hashtags.join(' ') : draft.hashtags,
                      ...(withGraphic ? { headline: suggestion.headline || draft.headline, subline: suggestion.subline || draft.subline } : {}),
                    })}
                    onHashtags={(tags) => change({ hashtags: tags.join(' ') })}
                    onSettings={(settings) => setDetail((current) => (current ? { ...current, settings } : current))} />
                )}
              </div>
            </section>

            <aside className={`${cardClass} space-y-3 p-4`}>
              <div className="flex flex-wrap gap-1">
                {previewTabs.map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setPreview(key)}
                    className={`rounded-lg px-3 py-1.5 text-xs ${previewTab === key ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>{label}</button>
                ))}
              </div>
              {canvas ? (
                <>
                  {previewTab === 'grid' && <CanvasGridPreview tiles={tileSources} grid={detail.grid} />}
                  {previewTab === 'feed' && (
                    <InstagramFeedPreview source={tileSources[0] || null} slides={canvas.mode === 'panorama' ? tileSources.slice(1) : []} account={account}
                      logoUrl={detail.template?.logoUrl || null} caption={publicationText} />
                  )}
                  {previewTab === 'feed' && canvas.mode === 'grid' && <p className="text-[11px] text-[#e5e4e2]/45">W feedzie kafelki pojawiają się jako osobne posty — kafelek 1 (najnowszy) z opisem, pozostałe z hashtagami.</p>}
                  {previewTab === 'facebook' && <FacebookPreview source={tileSources[0] || null} slides={tileSources.slice(1)} account={account} logoUrl={detail.template?.logoUrl || null} caption={publicationText} />}
                  {previewTab === 'linkedin' && <LinkedInPreview source={tileSources[0] || null} slides={tileSources.slice(1)} account={detail.meta?.linkedin?.organizationName || detail.company.name} logoUrl={detail.template?.logoUrl || null} caption={publicationText} />}
                </>
              ) : (<>
              {preview === 'feed' && <InstagramFeedPreview source={feedFormat ? variantSource(feedFormat) : null} slides={feedSlides} account={account} logoUrl={detail.template?.logoUrl || null} caption={publicationText} />}
              {preview === 'grid' && <ProfileGridPreview current={feedFormat ? variantSource(feedFormat) : null} grid={detail.grid} />}
              {preview === 'story' && (storyFormat
                ? <StoryPreview source={variantSource(storyFormat)} account={account} logoUrl={detail.template?.logoUrl || null} />
                : <p className="p-6 text-center text-sm text-[#e5e4e2]/45">Włącz format „Relacja 9:16” i kanał „Instagram — relacja”, żeby zobaczyć relację.</p>)}
              {preview === 'facebook' && <FacebookPreview source={fbFormat ? variantSource(fbFormat) : null} slides={fbSlides} account={account} logoUrl={detail.template?.logoUrl || null} caption={publicationText} />}
              {preview === 'linkedin' && <LinkedInPreview source={linkedinFormat ? variantSource(linkedinFormat) : null} slides={linkedinSlides} account={detail.meta?.linkedin?.organizationName || detail.company.name} logoUrl={detail.template?.logoUrl || null} caption={publicationText} />}
              </>)}
              <p className="text-[11px] text-[#e5e4e2]/40">Podglądy pokazują grafiki w proporcjach platform. Ostateczny plik generuje serwer — identyczny w CRM, na Macu i w telefonie.</p>
              {detail.post.status === 'published' && detail.post.publishedUrl && (
                <a href={detail.post.publishedUrl} target="_blank" rel="noreferrer" className={secondaryButton}><Link2 className="h-4 w-4" />Opublikowany post</a>
              )}
              {(detail.publications.some((item) => item.status === 'published' && item.channel !== 'instagram_story') || detail.comments.total > 0) && (
                <div id="social-post-comments" className="border-t border-[#d3bb73]/10 pt-3">
                  <SocialComments postId={detail.post.id} />
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>

      {picker && (
        <Modal open onClose={() => setPicker(null)} title={picker === 'all' ? 'Zdjęcie dla wszystkich formatów' : `Zdjęcie — ${SOCIAL_FORMAT_INFO[picker].label}`} scrollBody>
          <SocialLibrary companyId={detail.post.companyId} access={detail.access} onCreatePost={() => undefined} onChanged={() => undefined}
            pickMode={{
              onPick: (asset) => {
                if (picker === 'all') {
                  setDraft((current) => current ? {
                    ...current,
                    variants: Object.fromEntries(SOCIAL_FORMATS.map((format) => [format, current.variants[format].enabled
                      ? { ...current.variants[format], asset, crop: null, touched: true } : current.variants[format]])) as Draft['variants'],
                  } : current);
                  setDirty(true);
                } else changeVariant(picker, { asset, crop: null, touched: true });
                if (!draft.eventId && asset.eventId) change({ eventId: asset.eventId, eventName: asset.eventName });
                setPicker(null);
              },
            }} />
        </Modal>
      )}
      {slidePicker !== null && (
        <Modal open onClose={() => setSlidePicker(null)} scrollBody
          title={slidePicker === 'add' ? `Dodaj zdjęcia do karuzeli (${1 + draft.slides.length}/${SOCIAL_LIMITS.slides + 1})` : `Zdjęcie ${slidePicker + 2} karuzeli`}>
          <SocialLibrary companyId={detail.post.companyId} access={detail.access} onCreatePost={() => undefined} onChanged={() => undefined}
            pickMode={{
              onPick: (asset) => {
                if (slidePicker === 'add') {
                  if (draft.slides.length >= SOCIAL_LIMITS.slides) { showSnackbar(`Karuzela ma już ${SOCIAL_LIMITS.slides + 1} zdjęć.`, 'warning'); setSlidePicker(null); return; }
                  changeSlides((slides) => (slides.length >= SOCIAL_LIMITS.slides ? slides : [...slides, { asset, crops: {}, touched: {} }]));
                  showSnackbar('Dodano zdjęcie do karuzeli — wybierz kolejne albo zamknij okno', 'success');
                  if (draft.slides.length + 1 >= SOCIAL_LIMITS.slides) setSlidePicker(null);
                } else {
                  const index = slidePicker;
                  changeSlides((slides) => slides.map((item, position) => (position === index ? { asset, crops: {}, touched: Object.fromEntries(SOCIAL_SLIDE_FORMATS.map((format) => [format, true])) } : item)));
                  setSlidePicker(null);
                }
              },
            }} />
        </Modal>
      )}
      {slotPicker !== null && (
        <Modal open onClose={() => setSlotPicker(null)} scrollBody title={`Zdjęcie ${slotPicker + 1} kolażu`}>
          <SocialLibrary companyId={detail.post.companyId} access={detail.access} onCreatePost={() => undefined} onChanged={() => undefined}
            pickMode={{
              onPick: (asset) => {
                const slot = slotPicker;
                changeSlot(slot, () => ({ slot, asset, crops: {}, touched: Object.fromEntries(SOCIAL_FORMATS.map((format) => [format, true])) as SlotDraft['touched'] }));
                setSlotPicker(null);
                setSlotEdit(slot);
                setSlideIndex(null);
              },
            }} />
        </Modal>
      )}
      {layoutsOpen && (
        <SocialLayoutEditor companyId={detail.post.companyId} templateId={draft.templateId || detail.post.templateId} onClose={() => setLayoutsOpen(false)}
          onChanged={() => {
            // Nowa lista układów (i znacznik nowej wersji) bez naruszania niezapisanych zmian w poście.
            void socialGet<SocialPostDetail>('post', { id: postId })
              .then((fresh) => setDetail((current) => (current ? { ...current, layouts: fresh.layouts, layout: fresh.layout } : current)))
              .catch(() => undefined);
          }} />
      )}
      {eventPicker && <EventPicker companyId={detail.post.companyId} onClose={() => setEventPicker(false)}
        onPick={(event: SocialEventOption) => { change({ eventId: event.id, eventName: event.name }); setEventPicker(false); }} />}
      {noteAction === 'request_changes' && (
        <Modal open onClose={() => setNoteAction(null)} title="Do poprawy">
          <div className="space-y-3">
            <textarea autoFocus value={note} maxLength={SOCIAL_LIMITS.note} rows={4} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="Co poprawić? (autor dostanie powiadomienie)" />
            <button type="button" className={primaryButton} disabled={!note.trim()} onClick={() => { setNoteAction(null); void transition('request_changes', { note }); }}>Odeślij do poprawy</button>
          </div>
        </Modal>
      )}
      {noteAction === 'publish' && (
        <Modal open onClose={() => setNoteAction(null)} title="Oznacz jako opublikowany">
          <div className="space-y-3 text-sm">
            <p className="text-[#e5e4e2]/70">Użyj, gdy post opublikowano ręcznie (np. z paczki „Pobierz paczkę”, bez połączenia z Meta lub LinkedIn). Wklej link do posta. Automatyczną publikację uruchamiają „Opublikuj teraz” i „Zaplanuj publikację”.</p>
            <input value={publishUrl} onChange={(e) => setPublishUrl(e.target.value)} className={inputClass} placeholder="https://www.instagram.com/p/… (opcjonalnie)" />
            <button type="button" className={primaryButton} onClick={() => { setNoteAction(null); void transition('publish', { url: publishUrl.trim() }); }}>Oznacz jako opublikowany</button>
          </div>
        </Modal>
      )}
      {scheduleOpen && (
        <Modal open onClose={() => setScheduleOpen(false)} title={detail.post.status === 'scheduled' ? 'Zmień termin publikacji' : 'Zaplanuj publikację'}>
          <div className="space-y-3 text-sm">
            <p className="text-[#e5e4e2]/70">W tym terminie serwer opublikuje post: {detail.post.channels.map((channel) => SOCIAL_CHANNEL_LABELS[channel]).join(', ')}. Błąd publikacji zobaczysz na karcie posta (autor i osoba planująca dostaną powiadomienie).</p>
            <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className={inputClass} />
            {detail.problems.meta.length > 0 && (
              <ul className="list-disc space-y-0.5 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 pl-6 text-xs text-amber-100">
                {detail.problems.meta.map((problem) => <li key={problem}>{problem}</li>)}
              </ul>
            )}
            <button type="button" className={primaryButton} disabled={!scheduleAt} onClick={() => void schedule()}><CalendarClock className="h-4 w-4" />Zaplanuj</button>
          </div>
        </Modal>
      )}
      {historyOpen && (
        <Modal open onClose={() => setHistoryOpen(false)} title="Historia posta" scrollBody>
          <ul className="space-y-2 text-sm">
            {detail.history.map((item, index) => (
              <li key={`${item.createdAt}-${index}`} className="rounded-lg border border-[#d3bb73]/10 p-2">
                <div className="flex justify-between gap-2"><span>{HISTORY_LABELS[item.kind] || item.kind}{item.revision ? ` (wersja ${item.revision})` : ''}</span><span className="text-xs text-[#e5e4e2]/45">{dateTimeLabel(item.createdAt)}</span></div>
                {item.actorName && <div className="text-xs text-[#e5e4e2]/50">{item.actorName}</div>}
                {item.note && <p className="mt-1 whitespace-pre-wrap text-xs text-[#e5e4e2]/70">{item.note}</p>}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </OverlayPortal>
  );
}
