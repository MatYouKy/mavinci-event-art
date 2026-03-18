'use client';

import { useState, useEffect } from 'react';
import { Plus, CreditCard as Edit, Trash2, Package, Truck, Wrench, Save, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useRouter } from 'next/navigation';

interface SubcontractorServicesPanelProps {
  subcontractorId: string;
  organizationId?: string;
}

type ServiceType = 'transport' | 'services' | 'rental';

interface SubcontractorService {
  id: string;
  service_type: ServiceType;
  is_active: boolean;
  notes: string | null;
}

interface ServiceCatalogItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  unit_price?: number;
  daily_rental_price?: number;
  unit?: string;
  quantity_available?: number;
  thumbnail_url: string | null;
  is_active: boolean;
  vat_rate?: number;
  price_net?: number;
  price_gross?: number;
  daily_price_net?: number;
  daily_price_gross?: number;
  weekly_price_net?: number;
  weekly_price_gross?: number;
  monthly_price_net?: number;
  monthly_price_gross?: number;
}

const serviceTypeConfig = {
  transport: {
    label: 'Transport',
    icon: Truck,
    color: 'blue',
    catalogRoute: '/crm/contacts',
  },
  services: {
    label: 'Usługi',
    icon: Wrench,
    color: 'green',
    catalogRoute: '/crm/offers/products',
  },
  rental: {
    label: 'Wynajem sprzętu',
    icon: Package,
    color: 'purple',
    catalogRoute: '/crm/equipment',
  },
};

