'use client';

import { Award, Users, Heart, Target, Sparkles, TrendingUp, ArrowRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';
import { EditableImage } from '@/components/EditableImage';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';

export default function AboutPageClient() {
  const values = [
    {
      icon: Award,
      title: 'Profesjonalizm',
      description: 'Każdy event realizujemy z najwyższą starannością i zaangażowaniem, dbając o każdy szczegół.',
    },
    {
      icon: Heart,
      title: 'Pasja',
      description: 'Kochamy to, co robimy. Nasza pasja do eventów przekłada się na wyjątkowe doświadczenia dla klientów.',
    },
    {
      icon: Users,
      title: 'Zespół',
      description: 'Nasz doświadczony zespół to ludzie, którzy tworzą magie eventową z zaangażowaniem i kreatywnością.',
    },
    {
      icon: Target,
      title: 'Precyzja',
      description: 'Dokładne planowanie i perfekcyjne wykonanie - to klucz do sukcesu każdego wydarzenia.',
    },
  ];

  const stats = [
    { value: '15+', label: 'Lat doświadczenia' },
    { value: '500+', label: 'Zrealizowanych eventów' },
    { value: '100%', label: 'Zaangażowania' },
  ];

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#0f1119]">
        <PageHeroImage
          section="about"
          defaultImage="https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920"
          defaultOpacity={0.2}
          className="py-24 md:py-32 overflow-hidden"
        >
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <CategoryBreadcrumb pageSlug="o-nas" />
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                <Sparkles className="w-5 h-5 text-[#d3bb73]" />
                <span className="text-[#d3bb73] text-sm font-medium">Poznaj Nas</span>
              </div>

              <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                Kim <span className="text-[#d3bb73]">Jesteśmy</span>
              </h1>

              <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed max-w-3xl mx-auto">
                Mavinci to agencja eventowa z pasją do tworzenia niezapomnianych wydarzeń. Od ponad 15 lat realizujemy eventy, które inspirują, integrują i pozostają w pamięci na długo.
              </p>
            </div>

            <div className="grid md:grid-cols-4 gap-6 mt-12">
              {stats.map((stat, index) => (
                <div
                  key={index}
                  className="bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-2xl p-6 text-center"
                >
                  <div className="text-4xl md:text-5xl font-light text-[#d3bb73] mb-2">
                    {stat.value}
                  </div>
                  <div className="text-[#e5e4e2]/70 text-sm font-light">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </PageHeroImage>

        <section className="py-24 bg-[#0f1119]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
                  Nasza <span className="text-[#d3bb73]">Historia</span>
                </h2>
                <div className="h-1 w-24 bg-gradient-to-r from-[#d3bb73] to-transparent mb-8"></div>

                <div className="space-y-6 text-[#e5e4e2]/70 font-light leading-relaxed">
                  <p>
                    Mavinci powstało z pasji do tworzenia wyjątkowych doświadczeń. Rozpoczęliśmy od małych eventów lokalnych, a dziś jesteśmy jedną z wiodących agencji eventowych w Polsce.
                  </p>
                  <p>
                    Przez lata zdobyliśmy doświadczenie w organizacji najróżniejszych wydarzeń - od kameralnych integracji firmowych, przez wielkie konferencje biznesowe, po festiwale muzyczne dla tysięcy uczestników.
                  </p>
                  <p>
                    Nasz zespół to grupa pasjonatów, którzy każdy projekt traktują jak wyzwanie do stworzenia czegoś wyjątkowego. Łączymy kreatywność z precyzją wykonania, co przekłada się na satysfakcję naszych klientów.
                  </p>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 rounded-3xl blur-3xl"></div>
                <EditableImage
                  section="about-historia"
                  defaultImage="https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1200"
                  alt="Nasz zespół"
                  className="relative rounded-3xl overflow-hidden border border-[#d3bb73]/20 aspect-square"
                  imageClassName="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
                Nasze <span className="text-[#d3bb73]">Wartości</span>
              </h2>
              <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              {values.map((value, index) => (
                <div
                  key={index}
                  className="bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-2xl p-8 hover:border-[#d3bb73]/30 transition-all duration-300"
                >
                  <value.icon className="w-12 h-12 text-[#d3bb73] mb-6" />
                  <h3 className="text-xl font-light text-[#e5e4e2] mb-3">{value.title}</h3>
                  <p className="text-[#e5e4e2]/70 font-light leading-relaxed">
                    {value.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-24 bg-[#0f1119]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="relative order-2 lg:order-1">
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 rounded-3xl blur-3xl"></div>
                <EditableImage
                  section="about-mavinci"
                  defaultImage="https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1200"
                  alt="Nasze projekty"
                  className="relative rounded-3xl overflow-hidden border border-[#d3bb73]/20 aspect-square"
                  imageClassName="w-full h-full object-cover"
                />
              </div>

              <div className="order-1 lg:order-2">
                <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
                  Dlaczego <span className="text-[#d3bb73]">Mavinci</span>?
                </h2>
                <div className="h-1 w-24 bg-gradient-to-r from-[#d3bb73] to-transparent mb-8"></div>

                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#d3bb73]/20 border border-[#d3bb73]/30 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-[#d3bb73]" />
                    </div>
                    <div>
                      <h3 className="text-lg font-light text-[#e5e4e2] mb-2">
                        Kompleksowa obsługa
                      </h3>
                      <p className="text-[#e5e4e2]/70 font-light leading-relaxed">
                        Od pomysłu po realizację - zajmiemy się wszystkim, abyś mógł cieszyć się swoim eventem.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#d3bb73]/20 border border-[#d3bb73]/30 flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-[#d3bb73]" />
                    </div>
                    <div>
                      <h3 className="text-lg font-light text-[#e5e4e2] mb-2">
                        Kreatywne rozwiązania
                      </h3>
                      <p className="text-[#e5e4e2]/70 font-light leading-relaxed">
                        Każdy event to dla nas wyzwanie do stworzenia czegoś wyjątkowego i niepowtarzalnego.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#d3bb73]/20 border border-[#d3bb73]/30 flex items-center justify-center">
                      <Award className="w-5 h-5 text-[#d3bb73]" />
                    </div>
                    <div>
                      <h3 className="text-lg font-light text-[#e5e4e2] mb-2">
                        Doświadczenie
                      </h3>
                      <p className="text-[#e5e4e2]/70 font-light leading-relaxed">
                        15 lat na rynku i setki zrealizowanych projektów to gwarancja profesjonalizmu.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-24 bg-gradient-to-br from-[#1c1f33] to-[#0f1119]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Target className="w-16 h-16 text-[#d3bb73] mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
              Stwórzmy Coś Razem!
            </h2>
            <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
              Masz pomysł na event? Skontaktuj się z nami, a pomożemy Ci go zrealizować. Od planowania po wykonanie - zadbamy o wszystko.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a
                href="/#kontakt"
                className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
              >
                Skontaktuj się z nami
                <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href="/portfolio"
                className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/20 transition-colors"
              >
                Zobacz portfolio
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
