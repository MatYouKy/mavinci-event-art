'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calculator,
  Plus,
  Trash2,
  FileDown,
  Printer,
  ArrowLeft,
  Package,
  Users,
  Truck,
  MoreHorizontal,
  Import,
  Save,
  Pencil,
  Check,
  FileText,
  Mail,
  Loader2,
  Copy,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { usePortalDropdown } from '@/hooks/usePortalDropdown';
import { PortalDropdownMenu } from '@/components/UI/PortalDropdownMenu/PortalDropdownMenu';
import SendCalculationEmailModal from '@/components/crm/SendCalculationEmailModal';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import {
  DEFAULT_VAT,
  fmt,
  round2,
  rowGross,
  rowNet,
} from '@/components/crm/events/helpers/calculations/calculations.helper';
import { buildCalculationHtml } from '@/components/crm/events/pdf/buildCalculationHtml';

export type Category = 'equipment' | 'staff' | 'transport' | 'other';

interface CalculationRow {
  id: string;
  event_id: string;
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items_count?: number;
  total?: number;
}

export interface CalcItem {
  id?: string;
  calculation_id?: string;
  category: Category;
  name: string;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  days: number;
  source: 'manual' | 'offer' | 'warehouse';
  source_ref?: string | null;
  position: number;
  vat_rate: number;
  editing?: boolean;
}

interface WarehouseEquipment {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  rental_price_per_day: number | null;
}

interface OfferItem {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  total: number;
}

interface Props {
  eventId: string;
}

const CATEGORY_META: Record<
  Category,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  equipment: { label: 'Sprzęt', icon: Package },
  staff: { label: 'Ludzie', icon: Users },
  transport: { label: 'Transport', icon: Truck },
  other: { label: 'Pozostałe', icon: MoreHorizontal },
};

// const rowTotal = rowNet;

