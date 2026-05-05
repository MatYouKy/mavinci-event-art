'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Package, Truck, Wrench, Save, X, Upload, Star, StarOff, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useRouter } from 'next/navigation';
import NextImage from 'next/image';

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

interface ServiceImage {
  url: string;
  title?: string;
  isPrimary?: boolean;
}

interface ServiceCatalogItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  unit_price?: number;
  rental_price_per_day?: number;
  unit?: string;
  quantity_available?: number;
  thumbnail_url: string | null;
  is_active: boolean;
  vat_rate?: number;
  price_net?: number;
  price_gross?: number;
  daily_price_net?: number;
  daily_price_gross?: number;
  images?: ServiceImage[];
  warehouse_categories?: {
    id: string;
    name: string;
    level: number;
    parent_id: string | null;
  } | null;
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
    label: 'Uslugi',
    icon: Wrench,
    color: 'green',
    catalogRoute: '/crm/offers/products',
  },
  rental: {
    label: 'Wynajem sprzetu',
    icon: Package,
    color: 'purple',
    catalogRoute: '/crm/equipment',
  },
};

const compressImage = async (file: File, maxWidth = 1920, maxHeight = 1080, quality = 0.8): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
          } else {
            if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; }
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('No canvas ctx')); return; }
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) { reject(new Error('Blob failed')); return; }
            resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }));
          },
          'image/jpeg',
          quality,
        );
      };
      img.onerror = (e) => reject(e);
    };
    reader.onerror = (e) => reject(e);
  });
};

const compressThumbnail = async (file: File): Promise<File> => {
  return compressImage(file, 400, 400, 0.7);
};

