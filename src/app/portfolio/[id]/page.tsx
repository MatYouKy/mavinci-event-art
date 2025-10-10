'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Calendar, Tag, MapPin, Image as ImageIcon } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PortfolioProject } from '@/lib/supabase';
import { PageHeroImage } from '@/components/PageHeroImage';

const MOCK_PROJECTS: PortfolioProject[] = [
  {
    id: 'mock-1',
    title: 'Targi Branżowe Olsztyn 2024',
    category: 'Targi i Wystawy',
    image: 'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920',
    description: 'Kompleksowa organizacja targów branżowych w Olsztynie - obsługa 200 wystawców, catering, multimedia. Event trwał 3 dni i przyciągnął ponad 5000 zwiedzających z całej Polski. Zapewniliśmy pełną obsługę techniczną, catering dla wystawców oraz kompleksową promocję wydarzenia.',
    order_index: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-2',
    title: 'Integracja Firmowa - Mazury',
    category: 'Integracja Pracownicza',
    image: 'https://images.pexels.com/photos/2788488/pexels-photo-2788488.jpeg?auto=compress&cs=tinysrgb&w=1920',
    description: 'Dwudniowa integracja dla 150 pracowników z team buildingiem nad Jeziorakami w województwie warmińsko-mazurskim. Program obejmował gry zespołowe, warsztaty integracyjne, wieczorną galę oraz profesjonalny catering. Wszyscy uczestnicy zostali zakwaterowani w luksusowym hotelu z pełnym wyżywieniem.',
    order_index: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-3',
    title: 'Konferencja Biznesowa Gdańsk',
    category: 'Konferencje',
    image: 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1920',
    description: 'Międzynarodowa konferencja biznesowa w Gdańsku - 500 uczestników, tłumaczenia symultaniczne, strefy networkingowe. Wydarzenie przyciągnęło prelegentów z 15 krajów. Zapewniliśmy profesjonalną realizację techniczną, streamowanie online oraz kompleksową obsługę gości VIP.',
    order_index: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-4',
    title: 'Gala Biznesowa Warszawa',
    category: 'Eventy Korporacyjne',
    image: 'https://images.pexels.com/photos/1112080/pexels-photo-1112080.jpeg?auto=compress&cs=tinysrgb&w=1920',
    description: 'Ekskluzywna gala biznesowa w Warszawie dla 300 gości - profesjonalna scenografia i catering premium. Wydarzenie obejmowało ceremonię wręczenia nagród, koncert gwiazdy polskiej estrady oraz bankiet w eleganckim stylu. Zapewniliśmy pełną obsługę eventową od scenografii po fotografa.',
    order_index: 4,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-5',
    title: 'Event Marketingowy Toruń',
    category: 'Event Marketing',
    image: 'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=1920',
    description: 'Kampania eventowa w Toruniu - road show, degustacje produktu, aktywacja marki, obsługa influencerów. Wydarzenie trwało 2 tygodnie i odwiedziło 5 miast. Zapewniliśmy mobilną scenę, hostessy, materiały promocyjne oraz kompleksową obsługę logistyczną.',
    order_index: 5,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-6',
    title: 'Festiwal Muzyczny',
    category: 'Festival',
    image: 'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=1920',
    description: 'Wielki festiwal muzyczny z profesjonalną sceną i kompleksową obsługą eventową. Event przyciągnął ponad 10 000 uczestników. Zapewniliśmy 3 sceny, nagłośnienie, oświetlenie, catering, ochronę oraz pełną infrastrukturę sanitarną.',
    order_index: 6,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-7',
    title: 'Konferencja Medyczna',
    category: 'Konferencje',
    image: 'https://images.pexels.com/photos/3182750/pexels-photo-3182750.jpeg?auto=compress&cs=tinysrgb&w=1920',
    description: 'Konferencja medyczna z symultanicznym tłumaczeniem dla 300 uczestników. Wydarzenie obejmowało warsztaty praktyczne, prezentacje naukowe oraz strefy networkingowe dla lekarzy. Zapewniliśmy pełną obsługę techniczną i logistyczną.',
    order_index: 7,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-8',
    title: 'Wieczór Tematyczny - Gatsby',
    category: 'Eventy Korporacyjne',
    image: 'https://images.pexels.com/photos/1679618/pexels-photo-1679618.jpeg?auto=compress&cs=tinysrgb&w=1920',
    description: 'Stylizowany wieczór w klimacie lat 20. dla 200 gości. Profesjonalna scenografia w stylu art deco, żywa muzyka jazzowa, tancerze oraz catering inspirowany epoką prohibicji. Wszyscy goście przybyli w stylizacjach nawiązujących do epoki Wielkiego Gatsby\'ego.',
    order_index: 8,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-9',
    title: 'Targi Tech Expo',
    category: 'Targi i Wystawy',
    image: 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1920',
    description: 'Targi technologiczne z demonstracjami na żywo dla 100 wystawców i 3000 zwiedzających. Event prezentował najnowsze innowacje w branży IT. Zapewniliśmy stoiska wystawowe, sceny demo, strefy networkingowe oraz pełną infrastrukturę techniczną.',
    order_index: 9,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export default function ProjectDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [project, setProject] = useState<PortfolioProject | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProject();
  }, [id]);

  const fetchProject = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/portfolio-projects/${id}`);
      if (response.ok) {
        const data = await response.json();
        setProject(data);
      } else {
        const mockProject = MOCK_PROJECTS.find(p => p.id === id);
        setProject(mockProject || null);
      }
    } catch (error) {
      console.error('Error fetching project:', error);
      const mockProject = MOCK_PROJECTS.find(p => p.id === id);
      setProject(mockProject || null);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-[#0f1119] flex items-center justify-center">
          <div className="text-[#d3bb73] text-lg">Ładowanie projektu...</div>
        </main>
        <Footer />
      </>
    );
  }

  if (!project) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-[#0f1119] flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-3xl font-light text-[#e5e4e2] mb-4">Projekt nie znaleziony</h1>
            <Link href="/portfolio" className="text-[#d3bb73] hover:text-[#d3bb73]/80">
              Wróć do portfolio
            </Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#0f1119]">
        <PageHeroImage
          section={project.hero_image_section || `portfolio-${project.id}`}
          defaultImage={project.image_metadata?.desktop?.src || project.image}
          defaultOpacity={0.2}
          className="py-24 md:py-32 overflow-hidden"
        >
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Link
              href="/portfolio"
              className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors mb-8"
            >
              <ArrowLeft className="w-4 h-4" />
              Wróć do portfolio
            </Link>

            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                  <Tag className="w-5 h-5 text-[#d3bb73]" />
                  <span className="text-[#d3bb73] text-sm font-medium">{project.category}</span>
                </div>

                <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                  {project.title}
                </h1>

                <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed mb-8">
                  {project.description}
                </p>

                <div className="flex flex-wrap gap-4">
                  <a
                    href="/#kontakt"
                    className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
                  >
                    Zapytaj o podobny event
                  </a>
                  <Link
                    href="/portfolio"
                    className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/20 transition-colors"
                  >
                    Zobacz więcej projektów
                  </Link>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 rounded-3xl blur-3xl"></div>
                <div className="relative rounded-3xl overflow-hidden border border-[#d3bb73]/20">
                  <img
                    src={project.image_metadata?.desktop?.src || project.image}
                    alt={project.alt || project.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            </div>
          </div>
        </PageHeroImage>

        <section className="py-24 bg-[#0f1119]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
                Szczegóły Projektu
              </h2>
              <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
            </div>

            <div className="bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-2xl p-8 mb-12">
              <div className="prose prose-invert max-w-none">
                <p className="text-[#e5e4e2]/80 text-lg font-light leading-relaxed">
                  {project.description}
                </p>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-xl p-6 text-center">
                <Tag className="w-8 h-8 text-[#d3bb73] mx-auto mb-4" />
                <h3 className="text-[#e5e4e2] font-light mb-2">Kategoria</h3>
                <p className="text-[#d3bb73] text-sm">{project.category}</p>
              </div>

              <div className="bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-xl p-6 text-center">
                <Calendar className="w-8 h-8 text-[#d3bb73] mx-auto mb-4" />
                <h3 className="text-[#e5e4e2] font-light mb-2">Data realizacji</h3>
                <p className="text-[#d3bb73] text-sm">
                  {new Date(project.created_at).toLocaleDateString('pl-PL')}
                </p>
              </div>

              <div className="bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-xl p-6 text-center">
                <MapPin className="w-8 h-8 text-[#d3bb73] mx-auto mb-4" />
                <h3 className="text-[#e5e4e2] font-light mb-2">Lokalizacja</h3>
                <p className="text-[#d3bb73] text-sm">{project.location || 'Polska'}</p>
              </div>
            </div>
          </div>
        </section>

        {project.gallery && project.gallery.length > 0 && (
          <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-16">
                <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
                  Galeria Wydarzenia
                </h2>
                <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {project.gallery.map((image, index) => (
                  <div
                    key={index}
                    className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-[#d3bb73]/10 hover:border-[#d3bb73]/30 transition-all duration-300"
                  >
                    <img
                      src={image.image_metadata?.desktop?.src || image.src}
                      alt={image.alt || `Zdjęcie z wydarzenia ${index + 1}`}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119]/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="absolute bottom-4 left-4 right-4">
                        <p className="text-[#e5e4e2] text-sm font-light">
                          {image.alt || `Zdjęcie ${index + 1}`}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
              Zorganizujmy Twój Wydarzenie!
            </h2>
            <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
              Skontaktuj się z nami, aby omówić szczegóły Twojego eventu. Zapewnimy profesjonalną realizację na najwyższym poziomie.
            </p>
            <a
              href="/#kontakt"
              className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
            >
              Skontaktuj się z nami
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
