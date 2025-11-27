'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, Star, Mail, Edit2, FileText, Tag, Package, Trash2, GripVertical, Plus } from 'lucide-react';
import ContactFormWithTracking from '@/components/ContactFormWithTracking';
import { AdminServiceEditor } from '@/components/AdminServiceEditor';
import ServiceSEOModal from '@/components/ServiceSEOModal';
import { useEditMode } from '@/contexts/EditModeContext';
import { ResponsiveCarousel } from '@/components/ResponsiveCarousel';
import { iconMap } from '@/app/oferta/konferencje/ConferencesPage';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectCustomIcons, fetchCustomIcons } from '@/store/slices/customIconSlice';
import { CustomIcon } from '@/components/UI/CustomIcon/CustomIcon';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { SimpleImageUploader } from '@/components/SimpleImageUploader';
import { uploadOptimizedImage } from '@/lib/storage';
import { IUploadImage } from '@/types/image';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
interface ServiceDetailClientProps {
  service: any;
  category: any;
  relatedServices: any[];
  ogImage?: string;
  gallery?: any[];
  isAdmin?: boolean;
}

export default function ServiceDetailClient({
  service,
  category,
  relatedServices,
  ogImage,
  gallery = [],
  isAdmin = false,
}: ServiceDetailClientProps) {
  const router = useRouter();
  const { isEditMode } = useEditMode();
  const dispatch = useAppDispatch();
  const icons = useAppSelector(selectCustomIcons);
  const { showSnackbar } = useSnackbar();
  const [isContactFormOpen, setIsContactFormOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSEOModalOpen, setIsSEOModalOpen] = useState(false);
  const [localGallery, setLocalGallery] = useState(gallery);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isAddingImage, setIsAddingImage] = useState(false);
  const [newImageData, setNewImageData] = useState<IUploadImage | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    dispatch(fetchCustomIcons());
  }, [dispatch]);

  useEffect(() => {
    setLocalGallery(gallery);
  }, [gallery]);

  console.log(icons);

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newGallery = [...localGallery];
    const draggedItem = newGallery[draggedIndex];
    newGallery.splice(draggedIndex, 1);
    newGallery.splice(index, 0, draggedItem);

    setLocalGallery(newGallery);
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null) return;

    try {
      const updates = localGallery.map((image, index) => ({
        id: image.id,
        display_order: index + 1,
      }));

      for (const update of updates) {
        await supabase
          .from('conferences_service_gallery')
          .update({ display_order: update.display_order })
          .eq('id', update.id);
      }

      showSnackbar('Kolejność zaktualizowana', 'success');
      router.refresh();
    } catch (error) {
      console.error('Error updating order:', error);
      showSnackbar('Błąd podczas aktualizacji kolejności', 'error');
    } finally {
      setDraggedIndex(null);
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć to zdjęcie?')) return;

    try {
      const { error } = await supabase
        .from('conferences_service_gallery')
        .delete()
        .eq('id', imageId);

      if (error) throw error;

      showSnackbar('Zdjęcie usunięte', 'success');
      setLocalGallery(localGallery.filter(img => img.id !== imageId));
      router.refresh();
    } catch (error) {
      console.error('Error deleting image:', error);
      showSnackbar('Błąd podczas usuwania zdjęcia', 'error');
    }
  };

  const handleAddImage = async () => {
    if (!newImageData?.file) {
      showSnackbar('Wybierz zdjęcie', 'error');
      return;
    }

    setUploading(true);
    try {
      const result = await uploadOptimizedImage(newImageData.file, 'services/gallery');

      const maxOrder = localGallery.length > 0 ? Math.max(...localGallery.map(g => g.display_order)) : 0;

      const { error } = await supabase
        .from('conferences_service_gallery')
        .insert({
          service_id: service.id,
          image_url: result.desktop,
          alt_text: newImageData.alt || '',
          display_order: maxOrder + 1,
          is_active: true,
        });

      if (error) throw error;

      showSnackbar('Zdjęcie dodane', 'success');
      setIsAddingImage(false);
      setNewImageData(null);
      router.refresh();
    } catch (error) {
      console.error('Error uploading image:', error);
      showSnackbar('Błąd podczas wgrywania zdjęcia', 'error');
    } finally {
      setUploading(false);
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
      {/* Inactive Service Banner for Admins */}
      {!service.is_active && isAdmin && (
        <section className="bg-red-500/10 border-b border-red-500/30 px-6 py-4">
          <div className="mx-auto max-w-7xl">
            <div className="flex items-center gap-3 text-red-400">
              <div className="rounded-full bg-red-500/20 p-2">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-red-300">Ta usługa jest nieaktywna</p>
                <p className="text-sm text-red-400/80">
                  Użytkownicy bez uprawnień nie widzą tej strony i są przekierowywani na /uslugi
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Edit Button */}
      {isEditMode && (
        <section className="px-6 pt-6">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <button
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73] px-4 py-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
            >
              <Edit2 className="h-4 w-4" />
              Edytuj usługę
            </button>
          </div>
        </section>
      )}

      {/* Service Header */}
      <section className="px-6 py-4">
        <div className="mx-auto max-w-7xl">
          <div className="mb-2 flex items-center gap-3">
            <div className="mb-2 flex items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-4 py-1">
                <CustomIcon
                  iconId={service.icon_id} // string z bazy
                  className="h-7 w-7 text-[#1c1f33]" // rozmiar + kolor
                  fallback={<span className="text-xs text-[#1c1f33]">?</span>}
                />

                {/* <Icon className="h-4 w-4 text-[#d3bb73]" /> */}
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
            <section className="px-6 pt-24 min-h-[50px]">
          <div className="mx-auto min-h-[50px] max-w-screen-lg">
            <CategoryBreadcrumb
              pageSlug={`uslugi/${service.slug}`}
              productName={service.name}
              hideMetadataButton={false}
            />
          </div>
        </section>

      {/* Gallery Section */}
      {(localGallery.length > 0 || isEditMode) && (
        <section className="bg-[#0f1119] px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <div className="mb-12 flex items-center justify-between">
              <div className="text-center flex-1">
                <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                  Galeria
                </h2>
                <p className="text-[#e5e4e2]/60">Zobacz więcej zdjęć naszej usługi</p>
              </div>
              {isEditMode && (
                <button
                  onClick={() => setIsAddingImage(true)}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj zdjęcie
                </button>
              )}
            </div>

            {isAddingImage && (
              <div className="mb-8 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                <h5 className="mb-4 text-[#e5e4e2]">Nowe zdjęcie</h5>
                <SimpleImageUploader
                  onImageSelect={(imageData) => setNewImageData(imageData)}
                  showPreview={true}
                />
                <div className="mt-4 flex gap-3">
                  <button
                    onClick={handleAddImage}
                    disabled={uploading || !newImageData?.file}
                    className="rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {uploading ? 'Wgrywanie...' : 'Dodaj zdjęcie'}
                  </button>
                  <button
                    onClick={() => {
                      setIsAddingImage(false);
                      setNewImageData(null);
                    }}
                    className="rounded-lg bg-[#800020]/20 px-6 py-2 text-[#e5e4e2] transition-colors hover:bg-[#800020]/30"
                  >
                    Anuluj
                  </button>
                </div>
              </div>
            )}

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {localGallery.map((image: any, index: number) => (
                <div
                  key={image.id}
                  draggable={isEditMode}
                  onDragStart={() => isEditMode && handleDragStart(index)}
                  onDragOver={(e) => isEditMode && handleDragOver(e, index)}
                  onDragEnd={() => isEditMode && handleDragEnd()}
                  className={`group relative aspect-video overflow-hidden rounded-xl bg-[#1c1f33] ${
                    isEditMode ? 'cursor-move' : ''
                  }`}
                >
                  <img
                    src={image.image_url}
                    alt={image.alt_text || service.name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  {isEditMode && (
                    <>
                      <div className="absolute left-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <GripVertical className="h-6 w-6 text-white drop-shadow-lg" />
                      </div>
                      <button
                        onClick={() => handleDeleteImage(image.id)}
                        className="absolute right-2 top-2 rounded-lg bg-[#800020] p-2 text-[#e5e4e2] opacity-0 transition-all hover:bg-[#800020]/90 group-hover:opacity-100"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  {image.caption && (
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                      <p className="text-sm text-white">{image.caption}</p>
                    </div>
                  )}
                </div>
              ))}
              {isEditMode && localGallery.length === 0 && !isAddingImage && (
                <div className="col-span-full flex items-center justify-center rounded-xl border-2 border-dashed border-[#d3bb73]/30 p-12 text-center">
                  <div>
                    <p className="mb-2 text-[#e5e4e2]/70">Brak zdjęć w galerii</p>
                    <p className="text-sm text-[#e5e4e2]/40">
                      Kliknij "Dodaj zdjęcie" aby rozpocząć
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

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
                          <CustomIcon
                            iconId={item.icon_id}
                            className="h-6 w-6 text-[#d3bb73]"
                            fallback={<Package className="h-6 w-6 text-[#d3bb73]" />}
                          />
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
