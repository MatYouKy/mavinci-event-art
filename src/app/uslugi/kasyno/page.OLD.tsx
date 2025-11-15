'use client';

import { useState, useEffect } from 'react';
import { Dices, Spade, CheckCircle2, ArrowLeft, ChevronLeft, ChevronRight, XCircle } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';
import CasinoLegalPopup from '@/components/CasinoLegalPopup';
import { supabase } from '@/lib/supabase';

interface CasinoTable {
  id: string;
  name: string;
  slug: string;
  description: string;
  image_url: string;
  image_alt: string;
  order_index: number;
}

interface CasinoFeature {
  id: string;
  title: string;
  icon_name: string;
  order_index: number;
}

interface CasinoGameRule {
  id: string;
  game_name: string;
  slug: string;
  short_description: string;
  rules_content: string;
  order_index: number;
}

interface GalleryImage {
  id: string;
  image_url: string;
  alt_text: string;
  caption: string;
}

interface ContentBlock {
  id: string;
  title: string;
  content: string;
  layout_type: 'grid-4' | 'grid-3' | 'grid-2' | 'grid-1';
  order_index: number;
}

export default function KasynoPage() {
  const [showContent, setShowContent] = useState(false);
  const [legalContent, setLegalContent] = useState('');
  const [tables, setTables] = useState<CasinoTable[]>([]);
  const [features, setFeatures] = useState<CasinoFeature[]>([]);
  const [gameRules, setGameRules] = useState<CasinoGameRule[]>([]);
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([]);
  const [currentGalleryIndex, setCurrentGalleryIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const { data: popupData } = await supabase
      .from('casino_legal_popup')
      .select('*')
      .eq('is_active', true)
      .single();

    if (popupData) {
      setLegalContent(popupData.content);
    }

    const { data: tablesData } = await supabase
      .from('casino_tables')
      .select('*')
      .eq('is_visible', true)
      .order('order_index');
    if (tablesData) setTables(tablesData);

    const { data: featuresData } = await supabase
      .from('casino_features')
      .select('*')
      .eq('is_visible', true)
      .order('order_index');
    if (featuresData) setFeatures(featuresData);

    const { data: rulesData } = await supabase
      .from('casino_game_rules')
      .select('*')
      .eq('is_visible', true)
      .order('order_index');
    if (rulesData) setGameRules(rulesData);

    const { data: galleryData } = await supabase
      .from('casino_gallery')
      .select('*')
      .eq('is_visible', true)
      .order('order_index');
    if (galleryData) setGallery(galleryData);

    const { data: blocksData } = await supabase
      .from('casino_content_blocks')
      .select('*')
      .eq('is_visible', true)
      .order('order_index');
    if (blocksData) setContentBlocks(blocksData);
  };

  const openLightbox = (index: number) => {
    setCurrentGalleryIndex(index);
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
  };

  const nextImage = () => {
    setCurrentGalleryIndex((prev) => (prev + 1) % gallery.length);
  };

  const prevImage = () => {
    setCurrentGalleryIndex((prev) => (prev - 1 + gallery.length) % gallery.length);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!lightboxOpen) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') prevImage();
      if (e.key === 'ArrowRight') nextImage();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen, gallery.length]);

  const getGridClass = (layout: string) => {
    switch (layout) {
      case 'grid-4': return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4';
      case 'grid-3': return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
      case 'grid-2': return 'grid-cols-1 md:grid-cols-2';
      case 'grid-1': return 'grid-cols-1';
      default: return 'grid-cols-1';
    }
  };

  return (
    <>
      {legalContent && (
        <CasinoLegalPopup
          content={legalContent}
          onAccept={() => setShowContent(true)}
        />
      )}

      {showContent && (
        <>
          <Navbar />
          <main className="min-h-screen bg-[#0f1119]">
            <PageHeroImage
              section="kasyno"
              defaultImage="https://images.pexels.com/photos/262508/pexels-photo-262508.jpeg?auto=compress&cs=tinysrgb&w=1920"
              defaultOpacity={0.2}
              className="py-24 md:py-32 overflow-hidden"
            >
              <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <Link href="/#uslugi" className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors mb-8">
                  <ArrowLeft className="w-4 h-4" />
                  Powrót do usług
                </Link>

                <div className="grid lg:grid-cols-2 gap-12 items-center">
                  <div>
                    <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                      <Dices className="w-5 h-5 text-[#d3bb73]" />
                      <span className="text-[#d3bb73] text-sm font-medium">Wieczory w Kasynie</span>
                    </div>

                    <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                      Kasyno <span className="text-[#d3bb73]">Eventowe</span>
                    </h1>

                    <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed mb-4">
                      Profesjonalna agencja eventowa oferująca stoły kasynowe jako formę rozrywki. Przenieś swoich gości do świata Las Vegas bez elementów hazardu!
                    </p>

                    <p className="text-[#e5e4e2]/50 text-sm font-light leading-relaxed mb-8">
                      Nie prowadzimy gier losowych - wszystkie gry są prowadzone wyłącznie w celach rozrywkowych podczas eventów firmowych i imprez okolicznościowych.
                    </p>

                    <div className="flex flex-wrap gap-4">
                      <a href="/#kontakt" className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors">
                        Zapytaj o wycenę
                      </a>
                      <Link href="/#uslugi" className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/20 transition-colors">
                        Zobacz inne usługi
                      </Link>
                    </div>
                  </div>

                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 rounded-3xl blur-3xl"></div>
                    <div className="relative bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-3xl p-8">
                      <Spade className="w-24 h-24 text-[#d3bb73] mb-6" />
                      <h3 className="text-2xl font-light text-[#e5e4e2] mb-4">Elegancja i Rozrywka</h3>
                      <p className="text-[#e5e4e2]/70 font-light">
                        Klimat prawdziwego kasyna, profesjonalni krupierzy i niezapomniana atmosfera gier w bezpiecznym środowisku eventowym bez hazardu.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </PageHeroImage>

            {features.length > 0 && (
              <section className="py-24 bg-[#0f1119]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Co Oferujemy</h2>
                    <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
                  </div>

                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {features.map((feature) => (
                      <div key={feature.id} className="flex items-start gap-3 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all duration-300">
                        <CheckCircle2 className="w-5 h-5 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                        <span className="text-[#e5e4e2]/90 font-light">{feature.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {tables.length > 0 && (
              <section className="py-24 bg-gradient-to-br from-[#1c1f33] to-[#0f1119]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Nasze Stoły</h2>
                    <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
                  </div>

                  <div className="space-y-16">
                    {tables.map((table, index) => (
                      <div key={table.id} className={`grid lg:grid-cols-2 gap-12 items-center ${index % 2 === 1 ? 'lg:flex-row-reverse' : ''}`}>
                        <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                          <div className="relative group">
                            <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-transparent rounded-2xl blur-xl group-hover:blur-2xl transition-all"></div>
                            <img
                              src={table.image_url}
                              alt={table.image_alt || table.name}
                              className="relative w-full h-[400px] object-cover rounded-2xl border border-[#d3bb73]/20"
                            />
                          </div>
                        </div>
                        <div className={index % 2 === 1 ? 'lg:order-1' : ''}>
                          <h3 className="text-3xl font-light text-[#e5e4e2] mb-4">{table.name}</h3>
                          <p className="text-[#e5e4e2]/70 font-light leading-relaxed">
                            {table.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {gallery.length > 0 && (
              <section className="py-24 bg-[#0f1119]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Galeria</h2>
                    <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {gallery.map((image, index) => (
                      <div
                        key={image.id}
                        onClick={() => openLightbox(index)}
                        className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-[#d3bb73]/10 hover:border-[#d3bb73]/30 transition-all duration-300 cursor-pointer"
                      >
                        <img
                          src={image.image_url}
                          alt={image.alt_text || `Zdjęcie z kasyna ${index + 1}`}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119]/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          <div className="absolute bottom-4 left-4 right-4">
                            <p className="text-[#e5e4e2] text-sm font-light">
                              {image.alt_text || `Zdjęcie ${index + 1}`}
                            </p>
                            {image.caption && (
                              <p className="text-[#e5e4e2]/60 text-xs font-light mt-1">
                                {image.caption}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {gameRules.length > 0 && (
              <section className="py-24 bg-gradient-to-br from-[#1c1f33] to-[#0f1119]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Zasady Gier</h2>
                    <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
                    <p className="text-[#e5e4e2]/60 font-light mt-4 max-w-2xl mx-auto">
                      Poznaj szczegółowe zasady naszych gier kasynowych
                    </p>
                  </div>

                  <div className="grid lg:grid-cols-3 gap-8">
                    {gameRules.map((rule) => {
                      const ruleLinks: { [key: string]: string } = {
                        'poker-texas-holdem': '/uslugi/kasyno/zasady/poker',
                        'ruletka': '/uslugi/kasyno/zasady/ruletka',
                        'blackjack': '/uslugi/kasyno/zasady/blackjack',
                      };

                      return (
                        <Link
                          key={rule.id}
                          href={ruleLinks[rule.slug] || '/uslugi/kasyno'}
                          className="group bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-2xl p-8 hover:border-[#d3bb73]/30 transition-all"
                        >
                          <h3 className="text-2xl font-light text-[#e5e4e2] mb-3 group-hover:text-[#d3bb73] transition-colors">
                            {rule.game_name}
                          </h3>
                          <p className="text-[#e5e4e2]/60 text-sm font-light mb-6">
                            {rule.short_description}
                          </p>
                          <div className="text-[#d3bb73] text-sm font-medium flex items-center gap-2 group-hover:gap-3 transition-all">
                            Czytaj więcej
                            <ArrowLeft className="w-4 h-4 rotate-180" />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {contentBlocks.length > 0 && (
              <section className="py-24 bg-[#0f1119]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
                  {contentBlocks.map((block) => (
                    <div key={block.id}>
                      <h2 className="text-3xl font-light text-[#e5e4e2] mb-8 text-center">{block.title}</h2>
                      <div className={`grid ${getGridClass(block.layout_type)} gap-6`}>
                        <div className="bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-2xl p-8">
                          <div className="prose prose-invert max-w-none">
                            <div className="text-[#e5e4e2]/80 font-light leading-relaxed whitespace-pre-line">
                              {block.content}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
              <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                <Dices className="w-16 h-16 text-[#d3bb73] mx-auto mb-6" />
                <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
                  Zorganizujmy Wieczór w Kasynie!
                </h2>
                <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
                  Skontaktuj się z nami, aby przygotować niezapomniane kasyno eventowe. Zapewnimy profesjonalną obsługę i klimat prawdziwego Las Vegas bez elementów hazardu.
                </p>
                <a href="/#kontakt" className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors">
                  Skontaktuj się z nami
                </a>
              </div>
            </section>
          </main>
          <Footer />

          {lightboxOpen && gallery.length > 0 && (
            <div className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center">
              <button
                onClick={closeLightbox}
                className="absolute top-4 right-4 text-white hover:text-[#d3bb73] transition-colors z-10"
                aria-label="Zamknij"
              >
                <XCircle className="w-10 h-10" />
              </button>

              {gallery.length > 1 && (
                <>
                  <button
                    onClick={prevImage}
                    className="absolute left-4 text-white hover:text-[#d3bb73] transition-colors z-10"
                    aria-label="Poprzednie zdjęcie"
                  >
                    <ChevronLeft className="w-12 h-12" />
                  </button>
                  <button
                    onClick={nextImage}
                    className="absolute right-4 text-white hover:text-[#d3bb73] transition-colors z-10"
                    aria-label="Następne zdjęcie"
                  >
                    <ChevronRight className="w-12 h-12" />
                  </button>
                </>
              )}

              <div className="relative max-w-7xl max-h-[90vh] mx-4">
                <img
                  src={gallery[currentGalleryIndex].image_url}
                  alt={gallery[currentGalleryIndex].alt_text || `Zdjęcie ${currentGalleryIndex + 1}`}
                  className="max-w-full max-h-[90vh] object-contain"
                />

                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                  <p className="text-white text-center">
                    {gallery[currentGalleryIndex].alt_text || `Zdjęcie ${currentGalleryIndex + 1}`}
                  </p>
                  {gallery[currentGalleryIndex].caption && (
                    <p className="text-white/80 text-sm text-center mt-1">
                      {gallery[currentGalleryIndex].caption}
                    </p>
                  )}
                  <p className="text-white/60 text-sm text-center mt-2">
                    {currentGalleryIndex + 1} / {gallery.length}
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
