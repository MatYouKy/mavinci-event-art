'use client';

import { useEffect, useState } from 'react';
import { useParams, notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Head from 'next/head';
import Link from 'next/link';
import {
  ArrowLeft, Check, Star, Mail, Phone, Calendar,
  Package, Award, Shield, Zap, Info, Edit2, ChevronLeft, ChevronRight
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ContactFormWithTracking from '@/components/ContactFormWithTracking';
import { AdminServiceEditor } from '@/components/AdminServiceEditor';
import { useEditMode } from '@/contexts/EditModeContext'; 

export default function ServiceDetailPage() {
  const params = useParams();
  const { isEditMode, setIsEditMode } = useEditMode();
  const [service, setService] = useState<any>(null);
  const [category, setCategory] = useState<any>(null);
  const [relatedServices, setRelatedServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isContactFormOpen, setIsContactFormOpen] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);

  useEffect(() => {
    loadServiceData();
  }, [params.slug]);

  const loadServiceData = async () => {
    try {
      const { data: serviceData, error: serviceError } = await supabase
        .from('conferences_service_items')
        .select('*')
        .eq('slug', params.slug)
        .eq('is_active', true)
        .maybeSingle();

      if (!serviceData || serviceError) {
        notFound();
        return;
      }

      setService(serviceData);

      const { data: categoryData } = await supabase
        .from('conferences_service_categories')
        .select('*')
        .eq('id', serviceData.category_id)
        .eq('is_active', true)
        .maybeSingle();

      if (categoryData) {
        setCategory(categoryData);

        const { data: related } = await supabase
          .from('conferences_service_items')
          .select('*')
          .eq('category_id', categoryData.id)
          .eq('is_active', true)
          .neq('id', serviceData.id)
          .limit(3);

        if (related) {
          setRelatedServices(related);
        }
      }
    } catch (error) {
      console.error('Error loading service:', error);
      notFound();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (service) {
      document.title = service.seo_title || `${service.name} - MAVINCI Event & ART`;
    }
  }, [service]);

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
          <div className="text-[#d3bb73] text-lg">Ładowanie...</div>
        </div>
      </>
    );
  }

  if (!service) {
    notFound();
    return null;
  }

  const features = Array.isArray(service.features) ? service.features : [];
  const technicalSpecs = service.technical_specs || {};

  return (
    <>
      <Head>
        <title>{service.seo_title || `${service.name} - MAVINCI Event & ART`}</title>
        <meta name="description" content={service.seo_description || service.description} />
        {service.seo_keywords && <meta name="keywords" content={service.seo_keywords} />}

        <meta property="og:type" content="product" />
        <meta property="og:title" content={service.seo_title || service.name} />
        <meta property="og:description" content={service.seo_description || service.description} />
        <meta property="og:url" content={`https://mavinci.pl/oferta/uslugi/${service.slug}`} />
        <meta property="og:image" content={service.hero_image_url || service.thumbnail_url} />
        <meta property="og:site_name" content="MAVINCI Event & ART" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={service.seo_title || service.name} />
        <meta name="twitter:description" content={service.seo_description || service.description} />
        <meta name="twitter:image" content={service.hero_image_url || service.thumbnail_url} />

        <link rel="canonical" href={`https://mavinci.pl/oferta/uslugi/${service.slug}`} />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Product',
              name: service.name,
              description: service.long_description || service.description,
              image: service.hero_image_url,
              brand: {
                '@type': 'Brand',
                name: 'MAVINCI Event & ART'
              },
              offers: {
                '@type': 'Offer',
                availability: 'https://schema.org/InStock',
                priceCurrency: 'PLN'
              }
            })
          }}
        />
      </Head>

      <Navbar />
      <div className="min-h-screen bg-[#0f1119]">
        {/* Hero Section with Image */}
        <section className="relative h-[60vh] min-h-[500px] overflow-hidden">
          {service.hero_image_url && (
            <>
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${service.hero_image_url})` }}
              />
              <div className="absolute inset-0 bg-gradient-to-b from-[#0f1119]/60 via-[#0f1119]/80 to-[#0f1119]" />
            </>
          )}

         

          <div className="relative h-full flex items-end pb-20 px-6">
            <div className="max-w-7xl mx-auto w-full">
              <Link
                href="/uslugi"
                className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors mb-6"
              >
                <ArrowLeft className="w-4 h-4" />
                Powrót do katalogu
              </Link>

              <div className="mb-4">
                {category && (
                  <Link
                    href="/uslugi"
                    className="inline-block text-[#d3bb73] text-sm font-medium mb-2 hover:underline"
                  >
                    {category.name}
                  </Link>
                )}
                {service.is_premium && (
                  <div className="inline-flex items-center gap-2 bg-[#d3bb73]/20 border border-[#d3bb73] rounded-full px-4 py-1 ml-3">
                    <Star className="w-4 h-4 text-[#d3bb73] fill-[#d3bb73]" />
                    <span className="text-[#d3bb73] text-sm font-medium">Premium</span>
                  </div>
                )}
              </div>

              <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6 max-w-4xl">
                {service.name}
              </h1>

              <p className="text-[#e5e4e2]/80 text-xl font-light max-w-3xl">
                {service.description}
              </p>
            </div>
          </div>
        </section>

        {/* Main Content */}
        <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="grid lg:grid-cols-3 gap-12">
              {/* Main Info */}
              <div className="lg:col-span-2 space-y-12">
                {/* Description */}
                {service.long_description && (
                  <div>
                    <h2 className="text-3xl font-light text-[#e5e4e2] mb-6">
                      Szczegóły usługi
                    </h2>
                    <p className="text-[#e5e4e2]/70 text-lg leading-relaxed whitespace-pre-line">
                      {service.long_description}
                    </p>
                  </div>
                )}

                {/* Features */}
                {features.length > 0 && (
                  <div>
                    <h2 className="text-3xl font-light text-[#e5e4e2] mb-6">
                      Co oferujemy
                    </h2>
                    <div className="grid md:grid-cols-2 gap-4">
                      {features.map((feature: string, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-start gap-3 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-4"
                        >
                          <Check className="w-5 h-5 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                          <span className="text-[#e5e4e2]/80">{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Technical Specs */}
                {Object.keys(technicalSpecs).length > 0 && (
                  <div>
                    <h2 className="text-3xl font-light text-[#e5e4e2] mb-6 flex items-center gap-3">
                      <Info className="w-8 h-8 text-[#d3bb73]" />
                      Specyfikacja techniczna
                    </h2>
                    <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-2xl overflow-hidden">
                      <table className="w-full">
                        <tbody>
                          {Object.entries(technicalSpecs).map(([key, value], idx) => (
                            <tr
                              key={idx}
                              className="border-b border-[#d3bb73]/10 last:border-0"
                            >
                              <td className="px-6 py-4 text-[#e5e4e2] font-medium capitalize">
                                {key.replace(/_/g, ' ')}
                              </td>
                              <td className="px-6 py-4 text-[#e5e4e2]/70">
                                {String(value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Why MAVINCI */}
                <div className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] border border-[#d3bb73]/20 rounded-2xl p-8">
                  <h2 className="text-3xl font-light text-[#e5e4e2] mb-6">
                    Dlaczego <span className="text-[#d3bb73]">MAVINCI</span>?
                  </h2>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Award className="w-6 h-6 text-[#d3bb73]" />
                      </div>
                      <div>
                        <h4 className="text-[#e5e4e2] font-medium mb-1">Doświadczenie od 2015</h4>
                        <p className="text-[#e5e4e2]/60 text-sm">Setki zrealizowanych eventów dla topowych klientów</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Shield className="w-6 h-6 text-[#d3bb73]" />
                      </div>
                      <div>
                        <h4 className="text-[#e5e4e2] font-medium mb-1">Ubezpieczenie OC 1M PLN</h4>
                        <p className="text-[#e5e4e2]/60 text-sm">Pełne bezpieczeństwo dla Twojego wydarzenia</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Package className="w-6 h-6 text-[#d3bb73]" />
                      </div>
                      <div>
                        <h4 className="text-[#e5e4e2] font-medium mb-1">Własny sprzęt premium</h4>
                        <p className="text-[#e5e4e2]/60 text-sm">CODA Audio, Blackmagic, Shure Axient Digital</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Zap className="w-6 h-6 text-[#d3bb73]" />
                      </div>
                      <div>
                        <h4 className="text-[#e5e4e2] font-medium mb-1">24/7 Wsparcie techniczne</h4>
                        <p className="text-[#e5e4e2]/60 text-sm">Zawsze dostępni podczas Twojego eventu</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                {/* CTA Card */}
                <div className="bg-gradient-to-br from-[#d3bb73]/10 to-[#1c1f33] border border-[#d3bb73]/30 rounded-2xl p-8 sticky top-24">
                  <h3 className="text-2xl font-light text-[#e5e4e2] mb-4">
                    Zainteresowany?
                  </h3>
                  <p className="text-[#e5e4e2]/70 text-sm mb-6">
                    Skontaktuj się z nami i otrzymaj indywidualną wycenę dostosowaną do Twojego eventu.
                  </p>

                  <div className="space-y-3 mb-6">
                    <button
                      onClick={() => setIsContactFormOpen(true)}
                      className="w-full inline-flex items-center justify-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-all"
                    >
                      <Mail className="w-4 h-4" />
                      Wyślij zapytanie
                    </button>

                    <a
                      href="tel:+48123456789"
                      className="w-full inline-flex items-center justify-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/30 text-[#e5e4e2] px-6 py-3 rounded-full text-sm font-medium hover:border-[#d3bb73] transition-all"
                    >
                      <Phone className="w-4 h-4" />
                      Zadzwoń
                    </a>
                  </div>

                  <div className="flex items-start gap-3 text-[#e5e4e2]/60 text-xs">
                    <Calendar className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>Odpowiedź w 24h • Bezpłatna konsultacja • Wycena bez zobowiązań</span>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </section>

        {/* Related Services Carousel */}
        {relatedServices.length > 0 && (
          <section className="py-20 px-6 bg-gradient-to-b from-[#0f1119] to-[#1c1f33]">
            <div className="max-w-7xl mx-auto">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-light text-[#e5e4e2]">
                  Podobne usługi z kategorii <span className="text-[#d3bb73]">{category?.name}</span>
                </h2>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCarouselIndex(Math.max(0, carouselIndex - 1))}
                    disabled={carouselIndex === 0}
                    className="bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] p-3 rounded-full hover:border-[#d3bb73]/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setCarouselIndex(Math.min(relatedServices.length - 1, carouselIndex + 1))}
                    disabled={carouselIndex >= relatedServices.length - 1}
                    className="bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] p-3 rounded-full hover:border-[#d3bb73]/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="relative overflow-hidden">
                <div
                  className="flex transition-transform duration-500 ease-out gap-6"
                  style={{
                    transform: `translateX(-${carouselIndex * (100 / 3 + 2)}%)`
                  }}
                >
                  {relatedServices.map((related) => (
                    <Link
                      key={related.id}
                      href={`/uslugi/${related.slug}`}
                      className="group bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl overflow-hidden hover:border-[#d3bb73]/40 transition-all flex-shrink-0"
                      style={{ width: 'calc(33.333% - 16px)' }}
                    >
                      {related.thumbnail_url && (
                        <div className="aspect-video overflow-hidden bg-[#0f1119]">
                          <img
                            src={related.thumbnail_url}
                            alt={related.name}
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                          />
                        </div>
                      )}
                      <div className="p-6">
                        <h3 className="text-lg font-medium text-[#e5e4e2] mb-2 group-hover:text-[#d3bb73] transition-colors">
                          {related.name}
                        </h3>
                        {related.description && (
                          <p className="text-[#e5e4e2]/60 text-sm line-clamp-2">
                            {related.description}
                          </p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Dots indicator */}
              <div className="flex items-center justify-center gap-2 mt-6">
                {relatedServices.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCarouselIndex(idx)}
                    className={`w-2 h-2 rounded-full transition-all ${
                      idx === carouselIndex ? 'bg-[#d3bb73] w-8' : 'bg-[#e5e4e2]/20'
                    }`}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        {isContactFormOpen && (
          <ContactFormWithTracking
            isOpen={isContactFormOpen}
            onClose={() => setIsContactFormOpen(false)}
            sourcePage={`/uslugi/${params.slug}`}
          />
        )}

        {isEditMode && (
          <AdminServiceEditor
            serviceId={service.id}
            onClose={() => setIsEditMode(false)}
            onSaved={loadServiceData}
          />
        )}
      </div>
      <Footer />
    </>
  );
}
