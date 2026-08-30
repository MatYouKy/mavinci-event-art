'use client';

import { useEffect, useMemo, useState } from 'react';
import { Layers3, Loader2, Plus, Save, Star, Trash2, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import type { IProductVariant } from '../../types';

type CatalogProduct = {
  offer_item_id: string;
  id: string;
  name: string;
  unit: string;
  base_price: number;
  quantity: number;
  selected_variant_id?: string | null;
  variants?: IProductVariant[];
};

type PackageItemDraft = {
  id: string;
  offer_item_id: string | null;
  product_id: string | null;
  product_variant_id: string | null;
  quantity: number;
  product?: CatalogProduct;
  product_variant?: IProductVariant | null;
};

type PackageDraft = {
  id: string;
  name: string;
  description: string;
  price_net: number;
  list_price_net: number;
  discount_percent: number;
  discount_amount: number;
  is_recommended: boolean;
  display_order: number;
  items: PackageItemDraft[];
};

type Props = {
  offer: any;
  canEdit: boolean;
  onSaved?: () => void;
};

const packageDefaults = ['LIGHT', 'GIT', 'VIP'];
const temporaryId = () => `temp-${crypto.randomUUID()}`;
const roundMoney = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const clampPercent = (value: number) => Math.min(100, Math.max(0, Number(value) || 0));

const packageItemPrice = (item: PackageItemDraft) => {
  const unitPrice = item.product_variant
    ? Number(item.product_variant.price_net || 0)
    : Number(item.product?.base_price || 0);
  return roundMoney(unitPrice * Number(item.quantity || 1));
};

const packageListPrice = (items: PackageItemDraft[]) =>
  roundMoney(items.reduce((sum, item) => sum + packageItemPrice(item), 0));

const calculatePackageFromPercent = (pkg: PackageDraft, percent = pkg.discount_percent): PackageDraft => {
  const listPrice = packageListPrice(pkg.items);
  const normalizedPercent = clampPercent(percent);
  const discountAmount = roundMoney(listPrice * normalizedPercent / 100);
  return {
    ...pkg,
    list_price_net: listPrice,
    discount_percent: normalizedPercent,
    discount_amount: discountAmount,
    price_net: roundMoney(listPrice - discountAmount),
  };
};

export default function OfferPackagesEditor({ offer, canEdit, onSaved }: Props) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [packageMode, setPackageMode] = useState(Boolean(offer.package_mode));
  const [packages, setPackages] = useState<PackageDraft[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [logisticsEnabled, setLogisticsEnabled] = useState(Boolean(offer.logistics_enabled));
  const [logisticsPriceNet, setLogisticsPriceNet] = useState(Number(offer.logistics_price_net || 0));
  const [logisticsDescription, setLogisticsDescription] = useState(offer.logistics_description || 'Transport, załadunek i obsługa logistyczna realizacji.');
  const [selectedProducts, setSelectedProducts] = useState<Record<string, string>>({});
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});

  const loadData = async () => {
    setLoading(true);
    try {
      const packagesResult = await supabase
          .from('offer_packages')
          .select(`id, name, description, price_net, list_price_net, discount_percent, discount_amount, is_recommended, display_order, items:offer_package_items(id, offer_item_id, product_id, product_variant_id, quantity, display_order, product:offer_products(id, name, unit, base_price), product_variant:offer_product_variants(id, product_id, name, short_description, description, benefits, price_net, price_gross, is_recommended, is_active, display_order))`)
          .eq('offer_id', offer.id)
          .order('display_order');
      if (packagesResult.error) throw packagesResult.error;

      const catalog = [...(offer.offer_items || [])]
        .filter((item: any) => item?.id && (item.product_id || item.product?.id))
        .sort((a: any, b: any) => Number(a.display_order || 0) - Number(b.display_order || 0))
        .map((item: any) => ({
        offer_item_id: item.id,
        id: item.product_id || item.product?.id || '',
        name: item.name || item.product?.name || 'Pozycja oferty',
        unit: item.unit || item.product?.unit || 'szt.',
        base_price: Number(item.unit_price || 0),
        quantity: Number(item.quantity || 1),
        selected_variant_id: item.product_variant_id || null,
        variants: [...(item.product?.variants || item.product?.offer_product_variants || [])]
          .filter((variant: IProductVariant) => variant.is_active !== false)
          .sort((a: IProductVariant, b: IProductVariant) => a.display_order - b.display_order),
      }));
      setProducts(catalog);
      const firstPositionByProductId = new Map<string, CatalogProduct>();
      catalog.forEach((position) => {
        if (position.id && !firstPositionByProductId.has(position.id)) {
          firstPositionByProductId.set(position.id, position);
        }
      });
      setPackages((packagesResult.data || []).map((pkg: any) => {
        const mappedItems = [...(pkg.items || [])]
          .sort((a: any, b: any) => a.display_order - b.display_order)
          .map((item: any) => {
            const sourcePosition = catalog.find((position) => position.offer_item_id === item.offer_item_id)
              || firstPositionByProductId.get(item.product_id);
            return {
              ...item,
              offer_item_id: sourcePosition?.offer_item_id || null,
              product_id: item.product_id || sourcePosition?.id || null,
              quantity: Number(item.quantity || sourcePosition?.quantity || 1),
              product: sourcePosition || item.product,
            };
          })
          .filter((item: PackageItemDraft) => Boolean(item.offer_item_id));
        const listPrice = packageListPrice(mappedItems);
        const savedAmount = Number(pkg.discount_amount || 0);
        const savedPercent = Number(pkg.discount_percent || 0);
        const discountAmount = savedAmount > 0
          ? Math.min(listPrice, savedAmount)
          : roundMoney(listPrice * clampPercent(savedPercent) / 100);
        return {
          ...pkg,
          description: pkg.description || '',
          items: mappedItems,
          list_price_net: listPrice,
          discount_percent: listPrice > 0 ? roundMoney(discountAmount / listPrice * 100) : 0,
          discount_amount: discountAmount,
          price_net: roundMoney(listPrice - discountAmount),
        };
      }));
    } catch (error: any) {
      showSnackbar(error.message || 'Nie udało się wczytać pakietów', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.id, offer.offer_items]);

  const activatePackageMode = (enabled: boolean) => {
    setPackageMode(enabled);
    if (enabled && packages.length === 0) {
      setPackages(packageDefaults.map((name, index) => ({
        id: temporaryId(),
        name,
        description: '',
        price_net: 0,
        list_price_net: 0,
        discount_percent: 0,
        discount_amount: 0,
        is_recommended: index === 1,
        display_order: index,
        items: [],
      })));
    }
  };

  const updatePackage = (index: number, patch: Partial<PackageDraft>) => {
    setPackages((current) => current.map((pkg, packageIndex) => (
      packageIndex === index ? { ...pkg, ...patch } : pkg
    )));
  };

  const setRecommended = (index: number) => {
    setPackages((current) => current.map((pkg, packageIndex) => ({
      ...pkg,
      is_recommended: packageIndex === index,
    })));
  };

  const addPackage = () => {
    if (packages.length >= 3) return;
    setPackages((current) => [...current, {
      id: temporaryId(),
      name: packageDefaults[current.length] || `PAKIET ${current.length + 1}`,
      description: '',
      price_net: 0,
      list_price_net: 0,
      discount_percent: 0,
      discount_amount: 0,
      is_recommended: current.length === 1,
      display_order: current.length,
      items: [],
    }]);
  };

  const removePackage = (index: number) => {
    setPackages((current) => {
      const next = current.filter((_, packageIndex) => packageIndex !== index);
      if (next.length > 0 && !next.some((pkg) => pkg.is_recommended)) {
        const recommendedIndex = Math.min(1, next.length - 1);
        next[recommendedIndex] = { ...next[recommendedIndex], is_recommended: true };
      }
      return next.map((pkg, displayOrder) => ({ ...pkg, display_order: displayOrder }));
    });
  };

  const addProductToPackage = (packageIndex: number) => {
    const pkg = packages[packageIndex];
    const offerItemId = selectedProducts[pkg.id];
    const product = products.find((item) => item.offer_item_id === offerItemId);
    if (!product) return;
    const variantId = selectedVariants[pkg.id] || null;
    const variant = product.variants?.find((item) => item.id === variantId) || null;
    if (product.variants?.length && !variant) {
      showSnackbar('Wybierz wariant tego produktu', 'error');
      return;
    }
    if (pkg.items.some((item) => item.offer_item_id === product.offer_item_id)) {
      showSnackbar('Ta pozycja oferty jest już w pakiecie', 'error');
      return;
    }
    const nextPackage = {
      ...pkg,
      items: [...pkg.items, {
        id: temporaryId(),
        offer_item_id: product.offer_item_id,
        product_id: product.id || null,
        product_variant_id: variant?.id || null,
        quantity: product.quantity,
        product,
        product_variant: variant,
      }],
    };
    updatePackage(packageIndex, calculatePackageFromPercent(nextPackage));
    setSelectedProducts((current) => ({ ...current, [pkg.id]: '' }));
    setSelectedVariants((current) => ({ ...current, [pkg.id]: '' }));
  };

  const savePackages = async () => {
    if (!canEdit) return;
    const activePackages = packages.slice(0, 3);
    if (packageMode && activePackages.some((pkg) => !pkg.name.trim())) {
      showSnackbar('Każdy pakiet musi mieć nazwę', 'error');
      return;
    }
    if (packageMode && activePackages.some((pkg) => pkg.items.length === 0)) {
      showSnackbar('Każdy pakiet musi zawierać przynajmniej jeden produkt', 'error');
      return;
    }

    setSaving(true);
    try {
      const { error: offerError } = await supabase
        .from('offers')
        .update({
          package_mode: packageMode,
          logistics_enabled: logisticsEnabled,
          logistics_price_net: logisticsEnabled ? logisticsPriceNet : 0,
          logistics_description: logisticsEnabled ? logisticsDescription.trim() || null : null,
        })
        .eq('id', offer.id);
      if (offerError) throw offerError;

      const { data: existingRows, error: existingError } = await supabase
        .from('offer_packages')
        .select('id')
        .eq('offer_id', offer.id);
      if (existingError) throw existingError;
      const retainedIds = activePackages.filter((pkg) => !pkg.id.startsWith('temp-')).map((pkg) => pkg.id);
      const removedIds = (existingRows || []).map((row) => row.id).filter((id) => !retainedIds.includes(id));
      if (removedIds.length > 0) {
        const { error } = await supabase.from('offer_packages').delete().in('id', removedIds);
        if (error) throw error;
      }

      for (let index = 0; index < activePackages.length; index += 1) {
        const pkg = activePackages[index];
        const payload = {
          offer_id: offer.id,
          name: pkg.name.trim(),
          description: pkg.description.trim() || null,
          list_price_net: Number(pkg.list_price_net || 0),
          discount_percent: Number(pkg.discount_percent || 0),
          discount_amount: Number(pkg.discount_amount || 0),
          price_net: Number(pkg.price_net || 0),
          is_recommended: pkg.is_recommended,
          display_order: index,
        };
        let packageId = pkg.id;
        if (pkg.id.startsWith('temp-')) {
          const { data, error } = await supabase
            .from('offer_packages')
            .insert(payload)
            .select('id')
            .single();
          if (error) throw error;
          packageId = data.id;
        } else {
          const { error } = await supabase.from('offer_packages').update(payload).eq('id', pkg.id);
          if (error) throw error;
        }

        const { error: deleteItemsError } = await supabase
          .from('offer_package_items')
          .delete()
          .eq('package_id', packageId);
        if (deleteItemsError) throw deleteItemsError;
        const itemPayload = pkg.items.map((item, itemIndex) => ({
          package_id: packageId,
          offer_item_id: item.offer_item_id,
          product_id: item.product_id,
          product_variant_id: item.product_variant_id || null,
          quantity: Number(item.quantity || 1),
          display_order: itemIndex,
        }));
        if (itemPayload.length > 0) {
          const { error } = await supabase.from('offer_package_items').insert(itemPayload);
          if (error) throw error;
        }
      }

      showSnackbar('Pakiety i logistyka zostały zapisane', 'success');
      await loadData();
      onSaved?.();
    } catch (error: any) {
      showSnackbar(error.message || 'Nie udało się zapisać pakietów', 'error');
    } finally {
      setSaving(false);
    }
  };

  const selectedProductVariants = useMemo(() => {
    const result: Record<string, IProductVariant[]> = {};
    packages.forEach((pkg) => {
      result[pkg.id] = products.find((product) => product.offer_item_id === selectedProducts[pkg.id])?.variants || [];
    });
    return result;
  }, [packages, products, selectedProducts]);

  const availablePositions = useMemo(() => {
    const result: Record<string, CatalogProduct[]> = {};
    packages.forEach((pkg) => {
      const usedOfferItemIds = new Set(pkg.items.map((item) => item.offer_item_id).filter(Boolean));
      result[pkg.id] = products.filter((position) => !usedOfferItemIds.has(position.offer_item_id));
    });
    return result;
  }, [packages, products]);

  if (loading) {
    return <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 text-sm text-[#e5e4e2]/50">Ładowanie pakietów…</div>;
  }

  return (
    <section className="rounded-xl border border-[#7f1734]/35 bg-[#1c1f33] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers3 className="h-5 w-5 text-[#b94b69]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Pakiety oferty</h2>
          </div>
          <p className="mt-1 text-sm text-[#e5e4e2]/55">
            Maksymalnie trzy alternatywy budowane wyłącznie z pozycji dodanych do tej oferty.
          </p>
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/15 bg-[#0d0f1a] px-3 py-2 text-sm text-[#e5e4e2]">
          <input
            type="checkbox"
            checked={packageMode}
            onChange={(event) => activatePackageMode(event.target.checked)}
            disabled={!canEdit}
            className="h-4 w-4 rounded"
          />
          Oferta pakietowa
        </label>
      </div>

      {packageMode && (
        <>
          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
            {packages.map((pkg, packageIndex) => (
              <article
                key={pkg.id}
                className={`self-start rounded-xl border p-4 transition-shadow ${pkg.is_recommended ? 'border-[#d3bb73]/70 bg-[#7f1734]/20 shadow-[0_0_32px_rgba(211,187,115,0.22)]' : 'border-[#d3bb73]/15 bg-[#0d0f1a]/70'}`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setRecommended(packageIndex)}
                    disabled={!canEdit}
                    className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] uppercase ${pkg.is_recommended ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/35'}`}
                  >
                    <Star className={`h-3 w-3 ${pkg.is_recommended ? 'fill-current' : ''}`} />
                    {pkg.is_recommended ? 'Rekomendowany' : 'Poleć ten pakiet'}
                  </button>
                  <button type="button" onClick={() => removePackage(packageIndex)} disabled={!canEdit} className="rounded p-1.5 text-red-300/60 hover:bg-red-500/10 hover:text-red-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  <input
                    value={pkg.name}
                    onChange={(event) => updatePackage(packageIndex, { name: event.target.value })}
                    disabled={!canEdit}
                    placeholder="Nazwa pakietu"
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 font-medium uppercase text-[#e5e4e2]"
                  />
                  <textarea
                    value={pkg.description}
                    onChange={(event) => updatePackage(packageIndex, { description: event.target.value })}
                    disabled={!canEdit}
                    rows={2}
                    placeholder="Krótko: dla kogo jest ten pakiet"
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-sm text-[#e5e4e2]"
                  />
                  <div className="rounded-lg border border-[#d3bb73]/15 bg-black/10 p-3">
                    <div className="flex items-center justify-between gap-3 text-xs text-[#e5e4e2]/55">
                      <span>Suma produktów</span>
                      <span>{pkg.list_price_net.toLocaleString('pl-PL')} zł netto</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="text-xs text-[#e5e4e2]/50">
                        Korzyść (%)
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={pkg.discount_percent}
                          onChange={(event) => updatePackage(
                            packageIndex,
                            calculatePackageFromPercent(pkg, Number(event.target.value) || 0),
                          )}
                          disabled={!canEdit || pkg.list_price_net <= 0}
                          className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]"
                        />
                      </label>
                      <label className="text-xs text-[#e5e4e2]/50">
                        Korzyść (zł netto)
                        <input
                          type="number"
                          min="0"
                          max={pkg.list_price_net}
                          step="0.01"
                          value={pkg.discount_amount}
                          onChange={(event) => {
                            const amount = Math.min(pkg.list_price_net, Math.max(0, Number(event.target.value) || 0));
                            const percent = pkg.list_price_net > 0
                              ? roundMoney(amount / pkg.list_price_net * 100)
                              : 0;
                            updatePackage(packageIndex, {
                              ...pkg,
                              discount_amount: amount,
                              discount_percent: percent,
                              price_net: roundMoney(pkg.list_price_net - amount),
                            });
                          }}
                          disabled={!canEdit || pkg.list_price_net <= 0}
                          className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]"
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3 border-t border-[#d3bb73]/10 pt-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-[#d3bb73]">Klient oszczędza</p>
                        <p className="text-sm text-[#e5e4e2]">
                          {pkg.discount_amount.toLocaleString('pl-PL')} zł netto ({pkg.discount_percent.toLocaleString('pl-PL')}%)
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/45">Cena pakietowa</p>
                        <p className="text-lg font-medium text-[#d3bb73]">{pkg.price_net.toLocaleString('pl-PL')} zł</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-lg border border-[#d3bb73]/10 bg-black/10 p-3">
                    {pkg.items.map((item, itemIndex) => (
                      <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 text-[#e5e4e2]/75">
                          <span className="block truncate">{item.product?.name || 'Produkt'}</span>
                          {item.product_variant?.name && <span className="block text-xs text-[#d3bb73]">{item.product_variant.name}</span>}
                          <span className="block text-[11px] text-[#e5e4e2]/40">
                            {item.quantity.toLocaleString('pl-PL')} × {(item.product_variant
                              ? Number(item.product_variant.price_net || 0)
                              : Number(item.product?.base_price || 0)).toLocaleString('pl-PL')} zł netto
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => updatePackage(
                            packageIndex,
                            calculatePackageFromPercent({
                              ...pkg,
                              items: pkg.items.filter((_, index) => index !== itemIndex),
                            }),
                          )}
                          disabled={!canEdit}
                          className="rounded p-1 text-red-300/60 hover:text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {pkg.items.length === 0 && <p className="py-2 text-center text-xs text-[#e5e4e2]/35">Dodaj produkty do pakietu</p>}
                  </div>

                  {(availablePositions[pkg.id] || []).length > 0 ? <select
                    value={selectedProducts[pkg.id] || ''}
                    onChange={(event) => {
                      const offerItemId = event.target.value;
                      setSelectedProducts((current) => ({ ...current, [pkg.id]: offerItemId }));
                      const product = products.find((item) => item.offer_item_id === offerItemId);
                      const recommendedVariant = product?.variants?.find((variant) => variant.id === product.selected_variant_id)
                        || product?.variants?.find((variant) => variant.is_recommended)
                        || product?.variants?.[0];
                      setSelectedVariants((current) => ({ ...current, [pkg.id]: recommendedVariant?.id || '' }));
                    }}
                    disabled={!canEdit}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-sm text-[#e5e4e2]"
                  >
                    <option value="">Wybierz pozycję oferty…</option>
                    {(availablePositions[pkg.id] || []).map((product) => (
                      <option key={product.offer_item_id} value={product.offer_item_id}>
                        {product.name} · {product.quantity} {product.unit} · {product.base_price.toLocaleString('pl-PL')} zł netto
                      </option>
                    ))}
                  </select> : (
                    <p className="rounded-lg border border-[#d3bb73]/10 bg-black/10 px-3 py-2 text-center text-xs text-[#e5e4e2]/45">
                      Wszystkie pozycje tej oferty są już w pakiecie.
                    </p>
                  )}
                  {(selectedProductVariants[pkg.id] || []).length > 0 && (
                    <select
                      value={selectedVariants[pkg.id] || ''}
                      onChange={(event) => setSelectedVariants((current) => ({ ...current, [pkg.id]: event.target.value }))}
                      disabled={!canEdit}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-sm text-[#e5e4e2]"
                    >
                      {(selectedProductVariants[pkg.id] || []).map((variant) => (
                        <option key={variant.id} value={variant.id}>{variant.name}</option>
                      ))}
                    </select>
                  )}
                  {(availablePositions[pkg.id] || []).length > 0 && <button
                    type="button"
                    onClick={() => addProductToPackage(packageIndex)}
                    disabled={!canEdit || !selectedProducts[pkg.id]}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/15 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/25 disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" /> Dodaj pozycję oferty
                  </button>}
                </div>
              </article>
            ))}
          </div>

          {packages.length < 3 && (
            <button type="button" onClick={addPackage} disabled={!canEdit} className="mt-4 flex items-center gap-2 text-sm text-[#d3bb73]">
              <Plus className="h-4 w-4" /> Dodaj kolejny pakiet
            </button>
          )}
        </>
      )}

      <div className="mt-5 rounded-xl border border-[#d3bb73]/15 bg-[#0d0f1a]/70 p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
          <Truck className="h-4 w-4 text-[#d3bb73]" />
          <input type="checkbox" checked={logisticsEnabled} onChange={(event) => setLogisticsEnabled(event.target.checked)} disabled={!canEdit} className="h-4 w-4 rounded" />
          Uwzględnij logistykę w kalkulacji
        </label>
        {logisticsEnabled && (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[180px_1fr]">
            <input type="number" min="0" step="0.01" value={logisticsPriceNet} onChange={(event) => setLogisticsPriceNet(Number(event.target.value) || 0)} disabled={!canEdit} placeholder="Kwota netto" className="rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]" />
            <input value={logisticsDescription} onChange={(event) => setLogisticsDescription(event.target.value)} disabled={!canEdit} placeholder="Opis logistyki" className="rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]" />
          </div>
        )}
      </div>

      {canEdit && (
        <button type="button" onClick={savePackages} disabled={saving} className="mt-5 flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Zapisywanie…' : 'Zapisz pakiety i logistykę'}
        </button>
      )}
    </section>
  );
}
