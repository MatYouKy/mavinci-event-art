'use client';

import { useEffect, useMemo, useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import type { IProductVariant } from '@/app/(crm)/crm/offers/types';

type PreviewProduct = {
  category_id?: string | null;
  name: string;
  description?: string | null;
  unit?: string | null;
  price_net?: number | null;
  base_price?: number | null;
  service_duration_hours?: number | null;
  extension_price_net_per_hour?: number | null;
  offer_short_description?: string | null;
  offer_description?: string | null;
  offer_benefits?: string[] | null;
  offer_requirements?: string[] | null;
  tags?: string[] | null;
  offer_page_variant?: string | null;
  product_page_url?: string | null;
  offer_image_position_x?: number | null;
  offer_image_position_y?: number | null;
  offer_image_zoom?: number | null;
  offer_product_variants?: IProductVariant[];
};

type EventCategory = {
  id: string;
  name: string;
  default_offer_template_category_id?: string | null;
};

type PreviewField = {
  field_name: string;
  x: number;
  y: number;
  type?: 'text' | 'image';
  font_size?: number;
  font_color?: string;
  max_width?: number;
  align?: 'left' | 'center' | 'right';
  width?: number;
  height?: number;
  is_circular?: boolean;
  line_height?: number;
  font_role?: 'heading' | 'body';
  image_fit?: 'cover' | 'contain';
};

type Props = {
  product: PreviewProduct;
  imageUrl: string | null;
  variantImageUrls?: Record<string, string>;
};

const normalizeOfferImageScale = (value: unknown) => {
  const scale = Number(value ?? 1);
  if (!Number.isFinite(scale)) return 1;
  return Math.min(3, Math.max(0.5, scale));
};

const defaultFallbackFields: PreviewField[] = [
  { field_name: 'product_name', x: 45, y: 55, font_size: 24, font_color: '#7f1734', max_width: 505 },
  { field_name: 'product_short_description', x: 45, y: 108, font_size: 11, font_color: '#575c66', max_width: 505 },
  { field_name: 'scope_title', x: 45, y: 175, font_size: 12, font_color: '#7f1734' },
  { field_name: 'product_description', x: 45, y: 210, font_size: 10.5, line_height: 15, font_color: '#0c1a30', max_width: 245 },
  { field_name: 'product_image', x: 325, y: 180, type: 'image', width: 225, height: 190 },
  { field_name: 'reason_title', x: 45, y: 455, font_size: 12, font_color: '#7f1734' },
  { field_name: 'product_benefits_narrative', x: 45, y: 490, font_size: 9.5, line_height: 14, font_color: '#0c1a30', max_width: 245 },
];

const compactFallbackFields: PreviewField[] = [
  { field_name: 'compact_page_title', x: 45, y: 55, font_size: 23, font_color: '#7f1734', max_width: 505 },
  { field_name: 'product_1_name', x: 65, y: 153, font_size: 16, font_color: '#7f1734', max_width: 315 },
  { field_name: 'product_1_short_description', x: 65, y: 189, font_size: 9.5, font_color: '#575c66', max_width: 315 },
  { field_name: 'product_1_description', x: 65, y: 218, font_size: 9.3, line_height: 13, font_color: '#0c1a30', max_width: 315 },
  { field_name: 'product_1_requirements', x: 65, y: 276, font_size: 7.5, line_height: 10, font_color: '#7f1734', max_width: 315 },
  { field_name: 'product_1_image', x: 405, y: 155, type: 'image', width: 145, height: 135 },
];

const visualFallbackFields: PreviewField[] = [
  { field_name: 'product_name', x: 45, y: 45, font_size: 24, font_color: '#5b001f', max_width: 505, font_role: 'heading' },
  { field_name: 'product_short_description', x: 45, y: 93, font_size: 9.5, font_color: '#756f6b', max_width: 505 },
  { field_name: 'visual_scope_title', x: 45, y: 132, font_size: 11.5, font_color: '#5b001f', max_width: 505, font_role: 'heading' },
  { field_name: 'product_description', x: 45, y: 158, font_size: 9.5, line_height: 14, font_color: '#171717', max_width: 505 },
  { field_name: 'product_image', x: 82, y: 235, type: 'image', width: 431, height: 285 },
  { field_name: 'scope_title', x: 67, y: 620, font_size: 8.5, font_color: '#5b001f' },
  { field_name: 'product_benefits', x: 67, y: 650, font_size: 9, line_height: 14, font_color: '#171717', max_width: 250 },
];

const DEFAULT_PREVIEW_DESIGN = {
  primary_color: '#5b001f',
  secondary_color: '#1c1f33',
  accent_color: '#d3bb73',
  surface_color: '#faf7f2',
  visual_image_height: 285,
};

const fallbackFieldsByVariant: Record<string, PreviewField[]> = {
  default: defaultFallbackFields,
  compact: compactFallbackFields,
  visual: visualFallbackFields,
};

const formatMoney = (value: number) =>
  `${Number(value || 0).toLocaleString('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} PLN`;

const formatDuration = (value: number) => Number(value).toLocaleString('pl-PL', {
  minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 1,
  maximumFractionDigits: 2,
});

const getServiceTerms = (
  durationHours?: number | null,
  extensionPriceNetPerHour?: number | null,
) => {
  const terms: string[] = [];
  const duration = Number(durationHours || 0);
  const extensionPrice = Number(extensionPriceNetPerHour || 0);
  if (duration > 0) terms.push(`CZAS USŁUGI: ${formatDuration(duration)} H`);
  if (extensionPrice > 0) {
    terms.push(`DODATKOWA GODZINA: ${formatMoney(extensionPrice)} NETTO`);
  }
  return terms.join('  •  ');
};

const truncateAtWord = (value: string, limit: number) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  const shortened = normalized.slice(0, limit);
  const lastSpace = shortened.lastIndexOf(' ');
  return `${shortened.slice(0, lastSpace > 0 ? lastSpace : limit)}…`;
};

