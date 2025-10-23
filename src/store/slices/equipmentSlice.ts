import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { supabase } from '@/lib/supabase';

export interface StorageLocation {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
}

export interface EquipmentCategory {
  id: string;
  name: string;
  description?: string;
  parent_id?: string;
  uses_simple_quantity: boolean;
}

export interface EquipmentDetails {
  equipment: any;
  warehouse_category: EquipmentCategory | null;
  warehouse_categories: EquipmentCategory[];
  equipment_stock: any[];
  equipment_components: any[];
  equipment_images: any[];
  units: any[];
  unit_events: any[];
}

export interface EquipmentListItem {
  id: string;
  name: string;
  type: 'equipment' | 'kit';
  category_name?: string;
  category_id?: string;
  thumbnail?: string;
  total_quantity?: number;
  available_quantity?: number;
  [key: string]: any;
}

export interface EquipmentList {
  equipment_items: EquipmentListItem[];
  equipment_kits: EquipmentListItem[];
  warehouse_categories: EquipmentCategory[];
}

interface EquipmentState {
  storageLocations: StorageLocation[];
  categories: EquipmentCategory[];
  equipmentDetails: Record<string, EquipmentDetails>;
  equipmentList: EquipmentList | null;
  loading: boolean;
  error: string | null;
}

const initialState: EquipmentState = {
  storageLocations: [],
  categories: [],
  equipmentDetails: {},
  equipmentList: null,
  loading: false,
  error: null,
};

export const fetchStorageLocations = createAsyncThunk(
  'equipment/fetchStorageLocations',
  async () => {
    const { data, error } = await supabase
      .from('storage_locations')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return data || [];
  }
);

export const fetchEquipmentCategories = createAsyncThunk(
  'equipment/fetchCategories',
  async () => {
    const { data, error } = await supabase
      .from('warehouse_categories')
      .select('*')
      .order('name');

    if (error) throw error;
    return data || [];
  }
);

export const fetchEquipmentDetails = createAsyncThunk(
  'equipment/fetchDetails',
  async ({ equipmentId, includeUnits = false }: { equipmentId: string; includeUnits?: boolean }) => {
    const { data, error } = await supabase.rpc('get_equipment_details', {
      item_id: equipmentId,
      include_units: includeUnits
    });

    if (error) throw error;
    return { equipmentId, data };
  }
);

export const fetchEquipmentList = createAsyncThunk(
  'equipment/fetchList',
  async () => {
    const { data, error } = await supabase.rpc('get_equipment_list');

    if (error) throw error;
    return data as EquipmentList;
  }
);

const equipmentSlice = createSlice({
  name: 'equipment',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchStorageLocations.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchStorageLocations.fulfilled, (state, action) => {
        state.loading = false;
        state.storageLocations = action.payload;
      })
      .addCase(fetchStorageLocations.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch storage locations';
      })
      .addCase(fetchEquipmentCategories.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchEquipmentCategories.fulfilled, (state, action) => {
        state.loading = false;
        state.categories = action.payload;
      })
      .addCase(fetchEquipmentCategories.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch categories';
      })
      .addCase(fetchEquipmentDetails.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchEquipmentDetails.fulfilled, (state, action) => {
        state.loading = false;
        state.equipmentDetails[action.payload.equipmentId] = action.payload.data;
      })
      .addCase(fetchEquipmentDetails.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch equipment details';
      })
      .addCase(fetchEquipmentList.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchEquipmentList.fulfilled, (state, action) => {
        state.loading = false;
        state.equipmentList = action.payload;
      })
      .addCase(fetchEquipmentList.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch equipment list';
      });
  },
});

export const { clearError } = equipmentSlice.actions;
export default equipmentSlice.reducer;
