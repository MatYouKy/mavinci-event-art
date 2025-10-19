'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Edit, Save, X, Plus, Trash2, Upload, Package, History, Image as ImageIcon, FileText, ShoppingCart, Settings as SettingsIcon, ChevronLeft, ChevronRight, Copy, MoreVertical } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/storage';
import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import EquipmentSkillRequirementsPanel from '@/components/crm/EquipmentSkillRequirementsPanel';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';

interface EquipmentStock {
  id: string;
  total_quantity: number;
  available_quantity: number;
  reserved_quantity: number;
  in_use_quantity: number;
  damaged_quantity: number;
  in_service_quantity: number;
  storage_location: string | null;
  min_stock_level: number;
  last_inventory_date: string | null;
}

interface Component {
  id: string;
  component_name: string;
  quantity: number;
  description: string | null;
  is_included: boolean;
}

interface GalleryImage {
  id: string;
  image_url: string;
  caption: string | null;
  order_index: number;
}

interface StockHistory {
  id: string;
  change_type: string;
  quantity_change: number;
  quantity_after: number;
  notes: string | null;
  created_at: string;
  employees: { name: string; surname: string } | null;
}

interface EquipmentUnit {
  id: string;
  equipment_id: string;
  unit_serial_number: string | null;
  status: 'available' | 'damaged' | 'in_service' | 'retired';
  location: string | null;
  location_id: string | null;
  condition_notes: string | null;
  purchase_date: string | null;
  last_service_date: string | null;
  estimated_repair_date: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
  storage_locations?: { name: string } | null;
}

interface UnitEvent {
  id: string;
  unit_id: string;
  event_type: 'damage' | 'repair' | 'service' | 'status_change' | 'note' | 'inspection' | 'sold';
  description: string;
  image_url: string | null;
  old_status: string | null;
  new_status: string | null;
  employee_id: string | null;
  created_at: string;
  employees: { name: string; surname: string } | null;
}

interface WarehouseCategory {
  id: string;
  name: string;
  parent_id: string | null;
  level: number;
}

interface Equipment {
  id: string;
  name: string;
  warehouse_category_id: string | null;
  brand: string | null;
  model: string | null;
  description: string | null;
  thumbnail_url: string | null;
  user_manual_url: string | null;
  weight_kg: number | null;
  cable_specs: any;
  dimensions_cm: any;
  purchase_date: string | null;
  purchase_price: number | null;
  current_value: number | null;
  warranty_until: string | null;
  serial_number: string | null;
  barcode: string | null;
  notes: string | null;
  is_active: boolean;
  warehouse_categories: WarehouseCategory | null;
  equipment_stock: EquipmentStock[];
  equipment_components: Component[];
  equipment_gallery: GalleryImage[];
}

