// =============================
// src/store/slices/equipmentSlice.ts
// Kompletny slice z thunkami Supabase, zgodny ze schematem który podałeś
// =============================
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit'
import { supabase } from '@/lib/supabase'

// --- Typy uproszczone na bazie przesłanego schematu ---
export type UUID = string

export interface StorageLocation {
  id: UUID
  name: string
  address: string | null
  access_info: string | null
  google_maps_url: string | null
  notes: string | null
  is_active: boolean | null
  created_at: string | null
  updated_at: string | null
}

export interface ConnectorType {
  id: UUID
  name: string
  description: string | null
  common_uses: string | null
  is_active: boolean | null
  created_at: string | null
  updated_at: string | null
  thumbnail_url: string | null
}

export interface EquipmentComponent {
  id: UUID
  equipment_id: UUID
  component_name: string
  quantity: number | null
  description: string | null
  is_included: boolean | null
  created_at: string | null
}

export interface EquipmentStock {
  id: UUID
  equipment_id: UUID
  total_quantity: number | null
  available_quantity: number | null
  reserved_quantity: number | null
  in_use_quantity: number | null
  damaged_quantity: number | null
  in_service_quantity: number | null
  min_stock_level: number | null
  storage_location: string | null
  last_inventory_date: string | null
  updated_at: string | null
  company_stock_quantity: number
}

export interface EquipmentUnit {
  id: UUID
  equipment_id: UUID
  unit_serial_number: string | null
  status: 'available' | 'damaged' | 'in_service' | 'retired';
  location: string | null
  condition_notes: string | null
  purchase_date: string | null
  last_service_date: string | null
  created_at: string
  updated_at: string
  estimated_repair_date: string | null
  thumbnail_url: string | null
  location_id: UUID | null
  storage_locations?: { name: string } | null // via select
}

export interface EquipmentUnitEvent {
  id: UUID
  unit_id: UUID
  event_type: 'damage' | 'repair' | 'service' | 'status_change' | 'note' | 'inspection' | 'sold'
  description: string
  image_url: string | null
  old_status: string | null
  new_status: string | null
  employee_id: UUID | null
  created_at: string
  employees?: { name: string; surname: string } | null
}

export interface WarehouseCategory {
  id: UUID
  name: string
  parent_id: UUID | null
  level: number
  uses_simple_quantity?: boolean | null // zakładamy istnienie w widoku/RPC
}

export interface EquipmentItem {
  id: UUID
  name: string
  brand: string | null
  model: string | null
  description: string | null
  thumbnail_url: string | null
  user_manual_url: string | null
  weight_kg: number | null
  dimensions_cm: any | null
  purchase_date: string | null
  purchase_price: number | null
  current_value: number | null
  warranty_until: string | null
  serial_number: string | null
  barcode: string | null
  notes: string | null
  is_active: boolean | null
  created_at: string | null
  updated_at: string | null
  cable_specs: any | null
  warehouse_category_id: UUID | null
  cable_stock_quantity: number | null
  storage_location_id: UUID | null
}

// ====== Slice state ======
const initialState = {
  loading: false as boolean,
  error: null as string | null,
  equipmentDetails: {} as Record<string, any>,
  unitEvents: {} as Record<string, EquipmentUnitEvent[]>,
  connectorTypes: [] as ConnectorType[],
  storageLocations: [] as StorageLocation[],
}

// ====== THUNKS ======

// Pobierz lokacje magazynowe (aktywne)
export const fetchStorageLocations = createAsyncThunk(
  'equipment/fetchStorageLocations',
  async () => {
    const { data, error } = await supabase
      .from('storage_locations')
      .select('*')
      .eq('is_active', true)
      .order('name')
    if (error) throw error
    return data as StorageLocation[]
  }
)

// Pobierz słownik wtyków
export const fetchConnectorTypes = createAsyncThunk(
  'equipment/fetchConnectorTypes',
  async () => {
    const { data, error } = await supabase
      .from('connector_types')
      .select('*')
      .eq('is_active', true)
      .order('name')
    if (error) throw error
    return data as ConnectorType[]
  }
)

