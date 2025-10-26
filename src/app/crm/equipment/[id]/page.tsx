'use client';

import { useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, CreditCard as Edit, Save, X, Trash2, Package } from 'lucide-react';

import { uploadImage } from '@/lib/storage';
import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import EquipmentGallery from '@/components/crm/EquipmentGallery';

import {
  useGetEquipmentDetailsQuery,
  useGetUnitsByEquipmentQuery,
  useGetConnectorTypesQuery,
  useGetStorageLocationsQuery,
  useGetEquipmentCategoriesQuery,
  useUpdateEquipmentItemMutation,
} from '../store/equipmentApi';

import {
  softDeleteEquipmentItem,
  addEquipmentComponent,
  deleteEquipmentComponent,
  deleteEquipmentUnit,
  duplicateEquipmentUnit,
  fetchUnitEvents,
  logEquipmentEdit,
  upsertEquipmentUnit,
  addUnitEvent,
  setCableQuantity,
} from '@/store/slices/equipmentSlice';

import { useAppDispatch } from '@/store/hooks';
import { TabCarousel } from '../components/tabs/TabCarousel';
import { EquipmentTabsCarouselType } from '../types/equipment.types';
import { ComponentsTab } from '../components/tabs/ComponentsTab';
import { HistoryTab } from '../components/tabs/HistoryTab';
import { TechnicalTab } from '../components/tabs/TechnicalTab';
import { DetailsTab } from '../components/tabs/DetailsTab';
import { PurchaseTab } from '../components/tabs/PurchaseTab';
import { UnitsTab } from '../components/tabs/UnitTabs';

/* ----------------------------- helpers ----------------------------- */
const normalizeUuid = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() && v !== 'undefined' ? v : null;

const toFloat = (v: any): number | null => (v === '' || v == null ? null : parseFloat(v));
const toInt = (v: any): number | null => (v === '' || v == null ? null : parseInt(v, 10));

const removeUndefined = <T extends Record<string, any>>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, val]) => val !== undefined)) as T;

/** ======================================================================
 *  PAGE
 *  ====================================================================== */
