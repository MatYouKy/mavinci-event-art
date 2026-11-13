import { parseContractClauseEntries } from '@/lib/CRM/contracts/contractClauseContent';
import { packageCostNet, type ProductSalesPackage } from './productSalesPackages';

/**
 * Gotowość produktu do oferty — jedna reguła dla katalogu, karty produktu i (później) aplikacji na Maca.
 *
 * Produkt jest gotowy, gdy ma:
 * 1. Cenę i koszt — cenę sprzedaży (produktu, wariantów, pakietów albo z konfiguratora) i znany koszt realizacji
 *    (koszt netto, koszt podwykonawcy, stawki obsady albo koszty pakietów), żeby marża i prowizje były prawdziwe.
 * 2. Zdjęcie i opisy do PDF — zdjęcie oferty, zdanie pod tytułem, opis rozszerzony i co najmniej jedną korzyść.
 * 3. Sprzęt i obsadę — sprzęt z magazynu i ludzi do realizacji (w produkcie z pakietami — w każdym pakiecie).
 * 4. Klauzule umowy — co najmniej jedną klauzulę, która trafi do umowy wydarzenia.
 *
 * Koszt, sprzęt, obsada i klauzule mogą „nie dotyczyć” konkretnego produktu (np. występ artysty z własnym sprzętem,
 * koszt 0 zł przy własnym sprzęcie) — wtedy produkt ma wpis w `offer_products.readiness_exemptions` z powodem.
 * Usługa podwykonawcy nie wymaga własnego sprzętu i obsady, usługa personelu — sprzętu.
 */

export type ReadinessGroupKey = 'pricing' | 'presentation' | 'resources' | 'clauses';
export type ReadinessCheckKey = 'price' | 'cost' | 'image' | 'short_description' | 'description' | 'benefits' | 'equipment' | 'staff' | 'clauses';
export type ReadinessExemptionKey = 'cost' | 'equipment' | 'staff' | 'clauses';
export type ReadinessState = 'ok' | 'missing' | 'not_applicable' | 'waived';

export type ReadinessExemption = { reason: string; by?: string | null; at?: string | null };
export type ReadinessExemptions = Partial<Record<ReadinessExemptionKey, ReadinessExemption>>;

export const READINESS_GROUPS: Array<{ key: ReadinessGroupKey; label: string; short: string }> = [
  { key: 'pricing', label: 'Cena i koszt', short: 'Cena i koszt' },
  { key: 'presentation', label: 'Zdjęcie i opisy do PDF', short: 'Zdjęcie i opisy' },
  { key: 'resources', label: 'Sprzęt i obsada', short: 'Sprzęt i obsada' },
  { key: 'clauses', label: 'Klauzule umowy', short: 'Klauzule' },
];

/** Krótkie nazwy wymagań do list („Braki: koszt, zdjęcie, obsada”). */
export const READINESS_CHECK_SHORT: Record<ReadinessCheckKey, string> = {
  price: 'cena', cost: 'koszt', image: 'zdjęcie', short_description: 'zdanie pod tytułem', description: 'opis',
  benefits: 'korzyści', equipment: 'sprzęt', staff: 'obsada', clauses: 'klauzule',
};

export const READINESS_EXEMPTION_KEYS: ReadinessExemptionKey[] = ['cost', 'equipment', 'staff', 'clauses'];
export const READINESS_EXEMPTION_REASON_MAX = 300;

/** Sekcje karty produktu (atrybut `id`), do których prowadzi „Uzupełnij”. */
export const PRODUCT_SECTION_ANCHORS = {
  pricing: 'product-section-pricing',
  presentation: 'product-section-presentation',
  packages: 'product-section-packages',
  equipment: 'product-section-equipment',
  staff: 'product-section-staff',
  clauses: 'product-section-clauses',
} as const;

type ReadinessVariant = {
  is_active?: boolean | null;
  price_net?: number | null;
  overrides_contract_clauses?: boolean | null;
  recommended_contract_clauses?: string | null;
};

export type ReadinessProduct = {
  is_active?: boolean | null;
  price_net?: number | null;
  base_price?: number | null;
  cost_net?: number | null;
  cost_price?: number | null;
  subcontractor_economic_cost?: number | null;
  is_subcontractor_service?: boolean | null;
  is_personnel_service?: boolean | null;
  sales_packages_enabled?: boolean | null;
  sales_packages?: ProductSalesPackage[] | null;
  configuration_schema?: unknown;
  offer_image_path?: string | null;
  offer_short_description?: string | null;
  offer_description?: string | null;
  offer_benefits?: unknown;
  recommended_contract_clauses?: string | null;
  readiness_exemptions?: unknown;
  variants?: ReadinessVariant[] | null;
  offer_product_variants?: ReadinessVariant[] | null;
};