// Pobierz kompletne dane sprzętu (zależnie od includeUnits)
export const fetchEquipmentDetails = createAsyncThunk(
  'equipment/fetchEquipmentDetails',
  async ({ equipmentId, includeUnits }: { equipmentId: string; includeUnits: boolean }, { rejectWithValue }) => {
    // Podstawowe informacje + relacje
    const baseSelect = `
      *,
      warehouse_categories:warehouse_category_id(*),
      equipment_components(*),
      equipment_stock(*),
      equipment_images(*)
    `

    const { data: eq, error } = await supabase
      .from('equipment_items')
      .select(baseSelect)
      .eq('id', equipmentId)
      .single()

    if (error) return rejectWithValue(error.message)

    // Pobierz pełne drzewo kategorii (do logiki uses_simple_quantity w UI)
    const { data: categories } = await supabase
      .from('warehouse_categories')
      .select('*')

    let units: EquipmentUnit[] = []
    if (includeUnits) {
      const { data: unitsData, error: uerr } = await supabase
        .from('equipment_units')
        .select('*, storage_locations(name)')
        .eq('equipment_id', equipmentId)
        .order('created_at', { ascending: false })
      if (uerr) return rejectWithValue(uerr.message)
      units = (unitsData || []) as any
    }

    // (opcjonalnie) historia zdarzeń jednostek
    let unit_events: EquipmentUnitEvent[] = []
    if (includeUnits) {
      const { data: ev } = await supabase
        .from('equipment_unit_events')
        .select('*, employees(name, surname)')
        .in('unit_id', units.map(u => u.id))
        .order('created_at', { ascending: false })
      unit_events = (ev || []) as any
    }

    return {
      equipment: eq as EquipmentItem,
      equipment_stock: (eq as any)?.equipment_stock ?? [],
      equipment_components: (eq as any)?.equipment_components ?? [],
      equipment_images: (eq as any)?.equipment_images ?? [],
      warehouse_category: (eq as any)?.warehouse_categories ?? null,
      warehouse_categories: categories ?? [],
      units,
      unit_events,
      connector_types: [],
    }
  }
)

// Aktualizacja sprzętu
export const updateEquipmentItem = createAsyncThunk(
  'equipment/updateEquipmentItem',
  async ({ id, payload }: { id: string; payload: Partial<EquipmentItem> }) => {
    const { error } = await supabase
      .from('equipment_items')
      .update(payload)
      .eq('id', id)
    if (error) throw error
    return { id, payload }
  }
)

// Miękkie usunięcie
export const softDeleteEquipmentItem = createAsyncThunk(
  'equipment/softDeleteEquipmentItem',
  async (id: string) => {
    const { error } = await supabase
      .from('equipment_items')
      .update({ is_active: false })
      .eq('id', id)
    if (error) throw error
    return id
  }
)

// Log zmian
export const logEquipmentEdit = createAsyncThunk(
  'equipment/logEquipmentEdit',
  async (p: {
    equipment_id: string
    employee_id: string | null
    field_name: string
    old_value: string | null
    new_value: string | null
    change_type?: string
  }) => {
    const { error } = await supabase
      .from('equipment_edit_history')
      .insert({
        equipment_id: p.equipment_id,
        employee_id: p.employee_id,
        field_name: p.field_name,
        old_value: p.old_value,
        new_value: p.new_value,
        change_type: p.change_type ?? 'update',
      })
    if (error) throw error
    return true
  }
)

// Komponenty zestawu
export const addEquipmentComponent = createAsyncThunk(
  'equipment/addEquipmentComponent',
  async ({ equipment_id, component }: { equipment_id: string; component: Omit<EquipmentComponent, 'id' | 'created_at' | 'equipment_id'> & { component_equipment_id?: string | null } }) => {
    const { error } = await supabase
      .from('equipment_components')
      .insert({
        equipment_id,
        component_equipment_id: component.component_equipment_id || null,
        component_name: component.component_name,
        quantity: component.quantity ?? 1,
        description: component.description ?? null,
        is_included: component.is_included ?? true,
      })
    if (error) throw error
    return true
  }
)

export const deleteEquipmentComponent = createAsyncThunk(
  'equipment/deleteEquipmentComponent',
  async (componentId: string) => {
    const { error } = await supabase
      .from('equipment_components')
      .delete()
      .eq('id', componentId)
    if (error) throw error
    return componentId
  }
)

// Magazyn / stock (RPC)
export const changeEquipmentStock = createAsyncThunk(
  'equipment/changeEquipmentStock',
  async (p: { equipment_id: string; change_type: string; quantity_change: number; employee_id?: string | null; notes?: string | null }) => {
    const { error } = await (supabase as any).rpc('update_equipment_stock_with_history', {
      p_equipment_id: p.equipment_id,
      p_change_type: p.change_type,
      p_quantity_change: p.quantity_change,
      p_employee_id: p.employee_id ?? null,
      p_notes: p.notes ?? null,
    })
    if (error) throw error
    return true
  }
)

export const updateEquipmentStockSettings = createAsyncThunk(
  'equipment/updateEquipmentStockSettings',
  async ({ stock_id, payload }: { stock_id: string; payload: Pick<EquipmentStock, 'storage_location' | 'min_stock_level'> }) => {
    const { error } = await supabase
      .from('equipment_stock')
      .update({
        storage_location: payload.storage_location ?? null,
        min_stock_level: payload.min_stock_level ?? 0,
      })
      .eq('id', stock_id)
    if (error) throw error
    return { stock_id, payload }
  }
)

