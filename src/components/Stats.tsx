'use client';

import { useEffect, useRef, useState } from 'react';
import { Award, Users, Calendar, Star } from 'lucide-react';

interface StatItem {
  icon: typeof Award;
  value: number;
  suffix: string;
  label: string;
}

const stats: StatItem[] = [
  { icon: Calendar, value: 500, suffix: '+', label: 'Zrealizowanych Eventów' },
  { icon: Users, value: 150, suffix: '+', label: 'Zadowolonych Klientów' },
  { icon: Award, value: 15, suffix: '+', label: 'Lat Doświadczenia' },
  { icon: Star, value: 98, suffix: '%', label: 'Satysfakcja Klientów' },
];

function AnimatedCounter({
  end,
  duration = 2000,
  suffix,
}: {
  end: number;
  duration?: number;
  suffix: string;
}) {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);
  const [isVisible, setIsVisible] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isVisible) {
          setIsVisible(true);
        }
      },
      { threshold: 0.3 },
    );

    if (elementRef.current) {
      observer.observe(elementRef.current);
    }

    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;

    const startTime = Date.now();
    const endTime = startTime + duration;

    const updateCount = () => {
      const now = Date.now();
      const progress = Math.min((now - startTime) / duration, 1);
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const current = Math.floor(easeOutQuart * end);

      countRef.current = current;
      setCount(current);

      if (now < endTime) {
        requestAnimationFrame(updateCount);
      } else {
        setCount(end);
      }
    };

    requestAnimationFrame(updateCount);
  }, [end, duration, isVisible]);

  return (
    <div ref={elementRef} className="mb-3 text-5xl font-light text-[#d3bb73] md:text-6xl">
      {count}
      {suffix}
    </div>
  );
}

export default function Stats() {
  return (
    <section className="relative overflow-hidden bg-[#1c1f33] py-24 md:py-32">
      <div className="absolute inset-0 opacity-10">
        <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
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
        <div className="absolute left-1/4 top-0 h-96 w-96 rounded-full bg-[#d3bb73] blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-[#800020] blur-3xl"></div>
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 text-center md:mb-20">
          <div className="inline-block">
            <span className="mb-4 block text-sm font-light uppercase tracking-widest text-[#d3bb73] md:text-base">
              Nasze Osiągnięcia
            </span>
            <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] sm:text-4xl md:text-5xl">
              Liczby, które mówią same za siebie
            </h2>
            <div className="mx-auto h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 md:gap-12 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className="group relative"
              style={{
                animation: `fadeInUp 0.6s ease-out ${index * 0.1}s both`,
              }}
            >
              <div className="rounded-2xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#1c1f33] to-[#800020]/10 p-8 text-center backdrop-blur-sm transition-all duration-500 hover:-translate-y-2 hover:border-[#d3bb73]/50 hover:shadow-2xl hover:shadow-[#d3bb73]/20">
                <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]/10 transition-all duration-300 group-hover:scale-110 group-hover:bg-[#d3bb73]/20">
                  <stat.icon className="h-8 w-8 text-[#d3bb73] transition-transform duration-300 group-hover:rotate-12" />
                </div>

                <AnimatedCounter end={stat.value} suffix={stat.suffix} />

                <p className="text-sm font-light leading-relaxed text-[#e5e4e2]/80 md:text-base">
                  {stat.label}
                </p>
              </div>

              <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-[#d3bb73]/0 to-[#d3bb73]/5 opacity-0 transition-opacity duration-500 group-hover:opacity-100"></div>
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
