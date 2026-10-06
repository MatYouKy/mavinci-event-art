import { supabase } from '@/lib/supabase/browser';
import { checkKitInventory, KitComponent } from './kitInventory';
export async function saveEquipmentKit(id: string | null, kit: { name: string; quantity: number; description?: string | null; thumbnail_url?: string | null; warehouse_category_id?: string | null }, items: KitComponent[]) {
  // Fresh inventory for useful error messages; database repeats validation under a lock.
  const [kits, equipment, cables] = await Promise.all([
    supabase.from('equipment_kits').select('id,quantity,is_active,deleted_at,equipment_kit_items(equipment_id,cable_id,quantity)'),
    supabase.from('equipment_items').select('id,name,is_active,total_quantity,equipment_units(status)'),
    supabase.from('cables').select('id,name,is_active,deleted_at,stock_quantity'),
  ]);
  for (const result of [kits, equipment, cables]) if (result.error) throw result.error;
  const result = checkKitInventory(id, kit.quantity, items, kits.data || [], equipment.data || [], cables.data || []);
  if (result.shortages.length) throw new Error(`Nie można zapisać zestawu. Maksymalnie ${result.maxQuantity} kompletów. ${result.shortages.join(' ')}`);
  const { data, error } = await supabase.rpc('save_equipment_kit_checked', { p_kit_id: id, p_kit: kit, p_items: items });
  if (error) {
    if (error.code === 'PGRST202') throw new Error('Zapis zablokowany: zabezpieczenie magazynu wymaga wdrożenia migracji bazy danych.');
    throw new Error(error.message);
  }
  return data as string;
}
