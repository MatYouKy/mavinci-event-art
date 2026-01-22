import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { supabase } from '@/lib/supabase/browser';
import type { RootState } from '../store';

export interface CustomIcon {
  id: string;
  name: string;
  svg_code: string;
  preview_color?: string;
}

type Status = 'idle' | 'loading' | 'succeeded' | 'failed';

interface CustomIconsState {
  icons: CustomIcon[];
  status: Status;
  error: string | null;
}

const initialState: CustomIconsState = {
  icons: [],
  status: 'idle',
  error: null,
};

// async thunk – możesz zostawić jako fallback
export const fetchCustomIcons = createAsyncThunk('customIcons/fetchAll', async () => {
  const { data, error } = await supabase
    .from('custom_icons')
    .select('id, name, svg_code, preview_color')
    .order('name');

  if (error) throw error;
  return (data ?? []) as CustomIcon[];
});

const customIconsSlice = createSlice({
  name: 'customIcons',
  initialState,
  reducers: {
    // ✅ to będzie użyte przy hydratacji z serwera
    setIconsFromServer(state, action: PayloadAction<CustomIcon[]>) {
      state.icons = action.payload;
      state.status = 'succeeded';
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCustomIcons.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchCustomIcons.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.icons = action.payload;
      })
      .addCase(fetchCustomIcons.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.error.message || 'Failed to load icons';
      });
  },
});

export const { setIconsFromServer } = customIconsSlice.actions;
export default customIconsSlice.reducer;

export const selectCustomIcons = (state: RootState) => state.customIcons.icons;
export const selectCustomIconsStatus = (state: RootState) => state.customIcons.status;
export const selectCustomIconsError = (state: RootState) => state.customIcons.error;
export const selectIconById = (id: string) => (state: RootState) =>
  state.customIcons.icons.find((i) => i.id === id);
