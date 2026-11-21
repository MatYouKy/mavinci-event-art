'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  Archive, ArrowDown, ArrowUp, Copy, Image as ImageIcon, LayoutTemplate, Plus, RotateCcw, Save, Square, SunDim, Trash2, Type, X,
} from 'lucide-react';
import OverlayPortal from '@/components/UI/OverlayPortal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { useDialog } from '@/contexts/DialogContext';
import { SOCIAL_FORMATS, SOCIAL_FORMAT_INFO, type SocialFormat } from '@/lib/social/socialShared';
import {
  SOCIAL_LAYOUT_BIND_LABELS, SOCIAL_LAYOUT_COLORS, SOCIAL_LAYOUT_COLOR_LABELS, SOCIAL_LAYOUT_ELEMENT_LABELS, SOCIAL_LAYOUT_LIMITS,
  socialAspectCrop, socialLayoutProblem, socialLayoutRect, socialLayoutSlotAspect, socialLayoutSlots,
  type SocialLayoutColor, type SocialLayoutDefinition, type SocialLayoutElement, type SocialLayoutElementType, type SocialLayoutRect,
} from '@/lib/social/socialLayout';
import { socialGet, socialPost, type SocialSpec } from './socialApi';
import { GraphicView } from './SocialPreviews';
import { LayoutThumb } from './SocialLayoutPicker';
import { cardClass, dangerButton, errorMessage, inputClass, primaryButton, secondaryButton } from './socialUi';

/*
 * Edytor układów grafik (Etap F) — układy marki jako dane na płótnie: podgląd tym samym HTML co render na serwerze
 * (zdjęcia zastępcze w miejscach, przykładowe teksty, logo, fonty i kolory z szablonu marki = księgi znaku), elementy do
 * przesuwania i zmiany rozmiaru (mysz, strzałki — krok 0,5%, z Shift 2%), położenie wspólne dla formatów albo osobne dla
 * formatu, kolejność warstw, właściwości elementów (role kolorów i fontów, przezroczystość, kierunek przyciemnienia,
 * zaokrąglenia, wyrównanie, wiązanie tekstu z tytułem / podpisem / napisem). Zapis, kopia, archiwum i usunięcie
 * nieużywanego układu — akceptujący w marce. Zapisane posty mają migawkę układu (zmiana układu ich nie zmienia).
 */

type LayoutDTO = { id: string; name: string; definition: SocialLayoutDefinition; slots: number; archived: boolean; usedBy: number; updatedAt: string };
type LayoutsReply = {
  companyId: string;
  access: { approve: boolean; create: boolean; view: boolean };
  layouts: LayoutDTO[];
  presets: Array<{ key: string; name: string; description: string; definition: SocialLayoutDefinition; slots: number }>;
  spec: SocialSpec | null;
  savedId?: string;
};
type Draft = { id: string | null; name: string; definition: SocialLayoutDefinition; updatedAt: string | null };
type Drag = { id: string; mode: 'move' | 'resize'; startX: number; startY: number; rect: SocialLayoutRect };

