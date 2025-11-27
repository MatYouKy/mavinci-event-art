'use client';

import { Users, Sparkles } from 'lucide-react';

interface IntegrationsHeroProps {
  title?: string;
  subtitle?: string;
  description?: string;
  ctaText?: string;
  onCTAClick?: () => void;
  backgroundImage?: string;
}

export default function IntegrationsHero({
  title = 'Integracje Firmowe',
  subtitle = 'Team Building z charakterem',
  description = 'Profesjonalne integracje firmowe i eventy integracyjne dla zespołów 10-500+ osób. Gry terenowe, scenariusze fabularne, zadania zespołowe outdoor i indoor. Budowanie zespołu przez doświadczenie i wspólną przygodę.',
  ctaText = 'Zapytaj o integrację',
  onCTAClick,
  backgroundImage = 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&w=2000&q=80',
}: IntegrationsHeroProps) {
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
    <section className="relative min-h-[75vh] flex items-center justify-center overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img
          src={backgroundImage}
          alt="Integracje firmowe team building"
          className="h-full w-full object-cover"
        />
        {/* Dark Gradient Overlays */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0f1119]/95 via-[#1c1f33]/92 to-[#800020]/85" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-transparent to-transparent" />
      </div>

      {/* Content */}
      <div className="relative z-10 mx-auto max-w-7xl px-6 py-32 text-center">
        {/* Icon */}
        <div className="mb-8 inline-flex items-center justify-center rounded-full bg-[#d3bb73]/10 p-6 backdrop-blur-sm ring-1 ring-[#d3bb73]/30">
          <Users className="h-14 w-14 text-[#d3bb73]" />
        </div>

        {/* Subtitle */}
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/5 px-4 py-2 backdrop-blur-sm">
          <Sparkles className="h-4 w-4 text-[#d3bb73]" />
          <span className="text-sm font-light text-[#e5e4e2]/90">{subtitle}</span>
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
          className="group inline-flex items-center gap-3 rounded-full bg-gradient-to-r from-[#d3bb73] to-[#c5a960] px-8 py-4 text-lg font-medium text-[#1c1f33] transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-[#d3bb73]/30"
        >
          <Users className="h-5 w-5 transition-transform group-hover:scale-110" />
          {ctaText}
        </button>

        {/* Keywords Pills */}
        <div className="mt-14 flex flex-wrap items-center justify-center gap-3">
          {[
            'Gry terenowe',
            'Team building',
            'Integracja outdoor',
            'Integracja indoor',
            'Imprezy firmowe',
            'Animatorzy',
          ].map((keyword) => (
            <span
              key={keyword}
              className="rounded-full border border-[#d3bb73]/30 bg-[#0f1119]/50 px-4 py-2 text-sm font-light text-[#e5e4e2]/70 backdrop-blur-sm"
            >
              {keyword}
            </span>
          ))}
        </div>
      </div>

      {/* Bottom Gradient */}
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#0f1119] to-transparent" />
    </section>
  );
}
