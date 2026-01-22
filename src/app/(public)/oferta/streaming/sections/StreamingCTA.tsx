'use client';

import { Mail, Phone, ArrowRight } from 'lucide-react';

interface StreamingCTAProps {
  title?: string;
  subtitle?: string;
  ctaText?: string;
  secondaryText?: string;
  onCTAClick?: () => void;
}

export default function StreamingCTA({
  title = 'Zrealizuj profesjonalny streaming',
  subtitle = 'Skontaktuj się z nami już dziś i omów szczegóły swojej transmisji. Zapewniamy kompleksową obsługę techniczną i doradztwo na każdym etapie realizacji.',
  ctaText = 'Skontaktuj się z nami',
  secondaryText = 'lub zadzwoń: +48 123 456 789',
  onCTAClick,
}: StreamingCTAProps) {
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
    <section className="relative overflow-hidden bg-gradient-to-br from-[#800020] via-[#1c1f33] to-[#0f1119] px-6 py-24">
      {/* Decorative Elements */}
      <div className="absolute left-0 top-0 h-96 w-96 rounded-full bg-[#d3bb73]/5 blur-3xl" />
      <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-[#800020]/10 blur-3xl" />

      <div className="relative z-10 mx-auto max-w-4xl text-center">
        {/* Icon */}
        <div className="mb-8 inline-flex items-center justify-center rounded-full bg-[#d3bb73]/10 p-6 backdrop-blur-sm ring-1 ring-[#d3bb73]/20">
          <Mail className="h-10 w-10 text-[#d3bb73]" />
        </div>

        {/* Title */}
        <h2 className="mb-6 text-4xl font-light text-[#e5e4e2] md:text-5xl lg:text-6xl">
          {title}
        </h2>

        {/* Divider */}
        <div className="mx-auto mb-8 h-1 w-32 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />

        {/* Subtitle */}
        <p className="mb-12 text-lg font-light leading-relaxed text-[#e5e4e2]/80 md:text-xl">
          {subtitle}
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
          {/* Primary CTA */}
          <button
            onClick={handleCTAClick}
            className="group inline-flex items-center gap-3 rounded-full bg-gradient-to-r from-[#d3bb73] to-[#c5a960] px-8 py-4 text-lg font-medium text-[#1c1f33] transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-[#d3bb73]/30"
          >
            {ctaText}
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </button>

          {/* Secondary Info */}
          <div className="flex items-center gap-2 text-[#e5e4e2]/70">
            <Phone className="h-5 w-5 text-[#d3bb73]" />
            <span className="text-sm font-light">{secondaryText}</span>
          </div>
        </div>

        {/* Features Pills */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
          {[
            'Bezpłatna konsultacja',
            'Wycena w 24h',
            'Doświadczony zespół',
            'Sprzęt na miejscu',
          ].map((feature) => (
            <span
              key={feature}
              className="rounded-full border border-[#d3bb73]/30 bg-[#0f1119]/30 px-4 py-2 text-sm font-light text-[#e5e4e2]/70 backdrop-blur-sm"
            >
              {feature}
            </span>
          ))}
        </div>

        {/* Bottom Note */}
        <div className="mt-12 text-center">
          <p className="text-sm font-light text-[#e5e4e2]/50">
            Obsługujemy wydarzenia w całej Polsce • Doświadczenie od 2010 roku
          </p>
        </div>
      </div>
    </section>
  );
}
