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
  Package,
} from 'lucide-react';
import ContactFormWithTracking from '@/components/ContactFormWithTracking';
import { AdminServiceEditor } from '@/components/AdminServiceEditor';
import ServiceSEOModal from '@/components/ServiceSEOModal';
import { useEditMode } from '@/contexts/EditModeContext';
import { ResponsiveCarousel } from '@/components/ResponsiveCarousel';
import { iconMap } from '@/app/oferta/konferencje/ConferencesPage';
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
  const [isTransitioning, setIsTransitioning] = useState(false);
  const itemsPerView = 3;
  const delay = 4000;

  const extendedServices =
    relatedServices.length > 0 ? [...relatedServices, ...relatedServices, ...relatedServices] : [];

  useEffect(() => {
    if (relatedServices.length > 0) {
      setCarouselIndex(relatedServices.length);
    }
  }, [relatedServices.length]);

  useEffect(() => {
    if (relatedServices.length === 0) return;

    const interval = setInterval(() => {
      setIsTransitioning(true);
      setCarouselIndex((prev) => prev + 1);
    }, delay);

    return () => clearInterval(interval);
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
              {service.hero_image_url && (
                <div className="overflow-hidden rounded-2xl">
                  <img
                    src={service.hero_image_url}
                    alt={service.name}
                    className="center h-auto max-h-[500px] w-full object-cover"
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

      {relatedServices.length > 0 && (
        <section className="bg-[#1c1f33] px-6 py-20">
          <div className="mx-auto max-w-7xl p-4">
            <div className="mb-12 p-4 text-center">
              <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                Podobne usługi
              </h2>
              <p className="text-[#e5e4e2]/60">Zobacz inne usługi z kategorii {category?.name}</p>
            </div>

            <ResponsiveCarousel
              items={relatedServices}
              responsive={{
                desktop: 3,
                tablet: 2,
                mobile: 1,
              }}
              autoPlay={!isEditMode}
              autoPlayDelay={4000}
              showArrows
              renderItem={(item, idx) => {
                const Icon = iconMap[item.icon] || Package;
                return (
                  <Link
                    key={`${item.id}-${idx}`}
                    href={`/uslugi/${item.slug}`}
                    className="group relative w-full flex-shrink-0 overflow-hidden rounded-xl transition-all hover:-translate-y-1 hover:border-[#d3bb73]/40 sm:w-[calc(50%-12px)] lg:w-[calc(33.333%-16px)]"
                  >
                    <div className="relative aspect-video overflow-hidden rounded-lg bg-[#0f1119]">
                      {/* Obrazek */}
                      <img
                        src={item.thumbnail_url}
                        alt={item.name}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                      />

                      {/* 🌙 Gradient — ZAWSZE WIDOCZNY, nie tylko w hover */}
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                      <div className="absolute bottom-2 left-6 mb-4 flex flex-col gap-2">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#d3bb73]/10 transition-colors group-hover:bg-[#d3bb73]/20">
                          <Icon className="h-6 w-6 text-[#d3bb73]" />
                        </div>
                        <div className="relative z-10">
                          <h3 className="mb-2 text-lg font-medium text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
                            {item.name}
                          </h3>
                          {item.description && (
                            <p className="line-clamp-2 text-sm text-[#e5e4e2]/60">
                              {item.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              }}
            />
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
