'use client';

import { motion } from 'framer-motion';
import { Zap, Brain, Tv, Star, Radio, Sparkles, ArrowRight } from 'lucide-react';

interface QuizType {
  icon: React.ReactNode;
  title: string;
  level: string;
  description: string;
  features: string[];
  image: string;
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
    image: 'https://images.unsplash.com/photo-1543269664-76bc3997d9ea?auto=format&fit=crop&w=800&q=80',
  },
  {
    icon: <Zap className="h-10 w-10" />,
    title: 'Quizy z buzzerami',
    level: 'Średnio zaawansowane',
    description: 'Dynamiczne teleturnieje z systemem buzzerów – kto pierwszy naciśnie, ten odpowiada. Emocje i rywalizacja.',
    features: ['Profesjonalne buzzery', 'System wykrywania pierwszeństwa', 'Wyniki na żywo na ekranie', 'Tryb drużynowy lub indywidualny'],
    image: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=800&q=80',
  },
  {
    icon: <Radio className="h-10 w-10" />,
    title: 'Teleturnieje z pilotami',
    level: 'Zaawansowane',
    description: 'Każdy uczestnik otrzymuje bezprzewodowy pilot do głosowania. System zlicza odpowiedzi w czasie rzeczywistym.',
    features: ['Indywidualne piloty bezprzewodowe', 'Statystyki na żywo', 'Ranking uczestników', 'Do 500 osób jednocześnie'],
    image: 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=800&q=80',
  },
  {
    icon: <Tv className="h-10 w-10" />,
    title: 'Multimedialne teleturnieje',
    level: 'Premium',
    description: 'Pełna produkcja z materiałami wideo, dźwiękiem, grafiką na ekranach LED. Format godny studia telewizyjnego.',
    features: ['Pytania wideo i audio', 'Profesjonalna scenografia', 'Konferansjer i realizator', 'Nagranie relacji wideo'],
    image: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=800&q=80',
  },
  {
    icon: <Star className="h-10 w-10" />,
    title: 'Teleturnieje tematyczne',
    level: 'Spersonalizowane',
    description: 'Scenariusz dopasowany do branży, historii firmy lub tematyki wydarzenia. Pytania szyte na miarę.',
    features: ['Pytania o firmę/branżę', 'Personalizowana grafika', 'Wideo i zdjęcia klienta', 'Unikalna scenografia'],
    image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=800&q=80',
  },
  {
    icon: <Sparkles className="h-10 w-10" />,
    title: 'Teleturnieje dla VIP',
    level: 'Ekskluzywne',
    description: 'Najwyższa jakość realizacji na gale, jubileusze, uroczystości premium. Pełna obsługa produkcyjna.',
    features: ['Dedykowany scenariusz', 'Operator kamery i realizator', 'Nagrody luksusowe', 'Transmisja live opcjonalnie'],
    image: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=800&q=80',
  },
];

export default function QuizShowsTypes({
  title = 'Formaty teleturniejów',
  subtitle = 'Od prostych quizów po multimedialne widowiska',
  types = defaultTypes,
}: QuizShowsTypesProps) {
  return (
    <section className="relative bg-[#0f1119] px-6 py-24 overflow-hidden">
      {/* Subtle Background Decorations - CRM Style */}
      <div className="absolute left-0 top-1/4 h-64 w-64 rounded-full bg-[#d3bb73]/5 blur-3xl" />
      <div className="absolute right-0 bottom-1/4 h-64 w-64 rounded-full bg-[#800020]/5 blur-3xl" />

      <div className="relative z-10 mx-auto max-w-7xl">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-20 text-center"
        >
          <h2 className="mb-4 text-4xl font-light text-[#e5e4e2] md:text-5xl">
            {title}
          </h2>
          <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
          <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
            {subtitle}
          </p>
        </motion.div>

        {/* Alternating Layout: Image-Text / Text-Image */}
        <div className="space-y-32">
          {types.map((type, index) => {
            const isEven = index % 2 === 0;

            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.7, delay: 0.2 }}
                className={`flex flex-col gap-12 ${
                  isEven ? 'lg:flex-row' : 'lg:flex-row-reverse'
                } items-center`}
              >
                {/* Image Side */}
                <motion.div
                  initial={{ opacity: 0, x: isEven ? -50 : 50 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.8, delay: 0.3 }}
                  className="relative w-full lg:w-1/2"
                >
                  <div className="group relative aspect-[4/3] overflow-hidden rounded-2xl">
                    <img
                      src={type.image}
                      alt={type.title}
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119]/60 via-transparent to-transparent" />

                    {/* Decorative Border - CRM Style */}
                    <div className="absolute inset-0 rounded-2xl border border-[#d3bb73]/20 transition-colors group-hover:border-[#d3bb73]/40" />
                  </div>

                  {/* Floating Decoration - Subtle */}
                  <div className={`absolute -z-10 h-full w-full rounded-2xl bg-gradient-to-br from-[#d3bb73]/10 to-[#800020]/10 blur-2xl ${
                    isEven ? '-right-8 -bottom-8' : '-left-8 -bottom-8'
                  }`} />
                </motion.div>

                {/* Content Side */}
                <motion.div
                  initial={{ opacity: 0, x: isEven ? 50 : -50 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.8, delay: 0.4 }}
                  className="w-full lg:w-1/2"
                >
                  <div className="space-y-6">
                    {/* Icon */}
                    <div className="inline-flex items-center justify-center rounded-xl bg-[#d3bb73]/10 p-4 text-[#d3bb73] ring-1 ring-[#d3bb73]/20">
                      {type.icon}
                    </div>

                    {/* Level Badge */}
                    <div className="inline-block rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/5 px-4 py-1.5 text-sm font-light text-[#d3bb73]">
                      {type.level}
                    </div>

                    {/* Title */}
                    <h3 className="text-3xl font-light text-[#e5e4e2] lg:text-4xl">
                      {type.title}
                    </h3>

                    {/* Description */}
                    <p className="text-lg font-light leading-relaxed text-[#e5e4e2]/70">
                      {type.description}
                    </p>

                    {/* Features List */}
                    <div className="space-y-3 pt-4">
                      {type.features.map((feature, idx) => (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, x: -20 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.5, delay: 0.5 + idx * 0.1 }}
                          className="flex items-start gap-3"
                        >
                          <div className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#d3bb73]" />
                          <span className="font-light text-[#e5e4e2]/80">
                            {feature}
                          </span>
                        </motion.div>
                      ))}
                    </div>

                    {/* Learn More Link */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.6, delay: 0.8 }}
                      className="pt-4"
                    >
                      <button className="group inline-flex items-center gap-2 text-[#d3bb73] transition-all hover:gap-4">
                        <span className="text-sm font-light">Dowiedz się więcej</span>
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </motion.div>
                  </div>
                </motion.div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
