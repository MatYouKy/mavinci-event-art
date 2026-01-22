'use client';

import { MessageSquare, FileText, Users, Sparkles } from 'lucide-react';

interface ProcessStep {
  number: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}

interface IntegrationsProcessProps {
  title?: string;
  subtitle?: string;
  steps?: ProcessStep[];
}

const defaultSteps: ProcessStep[] = [
  {
    number: '01',
    icon: <MessageSquare className="h-8 w-8" />,
    title: 'Konsultacja i brief',
    description: 'Poznajemy Twój zespół, cele integracji i oczekiwania',
  },
  {
    number: '02',
    icon: <FileText className="h-8 w-8" />,
    title: 'Scenariusz integracyjny',
    description: 'Tworzymy autorski scenariusz dopasowany do grupy',
  },
  {
    number: '03',
    icon: <Users className="h-8 w-8" />,
    title: 'Realizacja z animatorami',
    description: 'Profesjonalni animatorzy firmowi prowadzą event',
  },
  {
    number: '04',
    icon: <Sparkles className="h-8 w-8" />,
    title: 'Podsumowanie i efekty',
    description: 'Zespół zintegrowany, zmotywowany i gotowy do działania',
  },
];

export default function IntegrationsProcess({
  title = 'Jak to działa?',
  subtitle = 'Proces organizacji integracji firmowej krok po kroku',
  steps = defaultSteps,
}: IntegrationsProcessProps) {
  return (
    <section className="bg-gradient-to-br from-[#0f1119] via-[#1c1f33] to-[#0f1119] px-6 py-24">
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

        {/* Process Steps */}
        <div className="relative">
          {/* Connection Line */}
          <div className="absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-gradient-to-b from-[#d3bb73]/0 via-[#d3bb73]/30 to-[#d3bb73]/0 lg:block" />

          <div className="space-y-12">
            {steps.map((step, index) => (
              <div
                key={index}
                className={`relative flex items-center gap-8 ${
                  index % 2 === 0 ? 'lg:flex-row' : 'lg:flex-row-reverse'
                }`}
              >
                {/* Content */}
                <div className="flex-1">
                  <div
                    className={`group relative overflow-hidden rounded-2xl border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-8 backdrop-blur-sm transition-all duration-300 hover:border-[#d3bb73]/30 hover:shadow-xl hover:shadow-[#d3bb73]/5 ${
                      index % 2 === 0 ? 'lg:text-right' : 'lg:text-left'
                    }`}
                  >
                    {/* Number */}
                    <div
                      className={`mb-4 inline-block rounded-full bg-[#d3bb73]/10 px-4 py-1 text-sm font-light text-[#d3bb73] ring-1 ring-[#d3bb73]/20`}
                    >
                      {step.number}
                    </div>

                    {/* Title */}
                    <h3 className="mb-3 text-2xl font-light text-[#e5e4e2]">
                      {step.title}
                    </h3>

                    {/* Description */}
                    <p className="font-light leading-relaxed text-[#e5e4e2]/70">
                      {step.description}
                    </p>

                    {/* Hover Gradient */}
                    <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  </div>
                </div>

                {/* Icon Circle */}
                <div className="relative z-10 hidden flex-shrink-0 lg:block">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#d3bb73] bg-[#0f1119] text-[#d3bb73] shadow-lg shadow-[#d3bb73]/20">
                    {step.icon}
                  </div>
                </div>

                {/* Spacer for alternating layout */}
                <div className="hidden flex-1 lg:block" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
