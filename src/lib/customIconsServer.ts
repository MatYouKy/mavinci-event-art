// lib/customIconsServer.ts
import { supabase } from '@/lib/supabase'; // jeśli masz wariant serverowy
import type { CustomIcon } from '@/store/slices/customIconSlice';

export async function loadCustomIconsServer(): Promise<CustomIcon[]> {
  const { data, error } = await supabase
    .from('custom_icons')
    .select('id, name, svg_code, preview_color')
    .order('name');

  if (error) {
    console.error('Error loading custom icons on server:', error);
    return [];
  }

  return (data ?? []) as CustomIcon[];
}