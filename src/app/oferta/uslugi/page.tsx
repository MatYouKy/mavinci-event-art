'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Head from 'next/head';
import {
  Mic, Camera, Lightbulb, Monitor, Wifi, Settings,
  Award, Shield, Users, Video, FileSearch, MapPin,
  MessageSquare, Search, FileText, CheckCircle, Play, Package,
  Music, Presentation, Star, ArrowRight, Mail
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ContactFormWithTracking from '@/components/ContactFormWithTracking';

const iconMap: Record<string, any> = {
  Mic, Camera, Lightbulb, Monitor, Wifi, Settings,
  Award, Shield, Users, Video, FileSearch, MapPin,
  MessageSquare, Search, FileText, CheckCircle, Play, Package,
  Music, Presentation,
  Volume2: Mic, Truck: Package
};

const getIcon = (iconName: string) => {
  return iconMap[iconName] || Settings;
};

export default function UslugiPage() {
  const [serviceCategories, setServiceCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isContactFormOpen, setIsContactFormOpen] = useState(false);

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    try {
      const { data, error } = await supabase
        .from('conferences_service_categories')
        .select(`
          *,
          items:conferences_service_items(*)
        `)
        .eq('is_active', true)
        .order('display_order');

      if (data) {
        setServiceCategories(data);
      }
    } catch (error) {
      console.error('Error loading services:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredCategories = serviceCategories.map(category => {
    const filteredItems = category.items?.filter((item: any) => {
      const matchesSearch = searchQuery === '' ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description?.toLowerCase().includes(searchQuery.toLowerCase());

      return item.is_active && matchesSearch;
    }) || [];

    return {
      ...category,
      items: filteredItems
    };
  }).filter(category =>
    selectedCategory === null || category.slug === selectedCategory
  ).filter(category => category.items.length > 0);

  const totalServices = serviceCategories.reduce((sum, cat) =>
    sum + (cat.items?.filter((item: any) => item.is_active).length || 0), 0
  );

  const premiumServices = serviceCategories.reduce((sum, cat) =>
    sum + (cat.items?.filter((item: any) => item.is_active && item.is_premium).length || 0), 0
  );

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
          <div className="text-[#d3bb73] text-lg">Ładowanie usług...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Pełna Lista Usług Eventowych - MAVINCI Event & ART</title>
        <meta
          name="description"
          content="Kompletny katalog usług eventowych MAVINCI: nagłośnienie, oświetlenie, ekrany LED, kamery 4K, streaming, quizy, foto atrakcje. 67+ usług dla Twojego wydarzenia."
        />
        <meta
          name="keywords"
          content="usługi eventowe, katalog usług, nagłośnienie event, ekrany LED, streaming konferencji, quizy interaktywne, fotolustro, realizacja wideo 4K, oświetlenie DMX, technika eventowa"
        />

        <meta property="og:type" content="website" />
        <meta property="og:title" content="Pełna Lista Usług Eventowych - MAVINCI" />
        <meta property="og:description" content="Katalog 67+ usług eventowych: audio, video, streaming, interakcje, foto atrakcje i więcej." />
        <meta property="og:url" content="https://mavinci.pl/oferta/uslugi" />
        <meta property="og:image" content="https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1200&h=630&fit=crop" />
        <meta property="og:site_name" content="MAVINCI Event & ART" />
        <meta property="og:locale" content="pl_PL" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Pełna Lista Usług Eventowych - MAVINCI" />
        <meta name="twitter:description" content="Katalog 67+ usług eventowych dla konferencji, gal i wydarzeń firmowych." />
        <meta name="twitter:image" content="https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1200&h=630&fit=crop" />

        <link rel="canonical" href="https://mavinci.pl/oferta/uslugi" />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'ItemList',
              name: 'Usługi Eventowe MAVINCI',
              description: 'Kompletny katalog usług technicznych i kreatywnych dla wydarzeń',
              numberOfItems: totalServices,
              itemListElement: serviceCategories.map((category, idx) => ({
                '@type': 'ListItem',
                position: idx + 1,
                item: {
                  '@type': 'Service',
                  name: category.name,
                  description: category.description,
                  provider: {
                    '@type': 'Organization',
                    name: 'MAVINCI Event & ART'
                  }
                }
              }))
            })
          }}
        />
      </Head>

      <Navbar />
      <div className="min-h-screen bg-[#0f1119]">
        {/* Hero Section */}
        <section className="py-20 px-6 bg-gradient-to-b from-[#1c1f33] to-[#0f1119]">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                <Star className="w-4 h-4 text-[#d3bb73]" />
                <span className="text-[#d3bb73] text-sm font-medium">Katalog Usług</span>
              </div>

              <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                Pełna Lista <span className="text-[#d3bb73]">Usług Eventowych</span>
              </h1>

              <p className="text-[#e5e4e2]/70 text-lg max-w-3xl mx-auto mb-8">
                Odkryj wszystkie nasze możliwości techniczne i kreatywne. Od profesjonalnego nagłośnienia
                po najnowsze innowacje w świecie eventów.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                    <span className="text-[#d3bb73] font-bold text-lg">{totalServices}</span>
                  </div>
                  <div className="text-left">
                    <div className="text-[#e5e4e2] font-medium">Usług</div>
                    <div className="text-[#e5e4e2]/40 text-xs">w ofercie</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                    <span className="text-[#d3bb73] font-bold text-lg">{serviceCategories.length}</span>
                  </div>
                  <div className="text-left">
                    <div className="text-[#e5e4e2] font-medium">Kategorii</div>
                    <div className="text-[#e5e4e2]/40 text-xs">tematycznych</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                    <Star className="w-6 h-6 text-[#d3bb73]" />
                  </div>
                  <div className="text-left">
                    <div className="text-[#e5e4e2] font-medium">{premiumServices} Premium</div>
                    <div className="text-[#e5e4e2]/40 text-xs">najwyższej klasy</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="max-w-4xl mx-auto mb-12">
              <div className="relative mb-6">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
                <input
                  type="text"
                  placeholder="Szukaj usługi... (np. streaming, LED, quiz)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-full pl-12 pr-4 py-4 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap gap-2 justify-center">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={`px-4 py-2 rounded-full text-sm transition-all ${
                    selectedCategory === null
                      ? 'bg-[#d3bb73] text-[#1c1f33] font-medium'
                      : 'bg-[#1c1f33] text-[#e5e4e2]/70 border border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                >
                  Wszystkie
                </button>
                {serviceCategories.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => setSelectedCategory(category.slug)}
                    className={`px-4 py-2 rounded-full text-sm transition-all ${
                      selectedCategory === category.slug
                        ? 'bg-[#d3bb73] text-[#1c1f33] font-medium'
                        : 'bg-[#1c1f33] text-[#e5e4e2]/70 border border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                    }`}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Services List */}
        <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto space-y-16">
            {filteredCategories.map((category, idx) => {
              const Icon = getIcon(category.icon);

              return (
                <div key={category.id} className="animate-fade-in-up" style={{ animationDelay: `${idx * 100}ms` }}>
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-16 h-16 bg-[#d3bb73]/10 rounded-2xl flex items-center justify-center flex-shrink-0">
                      <Icon className="w-8 h-8 text-[#d3bb73]" />
                    </div>
                    <div>
                      <h2 className="text-3xl font-light text-[#e5e4e2]">{category.name}</h2>
                      {category.description && (
                        <p className="text-[#e5e4e2]/60 text-sm mt-1">{category.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {category.items.map((item: any) => (
                      <div
                        key={item.id}
                        className="group bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 hover:border-[#d3bb73]/40 transition-all hover:transform hover:scale-105"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <h3 className={`text-lg font-medium ${item.is_premium ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'}`}>
                            {item.name}
                          </h3>
                          {item.is_premium && (
                            <div className="flex items-center gap-1 bg-[#d3bb73]/10 rounded-full px-2 py-1">
                              <Star className="w-3 h-3 text-[#d3bb73] fill-[#d3bb73]" />
                              <span className="text-[#d3bb73] text-xs font-medium">Premium</span>
                            </div>
                          )}
                        </div>

                        {item.description && (
                          <p className="text-[#e5e4e2]/60 text-sm leading-relaxed">
                            {item.description}
                          </p>
                        )}

                        <div className="mt-4 pt-4 border-t border-[#d3bb73]/10 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setIsContactFormOpen(true)}
                            className="text-[#d3bb73] text-sm font-medium flex items-center gap-2 hover:gap-3 transition-all"
                          >
                            Zapytaj o usługę
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {filteredCategories.length === 0 && (
              <div className="text-center py-20">
                <Search className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
                <h3 className="text-2xl font-light text-[#e5e4e2] mb-2">
                  Nie znaleziono usług
                </h3>
                <p className="text-[#e5e4e2]/60">
                  Spróbuj zmienić kryteria wyszukiwania lub skontaktuj się z nami bezpośrednio
                </p>
              </div>
            )}
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 px-6 bg-gradient-to-b from-[#0f1119] to-[#1c1f33]">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
              Potrzebujesz <span className="text-[#d3bb73]">czegoś więcej?</span>
            </h2>
            <p className="text-[#e5e4e2]/70 text-lg mb-8 max-w-2xl mx-auto">
              Nasze możliwości wykraczają poza standardową ofertę. Realizujemy niestandardowe projekty
              i łączymy usługi w kompleksowe pakiety dostosowane do Twoich potrzeb.
            </p>

            <div className="flex flex-wrap gap-4 justify-center">
              <button
                onClick={() => setIsContactFormOpen(true)}
                className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-4 rounded-full text-lg font-medium hover:bg-[#d3bb73]/90 transition-all hover:scale-105 transform shadow-lg"
              >
                <Mail className="w-5 h-5" />
                Zapytaj o wycenę
              </button>

              <a
                href="/oferta"
                className="inline-flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/30 text-[#e5e4e2] px-8 py-4 rounded-full text-lg font-medium hover:border-[#d3bb73] transition-all"
              >
                Zobacz pakiety usług
                <ArrowRight className="w-5 h-5" />
              </a>
            </div>

            <p className="text-[#e5e4e2]/40 text-sm mt-6">
              Odpowiedź w 24h • Bezpłatna konsultacja techniczna • Wycena bez zobowiązań
            </p>
          </div>
        </section>

        {isContactFormOpen && (
          <ContactFormWithTracking
            isOpen={isContactFormOpen}
            onClose={() => setIsContactFormOpen(false)}
            defaultSubject="Zapytanie o usługi eventowe"
          />
        )}
      </div>
      <Footer />
    </>
  );
}
