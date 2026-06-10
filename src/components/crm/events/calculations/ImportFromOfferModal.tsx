import { ArrowLeft, FileDown, Package, Users, Truck } from 'lucide-react';
import { CATEGORY_META } from './calculations.constants';
import { CalcItem, Category } from './EventCalculationsTab';
import { DEFAULT_VAT, fmt } from '../helpers/calculations/calculations.helper';
import { guessCategory } from './calculations.utils';
import { ImportableItem } from './calculations.types';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';

type ImportMode = 'products' | 'contents' | 'transport';

interface EquipmentRow {
  id: string;
  name: string;
  brand: string | null;
  quantity: number;
  rentalPrice: number;
  productName: string;
  offerName: string;
  isKit: boolean;
  isRental: boolean;
}

interface StaffRow {
  id: string;
  role: string;
  quantity: number;
  hourlyRate: number;
  estimatedHours: number;
  productName: string;
  offerName: string;
}

interface VehicleRow {
  id: string;
  vehicleName: string;
  role: string;
  driverName: string | null;
  estimatedDistance: number | null;
  fuelCost: number | null;
  tollCost: number | null;
}

const ROLE_LABELS: Record<string, string> = {
  transport_equipment: 'Transport sprzętu',
  transport_crew: 'Transport ekipy',
  support: 'Wsparcie',
};