const PLACEHOLDER_SIZE = { width: 1600, height: 1200 };
const placeholderPhoto = (slot: number) => `data:image/svg+xml;base64,${typeof window === 'undefined' ? '' : window.btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${200 + slot * 47},18%,52%)"/><stop offset="1" stop-color="hsl(${230 + slot * 47},22%,28%)"/></linearGradient></defs><rect width="1600" height="1200" fill="url(#g)"/><path d="M0 1200 L520 640 L820 920 L1080 700 L1600 1200 Z" fill="rgba(255,255,255,0.18)"/><circle cx="1180" cy="360" r="120" fill="rgba(255,255,255,0.22)"/><text x="800" y="660" font-family="sans-serif" font-size="260" text-anchor="middle" fill="rgba(255,255,255,0.55)">${slot + 1}</text></svg>`,
)}`;

const round = (value: number) => Math.round(value * 10000) / 10000;
const snap = (value: number) => Math.round(value / 0.005) * 0.005;
const clampRect = (rect: SocialLayoutRect): SocialLayoutRect => {
  const w = Math.min(1, Math.max(0.01, rect.w));
  const h = Math.min(1, Math.max(0.005, rect.h));
  return { x: round(Math.min(1 - w, Math.max(0, rect.x))), y: round(Math.min(1 - h, Math.max(0, rect.y))), w: round(w), h: round(h) };
};

let counter = 0;
const newId = (type: string) => `${type}-${Date.now().toString(36)}${(counter += 1).toString(36)}`;

function newElement(type: SocialLayoutElementType, definition: SocialLayoutDefinition): SocialLayoutElement {
  const id = newId(type);
  switch (type) {
    case 'photo': return { id, type, slot: socialLayoutSlots(definition), radius: 0, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } };
    case 'shade': return { id, type, color: 'overlay', direction: 'down', from: 0, to: 0.85, rect: { x: 0, y: 0.55, w: 1, h: 0.45 } };
    case 'box': return { id, type, fill: { color: 'accent', opacity: 1 }, stroke: null, radius: 0, rect: { x: 0.4, y: 0.88, w: 0.2, h: 0.005 } };
    case 'logo': return { id, type, align: 'center', valign: 'middle', rect: { x: 0.38, y: 0.04, w: 0.24, h: 0.1 } };
    default: return {
      id, type: 'text', bind: 'headline', font: 'title', color: 'text', size: 36, tracking: 0.2, align: 'center',
      rect: { x: 0.08, y: 0.78, w: 0.84, h: 0.07 },
    };
  }
}

const emptyDefinition = (): SocialLayoutDefinition => ({
  v: 1, background: 'overlay', elements: [{ id: 'photo-1', type: 'photo', slot: 0, radius: 0, rect: { x: 0, y: 0, w: 1, h: 1 } }],
});

const elementIcon = (type: SocialLayoutElementType) => (type === 'photo' ? ImageIcon : type === 'shade' ? SunDim : type === 'box' ? Square : type === 'logo' ? LayoutTemplate : Type);

export default function SocialLayoutEditor({ companyId, templateId, onClose, onChanged }: {
  companyId: string; templateId?: string | null; onClose: () => void; onChanged?: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const { showConfirm } = useDialog();
  const [reply, setReply] = useState<LayoutsReply | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [format, setFormat] = useState<SocialFormat>('4:5');
  const [selected, setSelected] = useState<string | null>(null);
  const [texts, setTexts] = useState({ headline: 'Gala firmowa w Operze', subline: 'Realizacja · Warszawa 2026', kicker: 'Realizacja' });
  const [drag, setDrag] = useState<Drag | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(480);

  const editable = Boolean(reply?.access.approve);
  const hasDraft = Boolean(draft);
  const info = SOCIAL_FORMAT_INFO[format];
  const canvasHeight = Math.round((canvasWidth * info.height) / info.width);

  const run = async <T,>(title: string, action: () => Promise<T>, success?: string): Promise<T | null> => {
    showLoader(title, 'Proszę chwilę poczekać...');
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

  const open = useCallback((value: Draft) => {
    setDraft(value);
    setDirty(false);
    setSelected(null);
  }, []);

  const load = useCallback(async (selectId?: string | null) => {
    try {
      const data = await socialGet<LayoutsReply>('layouts', { company: companyId, template: templateId || null });
      setReply(data);
      const chosen = data.layouts.find((item) => item.id === selectId) || null;
      if (chosen) open({ id: chosen.id, name: chosen.name, definition: chosen.definition, updatedAt: chosen.updatedAt });
      return data;
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się pobrać układów.'), 'error');
      return null;
    }
  }, [companyId, templateId, showSnackbar, open]);

  useEffect(() => { void load(); }, [load]);

  // Płótno na szerokość kolumny (MacBook Air 13" — Pro 16"), najwyżej ~70% wysokości okna.
  useEffect(() => {
    const element = canvas.current?.parentElement;
    if (!element) return;
    const measure = () => {
      const maxWidth = Math.max(260, element.clientWidth - 8);
      const maxHeight = Math.max(320, window.innerHeight * 0.7);
      setCanvasWidth(Math.round(Math.min(maxWidth, (maxHeight * info.width) / info.height, 720)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [info.width, info.height, hasDraft]);

  const confirmDiscard = async () => !dirty || showConfirm({
    title: 'Niezapisane zmiany', message: 'Układ ma niezapisane zmiany. Porzucić je?', confirmText: 'Porzuć zmiany',
  });

  const changeDefinition = (update: (definition: SocialLayoutDefinition) => SocialLayoutDefinition) => {
    setDraft((current) => (current ? { ...current, definition: update(current.definition) } : current));
    setDirty(true);
  };
  const changeElement = (id: string, update: (element: SocialLayoutElement) => SocialLayoutElement) =>
    changeDefinition((definition) => ({ ...definition, elements: definition.elements.map((item) => (item.id === id ? update(item) : item)) }));

  /** Położenie w aktywnym formacie: osobne dla formatu (gdy element je ma) albo wspólne. */
  const setRect = (id: string, rect: SocialLayoutRect) => changeElement(id, (element) => (element.formats?.[format]
    ? { ...element, formats: { ...element.formats, [format]: clampRect(rect) } }
    : { ...element, rect: clampRect(rect) }));

  const element = draft?.definition.elements.find((item) => item.id === selected) || null;
  const problem = draft ? socialLayoutProblem(draft.definition) : null;
  const current = reply?.layouts.find((item) => item.id === draft?.id) || null;

  // Podgląd: ten sam HTML co render (zdjęcia zastępcze w proporcjach miejsc, przykładowe teksty).
  const preview = useMemo(() => {
    if (!draft || !reply?.spec) return null;
    const definition = draft.definition;
    const crop = (slot: number) => socialAspectCrop(PLACEHOLDER_SIZE.width, PLACEHOLDER_SIZE.height, socialLayoutSlotAspect(definition, slot, format));
    const photos = Array.from({ length: socialLayoutSlots(definition) }, (_, slot) => (slot === 0 ? null : { src: placeholderPhoto(slot), crop: crop(slot) }));
    return {
      format, renderedUrl: null,
      live: {
        spec: reply.spec, photoUrl: placeholderPhoto(0), crop: crop(0), headline: texts.headline, subline: texts.subline, style: 'classic' as const,
        kicker: texts.kicker, layout: definition, photos,
      },
    };
  }, [draft, reply?.spec, format, texts]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, item: SocialLayoutElement, mode: Drag['mode']) => {
    event.stopPropagation();
    setSelected(item.id);
    if (!editable) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id: item.id, mode, startX: event.clientX, startY: event.clientY, rect: socialLayoutRect(item, format) });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / canvasWidth;
    const dy = (event.clientY - drag.startY) / canvasHeight;
    const rect = drag.mode === 'move'
      ? { ...drag.rect, x: snap(drag.rect.x + dx), y: snap(drag.rect.y + dy) }
      : { ...drag.rect, w: Math.min(1 - drag.rect.x, snap(drag.rect.w + dx)), h: Math.min(1 - drag.rect.y, Math.max(0.005, snap(drag.rect.h + dy))) };
    setRect(drag.id, rect);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!element || !editable) return;
    const step = event.shiftKey ? 0.02 : 0.005;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      event.preventDefault();
      const rect = socialLayoutRect(element, format);
      setRect(element.id, { ...rect, x: rect.x + moves[event.key][0], y: rect.y + moves[event.key][1] });
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      changeDefinition((definition) => ({ ...definition, elements: definition.elements.filter((item) => item.id !== element.id) }));
      setSelected(null);
    }
  };

  const addElement = (type: SocialLayoutElementType) => {
    if (!draft) return;
    if (draft.definition.elements.length >= SOCIAL_LAYOUT_LIMITS.elements) { showSnackbar(`Układ może mieć najwyżej ${SOCIAL_LAYOUT_LIMITS.elements} elementów.`, 'warning'); return; }
    if (type === 'photo' && socialLayoutSlots(draft.definition) >= SOCIAL_LAYOUT_LIMITS.slots) { showSnackbar(`Kolaż może mieć najwyżej ${SOCIAL_LAYOUT_LIMITS.slots} zdjęcia.`, 'warning'); return; }
    const item = newElement(type, draft.definition);
    changeDefinition((definition) => ({
      ...definition,
      // Zdjęcia rysują się pod resztą — nowe zdjęcie trafia za ostatnie zdjęcie na liście.
      elements: type === 'photo'
        ? [...definition.elements.filter((entry) => entry.type === 'photo'), item, ...definition.elements.filter((entry) => entry.type !== 'photo')]
        : [...definition.elements, item],
    }));
    setSelected(item.id);
  };
  const moveElement = (id: string, by: number) => changeDefinition((definition) => {
    const list = [...definition.elements];
    const index = list.findIndex((item) => item.id === id);
    const target = index + by;
    if (index < 0 || target < 0 || target >= list.length) return definition;
    [list[index], list[target]] = [list[target], list[index]];
    return { ...definition, elements: list };
  });

  const startNew = async (definition: SocialLayoutDefinition, name: string) => {
    if (!(await confirmDiscard())) return;
    open({ id: null, name, definition: JSON.parse(JSON.stringify(definition)) as SocialLayoutDefinition, updatedAt: null });
    setDirty(true);
  };
  /** Kopia bieżącego układu (z niezapisanymi zmianami) jako nowy układ — oryginał zostaje bez zmian. */
  const duplicate = () => {
    if (!draft) return;
    open({ id: null, name: `${draft.name} (kopia)`.slice(0, SOCIAL_LAYOUT_LIMITS.name), definition: JSON.parse(JSON.stringify(draft.definition)) as SocialLayoutDefinition, updatedAt: null });
    setDirty(true);
  };
  const select = async (layout: LayoutDTO) => {
    if (draft?.id === layout.id || !(await confirmDiscard())) return;
    open({ id: layout.id, name: layout.name, definition: layout.definition, updatedAt: layout.updatedAt });
  };
  const save = async () => {
    if (!draft) return;
    if (problem) { showSnackbar(problem, 'warning'); return; }
    const result = await run('Zapisuję układ', () => socialPost<LayoutsReply>('saveLayout', {
      companyId, templateId: templateId || null, id: draft.id, name: draft.name, definition: draft.definition, updatedAt: draft.updatedAt,
    }), 'Zapisano układ');
    if (!result) return;
    setReply(result);
    const saved = result.layouts.find((item) => item.id === result.savedId);
    if (saved) open({ id: saved.id, name: saved.name, definition: saved.definition, updatedAt: saved.updatedAt });
    onChanged?.();
  };
  const archive = async (archived: boolean) => {
    if (!draft?.id) return;
    const result = await run(archived ? 'Przenoszę do archiwum' : 'Przywracam układ',
      () => socialPost<LayoutsReply>('archiveLayout', { id: draft.id, archived, templateId: templateId || null }),
      archived ? 'Układ jest w archiwum' : 'Przywrócono układ');
    if (!result) return;
    setReply(result);
    // Archiwum zmienia znacznik wersji — niezapisane zmiany w edytorze zostają i dalej dadzą się zapisać.
    const saved = result.layouts.find((item) => item.id === draft.id);
    if (saved) setDraft((value) => (value && value.id === saved.id ? { ...value, updatedAt: saved.updatedAt } : value));
    onChanged?.();
  };
  const remove = async () => {
    if (!draft?.id) return;
    if (!(await showConfirm({ title: 'Usunąć układ?', message: 'Układ zostanie trwale usunięty. Tej operacji nie można cofnąć.', confirmText: 'Usuń układ' }))) return;
    const result = await run('Usuwam układ', () => socialPost<LayoutsReply>('deleteLayout', { id: draft.id, templateId: templateId || null }), 'Usunięto układ');
    if (result) { setReply(result); setDraft(null); setDirty(false); onChanged?.(); }
  };
  const close = async () => { if (await confirmDiscard()) onClose(); };

  const colors = reply?.spec?.colors || null;
  const unsafe = reply?.spec?.guides?.[format] || null;
  const rectOf = (item: SocialLayoutElement) => socialLayoutRect(item, format);
  const percent = (value: number) => Math.round(value * 1000) / 10;
  const rectInput = (key: keyof SocialLayoutRect) => element && (
    <label key={key} className="text-[11px] text-[#e5e4e2]/60">{{ x: 'Od lewej', y: 'Od góry', w: 'Szerokość', h: 'Wysokość' }[key]} (%)
      <input type="number" step={0.5} disabled={!editable} value={percent(rectOf(element)[key])} className={`${inputClass} mt-0.5 py-1 text-xs`}
        onChange={(event) => setRect(element.id, { ...rectOf(element), [key]: Number(event.target.value) / 100 })} />
    </label>
  );
  const colorSelect = (value: SocialLayoutColor, onChange: (color: SocialLayoutColor) => void) => (
    <select disabled={!editable} value={value} onChange={(event) => onChange(event.target.value as SocialLayoutColor)} className={`${inputClass} py-1 text-xs`}>
      {SOCIAL_LAYOUT_COLORS.map((color) => <option key={color} value={color}>{SOCIAL_LAYOUT_COLOR_LABELS[color]}</option>)}
    </select>
  );
  const number = (label: string, value: number, onChange: (value: number) => void, step = 1) => (
    <label className="text-[11px] text-[#e5e4e2]/60">{label}
      <input type="number" step={step} disabled={!editable} value={value} onChange={(event) => onChange(Number(event.target.value))} className={`${inputClass} mt-0.5 py-1 text-xs`} />
    </label>
  );
  const slider = (label: string, value: number, onChange: (value: number) => void) => (
    <label className="block text-[11px] text-[#e5e4e2]/60">{label}: {Math.round(value * 100)}%
      <input type="range" min={0} max={100} disabled={!editable} value={Math.round(value * 100)} onChange={(event) => onChange(Number(event.target.value) / 100)} className="w-full accent-[#d3bb73]" />
    </label>
  );

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-50 flex flex-col bg-[#0f1119] text-[#e5e4e2]" data-app-overlay="true">
        <header className="flex flex-wrap items-center gap-3 border-b border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3">
          <LayoutTemplate className="h-5 w-5 text-[#d3bb73]" />
          <h2 className="text-base font-medium">Układy grafik</h2>
          <span className="text-xs text-[#e5e4e2]/45">Logo, fonty i kolory zawsze z księgi znaku marki — układ wskazuje tylko role.</span>
          <span className="flex-1" />
          {draft && editable && (
            <>
              {draft.id && <button type="button" className={secondaryButton} title="Nowy układ na podstawie tego (oryginał zostaje bez zmian)" onClick={duplicate}><Copy className="h-4 w-4" />Kopia</button>}
              {draft.id && current && (current.archived
                ? <button type="button" className={secondaryButton} onClick={() => void archive(false)}><RotateCcw className="h-4 w-4" />Przywróć</button>
                : <button type="button" className={secondaryButton} onClick={() => void archive(true)}><Archive className="h-4 w-4" />Do archiwum</button>)}
              {draft.id && current && current.usedBy === 0 && <button type="button" className={dangerButton} onClick={() => void remove()}><Trash2 className="h-4 w-4" />Usuń</button>}
              <button type="button" className={primaryButton} disabled={!dirty || Boolean(problem) || !draft.name.trim()} onClick={() => void save()}><Save className="h-4 w-4" />Zapisz układ</button>
            </>
          )}
          <button type="button" className={secondaryButton} onClick={() => void close()}><X className="h-4 w-4" />Zamknij</button>
        </header>

        <div className="grid min-h-0 flex-1 gap-3 overflow-hidden p-3 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
          <aside className={`${cardClass} min-h-0 space-y-3 overflow-y-auto p-3`}>
            {editable && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium">Nowy układ</div>
                <button type="button" className={`${secondaryButton} w-full justify-center`} onClick={() => void startNew(emptyDefinition(), 'Nowy układ')}><Plus className="h-4 w-4" />Pusty (jedno zdjęcie)</button>
                <div className="grid grid-cols-3 gap-1.5">
                  {(reply?.presets || []).map((preset) => (
                    <button key={preset.key} type="button" title={`Na podstawie: ${preset.name}`} onClick={() => void startNew(preset.definition, preset.name)}
                      className="rounded border border-[#d3bb73]/15 p-1 hover:border-[#d3bb73]/50"><LayoutThumb definition={preset.definition} format="4:5" width={56} colors={colors} /></button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <div className="text-xs font-medium">Układy marki</div>
              {!reply?.layouts.length && <p className="text-[11px] text-[#e5e4e2]/45">Marka nie ma jeszcze własnych układów — zacznij od gotowego albo pustego.</p>}
              {(reply?.layouts || []).map((layout) => (
                <button key={layout.id} type="button" onClick={() => void select(layout)}
                  className={`flex w-full items-center gap-2 rounded-lg border p-1.5 text-left text-xs ${draft?.id === layout.id ? 'border-[#d3bb73] bg-[#d3bb73]/10' : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/40'} ${layout.archived ? 'opacity-60' : ''}`}>
                  <LayoutThumb definition={layout.definition} format="4:5" width={40} colors={colors} />
                  <span className="min-w-0 flex-1"><span className="block truncate">{layout.name}</span>
                    <span className="text-[10px] text-[#e5e4e2]/45">{layout.slots === 1 ? '1 zdjęcie' : `${layout.slots} zdjęcia`}{layout.usedBy ? ` · w ${layout.usedBy} post.` : ''}{layout.archived ? ' · archiwum' : ''}</span></span>
                </button>
              ))}
            </div>
          </aside>

          <section className={`${cardClass} flex min-h-0 flex-col gap-3 overflow-y-auto p-3`}>
            {!draft ? (
              <p className="m-auto max-w-sm text-center text-sm text-[#e5e4e2]/50">Wybierz układ marki z listy albo utwórz nowy — z gotowego układu albo pusty.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {SOCIAL_FORMATS.map((item) => (
                    <button key={item} type="button" onClick={() => setFormat(item)}
                      className={`rounded-lg px-3 py-1.5 text-xs ${format === item ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>{SOCIAL_FORMAT_INFO[item].label}</button>
                  ))}
                  <span className="flex-1" />
                  <span className="text-[11px] text-[#e5e4e2]/40">{info.width}×{info.height} px{unsafe?.unsafeTop || unsafe?.unsafeBottom ? ' · czerwone pasy — zasłaniane w relacji przez Instagram' : ''}</span>
                </div>
                <div className="flex justify-center">
                  <div ref={canvas} tabIndex={0} onKeyDown={onKeyDown} onPointerMove={onPointerMove} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}
                    onPointerDown={() => setSelected(null)} className="relative select-none outline-none" style={{ width: canvasWidth, height: canvasHeight, touchAction: 'none' }}>
                    <div className="pointer-events-none"><GraphicView source={preview} width={canvasWidth} delay={60} /></div>
                    {unsafe?.unsafeTop && <span className="pointer-events-none absolute left-0 top-0 w-full bg-red-500/15" style={{ height: `${unsafe.unsafeTop.h * 100}%` }} />}
                    {unsafe?.unsafeBottom && <span className="pointer-events-none absolute bottom-0 left-0 w-full bg-red-500/15" style={{ height: `${unsafe.unsafeBottom.h * 100}%` }} />}
                    {draft.definition.elements.map((item) => {
                      const rect = rectOf(item);
                      const active = item.id === selected;
                      return (
                        <div key={item.id} onPointerDown={(event) => onPointerDown(event, item, 'move')}
                          className={`absolute ${active ? 'z-20 border-2 border-[#d3bb73]' : 'z-10 border border-dashed border-white/35 hover:border-white/70'} ${editable ? 'cursor-move' : ''}`}
                          style={{ left: rect.x * canvasWidth, top: rect.y * canvasHeight, width: Math.max(4, rect.w * canvasWidth), height: Math.max(4, rect.h * canvasHeight) }}
                          title={SOCIAL_LAYOUT_ELEMENT_LABELS[item.type]}>
                          {active && (
                            <>
                              <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-[#d3bb73] px-1 text-[10px] text-[#1c1f33]">
                                {SOCIAL_LAYOUT_ELEMENT_LABELS[item.type]}{item.type === 'photo' ? ` ${item.slot + 1}` : item.type === 'text' ? ` · ${SOCIAL_LAYOUT_BIND_LABELS[item.bind]}` : ''}{item.formats?.[format] ? ' · ten format' : ''}
                              </span>
                              {editable && <span onPointerDown={(event) => onPointerDown(event, item, 'resize')} className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-[#1c1f33] bg-[#d3bb73]" />}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {!reply?.spec && <p className="text-center text-xs text-amber-200">Marka nie ma gotowego szablonu grafik — podgląd pojawi się po uzupełnieniu szablonu (logo, fonty, kolory z księgi znaku).</p>}
                <p className="text-center text-[11px] text-[#e5e4e2]/40">Kliknij element, przeciągnij go albo jego narożnik; strzałki — przesunięcie o 0,5% (z Shift — 2%), Delete — usunięcie. Zdjęcia zastępcze pokazują miejsca kolażu.</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(['kicker', 'headline', 'subline'] as const).map((key) => (
                    <label key={key} className="text-[11px] text-[#e5e4e2]/60">Przykład: {SOCIAL_LAYOUT_BIND_LABELS[key].toLowerCase()}
                      <input value={texts[key]} onChange={(event) => setTexts((value) => ({ ...value, [key]: event.target.value }))} className={`${inputClass} mt-0.5 py-1 text-xs`} />
                    </label>
                  ))}
                </div>
              </>
            )}
          </section>

          <aside className={`${cardClass} min-h-0 space-y-3 overflow-y-auto p-3 text-sm`}>
            {draft && (
              <>
                <label className="block text-xs">Nazwa układu
                  <input disabled={!editable} value={draft.name} maxLength={SOCIAL_LAYOUT_LIMITS.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setDirty(true); }} className={`${inputClass} mt-1`} />
                </label>
                <label className="block text-xs">Tło (miejsca bez zdjęć, odstępy kolażu)
                  <div className="mt-1">{colorSelect(draft.definition.background, (background) => changeDefinition((definition) => ({ ...definition, background })))}</div>
                </label>
                {problem && <p className="rounded border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-100">{problem}</p>}
                {editable && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium">Dodaj element</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(['photo', 'shade', 'box', 'logo', 'text'] as const).map((type) => {
                        const Icon = elementIcon(type);
                        return <button key={type} type="button" className={`${secondaryButton} px-2 py-1 text-xs`} onClick={() => addElement(type)}><Icon className="h-3.5 w-3.5" />{SOCIAL_LAYOUT_ELEMENT_LABELS[type]}</button>;
                      })}
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <div className="text-xs font-medium">Elementy (kolejność rysowania; zdjęcia zawsze pod resztą)</div>
                  {draft.definition.elements.map((item, index) => {
                    const Icon = elementIcon(item.type);
                    return (
                      <div key={item.id} className={`flex items-center gap-1.5 rounded border px-1.5 py-1 text-xs ${item.id === selected ? 'border-[#d3bb73] bg-[#d3bb73]/10' : 'border-[#d3bb73]/10'}`}>
                        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => setSelected(item.id)}>
                          <Icon className="h-3.5 w-3.5 shrink-0 text-[#d3bb73]" />
                          <span className="truncate">{SOCIAL_LAYOUT_ELEMENT_LABELS[item.type]}{item.type === 'photo' ? ` ${item.slot + 1}` : item.type === 'text' ? ` — ${SOCIAL_LAYOUT_BIND_LABELS[item.bind]}` : ''}</span>
                        </button>
                        {editable && (
                          <>
                            <button type="button" disabled={index === 0} onClick={() => moveElement(item.id, -1)} title="Niżej (wcześniej rysowany)" className="disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                            <button type="button" disabled={index === draft.definition.elements.length - 1} onClick={() => moveElement(item.id, 1)} title="Wyżej (później rysowany)" className="disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                            <button type="button" onClick={() => { changeDefinition((definition) => ({ ...definition, elements: definition.elements.filter((entry) => entry.id !== item.id) })); if (selected === item.id) setSelected(null); }} title="Usuń"><Trash2 className="h-3.5 w-3.5 text-red-300" /></button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                {element && (
                  <div className="space-y-2 border-t border-[#d3bb73]/10 pt-2">
                    <div className="text-xs font-medium">{SOCIAL_LAYOUT_ELEMENT_LABELS[element.type]} — {info.label}</div>
                    <label className="flex items-center gap-2 text-[11px] text-[#e5e4e2]/70">
                      <input type="checkbox" disabled={!editable} checked={Boolean(element.formats?.[format])} onChange={(event) => changeElement(element.id, (item) => {
                        const formats = { ...(item.formats || {}) };
                        if (event.target.checked) formats[format] = { ...socialLayoutRect(item, format) }; else delete formats[format];
                        return { ...item, formats: Object.keys(formats).length ? formats : undefined };
                      })} />Osobne położenie w tym formacie (inaczej — wspólne dla formatów bez własnego)
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">{(['x', 'y', 'w', 'h'] as const).map(rectInput)}</div>
                    {element.type === 'photo' && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <label className="text-[11px] text-[#e5e4e2]/60">Zdjęcie nr
                          <select disabled={!editable} value={element.slot} onChange={(event) => changeElement(element.id, (item) => (item.type === 'photo' ? { ...item, slot: Number(event.target.value) } : item))} className={`${inputClass} mt-0.5 py-1 text-xs`}>
                            {Array.from({ length: SOCIAL_LAYOUT_LIMITS.slots }, (_, slot) => <option key={slot} value={slot}>{slot + 1}{slot === 0 ? ' (zdjęcie posta)' : ''}</option>)}
                          </select>
                        </label>
                        {number('Zaokrąglenie (px)', element.radius, (radius) => changeElement(element.id, (item) => (item.type === 'photo' ? { ...item, radius: Math.max(0, radius) } : item)))}
                      </div>
                    )}
                    {element.type === 'shade' && (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-2 gap-1.5">
                          {colorSelect(element.color, (color) => changeElement(element.id, (item) => (item.type === 'shade' ? { ...item, color } : item)))}
                          <select disabled={!editable} value={element.direction} onChange={(event) => changeElement(element.id, (item) => (item.type === 'shade' ? { ...item, direction: event.target.value as typeof item.direction } : item))} className={`${inputClass} py-1 text-xs`}>
                            <option value="down">Ciemniej w dół</option><option value="up">Ciemniej w górę</option><option value="left">Ciemniej w lewo</option><option value="right">Ciemniej w prawo</option>
                          </select>
                        </div>
                        {slider('Krycie na początku', element.from, (from) => changeElement(element.id, (item) => (item.type === 'shade' ? { ...item, from } : item)))}
                        {slider('Krycie na końcu', element.to, (to) => changeElement(element.id, (item) => (item.type === 'shade' ? { ...item, to } : item)))}
                      </div>
                    )}
                    {element.type === 'box' && (
                      <div className="space-y-1.5">
                        <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" disabled={!editable} checked={Boolean(element.fill)} onChange={(event) => changeElement(element.id, (item) => (item.type === 'box' ? { ...item, fill: event.target.checked ? { color: 'accent', opacity: 1 } : null } : item))} />Wypełnienie</label>
                        {element.fill && (
                          <>
                            {colorSelect(element.fill.color, (color) => changeElement(element.id, (item) => (item.type === 'box' && item.fill ? { ...item, fill: { ...item.fill, color } } : item)))}
                            {slider('Krycie wypełnienia', element.fill.opacity, (opacity) => changeElement(element.id, (item) => (item.type === 'box' && item.fill ? { ...item, fill: { ...item.fill, opacity } } : item)))}
                          </>
                        )}
                        <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" disabled={!editable} checked={Boolean(element.stroke)} onChange={(event) => changeElement(element.id, (item) => (item.type === 'box' ? { ...item, stroke: event.target.checked ? { color: 'accent', width: 2, opacity: 1 } : null } : item))} />Ramka</label>
                        {element.stroke && (
                          <div className="grid grid-cols-2 gap-1.5">
                            {colorSelect(element.stroke.color, (color) => changeElement(element.id, (item) => (item.type === 'box' && item.stroke ? { ...item, stroke: { ...item.stroke, color } } : item)))}
                            {number('Grubość (px)', element.stroke.width, (width) => changeElement(element.id, (item) => (item.type === 'box' && item.stroke ? { ...item, stroke: { ...item.stroke, width: Math.max(0.5, width) } } : item)), 0.5)}
                          </div>
                        )}
                        {element.stroke && slider('Krycie ramki', element.stroke.opacity, (opacity) => changeElement(element.id, (item) => (item.type === 'box' && item.stroke ? { ...item, stroke: { ...item.stroke, opacity } } : item)))}
                        {number('Zaokrąglenie (px)', element.radius, (radius) => changeElement(element.id, (item) => (item.type === 'box' ? { ...item, radius: Math.max(0, radius) } : item)))}
                      </div>
                    )}
                    {element.type === 'logo' && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <select disabled={!editable} value={element.align} onChange={(event) => changeElement(element.id, (item) => (item.type === 'logo' ? { ...item, align: event.target.value as typeof item.align } : item))} className={`${inputClass} py-1 text-xs`}>
                          <option value="left">Do lewej</option><option value="center">Do środka</option><option value="right">Do prawej</option>
                        </select>
                        <select disabled={!editable} value={element.valign} onChange={(event) => changeElement(element.id, (item) => (item.type === 'logo' ? { ...item, valign: event.target.value as typeof item.valign } : item))} className={`${inputClass} py-1 text-xs`}>
                          <option value="top">Do góry</option><option value="middle">Pośrodku</option><option value="bottom">Do dołu</option>
                        </select>
                      </div>
                    )}
                    {element.type === 'text' && (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-2 gap-1.5">
                          <select disabled={!editable} value={element.bind} onChange={(event) => changeElement(element.id, (item) => (item.type === 'text' ? { ...item, bind: event.target.value as typeof item.bind } : item))} className={`${inputClass} py-1 text-xs`}>
                            {(['headline', 'subline', 'kicker'] as const).map((bind) => <option key={bind} value={bind}>{SOCIAL_LAYOUT_BIND_LABELS[bind]}</option>)}
                          </select>
                          <select disabled={!editable} value={element.font} onChange={(event) => changeElement(element.id, (item) => (item.type === 'text' ? { ...item, font: event.target.value as typeof item.font } : item))} className={`${inputClass} py-1 text-xs`}>
                            <option value="title">Font tytułu</option><option value="caption">Font podpisu</option>
                          </select>
                          {colorSelect(element.color, (color) => changeElement(element.id, (item) => (item.type === 'text' ? { ...item, color } : item)))}
                          <select disabled={!editable} value={element.align} onChange={(event) => changeElement(element.id, (item) => (item.type === 'text' ? { ...item, align: event.target.value as typeof item.align } : item))} className={`${inputClass} py-1 text-xs`}>
                            <option value="left">Do lewej</option><option value="center">Do środka</option><option value="right">Do prawej</option>
                          </select>
                          {number('Wielkość (px)', element.size, (size) => changeElement(element.id, (item) => (item.type === 'text' ? { ...item, size: Math.min(260, Math.max(6, size)) } : item)))}
                          {number('Odstęp liter (em)', element.tracking, (tracking) => changeElement(element.id, (item) => (item.type === 'text' ? { ...item, tracking: Math.min(1, Math.max(0, tracking)) } : item)), 0.01)}
                        </div>
                        <p className="text-[10px] text-[#e5e4e2]/40">Tekst w jednej linii, wersalikami; dłuższy niż prostokąt jest zmniejszany. Wielkość w px dla szerokości 1080.</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      </div>
    </OverlayPortal>
  );
}
