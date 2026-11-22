'use client';

import { useRef, useState, type DragEvent } from 'react';
import { Award, Eye, EyeOff, FolderOpen, GripVertical, Images, Package, Plus, Trash2, Upload, X } from 'lucide-react';
import {
  SHOWCASE_BLOCK_STYLES, SHOWCASE_KIND_LABELS, SHOWCASE_LIMITS, showcaseCatalogHasContent, showcaseDefaultTitle, showcaseId, showcaseMediaKey,
  type ShowcaseBlock, type ShowcaseMedia, type ShowcaseProductView, type ShowcaseRow, type ShowcaseUrls,
} from '@/lib/showcase/showcaseShared';
import { cardClass, inputClass, secondaryButton } from '../social/socialUi';
import { hasFiles, useDragList } from './showcaseUi';

/*
 * Edytor bloku karty prezentacji: zdjęcia (z dysku — także przeciągnięciem z Findera, z katalogu, realizacji, Materiałów,
 * plików wydarzenia, social media; kolejność przeciąganiem, podpisy), punkty / specyfikacja / pytania (wiersze z przeciąganiem),
 * blok z katalogu (produkt i rodzaj treści — dane na bieżąco z Oferty → Produkty), tekst i realizacje ze strony.
 */

/** Pole wyboru bez pełnej szerokości (wariant bloku obok tytułu). */
const selectClass = `${inputClass.replace('w-full ', '')} w-auto min-w-0 max-w-[260px]`;

const ROW_LABELS: Record<string, [string, string]> = {
  points: ['Punkt (np. „Widoczny z każdego miejsca sali”)', 'Opis (opcjonalnie)'],
  specs: ['Parametr (np. „Rozdzielczość”)', 'Wartość (np. „P2,6 — 384 × 384 px na panel”)'],
  faq: ['Pytanie klienta (np. „Czy ekran jest widoczny w dzień?”)', 'Odpowiedź'],
};

export type BlockEditorProps = {
  block: ShowcaseBlock;
  urls: ShowcaseUrls;
  products: Array<{ id: string; name: string }>;
  productViews: ShowcaseProductView[];
  realizationNames: Record<string, { title: string; thumb: string | null }>;
  highlighted: boolean;
  dragHandle: Record<string, unknown>;
  onChange: (block: ShowcaseBlock) => void;
  onRemove: () => void;
  onUpload: (files: FileList | File[]) => void;
  onPickPhotos: () => void;
  onPickRealizations: () => void;
  onAddProduct: () => void;
};

