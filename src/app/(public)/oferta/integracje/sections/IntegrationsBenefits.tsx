'use client';

import { Target, Heart, TrendingUp, Shield, Lightbulb, Award } from 'lucide-react';

interface Benefit {
  icon: React.ReactNode;
  title: string;
  description: string;
}

interface IntegrationsBenefitsProps {
  title?: string;
  subtitle?: string;
  benefits?: Benefit[];
}

const defaultBenefits: Benefit[] = [
  {
    icon: <Target className="h-8 w-8" />,
    title: 'Skuteczne budowanie zespołu',
    description: 'Zadania zespołowe wzmacniające współpracę i komunikację w grupie',
  },
  {
    icon: <Heart className="h-8 w-8" />,
    title: 'Atmosfera i zaangażowanie',
    description: 'Eventy integracyjne tworzące pozytywne relacje między pracownikami',
  },
  {
    icon: <TrendingUp className="h-8 w-8" />,
    title: 'Motywacja i energia',
    description: 'Imprezy firmowe podnoszące morale i chęć do wspólnego działania',
  },
  {
    icon: <Shield className="h-8 w-8" />,
    title: 'Bezpieczeństwo i profesjonalizm',
    description: 'Doświadczeni animatorzy firmowi zapewniający płynny przebieg',
  },
  {
    icon: <Lightbulb className="h-8 w-8" />,
    title: 'Kreatywne scenariusze',
    description: 'Autorskie scenariusze integracyjne dopasowane do charakteru firmy',
  },
  {
    icon: <Award className="h-8 w-8" />,
    title: 'Kompleksowa obsługa',
    description: 'Od koncepcji przez realizację po podsumowanie eventu',
  },
];

export default function IntegrationsBenefits({
  title = 'Dlaczego warto?',
  subtitle = 'Korzyści z profesjonalnych integracji firmowych',
  benefits = defaultBenefits,
}: IntegrationsBenefitsProps) {
  return (
    <section className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] px-6 py-24">
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

        {/* Benefits Grid */}
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {benefits.map((benefit, index) => (
            <div
              key={index}
              className="group relative overflow-hidden rounded-2xl border border-[#d3bb73]/10 bg-[#0f1119]/50 p-8 backdrop-blur-sm transition-all duration-300 hover:border-[#d3bb73]/30 hover:shadow-xl hover:shadow-[#d3bb73]/5"
            >
              {/* Hover Gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

              {/* Content */}
              <div className="relative z-10">
                {/* Icon */}
                <div className="mb-6 inline-flex items-center justify-center rounded-xl bg-[#d3bb73]/10 p-4 text-[#d3bb73] ring-1 ring-[#d3bb73]/20 transition-transform duration-300 group-hover:scale-110">
                  {benefit.icon}
                </div>

                {/* Title */}
                <h3 className="mb-3 text-xl font-light text-[#e5e4e2]">
                  {benefit.title}
                </h3>

                {/* Description */}
                <p className="font-light leading-relaxed text-[#e5e4e2]/60">
                  {benefit.description}
                </p>
              </div>

              {/* Bottom Accent */}
              <div className="absolute bottom-0 left-0 h-1 w-0 bg-gradient-to-r from-[#d3bb73] to-[#c5a960] transition-all duration-300 group-hover:w-full" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
