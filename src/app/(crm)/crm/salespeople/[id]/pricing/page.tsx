'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  BedDouble,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  RotateCcw,
  Search,
  Truck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import SellerPricingThumbnail from './SellerPricingThumbnail';

type Brand = { id: string; name: string };

type PriceItem = {
  product_id: string;
  product_variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  offer_image_path?: string | null;
  pdf_thumbnail_url?: string | null;
  unit: string | null;
  category_id: string | null;
  category_name: string | null;
  direct_price_net: number;
  default_price_net: number;
  price_net: number | null;
  effective_price_net: number;
  is_available: boolean;
  requires_accommodation: boolean;
  accommodation_note: string | null;
  estimated_logistics_cost: number | null;
  logistics_note: string | null;
  additional_requirements: string | null;
};

type PriceListResponse = { access_policy?: string; default_markup_percent: number; items: PriceItem[] };

const fieldClass = 'w-full rounded-lg border border-white/8 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/35 focus:shadow-[0_0_0_2px_rgba(211,187,115,0.08)]';

const money = (value: number | null | undefined) => new Intl.NumberFormat('pl-PL', {
  style: 'currency', currency: 'PLN', minimumFractionDigits: 2,
}).format(Number(value || 0));

const itemKey = (item: Pick<PriceItem, 'product_id' | 'product_variant_id'>) =>
  `${item.product_id}:${item.product_variant_id || 'base'}`;