export function ImportFromOfferModal({
  eventId,
  existingRefs,
  onClose,
  onImport,
}: {
  eventId: string;
  existingRefs: Set<string>;
  onClose: () => void;
  onImport: (items: CalcItem[]) => void;
}) {
  const [mode, setMode] = useState<ImportMode>('products');
  const [loading, setLoading] = useState(true);

  const [offerItems, setOfferItems] = useState<ImportableItem[]>([]);
  const [equipmentRows, setEquipmentRows] = useState<EquipmentRow[]>([]);
  const [staffRows, setStaffRows] = useState<StaffRow[]>([]);
  const [vehicleRows, setVehicleRows] = useState<VehicleRow[]>([]);

  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [selectedEquipment, setSelectedEquipment] = useState<Set<string>>(new Set());
  const [selectedStaff, setSelectedStaff] = useState<Set<string>>(new Set());
  const [selectedVehicles, setSelectedVehicles] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchData();
  }, [eventId]);

  const fetchData = async () => {
    setLoading(true);

    const { data: offers } = await supabase
      .from('offers')
      .select('id, offer_number')
      .eq('event_id', eventId);

    if (!offers?.length) {
      setOfferItems([]);
      setEquipmentRows([]);
      setStaffRows([]);
      setLoading(false);
      fetchVehicles();
      return;
    }

    const offerIds = offers.map((o) => o.id);

    await Promise.all([
      fetchOfferItems(offerIds, offers),
      fetchEquipmentAndStaff(offerIds, offers),
      fetchVehicles(),
    ]);

    setLoading(false);
  };

  const fetchOfferItems = async (offerIds: string[], offers: any[]) => {
    const { data: itemsData } = await supabase
      .from('offer_items')
      .select('*')
      .in('offer_id', offerIds)
      .order('display_order');

    const productIds = Array.from(
      new Set((itemsData ?? []).map((it: any) => it.product_id).filter(Boolean)),
    );

    let productMap = new Map<string, { category_id: string | null; vat_rate: number | null }>();
    let categoryMap = new Map<string, string>();

    if (productIds.length) {
      const { data: products } = await supabase
        .from('offer_products')
        .select('id, category_id, vat_rate')
        .in('id', productIds);
      (products ?? []).forEach((p: any) => productMap.set(p.id, p));

      const catIds = Array.from(
        new Set((products ?? []).map((p: any) => p.category_id).filter(Boolean)),
      );
      if (catIds.length) {
        const { data: cats } = await supabase
          .from('event_categories')
          .select('id, name')
          .in('id', catIds);
        (cats ?? []).forEach((c: any) => categoryMap.set(c.id, c.name));
      }
    }

    const mapped: ImportableItem[] = (itemsData ?? []).map((it: any) => {
      const off = offers.find((o) => o.id === it.offer_id);
      const product = it.product_id ? productMap.get(it.product_id) : null;
      const categoryName =
        product && product.category_id ? (categoryMap.get(product.category_id) ?? null) : null;
      const productVat = product && product.vat_rate != null ? Number(product.vat_rate) : null;
      return {
        id: it.id,
        name: it.name,
        description: it.description,
        quantity: Number(it.quantity || 1),
        unit: it.unit,
        unit_price: Number(it.unit_price || 0),
        total: Number(it.total || 0),
        offerId: it.offer_id,
        offerName: off?.offer_number || 'Oferta',
        categoryName,
        autoCategory: guessCategory(categoryName, it.name),
        vat_rate: productVat ?? DEFAULT_VAT,
        power_watts: null,
        power_source_ref: null,
      };
    });

    setOfferItems(mapped);
  };

  const fetchEquipmentAndStaff = async (offerIds: string[], offers: any[]) => {
    const { data: itemsData } = await supabase
      .from('offer_items')
      .select('id, offer_id, product_id, name, quantity')
      .in('offer_id', offerIds);

    if (!itemsData?.length) return;

    const productIds = Array.from(
      new Set(itemsData.map((it: any) => it.product_id).filter(Boolean)),
    );

    if (!productIds.length) return;

    const { data: prodEquipment } = await supabase
      .from('offer_product_equipment')
      .select(
        `id, product_id, equipment_item_id, equipment_kit_id, rental_equipment_id, quantity, is_rental, notes`,
      )
      .in('product_id', productIds);

    const { data: prodStaff } = await supabase
      .from('offer_product_staff')
      .select('id, product_id, role, quantity, hourly_rate, estimated_hours, notes')
      .in('product_id', productIds);

    const equipItemIds = (prodEquipment ?? [])
      .map((e: any) => e.equipment_item_id)
      .filter(Boolean);
    const equipKitIds = (prodEquipment ?? []).map((e: any) => e.equipment_kit_id).filter(Boolean);
    const rentalIds = (prodEquipment ?? [])
      .map((e: any) => e.rental_equipment_id)
      .filter(Boolean);

    let equipNameMap = new Map<string, { name: string; brand: string | null; rental_price_per_day: number | null }>();
    let kitNameMap = new Map<string, string>();
    let rentalNameMap = new Map<string, { name: string; daily_rate: number | null }>();

    if (equipItemIds.length) {
      const { data } = await supabase
        .from('equipment_items')
        .select('id, name, brand, rental_price_per_day')
        .in('id', equipItemIds);
      (data ?? []).forEach((e: any) => equipNameMap.set(e.id, e));
    }
    if (equipKitIds.length) {
      const { data } = await supabase
        .from('equipment_kits')
        .select('id, name')
        .in('id', equipKitIds);
      (data ?? []).forEach((k: any) => kitNameMap.set(k.id, k.name));
    }
    if (rentalIds.length) {
      const { data } = await supabase
        .from('subcontractor_rental_equipment')
        .select('id, name, daily_rate')
        .in('id', rentalIds);
      (data ?? []).forEach((r: any) => rentalNameMap.set(r.id, r));
    }

    const productNameMap = new Map<string, string>();
    itemsData.forEach((it: any) => {
      if (it.product_id) productNameMap.set(it.product_id, it.name);
    });

    const eqRows: EquipmentRow[] = [];
    (prodEquipment ?? []).forEach((pe: any) => {
      const offer = offers.find((o) =>
        itemsData.some((it: any) => it.offer_id === o.id && it.product_id === pe.product_id),
      );
      const offerName = offer?.offer_number || 'Oferta';
      const productName = productNameMap.get(pe.product_id) || '';

      if (pe.equipment_item_id) {
        const eq = equipNameMap.get(pe.equipment_item_id);
        eqRows.push({
          id: `eq_${pe.id}`,
          name: eq ? `${eq.name}${eq.brand ? ` (${eq.brand})` : ''}` : 'Sprzęt',
          brand: eq?.brand ?? null,
          quantity: pe.quantity || 1,
          rentalPrice: eq?.rental_price_per_day ?? 0,
          productName,
          offerName,
          isKit: false,
          isRental: false,
        });
      } else if (pe.equipment_kit_id) {
        const kitName = kitNameMap.get(pe.equipment_kit_id);
        eqRows.push({
          id: `kit_${pe.id}`,
          name: kitName || 'Zestaw',
          brand: null,
          quantity: pe.quantity || 1,
          rentalPrice: 0,
          productName,
          offerName,
          isKit: true,
          isRental: false,
        });
      } else if (pe.rental_equipment_id) {
        const rental = rentalNameMap.get(pe.rental_equipment_id);
        eqRows.push({
          id: `rental_${pe.id}`,
          name: rental?.name || 'Rental',
          brand: null,
          quantity: pe.quantity || 1,
          rentalPrice: rental?.daily_rate ?? 0,
          productName,
          offerName,
          isKit: false,
          isRental: true,
        });
      }
    });

    setEquipmentRows(eqRows);

    const stRows: StaffRow[] = (prodStaff ?? []).map((ps: any) => {
      const offer = offers.find((o) =>
        itemsData.some((it: any) => it.offer_id === o.id && it.product_id === ps.product_id),
      );
      return {
        id: `staff_${ps.id}`,
        role: ps.role,
        quantity: ps.quantity || 1,
        hourlyRate: Number(ps.hourly_rate || 0),
        estimatedHours: Number(ps.estimated_hours || 0),
        productName: productNameMap.get(ps.product_id) || '',
        offerName: offer?.offer_number || 'Oferta',
      };
    });

    setStaffRows(stRows);
  };

  const fetchVehicles = async () => {
    const { data: vehicles } = await supabase
      .from('event_vehicles')
      .select(
        `id, role, estimated_distance_km, fuel_cost_estimate, toll_cost_estimate,
         vehicle:vehicles(id, brand, model, registration_number),
         driver:employees!event_vehicles_driver_id_fkey(id, first_name, last_name)`,
      )
      .eq('event_id', eventId)
      .neq('status', 'cancelled');

    const vRows: VehicleRow[] = (vehicles ?? []).map((v: any) => ({
      id: `veh_${v.id}`,
      vehicleName: v.vehicle
        ? `${v.vehicle.brand || ''} ${v.vehicle.model || ''} (${v.vehicle.registration_number || ''})`.trim()
        : 'Pojazd',
      role: v.role || 'transport_equipment',
      driverName: v.driver ? `${v.driver.first_name} ${v.driver.last_name}` : null,
      estimatedDistance: v.estimated_distance_km ? Number(v.estimated_distance_km) : null,
      fuelCost: v.fuel_cost_estimate ? Number(v.fuel_cost_estimate) : null,
      tollCost: v.toll_cost_estimate ? Number(v.toll_cost_estimate) : null,
    }));

    setVehicleRows(vRows);
  };

  const toggleProduct = (id: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleEquipment = (id: string) => {
    setSelectedEquipment((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleStaff = (id: string) => {
    setSelectedStaff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleVehicle = (id: string) => {
    setSelectedVehicles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllProducts = () => {
    const available = offerItems.filter((it) => !existingRefs.has(it.id));
    if (selectedProducts.size === available.length) setSelectedProducts(new Set());
    else setSelectedProducts(new Set(available.map((it) => it.id)));
  };

  const toggleAllEquipment = () => {
    const available = equipmentRows.filter((it) => !existingRefs.has(it.id));
    if (selectedEquipment.size === available.length) setSelectedEquipment(new Set());
    else setSelectedEquipment(new Set(available.map((it) => it.id)));
  };

  const toggleAllStaff = () => {
    const available = staffRows.filter((it) => !existingRefs.has(it.id));
    if (selectedStaff.size === available.length) setSelectedStaff(new Set());
    else setSelectedStaff(new Set(available.map((it) => it.id)));
  };

  const toggleAllVehicles = () => {
    const available = vehicleRows.filter((it) => !existingRefs.has(it.id));
    if (selectedVehicles.size === available.length) setSelectedVehicles(new Set());
    else setSelectedVehicles(new Set(available.map((it) => it.id)));
  };

  const currentSelected = () => {
    if (mode === 'products') return selectedProducts;
    if (mode === 'contents') return new Set([...selectedEquipment, ...selectedStaff]);
    return selectedVehicles;
  };

  const handleImport = () => {
    const picked: CalcItem[] = [];

    if (mode === 'products') {
      offerItems
        .filter((it) => selectedProducts.has(it.id))
        .forEach((it, idx) => {
          picked.push({
            category: it.autoCategory,
            name: it.name,
            description: it.description || '',
            unit: it.unit || 'szt.',
            quantity: it.quantity,
            unit_price: it.unit_price,
            days: 1,
            source: 'offer',
            source_ref: it.id,
            position: idx,
            vat_rate: it.vat_rate,
            power_watts: null,
            power_source_ref: null,
          });
        });
    } else if (mode === 'contents') {
      let pos = 0;

      equipmentRows
        .filter((eq) => selectedEquipment.has(eq.id))
        .forEach((eq) => {
          picked.push({
            category: 'equipment',
            name: eq.name,
            description: eq.productName ? `Z produktu: ${eq.productName}` : '',
            unit: eq.isKit ? 'zest.' : 'szt.',
            quantity: eq.quantity,
            unit_price: eq.rentalPrice,
            days: 1,
            source: 'offer',
            source_ref: eq.id,
            position: pos++,
            vat_rate: DEFAULT_VAT,
            power_watts: null,
            power_source_ref: null,
          });
        });

      staffRows
        .filter((s) => selectedStaff.has(s.id))
        .forEach((s) => {
          const totalCost = s.hourlyRate * s.estimatedHours;
          picked.push({
            category: 'staff',
            name: s.role,
            description: s.productName ? `Z produktu: ${s.productName}` : '',
            unit: 'os.',
            quantity: s.quantity,
            unit_price: totalCost > 0 ? totalCost : s.hourlyRate,
            days: 1,
            source: 'offer',
            source_ref: s.id,
            position: pos++,
            vat_rate: DEFAULT_VAT,
            power_watts: null,
            power_source_ref: null,
          });
        });
    } else if (mode === 'transport') {
      vehicleRows
        .filter((v) => selectedVehicles.has(v.id))
        .forEach((v, idx) => {
          const totalCost = (v.fuelCost ?? 0) + (v.tollCost ?? 0);
          picked.push({
            category: 'transport',
            name: v.vehicleName,
            description: `${ROLE_LABELS[v.role] || v.role}${v.driverName ? ` — kierowca: ${v.driverName}` : ''}`,
            unit: 'kurs',
            quantity: 1,
            unit_price: totalCost,
            days: 1,
            source: 'offer',
            source_ref: v.id,
            position: idx,
            vat_rate: DEFAULT_VAT,
            power_watts: null,
            power_source_ref: null,
          });
        });
    }

    onImport(picked);
  };

  const totalSelected = currentSelected().size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-5 py-3">
          <h3 className="text-lg font-light text-[#e5e4e2]">Importuj z oferty</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[#e5e4e2]/60 hover:bg-[#0a0d1a] hover:text-[#e5e4e2]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-[#d3bb73]/10">
          <button
            onClick={() => setMode('products')}
            className={`flex items-center gap-2 px-5 py-3 text-sm transition-colors ${
              mode === 'products'
                ? 'border-b-2 border-[#d3bb73] text-[#d3bb73]'
                : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
            }`}
          >
            <Package className="h-4 w-4" />
            Produkty
          </button>
          <button
            onClick={() => setMode('contents')}
            className={`flex items-center gap-2 px-5 py-3 text-sm transition-colors ${
              mode === 'contents'
                ? 'border-b-2 border-[#d3bb73] text-[#d3bb73]'
                : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
            }`}
          >
            <Users className="h-4 w-4" />
            Zawartość (sprzęt + ludzie)
          </button>
          <button
            onClick={() => setMode('transport')}
            className={`flex items-center gap-2 px-5 py-3 text-sm transition-colors ${
              mode === 'transport'
                ? 'border-b-2 border-[#d3bb73] text-[#d3bb73]'
                : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
            }`}
          >
            <Truck className="h-4 w-4" />
            Transport
          </button>
        </div>

        {/* Subheader */}
        <div className="flex items-center justify-between gap-3 border-b border-[#d3bb73]/10 bg-[#0a0d1a]/60 px-5 py-3 text-sm text-[#e5e4e2]/70">
          <span>
            {mode === 'products' && 'Importuj produkty z oferty jako pozycje kalkulacji.'}
            {mode === 'contents' &&
              'Importuj sprzęt i pracowników przypisanych do produktów w ofercie.'}
            {mode === 'transport' && 'Importuj pojazdy przypisane do tego wydarzenia.'}
          </span>
          <button
            type="button"
            onClick={() => {
              if (mode === 'products') toggleAllProducts();
              else if (mode === 'contents') {
                toggleAllEquipment();
                toggleAllStaff();
              } else toggleAllVehicles();
            }}
            className="shrink-0 rounded-md border border-[#d3bb73]/30 px-3 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
          >
            Zaznacz wszystkie
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-8 text-center text-[#e5e4e2]/60">Wczytywanie...</div>
          ) : mode === 'products' ? (
            renderProductsTable()
          ) : mode === 'contents' ? (
            renderContentsTable()
          ) : (
            renderTransportTable()
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#d3bb73]/10 px-5 py-3">
          <div className="text-sm text-[#e5e4e2]/60">Zaznaczono: {totalSelected}</div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-[#d3bb73]/30 px-4 py-2 text-sm text-[#e5e4e2]/80 hover:bg-[#0a0d1a]"
            >
              Anuluj
            </button>
            <button
              onClick={handleImport}
              disabled={totalSelected === 0}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <FileDown className="h-4 w-4" />
              Importuj ({totalSelected})
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  function renderProductsTable() {
    if (offerItems.length === 0) {
      return (
        <div className="p-8 text-center text-[#e5e4e2]/60">
          Brak pozycji w ofertach dla tego wydarzenia.
        </div>
      );
    }

    return (
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[#0a0d1a] text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60">
          <tr>
            <th className="w-8 px-3 py-2"></th>
            <th className="px-3 py-2">Oferta</th>
            <th className="px-3 py-2">Nazwa</th>
            <th className="px-3 py-2">Kategoria</th>
            <th className="px-3 py-2">Ilość</th>
            <th className="px-3 py-2">Cena</th>
            <th className="px-3 py-2 text-right">Wartość</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#d3bb73]/10">
          {offerItems.map((it) => {
            const alreadyImported = existingRefs.has(it.id);
            return (
              <tr
                key={it.id}
                className={alreadyImported ? 'opacity-40' : 'hover:bg-[#0a0d1a]/50'}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedProducts.has(it.id)}
                    disabled={alreadyImported}
                    onChange={() => toggleProduct(it.id)}
                    className="h-4 w-4 rounded border-[#d3bb73]/40 bg-[#0a0d1a] text-[#d3bb73]"
                  />
                </td>
                <td className="px-3 py-2 text-[#e5e4e2]/60">{it.offerName}</td>
                <td className="px-3 py-2 text-[#e5e4e2]">
                  <div>{it.name}</div>
                  {it.categoryName && (
                    <div className="text-xs text-[#e5e4e2]/40">{it.categoryName}</div>
                  )}
                  {alreadyImported && (
                    <span className="mt-1 inline-block rounded bg-[#d3bb73]/10 px-1.5 py-0.5 text-xs text-[#d3bb73]">
                      Już zaimportowano
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={it.autoCategory}
                    disabled={alreadyImported}
                    onChange={(e) => {
                      const newCat = e.target.value as Category;
                      setOfferItems((prev) =>
                        prev.map((p) => (p.id === it.id ? { ...p, autoCategory: newCat } : p)),
                      );
                    }}
                    className="rounded-md border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1 text-xs text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  >
                    {(Object.keys(CATEGORY_META) as Category[]).map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_META[c].label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-[#e5e4e2]/80">
                  {it.quantity} {it.unit}
                </td>
                <td className="px-3 py-2 text-[#e5e4e2]/80">{fmt(it.unit_price)}</td>
                <td className="px-3 py-2 text-right text-[#d3bb73]">{fmt(it.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  function renderContentsTable() {
    if (equipmentRows.length === 0 && staffRows.length === 0) {
      return (
        <div className="p-8 text-center text-[#e5e4e2]/60">
          Brak sprzętu ani pracowników w produktach oferty.
        </div>
      );
    }

    return (
      <div className="divide-y divide-[#d3bb73]/20">
        {equipmentRows.length > 0 && (
          <div>
            <div className="sticky top-0 z-10 flex items-center gap-2 bg-[#0a0d1a] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#d3bb73]">
              <Package className="h-3.5 w-3.5" />
              Sprzęt ({equipmentRows.length})
            </div>
            <table className="w-full text-sm">
              <thead className="bg-[#0a0d1a]/60 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/50">
                <tr>
                  <th className="w-8 px-3 py-2"></th>
                  <th className="px-3 py-2">Nazwa</th>
                  <th className="px-3 py-2">Produkt</th>
                  <th className="px-3 py-2">Typ</th>
                  <th className="px-3 py-2">Ilość</th>
                  <th className="px-3 py-2 text-right">Cena/dzień</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d3bb73]/5">
                {equipmentRows.map((eq) => {
                  const alreadyImported = existingRefs.has(eq.id);
                  return (
                    <tr
                      key={eq.id}
                      className={alreadyImported ? 'opacity-40' : 'hover:bg-[#0a0d1a]/50'}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedEquipment.has(eq.id)}
                          disabled={alreadyImported}
                          onChange={() => toggleEquipment(eq.id)}
                          className="h-4 w-4 rounded border-[#d3bb73]/40 bg-[#0a0d1a] text-[#d3bb73]"
                        />
                      </td>
                      <td className="px-3 py-2 text-[#e5e4e2]">
                        {eq.name}
                        {alreadyImported && (
                          <span className="ml-2 inline-block rounded bg-[#d3bb73]/10 px-1.5 py-0.5 text-xs text-[#d3bb73]">
                            Już zaimportowano
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[#e5e4e2]/60">{eq.productName}</td>
                      <td className="px-3 py-2">
                        {eq.isKit && (
                          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-xs text-blue-400">
                            Zestaw
                          </span>
                        )}
                        {eq.isRental && (
                          <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-xs text-orange-400">
                            Rental
                          </span>
                        )}
                        {!eq.isKit && !eq.isRental && (
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-400">
                            Własny
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[#e5e4e2]/80">{eq.quantity}</td>
                      <td className="px-3 py-2 text-right text-[#d3bb73]">
                        {eq.rentalPrice > 0 ? fmt(eq.rentalPrice) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {staffRows.length > 0 && (
          <div>
            <div className="sticky top-0 z-10 flex items-center gap-2 bg-[#0a0d1a] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#d3bb73]">
              <Users className="h-3.5 w-3.5" />
              Pracownicy ({staffRows.length})
            </div>
            <table className="w-full text-sm">
              <thead className="bg-[#0a0d1a]/60 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/50">
                <tr>
                  <th className="w-8 px-3 py-2"></th>
                  <th className="px-3 py-2">Rola</th>
                  <th className="px-3 py-2">Produkt</th>
                  <th className="px-3 py-2">Ilość</th>
                  <th className="px-3 py-2">Stawka/h</th>
                  <th className="px-3 py-2">Godziny</th>
                  <th className="px-3 py-2 text-right">Koszt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d3bb73]/5">
                {staffRows.map((s) => {
                  const alreadyImported = existingRefs.has(s.id);
                  const cost = s.hourlyRate * s.estimatedHours * s.quantity;
                  return (
                    <tr
                      key={s.id}
                      className={alreadyImported ? 'opacity-40' : 'hover:bg-[#0a0d1a]/50'}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedStaff.has(s.id)}
                          disabled={alreadyImported}
                          onChange={() => toggleStaff(s.id)}
                          className="h-4 w-4 rounded border-[#d3bb73]/40 bg-[#0a0d1a] text-[#d3bb73]"
                        />
                      </td>
                      <td className="px-3 py-2 text-[#e5e4e2]">
                        {s.role}
                        {alreadyImported && (
                          <span className="ml-2 inline-block rounded bg-[#d3bb73]/10 px-1.5 py-0.5 text-xs text-[#d3bb73]">
                            Już zaimportowano
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[#e5e4e2]/60">{s.productName}</td>
                      <td className="px-3 py-2 text-[#e5e4e2]/80">{s.quantity}</td>
                      <td className="px-3 py-2 text-[#e5e4e2]/80">
                        {s.hourlyRate > 0 ? fmt(s.hourlyRate) : '—'}
                      </td>
                      <td className="px-3 py-2 text-[#e5e4e2]/80">
                        {s.estimatedHours > 0 ? `${s.estimatedHours}h` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-[#d3bb73]">
                        {cost > 0 ? fmt(cost) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function renderTransportTable() {
    if (vehicleRows.length === 0) {
      return (
        <div className="p-8 text-center text-[#e5e4e2]/60">
          Brak pojazdów przypisanych do tego wydarzenia.
        </div>
      );
    }

    return (
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[#0a0d1a] text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60">
          <tr>
            <th className="w-8 px-3 py-2"></th>
            <th className="px-3 py-2">Pojazd</th>
            <th className="px-3 py-2">Rola</th>
            <th className="px-3 py-2">Kierowca</th>
            <th className="px-3 py-2">Dystans</th>
            <th className="px-3 py-2 text-right">Koszt szac.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#d3bb73]/10">
          {vehicleRows.map((v) => {
            const alreadyImported = existingRefs.has(v.id);
            const totalCost = (v.fuelCost ?? 0) + (v.tollCost ?? 0);
            return (
              <tr
                key={v.id}
                className={alreadyImported ? 'opacity-40' : 'hover:bg-[#0a0d1a]/50'}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedVehicles.has(v.id)}
                    disabled={alreadyImported}
                    onChange={() => toggleVehicle(v.id)}
                    className="h-4 w-4 rounded border-[#d3bb73]/40 bg-[#0a0d1a] text-[#d3bb73]"
                  />
                </td>
                <td className="px-3 py-2 text-[#e5e4e2]">
                  {v.vehicleName}
                  {alreadyImported && (
                    <span className="ml-2 inline-block rounded bg-[#d3bb73]/10 px-1.5 py-0.5 text-xs text-[#d3bb73]">
                      Już zaimportowano
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-[#e5e4e2]/60">
                  {ROLE_LABELS[v.role] || v.role}
                </td>
                <td className="px-3 py-2 text-[#e5e4e2]/80">{v.driverName || '—'}</td>
                <td className="px-3 py-2 text-[#e5e4e2]/80">
                  {v.estimatedDistance ? `${v.estimatedDistance} km` : '—'}
                </td>
                <td className="px-3 py-2 text-right text-[#d3bb73]">
                  {totalCost > 0 ? fmt(totalCost) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
}
