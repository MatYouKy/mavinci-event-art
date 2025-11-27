'use client';

import { useEffect, useRef, useState } from 'react';
import { Award, Users, Calendar, Star } from 'lucide-react';
import { AnimatedCounter } from './UI/AnimatedCounter';

interface StatItem {
  icon: typeof Award;
  value: number;
  suffix: string;
  label: string;
}

export const stats: StatItem[] = [
  { icon: Calendar, value: 3700, suffix: '+', label: 'Zrealizowanych Eventów' },
  { icon: Award, value: 15, suffix: '+', label: 'Lat Doświadczenia' },
  { icon: Star, value: 101, suffix: '%', label: 'Zaangażowanie' },
];


export default function Stats() {
  return (
    <section className="relative py-24 md:py-32 bg-[#1c1f33] overflow-hidden">
      <div className="absolute inset-0 opacity-10">
        <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1" fill="#d3bb73" />
            </pattern>
            <pattern id="lines" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
              <path d="M0 40 L80 40" stroke="#800020" strokeWidth="0.5" opacity="0.3" />
              <path d="M40 0 L40 80" stroke="#800020" strokeWidth="0.5" opacity="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
          <rect width="100%" height="100%" fill="url(#lines)" />
        </svg>
      </div>
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#d3bb73] rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[#800020] rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16 md:mb-20">
          <div className="inline-block">
            <span className="text-[#d3bb73] text-sm md:text-base font-light tracking-widest uppercase mb-4 block">
              Nasze Osiągnięcia
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-light text-[#e5e4e2] mb-6">
              Liczby, które mówią same za siebie
            </h2>
            <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 md:gap-12">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className="group relative"
              style={{
                animation: `fadeInUp 0.6s ease-out ${index * 0.1}s both`,
              }}
            >
              <div className="text-center p-8 rounded-2xl bg-gradient-to-br from-[#1c1f33] to-[#800020]/10 border border-[#d3bb73]/20 backdrop-blur-sm transition-all duration-500 hover:border-[#d3bb73]/50 hover:shadow-2xl hover:shadow-[#d3bb73]/20 hover:-translate-y-2">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#d3bb73]/10 mb-6 group-hover:bg-[#d3bb73]/20 transition-all duration-300 group-hover:scale-110">
                  <stat.icon className="w-8 h-8 text-[#d3bb73] group-hover:rotate-12 transition-transform duration-300" />
                </div>

                <AnimatedCounter end={stat.value} suffix={stat.suffix} />

                <p className="text-[#e5e4e2]/80 text-sm md:text-base font-light leading-relaxed">
                  {stat.label}
                </p>
              </div>

              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#d3bb73]/0 to-[#d3bb73]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </section>
  );
}
