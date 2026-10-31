import type { SupabaseClient } from '@supabase/supabase-js';
import {componentGroupLinks,type WarehouseStageCatalog,type StageEquipment,type StageLink } from '@/lib/CRM/Offers/modularProduct';
export type WarehouseEquipmentRow={id:string;name:string;brand?:string|null;model?:string|null;rental_price_per_day:number|null;thumbnail_url?:string|null};
export async function loadConfigurationEquipment(client:SupabaseClient,catalog:WarehouseStageCatalog,moduleKind:'stage'|'led'='stage'):Promise<Record<string,StageEquipment>>{
 const result:Record<string,StageEquipment>={};const rootIds=new Set(catalog.roots.map(r=>r.equipment_id));
 async function visit(id:string,ancestors:string[]){
  if(ancestors.includes(id))throw new Error('Wykryto pętlę zależności sprzętu. Popraw kompatybilność w magazynie.');
  if(ancestors.length>=8)throw new Error('Zależności przekraczają 8 poziomów. Uprość strukturę sprzętu.');
  if(result[id])return;
  if(Object.keys(result).length>=200)throw new Error('Konfiguracja przekracza 200 elementów magazynowych.');
  const [{data:item,error:itemError},{data:links,error:linksError}]=await Promise.all([
   client.from('equipment_items').select('id,name,model,rental_price_per_day,dimensions_cm,thumbnail_url').eq('id',id).is('deleted_at',null).single(),
   client.from('equipment_compatible_items').select('*').eq('equipment_id',id).order('display_order').order('id'),
  ]);
  if(itemError||!item)throw new Error('Nie można pobrać sprzętu. Sprawdź, czy istnieje i masz dostęp do magazynu.');
  if(catalog.roots.some(r=>r.equipment_id===id&&r.basis==='decks')){const dimensions=item.dimensions_cm as {width?:number;length?:number;depth?:number}|null;const a=Number(dimensions?.width),b=Number(dimensions?.length??dimensions?.depth);if(moduleKind==='led'?!(a===50&&b===50):!((a===100&&b===200)||(a===200&&b===100)))throw new Error(moduleKind==='led'?'Moduł LED musi mieć w magazynie wymiary 50 × 50 cm.':'Główny blat musi mieć w magazynie wymiary 100 × 200 cm (szerokość i długość). Ten konfigurator dotyczy modułów 1 × 2 m.');}
  const ownGroups=catalog.component_groups?.[id];
  if(ownGroups===undefined&&linksError)throw new Error('Nie można pobrać kompatybilności sprzętu. Spróbuj ponownie.');
  if(ownGroups===undefined&&(links||[]).some(l=>!l.compatible_equipment_id))throw new Error(`„${item.name}” ma powiązanie z zestawem lub kablem. Konfigurator podestu obsługuje obecnie pojedyncze pozycje sprzętu; zastąp to powiązanie pozycją sprzętu.`);
  const resolved:StageLink[]=ownGroups!==undefined?componentGroupLinks(ownGroups):(links||[]).filter(l=>!rootIds.has(l.compatible_equipment_id!)).map(l=>({id:l.id,equipment_id:l.compatible_equipment_id!,type:l.compatibility_type as StageLink['type'],group:l.compatibility_group?.trim()||null,quantity:Number(l.quantity),mode:l.quantity_mode as StageLink['mode'],min_height:l.min_height_cm==null?null:Number(l.min_height_cm),max_height:l.max_height_cm==null?null:Number(l.max_height_cm)}));
  result[id]={id,name:item.name,model:item.model,name_en:'',thumbnail_url:item.thumbnail_url,rate:item.rental_price_per_day===null?null:Number(item.rental_price_per_day),links:resolved};
  for(const link of resolved)await visit(link.equipment_id,[...ancestors,id]);
 }
 for(const root of catalog.roots)await visit(root.equipment_id,[]);
 return result;
}
