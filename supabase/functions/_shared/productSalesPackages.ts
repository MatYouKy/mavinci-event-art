export type PackageCostSettlement = 'invoice' | 'cash_documented' | 'cash_non_deductible';
export const packageCostSettlementLabels: Record<PackageCostSettlement, string> = {
  invoice: 'Faktura / rachunek — koszt netto',
  cash_documented: 'Gotówka z dokumentem kosztowym',
  cash_non_deductible: 'Gotówka — finansowanie z zysku (CIT i dywidenda)',
};
export type PackageCostCompensationSnapshot = { cit_rate: number; dividend_rate: number; updated_at?: string };
export type ProductPackageCost = {
  id: string;
  name: string;
  quantity: number;
  /** Invoice net amount or cash paid to the contractor, before funding uplift. */
  unit_cost_net: number;
  settlement_method?: PackageCostSettlement;
  compensation_snapshot?: PackageCostCompensationSnapshot | null;
};
export type ProductPackageEquipment = {
  id: string; name: string; equipment_item_id: string | null; equipment_kit_id: string | null;
  quantity: number; is_optional: boolean; notes: string;
};
export type PackageStaffCompensation = {
  rate_basis: 'per_service' | 'hourly';
  rate: number;
  settlement_method: PackageCostSettlement;
  compensation_snapshot?: PackageCostCompensationSnapshot | null;
};
export type ProductPackageStaff = {
  id: string; role: string; quantity: number; estimated_hours: number | null; is_optional: boolean; notes: string;
  compensation?: PackageStaffCompensation | null;
};
export type ProductPackageResources = { equipment: ProductPackageEquipment[]; staff: ProductPackageStaff[] };
export type ProductSalesPackage = {
  id: string; name: string; description: string; included_label: string; element_ids: string[];
  extension_price_net_per_hour?: number | null;
  /** Internal estimate per one package; null/absent means not estimated, [] means explicitly zero. */
  cost_items?: ProductPackageCost[] | null;
  resources?: ProductPackageResources | null;
  price_net: number; bonus: string; highlighted: boolean; image_path: string | null; image_alt: string;
};
export type ProductPackageSelection = { selected_id: string; options: ProductSalesPackage[] };
export const PACKAGE_LAYOUT = { width: 595.28, height: 841.89, x: 33, widthCard: 529, tops: [180, 352, 524], heights: [160, 160, 160], imageX: 369, imageWidth: 177, textX: 107, textWidth: 247 };
export const PACKAGE_COPY = { title: 'WYBIERZ PAKIET\nDLA SWOJEGO WYDARZENIA', lead: 'Dopasuj zakres do charakteru swojego wydarzenia.', note: 'Skład pakietu i warunki realizacji potwierdzamy w ofercie.', steps: ['WYBIERZ PAKIET', 'USTAL ZAKRES', 'POTWIERDŹ REALIZACJĘ'] };
export function validateSalesPackages(options: ProductSalesPackage[]): string | null {
  if (!Array.isArray(options) || options.length > 3) return 'Możesz dodać maksymalnie trzy pakiety.';
  const ids = new Set<string>();
  for (const p of options) {
    if (!p || !/^[0-9a-f-]{36}$/i.test(p.id) || ids.has(p.id)) return 'Pakiety muszą mieć unikalne identyfikatory.';
    ids.add(p.id);
    const resourceError = validatePackageResources(p.resources);
    if (resourceError) return `${p.name || 'Pakiet'}: ${resourceError}`;
    const costError = validatePackageCosts(p.cost_items);
    if (costError) return `${p.name || 'Pakiet'}: ${costError}`;
    for (const [key, limit, label] of [['name', 42, 'nazwa'], ['description', 95, 'opis'], ['included_label', 95, 'zakres'], ['bonus', 65, 'bonus'], ['image_alt', 200, 'opis zdjęcia']] as const) {
      if (typeof p[key] !== 'string' || p[key].length > limit) return `Skróć treść pakietu (${label}): maks. ${limit} znaków.`;
    }
    if (!p.name.trim() || !p.included_label.trim()) return 'Podaj nazwę i zakres każdego pakietu.';
    if (!Number.isFinite(p.price_net) || p.price_net < 0 || p.price_net > 99999999 || Math.abs(p.price_net * 100 - Math.round(p.price_net * 100)) > .0001) return 'Podaj poprawną cenę pakietu z maksymalnie dwoma miejscami po przecinku.';
    if (!validPackageExtensionPrice(p.extension_price_net_per_hour)) return 'Podaj poprawną stawkę przedłużenia pakietu (netto, maksymalnie dwa miejsca po przecinku) lub pozostaw puste pole.';
    if (!Array.isArray(p.element_ids) || new Set(p.element_ids).size !== p.element_ids.length || p.element_ids.some(id => !/^[0-9a-f-]{36}$/i.test(id))) return 'Wybierz poprawne elementy pakietu.';
    if (typeof p.highlighted !== 'boolean' || (p.image_path !== null && (typeof p.image_path !== 'string' || p.image_path.length > 1000))) return 'Nieprawidłowe ustawienia pakietu.';
  }
  return null;
}
export function packageFor(selection?: ProductPackageSelection | null) { return selection?.options.find(p => p.id === selection.selected_id); }
export function pricedPackageSelection(selection: ProductPackageSelection, price: number): ProductPackageSelection {
  return { ...selection, options: selection.options.map(p => p.id === selection.selected_id ? { ...p, price_net: price } : { ...p }) };
}

