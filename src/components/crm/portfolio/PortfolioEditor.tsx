'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import * as Icons from 'lucide-react';
import {
  AlertTriangle, ArrowDown, ArrowUp, CalendarDays, Check, CheckCircle2, ChevronRight, CircleDashed, ExternalLink, FolderOpen, GripVertical,
  Image as ImageIcon, Images, Instagram, Lock, Plus, RotateCcw, Save, Send, Sparkles, Star, Trash2, Upload, Wand2, X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/UI/Modal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { useDialog } from '@/contexts/DialogContext';
import {
  PORTFOLIO_AI_SECTIONS, PORTFOLIO_ICONS, PORTFOLIO_LIMITS, PORTFOLIO_STATUS_LABELS, normalizePortfolioContent, portfolioAddFeatures,
  portfolioCheckTarget, portfolioChecklist, portfolioMergePhrases, portfolioSearchPreview, portfolioSlug, portfolioWithAlts, portfolioWithTitle,
  type PortfolioAiSection, type PortfolioContent, type PortfolioPhoto, type PortfolioStatus,
} from '@/lib/portfolio/portfolioShared';
import { cardClass, dangerButton, inputClass, primaryButton, secondaryButton } from '../social/socialUi';
import {
  errorMessage, portfolioGet, portfolioPost, portfolioUploadPhoto, type PortfolioAiResult, type PortfolioCity, type PortfolioDetail, type PortfolioEvent,
  type PortfolioPhotoOption, type PortfolioPhotoSource,
} from './portfolioApi';
import PortfolioPhotoPicker from './PortfolioPhotoPicker';
import PortfolioAssistant from './PortfolioAssistant';
import { SOCIAL_CHANNELS, SOCIAL_CHANNEL_LABELS, SOCIAL_LIMITS, type SocialChannel } from '@/lib/social/socialShared';

/*
 * Karta realizacji (Marketing → Realizacje): kopia robocza realizacji strony — podstawy i wydarzenie, zdjęcie główne
 * i galeria (z dysku — także przeciągnięciem plików na sekcję albo na zdjęcie główne, z plików wydarzenia, Materiałów, biblioteki
 * social media; kolejność przeciąganiem, opisy alt), opisy, elementy realizacji, SEO (opis w Google, słowa kluczowe, tagi, miasta),
 * lista kontrolna (kliknięcie — przejście do pola), podgląd w Google i asystent AI — przy sekcjach (tytuł, opisy, elementy, SEO,
 * opisy zdjęć) i w panelu bocznym.
 * „Zapisz” — kopia robocza, „Opublikuj” — strona (przy zmianie na stronie: wybór wersji). „Utwórz post” — szkic posta social media
 * z wybranymi zdjęciami (karuzela) i tekstami realizacji. Te same dane na Macu i w telefonie.
 */

export const STATUS_CLASSES: Record<PortfolioStatus, string> = {
  draft: 'border-[#e5e4e2]/20 bg-[#e5e4e2]/5 text-[#e5e4e2]/70',
  published: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  changed: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  conflict: 'border-red-400/40 bg-red-500/15 text-red-200',
};

export function PortfolioStatusBadge({ status }: { status: PortfolioStatus }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] ${STATUS_CLASSES[status]}`}>{PORTFOLIO_STATUS_LABELS[status]}</span>;
}

type Draft = { content: PortfolioContent; eventId: string | null; event: PortfolioEvent | null };
type Run = <T>(title: string, action: () => Promise<T>, success?: string, description?: string) => Promise<T | null>;

function FeatureIcon({ name, className }: { name: string; className?: string }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon | undefined>)[name] || Star;
  return <Icon className={className} />;
}

function ChipsInput({ values, onChange, placeholder, max, maxLength, disabled }: {
  values: string[]; onChange: (values: string[]) => void; placeholder: string; max: number; maxLength: number; disabled: boolean;
}) {
  const [value, setValue] = useState('');
  const add = () => {
    const parts = value.split(',').map((item) => item.trim().replace(/\s+/g, ' ').slice(0, maxLength)).filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const part of parts) if (!next.some((item) => item.toLocaleLowerCase('pl') === part.toLocaleLowerCase('pl')) && next.length < max) next.push(part);
    onChange(next);
    setValue('');
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {values.map((item) => (
          <span key={item} className="inline-flex items-center gap-1 rounded-full border border-[#d3bb73]/25 bg-[#d3bb73]/10 px-2 py-0.5 text-xs text-[#d3bb73]">
            {item}
            {!disabled && <button type="button" aria-label={`Usuń ${item}`} onClick={() => onChange(values.filter((entry) => entry !== item))}><X className="h-3 w-3" /></button>}
          </span>
        ))}
      </div>
      {!disabled && values.length < max && (
        <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} className={inputClass}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(); } }} onBlur={add} />
      )}
    </div>
  );
}

const aiLink = 'text-[#d3bb73] hover:underline disabled:opacity-40 disabled:no-underline';

/** Przycisk asystenta AI przy sekcji kreatora. */
function AiButton({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-2.5 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-40">
      <Sparkles className="h-3.5 w-3.5" />{label}
    </button>
  );
}

/** Propozycje asystenta pod sekcją: wstawienie wybranych, inne propozycje, zamknięcie. */
function AiPanel({ title, onClose, onRetry, children }: { title: string; onClose: () => void; onRetry: () => void; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-[#d3bb73]/25 bg-[#0f1119]/70 p-3 text-xs md:col-span-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#d3bb73]" />
        <span className="flex-1 text-[#d3bb73]">{title}</span>
        <button type="button" className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]" onClick={onRetry}>Inne propozycje</button>
        <button type="button" aria-label="Zamknij propozycje" className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]" onClick={onClose}><X className="h-3.5 w-3.5" /></button>
      </div>
      {children}
    </div>
  );
}

function AiText({ label, text, hint, onUse }: { label: string; text: string; hint?: ReactNode; onUse: () => void }) {
  return (
    <div className="rounded-lg bg-black/20 p-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[#e5e4e2]/70">{label}</span>
        {hint}
        <span className="flex-1" />
        <button type="button" className={aiLink} onClick={onUse}>Użyj</button>
      </div>
      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-[#e5e4e2]/85">{text}</p>
    </div>
  );
}

export default function PortfolioEditor({ id, cities, categories, onChanged, onDeleted, onDirtyChange }: {
  id: string;
  cities: PortfolioCity[];
  categories: string[];
  onChanged: () => void;
  onDeleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const { showConfirm } = useDialog();
  const [detail, setDetail] = useState<PortfolioDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<PortfolioPhotoSource | null>(null);
  const router = useRouter();
  /** „Utwórz post”: zaznaczone zdjęcia (adresy wersji strony) i kanały. */
  const [socialOpen, setSocialOpen] = useState(false);
  const [socialPhotos, setSocialPhotos] = useState<string[]>([]);
  const [socialChannels, setSocialChannels] = useState<SocialChannel[]>(['instagram_feed', 'facebook_feed']);
  const [eventPicker, setEventPicker] = useState(false);
  const [eventQuery, setEventQuery] = useState('');
  const [events, setEvents] = useState<PortfolioEvent[]>([]);
  const [cityQuery, setCityQuery] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /** Elementy realizacji: przeciąganie za uchwyt (pola tekstowe wiersza zostają do zaznaczania tekstu) i miejsce upuszczenia. */
  const [featureDrag, setFeatureDrag] = useState<number | null>(null);
  const [featureTarget, setFeatureTarget] = useState<number | null>(null);
  const endFeatureDrag = () => { setFeatureDrag(null); setFeatureTarget(null); };
  /** Przeniesienie elementu `from` na miejsce przed elementem `target` (długość listy — na koniec). */
  const moveFeatureTo = (from: number, target: number) => {
    const features = [...content.features];
    if (from < 0 || from >= features.length) return;
    const [moved] = features.splice(from, 1);
    const position = Math.max(0, Math.min(features.length, target > from ? target - 1 : target));
    if (position === from) return;
    features.splice(position, 0, moved);
    set({ features });
  };
  const fileInput = useRef<HTMLInputElement>(null);
  /** Lista kontrolna → pole: podświetlenie pola, do którego przeszedł pracownik. */
  const [highlight, setHighlight] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);
  /** Asystent AI: notatka (wspólna dla sekcji i panelu) i propozycje pod sekcjami. */
  const [aiBrief, setAiBrief] = useState('');
  const [ai, setAi] = useState<Partial<Record<PortfolioAiSection, PortfolioAiResult>>>({});
  /** Pliki przeciągane z pulpitu: nad sekcją zdjęć albo nad zdjęciem głównym. */
  const [fileDrag, setFileDrag] = useState<'section' | 'hero' | null>(null);
  const dragDepth = useRef(0);
  useEffect(() => () => { if (highlightTimer.current) window.clearTimeout(highlightTimer.current); }, []);

  const apply = useCallback((value: PortfolioDetail) => {
    setDetail(value);
    setDraft({ content: value.item.content, eventId: value.item.eventId, event: value.event });
  }, []);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setDraft(null);
    setAi({});
    portfolioGet<PortfolioDetail>('item', { id }).then((value) => { if (active) { apply(value); setError(''); } })
      .catch((cause) => { if (active) setError(errorMessage(cause, 'Nie udało się otworzyć realizacji.')); });
    return () => { active = false; };
  }, [id, apply]);

  const dirty = useMemo(() => Boolean(detail && draft && (JSON.stringify(draft.content) !== JSON.stringify(detail.item.content) || draft.eventId !== detail.item.eventId)), [detail, draft]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const run: Run = useCallback(async (title, action, success, description = 'Proszę chwilę poczekać...') => {
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
  }, [showLoader, hideLoader, showSnackbar]);

  const set = (patch: Partial<PortfolioContent>) => setDraft((current) => (current ? { ...current, content: { ...current.content, ...patch } } : current));

  const save = useCallback(async (quiet = false): Promise<PortfolioDetail | null> => {
    if (!detail || !draft) return null;
    const result = await run('Zapisuję realizację', () => portfolioPost<PortfolioDetail>('save', {
      id: detail.item.id, version: detail.item.version, content: normalizePortfolioContent(draft.content), eventId: draft.eventId,
    }), quiet ? undefined : 'Zapisano realizację');
    if (result) { apply(result); onChanged(); }
    return result;
  }, [detail, draft, run, apply, onChanged]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (dirty) void save(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dirty, save]);

  useEffect(() => {
    if (!eventPicker) return;
    let active = true;
    const timer = window.setTimeout(() => {
      portfolioGet<{ events: PortfolioEvent[] }>('events', { q: eventQuery }).then((data) => { if (active) setEvents(data.events); })
        .catch(() => { if (active) setEvents([]); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [eventPicker, eventQuery]);

  if (error) return <div className={`${cardClass} p-8 text-center text-sm text-[#e5e4e2]/60`}>{error}</div>;
  if (!detail || !draft) return <div className={`${cardClass} p-8 text-center text-sm text-[#e5e4e2]/50`}>Ładowanie realizacji…</div>;

  const { item } = detail;
  const content = draft.content;
  const published = item.status !== 'draft';
  const checks = portfolioChecklist(content);
  const missing = checks.filter((check) => check.required && !check.ok);
  const preview = portfolioSearchPreview(content);
  const metaLength = content.metaDescription.length;

  const publish = async () => {
    let current = detail;
    if (dirty) {
      const saved = await save(true);
      if (!saved) return;
      current = saved;
    }
    let overwrite = false;
    if (current.item.status === 'conflict') {
      overwrite = Boolean(await showConfirm({
        title: 'Zastąpić wersję na stronie?',
        message: 'Tę realizację zmieniono także bezpośrednio na stronie. Publikacja zastąpi tamte zmiany Twoją wersją.',
        confirmText: 'Opublikuj moją wersję',
      }));
      if (!overwrite) return;
    }
    const result = await run(published ? 'Publikuję zmiany' : 'Publikuję realizację', () => portfolioPost<PortfolioDetail>('publish', {
      id: current.item.id, version: current.item.version, overwrite,
    }), published ? 'Zmiany są na stronie' : 'Realizacja jest na stronie', 'Zapis na stronie mavinci.pl…');
    if (result) { apply(result); onChanged(); }
  };

  const discard = async () => {
    if (!(await showConfirm({ title: 'Pobrać wersję ze strony?', message: 'Niezapisane i niepublikowane zmiany w kopii roboczej zostaną zastąpione wersją, która jest teraz na stronie.', confirmText: 'Pobierz ze strony' }))) return;
    const result = await run('Pobieram wersję ze strony', () => portfolioPost<PortfolioDetail>('discard', { id: item.id }), 'Kopia robocza = wersja ze strony');
    if (result) { apply(result); onChanged(); }
  };

  const unpublish = async () => {
    if (!(await showConfirm({ title: 'Usunąć realizację ze strony?', message: 'Strona realizacji przestanie działać (link i pozycja w Google). Kopia robocza zostanie jako szkic — możesz ją opublikować ponownie.', confirmText: 'Usuń ze strony' }))) return;
    const result = await run('Usuwam realizację ze strony', () => portfolioPost<PortfolioDetail>('unpublish', { id: item.id, version: item.version }), 'Realizacja zniknęła ze strony');
    if (result) { apply(result); onChanged(); }
  };

  const remove = async () => {
    if (!(await showConfirm({
      title: 'Usunąć realizację?',
      message: published ? 'Realizacja zostanie usunięta ze strony i z „Realizacji”. Zdjęcia zostają w źródłach (Materiały, pliki wydarzenia). Tej operacji nie można cofnąć.' : 'Kopia robocza zostanie usunięta. Tej operacji nie można cofnąć.',
      confirmText: 'Usuń',
    }))) return;
    const result = await run('Usuwam realizację', () => portfolioPost('delete', { id: item.id, version: item.version, removeFromSite: published }), 'Usunięto realizację');
    if (result) onDeleted();
  };

  /** Nowe zdjęcia: pierwsze bez zdjęcia głównego (albo upuszczone na zdjęcie główne) zostaje głównym, reszta — do galerii. */
  const addPhotos = (photos: PortfolioPhoto[], asMain = false) => setDraft((current) => {
    if (!current || !photos.length) return current;
    let image = current.content.image;
    const gallery = [...current.content.gallery];
    const queue = [...photos];
    if (asMain) {
      if (image && gallery.length < PORTFOLIO_LIMITS.gallery) gallery.unshift(image);
      image = queue.shift() || image;
    }
    for (const photo of queue) {
      if (!image) image = photo;
      else if (gallery.length < PORTFOLIO_LIMITS.gallery) gallery.push(photo);
    }
    return { ...current, content: { ...current.content, image, gallery } };
  });

  const uploadFiles = async (files: FileList | null, asMain = false) => {
    const all = Array.from(files || []);
    const list = all.filter((file) => /^image\/(jpeg|png|webp)$/.test(file.type));
    const heic = all.filter((file) => /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name));
    if (heic.length) showSnackbar('Zdjęcia HEIC: zapisz je jako JPEG albo dodaj z aplikacji na Maca (zamienia HEIC sama).', 'warning');
    if (!list.length) {
      if (!heic.length) showSnackbar('Wybierz zdjęcia JPEG, PNG albo WebP.', 'warning');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    const added: PortfolioPhoto[] = [];
    showLoader('Wgrywam zdjęcia', `0 z ${list.length}`);
    try {
      for (const [index, file] of list.entries()) {
        showLoader('Wgrywam zdjęcia', `${index + 1} z ${list.length}: ${file.name}`);
        if (file.size > PORTFOLIO_LIMITS.uploadBytes) { showSnackbar(`${file.name}: zdjęcie może mieć najwyżej 40 MB.`, 'warning'); continue; }
        added.push(await portfolioUploadPhoto(item.id, file));
      }
      if (added.length) showSnackbar(`Dodano zdjęcia: ${added.length} — zapisz realizację`, 'success');
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się wgrać zdjęcia.'), 'error');
    } finally {
      hideLoader();
      addPhotos(added, asMain);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  /** Przeciąganie z pulpitu / Findera: pliki (obrazy z innych stron — najpierw zapis na dysku). */
  const externalDrag = (event: DragEvent) => {
    const types = Array.from(event.dataTransfer.types);
    return types.includes('Files') || (types.includes('text/uri-list') && dragIndex === null && featureDrag === null);
  };
  const dropFiles = (event: DragEvent, asMain: boolean) => {
    event.preventDefault();
    dragDepth.current = 0;
    setFileDrag(null);
    if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files, asMain);
    else showSnackbar('Przeciągnij plik zdjęcia z dysku. Obraz z innej strony zapisz najpierw na dysku.', 'warning');
  };

  const importPhotos = async (source: PortfolioPhotoSource, photos: PortfolioPhotoOption[]) => {
    setPicker(null);
    const added: PortfolioPhoto[] = [];
    try {
      for (const [index, photo] of photos.entries()) {
        showLoader('Dodaję zdjęcia', `${index + 1} z ${photos.length}: ${photo.name}`);
        const result = await portfolioPost<{ photo: PortfolioPhoto }>('import', { id: item.id, source, fileId: photo.id });
        added.push(result.photo);
      }
      if (added.length) showSnackbar(`Dodano zdjęcia: ${added.length} — zapisz realizację`, 'success');
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się dodać zdjęcia.'), 'error');
    } finally {
      hideLoader();
      addPhotos(added);
    }
  };

  const moveGallery = (from: number, to: number) => {
    if (from === to || to < 0 || to >= content.gallery.length) return;
    const gallery = [...content.gallery];
    const [moved] = gallery.splice(from, 1);
    gallery.splice(to, 0, moved);
    set({ gallery });
  };

  const makeMain = (index: number) => {
    const gallery = [...content.gallery];
    const [photo] = gallery.splice(index, 1);
    if (content.image) gallery.splice(index, 0, content.image);
    set({ image: photo, gallery });
  };

  const setAlt = (index: number | 'hero', alt: string) => {
    const value = alt.slice(0, PORTFOLIO_LIMITS.alt);
    if (index === 'hero') { if (content.image) set({ image: { ...content.image, alt: value } }); return; }
    set({ gallery: content.gallery.map((photo, position) => (position === index ? { ...photo, alt: value } : photo)) });
  };

  const filteredCities = cities.filter((city) => city.name.toLocaleLowerCase('pl').includes(cityQuery.toLocaleLowerCase('pl')));
  const allPhotos = [...(content.image ? [content.image] : []), ...content.gallery];
  const missingAlt = allPhotos.filter((photo) => !photo.alt).length;
  const cityLabel = (slug: string) => cities.find((city) => city.locality === slug)?.name || slug;

  /** Lista kontrolna → przewinięcie do pola, fokus (opisy alt — pierwsze zdjęcie bez opisu) i podświetlenie. */
  const jump = (key: string) => {
    const target = portfolioCheckTarget(key, content);
    const element = document.getElementById(`portfolio-${target}`);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const field = key === 'alt'
      ? element.querySelector<HTMLElement>('[data-alt-missing="true"]')
      : element.matches('input, textarea, select') ? element : element.querySelector<HTMLElement>('input:not([disabled]):not([type="checkbox"]), textarea, select');
    window.setTimeout(() => field?.focus({ preventScroll: true }), 400);
    setHighlight(target);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlight(null), 1800);
  };
  const ring = (target: string) => `rounded-lg transition-shadow duration-300 ${highlight === target ? 'ring-2 ring-[#d3bb73] ring-offset-4 ring-offset-[#1c1f33]' : ''}`;

  /** Asystent AI przy sekcji: propozycje do bieżącej (także niezapisanej) treści; opisy zdjęć — od razu w pustych polach. */
  const askAi = async (section: PortfolioAiSection) => {
    const config = PORTFOLIO_AI_SECTIONS[section];
    const result = await run(config.pending, () => portfolioPost<PortfolioAiResult>('assist', {
      id: item.id, content, eventId: draft.eventId, brief: aiBrief, fields: config.fields, usePhotos: config.photos && allPhotos.length > 0,
    }), undefined, 'Propozycje z danych realizacji, notatki dla asystenta i zdjęć…');
    if (!result) return;
    if (section === 'alts') {
      // Gdy każde zdjęcie ma opis, serwer proponuje nowe dla wszystkich — wtedy zastępujemy; inaczej uzupełniamy tylko puste.
      const all = missingAlt === 0;
      const filled = portfolioWithAlts(content, result.alts || [], all).filled;
      setDraft((current) => (current ? { ...current, content: { ...current.content, ...portfolioWithAlts(current.content, result.alts || [], all).patch } } : current));
      showSnackbar(filled ? `Uzupełniono opisy zdjęć: ${filled} — sprawdź je i zapisz realizację` : 'Asystent nie zaproponował opisów — spróbuj ponownie.', filled ? 'success' : 'warning');
      return;
    }
    setAi((current) => ({ ...current, [section]: result }));
  };
  const closeAi = (section: PortfolioAiSection) => setAi((current) => { const next = { ...current }; delete next[section]; return next; });
  const applied = (message = 'Wstawiono propozycję — zapisz realizację') => showSnackbar(message, 'success');
  const titleAi = ai.title?.titles || [];
  const descriptionAi = ai.descriptions;
  const featureAi = ai.features?.features || [];
  const seoAi = ai.seo;

  const openSocial = () => {
    setSocialPhotos(allPhotos.slice(0, SOCIAL_LIMITS.slides + 1).map((photo) => photo.src));
    setSocialOpen(true);
  };

  const createSocial = async () => {
    let current = detail;
    if (dirty) {
      const saved = await save(true);
      if (!saved) return;
      current = saved;
    }
    setSocialOpen(false);
    const result = await run('Tworzę post social media', () => portfolioPost<{ postId: string; photos: number }>('socialPost', {
      id: current.item.id, photos: socialPhotos, channels: socialChannels,
    }), undefined, 'Zdjęcia trafiają do biblioteki social media, grafiki powstają na serwerze…');
    if (!result) return;
    showSnackbar(`Utworzono szkic posta (${result.photos} ${result.photos === 1 ? 'zdjęcie' : 'zdjęć'}) — otwieram Social media`, 'success');
    router.push(`/crm/marketing/social?post=${result.postId}`);
  };

  return (
    <div className="space-y-4">
      <header className={`${cardClass} flex flex-wrap items-center gap-2 p-3`}>
        <h2 className="mr-2 min-w-0 flex-1 truncate text-lg font-light">{content.title || 'Realizacja bez tytułu'}</h2>
        <PortfolioStatusBadge status={item.status} />
        <span className="text-xs text-[#e5e4e2]/40">{dirty ? 'niezapisane zmiany' : `zapisano${item.updatedByName ? ` · ${item.updatedByName}` : ''}`}</span>
        <button type="button" className={primaryButton} disabled={!dirty} onClick={() => void save()}><Save className="h-4 w-4" />Zapisz</button>
        <button type="button" className={primaryButton} disabled={missing.length > 0 || (!dirty && item.status === 'published')}
          title={missing.length ? `Uzupełnij: ${missing.map((check) => check.label).join(', ')}` : ''} onClick={() => void publish()}>
          <Send className="h-4 w-4" />{published ? 'Opublikuj zmiany' : 'Opublikuj na stronie'}
        </button>
        {item.siteUrl && <a href={item.siteUrl} target="_blank" rel="noreferrer" className={secondaryButton}><ExternalLink className="h-4 w-4" />Zobacz na stronie</a>}
        {(item.status === 'changed' || item.status === 'conflict') && <button type="button" className={secondaryButton} onClick={() => void discard()}><RotateCcw className="h-4 w-4" />Wersja ze strony</button>}
        <button type="button" className={secondaryButton} disabled={!allPhotos.length} title={allPhotos.length ? 'Szkic posta z karuzelą zdjęć realizacji' : 'Dodaj zdjęcia'} onClick={openSocial}><Instagram className="h-4 w-4" />Utwórz post</button>
        {published && <button type="button" className={secondaryButton} onClick={() => void unpublish()}>Usuń ze strony</button>}
        <button type="button" className={dangerButton} onClick={() => void remove()} aria-label="Usuń realizację"><Trash2 className="h-4 w-4" /></button>
      </header>

      {item.status === 'conflict' && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
          <AlertTriangle className="h-4 w-4" />
          <span className="flex-1">Tę realizację zmieniono także bezpośrednio na stronie (tryb edycji strony). Wybierz: pobierz wersję ze strony albo opublikuj swoją.</span>
          <button type="button" className={secondaryButton} onClick={() => void discard()}>Pobierz ze strony</button>
        </div>
      )}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <section className={`${cardClass} grid gap-3 p-4 md:grid-cols-2`}>
            <h3 className="text-sm font-medium md:col-span-2">Podstawy</h3>
            <div id="portfolio-title" className={`space-y-1.5 text-sm md:col-span-2 ${ring('title')}`}>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="portfolio-title-input">Tytuł</label>
                <AiButton label={PORTFOLIO_AI_SECTIONS.title.button} onClick={() => void askAi('title')} />
              </div>
              <input id="portfolio-title-input" value={content.title} maxLength={PORTFOLIO_LIMITS.title} onChange={(event) => set({ title: event.target.value })} className={inputClass} placeholder="Jubileusz 30 lat marki" />
              {titleAi.length > 0 && (
                <AiPanel title="Propozycje tytułu — kliknij, żeby wstawić" onClose={() => closeAi('title')} onRetry={() => void askAi('title')}>
                  <div className="flex flex-wrap gap-1.5">
                    {titleAi.map((title) => (
                      <button key={title} type="button" onClick={() => { set(portfolioWithTitle(content, title, published)); applied('Wstawiono tytuł — zapisz realizację'); }}
                        className={`rounded-lg border px-2.5 py-1.5 text-left text-sm ${content.title === title ? 'border-[#d3bb73] bg-[#d3bb73]/15 text-[#d3bb73]' : 'border-[#d3bb73]/20 text-[#e5e4e2]/85 hover:border-[#d3bb73]/50'}`}>
                        {title}<span className="ml-1.5 text-[10px] text-[#e5e4e2]/40">{title.length} zn.</span>
                      </button>
                    ))}
                  </div>
                  {!published && <p className="text-[#e5e4e2]/45">Adres strony zmieni się razem z tytułem, jeśli nie był ustawiony ręcznie.</p>}
                </AiPanel>
              )}
            </div>
            <label className="block text-sm md:col-span-2">Notatka dla asystenta AI <span className="text-xs text-[#e5e4e2]/40">(opcjonalnie — motyw, dla kogo, co przygotowaliśmy, co było wyjątkowe; asystent użyje jej przy tytule, opisach, elementach i SEO)</span>
              <textarea value={aiBrief} maxLength={1500} rows={2} onChange={(event) => setAiBrief(event.target.value)} className={`${inputClass} mt-1`}
                placeholder="Np. urodziny 30-latki w stylu Wielkiego Gatsby'ego, scena z ekranem LED, kasyno Monte Carlo, fotolustro, muzyka na żywo." />
            </label>
            <div id="portfolio-slug" className={`text-sm md:col-span-2 ${ring('slug')}`}>
              <div className="flex items-center gap-2">Adres strony
                {published && <span className="inline-flex items-center gap-1 text-xs text-[#e5e4e2]/40"><Lock className="h-3 w-3" />opublikowany adres się nie zmienia</span>}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-[#e5e4e2]/40">mavinci.pl/portfolio/</span>
                <input value={content.slug} disabled={published} maxLength={PORTFOLIO_LIMITS.slug} onChange={(event) => set({ slug: event.target.value.toLowerCase() })}
                  onBlur={() => set({ slug: portfolioSlug(content.slug) })} className={inputClass} />
                {!published && <button type="button" className={secondaryButton} title="Adres z tytułu" onClick={() => set({ slug: portfolioSlug(content.title) })}><Wand2 className="h-4 w-4" /></button>}
              </div>
            </div>
            <label className="block text-sm">Kategoria
              <input value={content.category} list="portfolio-categories" maxLength={PORTFOLIO_LIMITS.category} onChange={(event) => set({ category: event.target.value })} className={`${inputClass} mt-1`} placeholder="Gala, Konferencja, Jubileusz…" />
              <datalist id="portfolio-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist>
            </label>
            <label className="block text-sm">Data wydarzenia
              <input type="date" value={content.eventDate || ''} onChange={(event) => set({ eventDate: event.target.value || null })} className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-sm">Miejsce (obiekt, miasto)
              <input value={content.location} maxLength={PORTFOLIO_LIMITS.location} onChange={(event) => set({ location: event.target.value })} className={`${inputClass} mt-1`} placeholder="Hotel Omega, Olsztyn" />
            </label>
            <label className="block text-sm">Klient <span className="text-xs text-[#e5e4e2]/40">(opcjonalnie, do opisów)</span>
              <input value={content.client} maxLength={PORTFOLIO_LIMITS.client} onChange={(event) => set({ client: event.target.value })} className={`${inputClass} mt-1`} />
            </label>
            <div className="text-sm md:col-span-2">
              <div className="mb-1">Wydarzenie w CRM</div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={`${secondaryButton} max-w-full justify-start truncate`} onClick={() => setEventPicker((value) => !value)}>
                  <CalendarDays className="h-4 w-4 shrink-0" /><span className="truncate">{draft.event?.name || 'Powiąż z wydarzeniem'}</span>
                </button>
                {draft.eventId && <button type="button" className={secondaryButton} aria-label="Bez wydarzenia" onClick={() => setDraft({ ...draft, eventId: null, event: null })}><X className="h-4 w-4" /></button>}
                {draft.event && <span className="text-xs text-[#e5e4e2]/45">{[draft.event.date?.slice(0, 10), draft.event.location, draft.event.category].filter(Boolean).join(' · ')}</span>}
              </div>
              {eventPicker && (
                <div className="mt-2 space-y-2 rounded-lg border border-[#d3bb73]/15 p-2">
                  <input value={eventQuery} onChange={(event) => setEventQuery(event.target.value)} placeholder="Szukaj wydarzenia" className={inputClass} autoFocus />
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {events.map((event) => (
                      <button key={event.id} type="button" className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[#d3bb73]/10"
                        onClick={() => { setDraft({ ...draft, eventId: event.id, event }); setEventPicker(false); }}>
                        {event.name}<span className="ml-2 text-xs text-[#e5e4e2]/45">{[event.date?.slice(0, 10), event.location].filter(Boolean).join(' · ')}</span>
                      </button>
                    ))}
                    {!events.length && <p className="p-2 text-xs text-[#e5e4e2]/45">Brak wydarzeń.</p>}
                  </div>
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={content.isFeatured} onChange={(event) => set({ isFeatured: event.target.checked })} />Wyróżniona realizacja</label>
            <label className="flex items-center gap-2 text-sm">Kolejność na stronie
              <input type="number" value={content.orderIndex} onChange={(event) => set({ orderIndex: Number(event.target.value) || 0 })} className={`${inputClass} w-24`} />
            </label>
          </section>

          <section className={`${cardClass} relative space-y-3 p-4`}
            onDragEnter={(event) => { if (!externalDrag(event)) return; event.preventDefault(); dragDepth.current += 1; if (fileDrag === null) setFileDrag('section'); }}
            onDragOver={(event) => { if (!externalDrag(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
            onDragLeave={(event) => { if (!externalDrag(event)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setFileDrag(null); }}
            onDrop={(event) => { if (externalDrag(event)) dropFiles(event, fileDrag === 'hero'); }}>
            {fileDrag && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-[#d3bb73] bg-[#0f1119]/75">
                <div className="flex items-center gap-2 rounded-lg bg-[#1c1f33] px-4 py-2 text-sm text-[#d3bb73]">
                  <Upload className="h-5 w-5" />{fileDrag === 'hero' ? 'Upuść — zdjęcie zostanie zdjęciem głównym' : 'Upuść zdjęcia, żeby dodać je do realizacji'}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto text-sm font-medium">Zdjęcia <span className="text-xs text-[#e5e4e2]/40">({(content.image ? 1 : 0) + content.gallery.length})</span></h3>
              {allPhotos.length > 0 && (
                <AiButton label={missingAlt ? `Opisz zdjęcia (${missingAlt} bez opisu)` : 'Nowe opisy zdjęć'} onClick={() => void askAi('alts')} />
              )}
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(event) => void uploadFiles(event.target.files)} />
              <button type="button" className={secondaryButton} onClick={() => fileInput.current?.click()}><Upload className="h-4 w-4" />Z dysku</button>
              <button type="button" className={secondaryButton} onClick={() => setPicker('event')}><FolderOpen className="h-4 w-4" />Z wydarzenia</button>
              <button type="button" className={secondaryButton} onClick={() => setPicker('material')}><Images className="h-4 w-4" />Z Materiałów</button>
              <button type="button" className={secondaryButton} onClick={() => setPicker('social')}><Sparkles className="h-4 w-4" />Z biblioteki social</button>
            </div>
            <p className="text-xs text-[#e5e4e2]/45">Przeciągnij pliki zdjęć z pulpitu albo Findera na tę sekcję (na zdjęcie główne — zastąpi je). JPEG, PNG, WebP do 40 MB; wersje strony (WebP: komputer, telefon, miniatura) powstaną na serwerze.</p>
            <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
              <div id="portfolio-image" className={`space-y-1.5 ${ring('image')}`}
                onDragOver={(event) => { if (externalDrag(event) && fileDrag !== 'hero') setFileDrag('hero'); }}
                onDragLeave={(event) => { if (externalDrag(event) && !event.currentTarget.contains(event.relatedTarget as Node | null)) setFileDrag(dragDepth.current ? 'section' : null); }}>
                <div className="text-xs text-[#e5e4e2]/50">Zdjęcie główne</div>
                {content.image ? (
                  <>
                    <div className={`relative overflow-hidden rounded-lg bg-black ${fileDrag === 'hero' ? 'ring-2 ring-[#d3bb73]' : ''}`}><img src={content.image.thumb} alt="" className="aspect-[4/3] w-full object-cover" />
                      <button type="button" aria-label="Usuń zdjęcie główne" className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white/80 hover:text-white" onClick={() => set({ image: null })}><X className="h-4 w-4" /></button>
                    </div>
                    <input value={content.image.alt} maxLength={PORTFOLIO_LIMITS.alt} onChange={(event) => setAlt('hero', event.target.value)} placeholder="Opis zdjęcia (alt)"
                      data-alt-missing={content.image.alt ? undefined : 'true'} className={`${inputClass} ${content.image.alt ? '' : 'border-amber-400/30'}`} />
                  </>
                ) : (
                  <button type="button" onClick={() => fileInput.current?.click()}
                    className={`flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs ${fileDrag === 'hero' ? 'border-[#d3bb73] text-[#d3bb73]' : 'border-[#d3bb73]/25 text-[#d3bb73]/50 hover:border-[#d3bb73]/60 hover:text-[#d3bb73]'}`}>
                    <ImageIcon className="h-8 w-8" />Upuść zdjęcie główne albo kliknij
                  </button>
                )}
              </div>
              <div id="portfolio-gallery" className={`space-y-1.5 ${ring('gallery')}`}>
                <div className="text-xs text-[#e5e4e2]/50">Galeria — przeciągnij, żeby zmienić kolejność</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                  {content.gallery.map((photo, index) => (
                    <div key={photo.src} draggable onDragStart={() => setDragIndex(index)} onDragEnd={() => setDragIndex(null)}
                      onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragIndex !== null) moveGallery(dragIndex, index); setDragIndex(null); }}
                      className={`space-y-1 rounded-lg border p-1 ${dragIndex === index ? 'border-[#d3bb73]/60 opacity-60' : 'border-[#d3bb73]/10'}`}>
                      <div className="relative overflow-hidden rounded bg-black">
                        <img src={photo.thumb} alt="" className="aspect-[4/3] w-full object-cover" />
                        <GripVertical className="absolute left-1 top-1 h-4 w-4 cursor-grab text-white/70" />
                        <div className="absolute right-1 top-1 flex gap-1">
                          <button type="button" title="Ustaw jako główne" className="rounded bg-black/60 p-1 text-white/80 hover:text-[#d3bb73]" onClick={() => makeMain(index)}><Star className="h-3.5 w-3.5" /></button>
                          <button type="button" title="Usuń z galerii" className="rounded bg-black/60 p-1 text-white/80 hover:text-red-300" onClick={() => set({ gallery: content.gallery.filter((_, position) => position !== index) })}><X className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                      <input value={photo.alt} maxLength={PORTFOLIO_LIMITS.alt} onChange={(event) => setAlt(index, event.target.value)} placeholder="Opis (alt)"
                        data-alt-missing={photo.alt ? undefined : 'true'} className={`${inputClass} px-2 py-1 text-xs ${photo.alt ? '' : 'border-amber-400/30'}`} />
                    </div>
                  ))}
                  {content.gallery.length < PORTFOLIO_LIMITS.gallery && (
                    <button type="button" onClick={() => fileInput.current?.click()}
                      className="flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#d3bb73]/30 p-2 text-center text-xs text-[#e5e4e2]/55 hover:border-[#d3bb73]/60 hover:text-[#d3bb73]">
                      <Upload className="h-5 w-5" />Upuść zdjęcia tutaj
                      <span className="text-[10px] text-[#e5e4e2]/35">albo kliknij — JPEG, PNG, WebP</span>
                    </button>
                  )}
                </div>
                {!content.gallery.length && <p className="text-xs text-[#e5e4e2]/45">Dodaj 5–12 zdjęć: szerokie ujęcie sali, scena, detale, goście (bez portretów).</p>}
              </div>
            </div>
          </section>

          <section className={`${cardClass} space-y-3 p-4`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Opisy</h3>
              <AiButton label={PORTFOLIO_AI_SECTIONS.descriptions.button} onClick={() => void askAi('descriptions')} />
            </div>
            {descriptionAi && (descriptionAi.description || descriptionAi.detailedDescription) && (
              <AiPanel title="Propozycje opisów" onClose={() => closeAi('descriptions')} onRetry={() => void askAi('descriptions')}>
                {descriptionAi.description && (
                  <AiText label="Krótki opis" hint={<span className="text-[#e5e4e2]/40">{descriptionAi.description.length} zn.</span>}
                    text={descriptionAi.description} onUse={() => { set({ description: descriptionAi.description || '' }); applied(); }} />
                )}
                {descriptionAi.detailedDescription && (
                  <AiText label="Szczegółowy opis" hint={<span className="text-[#e5e4e2]/40">{descriptionAi.detailedDescription.length} zn.</span>}
                    text={descriptionAi.detailedDescription} onUse={() => { set({ detailedDescription: descriptionAi.detailedDescription || '' }); applied(); }} />
                )}
                {descriptionAi.description && descriptionAi.detailedDescription && (
                  <button type="button" className={aiLink} onClick={() => {
                    set({ description: descriptionAi.description || '', detailedDescription: descriptionAi.detailedDescription || '' });
                    applied('Wstawiono oba opisy — zapisz realizację');
                    closeAi('descriptions');
                  }}>Użyj obu</button>
                )}
              </AiPanel>
            )}
            <label id="portfolio-description" className={`block text-sm ${ring('description')}`}>Krótki opis <span className="text-xs text-[#e5e4e2]/40">({content.description.length}/{PORTFOLIO_LIMITS.description} — karta realizacji)</span>
              <textarea value={content.description} maxLength={PORTFOLIO_LIMITS.description} rows={3} onChange={(event) => set({ description: event.target.value })} className={`${inputClass} mt-1`} />
            </label>
            <label id="portfolio-detailed" className={`block text-sm ${ring('detailed')}`}>Szczegółowy opis <span className="text-xs text-[#e5e4e2]/40">({content.detailedDescription.length} znaków, zalecane od {PORTFOLIO_LIMITS.detailedRecommended}; akapity oddziel pustą linią)</span>
              <textarea value={content.detailedDescription} maxLength={PORTFOLIO_LIMITS.detailedDescription} rows={10} onChange={(event) => set({ detailedDescription: event.target.value })} className={`${inputClass} mt-1`} />
            </label>
          </section>

          <section id="portfolio-features" className={`${cardClass} space-y-3 p-4 ${ring('features')}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="mr-auto text-sm font-medium">Elementy realizacji <span className="text-xs text-[#e5e4e2]/40">({content.features.length}/{PORTFOLIO_LIMITS.features})</span></h3>
              <AiButton label={PORTFOLIO_AI_SECTIONS.features.button} onClick={() => void askAi('features')} />
              <button type="button" className={secondaryButton} disabled={content.features.length >= PORTFOLIO_LIMITS.features}
                onClick={() => set({ features: [...content.features, { icon: 'Star', title: '', description: '' }] })}><Plus className="h-4 w-4" />Dodaj element</button>
            </div>
            {featureAi.length > 0 && (
              <AiPanel title="Propozycje elementów realizacji" onClose={() => closeAi('features')} onRetry={() => void askAi('features')}>
                <ul className="space-y-1">
                  {featureAi.map((feature, index) => {
                    const exists = content.features.some((item) => item.title.toLocaleLowerCase('pl') === feature.title.toLocaleLowerCase('pl'));
                    return (
                      <li key={`${feature.title}-${index}`} className="flex items-center gap-2">
                        <FeatureIcon name={feature.icon} className="h-4 w-4 shrink-0 text-[#d3bb73]" />
                        <span className="min-w-0 flex-1"><span className="text-[#e5e4e2]/90">{feature.title}</span>{feature.description && <span className="text-[#e5e4e2]/50"> — {feature.description}</span>}</span>
                        {exists ? <span className="text-[#e5e4e2]/40">już jest</span> : (
                          <button type="button" className={aiLink} disabled={content.features.length >= PORTFOLIO_LIMITS.features}
                            onClick={() => { set({ features: portfolioAddFeatures(content, [feature]) }); applied('Dodano element — zapisz realizację'); }}>Dodaj</button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="flex flex-wrap gap-3 border-t border-[#d3bb73]/10 pt-2">
                  <button type="button" className={aiLink} onClick={() => { set({ features: featureAi.slice(0, PORTFOLIO_LIMITS.features) }); applied('Zastąpiono elementy realizacji — zapisz realizację'); closeAi('features'); }}>Zastąp listę</button>
                  <button type="button" className={aiLink} onClick={() => { set({ features: portfolioAddFeatures(content, featureAi) }); applied('Dodano nowe elementy — zapisz realizację'); closeAi('features'); }}>Dodaj nowe</button>
                </div>
              </AiPanel>
            )}
            {content.features.length > 1 && <p className="text-[11px] text-[#e5e4e2]/40">Przeciągnij element za uchwyt, żeby zmienić kolejność (albo strzałki).</p>}
            {content.features.map((feature, index) => (
              <div key={index}
                onDragOver={(event) => {
                  if (featureDrag === null) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  const box = event.currentTarget.getBoundingClientRect();
                  setFeatureTarget(event.clientY > box.top + box.height / 2 ? index + 1 : index);
                }}
                onDrop={(event) => { event.preventDefault(); if (featureDrag !== null && featureTarget !== null) moveFeatureTo(featureDrag, featureTarget); endFeatureDrag(); }}
                className={`relative grid items-start gap-2 rounded-lg border border-[#d3bb73]/10 p-2 md:grid-cols-[auto_170px_minmax(0,1fr)_minmax(0,1.4fr)_auto] ${featureDrag === index ? 'opacity-40' : ''}`}>
                {featureDrag !== null && featureTarget === index && <span className="pointer-events-none absolute -top-[5px] left-0 right-0 h-[2px] rounded bg-[#d3bb73]" />}
                {featureDrag !== null && featureTarget === content.features.length && index === content.features.length - 1 && (
                  <span className="pointer-events-none absolute -bottom-[5px] left-0 right-0 h-[2px] rounded bg-[#d3bb73]" />
                )}
                <span draggable className="flex h-9 cursor-grab items-center text-[#e5e4e2]/40 active:cursor-grabbing" title="Przeciągnij, żeby zmienić kolejność"
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', String(index));
                    const row = event.currentTarget.parentElement;
                    if (row) event.dataTransfer.setDragImage(row, 16, 16);
                    setFeatureDrag(index);
                  }}
                  onDragEnd={endFeatureDrag}>
                  <GripVertical className="h-4 w-4" />
                </span>
                <label className="flex items-center gap-2">
                  <FeatureIcon name={feature.icon} className="h-5 w-5 shrink-0 text-[#d3bb73]" />
                  <select value={feature.icon} onChange={(event) => set({ features: content.features.map((item, position) => (position === index ? { ...item, icon: event.target.value } : item)) })} className={inputClass}>
                    {PORTFOLIO_ICONS.map((icon) => <option key={icon.name} value={icon.name}>{icon.category} — {icon.label}</option>)}
                  </select>
                </label>
                <input value={feature.title} maxLength={PORTFOLIO_LIMITS.featureTitle} placeholder="Np. Scena z ekranem LED" className={inputClass}
                  onChange={(event) => set({ features: content.features.map((item, position) => (position === index ? { ...item, title: event.target.value } : item)) })} />
                <input value={feature.description} maxLength={PORTFOLIO_LIMITS.featureDescription} placeholder="Krótki opis (opcjonalnie)" className={inputClass}
                  onChange={(event) => set({ features: content.features.map((item, position) => (position === index ? { ...item, description: event.target.value } : item)) })} />
                <div className="flex gap-1">
                  <button type="button" className={secondaryButton} aria-label="W górę" disabled={index === 0}
                    onClick={() => { const features = [...content.features]; [features[index - 1], features[index]] = [features[index], features[index - 1]]; set({ features }); }}><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" className={secondaryButton} aria-label="W dół" disabled={index === content.features.length - 1}
                    onClick={() => { const features = [...content.features]; [features[index + 1], features[index]] = [features[index], features[index + 1]]; set({ features }); }}><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" className={dangerButton} aria-label="Usuń element" onClick={() => set({ features: content.features.filter((_, position) => position !== index) })}><X className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </section>

          <section className={`${cardClass} grid gap-3 p-4 md:grid-cols-2`}>
            <div className="flex items-center justify-between gap-2 md:col-span-2">
              <h3 className="text-sm font-medium">SEO i miasta</h3>
              <AiButton label={PORTFOLIO_AI_SECTIONS.seo.button} onClick={() => void askAi('seo')} />
            </div>
            {seoAi && (
              <AiPanel title="Propozycje SEO — opis w Google, frazy, tagi i miasta" onClose={() => closeAi('seo')} onRetry={() => void askAi('seo')}>
                {seoAi.metaDescription && (
                  <AiText label="Opis w Google" text={seoAi.metaDescription}
                    hint={<span className={seoAi.metaDescription.length >= PORTFOLIO_LIMITS.metaMin && seoAi.metaDescription.length <= PORTFOLIO_LIMITS.metaMax ? 'text-emerald-300' : 'text-amber-200'}>{seoAi.metaDescription.length} zn.</span>}
                    onUse={() => { set({ metaDescription: seoAi.metaDescription || '' }); applied(); }} />
                )}
                {(seoAi.keywords?.length || 0) > 0 && (
                  <div className="rounded-lg bg-black/20 p-2">
                    <div className="mb-1 flex flex-wrap items-center gap-3"><span className="flex-1 text-[#e5e4e2]/70">Słowa kluczowe</span>
                      <button type="button" className={aiLink} onClick={() => { set({ keywords: portfolioMergePhrases(content.keywords, seoAi.keywords || [], PORTFOLIO_LIMITS.keywords, PORTFOLIO_LIMITS.keyword) }); applied('Dodano słowa kluczowe — zapisz realizację'); }}>Dodaj brakujące</button>
                      <button type="button" className={aiLink} onClick={() => { set({ keywords: portfolioMergePhrases([], seoAi.keywords || [], PORTFOLIO_LIMITS.keywords, PORTFOLIO_LIMITS.keyword) }); applied('Zastąpiono słowa kluczowe — zapisz realizację'); }}>Zastąp</button>
                    </div>
                    <div className="flex flex-wrap gap-1">{(seoAi.keywords || []).map((keyword) => <span key={keyword} className={`rounded-full border px-2 py-0.5 ${content.keywords.some((item) => item.toLocaleLowerCase('pl') === keyword.toLocaleLowerCase('pl')) ? 'border-emerald-400/30 text-emerald-200' : 'border-[#d3bb73]/25 text-[#d3bb73]'}`}>{keyword}</span>)}</div>
                  </div>
                )}
                {(seoAi.tags?.length || 0) > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-black/20 p-2">
                    <span className="text-[#e5e4e2]/70">Tagi:</span>
                    {(seoAi.tags || []).map((tag) => <span key={tag} className="rounded-full border border-[#d3bb73]/25 px-2 py-0.5 text-[#d3bb73]">{tag}</span>)}
                    <span className="flex-1" />
                    <button type="button" className={aiLink} onClick={() => { set({ tags: portfolioMergePhrases(content.tags, seoAi.tags || [], PORTFOLIO_LIMITS.tags, PORTFOLIO_LIMITS.tag) }); applied('Dodano tagi — zapisz realizację'); }}>Dodaj</button>
                  </div>
                )}
                {seoAi.eventCitySlug !== undefined && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-black/20 p-2">
                    <span className="text-[#e5e4e2]/70">Miasto realizacji:</span>
                    {seoAi.eventCitySlug ? <span className="text-[#e5e4e2]/90">{cityLabel(seoAi.eventCitySlug)}</span> : <span className="text-[#e5e4e2]/45">nie udało się ustalić — wpisz miasto w polu „Miejsce” albo wybierz z listy</span>}
                    <span className="flex-1" />
                    {seoAi.eventCitySlug && (content.eventCitySlug === seoAi.eventCitySlug ? <span className="text-emerald-300">ustawione</span> : (
                      <button type="button" className={aiLink} onClick={() => { set({ eventCitySlug: seoAi.eventCitySlug || null }); applied('Ustawiono miasto realizacji — zapisz realizację'); }}>Ustaw</button>
                    ))}
                  </div>
                )}
                {(seoAi.referenceCitySlugs?.length || 0) > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-black/20 p-2">
                    <span className="text-[#e5e4e2]/70">Priorytetowe miasta:</span>
                    {(seoAi.referenceCitySlugs || []).map((slug) => <span key={slug} className={`rounded-full border px-2 py-0.5 ${content.referenceCitySlugs.includes(slug) ? 'border-emerald-400/30 text-emerald-200' : 'border-[#d3bb73]/25 text-[#d3bb73]'}`}>{cityLabel(slug)}</span>)}
                    <span className="flex-1" />
                    <button type="button" className={aiLink} onClick={() => { set({ referenceCitySlugs: portfolioMergePhrases(content.referenceCitySlugs, seoAi.referenceCitySlugs || [], 60, 120) }); applied('Dodano priorytetowe miasta — zapisz realizację'); }}>Dodaj</button>
                  </div>
                )}
                <button type="button" className={aiLink} onClick={() => {
                  set({
                    ...(seoAi.metaDescription ? { metaDescription: seoAi.metaDescription } : {}),
                    keywords: portfolioMergePhrases(content.keywords, seoAi.keywords || [], PORTFOLIO_LIMITS.keywords, PORTFOLIO_LIMITS.keyword),
                    tags: portfolioMergePhrases(content.tags, seoAi.tags || [], PORTFOLIO_LIMITS.tags, PORTFOLIO_LIMITS.tag),
                    ...(seoAi.eventCitySlug ? { eventCitySlug: seoAi.eventCitySlug } : {}),
                    referenceCitySlugs: portfolioMergePhrases(content.referenceCitySlugs, seoAi.referenceCitySlugs || [], 60, 120),
                  });
                  applied('Wstawiono propozycje SEO — zapisz realizację');
                  closeAi('seo');
                }}>Użyj wszystkich (frazy, tagi i miasta — dopisane do obecnych)</button>
              </AiPanel>
            )}
            <label id="portfolio-meta" className={`block text-sm md:col-span-2 ${ring('meta')}`}>Opis w Google
              <span className={`ml-2 text-xs ${metaLength >= PORTFOLIO_LIMITS.metaMin && metaLength <= PORTFOLIO_LIMITS.metaMax ? 'text-emerald-300' : 'text-amber-200'}`}>{metaLength} znaków (zalecane {PORTFOLIO_LIMITS.metaMin}–{PORTFOLIO_LIMITS.metaMax})</span>
              <textarea value={content.metaDescription} maxLength={PORTFOLIO_LIMITS.metaDescription} rows={2} onChange={(event) => set({ metaDescription: event.target.value })} className={`${inputClass} mt-1`} />
            </label>
            <div id="portfolio-keywords" className={`text-sm ${ring('keywords')}`}>
              <div className="mb-1">Słowa kluczowe <span className="text-xs text-[#e5e4e2]/40">(Enter albo przecinek)</span></div>
              <ChipsInput values={content.keywords} onChange={(keywords) => set({ keywords })} placeholder="gala firmowa olsztyn" max={PORTFOLIO_LIMITS.keywords} maxLength={PORTFOLIO_LIMITS.keyword} disabled={false} />
            </div>
            <div className="text-sm">
              <div className="mb-1">Tagi <span className="text-xs text-[#e5e4e2]/40">(np. „konferencje” — strony konferencji)</span></div>
              <ChipsInput values={content.tags} onChange={(tags) => set({ tags })} placeholder="konferencje" max={PORTFOLIO_LIMITS.tags} maxLength={PORTFOLIO_LIMITS.tag} disabled={false} />
            </div>
            <label id="portfolio-city" className={`block text-sm ${ring('city')}`}>Miasto realizacji
              <select value={content.eventCitySlug || ''} onChange={(event) => set({ eventCitySlug: event.target.value || null })} className={`${inputClass} mt-1`}>
                <option value="">Nie przypisano / inne miejsce</option>
                {content.eventCitySlug && !cities.some((city) => city.locality === content.eventCitySlug) && <option value={content.eventCitySlug}>Dotychczas przypisane miasto</option>}
                {cities.map((city) => <option key={city.locality} value={city.locality}>{city.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">Na stronach konferencji
              <select value={content.conferenceReferenceEnabled === null ? 'inherit' : content.conferenceReferenceEnabled ? 'include' : 'exclude'}
                onChange={(event) => set({ conferenceReferenceEnabled: event.target.value === 'inherit' ? null : event.target.value === 'include' })} className={`${inputClass} mt-1`}>
                <option value="inherit">Automatycznie — według tagu „konferencje”</option>
                <option value="include">Pokazuj jako przykład obsługi konferencji</option>
                <option value="exclude">Nie pokazuj na stronach konferencji</option>
              </select>
            </label>
            <div className="text-sm md:col-span-2">
              <div className="mb-1">Priorytetowe miasta <span className="text-xs text-[#e5e4e2]/40">(na których stronach usług pokazać realizację wyżej; nie zmieniają miejsca wydarzenia)</span></div>
              <input value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} placeholder="Szukaj miasta…" className={inputClass} />
              <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-3">
                {filteredCities.map((city) => (
                  <label key={city.locality} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-white/5">
                    <input type="checkbox" checked={content.referenceCitySlugs.includes(city.locality)}
                      onChange={(event) => set({ referenceCitySlugs: event.target.checked ? [...content.referenceCitySlugs, city.locality] : content.referenceCitySlugs.filter((slug) => slug !== city.locality) })} />
                    {city.name}
                  </label>
                ))}
              </div>
            </div>
            <label className="block text-sm md:col-span-2">Film (adres https, opcjonalnie)
              <input value={content.videoUrl} maxLength={PORTFOLIO_LIMITS.videoUrl} onChange={(event) => set({ videoUrl: event.target.value.trim() })} className={`${inputClass} mt-1`} placeholder="https://www.youtube.com/watch?v=…" />
            </label>
          </section>
        </div>

        <aside className="space-y-4">
          <section className={`${cardClass} space-y-2 p-4`}>
            <h3 className="text-sm font-medium">Lista kontrolna</h3>
            <p className="text-[11px] text-[#e5e4e2]/40">Kliknij punkt, żeby przejść do pola.</p>
            {checks.map((check) => (
              <button key={check.key} type="button" onClick={() => jump(check.key)} title="Przejdź do pola"
                className="group -mx-1.5 flex w-[calc(100%+0.75rem)] items-start gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-[#d3bb73]/10">
                {check.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> : check.required ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />}
                <span className="min-w-0 flex-1"><span className={check.ok ? 'text-[#e5e4e2]/80' : check.required ? 'text-red-200 underline decoration-dotted underline-offset-2' : 'text-amber-100 underline decoration-dotted underline-offset-2'}>{check.label}{check.required && !check.ok ? ' (wymagane)' : ''}</span>
                  {!check.ok && <span className="block text-[#e5e4e2]/45">{check.hint}</span>}</span>
                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d3bb73]/0 transition-colors group-hover:text-[#d3bb73]/80" />
              </button>
            ))}
          </section>
          <section className={`${cardClass} space-y-1 p-4`}>
            <h3 className="mb-1 text-sm font-medium">Podgląd w Google</h3>
            <div className="rounded-lg bg-white p-3">
              <div className="truncate text-xs text-[#202124]">{preview.url}</div>
              <div className="truncate text-base text-[#1a0dab]">{preview.title}</div>
              <div className="line-clamp-2 text-xs text-[#4d5156]">{preview.description || 'Dodaj opis w Google albo krótki opis.'}</div>
            </div>
          </section>
          <PortfolioAssistant itemId={item.id} content={content} eventId={draft.eventId} onSite={published} brief={aiBrief} onBrief={setAiBrief} run={run} onApply={set} />
          <section className={`${cardClass} space-y-1 p-4 text-xs text-[#e5e4e2]/50`}>
            <div>Utworzono {new Date(item.createdAt).toLocaleString('pl-PL')}{item.createdByName ? ` · ${item.createdByName}` : ''}</div>
            {item.publishedAt && <div>Opublikowano {new Date(item.publishedAt).toLocaleString('pl-PL')}{item.publishedByName ? ` · ${item.publishedByName}` : ''}</div>}
          </section>
        </aside>
      </div>

      {socialOpen && (
        <Modal open onClose={() => setSocialOpen(false)} title="Utwórz post social media" scrollBody>
          <div className="space-y-4 text-sm">
            <p className="text-[#e5e4e2]/60">Zaznaczone zdjęcia trafią do biblioteki social media marki, a post (szkic) dostanie okładkę z tytułem realizacji i napisem „Realizacja”, kolejne zdjęcia jako karuzelę (Instagram do {SOCIAL_LIMITS.slides + 1}, Facebook — post z kilkoma zdjęciami), opis z krótkiego opisu i hashtagi ze słów kluczowych. Dalej edytujesz go w Social media (kadry, styl, akceptacja, publikacja).</p>
            <div>
              <div className="mb-1.5 flex items-center justify-between"><span>Zdjęcia ({socialPhotos.length}/{SOCIAL_LIMITS.slides + 1}) — kolejność jak w realizacji</span>
                <button type="button" className="text-xs text-[#d3bb73] hover:underline" onClick={() => setSocialPhotos(socialPhotos.length ? [] : allPhotos.slice(0, SOCIAL_LIMITS.slides + 1).map((photo) => photo.src))}>{socialPhotos.length ? 'Odznacz wszystkie' : 'Zaznacz pierwsze 10'}</button>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {allPhotos.map((photo) => {
                  const active = socialPhotos.includes(photo.src);
                  const index = socialPhotos.indexOf(photo.src);
                  return (
                    <button key={photo.src} type="button" title={photo.alt || ''}
                      onClick={() => setSocialPhotos((current) => (active ? current.filter((src) => src !== photo.src)
                        : current.length >= SOCIAL_LIMITS.slides + 1 ? current : allPhotos.map((item) => item.src).filter((src) => src === photo.src || current.includes(src))))}
                      className={`relative aspect-square overflow-hidden rounded-lg border-2 ${active ? 'border-[#d3bb73]' : 'border-transparent opacity-60 hover:opacity-100'}`}>
                      <img src={photo.thumb} alt="" className="h-full w-full object-cover" />
                      {active && <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#d3bb73] px-1 text-[11px] font-semibold text-[#1c1f33]">{index === 0 ? <Check className="h-3 w-3" /> : index + 1}</span>}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-[#e5e4e2]/45">Pierwsze zaznaczone zdjęcie to okładka z tytułem.</p>
            </div>
            <div className="space-y-1.5">
              <div>Kanały</div>
              {SOCIAL_CHANNELS.map((channel) => (
                <label key={channel} className="flex items-center gap-2">
                  <input type="checkbox" checked={socialChannels.includes(channel)}
                    onChange={(event) => setSocialChannels((current) => (event.target.checked ? [...current, channel] : current.filter((item) => item !== channel)))} />
                  {SOCIAL_CHANNEL_LABELS[channel]}{channel === 'instagram_story' ? ' (tylko okładka)' : ''}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-[#d3bb73]/10 pt-3">
              <button type="button" className={secondaryButton} onClick={() => setSocialOpen(false)}>Anuluj</button>
              <button type="button" className={primaryButton} disabled={!socialPhotos.length || !socialChannels.length} onClick={() => void createSocial()}>
                <Instagram className="h-4 w-4" />Utwórz szkic posta
              </button>
            </div>
          </div>
        </Modal>
      )}

      {picker && (
        <PortfolioPhotoPicker eventId={draft.eventId} eventName={draft.event?.name || null} initialSource={picker} onClose={() => setPicker(null)}
          onPick={(source, photos) => void importPhotos(source, photos)} />
      )}
    </div>
  );
}
