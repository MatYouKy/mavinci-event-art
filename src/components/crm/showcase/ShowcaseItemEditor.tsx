'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, Copy, ExternalLink, FolderOpen, Globe, GripVertical, Images, Package, Plus, Save, Tablet,
  Trash2, Upload, Wand2, X,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { useDialog } from '@/contexts/DialogContext';
import {
  SHOWCASE_BLOCK_KINDS, SHOWCASE_BLOCK_STYLES, SHOWCASE_KIND_LABELS, SHOWCASE_LIMITS, applyShowcaseAiSuggestion, emptyShowcaseBlock,
  normalizeShowcaseContent, showcaseChecklist, showcaseMediaKey,
  type ShowcaseBlock, type ShowcaseBlockKind, type ShowcaseContent, type ShowcaseItemDetail, type ShowcaseUrls,
} from '@/lib/showcase/showcaseShared';
import { cardClass, dangerButton, inputClass, primaryButton, secondaryButton } from '../social/socialUi';
import { errorMessage, showcaseGet, showcasePost, showcaseUploadPhoto, showcaseUploadSummary, type ShowcaseUploadResult } from './showcaseApi';
import ShowcaseAssistant from './ShowcaseAssistant';
import ShowcaseBlockEditor from './ShowcaseBlockEditor';
import ShowcaseListPicker from './ShowcaseListPicker';
import ShowcasePhotoPicker from './ShowcasePhotoPicker';
import { Toggle, hasFiles, imageFiles, useDragList } from './showcaseUi';

/*
 * Karta prezentacji (Strefa sprzedawcy → Prezentacje): tytuł, hasło, wstęp i zdjęcie główne, produkty z katalogu (dane na
 * bieżąco z Oferty → Produkty), bloki w kolejności pokazu (przeciąganie za uchwyt), lista kontrolna z przejściem do bloku
 * i podgląd jak na iPadzie (także przed zapisem). „Zapisz” (⌘S) — wersja chroni przed nadpisaniem zmian z innego okna.
 * Aktywna karta pokazuje się też na stronie produktu dla klienta (`/produkty/[id]` każdego powiązanego produktu — bez ukrytych
 * bloków; `showcaseProductPage.server.ts`), chyba że wyłączono „Pokazuj na stronie produktu dla klienta” (tylko spotkania).
 * Te same dane na Macu (natywny edytor) i — w etapie 2 — na iPadzie.
 */

type Draft = { title: string; tagline: string; isActive: boolean; showOnProductPage: boolean; productIds: string[]; content: ShowcaseContent };
type PhotoTarget = 'hero' | string;

const draftOf = (detail: ShowcaseItemDetail): Draft => ({
  title: detail.item.title, tagline: detail.item.tagline, isActive: detail.item.isActive,
  showOnProductPage: detail.item.showOnProductPage ?? true, productIds: detail.item.productIds, content: detail.item.content,
});

