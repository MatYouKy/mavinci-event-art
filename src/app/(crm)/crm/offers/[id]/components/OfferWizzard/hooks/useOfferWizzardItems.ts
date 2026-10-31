'use client';
import { resolveAudienceConfiguration, type OfferAudience } from '@/lib/CRM/Offers/audiencePricing';
import { pricedPackageSelection, type ProductSalesPackage } from '@/lib/CRM/Offers/productSalesPackages';
import { productConfigurationSnapshot, modularTitle, modularScope } from '@/lib/CRM/Offers/modularProduct';
import { createConfiguration, createModularConfiguration, configurationPrice } from '@/lib/CRM/Offers/offerAddons';

import { useEffect, useMemo, useRef, useState } from 'react';
import { calcSubtotal, calcTotal } from '../utils';
import { IOfferItem, IOfferWizardCustomItem, IProduct, IProductVariant } from '@/app/(crm)/crm/offers/types';

export function useOfferWizardItems(audience: OfferAudience = {}) {
  const [offerItems, setOfferItems] = useState<IOfferItem[]>([]);
  const offerItemsRef = useRef<IOfferItem[]>([]);
  // trzymamy ref w sync z realnym stanem
  if (offerItemsRef.current !== offerItems) offerItemsRef.current = offerItems;

  const [showCustomItemForm, setShowCustomItemForm] = useState(false);
  const [showEquipmentSelector, setShowEquipmentSelector] = useState(false);
  const [showSubcontractorSelector, setShowSubcontractorSelector] = useState(false);

  const [customItem, setCustomItem] = useState<IOfferWizardCustomItem>({
    name: '',
    description: '',
    unit: 'szt',
    unit_price: 0,
    discount_percent: 0,
    quantity: 1,
    equipment_ids: [] as string[],
    subcontractor_id: '',
    needs_subcontractor: false,
    subtotal: 0,
  });

  const total = useMemo(() => calcTotal(offerItems), [offerItems]);

  // ✅ helper żeby zawsze ustawiać i ref, i state
  const setOfferItemsSafe = (next: IOfferItem[]) => {
    const resolved = next.map(item=>{
      if(!item.pricing_configuration)return item;
      const result=resolveAudienceConfiguration(item.pricing_configuration,audience,item.quantity);
      if(result.error)return item;
      const unitPrice=configurationPrice(result.configuration);
      const source=result.configuration.quantity_source;
      return {...item,pricing_configuration:result.configuration,quantity:result.quantity,unit_price:unitPrice,
        unit:source==='guests'?'osoba':source==='tables'?'stół':item.unit,
        subtotal:calcSubtotal(result.quantity,unitPrice,item.discount_percent || 0,item.days ?? 1)};
    });
    offerItemsRef.current = resolved;
    setOfferItems(resolved);
  };

  useEffect(()=>{setOfferItemsSafe(offerItemsRef.current);},[audience.guest_count,audience.guests_per_table,audience.table_count]);

  // ✅ teraz addProduct zwraca nextItems
  const addProduct = (product: IProduct, variant?: IProductVariant, salesPackage?: ProductSalesPackage) => {
    const options = !product.configuration_schema && product.sales_packages_enabled ? product.sales_packages || [] : [];
    const selectedPackage = variant ? undefined : salesPackage || options[0];
    const basePrice = Number(selectedPackage?.price_net ?? variant?.price_net ?? product.base_price ?? 0);
    const modular = product.configuration_schema ? productConfigurationSnapshot(product.configuration_schema) : null;
    if (modular) variant = undefined;
    const initialConfiguration = modular ? createModularConfiguration(modular) : createConfiguration(basePrice, selectedPackage && !selectedPackage.include_product_addons ? [] : product.pricing_addons || [],
      selectedPackage ? { selected_id: selectedPackage.id, options: structuredClone(options) } : undefined);
    initialConfiguration.quantity_source=modular||selectedPackage?'manual':variant?.quantity_source || product.quantity_source || 'manual';
    const initialPrice = configurationPrice(initialConfiguration);
    const name = modular ? modularTitle(modular) : selectedPackage ? `${product.name} — ${selectedPackage.name}` : variant ? `${product.name} — ${variant.name}` : product.name;
    const description = modular ? modularScope(modular).join('\n') : selectedPackage ? [selectedPackage.included_label, selectedPackage.bonus].filter(Boolean).join('. ')
      : variant?.description || variant?.short_description || product.description || '';
    const selection = {
      unit: modular ? 'zestaw' : selectedPackage ? 'pakiet' : product.unit,
      name, description, product, product_variant_id: selectedPackage ? null : variant?.id || null,
      product_variant: selectedPackage ? null : variant || null,
      pricing_configuration: initialConfiguration, unit_price: initialPrice,
      show_variant_prices_in_pdf: !modular && !selectedPackage,
      show_product_variants_in_pdf: modular ? false : selectedPackage ? true : product.sales_packages_enabled ? false : true,
    };
    const prev = offerItemsRef.current;
    const existing = prev.find(item => item.product_id === product.id);
    let next: IOfferItem[];
    if (existing && (variant || selectedPackage)) {
      next = prev.map(item => item.id === existing.id ? { ...item, ...selection,
        subtotal: calcSubtotal(item.quantity, initialPrice, item.discount_percent || 0, item.days ?? 1),
      } : item);
    } else if (existing) {
      next = prev.map(item => item.id === existing.id ? { ...item, quantity: item.quantity + 1,
        subtotal: calcSubtotal(item.quantity + 1, item.unit_price, item.discount_percent || 0, item.days ?? 1),
      } : item);
    } else {
      next = [...prev, {
        id: `temp-${crypto.randomUUID()}`, product_id: product.id, ...selection,
        quantity: 1, discount_percent: 0, subtotal: initialPrice,
        discount_amount: 0, total: 0, display_order: prev.length,
      }];
    }
    setOfferItemsSafe(next);
    return offerItemsRef.current;
  };

  // ✅ remove zwraca next
  const removeItem = (id: string) => {
    const prev = offerItemsRef.current;
    const next = prev.filter((i) => i.id !== id);
    setOfferItemsSafe(next);
    return offerItemsRef.current;
  };

  // ✅ update zwraca next
  const updateItem = (id: string, patch: Partial<IOfferItem>) => {
    const prev = offerItemsRef.current;

    const next = prev.map((i) => {
      if (i.id !== id) return i;
      const updated: any = { ...i, ...patch };
      if (updated.pricing_configuration) {
        if (!updated.pricing_configuration.modular && patch.unit_price !== undefined && patch.pricing_configuration === undefined) {
          const extras = configurationPrice(updated.pricing_configuration) - updated.pricing_configuration.base_unit_price;
          updated.pricing_configuration = { ...updated.pricing_configuration, base_unit_price: patch.unit_price - extras };
        }
        if (updated.pricing_configuration.product_package) {
          updated.unit = 'pakiet';
          updated.pricing_configuration = { ...updated.pricing_configuration, product_package: pricedPackageSelection(updated.pricing_configuration.product_package, updated.pricing_configuration.base_unit_price) };
        }
        updated.pricing_configuration = { ...updated.pricing_configuration, ...createConfiguration(updated.pricing_configuration.base_unit_price, updated.pricing_configuration.addons, updated.pricing_configuration.product_package) };
        if (updated.pricing_configuration.modular) {
          const c = updated.pricing_configuration;
          const manualPrice = patch.unit_price !== undefined && patch.pricing_configuration === undefined
            ? patch.unit_price : c.modular_price_source === 'manual' ? c.base_unit_price : undefined;
          updated.pricing_configuration = createModularConfiguration(c.modular, manualPrice);
        }
        updated.unit_price = configurationPrice(updated.pricing_configuration);
      }
      updated.subtotal = calcSubtotal(
        updated.quantity,
        updated.unit_price,
        updated.discount_percent || 0,
        updated.days ?? 1,
      );
      return updated;
    });

    setOfferItemsSafe(next);
    return offerItemsRef.current;
  };

  const addCustomItem = () => {
    const subtotal = calcSubtotal(
      customItem.quantity,
      customItem.unit_price,
      customItem.discount_percent,
      customItem.days ?? 1,
    );

    const newItem: IOfferWizardCustomItem = {
      id: `temp-${Date.now()}`,
      name: customItem.name,
      description: customItem.description,
      quantity: customItem.quantity,
      days: customItem.days ?? 1,
      unit: customItem.unit,
      unit_price: customItem.unit_price,
      discount_percent: customItem.discount_percent,
      subtotal,
      equipment_ids: customItem.equipment_ids,
      subcontractor_id: customItem.subcontractor_id,
      needs_subcontractor: customItem.needs_subcontractor,
    };

    const prev = offerItemsRef.current;
    const next = [...prev, newItem as IOfferItem];
    setOfferItemsSafe(next);

    // reset UI/form
    setCustomItem({
      name: '',
      description: '',
      unit: 'szt',
      unit_price: 0,
      discount_percent: 0,
      quantity: 1,
      equipment_ids: [],
      subcontractor_id: '',
      needs_subcontractor: false,
    } as any);

    setShowCustomItemForm(false);
    setShowEquipmentSelector(false);
    setShowSubcontractorSelector(false);

    return offerItemsRef.current;
  };

  return {
    offerItems,
    setOfferItems: setOfferItemsSafe, // ✅ dalej masz setter, ale bez rozjazdu z ref

    total,

    addProduct,
    removeItem,
    updateItem,

    // custom form UI
    showCustomItemForm,
    setShowCustomItemForm,
    customItem,
    setCustomItem,

    showEquipmentSelector,
    setShowEquipmentSelector,
    showSubcontractorSelector,
    setShowSubcontractorSelector,

    addCustomItem,
  };
}