export default function EquipmentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const equipmentId = params.id as string;
  const { showConfirm } = useDialog();
  const { showSnackbar } = useSnackbar();

  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [warehouseCategories, setWarehouseCategories] = useState<WarehouseCategory[]>([]);
  const [connectorTypes, setConnectorTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAddConnectorModal, setShowAddConnectorModal] = useState(false);
  const [connectorField, setConnectorField] = useState<'in' | 'out' | null>(null);
  const [showConnectorPreview, setShowConnectorPreview] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState<any>(null);
  const [connectorTooltip, setConnectorTooltip] = useState<any>(null);
  const [connectorTooltipPosition, setConnectorTooltipPosition] = useState({ x: 0, y: 0 });
  const [activeTab, setActiveTab] = useState<'details' | 'technical' | 'purchase' | 'components' | 'units' | 'gallery' | 'stock' | 'history'>('details');

  const [editForm, setEditForm] = useState<any>({});
  const [stockHistory, setStockHistory] = useState<StockHistory[]>([]);
  const [units, setUnits] = useState<EquipmentUnit[]>([]);

  const { canManageModule, loading: employeeLoading, currentEmployee } = useCurrentEmployee();
  const canEdit = canManageModule('equipment');

  useEffect(() => {
    fetchEquipment();
    fetchWarehouseCategories();
    fetchConnectorTypes();
  }, [equipmentId]);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchStockHistory();
    } else if (activeTab === 'units') {
      fetchUnits();
    }
  }, [activeTab]);

  const fetchWarehouseCategories = async () => {
    const { data } = await supabase
      .from('warehouse_categories')
      .select('*')
      .eq('is_active', true)
      .order('level', { ascending: true })
      .order('order_index', { ascending: true });

    if (data) setWarehouseCategories(data);
  };

  const fetchConnectorTypes = async () => {
    const { data } = await supabase
      .from('connector_types')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (data) setConnectorTypes(data);
  };

  const fetchEquipment = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('equipment_items')
        .select(`
          *,
          warehouse_categories(id, name, parent_id, level),
          equipment_stock(*),
          equipment_components(*),
          equipment_gallery(*)
        `)
        .eq('id', equipmentId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching equipment:', error);
        throw error;
      }

      if (!data) {
        console.error('Equipment not found');
        return;
      }

      const formData = {
        ...data,
        dimensions_length: data.dimensions_cm?.length || '',
        dimensions_width: data.dimensions_cm?.width || '',
        dimensions_height: data.dimensions_cm?.height || '',
        cable_length_meters: data.cable_specs?.length_meters || '',
        cable_connector_in: data.cable_specs?.connector_in || '',
        cable_connector_out: data.cable_specs?.connector_out || '',
      };

      setEquipment(data);
      setEditForm(formData);
    } catch (error) {
      console.error('Error fetching equipment:', error);
      showSnackbar('Błąd podczas pobierania danych sprzętu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchStockHistory = async () => {
    const { data, error } = await supabase
      .from('equipment_unit_events')
      .select(`
        *,
        equipment_units(unit_serial_number, internal_id),
        employees(name, surname)
      `)
      .eq('equipment_units.equipment_id', equipmentId)
      .order('event_date', { ascending: false })
      .limit(50);

    if (data) setStockHistory(data);
  };

  const fetchUnits = async () => {
    const { data, error } = await supabase
      .from('equipment_units')
      .select('*, storage_locations(name)')
      .eq('equipment_id', equipmentId)
      .order('created_at', { ascending: false });

    if (data) setUnits(data);
  };

  const logEquipmentChange = async (fieldName: string, oldValue: any, newValue: any) => {
    if (!currentEmployee) return;
    if (oldValue === newValue) return;

    try {
      await supabase
        .from('equipment_edit_history')
        .insert({
          equipment_id: equipmentId,
          employee_id: currentEmployee.id,
          field_name: fieldName,
          old_value: oldValue !== null && oldValue !== undefined ? String(oldValue) : null,
          new_value: newValue !== null && newValue !== undefined ? String(newValue) : null,
          change_type: 'update',
        });
    } catch (error) {
      console.error('Error logging change:', error);
    }
  };

  const handleEdit = () => {
    const formData = {
      ...equipment,
      dimensions_length: equipment?.dimensions_cm?.length || '',
      dimensions_width: equipment?.dimensions_cm?.width || '',
      dimensions_height: equipment?.dimensions_cm?.height || '',
      cable_length_meters: equipment?.cable_specs?.length_meters || '',
      cable_connector_in: equipment?.cable_specs?.connector_in || '',
      cable_connector_out: equipment?.cable_specs?.connector_out || '',
    };
    setEditForm(formData);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    const formData = {
      ...equipment,
      dimensions_length: equipment?.dimensions_cm?.length || '',
      dimensions_width: equipment?.dimensions_cm?.width || '',
      dimensions_height: equipment?.dimensions_cm?.height || '',
      cable_length_meters: equipment?.cable_specs?.length_meters || '',
      cable_connector_in: equipment?.cable_specs?.connector_in || '',
      cable_connector_out: equipment?.cable_specs?.connector_out || '',
    };
    setEditForm(formData);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const dimensions = editForm.dimensions_length || editForm.dimensions_width || editForm.dimensions_height
        ? {
            length: parseFloat(editForm.dimensions_length) || null,
            width: parseFloat(editForm.dimensions_width) || null,
            height: parseFloat(editForm.dimensions_height) || null,
          }
        : null;

      const cableSpecs = editForm.cable_length_meters || editForm.cable_connector_in || editForm.cable_connector_out
        ? {
            length_meters: editForm.cable_length_meters ? parseFloat(editForm.cable_length_meters) : null,
            connector_in: editForm.cable_connector_in || null,
            connector_out: editForm.cable_connector_out || null,
          }
        : null;

      const { error } = await supabase
        .from('equipment_items')
        .update({
          name: editForm.name,
          warehouse_category_id: editForm.warehouse_category_id || null,
          brand: editForm.brand || null,
          model: editForm.model || null,
          description: editForm.description || null,
          thumbnail_url: editForm.thumbnail_url || null,
          user_manual_url: editForm.user_manual_url || null,
          weight_kg: editForm.weight_kg ? parseFloat(editForm.weight_kg) : null,
          cable_specs: cableSpecs,
          dimensions_cm: dimensions,
          purchase_date: editForm.purchase_date || null,
          purchase_price: editForm.purchase_price ? parseFloat(editForm.purchase_price) : null,
          current_value: editForm.current_value ? parseFloat(editForm.current_value) : null,
          warranty_until: editForm.warranty_until || null,
          serial_number: editForm.serial_number || null,
          barcode: editForm.barcode || null,
          notes: editForm.notes || null,
        })
        .eq('id', equipmentId);

      if (error) throw error;

      // Log changes
      const fieldsToLog = [
        { name: 'name', old: equipment?.name, new: editForm.name },
        { name: 'warehouse_category_id', old: equipment?.warehouse_category_id, new: editForm.warehouse_category_id },
        { name: 'brand', old: equipment?.brand, new: editForm.brand },
        { name: 'model', old: equipment?.model, new: editForm.model },
        { name: 'description', old: equipment?.description, new: editForm.description },
        { name: 'weight_kg', old: equipment?.weight_kg, new: editForm.weight_kg ? parseFloat(editForm.weight_kg) : null },
        { name: 'purchase_date', old: equipment?.purchase_date, new: editForm.purchase_date },
        { name: 'purchase_price', old: equipment?.purchase_price, new: editForm.purchase_price ? parseFloat(editForm.purchase_price) : null },
        { name: 'serial_number', old: equipment?.serial_number, new: editForm.serial_number },
      ];

      for (const field of fieldsToLog) {
        await logEquipmentChange(field.name, field.old, field.new);
      }

      await fetchEquipment();
      setIsEditing(false);
      showSnackbar('Zmiany zostały zapisane', 'success');
    } catch (error) {
      console.error('Error saving equipment:', error);
      showSnackbar('Błąd podczas zapisywania', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEditForm((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      showSnackbar('Przesyłanie zdjęcia...', 'info');
      const url = await uploadImage(file, 'equipment-thumbnails');
      setEditForm((prev: any) => ({ ...prev, thumbnail_url: url }));
      showSnackbar('Zdjęcie zostało przesłane', 'success');
    } catch (error) {
      console.error('Error uploading thumbnail:', error);
      showSnackbar(error instanceof Error ? error.message : 'Błąd podczas przesyłania zdjęcia', 'error');
    }
  };

  const handleDelete = async () => {
    const confirmed = await showConfirm(
      `Czy na pewno chcesz usunąć sprzęt "${equipment?.name}"? Ta operacja jest nieodwracalna.`,
      'Usuń sprzęt'
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('equipment_items')
        .update({ is_active: false })
        .eq('id', equipmentId);

      if (error) throw error;

      showSnackbar('Sprzęt został usunięty', 'success');
      router.push('/crm/equipment');
    } catch (error) {
      console.error('Error deleting equipment:', error);
      showSnackbar('Błąd podczas usuwania sprzętu', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  if (!equipment) {
    return (
      <div className="text-center py-12">
        <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
        <p className="text-[#e5e4e2]/60">Nie znaleziono sprzętu</p>
      </div>
    );
  }

  const stock = equipment.equipment_stock[0];

  const availableUnits = units.filter((u: EquipmentUnit) => u.status === 'available').length;
  const totalUnits = units.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-[#e5e4e2]" />
          </button>
          <div>
            <h2 className="text-2xl font-light text-[#e5e4e2] flex items-center gap-3">
              {equipment.name}
              <span className="text-lg font-normal text-[#d3bb73]">
                {availableUnits}/{totalUnits}
              </span>
            </h2>
            {(equipment.brand || equipment.model) && (
              <p className="text-sm text-[#e5e4e2]/60 mt-1">
                {equipment.brand} {equipment.model}
              </p>
            )}
          </div>
        </div>

        {isEditing ? (
          <ResponsiveActionBar
            actions={[
              {
                label: 'Anuluj',
                onClick: handleCancelEdit,
                icon: <X className="w-4 h-4" />,
                variant: 'default'
              },
              {
                label: saving ? 'Zapisywanie...' : 'Zapisz',
                onClick: handleSave,
                icon: <Save className="w-4 h-4" />,
                variant: 'primary'
              }
            ]}
          />
        ) : canEdit ? (
          <ResponsiveActionBar
            actions={[
              {
                label: 'Usuń',
                onClick: handleDelete,
                icon: <Trash2 className="w-4 h-4" />,
                variant: 'danger'
              },
              {
                label: 'Edytuj',
                onClick: handleEdit,
                icon: <Edit className="w-4 h-4" />,
                variant: 'primary'
              }
            ]}
          />
        ) : null}
      </div>

      <TabCarousel activeTab={activeTab} setActiveTab={setActiveTab} equipment={equipment} units={units} />

      {activeTab === 'details' && (
        <DetailsTab
          equipment={equipment}
          editForm={editForm}
          isEditing={isEditing}
          onInputChange={handleInputChange}
          onThumbnailUpload={handleThumbnailUpload}
          equipmentId={equipmentId}
          canEdit={canEdit}
        />
      )}

      {activeTab === 'technical' && (
        <TechnicalTab
          equipment={equipment}
          editForm={editForm}
          isEditing={isEditing}
          onInputChange={handleInputChange}
          connectorTypes={connectorTypes}
          setConnectorTooltip={setConnectorTooltip}
          setConnectorTooltipPosition={setConnectorTooltipPosition}
          setShowAddConnectorModal={setShowAddConnectorModal}
          setConnectorField={setConnectorField}
          onConnectorClick={(connectorName: string) => {
            const connector = connectorTypes.find((c: any) => c.name === connectorName);
            if (connector) {
              setSelectedConnector(connector);
              setShowConnectorPreview(true);
            }
          }}
        />
      )}

      {activeTab === 'purchase' && (
        <PurchaseTab
          equipment={equipment}
          editForm={editForm}
          isEditing={isEditing}
          onInputChange={handleInputChange}
        />
      )}

      {activeTab === 'components' && (
        <ComponentsTab
          equipment={equipment}
          isEditing={isEditing}
          onUpdate={fetchEquipment}
        />
      )}

      {activeTab === 'units' && (
        <UnitsTab
          equipment={equipment}
          units={units}
          onUpdate={fetchUnits}
          canEdit={canEdit}
        />
      )}

      {activeTab === 'gallery' && (
        <GalleryTab
          equipment={equipment}
          onUpdate={fetchEquipment}
        />
      )}

      {activeTab === 'history' && (
        <HistoryTab history={stockHistory} />
      )}

      {connectorTooltip && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: `${connectorTooltipPosition.x}px`,
            top: `${connectorTooltipPosition.y}px`,
          }}
        >
          <div className="bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg shadow-xl p-4 max-w-sm ml-2">
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                {connectorTooltip.thumbnail_url && (
                  <img
                    src={connectorTooltip.thumbnail_url}
                    alt={connectorTooltip.name}
                    className="w-20 h-20 rounded object-cover flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-[#e5e4e2] mb-1">{connectorTooltip.name}</h4>
                  {connectorTooltip.description && (
                    <p className="text-xs text-[#e5e4e2]/60">{connectorTooltip.description}</p>
                  )}
                </div>
              </div>
              {connectorTooltip.common_uses && (
                <div className="border-t border-[#d3bb73]/10 pt-2">
                  <div className="text-xs text-[#e5e4e2]/60 mb-1">Typowe zastosowania:</div>
                  <p className="text-sm text-[#e5e4e2]">{connectorTooltip.common_uses}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAddConnectorModal && (
        <AddConnectorModal
          onClose={() => setShowAddConnectorModal(false)}
          onAdd={(name) => {
            if (connectorField === 'in') {
              setEditForm((prev: any) => ({ ...prev, cable_connector_in: name }));
            } else {
              setEditForm((prev: any) => ({ ...prev, cable_connector_out: name }));
            }
            fetchConnectorTypes();
          }}
        />
      )}

      {showConnectorPreview && selectedConnector && (
        <ConnectorPreviewModal
          connector={selectedConnector}
          onClose={() => {
            setShowConnectorPreview(false);
            setSelectedConnector(null);
          }}
          onEdit={() => {
            setShowConnectorPreview(false);
          }}
        />
      )}
    </div>
  );
}

function TabCarousel({ activeTab, setActiveTab, equipment, units }: any) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [visibleTabs, setVisibleTabs] = useState(5);
  const isCable = equipment.equipment_categories?.name?.toLowerCase().includes('przewod');

  const allTabs = [
    { id: 'details', label: 'Podstawowe' },
    { id: 'technical', label: 'Parametry techniczne' },
    { id: 'purchase', label: 'Informacje zakupowe' },
    { id: 'components', label: `Skład zestawu (${equipment.equipment_components?.length || 0})` },
    { id: 'units', label: `Jednostki (${units?.length || 0})` },
    { id: 'gallery', label: `Galeria (${equipment.equipment_gallery?.length || 0})` },
    { id: 'history', label: 'Historia' },
  ];

  const tabs = isCable
    ? allTabs.filter(tab => tab.id !== 'components')
    : allTabs;

  useEffect(() => {
    const updateVisibleTabs = () => {
      if (window.innerWidth < 640) {
        setVisibleTabs(2);
      } else if (window.innerWidth < 1024) {
        setVisibleTabs(3);
      } else {
        setVisibleTabs(5);
      }
    };

    updateVisibleTabs();
    window.addEventListener('resize', updateVisibleTabs);
    return () => window.removeEventListener('resize', updateVisibleTabs);
  }, []);

  useEffect(() => {
    const activeIndex = tabs.findIndex(tab => tab.id === activeTab);
    if (activeIndex !== -1) {
      if (activeIndex < currentIndex) {
        setCurrentIndex(activeIndex);
      } else if (activeIndex >= currentIndex + visibleTabs) {
        setCurrentIndex(activeIndex - visibleTabs + 1);
      }
    }
  }, [activeTab, visibleTabs]);

  const canScrollLeft = currentIndex > 0;
  const canScrollRight = currentIndex < tabs.length - visibleTabs;

  const scrollLeft = () => {
    if (canScrollLeft) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const scrollRight = () => {
    if (canScrollRight) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const visibleTabsArray = tabs.slice(currentIndex, currentIndex + visibleTabs);

  const tabsContainerRef = useRef<HTMLDivElement>(null);

  const scrollToTab = (direction: 'left' | 'right') => {
    if (tabsContainerRef.current) {
      const scrollAmount = 200;
      tabsContainerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className="relative border-b border-[#d3bb73]/10">
      <div className="flex items-center">
        <button
          onClick={() => scrollToTab('left')}
          className="absolute left-0 z-10 p-2 bg-gradient-to-r from-[#0f1119] via-[#0f1119] to-transparent hover:from-[#1c1f33] transition-colors md:hidden"
        >
          <ChevronLeft className="w-5 h-5 text-[#d3bb73]" />
        </button>

        <div
          ref={tabsContainerRef}
          className="flex gap-2 flex-1 overflow-x-auto scrollbar-hide scroll-smooth px-10 md:px-2 md:justify-center"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 text-sm whitespace-nowrap transition-colors flex-shrink-0 ${
                activeTab === tab.id
                  ? 'text-[#d3bb73] border-b-2 border-[#d3bb73]'
                  : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => scrollToTab('right')}
          className="absolute right-0 z-10 p-2 bg-gradient-to-l from-[#0f1119] via-[#0f1119] to-transparent hover:from-[#1c1f33] transition-colors md:hidden"
        >
          <ChevronRight className="w-5 h-5 text-[#d3bb73]" />
        </button>
      </div>
    </div>
  );
}

function DetailsTab({
  equipment,
  editForm,
  isEditing,
  onInputChange,
  onThumbnailUpload,
  equipmentId,
  canEdit,
}: any) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          {isEditing ? (
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Miniaturka</label>
              {editForm.thumbnail_url ? (
                <div className="space-y-2">
                  <img
                    src={editForm.thumbnail_url}
                    alt={equipment.name}
                    className="w-full aspect-square object-cover rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => onInputChange({ target: { name: 'thumbnail_url', value: '' } })}
                    className="w-full text-red-400 hover:text-red-300 text-sm"
                  >
                    Usuń zdjęcie
                  </button>
                </div>
              ) : (
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onThumbnailUpload}
                    className="hidden"
                    id="thumbnail-upload-edit"
                  />
                  <label
                    htmlFor="thumbnail-upload-edit"
                    className="flex items-center justify-center gap-2 w-full aspect-square bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]/60 hover:border-[#d3bb73]/30 cursor-pointer transition-colors"
                  >
                    <Upload className="w-8 h-8" />
                  </label>
                </div>
              )}
            </div>
          ) : equipment.thumbnail_url ? (
            <img
              src={equipment.thumbnail_url}
              alt={equipment.name}
              className="w-full aspect-square object-cover rounded-lg"
            />
          ) : (
            <div className="w-full aspect-square bg-[#d3bb73]/20 rounded-lg flex items-center justify-center">
              <Package className="w-16 h-16 text-[#d3bb73]" />
            </div>
          )}

          <div className="mt-6 space-y-4">
            <div>
              <div className="text-sm text-[#e5e4e2]/60 mb-1">Kategoria</div>
              {isEditing ? (
                <select
                  name="warehouse_category_id"
                  value={editForm.warehouse_category_id || ''}
                  onChange={(e) => {
                    onInputChange(e);
                  }}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                >
                  <option value="">Brak</option>
                  {warehouseCategories?.filter(c => c.level === 1).map((cat) => (
                    <optgroup key={cat.id} label={cat.name}>
                      <option value={cat.id}>{cat.name}</option>
                      {warehouseCategories
                        .filter(sub => sub.parent_id === cat.id)
                        .map(sub => (
                          <option key={sub.id} value={sub.id}>
                            &nbsp;&nbsp;└─ {sub.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              ) : equipment.warehouse_categories ? (
                <div className="inline-block px-3 py-1 rounded bg-blue-500/20 text-blue-400">
                  {(() => {
                    const cat = equipment.warehouse_categories;
                    if (cat.level === 2 && cat.parent_id) {
                      const parent = warehouseCategories.find(c => c.id === cat.parent_id);
                      return parent ? `${parent.name} / ${cat.name}` : cat.name;
                    }
                    return cat.name;
                  })()}
                </div>
              ) : (
                <div className="text-[#e5e4e2]/60">-</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="lg:col-span-2 space-y-6">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Podstawowe informacje</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa</label>
              {isEditing ? (
                <input
                  type="text"
                  name="name"
                  value={editForm.name}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.name}</div>
              )}
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Marka</label>
              {isEditing ? (
                <input
                  type="text"
                  name="brand"
                  value={editForm.brand || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.brand || '-'}</div>
              )}
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Model</label>
              {isEditing ? (
                <input
                  type="text"
                  name="model"
                  value={editForm.model || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.model || '-'}</div>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
              {isEditing ? (
                <textarea
                  name="description"
                  value={editForm.description || ''}
                  onChange={onInputChange}
                  rows={4}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.description || '-'}</div>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Notatki</label>
              {isEditing ? (
                <textarea
                  name="notes"
                  value={editForm.notes || ''}
                  onChange={onInputChange}
                  rows={3}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.notes || '-'}</div>
              )}
            </div>
          </div>
        </div>

        {/* Panel wymaganych umiejętności */}
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <EquipmentSkillRequirementsPanel equipmentId={equipmentId} canEdit={canEdit} />
        </div>
      </div>
    </div>
  );
}

function TechnicalTab({ equipment, editForm, isEditing, onInputChange, connectorTypes, setConnectorTooltip, setConnectorTooltipPosition, setShowAddConnectorModal, setConnectorField, onConnectorClick }: any) {
  const isCable = equipment.equipment_categories?.name?.toLowerCase().includes('przewod');

  return (
    <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
      <h3 className="text-lg font-medium text-[#e5e4e2] mb-6">Parametry techniczne</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {isCable ? (
          <>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Długość (m)</label>
              {isEditing ? (
                <input
                  type="number"
                  step="0.5"
                  name="cable_length_meters"
                  value={editForm.cable_length_meters || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">
                  {equipment.cable_specs?.length_meters ? `${equipment.cable_specs.length_meters} m` : '-'}
                </div>
              )}
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Wtyki</label>
              {isEditing ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[#e5e4e2]/40 mb-2">Wtyk wejściowy</label>
                    <div className="flex gap-2">
                      <select
                        name="cable_connector_in"
                        value={editForm.cable_connector_in || ''}
                        onChange={onInputChange}
                        className="flex-1 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                      >
                        <option value="">Wybierz wtyk</option>
                        {connectorTypes.map((connector: any) => (
                          <option key={connector.id} value={connector.name}>
                            {connector.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => { setConnectorField('in'); setShowAddConnectorModal(true); }}
                        className="px-3 py-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
                        title="Dodaj nowy wtyk"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-[#e5e4e2]/40 mb-2">Wtyk wyjściowy</label>
                    <div className="flex gap-2">
                      <select
                        name="cable_connector_out"
                        value={editForm.cable_connector_out || ''}
                        onChange={onInputChange}
                        className="flex-1 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                      >
                        <option value="">Wybierz wtyk</option>
                        {connectorTypes.map((connector: any) => (
                          <option key={connector.id} value={connector.name}>
                            {connector.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => { setConnectorField('out'); setShowAddConnectorModal(true); }}
                        className="px-3 py-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
                        title="Dodaj nowy wtyk"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[#e5e4e2]/40 mb-2">Wtyk wejściowy</label>
                    {equipment.cable_specs?.connector_in ? (
                      <div className="flex items-center gap-3">
                        {connectorTypes.find(c => c.name === equipment.cable_specs.connector_in)?.thumbnail_url && (
                          <img
                            src={connectorTypes.find(c => c.name === equipment.cable_specs.connector_in)?.thumbnail_url}
                            alt={equipment.cable_specs.connector_in}
                            className="w-12 h-12 object-cover rounded border border-[#d3bb73]/20"
                          />
                        )}
                        <button
                          onClick={() => onConnectorClick(equipment.cable_specs.connector_in)}
                          onMouseEnter={(e) => {
                            const connector = connectorTypes.find(c => c.name === equipment.cable_specs.connector_in);
                            if (connector) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setConnectorTooltip(connector);
                              setConnectorTooltipPosition({ x: rect.right + 10, y: rect.top });
                            }
                          }}
                          onMouseLeave={() => setConnectorTooltip(null)}
                          className="text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors underline text-left"
                        >
                          {equipment.cable_specs.connector_in}
                        </button>
                      </div>
                    ) : (
                      <div className="text-[#e5e4e2]">-</div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-[#e5e4e2]/40 mb-2">Wtyk wyjściowy</label>
                    {equipment.cable_specs?.connector_out ? (
                      <div className="flex items-center gap-3">
                        {connectorTypes.find(c => c.name === equipment.cable_specs.connector_out)?.thumbnail_url && (
                          <img
                            src={connectorTypes.find(c => c.name === equipment.cable_specs.connector_out)?.thumbnail_url}
                            alt={equipment.cable_specs.connector_out}
                            className="w-12 h-12 object-cover rounded border border-[#d3bb73]/20"
                          />
                        )}
                        <button
                          onClick={() => onConnectorClick(equipment.cable_specs.connector_out)}
                          onMouseEnter={(e) => {
                            const connector = connectorTypes.find(c => c.name === equipment.cable_specs.connector_out);
                            if (connector) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setConnectorTooltip(connector);
                              setConnectorTooltipPosition({ x: rect.right + 10, y: rect.top });
                            }
                          }}
                          onMouseLeave={() => setConnectorTooltip(null)}
                          className="text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors underline text-left"
                        >
                          {equipment.cable_specs.connector_out}
                        </button>
                      </div>
                    ) : (
                      <div className="text-[#e5e4e2]">-</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Waga (kg)</label>
            {isEditing ? (
              <input
                type="number"
                step="0.01"
                name="weight_kg"
                value={editForm.weight_kg || ''}
                onChange={onInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
              />
            ) : (
              <div className="text-[#e5e4e2]">
                {equipment.weight_kg ? `${equipment.weight_kg} kg` : '-'}
              </div>
            )}
          </div>
        )}

        {!isCable && (
        <div>
          <label className="block text-sm text-[#e5e4e2]/60 mb-2">Wymiary (cm)</label>
          {isEditing ? (
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                step="0.1"
                name="dimensions_length"
                value={editForm.dimensions_length || ''}
                onChange={onInputChange}
                placeholder="Długość"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/30"
              />
              <input
                type="number"
                step="0.1"
                name="dimensions_width"
                value={editForm.dimensions_width || ''}
                onChange={onInputChange}
                placeholder="Szerokość"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/30"
              />
              <input
                type="number"
                step="0.1"
                name="dimensions_height"
                value={editForm.dimensions_height || ''}
                onChange={onInputChange}
                placeholder="Wysokość"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/30"
              />
            </div>
          ) : (
            <div className="text-[#e5e4e2]">
              {equipment.dimensions_cm
                ? `${equipment.dimensions_cm.length || '-'} × ${equipment.dimensions_cm.width || '-'} × ${equipment.dimensions_cm.height || '-'} cm`
                : '-'}
            </div>
          )}
        </div>
        )}

        <div>
          <label className="block text-sm text-[#e5e4e2]/60 mb-2">Numer seryjny</label>
          {isEditing ? (
            <input
              type="text"
              name="serial_number"
              value={editForm.serial_number || ''}
              onChange={onInputChange}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
            />
          ) : (
            <div className="text-[#e5e4e2]">{equipment.serial_number || '-'}</div>
          )}
        </div>

        <div>
          <label className="block text-sm text-[#e5e4e2]/60 mb-2">Kod kreskowy</label>
          {isEditing ? (
            <input
              type="text"
              name="barcode"
              value={editForm.barcode || ''}
              onChange={onInputChange}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
            />
          ) : (
            <div className="text-[#e5e4e2] font-mono">{equipment.barcode || '-'}</div>
          )}
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm text-[#e5e4e2]/60 mb-2">Instrukcja obsługi (URL)</label>
          {isEditing ? (
            <input
              type="url"
              name="user_manual_url"
              value={editForm.user_manual_url || ''}
              onChange={onInputChange}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
            />
          ) : equipment.user_manual_url ? (
            <a
              href={equipment.user_manual_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#d3bb73] hover:underline flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              Otwórz instrukcję
            </a>
          ) : (
            <div className="text-[#e5e4e2]/60">-</div>
          )}
        </div>
      </div>
    </div>
  );
}

function PurchaseTab({ equipment, editForm, isEditing, onInputChange }: any) {
  return (
    <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
      <h3 className="text-lg font-medium text-[#e5e4e2] mb-6">Informacje zakupowe</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm text-[#e5e4e2]/60 mb-2">Data zakupu</label>
          {isEditing ? (
            <input
              type="date"
              name="purchase_date"
              value={editForm.purchase_date || ''}
              onChange={onInputChange}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
            />
          ) : (
            <div className="text-[#e5e4e2]">
              {equipment.purchase_date
                ? new Date(equipment.purchase_date).toLocaleDateString('pl-PL')
                : '-'}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm text-[#e5e4e2]/60 mb-2">Gwarancja do</label>
          {isEditing ? (
            <input
              type="date"
              name="warranty_until"
              value={editForm.warranty_until || ''}
              onChange={onInputChange}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
            />
          ) : (
            <div className="text-[#e5e4e2]">
              {equipment.warranty_until
                ? new Date(equipment.warranty_until).toLocaleDateString('pl-PL')
                : '-'}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm text-[#e5e4e2]/60 mb-2">Cena zakupu (zł)</label>
          {isEditing ? (
            <input
              type="number"
              step="0.01"
              name="purchase_price"
              value={editForm.purchase_price || ''}
              onChange={onInputChange}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
            />
          ) : (
            <div className="text-[#e5e4e2]">
              {equipment.purchase_price
                ? `${equipment.purchase_price.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł`
                : '-'}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm text-[#e5e4e2]/60 mb-2">Obecna wartość (zł)</label>
          {isEditing ? (
            <input
              type="number"
              step="0.01"
              name="current_value"
              value={editForm.current_value || ''}
              onChange={onInputChange}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
            />
          ) : (
            <div className="text-[#e5e4e2]">
              {equipment.current_value
                ? `${equipment.current_value.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł`
                : '-'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ComponentMenu({ onDelete }: { onDelete: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div ref={menuRef} className="relative md:hidden">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg shadow-xl z-50 overflow-hidden">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
              setIsOpen(false);
            }}
            className="w-full px-4 py-3 text-left text-red-400 hover:bg-[#d3bb73]/10 transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Usuń komponent
          </button>
        </div>
      )}
    </div>
  );
}

function ComponentsTab({ equipment, isEditing, onUpdate }: any) {
  const [isAdding, setIsAdding] = useState(false);
  const [newComponent, setNewComponent] = useState({
    component_name: '',
    quantity: 1,
    description: '',
  });

  const handleAddComponent = async () => {
    if (!newComponent.component_name.trim()) {
      alert('Wprowadź nazwę komponentu');
      return;
    }

    try {
      const { error } = await supabase
        .from('equipment_components')
        .insert({
          equipment_id: equipment.id,
          component_name: newComponent.component_name,
          quantity: newComponent.quantity,
          description: newComponent.description || null,
          is_included: true,
        });

      if (error) throw error;

      setNewComponent({ component_name: '', quantity: 1, description: '' });
      setIsAdding(false);
      onUpdate();
    } catch (error) {
      console.error('Error adding component:', error);
      alert('Błąd podczas dodawania komponentu');
    }
  };

  const handleDeleteComponent = async (componentId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten komponent?')) return;

    try {
      const { error } = await supabase
        .from('equipment_components')
        .delete()
        .eq('id', componentId);

      if (error) throw error;
      onUpdate();
    } catch (error) {
      console.error('Error deleting component:', error);
      alert('Błąd podczas usuwania komponentu');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Skład zestawu</h3>
        {isEditing && (
          <button
            onClick={() => setIsAdding(true)}
            className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Dodaj komponent
          </button>
        )}
      </div>

      {isAdding && (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h4 className="text-[#e5e4e2] font-medium mb-4">Nowy komponent</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <input
              type="text"
              value={newComponent.component_name}
              onChange={(e) => setNewComponent(prev => ({ ...prev, component_name: e.target.value }))}
              placeholder="Nazwa komponentu"
              className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
            />
            <input
              type="number"
              value={newComponent.quantity}
              onChange={(e) => setNewComponent(prev => ({ ...prev, quantity: parseInt(e.target.value) || 1 }))}
              placeholder="Ilość"
              min="1"
              className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
            />
            <input
              type="text"
              value={newComponent.description}
              onChange={(e) => setNewComponent(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Opis (opcjonalnie)"
              className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setIsAdding(false)}
              className="flex-1 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
            >
              Anuluj
            </button>
            <button
              onClick={handleAddComponent}
              className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
            >
              Zapisz
            </button>
          </div>
        </div>
      )}

      {equipment.equipment_components.length === 0 ? (
        <div className="text-center py-12 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
          <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">Brak komponentów w zestawie</p>
        </div>
      ) : (
        <div className="space-y-3">
          {equipment.equipment_components.map((component: Component) => (
            <div
              key={component.id}
              className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4 flex items-center justify-between relative"
            >
              <div className="flex-1 pr-2">
                <div className="text-[#e5e4e2] font-medium">{component.component_name}</div>
                {component.description && (
                  <div className="text-sm text-[#e5e4e2]/60 mt-1">{component.description}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="text-[#d3bb73] font-medium">x{component.quantity}</div>
                {isEditing && (
                  <>
                    {/* Desktop: Direct button */}
                    <button
                      onClick={() => handleDeleteComponent(component.id)}
                      className="hidden md:flex p-2 text-red-400 hover:text-red-300 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    {/* Mobile: 3-dot menu */}
                    <ComponentMenu
                      onDelete={() => handleDeleteComponent(component.id)}
                    />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GalleryTab({ equipment, onUpdate }: any) {
  const [uploading, setUploading] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const url = await uploadImage(file, 'equipment-gallery');

        const maxOrder = equipment.equipment_gallery.length > 0
          ? Math.max(...equipment.equipment_gallery.map((img: any) => img.order_index))
          : -1;

        await supabase.from('equipment_gallery').insert({
          equipment_id: equipment.id,
          image_url: url,
          order_index: maxOrder + 1,
        });
      }

      onUpdate();
    } catch (error) {
      console.error('Error uploading images:', error);
      alert('Błąd podczas przesyłania zdjęć');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć to zdjęcie?')) return;

    try {
      await supabase.from('equipment_gallery').delete().eq('id', imageId);
      onUpdate();
    } catch (error) {
      console.error('Error deleting image:', error);
      alert('Błąd podczas usuwania zdjęcia');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Galeria zdjęć</h3>
        <div>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageUpload}
            className="hidden"
            id="gallery-upload"
            disabled={uploading}
          />
          <label
            htmlFor="gallery-upload"
            className={`flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg cursor-pointer hover:bg-[#d3bb73]/90 transition-colors ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Upload className="w-4 h-4" />
            {uploading ? 'Przesyłanie...' : 'Dodaj zdjęcia'}
          </label>
        </div>
      </div>

      {equipment.equipment_gallery.length === 0 ? (
        <div className="text-center py-12 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
          <ImageIcon className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">Brak zdjęć w galerii</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {equipment.equipment_gallery.map((image: GalleryImage) => (
            <div key={image.id} className="relative group">
              <img
                src={image.image_url}
                alt={image.caption || ''}
                className="w-full aspect-square object-cover rounded-lg"
              />
              <button
                onClick={() => handleDeleteImage(image.id)}
                className="absolute top-2 right-2 p-2 bg-red-500 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StockTab({ equipment, stock, onUpdate }: any) {
  const [showModal, setShowModal] = useState(false);
  const [changeType, setChangeType] = useState('add');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingStock, setEditingStock] = useState(false);
  const [stockEdit, setStockEdit] = useState({
    storage_location: stock?.storage_location || '',
    min_stock_level: stock?.min_stock_level || 0,
  });

  const handleStockChange = async () => {
    if (!quantity || parseInt(quantity) === 0) {
      alert('Wprowadź ilość');
      return;
    }

    setSaving(true);
    try {
      const qty = changeType === 'remove' || changeType === 'damage'
        ? -Math.abs(parseInt(quantity))
        : Math.abs(parseInt(quantity));

      const { error } = await supabase.rpc('update_equipment_stock_with_history', {
        p_equipment_id: equipment.id,
        p_change_type: changeType,
        p_quantity_change: qty,
        p_employee_id: null,
        p_notes: notes || null,
      });

      if (error) throw error;

      setShowModal(false);
      setQuantity('');
      setNotes('');
      onUpdate();
    } catch (error) {
      console.error('Error updating stock:', error);
      alert('Błąd podczas aktualizacji stanu magazynowego');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveStockSettings = async () => {
    try {
      const { error } = await supabase
        .from('equipment_stock')
        .update({
          storage_location: stockEdit.storage_location || null,
          min_stock_level: parseInt(stockEdit.min_stock_level as any) || 0,
        })
        .eq('id', stock.id);

      if (error) throw error;

      setEditingStock(false);
      onUpdate();
    } catch (error) {
      console.error('Error updating stock settings:', error);
      alert('Błąd podczas zapisywania');
    }
  };

  if (!stock) {
    return (
      <div className="text-center py-12 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
        <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
        <p className="text-[#e5e4e2]/60">Brak danych o stanie magazynowym</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Stan magazynowy</h3>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Zmień stan
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="text-sm text-[#e5e4e2]/60 mb-2">Łącznie</div>
          <div className="text-3xl font-light text-[#e5e4e2]">{stock.total_quantity}</div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
          <div className="text-sm text-[#e5e4e2]/60 mb-2">Na firmie</div>
          <div className="text-3xl font-light text-[#d3bb73]">
            {units.filter(u => ['available', 'damaged', 'in_service'].includes(u.status)).length}
          </div>
          <div className="text-xs text-[#e5e4e2]/40 mt-1">z zakładki Jednostki</div>
        </div>

        <div className="bg-[#1c1f33] border border-green-500/10 rounded-xl p-6">
          <div className="text-sm text-[#e5e4e2]/60 mb-2">Dostępne</div>
          <div className="text-3xl font-light text-green-400">{stock.available_quantity}</div>
        </div>

        <div className="bg-[#1c1f33] border border-blue-500/10 rounded-xl p-6">
          <div className="text-sm text-[#e5e4e2]/60 mb-2">W użyciu</div>
          <div className="text-3xl font-light text-blue-400">{stock.in_use_quantity}</div>
        </div>

        <div className="bg-[#1c1f33] border border-yellow-500/10 rounded-xl p-6">
          <div className="text-sm text-[#e5e4e2]/60 mb-2">Zarezerwowane</div>
          <div className="text-3xl font-light text-yellow-400">{stock.reserved_quantity}</div>
        </div>

        <div className="bg-[#1c1f33] border border-red-500/10 rounded-xl p-6">
          <div className="text-sm text-[#e5e4e2]/60 mb-2">Uszkodzone</div>
          <div className="text-3xl font-light text-red-400">{stock.damaged_quantity}</div>
        </div>

        <div className="bg-[#1c1f33] border border-orange-500/10 rounded-xl p-6">
          <div className="text-sm text-[#e5e4e2]/60 mb-2">W serwisie</div>
          <div className="text-3xl font-light text-orange-400">{stock.in_service_quantity}</div>
        </div>
      </div>

      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-[#e5e4e2] font-medium">Ustawienia magazynu</h4>
          {editingStock ? (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditingStock(false);
                  setStockEdit({
                    storage_location: stock.storage_location || '',
                    min_stock_level: stock.min_stock_level || 0,
                  });
                }}
                className="text-sm text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveStockSettings}
                className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
              >
                Zapisz
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingStock(true)}
              className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
            >
              Edytuj
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="text-sm text-[#e5e4e2]/60 mb-1">Lokalizacja</div>
            {editingStock ? (
              <input
                type="text"
                value={stockEdit.storage_location}
                onChange={(e) => setStockEdit(prev => ({ ...prev, storage_location: e.target.value }))}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="np. Regał A, Półka 3"
              />
            ) : (
              <div className="text-[#e5e4e2]">{stock.storage_location || '-'}</div>
            )}
          </div>
          <div>
            <div className="text-sm text-[#e5e4e2]/60 mb-1">Minimalny poziom</div>
            {editingStock ? (
              <input
                type="number"
                value={stockEdit.min_stock_level}
                onChange={(e) => setStockEdit(prev => ({ ...prev, min_stock_level: parseInt(e.target.value) || 0 }))}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                min="0"
              />
            ) : (
              <div className="text-[#e5e4e2]">{stock.min_stock_level}</div>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-md w-full p-6">
            <h3 className="text-xl font-light text-[#e5e4e2] mb-4">Zmień stan magazynowy</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Typ zmiany</label>
                <select
                  value={changeType}
                  onChange={(e) => setChangeType(e.target.value)}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                >
                  <option value="add">Dodaj do magazynu</option>
                  <option value="remove">Usuń z magazynu</option>
                  <option value="rent">Wypożycz</option>
                  <option value="return">Zwrot</option>
                  <option value="damage">Uszkodzenie</option>
                  <option value="repair">Naprawa</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Ilość</label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="0"
                  min="1"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Notatka</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="Opcjonalna notatka..."
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
              >
                Anuluj
              </button>
              <button
                onClick={handleStockChange}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
              >
                {saving ? 'Zapisywanie...' : 'Zapisz'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UnitsTab({ equipment, units, onUpdate, canEdit }: any) {
  const isCable = equipment?.equipment_categories?.name?.toLowerCase().includes('przewod');
  const [showModal, setShowModal] = useState(false);
  const [editingQuantity, setEditingQuantity] = useState(false);
  const [newQuantity, setNewQuantity] = useState(units.length);
  const [editingUnit, setEditingUnit] = useState<EquipmentUnit | null>(null);
  const [unitForm, setUnitForm] = useState({
    unit_serial_number: '',
    status: 'available' as const,
    location_id: '',
    condition_notes: '',
    purchase_date: '',
    last_service_date: '',
    estimated_repair_date: '',
    thumbnail_url: '',
  });
  const [saving, setSaving] = useState(false);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [locations, setLocations] = useState<any[]>([]);

  const [showEventModal, setShowEventModal] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<EquipmentUnit | null>(null);
  const [unitEvents, setUnitEvents] = useState<UnitEvent[]>([]);
  const [showEventsHistory, setShowEventsHistory] = useState(false);

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    const { data } = await supabase
      .from('storage_locations')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (data) setLocations(data);
  };

  const statusColors: Record<string, string> = {
    available: 'text-green-400 bg-green-500/10',
    damaged: 'text-red-400 bg-red-500/10',
    in_service: 'text-orange-400 bg-orange-500/10',
    retired: 'text-gray-400 bg-gray-500/10',
  };

  const statusLabels: Record<string, string> = {
    available: 'Dostępny',
    damaged: 'Uszkodzony',
    in_service: 'Serwis',
    retired: 'Wycofany',
  };

  const handleOpenModal = (unit?: EquipmentUnit) => {
    if (unit) {
      setEditingUnit(unit);
      setUnitForm({
        unit_serial_number: unit.unit_serial_number || '',
        status: unit.status,
        location_id: unit.location_id || '',
        condition_notes: unit.condition_notes || '',
        purchase_date: unit.purchase_date || '',
        last_service_date: unit.last_service_date || '',
        estimated_repair_date: unit.estimated_repair_date || '',
        thumbnail_url: unit.thumbnail_url || '',
      });
    } else {
      setEditingUnit(null);
      setUnitForm({
        unit_serial_number: '',
        status: 'available',
        location_id: '',
        condition_notes: '',
        purchase_date: '',
        last_service_date: '',
        estimated_repair_date: '',
        thumbnail_url: '',
      });
    }
    setShowModal(true);
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingThumb(true);
    try {
      const url = await uploadImage(file, 'equipment-units');
      setUnitForm(prev => ({ ...prev, thumbnail_url: url }));
    } catch (error) {
      console.error('Error uploading thumbnail:', error);
      alert('Błąd podczas przesyłania zdjęcia');
    } finally {
      setUploadingThumb(false);
    }
  };

  const handleSaveUnit = async () => {
    setSaving(true);
    try {
      if (editingUnit) {
        const { error } = await supabase
          .from('equipment_units')
          .update({
            unit_serial_number: unitForm.unit_serial_number || null,
            status: unitForm.status,
            location_id: unitForm.location_id || null,
            condition_notes: unitForm.condition_notes || null,
            purchase_date: unitForm.purchase_date || null,
            last_service_date: unitForm.last_service_date || null,
            estimated_repair_date: unitForm.estimated_repair_date || null,
            thumbnail_url: unitForm.thumbnail_url || null,
          })
          .eq('id', editingUnit.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('equipment_units')
          .insert({
            equipment_id: equipment.id,
            unit_serial_number: unitForm.unit_serial_number || null,
            status: unitForm.status,
            location_id: unitForm.location_id || null,
            condition_notes: unitForm.condition_notes || null,
            purchase_date: unitForm.purchase_date || null,
            last_service_date: unitForm.last_service_date || null,
            estimated_repair_date: unitForm.estimated_repair_date || null,
            thumbnail_url: unitForm.thumbnail_url || null,
          });

        if (error) throw error;
      }

      setShowModal(false);
      onUpdate();
    } catch (error) {
      console.error('Error saving unit:', error);
      alert('Błąd podczas zapisywania jednostki');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUnit = async (unitId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę jednostkę?')) return;

    try {
      const { error } = await supabase
        .from('equipment_units')
        .delete()
        .eq('id', unitId);

      if (error) throw error;
      onUpdate();
    } catch (error) {
      console.error('Error deleting unit:', error);
      alert('Błąd podczas usuwania jednostki');
    }
  };

  const handleDuplicateUnit = async (unit: EquipmentUnit) => {
    if (!confirm('Czy na pewno chcesz zduplikować tę jednostkę?')) return;

    try {
      const newSerialNumber = unit.unit_serial_number ? `${unit.unit_serial_number} (duplikat)` : null;

      const { error } = await supabase
        .from('equipment_units')
        .insert({
          equipment_id: unit.equipment_id,
          unit_serial_number: newSerialNumber,
          status: unit.status,
          location_id: unit.location_id,
          condition_notes: unit.condition_notes ? `${unit.condition_notes} [DUPLIKAT]` : 'Duplikat jednostki',
          purchase_date: unit.purchase_date,
          last_service_date: unit.last_service_date,
          estimated_repair_date: unit.estimated_repair_date,
          thumbnail_url: unit.thumbnail_url,
        });

      if (error) throw error;
      onUpdate();
      alert('Jednostka została zduplikowana');
    } catch (error) {
      console.error('Error duplicating unit:', error);
      alert('Błąd podczas duplikowania jednostki');
    }
  };

  const fetchUnitEvents = async (unitId: string) => {
    const { data, error } = await supabase
      .from('equipment_unit_events')
      .select(`
        *,
        employees(name, surname)
      `)
      .eq('unit_id', unitId)
      .order('created_at', { ascending: false });

    if (data) setUnitEvents(data);
  };

  const handleShowEvents = async (unit: EquipmentUnit) => {
    setSelectedUnit(unit);
    await fetchUnitEvents(unit.id);
    setShowEventsHistory(true);
  };

  const groupedUnits = {
    available: units.filter((u: EquipmentUnit) => u.status === 'available'),
    damaged: units.filter((u: EquipmentUnit) => u.status === 'damaged'),
    in_service: units.filter((u: EquipmentUnit) => u.status === 'in_service'),
    retired: units.filter((u: EquipmentUnit) => u.status === 'retired'),
  };

  const handleUpdateCableQuantity = async () => {
    const currentCount = units.length;
    const diff = newQuantity - currentCount;

    try {
      if (diff > 0) {
        const unitsToAdd = Array.from({ length: diff }, () => ({
          equipment_id: equipment.id,
          status: 'available',
        }));
        await supabase.from('equipment_units').insert(unitsToAdd);
      } else if (diff < 0) {
        const unitsToRemove = units.slice(0, Math.abs(diff));
        await supabase.from('equipment_units').delete().in('id', unitsToRemove.map((u: any) => u.id));
      }
      setEditingQuantity(false);
      onUpdate();
    } catch (error) {
      console.error('Error updating cable quantity:', error);
      alert('Błąd podczas aktualizacji ilości');
    }
  };

  if (isCable) {
    return (
      <div className="space-y-6">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-8">
          <div className="text-center">
            {editingQuantity ? (
              <div className="flex items-center justify-center gap-4 mb-4">
                <input
                  type="number"
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(parseInt(e.target.value) || 0)}
                  className="w-32 text-center text-4xl font-light bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg px-4 py-2 text-[#d3bb73] focus:outline-none focus:border-[#d3bb73]"
                  min="0"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleUpdateCableQuantity}
                    className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                  >
                    Zapisz
                  </button>
                  <button
                    onClick={() => {
                      setEditingQuantity(false);
                      setNewQuantity(units.length);
                    }}
                    className="px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
                  >
                    Anuluj
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => canEdit && setEditingQuantity(true)}
                className={`text-6xl font-light text-[#d3bb73] mb-4 transition-colors ${canEdit ? 'cursor-pointer hover:text-[#d3bb73]/80' : 'cursor-default'}`}
                title={canEdit ? "Kliknij aby edytować" : "Tylko administrator może edytować"}
              >
                {units.length}
              </div>
            )}
            <div className="text-lg text-[#e5e4e2]/60 mb-2">Liczba jednostek</div>
            <p className="text-sm text-[#e5e4e2]/40 max-w-md mx-auto">
              {editingQuantity ? 'Wprowadź nową liczbę przewodów' : (canEdit ? 'Kliknij na liczbę aby ją edytować' : 'Tylko odczyt')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Zarządzanie jednostkami</h3>
        {canEdit && (
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Dodaj jednostkę
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[#1c1f33] border border-green-500/10 rounded-xl p-4">
          <div className="text-sm text-[#e5e4e2]/60 mb-1">Dostępne</div>
          <div className="text-2xl font-light text-green-400">{groupedUnits.available.length}</div>
        </div>
        <div className="bg-[#1c1f33] border border-red-500/10 rounded-xl p-4">
          <div className="text-sm text-[#e5e4e2]/60 mb-1">Uszkodzone</div>
          <div className="text-2xl font-light text-red-400">{groupedUnits.damaged.length}</div>
        </div>
        <div className="bg-[#1c1f33] border border-orange-500/10 rounded-xl p-4">
          <div className="text-sm text-[#e5e4e2]/60 mb-1">Serwis</div>
          <div className="text-2xl font-light text-orange-400">{groupedUnits.in_service.length}</div>
        </div>
        <div className="bg-[#1c1f33] border border-gray-500/10 rounded-xl p-4">
          <div className="text-sm text-[#e5e4e2]/60 mb-1">Wycofane</div>
          <div className="text-2xl font-light text-gray-400">{groupedUnits.retired.length}</div>
        </div>
      </div>

      {units.length === 0 ? (
        <div className="text-center py-12 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
          <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60 mb-2">Brak jednostek</p>
          <p className="text-sm text-[#e5e4e2]/40">Dodaj pierwszą jednostkę sprzętu</p>
        </div>
      ) : (
        <div className="space-y-3">
          {units.map((unit: EquipmentUnit) => {
            const isUnavailable = unit.status === 'damaged' || unit.status === 'in_service';
            return (
            <div
              key={unit.id}
              className={`bg-[#1c1f33] border rounded-xl p-4 ${
                isUnavailable
                  ? 'border-red-500/20 opacity-60'
                  : 'border-[#d3bb73]/10'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                {unit.thumbnail_url && (
                  <img
                    src={unit.thumbnail_url}
                    alt="Miniaturka"
                    className="w-20 h-20 object-cover rounded-lg border border-[#d3bb73]/20"
                  />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    {unit.unit_serial_number && (
                      <span className="font-mono text-[#e5e4e2] font-medium">
                        SN: {unit.unit_serial_number}
                      </span>
                    )}
                    {!unit.unit_serial_number && (
                      <span className="text-[#e5e4e2]/60 italic">Bez numeru seryjnego</span>
                    )}
                    <span className={`px-2 py-1 rounded text-xs ${statusColors[unit.status]}`}>
                      {statusLabels[unit.status]}
                    </span>
                    {isUnavailable && (
                      <span className="px-2 py-1 rounded text-xs bg-red-500/20 text-red-300 border border-red-500/30">
                        Niedostępny
                      </span>
                    )}
                    {unit.estimated_repair_date && isUnavailable && (
                      <span className="text-xs text-[#e5e4e2]/60">
                        Szac. dostępność: {new Date(unit.estimated_repair_date).toLocaleDateString('pl-PL')}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    {unit.storage_locations && (
                      <div>
                        <span className="text-[#e5e4e2]/60">Lokalizacja:</span>{' '}
                        <span className="text-[#e5e4e2]">{unit.storage_locations.name}</span>
                      </div>
                    )}
                    {unit.purchase_date && (
                      <div>
                        <span className="text-[#e5e4e2]/60">Zakup:</span>{' '}
                        <span className="text-[#e5e4e2]">
                          {new Date(unit.purchase_date).toLocaleDateString('pl-PL')}
                        </span>
                      </div>
                    )}
                    {unit.last_service_date && (
                      <div>
                        <span className="text-[#e5e4e2]/60">Ostatni serwis:</span>{' '}
                        <span className="text-[#e5e4e2]">
                          {new Date(unit.last_service_date).toLocaleDateString('pl-PL')}
                        </span>
                      </div>
                    )}
                  </div>

                  {unit.condition_notes && (
                    <div className="mt-2 text-sm text-[#e5e4e2]/60">
                      <span className="font-medium">Notatki:</span> {unit.condition_notes}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleShowEvents(unit)}
                    className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                    title="Historia zdarzeń"
                  >
                    <History className="w-4 h-4" />
                  </button>
                  {canEdit && (
                    <>
                      <button
                        onClick={() => handleDuplicateUnit(unit)}
                        className="p-2 text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors"
                        title="Duplikuj jednostkę"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleOpenModal(unit)}
                        className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteUnit(unit.id)}
                        className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-light text-[#e5e4e2] mb-4">
              {editingUnit ? 'Edytuj jednostkę' : 'Dodaj nową jednostkę'}
            </h3>

            <div className="space-y-4">
              {unitForm.thumbnail_url && (
                <div className="relative w-32 h-32 mx-auto">
                  <img
                    src={unitForm.thumbnail_url}
                    alt="Miniaturka"
                    className="w-full h-full object-cover rounded-lg border border-[#d3bb73]/20"
                  />
                  <button
                    onClick={() => setUnitForm(prev => ({ ...prev, thumbnail_url: '' }))}
                    className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Miniaturka (opcjonalne)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleThumbnailUpload}
                  disabled={uploadingThumb}
                  className="hidden"
                  id="unit-thumbnail-upload"
                />
                <label
                  htmlFor="unit-thumbnail-upload"
                  className={`flex items-center justify-center gap-2 w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] cursor-pointer hover:border-[#d3bb73]/30 transition-colors ${uploadingThumb ? 'opacity-50' : ''}`}
                >
                  <Upload className="w-4 h-4" />
                  {uploadingThumb ? 'Przesyłanie...' : unitForm.thumbnail_url ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                    Numer seryjny (opcjonalny)
                  </label>
                  <input
                    type="text"
                    value={unitForm.unit_serial_number}
                    onChange={(e) => setUnitForm(prev => ({ ...prev, unit_serial_number: e.target.value }))}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                    placeholder="np. SN123456"
                  />
                  <p className="text-xs text-[#e5e4e2]/40 mt-1">
                    Pozostaw puste dla sprzętu bez numeru seryjnego
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Status</label>
                  <select
                    value={unitForm.status}
                    onChange={(e) => setUnitForm(prev => ({ ...prev, status: e.target.value as any }))}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  >
                    <option value="available">Dostępny</option>
                    <option value="damaged">Uszkodzony</option>
                    <option value="in_service">Serwis</option>
                    <option value="retired">Wycofany</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Lokalizacja</label>
                  <select
                    value={unitForm.location_id}
                    onChange={(e) => setUnitForm(prev => ({ ...prev, location_id: e.target.value }))}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  >
                    <option value="">Brak lokalizacji</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Data zakupu</label>
                  <input
                    type="date"
                    value={unitForm.purchase_date}
                    onChange={(e) => setUnitForm(prev => ({ ...prev, purchase_date: e.target.value }))}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Ostatni serwis</label>
                  <input
                    type="date"
                    value={unitForm.last_service_date}
                    onChange={(e) => setUnitForm(prev => ({ ...prev, last_service_date: e.target.value }))}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                    Szacowana dostępność
                  </label>
                  <input
                    type="date"
                    value={unitForm.estimated_repair_date}
                    onChange={(e) => setUnitForm(prev => ({ ...prev, estimated_repair_date: e.target.value }))}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                    disabled={unitForm.status !== 'damaged' && unitForm.status !== 'in_service'}
                  />
                  <p className="text-xs text-[#e5e4e2]/40 mt-1">
                    Dla jednostek uszkodzonych lub w serwisie
                  </p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Notatki o stanie</label>
                  <textarea
                    value={unitForm.condition_notes}
                    onChange={(e) => setUnitForm(prev => ({ ...prev, condition_notes: e.target.value }))}
                    rows={3}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                    placeholder="Notatki o stanie technicznym, usterki, naprawy..."
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveUnit}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
              >
                {saving ? 'Zapisywanie...' : 'Zapisz'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEventsHistory && selectedUnit && (
        <UnitEventsModal
          unit={selectedUnit}
          events={unitEvents}
          onClose={() => {
            setShowEventsHistory(false);
            onUpdate();
          }}
          onUpdate={() => {
            fetchUnitEvents(selectedUnit.id);
            onUpdate();
          }}
        />
      )}
    </div>
  );
}

function UnitEventsModal({ unit, events, onClose, onUpdate }: any) {
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [eventForm, setEventForm] = useState({
    event_type: 'note' as const,
    description: '',
    image_url: '',
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const eventTypeLabels: Record<string, string> = {
    damage: 'Uszkodzenie',
    repair: 'Naprawa',
    service: 'Serwis',
    status_change: 'Zmiana statusu',
    note: 'Notatka',
    inspection: 'Inspekcja',
    sold: 'Sprzedaż',
  };

  const eventTypeColors: Record<string, string> = {
    damage: 'text-red-400',
    repair: 'text-green-400',
    service: 'text-orange-400',
    status_change: 'text-blue-400',
    note: 'text-[#d3bb73]',
    inspection: 'text-purple-400',
    sold: 'text-pink-400',
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const url = await uploadImage(file, 'equipment-events');
      setEventForm(prev => ({ ...prev, image_url: url }));
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Błąd podczas przesyłania zdjęcia');
    } finally {
      setUploading(false);
    }
  };

  const handleAddEvent = async () => {
    if (!eventForm.description.trim()) {
      alert('Wprowadź opis zdarzenia');
      return;
    }

    if (eventForm.event_type === 'sold') {
      if (!confirm('Czy na pewno chcesz oznaczyć tę jednostkę jako sprzedaną? Jednostka zostanie usunięta z systemu.')) {
        return;
      }
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error: eventError } = await supabase
        .from('equipment_unit_events')
        .insert({
          unit_id: unit.id,
          event_type: eventForm.event_type,
          description: eventForm.description,
          image_url: eventForm.image_url || null,
          employee_id: user?.id || null,
        });

      if (eventError) throw eventError;

      if (eventForm.event_type === 'damage') {
        const { error: updateError } = await supabase
          .from('equipment_units')
          .update({
            status: 'damaged',
          })
          .eq('id', unit.id);

        if (updateError) throw updateError;
        alert('Status jednostki został zmieniony na "Uszkodzony"');
      }

      if (eventForm.event_type === 'repair' || eventForm.event_type === 'service') {
        const updateData: any = {
          last_service_date: new Date().toISOString().split('T')[0],
        };

        if (eventForm.event_type === 'repair') {
          updateData.status = 'available';
          updateData.estimated_repair_date = null;
        }

        const { error: updateError } = await supabase
          .from('equipment_units')
          .update(updateData)
          .eq('id', unit.id);

        if (updateError) throw updateError;

        if (eventForm.event_type === 'repair') {
          alert('Jednostka została naprawiona i jest znowu dostępna!');
        } else {
          alert('Data ostatniego serwisu została zaktualizowana!');
        }
      }

      if (eventForm.event_type === 'sold') {
        const { error: deleteError } = await supabase
          .from('equipment_units')
          .delete()
          .eq('id', unit.id);

        if (deleteError) throw deleteError;
        alert('Jednostka została usunięta z systemu jako sprzedana.');
        onClose();
        window.location.reload();
        return;
      }

      setEventForm({
        event_type: 'note',
        description: '',
        image_url: '',
      });
      setShowAddEvent(false);
      onUpdate();
    } catch (error) {
      console.error('Error adding event:', error);
      alert('Błąd podczas dodawania zdarzenia');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-[#d3bb73]/10 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-light text-[#e5e4e2] mb-1">Historia zdarzeń</h3>
            <p className="text-sm text-[#e5e4e2]/60">
              {unit.unit_serial_number ? `SN: ${unit.unit_serial_number}` : 'Bez numeru seryjnego'}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-[#e5e4e2]/40">Aktualny status:</span>
              <span className={`px-2 py-1 rounded text-xs ${
                unit.status === 'available' ? 'bg-green-500/20 text-green-400' :
                unit.status === 'damaged' ? 'bg-red-500/20 text-red-400' :
                unit.status === 'in_service' ? 'bg-orange-500/20 text-orange-400' :
                'bg-gray-500/20 text-gray-400'
              }`}>
                {unit.status === 'available' ? 'Dostępny' :
                 unit.status === 'damaged' ? 'Uszkodzony' :
                 unit.status === 'in_service' ? 'Serwis' :
                 'Wycofany'}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddEvent(!showAddEvent)}
              className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Dodaj zdarzenie
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[#e5e4e2]/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[#e5e4e2]" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {showAddEvent && (
            <div className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-xl p-4 mb-6">
              <h4 className="text-[#e5e4e2] font-medium mb-4">Nowe zdarzenie</h4>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">Typ zdarzenia</label>
                    <select
                      value={eventForm.event_type}
                      onChange={(e) => setEventForm(prev => ({ ...prev, event_type: e.target.value as any }))}
                      className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                    >
                      <option value="note">Notatka</option>
                      <option value="damage">Uszkodzenie (zmienia status)</option>
                      <option value="repair">Naprawa (anuluje uszkodzenie)</option>
                      <option value="service">Serwis</option>
                      <option value="inspection">Inspekcja</option>
                      <option value="sold">Sprzedaż (usuwa jednostkę)</option>
                    </select>
                    {eventForm.event_type === 'damage' && (
                      <p className="text-xs text-red-400 mt-1">
                        Status zostanie zmieniony na "Uszkodzony"
                      </p>
                    )}
                    {eventForm.event_type === 'repair' && (
                      <p className="text-xs text-green-400 mt-1">
                        Status zostanie zmieniony na "Dostępny"
                      </p>
                    )}
                    {eventForm.event_type === 'sold' && (
                      <p className="text-xs text-red-400 mt-1">
                        UWAGA: Jednostka zostanie całkowicie usunięta z systemu!
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">Zdjęcie (opcjonalne)</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      disabled={uploading}
                      className="hidden"
                      id="event-image-upload"
                    />
                    <label
                      htmlFor="event-image-upload"
                      className={`flex items-center justify-center gap-2 w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] cursor-pointer hover:border-[#d3bb73]/30 transition-colors ${uploading ? 'opacity-50' : ''}`}
                    >
                      <Upload className="w-4 h-4" />
                      {uploading ? 'Przesyłanie...' : eventForm.image_url ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
                    </label>
                  </div>
                </div>

                {eventForm.image_url && (
                  <div className="relative">
                    <img
                      src={eventForm.image_url}
                      alt="Preview"
                      className="w-full max-h-48 object-contain rounded-lg"
                    />
                    <button
                      onClick={() => setEventForm(prev => ({ ...prev, image_url: '' }))}
                      className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-lg hover:bg-red-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis zdarzenia</label>
                  <textarea
                    value={eventForm.description}
                    onChange={(e) => setEventForm(prev => ({ ...prev, description: e.target.value }))}
                    rows={4}
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                    placeholder="Opisz szczegóły zdarzenia..."
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAddEvent(false)}
                    className="flex-1 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
                  >
                    Anuluj
                  </button>
                  <button
                    onClick={handleAddEvent}
                    disabled={saving}
                    className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Zapisywanie...' : 'Dodaj'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {events.length === 0 ? (
            <div className="text-center py-12">
              <History className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
              <p className="text-[#e5e4e2]/60">Brak zdarzeń</p>
            </div>
          ) : (
            <div className="space-y-4">
              {events.map((event: UnitEvent) => (
                <div
                  key={event.id}
                  className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-xl p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={`font-medium ${eventTypeColors[event.event_type]}`}>
                        {eventTypeLabels[event.event_type]}
                      </span>
                      <span className="text-xs text-[#e5e4e2]/40">
                        {new Date(event.created_at).toLocaleString('pl-PL')}
                      </span>
                      {event.employees && (
                        <span className="text-xs text-[#e5e4e2]/60">
                          • Zgłosił: {event.employees.name} {event.employees.surname}
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-[#e5e4e2] mb-2">{event.description}</p>

                  {event.old_status && event.new_status && (
                    <div className="text-sm text-[#e5e4e2]/60">
                      Status: {event.old_status} → {event.new_status}
                    </div>
                  )}

                  {event.image_url && (
                    <img
                      src={event.image_url}
                      alt="Zdjęcie zdarzenia"
                      className="mt-3 w-full max-h-64 object-contain rounded-lg border border-[#d3bb73]/10"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryTab({ history }: { history: any[] }) {
  const getEventTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      created: 'Utworzono',
      status_change: 'Zmiana statusu',
      location_change: 'Zmiana lokalizacji',
      maintenance: 'Konserwacja',
      repair: 'Naprawa',
      damage: 'Uszkodzenie',
      sold: 'Sprzedano',
      rented: 'Wypożyczono',
      returned: 'Zwrócono',
    };
    return labels[type] || type;
  };

  const getEventTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      created: 'text-green-400',
      maintenance: 'text-blue-400',
      repair: 'text-yellow-400',
      damage: 'text-red-400',
      sold: 'text-purple-400',
      rented: 'text-cyan-400',
      returned: 'text-green-400',
      status_change: 'text-blue-400',
      location_change: 'text-blue-400',
    };
    return colors[type] || 'text-[#e5e4e2]';
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      available: 'Dostępny',
      in_use: 'W użyciu',
      maintenance: 'Konserwacja',
      repair: 'Naprawa',
      damaged: 'Uszkodzony',
      sold: 'Sprzedany',
      rented: 'Wypożyczony',
    };
    return labels[status] || status;
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium text-[#e5e4e2]">Historia zdarzeń</h3>

      {history.length === 0 ? (
        <div className="text-center py-12 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
          <History className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">Brak historii zdarzeń</p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((event) => (
            <div
              key={event.id}
              className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`font-medium ${getEventTypeColor(event.event_type)}`}>
                      {getEventTypeLabel(event.event_type)}
                    </span>
                    {event.equipment_units && (
                      <span className="text-[#e5e4e2]/60 text-sm">
                        {event.equipment_units.unit_serial_number || event.equipment_units.internal_id}
                      </span>
                    )}
                  </div>
                  {event.new_status && (
                    <div className="text-sm text-[#e5e4e2]/60 mb-1">
                      Status: {getStatusLabel(event.new_status)}
                    </div>
                  )}
                  {event.notes && (
                    <div className="text-sm text-[#e5e4e2]/60 mb-1">{event.notes}</div>
                  )}
                  <div className="text-xs text-[#e5e4e2]/40">
                    {new Date(event.event_date).toLocaleString('pl-PL')}
                    {event.employees && (
                      <span> • {event.employees.name} {event.employees.surname}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddConnectorModal({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [commonUses, setCommonUses] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingThumbnail(true);
    try {
      const url = await uploadImage(file, 'connector-thumbnails');
      setThumbnailUrl(url);
    } catch (error) {
      console.error('Error uploading thumbnail:', error);
      alert('Błąd podczas wgrywania zdjęcia');
    } finally {
      setUploadingThumbnail(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('connector_types')
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          common_uses: commonUses.trim() || null,
          thumbnail_url: thumbnailUrl || null,
          is_active: true,
        });

      if (error) throw error;

      onAdd(name.trim());
      onClose();
    } catch (error) {
      console.error('Error adding connector:', error);
      alert('Błąd podczas dodawania wtyczki');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-md w-full">
        <div className="p-6 border-b border-[#d3bb73]/10">
          <h3 className="text-xl font-light text-[#e5e4e2]">Dodaj nowy wtyk</h3>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa wtyczki *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. XLR Male"
              className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis (opcjonalnie)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="np. Wtyk XLR męski, 3-pinowy"
              className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Typowe zastosowania (opcjonalnie)</label>
            <textarea
              value={commonUses}
              onChange={(e) => setCommonUses(e.target.value)}
              placeholder="np. Mikrofony, sygnały audio balanced, DMX"
              rows={3}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Zdjęcie wtyczki (opcjonalnie)</label>
            <div className="flex gap-4 items-start">
              {thumbnailUrl && (
                <div className="w-20 h-20 rounded-lg overflow-hidden bg-[#0f1119] border border-[#d3bb73]/10">
                  <img src={thumbnailUrl} alt="Miniaturka" className="w-full h-full object-cover" />
                </div>
              )}
              <label className="flex-1 cursor-pointer">
                <div className="border-2 border-dashed border-[#d3bb73]/20 rounded-lg p-4 text-center hover:border-[#d3bb73]/40 transition-colors">
                  <Upload className="w-6 h-6 text-[#e5e4e2]/40 mx-auto mb-2" />
                  <div className="text-sm text-[#e5e4e2]/60">
                    {uploadingThumbnail ? 'Wgrywanie...' : 'Kliknij aby dodać zdjęcie'}
                  </div>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleThumbnailUpload}
                  className="hidden"
                  disabled={uploadingThumbnail}
                />
              </label>
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="px-6 py-2.5 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Dodawanie...' : 'Dodaj wtyk'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConnectorPreviewModal({ connector, onClose, onEdit }: { connector: any; onClose: () => void; onEdit: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-[#d3bb73]/10 flex justify-between items-center">
          <h3 className="text-xl font-light text-[#e5e4e2]">{connector.name}</h3>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {connector.thumbnail_url && (
            <div className="w-full aspect-video rounded-lg overflow-hidden bg-[#0f1119] border border-[#d3bb73]/10">
              <img
                src={connector.thumbnail_url}
                alt={connector.name}
                className="w-full h-full object-contain"
              />
            </div>
          )}

          {connector.description && (
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
              <p className="text-[#e5e4e2]">{connector.description}</p>
            </div>
          )}

          {connector.common_uses && (
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Typowe zastosowania</label>
              <p className="text-[#e5e4e2]/80">{connector.common_uses}</p>
            </div>
          )}

          {!connector.description && !connector.common_uses && !connector.thumbnail_url && (
            <div className="text-center text-[#e5e4e2]/40 py-8">
              Brak dodatkowych informacji o tym wtyku
            </div>
          )}
        </div>

        <div className="p-6 border-t border-[#d3bb73]/10 flex gap-3 justify-end">
          <button
            onClick={onEdit}
            className="px-6 py-2.5 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
          >
            Edytuj wtyk
          </button>
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
