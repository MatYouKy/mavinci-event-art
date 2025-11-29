'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, FileText, Search, DollarSign, Calendar, Building2, User, Package, FileType, Edit, Trash2, Eye, Grid3x3, List, Settings, X, Upload, BookOpen } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';
import TechnicalBrochureEditor from './TechnicalBrochureEditor';
import { OffersListView, OffersTableView, OffersGridView } from './OffersViews';
import OfferWizard from '@/components/crm/OfferWizard';

type Tab = 'offers' | 'catalog' | 'templates' | 'brochure';

interface Offer {
  id: string;
  offer_number: string;
  event_id: string;
  client_id: string;
  total_amount: number;
  valid_until: string;
  status: string;
  created_at: string;
  created_by?: string;
  client?: {
    company_name?: string;
    first_name?: string;
    last_name?: string;
  };
  event?: {
    name: string;
    event_date: string;
  };
  creator?: {
    name: string;
    surname: string;
  };
}

interface ProductCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
}

interface Product {
  id: string;
  category_id: string;
  name: string;
  description: string;
  base_price: number;
  cost_price: number;
  transport_cost: number;
  logistics_cost: number;
  unit: string;
  tags: string[];
  is_active: boolean;
  category?: ProductCategory;
}

interface Template {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  is_active: boolean;
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  sent: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  accepted: 'bg-green-500/20 text-green-400 border-green-500/30',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
  expired: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const statusLabels: Record<string, string> = {
  draft: 'Szkic',
  sent: 'Wysłana',
  accepted: 'Zaakceptowana',
  rejected: 'Odrzucona',
  expired: 'Wygasła',
};

export default function OffersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { employee, isAdmin } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();

  const [activeTab, setActiveTab] = useState<Tab>((searchParams.get('tab') as Tab) || 'offers');
  const [loading, setLoading] = useState(true);

  // Oferty
  const [offers, setOffers] = useState<Offer[]>([]);
  const [filteredOffers, setFilteredOffers] = useState<Offer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [offersViewMode, setOffersViewMode] = useState<'list' | 'table' | 'grid'>('list');