export function validPackageExtensionPrice(value: unknown): boolean {
  return value == null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 99999999 && Math.abs(value * 100 - Math.round(value * 100)) <= .0001);
}
export function packageExtensionLabel(p: Pick<ProductSalesPackage, 'extension_price_net_per_hour'>): string {
  const rate = p.extension_price_net_per_hour;
  if (rate == null || !validPackageExtensionPrice(rate)) return '';
  return `Dodatkowa godzina: ${rate.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł netto`;
}


export function validatePackageCosts(value: unknown): string | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 40) return 'Możesz dodać maksymalnie 40 pozycji kosztowych.';
  const ids = new Set<string>();
  for (const row of value) {
    if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 100 || ids.has(row.id)) return 'Pozycje kosztowe muszą mieć unikalne identyfikatory.';
    ids.add(row.id);
    if (row.settlement_method != null && !Object.prototype.hasOwnProperty.call(packageCostSettlementLabels, row.settlement_method)) return 'Wybierz poprawny sposób rozliczenia kosztu.';
    if (row.settlement_method === 'cash_non_deductible' && !validPackageCompensationSnapshot(row.compensation_snapshot)) return 'Wczytaj parametry CIT i dywidendy z ustawień wynagrodzeń.';
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 120) return 'Podaj nazwę kosztu (maks. 120 znaków).';
    if (typeof row.quantity !== 'number' || row.quantity <= 0 || row.quantity > 100000 || !validPackageExtensionPrice(row.quantity)) return 'Podaj dodatnią ilość kosztu z maksymalnie dwoma miejscami po przecinku.';
    if (typeof row.unit_cost_net !== 'number' || !validPackageExtensionPrice(row.unit_cost_net)) return 'Podaj nieujemną stawkę kosztu netto z maksymalnie dwoma miejscami po przecinku.';
  }
  if (value.reduce((total, row) => total + Math.round(packageCostLineNet(row)! * 100), 0) > 9999999900) return 'Łączny koszt pakietu jest zbyt wysoki.';
  return null;
}
export function packageCostNet(p: Pick<ProductSalesPackage, 'cost_items' | 'resources'>): number | null {
  if (validatePackageCosts(p.cost_items) || validatePackageResources(p.resources)) return null;
  const staffCosts = packageStaffCostItems(p.resources);
  if (p.cost_items == null && !staffCosts.length) return null;
  return [...(p.cost_items || []), ...staffCosts].reduce((total, row) => total + Math.round(packageCostLineNet(row)! * 100), 0) / 100;
}