// Jednostki
export const createEquipmentUnit = createAsyncThunk(
  'equipment/createEquipmentUnit',
  async (payload: Omit<EquipmentUnit, 'id' | 'created_at' | 'updated_at'>) => {
    const insert = {
      equipment_id: payload.equipment_id,
      unit_serial_number: payload.unit_serial_number ?? null,
      status: payload.status ?? 'available',
      location_id: payload.location_id ?? null,
      condition_notes: payload.condition_notes ?? null,
      purchase_date: payload.purchase_date ?? null,
      last_service_date: payload.last_service_date ?? null,
      estimated_repair_date: payload.estimated_repair_date ?? null,
      thumbnail_url: payload.thumbnail_url ?? null,
    }
    const { error } = await supabase.from('equipment_units').insert(insert)
    if (error) throw error
    return true
  }
)

export const updateEquipmentUnit = createAsyncThunk(
  'equipment/updateEquipmentUnit',
  async ({ id, payload }: { id: string; payload: Partial<EquipmentUnit> }) => {
    const { error } = await supabase
      .from('equipment_units')
      .update({
        unit_serial_number: payload.unit_serial_number ?? null,
        status: (payload.status as any) ?? 'available',
        location_id: payload.location_id ?? null,
        condition_notes: payload.condition_notes ?? null,
        purchase_date: payload.purchase_date ?? null,
        last_service_date: payload.last_service_date ?? null,
        estimated_repair_date: payload.estimated_repair_date ?? null,
        thumbnail_url: payload.thumbnail_url ?? null,
      })
      .eq('id', id)
    if (error) throw error
    return { id, payload }
  }
)

export const deleteEquipmentUnit = createAsyncThunk(
  'equipment/deleteEquipmentUnit',
  async (unitId: string) => {
    const { error } = await supabase
      .from('equipment_units')
      .delete()
      .eq('id', unitId)
    if (error) throw error
    return unitId
  }
)

export const duplicateEquipmentUnit = createAsyncThunk(
  'equipment/duplicateEquipmentUnit',
  async (unit: EquipmentUnit) => {
    const newSerial = unit.unit_serial_number ? `${unit.unit_serial_number} (duplikat)` : null
    const { error } = await supabase
      .from('equipment_units')
      .insert({
        equipment_id: unit.equipment_id,
        unit_serial_number: newSerial,
        status: unit.status,
        location_id: unit.location_id,
        condition_notes: unit.condition_notes ? `${unit.condition_notes} [DUPLIKAT]` : 'Duplikat jednostki',
        purchase_date: unit.purchase_date,
        last_service_date: unit.last_service_date,
        estimated_repair_date: unit.estimated_repair_date,
        thumbnail_url: unit.thumbnail_url,
      })
    if (error) throw error
    return true
  }
)

// Zdarzenia jednostek
export const fetchUnitEvents = createAsyncThunk(
  'equipment/fetchUnitEvents',
  async (unitId: string) => {
    const { data, error } = await supabase
      .from('equipment_unit_events')
      .select('*, employees(name, surname)')
      .eq('unit_id', unitId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return { unitId, events: (data || []) as EquipmentUnitEvent[] }
  }
)

export const addEquipmentUnitEvent = createAsyncThunk(
  'equipment/addEquipmentUnitEvent',
  async (p: { unit: EquipmentUnit; event: Omit<EquipmentUnitEvent, 'id' | 'created_at'> }) => {
    // 1) Insert event
    const { error } = await supabase
      .from('equipment_unit_events')
      .insert({
        unit_id: p.unit.id,
        event_type: p.event.event_type,
        description: p.event.description,
        image_url: p.event.image_url ?? null,
        employee_id: p.event.employee_id ?? null,
        old_status: p.event.old_status ?? null,
        new_status: p.event.new_status ?? null,
      })
    if (error) throw error

    // 2) Ewentualne aktualizacje jednostki
    if (p.event.event_type === 'damage') {
      await supabase.from('equipment_units').update({ status: 'damaged' }).eq('id', p.unit.id)
    }
    if (p.event.event_type === 'repair') {
      await supabase.from('equipment_units').update({ status: 'available', estimated_repair_date: null, last_service_date: new Date().toISOString().slice(0,10) }).eq('id', p.unit.id)
    }
    if (p.event.event_type === 'service') {
      await supabase.from('equipment_units').update({ last_service_date: new Date().toISOString().slice(0,10) }).eq('id', p.unit.id)
    }
    if (p.event.event_type === 'sold') {
      await supabase.from('equipment_units').delete().eq('id', p.unit.id)
    }

    return true
  }
)

// Wtyki
export const createConnectorType = createAsyncThunk(
  'equipment/createConnectorType',
  async (p: Omit<ConnectorType, 'id' | 'created_at' | 'updated_at'>) => {
    const { error } = await supabase
      .from('connector_types')
      .insert({
        name: p.name,
        description: p.description ?? null,
        common_uses: p.common_uses ?? null,
        thumbnail_url: p.thumbnail_url ?? null,
        is_active: p.is_active ?? true,
      })
    if (error) throw error
    return true
  }
)

// ====== SLICE ======
const equipmentSlice = createSlice({
  name: 'equipment',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchStorageLocations.fulfilled, (state, { payload }) => {
        state.storageLocations = payload
      })
      .addCase(fetchConnectorTypes.fulfilled, (state, { payload }) => {
        state.connectorTypes = payload
      })
      .addCase(fetchEquipmentDetails.pending, state => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchEquipmentDetails.fulfilled, (state, { payload }: PayloadAction<any>) => {
        state.loading = false
        state.error = null
        state.equipmentDetails[payload.equipment.id] = payload
      })
      .addCase(fetchEquipmentDetails.rejected, (state, action) => {
        state.loading = false
        state.error = String(action.payload || action.error.message || 'Error')
      })
      .addCase(fetchUnitEvents.fulfilled, (state, { payload }) => {
        state.unitEvents[payload.unitId] = payload.events
      })
  }
})

