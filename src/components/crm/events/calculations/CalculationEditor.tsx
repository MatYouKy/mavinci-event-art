import SendCalculationEmailModal from '../../SendCalculationEmailModal';
import { ImportFromOfferModal } from './ImportFromOfferModal';
import { useState } from 'react';
import { useCallback } from 'react';
import { useEffect } from 'react';
import { useMemo } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { Category, CalcItem } from './EventCalculationsTab';
import { DEFAULT_VAT } from '../helpers/calculations/calculations.helper';
import { round2 } from '../helpers/calculations/calculations.helper';
import { rowNet, rowGross } from '../helpers/calculations/calculations.helper';
import { buildCalculationHtml } from '../pdf/buildCalculationHtml';
import { CATEGORY_META } from './calculations.constants';
import { CategorySection } from './CategorySection';
import ResponsiveActionBar from '../../ResponsiveActionBar';
import { ArrowLeft } from 'lucide-react';
import { Import } from 'lucide-react';
import { Printer } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { FileText } from 'lucide-react';
import { Mail } from 'lucide-react';
import { Save } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import { fmt } from '../helpers/calculations/calculations.helper';

export function CalculationEditor({
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
