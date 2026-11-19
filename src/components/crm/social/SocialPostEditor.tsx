'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CalendarClock, CalendarDays, Check, CheckCircle2, ClipboardCopy, Copy, Download, History, Images, Link2,
  PauseCircle, RefreshCw, RotateCcw, Save, Send, Sparkles, Trash2, Undo2, X, XCircle, Zap,
} from 'lucide-react';
import OverlayPortal from '@/components/UI/OverlayPortal';
import { Modal } from '@/components/UI/Modal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { useDialog } from '@/contexts/DialogContext';
import {
  SOCIAL_CHANNELS, SOCIAL_CHANNEL_LABELS, SOCIAL_FORMATS, SOCIAL_FORMAT_INFO, SOCIAL_LIMITS, SOCIAL_POST_ACTION_LABELS,
  SOCIAL_POST_ACTION_SUCCESS, channelFormat, effectiveCrop, isSocialCrop, normalizeHashtags, socialPostEditable,
  socialPublicationText, type SocialChannel, type SocialCrop, type SocialFormat, type SocialPostAction,
} from '@/lib/social/socialShared';
import {
  downloadSocialPackage, socialGet, socialPost, type SocialAiSuggestion, type SocialAsset, type SocialEventOption, type SocialPostDetail,
} from './socialApi';
import SocialCropEditor from './SocialCropEditor';
import SocialComments from './SocialComments';
import { MetaPublishPanel } from './SocialMetaPanel';
import SocialLibrary, { EventPicker } from './SocialLibrary';
import { FacebookPreview, GraphicView, InstagramFeedPreview, ProfileGridPreview, StoryPreview, useAccountName, type GraphicSource } from './SocialPreviews';
import {
  ConsentBadge, PostStatusBadge, cardClass, dangerButton, dateTimeLabel, errorMessage, fromLocalInput, inputClass, primaryButton,
  secondaryButton, toLocalInput,
} from './socialUi';

/*
 * Kreator posta (pełny ekran): kanały, termin, wydarzenie, formaty grafik 4:5 / 1:1 / 9:16 / 1,91:1 ze zdjęciem z biblioteki,
 * edytor kadru z polami szablonu, tytuł i podpis grafiki, opis i hashtagi, opisy AI, podglądy (feed, siatka profilu, relacja,
 * Facebook), braki przed akceptacją i publikacją, historia oraz akcje statusu. Zapis renderuje grafiki na serwerze
 * (ten sam plik dla CRM, Maca i telefonu).
 */

