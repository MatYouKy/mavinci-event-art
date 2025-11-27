'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface GalleryImage {
  src: string;
  title: string;
  description: string;
}

interface StreamingGalleryProps {
  title?: string;
  subtitle?: string;
  images?: GalleryImage[];
}

const defaultImages: GalleryImage[] = [
  {
    src: 'https://images.pexels.com/photos/66134/pexels-photo-66134.jpeg?auto=compress&cs=tinysrgb&w=800',
    title: 'Realizacja wielokamerowa',
    description: 'Operator przy profesjonalnej kamerze 4K',
  },
  {
    src: 'https://images.pexels.com/photos/257904/pexels-photo-257904.jpeg?auto=compress&cs=tinysrgb&w=800',
    title: 'Widok realizatora',
    description: 'Mikser wideo i monitory reżyserskie',
  },
  {
    src: 'https://images.pexels.com/photos/2608517/pexels-photo-2608517.jpeg?auto=compress&cs=tinysrgb&w=800',
    title: 'Transmisja konferencji',
    description: 'Prelegent i prezentacja na ekranie',
  },
  {
    src: 'https://images.pexels.com/photos/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=800',
    title: 'Panel dyskusyjny online',
    description: 'Streaming rozmowy z gośćmi',
  },
  {
    src: 'https://images.pexels.com/photos/3184338/pexels-photo-3184338.jpeg?auto=compress&cs=tinysrgb&w=800',
    title: 'Streaming hybrydowy',
    description: 'Połączenie wydarzenia stacjonarnego z transmisją',
  },
  {
    src: 'https://images.pexels.com/photos/1181354/pexels-photo-1181354.jpeg?auto=compress&cs=tinysrgb&w=800',
    title: 'Blackmagic Web Presenter',
    description: 'Sprzęt streamingowy w profesjonalnym racku',
  },
];

export default function StreamingGallery({
  title = 'Nasze realizacje',
  subtitle = 'Zobacz jak wygląda profesjonalny streaming w praktyce',
  images = defaultImages,
}: StreamingGalleryProps) {
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
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((image, index) => (
              <div
                key={index}
                onClick={() => openLightbox(index)}
                className="group relative aspect-video cursor-pointer overflow-hidden rounded-xl bg-[#1c1f33] transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-[#d3bb73]/10"
              >
                {/* Image */}
                <img
                  src={image.src}
                  alt={image.title}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />

                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-[#0f1119]/50 to-transparent opacity-60 transition-opacity group-hover:opacity-80" />

                {/* Content */}
                <div className="absolute inset-x-0 bottom-0 p-6">
                  <h3 className="mb-1 text-lg font-light text-[#e5e4e2]">
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