export default function SubcontractorServicesPanel({ subcontractorId, organizationId }: SubcontractorServicesPanelProps) {
  const { showSnackbar } = useSnackbar();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const [newItemImages, setNewItemImages] = useState<ServiceImage[]>([]);
  const [uploading, setUploading] = useState(false);

  const [services, setServices] = useState<SubcontractorService[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddService, setShowAddService] = useState(false);
  const [selectedServiceType, setSelectedServiceType] = useState<ServiceType | null>(null);
  const [serviceNotes, setServiceNotes] = useState('');

  const [serviceCatalog, setServiceCatalog] = useState<ServiceCatalogItem[]>([]);
  const [equipmentCatalog, setEquipmentCatalog] = useState<ServiceCatalogItem[]>([]);
  const [transportCatalog, setTransportCatalog] = useState<ServiceCatalogItem[]>([]);

  const [activeTab, setActiveTab] = useState<ServiceType | null>(null);

  useEffect(() => { fetchServices(); }, [subcontractorId]);
  useEffect(() => { if (activeTab) fetchCatalog(activeTab); }, [activeTab]);

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
      if (data && data.length > 0) setActiveTab(data[0].service_type as ServiceType);
    } catch (error: any) {
      showSnackbar('Blad podczas ladowania uslug', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchCatalog = async (serviceType: ServiceType) => {
    try {
      let tableName = '';
      let setter: (items: ServiceCatalogItem[]) => void = () => {};

      switch (serviceType) {
        case 'services': tableName = 'subcontractor_service_catalog'; setter = setServiceCatalog; break;
        case 'rental': tableName = 'subcontractor_rental_equipment'; setter = setEquipmentCatalog; break;
        case 'transport': tableName = 'subcontractor_transport_catalog'; setter = setTransportCatalog; break;
      }

      let selectQuery = '*';
      if (serviceType === 'rental') selectQuery = '*, warehouse_categories(id, name, level, parent_id)';

      const { data, error } = await supabase
        .from(tableName)
        .select(selectQuery)
        .eq('subcontractor_id', subcontractorId)
        .order('name');

      if (error) throw error;
      setter((data as any) || []);
    } catch (error: any) {
      showSnackbar(`Blad podczas ladowania katalogu ${serviceTypeConfig[serviceType].label}`, 'error');
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
      showSnackbar('Dodano typ uslugi', 'success');
      fetchServices();
      setShowAddService(false);
      setSelectedServiceType(null);
      setServiceNotes('');
      setActiveTab(selectedServiceType);
    } catch (error: any) {
      showSnackbar('Blad podczas dodawania uslugi', 'error');
    }
  };

  const handleRemoveService = async (serviceId: string, serviceType: ServiceType) => {
    if (!confirm(`Czy na pewno chcesz usunac typ uslugi "${serviceTypeConfig[serviceType].label}"?`)) return;
    try {
      const { error } = await supabase.from('subcontractor_services').delete().eq('id', serviceId);
      if (error) throw error;
      showSnackbar('Usunieto typ uslugi', 'success');
      fetchServices();
      if (activeTab === serviceType) setActiveTab(null);
    } catch (error: any) {
      showSnackbar('Blad podczas usuwania uslugi', 'error');
    }
  };

  const handleToggleActive = async (serviceId: string, currentActive: boolean) => {
    try {
      const { error } = await supabase
        .from('subcontractor_services')
        .update({ is_active: !currentActive })
        .eq('id', serviceId);
      if (error) throw error;
      showSnackbar(currentActive ? 'Dezaktywowano usluge' : 'Aktywowano usluge', 'success');
      fetchServices();
    } catch (error: any) {
      showSnackbar('Blad podczas zmiany statusu uslugi', 'error');
    }
  };

  const getCatalogItems = () => {
    switch (activeTab) {
      case 'services': return serviceCatalog;
      case 'rental': return equipmentCatalog;
      case 'transport': return transportCatalog;
      default: return [];
    }
  };

  const handleViewInCatalog = (item: ServiceCatalogItem) => {
    if (activeTab === 'services') {
      router.push(`/crm/subcontractors/service/${item.id}`);
    } else if (activeTab === 'rental') {
      router.push(`/crm/subcontractors/rental/${item.id}`);
    }
  };

  const handleUploadImages = async (files: FileList) => {
    if (!files.length) return;
    setUploading(true);
    const tempId = `temp-${Date.now()}`;
    const uploaded: ServiceImage[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 10 * 1024 * 1024) { showSnackbar(`${file.name} przekracza 10MB`, 'error'); continue; }

      try {
        const compressed = await compressImage(file);
        const fileName = `${tempId}/${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from('service-catalog-images')
          .upload(fileName, compressed);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage.from('service-catalog-images').getPublicUrl(fileName);

        uploaded.push({
          url: publicUrl,
          title: file.name,
          isPrimary: newItemImages.length === 0 && i === 0,
        });
      } catch (err: any) {
        showSnackbar(`Blad przesylania ${file.name}`, 'error');
      }
    }

    if (uploaded.length > 0) {
      setNewItemImages((prev) => [...prev, ...uploaded]);
    }
    setUploading(false);
  };

  const handleRemoveNewImage = async (url: string) => {
    const fileName = url.split('/service-catalog-images/').pop();
    if (fileName) {
      await supabase.storage.from('service-catalog-images').remove([fileName]);
    }
    setNewItemImages((prev) => prev.filter((img) => img.url !== url));
  };

  const handleSetPrimaryNewImage = (url: string) => {
    setNewItemImages((prev) => prev.map((img) => ({ ...img, isPrimary: img.url === url })));
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
          insertData.images = newItemImages;
          insertData.thumbnail_url = newItemImages.find((img) => img.isPrimary)?.url || newItemImages[0]?.url || null;
          break;
        case 'rental':
          tableName = 'subcontractor_rental_equipment';
          insertData.rental_price_per_day = newItemPrice;
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

      const { error } = await supabase.from(tableName).insert(insertData).select().single();
      if (error) throw error;

      showSnackbar('Dodano pozycje do katalogu', 'success');
      resetAddItemForm();
      fetchCatalog(activeTab);
    } catch (error: any) {
      showSnackbar(error.message || 'Blad podczas dodawania pozycji', 'error');
    }
  };

  const resetAddItemForm = () => {
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
    setNewItemImages([]);
  };

  const handleDeleteCatalogItem = async (itemId: string, itemName: string) => {
    if (!activeTab) return;
    if (!confirm(`Czy na pewno chcesz usunac "${itemName}"? Ta operacja jest nieodwracalna.`)) return;

    try {
      let tableName = '';
      switch (activeTab) {
        case 'services': tableName = 'subcontractor_service_catalog'; break;
        case 'rental': tableName = 'subcontractor_rental_equipment'; break;
        case 'transport': tableName = 'subcontractor_transport_catalog'; break;
      }
      const { error } = await supabase.from(tableName).delete().eq('id', itemId);
      if (error) throw error;
      showSnackbar('Usunieto pozycje z katalogu', 'success');
      fetchCatalog(activeTab);
    } catch (error: any) {
      showSnackbar(error.message || 'Blad podczas usuwania pozycji', 'error');
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Swiadczone uslugi</h2>
          <p className="text-sm text-gray-400">Typy uslug oferowanych przez podwykonawce</p>
        </div>
        <button
          onClick={() => setShowAddService(true)}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] hover:bg-[#c4a859]"
        >
          <Plus className="h-4 w-4" />
          Dodaj typ uslugi
        </button>
      </div>

      {showAddService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-[#1a1d2e] p-6">
            <h3 className="mb-4 text-lg font-semibold text-white">Dodaj typ uslugi</h3>
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
                onClick={() => { setShowAddService(false); setSelectedServiceType(null); setServiceNotes(''); }}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600"
              >
                <X className="h-4 w-4" />
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

      {services.length === 0 ? (
        <div className="rounded-lg border border-gray-700 bg-[#1a1d2e] p-8 text-center">
          <Package className="mx-auto mb-3 h-12 w-12 text-gray-600" />
          <p className="text-gray-400">Nie dodano zadnych typow uslug</p>
        </div>
      ) : (
        <>
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
                    <span className="rounded-full bg-red-900/30 px-2 py-0.5 text-xs text-red-400">Nieaktywny</span>
                  )}
                </button>
              );
            })}
          </div>

          {activeTab && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">{serviceTypeConfig[activeTab].label}</h3>
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
                        {services.find((s) => s.service_type === activeTab)?.is_active ? 'Dezaktywuj' : 'Aktywuj'}
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

              <div className="rounded-lg border border-blue-900/30 bg-blue-900/10 p-4">
                <p className="text-sm text-blue-400">
                  {activeTab === 'services' && 'Dodaj produkty/uslugi jakie moze swiadczyc ten podwykonawca. Kliknij w pozycje aby zobaczyc szczegoly.'}
                  {activeTab === 'rental' && 'Dodaj sprzet ktory mozesz wynajac od tego podwykonawcy. Kliknij w pozycje aby zobaczyc szczegoly.'}
                  {activeTab === 'transport' && 'Dodaj pojazdy transportowe dostepne u tego podwykonawcy. (W przyszlosci)'}
                </p>
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => setShowAddItemModal(true)}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] hover:bg-[#c4a859]"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj pozycje do katalogu
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
                        className="group relative rounded-lg border border-gray-700 bg-[#1a1d2e] transition-colors hover:border-[#d3bb73]"
                      >
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteCatalogItem(item.id, item.name); }}
                          className="absolute right-2 top-2 z-10 rounded-lg border border-red-500/20 bg-red-900/30 p-2 text-red-400 opacity-0 transition-all hover:bg-red-900/50 group-hover:opacity-100"
                          title="Usun pozycje"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <div
                          onClick={() => handleViewInCatalog(item)}
                          className="cursor-pointer"
                        >
                          {item.thumbnail_url ? (
                            <NextImage
                              src={item.thumbnail_url}
                              alt={item.name}
                              className="h-40 w-full rounded-t-lg object-cover"
                              width={160}
                              height={160}
                            />
                          ) : (
                            <div className="flex h-40 w-full items-center justify-center rounded-t-lg bg-[#252837]">
                              <Package className="h-12 w-12 text-gray-600" />
                            </div>
                          )}
                          <div className="p-4">
                            <div className="mb-1 flex items-center gap-2">
                              <h4 className="font-medium text-white">{item.name}</h4>
                              <ExternalLink className="h-3.5 w-3.5 text-gray-500 opacity-0 transition-opacity group-hover:opacity-100" />
                            </div>
                            {item.description && (
                              <p className="mb-2 line-clamp-2 text-sm text-gray-400">{item.description}</p>
                            )}
                            {(item.warehouse_categories?.name || item.category) && (
                              <span className="inline-block rounded-full bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73]">
                                {item.warehouse_categories?.name || item.category}
                              </span>
                            )}
                            <div className="mt-3 flex items-center justify-between border-t border-gray-700 pt-3 text-sm">
                              {item.unit_price != null && item.unit_price > 0 && (
                                <span className="text-green-400">{item.unit_price} zl / {item.unit}</span>
                              )}
                              {item.price_net != null && item.price_net > 0 && !item.unit_price && (
                                <span className="text-green-400">{item.price_net} zl netto</span>
                              )}
                              {item.rental_price_per_day != null && item.rental_price_per_day > 0 && (
                                <span className="text-green-400">{item.rental_price_per_day} zl / dzien</span>
                              )}
                              {!item.is_active && (
                                <span className="text-xs text-red-400">Nieaktywny</span>
                              )}
                            </div>
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

      {showAddItemModal && activeTab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-[#1a1d2e] p-6">
            <h3 className="mb-4 text-lg font-semibold text-white">
              Dodaj pozycje do katalogu: {serviceTypeConfig[activeTab].label}
            </h3>

            <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
              <div>
                <label className="mb-2 block text-sm text-gray-400">Nazwa *</label>
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                  placeholder="Nazwa uslugi / sprzetu"
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

              {(activeTab === 'services' || activeTab === 'rental') && (
                <>
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">Zdjecia</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => { if (e.target.files) handleUploadImages(e.target.files); e.target.value = ''; }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-700 p-4 text-sm text-gray-400 transition-colors hover:border-[#d3bb73] hover:text-[#d3bb73] disabled:opacity-50"
                    >
                      <Upload className="h-5 w-5" />
                      {uploading ? 'Przesylanie...' : 'Kliknij aby dodac zdjecia (maks. 10MB)'}
                    </button>

                    {newItemImages.length > 0 && (
                      <div className="mt-3">
                        <p className="mb-2 text-xs text-gray-500">Kliknij gwiazdke aby ustawic miniature (thumbnail)</p>
                        <div className="grid grid-cols-4 gap-2">
                          {newItemImages.map((img, idx) => (
                            <div key={idx} className="group/img relative aspect-square overflow-hidden rounded-lg border border-gray-700">
                              <NextImage src={img.url} alt={img.title || ''} className="h-full w-full object-cover" width={160} height={160} />
                              {img.isPrimary && (
                                <div className="absolute left-1 top-1 rounded-full bg-[#d3bb73] p-0.5">
                                  <Star className="h-3 w-3 fill-[#0f1119] text-[#0f1119]" />
                                </div>
                              )}
                              <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/60 opacity-0 transition-opacity group-hover/img:opacity-100">
                                {!img.isPrimary && (
                                  <button
                                    type="button"
                                    onClick={() => handleSetPrimaryNewImage(img.url)}
                                    className="rounded bg-[#d3bb73] p-1.5 hover:bg-[#c4a859]"
                                    title="Ustaw jako miniature"
                                  >
                                    <StarOff className="h-3 w-3 text-[#0f1119]" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveNewImage(img.url)}
                                  className="rounded bg-red-600 p-1.5 hover:bg-red-700"
                                  title="Usun"
                                >
                                  <Trash2 className="h-3 w-3 text-white" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

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
                        if (newItemPriceNet > 0) setNewItemPriceGross(Number((newItemPriceNet * (1 + vat / 100)).toFixed(2)));
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
                          const net = parseFloat(e.target.value);
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
                          const gross = parseFloat(e.target.value);
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
                      placeholder="szt, godz, usluga"
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
                      placeholder="np. Naglosnienie, Oswietlenie"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">Stawka VAT (%)</label>
                    <select
                      value={newItemVatRate}
                      onChange={(e) => {
                        const vat = parseFloat(e.target.value);
                        setNewItemVatRate(vat);
                        if (newItemPriceNet > 0) setNewItemPriceGross(Number((newItemPriceNet * (1 + vat / 100)).toFixed(2)));
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
                          const net = parseFloat(e.target.value);
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
                          const gross = parseFloat(e.target.value);
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
                    <label className="mb-2 block text-sm text-gray-400">Dostepna ilosc</label>
                    <input
                      type="number"
                      value={newItemQuantity}
                      onChange={(e) => setNewItemQuantity(parseInt(e.target.value))}
                      className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                      min="1"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">Wymagane umiejetnosci</label>
                    <input
                      type="text"
                      value={newItemRequiredSkills}
                      onChange={(e) => setNewItemRequiredSkills(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-[#252837] p-3 text-white focus:border-[#d3bb73] focus:outline-none"
                      placeholder="np. Operator dzwieku, Technik oswietlenia (oddziel przecinkami)"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={handleAddNewItem}
                disabled={!newItemName.trim() || uploading}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] hover:bg-[#c4a859] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                Dodaj
              </button>
              <button
                onClick={resetAddItemForm}
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