export default function ShowcaseBlockEditor({
  block, urls, products, productViews, realizationNames, highlighted, dragHandle, onChange, onRemove, onUpload, onPickPhotos, onPickRealizations, onAddProduct,
}: BlockEditorProps) {
  const set = (patch: Partial<ShowcaseBlock>) => onChange({ ...block, ...patch });
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileOver, setFileOver] = useState(false);
  const depth = useRef(0);
  const styles = SHOWCASE_BLOCK_STYLES[block.kind];

  const photoDrag = useDragList<ShowcaseMedia>({ items: block.photos, keyOf: (photo) => photo.id, onMove: (photos) => set({ photos }), axis: 'x', group: `photos-${block.id}` });
  const rowDrag = useDragList<ShowcaseRow>({ items: block.rows, keyOf: (row) => row.id, onMove: (rows) => set({ rows }), group: `rows-${block.id}` });
  const refDrag = useDragList<string>({ items: block.refs, keyOf: (ref) => ref, onMove: (refs) => set({ refs }), axis: 'x', group: `refs-${block.id}` });

  const fileEvents = block.kind === 'photos' ? {
    onDragEnter: (event: DragEvent<HTMLElement>) => { if (!hasFiles(event)) return; event.preventDefault(); depth.current += 1; setFileOver(true); },
    onDragOver: (event: DragEvent<HTMLElement>) => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } },
    onDragLeave: (event: DragEvent<HTMLElement>) => { if (!hasFiles(event)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setFileOver(false); },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setFileOver(false);
      onUpload(event.dataTransfer.files);
    },
  } : {};

  const productView = productViews.find((product) => product.id === block.productId);

  return (
    <div {...fileEvents} data-block-editor={block.id}
      className={`${cardClass} relative space-y-3 p-4 transition-shadow ${highlighted ? 'ring-2 ring-[#d3bb73]' : ''} ${block.hidden ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span {...dragHandle} className="flex h-8 cursor-grab items-center text-[#e5e4e2]/40 active:cursor-grabbing" title="Przeciągnij, żeby zmienić kolejność bloków">
          <GripVertical className="h-4 w-4" />
        </span>
        <span className="shrink-0 whitespace-nowrap rounded-full border border-[#d3bb73]/25 bg-[#d3bb73]/10 px-2 py-0.5 text-[11px] text-[#d3bb73]">{SHOWCASE_KIND_LABELS[block.kind]}</span>
        <input value={block.title} maxLength={SHOWCASE_LIMITS.blockTitle} onChange={(event) => set({ title: event.target.value })}
          placeholder={showcaseDefaultTitle(block.kind, block.style)} className={`${inputClass} min-w-[160px] flex-1 basis-[200px] font-medium`} aria-label="Tytuł bloku" />
        {/* Wariant i akcje przechodzą do kolejnego wiersza razem (wąski edytor), nigdy pojedynczo. */}
        <div className="ml-auto flex max-w-full shrink-0 items-center gap-1">
          {styles.length > 1 && (
            <select value={block.style} className={selectClass} aria-label="Wariant bloku"
              onChange={(event) => {
                const style = event.target.value;
                const oldDefault = showcaseDefaultTitle(block.kind, block.style);
                set({ style, title: !block.title || block.title === oldDefault ? showcaseDefaultTitle(block.kind, style) : block.title });
              }}>
              {styles.map((style) => <option key={style.key} value={style.key}>{style.label}</option>)}
            </select>
          )}
          <button type="button" onClick={() => set({ hidden: !block.hidden })} title={block.hidden ? 'Ukryty — kliknij, żeby pokazywać na spotkaniach' : 'Ukryj na spotkaniach (blok zostaje w karcie)'}
            className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]">
            {block.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onRemove} title="Usuń blok" className="rounded-lg p-2 text-[#e5e4e2]/50 hover:bg-red-500/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      {block.kind !== 'text' && (
        <textarea value={block.text} onChange={(event) => set({ text: event.target.value })} rows={1} maxLength={600}
          placeholder="Wprowadzenie pod tytułem (opcjonalnie)" className={`${inputClass} resize-y text-xs`} />
      )}

      {block.kind === 'photos' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-4">
            {block.photos.map((photo) => {
              const url = urls[showcaseMediaKey(photo)]?.thumb;
              return (
                <div key={photo.id} {...photoDrag.rowProps(photo)} className={`group relative rounded-lg bg-[#0f1119] ${photoDrag.indicator(photo)} ${photoDrag.dragging(photo) ? 'opacity-40' : ''}`}>
                  <div {...photoDrag.handleProps(photo)} className="aspect-[4/3] cursor-grab overflow-hidden rounded-t-lg active:cursor-grabbing" title="Przeciągnij, żeby zmienić kolejność">
                    {url ? <img src={url} alt="" className="h-full w-full object-cover" draggable={false} /> : <Images className="m-auto mt-8 h-6 w-6 text-[#d3bb73]/30" />}
                  </div>
                  <button type="button" onClick={() => set({ photos: block.photos.filter((entry) => entry.id !== photo.id) })} aria-label="Usuń zdjęcie"
                    className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
                  {photo.source !== 'upload' && (
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/80">{photo.source === 'product' ? 'Katalog' : photo.source === 'material' ? 'Baza zdjęć' : 'Realizacja'}</span>
                  )}
                  <input value={photo.caption} maxLength={SHOWCASE_LIMITS.caption} placeholder="Podpis (opcjonalnie)"
                    onChange={(event) => set({ photos: block.photos.map((entry) => (entry.id === photo.id ? { ...entry, caption: event.target.value } : entry)) })}
                    className="w-full rounded-b-lg border-0 bg-transparent px-2 py-1.5 text-[11px] text-[#e5e4e2]/80 outline-none placeholder:text-[#e5e4e2]/30" />
                </div>
              );
            })}
          </div>
          <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-xs ${fileOver ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]' : 'border-[#d3bb73]/20 text-[#e5e4e2]/50'}`}>
            <Upload className="h-4 w-4" />
            <span className="mr-auto">{fileOver ? 'Upuść zdjęcia tutaj' : 'Przeciągnij zdjęcia z Findera albo pulpitu (JPEG, PNG, WebP)'}</span>
            <button type="button" className={secondaryButton} onClick={() => fileInput.current?.click()}><Upload className="h-4 w-4" />Z dysku</button>
            <button type="button" className={secondaryButton} onClick={onPickPhotos}><FolderOpen className="h-4 w-4" />Wybierz…</button>
          </div>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden"
            onChange={(event) => { if (event.target.files?.length) onUpload(Array.from(event.target.files)); event.target.value = ''; }} />
        </div>
      )}

      {(block.kind === 'points' || block.kind === 'specs' || block.kind === 'faq') && (
        <div className="space-y-2">
          {block.rows.map((row) => (
            <div key={row.id} {...rowDrag.rowProps(row)} className={`flex gap-2 rounded-lg ${rowDrag.indicator(row)} ${rowDrag.dragging(row) ? 'opacity-40' : ''}`}>
              <span {...rowDrag.handleProps(row)} className="flex h-9 cursor-grab items-center text-[#e5e4e2]/40 active:cursor-grabbing" title="Przeciągnij, żeby zmienić kolejność">
                <GripVertical className="h-4 w-4" />
              </span>
              <div className={`grid min-w-0 flex-1 gap-2 ${block.kind === 'specs' ? 'md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : ''}`}>
                <input value={row.title} maxLength={SHOWCASE_LIMITS.rowTitle} placeholder={ROW_LABELS[block.kind][0]} className={inputClass}
                  onChange={(event) => set({ rows: block.rows.map((entry) => (entry.id === row.id ? { ...entry, title: event.target.value } : entry)) })} />
                <textarea value={row.text} maxLength={SHOWCASE_LIMITS.rowText} rows={block.kind === 'specs' ? 1 : 2} placeholder={ROW_LABELS[block.kind][1]} className={`${inputClass} resize-y`}
                  onChange={(event) => set({ rows: block.rows.map((entry) => (entry.id === row.id ? { ...entry, text: event.target.value } : entry)) })} />
              </div>
              <button type="button" aria-label="Usuń wiersz" className="h-9 rounded-lg px-2 text-[#e5e4e2]/40 hover:text-red-300"
                onClick={() => set({ rows: block.rows.filter((entry) => entry.id !== row.id) })}><X className="h-4 w-4" /></button>
            </div>
          ))}
          <button type="button" className={secondaryButton} disabled={block.rows.length >= SHOWCASE_LIMITS.rows}
            onClick={() => set({ rows: [...block.rows, { id: showcaseId(), title: '', text: '' }] })}>
            <Plus className="h-4 w-4" />{block.kind === 'faq' ? 'Dodaj pytanie' : block.kind === 'specs' ? 'Dodaj parametr' : 'Dodaj punkt'}
          </button>
        </div>
      )}

      {block.kind === 'text' && (
        <textarea value={block.text} onChange={(event) => set({ text: event.target.value })} rows={6} maxLength={SHOWCASE_LIMITS.blockText}
          placeholder="Akapity tekstu — pusta linia oddziela akapity." className={`${inputClass} resize-y`} />
      )}

      {block.kind === 'catalog' && (
        <div className="space-y-2 text-sm">
          {products.length ? (
            <select value={block.productId || ''} onChange={(event) => set({ productId: event.target.value || null })} className={inputClass} aria-label="Produkt z katalogu">
              <option value="">Wybierz produkt karty…</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          ) : (
            <button type="button" className={secondaryButton} onClick={onAddProduct}><Package className="h-4 w-4" />Dodaj produkt z katalogu do karty</button>
          )}
          {block.productId && !productView && <p className="text-xs text-[#e5e4e2]/45">Dane produktu (warianty, ceny, przygotowanie) pojawią się po zapisaniu karty.</p>}
          {productView && (
            <p className={`text-xs ${showcaseCatalogHasContent(productView, block.style) ? 'text-[#e5e4e2]/55' : 'text-amber-200'}`}>
              {catalogSummary(productView, block.style)}
              {' '}<a href={`/crm/offers/products/${productView.id}`} target="_blank" rel="noreferrer" className="text-[#d3bb73] hover:underline">Otwórz kartę produktu</a>
            </p>
          )}
        </div>
      )}

      {block.kind === 'realizations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {block.refs.map((ref) => {
              const info = realizationNames[ref];
              return (
                <div key={ref} {...refDrag.rowProps(ref)} className={`flex w-44 flex-col overflow-hidden rounded-lg bg-[#0f1119] ${refDrag.indicator(ref)} ${refDrag.dragging(ref) ? 'opacity-40' : ''}`}>
                  <div {...refDrag.handleProps(ref)} className="relative aspect-[4/3] cursor-grab bg-black/30 active:cursor-grabbing" title="Przeciągnij, żeby zmienić kolejność">
                    {info?.thumb ? <img src={info.thumb} alt="" className="h-full w-full object-cover" draggable={false} /> : <Award className="m-auto mt-8 h-6 w-6 text-[#d3bb73]/30" />}
                    <button type="button" aria-label="Usuń realizację" onClick={() => set({ refs: block.refs.filter((entry) => entry !== ref) })}
                      className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"><X className="h-3.5 w-3.5" /></button>
                  </div>
                  <span className="truncate px-2 py-1.5 text-[11px] text-[#e5e4e2]/75">{info?.title || 'Realizacja'}</span>
                </div>
              );
            })}
          </div>
          <button type="button" className={secondaryButton} disabled={block.refs.length >= SHOWCASE_LIMITS.refs} onClick={onPickRealizations}>
            <Plus className="h-4 w-4" />Dodaj realizacje ze strony
          </button>
        </div>
      )}
    </div>
  );
}

