'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Plus,
  FileText,
  Search,
  DollarSign,
  Calendar,
  Building2,
  User,
  Package,
  FileType,
  CreditCard as Edit,
  Trash2,
  Eye,
  Grid3x3,
  List,
  Settings,
  X,
  Upload,
} from 'lucide-react';
import Image from 'next/image';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { OffersListView, OffersTableView, OffersGridView } from './OffersViews';
import OfferWizard from '@/app/(crm)/crm/offers/[id]/components/OfferWizzard/OfferWizard';
import OfferPageTemplatesEditor from '@/components/crm/OfferPageTemplatesEditor';
import { CatalogTab } from '@/components/crm/offers/products/CatalogTab';

type Tab = 'offers' | 'catalog' | 'templates';
type TemplatesSubTab = 'offer-templates' | 'page-templates';

interface Offer {
  client: any;
  id: string;
  offer_number: string;
  event_id: string;
  organization_id: string;
  total_amount: number;
  valid_until: string;
  status: string;
  created_at: string;
  created_by?: string;
  organization?: {
    name?: string;
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

export function OfferPage({
  offers,
  categories,
  products,
  templates,
}: {
  offers: Offer[];
  categories: ProductCategory[];
  products: Product[];
  templates: Template[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { employee, isAdmin } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();

  const [activeTab, setActiveTab] = useState<Tab>((searchParams.get('tab') as Tab) || 'offers');
  const [templatesSubTab, setTemplatesSubTab] = useState<TemplatesSubTab>('offer-templates');
  const [loading, setLoading] = useState(false);

  const [filteredOffers, setFilteredOffers] = useState<Offer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [offersViewMode, setOffersViewMode] = useState<'list' | 'table' | 'grid'>('list');

  // Katalog produktów
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Szablony
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);

  // Liczniki
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
    filterOffers();
  }, [searchQuery, statusFilter, offers]);

  useEffect(() => {
    filterProducts();
  }, [productSearch, categoryFilter, products]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    router.push(`/crm/offers?tab=${tab}`);
  };

  // Filter functions
  const filterOffers = () => {
    let filtered = [...offers];

    if (searchQuery) {
      filtered = filtered.filter(
        (offer) =>
          offer.offer_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          offer.client?.company_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          offer.event?.name?.toLowerCase().includes(searchQuery.toLowerCase()),
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
          product.tags?.some((tag) => tag.toLowerCase().includes(productSearch.toLowerCase())),
      );
    }

    if (categoryFilter !== 'all') {
      filtered = filtered.filter((product) => product.category_id === categoryFilter);
    }

    setFilteredProducts(filtered);
  };

  const getClientName = (offer: Offer) => {
    const event = (offer as any).event;
    if (event?.organization?.name) {
      return event.organization.name;
    }
    if (event?.contact?.first_name || event?.contact?.last_name) {
      return `${event.contact.first_name || ''} ${event.contact.last_name || ''}`.trim();
    }

    if (offer.client?.company_name) return offer.client.company_name;
    if (offer.client?.first_name || offer.client?.last_name) {
      return `${offer.client.first_name || ''} ${offer.client.last_name || ''}`.trim();
    }

    return 'Brak klienta';
  };

  const handleDeleteOffer = async (offerId: string) => {
    const offer = offers.find((o) => o.id === offerId);
    const confirmMessage = offer?.event_id
      ? 'Czy na pewno chcesz usunąć tę ofertę?\n\nSprzęt automatycznie dodany z tej oferty zostanie usunięty z eventu.\n\nTej operacji nie można cofnąć.'
      : 'Czy na pewno chcesz usunąć tę ofertę? Tej operacji nie można cofnąć.';

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      const { error } = await supabase.from('offers').delete().eq('id', offerId);

      if (error) throw error;

      showSnackbar('Oferta została usunięta pomyślnie', 'success');
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd podczas usuwania oferty', 'error');
    }
  };