export default function SubcontractorServicesPanel({ subcontractorId, organizationId }: SubcontractorServicesPanelProps) {
  const { showSnackbar } = useSnackbar();
  const router = useRouter();

  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemDescription, setNewItemDescription] = useState('');
  const [newItemPrice, setNewItemPrice] = useState<number>(0);
  const [newItemUnit, setNewItemUnit] = useState('szt');
  const [newItemCategory, setNewItemCategory] = useState('');
  const [newItemQuantity, setNewItemQuantity] = useState<number>(1);
  const [newItemWeeklyPrice, setNewItemWeeklyPrice] = useState<number>(0);
  const [newItemMonthlyPrice, setNewItemMonthlyPrice] = useState<number>(0);
  const [newItemRequiredSkills, setNewItemRequiredSkills] = useState<string>('');
  const [newItemVatRate, setNewItemVatRate] = useState<number>(23);
  const [newItemPriceNet, setNewItemPriceNet] = useState<number>(0);
  const [newItemPriceGross, setNewItemPriceGross] = useState<number>(0);

  const [services, setServices] = useState<SubcontractorService[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddService, setShowAddService] = useState(false);
  const [selectedServiceType, setSelectedServiceType] = useState<ServiceType | null>(null);
  const [serviceNotes, setServiceNotes] = useState('');

  // Katalogi dla każdego typu
  const [serviceCatalog, setServiceCatalog] = useState<ServiceCatalogItem[]>([]);
  const [equipmentCatalog, setEquipmentCatalog] = useState<ServiceCatalogItem[]>([]);
  const [transportCatalog, setTransportCatalog] = useState<ServiceCatalogItem[]>([]);

  const [activeTab, setActiveTab] = useState<ServiceType | null>(null);

  useEffect(() => {
    fetchServices();
  }, [subcontractorId]);

  useEffect(() => {
    if (activeTab) {
      fetchCatalog(activeTab);
    }
  }, [activeTab]);

  const fetchServices = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('subcontractor_services')
        .select('*')
        .eq('subcontractor_id', subcontractorId)
        .order('service_type');

      if (error) throw error;

      setServices(data || []);

      // Auto-select pierwszy aktywny serwis
      if (data && data.length > 0) {
        setActiveTab(data[0].service_type as ServiceType);
      }
    } catch (error: any) {
      console.error('Error fetching services:', error);
      showSnackbar('Błąd podczas ładowania usług', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchCatalog = async (serviceType: ServiceType) => {
    try {
      let tableName = '';
      let setter: (items: ServiceCatalogItem[]) => void = () => {};

      switch (serviceType) {
        case 'services':
          tableName = 'subcontractor_service_catalog';
          setter = setServiceCatalog;
          break;
        case 'rental':
          tableName = 'subcontractor_rental_equipment';
          setter = setEquipmentCatalog;
          break;
        case 'transport':
          tableName = 'subcontractor_transport_catalog';
          setter = setTransportCatalog;
          break;
      }

      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('subcontractor_id', subcontractorId)
        .order('name');

      if (error) throw error;

      setter(data || []);
    } catch (error: any) {
      console.error(`Error fetching ${serviceType} catalog:`, error);
      showSnackbar(`Błąd podczas ładowania katalogu ${serviceTypeConfig[serviceType].label}`, 'error');
    }
  };

  const handleAddService = async () => {
    if (!selectedServiceType) return;

    try {
      const { error } = await supabase.from('subcontractor_services').insert({
        subcontractor_id: subcontractorId,
        service_type: selectedServiceType,
        is_active: true,
        notes: serviceNotes || null,
      });

      if (error) throw error;

      showSnackbar('Dodano typ usługi', 'success');
      fetchServices();
      setShowAddService(false);
      setSelectedServiceType(null);
      setServiceNotes('');
      setActiveTab(selectedServiceType);
    } catch (error: any) {
      console.error('Error adding service:', error);
      showSnackbar('Błąd podczas dodawania usługi', 'error');
    }
  };

  const handleRemoveService = async (serviceId: string, serviceType: ServiceType) => {
    if (!confirm(`Czy na pewno chcesz usunąć typ usługi "${serviceTypeConfig[serviceType].label}"?`)) {
      return;
    }

    try {
      const { error } = await supabase.from('subcontractor_services').delete().eq('id', serviceId);

      if (error) throw error;

      showSnackbar('Usunięto typ usługi', 'success');
      fetchServices();

      if (activeTab === serviceType) {
        setActiveTab(null);
      }
    } catch (error: any) {
      console.error('Error removing service:', error);
      showSnackbar('Błąd podczas usuwania usługi', 'error');
    }
  };

  const handleToggleActive = async (serviceId: string, currentActive: boolean) => {
    try {
      const { error } = await supabase
        .from('subcontractor_services')
        .update({ is_active: !currentActive })
        .eq('id', serviceId);

      if (error) throw error;

      showSnackbar(currentActive ? 'Dezaktywowano usługę' : 'Aktywowano usługę', 'success');
      fetchServices();
    } catch (error: any) {
      console.error('Error toggling service:', error);
      showSnackbar('Błąd podczas zmiany statusu usługi', 'error');
    }
  };

  const getCatalogItems = () => {
    switch (activeTab) {
      case 'services':
        return serviceCatalog;
      case 'rental':
        return equipmentCatalog;
      case 'transport':
        return transportCatalog;
      default:
        return [];
    }
  };

  const handleViewInCatalog = (item: ServiceCatalogItem) => {
    if (activeTab === 'services') {
      router.push(`/crm/offers/products/${item.id}`);
    } else if (activeTab === 'rental') {
      router.push(`/crm/subcontractors/rental/${item.id}`);
    }
  };

  const handleAddNewItem = async () => {
    if (!activeTab || !newItemName.trim()) return;

    try {
      let tableName = '';
      let insertData: any = {
        subcontractor_id: subcontractorId,
        name: newItemName,
        description: newItemDescription || null,
        is_active: true,
      };

      switch (activeTab) {
        case 'services':
          tableName = 'subcontractor_service_catalog';
          insertData.unit_price = newItemPrice;
          insertData.unit = newItemUnit;
          insertData.category = newItemCategory || null;
          insertData.vat_rate = newItemVatRate;
          insertData.price_net = newItemPriceNet;
          insertData.price_gross = newItemPriceGross;
          break;
        case 'rental':
          tableName = 'subcontractor_rental_equipment';
          insertData.daily_rental_price = newItemPrice;
          insertData.weekly_rental_price = newItemWeeklyPrice || null;
          insertData.monthly_rental_price = newItemMonthlyPrice || null;
          insertData.quantity_available = newItemQuantity;
          insertData.category = newItemCategory || null;
          insertData.vat_rate = newItemVatRate;
          insertData.daily_price_net = newItemPriceNet;
          insertData.daily_price_gross = newItemPriceGross;
          insertData.required_skills = newItemRequiredSkills
            ? newItemRequiredSkills.split(',').map(s => s.trim()).filter(Boolean)
            : [];
          break;
        case 'transport':
          tableName = 'subcontractor_transport_catalog';
          break;
      }

      const { data, error } = await supabase
        .from(tableName)
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      showSnackbar('Dodano pozycję do katalogu', 'success');
      setShowAddItemModal(false);
      setNewItemName('');
      setNewItemDescription('');
      setNewItemPrice(0);
      setNewItemUnit('szt');
      setNewItemCategory('');
      setNewItemQuantity(1);
      setNewItemWeeklyPrice(0);
      setNewItemMonthlyPrice(0);
      setNewItemRequiredSkills('');
      setNewItemVatRate(23);
      setNewItemPriceNet(0);
      setNewItemPriceGross(0);

      // Odśwież katalog
      fetchCatalog(activeTab);
    } catch (error: any) {
      console.error('Error adding catalog item:', error);
      showSnackbar(error.message || 'Błąd podczas dodawania pozycji', 'error');
    }
  };

  const handleDeleteCatalogItem = async (itemId: string, itemName: string) => {
    if (!activeTab) return;

    if (!confirm(`Czy na pewno chcesz usunąć "${itemName}"? Ta operacja jest nieodwracalna.`)) {
      return;
    }

    try {
      let tableName = '';
      switch (activeTab) {
        case 'services':
          tableName = 'subcontractor_service_catalog';
          break;
        case 'rental':
          tableName = 'subcontractor_rental_equipment';
          break;
        case 'transport':
          tableName = 'subcontractor_transport_catalog';
          break;
      }

      const { error } = await supabase.from(tableName).delete().eq('id', itemId);

      if (error) throw error;

      showSnackbar('Usunięto pozycję z katalogu', 'success');
      fetchCatalog(activeTab);
    } catch (error: any) {
      console.error('Error deleting catalog item:', error);
      showSnackbar(error.message || 'Błąd podczas usuwania pozycji', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header z przyciskiem dodawania */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Świadczone usługi</h2>
          <p className="text-sm text-gray-400">Typy usług oferowanych przez podwykonawcę</p>
        </div>
        <button
          onClick={() => setShowAddService(true)}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] hover:bg-[#c4a859]"
        >
          <Plus className="h-4 w-4" />
          Dodaj typ usługi
        </button>
      </div>

      {/* Modal dodawania usługi */}
      {showAddService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-[#1a1d2e] p-6">
            <h3 className="mb-4 text-lg font-semibold text-white">Dodaj typ usługi</h3>

            <div className="mb-4 space-y-3">
              {(Object.keys(serviceTypeConfig) as ServiceType[])
                .filter((type) => !services.find((s) => s.service_type === type))
                .map((type) => {
                  const config = serviceTypeConfig[type];
                  const Icon = config.icon;

                  return (
                    <button
                      key={type}
                      onClick={() => setSelectedServiceType(type)}
                      className={`flex w-full items-center gap-3 rounded-lg border-2 p-4 transition-all ${
                        selectedServiceType === type
                          ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                          : 'border-gray-700 bg-[#252837] hover:border-gray-600'
                      }`}
                    >
                      <Icon className={`h-6 w-6 text-${config.color}-400`} />
                      <span className="font-medium text-white">{config.label}</span>
                    </button>
                  );
                })}
            </div>

            {selectedServiceType && (
              <div className="mb-4">
                <label className="mb-2 block text-sm text-gray-400">Notatki (opcjonalne)</label>
                <textarea
                  value={serviceNotes}
                  onChange={(e) => setServiceNotes(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                  rows={3}
                  placeholder="Dodatkowe informacje..."
                />
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleAddService}
                disabled={!selectedServiceType}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] hover:bg-[#c4a859] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                Dodaj
              </button>
              <button
                onClick={() => {
                  setShowAddService(false);
                  setSelectedServiceType(null);
                  setServiceNotes('');
                }}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600"
              >
                <X className="h-4 w-4" />
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lista usług */}
      {services.length === 0 ? (
        <div className="rounded-lg border border-gray-700 bg-[#1a1d2e] p-8 text-center">
          <Package className="mx-auto mb-3 h-12 w-12 text-gray-600" />
          <p className="text-gray-400">Nie dodano żadnych typów usług</p>
        </div>
      ) : (
        <>
          {/* Zakładki typów usług */}
          <div className="flex gap-2 border-b border-gray-700">
            {services.map((service) => {
              const config = serviceTypeConfig[service.service_type];
              const Icon = config.icon;

              return (
                <button
                  key={service.id}
                  onClick={() => setActiveTab(service.service_type as ServiceType)}
                  className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === service.service_type
                      ? 'border-[#d3bb73] text-[#d3bb73]'
                      : 'border-transparent text-gray-400 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {config.label}
                  {!service.is_active && (
                    <span className="rounded-full bg-red-900/30 px-2 py-0.5 text-xs text-red-400">
                      Nieaktywny
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Zawartość aktywnej zakładki */}
          {activeTab && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">
                  {serviceTypeConfig[activeTab].label}
                </h3>
                <div className="flex gap-2">
                  {services.find((s) => s.service_type === activeTab) && (
                    <>
                      <button
                        onClick={() => {
                          const service = services.find((s) => s.service_type === activeTab)!;
                          handleToggleActive(service.id, service.is_active);
                        }}
                        className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm text-white hover:bg-gray-600"
                      >
                        {services.find((s) => s.service_type === activeTab)?.is_active
                          ? 'Dezaktywuj'
                          : 'Aktywuj'}
                      </button>
                      <button
                        onClick={() => {
                          const service = services.find((s) => s.service_type === activeTab)!;
                          handleRemoveService(service.id, service.service_type as ServiceType);
                        }}
                        className="rounded-lg bg-red-900/30 px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Informacja o katalogu */}
              <div className="rounded-lg border border-blue-900/30 bg-blue-900/10 p-4">
                <p className="text-sm text-blue-400">
                  {activeTab === 'services' &&
                    'Dodaj produkty/usługi jakie może świadczyć ten podwykonawca. Podobnie jak w systemie ofert.'}
                  {activeTab === 'rental' &&
                    'Dodaj sprzęt który możesz wynająć od tego podwykonawcy. Podobnie jak w magazynie.'}
                  {activeTab === 'transport' &&
                    'Dodaj pojazdy transportowe dostępne u tego podwykonawcy. (W przyszłości)'}
                </p>
              </div>

              {/* Lista produktów w katalogu */}
              <div className="space-y-4">
                <button
                  onClick={() => setShowAddItemModal(true)}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] hover:bg-[#c4a859]"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj pozycję do katalogu
                </button>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {getCatalogItems().length === 0 ? (
                    <div className="col-span-full rounded-lg border border-gray-700 bg-[#1a1d2e] p-8 text-center">
                      <p className="text-gray-400">Brak pozycji w katalogu</p>
                    </div>
                  ) : (
                  getCatalogItems().map((item) => (
                    <div
                      key={item.id}
                      className="relative rounded-lg border border-gray-700 bg-[#1a1d2e] p-4 transition-colors hover:border-[#d3bb73]"
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCatalogItem(item.id, item.name);
                        }}
                        className="absolute right-2 top-2 z-10 rounded-lg border border-red-500/20 bg-red-900/30 p-2 text-red-400 transition-colors hover:bg-red-900/50"
                        title="Usuń pozycję"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <div
                        onClick={() => handleViewInCatalog(item)}
                        className="cursor-pointer"
                      >
                        {item.thumbnail_url && (
                          <img
                            src={item.thumbnail_url}
                            alt={item.name}
                            className="mb-3 h-32 w-full rounded-lg object-cover"
                          />
                        )}
                        <h4 className="mb-1 font-medium text-white">{item.name}</h4>
                        {item.description && (
                          <p className="mb-2 line-clamp-2 text-sm text-gray-400">{item.description}</p>
                        )}
                        {item.category && (
                          <span className="inline-block rounded-full bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73]">
                            {item.category}
                          </span>
                        )}
                        <div className="mt-3 flex items-center justify-between border-t border-gray-700 pt-3 text-sm">
                          {item.unit_price && (
                            <span className="text-green-400">{item.unit_price} zł / {item.unit}</span>
                          )}
                          {item.daily_rental_price && (
                            <span className="text-green-400">{item.daily_rental_price} zł / dzień</span>
                          )}
                          {!item.is_active && (
                            <span className="text-xs text-red-400">Nieaktywny</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal dodawania pozycji do katalogu */}
      {showAddItemModal && activeTab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-[#1a1d2e] p-6">
            <h3 className="mb-4 text-lg font-semibold text-white">
              Dodaj pozycję do katalogu: {serviceTypeConfig[activeTab].label}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-gray-400">Nazwa *</label>
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                  placeholder="Nazwa usługi / sprzętu"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-gray-400">Opis</label>
                <textarea
                  value={newItemDescription}
                  onChange={(e) => setNewItemDescription(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                  rows={3}
                  placeholder="Opcjonalny opis..."
                />
              </div>

              {activeTab === 'services' && (
                <>
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">Kategoria</label>
                    <input
                      type="text"
                      value={newItemCategory}
                      onChange={(e) => setNewItemCategory(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                      placeholder="np. Catering, Animacje, Dekoracje"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-gray-400">Stawka VAT (%)</label>
                    <select
                      value={newItemVatRate}
                      onChange={(e) => {
                        const vat = parseFloat(e.target.value);
                        setNewItemVatRate(vat);
                        if (newItemPriceNet > 0) {
                          setNewItemPriceGross(Number((newItemPriceNet * (1 + vat / 100)).toFixed(2)));
                        }
                      }}
                      className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                    >
                      <option value="0">0% (zwolniony)</option>
                      <option value="5">5%</option>
                      <option value="8">8%</option>
                      <option value="23">23%</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-2 block text-sm text-gray-400">Cena netto (PLN)</label>
                      <input
                        type="number"
                        value={newItemPriceNet}
                        onChange={(e) => {
                          const net = parseFloat(e.target.value) || 0;
                          setNewItemPriceNet(net);
                          setNewItemPriceGross(Number((net * (1 + newItemVatRate / 100)).toFixed(2)));
                          setNewItemPrice(Number((net * (1 + newItemVatRate / 100)).toFixed(2)));
                        }}
                        className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-gray-400">Cena brutto (PLN)</label>
                      <input
                        type="number"
                        value={newItemPriceGross}
                        onChange={(e) => {
                          const gross = parseFloat(e.target.value) || 0;
                          setNewItemPriceGross(gross);
                          setNewItemPriceNet(Number((gross / (1 + newItemVatRate / 100)).toFixed(2)));
                          setNewItemPrice(gross);
                        }}
                        className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                        step="0.01"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-gray-400">Jednostka</label>
                    <input
                      type="text"
                      value={newItemUnit}
                      onChange={(e) => setNewItemUnit(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                      placeholder="szt, godz, usługa"
                    />
                  </div>
                </>
              )}

              {activeTab === 'rental' && (
                <>
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">Kategoria</label>
                    <input
                      type="text"
                      value={newItemCategory}
                      onChange={(e) => setNewItemCategory(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                      placeholder="np. Nagłośnienie, Oświetlenie"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-gray-400">Stawka VAT (%)</label>
                    <select
                      value={newItemVatRate}
                      onChange={(e) => {
                        const vat = parseFloat(e.target.value);
                        setNewItemVatRate(vat);
                        if (newItemPriceNet > 0) {
                          setNewItemPriceGross(Number((newItemPriceNet * (1 + vat / 100)).toFixed(2)));
                        }
                      }}
                      className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                    >
                      <option value="0">0% (zwolniony)</option>
                      <option value="5">5%</option>
                      <option value="8">8%</option>
                      <option value="23">23%</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-2 block text-sm text-gray-400">Cena dzienna netto (PLN)</label>
                      <input
                        type="number"
                        value={newItemPriceNet}
                        onChange={(e) => {
                          const net = parseFloat(e.target.value) || 0;
                          setNewItemPriceNet(net);
                          const gross = Number((net * (1 + newItemVatRate / 100)).toFixed(2));
                          setNewItemPriceGross(gross);
                          setNewItemPrice(gross);
                        }}
                        className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-gray-400">Cena dzienna brutto (PLN)</label>
                      <input
                        type="number"
                        value={newItemPriceGross}
                        onChange={(e) => {
                          const gross = parseFloat(e.target.value) || 0;
                          setNewItemPriceGross(gross);
                          const net = Number((gross / (1 + newItemVatRate / 100)).toFixed(2));
                          setNewItemPriceNet(net);
                          setNewItemPrice(gross);
                        }}
                        className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                        step="0.01"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-gray-400">Dostępna ilość</label>
                    <input
                      type="number"
                      value={newItemQuantity}
                      onChange={(e) => setNewItemQuantity(parseInt(e.target.value) || 1)}
                      className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                      min="1"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-gray-400">Wymagane umiejętności</label>
                    <input
                      type="text"
                      value={newItemRequiredSkills}
                      onChange={(e) => setNewItemRequiredSkills(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                      placeholder="np. Operator dźwięku, Technik oświetlenia (oddziel przecinkami)"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={handleAddNewItem}
                disabled={!newItemName.trim()}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] hover:bg-[#c4a859] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                Dodaj
              </button>
              <button
                onClick={() => {
                  setShowAddItemModal(false);
                  setNewItemName('');
                  setNewItemDescription('');
                  setNewItemPrice(0);
                  setNewItemUnit('szt');
                  setNewItemCategory('');
                  setNewItemQuantity(1);
                  setNewItemWeeklyPrice(0);
                  setNewItemMonthlyPrice(0);
                  setNewItemRequiredSkills('');
                  setNewItemVatRate(23);
                  setNewItemPriceNet(0);
                  setNewItemPriceGross(0);
                }}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600"
              >
                <X className="h-4 w-4" />
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