export default function ShowcaseItemEditor({ id, onChanged, onDeleted, onOpen, onDirtyChange, onPreview }: {
  id: string;
  onChanged: () => void;
  onDeleted: () => void;
  onOpen: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onPreview: (draft: ShowcaseItemDetail) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const { showConfirm } = useDialog();
  const [detail, setDetail] = useState<ShowcaseItemDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [urls, setUrls] = useState<ShowcaseUrls>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [refInfo, setRefInfo] = useState<Record<string, { title: string; thumb: string | null }>>({});
  const [photoPicker, setPhotoPicker] = useState<PhotoTarget | null>(null);
  const [productPicker, setProductPicker] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const [realizationPicker, setRealizationPicker] = useState<string | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [heroOver, setHeroOver] = useState(false);
  const heroDepth = useRef(0);
  const heroInput = useRef<HTMLInputElement>(null);
  const highlightTimer = useRef<number | null>(null);
  useEffect(() => () => { if (highlightTimer.current) window.clearTimeout(highlightTimer.current); }, []);

  const apply = useCallback((value: ShowcaseItemDetail) => {
    setDetail(value);
    setDraft(draftOf(value));
    setUrls((current) => ({ ...current, ...value.urls }));
    setNames((current) => ({ ...current, ...Object.fromEntries(value.products.map((product) => [product.id, product.name])) }));
    setRefInfo((current) => ({
      ...current,
      ...Object.fromEntries(value.realizations.map((entry) => [entry.id, { title: entry.title, thumb: entry.photos[0] ? value.urls[showcaseMediaKey(entry.photos[0])]?.thumb || null : null }])),
    }));
  }, []);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setDraft(null);
    showcaseGet<ShowcaseItemDetail>('item', { id }).then((value) => { if (active) { apply(value); setError(''); } })
      .catch((cause) => { if (active) setError(errorMessage(cause, 'Nie udało się otworzyć karty.')); });
    return () => { active = false; };
  }, [id, apply]);

  const dirty = useMemo(() => Boolean(detail && draft && JSON.stringify(draft) !== JSON.stringify(draftOf(detail))), [detail, draft]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const run = useCallback(async <T,>(title: string, action: () => Promise<T>, success?: string): Promise<T | null> => {
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
  }, [showLoader, hideLoader, showSnackbar]);

  const save = useCallback(async (): Promise<ShowcaseItemDetail | null> => {
    if (!detail || !draft) return null;
    const result = await run('Zapisuję kartę', () => showcasePost<ShowcaseItemDetail>('saveItem', {
      id: detail.item.id, version: detail.item.version, title: draft.title, tagline: draft.tagline, isActive: draft.isActive,
      ...(detail.item.showOnProductPage === undefined ? {} : { showOnProductPage: draft.showOnProductPage }),
      productIds: draft.productIds, content: normalizeShowcaseContent(draft.content),
    }), 'Zapisano kartę');
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

  const setContent = (patch: Partial<ShowcaseContent>) => setDraft((current) => (current ? { ...current, content: { ...current.content, ...patch } } : current));
  const setBlock = (block: ShowcaseBlock) => setDraft((current) => (current
    ? { ...current, content: { ...current.content, blocks: current.content.blocks.map((entry) => (entry.id === block.id ? block : entry)) } } : current));
  const blocksDrag = useDragList<ShowcaseBlock>({ items: draft?.content.blocks || [], keyOf: (block) => block.id, onMove: (blocks) => setContent({ blocks }), group: 'blocks' });
  const productDrag = useDragList<string>({ items: draft?.productIds || [], keyOf: (productId) => productId, onMove: (productIds) => setDraft((current) => (current ? { ...current, productIds } : current)), group: 'products' });

  if (error) return <div className={`${cardClass} p-8 text-center text-sm text-[#e5e4e2]/60`}>{error}</div>;
  if (!detail || !draft) return <div className={`${cardClass} p-8 text-center text-sm text-[#e5e4e2]/50`}>Ładowanie karty…</div>;

  const { item } = detail;
  const content = draft.content;
  const products = draft.productIds.map((productId) => ({ id: productId, name: names[productId] || 'Produkt' }));
  const checks = showcaseChecklist({ title: draft.title, productIds: draft.productIds, content }, detail.products);
  const missing = checks.filter((check) => !check.ok);

  /** Zdjęcia do zdjęcia głównego (pierwsze) albo do bloku. */
  const addPhotos = (target: PhotoTarget, results: ShowcaseUploadResult[]) => {
    if (!results.length) return;
    setUrls((current) => Object.assign({ ...current }, ...results.map((result) => result.urls)));
    const photos = results.map((result) => result.photo);
    setDraft((current) => {
      if (!current) return current;
      if (target === 'hero') return { ...current, content: { ...current.content, hero: photos[0] } };
      return {
        ...current,
        content: {
          ...current.content,
          blocks: current.content.blocks.map((block) => {
            if (block.id !== target) return block;
            const known = new Set(block.photos.map(showcaseMediaKey));
            const fresh = photos.filter((photo) => !known.has(showcaseMediaKey(photo)));
            return { ...block, photos: [...block.photos, ...fresh].slice(0, SHOWCASE_LIMITS.photos) };
          }),
        },
      };
    });
  };

  const uploadFiles = async (target: PhotoTarget, list: FileList | File[]) => {
    const { images, heic, other } = imageFiles(list);
    if (heic) showSnackbar('Zdjęcia HEIC: zapisz je jako JPEG albo dodaj z aplikacji na Maca (zamienia HEIC sama).', 'warning');
    if (!images.length) {
      if (!heic) showSnackbar(other ? 'Wybierz zdjęcia JPEG, PNG albo WebP.' : 'Brak zdjęć do dodania.', 'warning');
      return;
    }
    const files = target === 'hero' ? images.slice(0, 1) : images;
    const results: ShowcaseUploadResult[] = [];
    showLoader('Wgrywam zdjęcia', `0 z ${files.length}`);
    try {
      for (const [index, file] of files.entries()) {
        showLoader('Wgrywam zdjęcia', `${index + 1} z ${files.length}: ${file.name}`);
        if (file.size > SHOWCASE_LIMITS.uploadBytes) { showSnackbar(`${file.name}: zdjęcie może mieć najwyżej 40 MB.`, 'warning'); continue; }
        results.push(await showcaseUploadPhoto({ itemId: item.id }, file));
      }
      if (results.length) showSnackbar(showcaseUploadSummary(results, 'zapisz kartę'), 'success');
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się wgrać zdjęcia.'), 'error');
    } finally {
      hideLoader();
    }
    addPhotos(target, results);
  };

  const jumpTo = (key: string, blockId?: string) => {
    const selector = blockId ? `[data-block-editor="${blockId}"]` : `[data-field="${key}"]`;
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlight(blockId || key);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlight(null), 2200);
    element.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
  };

  const addBlock = (kind: ShowcaseBlockKind, style: string) => {
    if (content.blocks.length >= SHOWCASE_LIMITS.blocks) { showSnackbar(`Karta może mieć najwyżej ${SHOWCASE_LIMITS.blocks} bloków.`, 'warning'); return; }
    const block = emptyShowcaseBlock(kind, style, kind === 'catalog' ? draft.productIds[0] || null : null);
    setContent({ blocks: [...content.blocks, block] });
    setAddMenu(false);
    window.setTimeout(() => jumpTo('', block.id), 50);
  };

  const removeBlock = async (block: ShowcaseBlock) => {
    const empty = block.photos.length === 0 && block.rows.length === 0 && !block.text && block.refs.length === 0;
    if (!empty && !(await showConfirm({ title: `Usunąć blok „${block.title}”?`, message: 'Treść bloku zniknie z karty po zapisaniu. Zamiast usuwać, możesz go ukryć (ikona oka).', confirmText: 'Usuń blok' }))) return;
    setContent({ blocks: content.blocks.filter((entry) => entry.id !== block.id) });
  };

  const duplicate = async () => {
    if (dirty && !(await showConfirm({ title: 'Niezapisane zmiany', message: 'Kopia powstanie z zapisanej wersji karty. Kontynuować bez zapisu?', confirmText: 'Utwórz kopię' }))) return;
    const result = await run('Kopiuję kartę', () => showcasePost<ShowcaseItemDetail>('duplicateItem', { id: item.id }), 'Utworzono kopię (ukrytą) — popraw ją i pokaż na spotkaniach');
    if (result) { onChanged(); onOpen(result.item.id); }
  };

  const remove = async () => {
    if (!(await showConfirm({ title: `Usunąć kartę „${item.title}”?`, message: 'Karta zniknie z prezentacji. Zdjęcia z katalogu i realizacji zostają w swoich miejscach. Tej operacji nie można cofnąć.', confirmText: 'Usuń kartę' }))) return;
    const result = await run('Usuwam kartę', () => showcasePost('deleteItem', { id: item.id }), 'Usunięto kartę');
    if (result) onDeleted();
  };

  const preview = () => onPreview({
    ...detail,
    item: { ...detail.item, title: draft.title || detail.item.title, tagline: draft.tagline, isActive: draft.isActive, productIds: draft.productIds, content: normalizeShowcaseContent(content) },
    urls,
  });

  const heroUrl = content.hero ? urls[showcaseMediaKey(content.hero)]?.url : null;
  const heroEvents = {
    onDragEnter: (event: DragEvent<HTMLElement>) => { if (!hasFiles(event)) return; event.preventDefault(); heroDepth.current += 1; setHeroOver(true); },
    onDragOver: (event: DragEvent<HTMLElement>) => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } },
    onDragLeave: (event: DragEvent<HTMLElement>) => { if (!hasFiles(event)) return; heroDepth.current = Math.max(0, heroDepth.current - 1); if (!heroDepth.current) setHeroOver(false); },
    onDrop: (event: DragEvent<HTMLElement>) => { if (!hasFiles(event)) return; event.preventDefault(); heroDepth.current = 0; setHeroOver(false); void uploadFiles('hero', event.dataTransfer.files); },
  };
  const ring = (key: string) => (highlight === key ? 'ring-2 ring-[#d3bb73]' : '');

  return (
    <div className="space-y-4">
      <div className={`${cardClass} flex flex-wrap items-center gap-3 p-4`}>
        <input value={draft.title} maxLength={SHOWCASE_LIMITS.title} data-field="title" placeholder="Tytuł karty (np. „Ekran LED na scenę”)"
          onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={`${inputClass} min-w-[240px] flex-1 basis-[320px] text-lg ${ring('title')}`} />
        {/* Przełącznik i przyciski przechodzą pod tytuł razem (MacBook Air), nigdy pojedynczo. */}
        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center gap-3">
          <Toggle checked={draft.isActive} onChange={(isActive) => setDraft({ ...draft, isActive })} label={draft.isActive ? 'Widoczna na spotkaniach' : 'Ukryta (szkic)'} />
          <button type="button" className={secondaryButton} onClick={() => setAssistant(true)} title="Propozycje treści z danych produktów karty"><Wand2 className="h-4 w-4" />Asystent AI</button>
          <button type="button" className={secondaryButton} onClick={preview}><Tablet className="h-4 w-4" />Podgląd na iPadzie</button>
          <button type="button" className={secondaryButton} onClick={() => void duplicate()} title="Kopia karty w tym samym dziale"><Copy className="h-4 w-4" /></button>
          <button type="button" className={dangerButton} onClick={() => void remove()} title="Usuń kartę"><Trash2 className="h-4 w-4" /></button>
          <button type="button" className={primaryButton} disabled={!dirty} onClick={() => void save()}><Save className="h-4 w-4" />Zapisz</button>
        </div>
        <div className="w-full text-[11px] text-[#e5e4e2]/40">
          {item.updatedAt && `Zmieniono ${new Date(item.updatedAt).toLocaleString('pl-PL')}${item.updatedByName ? ` · ${item.updatedByName}` : ''}`}
          {dirty && <span className="ml-2 text-amber-200">Niezapisane zmiany</span>}
        </div>
      </div>

      {/* Panel boczny (produkty, lista kontrolna) obok bloków dopiero na bardzo szerokim ekranie; na MacBooku — nad blokami, żeby bloki miały pełną szerokość. */}
      <div className="grid gap-4 min-[1800px]:grid-cols-[minmax(0,1fr)_340px]">
        <section className={`${cardClass} grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_280px] min-[1800px]:col-start-1 min-[1800px]:row-start-1`}>
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-[#d3bb73]">Ekran startowy karty</h3>
            <label className="block space-y-1" data-field="tagline">
              <span className="text-xs text-[#e5e4e2]/60">Hasło (jedno zdanie pod tytułem)</span>
              <input value={draft.tagline} maxLength={SHOWCASE_LIMITS.tagline} onChange={(event) => setDraft({ ...draft, tagline: event.target.value })}
                placeholder="np. „Obraz widoczny z każdego miejsca sali — także w dzień”" className={`${inputClass} ${ring('tagline')}`} />
            </label>
            <label className="block space-y-1" data-field="lead">
              <span className="flex justify-between text-xs text-[#e5e4e2]/60"><span>Wstęp — co klient dostaje i dlaczego warto (1–3 zdania)</span><span>{content.lead.length}/{SHOWCASE_LIMITS.lead}</span></span>
              <textarea value={content.lead} maxLength={SHOWCASE_LIMITS.lead} rows={4} onChange={(event) => setContent({ lead: event.target.value })}
                className={`${inputClass} resize-y ${ring('lead')}`} />
            </label>
          </div>
          <div {...heroEvents} data-field="hero" className={`space-y-2 rounded-lg ${ring('hero')}`}>
            <span className="text-xs text-[#e5e4e2]/60">Zdjęcie główne</span>
            <div className={`relative aspect-[4/3] overflow-hidden rounded-lg border border-dashed ${heroOver ? 'border-[#d3bb73] bg-[#d3bb73]/10' : 'border-[#d3bb73]/20 bg-[#0f1119]'}`}>
              {heroUrl ? <img src={heroUrl} alt="" className="h-full w-full object-cover" />
                : <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-[#e5e4e2]/40"><Images className="h-8 w-8 text-[#d3bb73]/30" />Przeciągnij zdjęcie z Findera</div>}
              {heroOver && <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-[#d3bb73]">Upuść, żeby ustawić zdjęcie główne</div>}
              {content.hero && (
                <button type="button" aria-label="Usuń zdjęcie główne" onClick={() => setContent({ hero: null })}
                  className="absolute right-2 top-2 rounded-full bg-black/70 p-1 text-white"><X className="h-4 w-4" /></button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" className={`${secondaryButton} flex-1`} onClick={() => heroInput.current?.click()}><Upload className="h-4 w-4" />Z dysku</button>
              <button type="button" className={`${secondaryButton} flex-1`} onClick={() => setPhotoPicker('hero')}><FolderOpen className="h-4 w-4" />Wybierz…</button>
            </div>
            <input ref={heroInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={(event) => { if (event.target.files?.length) void uploadFiles('hero', Array.from(event.target.files)); event.target.value = ''; }} />
          </div>
        </section>

        <aside className="grid content-start gap-4 xl:grid-cols-2 min-[1800px]:sticky min-[1800px]:top-0 min-[1800px]:col-start-2 min-[1800px]:row-span-2 min-[1800px]:row-start-1 min-[1800px]:flex min-[1800px]:flex-col min-[1800px]:self-start">
          <section className={`${cardClass} space-y-3 p-4`} data-field="products">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-[#d3bb73]" />
              <h3 className="mr-auto text-sm font-medium">Produkty z katalogu</h3>
              <button type="button" className="text-xs text-[#d3bb73] hover:underline" disabled={draft.productIds.length >= SHOWCASE_LIMITS.products} onClick={() => setProductPicker(true)}>Dodaj</button>
            </div>
            <div className={`space-y-1.5 rounded-lg ${ring('products')}`}>
              {products.map((product, index) => (
                <div key={product.id} {...productDrag.rowProps(product.id)} className={`flex items-center gap-2 rounded-lg bg-[#0f1119] px-2 py-1.5 text-sm ${productDrag.indicator(product.id)} ${productDrag.dragging(product.id) ? 'opacity-40' : ''}`}>
                  <span {...productDrag.handleProps(product.id)} className="cursor-grab text-[#e5e4e2]/40 active:cursor-grabbing" title="Przeciągnij, żeby zmienić kolejność"><GripVertical className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1 truncate">{product.name}{index === 0 && <span className="ml-1 text-[11px] text-[#e5e4e2]/40">(główny)</span>}</span>
                  <a href={`/produkty/${product.id}`} target="_blank" rel="noreferrer" title="Strona produktu dla klienta — z materiałem tej karty" className="text-[#e5e4e2]/40 hover:text-[#d3bb73]"><Globe className="h-3.5 w-3.5" /></a>
                  <a href={`/crm/offers/products/${product.id}`} target="_blank" rel="noreferrer" title="Karta produktu" className="text-[#e5e4e2]/40 hover:text-[#d3bb73]"><ExternalLink className="h-3.5 w-3.5" /></a>
                  <button type="button" aria-label={`Usuń ${product.name}`} className="text-[#e5e4e2]/40 hover:text-red-300"
                    onClick={() => setDraft({ ...draft, productIds: draft.productIds.filter((entry) => entry !== product.id) })}><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {!products.length && <p className="text-xs text-[#e5e4e2]/45">Powiąż produkty — warianty, ceny, pakiety i przygotowanie zaciągną się z Oferty → Produkty.</p>}
            </div>
            {products.length > 0 && detail.item.showOnProductPage !== undefined && (
              <Toggle checked={draft.showOnProductPage} onChange={(showOnProductPage) => setDraft({ ...draft, showOnProductPage })}
                label="Pokazuj na stronie produktu dla klienta" />
            )}
            {products.length > 0 && <p className="text-xs leading-5 text-[#e5e4e2]/45">
              {!draft.isActive
                ? 'Szkic — karta nie pokazuje się na spotkaniach ani na stronie produktu dla klienta.'
                : detail.item.showOnProductPage !== undefined && !draft.showOnProductPage
                  ? 'Karta tylko na spotkaniach — strona produktu dla klienta jej nie pokazuje.'
                  : 'Po zapisie treść karty (zdjęcia, punkty, pytania, realizacje — bez ukrytych bloków i cen) pokazuje się też na stronie produktu dla klienta. Podgląd: ikona globusa.'}
            </p>}
          </section>

          <section className={`${cardClass} space-y-2 p-4`}>
            <h3 className="flex items-center gap-2 text-sm font-medium">
              {missing.length ? <AlertTriangle className="h-4 w-4 text-amber-300" /> : <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
              Lista kontrolna
            </h3>
            {checks.map((check) => (
              <button key={check.key} type="button" onClick={() => jumpTo(check.key, check.blockId)}
                className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-[#d3bb73]/10">
                {check.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" /> : <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />}
                <span><span className={check.ok ? 'text-[#e5e4e2]/70' : 'text-[#e5e4e2]'}>{check.label}</span>{!check.ok && <span className="block text-[#e5e4e2]/45">{check.hint}</span>}</span>
              </button>
            ))}
          </section>
        </aside>

        <div className="min-w-0 space-y-4 min-[1800px]:col-start-1 min-[1800px]:row-start-2">
          <div className="flex items-center gap-2">
            <h3 className="mr-auto text-sm font-medium text-[#e5e4e2]/80">Bloki pokazu <span className="text-xs font-normal text-[#e5e4e2]/40">— kolejność jak na spotkaniu (przeciągnij za uchwyt)</span></h3>
            <div className="relative">
              <button type="button" className={secondaryButton} onClick={() => setAddMenu((value) => !value)}><Plus className="h-4 w-4" />Dodaj blok<ChevronDown className="h-3.5 w-3.5" /></button>
              {addMenu && (
                <div className="absolute right-0 z-20 mt-1 w-80 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-2 shadow-2xl">
                  {SHOWCASE_BLOCK_KINDS.map((kind) => (
                    <div key={kind} className="py-1">
                      <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-[#e5e4e2]/40">{SHOWCASE_KIND_LABELS[kind]}</div>
                      {SHOWCASE_BLOCK_STYLES[kind].map((style) => (
                        <button key={style.key || kind} type="button" onClick={() => addBlock(kind, style.key)}
                          className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-[#e5e4e2]/85 hover:bg-[#d3bb73]/10">{style.title}
                          <span className="ml-1 text-xs text-[#e5e4e2]/40">{style.label !== style.title ? `— ${style.label}` : ''}</span></button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {content.blocks.map((block) => (
              <div key={block.id} {...blocksDrag.rowProps(block)} className={`rounded-xl ${blocksDrag.indicator(block)} ${blocksDrag.dragging(block) ? 'opacity-40' : ''}`}>
                <ShowcaseBlockEditor block={block} urls={urls} products={products} productViews={detail.products} realizationNames={refInfo}
                  highlighted={highlight === block.id} dragHandle={blocksDrag.handleProps(block)} onChange={setBlock} onRemove={() => void removeBlock(block)}
                  onUpload={(files) => void uploadFiles(block.id, files)} onPickPhotos={() => setPhotoPicker(block.id)}
                  onPickRealizations={() => setRealizationPicker(block.id)} onAddProduct={() => setProductPicker(true)} />
              </div>
            ))}
            {!content.blocks.length && (
              <div className={`${cardClass} p-6 text-center text-sm text-[#e5e4e2]/50`}>Karta nie ma bloków — dodaj „Jak to wygląda”, „Korzyści” albo galerię.</div>
            )}
          </div>
        </div>
      </div>

      {photoPicker && (
        <ShowcasePhotoPicker target={{ itemId: item.id }} products={products} single={photoPicker === 'hero'}
          title={photoPicker === 'hero' ? 'Zdjęcie główne karty' : 'Dodaj zdjęcia do bloku'}
          onClose={() => setPhotoPicker(null)} onPick={(results) => { addPhotos(photoPicker, results); setPhotoPicker(null); showSnackbar('Dodano zdjęcia — zapisz kartę', 'success'); }} />
      )}
      {assistant && (
        <ShowcaseAssistant input={{ title: draft.title, tagline: draft.tagline, productIds: draft.productIds, content }} onClose={() => setAssistant(false)}
          onApply={(suggestion, fields) => {
            setDraft((current) => {
              if (!current) return current;
              const next = applyShowcaseAiSuggestion({ tagline: current.tagline, content: current.content }, suggestion, fields);
              return { ...current, tagline: next.tagline, content: next.content };
            });
            setAssistant(false);
            showSnackbar(`Wstawiono propozycje asystenta (${fields.length}) — sprawdź tekst i zapisz kartę`, 'success');
          }} />
      )}
      {productPicker && (
        <ShowcaseListPicker mode="products" title="Produkty z katalogu" exclude={draft.productIds} onClose={() => setProductPicker(false)}
          onPick={(picked) => {
            setNames((current) => ({ ...current, ...Object.fromEntries(picked.map((entry) => [entry.id, entry.title])) }));
            setDraft((current) => (current ? { ...current, productIds: [...current.productIds, ...picked.map((entry) => entry.id)].slice(0, SHOWCASE_LIMITS.products) } : current));
            setProductPicker(false);
          }} />
      )}
      {realizationPicker && (
        <ShowcaseListPicker mode="realizations" title="Realizacje ze strony" exclude={content.blocks.find((block) => block.id === realizationPicker)?.refs || []}
          onClose={() => setRealizationPicker(null)}
          onPick={(picked) => {
            setRefInfo((current) => ({ ...current, ...Object.fromEntries(picked.map((entry) => [entry.id, { title: entry.title, thumb: entry.thumbnailUrl || current[entry.id]?.thumb || null }])) }));
            const target = content.blocks.find((block) => block.id === realizationPicker);
            if (target) setBlock({ ...target, refs: [...target.refs, ...picked.map((entry) => entry.id)].slice(0, SHOWCASE_LIMITS.refs) });
            setRealizationPicker(null);
          }} />
      )}
    </div>
  );
}
