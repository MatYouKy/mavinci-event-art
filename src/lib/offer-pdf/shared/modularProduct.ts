export * from './ledProcessorCapacity';
import {calculateLedWarehouse} from './ledWarehouse';
export * from './ledWarehouse';
import {ledSectionTotals,ledSectionScope,type LedSection} from './ledSections';
export * from './ledSections';
import { validateWarehouseStage,warehouseStageSnapshot,calculateWarehouseStage,warehouseStageTitle,warehouseStageScope,missingWarehouseEnglish,type StageEquipment,type WarehouseStageCatalog,type WarehouseStageSnapshot } from './warehouseStage';
export * from './warehouseStage';
/** Versioned profiles: stage geometry is deliberately not a universal formula language. */
export type StageCatalog = {
  version: 1; profile: 'stage'; deck_rate: number; legs_per_deck: number;
  heights: { cm: number; leg_rate: number | null }[];
  fascia_rate: number | null; skirt_rate: number | null; skirt_basis: 'set' | 'metre';
  carpet_rate: number | null; stairs_rate: number | null; multiplier: number;
};
export type StageSelection = {
  width: number; depth: number; height: number; skirt: 'none' | 'front_sides' | 'all';
  carpet: boolean; stairs: number;
  accessories: { id: string; name: string; name_en: string; quantity: number; rate: number | null }[];
};
export type ModularSnapshot = { version: 1; profile: 'stage'; catalog: StageCatalog; selection: StageSelection };
export type ModularLine = { key: string; name: string; quantity: number; unit: string; rate: number | null; total: number };
export const stageDefaults = (): StageCatalog => ({ version: 1, profile: 'stage', deck_rate: 150, legs_per_deck: 4,
  heights: [{ cm: 30, leg_rate: 12.5 }, { cm: 40, leg_rate: null }, { cm: 50, leg_rate: null }],
  fascia_rate: 0, skirt_rate: 50, skirt_basis: 'set', carpet_rate: 100, stairs_rate: null, multiplier: 1 });