export default function SellerPricingPage() {
  const params = useParams<{ id: string }>();
  const sellerId = params.id;
  const [sellerName, setSellerName] = useState('Sprzedawca');
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState('');
  const [items, setItems] = useState<PriceItem[]>([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [defaultMarkup, setDefaultMarkup] = useState(20);

  useEffect(() => {
    if (!sellerId) return;
    void (async () => {
      setLoading(true);
      const [profileResult, termsResult, companiesResult] = await Promise.all([
        supabase.from('sales_partner_profiles').select('id,employee_id,contact_id').eq('id', sellerId).maybeSingle(),
        supabase.from('sales_partner_brand_terms').select('my_company_id,is_active').eq('sales_partner_id', sellerId).eq('is_active', true),
        supabase.from('my_companies').select('id,name').eq('is_active', true).order('name'),
      ]);

      if (profileResult.error || !profileResult.data) {
        setMessage({ type: 'error', text: profileResult.error?.message || 'Nie znaleziono sprzedawcy.' });
        setLoading(false);
        return;
      }

      const profile = profileResult.data;
      if (profile.contact_id) {
        const { data } = await supabase.from('contacts').select('full_name').eq('id', profile.contact_id).maybeSingle();
        if (data?.full_name) setSellerName(data.full_name);
      } else if (profile.employee_id) {
        const { data } = await supabase.from('employees').select('name,surname').eq('id', profile.employee_id).maybeSingle();
        if (data) setSellerName(`${data.name || ''} ${data.surname || ''}`.trim() || 'Sprzedawca');
      }

      const activeIds = new Set((termsResult.data || []).map((term) => term.my_company_id));
      const availableBrands = (companiesResult.data || []).filter((company) => activeIds.has(company.id));
      setBrands(availableBrands);
      setBrandId((current) => current || availableBrands[0]?.id || '');
      if (termsResult.error || companiesResult.error) {
        setMessage({ type: 'error', text: termsResult.error?.message || companiesResult.error?.message || 'Nie udało się pobrać marek.' });
      }
      setLoading(false);
    })();
  }, [sellerId]);

  useEffect(() => {
    if (!sellerId || !brandId) { setItems([]); return; }
    void (async () => {
      setPricesLoading(true);
      setMessage(null);
      const { data, error } = await supabase.rpc('get_sales_partner_price_list', {
        p_sales_partner_id: sellerId,
        p_company_id: brandId,
      });
      if (error) {
        setItems([]);
        setMessage({ type: 'error', text: error.message });
      } else {
        const response = (data || {}) as PriceListResponse;
        if (response.access_policy !== 'explicit_grant') {
          setItems([]);
          setDirty(false);
          setMessage({ type: 'error', text: 'Cennik wymaga migracji 20260908203000 w Supabase. Wprowadza ona dostęp do produktów wyłącznie po zaznaczeniu „Dostępny”. Do tego czasu zapis cennika jest wyłączony.' });
          setPricesLoading(false);
          return;
        }
        setDefaultMarkup(Number(response.default_markup_percent || 20));
        setItems((response.items || []).map((item) => ({
          ...item,
          is_available: item.is_available === true,
          direct_price_net: Number(item.direct_price_net || 0),
          default_price_net: Number(item.default_price_net || 0),
          price_net: item.price_net == null ? null : Number(item.price_net),
          effective_price_net: Number(item.effective_price_net || 0),
          estimated_logistics_cost: item.estimated_logistics_cost == null ? null : Number(item.estimated_logistics_cost),
        })));
        setDirty(false);
      }
      setPricesLoading(false);
    })();
  }, [brandId, sellerId]);

  const updateItem = (key: string, patch: Partial<PriceItem>) => {
    setItems((current) => current.map((item) => itemKey(item) === key ? { ...item, ...patch } : item));
    setDirty(true);
    setMessage(null);
  };

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pl-PL');
    const grouped = new Map<string, { name: string; category: string; imagePath?: string | null; fallbackPath?: string | null; entries: PriceItem[] }>();
    items.forEach((item) => {
      const searchable = `${item.product_name} ${item.variant_name || ''} ${item.category_name || ''}`.toLocaleLowerCase('pl-PL');
      if (query && !searchable.includes(query)) return;
      const current = grouped.get(item.product_id) || { name: item.product_name, category: item.category_name || 'Bez kategorii', imagePath: item.offer_image_path, fallbackPath: item.pdf_thumbnail_url, entries: [] };
      if (!current.imagePath && item.offer_image_path) current.imagePath = item.offer_image_path;
      current.entries.push(item);
      grouped.set(item.product_id, current);
    });
    return [...grouped.entries()];
  }, [items, search]);

  const toggleExpanded = (key: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const savePrices = async () => {
    if (!brandId) return;
    setSaving(true);
    setMessage(null);
    const { error } = await supabase.rpc('save_sales_partner_price_list', {
      p_sales_partner_id: sellerId,
      p_company_id: brandId,
      p_items: items.map((item) => ({
        product_id: item.product_id,
        product_variant_id: item.product_variant_id,
        price_net: item.price_net,
        is_available: item.is_available,
        requires_accommodation: item.requires_accommodation,
        accommodation_note: item.accommodation_note,
        estimated_logistics_cost: item.estimated_logistics_cost,
        logistics_note: item.logistics_note,
        additional_requirements: item.additional_requirements,
      })),
    });
    setSaving(false);
    if (error) { setMessage({ type: 'error', text: error.message }); return; }
    setDirty(false);
    setItems((current) => current.map((item) => ({ ...item, effective_price_net: item.price_net ?? item.default_price_net })));
    setMessage({ type: 'success', text: 'Indywidualny cennik został zapisany.' });
  };

  if (loading) return <div className="p-10 text-center text-[#d3bb73]">Ładowanie cennika...</div>;

  return (
    <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/crm/salespeople" className="inline-flex items-center gap-2 text-xs text-[#e5e4e2]/45 hover:text-[#d3bb73]"><ArrowLeft className="h-4 w-4" /> Sprzedawcy</Link>
            <h1 className="mt-3 text-2xl font-light">Cennik: {sellerName}</h1>
            <p className="mt-1 max-w-3xl text-sm text-[#e5e4e2]/45">Każda pozycja bez własnej ceny otrzymuje automatycznie stawkę MAVINCI powiększoną o {defaultMarkup}%. Sprzedawca widzi tylko cenę wynikową.</p>
            <p className="mt-2 max-w-3xl text-xs text-[#d3bb73]/75">Nowi sprzedawcy oraz nowe produkty i warianty startują bez dostępu. Zaznacz „Dostępny” i zapisz cennik, aby udostępnić wybraną pozycję dla tej marki. Sama zmiana ceny nie przyznaje dostępu.</p>
          </div>
          <button type="button" onClick={savePrices} disabled={!dirty || saving || !brandId} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#111522] shadow-sm disabled:cursor-not-allowed disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Zapisz cennik</button>
        </header>

        {message && <div className={`rounded-lg px-4 py-3 text-sm ${message.type === 'error' ? 'bg-red-300/10 text-red-100' : 'bg-emerald-300/10 text-emerald-100'}`}>{message.text}</div>}

        <section className="grid gap-3 rounded-xl bg-[#1c1f33] p-4 shadow-sm md:grid-cols-[minmax(220px,340px)_1fr]">
          <label className="text-xs text-[#e5e4e2]/45">Marka<select value={brandId} onChange={(event) => setBrandId(event.target.value)} className={`${fieldClass} mt-1.5`}>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
          <label className="relative self-end"><Search className="absolute left-3 top-3 h-4 w-4 text-white/25" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj produktu, wariantu lub kategorii..." className={`${fieldClass} pl-9`} /></label>
        </section>

        {brands.length === 0 && <div className="rounded-xl bg-amber-300/10 p-6 text-sm text-amber-100">Najpierw przypisz sprzedawcy co najmniej jedną markę w kartotece sprzedawców.</div>}
        {pricesLoading && <div className="py-12 text-center text-[#d3bb73]"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>}

        {!pricesLoading && <div className="space-y-3">
          {visibleProducts.map(([productId, product]) => (
            <section key={productId} className="overflow-hidden rounded-xl bg-[#1c1f33] shadow-sm">
              <div className="flex items-center gap-3 bg-white/[0.025] px-4 py-3">
                <SellerPricingThumbnail key={`${productId}:${product.imagePath || ''}:${product.fallbackPath || ''}`} imagePath={product.imagePath} fallbackPath={product.fallbackPath} name={product.name} />
                <div className="min-w-0"><h2 className="break-words text-sm font-medium">{product.name}</h2><p className="text-[11px] text-[#e5e4e2]/35">{product.category}</p></div>
              </div>
              <div className="divide-y divide-white/5">
                {product.entries.map((item) => {
                  const key = itemKey(item);
                  const isExpanded = expanded.has(key);
                  const effectivePrice = item.price_net ?? item.default_price_net;
                  return (
                    <div key={key} className={`px-4 py-4 ${!item.is_available ? 'opacity-55' : ''}`}>
                      <div className="grid gap-3 lg:grid-cols-[minmax(180px,1fr)_150px_170px_120px_auto] lg:items-end">
                        <div><p className="text-sm">{item.variant_name || 'Cena podstawowa produktu'}</p><p className="mt-1 text-[11px] text-[#e5e4e2]/35">Stawka wewnętrzna: {money(item.direct_price_net)} · automatyczna +{defaultMarkup}%: {money(item.default_price_net)}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/35">Cena wynikowa</p><p className="mt-2 text-sm text-[#d3bb73]">{money(effectivePrice)}</p></div>
                        <label className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/35">Cena indywidualna netto<input type="number" min="0" step="0.01" value={item.price_net ?? ''} onChange={(event) => updateItem(key, { price_net: event.target.value === '' ? null : Number(event.target.value) })} placeholder={String(item.default_price_net.toFixed(2))} className={`${fieldClass} mt-1 py-1.5`} /></label>
                        <label className="flex h-9 items-center gap-2 rounded-lg bg-white/[0.035] px-3 text-xs"><input type="checkbox" checked={item.is_available} onChange={(event) => updateItem(key, { is_available: event.target.checked })} /> Dostępny</label>
                        <div className="flex justify-end gap-1"><button type="button" onClick={() => updateItem(key, { price_net: null })} title="Przywróć cenę automatyczną" className="rounded-lg p-2 text-white/35 hover:bg-white/5 hover:text-[#d3bb73]"><RotateCcw className="h-4 w-4" /></button><button type="button" onClick={() => toggleExpanded(key)} className="flex items-center gap-1 rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-white/60 hover:bg-white/[0.07]">Warunki {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button></div>
                      </div>

                      {isExpanded && <div className="mt-4 grid gap-3 rounded-xl bg-[#0f1119]/70 p-4 md:grid-cols-2">
                        <label className="flex items-center gap-3 rounded-lg bg-white/[0.035] px-3 py-2.5 text-sm"><BedDouble className="h-4 w-4 text-[#d3bb73]" /><input type="checkbox" checked={item.requires_accommodation} onChange={(event) => updateItem(key, { requires_accommodation: event.target.checked })} /> Wymagany nocleg</label>
                        <label className="text-xs text-[#e5e4e2]/45">Notatka o noclegu<input value={item.accommodation_note || ''} onChange={(event) => updateItem(key, { accommodation_note: event.target.value })} placeholder="Np. 1 pokój jednoosobowy, 2 noce" className={`${fieldClass} mt-1.5`} /></label>
                        <label className="text-xs text-[#e5e4e2]/45"><span className="flex items-center gap-2"><Truck className="h-3.5 w-3.5" /> Szacowany koszt logistyki — tylko CRM</span><input type="number" min="0" step="0.01" value={item.estimated_logistics_cost ?? ''} onChange={(event) => updateItem(key, { estimated_logistics_cost: event.target.value === '' ? null : Number(event.target.value) })} placeholder="0,00" className={`${fieldClass} mt-1.5`} /></label>
                        <label className="text-xs text-[#e5e4e2]/45">Warunek logistyczny widoczny dla sprzedawcy<input value={item.logistics_note || ''} onChange={(event) => updateItem(key, { logistics_note: event.target.value })} placeholder="Np. transport wyceniany po podaniu adresu" className={`${fieldClass} mt-1.5`} /></label>
                        <label className="text-xs text-[#e5e4e2]/45 md:col-span-2">Dodatkowe wymagania widoczne dla sprzedawcy<textarea value={item.additional_requirements || ''} onChange={(event) => updateItem(key, { additional_requirements: event.target.value })} rows={2} placeholder="Np. dostęp do obiektu 3 godziny przed wydarzeniem" className={`${fieldClass} mt-1.5 resize-y`} /></label>
                      </div>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {brandId && visibleProducts.length === 0 && <p className="py-12 text-center text-sm text-white/35">Nie znaleziono produktów.</p>}
        </div>}
      </div>
    </div>
  );
}
