'use client';

import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import { PolishCityCases } from '@/lib/polishCityCases';

interface GalleryImage {
  id: string;
  image_url: string;
  alt_text: string;
  caption: string;
}

type Props = {
  images: GalleryImage[];
  cityCases: PolishCityCases;
};

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export default function IntegrationsCityGallery({ images, cityCases }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const prep = cityCases.locative_preposition || 'w';

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (lightboxIndex === null) return;
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowLeft') setLightboxIndex((p) => (p! - 1 + images.length) % images.length);
      if (e.key === 'ArrowRight') setLightboxIndex((p) => (p! + 1) % images.length);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxIndex, images.length]);

  if (!images || images.length === 0) return null;

  return (
    <>
      <section className="border-b border-[#d3bb73]/10 px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
            Galeria integracji {prep} {capitalize(cityCases.locative)}
          </h2>
          <p className="mx-auto mb-12 max-w-2xl text-center text-[#e5e4e2]/60">
            Wybrane realizacje integracji firmowych zorganizowanych przez nasz zespol
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((img, idx) => (
              <button
                key={img.id}
                onClick={() => setLightboxIndex(idx)}
                className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-[#d3bb73]/10 transition-all duration-300 hover:border-[#d3bb73]/40 hover:shadow-lg hover:shadow-[#d3bb73]/5"
              >
                <Image
                  src={img.image_url}
                  alt={img.alt_text || `Integracja firmowa ${prep} ${capitalize(cityCases.locative)}`}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-110"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119]/80 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                  <div className="absolute bottom-4 left-4 right-4">
                    <p className="text-sm font-light text-[#e5e4e2]">{img.alt_text}</p>
                    {img.caption && (
                      <p className="mt-1 text-xs text-[#e5e4e2]/60">{img.caption}</p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {lightboxIndex !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95">
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="h-6 w-6" />
          </button>

          {images.length > 1 && (
            <>
              <button
                onClick={() => setLightboxIndex((p) => (p! - 1 + images.length) % images.length)}
                className="absolute left-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              >
                <ChevronLeft className="h-8 w-8" />
              </button>
              <button
                onClick={() => setLightboxIndex((p) => (p! + 1) % images.length)}
                className="absolute right-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              >
                <ChevronRight className="h-8 w-8" />
              </button>
            </>
          )}

          <div className="relative mx-4 h-[80vh] w-full max-w-7xl">
            <Image
              src={images[lightboxIndex].image_url}
              alt={images[lightboxIndex].alt_text || ''}
              fill
              className="object-contain"
              sizes="100vw"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
              <p className="text-center text-white">{images[lightboxIndex].alt_text}</p>
              {images[lightboxIndex].caption && (
                <p className="mt-1 text-center text-sm text-white/80">
                  {images[lightboxIndex].caption}
                </p>
              )}
              <p className="mt-2 text-center text-sm text-white/60">
                {lightboxIndex + 1} / {images.length}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
