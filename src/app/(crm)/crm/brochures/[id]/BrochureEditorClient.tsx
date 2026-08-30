'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Building2,
  Download,
  Eye,
  FileText,
  GripVertical,
  ImageIcon,
  LayoutTemplate,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

type Brochure = {
  id: string;
  name: string;
  title: string;
  subtitle: string | null;
  introduction: string | null;
  closing_text: string | null;
  audience_type: string;
  organization_id: string | null;
  my_company_id: string;
  contact_employee_id: string | null;
  current_pdf_path: string | null;
  current_pdf_version: number;
  modified_after_generation: boolean;
  generated_at: string | null;
};

type Variant = {
  id: string;
  name: string;
  short_description: string | null;
  description: string | null;
  benefits: string[] | null;
  offer_image_path: string | null;
  display_order: number;
};

type Product = {
  id: string;
  name: string;
  description: string | null;
  offer_short_description: string | null;
  offer_description: string | null;
  offer_benefits: string[] | null;
  offer_image_path: string | null;
  category: { id: string; name: string } | null;
  variants: Variant[];
};

type BrochureItem = {
  id: string;
  product_id: string;
  product_variant_id: string | null;
  display_order: number;
  custom_title: string | null;
  custom_short_description: string | null;
  custom_description: string | null;
  custom_benefits: string[] | null;
  custom_image_path: string | null;
  page_layout: 'visual' | 'classic' | 'compact';
  is_visible: boolean;
  product: Product;
  variant: Variant | null;
};

type Organization = { id: string; name: string; email: string | null; business_type: string };
type Company = { id: string; name: string };
type Employee = { id: string; name: string | null; surname: string | null; email: string | null };

const inputClass = 'w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/45 disabled:opacity-50';
const cardClass = 'rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]';
const one = <T,>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? value[0] || null : value || null;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];

const itemTitle = (item: BrochureItem) => item.custom_title
  || (item.variant?.name ? `${item.product.name} — ${item.variant.name}` : item.product.name);
const itemShort = (item: BrochureItem) => item.custom_short_description
  || item.variant?.short_description || item.product.offer_short_description || '';
const itemDescription = (item: BrochureItem) => item.custom_description
  || item.variant?.description || item.product.offer_description || item.product.description || '';
const itemBenefits = (item: BrochureItem) => {
  if (item.custom_benefits?.length) return item.custom_benefits;
  const variantBenefits = strings(item.variant?.benefits);
  return variantBenefits.length ? variantBenefits : strings(item.product.offer_benefits);
};

