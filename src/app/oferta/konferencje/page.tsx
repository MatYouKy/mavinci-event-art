'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import Head from 'next/head';
import {
  Mic, Camera, Lightbulb, Monitor, Wifi, Settings,
  Award, Shield, Users, Video, FileSearch, MapPin,
  MessageSquare, Search, FileText, CheckCircle, Play, Package,
  ChevronDown, Mail, ArrowLeft, Presentation, Music
} from 'lucide-react';
import Link from 'next/link';
import ContactFormWithTracking from '@/components/ContactFormWithTracking';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';
import { EditableContent } from '@/components/EditableContent';
import { useEditMode } from '@/contexts/EditModeContext';

const iconMap: Record<string, any> = {
  Mic, Camera, Lightbulb, Monitor, Wifi, Settings,
  Award, Shield, Users, Video, FileSearch, MapPin,
  MessageSquare, Search, FileText, CheckCircle, Play, Package,
  Music, Presentation,
  Volume2: Mic, Truck: Package
};

export default function ConferencesPage() {
  const { isEditMode } = useEditMode();
  const [heroData, setHeroData] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editHeroTitle, setEditHeroTitle] = useState('');
  const [editHeroSubtitle, setEditHeroSubtitle] = useState('');
  const [editHeroDescription, setEditHeroDescription] = useState('');
  const [editHeroOpacity, setEditHeroOpacity] = useState(0.7);
  const [problems, setProblems] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [caseStudies, setCaseStudies] = useState<any[]>([]);
  const [advantages, setAdvantages] = useState<any[]>([]);
  const [process, setProcess] = useState<any[]>([]);
  const [pricing, setPricing] = useState<any[]>([]);
  const [faq, setFaq] = useState<any[]>([]);
  const [gallery, setGallery] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [ogImage, setOgImage] = useState<string>('');
  const [serviceCategories, setServiceCategories] = useState<any[]>([]);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [isContactFormOpen, setIsContactFormOpen] = useState(false);
  const [relatedServices, setRelatedServices] = useState<any[]>([]);
  const [allServiceItems, setAllServiceItems] = useState<any[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const [triplicatedServices, setTriplicatedServices] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (relatedServices.length > 0) {
      setTriplicatedServices([...relatedServices, ...relatedServices, ...relatedServices]);
      setCurrentIndex(relatedServices.length);
    }
  }, [relatedServices]);

  const handleNext = () => {
    setCurrentIndex((prev) => {
      const next = prev + 1;
      if (next >= relatedServices.length * 2) {
        setTimeout(() => {
          setCurrentIndex(relatedServices.length);
        }, 700);
      }
      return next;
    });
  };

  const handlePrev = () => {
    setCurrentIndex((prev) => {
      const next = prev - 1;
      if (next < relatedServices.length) {
        setTimeout(() => {
          setCurrentIndex(relatedServices.length * 2 - 1);
        }, 700);
      }
      return next;
    });
  };

  const loadData = async () => {
    const [
      heroRes,
      problemsRes,
      servicesRes,
      packagesRes,
      caseStudiesRes,
      advantagesRes,
      processRes,
      pricingRes,
      faqRes,
      galleryRes,
      citiesRes,
      ogImageRes,
      serviceCategoriesRes,
      relatedServicesRes,
      allServiceItemsRes
    ] = await Promise.all([
      supabase.from('conferences_hero').select('*').eq('is_active', true).single(),
      supabase.from('conferences_problems').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_services').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_packages').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_case_studies').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_advantages').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_process').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_pricing').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_faq').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_gallery').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_cities').select('*').eq('is_active', true).order('display_order'),
      supabase.from('site_images').select('desktop_url').eq('section', 'konferencje-hero').eq('is_active', true).single(),
      supabase.from('conferences_service_categories').select(`
        *,
        items:conferences_service_items(*)
      `).eq('is_active', true).order('display_order'),
      supabase.from('conferences_related_services').select(`
        *,
        service_item:conferences_service_items(*)
      `).eq('is_active', true).order('display_order'),
      supabase.from('conferences_service_items').select('*').eq('is_active', true).order('name')
    ]);

    if (heroRes.data) setHeroData(heroRes.data);
    if (problemsRes.data) setProblems(problemsRes.data);
    if (servicesRes.data) setServices(servicesRes.data);
    if (packagesRes.data) setPackages(packagesRes.data);
    if (caseStudiesRes.data) setCaseStudies(caseStudiesRes.data);
    if (advantagesRes.data) setAdvantages(advantagesRes.data);
    if (processRes.data) setProcess(processRes.data);
    if (pricingRes.data) setPricing(pricingRes.data);
    if (faqRes.data) setFaq(faqRes.data);
    if (galleryRes.data) setGallery(galleryRes.data);
    if (citiesRes.data) setCities(citiesRes.data);
    if (serviceCategoriesRes.data) setServiceCategories(serviceCategoriesRes.data);

    if (relatedServicesRes.data) {
      setRelatedServices(relatedServicesRes.data.map(r => r.service_item));
      setSelectedServiceIds(new Set(relatedServicesRes.data.map(r => r.service_item_id)));
    }
    if (allServiceItemsRes.data) setAllServiceItems(allServiceItemsRes.data);
    setOgImage(ogImageRes.data?.desktop_url || 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1200&h=630&fit=crop');
  };

  useEffect(() => {
    if (heroData && !isEditing) {
      setEditHeroTitle(heroData.title || '');
      setEditHeroSubtitle(heroData.subtitle || '');
      setEditHeroDescription(heroData.trust_badge || '');
      setEditHeroOpacity(0.7);
    }
  }, [heroData, isEditing]);

  const handleSaveHero = async () => {
    try {
      const { error } = await supabase
        .from('conferences_hero')
        .update({
          title: editHeroTitle,
          subtitle: editHeroSubtitle,
          trust_badge: editHeroDescription,
          updated_at: new Date().toISOString()
        })
        .eq('id', heroData.id);

      if (error) throw error;

      setHeroData({
        ...heroData,
        title: editHeroTitle,
        subtitle: editHeroSubtitle,
        trust_badge: editHeroDescription
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving hero:', error);
    }
  };

  const getIcon = (iconName: string) => {
    const Icon = iconMap[iconName] || Settings;
    return Icon;
  };

  if (!heroData) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
          <div className="text-[#d3bb73]">Ładowanie...</div>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Obsługa Konferencji - Profesjonalne Nagłośnienie i Multimedia | MAVINCI Event & ART</title>
        <meta
          name="description"
          content="Kompleksowa obsługa techniczna konferencji: nagłośnienie, multimedia, streaming live, realizacja wideo. Pakiety dla 50-500+ uczestników. Północna i centralna Polska."
        />
        <meta
          name="keywords"
          content="obsługa konferencji warszawa, nagłośnienie konferencyjne gdańsk, technika av bydgoszcz, streaming konferencji toruń, realizacja live olsztyn, konferencje łódź, obsługa multimedialna białystok, technika konferencyjna rzeszów"
        />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Obsługa Konferencji - Profesjonalne Nagłośnienie | MAVINCI Event & ART" />
        <meta property="og:description" content="Profesjonalne nagłośnienie, multimedia i realizacja live dla konferencji. Pakiety BASIC, STANDARD, PRO. Warszawa, Gdańsk, Bydgoszcz." />
        <meta property="og:url" content="https://mavinci.pl/oferta/konferencje" />
        <meta property="og:image" content={ogImage} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="MAVINCI Obsługa Konferencji" />
        <meta property="og:site_name" content="MAVINCI Event & ART" />
        <meta property="og:locale" content="pl_PL" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Obsługa Konferencji - MAVINCI Event & ART" />
        <meta name="twitter:description" content="Profesjonalne nagłośnienie, multimedia i realizacja live dla konferencji. Pakiety BASIC, STANDARD, PRO." />
        <meta name="twitter:image" content={ogImage} />
        <meta name="twitter:image:alt" content="MAVINCI Obsługa Konferencji" />

        {/* Canonical */}
        <link rel="canonical" href="https://mavinci.pl/oferta/konferencje" />

        {/* JSON-LD Schema */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Service',
              name: 'Obsługa Konferencji',
              description: 'Kompleksowa obsługa techniczna konferencji: nagłośnienie, multimedia, streaming live, realizacja wideo.',
              provider: {
                '@type': 'Organization',
                name: 'MAVINCI Event & ART',
                url: 'https://mavinci.pl',
                logo: 'https://mavinci.pl/logo-mavinci-crm.png',
                address: {
                  '@type': 'PostalAddress',
                  addressLocality: 'Bydgoszcz',
                  addressRegion: 'Kujawsko-Pomorskie',
                  addressCountry: 'PL'
                },
                telephone: '+48-123-456-789',
                email: 'kontakt@mavinci.pl'
              },
              areaServed: [
                { '@type': 'City', name: 'Warszawa' },
                { '@type': 'City', name: 'Gdańsk' },
                { '@type': 'City', name: 'Bydgoszcz' },
                { '@type': 'City', name: 'Toruń' },
                { '@type': 'City', name: 'Olsztyn' },
                { '@type': 'City', name: 'Łódź' },
                { '@type': 'City', name: 'Białystok' },
                { '@type': 'City', name: 'Rzeszów' },
                { '@type': 'City', name: 'Poznań' },
                { '@type': 'City', name: 'Kraków' }
              ],
              serviceType: 'Obsługa Techniczna Konferencji',
              offers: {
                '@type': 'AggregateOffer',
                priceCurrency: 'PLN',
                availability: 'https://schema.org/InStock'
              }
            })
          }}
        />
      </Head>
      <Navbar />
      <div className="min-h-screen bg-[#0f1119]">
        {/* Hero Section with PageHeroImage */}
        <PageHeroImage
          section="konferencje-hero"
          defaultImage="https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1920"
          defaultOpacity={editHeroOpacity}
          className="py-24 md:py-32 overflow-hidden"
        >
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {!isEditing && (
              <Link href="/#uslugi" className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors mb-8">
                <ArrowLeft className="w-4 h-4" />
                Powrót do usług
              </Link>
            )}

            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                  <Presentation className="w-5 h-5 text-[#d3bb73]" />
                  <span className="text-[#d3bb73] text-sm font-medium">Obsługa Konferencji</span>
                </div>

                {isEditMode && (
                  <div className="mb-4 flex gap-2">
                    {!isEditing ? (
                      <button
                        onClick={() => setIsEditing(true)}
                        className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg text-sm font-medium hover:bg-[#c5ad65] transition-colors"
                      >
                        Edytuj sekcję
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={handleSaveHero}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                        >
                          Zapisz
                        </button>
                        <button
                          onClick={() => setIsEditing(false)}
                          className="px-4 py-2 bg-gray-600 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
                        >
                          Anuluj
                        </button>
                      </>
                    )}
                  </div>
                )}

                {isEditing ? (
                  <div className="space-y-4 mb-8">
                    <div>
                      <label className="block text-[#e5e4e2]/70 text-sm mb-2">Tytuł</label>
                      <input
                        type="text"
                        value={editHeroTitle}
                        onChange={(e) => setEditHeroTitle(e.target.value)}
                        className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] text-3xl font-light focus:border-[#d3bb73] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[#e5e4e2]/70 text-sm mb-2">Podtytuł</label>
                      <textarea
                        value={editHeroSubtitle}
                        onChange={(e) => setEditHeroSubtitle(e.target.value)}
                        rows={3}
                        className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[#e5e4e2]/70 text-sm mb-2">Opis</label>
                      <textarea
                        value={editHeroDescription}
                        onChange={(e) => setEditHeroDescription(e.target.value)}
                        rows={2}
                        className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[#e5e4e2]/70 text-sm mb-2">
                        Przeźroczystość tła: {Math.round(editHeroOpacity * 100)}%
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={editHeroOpacity * 100}
                        onChange={(e) => setEditHeroOpacity(parseInt(e.target.value) / 100)}
                        className="w-full h-2 bg-[#1c1f33] rounded-lg appearance-none cursor-pointer accent-[#d3bb73]"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                      {heroData.title.split(' ')[0]} <span className="text-[#d3bb73]">{heroData.title.split(' ').slice(1).join(' ')}</span>
                    </h1>

                    <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed mb-4">
                      {heroData.subtitle}
                    </p>

                    <p className="text-[#e5e4e2]/50 text-sm font-light leading-relaxed mb-8">
                      {heroData.trust_badge}
                    </p>
                  </>
                )}

                {!isEditing && (
                  <div className="flex flex-wrap gap-4">
                    <button
                      onClick={() => setIsContactFormOpen(true)}
                      className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
                    >
                      Zapytaj o wycenę
                    </button>
                    <Link href="/#uslugi" className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/20 transition-colors">
                      Zobacz inne usługi
                    </Link>
                  </div>
                )}
              </div>

              <div className="relative">
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#0f1119]/20 rounded-3xl blur-3xl"></div>
                  <div className="relative bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-3xl p-8">
                    <Mic className="w-24 h-24 text-[#d3bb73] mb-6" />
                    <h3 className="text-2xl font-light text-[#e5e4e2] mb-4">Profesjonalizm i Technika</h3>
                    <p className="text-[#e5e4e2]/70 font-light">
                      Kompleksowa obsługa audio-video, streaming live, wielokamerowa realizacja. Od małych szkoleń po duże konferencje międzynarodowe.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </PageHeroImage>

        {/* Detailed Services Section */}
        {serviceCategories.length > 0 && (
          <section className="py-20 px-6 bg-gradient-to-b from-[#0f1119] to-[#1c1f33]">
            <div className="max-w-7xl mx-auto">
              <div className="text-center mb-16">
                <h2 className="text-4xl md:text-5xl font-light text-[#e5e4e2] mb-4">
                  Pełen Zakres <span className="text-[#d3bb73]">Usług Eventowych</span>
                </h2>
                <p className="text-[#e5e4e2]/60 text-lg max-w-3xl mx-auto">
                  Profesjonalna technika, doświadczony zespół i kompleksowa obsługa – od koncepcji po realizację
                </p>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                {serviceCategories.map((category, idx) => {
                  const Icon = getIcon(category.icon);
                  const activeItems = category.items?.filter((item: any) => item.is_active) || [];

                  return (
                    <div
                      key={category.id}
                      className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-2xl p-6 hover:border-[#d3bb73]/40 transition-all hover:transform hover:scale-105"
                      style={{ animationDelay: `${idx * 50}ms` }}
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Icon className="w-6 h-6 text-[#d3bb73]" />
                        </div>
                        <h3 className="text-xl font-medium text-[#e5e4e2]">
                          {category.name}
                        </h3>
                      </div>

                      {category.description && (
                        <p className="text-[#e5e4e2]/60 text-sm mb-4">
                          {category.description}
                        </p>
                      )}

                      <ul className="space-y-2">
                        {activeItems.slice(0, 6).map((item: any) => (
                          <li key={item.id} className="flex items-start gap-2 text-[#e5e4e2]/70 text-sm">
                            <CheckCircle className="w-4 h-4 text-[#d3bb73] mt-0.5 flex-shrink-0" />
                            <div>
                              <span className={item.is_premium ? 'text-[#d3bb73] font-medium' : ''}>
                                {item.name}
                              </span>
                              {item.description && (
                                <p className="text-[#e5e4e2]/40 text-xs mt-0.5">{item.description}</p>
                              )}
                            </div>
                          </li>
                        ))}
                        {activeItems.length > 6 && (
                          <li className="text-[#e5e4e2]/40 text-xs italic">
                            ...i więcej ({activeItems.length - 6} dodatkowych usług)
                          </li>
                        )}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <div className="mt-12 text-center bg-[#1c1f33]/50 border border-[#d3bb73]/20 rounded-2xl p-8">
                <h3 className="text-2xl font-light text-[#e5e4e2] mb-4">
                  Nie znalazłeś tego, czego szukasz?
                </h3>
                <p className="text-[#e5e4e2]/60 mb-6 max-w-2xl mx-auto">
                  Nasze możliwości wykraczają poza standardową ofertę. Skontaktuj się z nami, a znajdziemy idealne rozwiązanie dla Twojego wydarzenia.
                </p>
                <button
                  onClick={() => setIsContactFormOpen(true)}
                  className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-all hover:scale-105 transform"
                >
                  Zapytaj o niestandardową realizację
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Gallery Section */}
        {gallery.length > 0 && (
          <section className="py-20 px-6">
            <div className="max-w-7xl mx-auto">
              <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center animate-fade-in-up">
                Nasze realizacje w obiektywie
              </h2>
              <p className="text-[#e5e4e2]/60 text-center mb-16 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                Galeria zdjęć z obsłużonych konferencji
              </p>

              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                {gallery.map((item, idx) => (
                  <div
                    key={item.id}
                    className="group relative overflow-hidden rounded-xl aspect-[4/3] cursor-pointer transform hover:scale-105 transition-all duration-500 animate-fade-in-up"
                    style={{ animationDelay: `${idx * 100}ms` }}
                  >
                    <img
                      src={item.image_url}
                      alt={item.alt_text}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="absolute bottom-0 left-0 right-0 p-4">
                        {item.title && (
                          <h3 className="text-white font-medium mb-1">{item.title}</h3>
                        )}
                        {item.caption && (
                          <p className="text-white/80 text-sm">{item.caption}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Multi-City SEO Section - Simple List */}
        {cities.length > 0 && (
          <section className="py-16 px-6 border-t border-[#1c1f33]">
            <div className="max-w-7xl mx-auto">
              <div className="text-center mb-8">
                <p className="text-[#e5e4e2]/40 text-sm mb-3">Obsługujemy konferencje w miastach:</p>
                <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
                  {cities.map((city) => (
                    <Link
                      key={city.id}
                      href={`/uslugi/konferencje/${city.slug}`}
                      className="text-[#e5e4e2]/60 hover:text-[#d3bb73] transition-colors text-sm"
                    >
                      {city.city_name}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Problems and Solutions */}
        <section className="py-20 px-6 bg-[#1c1f33]/30">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Najczęstsze problemy organizatorów konferencji
            </h2>
            <p className="text-[#e5e4e2]/60 text-center mb-16 max-w-2xl mx-auto">
              I nasze profesjonalne rozwiązania
            </p>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {problems.map((problem) => {
                const Icon = getIcon(problem.icon_name);
                return (
                  <div key={problem.id} className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 hover:border-[#d3bb73]/40 transition-all">
                    <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-full flex items-center justify-center mb-4">
                      <Icon className="w-6 h-6 text-[#d3bb73]" />
                    </div>
                    <h3 className="text-xl font-medium text-[#e5e4e2] mb-3">
                      {problem.title}
                    </h3>
                    <p className="text-[#e5e4e2]/60 mb-4 text-sm">
                      <span className="text-red-400">Problem:</span> {problem.problem_description}
                    </p>
                    <p className="text-[#e5e4e2]/80 text-sm">
                      <span className="text-[#d3bb73]">Rozwiązanie:</span> {problem.solution_description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Technical Services */}
        <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Zakres obsługi technicznej
            </h2>
            <p className="text-[#e5e4e2]/60 text-center mb-16">
              Kompleksowa realizacja audio-video dla Twojej konferencji
            </p>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {services.map((service) => {
                const Icon = getIcon(service.icon_name);
                return (
                  <div key={service.id} className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6">
                    <div className="w-14 h-14 bg-[#d3bb73] rounded-full flex items-center justify-center mb-4">
                      <Icon className="w-7 h-7 text-[#1c1f33]" />
                    </div>
                    <h3 className="text-2xl font-medium text-[#e5e4e2] mb-3">
                      {service.category_name}
                    </h3>
                    <p className="text-[#e5e4e2]/70 mb-4">
                      {service.category_description}
                    </p>
                    <ul className="space-y-2">
                      {service.services_list.map((item: string, idx: number) => (
                        <li key={idx} className="flex items-start gap-2 text-[#e5e4e2]/60 text-sm">
                          <CheckCircle className="w-4 h-4 text-[#d3bb73] mt-0.5 flex-shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Packages */}
        <section className="py-20 px-6 bg-[#1c1f33]/30">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Gotowe pakiety konferencyjne
            </h2>
            <p className="text-[#e5e4e2]/60 text-center mb-16">
              Wybierz pakiet dopasowany do wielkości Twojego eventu
            </p>

            <div className="grid md:grid-cols-3 gap-8">
              {packages.map((pkg) => (
                <div key={pkg.id} className={`bg-[#1c1f33] border rounded-xl p-8 ${pkg.package_level === 'pro' ? 'border-[#d3bb73] shadow-xl shadow-[#d3bb73]/20' : 'border-[#d3bb73]/20'}`}>
                  <div className="text-center mb-6">
                    <h3 className="text-2xl font-medium text-[#d3bb73] mb-2">
                      {pkg.package_name}
                    </h3>
                    <p className="text-[#e5e4e2]/60 text-sm mb-4">
                      {pkg.target_audience}
                    </p>
                    <div className="text-3xl font-light text-[#e5e4e2]">
                      {pkg.price_info}
                    </div>
                  </div>

                  <p className="text-[#e5e4e2]/80 mb-6">
                    {pkg.description}
                  </p>

                  <div className="space-y-4 mb-6">
                    {Object.entries(pkg.features).map(([category, items]: [string, any]) => (
                      <div key={category}>
                        <h4 className="text-[#d3bb73] text-sm font-medium mb-2 uppercase">
                          {category}
                        </h4>
                        <ul className="space-y-1">
                          {items.map((item: string, idx: number) => (
                            <li key={idx} className="flex items-start gap-2 text-[#e5e4e2]/70 text-sm">
                              <CheckCircle className="w-4 h-4 text-[#d3bb73] mt-0.5 flex-shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => setIsContactFormOpen(true)}
                    className={`w-full py-3 rounded-lg font-medium transition-all ${
                      pkg.package_level === 'pro'
                        ? 'bg-[#d3bb73] text-[#1c1f33] hover:bg-[#c5ad65]'
                        : 'bg-[#d3bb73]/10 text-[#d3bb73] border border-[#d3bb73]/30 hover:bg-[#d3bb73]/20'
                    }`}
                  >
                    Zapytaj o wycenę
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Case Studies */}
        <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Nasze realizacje
            </h2>
            <p className="text-[#e5e4e2]/60 text-center mb-16">
              Przykłady obsłużonych konferencji i eventów
            </p>

            <div className="space-y-12">
              {caseStudies.map((study) => (
                <div key={study.id} className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-8">
                  <div className="grid md:grid-cols-2 gap-8">
                    <div>
                      <h3 className="text-2xl font-medium text-[#e5e4e2] mb-2">
                        {study.project_name}
                      </h3>
                      {study.client_name && (
                        <p className="text-[#d3bb73] mb-4">{study.client_name}</p>
                      )}
                      <p className="text-[#e5e4e2]/60 mb-6">{study.event_type}</p>

                      {study.attendees_count && (
                        <div className="flex items-center gap-2 text-[#e5e4e2]/80 mb-4">
                          <Users className="w-5 h-5 text-[#d3bb73]" />
                          <span>{study.attendees_count} uczestników</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div>
                        <h4 className="text-[#d3bb73] font-medium mb-2">Wyzwanie</h4>
                        <p className="text-[#e5e4e2]/70 text-sm">{study.challenge}</p>
                      </div>

                      <div>
                        <h4 className="text-[#d3bb73] font-medium mb-2">Rozwiązanie</h4>
                        <p className="text-[#e5e4e2]/70 text-sm">{study.solution}</p>
                      </div>

                      <div>
                        <h4 className="text-[#d3bb73] font-medium mb-2">Rezultat</h4>
                        <p className="text-[#e5e4e2]/70 text-sm">{study.result}</p>
                      </div>

                      <div>
                        <h4 className="text-[#d3bb73] font-medium mb-2">Wykorzystany sprzęt</h4>
                        <div className="flex flex-wrap gap-2">
                          {study.equipment_used.map((eq: string, idx: number) => (
                            <span key={idx} className="text-xs px-3 py-1 bg-[#d3bb73]/10 text-[#e5e4e2]/80 rounded-full">
                              {eq}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Advantages */}
        <section className="py-20 px-6 bg-[#1c1f33]/30">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-16 text-center">
              Dlaczego MAVINCI?
            </h2>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {advantages.map((adv) => {
                const Icon = getIcon(adv.icon_name);
                return (
                  <div key={adv.id} className="flex gap-4">
                    <div className="w-12 h-12 bg-[#d3bb73] rounded-full flex items-center justify-center flex-shrink-0">
                      <Icon className="w-6 h-6 text-[#1c1f33]" />
                    </div>
                    <div>
                      <h3 className="text-xl font-medium text-[#e5e4e2] mb-2">
                        {adv.title}
                      </h3>
                      <p className="text-[#e5e4e2]/70 text-sm">
                        {adv.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Process */}
        <section className="py-20 px-6">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Proces współpracy
            </h2>
            <p className="text-[#e5e4e2]/60 text-center mb-16">
              Krok po kroku do profesjonalnej realizacji
            </p>

            <div className="space-y-6">
              {process.map((step) => {
                const Icon = getIcon(step.icon_name);
                return (
                  <div key={step.id} className="flex gap-6 items-start">
                    <div className="w-16 h-16 bg-[#d3bb73] rounded-full flex items-center justify-center flex-shrink-0">
                      <Icon className="w-8 h-8 text-[#1c1f33]" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-2xl font-medium text-[#e5e4e2]">
                          {step.step_title}
                        </h3>
                        {step.duration_info && (
                          <span className="text-xs text-[#d3bb73] px-3 py-1 bg-[#d3bb73]/10 rounded-full">
                            {step.duration_info}
                          </span>
                        )}
                      </div>
                      <p className="text-[#e5e4e2]/70">
                        {step.step_description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="py-20 px-6 bg-[#1c1f33]/30">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Orientacyjne ceny
            </h2>
            <p className="text-[#e5e4e2]/60 text-center mb-16">
              Finalna wycena zależy od zakresu technicznego i specyfiki wydarzenia
            </p>

            <div className="grid md:grid-cols-3 gap-8">
              {pricing.map((tier) => (
                <div key={tier.id} className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                  <h3 className="text-xl font-medium text-[#e5e4e2] mb-2">
                    {tier.tier_name}
                  </h3>
                  <p className="text-[#e5e4e2]/60 text-sm mb-4">
                    {tier.tier_description}
                  </p>

                  <div className="mb-4">
                    <div className="text-3xl font-light text-[#d3bb73] mb-1">
                      {tier.price_range}
                    </div>
                    <div className="text-[#e5e4e2]/60 text-sm">
                      {tier.attendees_range}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {tier.whats_included.map((item: string, idx: number) => (
                      <div key={idx} className="flex items-start gap-2 text-[#e5e4e2]/70 text-sm">
                        <CheckCircle className="w-4 h-4 text-[#d3bb73] mt-0.5 flex-shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-12 text-center">
              <button
                onClick={() => setIsContactFormOpen(true)}
                className="px-8 py-4 bg-[#d3bb73] text-[#1c1f33] font-medium rounded-lg hover:bg-[#c5ad65] transition-all"
              >
                Zapytaj o szczegółową wycenę
              </button>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-16 text-center">
              Najczęściej zadawane pytania
            </h2>

            <div className="space-y-4">
              {faq.map((item, idx) => (
                <div key={item.id} className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                    className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-[#d3bb73]/5 transition-colors"
                  >
                    <span className="text-lg text-[#e5e4e2] font-medium pr-4">
                      {item.question}
                    </span>
                    <ChevronDown className={`w-5 h-5 text-[#d3bb73] transition-transform flex-shrink-0 ${expandedFaq === idx ? 'rotate-180' : ''}`} />
                  </button>
                  {expandedFaq === idx && (
                    <div className="px-6 pb-4 text-[#e5e4e2]/70">
                      {item.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Related Services Section */}
        {(relatedServices.length > 0 || isEditMode) && (
          <section className="py-20 px-6 bg-gradient-to-b from-[#0f1119] to-[#1c1f33]">
            <div className="max-w-7xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
                  Nasze <span className="text-[#d3bb73]">Usługi</span> Konferencyjne
                </h2>
                <p className="text-[#e5e4e2]/70 text-lg">
                  Poznaj szczegóły naszych rozwiązań technicznych
                </p>
              </div>

              {isEditMode && (
                <div className="mb-8 bg-[#1c1f33] border-2 border-[#d3bb73] rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[#d3bb73] text-lg font-medium">Tryb edycji - Wybierz usługi do wyświetlenia</h3>
                    <span className="text-[#e5e4e2]/60 text-sm">
                      Wybrano: {selectedServiceIds.size}
                    </span>
                  </div>
                  <p className="text-[#e5e4e2]/70 text-sm mb-4">
                    Wybierz usługi, które mają być wyświetlane w tej sekcji. Zmiany zapisują się automatycznie.
                  </p>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto pr-2">
                    {allServiceItems.map((item) => (
                      <label
                        key={item.id}
                        className={`flex items-start gap-3 p-3 bg-[#0f1119] border rounded-lg cursor-pointer transition-all ${
                          selectedServiceIds.has(item.id)
                            ? 'border-[#d3bb73] bg-[#d3bb73]/5'
                            : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedServiceIds.has(item.id)}
                          onChange={async (e) => {
                            const newSelected = new Set(selectedServiceIds);
                            setIsSaving(true);

                            try {
                              if (e.target.checked) {
                                newSelected.add(item.id);
                                setSelectedServiceIds(newSelected);

                                await supabase.from('conferences_related_services').insert({
                                  service_item_id: item.id,
                                  display_order: newSelected.size
                                });
                              } else {
                                newSelected.delete(item.id);
                                setSelectedServiceIds(newSelected);

                                await supabase.from('conferences_related_services')
                                  .delete()
                                  .eq('service_item_id', item.id);
                              }
                            } finally {
                              setTimeout(() => setIsSaving(false), 500);
                            }
                          }}
                          className="mt-1 w-5 h-5 rounded border-[#d3bb73] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-0 cursor-pointer"
                        />

                        {item.thumbnail_url && (
                          <div className="w-16 h-16 rounded-lg overflow-hidden bg-[#0f1119] border border-[#d3bb73]/10 flex-shrink-0">
                            <img
                              src={item.thumbnail_url}
                              alt={item.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <span className="text-[#e5e4e2] text-sm font-medium block mb-1">{item.name}</span>
                          {item.description && (
                            <span className="text-[#e5e4e2]/60 text-xs line-clamp-2">{item.description}</span>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="mt-6 flex items-center justify-between pt-4 border-t border-[#d3bb73]/20">
                    <div className="flex items-center gap-2">
                      {isSaving ? (
                        <span className="text-[#d3bb73] text-sm flex items-center gap-2">
                          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Zapisywanie...
                        </span>
                      ) : (
                        <span className="text-green-500 text-sm flex items-center gap-2">
                          <CheckCircle className="w-4 h-4" />
                          Zapisano automatycznie
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => loadData()}
                      className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Odśwież podgląd
                    </button>
                  </div>
                </div>
              )}

              {/* Infinite Carousel */}
              <div className="relative overflow-hidden" ref={carouselRef}>
                <div
                  className="flex gap-6 transition-transform duration-700 ease-out"
                  style={{ transform: `translateX(-${currentIndex * (100 / 3)}%)` }}
                >
                  {triplicatedServices.map((service, idx) => {
                    const Icon = iconMap[service.icon] || Package;
                    return (
                      <Link
                        key={`${service.id}-${idx}`}
                        href={`/uslugi/${service.slug}`}
                        className="flex-shrink-0 w-full sm:w-[calc(50%-12px)] lg:w-[calc(33.333%-16px)] group bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl overflow-hidden hover:border-[#d3bb73]/40 transition-all hover:-translate-y-1"
                      >
                        {service.thumbnail_url && (
                          <div className="aspect-video overflow-hidden bg-[#0f1119]">
                            <img
                              src={service.thumbnail_url}
                              alt={service.name}
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                            />
                          </div>
                        )}
                        <div className="p-6">
                          <div className="w-12 h-12 rounded-lg bg-[#d3bb73]/10 flex items-center justify-center mb-4 group-hover:bg-[#d3bb73]/20 transition-colors">
                            <Icon className="w-6 h-6 text-[#d3bb73]" />
                          </div>
                          <h3 className="text-[#e5e4e2] text-lg font-medium mb-2 group-hover:text-[#d3bb73] transition-colors">
                            {service.name}
                          </h3>
                          {service.description && (
                            <p className="text-[#e5e4e2]/60 text-sm line-clamp-2">
                              {service.description}
                            </p>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>

                {/* Navigation Arrows */}
                {relatedServices.length > 3 && (
                  <>
                    <button
                      onClick={handlePrev}
                      className="absolute left-0 top-1/2 -translate-y-1/2 bg-[#d3bb73] text-[#1c1f33] p-3 rounded-full hover:bg-[#d3bb73]/90 transition-all z-10 shadow-lg"
                      aria-label="Previous services"
                    >
                      <ArrowLeft className="w-6 h-6" />
                    </button>
                    <button
                      onClick={handleNext}
                      className="absolute right-0 top-1/2 -translate-y-1/2 bg-[#d3bb73] text-[#1c1f33] p-3 rounded-full hover:bg-[#d3bb73]/90 transition-all z-10 shadow-lg"
                      aria-label="Next services"
                    >
                      <ArrowLeft className="w-6 h-6 rotate-180" />
                    </button>
                  </>
                )}
              </div>

              {/* Dots Indicator */}
              {relatedServices.length > 1 && (
                <div className="flex justify-center gap-2 mt-8">
                  {relatedServices.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentIndex(idx + relatedServices.length)}
                      className={`w-2 h-2 rounded-full transition-all ${
                        currentIndex % relatedServices.length === idx
                          ? 'bg-[#d3bb73] w-8'
                          : 'bg-[#d3bb73]/30 hover:bg-[#d3bb73]/50'
                      }`}
                      aria-label={`Go to service ${idx + 1}`}
                    />
                  ))}
                </div>
              )}

              <div className="text-center mt-12">
                <Link
                  href="/uslugi"
                  className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-all"
                >
                  Zobacz wszystkie usługi
                  <ArrowLeft className="w-4 h-4 rotate-180" />
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* Contact CTA */}
        <section className="py-20 px-6 bg-gradient-to-br from-[#1c1f33] to-[#0f1119]">
          <div className="max-w-4xl mx-auto text-center">
            <div className="w-20 h-20 bg-[#d3bb73] rounded-full flex items-center justify-center mx-auto mb-6">
              <Mail className="w-10 h-10 text-[#1c1f33]" />
            </div>
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4">
              Porozmawiajmy o Twojej konferencji
            </h2>
            <p className="text-xl text-[#e5e4e2]/70 mb-8">
              Odpowiadamy w ciągu 24 godzin
            </p>
            <button
              onClick={() => setIsContactFormOpen(true)}
              className="px-10 py-4 bg-[#d3bb73] text-[#1c1f33] font-medium rounded-lg hover:bg-[#c5ad65] transition-all text-lg"
            >
              Wyceń swoją konferencję
            </button>
          </div>
        </section>

        <ContactFormWithTracking
          isOpen={isContactFormOpen}
          onClose={() => setIsContactFormOpen(false)}
          sourcePage="Konferencje"
          sourceSection="conferences"
          defaultEventType="Konferencja"
        />
      </div>
      <Footer />

      <style jsx global>{`
        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fade-in-up {
          animation: fade-in-up 0.8s ease-out forwards;
          opacity: 0;
        }
      `}</style>
    </>
  );
}