export function stageSnapshot(catalog: StageCatalog): ModularSnapshot {
  return { version: 1, profile: 'stage', catalog: structuredClone(catalog), selection: {
    width: 4, depth: 2, height: catalog.heights[0]?.cm ?? 30, skirt: 'none', carpet: false, stairs: 0, accessories: [],
  } };
}
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const validRate = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 9999999 && Math.abs(n * 100 - Math.round(n * 100)) < .0001;
export function validateStageCatalog(c: StageCatalog): string | null {
  if (!c || c.profile !== 'stage' || c.version !== 1) return 'Nieobsługiwany typ konfiguratora.';
  if (!validRate(c.deck_rate) || !Number.isInteger(c.legs_per_deck) || c.legs_per_deck < 1 || c.legs_per_deck > 8) return 'Podaj cenę blatu i liczbę nóg (1–8) na moduł.';
  if (!Array.isArray(c.heights) || c.heights.length < 1 || c.heights.length > 20 || c.heights.some(h => !h || !Number.isInteger(h.cm) || h.cm < 1 || h.cm > 200 || (h.leg_rate !== null && !validRate(h.leg_rate))) || new Set(c.heights.map(h => h.cm)).size !== c.heights.length) return 'Podaj unikalne wysokości 1–200 cm i poprawne stawki nóg.';
  if ([c.fascia_rate, c.skirt_rate, c.carpet_rate, c.stairs_rate].some(n => n !== null && !validRate(n))) return 'Stawki muszą być nieujemne, z maksymalnie dwoma miejscami po przecinku. Puste oznacza do wyceny.';
  if (!['set', 'metre'].includes(c.skirt_basis) || !validRate(c.multiplier) || c.multiplier <= 0 || c.multiplier > 100) return 'Podaj sposób naliczania wysłony i mnożnik większy od 0, do 100.';
  return null;
}
export function calculateStage(s: ModularSnapshot, english = false): { error: string | null; lines: ModularLine[]; total: number; area: number; decks: number; perimeter: number } {
  const fail = (error: string) => ({ error, lines: [], total: 0, area: 0, decks: 0, perimeter: 0 });
  if (!s || s.profile !== 'stage' || s.version !== 1) return fail('Nieobsługiwana konfiguracja produktu.');
  const catalogError = validateStageCatalog(s.catalog);
  if (catalogError) return fail(catalogError);
  const c = s.catalog, p = s.selection;
  if (!p || !Number.isInteger(p.width) || !Number.isInteger(p.depth) || p.width < 1 || p.depth < 1 || p.width > 100 || p.depth > 100 || (p.width % 2 !== 0 && p.depth % 2 !== 0)) return fail('Podesty 1 × 2 m wymagają pełnych metrów (1–100 m), a przynajmniej jeden bok musi być parzysty.');
  const height = c.heights.find(h => h.cm === p.height);
  if (!height) return fail('Wybierz wysokość z cennika nóg.');
  if (!['none','front_sides','all'].includes(p.skirt) || typeof p.carpet !== 'boolean' || !Number.isInteger(p.stairs) || p.stairs < 0 || p.stairs > 20) return fail('Wybierz wysłonę, dywan i liczbę kompletów schodów (0–20).');
  if (!Array.isArray(p.accessories) || p.accessories.length > 8 || p.accessories.some(a => !a || !a.id || !a.name?.trim() || a.name.length > 100 || typeof a.name_en !== 'string' || a.name_en.length > 100 || !Number.isInteger(a.quantity) || a.quantity < 1 || a.quantity > 1000 || (a.rate !== null && !validRate(a.rate))) || new Set(p.accessories.map(a => a.id)).size !== p.accessories.length) return fail('Uzupełnij akcesoria: nazwa, ilość całkowita 1–1000 i stawka. Maksymalnie 8 pozycji.');
  const area = p.width * p.depth, decks = area / 2;
  const sides = p.skirt === 'none' ? 0 : p.skirt === 'all' ? 4 : 3;
  const perimeter = p.skirt === 'none' ? 0 : p.width + 2 * p.depth + (p.skirt === 'all' ? p.width : 0);
  const lines: ModularLine[] = [];
  const add = (key: string, pl: string, en: string, quantity: number, unit: string, rate: number | null) => {
    if (quantity) lines.push({ key, name: english ? en : pl, quantity, unit, rate, total: rate === null ? 0 : money(quantity * rate) });
  };
  add('decks', 'Blaty sceniczne 1 × 2 m', 'Stage decks 1 × 2 m', decks, english ? 'pcs' : 'szt.', c.deck_rate);
  add('legs', `Nogi ${p.height} cm`, `${p.height} cm stage legs`, decks * c.legs_per_deck, english ? 'pcs' : 'szt.', height.leg_rate);
  add('fascia', 'Blendy / mocowanie wysłony — komplet na bok', 'Skirting attachment — set per side', sides, english ? 'sets' : 'kpl.', c.fascia_rate);
  add('skirt', `Wysłona ${sides} stron (${perimeter} mb)`, `Skirting on ${sides} sides (${perimeter} m)`, sides ? c.skirt_basis === 'metre' ? perimeter : 1 : 0, c.skirt_basis === 'metre' ? 'm' : english ? 'set' : 'kpl.', c.skirt_rate);
  add('carpet', 'Pokrycie dywanem', 'Carpet covering', p.carpet ? area : 0, 'm²', c.carpet_rate);
  add('stairs', `Schody dopasowane do wysokości ${p.height} cm`, `Stairs suitable for ${p.height} cm stage height`, p.stairs, english ? 'sets' : 'kpl.', c.stairs_rate);
  p.accessories.forEach(a => add(a.id, a.name, a.name_en || a.name, a.quantity, english ? 'pcs' : 'szt.', a.rate));
  const missing = lines.find(l => l.rate === null);
  const total = money(lines.reduce((sum, l) => sum + l.total, 0) * c.multiplier);
  return { error: missing ? `Uzupełnij stawkę: ${missing.name}.` : total > 999999999 ? 'Wartość konfiguracji jest zbyt wysoka.' : null, lines, total, area, decks, perimeter };
}
export function stageTitle(s: ModularSnapshot, english = false): string {
  return `${english ? 'Stage platform' : 'Podest sceniczny'} ${s.selection.width} × ${s.selection.depth} m — ${s.selection.height} cm`;
}
export function stageScope(s: ModularSnapshot, english = false): string[] {
  const result = calculateStage(s, english), p = s.selection;
  if (result.error) return [];
  return [
    english ? `${result.area} m² stage built from ${result.decks} decks, each 1 × 2 m; height ${p.height} cm.` : `Podest o powierzchni ${result.area} m² z ${result.decks} blatów 1 × 2 m; wysokość ${p.height} cm.`,
    english ? 'Legs supporting the selected stage configuration.' : 'Nogi dobrane do wybranej wysokości i liczby modułów.',
    ...(p.skirt !== 'none' ? [english ? `Skirting with attachment on ${p.skirt === 'all' ? 'all four sides' : 'the front and both sides'} (${result.perimeter} m).` : `Wysłona z mocowaniem: ${p.skirt === 'all' ? 'wszystkie cztery strony' : 'front i dwa boki'} (${result.perimeter} mb).`] : []),
    ...(p.carpet ? [english ? `Carpet covering the entire ${result.area} m² platform.` : `Pokrycie całego podestu dywanem — ${result.area} m².`] : []),
    ...(p.stairs ? [english ? `${p.stairs} set(s) of stairs suitable for the selected height.` : `Schody do wybranej wysokości — ${p.stairs} kpl.`] : []),
    ...p.accessories.map(a => `${english ? a.name_en || a.name : a.name} — ${a.quantity} ${english ? 'pcs' : 'szt.'}`),
  ];
}