export function validatePackageResources(value: ProductPackageResources | null | undefined): string | null {
  if (value == null) return null;
  if (!Array.isArray(value.equipment) || !Array.isArray(value.staff) || value.equipment.length > 100 || value.staff.length > 40) return 'Dodaj maksymalnie 100 pozycji sprzętu i 40 ról.';
  const ids = new Set<string>();
  const equipmentIds = new Set<string>();
  for (const row of [...value.equipment, ...value.staff]) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)) return 'Zasoby muszą mieć unikalne identyfikatory.';
    ids.add(row.id);
    if (!Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 10000) return 'Podaj całkowitą ilość zasobu od 1 do 10 000.';
    if (typeof row.is_optional !== 'boolean' || typeof row.notes !== 'string' || row.notes.length > 500) return 'Notatki zasobu mogą mieć maksymalnie 500 znaków.';
  }
  for (const row of value.equipment) {
    const id = row.equipment_item_id || row.equipment_kit_id;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id) || Boolean(row.equipment_item_id) === Boolean(row.equipment_kit_id)) return 'Wybierz sprzęt lub zestaw z katalogu.';
    const key = `${row.equipment_item_id ? 'item' : 'kit'}:${id}`;
    if (equipmentIds.has(key)) return 'Sprzęt jest już na liście. Zmień jego ilość.';
    equipmentIds.add(key);
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 300) return 'Brakuje nazwy sprzętu.';
  }
  for (const row of value.staff) {
    if (typeof row.role !== 'string' || !row.role.trim() || row.role.length > 120) return 'Podaj nazwę roli (maks. 120 znaków).';
    if (row.estimated_hours != null && (!validPackageExtensionPrice(row.estimated_hours) || row.estimated_hours > 10000)) return 'Podaj poprawny czas pracy (maks. 10 000 godzin).';
    if (row.compensation) {
      if (!['per_service', 'hourly'].includes(row.compensation.rate_basis)) return 'Wybierz stawkę za realizację lub za godzinę.';
      if (row.compensation.rate_basis === 'hourly' && !(Number.isFinite(row.estimated_hours) && Number(row.estimated_hours) > 0)) return 'Podaj liczbę godzin dla rozliczenia godzinowego obsady.';
      const costError = validatePackageCosts([staffCostItem(row)!]);
      if (costError) return `${row.role}: ${costError}`;
    }
  }
  return null;
}

export function validPackageCompensationSnapshot(value: unknown): value is PackageCostCompensationSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as PackageCostCompensationSnapshot;
  return [snapshot.cit_rate, snapshot.dividend_rate].every(rate => typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate < 100);
}
/** Same sequential CIT/dividend funding model as compensation settings; use saved rates. */
export function packageCostLineNet(row: ProductPackageCost): number | null {
  if (!Number.isFinite(row.quantity) || row.quantity <= 0 || !Number.isFinite(row.unit_cost_net) || row.unit_cost_net < 0) return null;
  let cost = row.quantity * row.unit_cost_net;
  if (row.settlement_method === 'cash_non_deductible') {
    if (!validPackageCompensationSnapshot(row.compensation_snapshot)) return null;
    cost /= (1 - row.compensation_snapshot.cit_rate / 100) * (1 - row.compensation_snapshot.dividend_rate / 100);
  }
  return Math.round((cost + Number.EPSILON) * 100) / 100;
}

/** Staff compensation is derived, never copied into manual cost_items. */
export function staffCostItem(row: ProductPackageStaff): ProductPackageCost | null {
  const payment = row.compensation;
  if (!payment) return null;
  return {
    id: `staff:${row.id}`, name: row.role,
    quantity: Math.round(row.quantity * (payment.rate_basis === 'hourly' ? Number(row.estimated_hours || 0) : 1) * 100) / 100,
    unit_cost_net: payment.rate, settlement_method: payment.settlement_method,
    compensation_snapshot: payment.compensation_snapshot,
  };
}
export function packageStaffCostItems(resources?: ProductPackageResources | null): ProductPackageCost[] {
  return (resources?.staff || []).filter(row => !row.is_optional && row.compensation).map(row => staffCostItem(row)!);
}
