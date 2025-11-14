'use client';

import { useState, useEffect } from 'react';
import { Eye, ArrowUpRight, Filter, Edit, Plus, Trash2, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PortfolioProject, GalleryImage } from '@/lib/supabase';
import { PageHeroImage } from '@/components/PageHeroImage';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { ImageEditorField } from '@/components/ImageEditorField';
import { Formik, Form } from 'formik';
import { FormInput } from '@/components/formik/FormInput';
import { uploadImage } from '@/lib/storage';
import { IUploadImage } from '@/types/image';
import { supabase } from '@/lib/supabase';

const MOCK_PROJECTS: PortfolioProject[] = [
  {
    id: 'mock-1',
    title: 'Targi Branżowe Olsztyn 2024',
    category: 'Targi i Wystawy',
    image:
      'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=800',
    description:
      'Kompleksowa organizacja targów branżowych w Olsztynie - obsługa 200 wystawców, catering, multimedia',
    order_index: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-2',
    title: 'Integracja Firmowa - Mazury',
    category: 'Integracja Pracownicza',
    image:
      'https://images.pexels.com/photos/2788488/pexels-photo-2788488.jpeg?auto=compress&cs=tinysrgb&w=800',
    description:
      'Dwudniowa integracja dla 150 pracowników z team buildingiem nad Jeziorakami w województwie warmińsko-mazurskim',
    order_index: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-3',
    title: 'Konferencja Biznesowa Gdańsk',
    category: 'Konferencje',
    image:
      'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=800',
    description:
      'Międzynarodowa konferencja biznesowa w Gdańsku - 500 uczestników, tłumaczenia symultaniczne, strefy networkingowe',
    order_index: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-4',
    title: 'Gala Biznesowa Warszawa',
    category: 'Eventy Korporacyjne',
    image:
      'https://images.pexels.com/photos/1112080/pexels-photo-1112080.jpeg?auto=compress&cs=tinysrgb&w=800',
    description:
      'Ekskluzywna gala biznesowa w Warszawie dla 300 gości - profesjonalna scenografia i catering premium',
    order_index: 4,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-5',
    title: 'Event Marketingowy Toruń',
    category: 'Event Marketing',
    image:
      'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=800',
    description:
      'Kampania eventowa w Toruniu - road show, degustacje produktu, aktywacja marki, obsługa influencerów',
    order_index: 5,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-6',
    title: 'Festiwal Muzyczny',
    category: 'Festival',
    image:
      'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Wielki festiwal muzyczny z profesjonalną sceną i kompleksową obsługą eventową',
    order_index: 6,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-7',
    title: 'Konferencja Medyczna',
    category: 'Konferencje',
    image:
      'https://images.pexels.com/photos/3182750/pexels-photo-3182750.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Konferencja medyczna z symultanicznym tłumaczeniem',
    order_index: 7,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-8',
    title: 'Wieczór Tematyczny - Gatsby',
    category: 'Eventy Korporacyjne',
    image:
      'https://images.pexels.com/photos/1679618/pexels-photo-1679618.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Stylizowany wieczór w klimacie lat 20.',
    order_index: 8,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-9',
    title: 'Targi Tech Expo',
    category: 'Targi i Wystawy',
    image:
      'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Targi technologiczne z demonstracjami na żywo',
    order_index: 9,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export default function PortfolioPage() {
  const router = useRouter();
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [projects, setProjects] = useState<PortfolioProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('portfolio_projects')
        .select('*')
        .order('order_index', { ascending: true });

      if (!error && data && data.length > 0) {
        setProjects(data);
      } else {
        setProjects(MOCK_PROJECTS);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
      setProjects(MOCK_PROJECTS);
    }
    setLoading(false);
  };

  const handleSave = async (values: any) => {
    try {
      let imageUrl = values.image;
      let imageMetadata = values.image_metadata;

      if (values.imageData?.file) {
        imageUrl = await uploadImage(values.imageData.file, 'portfolio');
        imageMetadata = {
          desktop: {
            src: imageUrl,
            position: values.imageData.image_metadata?.desktop?.position || {
              posX: 0,
              posY: 0,
              scale: 1,
            },
          },
          mobile: {
            src: imageUrl,
            position: values.imageData.image_metadata?.mobile?.position || {
              posX: 0,
              posY: 0,
              scale: 1,
            },
          },
        };
      }

      const payload = {
        title: values.title,
        category: values.category,
        image: imageUrl,
        alt: values.alt || '',
        image_metadata: imageMetadata,
        description: values.description,
        order_index: values.order_index,
        gallery: [],
        hero_image_section: `portfolio-${values.title.toLowerCase().replace(/\s+/g, '-')}`,
        location: values.location || 'Polska',
        event_date: values.event_date || new Date().toISOString().split('T')[0],
      };

      const { error } = await supabase.from('portfolio_projects').insert([payload]);

      if (error) throw error;
      showSnackbar('Projekt dodany pomyślnie', 'success');
      setIsAdding(false);
      fetchProjects();
    } catch (error: any) {
      console.error('Error saving project:', error);
      showSnackbar('Błąd podczas zapisywania projektu', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten projekt?')) return;

    try {
      const { error } = await supabase.from('portfolio_projects').delete().eq('id', id);

      if (error) throw error;

      showSnackbar('Projekt usunięty pomyślnie', 'success');
      fetchProjects();
    } catch (error: any) {
      console.error('Error deleting project:', error);
      showSnackbar('Błąd podczas usuwania projektu', 'error');
    }
  };

  const categories = ['all', ...Array.from(new Set(projects.map((p) => p.category)))];
  const filteredProjects =
    selectedCategory === 'all' ? projects : projects.filter((p) => p.category === selectedCategory);

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#0f1119]">
        <PageHeroImage
          section="portfolio"
          defaultImage="https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920"
          defaultOpacity={0.2}
          className="overflow-hidden py-24 md:py-32"
        >
          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="mb-6 inline-flex items-center gap-3 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-2">
                <Eye className="h-5 w-5 text-[#d3bb73]" />
                <span className="text-sm font-medium text-[#d3bb73]">Nasze Realizacje</span>
              </div>

              <h1 className="mb-6 text-4xl font-light text-[#e5e4e2] md:text-6xl">
                Portfolio <span className="text-[#d3bb73]">Eventowe</span>
              </h1>

              <p className="mx-auto max-w-2xl text-lg font-light leading-relaxed text-[#e5e4e2]/70">
                Zobacz projekty, które stworzyliśmy dla naszych klientów. Od konferencji biznesowych
                po wielkie festiwale.
              </p>
            </div>
          </div>
        </PageHeroImage>

        <section className="bg-[#0f1119] py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-8 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Filter className="h-5 w-5 text-[#d3bb73]" />
                <h2 className="text-xl font-light text-[#e5e4e2]">Filtruj projekty</h2>
              </div>
              <div className="flex items-center gap-4">
                <p className="text-sm text-[#e5e4e2]/60">
                  {filteredProjects.length}{' '}
                  {filteredProjects.length === 1 ? 'projekt' : 'projektów'}
                </p>
                {isEditMode && (
                  <button
                    onClick={() => router.push('/portfolio/new')}
                    className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                  >
                    <Plus className="h-5 w-5" />
                    Dodaj wydarzenie
                  </button>
                )}
              </div>
            </div>

            <div className="mb-12 flex flex-wrap gap-3">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`rounded-full px-6 py-2 text-sm font-light transition-all duration-300 ${
                    selectedCategory === category
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'border border-[#d3bb73]/30 bg-[#d3bb73]/10 text-[#d3bb73] hover:bg-[#d3bb73]/20'
                  }`}
                >
                  {category === 'all' ? 'Wszystkie' : category}
                </button>
              ))}
            </div>

            {isAdding && (
              <div className="mb-12 rounded-2xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-8 backdrop-blur-sm">
                <h3 className="mb-6 text-2xl font-light text-[#e5e4e2]">Nowe Wydarzenie</h3>
                <Formik
                  initialValues={{
                    title: '',
                    category: '',
                    image: '',
                    alt: '',
                    imageData: {} as IUploadImage,
                    description: '',
                    order_index: projects.length,
                    image_metadata: undefined,
                    gallery: [] as GalleryImage[],
                    location: 'Polska',
                    event_date: new Date().toISOString().split('T')[0],
                  }}
                  onSubmit={(values) => handleSave(values)}
                >
                  {({ submitForm, values, setFieldValue }) => (
                    <Form>
                      <div className="mb-6">
                        <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                          Hero Image
                        </label>
                        <ImageEditorField
                          fieldName="imageData"
                          isAdmin={true}
                          mode="vertical"
                          multiplier={1.25}
                          onSave={async () => {}}
                        />
                      </div>

                      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <FormInput
                          name="title"
                          label="Tytuł wydarzenia"
                          placeholder="Gala Biznesowa 2024"
                        />
                        <FormInput
                          name="category"
                          label="Kategoria"
                          placeholder="Eventy Korporacyjne"
                        />
                        <FormInput name="location" label="Lokalizacja" placeholder="Warszawa" />
                        <FormInput name="event_date" label="Data wydarzenia" type="date" />
                        <FormInput name="order_index" label="Kolejność" type="number" />
                        <div className="md:col-span-2">
                          <FormInput
                            name="description"
                            label="Opis wydarzenia"
                            multiline
                            rows={3}
                          />
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={submitForm}
                          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                        >
                          <Save className="h-4 w-4" />
                          Zapisz
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsAdding(false)}
                          className="flex items-center gap-2 rounded-lg bg-[#800020]/20 px-6 py-2 text-[#e5e4e2] transition-colors hover:bg-[#800020]/30"
                        >
                          <X className="h-4 w-4" />
                          Anuluj
                        </button>
                      </div>
                    </Form>
                  )}
                </Formik>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-lg text-[#d3bb73]">Ładowanie projektów...</div>
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-[#e5e4e2]/60">Brak projektów w wybranej kategorii</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
                {filteredProjects.map((project) => {
                  const projectId = project.id || '';

                  return (
                    <div
                      key={projectId}
                      className="group relative overflow-hidden rounded-2xl"
                      onMouseEnter={() => setHoveredId(projectId)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <a href={`/portfolio/${projectId}`} className="block">
                        <div className="relative aspect-[4/5] overflow-hidden">
                          <img
                            src={project.image_metadata?.desktop?.src || project.image}
                            alt={project.alt || project.title}
                            className="h-full w-full object-cover transition-all duration-700 group-hover:scale-110"
                          />

                          <div className="absolute inset-0 bg-gradient-to-t from-[#1c1f33] via-[#1c1f33]/60 to-transparent opacity-80 transition-opacity duration-500 group-hover:opacity-95"></div>

                          <div className="absolute right-4 top-4 flex translate-y-[-10px] transform gap-2 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">
                            {isEditMode ? (
                              <>
                                <a
                                  href={`/portfolio/${projectId}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex h-10 w-10 transform items-center justify-center rounded-full bg-[#d3bb73]/90 backdrop-blur-sm transition-colors duration-300 hover:scale-110 hover:bg-[#d3bb73]"
                                >
                                  <Edit className="h-5 w-5 text-[#1c1f33]" />
                                </a>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleDelete(projectId);
                                  }}
                                  className="flex h-10 w-10 transform items-center justify-center rounded-full bg-[#800020]/90 backdrop-blur-sm transition-colors duration-300 hover:scale-110 hover:bg-[#800020]"
                                >
                                  <Trash2 className="h-5 w-5 text-[#e5e4e2]" />
                                </button>
                              </>
                            ) : (
                              <>
                                <div className="flex h-10 w-10 transform items-center justify-center rounded-full bg-[#d3bb73]/90 backdrop-blur-sm transition-colors duration-300 hover:scale-110 hover:bg-[#d3bb73]">
                                  <Eye className="h-5 w-5 text-[#1c1f33]" />
                                </div>
                                <div className="flex h-10 w-10 transform items-center justify-center rounded-full bg-[#d3bb73]/90 backdrop-blur-sm transition-colors duration-300 hover:scale-110 hover:bg-[#d3bb73]">
                                  <ArrowUpRight className="h-5 w-5 text-[#1c1f33]" />
                                </div>
                              </>
                            )}
                          </div>

                          <div className="absolute bottom-0 left-0 right-0 transform p-6 transition-all duration-500">
                            <div className="mb-3">
                              <span className="inline-block rounded-full border border-[#d3bb73]/40 bg-[#d3bb73]/20 px-3 py-1 text-xs font-light tracking-wide text-[#d3bb73] backdrop-blur-md">
                                {project.category}
                              </span>
                            </div>

                            <h3 className="mb-2 transform text-xl font-light text-[#e5e4e2] transition-all duration-500 group-hover:translate-x-2 md:text-2xl">
                              {project.title}
                            </h3>

                            <p
                              className={`text-sm font-light leading-relaxed text-[#e5e4e2]/70 transition-all duration-500 ${
                                hoveredId === projectId
                                  ? 'max-h-20 translate-y-0 opacity-100'
                                  : 'max-h-0 translate-y-4 opacity-0'
                              }`}
                            >
                              {project.description}
                            </p>
                          </div>

                          <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-transparent transition-all duration-500 group-hover:border-[#d3bb73]/30"></div>
                        </div>
                      </a>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="bg-gradient-to-br from-[#0f1119] to-[#1c1f33] py-24">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <Eye className="mx-auto mb-6 h-16 w-16 text-[#d3bb73]" />
            <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Chcesz Zobaczyć Więcej?
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-lg font-light text-[#e5e4e2]/70">
              To tylko przykłady naszych realizacji. Skontaktuj się z nami, aby poznać pełne
              portfolio i omówić szczegóły Twojego projektu.
            </p>
            <a
              href="/#kontakt"
              className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              Skontaktuj się z nami
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