export type EquipmentComponent = {
  id: string; name: string; name_en: string; role: 'display' | 'support' | 'processor' | 'equipment';
  source_product_id?: string; source_equipment_id?: string; parent_id?: string; basis: 'area' | 'manual' | 'fixed' | 'parent'; quantity: number; rate: number | null; required: boolean;
};
export type EquipmentCatalog = { version: 1; profile: 'led' | 'sound' | 'microphones'; components: EquipmentComponent[]; multiplier: number; led_equipment_id?:string; led_layout?:'sections'; led_tree?:WarehouseStageCatalog; led_cable_root_id?:string; led_cable_component_id?:string };
export type ProductConfigurator = StageCatalog | EquipmentCatalog | WarehouseStageCatalog;
export type EquipmentSnapshot = { version: 1; profile: 'led' | 'sound' | 'microphones'; catalog: EquipmentCatalog; selection: { area: number; led_sections?:LedSection[]; led_equipment?:Record<string,StageEquipment>; led_loaded_at?:string; led_choices?:Record<string,string>; led_enabled?:Record<string,boolean>; quantities: Record<string,number> } };
export type ProductConfigurationSnapshot = ModularSnapshot | EquipmentSnapshot | WarehouseStageSnapshot;
export const profileLabels = { warehouse_stage: 'Podest — sprzęt magazynowy', stage: 'Podest sceniczny', led: 'Ekran LED', sound: 'Nagłośnienie Point Source', microphones: 'Zestaw mikrofonów' };
export function equipmentDefaults(profile: EquipmentCatalog['profile']): EquipmentCatalog {
  return { version:1, profile, multiplier:1, components: profile === 'led' ? [
    {id:'screen',name:'Ekran LED — powierzchnia kabinetów',name_en:'LED screen — cabinet area',role:'display',basis:'area',quantity:1,rate:null,required:true},
    {id:'support',name:'Konstrukcja podtrzymująca ekran',name_en:'LED screen support structure',role:'support',basis:'manual',quantity:1,rate:null,required:true},
    {id:'processor',name:'Procesor obrazu',name_en:'Video processor',role:'processor',basis:'manual',quantity:1,rate:null,required:true},
  ] : [{id:'equipment',name:profile === 'sound' ? 'Zestaw głośnikowy — określ model' : 'Mikrofon — określ model',name_en:profile === 'sound' ? 'Loudspeaker — specify model' : 'Microphone — specify model',role:'equipment',basis:'manual',quantity:1,rate:null,required:true}] };
}
export function ledTreeSnapshot(s:EquipmentSnapshot):WarehouseStageSnapshot{
 return {version:2,profile:'warehouse_stage',catalog:s.catalog.led_tree!,equipment:s.selection.led_equipment||null,loaded_at:s.selection.led_loaded_at||null,selection:{width:2,depth:1,height:1,skirt:'all',quantities:s.selection.quantities,choices:s.selection.led_choices||{},enabled:s.selection.led_enabled||{}}};
}
export function validateProductConfigurator(c: ProductConfigurator): string | null {
  if (c?.profile === 'warehouse_stage') return validateWarehouseStage(c);
  if (c?.profile === 'stage') return validateStageCatalog(c);
  if (!c || !['led','sound','microphones'].includes(c.profile) || c.version !== 1 || !validRate(c.multiplier) || c.multiplier <= 0 || c.multiplier > 100) return 'Nieprawidłowy profil lub mnożnik konfiguratora.';
  if(c.profile==='led'&&c.led_tree){
    const error=validateWarehouseStage(c.led_tree);if(error)return error;
    if(c.led_tree.multiplier!==1||c.multiplier!==1)return 'Wycena drzewa LED korzysta bezpośrednio z cen magazynowych.';
    if(c.led_tree.roots.some(r=>!['decks','area','manual','fixed'].includes(r.basis)))return 'Dla LED wybierz naliczanie na moduł, m², cały zestaw lub ilość w ofercie.';
    if(c.led_cable_root_id&&!c.led_tree.roots.some(r=>r.id===c.led_cable_root_id&&r.basis!=='decks'&&r.required))return 'Wybierz wymagany komponent skrętek na poziomie całego zestawu.';
    return null;
  }
  if (!Array.isArray(c.components) || c.components.length < 1 || c.components.length > 12) return 'Dodaj od 1 do 12 składników zestawu.';
  if (c.components.some(r => !r || !r.id || !r.name?.trim() || r.name.length > 100 || typeof r.name_en !== 'string' || r.name_en.length > 100 || !['display','support','processor','equipment'].includes(r.role) || !['area','manual','fixed','parent'].includes(r.basis) || typeof r.required !== 'boolean' || !Number.isInteger(r.quantity) || r.quantity < (r.required ? 1 : 0) || r.quantity > 1000 || (r.rate !== null && !validRate(r.rate)) || (r.basis === 'area' && c.profile !== 'led')) || new Set(c.components.map(r => r.id)).size !== c.components.length) return 'Uzupełnij nazwy, ilości i stawki składników; wymagane elementy muszą mieć ilość co najmniej 1.';
  if(c.profile==='led'&&c.led_layout==='sections'&&(!c.led_equipment_id||!c.led_cable_component_id))return 'Powiąż moduł LED i skrętki w konfiguracji produktu.';
  if(c.profile==='led'&&c.led_cable_component_id&&!c.components.some(r=>r.id===c.led_cable_component_id&&r.basis==='manual'&&r.required))return 'Skrętki muszą być wymaganym składnikiem z ilością wybieraną w ofercie.';
  if (c.components.some(r => r.basis === 'parent' && (r.quantity < 1 || !c.components.some(parent => parent.id === r.parent_id && parent.id !== r.id && parent.basis === 'manual')))) return 'Akcesorium zależne musi wskazywać komponent główny z ilością wybieraną w ofercie oraz dodatni przelicznik.';
  if (c.profile === 'led' && (['display','support','processor'] as const).some(role => !c.components.some(r => r.role === role && r.required))) return 'LED wymaga powierzchni ekranu, konstrukcji podtrzymującej i procesora obrazu.';
  return null;
}
export function productConfigurationSnapshot(c: ProductConfigurator): ProductConfigurationSnapshot {
  if (c.profile === 'warehouse_stage') return warehouseStageSnapshot(c);
  if(c.profile==='led'&&c.led_tree)return {version:1,profile:'led',catalog:structuredClone(c),selection:{area:1,led_sections:[{id:'section-1',name:'Sekcja 1',columns:2,rows:2}],quantities:Object.fromEntries(c.led_tree.roots.map(r=>[r.id,r.quantity])),led_choices:{},led_enabled:{}}};
  return c.profile === 'stage' ? stageSnapshot(c) : { version:1,profile:c.profile,catalog:structuredClone(c),selection:{area:c.profile==='led'&&c.led_layout==='sections'?1:6,...(c.profile==='led'&&c.led_layout==='sections'?{led_sections:[{id:'section-1',name:'Sekcja 1',columns:2,rows:2}]}:{}),quantities:Object.fromEntries(c.components.map(r => [r.id,c.profile==='led'&&c.led_layout==='sections'&&r.id===c.led_cable_component_id?2:r.quantity]))} };
}
export function calculateModular(s: ProductConfigurationSnapshot, english=false): {error:string|null;lines:ModularLine[];total:number} {
  if (s?.profile === 'warehouse_stage') return calculateWarehouseStage(s,english);
  if (s?.profile === 'stage') return calculateStage(s,english);
  const fail = (error:string) => ({error,lines:[],total:0});
  if (!s || s.version !== 1 || s.profile !== s.catalog?.profile) return fail('Nieprawidłowa konfiguracja produktu.');
  const e=validateProductConfigurator(s.catalog); if(e)return fail(e);
  const c=s.catalog,p=s.selection;
  if (!p || !p.quantities || (c.profile==='led' && (!validRate(p.area) || p.area<=0 || p.area>10000))) return fail('Podaj powierzchnię LED (do 10 000 m², maksymalnie dwa miejsca po przecinku).');
  if(s.profile==='led'&&c.led_tree){
    try{if(ledSectionTotals(p.led_sections||[]).area!==p.area)return fail('Powierzchnia nie odpowiada sekcjom LED.');}catch(e){return fail(e instanceof Error?e.message:'Nieprawidłowy układ LED.');}
    return calculateLedWarehouse(ledTreeSnapshot(s),p.led_sections!,c.led_cable_root_id,english);
  }
  if(s.profile==='led'&&c.led_layout==='sections'&&!p.led_sections)return fail('Dodaj sekcje ekranu LED.');
  if(s.profile==='led'&&p.led_sections){
    try{const totals=ledSectionTotals(p.led_sections);if(p.area!==totals.area)return fail('Powierzchnia nie odpowiada sekcjom ekranu.');if(c.led_cable_component_id&&p.quantities[c.led_cable_component_id]!==totals.cables)return fail('Liczba skrętek nie odpowiada sekcjom ekranu.');}catch(e){return fail(e instanceof Error?e.message:'Nieprawidłowe sekcje LED.');}
  }
  const lines:ModularLine[]=[];
  for(const r of c.components){
    const q=r.basis==='area' ? p.area*r.quantity : r.basis==='fixed' ? r.quantity : r.basis==='parent' ? p.quantities[r.parent_id!]*r.quantity : p.quantities[r.id];
    if (!Number.isFinite(q) || q<(r.required && r.basis!=='parent' ? (r.basis==='area' ? .01 : 1):0) || q>100000 || (r.basis!=='area'&&!Number.isInteger(q))) return fail(`Podaj poprawną ilość: ${r.name}.`);
    if(q>0)lines.push({key:r.id,name:english ? r.name_en||r.name : r.name,quantity:q,unit:r.basis==='area'?'m²':english?'pcs':'szt.',rate:r.rate,total:r.rate===null?0:money(q*r.rate)});
  }
  if(!lines.length)return fail('Wybierz co najmniej jeden składnik zestawu.');
  const missing=lines.find(l=>l.rate===null),total=money(lines.reduce((sum,l)=>sum+l.total,0)*c.multiplier);
  return {error:missing?`Uzupełnij stawkę: ${missing.name}.`:total>999999999?'Wartość konfiguracji jest zbyt wysoka.':null,lines,total};
}
export function modularTitle(s:ProductConfigurationSnapshot,english=false):string{
  if(s.profile==='warehouse_stage')return warehouseStageTitle(s,english);
  if(s.profile==='stage')return stageTitle(s,english);
  const label=english?{led:'LED screen',sound:'Point source sound system',microphones:'Microphone set'}[s.profile]:profileLabels[s.profile];
  return s.profile==='led'?`${label} ${s.selection.area} m²`:label;
}
export function modularScope(s:ProductConfigurationSnapshot,english=false):string[]{
  if(s.profile==='warehouse_stage')return warehouseStageScope(s,english);
  if(s.profile==='stage')return stageScope(s,english);
  const result=calculateModular(s,english);
  if(result.error)return [];
  return [...(s.profile==='led'&&s.selection.led_sections?ledSectionScope(s.selection.led_sections,english):[]),...result.lines.map(l=>`${l.name} — ${l.quantity} ${l.unit}`)];
}
export function missingModularEnglish(s:ProductConfigurationSnapshot):boolean {
  if(s.profile==='warehouse_stage')return missingWarehouseEnglish(s);
  if(s.profile==='led'&&s.catalog.led_tree)return calculateModular(s).lines.some(l=>{const id=l.key.split('/').pop();const root=s.catalog.led_tree!.roots.find(r=>r.id===id);const equipmentId=root?.equipment_id||Object.values(s.selection.led_equipment||{}).flatMap(n=>n.links).find(link=>link.id===id)?.equipment_id;return !equipmentId||!s.selection.led_equipment?.[equipmentId]?.name_en.trim();});
  return s.profile==='stage'?s.selection.accessories.some(a=>!a.name_en.trim()):s.catalog.components.some(r=>!r.name_en.trim() && calculateModular(s).lines.some(l=>l.key===r.id));
}
