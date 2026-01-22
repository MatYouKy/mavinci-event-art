'use client';

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';

export interface KitByIdResult {
  id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  warehouse_category_id: string | null;
  is_active: boolean;
  created_at: string;
  created_by?: string | null;
  equipment_kit_items: Array<{
    id: string;
    kit_id: string;
    equipment_id: string | null;
    cable_id: string | null;
    quantity: number;
    notes: string | null;
    order_index: number;
    equipment_items: {
      id: string;
      name: string;
      brand: string | null;
      model: string | null;
      thumbnail_url: string | null;
      equipment_units?: Array<{
        id: string;
        status: 'available' | 'damaged' | 'in_service' | 'retired';
      }>;
    } | null;
    cables: {
      id: string;
      name: string;
      length_meters: number | null;
      thumbnail_url: string | null;
      stock_quantity: number;
    } | null;
  }>;
}

export function useKitByIdLazy() {
  const [kit, setKit] = useState<KitByIdResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadKit = useCallback(async (kitId: string) => {
    if (!kitId) return null;

    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from('equipment_kits')
        .select(
          `
          id,
          name,
          description,
          thumbnail_url,
          warehouse_category_id,
          is_active,
          created_at,
          created_by,
          equipment_kit_items(
            id,
            kit_id,
            equipment_id,
            cable_id,
            quantity,
            notes,
            order_index,
            equipment_items(
              id,
              name,
              brand,
              model,
              thumbnail_url,
              equipment_units(id, status)
            ),
            cables(
              id,
              name,
              length_meters,
              thumbnail_url,
              stock_quantity
            )
          )
        `,
        )
        .eq('id', kitId)
        .maybeSingle();

      if (error) throw error;

      const result = (data as unknown as KitByIdResult | null) ?? null;
      setKit(result);
      return result;
    } catch (e: any) {
      const msg = e?.message || 'Błąd podczas pobierania zestawu';
      setError(msg);
      setKit(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setKit(null);
    setError(null);
    setLoading(false);
  }, []);

  return { kit, loading, error, loadKit, reset };
}
