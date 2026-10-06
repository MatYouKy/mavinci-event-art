'use client';
import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import OverlayPortal from '@/components/UI/OverlayPortal';

function GeneratingDialog() {
  const dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    dialog.current?.focus();
    const containFocus=(event:FocusEvent)=>{
      if(dialog.current&&!dialog.current.contains(event.target as Node))dialog.current.focus();
    };
    document.addEventListener('focusin',containFocus);
    return()=>{
      document.removeEventListener('focusin',containFocus);
      document.body.style.overflow=previousOverflow;
      requestAnimationFrame(()=>{if(previousFocus?.isConnected)previousFocus.focus();});
    };
  },[]);
  return <div data-app-overlay="true" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="demo-generation-title" aria-describedby="demo-generation-description" tabIndex={-1} onKeyDown={event=>{if(event.key==='Tab'||event.key==='Escape'){event.preventDefault();event.stopPropagation();}}} className="w-full max-w-md rounded-2xl bg-[var(--brand-burgundy-850)] px-7 py-9 text-center text-white shadow-2xl outline-none">
      <Loader2 aria-hidden="true" className="mx-auto h-10 w-10 animate-spin text-[var(--brand-gold)]"/>
      <h2 id="demo-generation-title" className="mt-5 text-xl">Generujemy Twoją ofertę PDF</h2>
      <p id="demo-generation-description" className="mt-3 text-sm leading-6 text-white/65">Przygotowujemy strony usług, kalkulację i plik do pobrania. Poczekaj na zakończenie — formularz jest teraz zablokowany.</p>
      <p role="status" className="mt-5 text-xs text-[var(--brand-gold)]">Pobieranie rozpocznie się automatycznie po przygotowaniu pliku.</p>
    </div>
  </div>;
}
export default function DemoGenerationLoader({show}:{show:boolean}) {
  return show?<OverlayPortal><GeneratingDialog/></OverlayPortal>:null;
}
