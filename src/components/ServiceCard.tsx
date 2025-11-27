'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import * as Icons from 'lucide-react';

interface ServiceCardProps {
  slug: string;
  title: string;
  description: string;
  iconName: string;
  colorFrom: string;
  colorTo: string;
  borderColor: string;
  heroImageUrl?: string;
  heroOpacity?: number;
  imageMetadata?: {
    desktop?: { posX?: number; posY?: number; scale?: number };
    mobile?: { posX?: number; posY?: number; scale?: number };
  };
  index: number;
}

export function ServiceCard({
  slug,
  title,
  description,
  iconName,
  colorFrom,
  colorTo,
  borderColor,
  heroImageUrl,
  heroOpacity = 1,
  imageMetadata,
  index,
}: ServiceCardProps) {
  const IconComponent = (Icons as any)[iconName] || Icons.Settings;

  const desktopPos = imageMetadata?.desktop || {};
  const posX = desktopPos.posX || 0;
  const posY = desktopPos.posY || 0;
  const scale = desktopPos.scale || 1;

  return (
    <Link
      href={`/oferta/${slug}`}
      className="group relative bg-[#1c1f33]/50 backdrop-blur-sm border border-[#d3bb73]/20 rounded-2xl overflow-hidden hover:border-[#d3bb73]/50 transition-all duration-500 hover:scale-[1.02] hover:shadow-2xl hover:shadow-[#d3bb73]/10 flex flex-col"
      style={{
        animationDelay: `${index * 0.1}s`,
        animation: 'fadeInUp 0.6s ease-out forwards',
        opacity: 0,
      }}
    >
      {heroImageUrl && (
        <div className="relative h-48 overflow-hidden">
          <div
            className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-110"
            style={{
              backgroundImage: `url(${heroImageUrl})`,
              opacity: heroOpacity,
              transform: `translate(${posX}%, ${posY}%) scale(${scale})`,
              transformOrigin: 'center center',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#1c1f33]/40 via-[#1c1f33]/60 to-[#1c1f33]" />

          <div className="absolute top-4 left-4">
            <div
              className={`inline-flex p-3 rounded-xl bg-gradient-to-br from-${colorFrom} to-${colorTo} border ${borderColor} backdrop-blur-sm group-hover:scale-110 transition-transform duration-500`}
            >
              <IconComponent className="w-6 h-6 text-[#e5e4e2]" />
            </div>
          </div>
        </div>
      )}

      <div className="relative flex-1 p-8">
        <div
          className={`absolute inset-0 bg-gradient-to-br from-${colorFrom} to-${colorTo} opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
        />

        <div className="relative z-10 flex flex-col h-full">
          <h3 className="text-2xl font-light text-[#e5e4e2] mb-3 group-hover:text-[#d3bb73] transition-colors duration-300">
            {title}
          </h3>

          <p className="text-[#e5e4e2]/70 text-sm mb-6 leading-relaxed flex-1">
            {description}
          </p>

          <div className="flex items-center gap-2 text-[#d3bb73] text-sm font-medium">
            <span>Zobacz szczegóły</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-2 transition-transform duration-300" />
          </div>
        </div>

        <div className="absolute top-0 right-0 w-32 h-32 bg-[#d3bb73]/5 rounded-full blur-3xl group-hover:bg-[#d3bb73]/10 transition-all duration-500 pointer-events-none" />
      </div>
    </Link>
  );
}
