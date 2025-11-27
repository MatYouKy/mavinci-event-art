'use client';

import { Video, Play } from 'lucide-react';

interface StreamingHeroProps {
  title?: string;
  description?: string;
  ctaText?: string;
  onCTAClick?: () => void;
  backgroundImage?: string;
}

export default function StreamingHero({
  title = 'Profesjonalny Streaming Live',
  description = 'Profesjonalna transmisja online w jakości FullHD/4K. Wielokamerowa realizacja, oprawa graficzna, stabilne połączenie, pełne zaplecze techniczne. Streaming konferencji, gal, szkoleń i eventów.',
  ctaText = 'Zapytaj o wycenę',
  onCTAClick,
  backgroundImage = 'https://images.pexels.com/photos/2507007/pexels-photo-2507007.jpeg?auto=compress&cs=tinysrgb&w=2000',
}: StreamingHeroProps) {
  const handleCTAClick = () => {
    if (onCTAClick) {
      onCTAClick();
    } else {
      const contactSection = document.getElementById('kontakt');
      if (contactSection) {
        contactSection.scrollIntoView({ behavior: 'smooth' });
      } else {
        window.location.href = '/#kontakt';
      }
    }
  };

  return (
    <section className="relative min-h-[70vh] flex items-center justify-center overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img
          src={backgroundImage}
          alt="Streaming setup"
          className="h-full w-full object-cover"
        />
        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0f1119]/95 via-[#1c1f33]/90 to-[#800020]/80" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-transparent to-transparent" />
      </div>

      {/* Content */}
      <div className="relative z-10 mx-auto max-w-7xl px-6 py-24 text-center">
        {/* Icon */}
        <div className="mb-8 inline-flex items-center justify-center rounded-full bg-[#d3bb73]/10 p-6 backdrop-blur-sm ring-1 ring-[#d3bb73]/20">
          <Video className="h-12 w-12 text-[#d3bb73]" />
        </div>

        {/* Title */}
        <h1 className="mb-6 text-5xl font-light text-[#e5e4e2] md:text-6xl lg:text-7xl">
          {title}
        </h1>

        {/* Divider */}
        <div className="mx-auto mb-8 h-1 w-32 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />

        {/* Description */}
        <p className="mx-auto mb-12 max-w-3xl text-lg font-light leading-relaxed text-[#e5e4e2]/80 md:text-xl">
          {description}
        </p>

        {/* CTA Button */}
        <button
          onClick={handleCTAClick}
          className="group inline-flex items-center gap-3 rounded-full bg-gradient-to-r from-[#d3bb73] to-[#c5a960] px-8 py-4 text-lg font-medium text-[#1c1f33] transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-[#d3bb73]/20"
        >
          <Play className="h-5 w-5 transition-transform group-hover:scale-110" />
          {ctaText}
        </button>

        {/* Features Pills */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
          {['FullHD/4K', 'Wielokamerowy', 'Stabilny stream', 'Oprawa graficzna'].map((feature) => (
            <span
              key={feature}
              className="rounded-full border border-[#d3bb73]/30 bg-[#0f1119]/50 px-4 py-2 text-sm font-light text-[#e5e4e2]/70 backdrop-blur-sm"
            >
              {feature}
            </span>
          ))}
        </div>
      </div>

      {/* Bottom Gradient */}
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#0f1119] to-transparent" />
    </section>
  );
}
