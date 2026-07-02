'use client';

import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Type, Save } from 'lucide-react';
import { PolishCityCases } from '@/lib/polishCityCases';
import { supabase } from '@/lib/supabase/browser';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { useSnackbar } from '@/contexts/SnackbarContext';
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

export default function TechStageCityGallery({ images: initialImages, cityCases }: Props) {
  const [images, setImages] = useState<GalleryImage[]>(initialImages);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [editingAltId, setEditingAltId] = useState<string | null>(null);
  const [altValue, setAltValue] = useState('');
  const { canEdit } = useWebsiteEdit();
  const { showSnackbar } = useSnackbar();
  const prep = cityCases.locative_preposition || 'w';

  const capitalize = (v: string) =>
    v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : v;

  const handleAltEdit = (img: GalleryImage) => {
    setEditingAltId(img.id);
    setAltValue(img.alt_text || '');
  };

  const handleAltSave = async () => {
    if (!editingAltId) return;
    try {
      const { error } = await supabase
        .from('techstage_city_gallery')
        .update({ alt_text: altValue })
        .eq('id', editingAltId);

      if (error) throw error;
      setImages((prev) =>
        prev.map((img) => (img.id === editingAltId ? { ...img, alt_text: altValue } : img)),
      );
      showSnackbar('Alt text zapisany', 'success');
    } catch (error) {
      console.error('Error saving alt:', error);
      showSnackbar('Błąd zapisu alt', 'error');
    } finally {
      setEditingAltId(null);
      setAltValue('');
    }
  };

  return (
    <section className="border-b border-[#d3bb73]/10 px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          Realizacje {prep} {capitalize(cityCases.locative)}
        </h2>
        <p className="mx-auto mb-12 max-w-2xl text-center text-[#e5e4e2]/60">
          Wybrane projekty techniki scenicznej zrealizowane przez nasz zespół
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img, idx) => (
            <div key={img.id} className="group relative overflow-hidden rounded-lg border border-[#d3bb73]/10 transition-all hover:border-[#d3bb73]/40">
              <button
                onClick={() => setLightboxIndex(idx)}
                className="relative aspect-video w-full overflow-hidden"
              >
                <Image
                  src={img.image_url}
                  alt={img.alt_text || `Technika sceniczna ${cityCases.locative}`}
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

              {canEdit && editingAltId !== img.id && (
                <button
                  onClick={() => handleAltEdit(img)}
                  className="absolute right-3 top-3 rounded-full bg-[#d3bb73]/80 p-2 opacity-0 backdrop-blur-sm transition-all hover:bg-[#d3bb73] group-hover:opacity-100"
                  title="Edytuj alt text"
                >
                  <Type className="h-4 w-4 text-[#1c1f33]" />
                </button>
              )}

              {canEdit && editingAltId === img.id ? (
                <div className="flex gap-2 border-t border-[#d3bb73]/10 bg-[#1c1f33] p-3">
                  <input
                    type="text"
                    value={altValue}
                    onChange={(e) => setAltValue(e.target.value)}
                    placeholder="Opisz zdjęcie (alt text SEO)"
                    className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAltSave();
                      if (e.key === 'Escape') { setEditingAltId(null); setAltValue(''); }
                    }}
                  />
                  <button
                    onClick={handleAltSave}
                    className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                  >
                    <Save className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => { setEditingAltId(null); setAltValue(''); }}
                    className="rounded-lg border border-[#d3bb73]/30 px-3 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : canEdit && img.alt_text ? (
                <div className="border-t border-[#d3bb73]/10 bg-[#1c1f33]/50 px-3 py-2">
                  <p className="truncate text-xs text-[#e5e4e2]/50">
                    <span className="text-[#d3bb73]/60">alt:</span> {img.alt_text}
                  </p>
                </div>
              ) : null}
            </div>
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