  // Katalog produktów
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Szablony
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);

  // Kreator oferty
  const [showOfferWizard, setShowOfferWizard] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [showEventSelector, setShowEventSelector] = useState(false);
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    const tab = searchParams.get('tab') as Tab;
    if (tab && (tab === 'offers' || tab === 'catalog' || tab === 'templates')) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (employee) {
      if (activeTab === 'offers') {
        fetchOffers();
      } else if (activeTab === 'catalog') {
        fetchCategories();
        fetchProducts();
      } else if (activeTab === 'templates') {
        fetchTemplates();
      }
    }
  }, [employee, activeTab]);

  useEffect(() => {
    filterOffers();
  }, [searchQuery, statusFilter, offers]);

  useEffect(() => {
    filterProducts();
  }, [productSearch, categoryFilter, products]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    router.push(`/crm/offers?tab=${tab}`);
  };

  // Fetch functions
  const fetchOffers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('offers')
        .select(`
          *,
          event:events!event_id(
            name,
            event_date,
            organization:organizations(company_name, first_name, last_name),
            contact:contacts!contact_person_id(first_name, last_name)
          ),
          creator:employees!created_by(name, surname)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data) setOffers(data);
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd pobierania ofert', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('offer_product_categories')
        .select('*')
        .eq('is_active', true)
        .order('display_order');

      if (error) throw error;
      if (data) setCategories(data);
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd pobierania kategorii', 'error');
    }
  };

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('offer_products')
        .select(`
          *,
          category:offer_product_categories(id, name, icon)
        `)
        .order('display_order');

      if (error) throw error;
      if (data) setProducts(data);
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd pobierania produktów', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('offer_templates')
        .select('*')
        .order('is_default', { ascending: false });

      if (error) throw error;
      if (data) setTemplates(data);
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd pobierania szablonów', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Filter functions
  const filterOffers = () => {
    let filtered = [...offers];

    if (searchQuery) {
      filtered = filtered.filter(
        (offer) =>
          offer.offer_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          offer.client?.company_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          offer.event?.name?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter((offer) => offer.status === statusFilter);
    }

    setFilteredOffers(filtered);
  };

  const filterProducts = () => {
    let filtered = [...products];

    if (productSearch) {
      filtered = filtered.filter(
        (product) =>
          product.name.toLowerCase().includes(productSearch.toLowerCase()) ||
          product.description?.toLowerCase().includes(productSearch.toLowerCase()) ||
          product.tags?.some(tag => tag.toLowerCase().includes(productSearch.toLowerCase()))
      );
    }

    if (categoryFilter !== 'all') {
      filtered = filtered.filter((product) => product.category_id === categoryFilter);
    }

    setFilteredProducts(filtered);
  };

  const getClientName = (offer: Offer) => {
    // Pobierz nazwę z organizacji lub kontaktu przez event
    const event = (offer as any).event;
    if (event?.organization?.company_name) {
      return event.organization.company_name;
    }
    if (event?.organization?.first_name || event?.organization?.last_name) {
      return `${event.organization.first_name || ''} ${event.organization.last_name || ''}`.trim();
    }
    if (event?.contact?.first_name || event?.contact?.last_name) {
      return `${event.contact.first_name || ''} ${event.contact.last_name || ''}`.trim();
    }

    // Fallback do starego formatu (jeśli istnieje)
    if (offer.client?.company_name) return offer.client.company_name;
    if (offer.client?.first_name || offer.client?.last_name) {
      return `${offer.client.first_name || ''} ${offer.client.last_name || ''}`.trim();
    }

    return 'Brak klienta';
  };

  const handleDeleteOffer = async (offerId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę ofertę? Tej operacji nie można cofnąć.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('offers')
        .delete()
        .eq('id', offerId);

      if (error) throw error;

      showSnackbar('Oferta została usunięta', 'success');
      fetchOffers();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd podczas usuwania oferty', 'error');
    }
  };

  const handleNewOffer = async () => {
    try {
      // Pobierz eventy
      const { data, error } = await supabase
        .from('events')
        .select(`
          id,
          name,
          event_date,
          organization:organizations(company_name, first_name, last_name),
          contact:contacts!contact_person_id(first_name, last_name)
        `)
        .order('event_date', { ascending: false });

      if (error) throw error;
      setEvents(data || []);
      setShowEventSelector(true);
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd pobierania eventów', 'error');
    }
  };

  const handleEventSelect = (eventId: string) => {
    setSelectedEventId(eventId);
    setShowEventSelector(false);
    setShowOfferWizard(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-light text-[#e5e4e2]">Oferty i Katalog</h1>
          <p className="text-sm text-[#e5e4e2]/60 mt-1">
            Zarządzaj ofertami, katalogiem produktów i szablonami
          </p>
        </div>
        <button
          onClick={() => router.push('/technical')}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#d3bb73] to-[#c1a85f] hover:from-[#c1a85f] hover:to-[#d3bb73] text-[#1c1f33] font-medium rounded-lg transition-all duration-300 hover:scale-105"
        >
          <BookOpen className="w-5 h-5" />
          <span>Broszura techniczna</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 border-b border-[#d3bb73]/10">
        <button
          onClick={() => handleTabChange('offers')}
          className={`px-6 py-3 font-medium transition-colors relative ${
            activeTab === 'offers'
              ? 'text-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <div className="flex items-center space-x-2">
            <FileText className="w-5 h-5" />
            <span>Oferty</span>
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-[#1c1f33] text-[#e5e4e2]/60">
              {offers.length}
            </span>
          </div>
          {activeTab === 'offers' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
          )}
        </button>

        <button
          onClick={() => handleTabChange('catalog')}
          className={`px-6 py-3 font-medium transition-colors relative ${
            activeTab === 'catalog'
              ? 'text-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <div className="flex items-center space-x-2">
            <Package className="w-5 h-5" />
            <span>Katalog produktów</span>
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-[#1c1f33] text-[#e5e4e2]/60">
              {products.length}
            </span>
          </div>
          {activeTab === 'catalog' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
          )}
        </button>

        <button
          onClick={() => handleTabChange('templates')}
          className={`px-6 py-3 font-medium transition-colors relative ${
            activeTab === 'templates'
              ? 'text-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <div className="flex items-center space-x-2">
            <FileType className="w-5 h-5" />
            <span>Szablony</span>
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-[#1c1f33] text-[#e5e4e2]/60">
              {templates.length}
            </span>
          </div>
          {activeTab === 'templates' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
          )}
        </button>

        <button
          onClick={() => handleTabChange('brochure')}
          className={`px-6 py-3 font-medium transition-colors relative ${
            activeTab === 'brochure'
              ? 'text-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <div className="flex items-center space-x-2">
            <BookOpen className="w-5 h-5" />
            <span>Technika Estradowa</span>
          </div>
          {activeTab === 'brochure' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
          )}
        </button>
      </div>

      {/* Content */}
      {activeTab === 'offers' && (
        <OffersTab
          offers={filteredOffers}
          allOffers={offers}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          getClientName={getClientName}
          router={router}
          onRefresh={fetchOffers}
          viewMode={offersViewMode}
          setViewMode={setOffersViewMode}
          onDelete={handleDeleteOffer}
          onNewOffer={handleNewOffer}
        />
      )}

      {activeTab === 'catalog' && (
        <CatalogTab
          products={filteredProducts}
          categories={categories}
          productSearch={productSearch}
          setProductSearch={setProductSearch}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          viewMode={viewMode}
          setViewMode={setViewMode}
          router={router}
          onRefresh={fetchProducts}
        />
      )}

      {activeTab === 'templates' && (
        <TemplatesTab
          templates={templates}
          onRefresh={fetchTemplates}
          onNew={() => {
            setEditingTemplate(null);
            setShowTemplateModal(true);
          }}
          onEdit={(template) => {
            setEditingTemplate(template);
            setShowTemplateModal(true);
          }}
        />
      )}

      {activeTab === 'brochure' && (
        <div className="bg-[#1c1f33]/50 rounded-xl border border-[#d3bb73]/20">
          <div className="p-6">
            <TechnicalBrochureEditor employee={employee} />
          </div>
        </div>
      )}

      {/* Template Modal */}
      {showTemplateModal && (
        <TemplateEditorModal
          template={editingTemplate}
          onClose={() => {
            setShowTemplateModal(false);
            setEditingTemplate(null);
          }}
          onSuccess={() => {
            fetchTemplates();
            setShowTemplateModal(false);
            setEditingTemplate(null);
          }}
        />
      )}

      {/* Event Selector Modal */}
      {showEventSelector && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-3xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6 border-b border-[#d3bb73]/10 flex items-center justify-between sticky top-0 bg-[#1c1f33] z-10">
              <h3 className="text-xl font-light text-[#e5e4e2]">Wybierz event dla oferty</h3>
              <button
                onClick={() => setShowEventSelector(false)}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              {events.length === 0 ? (
                <div className="text-center py-12 text-[#e5e4e2]/60">
                  Brak dostępnych eventów. Utwórz event aby móc dodać ofertę.
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((event: any) => {
                    const clientName =
                      event.organization?.company_name ||
                      [event.organization?.first_name, event.organization?.last_name].filter(Boolean).join(' ') ||
                      [event.contact?.first_name, event.contact?.last_name].filter(Boolean).join(' ') ||
                      'Brak klienta';

                    return (
                      <button
                        key={event.id}
                        onClick={() => handleEventSelect(event.id)}
                        className="w-full text-left bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4 hover:border-[#d3bb73]/30 transition-all"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-medium text-[#e5e4e2] mb-1">{event.name}</h4>
                            <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                              <span className="flex items-center gap-1">
                                <Building2 className="w-4 h-4" />
                                {clientName}
                              </span>
                              {event.event_date && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-4 h-4" />
                                  {new Date(event.event_date).toLocaleDateString('pl-PL')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Offer Wizard */}
      {showOfferWizard && selectedEventId && (
        <OfferWizard
          isOpen={showOfferWizard}
          onClose={() => {
            setShowOfferWizard(false);
            setSelectedEventId(null);
          }}
          eventId={selectedEventId}
          clientId={null}
          onSuccess={() => {
            setShowOfferWizard(false);
            setSelectedEventId(null);
            fetchOffers();
            showSnackbar('Oferta została utworzona', 'success');
          }}
        />
      )}
    </div>
  );
}

// Offers Tab Component
function OffersTab({ offers, allOffers, searchQuery, setSearchQuery, statusFilter, setStatusFilter, getClientName, router, onRefresh, viewMode, setViewMode, onDelete, onNewOffer }: any) {
  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-5 h-5 text-[#d3bb73]" />
            <span className="text-2xl font-light text-[#e5e4e2]">{allOffers.length}</span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Wszystkie</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-5 h-5 text-gray-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {allOffers.filter((o: any) => o.status === 'draft').length}
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Szkice</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-5 h-5 text-blue-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {allOffers.filter((o: any) => o.status === 'sent').length}
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Wysłane</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-5 h-5 text-green-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {allOffers.filter((o: any) => o.status === 'accepted').length}
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Zaakceptowane</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <DollarSign className="w-5 h-5 text-yellow-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {allOffers
                .reduce((sum: number, o: any) => sum + (o.total_amount || 0), 0)
                .toLocaleString('pl-PL')}
              zł
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Łączna wartość</p>
        </div>
      </div>

      {/* Filters and List */}
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Szukaj oferty..."
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg pl-10 pr-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
          >
            <option value="all">Wszystkie statusy</option>
            <option value="draft">Szkice</option>
            <option value="sent">Wysłane</option>
            <option value="accepted">Zaakceptowane</option>
            <option value="rejected">Odrzucone</option>
          </select>

          <div className="flex items-center gap-2 bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded transition-colors ${
                viewMode === 'list'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok listy"
            >
              <List className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-2 rounded transition-colors ${
                viewMode === 'table'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok tabeli"
            >
              <Grid3x3 className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded transition-colors ${
                viewMode === 'grid'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok kafelków"
            >
              <Package className="w-5 h-5" />
            </button>
          </div>

          <button
            onClick={handleNewOffer}
            className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors flex items-center space-x-2 whitespace-nowrap"
          >
            <Plus className="w-5 h-5" />
            <span>Nowa oferta</span>
          </button>
        </div>

        {offers.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
            <p className="text-[#e5e4e2]/60">
              {searchQuery || statusFilter !== 'all'
                ? 'Brak ofert spełniających kryteria'
                : 'Brak ofert. Kliknij "Nowa oferta" aby rozpocząć.'}
            </p>
          </div>
        ) : (
          <>
            {viewMode === 'list' && (
              <OffersListView
                offers={offers}
                getClientName={getClientName}
                onView={(id) => router.push(`/crm/offers/${id}`)}
                onDelete={onDelete}
              />
            )}
            {viewMode === 'table' && (
              <OffersTableView
                offers={offers}
                getClientName={getClientName}
                onView={(id) => router.push(`/crm/offers/${id}`)}
                onDelete={onDelete}
              />
            )}
            {viewMode === 'grid' && (
              <OffersGridView
                offers={offers}
                getClientName={getClientName}
                onView={(id) => router.push(`/crm/offers/${id}`)}
                onDelete={onDelete}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

// Catalog Tab Component
function CatalogTab({ products, categories, productSearch, setProductSearch, categoryFilter, setCategoryFilter, viewMode, setViewMode, router, onRefresh }: any) {
  return (
    <>
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Szukaj produktu..."
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg pl-10 pr-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
          >
            <option value="all">Wszystkie kategorie</option>
            {categories.map((cat: any) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded transition-colors ${
                viewMode === 'grid' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <Grid3x3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded transition-colors ${
                viewMode === 'list' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => router.push('/crm/offers/categories')}
            className="px-4 py-2 bg-[#0a0d1a] text-[#e5e4e2] border border-[#d3bb73]/20 rounded-lg hover:bg-[#1c1f33] transition-colors flex items-center space-x-2 whitespace-nowrap"
            title="Zarządzaj kategoriami"
          >
            <Settings className="w-4 h-4" />
            <span>Kategorie</span>
          </button>

          <button
            onClick={onRefresh}
            className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors flex items-center space-x-2 whitespace-nowrap"
          >
            <Plus className="w-5 h-5" />
            <span>Nowy produkt</span>
          </button>
        </div>

        {products.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
            <p className="text-[#e5e4e2]/60">Brak produktów w katalogu</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((product: any) => (
              <div
                key={product.id}
                onClick={() => router.push(`/crm/offers/products/${product.id}`)}
                className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-5 hover:border-[#d3bb73]/30 transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-[#e5e4e2] mb-1">{product.name}</h3>
                    <p className="text-xs text-[#d3bb73]">{product.category?.name}</p>
                  </div>
                  {!product.is_active && (
                    <span className="px-2 py-1 text-xs bg-gray-500/20 text-gray-400 rounded">
                      Nieaktywny
                    </span>
                  )}
                </div>

                {product.description && (
                  <p className="text-sm text-[#e5e4e2]/60 mb-4 line-clamp-2">
                    {product.description}
                  </p>
                )}

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#e5e4e2]/60">Cena:</span>
                    <span className="text-[#d3bb73] font-medium">
                      {product.base_price.toLocaleString('pl-PL')} zł/{product.unit}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#e5e4e2]/60">Koszt:</span>
                    <span className="text-[#e5e4e2]/80">
                      {product.cost_price.toLocaleString('pl-PL')} zł
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#e5e4e2]/60">Marża:</span>
                    <span className="text-green-400 font-medium">
                      {((product.base_price - product.cost_price) / product.base_price * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                {product.tags && product.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-4">
                    {product.tags.slice(0, 3).map((tag: string, idx: number) => (
                      <span key={idx} className="text-xs px-2 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {products.map((product: any) => (
              <div
                key={product.id}
                onClick={() => router.push(`/crm/offers/products/${product.id}`)}
                className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4 hover:border-[#d3bb73]/30 transition-all cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-10 h-10 bg-[#d3bb73]/20 rounded-lg flex items-center justify-center">
                      <Package className="w-5 h-5 text-[#d3bb73]" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-medium text-[#e5e4e2]">{product.name}</h3>
                        {!product.is_active && (
                          <span className="px-2 py-0.5 text-xs bg-gray-500/20 text-gray-400 rounded">
                            Nieaktywny
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                        <span className="text-[#d3bb73]">{product.category?.name}</span>
                        {product.description && (
                          <span className="line-clamp-1">{product.description}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-right">
                      <div className="text-xs text-[#e5e4e2]/60 mb-1">Cena</div>
                      <div className="text-[#d3bb73] font-medium">
                        {product.base_price.toLocaleString('pl-PL')} zł
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-[#e5e4e2]/60 mb-1">Koszt</div>
                      <div className="text-[#e5e4e2]/80">
                        {product.cost_price.toLocaleString('pl-PL')} zł
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-[#e5e4e2]/60 mb-1">Marża</div>
                      <div className="text-green-400 font-medium">
                        {((product.base_price - product.cost_price) / product.base_price * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// Templates Tab Component
function TemplatesTab({ templates, onRefresh, onNew, onEdit }: any) {
  return (
    <>
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-medium text-[#e5e4e2]">Szablony ofert PDF</h2>
          <button
            onClick={onNew}
            className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors flex items-center space-x-2"
          >
            <Plus className="w-5 h-5" />
            <span>Nowy szablon</span>
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="text-center py-12">
            <FileType className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
            <p className="text-[#e5e4e2]/60">Brak szablonów ofert</p>
          </div>
        ) : (
          <div className="space-y-4">
            {templates.map((template: any) => (
              <div
                key={template.id}
                className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-5 hover:border-[#d3bb73]/30 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-[#e5e4e2]">{template.name}</h3>
                      {template.is_default && (
                        <span className="px-2 py-1 text-xs bg-[#d3bb73]/20 text-[#d3bb73] rounded">
                          Domyślny
                        </span>
                      )}
                      {!template.is_active && (
                        <span className="px-2 py-1 text-xs bg-gray-500/20 text-gray-400 rounded">
                          Nieaktywny
                        </span>
                      )}
                    </div>
                    {template.description && (
                      <p className="text-sm text-[#e5e4e2]/60">{template.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onEdit(template)}
                      className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors"
                    >
                      <Edit className="w-4 h-4 text-[#e5e4e2]/60" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}


function TemplateEditorModal({ template, onClose, onSuccess }: { template: Template | null; onClose: () => void; onSuccess: () => void }) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [formData, setFormData] = useState({
    name: template?.name || "",
    description: template?.description || "",
    logo_url: "",
    show_logo: template ? (template as any).show_logo ?? true : true,
    show_company_details: template ? (template as any).show_company_details ?? true : true,
    show_client_details: template ? (template as any).show_client_details ?? true : true,
    show_terms: template ? (template as any).show_terms ?? true : true,
    show_payment_info: template ? (template as any).show_payment_info ?? true : true,
    terms_text: (template as any)?.terms_text || "",
    payment_info_text: (template as any)?.payment_info_text || "",
    footer_text: (template as any)?.footer_text || "",
    is_default: template?.is_default || false,
    is_active: template?.is_active ?? true,
  });

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `offer-logos/${fileName}`;
      const { error: uploadError } = await supabase.storage.from("site-images").upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("site-images").getPublicUrl(filePath);
      setFormData(prev => ({ ...prev, logo_url: publicUrl }));
      showSnackbar("Logo przesłane", "success");
    } catch (error) {
      showSnackbar("Błąd przesyłania logo", "error");
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.name) { showSnackbar("Podaj nazwę szablonu", "error"); return; }
    setLoading(true);
    try {
      if (template) {
        const { error } = await supabase.from("offer_templates").update(formData).eq("id", template.id);
        if (error) throw error;
        showSnackbar("Szablon zaktualizowany", "success");
      } else {
        const { error } = await supabase.from("offer_templates").insert(formData);
        if (error) throw error;
        showSnackbar("Szablon utworzony", "success");
      }
      onSuccess();
    } catch (error) {
      showSnackbar("Błąd zapisu szablonu", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-[#d3bb73]/10 flex items-center justify-between sticky top-0 bg-[#1c1f33] z-10">
          <h3 className="text-xl font-light text-[#e5e4e2]">{template ? "Edytuj szablon" : "Nowy szablon"}</h3>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-6">
          <div>
            <h4 className="text-sm font-medium text-[#e5e4e2] mb-4">Podstawowe informacje</h4>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa szablonu *</label>
                <input type="text" value={formData.name} onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))} className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]" />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
                <textarea value={formData.description} onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))} rows={2} className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]" />
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-medium text-[#e5e4e2] mb-4">Logo firmy</h4>
            <div className="space-y-4">
              <label className="flex items-center gap-2 px-4 py-2 bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg cursor-pointer hover:bg-[#0a0d1a]/70 transition-colors w-fit">
                <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" disabled={uploadingLogo} />
                <Upload className="w-5 h-5 text-[#d3bb73]" />
                <span className="text-[#e5e4e2]">{uploadingLogo ? "Przesyłanie..." : "Prześlij logo"}</span>
              </label>
              {formData.logo_url && <img src={formData.logo_url} alt="Logo" className="w-32 h-32 object-contain" />}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-medium text-[#e5e4e2] mb-4">Widoczne elementy</h4>
            <div className="space-y-2">
              {[{ key: "show_logo", label: "Pokaż logo" }, { key: "show_company_details", label: "Pokaż dane firmy" }, { key: "show_client_details", label: "Pokaż dane klienta" }, { key: "show_terms", label: "Pokaż warunki oferty" }, { key: "show_payment_info", label: "Pokaż informacje o płatności" }].map((item) => (
                <label key={item.key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formData[item.key as keyof typeof formData] as boolean} onChange={(e) => setFormData(prev => ({ ...prev, [item.key]: e.target.checked }))} className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]" />
                  <span className="text-sm text-[#e5e4e2]">{item.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Warunki oferty</label>
              <textarea value={formData.terms_text} onChange={(e) => setFormData(prev => ({ ...prev, terms_text: e.target.value }))} rows={4} placeholder="WARUNKI OFERTY..." className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] font-mono text-sm" />
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Informacje o płatności</label>
              <textarea value={formData.payment_info_text} onChange={(e) => setFormData(prev => ({ ...prev, payment_info_text: e.target.value }))} rows={4} placeholder="DANE DO PRZELEWU..." className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] font-mono text-sm" />
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Stopka</label>
              <textarea value={formData.footer_text} onChange={(e) => setFormData(prev => ({ ...prev, footer_text: e.target.value }))} rows={2} placeholder="Dziękujemy za zainteresowanie..." className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={formData.is_default} onChange={(e) => setFormData(prev => ({ ...prev, is_default: e.target.checked }))} className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]" />
              <span className="text-sm text-[#e5e4e2]">Szablon domyślny</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))} className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]" />
              <span className="text-sm text-[#e5e4e2]">Aktywny</span>
            </label>
          </div>
        </div>
        <div className="p-6 border-t border-[#d3bb73]/10 flex gap-3 justify-end sticky bottom-0 bg-[#1c1f33]">
          <button onClick={onClose} className="px-6 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20">Anuluj</button>
          <button onClick={handleSubmit} disabled={loading} className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 disabled:opacity-50">{loading ? "Zapisuję..." : "Zapisz"}</button>
        </div>
      </div>
    </div>
  );
}
