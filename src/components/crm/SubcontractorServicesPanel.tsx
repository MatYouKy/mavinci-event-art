'use client';

import { useState, useEffect } from 'react';
import { Plus, CreditCard as Edit, Trash2, Package, Truck, Wrench, Save, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useRouter } from 'next/navigation';

interface SubcontractorServicesPanelProps {
  subcontractorId: string;
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

export default function SubcontractorServicesPanel({ subcontractorId }: SubcontractorServicesPanelProps) {
  const { showSnackbar } = useSnackbar();
  const router = useRouter();

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
          tableName = 'subcontractor_equipment_catalog';
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
      router.push(`/crm/equipment/${item.id}`);
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
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {getCatalogItems().length === 0 ? (
                  <div className="col-span-full rounded-lg border border-gray-700 bg-[#1a1d2e] p-8 text-center">
                    <p className="text-gray-400">Brak pozycji w katalogu</p>
                    <button className="mt-3 text-sm text-[#d3bb73] hover:text-[#c4a859]">
                      Dodaj pierwszą pozycję
                    </button>
                  </div>
                ) : (
                  getCatalogItems().map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleViewInCatalog(item)}
                      className="cursor-pointer rounded-lg border border-gray-700 bg-[#1a1d2e] p-4 transition-colors hover:border-[#d3bb73]"
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
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
