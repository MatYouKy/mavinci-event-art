'use client';

import { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';

type GalleryImage = {
  id: string;
  image_url: string;
  alt_text: string | null;
  caption: string | null;
  image_metadata?: { mobile?: { src?: string }; desktop?: { src?: string } } | null;
};

type Props = {
  images: GalleryImage[];
};

export default function CasinoCityGallery({ images }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <section className="border-b border-[#d3bb73]/10 px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-4 text-center text-3xl font-light uppercase text-[#e5e4e2] md:text-4xl">
          Galeria kasyna eventowego
        </h2>
        <p className="mx-auto mb-12 max-w-2xl text-center text-[#e5e4e2]/60">
          Stoły do gier, oprawa i inspiracje do wieczoru w klimacie kasyna.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img, idx) => (
            <button
              key={img.id}
              type="button"
              aria-label={`Powiększ zdjęcie: ${img.alt_text || img.caption || 'kasyno eventowe'}`}
              onClick={() => setLightboxIndex(idx)}
              className="group relative aspect-video overflow-hidden rounded-lg border border-[#d3bb73]/10 transition-all hover:border-[#d3bb73]/40"
            >
              <picture>
                {img.image_metadata?.mobile?.src && <source media="(max-width: 767px)" srcSet={img.image_metadata.mobile.src} />}
                <img src={img.image_metadata?.desktop?.src || img.image_url}
                  alt={img.alt_text || 'Kasyno eventowe MAVINCI'} width={960} height={540}
                  className="absolute inset-0 h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-105"
                  loading="lazy" decoding="async" />
              </picture>
              {img.caption && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                  <p className="text-sm text-white/90">{img.caption}</p>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {lightboxIndex !== null && (
        <div role="dialog" aria-modal="true" aria-label="Podgląd zdjęcia kasyna" onKeyDown={event => { if (event.key === 'Escape') setLightboxIndex(null); }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
          <button
            type="button"
            autoFocus
            aria-label="Zamknij zdjęcie"
            onClick={() => setLightboxIndex(null)}
            className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
          >
            <X className="h-6 w-6" />
          </button>

          {lightboxIndex > 0 && (
            <button
              type="button"
              aria-label="Poprzednie zdjęcie"
              onClick={() => setLightboxIndex(lightboxIndex - 1)}
              className="absolute left-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            >
              <ChevronLeft className="h-8 w-8" />
            </button>
          )}

          {lightboxIndex < images.length - 1 && (
            <button
              type="button"
              aria-label="Następne zdjęcie"
              onClick={() => setLightboxIndex(lightboxIndex + 1)}
              className="absolute right-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            >
              <ChevronRight className="h-8 w-8" />
            </button>
          )}

          <div className="relative h-[80vh] w-full max-w-5xl">
            <Image
              src={images[lightboxIndex].image_url}
              alt={images[lightboxIndex].alt_text || ''}
              fill
              className="object-contain"
              sizes="100vw"
            />
          </div>

          <div className="absolute bottom-6 text-center text-sm text-white/60">
            {lightboxIndex + 1} / {images.length}
            {images[lightboxIndex].caption && (
              <span className="ml-4 text-white/80">{images[lightboxIndex].caption}</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