type VariantDraft = { enabled: boolean; asset: SocialAsset | null; crop: SocialCrop | null; touched: boolean };
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
  variants: Record<SocialFormat, VariantDraft>;
};
type PreviewTab = 'feed' | 'grid' | 'story' | 'facebook';

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
    variants,
  };
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

  // „Opublikuj teraz” / „Ponów publikację” — publikacja w Meta od razu, wynik w odpowiedzi serwera.
  const publishNow = async () => {
    if (!detail) return;
    const retry = detail.post.status === 'failed';
    const confirmed = await showConfirm({
      title: retry ? 'Ponowić publikację?' : 'Opublikować teraz?',
      message: retry
        ? 'Kanały, które już się opublikowały, zostaną pominięte. Pozostałe trafią do Meta teraz.'
        : `Post trafi teraz na: ${detail.post.channels.map((channel) => SOCIAL_CHANNEL_LABELS[channel]).join(', ')}.`,
      confirmText: retry ? 'Ponów publikację' : 'Opublikuj teraz',
    });
    if (!confirmed) return;
    const result = await run(retry ? 'Ponawiam publikację' : 'Publikuję w Meta', () => socialPost<SocialPostDetail>('publishNow', {
      id: detail.post.id, revision: detail.post.revision,
    }), undefined, 'Wysyłam grafiki i opis do Facebooka i Instagrama…');
    if (!result) return;
    apply(result);
    onChanged();
    if (result.publishResult?.status === 'published') showSnackbar('Post opublikowany w Meta', 'success');
    else if (result.publishResult?.status === 'failed') showSnackbar(result.publishResult.error || 'Publikacja nie powiodła się.', 'error');
    else showSnackbar('Publikacja trwa — karta odświeży się sama.', 'info');
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

  const variantSource = useCallback((format: SocialFormat): GraphicSource | null => {
    if (!detail || !draft) return null;
    const saved = detail.variants.find((item) => item.format === format);
    const local = draft.variants[format];
    if (!local.enabled) return null;
    const asset = local.asset;
    const unchanged = !dirty && saved?.upToDate;
    if (unchanged && saved?.renderedUrl) return { format, renderedUrl: saved.renderedUrl, live: null };
    if (!asset?.workUrl || !asset.width || !asset.height || !detail.spec?.ready) {
      return { format, renderedUrl: saved?.renderedUrl || null, live: null };
    }
    const crop = local.crop && isSocialCrop(local.crop) ? local.crop : effectiveCrop(null, asset.crops, asset.width, asset.height, format);
    return { format, renderedUrl: null, live: { spec: detail.spec, photoUrl: asset.workUrl, crop, headline: draft.headline, subline: draft.subline } };
  }, [detail, draft, dirty]);

  const enabledFormats = useMemo(() => (draft ? SOCIAL_FORMATS.filter((format) => draft.variants[format].enabled && draft.variants[format].asset) : []), [draft]);
  const feedFormat = draft ? channelFormat('instagram_feed', enabledFormats) || enabledFormats[0] : null;
  const fbFormat = draft ? channelFormat('facebook_feed', enabledFormats) || enabledFormats[0] : null;
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
  const activeCrop = activeAsset?.width && activeAsset.height
    ? (activeVariant.crop && isSocialCrop(activeVariant.crop) ? activeVariant.crop : effectiveCrop(null, activeAsset.crops, activeAsset.width, activeAsset.height, active))
    : null;
  const consentAssets = Array.from(new Map(SOCIAL_FORMATS.map((format) => draft.variants[format]).filter((item) => item.enabled && item.asset).map((item) => [item.asset!.id, item.asset!])).values());
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
            <button type="button" className={primaryButton} disabled={dirty} title={dirty ? 'Najpierw zapisz zmiany' : 'Publikacja w Meta teraz'} onClick={() => void publishNow()}>
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
              <MetaPublishPanel detail={detail} />
              <section className={`${cardClass} space-y-3 p-4`}>
                <h3 className="text-sm font-medium">Publikacja</h3>
                <div className="space-y-1.5">
                  {SOCIAL_CHANNELS.map((channel) => (
                    <label key={channel} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" disabled={!editable} checked={draft.channels.includes(channel)}
                        onChange={(e) => change({ channels: e.target.checked ? [...draft.channels, channel] : draft.channels.filter((item) => item !== channel) })} />
                      {SOCIAL_CHANNEL_LABELS[channel]}
                      {draft.channels.includes(channel) && <span className="text-[11px] text-[#e5e4e2]/40">→ {channelFormat(channel, enabledFormats) || 'brak grafiki'}</span>}
                    </label>
                  ))}
                </div>
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

              <section className={`${cardClass} space-y-3 p-4`}>
                <h3 className="text-sm font-medium">Tekst na grafice</h3>
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

              {!activeVariant.enabled ? (
                <p className="p-10 text-center text-sm text-[#e5e4e2]/45">Ten format jest wyłączony.</p>
              ) : !activeAsset ? (
                <div className="flex flex-col items-center gap-3 p-10 text-center text-sm text-[#e5e4e2]/50">
                  <Images className="h-10 w-10 text-[#d3bb73]/40" />Wybierz zdjęcie z biblioteki.
                  {editable && <button type="button" className={primaryButton} onClick={() => setPicker(active)}>Wybierz zdjęcie</button>}
                </div>
              ) : (
                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="min-w-0">
                    {activeAsset.workUrl && activeAsset.width && activeAsset.height && activeCrop ? (
                      <SocialCropEditor imageUrl={activeAsset.workUrl} imageWidth={activeAsset.width} imageHeight={activeAsset.height}
                        format={active} crop={activeCrop} proposal={activeAsset.crops[active] || null} guides={detail.spec?.guides[active] || null}
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
                <label className="block text-sm">Hashtagi <span className={`text-xs ${hashtagCount > SOCIAL_LIMITS.hashtags ? 'text-red-300' : 'text-[#e5e4e2]/40'}`}>({hashtagCount}/{SOCIAL_LIMITS.hashtags})</span>
                  <input disabled={!editable} value={draft.hashtags} onChange={(e) => change({ hashtags: e.target.value })} className={`${inputClass} mt-1`} placeholder="#mavinci #eventy #gala" />
                </label>
                <AiPanel detail={detail} editable={editable} dirty={dirty}
                  onGenerate={async () => {
                    let current = detail;
                    if (dirty) { const saved = await save(true); if (!saved) return; current = saved; }
                    const result = await run('Przygotowuję propozycje opisu', () => socialPost<SocialPostDetail>('suggest', { id: current.post.id }), 'Gotowe propozycje opisu', 'AI pisze 2–3 wersje opisu na podstawie danych realizacji…');
                    if (result) apply(result);
                  }}
                  onUse={(suggestion) => change({ caption: suggestion.caption, hashtags: suggestion.hashtags.join(' '), headline: suggestion.headline || draft.headline, subline: suggestion.subline || draft.subline })} />
              </div>
            </section>

            <aside className={`${cardClass} space-y-3 p-4`}>
              <div className="flex flex-wrap gap-1">
                {([['feed', 'Feed Instagram'], ['grid', 'Siatka profilu'], ['story', 'Relacja'], ['facebook', 'Facebook']] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setPreview(key)}
                    className={`rounded-lg px-3 py-1.5 text-xs ${preview === key ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>{label}</button>
                ))}
              </div>
              {preview === 'feed' && <InstagramFeedPreview source={feedFormat ? variantSource(feedFormat) : null} account={account} logoUrl={detail.template?.logoUrl || null} caption={publicationText} />}
              {preview === 'grid' && <ProfileGridPreview current={feedFormat ? variantSource(feedFormat) : null} grid={detail.grid} />}
              {preview === 'story' && (storyFormat
                ? <StoryPreview source={variantSource(storyFormat)} account={account} logoUrl={detail.template?.logoUrl || null} />
                : <p className="p-6 text-center text-sm text-[#e5e4e2]/45">Włącz format „Relacja 9:16” i kanał „Instagram — relacja”, żeby zobaczyć relację.</p>)}
              {preview === 'facebook' && <FacebookPreview source={fbFormat ? variantSource(fbFormat) : null} account={account} logoUrl={detail.template?.logoUrl || null} caption={publicationText} />}
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
            <p className="text-[#e5e4e2]/70">Użyj, gdy post opublikowano ręcznie (np. z paczki „Pobierz paczkę”, bez połączenia z Meta). Wklej link do posta. Publikację w Meta uruchamiają „Opublikuj teraz” i „Zaplanuj publikację”.</p>
            <input value={publishUrl} onChange={(e) => setPublishUrl(e.target.value)} className={inputClass} placeholder="https://www.instagram.com/p/… (opcjonalnie)" />
            <button type="button" className={primaryButton} onClick={() => { setNoteAction(null); void transition('publish', { url: publishUrl.trim() }); }}>Oznacz jako opublikowany</button>
          </div>
        </Modal>
      )}
      {scheduleOpen && (
        <Modal open onClose={() => setScheduleOpen(false)} title={detail.post.status === 'scheduled' ? 'Zmień termin publikacji' : 'Zaplanuj publikację'}>
          <div className="space-y-3 text-sm">
            <p className="text-[#e5e4e2]/70">W tym terminie serwer opublikuje post w Meta: {detail.post.channels.map((channel) => SOCIAL_CHANNEL_LABELS[channel]).join(', ')}. Błąd publikacji zobaczysz na karcie posta (autor i osoba planująca dostaną powiadomienie).</p>
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

function AiPanel({ detail, editable, dirty, onGenerate, onUse }: { detail: SocialPostDetail; editable: boolean; dirty: boolean; onGenerate: () => void; onUse: (suggestion: SocialAiSuggestion) => void }) {
  if (!editable) return null;
  if (!detail.settings.aiCaptionsEnabled) {
    return <p className="rounded-lg border border-[#d3bb73]/10 p-2 text-xs text-[#e5e4e2]/50"><Sparkles className="mr-1 inline h-3.5 w-3.5 text-[#d3bb73]" />Opisy AI włącza osoba akceptująca posty („Szablony i AI”).</p>;
  }
  const suggestions = (detail.post.aiSuggestions || []) as SocialAiSuggestion[];
  return (
    <div className="space-y-2 rounded-lg border border-[#d3bb73]/15 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm"><Sparkles className="mr-1 inline h-4 w-4 text-[#d3bb73]" />Opisy AI z danych realizacji</span>
        <button type="button" className={secondaryButton} onClick={onGenerate}>{suggestions.length ? 'Nowe propozycje' : 'Zaproponuj opisy'}</button>
      </div>
      <p className="text-[11px] text-[#e5e4e2]/40">Do AI trafia rodzaj wydarzenia, miejsce, miesiąc i opis realizacji; nazwa wydarzenia i klient — tylko przy zgodzie klienta.{dirty ? ' Najpierw zapiszemy zmiany.' : ''}</p>
      {suggestions.map((suggestion, index) => (
        <div key={index} className="rounded-lg bg-[#0f1119]/70 p-2 text-xs">
          {(suggestion.headline || suggestion.subline) && <div className="mb-1 text-[#d3bb73]">{suggestion.headline}{suggestion.subline ? ` · ${suggestion.subline}` : ''}</div>}
          <p className="whitespace-pre-wrap text-[#e5e4e2]/80">{suggestion.caption}</p>
          <p className="mt-1 text-[#e5e4e2]/45">{suggestion.hashtags.join(' ')}</p>
          <button type="button" className={`${secondaryButton} mt-2`} onClick={() => onUse(suggestion)}>Użyj tej wersji</button>
        </div>
      ))}
    </div>
  );
}