export type ReadinessStaffRow = {
  hourly_rate?: number | null;
  estimated_hours?: number | null;
  compensation?: unknown;
  is_optional?: boolean | null;
};

/** Sprzęt i obsada produktu (bez pakietów) — z `offer_product_equipment` i `offer_product_staff`, łącznie z wariantami. */
export type ReadinessResources = { equipmentCount: number; staff: ReadinessStaffRow[] };

export type ReadinessCheck = {
  key: ReadinessCheckKey;
  group: ReadinessGroupKey;
  label: string;
  state: ReadinessState;
  detail: string;
  anchor: string;
  /** Wymaganie, które może „nie dotyczyć” produktu (z powodem). */
  exemptionKey: ReadinessExemptionKey | null;
  exemption: ReadinessExemption | null;
};

export type ReadinessGroup = { key: ReadinessGroupKey; label: string; short: string; ok: boolean; checks: ReadinessCheck[] };
export type ProductReadiness = { ready: boolean; groups: ReadinessGroup[]; missing: ReadinessCheck[] };

const money = (value: number) => `${value.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} zł`;
const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;
const filled = (value: unknown) => typeof value === 'string' && value.replace(/<[^>]*>/g, ' ').trim().length > 0;
const passes = (state: ReadinessState) => state !== 'missing';
const plural = (count: number, one: string, few: string, many: string) => {
  if (count === 1) return `1 ${one}`;
  const few_ = [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100);
  return `${count} ${few_ ? few : many}`;
};

/** Wpisy „nie dotyczy” z bazy — tylko znane wymagania z niepustym powodem. */
export function normalizeReadinessExemptions(value: unknown): ReadinessExemptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: ReadinessExemptions = {};
  for (const key of READINESS_EXEMPTION_KEYS) {
    const entry = (value as Record<string, unknown>)[key];
    if (!entry || typeof entry !== 'object') continue;
    const reason = String((entry as ReadinessExemption).reason || '').trim();
    if (!reason) continue;
    result[key] = {
      reason: reason.slice(0, READINESS_EXEMPTION_REASON_MAX),
      by: typeof (entry as ReadinessExemption).by === 'string' ? (entry as ReadinessExemption).by : null,
      at: typeof (entry as ReadinessExemption).at === 'string' ? (entry as ReadinessExemption).at : null,
    };
  }
  return result;
}

export function withReadinessExemption(current: unknown, key: ReadinessExemptionKey, reason: string, by: string | null): ReadinessExemptions {
  const text = reason.trim();
  if (text.length < 3) throw new Error('Wpisz powód (co najmniej 3 znaki).');
  if (text.length > READINESS_EXEMPTION_REASON_MAX) throw new Error(`Powód może mieć najwyżej ${READINESS_EXEMPTION_REASON_MAX} znaków.`);
  return { ...normalizeReadinessExemptions(current), [key]: { reason: text, by, at: new Date().toISOString() } };
}

export function withoutReadinessExemption(current: unknown, key: ReadinessExemptionKey): ReadinessExemptions {
  const next = { ...normalizeReadinessExemptions(current) };
  delete next[key];
  return next;
}

const activePackages = (product: ReadinessProduct): ProductSalesPackage[] =>
  product.sales_packages_enabled && Array.isArray(product.sales_packages) ? product.sales_packages : [];

const listNames = (packages: ProductSalesPackage[]) => packages.map((item) => `„${item.name || 'Pakiet'}”`).join(', ');

/** Stawka obsady, z której wynika koszt (stawka godzinowa z liczbą godzin albo wynagrodzenie za realizację). */
const staffHasCost = (row: ReadinessStaffRow) => {
  if (row.is_optional) return false;
  const compensation = row.compensation as { rate?: unknown } | null | undefined;
  if (compensation && typeof compensation === 'object' && positive(compensation.rate)) return true;
  return positive(row.hourly_rate) && positive(row.estimated_hours);
};

