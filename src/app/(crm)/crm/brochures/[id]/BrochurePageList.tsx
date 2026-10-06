'use client';
import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical } from 'lucide-react';
export type BrochurePageRow = { key: string; title: string; subtitle: string; visible: boolean; imageUrl?: string };
export default function BrochurePageList({ pages, selectedKey, disabled, onSelect, onOrder, onToggle }: {
  pages: BrochurePageRow[]; selectedKey: string; disabled: boolean;
  onSelect: (key: string) => void; onOrder: (keys: string[]) => void; onToggle: (key: string) => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const move = (from: number, to: number) => {
    if (disabled || from < 0 || to < 0 || to >= pages.length || from === to) return;
    const keys = pages.map((p) => p.key); const [key] = keys.splice(from, 1); keys.splice(to, 0, key); onOrder(keys);
  };
  let visibleIndex = 0;
  return <section className="rounded-xl bg-[#1c1f33] p-4">
    <h2 className="text-sm font-medium">Wszystkie strony</h2><p className="mt-1 text-xs leading-5 text-white/45">Przeciągnij stronę lub użyj strzałek. Ukryte strony zachowują treść, ale nie trafiają do PDF.</p>
    <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto">{pages.map((page, index) => {
      if (page.visible) visibleIndex++;
      return <div key={page.key} draggable={!disabled} onDragStart={() => setDragged(page.key)} onDragEnd={() => setDragged(null)} onDragOver={(e) => { if (!disabled) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (dragged) move(pages.findIndex((p) => p.key === dragged), index); setDragged(null); }} className={`flex items-center gap-2 rounded-lg p-2 ${selectedKey === page.key ? 'bg-[#d3bb73]/10' : 'bg-black/15'} ${!page.visible ? 'opacity-50' : ''}`}>
        <GripVertical className="h-4 w-4 shrink-0 text-white/25" />
        <button type="button" onClick={() => onSelect(page.key)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className="w-5 text-xs text-[#d3bb73]">{page.visible ? String(visibleIndex).padStart(2, '0') : '—'}</span>{page.imageUrl && <img src={page.imageUrl} alt="" className="h-12 w-9 rounded object-cover" />}<span className="min-w-0"><span className="block truncate text-sm">{page.title}</span><span className="block truncate text-[11px] text-white/40">{page.subtitle}</span></span></button>
        <div className="flex shrink-0 gap-1">{([-1, 1] as const).map((direction) => <button key={direction} type="button" disabled={disabled || index + direction < 0 || index + direction >= pages.length} aria-label={`${direction < 0 ? 'Wcześniej' : 'Później'}: ${page.title}`} onClick={() => move(index, index + direction)} className="rounded p-1.5 text-white/45 hover:bg-white/5 disabled:opacity-20">{direction < 0 ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}</button>)}<button type="button" disabled={disabled} aria-label={`${page.visible ? 'Ukryj' : 'Pokaż'}: ${page.title}`} onClick={() => onToggle(page.key)} className="rounded p-1.5 text-[#d3bb73]/70 hover:bg-white/5 disabled:opacity-20">{page.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button></div>
      </div>;
    })}</div>
  </section>;
}
