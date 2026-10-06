'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Building2, FilePlus2, FileText, Loader2, Plus, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { parseDecorativePages, parseComposer } from '@/lib/brochures/decorativePages';
import { createHotelBrochureTemplate, HOTEL_TEMPLATE_PRODUCT_IDS } from '@/lib/brochures/hotelTemplate';
import { useSnackbar } from '@/contexts/SnackbarContext';

type Brochure = {
  id: string;
  name: string;
  title: string;
  audience_type: string;
  status: 'draft' | 'ready' | 'archived';
  current_pdf_version: number;
  modified_after_generation: boolean;
  updated_at: string;
  organization?: { name: string } | null;
  brand_config?: Record<string, unknown>;
  items?: Array<{ id: string; is_visible: boolean }>;
};

const audienceLabels: Record<string, string> = {
  hotel: 'Hotele',
  venue: 'Sale i obiekty',
  agency: 'Agencje',
  corporate: 'Klienci biznesowi',
  wedding: 'Branża weselna',
  general: 'Ogólna',
};

export default function BrochuresPage() {
  const router = useRouter();
  const { employee, isAdmin, hasScope, loading: employeeLoading } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const [brochures, setBrochures] = useState<Brochure[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const canManage = isAdmin || hasScope('offers_manage');

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('sales_brochures')
      .select('id,name,title,audience_type,status,current_pdf_version,modified_after_generation,updated_at,brand_config,organization:organizations(name),items:sales_brochure_items(id,is_visible)')
      .neq('status', 'archived')
      .order('updated_at', { ascending: false });
    if (error) {
      showSnackbar(
        error.code === 'PGRST205'
          ? 'Najpierw uruchom migrację modułu broszur'
          : error.message || 'Nie udało się pobrać broszur',
        'error',
      );
      setBrochures([]);
    } else {
      setBrochures((data || []) as unknown as Brochure[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!employeeLoading) void load();
  }, [employeeLoading]);

  const createBrochure = async (hotelTemplate = false) => {
    if (!employee || !canManage || creating) return;
    setCreating(true);
    try {
      const { data: company, error: companyError } = await supabase
        .from('my_companies')
        .select('id')
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (companyError || !company) throw companyError || new Error('Brak aktywnej działalności');

      const productImages: Record<string, string> = {};
      if (hotelTemplate) {
        const { data: products, error: imageError } = await supabase.from('offer_products')
          .select('id,offer_image_path').in('id', Object.values(HOTEL_TEMPLATE_PRODUCT_IDS));
        if (imageError) throw new Error('Nie udało się pobrać aktualnych zdjęć usług do szablonu broszury. Spróbuj ponownie.');
        for (const product of products || []) {
          if (product.offer_image_path) productImages[product.id] = product.offer_image_path;
        }
      }

      const { data, error } = await supabase
        .from('sales_brochures')
        .insert({
          name: 'Nowa broszura dla hoteli',
          title: 'Technika i produkcja wydarzeń dla hoteli',
          subtitle: 'Rozwiązania, które wspierają sprzedaż i realizację eventów',
          audience_type: 'hotel',
          ...(hotelTemplate ? createHotelBrochureTemplate(productImages) : {}),
          my_company_id: company.id,
          contact_employee_id: employee.id,
          created_by: employee.id,
          updated_by: employee.id,
        })
        .select('id')
        .single();
      if (error) throw error;
      if (hotelTemplate && Object.values(HOTEL_TEMPLATE_PRODUCT_IDS).some((id) => !productImages[id])) {
        showSnackbar('Szablon utworzony. Część usług nie ma zdjęć — uzupełnij je w Studio stron przed generowaniem PDF.', 'warning');
      }
      router.push(`/crm/brochures/${data.id}`);
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się utworzyć broszury', 'error');
      setCreating(false);
    }
  };

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return brochures;
    return brochures.filter((brochure) =>
      `${brochure.name} ${brochure.title} ${brochure.organization?.name || ''}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [brochures, query]);

  return (
    <div className="min-h-screen bg-[#0f1119] px-5 py-6 text-[#e5e4e2] lg:px-8">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#d3bb73]">
              <BookOpen className="h-4 w-4" /> Materiały sprzedażowe
            </div>
            <h1 className="text-3xl font-light">Broszury</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#e5e4e2]/50">
              Zacznij od gotowego szablonu dla hoteli lub pustej broszury. W Studio stron zmienisz treść, zdjęcia i układ, a następnie zapiszesz PDF.
            </p>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void createBrochure(true)} disabled={creating} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-3 font-medium text-[#1c1f33] disabled:opacity-50"><Building2 className="h-4 w-4" />Szablon Hotele · 24 strony</button>
            <button
              type="button"
              onClick={() => void createBrochure()}
              disabled={creating}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-3 font-medium text-[#1c1f33] disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Pusta broszura
            </button>
            </div>
          )}
        </header>

        <div className="mb-5 flex items-center gap-3 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3">
          <Search className="h-4 w-4 text-[#d3bb73]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Szukaj po nazwie broszury lub hotelu…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-[#e5e4e2]/30"
          />
        </div>

        {loading ? (
          <div className="flex min-h-[320px] items-center justify-center text-[#e5e4e2]/45">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Ładowanie broszur…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#d3bb73]/20 bg-[#1c1f33] px-6 py-20 text-center">
            <FilePlus2 className="mx-auto mb-4 h-12 w-12 text-[#d3bb73]/50" />
            <h2 className="text-xl font-light">Brak broszur</h2>
            <p className="mt-2 text-sm text-[#e5e4e2]/45">Utwórz pierwszą prezentację usług dla hoteli.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((brochure) => {
              const pageCount = (brochure.items || []).filter((i) => i.is_visible).length + parseDecorativePages(brochure.brand_config?.decorative_pages).filter((p) => p.isVisible).length + 3 - parseComposer(brochure.brand_config?.composer).hiddenPages.length;
              const ready = brochure.current_pdf_version > 0 && !brochure.modified_after_generation;
              return (
                <button
                  key={brochure.id}
                  type="button"
                  onClick={() => router.push(`/crm/brochures/${brochure.id}`)}
                  className="group rounded-2xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 text-left transition hover:-translate-y-0.5 hover:border-[#d3bb73]/35"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="rounded-xl bg-[#d3bb73]/10 p-3 text-[#d3bb73]">
                      <FileText className="h-6 w-6" />
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs ${ready ? 'bg-green-500/10 text-green-300' : 'bg-orange-500/10 text-orange-300'}`}>
                      {ready ? `PDF v${brochure.current_pdf_version}` : brochure.current_pdf_version ? 'Wymaga aktualizacji' : 'Szkic'}
                    </span>
                  </div>
                  <h2 className="mt-5 text-lg font-medium transition group-hover:text-[#d3bb73]">{brochure.name}</h2>
                  <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-[#e5e4e2]/50">{brochure.title}</p>
                  <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#d3bb73]/10 pt-4 text-xs text-[#e5e4e2]/45">
                    <span>{audienceLabels[brochure.audience_type] || 'Inny odbiorca'}</span>
                    <span>{pageCount} stron</span>
                    {brochure.organization?.name && (
                      <span className="inline-flex items-center gap-1 text-[#d3bb73]">
                        <Building2 className="h-3.5 w-3.5" /> {brochure.organization.name}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
