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

interface EquipmentState {
  storageLocations: StorageLocation[];
  categories: EquipmentCategory[];
  loading: boolean;
  error: string | null;
}

const initialState: EquipmentState = {
  storageLocations: [],
  categories: [],
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
      });
  },
});

export const { clearError } = equipmentSlice.actions;
export default equipmentSlice.reducer;
