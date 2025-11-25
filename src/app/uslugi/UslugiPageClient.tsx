'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Head from 'next/head';
import {
  Mic,
  Camera,
  Lightbulb,
  Monitor,
  Wifi,
  Settings,
  Award,
  Shield,
  Users,
  Video,
  FileSearch,
  MapPin,
  MessageSquare,
  Search,
  FileText,
  CheckCircle,
  Play,
  Package,
  Music,
  Presentation,
  Star,
  ArrowRight,
  Mail,
  Plus,
  Trash2,
  Edit2,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ContactFormWithTracking from '@/components/ContactFormWithTracking';
import Link from 'next/link';
import { useEditMode } from '@/contexts/EditModeContext';
import { WebsiteEditButton } from '@/components/WebsiteEditButton';
import { AdminAddServiceModal } from '@/components/AdminAddServiceModal';
import { AdminServiceEditor } from '@/components/AdminServiceEditor';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import PageLayout from '@/components/Layout/PageLayout';
import { Metadata } from 'next';

const iconMap: Record<string, any> = {
  Mic,
  Camera,
  Lightbulb,
  Monitor,
  Wifi,
  Settings,
  Award,
  Shield,
  Users,
  Video,
  FileSearch,
  MapPin,
  MessageSquare,
  Search,
  FileText,
  CheckCircle,
  Play,
  Package,
  Music,
  Presentation,
  Volume2: Mic,
  Truck: Package,
};

const getIcon = (iconName: string) => {
  return iconMap[iconName] || Settings;
};

export function UslugiPageClient() {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const [serviceCategories, setServiceCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isContactFormOpen, setIsContactFormOpen] = useState(false);
  const [addingToCategoryId, setAddingToCategoryId] = useState<string | null>(null);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);

  useEffect(() => {
    loadServices();
  }, [isEditMode]);

  const loadServices = async () => {
    try {
      let query = supabase
        .from('conferences_service_categories')
        .select(
          `
          *,
          items:conferences_service_items(*)
        `,
        )
        .order('display_order');

      // W trybie zwykłym filtruj tylko aktywne kategorie
      if (!isEditMode) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query;

      if (data) {
        setServiceCategories(data);
      }
    } catch (error) {
      console.error('Error loading services:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteService = async (serviceId: string, serviceName: string) => {
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

  const filteredCategories = serviceCategories
    .map((category) => {
      const filteredItems =
        category.items?.filter((item: any) => {
          const matchesSearch =
            searchQuery === '' ||
            item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.description?.toLowerCase().includes(searchQuery.toLowerCase());

          // W trybie edycji pokazuj wszystkie, normalnie tylko aktywne
          const matchesActive = isEditMode ? true : item.is_active;

          return matchesActive && matchesSearch;
        }) || [];

      return {
        ...category,
        items: filteredItems,
      };
    })
    .filter((category) => selectedCategory === null || category.slug === selectedCategory)
    .filter((category) => category.items.length > 0);

  const totalServices = serviceCategories.reduce(
    (sum, cat) => sum + (cat.items?.filter((item: any) => item.is_active).length || 0),
    0,
  );

  const premiumServices = serviceCategories.reduce(
    (sum, cat) =>
      sum + (cat.items?.filter((item: any) => item.is_active && item.is_premium).length || 0),
    0,
  );

  // 🔗 Canonical dla tej strony
  const canonicalUrl = 'https://mavinci.pl/oferta/uslugi';

  // 📦 JSON-LD: ItemList (katalog usług)
  const itemListJsonLd = {
    '@type': 'ItemList',
    name: 'Usługi Eventowe MAVINCI',
    description: 'Kompletny katalog usług technicznych i kreatywnych dla wydarzeń',
    numberOfItems: totalServices,
    itemListElement: serviceCategories.map((category, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      item: {
        '@type': 'Service',
        name: category.name,
        description: category.description,
        provider: {
          '@type': 'Organization',
          name: 'MAVINCI Event & ART',
        },
      },
    })),
  };

  // 🧭 JSON-LD: BreadcrumbList dla tej podstrony
  const breadcrumbJsonLd = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Strona główna',
        item: 'https://mavinci.pl/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Oferta',
        item: 'https://mavinci.pl/oferta',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Katalog usług eventowych',
        item: canonicalUrl,
      },
    ],
  };

  // 🔗 Jeden wspólny JSON-LD z @graph
  const combinedJsonLd = {
    '@context': 'https://schema.org',
    '@graph': [itemListJsonLd, breadcrumbJsonLd],
  };

  if (loading) {
    return (
      <>    
        <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
          <div className="text-lg text-[#d3bb73]">Ładowanie usług...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-[#0f1119]">
        {/* Hero Section */}
        <section className="bg-gradient-to-b from-[#1c1f33] to-[#0f1119] px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <div className="mb-12 text-center">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-2">
                <Star className="h-4 w-4 text-[#d3bb73]" />
                <span className="text-sm font-medium text-[#d3bb73]">Katalog Usług</span>
              </div>

              <h1 className="mb-6 text-4xl font-light text-[#e5e4e2] md:text-6xl">
                Pełna Lista <span className="text-[#d3bb73]">Usług Eventowych</span>
              </h1>

              <p className="mx-auto mb-8 max-w-3xl text-lg text-[#e5e4e2]/70">
                Odkryj wszystkie nasze możliwości techniczne i kreatywne. Od profesjonalnego
                nagłośnienia po najnowsze innowacje w świecie eventów.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#d3bb73]/10">
                    <span className="text-lg font-bold text-[#d3bb73]">{totalServices}</span>
                  </div>
                  <div className="text-left">
                    <div className="font-medium text-[#e5e4e2]">Usług</div>
                    <div className="text-xs text-[#e5e4e2]/40">w ofercie</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#d3bb73]/10">
                    <span className="text-lg font-bold text-[#d3bb73]">
                      {serviceCategories.length}
                    </span>
                  </div>
                  <div className="text-left">
                    <div className="font-medium text-[#e5e4e2]">Kategorii</div>
                    <div className="text-xs text-[#e5e4e2]/40">tematycznych</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#d3bb73]/10">
                    <Star className="h-6 w-6 text-[#d3bb73]" />
                  </div>
                  <div className="text-left">
                    <div className="font-medium text-[#e5e4e2]">{premiumServices} Premium</div>
                    <div className="text-xs text-[#e5e4e2]/40">najwyższej klasy</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="mx-auto mb-12 max-w-4xl">
              <div className="relative mb-6">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
                <input
                  type="text"
                  placeholder="Szukaj usługi... (np. streaming, LED, quiz)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-full border border-[#d3bb73]/20 bg-[#1c1f33] py-4 pl-12 pr-4 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={`rounded-full px-4 py-2 text-sm transition-all ${
                    selectedCategory === null
                      ? 'bg-[#d3bb73] font-medium text-[#1c1f33]'
                      : 'border border-[#d3bb73]/20 bg-[#1c1f33] text-[#e5e4e2]/70 hover:border-[#d3bb73]/40'
                  }`}
                >
                  Wszystkie
                </button>
                {serviceCategories.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => setSelectedCategory(category.slug)}
                    className={`rounded-full px-4 py-2 text-sm transition-all ${
                      selectedCategory === category.slug
                        ? 'bg-[#d3bb73] font-medium text-[#1c1f33]'
                        : 'border border-[#d3bb73]/20 bg-[#1c1f33] text-[#e5e4e2]/70 hover:border-[#d3bb73]/40'
                    }`}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ✅ Breadcrumb pod hero */}
        <section className="px-6 pt-4 min-h-[50px]">
          <div className="mx-auto min-h-[50px] max-w-screen-lg">
            <CategoryBreadcrumb />
          </div>
        </section>

        {/* Services List */}
        <section className="px-6 py-20">
          <div className="mx-auto max-w-7xl space-y-16">
            {filteredCategories.map((category, idx) => {
              const Icon = getIcon(category.icon);

              return (
                <div
                  key={category.id}
                  className="animate-fade-in-up"
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  <div className="mb-8 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-[#d3bb73]/10">
                        <Icon className="h-8 w-8 text-[#d3bb73]" />
                      </div>
                      <div>
                        <h2 className="text-3xl font-light text-[#e5e4e2]">{category.name}</h2>
                        {category.description && (
                          <p className="mt-1 text-sm text-[#e5e4e2]/60">{category.description}</p>
                        )}
                      </div>
                    </div>

                    {isEditMode && (
                      <button
                        onClick={() => setAddingToCategoryId(category.id)}
                        className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                      >
                        <Plus className="h-4 w-4" />
                        Dodaj usługę
                      </button>
                    )}
                  </div>

                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {category.items.map((item: any) => (
                      <div key={item.id} className="group relative">
                        {isEditMode && (
                          <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
                            {!item.is_active && (
                              <div className="rounded-lg bg-red-500/90 px-3 py-2 text-xs font-medium text-white shadow-lg">
                                Nieaktywna
                              </div>
                            )}
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                setEditingServiceId(item.id);
                              }}
                              className="rounded-lg bg-[#d3bb73] p-2 text-[#1c1f33] shadow-lg transition-colors hover:bg-[#d3bb73]/90"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                handleDeleteService(item.id, item.name);
                              }}
                              className="rounded-lg bg-red-500 p-2 text-white shadow-lg transition-colors hover:bg-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}

                        <Link
                          href={`/uslugi/${item.slug}`}
                          className={`block overflow-hidden rounded-xl border transition-all hover:scale-105 hover:transform ${
                            !item.is_active && isEditMode
                              ? 'border-red-500/40 bg-[#1c1f33]/50 opacity-60'
                              : 'border-[#d3bb73]/20 bg-[#1c1f33] hover:border-[#d3bb73]/40'
                          }`}
                        >
                          {item.thumbnail_url && (
                            <div className="aspect-video overflow-hidden bg-[#0f1119]">
                              <img
                                src={item.thumbnail_url}
                                alt={item.name}
                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                                loading="lazy"
                              />
                            </div>
                          )}

                          <div className="p-6">
                            <div className="mb-3 flex items-start justify-between">
                              <h3
                                className={`text-lg font-medium ${
                                  item.is_premium ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'
                                }`}
                              >
                                {item.name}
                              </h3>
                              {item.is_premium && (
                                <div className="flex flex-shrink-0 items-center gap-1 rounded-full bg-[#d3bb73]/10 px-2 py-1">
                                  <Star className="h-3 w-3 fill-[#d3bb73] text-[#d3bb73]" />
                                  <span className="text-xs font-medium text-[#d3bb73]">
                                    Premium
                                  </span>
                                </div>
                              )}
                            </div>

                            {item.description && (
                              <p className="line-clamp-2 text-sm leading-relaxed text-[#e5e4e2]/60">
                                {item.description}
                              </p>
                            )}

                            <div className="mt-4 border-t border-[#d3bb73]/10 pt-4 opacity-0 transition-opacity group-hover:opacity-100">
                              <span className="flex items-center gap-2 text-sm font-medium text-[#d3bb73] transition-all group-hover:gap-3">
                                Zobacz szczegóły
                                <ArrowRight className="h-4 w-4" />
                              </span>
                            </div>
                          </div>
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {filteredCategories.length === 0 && (
              <div className="py-20 text-center">
                <Search className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
                <h3 className="mb-2 text-2xl font-light text-[#e5e4e2]">Nie znaleziono usług</h3>
                <p className="text-[#e5e4e2]/60">
                  Spróbuj zmienić kryteria wyszukiwania lub skontaktuj się z nami bezpośrednio
                </p>
              </div>
            )}
          </div>
        </section>

        {/* CTA Section */}
        <section className="bg-gradient-to-b from-[#0f1119] to-[#1c1f33] px-6 py-20">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Potrzebujesz <span className="text-[#d3bb73]">czegoś więcej?</span>
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-[#e5e4e2]/70">
              Nasze możliwości wykraczają poza standardową ofertę. Realizujemy niestandardowe
              projekty i łączymy usługi w kompleksowe pakiety dostosowane do Twoich potrzeb.
            </p>

            <div className="flex flex-wrap justify-center gap-4">
              <button
                onClick={() => setIsContactFormOpen(true)}
                className="inline-flex transform items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-4 text-lg font-medium text-[#1c1f33] shadow-lg transition-all hover:scale-105 hover:bg-[#d3bb73]/90"
              >
                <Mail className="h-5 w-5" />
                Zapytaj o wycenę
              </button>

              <a
                href="/oferta"
                className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#1c1f33] px-8 py-4 text-lg font-medium text-[#e5e4e2] transition-all hover:border-[#d3bb73]"
              >
                Zobacz pakiety usług
                <ArrowRight className="h-5 w-5" />
              </a>
            </div>

            <p className="mt-6 text-sm text-[#e5e4e2]/40">
              Odpowiedź w 24h • Bezpłatna konsultacja techniczna • Wycena bez zobowiązań
            </p>
          </div>
        </section>

        {isContactFormOpen && (
          <ContactFormWithTracking
            isOpen={isContactFormOpen}
            onClose={() => setIsContactFormOpen(false)}
            sourcePage="/uslugi"
          />
        )}

        {addingToCategoryId && (
          <AdminAddServiceModal
            categoryId={addingToCategoryId}
            categoryName={
              serviceCategories.find((cat) => cat.id === addingToCategoryId)?.name || ''
            }
            onClose={() => setAddingToCategoryId(null)}
            onAdded={loadServices}
          />
        )}

        {editingServiceId && (
          <AdminServiceEditor
            serviceId={editingServiceId}
            onClose={() => setEditingServiceId(null)}
            onSaved={loadServices}
          />
        )}
      </div>
    </>
  );
}