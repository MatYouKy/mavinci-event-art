"use client";

import { useRef } from 'react';
import { Maximize2, X } from 'lucide-react';

export default function ProductPhoto({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button type="button" onClick={() => dialog.current?.showModal()} aria-label={`Powiększ zdjęcie: ${alt}`}
      className={`group relative block w-full overflow-hidden bg-black/10 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d3bb73]/40 ${className}`}>
      <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
      <span className="absolute bottom-3 right-3 flex items-center gap-2 rounded-lg bg-black/65 px-3 py-2 text-xs text-white"><Maximize2 className="h-4 w-4" />Powiększ zdjęcie</span>
    </button>
    <dialog ref={dialog} aria-label={`Zdjęcie: ${alt}`} onClick={event=>{if(event.target===event.currentTarget)dialog.current?.close();}}
      className="m-auto max-h-[94dvh] w-[calc(100%_-_2rem)] max-w-6xl overflow-auto rounded-2xl bg-[#250914] p-0 text-[#e5e4e2] shadow-2xl backdrop:bg-black/85">
      <header className="flex items-center justify-between gap-4 px-5 py-3"><p className="text-sm">{alt}</p><button autoFocus type="button" onClick={()=>dialog.current?.close()} aria-label="Zamknij zdjęcie" className="rounded-lg p-2 hover:bg-white/10"><X className="h-5 w-5"/></button></header>
      <img src={src} alt={alt} className="max-h-[72dvh] w-full object-contain" />
      <footer className="px-5 py-4 text-sm"><a href={src} target="_blank" rel="noopener noreferrer" className="font-medium text-[#d3bb73] underline underline-offset-4">Otwórz zdjęcie w pełnym rozmiarze w nowej karcie</a></footer>
    </dialog>
  </>;
}
