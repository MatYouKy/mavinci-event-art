'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, Minus, Plus, RotateCcw, Sparkles } from 'lucide-react';
import { centerCrop, fitCrop, formatAspect, moveCrop, zoomCrop, type SocialCrop, type SocialFormat } from '@/lib/social/socialShared';
import type { SocialGuides } from './socialApi';
import { secondaryButton } from './socialUi';

/*
 * Edytor kadru: zdjęcie (wersja robocza) z ramką formatu — przeciąganie, powiększanie (suwak, kółko myszy, przyciski),
 * propozycja kadru z analizy i środek zdjęcia. W ramce: siatka trójpodziału, pole logo i tekstów z szablonu marki
 * oraz strefy zasłaniane w relacji. Kadr zawsze w proporcjach formatu i w granicach zdjęcia (`fitCrop`).
 */

type Props = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  format: SocialFormat;
  crop: SocialCrop;
  proposal: SocialCrop | null;
  guides: SocialGuides | null;
  disabled?: boolean;
  onChange: (crop: SocialCrop) => void;
};

export default function SocialCropEditor({ imageUrl, imageWidth, imageHeight, format, crop, proposal, guides, disabled, onChange }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const drag = useRef<{ x: number; y: number; crop: SocialCrop } | null>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => {
      const maxWidth = element.parentElement?.clientWidth || 600;
      const maxHeight = Math.min(560, Math.max(260, window.innerHeight * 0.55));
      const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
      setSize({ width: Math.round(imageWidth * scale), height: Math.round(imageHeight * scale) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [imageWidth, imageHeight]);

  const zoom = useCallback((factor: number) => onChange(zoomCrop(crop, factor, imageWidth, imageHeight, format)), [crop, imageWidth, imageHeight, format, onChange]);

  const maxW = fitCrop({ x: 0, y: 0, w: 1, h: 1 }, imageWidth, imageHeight, format).w;
  const zoomLevel = Math.round((maxW / crop.w) * 100);

  return (
    <div className="space-y-3">
      <div ref={box} className="relative mx-auto select-none overflow-hidden rounded-lg bg-black" style={{ width: size.width, height: size.height, touchAction: 'none' }}
        onWheel={(event) => { if (disabled) return; event.preventDefault(); zoom(event.deltaY > 0 ? 1.05 : 0.95); }}>
        {size.width > 0 && <img src={imageUrl} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />}
        {size.width > 0 && (
          <div
            role="slider"
            aria-label={`Kadr ${format}`}
            aria-valuenow={zoomLevel}
            tabIndex={0}
            onKeyDown={(event) => {
              if (disabled) return;
              const step = event.shiftKey ? 0.05 : 0.01;
              const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
              if (moves[event.key]) { event.preventDefault(); onChange(moveCrop(crop, moves[event.key][0], moves[event.key][1])); }
              if (event.key === '+' || event.key === '=') zoom(0.95);
              if (event.key === '-') zoom(1.05);
            }}
            onPointerDown={(event) => {
              if (disabled) return;
              (event.target as HTMLElement).setPointerCapture(event.pointerId);
              drag.current = { x: event.clientX, y: event.clientY, crop };
            }}
            onPointerMove={(event) => {
              if (!drag.current) return;
              const dx = (event.clientX - drag.current.x) / size.width;
              const dy = (event.clientY - drag.current.y) / size.height;
              onChange(moveCrop(drag.current.crop, dx, dy));
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            className={`absolute outline-none ring-2 ring-[#d3bb73] ${disabled ? 'cursor-default' : 'cursor-move'}`}
            style={{
              left: crop.x * size.width, top: crop.y * size.height, width: crop.w * size.width, height: crop.h * size.height,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)',
            }}>
            <div className="pointer-events-none absolute inset-0">
              {[1, 2].map((part) => (
                <span key={`v${part}`} className="absolute top-0 h-full w-px bg-white/25" style={{ left: `${(part * 100) / 3}%` }} />
              ))}
              {[1, 2].map((part) => (
                <span key={`h${part}`} className="absolute left-0 h-px w-full bg-white/25" style={{ top: `${(part * 100) / 3}%` }} />
              ))}
              {guides?.unsafeTop && <span className="absolute left-0 w-full bg-red-500/25" style={{ top: 0, height: `${guides.unsafeTop.h * 100}%` }} />}
              {guides?.unsafeBottom && <span className="absolute left-0 w-full bg-red-500/25" style={{ top: `${guides.unsafeBottom.y * 100}%`, height: `${guides.unsafeBottom.h * 100}%` }} />}
              {guides && (
                <>
                  <span className="absolute border border-dashed border-white/70" title="Logo" style={{ left: `${guides.logo.x * 100}%`, top: `${guides.logo.y * 100}%`, width: `${guides.logo.w * 100}%`, height: `${guides.logo.h * 100}%` }} />
                  <span className="absolute border border-dashed border-[#d3bb73]/80" title="Tytuł i podpis" style={{ left: `${guides.text.x * 100}%`, top: `${guides.text.y * 100}%`, width: `${guides.text.w * 100}%`, height: `${guides.text.h * 100}%` }} />
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" className={secondaryButton} disabled={disabled} onClick={() => zoom(1.08)} aria-label="Oddal"><Minus className="h-4 w-4" /></button>
        <input type="range" min={100} max={400} value={Math.min(400, Math.max(100, zoomLevel))} disabled={disabled} aria-label="Powiększenie kadru"
          onChange={(event) => {
            const target = maxW / (Number(event.target.value) / 100);
            onChange(zoomCrop(crop, target / crop.w, imageWidth, imageHeight, format));
          }} className="w-40 accent-[#d3bb73]" />
        <button type="button" className={secondaryButton} disabled={disabled} onClick={() => zoom(0.92)} aria-label="Przybliż"><Plus className="h-4 w-4" /></button>
        {proposal && <button type="button" className={secondaryButton} disabled={disabled} onClick={() => onChange(fitCrop(proposal, imageWidth, imageHeight, format))}><Sparkles className="h-4 w-4" />Propozycja</button>}
        <button type="button" className={secondaryButton} disabled={disabled} onClick={() => onChange(centerCrop(imageWidth, imageHeight, format))}><Crosshair className="h-4 w-4" />Środek</button>
        <span className="text-xs text-[#e5e4e2]/40"><RotateCcw className="mr-1 inline h-3 w-3" />Przeciągnij kadr, kółko myszy — powiększenie. Proporcje {format.replace('.', ',')} ({formatAspect(format).toFixed(2)})</span>
      </div>
      {guides && <p className="text-center text-[11px] text-[#e5e4e2]/40">Ramki: białą — logo, złotą — tytuł i podpis{guides.unsafeTop ? ', czerwone — zasłaniane w relacji przez Instagram' : ''}.</p>}
    </div>
  );
}
