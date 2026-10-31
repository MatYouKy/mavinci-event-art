'use client';

import { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';

type GalleryImage = { id: string; image_url: string; alt_text: string; caption: string };

export default function ThemedPartyCitySharedGallery({ images }: { images: GalleryImage[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const active = selected !== null ? images[selected] : null;
  function close() { setSelected(null); }
  function move(direction: number) { setSelected(index => index === null ? null : (index + direction + images.length) % images.length); }
  useEffect(() => {
    if (selected === null) {
      dialog.current?.close();
      opener.current?.focus();
      return;
    }
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [selected]);
  if (!images.length) return null;
  return <section className="mx-auto max-w-7xl px-5 py-14 sm:px-6 md:py-20">
    <h2 className="text-2xl font-light uppercase sm:text-3xl">Galeria motywów i oprawy wydarzeń</h2>
    <p className="mt-5 max-w-3xl leading-7 text-white/75">Zdjęcia z biblioteki MAVINCI pokazują różne warianty oprawy. Konkretny zakres i opis wykonanych prac znajdziesz w realizacjach powyżej.</p>
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {images.map((item, index) => <button key={item.id} type="button" onClick={event => { opener.current = event.currentTarget; setSelected(index); }} aria-label={`Powiększ: ${item.alt_text}`} className="group overflow-hidden rounded-2xl bg-white/[0.045] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d3bb73]/50">
        <div className="relative aspect-[4/3]"><Image src={item.image_url} alt={item.alt_text} fill loading="lazy" sizes="(max-width: 639px) calc(100vw - 40px), (max-width: 1023px) 50vw, 400px" className="object-cover" /></div>
        <span className="block p-4 text-sm leading-6 text-white/75">{item.caption || item.alt_text}</span>
      </button>)}
    </div>
    <dialog ref={dialog} onCancel={close} onClose={close} onKeyDown={event => { if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); } if (event.key === 'ArrowRight') { event.preventDefault(); move(1); } }} aria-label="Powiększone zdjęcie" className="fixed inset-0 m-auto h-[90dvh] max-h-none w-[96vw] max-w-7xl rounded-2xl bg-[#190f1b] p-4 text-white backdrop:bg-black/90">
      {active && <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3"><p className="text-sm">{(selected ?? 0) + 1} / {images.length}</p><button type="button" autoFocus aria-label="Zamknij zdjęcie" onClick={close} className="rounded-full bg-white/10 p-3"><X size={22} /></button></div>
        <div className="relative my-4 min-h-0 flex-1"><Image src={active.image_url} alt={active.alt_text} fill sizes="96vw" className="object-contain" /></div>
        <div className="flex shrink-0 items-center justify-between gap-3"><button type="button" aria-label="Poprzednie zdjęcie" onClick={() => move(-1)} className="rounded-full bg-white/10 p-3"><ChevronLeft size={22} /></button><p className="text-center text-sm leading-6">{active.caption || active.alt_text}</p><button type="button" aria-label="Następne zdjęcie" onClick={() => move(1)} className="rounded-full bg-white/10 p-3"><ChevronRight size={22} /></button></div>
      </div>}
    </dialog>
  </section>;
}
