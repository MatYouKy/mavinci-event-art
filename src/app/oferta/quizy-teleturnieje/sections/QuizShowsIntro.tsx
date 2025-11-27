'use client';

import { Sparkles, Trophy, Users } from 'lucide-react';

interface QuizShowsIntroProps {
  title?: string;
  subtitle?: string;
  description?: string;
}

export default function QuizShowsIntro({
  title = 'Teleturnieje na miarę telewizji',
  subtitle = 'Od prostych quizów po multimedialne widowiska',
  description = 'Nasza oferta obejmuje szeroką gamę formatów – od klasycznych quizów wiedzy po zaawansowane teleturnieje multimedialne. Każdy format można dostosować do charakteru wydarzenia i poziomu zaawansowania uczestników. Proste formuły idealne na szybką integrację, złożone produkcje z profesjonalnym sprzętem do głosowania na ekskluzywne gale i uroczystości premium.',
}: QuizShowsIntroProps) {
  return (
    <section className="bg-gradient-to-br from-[#0f1119] to-[#1c1f33] px-6 py-24">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-16 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/5 px-5 py-2 backdrop-blur-sm">
            <Sparkles className="h-4 w-4 text-[#d3bb73]" />
            <span className="text-sm font-light text-[#e5e4e2]/90">{subtitle}</span>
          </div>

          <h2 className="mb-6 text-4xl font-light text-[#e5e4e2] md:text-5xl">
            {title}
          </h2>

          <div className="mx-auto mb-8 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />

          <p className="mx-auto max-w-3xl text-lg font-light leading-relaxed text-[#e5e4e2]/70">
            {description}
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-6 md:grid-cols-3">
          {/* Card 1 */}
          <div className="group relative overflow-hidden rounded-2xl border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-8 backdrop-blur-sm transition-all duration-300 hover:border-[#d3bb73]/30">
            <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

            <div className="relative z-10">
              <div className="mb-4 inline-flex items-center justify-center rounded-xl bg-[#d3bb73]/10 p-4 text-[#d3bb73] ring-1 ring-[#d3bb73]/20">
                <Users className="h-8 w-8" />
              </div>
              <h3 className="mb-2 text-3xl font-light text-[#e5e4e2]">10-500+</h3>
              <p className="font-light text-[#e5e4e2]/60">
                Uczestników w jednym teleturnieju
              </p>
            </div>

            <div className="absolute bottom-0 left-0 h-1 w-0 bg-gradient-to-r from-[#d3bb73] to-[#c5a960] transition-all duration-300 group-hover:w-full" />
          </div>

          {/* Card 2 */}
          <div className="group relative overflow-hidden rounded-2xl border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-8 backdrop-blur-sm transition-all duration-300 hover:border-[#d3bb73]/30">
            <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

            <div className="relative z-10">
              <div className="mb-4 inline-flex items-center justify-center rounded-xl bg-[#d3bb73]/10 p-4 text-[#d3bb73] ring-1 ring-[#d3bb73]/20">
                <Trophy className="h-8 w-8" />
              </div>
              <h3 className="mb-2 text-3xl font-light text-[#e5e4e2]">15+</h3>
              <p className="font-light text-[#e5e4e2]/60">
                Autorskich formatów teleturniejów
              </p>
            </div>

            <div className="absolute bottom-0 left-0 h-1 w-0 bg-gradient-to-r from-[#d3bb73] to-[#c5a960] transition-all duration-300 group-hover:w-full" />
          </div>

          {/* Card 3 */}
          <div className="group relative overflow-hidden rounded-2xl border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-8 backdrop-blur-sm transition-all duration-300 hover:border-[#d3bb73]/30">
            <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

            <div className="relative z-10">
              <div className="mb-4 inline-flex items-center justify-center rounded-xl bg-[#d3bb73]/10 p-4 text-[#d3bb73] ring-1 ring-[#d3bb73]/20">
                <Sparkles className="h-8 w-8" />
              </div>
              <h3 className="mb-2 text-3xl font-light text-[#e5e4e2]">Premium</h3>
              <p className="font-light text-[#e5e4e2]/60">
                Realizacja na ekskluzywne wydarzenia
              </p>
            </div>

            <div className="absolute bottom-0 left-0 h-1 w-0 bg-gradient-to-r from-[#d3bb73] to-[#c5a960] transition-all duration-300 group-hover:w-full" />
          </div>
        </div>
      </div>
    </section>
  );
}
