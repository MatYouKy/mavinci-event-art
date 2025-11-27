'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface GalleryImage {
  src: string;
  title: string;
  description: string;
}

interface IntegrationsGalleryProps {
  title?: string;
  subtitle?: string;
  images?: GalleryImage[];
}

const defaultImages: GalleryImage[] = [
  {
    src: 'https://images.unsplash.com/photo-1543269664-76bc3997d9ea?auto=format&fit=crop&w=1200&q=80',
    title: 'Gra terenowa fabularna',
    description: 'Team building w plenerze z zadaniami i zagadkami',
  },
  {
    src: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80',
    title: 'Integracja outdoor',
    description: 'Wyzwania zespołowe na świeżym powietrzu',
  },
  {
    src: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80',
    title: 'Zadania integracyjne',
    description: 'Budowanie zespołu przez wspólne działanie',
  },
  {
    src: 'https://images.unsplash.com/photo-1531379410502-63bfe8cdaf9d?auto=format&fit=crop&w=1200&q=80',
    title: 'Wieczór firmowy',
    description: 'Impreza integracyjna z animacją',
  },
  {
    src: 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&w=1200&q=80',
    title: 'Duża integracja',
    description: 'Event dla grupy 100+ osób',
  },
  {
    src: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80',
    title: 'Warsztaty kreatywne',
    description: 'Integracja indoor z zadaniami zespołowymi',
  },
  {
    src: 'https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?auto=format&fit=crop&w=1200&q=80',
    title: 'Escape room mobilny',
    description: 'Logiczne wyzwania dla zespołu',
  },
  {
    src: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=1200&q=80',
    title: 'Animatorzy firmowi',
    description: 'Profesjonalna koordynacja eventu',
  },
];

export default function IntegrationsGallery({
  title = 'Nasze realizacje',
  subtitle = 'Zobacz jak wyglądają nasze integracje firmowe',
  images = defaultImages,
}: IntegrationsGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const openLightbox = (index: number) => {
    setCurrentImageIndex(index);
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
  };

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  return (
    <>
      <section className="bg-[#0f1119] px-6 py-24">
        <div className="mx-auto max-w-7xl">
          {/* Header */}
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-4xl font-light text-[#e5e4e2] md:text-5xl">
              {title}
            </h2>
            <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
            <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
              {subtitle}
            </p>
          </div>

          {/* Gallery Grid */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {images.map((image, index) => (
              <div
                key={index}
                onClick={() => openLightbox(index)}
                className="group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-xl bg-[#1c1f33] transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-[#d3bb73]/10"
              >
                {/* Image */}
                <img
                  src={image.src}
                  alt={image.title}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />

                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-[#0f1119]/60 to-transparent opacity-70 transition-opacity group-hover:opacity-85" />

                {/* Content */}
                <div className="absolute inset-x-0 bottom-0 p-5">
                  <h3 className="mb-1 text-base font-light text-[#e5e4e2]">
                    {image.title}
                  </h3>
                  <p className="text-sm font-light text-[#e5e4e2]/70">
                    {image.description}
                  </p>
                </div>

                {/* Hover Border */}
                <div className="absolute inset-0 rounded-xl border-2 border-[#d3bb73] opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
          onClick={closeLightbox}
        >
          {/* Close Button */}
          <button
            onClick={closeLightbox}
            className="absolute right-4 top-4 rounded-full bg-[#d3bb73]/10 p-2 text-[#e5e4e2] backdrop-blur-sm transition-colors hover:bg-[#d3bb73]/20"
          >
            <X className="h-6 w-6" />
          </button>

          {/* Previous Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              prevImage();
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-[#d3bb73]/10 p-3 text-[#e5e4e2] backdrop-blur-sm transition-colors hover:bg-[#d3bb73]/20"
          >
            <ChevronLeft className="h-8 w-8" />
          </button>

          {/* Next Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              nextImage();
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-[#d3bb73]/10 p-3 text-[#e5e4e2] backdrop-blur-sm transition-colors hover:bg-[#d3bb73]/20"
          >
            <ChevronRight className="h-8 w-8" />
          </button>

          {/* Image */}
          <div
            className="relative max-h-[90vh] max-w-6xl"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={images[currentImageIndex].src}
              alt={images[currentImageIndex].title}
              className="max-h-[90vh] w-full rounded-lg object-contain"
            />

            {/* Caption */}
            <div className="mt-4 text-center">
              <h3 className="mb-1 text-xl font-light text-[#e5e4e2]">
                {images[currentImageIndex].title}
              </h3>
              <p className="text-[#e5e4e2]/70">
                {images[currentImageIndex].description}
              </p>
              <p className="mt-2 text-sm text-[#e5e4e2]/50">
                {currentImageIndex + 1} / {images.length}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
