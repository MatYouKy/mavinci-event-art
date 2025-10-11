'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, Tag, MapPin, Edit, Save, X, Image as ImageIcon, ChevronLeft, ChevronRight, XCircle } from 'lucide-react';
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
    image: 'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920',
    description: 'Kompleksowa organizacja targów branżowych w Olsztynie - obsługa 200 wystawców, catering, multimedia. Event trwał 3 dni i przyciągnął ponad 5000 zwiedzających z całej Polski.',
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
        const mockProject = MOCK_PROJECTS.find(p => p.id === id);
        if (mockProject) {
          setProject(mockProject);
          loadProjectData(mockProject);
        } else {
          setProject(null);
        }
      }
    } catch (error) {
      console.error('Error fetching project:', error);
      const mockProject = MOCK_PROJECTS.find(p => p.id === id);
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

      const { error } = await supabase
        .from('portfolio_projects')
        .update(payload)
        .eq('id', id);

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
      <main className="min-h-screen bg-gradient-to-b from-[#0a0c15] via-[#0f1119] to-[#1c1f33]">
        {/* Hero Section - Editable or View Mode */}
        <section className="relative py-24 md:py-32 overflow-hidden">
          {/* Background Image */}
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${previewImage})`,
              opacity: heroOpacity,
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0a0c15]/50 via-[#0f1119]/30 to-[#1c1f33]" />

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Top Navigation */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
              <Link
                href="/portfolio"
                className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Wróć do portfolio
              </Link>

              {isEditMode && (
                <div className="flex gap-2 w-full sm:w-auto">
                  {isEditing ? (
                    <>
                      <button
                        onClick={handleSave}
                        disabled={saving || !title}
                        className="flex items-center gap-2 px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-1 sm:flex-none justify-center"
                      >
                        <Save className="w-4 h-4" />
                        {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
                      </button>
                      <button
                        onClick={() => {
                          setIsEditing(false);
                          loadProjectData(project);
                        }}
                        className="flex items-center gap-2 px-6 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                      >
                        <X className="w-4 h-4" />
                        Anuluj
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="flex items-center gap-2 px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors w-full sm:w-auto justify-center"
                    >
                      <Edit className="w-4 h-4" />
                      Edytuj wydarzenie
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="grid lg:grid-cols-2 gap-12 items-center">
              {/* Left Column - Content (Editable or View) */}
              <div>
                {/* Category Badge */}
                {isEditing ? (
                  <div className="mb-6">
                    <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2">
                      <Tag className="w-5 h-5 text-[#d3bb73]" />
                      <input
                        type="text"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        placeholder="Kategoria wydarzenia"
                        className="bg-transparent text-[#d3bb73] text-sm font-medium outline-none border-none w-full"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                    <Tag className="w-5 h-5 text-[#d3bb73]" />
                    <span className="text-[#d3bb73] text-sm font-medium">{category}</span>
                  </div>
                )}

                {/* Title */}
                {isEditing ? (
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Tytuł wydarzenia..."
                    className="w-full bg-transparent text-4xl md:text-5xl font-light text-[#e5e4e2] mb-6 outline-none border-b-2 border-transparent focus:border-[#d3bb73] transition-colors pb-2"
                  />
                ) : (
                  <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                    {title}
                  </h1>
                )}

                {/* Location & Date */}
                <div className="flex flex-wrap gap-6 mb-8">
                  {isEditing ? (
                    <>
                      <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                        <MapPin className="w-5 h-5 text-[#d3bb73]" />
                        <input
                          type="text"
                          value={location}
                          onChange={(e) => setLocation(e.target.value)}
                          placeholder="Lokalizacja"
                          className="bg-transparent outline-none border-none text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                        <Calendar className="w-5 h-5 text-[#d3bb73]" />
                        <span className="text-sm">{formatDate(eventDate)}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                        <MapPin className="w-5 h-5 text-[#d3bb73]" />
                        <span className="text-sm">{location}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                        <Calendar className="w-5 h-5 text-[#d3bb73]" />
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
                    className="w-full bg-[#1c1f33]/40 text-[#e5e4e2]/80 text-base font-light leading-relaxed p-4 rounded-lg border border-[#d3bb73]/20 outline-none focus:border-[#d3bb73] transition-colors resize-none"
                    rows={6}
                  />
                ) : (
                  <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed mb-8">
                    {description}
                  </p>
                )}

                {/* CTA Buttons (only in view mode) */}
                {!isEditing && (
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
                )}
              </div>

              {/* Right Column - Image (Editable or View) */}
              <div>
                {isEditing ? (
                  <div className="space-y-4">
                    <div className="bg-[#1c1f33]/60 backdrop-blur-sm border border-[#d3bb73]/20 rounded-2xl p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <ImageIcon className="w-5 h-5 text-[#d3bb73]" />
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
                        <label className="block text-[#e5e4e2]/70 text-sm mb-2">
                          Przeźroczystość tła: {Math.round(heroOpacity * 100)}%
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={heroOpacity * 100}
                          onChange={(e) => setHeroOpacity(parseInt(e.target.value) / 100)}
                          className="w-full h-2 bg-[#1c1f33] rounded-lg appearance-none cursor-pointer accent-[#d3bb73]"
                        />
                      </div>
                    </div>

                    {/* Additional Settings */}
                    <div className="bg-[#1c1f33]/60 backdrop-blur-sm border border-[#d3bb73]/20 rounded-2xl p-6">
                      <h3 className="text-lg font-light text-[#e5e4e2] mb-4">Ustawienia</h3>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-[#e5e4e2]/70 text-sm mb-2">Data wydarzenia</label>
                          <input
                            type="date"
                            value={eventDate}
                            onChange={(e) => setEventDate(e.target.value)}
                            className="w-full bg-[#0a0c15] text-[#e5e4e2] px-4 py-2 rounded-lg border border-[#d3bb73]/20 outline-none focus:border-[#d3bb73] transition-colors"
                          />
                        </div>
                        <div>
                          <label className="block text-[#e5e4e2]/70 text-sm mb-2">Kolejność wyświetlania</label>
                          <input
                            type="number"
                            value={orderIndex}
                            onChange={(e) => setOrderIndex(parseInt(e.target.value) || 0)}
                            className="w-full bg-[#0a0c15] text-[#e5e4e2] px-4 py-2 rounded-lg border border-[#d3bb73]/20 outline-none focus:border-[#d3bb73] transition-colors"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 rounded-3xl blur-3xl"></div>
                    <div className="relative rounded-3xl overflow-hidden border border-[#d3bb73]/20">
                      <img
                        src={previewImage}
                        alt={project.alt || title}
                        className="w-full h-full object-cover"
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
          <section className="py-16 bg-[#0f1119] border-y border-[#d3bb73]/10">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
                  Szczegóły <span className="text-[#d3bb73]">Realizacji</span>
                </h2>
                <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
              </div>

              {isEditing ? (
                <>
                  <div className="bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-2xl p-8">
                    <label className="block text-[#e5e4e2] text-sm font-medium mb-3">
                      Szczegółowy opis wydarzenia (SEO-friendly z długim ogonem słów kluczowych)
                    </label>
                    <textarea
                      value={detailedDescription}
                      onChange={(e) => setDetailedDescription(e.target.value)}
                      placeholder="Np: Organizacja konferencji biznesowej w Warszawie dla 300 uczestników. Zapewniliśmy profesjonalne nagłośnienie sceny, oświetlenie LED, tłumaczenia symultaniczne na 5 języków, catering premium dla gości VIP, strefy networkingowe z meblami eventowymi, rejestrację wideo 4K, transmisję online na żywo, kompleksową obsługę techniczną wydarzenia oraz dedykowanego koordynatora projektu..."
                      className="w-full bg-[#0a0c15] text-[#e5e4e2] px-4 py-4 rounded-lg border border-[#d3bb73]/20 outline-none focus:border-[#d3bb73] transition-colors resize-none font-light leading-relaxed"
                      rows={8}
                    />
                    <p className="text-[#e5e4e2]/50 text-xs mt-2">
                      Tip: Używaj konkretnych słów kluczowych jak "organizacja eventów firmowych", "catering na konferencje", "nagłośnienie sceny", "oświetlenie eventowe" itp.
                    </p>
                  </div>

                  <div className="mt-8 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-2xl p-8">
                    <PortfolioFeaturesEditor
                      projectId={id}
                      features={features}
                      onChange={setFeatures}
                    />
                  </div>
                </>
              ) : (
                <div className="bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-2xl p-8 md:p-12">
                  {features.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-6 mb-8 max-w-4xl mx-auto">
                      {features.map((feature, idx) => {
                        const IconComponent = (Icons as any)[feature.icon_name];
                        return (
                          <div key={idx} className="text-center w-32">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#d3bb73]/10 border border-[#d3bb73]/30 flex items-center justify-center">
                              {IconComponent && <IconComponent className="w-8 h-8 text-[#d3bb73]" />}
                            </div>
                            <h3 className="text-[#e5e4e2] font-light text-sm">{feature.title}</h3>
                            {feature.description && (
                              <p className="text-[#e5e4e2]/60 text-xs mt-1">{feature.description}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="prose prose-invert max-w-none">
                    <p className="text-[#e5e4e2]/80 text-base md:text-lg font-light leading-relaxed whitespace-pre-line">
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
          <section className="py-16 bg-[#0f1119] border-t border-[#d3bb73]/10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="mb-8">
                <h2 className="text-3xl font-light text-[#e5e4e2] mb-2">
                  Galeria <span className="text-[#d3bb73]">Zdjęć</span>
                </h2>
                <p className="text-[#e5e4e2]/60">
                  Edytuj zdjęcia z wydarzenia
                </p>
              </div>
              <PortfolioGalleryEditor
                gallery={gallery}
                onChange={setGallery}
              />
            </div>
          </section>
        ) : (
          gallery && gallery.length > 0 && (
            <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center mb-16">
                  <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
                    Galeria Wydarzenia
                  </h2>
                  <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {gallery.map((image, index) => (
                    <div
                      key={index}
                      onClick={() => openLightbox(index)}
                      className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-[#d3bb73]/10 hover:border-[#d3bb73]/30 transition-all duration-300 cursor-pointer"
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
          )
        )}

        {/* Tips Section (only in edit mode) */}
        {isEditing && (
          <section className="py-12 bg-[#0a0c15]">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="bg-[#d3bb73]/5 border border-[#d3bb73]/20 rounded-xl p-6">
                <h3 className="text-lg font-light text-[#e5e4e2] mb-3">Porady</h3>
                <ul className="text-[#e5e4e2]/60 text-sm space-y-2">
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
          <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
                Zorganizujmy Twoje Wydarzenie!
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
        )}

        {/* Fullscreen Lightbox */}
        {lightboxOpen && gallery.length > 0 && (
          <div className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center">
            {/* Close Button */}
            <button
              onClick={closeLightbox}
              className="absolute top-4 right-4 text-white hover:text-[#d3bb73] transition-colors z-10"
              aria-label="Zamknij"
            >
              <XCircle className="w-10 h-10" />
            </button>

            {/* Previous Button */}
            {gallery.length > 1 && (
              <button
                onClick={goToPrevious}
                className="absolute left-4 text-white hover:text-[#d3bb73] transition-colors z-10"
                aria-label="Poprzednie zdjęcie"
              >
                <ChevronLeft className="w-12 h-12" />
              </button>
            )}

            {/* Image */}
            <div className="relative max-w-7xl max-h-[90vh] mx-4">
              <img
                src={gallery[currentImageIndex]?.image_metadata?.desktop?.src || gallery[currentImageIndex]?.src}
                alt={gallery[currentImageIndex]?.alt || `Zdjęcie ${currentImageIndex + 1}`}
                className="max-w-full max-h-[90vh] object-contain"
              />

              {/* Image Caption */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                <p className="text-white text-center">
                  {gallery[currentImageIndex]?.alt || `Zdjęcie ${currentImageIndex + 1}`}
                </p>
                <p className="text-white/60 text-sm text-center mt-2">
                  {currentImageIndex + 1} / {gallery.length}
                </p>
              </div>
            </div>

            {/* Next Button */}
            {gallery.length > 1 && (
              <button
                onClick={goToNext}
                className="absolute right-4 text-white hover:text-[#d3bb73] transition-colors z-10"
                aria-label="Następne zdjęcie"
              >
                <ChevronRight className="w-12 h-12" />
              </button>
            )}

            {/* Keyboard Hints */}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-white/60 text-sm">
              <p>Użyj strzałek ← → aby nawigować | ESC aby zamknąć</p>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
