'use client';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { buildSalesBrochureHtml, type SalesBrochureSnapshot } from '@/lib/brochures/buildSalesBrochureHtml';
import { normalizeRect, pageDesign, type BrochureDecorativePage, type BrochurePageDesign, type PageRect } from '@/lib/brochures/decorativePages';

type Block = 'text' | 'image' | 'details';
const labels: Record<Block, string> = { text: 'Tekst', image: 'Zdjęcie', details: 'Punkty i przycisk' };
export default function BrochurePageCanvas({ page, company, imageUrl, organizationName, disabled, onChange }: {
  page: BrochureDecorativePage; company: SalesBrochureSnapshot['company']; imageUrl?: string;
  organizationName: string; disabled: boolean; onChange: (design: BrochurePageDesign) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ block: Block; resize: boolean; x: number; y: number; width: number; height: number; rect: PageRect; design: BrochurePageDesign } | null>(null);
  const [width, setWidth] = useState(360);
  const [selected, setSelected] = useState<Block>('text');
  const design = pageDesign(page);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  const html = buildSalesBrochureHtml({
    brochure: { id: 'canvas', name: '', title: '', audienceType: 'general' }, company,
    organization: organizationName ? { name: organizationName } : null, items: [],
    decorativePages: [{ ...page, design, isVisible: true, imageUrl }],
    composer: { pageOrder: [], hiddenPages: ['cover', 'intro', 'closing'], coverImagePath: '', coverImageBucket: 'offer-product-pages', coverX: 50, coverY: 50, coverOverlay: 78 }, generatedAt: '',
  });
  const blocks: Block[] = page.layout === 'artwork' ? ['image'] : ['features', 'process', 'timeline'].includes(page.layout) ? ['text', 'details'] : page.layout === 'statement' ? ['text'] : ['showcase', 'signature', 'features-photo'].includes(page.layout) ? ['image', 'text', 'details'] : ['image', 'text'];
  const start = (e: PointerEvent<HTMLButtonElement>, block: Block, resize: boolean) => {
    if (disabled || !ref.current) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setSelected(block);
    const box = ref.current.getBoundingClientRect();
    drag.current = { block, resize, x: e.clientX, y: e.clientY, width: box.width, height: box.height, rect: design[block], design };
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current; if (!d || disabled) return;
    const dx = (e.clientX - d.x) / d.width * 100, dy = (e.clientY - d.y) / d.height * 100;
    const rect = d.resize ? { ...d.rect, width: Math.max(12, Math.min(100 - d.rect.x, d.rect.width + dx)), height: Math.max(8, Math.min(100 - d.rect.y, d.rect.height + dy)) } : normalizeRect({ ...d.rect, x: d.rect.x + dx, y: d.rect.y + dy }, d.rect);
    onChange({ ...d.design, [d.block]: rect });
  };
  return <div className="space-y-3">
    <p className="text-xs leading-5 text-white/50">Przeciągnij pole lub jego narożnik. Strzałki klawiatury przesuwają zaznaczony element; Shift zwiększa krok. Podgląd poniżej pokazuje finalny wygląd bez uchwytów.</p>
    <div ref={ref} className="relative mx-auto w-full max-w-[460px] overflow-hidden rounded-lg shadow-lg" style={{ aspectRatio: '210 / 297' }}>
      <iframe title="Układ edytowanej strony" sandbox="" srcDoc={html} tabIndex={-1} width={794} height={1123} style={{ pointerEvents: 'none', border: 0, position: 'absolute', transform: `scale(${width / 794})`, transformOrigin: 'top left' }} />
      {blocks.map((block) => {
        const r = design[block];
        return <div key={block} style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.width}%`, height: `${r.height}%`, position: 'absolute', pointerEvents: 'none', zIndex: block === 'image' ? 4 : 5 }}>
          <button type="button" aria-label={`Przesuń: ${labels[block]}`} disabled={disabled} onPointerDown={(e) => start(e, block, false)} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onFocus={() => setSelected(block)} onKeyDown={(e) => {
            const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
            if (!delta[e.key] || disabled) return; e.preventDefault(); const [x, y] = delta[e.key], step = e.shiftKey ? 5 : 1;
            onChange({ ...design, [block]: normalizeRect({ ...r, x: r.x + x * step, y: r.y + y * step }, r) });
          }} className={`h-full w-full cursor-move rounded-sm border border-dashed text-left align-top focus:outline-none ${selected === block ? 'border-[#d3bb73]/40 bg-[#d3bb73]/5' : 'border-white/15'}`} style={{ pointerEvents: 'auto', touchAction: 'none' }}><span className="absolute left-0 top-0 rounded-br bg-[#1c1f33]/85 px-2 py-1 text-[10px] text-white/80">{labels[block]}</span></button>
          <button type="button" aria-label={`Zmień rozmiar: ${labels[block]}`} disabled={disabled} onPointerDown={(e) => start(e, block, true)} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize rounded-tl bg-[#d3bb73]/70" style={{ pointerEvents: 'auto', touchAction: 'none' }} />
        </div>;
      })}
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key} className="text-[11px] text-white/50">{labels[blocks.includes(selected) ? selected : blocks[0]]} · {{ x: 'Poziom', y: 'Pion', width: 'Szerokość', height: 'Wysokość' }[key]} %<input type="number" min={0} max={100} step={1} disabled={disabled} value={Math.round(design[blocks.includes(selected) ? selected : blocks[0]][key])} className="mt-1 w-full rounded bg-black/20 p-2 text-sm text-white/80" onChange={(e) => { const b = blocks.includes(selected) ? selected : blocks[0]; onChange({ ...design, [b]: normalizeRect({ ...design[b], [key]: Number(e.target.value) }, design[b]) }); }} /></label>)}</div>
  </div>;
}