export default function BrochureEditorClient({ brochureId }: { brochureId: string }) {
  const router = useRouter();
  const { employee, isAdmin, hasScope, loading: employeeLoading } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const canManage = isAdmin || hasScope('offers_manage');
  const [brochure, setBrochure] = useState<Brochure | null>(null);
  const [items, setItems] = useState<BrochureItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [brochureRes, itemsRes, productsRes, organizationsRes, companiesRes, employeesRes] = await Promise.all([
      supabase.from('sales_brochures').select('*').eq('id', brochureId).maybeSingle(),
      supabase.from('sales_brochure_items').select(`
        *,product:offer_products(id,name,description,offer_short_description,offer_description,offer_benefits,offer_image_path,category:event_categories(id,name)),
        variant:offer_product_variants(id,name,short_description,description,benefits,offer_image_path,display_order)
      `).eq('brochure_id', brochureId).order('display_order'),
      supabase.from('offer_products').select(`
        id,name,description,offer_short_description,offer_description,offer_benefits,offer_image_path,category:event_categories(id,name),
        variants:offer_product_variants(id,name,short_description,description,benefits,offer_image_path,display_order,is_active)
      `).eq('is_active', true).order('display_order'),
      supabase.from('organizations').select('id,name,email,business_type').eq('status', 'active').order('name').limit(1000),
      supabase.from('my_companies').select('id,name').eq('is_active', true).order('is_default', { ascending: false }),
      supabase.from('employees').select('id,name,surname,email').eq('is_active', true).order('surname'),
    ]);
    const error = brochureRes.error || itemsRes.error || productsRes.error || organizationsRes.error || companiesRes.error || employeesRes.error;
    if (error) {
      showSnackbar(error.code === 'PGRST205' ? 'Najpierw uruchom migrację modułu broszur' : error.message, 'error');
      if (!quiet) setLoading(false);
      return;
    }
    if (!brochureRes.data) {
      showSnackbar('Nie znaleziono broszury', 'error');
      router.push('/crm/brochures');
      return;
    }

    const normalizedProducts = (productsRes.data || []).map((row: any) => ({
      ...row,
      category: one(row.category),
      variants: (row.variants || []).filter((variant: any) => variant.is_active !== false)
        .sort((a: Variant, b: Variant) => a.display_order - b.display_order),
    })) as Product[];
    const normalizedItems = (itemsRes.data || []).map((row: any) => ({
      ...row,
      product: one(row.product),
      variant: one(row.variant),
      custom_benefits: row.custom_benefits ? strings(row.custom_benefits) : null,
    })).filter((item: any) => item.product) as BrochureItem[];
    const loadedBrochure = brochureRes.data as Brochure;
    setBrochure(loadedBrochure);
    setProducts(normalizedProducts);
    setItems(normalizedItems);
    setOrganizations((organizationsRes.data || []) as Organization[]);
    setCompanies((companiesRes.data || []) as Company[]);
    setEmployees((employeesRes.data || []) as Employee[]);
    setSelectedItemId((current) => current && normalizedItems.some((item) => item.id === current) ? current : normalizedItems[0]?.id || null);

    const paths = Array.from(new Set([
      ...normalizedProducts.flatMap((product) => [product.offer_image_path, ...product.variants.map((variant) => variant.offer_image_path)]),
      ...normalizedItems.map((item) => item.custom_image_path),
    ].filter(Boolean))) as string[];
    const signed = await Promise.all(paths.map(async (path) => {
      if (/^https?:\/\//i.test(path)) return [path, path] as const;
      const { data } = await supabase.storage.from('offer-product-pages').createSignedUrl(path, 3600, {
        transform: { width: 900, resize: 'cover', quality: 80 },
      });
      return [path, data?.signedUrl || ''] as const;
    }));
    setImageUrls(Object.fromEntries(signed));
    if (loadedBrochure.current_pdf_path) {
      const { data } = await supabase.storage.from('generated-brochures').createSignedUrl(loadedBrochure.current_pdf_path, 3600);
      setPdfUrl(data?.signedUrl || null);
    } else setPdfUrl(null);
    if (!quiet) setLoading(false);
  }, [brochureId, router, showSnackbar]);

  useEffect(() => { if (!employeeLoading) void load(); }, [employeeLoading, load]);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId) || null, [items, selectedItemId]);
  const catalogProducts = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    return query ? products.filter((product) => `${product.name} ${product.category?.name || ''}`.toLowerCase().includes(query)) : products;
  }, [catalogQuery, products]);
  const updateBrochure = <K extends keyof Brochure>(key: K, value: Brochure[K]) => setBrochure((current) => current ? { ...current, [key]: value } : current);
  const updateItem = <K extends keyof BrochureItem>(key: K, value: BrochureItem[K]) => setItems((current) => current.map((item) => item.id === selectedItemId ? { ...item, [key]: value } : item));

  const save = async (): Promise<boolean> => {
    if (!brochure || !canManage || busy) return false;
    setBusy('save');
    try {
      const { error } = await supabase.from('sales_brochures').update({
        name: brochure.name.trim(), title: brochure.title.trim(), subtitle: brochure.subtitle?.trim() || null,
        introduction: brochure.introduction?.trim() || null, closing_text: brochure.closing_text?.trim() || null,
        audience_type: brochure.audience_type, organization_id: brochure.organization_id || null,
        my_company_id: brochure.my_company_id, contact_employee_id: brochure.contact_employee_id || null,
        updated_by: employee?.id || null,
      }).eq('id', brochure.id);
      if (error) throw error;
      for (const item of items) {
        const { error: itemError } = await supabase.from('sales_brochure_items').update({
          display_order: item.display_order, custom_title: item.custom_title?.trim() || null,
          custom_short_description: item.custom_short_description?.trim() || null,
          custom_description: item.custom_description?.trim() || null,
          custom_benefits: item.custom_benefits?.filter(Boolean) || null,
          custom_image_path: item.custom_image_path || null, page_layout: item.page_layout, is_visible: item.is_visible,
        }).eq('id', item.id);
        if (itemError) throw itemError;
      }
      showSnackbar('Zapisano broszurę', 'success');
      await load(true);
      return true;
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się zapisać broszury', 'error');
      return false;
    } finally { setBusy(null); }
  };

  const addProduct = async (product: Product, variant: Variant | null) => {
    if (!canManage || busy) return;
    setBusy(`add-${variant?.id || product.id}`);
    const { error } = await supabase.from('sales_brochure_items').insert({
      brochure_id: brochureId, product_id: product.id, product_variant_id: variant?.id || null, display_order: items.length,
    });
    if (error) showSnackbar(error.code === '23505' ? 'Ta usługa lub wariant jest już w broszurze' : error.message, 'error');
    else { await load(true); showSnackbar('Dodano usługę do broszury', 'success'); }
    setBusy(null);
  };

  const removeItem = async (itemId: string) => {
    if (!canManage || busy || !window.confirm('Usunąć tę usługę z broszury?')) return;
    setBusy(`remove-${itemId}`);
    const { error } = await supabase.from('sales_brochure_items').delete().eq('id', itemId);
    if (error) showSnackbar(error.message, 'error');
    else { await load(true); showSnackbar('Usunięto usługę z broszury', 'success'); }
    setBusy(null);
  };

  const reorder = async (ordered: BrochureItem[]) => {
    const next = ordered.map((item, index) => ({ ...item, display_order: index }));
    setItems(next);
    if (!canManage) return;
    const results = await Promise.all(next.map((item) => supabase.from('sales_brochure_items').update({ display_order: item.display_order }).eq('id', item.id)));
    const failed = results.find((result) => result.error);
    if (failed?.error) showSnackbar(failed.error.message, 'error');
    else setBrochure((current) => current ? { ...current, modified_after_generation: Boolean(current.current_pdf_path) } : current);
  };

  const moveItem = (itemId: string, direction: -1 | 1) => {
    const index = items.findIndex((item) => item.id === itemId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    void reorder(next);
  };

  const dropItem = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    if (!draggedId || draggedId === targetId) return;
    const from = items.findIndex((item) => item.id === draggedId);
    const to = items.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDraggedId(null);
    void reorder(next);
  };

  const generatePdf = async () => {
    if (!brochure || busy || !(await save())) return;
    setBusy('pdf');
    try {
      const response = await fetch('/bridge/brochures/generate-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brochureId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Nie udało się wygenerować PDF');
      setPdfUrl(result.downloadUrl || null);
      await load(true);
      showSnackbar('Wygenerowano nową wersję PDF', 'success');
    } catch (error: any) { showSnackbar(error?.message || 'Nie udało się wygenerować PDF', 'error'); }
    finally { setBusy(null); }
  };

  const createCampaign = async () => {
    if (!brochure || busy) return;
    setBusy('campaign');
    try {
      const { data, error } = await supabase.rpc('create_hotel_brochure_campaign', {
        p_brochure_id: brochure.id, p_name: null, p_subject: null,
      });
      if (error) throw error;
      router.push(`/crm/campaigns?campaign=${data}`);
    } catch (error: any) { showSnackbar(error?.message || 'Nie udało się przygotować kampanii', 'error'); }
    finally { setBusy(null); }
  };

  if (employeeLoading || loading) return <div className="flex min-h-[60vh] items-center justify-center text-[#d3bb73]"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  if (!brochure) return null;

  return (
    <main className="min-h-screen bg-[#0f1119] p-4 text-[#e5e4e2] lg:p-6">
      <div className="mx-auto max-w-[1750px] space-y-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <button type="button" onClick={() => router.push('/crm/brochures')} className="mt-1 rounded-lg border border-[#d3bb73]/15 p-2 text-[#e5e4e2]/55 hover:text-[#d3bb73]"><ArrowLeft className="h-4 w-4" /></button>
            <div><div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[.18em] text-[#d3bb73]"><BookOpen className="h-4 w-4" /> Edytor broszury</div><h1 className="text-2xl font-light">{brochure.name}</h1><p className="mt-1 text-sm text-[#e5e4e2]/45">Katalog zasila treść bazową. Personalizacja nie zmienia produktu globalnie.</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={!canManage || Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/25 px-4 py-2.5 text-sm text-[#d3bb73] disabled:opacity-40">{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Zapisz</button>
            {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/25 px-4 py-2.5 text-sm"><Download className="h-4 w-4" /> PDF v{brochure.current_pdf_version}</a>}
            <button type="button" onClick={() => void generatePdf()} disabled={!canManage || Boolean(busy) || items.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#1c1f33] disabled:opacity-40">{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Generuj PDF</button>
            <button type="button" onClick={() => void createCampaign()} disabled={!pdfUrl || brochure.modified_after_generation || Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg border border-violet-400/25 px-4 py-2.5 text-sm text-violet-200 disabled:opacity-40"><Megaphone className="h-4 w-4" /> Utwórz szkic kampanii</button>
          </div>
        </header>

        {brochure.current_pdf_version > 0 && brochure.modified_after_generation && <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">Treść zmieniła się od wygenerowania PDF. Przed użyciem w kampanii utwórz nową wersję.</div>}

        <section className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)_360px]">
          <aside className="space-y-5">
            <div className={`${cardClass} p-4`}>
              <h2 className="mb-4 flex items-center gap-2 text-sm font-medium"><LayoutTemplate className="h-4 w-4 text-[#d3bb73]" /> Ustawienia</h2>
              <div className="space-y-3">
                <Field label="Nazwa robocza"><input value={brochure.name} disabled={!canManage} onChange={(event) => updateBrochure('name', event.target.value)} className={inputClass} /></Field>
                <Field label="Tytuł okładki"><textarea rows={2} value={brochure.title} disabled={!canManage} onChange={(event) => updateBrochure('title', event.target.value)} className={inputClass} /></Field>
                <Field label="Podtytuł"><textarea rows={2} value={brochure.subtitle || ''} disabled={!canManage} onChange={(event) => updateBrochure('subtitle', event.target.value || null)} className={inputClass} /></Field>
                <Field label="Odbiorca"><select value={brochure.audience_type} disabled={!canManage} onChange={(event) => updateBrochure('audience_type', event.target.value)} className={inputClass}><option value="hotel">Hotel</option><option value="venue">Sala / obiekt</option><option value="agency">Agencja</option><option value="corporate">Klient biznesowy</option><option value="wedding">Branża weselna</option><option value="general">Ogólna</option></select></Field>
                <Field label="Personalizacja dla organizacji"><select value={brochure.organization_id || ''} disabled={!canManage} onChange={(event) => updateBrochure('organization_id', event.target.value || null)} className={inputClass}><option value="">Broszura ogólna</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></Field>
                <Field label="Marka / działalność"><select value={brochure.my_company_id} disabled={!canManage} onChange={(event) => updateBrochure('my_company_id', event.target.value)} className={inputClass}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></Field>
                <Field label="Opiekun"><select value={brochure.contact_employee_id || ''} disabled={!canManage} onChange={(event) => updateBrochure('contact_employee_id', event.target.value || null)} className={inputClass}><option value="">Bez wskazanego opiekuna</option>{employees.map((person) => <option key={person.id} value={person.id}>{[person.name, person.surname].filter(Boolean).join(' ') || person.email}</option>)}</select></Field>
                <Field label="Wprowadzenie"><textarea rows={5} value={brochure.introduction || ''} disabled={!canManage} onChange={(event) => updateBrochure('introduction', event.target.value || null)} className={inputClass} /></Field>
                <Field label="Zakończenie / CTA"><textarea rows={4} value={brochure.closing_text || ''} disabled={!canManage} onChange={(event) => updateBrochure('closing_text', event.target.value || null)} className={inputClass} /></Field>
              </div>
            </div>

            <div className={`${cardClass} overflow-hidden`}>
              <div className="border-b border-[#d3bb73]/10 p-4"><h2 className="text-sm font-medium">Katalog usług</h2><div className="mt-3 flex items-center gap-2 rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3"><Search className="h-4 w-4 text-[#d3bb73]" /><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Szukaj usługi…" className="w-full bg-transparent py-2.5 text-sm outline-none" /></div></div>
              <div className="max-h-[520px] space-y-2 overflow-y-auto p-2">
                {catalogProducts.map((product) => {
                  const imageUrl = product.offer_image_path ? imageUrls[product.offer_image_path] : '';
                  const baseAdded = items.some((item) => item.product_id === product.id && !item.product_variant_id);
                  return <div key={product.id} className="rounded-lg border border-[#d3bb73]/8 bg-[#0f1119] p-3"><div className="flex gap-3">{imageUrl ? <img src={imageUrl} alt="" className="h-12 w-16 rounded object-cover" /> : <div className="flex h-12 w-16 items-center justify-center rounded bg-[#1c1f33]"><ImageIcon className="h-4 w-4 text-[#e5e4e2]/25" /></div>}<div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{product.name}</div><div className="mt-0.5 text-[11px] text-[#e5e4e2]/35">{product.category?.name || 'Bez kategorii'}</div></div><button type="button" disabled={!canManage || baseAdded || Boolean(busy)} onClick={() => void addProduct(product, null)} className="self-start rounded-md border border-[#d3bb73]/20 p-1.5 text-[#d3bb73] disabled:opacity-25" title="Dodaj produkt bazowy"><Plus className="h-4 w-4" /></button></div>{product.variants.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{product.variants.map((variant) => { const added = items.some((item) => item.product_variant_id === variant.id); return <button key={variant.id} type="button" disabled={!canManage || added || Boolean(busy)} onClick={() => void addProduct(product, variant)} className="rounded-full border border-[#d3bb73]/15 px-2.5 py-1 text-[11px] text-[#e5e4e2]/55 disabled:opacity-25">{added ? '✓ ' : '+ '}{variant.name}</button>; })}</div>}</div>;
                })}
              </div>
            </div>
          </aside>

          <section className="space-y-5">
            <div className={`${cardClass} overflow-hidden`}>
              <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-4 py-3"><div><h2 className="text-sm font-medium">Kolejność stron usługowych</h2><p className="mt-1 text-xs text-[#e5e4e2]/35">Przeciągnij lub użyj strzałek. Okładka, wstęp i kontakt powstają automatycznie.</p></div><span className="text-xs text-[#d3bb73]">{items.length} usług</span></div>
              <div className="space-y-2 p-3">
                {items.length === 0 && <div className="py-16 text-center text-sm text-[#e5e4e2]/35">Dodaj usługi z katalogu po lewej stronie.</div>}
                {items.map((item, index) => <button key={item.id} type="button" draggable={canManage} onDragStart={() => setDraggedId(item.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropItem(event, item.id)} onClick={() => setSelectedItemId(item.id)} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left ${selectedItemId === item.id ? 'border-[#d3bb73]/45 bg-[#d3bb73]/10' : 'border-[#d3bb73]/8 bg-[#0f1119]'}`}><GripVertical className="h-4 w-4 shrink-0 text-[#e5e4e2]/25" /><span className="w-7 shrink-0 text-xs text-[#d3bb73]">{String(index + 1).padStart(2, '0')}</span><ItemImage item={item} imageUrls={imageUrls} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{itemTitle(item)}</span><span className="mt-0.5 block truncate text-xs text-[#e5e4e2]/35">{item.variant?.name || item.product.category?.name || 'Produkt bazowy'}</span></span><span className="flex shrink-0 gap-1"><span onClick={(event) => { event.stopPropagation(); moveItem(item.id, -1); }} className="rounded p-1 text-[#e5e4e2]/40 hover:text-[#d3bb73]"><ArrowUp className="h-4 w-4" /></span><span onClick={(event) => { event.stopPropagation(); moveItem(item.id, 1); }} className="rounded p-1 text-[#e5e4e2]/40 hover:text-[#d3bb73]"><ArrowDown className="h-4 w-4" /></span><span onClick={(event) => { event.stopPropagation(); void removeItem(item.id); }} className="rounded p-1 text-red-300/55 hover:text-red-300"><Trash2 className="h-4 w-4" /></span></span></button>)}
              </div>
            </div>

            {selectedItem && <div className={`${cardClass} p-4 md:p-5`}><div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-light">Treść strony</h2><p className="mt-1 text-xs text-[#e5e4e2]/40">Puste nadpisanie oznacza aktualną treść katalogową.</p></div><button type="button" disabled={!canManage} onClick={() => setItems((current) => current.map((item) => item.id === selectedItem.id ? { ...item, custom_title: null, custom_short_description: null, custom_description: null, custom_benefits: null, custom_image_path: null } : item))} className="text-xs text-[#d3bb73]">Przywróć katalog</button></div><div className="space-y-4"><Field label="Układ strony"><select value={selectedItem.page_layout} disabled={!canManage} onChange={(event) => updateItem('page_layout', event.target.value as BrochureItem['page_layout'])} className={inputClass}><option value="visual">Wizualny — duże zdjęcie</option><option value="classic">Klasyczny</option><option value="compact">Kompaktowy</option></select></Field><Field label="Tytuł"><input value={selectedItem.custom_title ?? itemTitle(selectedItem)} disabled={!canManage} onChange={(event) => updateItem('custom_title', event.target.value)} className={inputClass} /></Field><Field label="Lead"><textarea rows={3} value={selectedItem.custom_short_description ?? itemShort(selectedItem)} disabled={!canManage} onChange={(event) => updateItem('custom_short_description', event.target.value)} className={inputClass} /></Field><Field label="Opis"><textarea rows={8} value={selectedItem.custom_description ?? itemDescription(selectedItem)} disabled={!canManage} onChange={(event) => updateItem('custom_description', event.target.value)} className={inputClass} /></Field><Field label="Korzyści — jedna w wierszu"><textarea rows={6} value={(selectedItem.custom_benefits ?? itemBenefits(selectedItem)).join('\n')} disabled={!canManage} onChange={(event) => updateItem('custom_benefits', event.target.value.split('\n').map((line) => line.trim()).filter(Boolean))} className={inputClass} /></Field></div></div>}
          </section>

          <aside className="xl:sticky xl:top-5 xl:self-start">
            <div className={`${cardClass} overflow-hidden`}><div className="flex items-center gap-2 border-b border-[#d3bb73]/10 px-4 py-3 text-sm"><Eye className="h-4 w-4 text-[#d3bb73]" /> Szybki podgląd</div><div className="aspect-[210/297] overflow-hidden bg-[#650026] text-white"><div className="relative flex h-full flex-col p-[9%]"><div className="absolute -right-[24%] -top-[12%] h-[45%] w-[78%] rounded-full bg-[#8f0035]/70" /><div className="absolute -right-[12%] -top-[7%] h-[35%] w-[62%] rounded-full border border-[#d3bb73]" /><div className="relative z-10 text-sm font-bold tracking-[.35em] text-[#d3bb73]">MAVINCI</div><div className="relative z-10 mt-[36%] text-[10px] font-bold tracking-[.16em] text-[#d3bb73]">BROSZURA USŁUG</div><div className="relative z-10 mt-4 text-2xl font-light leading-tight">{brochure.title || 'Oferta współpracy'}</div>{brochure.subtitle && <div className="relative z-10 mt-3 text-xs leading-5 text-white/65">{brochure.subtitle}</div>}<div className="relative z-10 mt-auto flex justify-between border-t border-[#d3bb73] pt-3 text-[8px] text-white/65"><span>{items.length} obszarów współpracy</span><span>01</span></div></div></div><div className="p-4 text-xs leading-5 text-[#e5e4e2]/45"><div className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-[#d3bb73]" />{organizations.find((item) => item.id === brochure.organization_id)?.name || 'Wersja ogólna'}</div><div className="mt-2 flex items-center gap-2"><RefreshCw className="h-3.5 w-3.5 text-[#d3bb73]" />{brochure.generated_at ? `Ostatni PDF: ${new Date(brochure.generated_at).toLocaleString('pl-PL')}` : 'PDF nie został jeszcze wygenerowany'}</div></div></div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs text-[#e5e4e2]/45">{label}</span>{children}</label>;
}

function ItemImage({ item, imageUrls }: { item: BrochureItem; imageUrls: Record<string, string> }) {
  const path = item.custom_image_path || item.variant?.offer_image_path || item.product.offer_image_path;
  const url = path ? imageUrls[path] : '';
  return url ? <img src={url} alt="" className="h-12 w-16 shrink-0 rounded object-cover" /> : <div className="h-12 w-16 shrink-0 rounded bg-[#1c1f33]" />;
}
