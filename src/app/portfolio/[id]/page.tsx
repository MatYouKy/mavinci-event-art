'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  Tag,
  MapPin,
  Edit,
  Save,
  X,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  XCircle,
} from 'lucide-react';
import * as Icons from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PortfolioProject, GalleryImage, PortfolioProjectFeature, supabase } from '@/lib/supabase';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { SimpleImageUploader } from '@/components/SimpleImageUploader';
import { PortfolioGalleryEditor } from '@/components/PortfolioGalleryEditor';
import PortfolioFeaturesEditor from '@/components/PortfolioFeaturesEditor';
import { uploadImage } from '@/lib/storage';
import { IUploadImage } from '@/types/image';

const MOCK_PROJECTS: PortfolioProject[] = [
  {
    id: 'mock-1',
    title: 'Targi Branżowe Olsztyn 2024',
    category: 'Targi i Wystawy',
    image:
      'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920',
    description:
      'Kompleksowa organizacja targów branżowych w Olsztynie - obsługa 200 wystawców, catering, multimedia. Event trwał 3 dni i przyciągnął ponad 5000 zwiedzających z całej Polski.',
    order_index: 1,
    location: 'Olsztyn',
    event_date: '2024-05-15',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export default function ProjectDetailPage() {
  const router = useRouter();
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const params = useParams();
  const id = params.id as string;

  const [project, setProject] = useState<PortfolioProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [description, setDescription] = useState('');
  const [orderIndex, setOrderIndex] = useState(0);
  const [imageData, setImageData] = useState<IUploadImage | null>(null);
  const [previewImage, setPreviewImage] = useState<string>('');
  const [heroOpacity, setHeroOpacity] = useState(0.2);
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [detailedDescription, setDetailedDescription] = useState('');
  const [features, setFeatures] = useState<PortfolioProjectFeature[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  useEffect(() => {
    fetchProject();
  }, [id]);

  const fetchProject = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('portfolio_projects')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!error && data) {
        setProject(data);
        loadProjectData(data);
      } else {
        const mockProject = MOCK_PROJECTS.find((p) => p.id === id);
        if (mockProject) {
          setProject(mockProject);
          loadProjectData(mockProject);
        } else {
          setProject(null);
        }
      }
    } catch (error) {
      console.error('Error fetching project:', error);
      const mockProject = MOCK_PROJECTS.find((p) => p.id === id);
      if (mockProject) {
        setProject(mockProject);
        loadProjectData(mockProject);
      }
    }
    setLoading(false);
  };

  const loadProjectData = (proj: PortfolioProject) => {
    setTitle(proj.title);
    setCategory(proj.category);
    setLocation(proj.location || 'Polska');
    setEventDate(proj.event_date || new Date().toISOString().split('T')[0]);
    setDescription(proj.description);
    setDetailedDescription(proj.detailed_description || '');
    setOrderIndex(proj.order_index || 0);
    setPreviewImage(proj.image_metadata?.desktop?.src || proj.image);
    setGallery(proj.gallery || []);
    setFeatures(proj.features || []);
  };

  const handleImageSelect = (data: IUploadImage) => {
    setImageData(data);
    if (data.file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewImage(reader.result as string);
      };
      reader.readAsDataURL(data.file);
    }
  };

  const handleSave = async () => {
    if (!title) {
      showSnackbar('Uzupełnij tytuł wydarzenia', 'error');
      return;
    }

    setSaving(true);
    try {
      let imageUrl = project?.image || '';
      let imageMetadata = project?.image_metadata;

      if (imageData?.file) {
        imageUrl = await uploadImage(imageData.file, 'portfolio');
        imageMetadata = {
          desktop: {
            src: imageUrl,
            position: { posX: 0, posY: 0, scale: 1 },
          },
          mobile: {
            src: imageUrl,
            position: { posX: 0, posY: 0, scale: 1 },
          },
        };
      }

      const payload = {
        title,
        category,
        image: imageUrl,
        alt: imageData?.alt || title,
        image_metadata: imageMetadata,
        description,
        detailed_description: detailedDescription,
        order_index: orderIndex,
        location,
        event_date: eventDate,
        gallery,
        features,
      };

      const { error } = await supabase.from('portfolio_projects').update(payload).eq('id', id);

      if (error) throw error;

      showSnackbar('Wydarzenie zaktualizowane pomyślnie', 'success');
      setIsEditing(false);
      fetchProject();
    } catch (error) {
      console.error('Error saving project:', error);
      showSnackbar('Błąd podczas zapisywania wydarzenia', 'error');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('pl-PL', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const openLightbox = (index: number) => {
    setCurrentImageIndex(index);
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
  };

  const goToPrevious = () => {
    setCurrentImageIndex((prev) => (prev === 0 ? gallery.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setCurrentImageIndex((prev) => (prev === gallery.length - 1 ? 0 : prev + 1));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!lightboxOpen) return;

      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') goToPrevious();
      if (e.key === 'ArrowRight') goToNext();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen, gallery.length]);

  if (loading) {
    return (
      <>
        <Navbar />
        <main className="flex min-h-screen items-center justify-center bg-[#0f1119]">
          <div className="text-lg text-[#d3bb73]">Ładowanie projektu...</div>
        </main>
        <Footer />
      </>
    );
  }

  if (!project) {
    return (
      <>
        <Navbar />
        <main className="flex min-h-screen items-center justify-center bg-[#0f1119]">
          <div className="text-center">
            <h1 className="mb-4 text-3xl font-light text-[#e5e4e2]">Projekt nie znaleziony</h1>
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
      <main className="min-h-screen bg-gradient-to-b from-[#0a0c15] via-[#0f1119] to-[#1c1f33]">
        {/* Hero Section - Editable or View Mode */}
        <section className="relative overflow-hidden py-24 md:py-32">
          {/* Background Image */}
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${previewImage})`,
              opacity: heroOpacity,
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0a0c15]/50 via-[#0f1119]/30 to-[#1c1f33]" />

          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {/* Top Navigation */}
            <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <Link
                href="/portfolio"
                className="inline-flex items-center gap-2 text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
              >
                <ArrowLeft className="h-4 w-4" />
                Wróć do portfolio
              </Link>

              {isEditMode && (
                <div className="flex w-full gap-2 sm:w-auto">
                  {isEditing ? (
                    <>
                      <button
                        onClick={handleSave}
                        disabled={saving || !title}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                      >
                        <Save className="h-4 w-4" />
                        {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
                      </button>
                      <button
                        onClick={() => {
                          setIsEditing(false);
                          loadProjectData(project);
                        }}
                        className="flex items-center gap-2 rounded-lg bg-[#800020]/20 px-6 py-2 text-[#e5e4e2] transition-colors hover:bg-[#800020]/30"
                      >
                        <X className="h-4 w-4" />
                        Anuluj
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 sm:w-auto"
                    >
                      <Edit className="h-4 w-4" />
                      Edytuj wydarzenie
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="grid items-center gap-12 lg:grid-cols-2">
              {/* Left Column - Content (Editable or View) */}
              <div>
                {/* Category Badge */}
                {isEditing ? (
                  <div className="mb-6">
                    <div className="inline-flex items-center gap-3 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-2">
                      <Tag className="h-5 w-5 text-[#d3bb73]" />
                      <input
                        type="text"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        placeholder="Kategoria wydarzenia"
                        className="w-full border-none bg-transparent text-sm font-medium text-[#d3bb73] outline-none"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mb-6 inline-flex items-center gap-3 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-2">
                    <Tag className="h-5 w-5 text-[#d3bb73]" />
                    <span className="text-sm font-medium text-[#d3bb73]">{category}</span>
                  </div>
                )}

                {/* Title */}
                {isEditing ? (
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Tytuł wydarzenia..."
                    className="mb-6 w-full border-b-2 border-transparent bg-transparent pb-2 text-4xl font-light text-[#e5e4e2] outline-none transition-colors focus:border-[#d3bb73] md:text-5xl"
                  />
                ) : (
                  <h1 className="mb-6 text-4xl font-light text-[#e5e4e2] md:text-6xl">{title}</h1>
                )}

                {/* Location & Date */}
                <div className="mb-8 flex flex-wrap gap-6">
                  {isEditing ? (
                    <>
                      <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                        <MapPin className="h-5 w-5 text-[#d3bb73]" />
                        <input
                          type="text"
                          value={location}
                          onChange={(e) => setLocation(e.target.value)}
                          placeholder="Lokalizacja"
                          className="border-none bg-transparent text-sm outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                        <Calendar className="h-5 w-5 text-[#d3bb73]" />
                        <span className="text-sm">{formatDate(eventDate)}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                        <MapPin className="h-5 w-5 text-[#d3bb73]" />
                        <span className="text-sm">{location}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                        <Calendar className="h-5 w-5 text-[#d3bb73]" />
                        <span className="text-sm">{formatDate(eventDate)}</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Description */}
                {isEditing ? (
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Opis wydarzenia..."
                    className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]/40 p-4 text-base font-light leading-relaxed text-[#e5e4e2]/80 outline-none transition-colors focus:border-[#d3bb73]"
                    rows={6}
                  />
                ) : (
                  <p className="mb-8 text-lg font-light leading-relaxed text-[#e5e4e2]/70">
                    {description}
                  </p>
                )}

                {/* CTA Buttons (only in view mode) */}
                {!isEditing && (
                  <div className="flex flex-wrap gap-4">
                    <a
                      href="/#kontakt"
                      className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                    >
                      Zapytaj o podobny event
                    </a>
                    <Link
                      href="/portfolio"
                      className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-8 py-3 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
                    >
                      Zobacz więcej projektów
                    </Link>
                  </div>
                )}
              </div>

              {/* Right Column - Image (Editable or View) */}
              <div>
                {isEditing ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33]/60 p-6 backdrop-blur-sm">
                      <div className="mb-4 flex items-center gap-2">
                        <ImageIcon className="h-5 w-5 text-[#d3bb73]" />
                        <h3 className="text-lg font-light text-[#e5e4e2]">Główne zdjęcie</h3>
                      </div>
                      <SimpleImageUploader
                        onImageSelect={handleImageSelect}
                        initialImage={{
                          src: previewImage,
                          alt: title,
                        }}
                        showPreview={true}
                      />

                      {/* Opacity Control */}
                      <div className="mt-4">
                        <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                          Przeźroczystość tła: {Math.round(heroOpacity * 100)}%
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={heroOpacity * 100}
                          onChange={(e) => setHeroOpacity(parseInt(e.target.value) / 100)}
                          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#1c1f33] accent-[#d3bb73]"
                        />
                      </div>
                    </div>

                    {/* Additional Settings */}
                    <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33]/60 p-6 backdrop-blur-sm">
                      <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Ustawienia</h3>
                      <div className="space-y-4">
                        <div>
                          <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                            Data wydarzenia
                          </label>
                          <input
                            type="date"
                            value={eventDate}
                            onChange={(e) => setEventDate(e.target.value)}
                            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0c15] px-4 py-2 text-[#e5e4e2] outline-none transition-colors focus:border-[#d3bb73]"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                            Kolejność wyświetlania
                          </label>
                          <input
                            type="number"
                            value={orderIndex}
                            onChange={(e) => setOrderIndex(parseInt(e.target.value) || 0)}
                            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0c15] px-4 py-2 text-[#e5e4e2] outline-none transition-colors focus:border-[#d3bb73]"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 blur-3xl"></div>
                    <div className="relative overflow-hidden rounded-3xl border border-[#d3bb73]/20">
                      <img
                        src={previewImage}
                        alt={project.alt || title}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Detailed Description Section */}
        {(detailedDescription || isEditing) && (
          <section className="border-y border-[#d3bb73]/10 bg-[#0f1119] py-16">
            <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
              <div className="mb-12 text-center">
                <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                  Szczegóły <span className="text-[#d3bb73]">Realizacji</span>
                </h2>
                <div className="mx-auto h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
              </div>

              {isEditing ? (
                <>
                  <div className="rounded-2xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-8 backdrop-blur-sm">
                    <label className="mb-3 block text-sm font-medium text-[#e5e4e2]">
                      Szczegółowy opis wydarzenia (SEO-friendly z długim ogonem słów kluczowych)
                    </label>
                    <textarea
                      value={detailedDescription}
                      onChange={(e) => setDetailedDescription(e.target.value)}
                      placeholder="Np: Organizacja konferencji biznesowej w Warszawie dla 300 uczestników. Zapewniliśmy profesjonalne nagłośnienie sceny, oświetlenie LED, tłumaczenia symultaniczne na 5 języków, catering premium dla gości VIP, strefy networkingowe z meblami eventowymi, rejestrację wideo 4K, transmisję online na żywo, kompleksową obsługę techniczną wydarzenia oraz dedykowanego koordynatora projektu..."
                      className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0a0c15] px-4 py-4 font-light leading-relaxed text-[#e5e4e2] outline-none transition-colors focus:border-[#d3bb73]"
                      rows={8}
                    />
                    <p className="mt-2 text-xs text-[#e5e4e2]/50">
                      Tip: Używaj konkretnych słów kluczowych jak "organizacja eventów firmowych",
                      "catering na konferencje", "nagłośnienie sceny", "oświetlenie eventowe" itp.
                    </p>
                  </div>

                  <div className="mt-8 rounded-2xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-8 backdrop-blur-sm">
                    <PortfolioFeaturesEditor
                      projectId={id}
                      features={features}
                      onChange={setFeatures}
                    />
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-[#d3bb73]/10 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-8 backdrop-blur-sm md:p-12">
                  {features.length > 0 && (
                    <div className="mx-auto mb-8 flex max-w-4xl flex-wrap justify-center gap-6">
                      {features.map((feature, idx) => {
                        const IconComponent = (Icons as any)[feature.icon_name];
                        return (
                          <div key={idx} className="w-32 text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10">
                              {IconComponent && (
                                <IconComponent className="h-8 w-8 text-[#d3bb73]" />
                              )}
                            </div>
                            <h3 className="text-sm font-light text-[#e5e4e2]">{feature.title}</h3>
                            {feature.description && (
                              <p className="mt-1 text-xs text-[#e5e4e2]/60">
                                {feature.description}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="prose prose-invert max-w-none">
                    <p className="whitespace-pre-line text-base font-light leading-relaxed text-[#e5e4e2]/80 md:text-lg">
                      {detailedDescription}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Gallery Section */}
        {isEditing ? (
          <section className="border-t border-[#d3bb73]/10 bg-[#0f1119] py-16">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="mb-8">
                <h2 className="mb-2 text-3xl font-light text-[#e5e4e2]">
                  Galeria <span className="text-[#d3bb73]">Zdjęć</span>
                </h2>
                <p className="text-[#e5e4e2]/60">Edytuj zdjęcia z wydarzenia</p>
              </div>
              <PortfolioGalleryEditor gallery={gallery} onChange={setGallery} />
            </div>
          </section>
        ) : (
          gallery &&
          gallery.length > 0 && (
            <section className="bg-gradient-to-br from-[#0f1119] to-[#1c1f33] py-24">
              <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="mb-16 text-center">
                  <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                    Galeria Wydarzenia
                  </h2>
                  <div className="mx-auto h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {gallery.map((image, index) => (
                    <div
                      key={index}
                      onClick={() => openLightbox(index)}
                      className="group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-xl border border-[#d3bb73]/10 transition-all duration-300 hover:border-[#d3bb73]/30"
                    >
                      <img
                        src={image.image_metadata?.desktop?.src || image.src}
                        alt={image.alt || `Zdjęcie z wydarzenia ${index + 1}`}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119]/80 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                        <div className="absolute bottom-4 left-4 right-4">
                          <p className="text-sm font-light text-[#e5e4e2]">
                            {image.alt || `Zdjęcie ${index + 1}`}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )
        )}

        {/* Tips Section (only in edit mode) */}
        {isEditing && (
          <section className="bg-[#0a0c15] py-12">
            <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
              <div className="rounded-xl border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-6">
                <h3 className="mb-3 text-lg font-light text-[#e5e4e2]">Porady</h3>
                <ul className="space-y-2 text-sm text-[#e5e4e2]/60">
                  <li>• Edytuj pola bezpośrednio w miejscu gdzie będą widoczne</li>
                  <li>• Użyj suwaka przeźroczystości aby dostosować widoczność tła</li>
                  <li>• Możesz zmienić główne zdjęcie lub dodać nowe do galerii</li>
                  <li>• Kliknij "Zapisz zmiany" aby zapisać wszystkie edycje</li>
                </ul>
              </div>
            </div>
          </section>
        )}

        {/* CTA Section (only in view mode) */}
        {!isEditing && (
          <section className="bg-gradient-to-br from-[#0f1119] to-[#1c1f33] py-24">
            <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
              <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                Zorganizujmy Twoje Wydarzenie!
              </h2>
              <p className="mx-auto mb-8 max-w-2xl text-lg font-light text-[#e5e4e2]/70">
                Skontaktuj się z nami, aby omówić szczegóły Twojego eventu. Zapewnimy profesjonalną
                realizację na najwyższym poziomie.
              </p>
              <a
                href="/#kontakt"
                className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                Skontaktuj się z nami
              </a>
            </div>
          </section>
        )}

        {/* Fullscreen Lightbox */}
        {lightboxOpen && gallery.length > 0 && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95">
            {/* Close Button */}
            <button
              onClick={closeLightbox}
              className="absolute right-4 top-4 z-10 text-white transition-colors hover:text-[#d3bb73]"
              aria-label="Zamknij"
            >
              <XCircle className="h-10 w-10" />
            </button>

            {/* Previous Button */}
            {gallery.length > 1 && (
              <button
                onClick={goToPrevious}
                className="absolute left-4 z-10 text-white transition-colors hover:text-[#d3bb73]"
                aria-label="Poprzednie zdjęcie"
              >
                <ChevronLeft className="h-12 w-12" />
              </button>
            )}

            {/* Image */}
            <div className="relative mx-4 max-h-[90vh] max-w-7xl">
              <img
                src={
                  gallery[currentImageIndex]?.image_metadata?.desktop?.src ||
                  gallery[currentImageIndex]?.src
                }
                alt={gallery[currentImageIndex]?.alt || `Zdjęcie ${currentImageIndex + 1}`}
                className="max-h-[90vh] max-w-full object-contain"
              />

              {/* Image Caption */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                <p className="text-center text-white">
                  {gallery[currentImageIndex]?.alt || `Zdjęcie ${currentImageIndex + 1}`}
                </p>
                <p className="mt-2 text-center text-sm text-white/60">
                  {currentImageIndex + 1} / {gallery.length}
                </p>
              </div>
            </div>

            {/* Next Button */}
            {gallery.length > 1 && (
              <button
                onClick={goToNext}
                className="absolute right-4 z-10 text-white transition-colors hover:text-[#d3bb73]"
                aria-label="Następne zdjęcie"
              >
                <ChevronRight className="h-12 w-12" />
              </button>
            )}

            {/* Keyboard Hints */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 transform text-sm text-white/60">
              <p>Użyj strzałek ← → aby nawigować | ESC aby zamknąć</p>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