export default function EventCalculationsTab({ eventId }: Props) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const [list, setList] = useState<CalculationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const fetchList = useCallback(
    async (showLoader = true) => {
      if (showLoader) setLoading(true);

      const { data, error } = await supabase
        .from('event_calculations')
        .select('*, event_calculation_items(quantity, unit_price, days)')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error(error);
        showSnackbar('Nie udało się pobrać kalkulacji', 'error');
        if (showLoader) setLoading(false);
        return;
      }

      const rows: CalculationRow[] = (data ?? []).map((r: any) => {
        const items = r.event_calculation_items ?? [];
        const total = items.reduce(
          (s: number, it: any) =>
            s + Number(it.quantity || 0) * Number(it.unit_price || 0) * Number(it.days || 1),
          0,
        );

        return {
          id: r.id,
          event_id: r.event_id,
          name: r.name,
          notes: r.notes,
          created_at: r.created_at,
          updated_at: r.updated_at,
          items_count: items.length,
          total: round2(total),
        };
      });

      setList(rows);
      if (showLoader) setLoading(false);
    },
    [eventId, showSnackbar],
  );

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const handleCreate = async () => {
    const { data, error } = await supabase
      .from('event_calculations')
      .insert({ event_id: eventId, name: 'Nowa kalkulacja' })
      .select()
      .single();
    if (error || !data) {
      showSnackbar('Nie udało się utworzyć kalkulacji', 'error');
      return;
    }
    await fetchList();
    setActiveId(data.id);
  };

  const handleDelete = async (id: string) => {
    showConfirm({
      title: 'Usunąć kalkulację?',
      message: 'Tej operacji nie można cofnąć.',
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    }).then(async (confirmed: boolean | void) => {
      if (confirmed) {
        await supabase.from('event_calculations').delete().eq('id', id);
        setList((prev) => prev.filter((item) => item.id !== id));
      } else {
        showSnackbar('Anulowano usuwanie kalkulacji', 'warning');
      }
    });
  };

  const handleDuplicate = async (id: string) => {
    try {
      setDuplicatingId(id);

      const { data: calc, error: calcError } = await supabase
        .from('event_calculations')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (calcError) throw calcError;

      if (!calc) {
        showSnackbar('Nie znaleziono kalkulacji do duplikowania', 'error');
        return;
      }

      const { data: calcItems, error: itemsError } = await supabase
        .from('event_calculation_items')
        .select('*')
        .eq('calculation_id', id)
        .order('position');

      if (itemsError) throw itemsError;

      const { data: newCalc, error: insertCalcError } = await supabase
        .from('event_calculations')
        .insert({
          event_id: calc.event_id,
          name: `${calc.name} — kopia`,
          notes: calc.notes,
        })
        .select()
        .single();

      if (insertCalcError) throw insertCalcError;

      if (calcItems?.length) {
        const payload = calcItems.map((item: any, index: number) => ({
          calculation_id: newCalc.id,
          category: item.category,
          name: item.name,
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          unit_price: item.unit_price,
          days: item.days,
          source: item.source,
          source_ref: item.source_ref,
          position: index,
          vat_rate: item.vat_rate ?? DEFAULT_VAT,
        }));

        const { error: insertItemsError } = await supabase
          .from('event_calculation_items')
          .insert(payload);

        if (insertItemsError) throw insertItemsError;
      }

      const duplicatedTotal =
        calcItems?.reduce(
          (sum: number, item: any) =>
            sum +
            Number(item.quantity || 0) * Number(item.unit_price || 0) * Number(item.days || 1),
          0,
        ) ?? 0;

      setList((prev) => [
        {
          id: newCalc.id,
          event_id: newCalc.event_id,
          name: newCalc.name,
          notes: newCalc.notes,
          created_at: newCalc.created_at,
          updated_at: newCalc.updated_at,
          items_count: calcItems?.length ?? 0,
          total: round2(duplicatedTotal),
        },
        ...prev,
      ]);

      showSnackbar('Kalkulacja została zduplikowana', 'success');
    } catch (error: any) {
      console.error('Error duplicating calculation:', error);
      showSnackbar(error.message || 'Nie udało się zduplikować kalkulacji', 'error');
    } finally {
      setDuplicatingId(null);
    }
  };

  if (activeId) {
    return (
      <CalculationEditor
        calculationId={activeId}
        eventId={eventId}
        onBack={() => {
          setActiveId(null);
          fetchList();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-light text-[#e5e4e2]">
            <Calculator className="h-5 w-5 text-[#d3bb73]" />
            Kalkulacje wydarzenia
          </h2>
          <p className="text-sm text-[#e5e4e2]/60">
            Podsumowanie zasobów: sprzęt, ludzie, transport i inne.
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Stwórz kalkulację
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8 text-center text-[#e5e4e2]/60">
          Wczytywanie...
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#d3bb73]/20 bg-[#1c1f33] p-10 text-center">
          <Calculator className="mx-auto mb-3 h-10 w-10 text-[#d3bb73]/40" />
          <p className="text-[#e5e4e2]/70">Brak kalkulacji dla tego wydarzenia</p>
          <p className="mt-1 text-sm text-[#e5e4e2]/50">
            Kliknij &bdquo;Stwórz kalkulację&rdquo;, aby zacząć.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
          <table className="w-full text-sm">
            <thead className="bg-[#0a0d1a] text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60">
              <tr>
                <th className="px-4 py-3">Nazwa</th>
                <th className="px-4 py-3">Pozycje</th>
                <th className="px-4 py-3">Suma netto</th>
                <th className="px-4 py-3">Zmodyfikowano</th>
                <th className="px-4 py-3 text-right">Akcje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d3bb73]/10">
              {list.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer transition-colors hover:bg-[#0a0d1a]/50"
                  onClick={() => setActiveId(c.id)}
                >
                  <td className="px-4 py-3 font-medium text-[#e5e4e2]">{c.name}</td>
                  <td className="px-4 py-3 text-[#e5e4e2]/80">{c.items_count ?? 0}</td>
                  <td className="px-4 py-3 text-[#d3bb73]">{fmt(c.total ?? 0)} PLN</td>
                  <td className="px-4 py-3 text-[#e5e4e2]/60">
                    {new Date(c.updated_at).toLocaleString('pl-PL')}
                  </td>
                  <td
                    className="px-4 py-3"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="flex justify-end">
                      <ResponsiveActionBar
                        disabledBackground
                        mobileBreakpoint={4000}
                        actions={[
                          {
                            label: 'Edytuj',
                            onClick: () => setActiveId(c.id),
                            icon: <Pencil className="h-4 w-4" />,
                            variant: 'default',
                          },
                          {
                            label: duplicatingId === c.id ? 'Duplikuję...' : 'Duplikuj',
                            onClick: () => handleDuplicate(c.id),
                            disabled: duplicatingId === c.id,
                            icon:
                              duplicatingId === c.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              ),
                            variant: 'default',
                          },
                          {
                            label: 'Usuń',
                            onClick: () => handleDelete(c.id),
                            icon: <Trash2 className="h-4 w-4" />,
                            variant: 'danger',
                          },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* -------------------- Editor -------------------- */

function CalculationEditor({
  calculationId,
  eventId,
  onBack,
}: {
  calculationId: string;
  eventId: string;
  onBack: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<CalcItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [generatedPdfPath, setGeneratedPdfPath] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [company, setCompany] = useState<any>(null);
  const [defaultEmail, setDefaultEmail] = useState<string | null>(null);
  const [primaryContact, setPrimaryContact] = useState<{
    id: string;
    name: string;
    email: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: calc }, { data: itemsData }, { data: ev }] = await Promise.all([
      supabase.from('event_calculations').select('*').eq('id', calculationId).maybeSingle(),
      supabase
        .from('event_calculation_items')
        .select('*')
        .eq('calculation_id', calculationId)
        .order('category')
        .order('position'),
      supabase
        .from('events')
        .select('name, event_date, my_company_id, contact_person_id')
        .eq('id', eventId)
        .maybeSingle(),
    ]);
    if (calc) {
      setName(calc.name);
      setNotes(calc.notes ?? '');
      setGeneratedPdfPath(calc.generated_pdf_path ?? null);
    }
    if (itemsData) {
      setItems(
        itemsData.map((r: any) => ({
          id: r.id,
          calculation_id: r.calculation_id,
          category: r.category,
          name: r.name,
          description: r.description ?? '',
          unit: r.unit,
          quantity: Number(r.quantity),
          unit_price: Number(r.unit_price),
          days: Number(r.days),
          source: r.source,
          source_ref: r.source_ref,
          position: r.position,
          vat_rate: r.vat_rate != null ? Number(r.vat_rate) : DEFAULT_VAT,
          editing: false,
        })),
      );
    }
    if (ev) {
      setEventName(ev.name ?? '');
      setEventDate(ev.event_date ?? null);
      const companyQuery = supabase
        .from('my_companies')
        .select(
          'id, name, legal_name, nip, logo_url, street, building_number, apartment_number, postal_code, city, email, phone, website',
        );
      const { data: comp } = ev.my_company_id
        ? await companyQuery.eq('id', ev.my_company_id).maybeSingle()
        : await companyQuery.eq('is_default', true).eq('is_active', true).maybeSingle();
      if (comp) {
        const rawLogo = (comp as any).logo_url as string | null;
        let resolvedLogo = rawLogo;
        if (rawLogo && !/^https?:\/\//i.test(rawLogo) && !rawLogo.startsWith('data:')) {
          const { data: pub } = supabase.storage.from('company-logos').getPublicUrl(rawLogo);
          resolvedLogo = pub?.publicUrl || rawLogo;
        }
        setCompany({ ...comp, logo_url: resolvedLogo });
      } else {
        setCompany(null);
      }

      if (ev.contact_person_id) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('id, first_name, last_name, full_name, email')
          .eq('id', ev.contact_person_id)
          .maybeSingle();

        if (contact) {
          const contactName =
            contact.full_name || `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim();

          setPrimaryContact({
            id: contact.id,
            name: contactName || 'Kontakt bez nazwy',
            email: contact.email ?? null,
          });

          setDefaultEmail(contact.email ?? '');
        } else {
          setPrimaryContact(null);
          setDefaultEmail('');
        }
      } else {
        setPrimaryContact(null);
        setDefaultEmail('');
      }
    }
    setLoading(false);
  }, [calculationId, eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const addEmptyRow = (category: Category) => {
    setItems((prev) => [
      ...prev,
      {
        category,
        name: '',
        description: '',
        unit: category === 'staff' ? 'h' : category === 'transport' ? 'km' : 'szt.',
        quantity: 1,
        unit_price: 0,
        days: 1,
        source: 'manual',
        position: prev.filter((p) => p.category === category).length,
        vat_rate: DEFAULT_VAT,
        editing: true,
      },
    ]);
  };

  const updateItem = (index: number, patch: Partial<CalcItem>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleEdit = (index: number, editing: boolean) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, editing } : it)));
  };

  const grouped = useMemo(() => {
    const map: Record<Category, CalcItem[]> = {
      equipment: [],
      staff: [],
      transport: [],
      other: [],
    };
    items.forEach((it) => map[it.category].push(it));
    return map;
  }, [items]);

  const categoryTotals = useMemo(() => {
    const totals: Record<Category, number> = {
      equipment: 0,
      staff: 0,
      transport: 0,
      other: 0,
    };
    items.forEach((it) => {
      totals[it.category] += rowNet(it);
    });
    return totals;
  }, [items]);

  const categoryTotalsGross = useMemo(() => {
    const totals: Record<Category, number> = {
      equipment: 0,
      staff: 0,
      transport: 0,
      other: 0,
    };
    items.forEach((it) => {
      totals[it.category] += rowGross(it);
    });
    return totals;
  }, [items]);

  const grandTotal = useMemo(
    () => round2(Object.values(categoryTotals).reduce((a, b) => a + b, 0)),
    [categoryTotals],
  );

  const grandTotalGross = useMemo(
    () => round2(Object.values(categoryTotalsGross).reduce((a, b) => a + b, 0)),
    [categoryTotalsGross],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error: updErr } = await supabase
        .from('event_calculations')
        .update({ name, notes, updated_at: new Date().toISOString() })
        .eq('id', calculationId);
      if (updErr) throw updErr;

      await supabase.from('event_calculation_items').delete().eq('calculation_id', calculationId);

      if (items.length) {
        const payload = items.map((it, idx) => ({
          calculation_id: calculationId,
          category: it.category,
          name: it.name,
          description: it.description || '',
          unit: it.unit || 'szt.',
          quantity: Number(it.quantity) || 0,
          unit_price: Number(it.unit_price) || 0,
          days: Number(it.days) || 1,
          source: it.source,
          source_ref: it.source_ref ?? null,
          position: idx,
          vat_rate: Number(it.vat_rate ?? DEFAULT_VAT),
        }));
        const { error: insErr } = await supabase.from('event_calculation_items').insert(payload);
        if (insErr) throw insErr;
      }

      showSnackbar('Zapisano kalkulację', 'success');
      setItems((prev) => prev.map((it) => ({ ...it, editing: false })));
      await load();
    } catch (e: any) {
      console.error(e);
      showSnackbar(e.message || 'Błąd zapisu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCalc = () => {
    showConfirm({
      title: 'Usunąć kalkulację?',
      message: 'Tej operacji nie można cofnąć.',
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    }).then(async (confirmed: boolean | void) => {
      if (confirmed) {
        await supabase.from('event_calculations').delete().eq('id', calculationId);
        onBack();
      } else {
        showSnackbar('Anulowano usuwanie kalkulacji', 'warning');
      }
    });
  };

  const appendImportedItems = (imported: CalcItem[]) => {
    setItems((prev) => [...prev, ...imported.map((it) => ({ ...it, editing: false }))]);
  };

  const handlePrint = () => {
    const html = buildCalculationHtml({
      name,
      notes,
      eventName,
      eventDate,
      grouped,
      categoryTotals,
      categoryTotalsGross,
      grandTotal,
      grandTotalGross,
      company,
    });
    const w = window.open('', '_blank');
    if (!w) {
      showSnackbar('Wyskakujące okna zablokowane', 'warning');
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  const handleGeneratePdf = async () => {
    if (!items.length) {
      showSnackbar('Kalkulacja nie zawiera pozycji', 'warning');
      return;
    }
    setGeneratingPdf(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const html = buildCalculationHtml({
        name,
        notes,
        eventName,
        eventDate,
        grouped,
        categoryTotals,
        categoryTotalsGross,
        grandTotal,
        grandTotalGross,
        company,
      });

      const res = await fetch('/bridge/events/calculations-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          calculationId,
          eventName,
          calculationName: name,
          html,
          createdBy: user?.id ?? null,
          previousPdfPath: generatedPdfPath,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Błąd generowania PDF');
      }

      setGeneratedPdfPath(data.storagePath);
      showSnackbar('PDF kalkulacji zapisany w plikach wydarzenia', 'success');
    } catch (e: any) {
      console.error(e);
      showSnackbar(e.message || 'Błąd generowania PDF', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleOpenSendEmail = async () => {
    if (!generatedPdfPath) {
      showSnackbar('Najpierw wygeneruj PDF kalkulacji', 'warning');
      return;
    }
    setShowSendEmail(true);
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8 text-center text-[#e5e4e2]/60">
        Wczytywanie...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="rounded-lg border border-[#d3bb73]/30 p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-lg font-light text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          />
        </div>

        <ResponsiveActionBar
          mobileBreakpoint={4000}
          actions={[
            {
              label: 'Importuj z oferty',
              onClick: () => setShowImport(true),
              icon: <Import className="h-4 w-4" />,
            },
            {
              label: 'Drukuj',
              onClick: handlePrint,
              icon: <Printer className="h-4 w-4" />,
            },
            {
              label: generatingPdf ? 'Generuję...' : 'Generuj PDF',
              onClick: handleGeneratePdf,
              disabled: generatingPdf,
              icon: generatingPdf ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              ),
            },
            {
              label: 'Wyślij email',
              onClick: handleOpenSendEmail,
              disabled: !generatedPdfPath,
              icon: <Mail className="h-4 w-4" />,
            },
            {
              label: saving ? 'Zapisywanie...' : 'Zapisz',
              onClick: handleSave,
              disabled: saving,
              variant: 'primary',
              icon: <Save className="h-4 w-4" />,
            },
            {
              label: 'Usuń kalkulację',
              onClick: handleDeleteCalc,
              variant: 'danger',
              icon: <Trash2 className="h-4 w-4" />,
            },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {(Object.keys(CATEGORY_META) as Category[]).map((cat) => {
          const Icon = CATEGORY_META[cat].icon;
          return (
            <div key={cat} className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
              <div className="mb-2 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                <Icon className="h-4 w-4 text-[#d3bb73]" />
                {CATEGORY_META[cat].label}
              </div>
              <div className="text-lg font-light text-[#e5e4e2]">
                {fmt(categoryTotals[cat])} <span className="text-xs text-[#e5e4e2]/50">netto</span>
              </div>
              <div className="text-sm font-light text-[#d3bb73]">
                {fmt(categoryTotalsGross[cat])}{' '}
                <span className="text-xs text-[#d3bb73]/70">brutto</span>
              </div>
              <div className="mt-1 text-xs text-[#e5e4e2]/50">{grouped[cat].length} pozycji</div>
            </div>
          );
        })}
      </div>

      {(Object.keys(CATEGORY_META) as Category[]).map((cat) => (
        <CategorySection
          key={cat}
          category={cat}
          items={grouped[cat]}
          allItems={items}
          onAdd={() => addEmptyRow(cat)}
          onUpdate={updateItem}
          onRemove={removeItem}
          onToggleEdit={toggleEdit}
        />
      ))}

      <div className="rounded-xl border border-[#d3bb73]/30 bg-[#1c1f33] p-4">
        <div className="mb-2 text-sm font-medium text-[#e5e4e2]/60">Notatki</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Dodatkowe uwagi do kalkulacji..."
          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-6 rounded-xl border border-[#d3bb73]/30 bg-[#0a0d1a] p-4">
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-[#e5e4e2]/50">Netto</div>
          <div className="text-xl font-light text-[#e5e4e2]">{fmt(grandTotal)} PLN</div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-[#e5e4e2]/50">VAT</div>
          <div className="text-xl font-light text-[#e5e4e2]/80">
            {fmt(round2(grandTotalGross - grandTotal))} PLN
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-[#d3bb73]">Brutto</div>
          <div className="text-3xl font-light text-[#d3bb73]">{fmt(grandTotalGross)} PLN</div>
        </div>
      </div>

      {showImport && (
        <ImportFromOfferModal
          eventId={eventId}
          existingRefs={new Set(items.map((i) => i.source_ref).filter(Boolean) as string[])}
          onClose={() => setShowImport(false)}
          onImport={(picked) => {
            appendImportedItems(picked);
            setShowImport(false);
          }}
        />
      )}

      {showSendEmail && (
        <SendCalculationEmailModal
          calculationId={calculationId}
          eventId={eventId}
          contactPerson={primaryContact}
          defaultEmail={defaultEmail ?? ''}
          recipientName={primaryContact?.name ?? ''}
          calculationName={name}
          eventName={eventName}
          onClose={() => setShowSendEmail(false)}
        />
      )}
    </div>
  );
}

/* -------------------- Category section -------------------- */

function CategorySection({
  category,
  items,
  allItems,
  onAdd,
  onUpdate,
  onRemove,
  onToggleEdit,
}: {
  category: Category;
  items: CalcItem[];
  allItems: CalcItem[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<CalcItem>) => void;
  onRemove: (index: number) => void;
  onToggleEdit: (index: number, editing: boolean) => void;
}) {
  const Icon = CATEGORY_META[category].icon;
  const indexOfAll = (item: CalcItem) => allItems.indexOf(item);

  const [warehouseList, setWarehouseList] = useState<WarehouseEquipment[]>([]);
  const [warehouseLoaded, setWarehouseLoaded] = useState(false);

  const ensureWarehouseLoaded = useCallback(async () => {
    if (warehouseLoaded) return;
    const { data } = await supabase
      .from('equipment_items')
      .select('id, name, brand, model, rental_price_per_day')
      .order('name');
    setWarehouseList((data as WarehouseEquipment[]) ?? []);
    setWarehouseLoaded(true);
  }, [warehouseLoaded]);

  const numberInputClass =
    'w-full min-w-[40px] max-w-[60px] rounded-md border border-[#d3bb73]/20 bg-[#0a0d1a] px-2 py-1 text-right tabular-nums text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none';

  const priceInputClass =
    'w-full min-w-[80px] max-w-[120px] rounded-md border border-[#d3bb73]/20 bg-[#0a0d1a] px-2 py-1 text-right tabular-nums text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none';

  return (
    <div className="relative rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
      <div className="flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#0a0d1a] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
          <Icon className="h-4 w-4 text-[#d3bb73]" />
          {CATEGORY_META[category].label}
          <span className="text-xs text-[#e5e4e2]/50">({items.length})</span>
        </div>
        <button
          onClick={onAdd}
          className="flex items-center gap-1 rounded-md border border-[#d3bb73]/30 px-2 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
        >
          <Plus className="h-3.5 w-3.5" />
          Dodaj
        </button>
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-[#e5e4e2]/40">Brak pozycji</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0a0d1a]/60 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60">
              <tr>
                <th className="px-3 py-2">Nazwa</th>
                <th className="px-3 py-2">Opis</th>
                <th className="min-w-[90px] px-3 py-2">Ilość</th>
                <th className="min-w-[80px] px-3 py-2">Jedn.</th>
                <th className="min-w-[80px] px-3 py-2">Dni</th>
                <th className="min-w-[120px] px-3 py-2">Cena jedn.</th>
                <th className="min-w-[80px] px-3 py-2">VAT %</th>
                <th className="w-28 px-3 py-2 text-right">Netto</th>
                <th className="w-28 px-3 py-2 text-right">Brutto</th>
                <th className="w-10 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d3bb73]/10">
              {items.map((it) => {
                const idx = indexOfAll(it);
                const isEditing = !!it.editing;
                if (!isEditing) {
                  return (
                    <tr
                      key={idx}
                      className="cursor-pointer hover:bg-[#0a0d1a]/40"
                      onDoubleClick={() => onToggleEdit(idx, true)}
                    >
                      <td className="px-3 py-2 text-[#e5e4e2]">
                        {it.name || <span className="text-[#e5e4e2]/40">—</span>}
                      </td>
                      <td className="px-3 py-2 text-[#e5e4e2]/70">
                        {it.description || <span className="text-[#e5e4e2]/30">—</span>}
                      </td>
                      <td className="px-3 py-2 text-[#e5e4e2]/80">{it.quantity}</td>
                      <td className="px-3 py-2 text-[#e5e4e2]/80">{it.unit}</td>
                      <td className="px-3 py-2 text-[#e5e4e2]/80">{it.days}</td>
                      <td className="px-3 py-2 text-[#e5e4e2]/80">{fmt(it.unit_price)}</td>
                      <td className="px-3 py-2 text-[#e5e4e2]/80">{it.vat_rate}%</td>
                      <td className="px-3 py-2 text-right text-[#e5e4e2]">{fmt(rowNet(it))}</td>
                      <td className="px-3 py-2 text-right text-[#d3bb73]">{fmt(rowGross(it))}</td>
                      <td
                        className="relative z-20 px-3 py-2 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ResponsiveActionBar
                          disabledBackground
                          mobileBreakpoint={2000}
                          actions={[
                            {
                              label: 'Edytuj',
                              onClick: () => onToggleEdit(idx, true),
                              icon: <Pencil className="h-4 w-4" />,
                              variant: 'default',
                            },
                            {
                              label: 'Usuń',
                              onClick: () => onRemove(idx),
                              icon: <Trash2 className="h-4 w-4" />,
                              variant: 'danger',
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={idx} className="bg-[#0a0d1a]/30">
                    <td className="px-3 py-2">
                      {category === 'equipment' ? (
                        <EquipmentNameCell
                          item={it}
                          warehouseList={warehouseList}
                          onFocusLoad={ensureWarehouseLoaded}
                          onUpdate={(patch) => onUpdate(idx, patch)}
                        />
                      ) : (
                        <input
                          value={it.name}
                          onChange={(e) => onUpdate(idx, { name: e.target.value })}
                          placeholder="Nazwa pozycji"
                          className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:bg-[#0a0d1a] focus:outline-none"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={it.description}
                        onChange={(e) => onUpdate(idx, { description: e.target.value })}
                        placeholder="Opis"
                        className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[#e5e4e2]/80 focus:border-[#d3bb73]/40 focus:bg-[#0a0d1a] focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        value={it.quantity}
                        onChange={(e) => onUpdate(idx, { quantity: Number(e.target.value) })}
                        className={numberInputClass}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={it.unit}
                        onChange={(e) => onUpdate(idx, { unit: e.target.value })}
                        className={numberInputClass}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.5"
                        value={it.days}
                        onChange={(e) => onUpdate(idx, { days: Number(e.target.value) })}
                        className={numberInputClass}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        value={it.unit_price}
                        onChange={(e) => onUpdate(idx, { unit_price: Number(e.target.value) })}
                        className={priceInputClass}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="1"
                        value={it.vat_rate}
                        onChange={(e) => onUpdate(idx, { vat_rate: Number(e.target.value) })}
                        className={numberInputClass}
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-[#e5e4e2]">{fmt(rowNet(it))}</td>
                    <td className="px-3 py-2 text-right text-[#d3bb73]">{fmt(rowGross(it))}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => onToggleEdit(idx, false)}
                          className="rounded-md p-1 text-emerald-400 hover:bg-emerald-500/10"
                          title="Zatwierdź"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => onRemove(idx)}
                          className="rounded-md p-1 text-red-400 hover:bg-red-500/10"
                          title="Usuń"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
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

/* -------------------- Equipment name cell (warehouse-aware) -------------------- */

function EquipmentNameCell({
  item,
  warehouseList,
  onFocusLoad,
  onUpdate,
}: {
  item: CalcItem;
  warehouseList: WarehouseEquipment[];
  onFocusLoad: () => void;
  onUpdate: (patch: Partial<CalcItem>) => void;
}) {
  const fromWarehouse = item.source === 'warehouse';
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const equipmentMenu = usePortalDropdown({
    align: 'left',
    width: 'trigger',
    offsetY: 4,
    closeOnScroll: false,
  });

  useEffect(() => {
    if (fromWarehouse) onFocusLoad();
  }, [fromWarehouse, onFocusLoad]);

  const toggleWarehouse = (checked: boolean) => {
    if (checked) {
      onFocusLoad();
      onUpdate({ source: 'warehouse', source_ref: null, name: '' });
    } else {
      onUpdate({ source: 'manual', source_ref: null });
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return warehouseList.slice(0, 30);
    return warehouseList
      .filter((e) => {
        const full = `${e.name} ${e.brand ?? ''} ${e.model ?? ''}`.toLowerCase();
        return full.includes(q);
      })
      .slice(0, 30);
  }, [warehouseList, search]);

  const selectEquipment = (eq: WarehouseEquipment) => {
    const full = [eq.brand, eq.model, eq.name].filter(Boolean).join(' ') || eq.name;
    const patch: Partial<CalcItem> = {
      source: 'warehouse',
      source_ref: eq.id,
      name: full,
    };
    const rental = Number(eq.rental_price_per_day ?? 0);
    if (eq.rental_price_per_day != null && rental > 0) {
      patch.unit_price = rental;
    }
    onUpdate(patch);
    setSearch('');
    setOpen(false);
  };

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-[11px] text-[#e5e4e2]/60">
        <input
          type="checkbox"
          checked={fromWarehouse}
          onChange={(e) => toggleWarehouse(e.target.checked)}
          className="h-3 w-3 rounded border-[#d3bb73]/40 bg-[#0a0d1a] text-[#d3bb73]"
        />
        z magazynu
      </label>

      {fromWarehouse ? (
        <div className="relative">
          {item.source_ref && item.name ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-[#d3bb73]/30 bg-[#0a0d1a] px-2 py-1">
              <span className="truncate text-[#e5e4e2]">{item.name}</span>
              <button
                type="button"
                onClick={() => onUpdate({ source_ref: null, name: '' })}
                className="text-xs text-[#d3bb73] hover:underline"
              >
                Zmień
              </button>
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                value={search}
                onMouseDown={(e) => {
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(true);
                  equipmentMenu.open('equipment-search', e.currentTarget);
                }}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOpen(true);
                  equipmentMenu.open('equipment-search', e.currentTarget);
                }}
                onFocus={(e) => {
                  setOpen(true);
                  equipmentMenu.open('equipment-search', e.currentTarget);
                }}
                onBlur={() => {
                  setTimeout(() => {
                    setOpen(false);
                    equipmentMenu.close();
                  }, 150);
                }}
                placeholder="Szukaj sprzętu w magazynie..."
                className="w-full rounded-md border border-[#d3bb73]/30 bg-[#0a0d1a] px-2 py-1 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
              {open && filtered.length > 0 && (
                <PortalDropdownMenu
                  open={open && filtered.length > 0}
                  position={equipmentMenu.position}
                  className="max-h-60 overflow-y-auto"
                  content={
                    <>
                      {filtered.map((eq) => (
                        <button
                          key={eq.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectEquipment(eq);
                            setOpen(false);
                            equipmentMenu.close();
                          }}
                          className="block w-full px-3 py-1.5 text-left text-sm text-[#e5e4e2] hover:bg-[#0a0d1a]"
                        >
                          <div className="font-medium">
                            {[eq.brand, eq.model].filter(Boolean).join(' ') || eq.name}
                          </div>

                          {(eq.brand || eq.model) && (
                            <div className="text-xs text-[#e5e4e2]/50">{eq.name}</div>
                          )}
                        </button>
                      ))}
                    </>
                  }
                />
              )}
              {open && search && filtered.length === 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-xs text-[#e5e4e2]/60">
                  Brak wyników
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <input
          value={item.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Nazwa pozycji"
          className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:bg-[#0a0d1a] focus:outline-none"
        />
      )}
    </div>
  );
}

/* -------------------- Import modal -------------------- */

type ImportableItem = {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  total: number;
  offerId: string;
  offerName: string;
  categoryName: string | null;
  autoCategory: Category;
  vat_rate: number;
};

function guessCategory(categoryName: string | null, itemName: string): Category {
  const hay = `${categoryName ?? ''} ${itemName ?? ''}`.toLowerCase();
  const staffKeywords = [
    'dj',
    'prowadz',
    'obsług',
    'kelner',
    'hostess',
    'operator',
    'technik',
    'ochron',
    'mc ',
    'konferansjer',
    'animator',
    'muzyk',
    'artyst',
    'barmen',
    'fotograf',
    'kamerzyst',
    'ludzi',
    'staff',
    'personel',
  ];
  const transportKeywords = ['transport', 'logistyk', 'kierowc', 'dojazd', 'przewóz'];
  const equipmentKeywords = [
    'nagłośn',
    'oświetl',
    'multimedia',
    'scena',
    'sprzęt',
    'projektor',
    'ekran',
    'mikrofon',
    'konsoleta',
    'głośnik',
    'led',
    'kabel',
    'technika',
    'światło',
    'dźwięk',
  ];

  if (staffKeywords.some((k) => hay.includes(k))) return 'staff';
  if (transportKeywords.some((k) => hay.includes(k))) return 'transport';
  if (equipmentKeywords.some((k) => hay.includes(k))) return 'equipment';
  return 'other';
}

function ImportFromOfferModal({
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
  const [offerItems, setOfferItems] = useState<ImportableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: offers, error: offersErr } = await supabase
        .from('offers')
        .select('id, offer_number')
        .eq('event_id', eventId);

      if (offersErr) {
        console.error('offers fetch error', offersErr);
      }
      if (!offers?.length) {
        setOfferItems([]);
        setLoading(false);
        return;
      }

      const offerIds = offers.map((o) => o.id);
      const { data: itemsData, error: itemsErr } = await supabase
        .from('offer_items')
        .select('*')
        .in('offer_id', offerIds)
        .order('display_order');

      if (itemsErr) {
        console.error('offer_items fetch error', itemsErr);
      }

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
        };
      });

      setOfferItems(mapped);
      setLoading(false);
    })();
  }, [eventId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const available = offerItems.filter((it) => !existingRefs.has(it.id));
    if (selected.size === available.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(available.map((it) => it.id)));
    }
  };

  const handleImport = () => {
    const picked: CalcItem[] = offerItems
      .filter((it) => selected.has(it.id))
      .map((it, idx) => ({
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
      }));
    onImport(picked);
  };

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
        <div className="flex items-center justify-between gap-3 border-b border-[#d3bb73]/10 bg-[#0a0d1a]/60 px-5 py-3 text-sm text-[#e5e4e2]/70">
          <span>
            Zaznacz pozycje z oferty — kalkulacja sama przypisze je do właściwej kategorii.
          </span>
          <button
            type="button"
            onClick={toggleAll}
            className="rounded-md border border-[#d3bb73]/30 px-3 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
          >
            Zaznacz wszystkie
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-8 text-center text-[#e5e4e2]/60">Wczytywanie...</div>
          ) : offerItems.length === 0 ? (
            <div className="p-8 text-center text-[#e5e4e2]/60">
              Brak pozycji w ofertach dla tego wydarzenia.
            </div>
          ) : (
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
                          checked={selected.has(it.id)}
                          disabled={alreadyImported}
                          onChange={() => toggle(it.id)}
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
                              prev.map((p) =>
                                p.id === it.id ? { ...p, autoCategory: newCat } : p,
                              ),
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
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#d3bb73]/10 px-5 py-3">
          <div className="text-sm text-[#e5e4e2]/60">Zaznaczono: {selected.size}</div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-[#d3bb73]/30 px-4 py-2 text-sm text-[#e5e4e2]/80 hover:bg-[#0a0d1a]"
            >
              Anuluj
            </button>
            <button
              onClick={handleImport}
              disabled={selected.size === 0}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <FileDown className="h-4 w-4" />
              Importuj ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
