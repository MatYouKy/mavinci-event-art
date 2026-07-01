'use client';

import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';

type GalleryImage = {
  id: string;
  image_url: string;
  alt_text: string | null;
  caption: string | null;
  category: string | null;
};

type Props = {
  images: GalleryImage[];
};

const defaultImages: GalleryImage[] = [
  {
    id: '1',
    image_url: 'https://images.pexels.com/photos/787961/pexels-photo-787961.jpeg?auto=compress&cs=tinysrgb&w=800',
    alt_text: 'Wieczór w stylu Las Vegas - kasyno rozrywkowe na imprezie firmowej',
    caption: 'Wieczór Las Vegas z kasynem',
    category: 'las-vegas',
  },
  {
    id: '2',
    image_url: 'https://images.pexels.com/photos/1283219/pexels-photo-1283219.jpeg?auto=compress&cs=tinysrgb&w=800',
    alt_text: 'Bal maskowy w stylu weneckim - maski karnawałowe',
    caption: 'Maskarada wenecka na gali firmowej',
    category: 'maskarada',
  },
  {
    id: '3',
    image_url: 'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=800',
    alt_text: 'Impreza w stylu lat 20 - Gatsby party z dekoracjami art deco',
    caption: 'Wieczór Great Gatsby',
    category: 'gatsby',
  },
  {
    id: '4',
    image_url: 'https://images.pexels.com/photos/2263436/pexels-photo-2263436.jpeg?auto=compress&cs=tinysrgb&w=800',
    alt_text: 'Wieczór Hollywood - czerwony dywan i oprawa galowa',
    caption: 'Gala w stylu Hollywood',
    category: 'hollywood',
  },
  {
    id: '5',
    image_url: 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=800',
    alt_text: 'Impreza tropikalna - hawajski wieczór z dekoracjami',
    caption: 'Aloha Party na firmowej integracji',
    category: 'hawajska',
  },
  {
    id: '6',
    image_url: 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=800',
    alt_text: 'Impreza disco - taneczna atmosfera z kula dyskotekowa',
    caption: 'Wieczór disco retro',
    category: 'disco',
  },
  {
    id: '7',
    image_url: 'https://images.pexels.com/photos/3171837/pexels-photo-3171837.jpeg?auto=compress&cs=tinysrgb&w=800',
    alt_text: 'Impreza tematyczna z dekoracjami i oświetleniem eventowym',
    caption: 'Event firmowy z oprawą scenograficzną',
    category: 'general',
  },
  {
    id: '8',
    image_url: 'https://images.pexels.com/photos/1267697/pexels-photo-1267697.jpeg?auto=compress&cs=tinysrgb&w=800',
    alt_text: 'Wieczór meksykański - fiesta z kolorowymi dekoracjami',
    caption: 'Fiesta meksykańska z dekoracjami',
    category: 'meksykanska',
  },
  {
    id: '9',
    image_url: 'https://images.pexels.com/photos/2306281/pexels-photo-2306281.jpeg?auto=compress&cs=tinysrgb&w=800',
    alt_text: 'Neonowe oświetlenie na wieczorze tematycznym',
    caption: 'Efekty świetlne na wieczorze tematycznym',
    category: 'general',
  },
];

export default function ThemedPartyGallery({ images }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const gallery = images.length > 0 ? images : defaultImages;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (lightboxIndex === null) return;
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowLeft' && lightboxIndex > 0) setLightboxIndex(lightboxIndex - 1);
      if (e.key === 'ArrowRight' && lightboxIndex < gallery.length - 1) setLightboxIndex(lightboxIndex + 1);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxIndex, gallery.length]);

  return (
    <section className="border-b border-[#d3bb73]/10 px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          Galeria wieczorów tematycznych
        </h2>
        <p className="mx-auto mb-12 max-w-2xl text-center text-[#e5e4e2]/60">
          Wybrane realizacje imprez tematycznych zorganizowanych przez nasz zespół
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {gallery.map((img, idx) => (
            <button
              key={img.id}
              onClick={() => setLightboxIndex(idx)}
              className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-[#d3bb73]/10 transition-all duration-300 hover:border-[#d3bb73]/40 hover:shadow-lg hover:shadow-[#d3bb73]/5"
            >
              <Image
                src={img.image_url}
                alt={img.alt_text || 'Wieczór tematyczny'}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover transition-transform duration-500 group-hover:scale-110"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119]/80 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <div className="absolute bottom-4 left-4 right-4">
                  <p className="text-sm font-light text-[#e5e4e2]">
                    {img.alt_text || `Zdjęcie ${idx + 1}`}
                  </p>
                  {img.caption && (
                    <p className="mt-1 text-xs text-[#e5e4e2]/60">{img.caption}</p>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {lightboxIndex !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4">
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
          >
            <X className="h-6 w-6" />
          </button>

          {lightboxIndex > 0 && (
            <button
              onClick={() => setLightboxIndex(lightboxIndex - 1)}
              className="absolute left-4 z-10 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            >
              <ChevronLeft className="h-8 w-8" />
            </button>
          )}

          {lightboxIndex < gallery.length - 1 && (
            <button
              onClick={() => setLightboxIndex(lightboxIndex + 1)}
              className="absolute right-4 z-10 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            >
              <ChevronRight className="h-8 w-8" />
            </button>
          )}

          <div className="relative h-[80vh] w-full max-w-5xl">
            <Image
              src={gallery[lightboxIndex].image_url}
              alt={gallery[lightboxIndex].alt_text || ''}
              fill
              className="object-contain"
              sizes="100vw"
            />
          </div>

          <div className="absolute bottom-6 text-center text-sm text-white/60">
            {lightboxIndex + 1} / {gallery.length}
            {gallery[lightboxIndex].caption && (
              <span className="ml-4 text-white/80">{gallery[lightboxIndex].caption}</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
