'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type ResponsiveConfig = {
  desktop: number; // >= 1024px
  tablet: number; // 640–1023px
  mobile: number; // < 640px
};

interface ResponsiveCarouselProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  responsive?: ResponsiveConfig;
  autoPlay?: boolean;
  autoPlayDelay?: number; // ms
  className?: string;
  showArrows?: boolean;
}

export function ResponsiveCarousel<T>({
  items,
  renderItem,
  responsive = {
    desktop: 3,
    tablet: 2,
    mobile: 1,
  },
  autoPlay = true,
  autoPlayDelay = 4000,
  className = '',
  showArrows = true,
}: ResponsiveCarouselProps<T>) {
  const [itemsPerView, setItemsPerView] = useState(1);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // responsywna liczba itemów
  useEffect(() => {
    const updateItemsPerView = () => {
      if (typeof window === 'undefined') return;

      const width = window.innerWidth;
      if (width >= 1024) {
        setItemsPerView(responsive.desktop);
      } else if (width >= 640) {
        setItemsPerView(responsive.tablet);
      } else {
        setItemsPerView(responsive.mobile);
      }
    };

    updateItemsPerView();
    window.addEventListener('resize', updateItemsPerView);
    return () => window.removeEventListener('resize', updateItemsPerView);
  }, [responsive.desktop, responsive.tablet, responsive.mobile]);

  // extended lista do infinite loop
  const extendedItems = useMemo(
    () => (items.length > 0 ? [...items, ...items, ...items] : []),
    [items],
  );

  // start w środkowym bloku
  useEffect(() => {
    if (items.length > 0) {
      setCarouselIndex(items.length);
    }
  }, [items.length]);

  // autoplay z resetem przy każdej zmianie indexu
  useEffect(() => {
    if (!autoPlay || items.length === 0) return;

    const timeout = setTimeout(() => {
      setIsTransitioning(true);
      setCarouselIndex((prev) => prev + 1);
    }, autoPlayDelay);

    return () => clearTimeout(timeout);
  }, [autoPlay, autoPlayDelay, items.length, carouselIndex]);

  const handlePrev = () => {
    if (isTransitioning || items.length === 0) return;
    setIsTransitioning(true);
    setCarouselIndex((prev) => prev - 1);
  };

  const handleNext = () => {
    if (isTransitioning || items.length === 0) return;
    setIsTransitioning(true);
    setCarouselIndex((prev) => prev + 1);
  };

  // domykanie pętli po animacji
  const handleTransitionEnd = () => {
    setIsTransitioning(false);
    if (items.length === 0) return;

    if (carouselIndex <= 0) {
      setCarouselIndex(items.length); // środkowy blok
    } else if (carouselIndex >= items.length * 2) {
      setCarouselIndex(items.length);
    }
  };

  if (!items.length) return null;

  // ile „widoków” mamy (w zależności od itemsPerView)
  const totalViews = Math.max(1, Math.ceil(items.length / itemsPerView));

  // który widok jest aktualnie (liczymy po oryginalnej tablicy)
  const baseIndex = carouselIndex % items.length;
  const normalizedBaseIndex = baseIndex < 0 ? baseIndex + items.length : baseIndex;
  const activeView = Math.floor(normalizedBaseIndex / itemsPerView);

  // transform w %
  const translatePercent = (carouselIndex * 100) / itemsPerView;

  const handleDotClick = (viewIndex: number) => {
    if (items.length === 0) return;
    const targetBaseIndex = viewIndex * itemsPerView; // index w oryginalnej tablicy
    const targetCarouselIndex = items.length + targetBaseIndex; // środkowy blok
    setIsTransitioning(true);
    setCarouselIndex(targetCarouselIndex);
  };

  return (
    <div className={`relative ${className}`}>
      {/* Strzałki */}
      {showArrows && items.length > itemsPerView && (
        <>
          <button
            onClick={handlePrev}
            className="absolute left-0 top-1/2 z-10 -translate-x-4 -translate-y-1/2 rounded-full bg-[#d3bb73] p-3 text-[#1c1f33] shadow-lg transition-all hover:bg-[#d3bb73]/90"
            aria-label="Poprzednie"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={handleNext}
            className="absolute right-0 top-1/2 z-10 -translate-y-1/2 translate-x-4 rounded-full bg-[#d3bb73] p-3 text-[#1c1f33] shadow-lg transition-all hover:bg-[#d3bb73]/90"
            aria-label="Następne"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {/* Tor karuzeli */}
      <div className="overflow-hidden">
        <div
          className={`flex ${isTransitioning ? 'transition-transform duration-700 ease-in-out' : ''}`}
          style={{
            transform: `translateX(-${translatePercent}%)`,
          }}
          onTransitionEnd={handleTransitionEnd}
        >
          {extendedItems.map((item, idx) => (
            <div
              key={idx}
              className="flex-shrink-0 px-4"
              style={{ width: `${100 / itemsPerView}%` }}
            >
              {renderItem(item, idx)}
            </div>
          ))}
        </div>
      </div>

      {items.length > 1 && (
        <div className="mt-8 flex justify-center gap-2">
          {items.map((_, idx) => (
            <button
              key={idx}
              onClick={() => handleDotClick(idx)}
              className={`h-2 w-2 rounded-full transition-all ${
                carouselIndex % items.length === idx
                  ? 'w-8 bg-[#d3bb73]'
                  : 'bg-[#d3bb73]/30 hover:bg-[#d3bb73]/50'
              }`}
              aria-label={`Go to service ${idx + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
