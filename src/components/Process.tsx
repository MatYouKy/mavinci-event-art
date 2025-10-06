'use client';

import { useEffect, useRef, useState } from 'react';
import { Lightbulb, FileText, Users, Settings, Sparkles, CheckCircle } from 'lucide-react';

interface ProcessStep {
  id: number;
  icon: typeof Lightbulb;
  title: string;
  description: string;
}

const steps: ProcessStep[] = [
  {
    id: 1,
    icon: Lightbulb,
    title: 'Konsultacja i Wizja',
    description: 'Poznajemy Twoje potrzeby, cele i oczekiwania. Wspólnie tworzymy wizję idealnego eventu.',
  },
  {
    id: 2,
    icon: FileText,
    title: 'Koncepcja i Planowanie',
    description: 'Opracowujemy szczegółową koncepcję, budżet oraz harmonogram realizacji projektu.',
  },
  {
    id: 3,
    icon: Users,
    title: 'Koordynacja Zespołu',
    description: 'Dobieramy najlepszych specjalistów i koordynujemy wszystkie aspekty przygotowań.',
  },
  {
    id: 4,
    icon: Settings,
    title: 'Realizacja Techniczna',
    description: 'Zajmujemy się wszystkimi detalami technicznymi, logistycznymi i produkcyjnymi.',
  },
  {
    id: 5,
    icon: Sparkles,
    title: 'Dzień Eventu',
    description: 'Zapewniamy sprawną realizację i pełne wsparcie podczas całego wydarzenia.',
  },
  {
    id: 6,
    icon: CheckCircle,
    title: 'Podsumowanie',
    description: 'Analizujemy efekty, zbieramy feedback i dostarczamy kompleksowy raport.',
  },
];

export default function Process() {
  const [visibleSteps, setVisibleSteps] = useState<number[]>([]);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observers = stepRefs.current.map((ref, index) => {
      if (!ref) return null;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setVisibleSteps((prev) => {
              if (!prev.includes(index)) {
                return [...prev, index];
              }
              return prev;
            });
          }
        },
        { threshold: 0.2 }
      );

      observer.observe(ref);
      return observer;
    });

    return () => {
      observers.forEach((observer) => observer?.disconnect());
    };
  }, []);

  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: 'url(https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1920)',
        }}
      >
        <div className="absolute inset-0 bg-[#1c1f33]/95 backdrop-blur-md"></div>
      </div>

      <div className="absolute inset-0 opacity-5">
        <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="circles" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
              <circle cx="40" cy="40" r="2" fill="#d3bb73" opacity="0.4" />
              <circle cx="40" cy="40" r="15" stroke="#d3bb73" strokeWidth="0.5" fill="none" opacity="0.2" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#circles)" />
        </svg>
      </div>
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 left-1/3 w-96 h-96 bg-[#d3bb73] rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-0 right-1/3 w-96 h-96 bg-[#800020] rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16 md:mb-20">
          <div className="inline-block">
            <span className="text-[#d3bb73] text-sm md:text-base font-light tracking-widest uppercase mb-4 block animate-[fadeIn_0.6s_ease-out]">
              Proces Współpracy
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-light text-[#e5e4e2] mb-6 animate-[fadeIn_0.8s_ease-out]">
              Krok po Kroku do Sukcesu
            </h2>
            <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto animate-[scaleIn_1s_ease-out]"></div>
          </div>
          <p className="text-[#e5e4e2]/70 text-base md:text-lg font-light mt-6 max-w-2xl mx-auto animate-[fadeIn_1.2s_ease-out]">
            Nasz sprawdzony proces gwarantuje sukces każdego projektu
          </p>
        </div>

        <div className="relative">
          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-gradient-to-b from-[#d3bb73]/0 via-[#d3bb73]/50 to-[#d3bb73]/0 hidden lg:block"></div>

          <div className="space-y-16 md:space-y-24">
            {steps.map((step, index) => (
              <div
                key={step.id}
                ref={(el) => (stepRefs.current[index] = el)}
                className={`relative transition-all duration-1000 ${
                  visibleSteps.includes(index)
                    ? 'opacity-100 translate-y-0'
                    : 'opacity-0 translate-y-12'
                }`}
              >
                <div
                  className={`flex flex-col lg:flex-row items-center gap-8 ${
                    index % 2 === 0 ? 'lg:flex-row' : 'lg:flex-row-reverse'
                  }`}
                >
                  <div className={`flex-1 ${index % 2 === 0 ? 'lg:text-right' : 'lg:text-left'}`}>
                    <div
                      className={`inline-block transition-all duration-700 delay-200 ${
                        visibleSteps.includes(index)
                          ? 'opacity-100 scale-100'
                          : 'opacity-0 scale-95'
                      }`}
                    >
                      <div className="bg-gradient-to-br from-[#1c1f33] to-[#800020]/20 border border-[#d3bb73]/20 rounded-2xl p-8 backdrop-blur-sm hover:border-[#d3bb73]/50 transition-all duration-500 hover:shadow-2xl hover:shadow-[#d3bb73]/20 group">
                        <div className={`flex items-start gap-4 ${index % 2 === 0 ? 'lg:flex-row-reverse' : 'lg:flex-row'}`}>
                          <div className="flex-shrink-0">
                            <div className="w-16 h-16 rounded-full bg-[#d3bb73]/10 flex items-center justify-center group-hover:bg-[#d3bb73]/20 transition-all duration-300 group-hover:scale-110 group-hover:rotate-12">
                              <step.icon className="w-8 h-8 text-[#d3bb73]" />
                            </div>
                          </div>
                          <div className="flex-1">
                            <h3 className="text-2xl md:text-3xl font-light text-[#e5e4e2] mb-3 group-hover:text-[#d3bb73] transition-colors duration-300">
                              {step.title}
                            </h3>
                            <p className="text-[#e5e4e2]/70 text-base font-light leading-relaxed">
                              {step.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative flex-shrink-0 z-10">
                    <div
                      className={`w-16 h-16 rounded-full bg-gradient-to-br from-[#d3bb73] to-[#d3bb73]/60 flex items-center justify-center text-[#1c1f33] text-xl font-light border-4 border-[#1c1f33] shadow-lg shadow-[#d3bb73]/30 transition-all duration-700 ${
                        visibleSteps.includes(index)
                          ? 'scale-100 rotate-0'
                          : 'scale-0 rotate-180'
                      }`}
                    >
                      {step.id}
                    </div>
                  </div>

                  <div className="flex-1 hidden lg:block"></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center mt-20 animate-[fadeIn_1.4s_ease-out]">
          <button className="group inline-flex items-center gap-3 px-8 py-4 bg-[#d3bb73] text-[#1c1f33] rounded-full font-medium hover:bg-[#d3bb73]/90 transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-[#d3bb73]/40">
            Rozpocznij Współpracę
            <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes scaleIn {
          from {
            transform: scaleX(0);
          }
          to {
            transform: scaleX(1);
          }
        }
      `}</style>
    </section>
  );
}
