'use client';

import { Award, Users, Heart, Target, Sparkles, TrendingUp, ArrowRight } from 'lucide-react';
import { PageHeroImage } from '@/components/PageHeroImage';
import { EditableImage } from '@/components/EditableImage';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import { stats } from '@/components/Stats';
import { AnimatedCounter } from '@/components/UI/AnimatedCounter';

export default function AboutPageClient() {
  const values = [
    {
      icon: Award,
      title: 'Profesjonalizm',
      description:
        'Każdy event realizujemy z najwyższą starannością i zaangażowaniem, dbając o każdy szczegół.',
    },
    {
      icon: Heart,
      title: 'Pasja',
      description:
        'Kochamy to, co robimy. Nasza pasja do eventów przekłada się na wyjątkowe doświadczenia dla klientów.',
    },
    {
      icon: Users,
      title: 'Zespół',
      description:
        'Nasz doświadczony zespół to ludzie, którzy tworzą magie eventową z zaangażowaniem i kreatywnością.',
    },
    {
      icon: Target,
      title: 'Precyzja',
      description:
        'Dokładne planowanie i perfekcyjne wykonanie - to klucz do sukcesu każdego wydarzenia.',
    },
  ];

  return (
    <>
      <main className="min-h-screen bg-[#0f1119]">
        <PageHeroImage
          section="about"
          defaultImage="https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920"
          defaultOpacity={0.2}
          className="overflow-hidden py-24 md:py-32"
        >
          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-16 text-center">
              <div className="mb-6 inline-flex items-center gap-3 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-2">
                <Sparkles className="h-5 w-5 text-[#d3bb73]" />
                <span className="text-sm font-medium text-[#d3bb73]">Poznaj Nas</span>
              </div>

              <h1 className="mb-6 text-4xl font-light text-[#e5e4e2] md:text-6xl">
                Kim <span className="text-[#d3bb73]">Jesteśmy</span>
              </h1>

              <p className="mx-auto max-w-3xl text-lg font-light leading-relaxed text-[#e5e4e2]/70">
                Mavinci to agencja eventowa z pasją do tworzenia niezapomnianych wydarzeń. Od ponad
                15 lat realizujemy eventy, które inspirują, integrują i pozostają w pamięci na
                długo.
              </p>
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {stats.map((stat, index) => (
                <div
                  key={index}
                  className="rounded-2xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#1c1f33] to-[#800020]/10 p-8 text-center backdrop-blur-sm transition-all duration-500 hover:-translate-y-2 hover:border-[#d3bb73]/50 hover:shadow-2xl hover:shadow-[#d3bb73]/20"
                >
                  <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]/10 transition-all duration-300 group-hover:scale-110 group-hover:bg-[#d3bb73]/20">
                    <stat.icon className="h-8 w-8 text-[#d3bb73] transition-transform duration-300 group-hover:rotate-12" />
                  </div>
                  <AnimatedCounter end={stat.value} suffix={stat.suffix} />
                  <div className="text-sm font-light text-[#e5e4e2]/70">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </PageHeroImage>
        <section className="px-6 pt-6 min-h-[50px]">
          <div className="mx-auto max-w-7xl min-h-[50px]">
            <CategoryBreadcrumb pageSlug="o-nas" />
          </div>
        </section>

        <section className="bg-[#0f1119] py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                  Nasza <span className="text-[#d3bb73]">Historia</span>
                </h2>
                <div className="mb-8 h-1 w-24 bg-gradient-to-r from-[#d3bb73] to-transparent"></div>

                <div className="space-y-6 font-light leading-relaxed text-[#e5e4e2]/70">
                  <p>
                    Mavinci powstało z pasji do tworzenia wyjątkowych doświadczeń. Rozpoczęliśmy od
                    małych eventów lokalnych, a dziś jesteśmy jedną z wiodących agencji eventowych w
                    Polsce.
                  </p>
                  <p>
                    Przez lata zdobyliśmy doświadczenie w organizacji najróżniejszych wydarzeń - od
                    kameralnych integracji firmowych, przez wielkie konferencje biznesowe, po
                    festiwale muzyczne dla tysięcy uczestników.
                  </p>
                  <p>
                    Nasz zespół to grupa pasjonatów, którzy każdy projekt traktują jak wyzwanie do
                    stworzenia czegoś wyjątkowego. Łączymy kreatywność z precyzją wykonania, co
                    przekłada się na satysfakcję naszych klientów.
                  </p>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 blur-3xl"></div>
                <EditableImage
                  section="about-historia"
                  defaultImage="https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1200"
                  alt="Nasz zespół"
                  className="relative aspect-square overflow-hidden rounded-3xl border border-[#d3bb73]/20"
                  imageClassName="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-gradient-to-br from-[#0f1119] to-[#1c1f33] py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-16 text-center">
              <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                Nasze <span className="text-[#d3bb73]">Wartości</span>
              </h2>
              <div className="mx-auto h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
            </div>

            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
              {values.map((value, index) => (
                <div
                  key={index}
                  className="rounded-2xl border border-[#d3bb73]/10 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-8 backdrop-blur-sm transition-all duration-300 hover:border-[#d3bb73]/30"
                >
                  <value.icon className="mb-6 h-12 w-12 text-[#d3bb73]" />
                  <h3 className="mb-3 text-xl font-light text-[#e5e4e2]">{value.title}</h3>
                  <p className="font-light leading-relaxed text-[#e5e4e2]/70">
                    {value.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#0f1119] py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div className="relative order-2 lg:order-1">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 blur-3xl"></div>
                <EditableImage
                  section="about-mavinci"
                  defaultImage="https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1200"
                  alt="Nasze projekty"
                  className="relative aspect-square overflow-hidden rounded-3xl border border-[#d3bb73]/20"
                  imageClassName="w-full h-full object-cover"
                />
              </div>

              <div className="order-1 lg:order-2">
                <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                  Dlaczego <span className="text-[#d3bb73]">Mavinci</span>?
                </h2>
                <div className="mb-8 h-1 w-24 bg-gradient-to-r from-[#d3bb73] to-transparent"></div>

                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/20">
                      <TrendingUp className="h-5 w-5 text-[#d3bb73]" />
                    </div>
                    <div>
                      <h3 className="mb-2 text-lg font-light text-[#e5e4e2]">
                        Kompleksowa obsługa
                      </h3>
                      <p className="font-light leading-relaxed text-[#e5e4e2]/70">
                        Od pomysłu po realizację - zajmiemy się wszystkim, abyś mógł cieszyć się
                        swoim eventem.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/20">
                      <Sparkles className="h-5 w-5 text-[#d3bb73]" />
                    </div>
                    <div>
                      <h3 className="mb-2 text-lg font-light text-[#e5e4e2]">
                        Kreatywne rozwiązania
                      </h3>
                      <p className="font-light leading-relaxed text-[#e5e4e2]/70">
                        Każdy event to dla nas wyzwanie do stworzenia czegoś wyjątkowego i
                        niepowtarzalnego.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/20">
                      <Award className="h-5 w-5 text-[#d3bb73]" />
                    </div>
                    <div>
                      <h3 className="mb-2 text-lg font-light text-[#e5e4e2]">Doświadczenie</h3>
                      <p className="font-light leading-relaxed text-[#e5e4e2]/70">
                        15 lat na rynku i setki zrealizowanych projektów to gwarancja
                        profesjonalizmu.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] py-24">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <Target className="mx-auto mb-6 h-16 w-16 text-[#d3bb73]" />
            <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Stwórzmy Coś Razem!
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-lg font-light text-[#e5e4e2]/70">
              Masz pomysł na event? Skontaktuj się z nami, a pomożemy Ci go zrealizować. Od
              planowania po wykonanie - zadbamy o wszystko.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a
                href="/#kontakt"
                className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                Skontaktuj się z nami
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="/portfolio"
                className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-8 py-3 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
              >
                Zobacz portfolio
              </a>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
