import { EquipmentUnit } from '@/store/slices/equipmentSlice';
import { useEffect, useMemo, useState } from 'react';
import {
  CreditCard as Edit, X, Plus, Trash2, Upload, Package, History, Copy,
} from 'lucide-react';
import { uploadImage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { UpdateCableQuantityModal } from '../modals/UpdateCableQuantityModal';
import { UnitEventsModal } from '../modals/UnitEventsModal';
import { useUpdateCableQuantityMutation } from '../../store/equipmentApi';

/** ---------- flag types ---------- */
type Flags = {
  simple_quantity: boolean;
  requires_serial: boolean;
  hide_events: boolean;
  disable_units: boolean;
  read_only: boolean;
};

const DEFAULT_FLAGS: Flags = {
  simple_quantity: false,
  requires_serial: false,
  hide_events: false,
  disable_units: false,
  read_only: false,
};

/** ---------- helpers for special_properties with inheritance ---------- */
type SpecialProperty = { name: string; value: boolean };
type CategoryLite = {
  id: string;
  parent_id: string | null;
  special_properties?: SpecialProperty[];
};

function getPropState(props: SpecialProperty[] | undefined, key: string): boolean | null {
  const p = props?.find((x) => x.name === key);
  return typeof p?.value === 'boolean' ? p.value : null;
}

/** Child overrides parent; fallback defaultValue if missing everywhere */
function getCategoryFlagFromHierarchy(
  currentCategory: CategoryLite | undefined,
  allCategories: CategoryLite[] | undefined,
  flag: string,
  defaultValue = false
): boolean {
  if (!currentCategory) return defaultValue;

  const childVal = getPropState(currentCategory.special_properties, flag);
  if (childVal !== null) return childVal;

  if (currentCategory.parent_id && allCategories?.length) {
    const parent = allCategories.find((c) => c.id === currentCategory.parent_id);
    const parentVal = getPropState(parent?.special_properties, flag);
    if (parentVal !== null) return parentVal;
  }
  return defaultValue;
}

function resolveCategoryFlags(equipment: any): Flags {
  const cur = equipment?.warehouse_categories as CategoryLite | undefined;
  const all = (equipment?.all_warehouse_categories as CategoryLite[]) || [];
  return {
    simple_quantity: getCategoryFlagFromHierarchy(cur, all, 'simple_quantity', false),
    requires_serial: getCategoryFlagFromHierarchy(cur, all, 'requires_serial', false),
    hide_events: getCategoryFlagFromHierarchy(cur, all, 'hide_events', false),
    disable_units: getCategoryFlagFromHierarchy(cur, all, 'disable_units', false),
    read_only: getCategoryFlagFromHierarchy(cur, all, 'read_only', false),
  };
}

/** Merge helpers (rightmost wins) */
function mergeFlags(...parts: Array<Partial<Flags> | undefined>): Flags {
  return parts.reduce<Flags>(
    (acc, p) => ({ ...acc, ...(p || {}) }),
    { ...DEFAULT_FLAGS }
  );
}

/** Optional: keep ephemeral flags per equipment in localStorage */
function useEphemeralFlags(equipmentId?: string, initial?: Partial<Flags>) {
  const storageKey = equipmentId ? `unitsTabFlags:${equipmentId}` : undefined;
  const [state, setState] = useState<Partial<Flags>>(() => {
    if (!storageKey) return initial || {};
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? { ...(JSON.parse(raw) as Partial<Flags>) } : (initial || {});
    } catch {
      return initial || {};
    }
  });

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state || {}));
    } catch {}
  }, [storageKey, state]);

  return [state, setState] as const;
}

/** ------------------------------------------------------------------ */