function catalogSummary(product: ShowcaseProductView, style: string): string {
  const count = (value: number, one: string, few: string, many: string) => `${value} ${value === 1 ? one : value % 10 >= 2 && value % 10 <= 4 && (value % 100 < 12 || value % 100 > 14) ? few : many}`;
  switch (style) {
    case 'variants': return product.variants.length ? `Z katalogu: ${count(product.variants.length, 'wariant', 'warianty', 'wariantów')} (zdjęcia, opisy, ceny).` : 'Produkt nie ma wariantów w katalogu — blok się nie pokaże.';
    case 'benefits': return product.benefits.length ? `Z katalogu: ${count(product.benefits.length, 'korzyść', 'korzyści', 'korzyści')}.` : 'Produkt nie ma korzyści w katalogu — blok się nie pokaże.';
    case 'packages': return product.packages.length ? `Z katalogu: ${count(product.packages.length, 'pakiet', 'pakiety', 'pakietów')}.` : 'Produkt nie ma pakietów sprzedażowych — blok się nie pokaże.';
    default: {
      const parts = [
        product.requirements.length ? count(product.requirements.length, 'wymaganie', 'wymagania', 'wymagań') : '',
        product.setupHours != null ? `montaż ${String(product.setupHours).replace('.', ',')} h` : '',
        product.preparation.length ? count(product.preparation.length, 'ustalenie z obiektem', 'ustalenia z obiektem', 'ustaleń z obiektem') : '',
      ].filter(Boolean);
      return parts.length ? `Z katalogu: ${parts.join(', ')}.` : 'Produkt nie ma wymagań ani czasu montażu w katalogu — blok się nie pokaże.';
    }
  }
}
