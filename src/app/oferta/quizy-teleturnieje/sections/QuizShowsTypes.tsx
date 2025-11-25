'use client';

import { Zap, Brain, Tv, Star, Radio, Sparkles } from 'lucide-react';

interface QuizType {
  icon: React.ReactNode;
  title: string;
  level: string;
  description: string;
  features: string[];
}

interface QuizShowsTypesProps {
  title?: string;
  subtitle?: string;
  types?: QuizType[];
}

const defaultTypes: QuizType[] = [
  {
    icon: <Brain className="h-10 w-10" />,
    title: 'Klasyczne quizy wiedzy',
    level: 'Proste',
    description: 'Idealne na szybką integrację i pierwsze lodołamacze. Format 1 z 10 pytań, prostota i dynamika.',
    features: ['Pytania wielokrotnego wyboru', 'Szybka rozgrywka 15-30 min', 'Bez zaawansowanego sprzętu', 'Do 100 uczestników'],
  },
  {
    icon: <Zap className="h-10 w-10" />,
    title: 'Quizy z buzzerami',
    level: 'Średnio zaawansowane',
    description: 'Dynamiczne teleturnieje z systemem buzzerów – kto pierwszy naciśnie, ten odpowiada. Emocje i rywalizacja.',
    features: ['Profesjonalne buzzery', 'System wykrywania pierwszeństwa', 'Wyniki na żywo na ekranie', 'Tryb drużynowy lub indywidualny'],
  },
  {
    icon: <Radio className="h-10 w-10" />,
    title: 'Teleturnieje z pilotami',
    level: 'Zaawansowane',
    description: 'Każdy uczestnik otrzymuje bezprzewodowy pilot do głosowania. System zlicza odpowiedzi w czasie rzeczywistym.',
    features: ['Indywidualne piloty bezprzewodowe', 'Statystyki na żywo', 'Ranking uczestników', 'Do 500 osób jednocześnie'],
  },
  {
    icon: <Tv className="h-10 w-10" />,
    title: 'Multimedialne teleturnieje',
    level: 'Premium',
    description: 'Pełna produkcja z materiałami wideo, dźwiękiem, grafiką na ekranach LED. Format godny studia telewizyjnego.',
    features: ['Pytania wideo i audio', 'Profesjonalna scenografia', 'Konferansjer i realizator', 'Nagranie relacji wideo'],
  },
  {
    icon: <Star className="h-10 w-10" />,
    title: 'Teleturnieje tematyczne',
    level: 'Spersonalizowane',
    description: 'Scenariusz dopasowany do branży, historii firmy lub tematyki wydarzenia. Pytania szyte na miarę.',
    features: ['Pytania o firmę/branżę', 'Personalizowana grafika', 'Wideo i zdjęcia klienta', 'Unikalna scenografia'],
  },
  {
    icon: <Sparkles className="h-10 w-10" />,
    title: 'Teleturnieje dla VIP',
    level: 'Ekskluzywne',
    description: 'Najwyższa jakość realizacji na gale, jubileusze, uroczystości premium. Pełna obsługa produkcyjna.',
    features: ['Dedykowany scenariusz', 'Operator kamery i realizator', 'Nagrody luksusowe', 'Transmisja live opcjonalnie'],
  },
];

export default function QuizShowsTypes({
  title = 'Formaty teleturniejów',
  subtitle = 'Od prostych quizów po multimedialne widowiska',
  types = defaultTypes,
}: QuizShowsTypesProps) {
  return (
    <section className="bg-[#0f1119] px-6 py-24">
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

        {/* Types Grid */}
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {types.map((type, index) => (
            <div
              key={index}
              className="group relative overflow-hidden rounded-2xl border border-[#d3bb73]/10 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm transition-all duration-300 hover:border-[#d3bb73]/30 hover:shadow-xl hover:shadow-[#d3bb73]/5"
            >
              {/* Hover Gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

              {/* Content */}
              <div className="relative z-10 p-8">
                {/* Icon */}
                <div className="mb-6 inline-flex items-center justify-center rounded-xl bg-[#d3bb73]/10 p-4 text-[#d3bb73] ring-1 ring-[#d3bb73]/20 transition-transform duration-300 group-hover:scale-110">
                  {type.icon}
                </div>

                {/* Level Badge */}
                <div className="mb-4 inline-block rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/5 px-3 py-1 text-xs font-light text-[#d3bb73]">
                  {type.level}
                </div>

                {/* Title */}
                <h3 className="mb-3 text-2xl font-light text-[#e5e4e2]">
                  {type.title}
                </h3>

                {/* Description */}
                <p className="mb-6 font-light leading-relaxed text-[#e5e4e2]/70">
                  {type.description}
                </p>

                {/* Features */}
                <ul className="space-y-2">
                  {type.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm font-light text-[#e5e4e2]/60">
                      <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#d3bb73]" />
                      {feature}
                    </li>
                  ))}
                </ul>
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
