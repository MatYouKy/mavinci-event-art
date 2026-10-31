import { supabase } from '@/lib/supabase/browser';
import { loadConfigurationEquipment } from './loadConfigurationEquipment';
import type { WarehouseStageCatalog } from './modularProduct';
export type { WarehouseEquipmentRow } from './loadConfigurationEquipment';

export function loadStageEquipment(catalog: WarehouseStageCatalog, moduleKind: 'stage' | 'led' = 'stage') {
  return loadConfigurationEquipment(supabase, catalog, moduleKind);
}
