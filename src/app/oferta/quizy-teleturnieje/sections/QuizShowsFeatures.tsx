'use client';

import { Monitor, Mic2, Trophy, Users, Video, Palette } from 'lucide-react';

interface Feature {
  icon: React.ReactNode;
  title: string;
  description: string;
}

interface QuizShowsFeaturesProps {
  title?: string;
  subtitle?: string;
  features?: Feature[];
}

const defaultFeatures: Feature[] = [
  {
    icon: <Monitor className="h-8 w-8" />,
    title: 'Ekrany LED i projekcje',
    description: 'Wyświetlamy pytania, wyniki i statystyki na profesjonalnych ekranach lub projektorach',
  },
  {
    icon: <Mic2 className="h-8 w-8" />,
    title: 'Konferansjer i prowadzący',
    description: 'Doświadczony konferansjer prowadzi teleturniej z energią i profesjonalizmem',
  },
  {
    icon: <Trophy className="h-8 w-8" />,
    title: 'Nagrody dla zwycięzców',
    description: 'Puchary, dyplomy, nagrody rzeczowe – dostosowane do budżetu wydarzenia',
  },
  {
    icon: <Users className="h-8 w-8" />,
    title: 'Tryb indywidualny lub drużynowy',
    description: 'Elastyczny format – każdy gra solo lub tworzymy drużyny konkurujące ze sobą',
  },
  {
    icon: <Video className="h-8 w-8" />,
    title: 'Materiały multimedialne',
    description: 'Pytania wideo, fragmenty filmów, nagrania audio – pełna gama formatów',
  },
  {
    icon: <Palette className="h-8 w-8" />,
    title: 'Personalizacja graficzna',
    description: 'Logo firmy, branding, kolory korporacyjne – wszystko dopasowane wizualnie',
  },
];

export default function QuizShowsFeatures({
  title = 'Co zapewniamy?',
  subtitle = 'Kompleksowa obsługa produkcyjna i techniczna',
  features = defaultFeatures,
}: QuizShowsFeaturesProps) {
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

        {/* Features Grid */}
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => (
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
                  {feature.icon}
                </div>

                {/* Title */}
                <h3 className="mb-3 text-xl font-light text-[#e5e4e2]">
                  {feature.title}
                </h3>

                {/* Description */}
                <p className="font-light leading-relaxed text-[#e5e4e2]/60">
                  {feature.description}
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
