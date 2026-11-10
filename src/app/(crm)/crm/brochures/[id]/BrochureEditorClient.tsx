'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArchiveRestore,
  BookOpen,
  Building2,
  Download,
  Eye,
  FileText,
  ImageIcon,
  LayoutTemplate,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import BrochureDecorativePagesEditor from './BrochureDecorativePagesEditor';
import BrochureImagePicker from './BrochureImagePicker';
import BrochurePageList from './BrochurePageList';
import BrochureDemoReport from './BrochureDemoReport';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import BrochureManagementDialog, { type BrochureManagementAction } from '@/components/crm/brochures/BrochureManagementDialog';
import SendBrochureEmailModal from '@/components/crm/brochures/SendBrochureEmailModal';
import BrochureClientPicker from '@/components/crm/brochures/BrochureClientPicker';
import type { BrochureClient } from '@/lib/brochures/recipient';
import BrochureValidationPanel from '@/components/crm/brochures/BrochureValidationPanel';
import { brochurePageReferences, validateBrochureContent, BrochureValidationError, type BrochureValidationIssue } from '@/lib/brochures/validation';
import { readBrochureResponse } from '@/components/crm/brochures/delivery';
import styles from './BrochureEditor.module.css';
import { buildSalesBrochureHtml, type SalesBrochureSnapshot } from '@/lib/brochures/buildSalesBrochureHtml';
import { brochureAssetKey, brochurePalette, parseDecorativePages, parseComposer, orderedBrochureKeys, resolvedBenefits, BROCHURE_LAYOUTS, type BrochureComposer, type BrochureDecorativePage, type BrochureImageAsset } from '@/lib/brochures/decorativePages';

