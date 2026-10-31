'use client';
import ModularProductConfigurator from '@/components/crm/offers/ModularProductConfigurator';
import { productConfigurationSnapshot, modularTitle, modularScope, type ProductConfigurationSnapshot } from '@/lib/CRM/Offers/modularProduct';
import ModularPriceHint from '@/components/crm/offers/ModularPriceHint';
import { createModularConfiguration } from '@/lib/CRM/Offers/offerAddons';
import InlineOfferAudience from '@/components/crm/offers/InlineOfferAudience';
import { resolveAudienceConfiguration, configurationNeedsTables, quantitySourceLabels, type QuantitySource } from '@/lib/CRM/Offers/audiencePricing';
import { QuantitySourceSelect } from '@/components/crm/offers/AudiencePricingEditor';
import { useOfferAudience } from '@/components/crm/offers/useOfferAudience';

import ProductPackagePicker from '@/components/crm/offers/ProductPackagePicker';
import { pricedPackageSelection, type ProductSalesPackage } from '@/lib/CRM/Offers/productSalesPackages';

import ProductAddonsEditor from '@/components/crm/offers/ProductAddonsEditor';
import { createConfiguration, configurationPrice, validateConfiguration, type ProductAddon } from '@/lib/CRM/Offers/offerAddons';

import { useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { IOfferItem } from '../../types';

import { VariantPricesEditor } from './VariantPricesEditor';

const VAT_RATES = [0, 5, 8, 23] as const;

interface EditOfferItemModalProps {
  item: IOfferItem | null;
  offerId?: string;
  vatRate?: number;
  onClose: () => void;
  onSuccess: (updatedItem?: Partial<IOfferItem>) => void | Promise<void>;
}

export default function EditOfferItemModal({
  item,
  offerId,
  vatRate = 23,
  onClose,
  onSuccess,
}: EditOfferItemModalProps) {
  const { showSnackbar } = useSnackbar();

  const [loading, setLoading] = useState(false);

  const [variantPrices, setVariantPrices] = useState<Record<string, number>>(() => ({
    ...(item?.variant_prices_net || {}),
    ...(item?.product_variant_id ? { [item.product_variant_id]: item.pricing_configuration?.base_unit_price ?? item.unit_price ?? 0 } : {}),
  }));
  const [quantity, setQuantity] = useState(item?.quantity ?? 1);
  const [quantitySource,setQuantitySource]=useState<QuantitySource>(item?.pricing_configuration?.quantity_source || 'manual');
  const {audience,error:audienceLoadError,loading:audienceLoading,saving:audienceSaving,saveAudience,reload:reloadAudience}=useOfferAudience(offerId);
  const [audienceDirty,setAudienceDirty]=useState(false);
  const [days, setDays] = useState(item?.days ?? 1);
  const [unitPrice, setUnitPrice] = useState(item?.pricing_configuration?.base_unit_price ?? item?.unit_price ?? 0);
  const [manualModularPrice, setManualModularPrice] = useState(item?.pricing_configuration?.modular_price_source === 'manual');
  const [addons, setAddons] = useState<ProductAddon[]>(() => (item?.pricing_configuration?.addons || []).map(a => ({ ...a })));
  const [modular, setModular] = useState<ProductConfigurationSnapshot | null>(() => item?.pricing_configuration?.modular ? structuredClone(item.pricing_configuration.modular) : null);
  const [packageOptions, setPackageOptions] = useState<ProductSalesPackage[]>(() => structuredClone(item?.pricing_configuration?.product_package?.options || (item?.product?.sales_packages_enabled ? item.product.sales_packages || [] : [])));
  const [selectedPackageId, setSelectedPackageId] = useState(item?.pricing_configuration?.product_package?.selected_id || '');
  const selectedPackage = packageOptions.find(p => p.id === selectedPackageId);
  const rawConfiguration = modular ? createModularConfiguration(modular, manualModularPrice ? unitPrice : undefined) : { ...createConfiguration(unitPrice, addons, selectedPackage ? pricedPackageSelection({ selected_id: selectedPackage.id, options: packageOptions }, unitPrice) : undefined), quantity_source: selectedPackage ? 'manual' as const : quantitySource };
  const resolvedAudience=resolveAudienceConfiguration(rawConfiguration,audience,quantity);
  const configuration=resolvedAudience.configuration;
  const resolvedQuantity=resolvedAudience.quantity;
  const audienceRequired = Boolean(selectedPackage?.audience_pricing) || rawConfiguration.quantity_source !== 'manual' || addons.some(a => a.quantity_source && a.quantity_source !== 'manual');
  const audienceError=audienceLoadError || (audienceDirty ? 'Zapisz liczbę osób przyciskiem nad wyborem pakietu.' : resolvedAudience.error ? 'Uzupełnij i zapisz dane w sekcji Uczestnicy oferty powyżej.' : null);
  const configuredPrice = configurationPrice(configuration);
  const [discountPercent, setDiscountPercent] = useState(item?.discount_percent ?? 0);
  const [itemVatRate, setItemVatRate] = useState(vatRate);
  const [name, setName] = useState(item?.name || item?.product?.name || '');
  const [selectedVariantId, setSelectedVariantId] = useState(item?.product_variant_id || '');
  const [showVariantPricesInPdf, setShowVariantPricesInPdf] = useState(item?.show_variant_prices_in_pdf !== false);
  const [showProductVariantsInPdf, setShowProductVariantsInPdf] = useState(item?.show_product_variants_in_pdf !== false);
  if (!item) return null;

  const productVariants = (item.product?.variants || []).filter((variant) => variant.is_active !== false);
  const missingPackageResources = selectedPackage && (!Array.isArray(selectedPackage.resources?.equipment) || !Array.isArray(selectedPackage.resources?.staff));
  const catalogPackage = item.product?.sales_packages?.find(p => p.id === selectedPackageId);
  const catalogResources = catalogPackage?.resources;
  const canImportResources = Array.isArray(catalogResources?.equipment) && Array.isArray(catalogResources?.staff);

  const handleSelectPackage = (id: string) => {
    setSelectedPackageId(id);
    const selected = packageOptions.find(option => option.id === id);
    if (selected) {
      setQuantity(1);
      setQuantitySource('manual');
      setSelectedVariantId('');
      setUnitPrice(selected.price_net);
      setAddons(selected.include_product_addons ? structuredClone(item.product?.pricing_addons || []) : []);
      setName(`${item.product?.name || item.name} — ${selected.name}`);
      return;
    }

    const variant = productVariants[0];
    setSelectedVariantId(variant?.id || '');
    setQuantitySource(variant?.quantity_source || item.product?.quantity_source || 'manual');
    setUnitPrice(Number(variant?.price_net ?? item.product?.base_price ?? 0));
    setAddons((item.product?.pricing_addons || []).map(addon => ({ ...addon })));
    setName(variant
      ? `${item.product?.name || item.name} — ${variant.name}`
      : item.product?.name || item.name);
  };

  const safeQuantity = Number.isFinite(resolvedQuantity) ? resolvedQuantity : 0;
  const safeUnitPrice = Number.isFinite(unitPrice) ? unitPrice : 0;
  const safeDiscountPercent = Number.isFinite(discountPercent) ? discountPercent : 0;

  const netto = safeQuantity * days * configuredPrice;
  const discountAmount = (netto * safeDiscountPercent) / 100;
  const nettoAfterDiscount = netto - discountAmount;
  const vatAmount = (nettoAfterDiscount * itemVatRate) / 100;
  const brutto = nettoAfterDiscount + vatAmount;

  const displayName = name || item.name || item.product?.name || 'Pozycja oferty';

  const handleSave = async () => {
    if (audienceLoading || audienceSaving || audienceError) { showSnackbar(audienceError || 'Wczytywanie liczby uczestników…','error'); return; }
    const safeName = name.trim();

    if (!safeName) {
      showSnackbar('Nazwa pozycji nie może być pusta', 'error');
      return;
    }

    if (!Number.isInteger(days) || days < 1 || days > 3650) { showSnackbar('Podaj liczbę dni od 1 do 3650.', 'error'); return; }

    if (safeQuantity <= 0) {
      showSnackbar('Ilość musi być większa od 0', 'error');
      return;
    }

    if (safeUnitPrice < 0) {
      showSnackbar('Cena nie może być ujemna', 'error');
      return;
    }

    if (safeDiscountPercent < 0 || safeDiscountPercent > 100) {
      showSnackbar('Rabat musi być w zakresie 0–100%', 'error');
      return;
    }

    if (Object.values(variantPrices).some(price => !Number.isFinite(price) || price < 0 || price > 999999999.99)) {
      showSnackbar('Podaj poprawne, nieujemne ceny wszystkich wariantów.', 'error'); return;
    }
    const addonError = validateConfiguration(configuration);
    if (addonError) { showSnackbar(addonError, 'error'); return; }
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('offer_items')
        .update({
          name: safeName,
          ...(modular ? { description: modularScope(modular).join('\n') } : {}),
          ...(selectedPackage ? { description: [selectedPackage.included_label, selectedPackage.bonus].filter(Boolean).join('. ') } : {}),
          quantity: safeQuantity,
          days,
          unit: modular ? 'zestaw' : selectedPackage ? 'pakiet' : quantitySource === 'guests' ? 'osoba' : quantitySource === 'tables' ? 'stół' : item.product?.unit || item.unit,
          unit_price: configuredPrice,
          pricing_configuration: configuration,
          discount_amount: Math.round(discountAmount * 100) / 100,
          discount_percent: safeDiscountPercent,
          product_variant_id: selectedVariantId || null,
          variant_prices_net: { ...variantPrices, ...(selectedVariantId ? { [selectedVariantId]: safeUnitPrice } : {}) },
          show_variant_prices_in_pdf: showVariantPricesInPdf,
          show_product_variants_in_pdf: showProductVariantsInPdf,
        })
        .eq('id', item.id)
        .select('*')
        .single();

      if (error) throw error;

      if (offerId) {
        const { error: offerError } = await supabase
          .from('offers')
          .update({ tax_percent: itemVatRate })
          .eq('id', offerId);

        if (offerError) {
          console.error('Error updating VAT rate:', offerError);
        }
      }
      showSnackbar('Pozycja zaktualizowana', 'success');

      await onSuccess({
        id: item.id,
        name: safeName,
        quantity: safeQuantity,
          days,
          unit: modular ? 'zestaw' : selectedPackage ? 'pakiet' : quantitySource === 'guests' ? 'osoba' : quantitySource === 'tables' ? 'stół' : item.product?.unit || item.unit,
        unit_price: configuredPrice,
          pricing_configuration: configuration,
          discount_amount: Math.round(discountAmount * 100) / 100,
        discount_percent: safeDiscountPercent,
        product_variant_id: selectedVariantId || null,
        variant_prices_net: { ...variantPrices, ...(selectedVariantId ? { [selectedVariantId]: safeUnitPrice } : {}) },
          show_variant_prices_in_pdf: showVariantPricesInPdf,
        show_product_variants_in_pdf: showProductVariantsInPdf,
        ...data,
      });

      onClose();
    } catch (error: any) {
      console.error('Error updating item:', error);
      showSnackbar(error?.message || 'Błąd podczas aktualizacji pozycji', 'error');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-3 text-base text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none md:px-4 md:py-2 md:text-sm';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 md:items-center md:p-4">
      <div className="flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-2xl border border-[#d3bb73]/20 bg-[#0f1119] md:max-w-2xl md:rounded-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#d3bb73]/20 bg-[#0f1119] px-4 py-4 md:px-6">
          <div>
            <h2 className="text-lg font-light text-[#e5e4e2] md:text-xl">Edytuj pozycję</h2>
            <p className="mt-0.5 line-clamp-1 text-xs text-[#e5e4e2]/50">{displayName}</p>
          </div>

          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2] disabled:opacity-50"
            aria-label="Zamknij"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 md:space-y-6 md:px-6">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]/60 p-4">
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/55">
              Nazwa pozycji w tej ofercie
            </label>

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />

            {item.product?.name && item.product.name !== name && (
              <p className="mt-2 text-xs text-[#e5e4e2]/40">Produkt bazowy: {item.product.name}</p>
            )}

            {(item.product?.description || item.description) && (
              <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-[#e5e4e2]/60">
                {item.description || item.product?.description}
              </p>
            )}
          </div>

          {missingPackageResources && <div className="space-y-2 rounded-lg bg-[#d3bb73]/10 p-3 text-sm text-[#e5e4e2]">
            <p>Pakiet „{selectedPackage.name}” w tej ofercie nie ma zapisanej konfiguracji sprzętu i obsady. Jest ona wymagana przed akceptacją.</p>
            {canImportResources ? <>
              <p className="text-xs text-[#e5e4e2]/65">Produkt ma już te dane. Możesz pobrać brakujące zasoby, sprawdzić je poniżej i zapisać pozycję. Stawki obsady wpłyną na wewnętrzny koszt realizacji.</p>
              <button type="button" disabled={loading} onClick={() => setPackageOptions(options => options.map(p => p.id === selectedPackageId ? { ...p, resources: {
                equipment: Array.isArray(p.resources?.equipment) ? p.resources.equipment : structuredClone(catalogResources!.equipment),
                staff: Array.isArray(p.resources?.staff) ? p.resources.staff : structuredClone(catalogResources!.staff),
              } } : p))} className="rounded-lg bg-[#d3bb73] px-3 py-2 text-[#1c1f33]">Pobierz sprzęt i obsadę z produktu</button>
            </> : <p className="text-xs text-[#e5e4e2]/65">Użyj przycisku „Sprzęt i obsada” poniżej. Jeśli pakiet ich nie wymaga, zatwierdź puste listy.</p>}
          </div>}
              <InlineOfferAudience audience={audience} needsTables={configurationNeedsTables(rawConfiguration)} required={audienceRequired} loading={audienceLoading} saving={audienceSaving} loadError={audienceLoadError} disabled={loading} onSave={saveAudience} onRetry={reloadAudience} onDirtyChange={setAudienceDirty} />
          {!modular && item.product?.configuration_schema && <div className="rounded-lg bg-[#d3bb73]/10 p-3 text-sm">
            <p>Ta pozycja zachowuje wcześniejszą wycenę. Możesz świadomie zastąpić ją konfiguracją według obecnego cennika produktu.</p>
            <button type="button" disabled={loading} className="mt-2 rounded-lg bg-[#d3bb73]/15 px-3 py-2 text-[#d3bb73]" onClick={() => {
              const next = productConfigurationSnapshot(item.product!.configuration_schema!);
              setModular(next); if (!manualModularPrice) setUnitPrice(createModularConfiguration(next).base_unit_price); setName(modularTitle(next));
              setSelectedPackageId(''); setPackageOptions([]); setSelectedVariantId(''); setVariantPrices({}); setQuantitySource('manual'); setQuantity(1); setAddons([]); setShowVariantPricesInPdf(false); setShowProductVariantsInPdf(false);
            }}>Przejdź na konfigurator — przelicz tę pozycję</button>
          </div>}
          {modular && <ModularProductConfigurator quantity={quantity} value={modular} disabled={loading} onChange={next => { setModular(next); if (!manualModularPrice) setUnitPrice(createModularConfiguration(next).base_unit_price); setName(modularTitle(next)); }} />}
          {modular && <ModularPriceHint value={modular} manual={manualModularPrice} disabled={loading} onReset={() => { setManualModularPrice(false); setUnitPrice(createModularConfiguration(modular).base_unit_price); }} />}
          {!modular && <ProductPackagePicker allowIndividual={!packageOptions.every(p=>p.price_on_request)} options={configuration.product_package?.options || packageOptions} selectedId={selectedPackageId} disabled={loading} discountPercent={discountPercent}
            onChange={options=>{setPackageOptions(options);const p=options.find(p=>p.id===selectedPackageId);if(p)setUnitPrice(p.price_net);}}
            onSelect={handleSelectPackage}
          />}
          {!modular && !selectedPackage && productVariants.length > 0 && (
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/55">
                Wariant produktu
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {productVariants.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => {
                      setSelectedVariantId(variant.id);
                      setQuantitySource(variant.quantity_source || 'manual');
                      setUnitPrice(Number(variantPrices[variant.id] ?? variant.price_net ?? 0));
                      setName(`${item.product?.name || item.name} — ${variant.name}`);
                    }}
                    className={`rounded-lg border px-3 py-3 text-left ${
                      selectedVariantId === variant.id
                        ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                        : 'border-[#d3bb73]/10 bg-[#1c1f33] hover:border-[#d3bb73]/30'
                    }`}
                  >
                    <span className="block text-sm font-medium text-[#e5e4e2]">{variant.name}</span>
                    <span className="mt-1 block text-xs text-[#d3bb73]">
                      {Number(variantPrices[variant.id] ?? variant.price_net ?? 0).toFixed(2)} PLN netto
                    </span>
                  </button>
                ))}
              </div>
              <VariantPricesEditor variants={productVariants} prices={variantPrices} disabled={loading} onChange={(id, price) => {
                setVariantPrices(current => ({ ...current, [id]: price }));
                if (id === selectedVariantId) setUnitPrice(price);
              }} />
              <div className="mt-3 space-y-2">
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2.5">
                  <span><span className="block text-sm text-[#e5e4e2]">Pokaż wszystkie warianty w PDF</span><span className="mt-0.5 block text-xs text-[#e5e4e2]/40">{addons.length ? 'Przy dodatkach pokazujemy wybrany wariant i jego szczegółową kalkulację' : 'Po wyłączeniu drukowany jest tylko wybrany wariant'}</span></span>
                  <input type="checkbox" checked={addons.length ? false : showProductVariantsInPdf} disabled={Boolean(addons.length)} onChange={(event) => setShowProductVariantsInPdf(event.target.checked)} className="h-4 w-4 accent-[#d3bb73]" />
                </label>
                <label className={`flex items-center justify-between gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2.5 ${showProductVariantsInPdf ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}>
                  <span><span className="block text-sm text-[#e5e4e2]">Pokaż ceny wariantów w PDF</span><span className="mt-0.5 block text-xs text-[#e5e4e2]/40">Cena netto i brutto VAT 23% przy każdym wariancie</span></span>
                  <input type="checkbox" checked={showVariantPricesInPdf} disabled={!showProductVariantsInPdf || Boolean(addons.length)} onChange={(event) => setShowVariantPricesInPdf(event.target.checked)} className="h-4 w-4 accent-[#d3bb73]" />
                </label>
              </div>
            </div>
          )}

          <div className="space-y-2 text-xs text-[#e5e4e2]/65">
            {!modular && !selectedPackage && <QuantitySourceSelect value={quantitySource} onChange={setQuantitySource}/>}
            {audience.guest_count && <p>Oferta dla {audience.guest_count} osób{configurationNeedsTables(configuration) ? ` · stoły: ${audience.table_count ?? Math.ceil(audience.guest_count/(audience.guests_per_table || 10))}` : ''}</p>}
            {selectedPackage?.audience_pricing && <p>Cena obliczana automatycznie. Stawki zmienisz w ustawieniach pakietu.</p>}
            {audienceError && <p role="alert" className="text-amber-300">{audienceError}</p>}
          </div>
          {!modular && <ProductAddonsEditor value={configuration.addons} onChange={setAddons} disabled={loading} />}
          {!modular && !item.pricing_configuration && !addons.length && Boolean(item.product?.pricing_addons?.length) && <button type="button" onClick={() => setAddons((item.product?.pricing_addons || []).map(a => ({ ...a })))} className="text-sm text-[#d3bb73]">Wczytaj obecne dodatki produktu do tej oferty</button>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/55">
                Ilość
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={resolvedQuantity}
                disabled={quantitySource !== 'manual' && !selectedPackage}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className={inputClass}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#e5e4e2]/55">Liczba dni</label>
              <input type="number" min="1" max="3650" step="1" value={days} onChange={e => setDays(Number(e.target.value))} className={inputClass} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/55">
                Cena bazowa netto / dzień
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                disabled={loading || Boolean(selectedPackage?.audience_pricing)}
                value={selectedPackage?.audience_pricing || (modular && !manualModularPrice) ? configuration.base_unit_price : Number.isFinite(unitPrice) ? unitPrice : ''}
                onChange={(e) => {
                  const price = e.target.value === '' ? NaN : Number(e.target.value);
                      if (modular) setManualModularPrice(true);
                  setUnitPrice(price);
                  if (selectedVariantId) setVariantPrices(current => ({ ...current, [selectedVariantId]: price }));
                }}
                className={inputClass}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/55">
                Rabat %
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(Number(e.target.value))}
                className={inputClass}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/55">
                Stawka VAT
              </label>
              <select
                value={itemVatRate}
                onChange={(e) => setItemVatRate(Number(e.target.value))}
                className={inputClass}
              >
                {VAT_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}%
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
            <div className="space-y-2 text-sm">
              <SummaryRow label="Netto" value={`${netto.toFixed(2)} PLN`} />

              {discountAmount > 0 && (
                <>
                  <SummaryRow
                    label={`Rabat (${safeDiscountPercent}%)`}
                    value={`-${discountAmount.toFixed(2)} PLN`}
                    valueClassName="text-green-400"
                  />
                  <SummaryRow
                    label="Netto po rabacie"
                    value={`${nettoAfterDiscount.toFixed(2)} PLN`}
                  />
                </>
              )}

              <SummaryRow label={`VAT (${itemVatRate}%)`} value={`${vatAmount.toFixed(2)} PLN`} />

              <div className="mt-3 flex items-center justify-between border-t border-[#d3bb73]/10 pt-3">
                <span className="text-sm font-medium text-[#e5e4e2]">Brutto</span>
                <span className="text-xl font-bold text-[#d3bb73]">{brutto.toFixed(2)} PLN</span>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 grid grid-cols-2 gap-3 border-t border-[#d3bb73]/20 bg-[#0f1119] p-4 md:flex md:justify-end md:px-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-4 py-3 text-sm font-medium text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/10 disabled:opacity-50 md:py-2"
          >
            Anuluj
          </button>

          <button
            onClick={handleSave}
            disabled={loading}
            className="rounded-lg bg-[#d3bb73] px-4 py-3 text-sm font-semibold text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50 md:py-2"
          >
            {loading ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  valueClassName = 'text-[#e5e4e2]',
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[#e5e4e2]/55">{label}</span>
      <span className={`text-right font-medium ${valueClassName}`}>{value}</span>
    </div>
  );
}
