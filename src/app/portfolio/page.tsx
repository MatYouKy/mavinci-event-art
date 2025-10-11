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
    image: 'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Kompleksowa organizacja targów branżowych w Olsztynie - obsługa 200 wystawców, catering, multimedia',
    order_index: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-2',
    title: 'Integracja Firmowa - Mazury',
    category: 'Integracja Pracownicza',
    image: 'https://images.pexels.com/photos/2788488/pexels-photo-2788488.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Dwudniowa integracja dla 150 pracowników z team buildingiem nad Jeziorakami w województwie warmińsko-mazurskim',
    order_index: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-3',
    title: 'Konferencja Biznesowa Gdańsk',
    category: 'Konferencje',
    image: 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Międzynarodowa konferencja biznesowa w Gdańsku - 500 uczestników, tłumaczenia symultaniczne, strefy networkingowe',
    order_index: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-4',
    title: 'Gala Biznesowa Warszawa',
    category: 'Eventy Korporacyjne',
    image: 'https://images.pexels.com/photos/1112080/pexels-photo-1112080.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Ekskluzywna gala biznesowa w Warszawie dla 300 gości - profesjonalna scenografia i catering premium',
    order_index: 4,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-5',
    title: 'Event Marketingowy Toruń',
    category: 'Event Marketing',
    image: 'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Kampania eventowa w Toruniu - road show, degustacje produktu, aktywacja marki, obsługa influencerów',
    order_index: 5,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-6',
    title: 'Festiwal Muzyczny',
    category: 'Festival',
    image: 'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Wielki festiwal muzyczny z profesjonalną sceną i kompleksową obsługą eventową',
    order_index: 6,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-7',
    title: 'Konferencja Medyczna',
    category: 'Konferencje',
    image: 'https://images.pexels.com/photos/3182750/pexels-photo-3182750.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Konferencja medyczna z symultanicznym tłumaczeniem',
    order_index: 7,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-8',
    title: 'Wieczór Tematyczny - Gatsby',
    category: 'Eventy Korporacyjne',
    image: 'https://images.pexels.com/photos/1679618/pexels-photo-1679618.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Stylizowany wieczór w klimacie lat 20.',
    order_index: 8,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-9',
    title: 'Targi Tech Expo',
    category: 'Targi i Wystawy',
    image: 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=800',
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
            position: values.imageData.image_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 },
          },
          mobile: {
            src: imageUrl,
            position: values.imageData.image_metadata?.mobile?.position || { posX: 0, posY: 0, scale: 1 },
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

      const { error } = await supabase
        .from('portfolio_projects')
        .insert([payload]);

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
      const { error } = await supabase
        .from('portfolio_projects')
        .delete()
        .eq('id', id);

      if (error) throw error;

      showSnackbar('Projekt usunięty pomyślnie', 'success');
      fetchProjects();
    } catch (error: any) {
      console.error('Error deleting project:', error);
      showSnackbar('Błąd podczas usuwania projektu', 'error');
    }
  };


  const categories = ['all', ...Array.from(new Set(projects.map(p => p.category)))];
  const filteredProjects = selectedCategory === 'all'
    ? projects
    : projects.filter(p => p.category === selectedCategory);

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#0f1119]">
        <PageHeroImage
          section="portfolio"
          defaultImage="https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920"
          defaultOpacity={0.2}
          className="py-24 md:py-32 overflow-hidden"
        >
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                <Eye className="w-5 h-5 text-[#d3bb73]" />
                <span className="text-[#d3bb73] text-sm font-medium">Nasze Realizacje</span>
              </div>

              <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                Portfolio <span className="text-[#d3bb73]">Eventowe</span>
              </h1>

              <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed max-w-2xl mx-auto">
                Zobacz projekty, które stworzyliśmy dla naszych klientów. Od konferencji biznesowych po wielkie festiwale.
              </p>
            </div>
          </div>
        </PageHeroImage>

        <section className="py-16 bg-[#0f1119]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <Filter className="w-5 h-5 text-[#d3bb73]" />
                <h2 className="text-xl font-light text-[#e5e4e2]">Filtruj projekty</h2>
              </div>
              <div className="flex items-center gap-4">
                <p className="text-[#e5e4e2]/60 text-sm">
                  {filteredProjects.length} {filteredProjects.length === 1 ? 'projekt' : 'projektów'}
                </p>
                {isEditMode && (
                  <button
                    onClick={() => router.push('/portfolio/new')}
                    className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                    Dodaj wydarzenie
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-3 mb-12">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-6 py-2 rounded-full text-sm font-light transition-all duration-300 ${
                    selectedCategory === category
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] hover:bg-[#d3bb73]/20'
                  }`}
                >
                  {category === 'all' ? 'Wszystkie' : category}
                </button>
              ))}
            </div>

            {isAdding && (
              <div className="mb-12 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-2xl p-8">
                <h3 className="text-2xl font-light text-[#e5e4e2] mb-6">Nowe Wydarzenie</h3>
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
                        <label className="block text-[#e5e4e2] text-sm font-medium mb-2">Hero Image</label>
                        <ImageEditorField
                          fieldName="imageData"
                          isAdmin={true}
                          mode="vertical"
                          multiplier={1.25}
                          onSave={async () => {}}
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <FormInput name="title" label="Tytuł wydarzenia" placeholder="Gala Biznesowa 2024" />
                        <FormInput name="category" label="Kategoria" placeholder="Eventy Korporacyjne" />
                        <FormInput name="location" label="Lokalizacja" placeholder="Warszawa" />
                        <FormInput name="event_date" label="Data wydarzenia" type="date" />
                        <FormInput name="order_index" label="Kolejność" type="number" />
                        <div className="md:col-span-2">
                          <FormInput name="description" label="Opis wydarzenia" multiline rows={3} />
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={submitForm}
                          className="flex items-center gap-2 px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                        >
                          <Save className="w-4 h-4" />
                          Zapisz
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsAdding(false)}
                          className="flex items-center gap-2 px-6 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                        >
                          <X className="w-4 h-4" />
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
                <div className="text-[#d3bb73] text-lg">Ładowanie projektów...</div>
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[#e5e4e2]/60">Brak projektów w wybranej kategorii</p>
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-6 md:gap-8">
                {filteredProjects.map((project) => {
                  const projectId = project.id || '';

                  return (
                    <div
                      key={projectId}
                      className="group relative overflow-hidden rounded-2xl w-full md:w-[calc(50%-1rem)] lg:w-[calc(33.333%-1.33rem)]"
                      onMouseEnter={() => setHoveredId(projectId)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <a
                        href={`/portfolio/${projectId}`}
                        className="block"
                      >
                        <div className="aspect-[4/5] relative overflow-hidden">
                          <img
                            src={project.image_metadata?.desktop?.src || project.image}
                            alt={project.alt || project.title}
                            className="w-full h-full object-cover transition-all duration-700 group-hover:scale-110"
                          />

                          <div className="absolute inset-0 bg-gradient-to-t from-[#1c1f33] via-[#1c1f33]/60 to-transparent opacity-80 group-hover:opacity-95 transition-opacity duration-500"></div>

                          <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-all duration-500 transform translate-y-[-10px] group-hover:translate-y-0">
                            {isEditMode ? (
                              <>
                                <a
                                  href={`/portfolio/${projectId}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-10 h-10 rounded-full bg-[#d3bb73]/90 backdrop-blur-sm flex items-center justify-center hover:bg-[#d3bb73] transition-colors duration-300 hover:scale-110 transform"
                                >
                                  <Edit className="w-5 h-5 text-[#1c1f33]" />
                                </a>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleDelete(projectId);
                                  }}
                                  className="w-10 h-10 rounded-full bg-[#800020]/90 backdrop-blur-sm flex items-center justify-center hover:bg-[#800020] transition-colors duration-300 hover:scale-110 transform"
                                >
                                  <Trash2 className="w-5 h-5 text-[#e5e4e2]" />
                                </button>
                              </>
                            ) : (
                              <>
                                <div className="w-10 h-10 rounded-full bg-[#d3bb73]/90 backdrop-blur-sm flex items-center justify-center hover:bg-[#d3bb73] transition-colors duration-300 hover:scale-110 transform">
                                  <Eye className="w-5 h-5 text-[#1c1f33]" />
                                </div>
                                <div className="w-10 h-10 rounded-full bg-[#d3bb73]/90 backdrop-blur-sm flex items-center justify-center hover:bg-[#d3bb73] transition-colors duration-300 hover:scale-110 transform">
                                  <ArrowUpRight className="w-5 h-5 text-[#1c1f33]" />
                                </div>
                              </>
                            )}
                          </div>

                          <div className="absolute bottom-0 left-0 right-0 p-6 transform transition-all duration-500">
                            <div className="mb-3">
                              <span className="inline-block px-3 py-1 bg-[#d3bb73]/20 backdrop-blur-md border border-[#d3bb73]/40 rounded-full text-[#d3bb73] text-xs font-light tracking-wide">
                                {project.category}
                              </span>
                            </div>

                            <h3 className="text-xl md:text-2xl font-light text-[#e5e4e2] mb-2 transform transition-all duration-500 group-hover:translate-x-2">
                              {project.title}
                            </h3>

                            <p
                              className={`text-[#e5e4e2]/70 text-sm font-light leading-relaxed transition-all duration-500 ${
                                hoveredId === projectId
                                  ? 'opacity-100 translate-y-0 max-h-20'
                                  : 'opacity-0 translate-y-4 max-h-0'
                              }`}
                            >
                              {project.description}
                            </p>
                          </div>

                          <div className="absolute inset-0 border-2 border-transparent group-hover:border-[#d3bb73]/30 rounded-2xl transition-all duration-500 pointer-events-none"></div>
                        </div>
                      </a>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Eye className="w-16 h-16 text-[#d3bb73] mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
              Chcesz Zobaczyć Więcej?
            </h2>
            <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
              To tylko przykłady naszych realizacji. Skontaktuj się z nami, aby poznać pełne portfolio i omówić szczegóły Twojego projektu.
            </p>
            <a
              href="/#kontakt"
              className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
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
