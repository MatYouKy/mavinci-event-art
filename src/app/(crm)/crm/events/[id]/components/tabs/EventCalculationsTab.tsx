'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';

type Category = 'equipment' | 'staff' | 'transport' | 'other';

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

interface CalcItem {
  id?: string;
  calculation_id?: string;
  category: Category;
  name: string;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  days: number;
  source: 'manual' | 'offer';
  source_ref?: string | null;
  position: number;
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

const round2 = (n: number) => Math.round(n * 100) / 100;
const rowTotal = (it: CalcItem) => round2(it.quantity * it.unit_price * (it.days || 1));
const fmt = (n: number) =>
  n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function EventCalculationsTab({ eventId }: Props) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const [list, setList] = useState<CalculationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('event_calculations')
      .select('*, event_calculation_items(quantity, unit_price, days)')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error(error);
      showSnackbar('Nie udało się pobrać kalkulacji', 'error');
      setLoading(false);
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
    setLoading(false);
  }, [eventId, showSnackbar]);

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
      onConfirm: async () => {
        const { error } = await supabase.from('event_calculations').delete().eq('id', id);
        if (error) {
          showSnackbar('Nie udało się usunąć kalkulacji', 'error');
          return;
        }
        showSnackbar('Usunięto', 'success');
        fetchList();
      },
    });
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
        <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
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
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveId(c.id);
                        }}
                        className="rounded-lg border border-[#d3bb73]/30 p-1.5 text-[#d3bb73] hover:bg-[#d3bb73]/10"
                        title="Edytuj"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(c.id);
                        }}
                        className="rounded-lg border border-red-500/30 p-1.5 text-red-400 hover:bg-red-500/10"
                        title="Usuń"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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
      supabase.from('events').select('name, event_date').eq('id', eventId).maybeSingle(),
    ]);
    if (calc) {
      setName(calc.name);
      setNotes(calc.notes ?? '');
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
        })),
      );
    }
    if (ev) {
      setEventName(ev.name ?? '');
      setEventDate(ev.event_date ?? null);
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
      },
    ]);
  };

  const updateItem = (index: number, patch: Partial<CalcItem>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
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
      totals[it.category] += rowTotal(it);
    });
    return totals;
  }, [items]);

  const grandTotal = useMemo(
    () => round2(Object.values(categoryTotals).reduce((a, b) => a + b, 0)),
    [categoryTotals],
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
        }));
        const { error: insErr } = await supabase.from('event_calculation_items').insert(payload);
        if (insErr) throw insErr;
      }

      showSnackbar('Zapisano kalkulację', 'success');
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
      onConfirm: async () => {
        await supabase.from('event_calculations').delete().eq('id', calculationId);
        onBack();
      },
    });
  };

  const appendImportedItems = (imported: CalcItem[]) => {
    setItems((prev) => [...prev, ...imported]);
  };

  const handlePrint = () => {
    const html = buildCalculationHtml({
      name,
      notes,
      eventName,
      eventDate,
      grouped,
      categoryTotals,
      grandTotal,
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
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/10"
          >
            <Import className="h-4 w-4" />
            Importuj z oferty
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/10"
          >
            <Printer className="h-4 w-4" />
            Drukuj / PDF
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
          <button
            onClick={handleDeleteCalc}
            className="rounded-lg border border-red-500/30 p-2 text-red-400 hover:bg-red-500/10"
            title="Usuń kalkulację"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {(Object.keys(CATEGORY_META) as Category[]).map((cat) => {
          const Icon = CATEGORY_META[cat].icon;
          return (
            <div
              key={cat}
              className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                <Icon className="h-4 w-4 text-[#d3bb73]" />
                {CATEGORY_META[cat].label}
              </div>
              <div className="text-xl font-light text-[#e5e4e2]">
                {fmt(categoryTotals[cat])} <span className="text-sm text-[#d3bb73]">PLN</span>
              </div>
              <div className="text-xs text-[#e5e4e2]/50">{grouped[cat].length} pozycji</div>
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

      <div className="flex items-center justify-end rounded-xl border border-[#d3bb73]/30 bg-[#0a0d1a] p-4">
        <div className="text-right">
          <div className="text-sm text-[#e5e4e2]/60">Suma całkowita (netto)</div>
          <div className="text-3xl font-light text-[#d3bb73]">{fmt(grandTotal)} PLN</div>
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
}: {
  category: Category;
  items: CalcItem[];
  allItems: CalcItem[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<CalcItem>) => void;
  onRemove: (index: number) => void;
}) {
  const Icon = CATEGORY_META[category].icon;
  const indexOfAll = (item: CalcItem) => allItems.indexOf(item);

  return (
    <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
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
                <th className="w-20 px-3 py-2">Ilość</th>
                <th className="w-20 px-3 py-2">Jedn.</th>
                <th className="w-20 px-3 py-2">Dni</th>
                <th className="w-28 px-3 py-2">Cena jedn.</th>
                <th className="w-28 px-3 py-2 text-right">Razem</th>
                <th className="w-10 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d3bb73]/10">
              {items.map((it) => {
                const idx = indexOfAll(it);
                return (
                  <tr key={idx}>
                    <td className="px-3 py-2">
                      <input
                        value={it.name}
                        onChange={(e) => onUpdate(idx, { name: e.target.value })}
                        placeholder="Nazwa pozycji"
                        className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:bg-[#0a0d1a] focus:outline-none"
                      />
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
                        onChange={(e) =>
                          onUpdate(idx, { quantity: Number(e.target.value) || 0 })
                        }
                        className="w-full rounded-md border border-[#d3bb73]/20 bg-[#0a0d1a] px-2 py-1 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={it.unit}
                        onChange={(e) => onUpdate(idx, { unit: e.target.value })}
                        className="w-full rounded-md border border-[#d3bb73]/20 bg-[#0a0d1a] px-2 py-1 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.5"
                        value={it.days}
                        onChange={(e) => onUpdate(idx, { days: Number(e.target.value) || 1 })}
                        className="w-full rounded-md border border-[#d3bb73]/20 bg-[#0a0d1a] px-2 py-1 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        value={it.unit_price}
                        onChange={(e) =>
                          onUpdate(idx, { unit_price: Number(e.target.value) || 0 })
                        }
                        className="w-full rounded-md border border-[#d3bb73]/20 bg-[#0a0d1a] px-2 py-1 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-[#d3bb73]">
                      {fmt(rowTotal(it))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onRemove(idx)}
                        className="rounded-md p-1 text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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

/* -------------------- Import modal -------------------- */

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
  const [offerItems, setOfferItems] = useState<
    Array<OfferItem & { offerName: string; offerId: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [defaultCategory, setDefaultCategory] = useState<Category>('equipment');

  useEffect(() => {
    (async () => {
      const { data: offers } = await supabase
        .from('offers')
        .select('id, name, offer_number')
        .eq('event_id', eventId);
      if (!offers?.length) {
        setLoading(false);
        return;
      }
      const { data: itemsData } = await supabase
        .from('offer_items')
        .select('*')
        .in(
          'offer_id',
          offers.map((o) => o.id),
        )
        .order('display_order');
      const mapped = (itemsData ?? []).map((it: any) => {
        const off = offers.find((o) => o.id === it.offer_id);
        return {
          id: it.id,
          name: it.name,
          description: it.description,
          quantity: Number(it.quantity || 1),
          unit: it.unit,
          unit_price: Number(it.unit_price || 0),
          total: Number(it.total || 0),
          offerId: it.offer_id,
          offerName: off?.offer_number || off?.name || 'Oferta',
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

  const handleImport = () => {
    const picked: CalcItem[] = offerItems
      .filter((it) => selected.has(it.id))
      .map((it, idx) => ({
        category: defaultCategory,
        name: it.name,
        description: it.description || '',
        unit: it.unit || 'szt.',
        quantity: it.quantity,
        unit_price: it.unit_price,
        days: 1,
        source: 'offer',
        source_ref: it.id,
        position: idx,
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
        <div className="border-b border-[#d3bb73]/10 bg-[#0a0d1a]/60 px-5 py-3">
          <label className="mr-2 text-sm text-[#e5e4e2]/70">Domyślna kategoria:</label>
          <select
            value={defaultCategory}
            onChange={(e) => setDefaultCategory(e.target.value as Category)}
            className="rounded-md border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          >
            {(Object.keys(CATEGORY_META) as Category[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
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
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2">Oferta</th>
                  <th className="px-3 py-2">Nazwa</th>
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
                        {it.name}
                        {alreadyImported && (
                          <span className="ml-2 rounded bg-[#d3bb73]/10 px-1.5 py-0.5 text-xs text-[#d3bb73]">
                            Już zaimportowano
                          </span>
                        )}
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

/* -------------------- Print HTML -------------------- */

function buildCalculationHtml(params: {
  name: string;
  notes: string;
  eventName: string;
  eventDate: string | null;
  grouped: Record<Category, CalcItem[]>;
  categoryTotals: Record<Category, number>;
  grandTotal: number;
}): string {
  const { name, notes, eventName, eventDate, grouped, categoryTotals, grandTotal } = params;
  const formattedDate = eventDate
    ? new Date(eventDate).toLocaleDateString('pl-PL', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '';

  const esc = (s: string) =>
    (s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const categoryLabel: Record<Category, string> = {
    equipment: 'Sprzęt',
    staff: 'Ludzie',
    transport: 'Transport',
    other: 'Pozostałe',
  };

  const sections = (Object.keys(categoryLabel) as Category[])
    .filter((cat) => grouped[cat].length > 0)
    .map((cat) => {
      const rows = grouped[cat]
        .map(
          (it) => `
        <tr>
          <td>${esc(it.name)}${it.description ? `<div class="desc">${esc(it.description)}</div>` : ''}</td>
          <td class="num">${it.quantity}</td>
          <td class="num">${esc(it.unit)}</td>
          <td class="num">${it.days}</td>
          <td class="num">${fmt(it.unit_price)}</td>
          <td class="num strong">${fmt(rowTotal(it))}</td>
        </tr>
      `,
        )
        .join('');
      return `
        <section>
          <h2>${categoryLabel[cat]}</h2>
          <table class="items">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th class="num">Ilość</th>
                <th class="num">Jedn.</th>
                <th class="num">Dni</th>
                <th class="num">Cena jedn.</th>
                <th class="num">Razem</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr>
                <td colspan="5" class="right">Podsuma ${categoryLabel[cat]}:</td>
                <td class="num strong accent">${fmt(categoryTotals[cat])} PLN</td>
              </tr>
            </tfoot>
          </table>
        </section>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8" />
<title>${esc(name)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    color: #1c1f33;
    margin: 0;
    padding: 40px 48px;
    background: #fff;
  }
  header {
    border-bottom: 2px solid #d3bb73;
    padding-bottom: 16px;
    margin-bottom: 24px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  header h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 300;
    letter-spacing: 0.5px;
  }
  header .meta {
    font-size: 12px;
    color: #555;
    text-align: right;
  }
  header .meta strong { color: #1c1f33; }
  section { margin-bottom: 24px; page-break-inside: avoid; }
  section h2 {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #d3bb73;
    border-bottom: 1px solid #d3bb73;
    padding-bottom: 4px;
    margin: 0 0 8px 0;
  }
  table.items {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  table.items th, table.items td {
    padding: 8px 10px;
    border-bottom: 1px solid #eee;
    text-align: left;
    vertical-align: top;
  }
  table.items th {
    background: #f6f3ea;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #4a4331;
  }
  table.items td.num, table.items th.num { text-align: right; white-space: nowrap; }
  table.items td.strong { font-weight: 600; }
  table.items td.accent { color: #b1963f; }
  table.items td.right { text-align: right; font-weight: 500; color: #555; }
  table.items .desc { font-size: 11px; color: #777; margin-top: 2px; }
  table.items tfoot td { border-top: 1px solid #d3bb73; border-bottom: none; background: #fafaf3; }
  .grand {
    margin-top: 16px;
    padding: 16px 20px;
    background: #1c1f33;
    color: #f5f5f5;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-radius: 4px;
  }
  .grand .value { color: #d3bb73; font-size: 22px; font-weight: 300; }
  .notes {
    margin-top: 24px;
    padding: 12px 16px;
    background: #faf8f2;
    border-left: 3px solid #d3bb73;
    font-size: 12px;
    color: #4a4331;
    white-space: pre-wrap;
  }
  footer {
    margin-top: 40px;
    font-size: 10px;
    color: #999;
    text-align: center;
    border-top: 1px solid #eee;
    padding-top: 8px;
  }
  @media print { body { padding: 20px 28px; } }
</style>
</head>
<body>
  <header>
    <div>
      <h1>${esc(name) || 'Kalkulacja'}</h1>
      <div style="font-size:12px;color:#555;margin-top:4px;">
        ${eventName ? `Wydarzenie: <strong>${esc(eventName)}</strong>` : ''}
        ${formattedDate ? ` &middot; ${esc(formattedDate)}` : ''}
      </div>
    </div>
    <div class="meta">
      <div>Wygenerowano</div>
      <strong>${new Date().toLocaleDateString('pl-PL')}</strong>
    </div>
  </header>
  ${sections || '<p style="color:#888;text-align:center;padding:40px 0;">Brak pozycji</p>'}
  <div class="grand">
    <span>Suma całkowita (netto)</span>
    <span class="value">${fmt(grandTotal)} PLN</span>
  </div>
  ${notes ? `<div class="notes">${esc(notes)}</div>` : ''}
  <footer>Mavinci CRM &middot; Kalkulacja wydarzenia</footer>
</body>
</html>`;
}