export default function EquipmentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const equipmentId = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const dispatch = useAppDispatch();
  const { showConfirm } = useDialog();
  const { showSnackbar } = useSnackbar();
  const { canManageModule, currentEmployee } = useCurrentEmployee();
  const canEdit = canManageModule('equipment');

  // dictionaries
  const { data: warehouseCategories = [] } = useGetEquipmentCategoriesQuery();
  const { data: connectorTypes = [] } = useGetConnectorTypesQuery();
  const { data: storageLocations = [] } = useGetStorageLocationsQuery();

  // data
  const {
    data: equipment,
    isFetching: eqLoading,
    isError: eqError,
    refetch: refetchEquipment,
  } = useGetEquipmentDetailsQuery(equipmentId, { skip: !equipmentId });

  const {
    data: units = [],
    isFetching: unitsLoading,
    refetch: refetchUnits,
  } = useGetUnitsByEquipmentQuery(equipmentId, { skip: !equipmentId });

  // RTK Query mutation
  const [updateEquipmentMutation] = useUpdateEquipmentItemMutation();

  const loading = eqLoading || unitsLoading;

  const unitsCount = equipment?.cable_specs ? equipment.cable_stock_quantity || 0 : units.length;
  const stock = useMemo(() => equipment?.equipment_stock?.[0] ?? null, [equipment]);
  const availableUnits = units.filter((u) => u.status === 'available').length;
  const totalUnits = units.length;

  // flags from the equipment’s category special_properties
  const categoryFlags: Record<string, boolean> = useMemo(() => {
    const props = equipment?.warehouse_categories?.special_properties ?? [];
    return Object.fromEntries((props as { name: string; value: boolean }[]).map((p) => [p.name, !!p.value]));
  }, [equipment?.warehouse_categories?.special_properties]);

  // ui state
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<EquipmentTabsCarouselType>('details');

  // edit form
  const [editForm, setEditForm] = useState<any>({});
  const handleEdit = () => {
    if (!equipment) return;
    setEditForm({
      ...equipment,
      dimensions_length: equipment?.dimensions_cm?.length ?? '',
      dimensions_width: equipment?.dimensions_cm?.width ?? '',
      dimensions_height: equipment?.dimensions_cm?.height ?? '',
      cable_length_meters: equipment?.cable_specs?.length_meters ?? '',
      cable_connector_in: equipment?.cable_specs?.connector_in ?? '',
      cable_connector_out: equipment?.cable_specs?.connector_out ?? '',
      warehouse_category_id: equipment?.warehouse_category_id ?? '',
      storage_location_id: equipment?.storage_location_id ?? '',
    });
    setIsEditing(true);
  };
  const handleCancelEdit = () => setIsEditing(false);

  // audit log
  const logChange = async (fieldName: string, oldValue: any, newValue: any) => {
    if (!currentEmployee) return;
    if (oldValue === newValue) return;
    await dispatch(
      logEquipmentEdit({
        equipment_id: equipmentId,
        employee_id: currentEmployee.id,
        field_name: fieldName,
        old_value: oldValue != null ? String(oldValue) : null,
        new_value: newValue != null ? String(newValue) : null,
        change_type: 'update',
      })
    );
  };

  // save
  const handleSave = async () => {
    if (!equipment) return;
    setSaving(true);
    try {
      const dimensions =
        editForm.dimensions_length || editForm.dimensions_width || editForm.dimensions_height
          ? {
              length: toFloat(editForm.dimensions_length),
              width: toFloat(editForm.dimensions_width),
              height: toFloat(editForm.dimensions_height),
            }
          : null;

      const cableSpecs =
        editForm.cable_length_meters || editForm.cable_connector_in || editForm.cable_connector_out
          ? {
              length_meters: toFloat(editForm.cable_length_meters),
              connector_in: editForm.cable_connector_in || null,
              connector_out: editForm.cable_connector_out || null,
            }
          : null;

      const payload = removeUndefined({
        name: editForm.name,
        warehouse_category_id: normalizeUuid(editForm.warehouse_category_id),
        storage_location_id: normalizeUuid(editForm.storage_location_id),
        brand: editForm.brand || null,
        model: editForm.model || null,
        description: editForm.description || null,
        thumbnail_url: editForm.thumbnail_url || null,
        user_manual_url: editForm.user_manual_url || null,
        weight_kg: toFloat(editForm.weight_kg),
        cable_specs: cableSpecs,
        cable_stock_quantity: toInt(editForm.cable_stock_quantity),
        dimensions_cm: dimensions,
        purchase_date: editForm.purchase_date || null,
        purchase_price: toFloat(editForm.purchase_price),
        current_value: toFloat(editForm.current_value),
        warranty_until: editForm.warranty_until || null,
        serial_number: editForm.serial_number || null,
        barcode: editForm.barcode || null,
        notes: editForm.notes || null,
      });

      await updateEquipmentMutation({ id: equipmentId, payload }).unwrap();

      // basic log set
      const fieldsToLog = [
        { name: 'name', old: equipment?.name, new: editForm.name },
        { name: 'warehouse_category_id', old: equipment?.warehouse_category_id, new: normalizeUuid(editForm.warehouse_category_id) },
        { name: 'brand', old: equipment?.brand, new: editForm.brand },
        { name: 'model', old: equipment?.model, new: editForm.model },
        { name: 'description', old: equipment?.description, new: editForm.description },
        { name: 'weight_kg', old: equipment?.weight_kg, new: toFloat(editForm.weight_kg) },
        { name: 'purchase_date', old: equipment?.purchase_date, new: editForm.purchase_date },
        { name: 'purchase_price', old: equipment?.purchase_price, new: toFloat(editForm.purchase_price) },
        { name: 'serial_number', old: equipment?.serial_number, new: editForm.serial_number },
      ];
      for (const f of fieldsToLog) await logChange(f.name, f.old, f.new);

      setIsEditing(false);
      showSnackbar('Zmiany zostały zapisane', 'success');
    } catch (e: any) {
      console.error(e);
      showSnackbar('Błąd podczas zapisywania', 'error');
    } finally {
      setSaving(false);
    }
  };

  // delete
  const handleDelete = async () => {
    const confirmed = await showConfirm(
      `Czy na pewno chcesz usunąć sprzęt "${equipment?.name}"? Ta operacja jest nieodwracalna.`,
      'Usuń sprzęt'
    );
    if (!confirmed) return;

    try {
      await dispatch(softDeleteEquipmentItem({ equipmentId }));
      showSnackbar('Sprzęt został usunięty', 'success');
      router.push('/crm/equipment');
    } catch {
      showSnackbar('Błąd podczas usuwania sprzętu', 'error');
    }
  };

  // generic input change (always strings)
  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setEditForm((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    showSnackbar('Przesyłanie zdjęcia...', 'info');
    try {
      const url = await uploadImage(file, 'equipment-thumbnails');
      setEditForm((prev: any) => ({ ...prev, thumbnail_url: url }));
      showSnackbar('Zdjęcie zostało przesłane', 'success');
    } catch (err: any) {
      showSnackbar(err?.message || 'Błąd podczas przesyłania zdjęcia', 'error');
    }
  };

  const refreshAll = async () => {
    await Promise.all([refetchEquipment(), refetchUnits()]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#e5e4e2]/60">Ładowanie…</div>
      </div>
    );
  }
  if (eqError || !equipment) {
    return (
      <div className="text-center py-12">
        <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
        <p className="text-[#e5e4e2]/60">Nie znaleziono sprzętu</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors">
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
              { label: 'Usuń', onClick: handleDelete, icon: <Trash2 className="w-4 h-4" />, variant: 'danger' },
              { label: 'Anuluj', onClick: handleCancelEdit, icon: <X className="w-4 h-4" />, variant: 'default' },
              { label: saving ? 'Zapisywanie…' : 'Zapisz', onClick: handleSave, icon: <Save className="w-4 h-4" />, variant: 'primary' },
            ]}
          />
        ) : canEdit ? (
          <ResponsiveActionBar
            actions={[{ label: 'Edytuj', onClick: handleEdit, icon: <Edit className="w-4 h-4" />, variant: 'primary' }]}
          />
        ) : null}
      </div>

      {/* TABS */}
      <TabCarousel activeTab={activeTab} setActiveTab={setActiveTab} equipment={equipment} units={unitsCount} />

      {/* DETAILS */}
      {activeTab === 'details' && (
        <DetailsTab
          equipment={equipment}
          editForm={editForm}
          isEditing={isEditing}
          onInputChange={handleInputChange}
          onThumbnailUpload={handleThumbnailUpload}
          canEdit={canEdit}
          warehouseCategories={warehouseCategories}
          storageLocations={storageLocations}
        />
      )}

      {/* TECHNICAL */}
      {activeTab === 'technical' && (
        <TechnicalTab
          equipment={equipment}
          editForm={editForm}
          isEditing={isEditing}
          onInputChange={handleInputChange}
          connectorTypes={connectorTypes}
          warehouseCategories={warehouseCategories}
        />
      )}

      {/* PURCHASE */}
      {activeTab === 'purchase' && (
        <PurchaseTab
          equipment={equipment}
          editForm={editForm}
          isEditing={isEditing}
          onInputChange={handleInputChange}
        />
      )}

      {/* COMPONENTS */}
      {activeTab === 'components' && (
        <ComponentsTab
          equipment={equipment}
          isEditing={isEditing}
          onAdd={async (payload: any) => {
            await dispatch(addEquipmentComponent(payload));
            await refetchEquipment();
          }}
          onDelete={async (componentId: string) => {
            await dispatch(deleteEquipmentComponent({ componentId }));
            await refetchEquipment();
          }}
        />
      )}

      {/* UNITS */}
      {activeTab === 'units' && (
        <UnitsTab
          equipment={equipment}
          units={units}
          locations={storageLocations}
          canEdit={canEdit}
          // ✅ pass flags derived from current category special_properties
          customFlags={categoryFlags}
          onUpsertUnit={async (payload: any) => {
            await dispatch(upsertEquipmentUnit(payload));
            await refreshAll();
          }}
          onDeleteUnit={async (unitId: string) => {
            await dispatch(deleteEquipmentUnit(unitId));
            await refreshAll();
          }}
          onDuplicateUnit={async (unit: any) => {
            await dispatch(duplicateEquipmentUnit(unit));
            await refreshAll();
          }}
          onFetchUnitEvents={(unitId: string) => dispatch(fetchUnitEvents(unitId))}
          onAddUnitEvent={async (payload: any) => {
            await dispatch(addUnitEvent(payload));
            await refreshAll();
          }}
          onSetCableQuantity={async (q: number) => {
            await dispatch(setCableQuantity({ equipmentId, quantity: q }));
            await refreshAll();
          }}
          currentEmployee={currentEmployee}
          showSnackbar={showSnackbar}
        />
      )}

      {/* GALLERY */}
      {activeTab === 'gallery' && <EquipmentGallery equipmentId={equipment.id} canManage={canEdit} />}

      {/* HISTORY */}
      {activeTab === 'history' && <HistoryTab history={equipment?.unit_events ?? []} />}
    </div>
  );
}