  const handleNewOffer = async () => {
    try {
      // Pobierz eventy z ID-kami relacji
      const { data: eventsData, error } = await supabase
        .from('events')
        .select(
          `
          id,
          name,
          event_date,
          organization_id,
          contact_person_id
        `,
        )
        .order('event_date', { ascending: false });

      if (error) throw error;

      // Pobierz organizacje i kontakty osobno
      if (eventsData && eventsData.length > 0) {
        const orgIds = eventsData.map((e) => e.organization_id).filter(Boolean);
        const contactIds = eventsData.map((e) => e.contact_person_id).filter(Boolean);

        let orgsMap: Record<string, any> = {};
        let contactsMap: Record<string, any> = {};

        if (orgIds.length > 0) {
          const { data: orgs } = await supabase
            .from('organizations')
            .select('id, name')
            .in('id', orgIds);
          orgsMap = Object.fromEntries((orgs || []).map((o) => [o.id, o]));
        }

        if (contactIds.length > 0) {
          const { data: contacts } = await supabase
            .from('contacts')
            .select('id, first_name, last_name, company_name')
            .in('id', contactIds);
          contactsMap = Object.fromEntries((contacts || []).map((c) => [c.id, c]));
        }

        // Dodaj dane do eventów
        const enrichedEvents = eventsData.map((event) => ({
          ...event,
          organization: event.organization_id ? orgsMap[event.organization_id] : null,
          contact: event.contact_person_id ? contactsMap[event.contact_person_id] : null,
        }));

        setEvents(enrichedEvents);
      } else {
        setEvents(eventsData || []);
      }

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
      <div className="flex h-64 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-light text-[#e5e4e2]">Oferty i Katalog</h1>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Zarządzaj ofertami, katalogiem produktów i szablonami
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 border-b border-[#d3bb73]/10">
        <button
          onClick={() => handleTabChange('offers')}
          className={`relative px-6 py-3 font-medium transition-colors ${
            activeTab === 'offers' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <div className="flex items-center space-x-2">
            <FileText className="h-5 w-5" />
            <span>Oferty</span>
            <span className="ml-2 rounded-full bg-[#1c1f33] px-2 py-0.5 text-xs text-[#e5e4e2]/60">
              {offers.length}
            </span>
          </div>
          {activeTab === 'offers' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
          )}
        </button>

        <button
          onClick={() => handleTabChange('catalog')}
          className={`relative px-6 py-3 font-medium transition-colors ${
            activeTab === 'catalog' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <div className="flex items-center space-x-2">
            <Package className="h-5 w-5" />
            <span>Produkty</span>
            <span className="ml-2 rounded-full bg-[#1c1f33] px-2 py-0.5 text-xs text-[#e5e4e2]/60">
              {products.length}
            </span>
          </div>
          {activeTab === 'catalog' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
          )}
        </button>

        <button
          onClick={() => handleTabChange('templates')}
          className={`relative px-6 py-3 font-medium transition-colors ${
            activeTab === 'templates' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <div className="flex items-center space-x-2">
            <FileType className="h-5 w-5" />
            <span>Szablony</span>
            <span className="ml-2 rounded-full bg-[#1c1f33] px-2 py-0.5 text-xs text-[#e5e4e2]/60">
              {templates.length}
            </span>
          </div>
          {activeTab === 'templates' && (
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
        />
      )}

      {activeTab === 'templates' && (
        <div className="space-y-6">
          {/* Sub-tabs dla Szablonów */}
          <div className="flex space-x-1 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-1">
            <button
              onClick={() => setTemplatesSubTab('offer-templates')}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                templatesSubTab === 'offer-templates'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              Szablony ofert
            </button>
            <button
              onClick={() => setTemplatesSubTab('page-templates')}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                templatesSubTab === 'page-templates'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              Szablony stron
            </button>
          </div>

          {/* Treść sub-tabów */}
          {templatesSubTab === 'offer-templates' && (
            <TemplatesTab
              templates={templates}
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

          {templatesSubTab === 'page-templates' && (
            <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]/50">
              <div className="p-6">
                <OfferPageTemplatesEditor />
              </div>
            </div>
          )}
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
            setShowTemplateModal(false);
            setEditingTemplate(null);
          }}
        />
      )}

      {/* Event Selector Modal */}
      {showEventSelector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h3 className="text-xl font-light text-[#e5e4e2]">Wybierz event dla oferty</h3>
              <button
                onClick={() => setShowEventSelector(false)}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              {events.length === 0 ? (
                <div className="py-12 text-center text-[#e5e4e2]/60">
                  Brak dostępnych eventów. Utwórz event aby móc dodać ofertę.
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((event: any) => {
                    const clientName =
                      event.organization?.name ||
                      [event.contact?.first_name, event.contact?.last_name]
                        .filter(Boolean)
                        .join(' ') ||
                      'Brak klienta';

                    return (
                      <button
                        key={event.id}
                        onClick={() => handleEventSelect(event.id)}
                        className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 text-left transition-all hover:border-[#d3bb73]/30"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="mb-1 font-medium text-[#e5e4e2]">{event.name}</h4>
                            <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                              <span className="flex items-center gap-1">
                                <Building2 className="h-4 w-4" />
                                {clientName}
                              </span>
                              {event.event_date && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-4 w-4" />
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
          onSuccess={() => {
            setShowOfferWizard(false);
            setSelectedEventId(null);
            showSnackbar('Oferta została utworzona', 'success');
          }}
        />
      )}
    </div>
  );
}

// Offers Tab Component
function OffersTab({
  offers,
  allOffers,
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  getClientName,
  router,
  viewMode,
  setViewMode,
  onDelete,
  onNewOffer,
}: any) {
  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-2 flex items-center gap-3">
            <FileText className="h-5 w-5 text-[#d3bb73]" />
            <span className="text-2xl font-light text-[#e5e4e2]">{allOffers.length}</span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Wszystkie</p>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-2 flex items-center gap-3">
            <FileText className="h-5 w-5 text-gray-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {allOffers.filter((o: any) => o.status === 'draft').length}
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Szkice</p>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-2 flex items-center gap-3">
            <FileText className="h-5 w-5 text-blue-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {allOffers.filter((o: any) => o.status === 'sent').length}
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Wysłane</p>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-2 flex items-center gap-3">
            <FileText className="h-5 w-5 text-green-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {allOffers.filter((o: any) => o.status === 'accepted').length}
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Zaakceptowane</p>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-2 flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-yellow-400" />
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
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Szukaj oferty..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] py-2 pl-10 pr-4 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          >
            <option value="all">Wszystkie statusy</option>
            <option value="draft">Szkice</option>
            <option value="sent">Wysłane</option>
            <option value="accepted">Zaakceptowane</option>
            <option value="rejected">Odrzucone</option>
          </select>

          <div className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`rounded p-2 transition-colors ${
                viewMode === 'list'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok listy"
            >
              <List className="h-5 w-5" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`rounded p-2 transition-colors ${
                viewMode === 'table'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok tabeli"
            >
              <Grid3x3 className="h-5 w-5" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`rounded p-2 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok kafelków"
            >
              <Package className="h-5 w-5" />
            </button>
          </div>

          <button
            onClick={onNewOffer}
            className="flex items-center space-x-2 whitespace-nowrap rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-5 w-5" />
            <span>Nowa oferta</span>
          </button>
        </div>

        {offers.length === 0 ? (
          <div className="py-12 text-center">
            <FileText className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
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

// Templates Tab Component
function TemplatesTab({ templates, onNew, onEdit }: any) {
  return (
    <>
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-medium text-[#e5e4e2]">Szablony ofert PDF</h2>
          <button
            onClick={onNew}
            className="flex items-center space-x-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-5 w-5" />
            <span>Nowy szablon</span>
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="py-12 text-center">
            <FileType className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
            <p className="text-[#e5e4e2]/60">Brak szablonów ofert</p>
          </div>
        ) : (
          <div className="space-y-4">
            {templates.map((template: any) => (
              <div
                key={template.id}
                className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-5 transition-all hover:border-[#d3bb73]/30"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-3">
                      <h3 className="font-semibold text-[#e5e4e2]">{template.name}</h3>
                      {template.is_default && (
                        <span className="rounded bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73]">
                          Domyślny
                        </span>
                      )}
                      {!template.is_active && (
                        <span className="rounded bg-gray-500/20 px-2 py-1 text-xs text-gray-400">
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
                      className="rounded-lg p-2 transition-colors hover:bg-[#1c1f33]"
                    >
                      <Edit className="h-4 w-4 text-[#e5e4e2]/60" />
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

function TemplateEditorModal({
  template,
  onClose,
  onSuccess,
}: {
  template: Template | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [formData, setFormData] = useState({
    name: template?.name || '',
    description: template?.description || '',
    logo_url: '',
    show_logo: template ? ((template as any).show_logo ?? true) : true,
    show_company_details: template ? ((template as any).show_company_details ?? true) : true,
    show_client_details: template ? ((template as any).show_client_details ?? true) : true,
    show_terms: template ? ((template as any).show_terms ?? true) : true,
    show_payment_info: template ? ((template as any).show_payment_info ?? true) : true,
    terms_text: (template as any)?.terms_text || '',
    payment_info_text: (template as any)?.payment_info_text || '',
    footer_text: (template as any)?.footer_text || '',
    is_default: template?.is_default || false,
    is_active: template?.is_active ?? true,
  });

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `offer-logos/${fileName}`;
      const { error: uploadError } = await supabase.storage
        .from('site-images')
        .upload(filePath, file);
      if (uploadError) throw uploadError;
      const {
        data: { publicUrl },
      } = supabase.storage.from('site-images').getPublicUrl(filePath);
      setFormData((prev) => ({ ...prev, logo_url: publicUrl }));
      showSnackbar('Logo przesłane', 'success');
    } catch (error) {
      showSnackbar('Błąd przesyłania logo', 'error');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.name) {
      showSnackbar('Podaj nazwę szablonu', 'error');
      return;
    }
    setLoading(true);
    try {
      if (template) {
        const { error } = await supabase
          .from('offer_templates')
          .update(formData)
          .eq('id', template.id);
        if (error) throw error;
        showSnackbar('Szablon zaktualizowany', 'success');
      } else {
        const { error } = await supabase.from('offer_templates').insert(formData);
        if (error) throw error;
        showSnackbar('Szablon utworzony', 'success');
      }
      onSuccess();
    } catch (error) {
      showSnackbar('Błąd zapisu szablonu', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">
            {template ? 'Edytuj szablon' : 'Nowy szablon'}
          </h3>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-6 p-6">
          <div>
            <h4 className="mb-4 text-sm font-medium text-[#e5e4e2]">Podstawowe informacje</h4>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa szablonu *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, description: e.target.value }))
                  }
                  rows={2}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-medium text-[#e5e4e2]">Logo firmy</h4>
            <div className="space-y-4">
              <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 transition-colors hover:bg-[#0a0d1a]/70">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                  disabled={uploadingLogo}
                />
                <Upload className="h-5 w-5 text-[#d3bb73]" />
                <span className="text-[#e5e4e2]">
                  {uploadingLogo ? 'Przesyłanie...' : 'Prześlij logo'}
                </span>
              </label>
              {formData.logo_url && (
                <Image
                  width={128}
                  height={128}
                  src={formData.logo_url}
                  alt="Logo"
                  className="h-32 w-32 object-contain"
                />
              )}
            </div>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-medium text-[#e5e4e2]">Widoczne elementy</h4>
            <div className="space-y-2">
              {[
                { key: 'show_logo', label: 'Pokaż logo' },
                { key: 'show_company_details', label: 'Pokaż dane firmy' },
                { key: 'show_client_details', label: 'Pokaż dane klienta' },
                { key: 'show_terms', label: 'Pokaż warunki oferty' },
                { key: 'show_payment_info', label: 'Pokaż informacje o płatności' },
              ].map((item) => (
                <label key={item.key} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData[item.key as keyof typeof formData] as boolean}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, [item.key]: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
                  />
                  <span className="text-sm text-[#e5e4e2]">{item.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Warunki oferty</label>
              <textarea
                value={formData.terms_text}
                onChange={(e) => setFormData((prev) => ({ ...prev, terms_text: e.target.value }))}
                rows={4}
                placeholder="WARUNKI OFERTY..."
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 font-mono text-sm text-[#e5e4e2]"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Informacje o płatności</label>
              <textarea
                value={formData.payment_info_text}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, payment_info_text: e.target.value }))
                }
                rows={4}
                placeholder="DANE DO PRZELEWU..."
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 font-mono text-sm text-[#e5e4e2]"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Stopka</label>
              <textarea
                value={formData.footer_text}
                onChange={(e) => setFormData((prev) => ({ ...prev, footer_text: e.target.value }))}
                rows={2}
                placeholder="Dziękujemy za zainteresowanie..."
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData((prev) => ({ ...prev, is_default: e.target.checked }))}
                className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
              />
              <span className="text-sm text-[#e5e4e2]">Szablon domyślny</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
                className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
              />
              <span className="text-sm text-[#e5e4e2]">Aktywny</span>
            </label>
          </div>
        </div>
        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <button
            onClick={onClose}
            className="rounded-lg bg-[#e5e4e2]/10 px-6 py-2 text-[#e5e4e2] hover:bg-[#e5e4e2]/20"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Zapisuję...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
