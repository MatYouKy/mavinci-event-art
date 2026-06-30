'use client';

import { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { PolishCityCases } from '@/lib/polishCityCases';
import Image from 'next/image';

type GalleryImage = {
  id: string;
  image_url: string;
  alt_text: string | null;
  caption: string | null;
};

type Props = {
  images: GalleryImage[];
  cityCases: PolishCityCases;
};

export default function StreamingCityGallery({ images, cityCases }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const prep = cityCases.locative_preposition || 'w';

  const capitalize = (v: string) =>
    v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : v;

  return (
    <section className="border-b border-[#d3bb73]/10 px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          Realizacje {prep} {capitalize(cityCases.locative)}
        </h2>
        <p className="mx-auto mb-12 max-w-2xl text-center text-[#e5e4e2]/60">
          Wybrane projekty streamingowe zrealizowane przez nasz zespół
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img, idx) => (
            <button
              key={img.id}
              onClick={() => setLightboxIndex(idx)}
              className="group relative aspect-video overflow-hidden rounded-lg border border-[#d3bb73]/10 transition-all hover:border-[#d3bb73]/40"
            >
              <Image
                src={img.image_url}
                alt={img.alt_text || `Streaming ${cityCases.locative}`}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="h-6 w-6" />
          </button>

          {lightboxIndex > 0 && (
            <button
              onClick={() => setLightboxIndex(lightboxIndex - 1)}
              className="absolute left-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            >
              <ChevronLeft className="h-8 w-8" />
            </button>
          )}

          {lightboxIndex < images.length - 1 && (
            <button
              onClick={() => setLightboxIndex(lightboxIndex + 1)}
              className="absolute right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
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