export function ProductOfferCardPreview({ product, imageUrl, variantImageUrls = {} }: Props) {
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [defaultTemplateCategoryId, setDefaultTemplateCategoryId] = useState<string | null>(null);
  const [template, setTemplate] = useState<any>(null);
  const [templatePdfUrl, setTemplatePdfUrl] = useState<string | null>(null);
  const [categoryDesign, setCategoryDesign] = useState(DEFAULT_PREVIEW_DESIGN);
  const [headingFontUrl, setHeadingFontUrl] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCategories = async () => {
      const [eventCategoriesResult, defaultCategoryResult] = await Promise.all([
        supabase
          .from('event_categories')
          .select('id, name, default_offer_template_category_id')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('offer_template_categories')
          .select('id')
          .eq('is_default', true)
          .limit(1)
          .maybeSingle(),
      ]);

      const loadedCategories = (eventCategoriesResult.data || []) as EventCategory[];
      setCategories(loadedCategories);
      setDefaultTemplateCategoryId(defaultCategoryResult.data?.id || null);
      setSelectedCategoryId((current) => {
        if (current) return current;
        if (product.category_id && loadedCategories.some((item) => item.id === product.category_id)) {
          return product.category_id;
        }
        return loadedCategories[0]?.id || '';
      });
    };

    loadCategories();
  }, [product.category_id]);

  useEffect(() => {
    const loadHeadingFont = async () => {
      const { data: company } = await supabase
        .from('my_companies')
        .select('id')
        .eq('is_active', true)
        .eq('is_default', true)
        .limit(1)
        .maybeSingle();
      if (!company) return;
      const { data: font } = await supabase
        .from('company_brandbook_fonts')
        .select('file_url, storage_path')
        .eq('company_id', company.id)
        .eq('role', 'heading')
        .order('order_index')
        .limit(1)
        .maybeSingle();
      if (font?.file_url) setHeadingFontUrl(font.file_url);
      else if (font?.storage_path) {
        setHeadingFontUrl(supabase.storage.from('company-logos').getPublicUrl(font.storage_path).data.publicUrl);
      }
    };
    loadHeadingFont();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadTemplate = async () => {
      setLoading(true);
      setTemplate(null);
      setTemplatePdfUrl(null);

      const eventCategory = categories.find((item) => item.id === selectedCategoryId);
      const templateCategoryId =
        eventCategory?.default_offer_template_category_id || defaultTemplateCategoryId;

      if (!templateCategoryId) {
        setLoading(false);
        return;
      }

      const { data: categorySettings } = await supabase
        .from('offer_template_categories')
        .select('design_config')
        .eq('id', templateCategoryId)
        .maybeSingle();
      if (!cancelled) {
        setCategoryDesign({
          ...DEFAULT_PREVIEW_DESIGN,
          ...((categorySettings?.design_config || {}) as Partial<typeof DEFAULT_PREVIEW_DESIGN>),
        });
      }

      const findTemplate = async (
        categoryId: string,
        variant: string,
        includeVariant = true,
      ) => {
        let query = supabase
          .from('offer_page_templates')
          .select(
            includeVariant
              ? 'id, pdf_url, pdf_width, pdf_height, text_fields_config, template_category_id, variant_key'
              : 'id, pdf_url, pdf_width, pdf_height, text_fields_config, template_category_id',
          )
          .eq('template_category_id', categoryId)
          .eq('type', 'product')
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .order('updated_at', { ascending: false })
          .limit(1);

        if (includeVariant) query = query.eq('variant_key', variant);
        return query.maybeSingle();
      };

      const requestedVariant = product.offer_page_variant || 'default';
      const findForCategory = async (categoryId: string) => {
        let result = await findTemplate(categoryId, requestedVariant);
        // Pozwala pokazac podglad rowniez przed wdrozeniem kolumny variant_key.
        if (result.error && requestedVariant === 'default') {
          result = await findTemplate(categoryId, 'default', false);
        }
        return result;
      };

      let result = await findForCategory(templateCategoryId);
      if (
        !result.data &&
        defaultTemplateCategoryId &&
        defaultTemplateCategoryId !== templateCategoryId
      ) {
        result = await findForCategory(defaultTemplateCategoryId);
      }

      if (cancelled) return;
      setTemplate(result.data || null);

      if (result.data?.pdf_url) {
        const { data } = await supabase.storage
          .from('offer-template-pages')
          .createSignedUrl(result.data.pdf_url, 3600);
        if (!cancelled) setTemplatePdfUrl(data?.signedUrl || null);
      }

      if (!cancelled) setLoading(false);
    };

    loadTemplate();
    return () => {
      cancelled = true;
    };
  }, [categories, defaultTemplateCategoryId, product.offer_page_variant, selectedCategoryId]);

  const previewData = useMemo<Record<string, string>>(() => {
    const price = Number(product.price_net ?? product.base_price ?? 0);
    const benefits = product.offer_benefits || [];
    const benefitsNarrative = benefits.length
      ? `Ten zakres łączy ${benefits
          .map((item) => item.trim().replace(/[.!?]+$/, '').toLocaleLowerCase('pl-PL'))
          .join(', ')}. Dzięki temu rozwiązanie pozostaje spójne, czytelne dla uczestników i dopasowane do przebiegu wydarzenia.`
      : 'Zakres dobieramy do miejsca, liczby uczestników i ustalonego przebiegu wydarzenia.';
    return {
      product_name: (product.name || 'Nazwa produktu').toLocaleUpperCase('pl-PL'),
      product_short_description: product.offer_short_description || '',
      product_description: product.offer_page_variant === 'visual'
        ? truncateAtWord(product.offer_description || product.description || '', 235)
        : product.offer_description || product.description || '',
      product_benefits: benefits.map((item) => `— ${item}`).join('\n'),
      product_requirements: '',
      product_benefits_narrative: benefitsNarrative,
      scope_title: product.offer_page_variant === 'visual' ? 'W ZAKRESIE' : 'CO ZAPEWNIAMY',
      visual_scope_title: 'ZAKRES REALIZACJI',
      reason_title: 'DLACZEGO TEN ZAKRES?',
      requirements_title: '',
      compact_page_title: 'ZAKRES OFERTY',
      product_1_name: (product.name || 'Nazwa produktu').toLocaleUpperCase('pl-PL'),
      product_1_short_description: product.offer_short_description || '',
      product_1_description: product.offer_description || product.description || '',
      product_1_requirements: '',
      product_1_image: imageUrl || '',
      product_image: imageUrl || '',
      product_quantity: '1',
      product_unit: product.unit || 'szt',
      product_unit_price: formatMoney(price),
      product_total: formatMoney(price),
    };
  }, [imageUrl, product]);

  const pdfWidth = Number(template?.pdf_width || 595);
  const pdfHeight = Number(template?.pdf_height || 842);
  const previewScale = Math.min(0.62, 360 / pdfWidth);
  const requestedVariant = product.offer_page_variant || 'default';
  const fallbackVariant = fallbackFieldsByVariant[requestedVariant] ? requestedVariant : 'default';
  const supportsRequestedLayout = requestedVariant !== 'compact'
    || template?.text_fields_config?.some((field: PreviewField) => field.field_name.startsWith('product_1_'));
  const fallbackFields = fallbackFieldsByVariant[fallbackVariant].map((field) => {
    if (fallbackVariant !== 'visual') return field;
    if (field.field_name === 'product_image') return { ...field, height: categoryDesign.visual_image_height };
    return {
      ...field,
      font_color: field.font_color === '#5b001f' ? categoryDesign.primary_color : field.font_color,
    };
  });
  const fields: PreviewField[] = templatePdfUrl && supportsRequestedLayout && Array.isArray(template?.text_fields_config) && template.text_fields_config.length > 0
    ? template.text_fields_config
    : fallbackFields;
  const selectedCategory = categories.find((item) => item.id === selectedCategoryId);
  const productVariants = [...(product.offer_product_variants || [])]
    .filter((variant) => variant.is_active !== false)
    .sort((a, b) => a.display_order - b.display_order)
    .slice(0, 3);

  return (
    <div className="rounded-xl border border-[#7f1734]/35 bg-[#1c1f33] p-6 lg:col-span-2">
      {headingFontUrl && <style>{`@font-face{font-family:'OfferBrandHeading';src:url('${headingFontUrl}') format('truetype');font-weight:400;font-style:normal;font-display:swap;}`}</style>}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-[#b94b69]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Podgląd karty produktu</h2>
          </div>
          <p className="mt-1 text-sm text-[#e5e4e2]/50">
            Dane aktualizują się na żywo. Cena i ilość są przykładowe; w ofercie poda je CRM.
          </p>
        </div>
        <div className="min-w-[240px]">
          <label className="mb-1 block text-xs text-[#e5e4e2]/50">Kategoria wydarzenia</label>
          <select
            value={selectedCategoryId}
            onChange={(event) => setSelectedCategoryId(event.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2]"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border border-[#e5e4e2]/10 bg-[#0a0d1a] p-4">
        {loading ? (
          <div className="flex min-h-[360px] items-center justify-center text-[#e5e4e2]/50">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Ładowanie podglądu...
          </div>
        ) : (
          <div className="mx-auto" style={{ width: pdfWidth * previewScale, height: pdfHeight * previewScale }}>
            <div
              className="relative origin-top-left overflow-hidden bg-white shadow-2xl"
              style={{ width: pdfWidth, height: pdfHeight, transform: `scale(${previewScale})` }}
            >
              {templatePdfUrl && supportsRequestedLayout ? (
                <embed
                  src={`${templatePdfUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                  type="application/pdf"
                  className="absolute inset-0 h-full w-full"
                />
              ) : (
                <>
                  <div className="absolute inset-0" style={{ backgroundColor: categoryDesign.surface_color }} />
                  {fallbackVariant === 'default' && (
                    <div className="absolute left-[45px] top-[141px] h-[2px] w-[505px] bg-[#7f1734]" />
                  )}
                  {fallbackVariant === 'default' && (
                    <>
                      <div className="absolute left-[325px] top-[180px] h-[190px] w-[225px] rounded-[9px] bg-white" />
                      <div className="absolute left-[45px] top-[429px] h-px w-[505px] bg-[#d2c7bd]" />
                    </>
                  )}
                  {fallbackVariant === 'compact' && (
                    <>
                      <div className="absolute left-[45px] top-[111px] h-[2px] w-[505px] bg-[#7f1734]" />
                      <div className="absolute left-[45px] top-[145px] h-[150px] w-1 bg-[#7f1734]" />
                      <div className="absolute left-[405px] top-[155px] h-[135px] w-[145px] rounded-[9px] bg-white" />
                      <div className="absolute left-[45px] top-[332px] h-px w-[505px] bg-[#d2c7bd]" />
                    </>
                  )}
                  {fallbackVariant === 'visual' && (
                    <>
                      <div
                        className="absolute left-[45px] top-[119px] h-px w-[505px]"
                        style={{ backgroundColor: categoryDesign.primary_color }}
                      />
                      <div className="absolute left-[82px] top-[235px] w-[431px] rounded-t-[9px] bg-white" style={{ height: categoryDesign.visual_image_height }} />
                      <div className="absolute left-[45px] top-[597px] h-[165px] w-[505px] rounded-[9px] bg-white" />
                    </>
                  )}
                </>
              )}

              <div className="pointer-events-none absolute inset-0">
                {fields.map((field, index) => {
                  const value = previewData[field.field_name] || '';
                  if (!value) return null;
                  if (field.type === 'image') {
                    const isProductImage = field.field_name === 'product_image';
                    const positionX = isProductImage ? Number(product.offer_image_position_x ?? 50) : 50;
                    const positionY = isProductImage ? Number(product.offer_image_position_y ?? 25) : 50;
                    const zoom = isProductImage ? normalizeOfferImageScale(product.offer_image_zoom) : 1;
                    const isZoomedOutProductImage = isProductImage && zoom < 1;
                    return (
                      <div
                        key={`${field.field_name}-${index}`}
                        className={field.is_circular ? 'absolute overflow-hidden rounded-full' : 'absolute overflow-hidden rounded-[9px]'}
                        style={{
                          left: field.x,
                          top: field.y,
                          width: field.width || 100,
                          height: field.height || 100,
                        }}
                      >
                        {isZoomedOutProductImage && (
                          <div
                            className="absolute inset-0 scale-110 bg-cover bg-no-repeat opacity-55 blur-[7px]"
                            style={{
                              backgroundImage: `url(${value})`,
                              backgroundPosition: `${positionX}% ${positionY}%`,
                            }}
                          />
                        )}
                        <div
                          className="absolute inset-0 z-10 bg-no-repeat transition-transform duration-150"
                          style={{
                            backgroundImage: `url(${value})`,
                            backgroundPosition: `${positionX}% ${positionY}%`,
                            backgroundSize: isZoomedOutProductImage || field.image_fit === 'contain' ? 'contain' : 'cover',
                            transform: `scale(${zoom})`,
                          }}
                        />
                      </div>
                    );
                  }

                  return (
                    <div
                      key={`${field.field_name}-${index}`}
                      className="absolute overflow-hidden whitespace-pre-wrap"
                      style={{
                        left: field.x,
                        top: field.y,
                        width: field.max_width || 'auto',
                        color: field.font_color || '#000000',
                        fontSize: field.font_size || 12,
                        lineHeight: field.line_height ? `${field.line_height}px` : 1.2,
                        textAlign: field.align || 'left',
                        fontWeight:
                          field.font_role === 'heading'
                            ? 400
                            : field.field_name.includes('name') || field.field_name.includes('title')
                            ? 600
                            : 400,
                        fontFamily: field.font_role === 'heading' ? "'OfferBrandHeading', sans-serif" : undefined,
                      }}
                    >
                      {value}
                    </div>
                  );
                })}
                {!templatePdfUrl && fallbackVariant === 'visual' && imageUrl && (
                  <div
                    className="absolute left-[45px] flex h-[92px] w-[505px] flex-col items-start justify-center gap-[12px] px-[22px] text-[13px] uppercase text-white"
                    style={{
                      top: categoryDesign.visual_image_height + 175,
                      backgroundColor: `${categoryDesign.primary_color}d1`,
                      fontFamily: "'OfferBrandHeading', sans-serif",
                    }}
                  >
                    <div>{product.name}</div>
                    <div className="w-full truncate text-center font-sans text-[8px] font-medium text-white">
                      {(product.tags?.length
                        ? product.tags
                        : (product.offer_benefits || []).map((benefit) =>
                            benefit
                              .replace(/^(możliwość|bieżąca|zakres)\s+/i, '')
                              .split(/\s+/)
                              .slice(0, 3)
                              .join(' '),
                          ))
                        .filter(Boolean)
                        .slice(0, 5)
                        .join('  •  ')}
                    </div>
                  </div>
                )}
                {product.product_page_url && productVariants.length === 0 && (
                  <div
                    className="absolute left-[45px] top-[748px] text-[8.5px] font-medium uppercase tracking-wide"
                    style={{ color: categoryDesign.primary_color }}
                  >
                    Zobacz więcej o tej usłudze&nbsp; →
                  </div>
                )}
              </div>

              {productVariants.length > 0 && (
                <div
                  className="pointer-events-none absolute inset-0 z-20"
                  style={{ backgroundColor: categoryDesign.surface_color }}
                >
                  <div
                    className="absolute left-[45px] top-[42px] w-[505px] text-[24px] uppercase"
                    style={{
                      color: categoryDesign.primary_color,
                      fontFamily: "'OfferBrandHeading', sans-serif",
                    }}
                  >
                    {product.name}
                  </div>
                  <div className="absolute left-[45px] top-[82px] w-[505px] text-[9.5px] text-[#756f6b]">
                    {product.offer_short_description || 'Wybierz zakres najlepiej dopasowany do charakteru wydarzenia.'}
                  </div>
                  <div
                    className="absolute left-[45px] top-[112px] h-px w-[505px]"
                    style={{ backgroundColor: categoryDesign.primary_color }}
                  />
                  <div className="absolute left-[45px] top-[137px] w-[250px] text-[9px] leading-[14px] text-[#171717]">
                    {product.offer_description || product.description}
                  </div>
                  {getServiceTerms(
                    product.service_duration_hours,
                    product.extension_price_net_per_hour,
                  ) && (
                    <div
                      className="absolute left-[45px] top-[307px] w-[250px] text-[6.8px] font-medium uppercase"
                      style={{ color: categoryDesign.primary_color }}
                    >
                      {getServiceTerms(
                        product.service_duration_hours,
                        product.extension_price_net_per_hour,
                      )}
                    </div>
                  )}
                  <div
                    className="absolute left-[330px] top-[132px] h-[165px] w-[220px] overflow-hidden rounded-[8px] bg-black/10 bg-cover bg-center"
                    style={{ backgroundImage: imageUrl ? `url(${imageUrl})` : undefined }}
                  />
                  <div
                    className="absolute left-[45px] top-[330px] h-px w-[505px]"
                    style={{ backgroundColor: categoryDesign.primary_color }}
                  />
                  <div
                    className="absolute left-[45px] top-[350px] text-[12px] uppercase"
                    style={{ color: categoryDesign.primary_color, fontFamily: "'OfferBrandHeading', sans-serif" }}
                  >
                    Warianty
                  </div>
                  <div className="absolute left-[45px] top-[382px] flex w-[505px] flex-col gap-[12px]">
                    {productVariants.map((variant, index) => {
                      const highlighted = variant.is_recommended || (
                        !productVariants.some((item) => item.is_recommended) && index === 0
                      );
                      const serviceTerms = getServiceTerms(
                        variant.service_duration_hours ?? product.service_duration_hours,
                        variant.extension_price_net_per_hour ?? product.extension_price_net_per_hour,
                      );
                      return (
                        <div
                          key={variant.id}
                          className="relative h-[120px] w-full overflow-hidden rounded-[9px] bg-white"
                        >
                          <div
                            className="absolute left-[14px] top-[10px] h-[100px] w-[3px] rounded-full"
                            style={{ backgroundColor: highlighted ? categoryDesign.accent_color : categoryDesign.primary_color }}
                          />
                          <div
                            className="absolute left-[28px] top-[16px] w-[30px] text-[12px]"
                            style={{
                              color: categoryDesign.accent_color,
                              fontFamily: "'OfferBrandHeading', sans-serif",
                            }}
                          >
                            {String(index + 1).padStart(2, '0')}
                          </div>
                          <div
                            className="absolute left-[72px] top-[14px] w-[285px] text-[12px] uppercase"
                            style={{
                              color: categoryDesign.primary_color,
                              fontFamily: "'OfferBrandHeading', sans-serif",
                            }}
                          >
                            {variant.name}
                          </div>
                          <div className="absolute left-[72px] top-[38px] w-[285px] text-[7.8px] text-[#756f6b]">
                            {variant.short_description}
                          </div>
                          <div className="absolute left-[72px] top-[57px] line-clamp-4 w-[210px] text-[7.2px] leading-[9.5px] text-[#171717]">
                            {variant.description}
                          </div>
                          {serviceTerms && (
                            <div
                              className="absolute left-[72px] top-[103px] w-[205px] truncate text-[5.8px] font-medium uppercase"
                              style={{ color: categoryDesign.primary_color }}
                            >
                              {serviceTerms}
                            </div>
                          )}
                          <div
                            className="absolute left-[285px] top-[66px] w-[72px] text-right text-[9px]"
                            style={{ color: categoryDesign.primary_color, fontFamily: "'OfferBrandHeading', sans-serif" }}
                          >
                            {formatMoney(Number(variant.price_net || 0))}
                          </div>
                          <div className="absolute left-[285px] top-[82px] w-[72px] text-right text-[5.3px] text-[#756f6b]">NETTO</div>
                          <div
                            className="absolute right-[12px] top-[10px] h-[100px] w-[118px] overflow-hidden rounded-[6px] bg-black/10 bg-cover bg-center"
                            style={{ backgroundImage: `url(${variantImageUrls[variant.id] || imageUrl || ''})` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="absolute left-[45px] top-[782px] w-[360px] text-[7.5px] text-[#756f6b]">
                    W kreatorze oferty możesz zdecydować, czy ceny wariantów będą widoczne w PDF.
                  </div>
                  {product.product_page_url && (
                    <div
                      className="absolute right-[45px] top-[778px] text-[7.8px] font-medium uppercase"
                      style={{ color: categoryDesign.primary_color }}
                    >
                      Zobacz więcej&nbsp; →
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-[#e5e4e2]/40">
        Źródło szaty:{' '}
        {templatePdfUrl && supportsRequestedLayout
          ? template?.template_category_id === defaultTemplateCategoryId &&
            selectedCategory?.default_offer_template_category_id !== defaultTemplateCategoryId
            ? 'domyślny zestaw szablonów'
            : `szablon kategorii ${selectedCategory?.name || ''}`
          : 'układ burgundowo-granatowy (fallback)'}.
        {!templatePdfUrl && ` Wariant: ${fallbackVariant === 'visual' ? 'duża grafika' : fallbackVariant === 'compact' ? 'kompaktowy' : 'domyślny'}.`}
      </p>
    </div>
  );
}