type Brochure = {
  id: string;
  name: string;
  status: 'draft' | 'ready' | 'archived';
  updated_at: string;
  title: string;
  subtitle: string | null;
  introduction: string | null;
  closing_text: string | null;
  audience_type: string;
  organization_id: string | null;
  my_company_id: string;
  contact_employee_id: string | null;
  cover_image_path: string | null;
  current_pdf_path: string | null;
  current_pdf_version: number;
  modified_after_generation: boolean;
  generated_at: string | null;
  brand_config: Record<string, unknown>;
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
  offer_compact_description?: string | null;
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
type Employee = { id: string; name: string | null; surname: string | null; email: string | null; phone_number?: string | null };

const inputClass = `${styles.field} w-full rounded-lg bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/45 disabled:opacity-50`;
const cardClass = 'rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]';
const one = <T,>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? value[0] || null : value || null;

const itemTitle = (item: BrochureItem) => item.custom_title
  || (item.variant?.name ? `${item.product.name} — ${item.variant.name}` : item.product.name);
const itemShort = (item: BrochureItem) => item.custom_short_description
  || item.variant?.short_description || item.product.offer_short_description || '';
const itemDescription = (item: BrochureItem) => item.custom_description
  || item.variant?.description || (item.page_layout === 'compact' ? item.product.offer_compact_description : null) || item.product.offer_description || item.product.description || '';
const itemBenefits = (item: BrochureItem) => resolvedBenefits(item.custom_benefits, item.variant?.benefits, item.product.offer_benefits);

export default function BrochureEditorClient({ brochureId }: { brochureId: string }) {
  const router = useRouter();
  const { employee, isAdmin, hasScope, loading: employeeLoading } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const canManage = isAdmin || hasScope('offers_manage');
  const canViewResults = isAdmin || hasScope('offers_brochures_view_own') || hasScope('offers_brochures_view_all');
  const [brochure, setBrochure] = useState<Brochure | null>(null);
  const [items, setItems] = useState<BrochureItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipient, setRecipient] = useState<BrochureClient | null>(null);
  const [ownPdfVersion, setOwnPdfVersion] = useState<number | null>(null);
  const [ownPdfRecipient, setOwnPdfRecipient] = useState('');
  const [reportRevision, setReportRevision] = useState(0);
  const [showBrochureMail, setShowBrochureMail] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [managementAction, setManagementAction] = useState<BrochureManagementAction | null>(null);
  const [selectedPageKey, setSelectedPageKey] = useState('cover');
  const [libraryAssets, setLibraryAssets] = useState<BrochureImageAsset[]>([]);
  const [hotelAssets, setHotelAssets] = useState<BrochureImageAsset[]>([]);
  const [assetNotice, setAssetNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [validationIssues, setValidationIssues] = useState<BrochureValidationIssue[] | null>(null);
  const [validationStale, setValidationStale] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [editTarget, setEditTarget] = useState<{ key: string; field: string } | null>(null);
  const openedValidationLink = useRef<string | null>(null);
  const [previewCompany, setPreviewCompany] = useState<SalesBrochureSnapshot['company']>({ name: 'MAVINCI', primaryColor: '#d3bb73', secondaryColor: '#1c1f33' });
  const decorationPages = useMemo(() => parseDecorativePages(brochure?.brand_config?.decorative_pages), [brochure?.brand_config]);
  const composer = useMemo(() => parseComposer(brochure?.brand_config?.composer), [brochure?.brand_config]);
  const productAssets = useMemo<BrochureImageAsset[]>(() => products.flatMap((product) => [
    ...(product.offer_image_path ? [{ key: brochureAssetKey('offer-product-pages', product.offer_image_path), label: product.name, path: product.offer_image_path, bucket: 'offer-product-pages' as const }] : []),
    ...product.variants.filter((v) => v.offer_image_path).map((v) => ({ key: brochureAssetKey('offer-product-pages', v.offer_image_path!), label: `${product.name} — ${v.name}`, path: v.offer_image_path!, bucket: 'offer-product-pages' as const })),
  ]), [products]);
  const decorationAssets = useMemo(() => [...new Map([...productAssets, ...libraryAssets, ...hotelAssets,
    ...items.filter((item) => item.custom_image_path).map((item) => ({
      key: brochureAssetKey('offer-product-pages', item.custom_image_path!), label: `Broszura: ${itemTitle(item)}`,
      path: item.custom_image_path!, bucket: 'offer-product-pages' as const,
    })),
    ...decorationPages.filter((p) => p.imagePath).map((p) => ({ key: brochureAssetKey(p.imageBucket, p.imagePath), label: `Broszura: ${p.slogan || 'grafika'}`, path: p.imagePath, bucket: p.imageBucket })),
    ...(composer.coverImagePath ? [{ key: brochureAssetKey(composer.coverImageBucket, composer.coverImagePath), label: 'Okładka broszury', path: composer.coverImagePath, bucket: composer.coverImageBucket }] : []),
  ].map((asset) => [asset.key, asset])).values()], [productAssets, libraryAssets, hotelAssets, items, decorationPages, composer.coverImagePath, composer.coverImageBucket]);
  const onUploadBusy = useCallback((uploading: boolean) => setBusy(uploading ? 'upload-image' : null), []);
  // The picker needs names for the whole library, but signed URLs only for
  // selected brochure images. Catalog thumbnails load lazily through the
  // existing authenticated thumbnail endpoint, with server-side resizing.
  const previewAssets = [
    ...items.map((item) => ({ bucket: 'offer-product-pages' as const,
      path: item.custom_image_path || item.variant?.offer_image_path || item.product.offer_image_path || '',
    })),
    ...decorationPages.map((page) => ({ bucket: page.imageBucket, path: page.imagePath })),
    { bucket: composer.coverImagePath ? composer.coverImageBucket : 'offer-product-pages' as const,
      path: composer.coverImagePath || brochure?.cover_image_path || '' },
  ].filter((asset) => asset.path);
  const assetPaths = JSON.stringify([...new Map(previewAssets.map((asset) =>
    [brochureAssetKey(asset.bucket, asset.path), asset])).values()]);
  // Scope cached private links to this editor and employee. Serialize successive
  // effects so loading a library or saving a page cannot launch another burst.
  const imageLoader = useMemo(() => ({
    cache: new Map<string, { url: string; expires: number }>(),
    queue: Promise.resolve(), retryAfter: 0,
  }), [brochureId, employee?.id]);
  const [imageRefresh, setImageRefresh] = useState(0);
  useEffect(() => { setImageUrls({}); }, [imageLoader]);
  useEffect(() => {
    let active = true;
    const assets: Array<Pick<BrochureImageAsset, 'bucket' | 'path'>> = JSON.parse(assetPaths);
    imageLoader.queue = imageLoader.queue.then(async () => {
      if (!active) return;
      const urls: Record<string, string> = {};
      const missing = new Map<string, string[]>();
      const addUrl = (bucket: string, path: string, url: string) => {
        urls[brochureAssetKey(bucket, path)] = url;
        if (bucket === 'offer-product-pages') urls[path] = url;
      };
      for (const { bucket, path } of assets) {
        if (/^https?:\/\//i.test(path)) { addUrl(bucket, path, path); continue; }
        const cached = imageLoader.cache.get(brochureAssetKey(bucket, path));
        if (cached && cached.expires > Date.now()) addUrl(bucket, path, cached.url);
        else missing.set(bucket, [...(missing.get(bucket) || []), path]);
      }
      if (active) setImageUrls((current) => ({ ...current, ...urls }));
      if (missing.size && imageLoader.retryAfter > Date.now()) return;
      let partial = false;
      for (const [bucket, paths] of missing) {
        for (let offset = 0; offset < paths.length; offset += 50) {
          if (!active) return;
          // One bounded request at a time, with the same authenticated RLS.
          const batch = paths.slice(offset, offset + 50);
          const { data, error } = await supabase.storage.from(bucket).createSignedUrls(batch, 3600);
          if (error) { imageLoader.retryAfter = Date.now() + 30_000; throw error; }
          const returned = new Map((data || []).map((image) => [image.path, image]));
          for (const path of batch) {
            const image = returned.get(path);
            const url = image && !image.error ? image.signedUrl || '' : '';
            if (!url) partial = true;
            imageLoader.cache.set(brochureAssetKey(bucket, path), {
              url, expires: Date.now() + (url ? 40 * 60_000 : 30_000),
            });
            addUrl(bucket, path, url);
          }
          if (active) setImageUrls((current) => ({ ...current, ...urls }));
        }
      }
      if (active && partial) showSnackbar('Nie udało się wczytać części zdjęć broszury. Spróbuj ponownie za chwilę.', 'warning');
    }).catch(() => {
      imageLoader.retryAfter = Date.now() + 30_000;
      if (active) showSnackbar('Nie udało się wczytać zdjęć broszury. Spróbuj ponownie za chwilę.', 'error');
    });
    // Refresh long-lived previews before their signed links expire.
    const refresh = window.setTimeout(() => setImageRefresh((value) => value + 1), 45 * 60_000);
    return () => { active = false; window.clearTimeout(refresh); };
  }, [assetPaths, imageLoader, imageRefresh, showSnackbar]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      supabase.from('offer_template_categories').select('name,hero_image_path').not('hero_image_path', 'is', null),
      supabase.from('portfolio_projects').select('title,image,image_metadata').order('order_index'),
    ]).then(([templates, portfolio]) => {
      if (!active) return;
      const publicAssets: BrochureImageAsset[] = (portfolio.data || []).flatMap((row: any) => {
        const path = row.image_metadata?.desktop?.src || row.image;
        return typeof path === 'string' && /^https?:\/\//i.test(path) ? [{ key: brochureAssetKey('offer-product-pages', path), path, bucket: 'offer-product-pages' as const, label: `Portfolio: ${row.title}` }] : [];
      });
      setLibraryAssets([...(templates.data || []).map((r) => ({ key: brochureAssetKey('offer-template-pages', r.hero_image_path), label: `Oferta: ${r.name}`, path: r.hero_image_path, bucket: 'offer-template-pages' as const })), ...publicAssets]);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setHotelAssets([]); setAssetNotice('');
    if (!brochure?.organization_id) return;
    void supabase.rpc('get_crm_offer_branding', { p_organization: brochure.organization_id }).then(({ data, error }) => {
      if (!active) return;
      if (error) { setAssetNotice('Biblioteka organizacji jest niedostępna. Nadal możesz wgrać własne zdjęcia.'); return; }
      const brand = data?.brands?.find((entry: any) => entry.id === brochure.my_company_id)?.branding;
      const images: Array<{ path: string; label: string }> = [
        ...(brand?.hotel_cover_image_url ? [{ path: brand.hotel_cover_image_url, label: 'Hotel: zdjęcie główne' }] : []),
        ...(Array.isArray(brand?.venue_image_urls) ? brand.venue_image_urls.map((path: string, i: number) => ({ path, label: `Hotel: galeria ${i + 1}` })) : []),
      ];
      setHotelAssets(images.filter((a) => typeof a.path === 'string' && a.path).map((a) => ({ ...a, bucket: 'seller-brand-assets', key: brochureAssetKey('seller-brand-assets', a.path) })));
      if (!images.length) setAssetNotice('Ta organizacja nie ma jeszcze zdjęć w bibliotece. Możesz wgrać je bezpośrednio do broszury.');
    });
    return () => { active = false; };
  }, [brochure?.organization_id, brochure?.my_company_id]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (!brochure?.my_company_id) return;
    let active = true;
    const companyId = brochure.my_company_id;
    void Promise.all([
      supabase.from('my_companies').select('name,logo_url,email,phone,website').eq('id', companyId).maybeSingle(),
      supabase.from('company_brandbook_logos').select('url,is_default,background,order_index').eq('company_id', companyId).order('is_default', { ascending: false }).order('order_index'),
      supabase.from('company_brandbook_colors').select('hex,role').eq('company_id', companyId),
      supabase.from('company_brandbook_fonts').select('family,role,file_url,storage_path,order_index').eq('company_id', companyId).order('order_index'),
    ]).then(([companyResult, logos, colors, fonts]) => {
      if (!active || !companyResult.data) return;
      const company = companyResult.data;
      const logo = logos.data?.find((logo) => logo.is_default) || logos.data?.find((logo) => logo.background === 'transparent') || logos.data?.[0];
      const rawLogo = logo?.url || company.logo_url;
      const font = fonts.data?.find((font) => font.role === 'heading' && (font.file_url || font.storage_path));
      const bodyFont = fonts.data?.find((font) => font.role === 'body');
      setPreviewCompany({ ...company, ...brochurePalette(colors.data || []), logoUrl: rawLogo ? /^https?:\/\//i.test(rawLogo) ? rawLogo : supabase.storage.from('company-logos').getPublicUrl(rawLogo).data.publicUrl : null,
        headingFontFamily: font?.family || null,
        bodyFontFamily: bodyFont?.family || null,
        bodyFontUrl: bodyFont?.file_url || (bodyFont?.storage_path ? supabase.storage.from('company-logos').getPublicUrl(bodyFont.storage_path).data.publicUrl : /\bInter\b/i.test(bodyFont?.family || '') ? `${window.location.origin}/fonts/Inter-Variable.ttf` : null),
        headingFontUrl: font?.file_url || (font?.storage_path ? supabase.storage.from('company-logos').getPublicUrl(font.storage_path).data.publicUrl : null),
      });
    });
    return () => { active = false; };
  }, [brochure?.my_company_id]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [brochureRes, itemsRes, productsRes, organizationsRes, companiesRes, employeesRes] = await Promise.all([
      supabase.from('sales_brochures').select('*').eq('id', brochureId).maybeSingle(),
      supabase.from('sales_brochure_items').select(`
        *,product:offer_products(id,name,description,offer_short_description,offer_description,offer_compact_description,offer_benefits,offer_image_path,category:event_categories(id,name)),
        variant:offer_product_variants(id,name,short_description,description,benefits,offer_image_path,display_order)
      `).eq('brochure_id', brochureId).order('display_order'),
      supabase.from('offer_products').select(`
        id,name,description,offer_short_description,offer_description,offer_compact_description,offer_benefits,offer_image_path,category:event_categories(id,name),
        variants:offer_product_variants(id,name,short_description,description,benefits,offer_image_path,display_order,is_active)
      `).eq('is_active', true).order('display_order'),
      supabase.from('organizations').select('id,name,email,business_type').eq('status', 'active').order('name').limit(1000),
      supabase.from('my_companies').select('id,name').eq('is_active', true).order('is_default', { ascending: false }),
      supabase.from('employees').select('id,name,surname,email,phone_number').eq('is_active', true).order('surname'),
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
      custom_benefits: Array.isArray(row.custom_benefits) ? row.custom_benefits.map(String) : null,
    })).filter((item: any) => item.product) as BrochureItem[];
    const loadedBrochure = brochureRes.data as Brochure;
    setBrochure(loadedBrochure);
    const loadedComposer = parseComposer(loadedBrochure.brand_config?.composer);
    const visibleKeys = orderedBrochureKeys(normalizedItems.filter((item) => item.is_visible), parseDecorativePages(loadedBrochure.brand_config?.decorative_pages), loadedComposer.pageOrder).filter((key) => !loadedComposer.hiddenPages.includes(key));
    setSelectedPageKey((current) => visibleKeys.includes(current) ? current : visibleKeys[0] || 'cover');
    setDirty(false);
    setProducts(normalizedProducts);
    setItems(normalizedItems);
    setOrganizations((organizationsRes.data || []) as Organization[]);
    setCompanies((companiesRes.data || []) as Company[]);
    setEmployees((employeesRes.data || []) as Employee[]);
    setSelectedItemId((current) => current && normalizedItems.some((item) => item.id === current) ? current : normalizedItems[0]?.id || null);

    setPdfUrl(null); setOwnPdfVersion(null); setOwnPdfRecipient('');
    const { data: currentEmployeeId } = await supabase.rpc('current_brochure_employee_id');
    if (currentEmployeeId) {
      const { data: ownGeneration } = await supabase.from('sales_brochure_generations')
        .select('pdf_path,file_name,version,snapshot').eq('brochure_id', brochureId).eq('created_by', currentEmployeeId)
        .order('version', { ascending: false }).limit(1).maybeSingle();
      if (ownGeneration) {
        const { data } = await supabase.storage.from('generated-brochures').createSignedUrl(ownGeneration.pdf_path, 3600, {
          download: ownGeneration.file_name,
        });
        setPdfUrl(data?.signedUrl || null); setOwnPdfVersion(ownGeneration.version);
        setOwnPdfRecipient(ownGeneration.snapshot?.recipient?.name || ownGeneration.snapshot?.recipientEmail || ownGeneration.snapshot?.demoAttribution?.recipientEmail || '');
      }
    }
    setReportRevision(value => value + 1);
    if (!quiet) setLoading(false);
  }, [brochureId, router, showSnackbar]);

  useEffect(() => { if (!employeeLoading) void load(); }, [employeeLoading, load]);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId) || null, [items, selectedItemId]);
  const catalogProducts = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    return query ? products.filter((product) => `${product.name} ${product.category?.name || ''}`.toLowerCase().includes(query)) : products;
  }, [catalogQuery, products]);
  const updateBrochure = <K extends keyof Brochure>(key: K, value: Brochure[K]) => { setDirty(true); setBrochure((current) => current ? { ...current, [key]: value, modified_after_generation: Boolean(current.current_pdf_path) } : current); };
  const updateItem = <K extends keyof BrochureItem>(key: K, value: BrochureItem[K]) => {
    setDirty(true);
    setItems((current) => current.map((item) => item.id === selectedItemId ? { ...item, [key]: value } : item));
    setBrochure((current) => current ? { ...current, modified_after_generation: Boolean(current.current_pdf_path) } : current);
  };
  const updateComposer = (patch: Partial<BrochureComposer>) => {
    if (!brochure) return;
    updateBrochure('brand_config', { ...brochure.brand_config, composer: { ...composer, ...patch } });
  };
  const updateDecorations = (pages: BrochureDecorativePage[]) => {
    setDirty(true);
    setBrochure((current) => current ? {
      ...current, brand_config: { ...(current.brand_config || {}), decorative_pages: pages,
        composer: { ...parseComposer(current.brand_config?.composer), pageOrder: orderedBrochureKeys(items, pages.map((p) => ({ ...p, isVisible: true })), parseComposer(current.brand_config?.composer).pageOrder) } },
      modified_after_generation: Boolean(current.current_pdf_path),
    } : current);
  };
  const selectPage = (key: string) => { setSelectedPageKey(key); if (key.startsWith('product:')) setSelectedItemId(key.slice(8)); };
  const togglePage = (key: string) => {
    if (!canManage || busy) return;
    if (key.startsWith('decorative:')) updateDecorations(decorationPages.map((p) => p.id === key.slice(11) ? { ...p, isVisible: !p.isVisible } : p));
    else if (key.startsWith('product:')) { setDirty(true); setItems((current) => current.map((item) => item.id === key.slice(8) ? { ...item, is_visible: !item.is_visible } : item)); setBrochure((current) => current ? { ...current, modified_after_generation: Boolean(current.current_pdf_path) } : current); }
    else updateComposer({ hiddenPages: composer.hiddenPages.includes(key) ? composer.hiddenPages.filter((k) => k !== key) : [...composer.hiddenPages, key] });
  };
  const pageRows = orderedBrochureKeys(items, decorationPages.map((p) => ({ ...p, isVisible: true })), composer.pageOrder).map((key) => {
    const item = key.startsWith('product:') ? items.find((i) => i.id === key.slice(8)) : null;
    const page = key.startsWith('decorative:') ? decorationPages.find((p) => p.id === key.slice(11)) : null;
    if (item) {
      const path = item.custom_image_path || item.variant?.offer_image_path || item.product.offer_image_path || '';
      return { key, title: itemTitle(item), subtitle: 'Usługa z katalogu', visible: item.is_visible, imageUrl: imageUrls[brochureAssetKey('offer-product-pages', path)] || imageUrls[path] };
    }
    if (page) return { key, title: page.slogan || 'Gotowa grafika', subtitle: BROCHURE_LAYOUTS[page.layout], visible: page.isVisible, imageUrl: imageUrls[brochureAssetKey(page.imageBucket, page.imagePath)] };
    return { key, title: ({ cover: 'Okładka', intro: 'Wprowadzenie', closing: 'Kontakt i następny krok' } as Record<string, string>)[key] || 'Strona', subtitle: 'Treść w ustawieniach po lewej', visible: !composer.hiddenPages.includes(key) };
  });

  // Retain the report while editing; it is no longer a verdict on the new draft.
  useEffect(() => { setValidationStale(true); }, [brochure, items]);
  useEffect(() => {
    if (loading || !brochure || openedValidationLink.current === brochureId) return;
    openedValidationLink.current = brochureId;
    const params = new URLSearchParams(window.location.search);
    const key = params.get('page');
    if (!key || !pageRows.some((row) => row.key === key)) return;
    setSelectedPageKey(key);
    if (key.startsWith('product:')) setSelectedItemId(key.slice(8));
    setEditTarget({ key, field: params.get('field') || 'layout' });
  }, [loading, brochure, brochureId, pageRows]);
  useEffect(() => {
    if (!editTarget || loading || busy || selectedPageKey !== editTarget.key) return;
    const frame = requestAnimationFrame(() => {
      const targetId = editTarget.key.startsWith('decorative:') ? 'brochure-page-studio'
        : editTarget.key.startsWith('product:') ? (editTarget.field === 'imagePath' ? 'brochure-product-image' : 'brochure-product-fields')
          : editTarget.key === 'cover' && editTarget.field === 'imagePath' ? 'brochure-cover-image' : 'brochure-settings';
      const container = document.getElementById(targetId);
      const field = Array.from(container?.querySelectorAll<HTMLElement>('[data-brochure-field]') || [])
        .find((element) => element.dataset.brochureField === editTarget.field);
      const target = field || container;
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.querySelector<HTMLElement>('input:not([type="file"]), textarea, select, button')?.focus({ preventScroll: true });
      setEditTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [editTarget, loading, busy, selectedPageKey]);
  const editValidationIssue = (issue: BrochureValidationIssue) => {
    if (!pageRows.some((row) => row.key === issue.pageKey)) {
      showSnackbar('Ta strona została usunięta. Sprawdź broszurę ponownie.', 'info');
      return;
    }
    selectPage(issue.pageKey);
    setEditTarget({ key: issue.pageKey, field: issue.field });
  };
  const revealValidation = () => requestAnimationFrame(() => {
    const panel = document.getElementById('brochure-validation');
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel?.focus({ preventScroll: true });
  });

  const save = async (notify = true): Promise<boolean> => {
    if (!brochure || !canManage || busy) return false;
    if (!brochure.name.trim() || !brochure.title.trim()) { showSnackbar('Uzupełnij nazwę broszury i tytuł okładki.', 'error'); return false; }
    setBusy('save');
    try {
      const { error } = await supabase.from('sales_brochures').update({
        name: brochure.name.trim(), title: brochure.title.trim(), subtitle: brochure.subtitle?.trim() || null,
        introduction: brochure.introduction?.trim() || null, closing_text: brochure.closing_text?.trim() || null,
        audience_type: brochure.audience_type, organization_id: brochure.organization_id || null, cover_image_path: brochure.cover_image_path || null,
        my_company_id: brochure.my_company_id, contact_employee_id: brochure.contact_employee_id || null,
        brand_config: { ...(brochure.brand_config || {}), decorative_pages: decorationPages, composer },
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
      if (notify) showSnackbar('Zapisano broszurę', 'success');
      await load(true);
      return true;
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się zapisać broszury', 'error');
      return false;
    } finally { setBusy(null); }
  };

  const addProduct = async (product: Product, variant: Variant | null) => {
    if (!canManage || busy) return;
    if (!(await save(false))) return;
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
    if (!(await save(false))) return;
    setBusy(`remove-${itemId}`);
    const { error } = await supabase.from('sales_brochure_items').delete().eq('id', itemId);
    if (error) showSnackbar(error.message, 'error');
    else { await load(true); showSnackbar('Usunięto usługę z broszury', 'success'); }
    setBusy(null);
  };

  const generatePdf = async (validateOnly = false) => {
    if (!brochure || busy || !canManage || !canViewResults) return;
    if (recipientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())) { showSnackbar('Wpisz prawidłowy e-mail odbiorcy lub pozostaw pole puste.', 'error'); return; }
    setValidationError('');
    const references = brochurePageReferences(items.filter((item) => item.is_visible).map((item) => ({
      id: item.id, title: itemTitle(item),
    })), decorationPages, composer);
    const contentIssues = validateBrochureContent(decorationPages, references);
    if (contentIssues.length) {
      setValidationIssues(contentIssues); setValidationStale(false); revealValidation();
      showSnackbar('Uzupełnij wskazane pola. Szczegóły znajdziesz w raporcie broszury.', 'error');
      return;
    }
    if (dirty && !(await save(false))) return;
    setBusy(validateOnly ? 'validate' : 'pdf');
    try {
      const response = await fetch('/bridge/brochures/generate-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brochureId, recipientEmail, recipient, validateOnly }),
      });
      const result = await readBrochureResponse<{ downloadUrl?: string; pageCount?: number; generation?: { version: number } }>(response, 'Nie udało się sprawdzić broszury.');
      if (!validateOnly) {
        await load(true);
        setPdfUrl(result.downloadUrl || null);
        if (result.generation) setOwnPdfVersion(result.generation.version);
        setOwnPdfRecipient(recipient?.name || recipientEmail.trim());
      }
      setValidationIssues([]); setValidationStale(false);
      showSnackbar(validateOnly ? 'Sprawdzono obrazy, czcionki i układ. Nie utworzono nowego PDF.'
        : recipient ? 'PDF zapisany w zakładce Broszury klienta. Wersja ogólna pozostała bez zmian. Nie wysłano wiadomości.'
          : 'Wygenerowano nową wersję PDF', 'success');
    } catch (error: any) {
      if (error instanceof BrochureValidationError) {
        setValidationIssues(error.issues); setValidationStale(false); revealValidation();
        showSnackbar('Nie utworzono PDF. W raporcie wskazaliśmy elementy wymagające sprawdzenia.', 'error');
      } else {
        const message = error?.message || 'Nie udało się sprawdzić broszury. Spróbuj ponownie.';
        setValidationError(message); setValidationStale(true); showSnackbar(message, 'error');
      }
    }
    finally { setBusy(null); }
  };

  const openBrochureMail = async () => {
    if (!canManage || !canViewResults || busy) return;
    if (dirty && !(await save())) return;
    setShowBrochureMail(true);
  };

  const createCampaign = async () => {
    if (!brochure || busy || !canViewResults) return;
    if (recipient || recipientEmail.trim()) { showSnackbar('Do kampanii wybierz wersję ogólną: bez powiązanego klienta i bez e-maila odbiorcy.', 'error'); return; }
    if (!brochure.current_pdf_path || brochure.modified_after_generation || dirty) { showSnackbar('Przed utworzeniem kampanii wygeneruj aktualną ogólną wersję PDF.', 'error'); return; }
    setBusy('campaign');
    try {
      const { data: currentGeneration, error: generationError } = await supabase.from('sales_brochure_generations').select('snapshot,created_by,recipient_contact_id,recipient_organization_id,recipient_email').eq('brochure_id', brochure.id).eq('version', brochure.current_pdf_version).single();
      if (generationError) throw generationError;
      if (currentGeneration.created_by !== employee?.id) throw new Error('Do kampanii potrzebujesz własnej ogólnej wersji PDF. Wygeneruj ją bez klienta i e-maila odbiorcy.');
      if (currentGeneration?.snapshot?.demoAttribution?.campaignId) throw new Error('Bieżący PDF jest przypisany do innej kampanii. Wygeneruj ogólną wersję przed utworzeniem kolejnej kampanii.');
      if (currentGeneration?.recipient_contact_id || currentGeneration?.recipient_organization_id || currentGeneration?.recipient_email
        || currentGeneration?.snapshot?.recipientEmail || currentGeneration?.snapshot?.demoAttribution?.recipientEmail) {
        throw new Error('Bieżący PDF jest przypisany do klienta. Do kampanii wygeneruj wersję ogólną bez klienta i e-maila odbiorcy.');
      }
      const { data, error } = await supabase.rpc('create_hotel_brochure_campaign', {
        p_brochure_id: brochure.id, p_name: null, p_subject: null,
      });
      if (error) throw error;
      if (brochure.brand_config?.seller_demo_enabled === true) {
        const response = await fetch('/bridge/brochures/generate-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brochureId, campaignId: data }) });
        if (!response.ok) showSnackbar('Szkic kampanii powstał. Przygotuj jej PDF przyciskiem w kampanii — generowanie nie zostało zakończone.', 'error');
      }
      router.push(`/crm/campaigns?campaign=${data}`);
    } catch (error: any) { showSnackbar(error?.message || 'Nie udało się przygotować kampanii', 'error'); }
    finally { setBusy(null); }
  };

  if (employeeLoading || loading) return <div className="flex min-h-[60vh] items-center justify-center text-[#d3bb73]"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  if (!brochure) return null;

  const managementDialog = managementAction && <BrochureManagementDialog key={`${brochure.id}:${managementAction}`}
    action={managementAction} brochure={brochure} canManage={canManage} hasUnsavedChanges={dirty}
    onClose={() => setManagementAction(null)} onSuccess={(updated) => {
      setBrochure((current) => current ? { ...current, ...updated,
        modified_after_generation: current.modified_after_generation || updated.modified_after_generation,
      } : current);
      setManagementAction(null);
      if (managementAction === 'remove') {
        setDirty(false);
        router.replace('/crm/brochures');
      }
    }} />;

  if (brochure.status === 'archived') return (
    <main className={`${styles.editor} min-h-screen bg-[#0f1119] p-5 text-[#e5e4e2]`}>
      <div className="mx-auto max-w-2xl space-y-5 rounded-xl bg-[#1c1f33] p-6">
        <button type="button" onClick={() => router.push('/crm/brochures')} className="inline-flex items-center gap-2 text-sm text-[#d3bb73]"><ArrowLeft className="h-4 w-4" /> Lista broszur</button>
        <h1 className="break-words text-2xl font-light uppercase">{brochure.name}</h1>
        <p className="text-sm leading-6 text-white/65">Ta broszura jest w archiwum. Zapisane wersje PDF i historia wysyłek nie zostały usunięte. Przywróć ją, aby ponownie edytować treść lub generować PDF.</p>
        {pdfUrl && <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm text-[#d3bb73]"><Download className="h-4 w-4" /> Ostatni zapisany PDF</a>}
        {canManage && <button type="button" onClick={() => setManagementAction('restore')} disabled={Boolean(managementAction)} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#1c1f33] disabled:opacity-50"><ArchiveRestore className="h-4 w-4" /> Przywróć broszurę</button>}
      </div>
      {managementDialog}
    </main>
  );

  return (
    <main className={`${styles.editor} min-h-screen bg-[#0f1119] p-4 text-[#e5e4e2] lg:p-6`}>
      <div className="w-full space-y-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <button type="button" onClick={() => { if (!dirty || window.confirm('Masz niezapisane zmiany. Opuścić kreator?')) router.push('/crm/brochures'); }} className="mt-1 rounded-lg border border-[#d3bb73]/15 p-2 text-[#e5e4e2]/55 hover:text-[#d3bb73]"><ArrowLeft className="h-4 w-4" /></button>
            <div><div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[.18em] text-[#d3bb73]"><BookOpen className="h-4 w-4" /> Edytor broszury</div><h1 className="text-2xl font-light">{brochure.name}</h1><p className="mt-1 text-sm text-[#e5e4e2]/45">Katalog zasila treść bazową. Personalizacja nie zmienia produktu globalnie. {dirty ? 'Masz niezapisane zmiany.' : 'Zmiany zapisane.'}</p></div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button type="button" onClick={() => void generatePdf(true)} disabled={!canManage || !canViewResults || Boolean(busy) || !pageRows.some((p) => p.visible)} className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 text-sm text-[#d3bb73] disabled:opacity-40">{busy === 'validate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Sprawdź broszurę</button>
            <button type="button" onClick={() => void generatePdf()} disabled={!canManage || !canViewResults || Boolean(busy) || !pageRows.some((p) => p.visible)} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#1c1f33] disabled:opacity-40">{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} {recipient ? 'Generuj PDF dla klienta' : 'Generuj PDF'}</button>
            <ResponsiveActionBar alwaysDropdown disabledBackground actions={[
              { label: 'Zmień nazwę', icon: <Pencil className="h-4 w-4" />, onClick: () => setManagementAction('rename'), show: canManage, disabled: Boolean(busy) },
              { label: 'Studio stron', icon: <LayoutTemplate className="h-4 w-4" />, onClick: () => document.getElementById('brochure-page-studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
              { label: busy === 'save' ? 'Zapisywanie…' : 'Zapisz', icon: busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />, onClick: () => void save(), disabled: !canManage || Boolean(busy) },
              { label: `Ostatni PDF v${ownPdfVersion}${ownPdfRecipient ? ` — ${ownPdfRecipient}` : ' — ogólny'}`, icon: <Download className="h-4 w-4" />, onClick: () => { if (pdfUrl) window.open(pdfUrl, '_blank', 'noopener,noreferrer'); }, show: Boolean(pdfUrl) },
              { label: 'Wyślij broszurę', icon: <FileText className="h-4 w-4" />, onClick: () => void openBrochureMail(), disabled: !canManage || !canViewResults || Boolean(busy) },
              { label: 'Utwórz szkic kampanii', icon: <Megaphone className="h-4 w-4" />, onClick: () => void createCampaign(), disabled: !canManage || !canViewResults || dirty || !brochure.current_pdf_path || brochure.modified_after_generation || Boolean(busy) },
              { label: 'Usuń broszurę', icon: <Trash2 className="h-4 w-4" />, variant: 'danger', onClick: () => setManagementAction('remove'), show: canManage, disabled: Boolean(busy) },
            ]} />
          </div>
        </header>
        <p className="text-xs leading-5 text-white/50">Sprawdzanie zapisuje bieżące zmiany i sprawdza obrazy, czcionki oraz układ stron. Nie tworzy nowej wersji PDF ani nie wysyła wiadomości. Generowanie PDF również wykonuje te kontrole.</p>
        {validationError && <p role="alert" className="rounded-lg bg-amber-400/10 p-4 text-sm text-amber-200">{validationError}</p>}
        {validationIssues !== null && <BrochureValidationPanel brochureId={brochureId} issues={validationIssues} stale={validationStale} disabled={Boolean(busy)} onEdit={editValidationIssue} />}

        <div className={`${cardClass} space-y-4 p-4`}>
          <BrochureClientPicker value={recipient} disabled={!canManage || Boolean(busy)} onChange={(client, suggestedEmail) => {
            setRecipient(client);
            if (suggestedEmail !== undefined) setRecipientEmail(suggestedEmail);
          }} />
          <label className="block text-xs text-white/60">E-mail odbiorcy tej wersji PDF — opcjonalnie
            <input type="email" maxLength={200} value={recipientEmail} disabled={!canManage || Boolean(busy)}
              onChange={event => setRecipientEmail(event.target.value)} placeholder="np. sprzedaz@hotel.pl" className={`${inputClass} mt-2 max-w-md`} />
          </label>
          <p className="text-xs leading-5 text-white/45">
            Generowanie zapisuje osobny PDF, ale nie wysyła wiadomości. Plik przypisany do klienta zostaje w jego kartotece i nie zastępuje wersji ogólnej.
            {' '}E-mail możesz zmienić lub pozostawić pusty; nie zmienia to danych kontaktu w CRM.
          </p>
          {brochure.brand_config?.seller_demo_enabled === true && <p className="text-xs leading-5 text-white/45">
            Link demo będzie przypisany do Ciebie i podanego e-maila, ukrytego w zaszyfrowanym linku.
            Przy przekazaniu pliku dalej przypisanie nadal dotyczy pierwotnego odbiorcy.
          </p>}
        </div>

        {brochure.current_pdf_version > 0 && brochure.modified_after_generation && <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">Treść zmieniła się od wygenerowania PDF. Przed użyciem w kampanii utwórz nową wersję.</div>}

        {showBrochureMail&&<SendBrochureEmailModal brochureId={brochure.id} onClose={()=>setShowBrochureMail(false)} onSent={()=>void load(true)}/>}
        {canViewResults && <BrochureDemoReport revision={reportRevision} brochureId={brochure.id} enabled={brochure.brand_config?.seller_demo_enabled === true} disabled={!canManage || Boolean(busy)} onToggle={(seller_demo_enabled) => updateBrochure('brand_config', { ...brochure.brand_config, seller_demo_enabled })} />}

        <section className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)_360px]">
          <aside className="space-y-5">
            <div id="brochure-settings" className={`${cardClass} p-4`}>
              <h2 className="mb-4 flex items-center gap-2 text-sm font-medium"><LayoutTemplate className="h-4 w-4 text-[#d3bb73]" /> Ustawienia</h2>
              <div className="space-y-3">
                <Field label="Nazwa robocza"><input value={brochure.name} disabled={!canManage || Boolean(busy)} onChange={(event) => updateBrochure('name', event.target.value)} className={inputClass} /></Field>
                <Field label="Tytuł okładki"><textarea rows={2} value={brochure.title} disabled={!canManage || Boolean(busy)} onChange={(event) => updateBrochure('title', event.target.value)} className={inputClass} /></Field>
                <Field label="Podtytuł"><textarea rows={2} value={brochure.subtitle || ''} disabled={!canManage || Boolean(busy)} onChange={(event) => updateBrochure('subtitle', event.target.value || null)} className={inputClass} /></Field>
                <Field label="Odbiorca"><select value={brochure.audience_type} disabled={!canManage || Boolean(busy)} onChange={(event) => updateBrochure('audience_type', event.target.value)} className={inputClass}><option value="hotel">Hotel</option><option value="venue">Sala / obiekt</option><option value="agency">Agencja</option><option value="corporate">Klient biznesowy</option><option value="wedding">Branża weselna</option><option value="general">Ogólna</option></select></Field>
                <Field label="Personalizacja dla organizacji"><select value={brochure.organization_id || ''} disabled={!canManage || Boolean(busy)} onChange={(event) => updateBrochure('organization_id', event.target.value || null)} className={inputClass}><option value="">Broszura ogólna</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></Field>
                <Field label="Marka / działalność"><select value={brochure.my_company_id} disabled={!canManage || Boolean(busy)} onChange={(event) => updateBrochure('my_company_id', event.target.value)} className={inputClass}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></Field>
                <Field label="Opiekun"><select value={brochure.contact_employee_id || ''} disabled={!canManage || Boolean(busy)} onChange={(event) => updateBrochure('contact_employee_id', event.target.value || null)} className={inputClass}><option value="">Bez wskazanego opiekuna</option>{employees.map((person) => <option key={person.id} value={person.id}>{[person.name, person.surname].filter(Boolean).join(' ') || person.email}</option>)}</select></Field>
                <div className="grid grid-cols-2 gap-3"><Field label="Kolor przewodni"><input type="color" value={composer.brandColor || previewCompany.secondaryColor} disabled={!canManage || Boolean(busy)} onChange={(e) => updateComposer({ brandColor: e.target.value })} className="h-10 w-full rounded bg-transparent" /></Field><Field label="Kolor akcentów"><input type="color" value={composer.accentColor || previewCompany.primaryColor} disabled={!canManage || Boolean(busy)} onChange={(e) => updateComposer({ accentColor: e.target.value })} className="h-10 w-full rounded bg-transparent" /></Field></div>
                <button type="button" disabled={!canManage || Boolean(busy)} className="text-xs text-[#d3bb73]" onClick={() => updateComposer({ brandColor: '#650026', accentColor: '#d3bb73' })}>Burgund i złoto Mavinci</button>
                <Field label="Wprowadzenie"><textarea rows={5} value={brochure.introduction || ''} disabled={!canManage || Boolean(busy)} onChange={(event) => updateBrochure('introduction', event.target.value || null)} className={inputClass} /></Field>
                <Field label="Zakończenie / CTA"><textarea rows={4} value={brochure.closing_text || ''} disabled={!canManage || Boolean(busy)} onChange={(event) => updateBrochure('closing_text', event.target.value || null)} className={inputClass} /></Field>
              </div>
            </div>

            <div id="brochure-cover-image" className={`${cardClass} space-y-4 p-4`}>
              <h2 className="text-sm font-medium">Zdjęcie okładki</h2>
              <BrochureImagePicker emptyLabel="Automatycznie z pierwszej usługi" brochureId={brochure.id} path={composer.coverImagePath || brochure.cover_image_path || ''} bucket={composer.coverImagePath ? composer.coverImageBucket : 'offer-product-pages'} assets={decorationAssets} imageUrls={imageUrls} disabled={!canManage || Boolean(busy)} inputClass={inputClass} onBusy={onUploadBusy} onSave={() => void save()} hasChanges={dirty} onChange={(coverImagePath, coverImageBucket) => { setDirty(true); setBrochure((current) => current ? { ...current, cover_image_path: null, brand_config: { ...current.brand_config, composer: { ...composer, coverImagePath, coverImageBucket } }, modified_after_generation: Boolean(current.current_pdf_path) } : current); }} />
              {assetNotice && <p className="text-xs leading-5 text-white/40">{assetNotice}</p>}
              {(['coverX', 'coverY', 'coverOverlay'] as const).map((key) => <label key={key} className="block text-xs text-white/50">{{ coverX: 'Kadr — lewo / prawo', coverY: 'Kadr — góra / dół', coverOverlay: 'Przyciemnienie' }[key]}<input type="range" min={0} max={key === 'coverOverlay' ? 95 : 100} value={composer[key]} disabled={!canManage || Boolean(busy)} className="mt-2 block w-full accent-[#d3bb73]" onChange={(e) => updateComposer({ [key]: Number(e.target.value) })} /></label>)}
            </div>
            <div className={`${cardClass} overflow-hidden`}>
              <div className="border-b border-[#d3bb73]/10 p-4"><h2 className="text-sm font-medium">Katalog usług</h2><div className="mt-3 flex items-center gap-2 rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3"><Search className="h-4 w-4 text-[#d3bb73]" /><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Szukaj usługi…" className={`${styles.search} w-full bg-transparent py-2.5 text-sm outline-none`} /></div></div>
              <div className="max-h-[520px] space-y-2 overflow-y-auto p-2">
                {catalogProducts.map((product) => {
                  const imageUrl = product.offer_image_path ? `/bridge/products/thumbnail?id=${encodeURIComponent(product.id)}&w=128&v=${encodeURIComponent(product.offer_image_path)}` : '';
                  const baseAdded = items.some((item) => item.product_id === product.id && !item.product_variant_id);
                  return <div key={product.id} className="rounded-lg border border-[#d3bb73]/8 bg-[#0f1119] p-3"><div className="flex gap-3">{imageUrl ? <img src={imageUrl} alt="" loading="lazy" decoding="async" className="h-12 w-16 rounded object-cover" /> : <div className="flex h-12 w-16 items-center justify-center rounded bg-[#1c1f33]"><ImageIcon className="h-4 w-4 text-[#e5e4e2]/25" /></div>}<div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{product.name}</div><div className="mt-0.5 text-[11px] text-[#e5e4e2]/35">{product.category?.name || 'Bez kategorii'}</div></div><button type="button" disabled={!canManage || baseAdded || Boolean(busy)} onClick={() => void addProduct(product, null)} className="self-start rounded-md border border-[#d3bb73]/20 p-1.5 text-[#d3bb73] disabled:opacity-25" title="Dodaj produkt bazowy"><Plus className="h-4 w-4" /></button></div>{product.variants.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{product.variants.map((variant) => { const added = items.some((item) => item.product_variant_id === variant.id); return <button key={variant.id} type="button" disabled={!canManage || added || Boolean(busy)} onClick={() => void addProduct(product, variant)} className="rounded-full border border-[#d3bb73]/15 px-2.5 py-1 text-[11px] text-[#e5e4e2]/55 disabled:opacity-25">{added ? '✓ ' : '+ '}{variant.name}</button>; })}</div>}</div>;
                })}
              </div>
            </div>
          </aside>

          <section className="space-y-5">
            <BrochurePageList pages={pageRows} selectedKey={selectedPageKey} disabled={!canManage || Boolean(busy)} onSelect={selectPage} onOrder={(pageOrder) => updateComposer({ pageOrder })} onToggle={togglePage} />
            <BrochureDecorativePagesEditor
              brochureId={brochure.id} pages={decorationPages} selectedId={selectedPageKey.startsWith('decorative:') ? selectedPageKey.slice(11) : null}
              assets={decorationAssets} imageUrls={imageUrls} company={{ ...previewCompany, primaryColor: composer.accentColor || previewCompany.primaryColor, secondaryColor: composer.brandColor || previewCompany.secondaryColor }}
              organizationName={organizations.find((o) => o.id === brochure.organization_id)?.name || ''}
              disabled={!canManage || Boolean(busy)} inputClass={inputClass}
              onChange={updateDecorations} onSelect={(id) => selectPage(`decorative:${id}`)} onUploadBusy={onUploadBusy}
              onSave={() => void save()} hasChanges={dirty}
            />
            {selectedItem && selectedPageKey.startsWith('product:') && <section id="brochure-product-image" className={`${cardClass} space-y-4 p-4`}>
              <h2 className="text-sm font-medium">Zdjęcie usługi — {itemTitle(selectedItem)}</h2>
              <p className="text-xs leading-5 text-white/55">Zmiana dotyczy tylko tej broszury. Nie zmienia zdjęcia w katalogu usług. Puste pole przywraca zdjęcie katalogowe.</p>
              <BrochureImagePicker key={selectedItem.id} brochureId={brochure.id}
                path={selectedItem.custom_image_path || selectedItem.variant?.offer_image_path || selectedItem.product.offer_image_path || ''}
                bucket="offer-product-pages" assets={decorationAssets.filter((asset) => asset.bucket === 'offer-product-pages')}
                imageUrls={imageUrls} emptyLabel="Przywróć zdjęcie katalogowe" disabled={!canManage || Boolean(busy)}
                inputClass={inputClass} onBusy={onUploadBusy} onSave={() => void save()} hasChanges={dirty}
                onChange={(path) => updateItem('custom_image_path', path || null)} />
            </section>}
            <div id="brochure-product-fields">
            {selectedItem && selectedPageKey.startsWith('product:') && <div className={`${cardClass} p-4 md:p-5`}><div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-light">Treść strony</h2><p className="mt-1 text-xs text-[#e5e4e2]/40">Puste pola tekstowe pobierają aktualną treść katalogową. Pusta lista korzyści ukrywa korzyści. Przywrócenie katalogu włącza dziedziczenie.</p></div><button type="button" disabled={!canManage || Boolean(busy)} onClick={() => { setDirty(true); setItems((current) => current.map((item) => item.id === selectedItem.id ? { ...item, custom_title: null, custom_short_description: null, custom_description: null, custom_benefits: null, custom_image_path: null } : item)); setBrochure((current) => current ? { ...current, modified_after_generation: Boolean(current.current_pdf_path) } : current); }} className="text-xs text-[#d3bb73]">Przywróć katalog</button><button type="button" disabled={!canManage || Boolean(busy)} onClick={() => void removeItem(selectedItem.id)} className="text-xs text-red-300/70">Usuń usługę</button></div><div className="space-y-4"><Field label="Układ strony"><select value={selectedItem.page_layout} disabled={!canManage || Boolean(busy)} onChange={(event) => updateItem('page_layout', event.target.value as BrochureItem['page_layout'])} className={inputClass}><option value="visual">Wizualny — duże zdjęcie</option><option value="classic">Klasyczny</option><option value="compact">Kompaktowy</option></select></Field><Field label="Tytuł"><input value={selectedItem.custom_title ?? itemTitle(selectedItem)} disabled={!canManage || Boolean(busy)} onChange={(event) => updateItem('custom_title', event.target.value)} className={inputClass} /></Field><Field label="Lead"><textarea rows={3} value={selectedItem.custom_short_description ?? itemShort(selectedItem)} disabled={!canManage || Boolean(busy)} onChange={(event) => updateItem('custom_short_description', event.target.value)} className={inputClass} /></Field><Field label="Opis"><textarea rows={8} value={selectedItem.custom_description ?? itemDescription(selectedItem)} disabled={!canManage || Boolean(busy)} onChange={(event) => updateItem('custom_description', event.target.value)} className={inputClass} /></Field><Field label="Korzyści — jedna w wierszu"><textarea rows={6} value={(selectedItem.custom_benefits ?? itemBenefits(selectedItem)).join('\n')} disabled={!canManage || Boolean(busy)} onChange={(event) => updateItem('custom_benefits', event.target.value.split('\n'))} className={inputClass} /></Field></div></div>}
            </div>
          </section>

          <aside className="xl:sticky xl:top-5 xl:self-start">
            <BrochureQuickPreview
              brochure={brochure}
              company={previewCompany}
              contact={employees.find((person) => person.id === (brochure.contact_employee_id || employee?.id)) || null}
              items={items}
              imageUrls={imageUrls}
              organizationName={organizations.find((item) => item.id === brochure.organization_id)?.name || null}
            />
          </aside>
        </section>
      </div>
      {managementDialog}
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs text-[#e5e4e2]/45">{label}</span>{children}</label>;
}

function BrochureQuickPreview({ brochure, company, contact, items, imageUrls, organizationName }: {
  brochure: Brochure;
  company: SalesBrochureSnapshot['company'];
  contact: Employee | null;
  items: BrochureItem[];
  imageUrls: Record<string, string>;
  organizationName: string | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(310);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const visibleItems = items.filter((item) => item.is_visible);
  const decorations = parseDecorativePages(brochure.brand_config?.decorative_pages);
  const composer = parseComposer(brochure.brand_config?.composer);
  const totalPages = visibleItems.length + decorations.filter((page) => page.isVisible).length + 3 - composer.hiddenPages.length;
  const snapshot: SalesBrochureSnapshot = {
    brochure: { id: brochure.id, name: brochure.name, title: brochure.title, subtitle: brochure.subtitle, introduction: brochure.introduction, closingText: brochure.closing_text, audienceType: brochure.audience_type },
    company,
    organization: organizationName ? { name: organizationName } : null,
    contact: contact ? { name: [contact.name, contact.surname].filter(Boolean).join(' ') || '', email: contact.email, phone: contact.phone_number } : null,
    coverImageUrl: composer.coverImagePath ? imageUrls[brochureAssetKey(composer.coverImageBucket, composer.coverImagePath)] : brochure.cover_image_path ? imageUrls[brochure.cover_image_path] : null,
    composer,
    items: visibleItems.map((item) => {
      const path = item.custom_image_path || item.variant?.offer_image_path || item.product.offer_image_path || '';
      return { id: item.id, title: itemTitle(item), shortDescription: itemShort(item), description: itemDescription(item), benefits: itemBenefits(item), category: item.product.category?.name, layout: item.page_layout, imageUrl: imageUrls[brochureAssetKey('offer-product-pages', path)] || imageUrls[path] };
    }),
    decorativePages: decorations.map((page) => ({ ...page, imageUrl: imageUrls[brochureAssetKey(page.imageBucket, page.imagePath)] })),
    generatedAt: '',
  };
  const html = buildSalesBrochureHtml(snapshot).replace('</style>', '.page{margin-bottom:16px}html,body{background:transparent}</style>');
  const documentWidth = 794;
  const documentHeight = totalPages * 1140;
  const scale = width / documentWidth;
  return <div className={`${cardClass} overflow-hidden`}>
    <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-4 py-3 text-sm"><span className="flex items-center gap-2"><Eye className="h-4 w-4 text-[#d3bb73]" />Podgląd broszury</span><span className="text-xs text-[#e5e4e2]/40">{totalPages} stron</span></div>
    <div className="max-h-[calc(100vh-180px)] overflow-y-auto bg-[#0f1119] p-3"><div ref={container}><div style={{ height: documentHeight * scale, position: 'relative' }}><iframe title="Podgląd wszystkich stron broszury" sandbox="" srcDoc={html} width={documentWidth} height={documentHeight} style={{ border: 0, position: 'absolute', top: 0, left: 0, transform: `scale(${scale})`, transformOrigin: 'top left', background: 'transparent' }} /></div></div></div>
    <div className="p-4 text-xs leading-5 text-[#e5e4e2]/45"><div className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-[#d3bb73]" />{organizationName || 'Wersja ogólna'}</div><p className="mt-2">Podgląd korzysta z tego samego układu i brandbooka co PDF.</p></div>
  </div>;
}
