'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  Star,
  Mail,
  ChevronLeft,
  ChevronRight,
  Edit2,
  FileText,
  Tag,
} from 'lucide-react';
import ContactFormWithTracking from '@/components/ContactFormWithTracking';
import { AdminServiceEditor } from '@/components/AdminServiceEditor';
import ServiceSEOModal from '@/components/ServiceSEOModal';
import { useEditMode } from '@/contexts/EditModeContext';
interface ServiceDetailClientProps {
  service: any;
  category: any;
  relatedServices: any[];
  ogImage?: string;
}

export default function ServiceDetailClient({
  service,
  category,
  relatedServices,
  ogImage,
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


  const extendedServices =
    relatedServices.length > 0 ? [...relatedServices, ...relatedServices, ...relatedServices] : [];

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

  const features = service.features
    ? Array.isArray(service.features)
      ? service.features
      : []
    : [];
  const technicalSpecs = service.technical_specs || {};

  return (
    <>
      {/* Back Link + Edit Button */}
      {isEditMode && (
        <section className="px-6 pt-6">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <div className="flex gap-2">
              <button
                onClick={() => setIsSEOModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                <FileText className="h-4 w-4" />
                Metadane
              </button>
              <button
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73] px-4 py-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
              >
                <Edit2 className="h-4 w-4" />
                Edytuj usługę
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Service Header */}
      <section className="px-6 py-4">
        <div className="mx-auto max-w-7xl">
          <div className="mb-2 flex items-center gap-3">
            <div className="mb-2 flex items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-4 py-1">
                <Tag className="h-4 w-4 text-[#d3bb73]" />
                <span className="text-sm font-medium text-[#d3bb73]">{category?.name}</span>
              </div>
            </div>

            {service.is_premium && (
              <div className="mb-2 flex items-center gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73] bg-[#d3bb73]/20 px-4 py-1">
                  <Star className="h-4 w-4 fill-[#d3bb73] text-[#d3bb73]" />
                  <span className="text-sm font-medium text-[#d3bb73]">Premium</span>
                </div>
              </div>
            )}
          </div>

          <h1 className="mb-6 text-4xl font-light text-[#e5e4e2] md:text-5xl">{service.name}</h1>

          <p className="max-w-3xl text-xl font-light text-[#e5e4e2]/80">{service.description}</p>
        </div>
      </section>

      {/* Main Content */}
      <section className="px-6 pb-12">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-3">
            {/* Main Info */}
            <div className="space-y-12 lg:col-span-2">
              {/* Thumbnail */}
              {service.thumbnail_url && (
                <div className="overflow-hidden rounded-2xl">
                  <img
                    src={service.thumbnail_url}
                    alt={service.name}
                    className="h-auto w-full object-cover"
                  />
                </div>
              )}

              {/* Description */}
              {service.long_description && (
                <div>
                  <h2 className="mb-6 text-3xl font-light text-[#e5e4e2]">Szczegóły usługi</h2>
                  <p className="whitespace-pre-line text-lg leading-relaxed text-[#e5e4e2]/70">
                    {service.long_description}
                  </p>
                </div>
              )}

              {/* Features */}
              {features.length > 0 && (
                <div>
                  <h2 className="mb-6 text-3xl font-light text-[#e5e4e2]">Co oferujemy</h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    {features.map((feature: string, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-start gap-3 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-4"
                      >
                        <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#d3bb73]" />
                        <span className="text-[#e5e4e2]/80">{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Technical Specs */}
              {Object.keys(technicalSpecs).length > 0 && (
                <div>
                  <h2 className="mb-6 text-3xl font-light text-[#e5e4e2]">
                    Specyfikacja techniczna
                  </h2>
                  <div className="space-y-4 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                    {Object.entries(technicalSpecs).map(([key, value]: [string, any]) => (
                      <div
                        key={key}
                        className="flex justify-between border-b border-[#d3bb73]/10 pb-4 last:border-0 last:pb-0"
                      >
                        <span className="font-medium text-[#e5e4e2]/60">{key}</span>
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
              <div className="sticky top-6 rounded-2xl border border-[#d3bb73]/30 bg-gradient-to-br from-[#d3bb73]/10 to-[#d3bb73]/5 p-6">
                <h3 className="mb-4 text-xl font-medium text-[#e5e4e2]">Zainteresowany?</h3>
                <p className="mb-6 text-[#e5e4e2]/70">
                  Skontaktuj się z nami, aby uzyskać szczegółową wycenę i omówić szczegóły
                  realizacji.
                </p>
                <button
                  onClick={() => setIsContactFormOpen(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  <Mail className="h-4 w-4" />
                  Zapytaj o wycenę
                </button>
                <p className="mt-4 text-center text-xs text-[#e5e4e2]/40">
                  Odpowiedź w 24h • Bezpłatna konsultacja
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Related Services */}
      {relatedServices.length > 0 && (
        <section className="bg-[#1c1f33] px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <div className="mb-12 text-center">
              <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                Podobne usługi
              </h2>
              <p className="text-[#e5e4e2]/60">Zobacz inne usługi z kategorii {category?.name}</p>
            </div>

            <div className="relative">
              {/* Carousel Navigation */}
              {relatedServices.length > itemsPerView && (
                <>
                  <button
                    onClick={handlePrev}
                    className="absolute left-0 top-1/2 z-10 -translate-x-4 -translate-y-1/2 rounded-full bg-[#d3bb73] p-3 text-[#1c1f33] shadow-lg transition-all hover:bg-[#d3bb73]/90"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    onClick={handleNext}
                    className="absolute right-0 top-1/2 z-10 -translate-y-1/2 translate-x-4 rounded-full bg-[#d3bb73] p-3 text-[#1c1f33] shadow-lg transition-all hover:bg-[#d3bb73]/90"
                  >
                    <ChevronRight className="h-6 w-6" />
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
                      className="flex-shrink-0 overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] transition-all hover:scale-105 hover:border-[#d3bb73]/40"
                      style={{
                        width: `calc(${100 / itemsPerView}% - ${((itemsPerView - 1) * 24) / itemsPerView}px)`,
                      }}
                    >
                      {item.thumbnail_url && (
                        <div className="aspect-video overflow-hidden bg-[#1c1f33]">
                          <img
                            src={item.thumbnail_url}
                            alt={item.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      )}
                      <div className="p-4">
                        <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">{item.name}</h3>
                        {item.description && (
                          <p className="line-clamp-2 text-sm text-[#e5e4e2]/60">
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
      {isSEOModalOpen && (
        <ServiceSEOModal
          key={`seo-modal-${service.id}-${service.updated_at || Date.now()}`}
          isOpen={isSEOModalOpen}
          onClose={() => setIsSEOModalOpen(false)}
          serviceId={service.id}
          slug={service.slug}
          initialData={{
            name: service.name,
            description: service.description,
            seo_title: service.seo_title,
            seo_description: service.seo_description,
            seo_keywords: service.seo_keywords,
            og_image: ogImage,
          }}
        />
      )}

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