export default equipmentSlice.reducer

// Aliasy dla kompatybilności z istniejącym kodem
export const upsertEquipmentUnit = createAsyncThunk(
  'equipment/upsertEquipmentUnit',
  async (payload: { id?: string; equipment_id: string; [key: string]: any }) => {
    if (payload.id) {
      const { id, ...updateData } = payload;
      const { error } = await supabase
        .from('equipment_units')
        .update(updateData)
        .eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('equipment_units')
        .insert(payload);
      if (error) throw error;
    }
    return true;
  }
);

export const addUnitEvent = createAsyncThunk(
  'equipment/addUnitEvent',
  async (payload: { unit_id: string; event_type: string; description: string; [key: string]: any }) => {
    const { error } = await supabase
      .from('equipment_unit_events')
      .insert(payload);
    if (error) throw error;
    return true;
  }
);

export const setCableQuantity = createAsyncThunk(
  'equipment/setCableQuantity',
  async ({ equipmentId, quantity }: { equipmentId: string; quantity: number }) => {
    const { error } = await supabase
      .from('equipment_items')
      .update({ cable_stock_quantity: quantity })
      .eq('id', equipmentId);
    if (error) throw error;
    return true;
  }
);

// =============================
// PODMIANY W KOMPONENCIE (wycinki do wklejenia)
// =============================
// 1) Importy thunków w EquipmentDetailPage.tsx
// import {
//  fetchStorageLocations,
//  fetchEquipmentDetails,
//  fetchConnectorTypes,
//  updateEquipmentItem,
//  softDeleteEquipmentItem,
//  logEquipmentEdit,
//  addEquipmentComponent,
//  deleteEquipmentComponent,
//  changeEquipmentStock,
//  updateEquipmentStockSettings,
//  createEquipmentUnit,
//  updateEquipmentUnit,
//  deleteEquipmentUnit,
//  duplicateEquipmentUnit,
//  fetchUnitEvents,
//  addEquipmentUnitEvent,
//  createConnectorType,
// } from '@/store/slices/equipmentSlice'

// 2) Zamiast local fetch connectorów, w useEffect po załadowaniu szczegółów:
// dispatch(fetchConnectorTypes())

// 3) handleSave -> dispatch(updateEquipmentItem(...)) i po sukcesie -> dispatch(fetchEquipmentDetails({ equipmentId, includeUnits: false }))
// 4) handleDelete -> dispatch(softDeleteEquipmentItem(equipmentId)) i router.push('/crm/equipment')
// 5) logEquipmentChange -> dispatch(logEquipmentEdit({...}))
// 6) ComponentsTab: add/delete -> dispatch(addEquipmentComponent(...)) / dispatch(deleteEquipmentComponent(id)) -> odśwież szczegóły
// 7) StockTab: change -> dispatch(changeEquipmentStock(...)); settings -> dispatch(updateEquipmentStockSettings(...))
// 8) UnitsTab: create/update/delete/duplicate -> odpowiednie thunki; events -> dispatch(fetchUnitEvents(unit.id)); add event -> dispatch(addEquipmentUnitEvent(...))
