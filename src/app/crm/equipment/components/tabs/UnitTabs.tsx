import { useEffect, useMemo, useState } from 'react';
import { CreditCard as Edit, X, Plus, Trash2, Upload, Package, History, Copy } from 'lucide-react';
import { uploadImage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { UpdateCableQuantityModal } from '../modals/UpdateCableQuantityModal';
import { UnitEventsModal } from '../modals/UnitEventsModal';
import { IEquipmentUnit, IEquipmentUnitEvent } from '../../types/equipment.types';
import { ThumbnailHoverPopper } from '@/components/UI/ThumbnailPopover';


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

function mergeFlags(...parts: Array<Partial<Flags> | undefined>): Flags {
  return parts.reduce<Flags>((acc, p) => ({ ...acc, ...(p || {}) }), { ...DEFAULT_FLAGS });
}

/** Optional: keep ephemeral flags per equipment in localStorage */
function useEphemeralFlags(equipmentId?: string, initial?: Partial<Flags>) {
  const storageKey = equipmentId ? `unitsTabFlags:${equipmentId}` : undefined;
  const [state, setState] = useState<Partial<Flags>>(() => {
    if (!storageKey) return initial || {};
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? { ...(JSON.parse(raw) as Partial<Flags>) } : initial || {};
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
  // const categoryFlags = useMemo(() => resolveCategoryFlags(equipment), [
  //   equipment?.warehouse_categories,
  //   equipment?.all_warehouse_categories,
  // ]);

  /** 2) ephemeral flags stored per-equipment in localStorage (optional UI toggles) */
  const [savedEphemeralFlags, setSavedEphemeralFlags] = useEphemeralFlags(equipment?.id);

  /** 3) final flags used by the tab (DEFAULT → category → ephemeral → props.custom) */
  const flags = useMemo(
    () => mergeFlags(DEFAULT_FLAGS, savedEphemeralFlags, customFlags),
    [savedEphemeralFlags, customFlags],
  );

  // Quantity-only mode if cable OR final simple_quantity flag
  const isSimpleStock = Boolean(equipment?.cable_specs) || flags.simple_quantity;

  // Final edit permission for this tab (respect global canEdit + read_only flag)
  const canEditHere = Boolean(canEdit) && !flags.read_only;


  const [showQuantityModal, setShowQuantityModal] = useState(false);
  const [qty, setQty] = useState<number>(equipment?.cable_stock_quantity || 0);

  useEffect(() => {
    setQty(equipment?.cable_stock_quantity || 0);
  }, [equipment?.id, equipment?.cable_stock_quantity]);

  const [showModal, setShowModal] = useState(false);
  const [newQuantity, setNewQuantity] = useState(
    isSimpleStock ? equipment?.cable_stock_quantity || 0 : units.length,
  );

  const [editingUnit, setEditingUnit] = useState<IEquipmentUnit | null>(null);
  const [unitForm, setUnitForm] = useState<IEquipmentUnit>({
    unit_serial_number: '',
    status: 'available',
    location_id: '',
    purchase_date: '',
    last_service_date: '',
    thumbnail_url: '',
    // Provide default values for missing IEquipmentUnit fields to fix the type error.
    events: [],
    created_at: '',
    updated_at: '',
    total_quantity: 0,
    available_quantity: 0,
  });
  const [saving, setSaving] = useState(false);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [locations, setLocations] = useState<any[]>([]);


  const [showEventModal, setShowEventModal] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<IEquipmentUnit | null>(null);
  const [unitEvents, setUnitEvents] = useState<IEquipmentUnitEvent[]>([]);
  const [showEventsHistory, setShowEventsHistory] = useState(false);

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

  const handleOpenModal = (unit?: IEquipmentUnit) => {
    if (!canEditHere || flags.disable_units) return;

    if (unit) {
      setEditingUnit(unit);

    } else {
      setEditingUnit(null);

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
            purchase_date: unitForm.purchase_date || null,
            last_service_date: unitForm.last_service_date || null,
            thumbnail_url: unitForm.thumbnail_url || null,
          })
          .eq('_id', editingUnit._id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from('equipment_units').insert({
          equipment_id: equipment.id,
          unit_serial_number: unitForm.unit_serial_number || null,
          status: unitForm.status,
          location_id: unitForm.location_id || null,
          purchase_date: unitForm.purchase_date || null,
          last_service_date: unitForm.last_service_date || null,
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

  const handleDuplicateUnit = async (unit: IEquipmentUnit) => {
    if (!canEditHere || flags.disable_units) return;
    if (!confirm('Czy na pewno chcesz zduplikować tę jednostkę?')) return;

    try {
      const newSerialNumber = unit.unit_serial_number
        ? `${unit.unit_serial_number} (duplikat)`
        : null;

      const { error } = await supabase.from('equipment_units').insert({

        unit_serial_number: newSerialNumber,
        status: unit.status,
        location_id: unit.location_id,
        purchase_date: unit.purchase_date,
        last_service_date: unit.last_service_date,
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
      `,
      )
      .eq('unit_id', unitId)
      .order('created_at', { ascending: false });

    if (data) setUnitEvents(data);
  };

  const handleShowEvents = async (unit: IEquipmentUnit) => {
    setSelectedUnit(unit);
    await fetchUnitEvents(unit._id);
    setShowEventsHistory(true);
  };

  const groupedUnits = {
    available: equipment?.quantity.units?.filter((u: IEquipmentUnit) => u.status === 'available'),
    damaged: equipment?.quantity.units?.filter((u: IEquipmentUnit) => u.status === 'damaged'),
    in_service: equipment?.quantity.units?.filter((u: IEquipmentUnit) => u.status === 'in_service'),
    retired: equipment?.quantity.units?.filter((u: IEquipmentUnit) => u.status === 'retired'),
  };

  const handleUpdateCableQuantity = async () => {}
  //   if (!canEditHere) return;
  //   try {
  //     await updateCableQty({ _id: equipment._id, quantity: qty }).unwrap();
  //     setShowQuantityModal(false);
  //     showSnackbar?.('Ilość zaktualizowana pomyślnie', 'success');
  //   } catch (err) {
  //     console.error(err);
  //     showSnackbar?.('Błąd podczas aktualizacji ilości', 'error');
  //   }
  // };

  /** ---- quick “Tab flags” toolbar (ephemeral toggles) ---- */
  const FlagChip = ({ k, label }: { k: keyof Flags; label: string }) => {
    const enabled = !!flags[k];
    return (
      <button
        type="button"
        onClick={() => setSavedEphemeralFlags((prev) => ({ ...(prev || {}), [k]: !enabled }))}
        className={`rounded border px-2 py-1 text-xs ${
          enabled
            ? 'border-[#d3bb73] bg-[#d3bb73] text-[#1c1f33]'
            : 'border-[#d3bb73]/20 bg-[#0f1119] text-[#e5e4e2]/70'
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
          {customFlags?.map((flag: any) => (
            <FlagChip k={flag.name} label={flag.name} />
          ))}
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8">
          <div className="text-center">
            <div className="mb-4 text-6xl font-light text-[#d3bb73]">
              {equipment?.cable_stock_quantity || 0}
            </div>
            <div className="mb-4 text-lg text-[#e5e4e2]/60">Ilość na stanie (szt.)</div>
            {canEditHere && (
              <button
                onClick={() => setShowQuantityModal(true)}
                className="mx-auto flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                <Plus className="h-4 w-4" />
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
          saving={saving}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Ephemeral toolbar */}
      <div className="flex flex-wrap gap-2">
        {customFlags?.map((flag: any) => (
          <FlagChip k={flag.name} label={flag.name} />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Zarządzanie jednostkami</h3>
        {canEditHere && !flags.disable_units && (
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Dodaj jednostkę
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-green-500/10 bg-[#1c1f33] p-4">
          <div className="mb-1 text-sm text-[#e5e4e2]/60">Dostępne</div>
          <div className="text-2xl font-light text-green-400">{groupedUnits.available.length}</div>
        </div>
        <div className="rounded-xl border border-red-500/10 bg-[#1c1f33] p-4">
          <div className="mb-1 text-sm text-[#e5e4e2]/60">Uszkodzone</div>
          <div className="text-2xl font-light text-red-400">{groupedUnits.damaged.length}</div>
        </div>
        <div className="rounded-xl border border-orange-500/10 bg-[#1c1f33] p-4">
          <div className="mb-1 text-sm text-[#e5e4e2]/60">Serwis</div>
          <div className="text-2xl font-light text-orange-400">
            {groupedUnits.in_service.length}
          </div>
        </div>
        <div className="rounded-xl border border-gray-500/10 bg-[#1c1f33] p-4">
          <div className="mb-1 text-sm text-[#e5e4e2]/60">Wycofane</div>
          <div className="text-2xl font-light text-gray-400">{groupedUnits.retired.length}</div>
        </div>
      </div>

      {equipment?.quantity.units?.length === 0 ? (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] py-12 text-center">
          <Package className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
          <p className="mb-2 text-[#e5e4e2]/60">Brak jednostek</p>
          <p className="text-sm text-[#e5e4e2]/40">Dodaj pierwszą jednostkę sprzętu</p>
        </div>
      ) : (
        <div className="space-y-3">
          {equipment?.quantity.units?.map((unit: IEquipmentUnit) => {
            const isUnavailable = unit.status === 'damaged' || unit.status === 'in_service';
            return (
              <div
                key={unit._id}
                className={`rounded-xl border bg-[#1c1f33] p-4 ${
                  isUnavailable ? 'border-red-500/20 opacity-60' : 'border-[#d3bb73]/10'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  {unit.thumbnail_url && <ThumbnailHoverPopper src={unit.thumbnail_url} />}
                  <div className="flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-3">
                      {flags.requires_serial ? (
                        unit.unit_serial_number ? (
                          <span className="font-mono font-medium text-[#e5e4e2]">
                            SN: {unit.unit_serial_number}
                          </span>
                        ) : (
                          <span className="italic text-[#e5e4e2]/60">Brak numeru seryjnego</span>
                        )
                      ) : unit.unit_serial_number ? (
                        <span className="font-mono font-medium text-[#e5e4e2]">
                          SN: {unit.unit_serial_number}
                        </span>
                      ) : null}

                      <span className={`rounded px-2 py-1 text-xs ${statusColors[unit.status]}`}>
                        {statusLabels[unit.status]}
                      </span>

                      {isUnavailable && (
                        <span className="rounded border border-red-500/30 bg-red-500/20 px-2 py-1 text-xs text-red-300">
                          Niedostępny
                        </span>
                      )}

                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
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

                  </div>

                  <div className="ml-4 flex gap-2">
                    {!flags.hide_events && (
                      <button
                        onClick={() => handleShowEvents(unit)}
                        className="rounded-lg p-2 text-blue-400 transition-colors hover:bg-blue-500/10"
                        title="Historia zdarzeń"
                      >
                        <History className="h-4 w-4" />
                      </button>
                    )}

                    {canEditHere && !flags.disable_units && (
                      <>
                        <button
                          onClick={() => handleDuplicateUnit(unit)}
                          className="rounded-lg p-2 text-purple-400 transition-colors hover:bg-purple-500/10"
                          title="Duplikuj jednostkę"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleOpenModal(unit)}
                          className="rounded-lg p-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteUnit(unit._id)}
                          className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
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
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                <h3 className="mb-4 text-xl font-light text-[#e5e4e2]">
                  {isSimpleStock
                    ? 'Ustaw ilość na stanie'
                    : editingUnit
                      ? 'Edytuj jednostkę'
                      : 'Dodaj nową jednostkę'}
                </h3>

                {isSimpleStock ? (
                  <div className="space-y-6">
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/60">Ilość sztuk</label>
                      <input
                        type="number"
                        value={newQuantity}
                        onChange={(e) => setNewQuantity(parseInt(e.target.value) || 0)}
                        min="0"
                        className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-3 text-lg text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                        placeholder="np. 50"
                        autoFocus
                      />
                      <p className="mt-2 text-sm text-[#e5e4e2]/40">
                        Wprowadź łączną ilość sztuk tego sprzętu
                      </p>
                    </div>

                    <div className="flex gap-3 pt-4">
                      <button
                        onClick={() => {
                          setShowModal(false);
                          setNewQuantity(equipment?.cable_stock_quantity || 0);
                        }}
                        className="flex-1 rounded-lg bg-[#e5e4e2]/10 px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/20"
                      >
                        Anuluj
                      </button>
                      {canEditHere && (
                        <button
                          onClick={async () => {
                            // await updateCableQty({
                            //   id: equipment.id,
                            //   quantity: newQuantity,
                            // }).unwrap();
                            // setShowModal(false);
                            // showSnackbar?.('Ilość zaktualizowana pomyślnie', 'success');
                          }}
                          className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
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
                        <div className="relative mx-auto h-32 w-32">
                          {unitForm.thumbnail_url && <ThumbnailHoverPopper src={unitForm.thumbnail_url as string} />}
                          {canEditHere && !flags.disable_units && (
                            <button
                              onClick={() =>
                                setUnitForm((prev) => ({ ...prev, thumbnail_url: '' }))
                              }
                              className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}

                      <div>
                        <label className="mb-2 block text-sm text-[#e5e4e2]/60">
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
                            className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] transition-colors hover:border-[#d3bb73]/30 ${
                              uploadingThumb ? 'opacity-50' : ''
                            }`}
                          >
                            <Upload className="h-4 w-4" />
                            {uploadingThumb
                              ? 'Przesyłanie...'
                              : unitForm.thumbnail_url
                                ? 'Zmień zdjęcie'
                                : 'Dodaj zdjęcie'}
                          </label>
                        )}
                      </div>

                      {flags.requires_serial && (
                        <div>
                          <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                            Numer seryjny (opcjonalny)
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
                            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-50"
                            placeholder="np. SN123456"
                          />
                          <p className="mt-1 text-xs text-[#e5e4e2]/40">
                            Pozostaw puste dla sprzętu bez numeru seryjnego
                          </p>
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status</label>
                          <select
                            value={unitForm.status}
                            onChange={(e) =>
                              setUnitForm((prev) => ({
                                ...prev,
                                status: e.target.value as any,
                              }))
                            }
                            disabled={!canEditHere || flags.disable_units}
                            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-50"
                          >
                            <option value="available">Dostępny</option>
                            <option value="damaged">Uszkodzony</option>
                            <option value="in_service">Serwis</option>
                            <option value="retired">Wycofany</option>
                          </select>
                        </div>

                        <div>
                          <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                            Lokalizacja
                          </label>
                          <select
                            value={unitForm.location_id}
                            onChange={(e) =>
                              setUnitForm((prev) => ({ ...prev, location_id: e.target.value }))
                            }
                            disabled={!canEditHere || flags.disable_units}
                            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-50"
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
                          <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                            Data zakupu
                          </label>
                          <input
                            type="date"
                            value={unitForm.purchase_date}
                            onChange={(e) =>
                              setUnitForm((prev) => ({ ...prev, purchase_date: e.target.value }))
                            }
                            disabled={!canEditHere || flags.disable_units}
                            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-50"
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm text-[#e5e4e2]/60">
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
                            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-50"
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                            Szacowana dostępność
                          </label>
                          <input
                            type="date"
                            onChange={(e) =>
                              setUnitForm((prev) => ({
                                ...prev,
                              }))
                            }
                            disabled={
                              !canEditHere ||
                              flags.disable_units ||
                              (unitForm.status !== 'damaged' && unitForm.status !== 'in_service')
                            }
                            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-50"
                          />
                          <p className="mt-1 text-xs text-[#e5e4e2]/40">
                            Dla jednostek uszkodzonych lub w serwisie
                          </p>
                        </div>

                        <div className="md:col-span-2">
                          <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                            Notatki o stanie
                          </label>
                          <textarea
                            onChange={(e) =>
                              setUnitForm((prev) => ({
                                ...prev,
                              }))
                            }
                            rows={3}
                            disabled={!canEditHere || flags.disable_units}
                            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-50"
                            placeholder="Notatki o stanie technicznym, usterki, naprawy..."
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 flex gap-3">
                      <button
                        onClick={() => setShowModal(false)}
                        className="flex-1 rounded-lg bg-[#e5e4e2]/10 px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/20"
                      >
                        Anuluj
                      </button>
                      {canEditHere && !flags.disable_units && (
                        <button
                          onClick={handleSaveUnit}
                          disabled={saving}
                          className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
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
            fetchUnitEvents(selectedUnit._id);
            onUpdate();
          }}
        />
      )}
    </div>
  );
}