export function UnitsTab({
  equipment,
  units,
  onUpdate,
  canEdit,
  showSnackbar,
  /** custom, non-persistent overrides injected from parent (last in precedence) */
  customFlags,
}: any & { customFlags?: Partial<Flags> }) {
  /** 1) flags from category (inherited) */
  const categoryFlags = useMemo(() => resolveCategoryFlags(equipment), [
    equipment?.warehouse_categories,
    equipment?.all_warehouse_categories,
  ]);

  console.log(categoryFlags, 'categoryFlags');

  /** 2) ephemeral flags stored per-equipment in localStorage (optional UI toggles) */
  const [savedEphemeralFlags, setSavedEphemeralFlags] = useEphemeralFlags(equipment?.id);

  /** 3) final flags used by the tab (DEFAULT → category → ephemeral → props.custom) */
  const flags = useMemo(
    () => mergeFlags(DEFAULT_FLAGS, categoryFlags, savedEphemeralFlags, customFlags),
    [categoryFlags, savedEphemeralFlags, customFlags]
  );

  // Quantity-only mode if cable OR final simple_quantity flag
  const isSimpleStock = Boolean(equipment?.cable_specs) || flags.simple_quantity;

  // Final edit permission for this tab (respect global canEdit + read_only flag)
  const canEditHere = Boolean(canEdit) && !flags.read_only;

  const [updateCableQty, { isLoading: savingQty }] = useUpdateCableQuantityMutation();

  const [showQuantityModal, setShowQuantityModal] = useState(false);
  const [qty, setQty] = useState<number>(equipment?.cable_stock_quantity || 0);

  useEffect(() => {
    setQty(equipment?.cable_stock_quantity || 0);
  }, [equipment?.id, equipment?.cable_stock_quantity]);

  const [showModal, setShowModal] = useState(false);
  const [newQuantity, setNewQuantity] = useState(
    isSimpleStock ? (equipment?.cable_stock_quantity || 0) : units.length
  );

  const [editingUnit, setEditingUnit] = useState<EquipmentUnit | null>(null);
  const [unitForm, setUnitForm] = useState<EquipmentUnit>({
    id: '',
    equipment_id: '',
    location: '',
    created_at: '',
    updated_at: '',
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
  const [unitEvents, setUnitEvents] = useState<EquipmentUnit[]>([]);
  const [showEventsHistory, setShowEventsHistory] = useState(false);
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
  const [bulkActionInProgress, setBulkActionInProgress] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('storage_locations')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (data) setLocations(data);
    })();
  }, []);

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
    if (!canEditHere || flags.disable_units) return;

    if (unit) {
      setEditingUnit(unit);
      setUnitForm({
        id: unit.id,
        equipment_id: unit.equipment_id,
        location: unit.location,
        created_at: unit.created_at,
        updated_at: unit.updated_at,
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
        id: '',
        equipment_id: '',
        location: '',
        created_at: '',
        updated_at: '',
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
      setUnitForm((prev) => ({ ...prev, thumbnail_url: url }));
    } catch (error) {
      console.error('Error uploading thumbnail:', error);
      alert('Błąd podczas przesyłania zdjęcia');
    } finally {
      setUploadingThumb(false);
    }
  };

  const handleSaveUnit = async () => {
    if (!canEditHere || flags.disable_units) return;
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
        showSnackbar?.('Jednostka zaktualizowana pomyślnie', 'success');
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
        showSnackbar?.('Jednostka dodana pomyślnie', 'success');
      }

      setShowModal(false);
      await onUpdate();
    } catch (error: any) {
      console.error('Error saving unit:', error);
      const errorMessage = error?.message || 'Błąd podczas zapisywania jednostki';
      showSnackbar?.(errorMessage, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUnit = async (unitId: string) => {
    if (!canEditHere || flags.disable_units) return;
    if (!confirm('Czy na pewno chcesz usunąć tę jednostkę?')) return;

    try {
      const { error } = await supabase.from('equipment_units').delete().eq('id', unitId);
      if (error) throw error;
      onUpdate();
    } catch (error) {
      console.error('Error deleting unit:', error);
      alert('Błąd podczas usuwania jednostki');
    }
  };

  const handleDuplicateUnit = async (unit: EquipmentUnit) => {
    if (!canEditHere || flags.disable_units) return;
    if (!confirm('Czy na pewno chcesz zduplikować tę jednostkę?')) return;

    try {
      const newSerialNumber = unit.unit_serial_number
        ? `${unit.unit_serial_number} (duplikat)`
        : null;

      const { error } = await supabase.from('equipment_units').insert({
        equipment_id: unit.equipment_id,
        unit_serial_number: newSerialNumber,
        status: unit.status,
        location_id: unit.location_id,
        condition_notes: unit.condition_notes
          ? `${unit.condition_notes} [DUPLIKAT]`
          : 'Duplikat jednostki',
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
    const { data } = await supabase
      .from('equipment_unit_events')
      .select(
        `
        *,
        employees(name, surname)
      `
      )
      .eq('unit_id', unitId)
      .order('created_at', { ascending: false });

    if (data) setUnitEvents(data);
  };

  const handleShowEvents = async (unit: EquipmentUnit) => {
    setSelectedUnit(unit);
    await fetchUnitEvents(unit.id);
    setShowEventsHistory(true);
  };

  const handleToggleSelectUnit = (unitId: string) => {
    setSelectedUnitIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(unitId)) {
        newSet.delete(unitId);
      } else {
        newSet.add(unitId);
      }
      return newSet;
    });
  };

  const handleSelectAllUnits = () => {
    if (selectedUnitIds.size === units.length) {
      setSelectedUnitIds(new Set());
    } else {
      setSelectedUnitIds(new Set(units.map((u: EquipmentUnit) => u.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedUnitIds.size === 0) return;
    if (!confirm(`Czy na pewno chcesz usunąć ${selectedUnitIds.size} jednostek?`)) return;

    setBulkActionInProgress(true);
    try {
      const { error } = await supabase
        .from('equipment_units')
        .delete()
        .in('id', Array.from(selectedUnitIds));

      if (error) throw error;

      setSelectedUnitIds(new Set());
      await onUpdate();
      showSnackbar?.(`Usunięto ${selectedUnitIds.size} jednostek`, 'success');
    } catch (error) {
      console.error('Error bulk deleting units:', error);
      showSnackbar?.('Błąd podczas usuwania jednostek', 'error');
    } finally {
      setBulkActionInProgress(false);
    }
  };

  const handleBulkDuplicate = async () => {
    if (selectedUnitIds.size === 0) return;
    if (!confirm(`Czy na pewno chcesz zduplikować ${selectedUnitIds.size} jednostek?`)) return;

    setBulkActionInProgress(true);
    try {
      const unitsToDuplicate = units.filter((u: EquipmentUnit) => selectedUnitIds.has(u.id));
      const insertData = unitsToDuplicate.map((unit: EquipmentUnit) => ({
        equipment_id: unit.equipment_id,
        unit_serial_number: unit.unit_serial_number
          ? `${unit.unit_serial_number} (duplikat)`
          : null,
        status: unit.status,
        location_id: unit.location_id,
        condition_notes: unit.condition_notes
          ? `${unit.condition_notes} [DUPLIKAT]`
          : 'Duplikat jednostki',
        purchase_date: unit.purchase_date,
        last_service_date: unit.last_service_date,
        estimated_repair_date: unit.estimated_repair_date,
        thumbnail_url: unit.thumbnail_url,
      }));

      const { error } = await supabase.from('equipment_units').insert(insertData);

      if (error) throw error;

      setSelectedUnitIds(new Set());
      await onUpdate();
      showSnackbar?.(`Zduplikowano ${selectedUnitIds.size} jednostek`, 'success');
    } catch (error) {
      console.error('Error bulk duplicating units:', error);
      showSnackbar?.('Błąd podczas duplikowania jednostek', 'error');
    } finally {
      setBulkActionInProgress(false);
    }
  };

  const groupedUnits = {
    available: units.filter((u: EquipmentUnit) => u.status === 'available'),
    damaged: units.filter((u: EquipmentUnit) => u.status === 'damaged'),
    in_service: units.filter((u: EquipmentUnit) => u.status === 'in_service'),
    retired: units.filter((u: EquipmentUnit) => u.status === 'retired'),
  };

  const handleUpdateCableQuantity = async () => {
    if (!canEditHere) return;
    try {
      await updateCableQty({ equipmentId: equipment.id, quantity: qty }).unwrap();
      setShowQuantityModal(false);
      showSnackbar?.('Ilość zaktualizowana pomyślnie', 'success');
    } catch (err) {
      console.error(err);
      showSnackbar?.('Błąd podczas aktualizacji ilości', 'error');
    }
  };

  /** ---- quick “Tab flags” toolbar (ephemeral toggles) ---- */
  const FlagChip = ({
    k,
    label,
  }: {
    k: keyof Flags;
    label: string;
  }) => {
    const enabled = !!flags[k];
    return (
      <button
        type="button"
        onClick={() =>
          setSavedEphemeralFlags((prev) => ({ ...(prev || {}), [k]: !enabled }))
        }
        className={`px-2 py-1 rounded text-xs border ${
          enabled
            ? 'bg-[#d3bb73] text-[#1c1f33] border-[#d3bb73]'
            : 'bg-[#0f1119] text-[#e5e4e2]/70 border-[#d3bb73]/20'
        }`}
        title="Ephemeral (not saved to DB)"
      >
        {label}
      </button>
    );
  };

  /** ---------------- render ---------------- */
  if (isSimpleStock) {
    return (
      <div className="space-y-6">
        {/* Ephemeral toolbar */}
        <div className="flex flex-wrap gap-2">
          <FlagChip k="simple_quantity" label="simple_quantity" />
          <FlagChip k="requires_serial" label="requires_serial" />
          <FlagChip k="hide_events" label="hide_events" />
          <FlagChip k="disable_units" label="disable_units" />
          <FlagChip k="read_only" label="read_only" />
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-8">
          <div className="text-center">
            <div className="text-6xl font-light text-[#d3bb73] mb-4">
              {equipment?.cable_stock_quantity || 0}
            </div>
            <div className="text-lg text-[#e5e4e2]/60 mb-4">Ilość na stanie (szt.)</div>
            {canEditHere && (
              <button
                onClick={() => setShowQuantityModal(true)}
                className="flex items-center gap-2 px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors mx-auto"
              >
                <Plus className="w-4 h-4" />
                Ustaw ilość
              </button>
            )}
          </div>
        </div>
        <UpdateCableQuantityModal
          open={showQuantityModal}
          value={qty}
          onChange={(v) => setQty(v)}
          onClose={() => setShowQuantityModal(false)}
          onSave={handleUpdateCableQuantity}
          saving={savingQty}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Ephemeral toolbar */}
      <div className="flex flex-wrap gap-2">
        <FlagChip k="simple_quantity" label="simple_quantity" />
        <FlagChip k="requires_serial" label="requires_serial" />
        <FlagChip k="hide_events" label="hide_events" />
        <FlagChip k="disable_units" label="disable_units" />
        <FlagChip k="read_only" label="read_only" />
      </div>

      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-medium text-[#e5e4e2]">Zarządzanie jednostkami</h3>
          {units.length > 0 && canEditHere && !flags.disable_units && (
            <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/60 cursor-pointer hover:text-[#e5e4e2]">
              <input
                type="checkbox"
                checked={selectedUnitIds.size === units.length}
                onChange={handleSelectAllUnits}
                className="w-4 h-4 rounded border-[#d3bb73]/20 text-[#d3bb73] focus:ring-[#d3bb73]"
              />
              Zaznacz wszystkie
            </label>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedUnitIds.size > 0 && canEditHere && !flags.disable_units && (
            <>
              <button
                onClick={handleBulkDuplicate}
                disabled={bulkActionInProgress}
                className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50"
              >
                <Copy className="w-4 h-4" />
                Duplikuj ({selectedUnitIds.size})
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkActionInProgress}
                className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                Usuń ({selectedUnitIds.size})
              </button>
            </>
          )}
          {canEditHere && !flags.disable_units && (
            <button
              onClick={() => handleOpenModal()}
              className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Dodaj jednostkę
            </button>
          )}
        </div>
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
                  isUnavailable ? 'border-red-500/20 opacity-60' : 'border-[#d3bb73]/10'
                } ${selectedUnitIds.has(unit.id) ? 'ring-2 ring-[#d3bb73]' : ''}`}
              >
                <div className="flex items-start justify-between gap-4">
                  {canEditHere && !flags.disable_units && (
                    <div className="flex items-center pt-1">
                      <input
                        type="checkbox"
                        checked={selectedUnitIds.has(unit.id)}
                        onChange={() => handleToggleSelectUnit(unit.id)}
                        className="w-5 h-5 rounded border-[#d3bb73]/20 text-[#d3bb73] focus:ring-[#d3bb73]"
                      />
                    </div>
                  )}
                  {unit.thumbnail_url && (
                    <img
                      src={unit.thumbnail_url}
                      alt="Miniaturka"
                      className="w-20 h-20 object-cover rounded-lg border border-[#d3bb73]/20"
                    />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      {flags.requires_serial ? (
                        unit.unit_serial_number ? (
                          <span className="font-mono text-[#e5e4e2] font-medium">
                            SN: {unit.unit_serial_number}
                          </span>
                        ) : (
                          <span className="text-[#e5e4e2]/60 italic">Brak numeru seryjnego</span>
                        )
                      ) : unit.unit_serial_number ? (
                        <span className="font-mono text-[#e5e4e2] font-medium">
                          SN: {unit.unit_serial_number}
                        </span>
                      ) : null}

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
                          Szac. dostępność:{' '}
                          {new Date(unit.estimated_repair_date).toLocaleDateString('pl-PL')}
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
                    {!flags.hide_events && (
                      <button
                        onClick={() => handleShowEvents(unit)}
                        className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                        title="Historia zdarzeń"
                      >
                        <History className="w-4 h-4" />
                      </button>
                    )}

                    {canEditHere && !flags.disable_units && (
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

      {showModal &&
        (() => {
          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
                <h3 className="text-xl font-light text-[#e5e4e2] mb-4">
                  {isSimpleStock
                    ? 'Ustaw ilość na stanie'
                    : editingUnit
                    ? 'Edytuj jednostkę'
                    : 'Dodaj nową jednostkę'}
                </h3>

                {isSimpleStock ? (
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm text-[#e5e4e2]/60 mb-2">Ilość sztuk</label>
                      <input
                        type="number"
                        value={newQuantity}
                        onChange={(e) => setNewQuantity(parseInt(e.target.value) || 0)}
                        min="0"
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2] text-lg focus:outline-none focus:border-[#d3bb73]/30"
                        placeholder="np. 50"
                        autoFocus
                      />
                      <p className="text-sm text-[#e5e4e2]/40 mt-2">
                        Wprowadź łączną ilość sztuk tego sprzętu
                      </p>
                    </div>

                    <div className="flex gap-3 pt-4">
                      <button
                        onClick={() => {
                          setShowModal(false);
                          setNewQuantity(equipment?.cable_stock_quantity || 0);
                        }}
                        className="flex-1 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
                      >
                        Anuluj
                      </button>
                      {canEditHere && (
                        <button
                          onClick={async () => {
                            await updateCableQty({ equipmentId: equipment.id, quantity: newQuantity }).unwrap();
                            setShowModal(false);
                            showSnackbar?.('Ilość zaktualizowana pomyślnie', 'success');
                          }}
                          className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                        >
                          Zapisz
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-4">
                      {unitForm.thumbnail_url && (
                        <div className="relative w-32 h-32 mx-auto">
                          <img
                            src={unitForm.thumbnail_url}
                            alt="Miniaturka"
                            className="w-full h-full object-cover rounded-lg border border-[#d3bb73]/20"
                          />
                          {canEditHere && !flags.disable_units && (
                            <button
                              onClick={() =>
                                setUnitForm((prev) => ({ ...prev, thumbnail_url: '' }))
                              }
                              className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}

                      <div>
                        <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                          Miniaturka (opcjonalne)
                        </label>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleThumbnailUpload}
                          disabled={uploadingThumb || !canEditHere || flags.disable_units}
                          className="hidden"
                          id="unit-thumbnail-upload"
                        />
                        {canEditHere && !flags.disable_units && (
                          <label
                            htmlFor="unit-thumbnail-upload"
                            className={`flex items-center justify-center gap-2 w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] cursor-pointer hover:border-[#d3bb73]/30 transition-colors ${
                              uploadingThumb ? 'opacity-50' : ''
                            }`}
                          >
                            <Upload className="w-4 h-4" />
                            {uploadingThumb
                              ? 'Przesyłanie...'
                              : unitForm.thumbnail_url
                              ? 'Zmień zdjęcie'
                              : 'Dodaj zdjęcie'}
                          </label>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                          Numer seryjny{flags.requires_serial ? ' (wymagany)' : ' (opcjonalny)'}
                        </label>
                        <input
                          type="text"
                          value={unitForm.unit_serial_number}
                          onChange={(e) =>
                            setUnitForm((prev) => ({
                              ...prev,
                              unit_serial_number: e.target.value,
                            }))
                          }
                          disabled={!canEditHere || flags.disable_units}
                          className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30 disabled:opacity-50"
                          placeholder="np. SN123456"
                        />
                        <p className="text-xs text-[#e5e4e2]/40 mt-1">
                          {flags.requires_serial
                            ? 'To pole jest wymagane dla tej kategorii sprzętu'
                            : 'Pozostaw puste dla sprzętu bez numeru seryjnego'}
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm text-[#e5e4e2]/60 mb-2">Status</label>
                          <select
                            value={unitForm.status}
                            onChange={(e) =>
                              setUnitForm((prev) => ({
                                ...prev,
                                status: e.target.value as any,
                              }))
                            }
                            disabled={!canEditHere || flags.disable_units}
                            className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30 disabled:opacity-50"
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
                            onChange={(e) =>
                              setUnitForm((prev) => ({ ...prev, location_id: e.target.value }))
                            }
                            disabled={!canEditHere || flags.disable_units}
                            className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30 disabled:opacity-50"
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
                            onChange={(e) =>
                              setUnitForm((prev) => ({ ...prev, purchase_date: e.target.value }))
                            }
                            disabled={!canEditHere || flags.disable_units}
                            className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30 disabled:opacity-50"
                          />
                        </div>

                        <div>
                          <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                            Ostatni serwis
                          </label>
                          <input
                            type="date"
                            value={unitForm.last_service_date}
                            onChange={(e) =>
                              setUnitForm((prev) => ({
                                ...prev,
                                last_service_date: e.target.value,
                              }))
                            }
                            disabled={!canEditHere || flags.disable_units}
                            className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30 disabled:opacity-50"
                          />
                        </div>

                        <div>
                          <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                            Szacowana dostępność
                          </label>
                          <input
                            type="date"
                            value={unitForm.estimated_repair_date}
                            onChange={(e) =>
                              setUnitForm((prev) => ({
                                ...prev,
                                estimated_repair_date: e.target.value,
                              }))
                            }
                            disabled={
                              !canEditHere ||
                              flags.disable_units ||
                              (unitForm.status !== 'damaged' && unitForm.status !== 'in_service')
                            }
                            className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30 disabled:opacity-50"
                          />
                          <p className="text-xs text-[#e5e4e2]/40 mt-1">
                            Dla jednostek uszkodzonych lub w serwisie
                          </p>
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                            Notatki o stanie
                          </label>
                          <textarea
                            value={unitForm.condition_notes}
                            onChange={(e) =>
                              setUnitForm((prev) => ({
                                ...prev,
                                condition_notes: e.target.value,
                              }))
                            }
                            rows={3}
                            disabled={!canEditHere || flags.disable_units}
                            className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30 disabled:opacity-50"
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
                      {canEditHere && !flags.disable_units && (
                        <button
                          onClick={handleSaveUnit}
                          disabled={saving}
                          className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
                        >
                          {saving ? 'Zapisywanie...' : 'Zapisz'}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })()}

      {/* Events history modal, hidden behind hide_events */}
      {!flags.hide_events && showEventsHistory && selectedUnit && (
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