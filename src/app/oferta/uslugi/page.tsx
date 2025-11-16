'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Head from 'next/head';
import {
  Mic, Camera, Lightbulb, Monitor, Wifi, Settings,
  Award, Shield, Users, Video, FileSearch, MapPin,
  MessageSquare, Search, FileText, CheckCircle, Play, Package,
  Music, Presentation, Star, ArrowRight, Mail, Plus, Trash2, Save, X
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ContactFormWithTracking from '@/components/ContactFormWithTracking';
import Link from 'next/link';
import { useEditMode } from '@/contexts/EditModeContext';
import { WebsiteEditButton } from '@/components/WebsiteEditButton';
import { useSnackbar } from '@/contexts/SnackbarContext';

const iconMap: Record<string, any> = {
  Mic, Camera, Lightbulb, Monitor, Wifi, Settings,
  Award, Shield, Users, Video, FileSearch, MapPin,
  MessageSquare, Search, FileText, CheckCircle, Play, Package,
  Music, Presentation,
  Volume2: Mic, Truck: Package
};

const getIcon = (iconName: string) => {
  return iconMap[iconName] || Settings;
};

export default function UslugiPage() {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const [serviceCategories, setServiceCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isContactFormOpen, setIsContactFormOpen] = useState(false);

  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editingService, setEditingService] = useState<any>(null);
  const [addingToCategoryId, setAddingToCategoryId] = useState<string | null>(null);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceDescription, setNewServiceDescription] = useState('');

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    try {
      const { data, error } = await supabase
        .from('conferences_service_categories')
        .select(`
          *,
          items:conferences_service_items(*)
        `)
        .eq('is_active', true)
        .order('display_order');

      if (data) {
        setServiceCategories(data);
      }
    } catch (error) {
      console.error('Error loading services:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteService = async (serviceId: string, serviceName: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm(`Czy na pewno chcesz usunąć usługę "${serviceName}"?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('conferences_service_items')
        .delete()
        .eq('id', serviceId);

      if (error) throw error;

      showSnackbar('Usługa usunięta', 'success');
      loadServices();
    } catch (error) {
      console.error('Error deleting service:', error);
      showSnackbar('Błąd usuwania usługi', 'error');
    }
  };

  const handleStartEditing = (service: any, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingServiceId(service.id);
    setEditingService({
      name: service.name,
      description: service.description || ''
    });
  };

  const handleSaveEdit = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!editingService.name.trim()) {
      showSnackbar('Nazwa nie może być pusta', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('conferences_service_items')
        .update({
          name: editingService.name.trim(),
          description: editingService.description.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', editingServiceId);

      if (error) throw error;

      showSnackbar('Zapisano zmiany', 'success');
      setEditingServiceId(null);
      setEditingService(null);
      loadServices();
    } catch (error) {
      console.error('Error saving service:', error);
      showSnackbar('Błąd zapisu', 'error');
    }
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingServiceId(null);
    setEditingService(null);
  };

  const handleAddService = async (categoryId: string) => {
    if (!newServiceName.trim()) {
      showSnackbar('Nazwa usługi jest wymagana', 'error');
      return;
    }

    try {
      const slug = newServiceName
        .toLowerCase()
        .replace(/[ąĄ]/g, 'a')
        .replace(/[ćĆ]/g, 'c')
        .replace(/[ęĘ]/g, 'e')
        .replace(/[łŁ]/g, 'l')
        .replace(/[ńŃ]/g, 'n')
        .replace(/[óÓ]/g, 'o')
        .replace(/[śŚ]/g, 's')
        .replace(/[źŹżŻ]/g, 'z')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const { error } = await supabase
        .from('conferences_service_items')
        .insert({
          category_id: categoryId,
          name: newServiceName.trim(),
          slug,
          description: newServiceDescription.trim() || null,
          is_active: true,
          display_order: 999
        });

      if (error) throw error;

      showSnackbar('Usługa dodana', 'success');
      setAddingToCategoryId(null);
      setNewServiceName('');
      setNewServiceDescription('');
      loadServices();
    } catch (error: any) {
      console.error('Error adding service:', error);
      if (error.code === '23505') {
        showSnackbar('Usługa o takiej nazwie już istnieje', 'error');
      } else {
        showSnackbar('Błąd dodawania usługi', 'error');
      }
    }
  };

  const filteredCategories = serviceCategories.map(category => {
    const filteredItems = category.items?.filter((item: any) => {
      const matchesSearch = searchQuery === '' ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description?.toLowerCase().includes(searchQuery.toLowerCase());

      return item.is_active && matchesSearch;
    }) || [];

    return {
      ...category,
      items: filteredItems
    };
  }).filter(category =>
    selectedCategory === null || category.slug === selectedCategory
  ).filter(category => category.items.length > 0 || isEditMode);

  const totalServices = serviceCategories.reduce((sum, cat) =>
    sum + (cat.items?.filter((item: any) => item.is_active).length || 0), 0
  );

  const premiumServices = serviceCategories.reduce((sum, cat) =>
    sum + (cat.items?.filter((item: any) => item.is_active && item.is_premium).length || 0), 0
  );

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
          <div className="text-[#d3bb73] text-lg">Ładowanie usług...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Pełna Lista Usług Eventowych - MAVINCI Event & ART</title>
        <meta
          name="description"
          content="Kompletny katalog usług eventowych MAVINCI: nagłośnienie, oświetlenie, ekrany LED, kamery 4K, streaming, quizy, foto atrakcje. 67+ usług dla Twojego wydarzenia."
        />
      </Head>

      <Navbar />
      <WebsiteEditButton />
      <div className="min-h-screen bg-[#0f1119]">
        {/* Hero Section */}
        <section className="py-20 px-6 bg-gradient-to-b from-[#1c1f33] to-[#0f1119]">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                <Star className="w-4 h-4 text-[#d3bb73]" />
                <span className="text-[#d3bb73] text-sm font-medium">Katalog Usług</span>
              </div>

              <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                Pełna Lista <span className="text-[#d3bb73]">Usług Eventowych</span>
              </h1>

              <p className="text-[#e5e4e2]/70 text-lg max-w-3xl mx-auto mb-8">
                Odkryj wszystkie nasze możliwości techniczne i kreatywne. Od profesjonalnego nagłośnienia
                po najnowsze innowacje w świecie eventów.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                    <span className="text-[#d3bb73] font-bold text-lg">{totalServices}</span>
                  </div>
                  <div className="text-left">
                    <div className="text-[#e5e4e2] font-medium">Usług</div>
                    <div className="text-[#e5e4e2]/40 text-xs">w ofercie</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                    <span className="text-[#d3bb73] font-bold text-lg">{serviceCategories.length}</span>
                  </div>
                  <div className="text-left">
                    <div className="text-[#e5e4e2] font-medium">Kategorii</div>
                    <div className="text-[#e5e4e2]/40 text-xs">tematycznych</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                    <Star className="w-6 h-6 text-[#d3bb73]" />
                  </div>
                  <div className="text-left">
                    <div className="text-[#e5e4e2] font-medium">{premiumServices} Premium</div>
                    <div className="text-[#e5e4e2]/40 text-xs">najwyższej klasy</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="max-w-4xl mx-auto mb-12">
              <div className="relative mb-6">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
                <input
                  type="text"
                  placeholder="Szukaj usługi... (np. streaming, LED, quiz)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-full pl-12 pr-4 py-4 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap gap-2 justify-center">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={`px-4 py-2 rounded-full text-sm transition-all ${
                    selectedCategory === null
                      ? 'bg-[#d3bb73] text-[#1c1f33] font-medium'
                      : 'bg-[#1c1f33] text-[#e5e4e2]/70 border border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                >
                  Wszystkie
                </button>
                {serviceCategories.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => setSelectedCategory(category.slug)}
                    className={`px-4 py-2 rounded-full text-sm transition-all ${
                      selectedCategory === category.slug
                        ? 'bg-[#d3bb73] text-[#1c1f33] font-medium'
                        : 'bg-[#1c1f33] text-[#e5e4e2]/70 border border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                    }`}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Services List */}
        <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto space-y-16">
            {filteredCategories.map((category, idx) => {
              const Icon = getIcon(category.icon);

              return (
                <div key={category.id} className="animate-fade-in-up" style={{ animationDelay: `${idx * 100}ms` }}>
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 bg-[#d3bb73]/10 rounded-2xl flex items-center justify-center flex-shrink-0">
                        <Icon className="w-8 h-8 text-[#d3bb73]" />
                      </div>
                      <div>
                        <h2 className="text-3xl font-light text-[#e5e4e2]">{category.name}</h2>
                        {category.description && (
                          <p className="text-[#e5e4e2]/60 text-sm mt-1">{category.description}</p>
                        )}
                      </div>
                    </div>

                    {isEditMode && (
                      <button
                        onClick={() => {
                          setAddingToCategoryId(category.id);
                          setNewServiceName('');
                          setNewServiceDescription('');
                        }}
                        className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Dodaj usługę
                      </button>
                    )}
                  </div>

                  {/* Add New Service Form */}
                  {isEditMode && addingToCategoryId === category.id && (
                    <div className="mb-6 bg-[#1c1f33] border-2 border-[#d3bb73]/40 rounded-xl p-6">
                      <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Nowa usługa</h3>
                      <div className="space-y-4">
                        <input
                          type="text"
                          value={newServiceName}
                          onChange={(e) => setNewServiceName(e.target.value)}
                          placeholder="Nazwa usługi"
                          className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        />
                        <textarea
                          value={newServiceDescription}
                          onChange={(e) => setNewServiceDescription(e.target.value)}
                          placeholder="Krótki opis"
                          rows={2}
                          className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAddService(category.id)}
                            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                          >
                            <Save className="w-4 h-4" />
                            Zapisz
                          </button>
                          <button
                            onClick={() => {
                              setAddingToCategoryId(null);
                              setNewServiceName('');
                              setNewServiceDescription('');
                            }}
                            className="flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-2 rounded-lg hover:border-[#d3bb73]/40 transition-colors"
                          >
                            <X className="w-4 h-4" />
                            Anuluj
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {category.items.map((item: any) => (
                      <div key={item.id} className="relative">
                        {editingServiceId === item.id ? (
                          // EDIT MODE - Inline
                          <div className="bg-[#1c1f33] border-2 border-[#d3bb73] rounded-xl p-6">
                            <div className="space-y-4">
                              <input
                                type="text"
                                value={editingService.name}
                                onChange={(e) => setEditingService({ ...editingService, name: e.target.value })}
                                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                              />
                              <textarea
                                value={editingService.description}
                                onChange={(e) => setEditingService({ ...editingService, description: e.target.value })}
                                rows={3}
                                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={handleSaveEdit}
                                  className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                                >
                                  <Save className="w-4 h-4" />
                                  Zapisz
                                </button>
                                <button
                                  onClick={handleCancelEdit}
                                  className="flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-2 rounded-lg hover:border-[#d3bb73]/40 transition-colors"
                                >
                                  <X className="w-4 h-4" />
                                  Anuluj
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          // DISPLAY MODE
                          <Link
                            href={`/oferta/uslugi/${item.slug}`}
                            className="group block bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl overflow-hidden hover:border-[#d3bb73]/40 transition-all hover:scale-105"
                          >
                            {item.thumbnail_url && (
                              <div className="aspect-video overflow-hidden bg-[#0f1119]">
                                <img
                                  src={item.thumbnail_url}
                                  alt={item.name}
                                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                                  loading="lazy"
                                />
                              </div>
                            )}

                            <div className="p-6">
                              <div className="flex items-start justify-between mb-3">
                                <h3 className={`text-lg font-medium ${item.is_premium ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'}`}>
                                  {item.name}
                                </h3>
                                {item.is_premium && (
                                  <div className="flex items-center gap-1 bg-[#d3bb73]/10 rounded-full px-2 py-1 flex-shrink-0">
                                    <Star className="w-3 h-3 text-[#d3bb73] fill-[#d3bb73]" />
                                    <span className="text-[#d3bb73] text-xs font-medium">Premium</span>
                                  </div>
                                )}
                              </div>

                              {item.description && (
                                <p className="text-[#e5e4e2]/60 text-sm leading-relaxed line-clamp-2">
                                  {item.description}
                                </p>
                              )}

                              <div className="mt-4 pt-4 border-t border-[#d3bb73]/10 opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="flex items-center gap-2 text-[#d3bb73] text-sm font-medium group-hover:gap-3 transition-all">
                                  Zobacz szczegóły
                                  <ArrowRight className="w-4 h-4" />
                                </span>
                              </div>

                              {isEditMode && (
                                <div className="absolute top-2 right-2 flex gap-2 z-10">
                                  <button
                                    onClick={(e) => handleStartEditing(item, e)}
                                    className="bg-[#d3bb73] text-[#1c1f33] p-2 rounded-lg hover:bg-[#d3bb73]/90 shadow-lg"
                                  >
                                    <Save className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={(e) => handleDeleteService(item.id, item.name, e)}
                                    className="bg-red-500 text-white p-2 rounded-lg hover:bg-red-600 shadow-lg"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {filteredCategories.length === 0 && (
              <div className="text-center py-20">
                <Search className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
                <h3 className="text-2xl font-light text-[#e5e4e2] mb-2">
                  Nie znaleziono usług
                </h3>
                <p className="text-[#e5e4e2]/60">
                  Spróbuj zmienić kryteria wyszukiwania
                </p>
              </div>
            )}
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 px-6 bg-gradient-to-b from-[#0f1119] to-[#1c1f33]">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
              Potrzebujesz <span className="text-[#d3bb73]">czegoś więcej?</span>
            </h2>
            <p className="text-[#e5e4e2]/70 text-lg mb-8 max-w-2xl mx-auto">
              Nasze możliwości wykraczają poza standardową ofertę. Realizujemy niestandardowe projekty
              i łączymy usługi w kompleksowe pakiety dostosowane do Twoich potrzeb.
            </p>

            <div className="flex flex-wrap gap-4 justify-center">
              <button
                onClick={() => setIsContactFormOpen(true)}
                className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-4 rounded-full text-lg font-medium hover:bg-[#d3bb73]/90 transition-all hover:scale-105 transform shadow-lg"
              >
                <Mail className="w-5 h-5" />
                Zapytaj o wycenę
              </button>

              <a
                href="/oferta"
                className="inline-flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/30 text-[#e5e4e2] px-8 py-4 rounded-full text-lg font-medium hover:border-[#d3bb73] transition-all"
              >
                Zobacz pakiety usług
                <ArrowRight className="w-5 h-5" />
              </a>
            </div>

            <p className="text-[#e5e4e2]/40 text-sm mt-6">
              Odpowiedź w 24h • Bezpłatna konsultacja techniczna • Wycena bez zobowiązań
            </p>
          </div>
        </section>

        {isContactFormOpen && (
          <ContactFormWithTracking
            isOpen={isContactFormOpen}
            onClose={() => setIsContactFormOpen(false)}
            defaultSubject="Zapytanie o usługi eventowe"
          />
        )}
      </div>
      <Footer />
    </>
  );
}
