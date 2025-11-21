'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Check, Star, Mail, ChevronLeft, ChevronRight, Edit2, FileText
} from 'lucide-react';
import ContactFormWithTracking from '@/components/ContactFormWithTracking';
import { AdminServiceEditor } from '@/components/AdminServiceEditor';
import ServiceSEOModal from '@/components/ServiceSEOModal';
import { useEditMode } from '@/contexts/EditModeContext';
interface ServiceDetailClientProps {
  service: any;
  category: any;
  relatedServices: any[];
}

export default function ServiceDetailClient({
  service,
  category,
  relatedServices,
}: ServiceDetailClientProps) {
  const router = useRouter();
  const { isEditMode } = useEditMode();
  const [isContactFormOpen, setIsContactFormOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSEOModalOpen, setIsSEOModalOpen] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [itemsPerView, setItemsPerView] = useState(3);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const updateItemsPerView = () => {
      if (window.innerWidth < 768) {
        setItemsPerView(1);
      } else if (window.innerWidth < 1024) {
        setItemsPerView(2);
      } else {
        setItemsPerView(3);
      }
    };

    updateItemsPerView();
    window.addEventListener('resize', updateItemsPerView);
    return () => window.removeEventListener('resize', updateItemsPerView);
  }, []);

  const extendedServices = relatedServices.length > 0
    ? [...relatedServices, ...relatedServices, ...relatedServices]
    : [];

  useEffect(() => {
    if (relatedServices.length > 0) {
      setCarouselIndex(relatedServices.length);
    }
  }, [relatedServices.length]);

  const handlePrev = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setCarouselIndex((prev) => prev - 1);
  };

  const handleNext = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setCarouselIndex((prev) => prev + 1);
  };

  const handleTransitionEnd = () => {
    setIsTransitioning(false);
    if (carouselIndex <= 0) {
      setCarouselIndex(relatedServices.length);
    } else if (carouselIndex >= relatedServices.length * 2) {
      setCarouselIndex(relatedServices.length);
    }
  };

  const features = service.features ? (Array.isArray(service.features) ? service.features : []) : [];
  const technicalSpecs = service.technical_specs || {};

  return (
    <>
      {/* Back Link + Edit Button */}
      <section className="px-6 pt-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link
            href="/uslugi"
            className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Powrót do katalogu
          </Link>

          {isEditMode && (
            <div className="flex gap-2">
              <button
                onClick={() => setIsSEOModalOpen(true)}
                className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
              >
                <FileText className="w-4 h-4" />
                Metadane
              </button>
              <button
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center gap-2 border border-[#d3bb73] text-[#d3bb73] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/10 transition-colors"
              >
                <Edit2 className="w-4 h-4" />
                Edytuj usługę
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Service Header */}
      <section className="px-6 py-12">
        <div className="max-w-7xl mx-auto">
          <div className="mb-4 flex items-center gap-3">
            {category && (
              <Link
                href="/uslugi"
                className="inline-block text-[#d3bb73] text-sm font-medium hover:underline"
              >
                {category.name}
              </Link>
            )}
            {service.is_premium && (
              <div className="inline-flex items-center gap-2 bg-[#d3bb73]/20 border border-[#d3bb73] rounded-full px-4 py-1">
                <Star className="w-4 h-4 text-[#d3bb73] fill-[#d3bb73]" />
                <span className="text-[#d3bb73] text-sm font-medium">Premium</span>
              </div>
            )}
          </div>

          <h1 className="text-4xl md:text-5xl font-light text-[#e5e4e2] mb-6">
            {service.name}
          </h1>

          <p className="text-[#e5e4e2]/80 text-xl font-light max-w-3xl">
            {service.description}
          </p>
        </div>
      </section>

      {/* Main Content */}
      <section className="px-6 py-12">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-3 gap-12">
            {/* Main Info */}
            <div className="lg:col-span-2 space-y-12">
              {/* Thumbnail */}
              {service.thumbnail_url && (
                <div className="rounded-2xl overflow-hidden">
                  <img
                    src={service.thumbnail_url}
                    alt={service.name}
                    className="w-full h-auto object-cover"
                  />
                </div>
              )}

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
                  <h2 className="text-3xl font-light text-[#e5e4e2] mb-6">
                    Specyfikacja techniczna
                  </h2>
                  <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 space-y-4">
                    {Object.entries(technicalSpecs).map(([key, value]: [string, any]) => (
                      <div key={key} className="flex justify-between border-b border-[#d3bb73]/10 pb-4 last:border-0 last:pb-0">
                        <span className="text-[#e5e4e2]/60 font-medium">{key}</span>
                        <span className="text-[#e5e4e2]">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* CTA Card */}
              <div className="bg-gradient-to-br from-[#d3bb73]/10 to-[#d3bb73]/5 border border-[#d3bb73]/30 rounded-2xl p-6 sticky top-6">
                <h3 className="text-xl font-medium text-[#e5e4e2] mb-4">
                  Zainteresowany?
                </h3>
                <p className="text-[#e5e4e2]/70 mb-6">
                  Skontaktuj się z nami, aby uzyskać szczegółową wycenę i omówić szczegóły realizacji.
                </p>
                <button
                  onClick={() => setIsContactFormOpen(true)}
                  className="w-full bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors flex items-center justify-center gap-2"
                >
                  <Mail className="w-4 h-4" />
                  Zapytaj o wycenę
                </button>
                <p className="mt-4 text-xs text-[#e5e4e2]/40 text-center">
                  Odpowiedź w 24h • Bezpłatna konsultacja
                </p>
              </div>

              {/* Category Info */}
              {category && (
                <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-2xl p-6">
                  <h3 className="text-sm font-medium text-[#e5e4e2]/60 mb-2">
                    Kategoria
                  </h3>
                  <Link
                    href="/uslugi"
                    className="text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors"
                  >
                    {category.name}
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Related Services */}
      {relatedServices.length > 0 && (
        <section className="px-6 py-20 bg-[#1c1f33]">
          <div className="max-w-7xl mx-auto">
            <div className="mb-12 text-center">
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
                Podobne usługi
              </h2>
              <p className="text-[#e5e4e2]/60">
                Zobacz inne usługi z kategorii {category?.name}
              </p>
            </div>

            <div className="relative">
              {/* Carousel Navigation */}
              {relatedServices.length > itemsPerView && (
                <>
                  <button
                    onClick={handlePrev}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 bg-[#d3bb73] text-[#1c1f33] p-3 rounded-full hover:bg-[#d3bb73]/90 transition-all shadow-lg"
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </button>
                  <button
                    onClick={handleNext}
                    className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 bg-[#d3bb73] text-[#1c1f33] p-3 rounded-full hover:bg-[#d3bb73]/90 transition-all shadow-lg"
                  >
                    <ChevronRight className="w-6 h-6" />
                  </button>
                </>
              )}

              {/* Carousel */}
              <div className="overflow-hidden">
                <div
                  className={`flex gap-6 ${isTransitioning ? 'transition-transform duration-500 ease-out' : ''}`}
                  style={{
                    transform: `translateX(-${(carouselIndex * 100) / itemsPerView}%)`,
                  }}
                  onTransitionEnd={handleTransitionEnd}
                >
                  {extendedServices.map((item: any, idx: number) => (
                    <Link
                      key={`${item.id}-${idx}`}
                      href={`/uslugi/${item.slug}`}
                      className="flex-shrink-0 rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] overflow-hidden transition-all hover:scale-105 hover:border-[#d3bb73]/40"
                      style={{ width: `calc(${100 / itemsPerView}% - ${(itemsPerView - 1) * 24 / itemsPerView}px)` }}
                    >
                      {item.thumbnail_url && (
                        <div className="aspect-video overflow-hidden bg-[#1c1f33]">
                          <img
                            src={item.thumbnail_url}
                            alt={item.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      )}
                      <div className="p-4">
                        <h3 className="text-lg font-medium text-[#e5e4e2] mb-2">
                          {item.name}
                        </h3>
                        {item.description && (
                          <p className="text-sm text-[#e5e4e2]/60 line-clamp-2">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Contact Form Modal */}
      {isContactFormOpen && (
        <ContactFormWithTracking
          isOpen={isContactFormOpen}
          onClose={() => setIsContactFormOpen(false)}
          sourcePage={`/uslugi/${service.slug}`}
        />
      )}

      {/* SEO Metadata Modal */}
      <ServiceSEOModal
        isOpen={isSEOModalOpen}
        onClose={() => setIsSEOModalOpen(false)}
        serviceId={service.id}
        initialData={{
          name: service.name,
          description: service.description,
          seo_title: service.seo_title,
          seo_description: service.seo_description,
          seo_keywords: service.seo_keywords,
        }}
      />

      {/* Edit Modal */}
      {isEditing && (
        <AdminServiceEditor
          serviceId={service.id}
          onClose={() => setIsEditing(false)}
          onSaved={() => {
            setIsEditing(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