export function productReadiness(product: ReadinessProduct, resources: ReadinessResources | null): ProductReadiness {
  const exemptions = normalizeReadinessExemptions(product.readiness_exemptions);
  const packages = activePackages(product);
  const variants = (product.offer_product_variants || product.variants || []).filter((variant) => variant?.is_active !== false);
  const subcontractor = product.is_subcontractor_service === true;
  const personnel = product.is_personnel_service === true;
  const checks: ReadinessCheck[] = [];

  const add = (check: Omit<ReadinessCheck, 'exemption'>) => {
    const exemption = check.exemptionKey ? exemptions[check.exemptionKey] || null : null;
    if (check.state === 'missing' && exemption) {
      checks.push({ ...check, state: 'waived', detail: `Nie dotyczy: ${exemption.reason}`, exemption });
      return;
    }
    checks.push({ ...check, exemption: check.state === 'missing' ? null : exemption });
  };

  // 1. Cena i koszt
  const pricingAnchor = packages.length ? PRODUCT_SECTION_ANCHORS.packages : PRODUCT_SECTION_ANCHORS.pricing;
  const basePrice = Number(product.price_net ?? product.base_price ?? 0);
  if (packages.length) {
    const unpriced = packages.filter((item) => !(positive(item.price_net) || item.price_on_request));
    add({
      key: 'price', group: 'pricing', label: 'Cena sprzedaży', anchor: pricingAnchor, exemptionKey: null,
      state: unpriced.length ? 'missing' : 'ok',
      detail: unpriced.length ? `Brak ceny w pakiecie ${listNames(unpriced)}.` : 'Ceny we wszystkich pakietach.',
    });
  } else {
    const variantPrices = variants.map((variant) => Number(variant.price_net || 0)).filter((value) => value > 0);
    const configurable = Boolean((product.configuration_schema as { profile?: unknown } | null | undefined)?.profile);
    const state: ReadinessState = basePrice > 0 || variantPrices.length || configurable ? 'ok' : 'missing';
    add({
      key: 'price', group: 'pricing', label: 'Cena sprzedaży', anchor: pricingAnchor, exemptionKey: null, state,
      detail: basePrice > 0 ? `${money(basePrice)} netto`
        : variantPrices.length ? `Od ${money(Math.min(...variantPrices))} netto (warianty)`
          : configurable ? 'Cena z konfiguratora.' : 'Podaj cenę netto produktu albo jego wariantów.',
    });
  }

  if (packages.length) {
    const uncosted = packages.filter((item) => packageCostNet(item) == null);
    add({
      key: 'cost', group: 'pricing', label: 'Koszt realizacji', anchor: pricingAnchor, exemptionKey: 'cost',
      state: uncosted.length ? 'missing' : 'ok',
      detail: uncosted.length ? `Brak kosztów w pakiecie ${listNames(uncosted)}.` : 'Koszty we wszystkich pakietach.',
    });
  } else {
    const costNet = Number(product.cost_net ?? product.cost_price ?? 0);
    const subcontractorCost = Number(product.subcontractor_economic_cost || 0);
    const staffCost = (resources?.staff || []).some(staffHasCost);
    add({
      key: 'cost', group: 'pricing', label: 'Koszt realizacji', anchor: PRODUCT_SECTION_ANCHORS.pricing, exemptionKey: 'cost',
      state: costNet > 0 || (subcontractor && subcontractorCost > 0) || staffCost ? 'ok' : 'missing',
      detail: costNet > 0 ? `${money(costNet)} netto`
        : subcontractor && subcontractorCost > 0 ? `Koszt podwykonawcy ${money(subcontractorCost)}`
          : staffCost ? 'Koszt ze stawek obsady.'
            : 'Podaj koszt netto — bez niego marża i prowizje w ofercie są zawyżone.',
    });
  }

  // 2. Zdjęcie i opisy do PDF
  const presentation = PRODUCT_SECTION_ANCHORS.presentation;
  add({
    key: 'image', group: 'presentation', label: 'Zdjęcie do oferty', anchor: presentation, exemptionKey: null,
    state: filled(product.offer_image_path) ? 'ok' : 'missing',
    detail: filled(product.offer_image_path) ? 'Dodane.' : 'Dodaj zdjęcie główne produktu.',
  });
  add({
    key: 'short_description', group: 'presentation', label: 'Zdanie pod tytułem', anchor: presentation, exemptionKey: null,
    state: filled(product.offer_short_description) ? 'ok' : 'missing',
    detail: filled(product.offer_short_description) ? 'Uzupełnione.' : 'Dopisz jedno zdanie pod tytułem produktu.',
  });
  add({
    key: 'description', group: 'presentation', label: 'Opis rozszerzony', anchor: presentation, exemptionKey: null,
    state: filled(product.offer_description) ? 'ok' : 'missing',
    detail: filled(product.offer_description) ? 'Uzupełniony.' : 'Dopisz opis produktu do oferty.',
  });
  const benefits = Array.isArray(product.offer_benefits) ? product.offer_benefits.filter(filled) : [];
  add({
    key: 'benefits', group: 'presentation', label: 'Korzyści', anchor: presentation, exemptionKey: null,
    state: benefits.length ? 'ok' : 'missing',
    detail: benefits.length ? `${plural(benefits.length, 'korzyść', 'korzyści', 'korzyści')}.` : 'Dopisz co najmniej jedną korzyść dla klienta.',
  });

  // 3. Sprzęt i obsada
  if (subcontractor) {
    add({ key: 'equipment', group: 'resources', label: 'Sprzęt', anchor: PRODUCT_SECTION_ANCHORS.equipment, exemptionKey: null,
      state: 'not_applicable', detail: 'Usługa podwykonawcy — sprzęt zapewnia podwykonawca.' });
    add({ key: 'staff', group: 'resources', label: 'Obsada', anchor: PRODUCT_SECTION_ANCHORS.staff, exemptionKey: null,
      state: 'not_applicable', detail: 'Usługa podwykonawcy — obsadę zapewnia podwykonawca.' });
  } else if (packages.length) {
    const noEquipment = packages.filter((item) => !(item.resources?.equipment || []).length);
    const noStaff = packages.filter((item) => !(item.resources?.staff || []).length);
    add({
      key: 'equipment', group: 'resources', label: 'Sprzęt', anchor: PRODUCT_SECTION_ANCHORS.packages,
      exemptionKey: personnel ? null : 'equipment',
      state: personnel ? 'not_applicable' : noEquipment.length ? 'missing' : 'ok',
      detail: personnel ? 'Usługa personelu — bez sprzętu.'
        : noEquipment.length ? `Brak sprzętu w pakiecie ${listNames(noEquipment)}.` : 'Sprzęt we wszystkich pakietach.',
    });
    add({
      key: 'staff', group: 'resources', label: 'Obsada', anchor: PRODUCT_SECTION_ANCHORS.packages, exemptionKey: 'staff',
      state: noStaff.length ? 'missing' : 'ok',
      detail: noStaff.length ? `Brak obsady w pakiecie ${listNames(noStaff)}.` : 'Obsada we wszystkich pakietach.',
    });
  } else {
    const equipmentCount = resources?.equipmentCount ?? 0;
    const staffCount = (resources?.staff || []).length;
    add({
      key: 'equipment', group: 'resources', label: 'Sprzęt', anchor: PRODUCT_SECTION_ANCHORS.equipment,
      exemptionKey: personnel ? null : 'equipment',
      state: personnel ? 'not_applicable' : resources == null ? 'missing' : equipmentCount ? 'ok' : 'missing',
      detail: personnel ? 'Usługa personelu — bez sprzętu.'
        : resources == null ? 'Nie udało się sprawdzić sprzętu.'
          : equipmentCount ? `${plural(equipmentCount, 'pozycja', 'pozycje', 'pozycji')} sprzętu.` : 'Przypisz sprzęt z magazynu potrzebny do realizacji.',
    });
    add({
      key: 'staff', group: 'resources', label: 'Obsada', anchor: PRODUCT_SECTION_ANCHORS.staff, exemptionKey: 'staff',
      state: resources == null ? 'missing' : staffCount ? 'ok' : 'missing',
      detail: resources == null ? 'Nie udało się sprawdzić obsady.'
        : staffCount ? `${plural(staffCount, 'rola', 'role', 'ról')} w obsadzie.` : 'Dodaj role i liczbę osób potrzebnych do realizacji.',
    });
  }

  // 4. Klauzule umowy
  const clauseCount = parseContractClauseEntries(product.recommended_contract_clauses).length
    + variants.filter((variant) => variant.overrides_contract_clauses)
      .reduce((total, variant) => total + parseContractClauseEntries(variant.recommended_contract_clauses).length, 0);
  add({
    key: 'clauses', group: 'clauses', label: 'Klauzule umowy', anchor: PRODUCT_SECTION_ANCHORS.clauses, exemptionKey: 'clauses',
    state: clauseCount ? 'ok' : 'missing',
    detail: clauseCount ? `${plural(clauseCount, 'klauzula', 'klauzule', 'klauzul')}.` : 'Dodaj klauzule, które trafią do umowy wydarzenia.',
  });

  const groups = READINESS_GROUPS.map((group) => {
    const groupChecks = checks.filter((check) => check.group === group.key);
    return { ...group, checks: groupChecks, ok: groupChecks.every((check) => passes(check.state)) };
  });
  const missing = checks.filter((check) => check.state === 'missing');
  return { ready: missing.length === 0, groups, missing };
}
