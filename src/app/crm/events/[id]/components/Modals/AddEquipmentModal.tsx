import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { AvailabilityUI } from '@/app/crm/events/hooks/useEventEquipment';

type ItemType = 'item' | 'kit';

type SelectedRow = {
  checked: boolean;
  quantity: number;
  notes: string;
  type: ItemType;
};

const keyOf = (type: ItemType, id: string) => `${type}-${id}` as const;

const normalize = (s: string) => (s || '').toLowerCase().trim();

function num(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(v: any, min = 1, max = 1) {
  const n = Math.floor(num(v, min));
  return Math.max(min, Math.min(n, max));
}

/**
 * ✅ Jedno źródło prawdy w modalu:
 * maxAdd = ile mogę JESZCZE dodać do TEGO eventu w tym terminie
 */
function getLimits(avail?: AvailabilityUI) {
  const used = num((avail as any)?.used_by_this_event, 0);
  const availableInTerm = num((avail as any)?.available_in_term, 0);
  const maxAdd = num((avail as any)?.max_add, 0);
  const maxSet = num((avail as any)?.max_set, used + maxAdd);
  const reserved = num((avail as any)?.reserved_quantity, 0);
  const total = num((avail as any)?.total_quantity, 0);

  return { used, availableInTerm, maxAdd, maxSet, reserved, total };
}

export function AddEquipmentModal({
  isOpen,
  onClose,
  onAdd,
  availableEquipment,
  availableKits,
  availabilityByKey,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (
    selectedItems: Array<{ id: string; quantity: number; notes: string; type: ItemType }>,
  ) => Promise<void>;
  availableEquipment: any[];
  availableKits: any[];
  availabilityByKey: Record<string, AvailabilityUI>;
}) {
  const [selectedItems, setSelectedItems] = useState<Record<string, SelectedRow>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [showKits, setShowKits] = useState(true);
  const [showItems, setShowItems] = useState(true);

  // UI: true = ukrywaj niedostępne, false = pokazuj wyszarzone
  const HIDE_UNAVAILABLE = true;

  const getAvail = (type: ItemType, id: string) => availabilityByKey?.[keyOf(type, id)];
  const getMaxAdd = (type: ItemType, id: string) => getLimits(getAvail(type, id)).maxAdd;

  // ✅ gdy odświeży się availability — przytnij qty dla zaznaczonych do maxAdd
  useEffect(() => {
    if (!isOpen) return;

    setSelectedItems((prev) => {
      let changed = false;
      const next: Record<string, SelectedRow> = { ...prev };

      for (const [k, row] of Object.entries(prev)) {
        if (!row?.checked) continue;

        const [type, ...rest] = k.split('-');
        const id = rest.join('-');
        const maxAdd = getMaxAdd(type as ItemType, id);

        // jeśli stało się niedostępne
        if (maxAdd <= 0) {
          next[k] = { ...row, checked: false, quantity: 1 };
          changed = true;
          continue;
        }

        const safe = clampInt(row.quantity, 1, maxAdd);
        if (safe !== row.quantity) {
          next[k] = { ...row, quantity: safe };
          changed = true;
        }
      }

      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityByKey, isOpen]);

  const kitsFiltered = useMemo(() => {
    const q = normalize(searchTerm);

    return (availableKits || [])
      .filter((k) => normalize(k?.name).includes(q))
      .filter((k) => {
        const maxAdd = getMaxAdd('kit', k.id);
        return HIDE_UNAVAILABLE ? maxAdd > 0 : true;
      });
  }, [availableKits, searchTerm, availabilityByKey]); // availabilityByKey -> bo maxAdd

  const itemsFiltered = useMemo(() => {
    const q = normalize(searchTerm);

    return (availableEquipment || [])
      .filter((i) => normalize(i?.name).includes(q) || normalize(i?.category?.name).includes(q))
      .filter((i) => {
        const maxAdd = getMaxAdd('item', i.id);
        return HIDE_UNAVAILABLE ? maxAdd > 0 : true;
      });
  }, [availableEquipment, searchTerm, availabilityByKey]);

  const selectedCount = useMemo(
    () => Object.values(selectedItems).filter((it) => it.checked).length,
    [selectedItems],
  );

  const resetAndClose = () => {
    setSelectedItems({});
    setSearchTerm('');
    onClose();
  };

  const handleToggle = (type: ItemType, id: string) => {
    const k = keyOf(type, id);
    const { maxAdd } = getLimits(getAvail(type, id));
    if (maxAdd <= 0) return;

    setSelectedItems((prev) => {
      const isChecked = !!prev[k]?.checked;
      const nextChecked = !isChecked;

      const prevQty = prev[k]?.quantity ?? 1;
      const safeQty = clampInt(prevQty, 1, maxAdd);

      return {
        ...prev,
        [k]: {
          checked: nextChecked,
          quantity: safeQty,
          notes: prev[k]?.notes ?? '',
          type,
        },
      };
    });
  };

  const handleQuantityChange = (type: ItemType, id: string, quantity: number) => {
    const k = keyOf(type, id);
    const { maxAdd } = getLimits(getAvail(type, id));
    const safe = clampInt(quantity, 1, Math.max(1, maxAdd));

    setSelectedItems((prev) => ({
      ...prev,
      [k]: {
        ...prev[k],
        checked: true,
        type,
        quantity: safe,
        notes: prev[k]?.notes ?? '',
      },
    }));
  };

  const handleNotesChange = (type: ItemType, id: string, notes: string) => {
    const k = keyOf(type, id);

    setSelectedItems((prev) => ({
      ...prev,
      [k]: {
        ...prev[k],
        checked: true,
        type,
        notes,
      },
    }));
  };

  const handleSubmit = async () => {
    const selected = Object.entries(selectedItems)
      .filter(([_, v]) => v.checked)
      .map(([k, v]) => {
        const [type, ...rest] = k.split('-');
        const id = rest.join('-');
        return { id, quantity: v.quantity, notes: v.notes, type: type as ItemType };
      });

    if (selected.length === 0) {
      alert('Zaznacz przynajmniej jedną pozycję');
      return;
    }

    for (const s of selected) {
      const maxAdd = getMaxAdd(s.type, s.id);

      if (maxAdd <= 0) {
        alert(
          'Część pozycji stała się niedostępna w tym terminie. Zamknij i otwórz modal ponownie.',
        );
        return;
      }
      if (s.quantity > maxAdd) {
        alert(
          `Nie można dodać ${s.quantity} szt. — możesz jeszcze dodać maksymalnie: ${maxAdd} szt.`,
        );
        return;
      }
    }

    await onAdd(selected);
    resetAndClose();
  };

  if (!isOpen) return null;

  const renderUnavailableOverlay = (text: string) => (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
      <span className="rounded bg-black/60 px-3 py-1 text-xs font-medium text-[#e5e4e2]/80">
        {text}
      </span>
    </div>
  );

  const Header = () => (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj sprzęt</h2>
        {selectedCount > 0 && (
          <p className="mt-1 text-sm text-[#d3bb73]">Zaznaczono: {selectedCount}</p>
        )}
      </div>

      <button onClick={resetAndClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
        <X className="h-5 w-5" />
      </button>
    </div>
  );

  const Tabs = () => (
    <div className="mb-4 flex gap-4">
      <button
        onClick={() => setShowKits(!showKits)}
        className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
          showKits ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/60'
        }`}
      >
        Zestawy ({kitsFiltered.length})
      </button>

      <button
        onClick={() => setShowItems(!showItems)}
        className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
          showItems ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/60'
        }`}
      >
        Pojedynczy sprzęt ({itemsFiltered.length})
      </button>
    </div>
  );

  const Footer = () => (
    <div className="mt-4 flex gap-3 border-t border-[#d3bb73]/10 pt-4">
      <button
        onClick={handleSubmit}
        disabled={selectedCount === 0}
        className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Dodaj zaznaczone ({selectedCount})
      </button>

      <button
        onClick={resetAndClose}
        className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
      >
        Anuluj
      </button>
    </div>
  );

  const renderRow = (type: ItemType, entity: any, title: string, subtitle?: string) => {
    const id = entity.id;
    const k = keyOf(type, id);

    const avail = getAvail(type, id);
    const { used, availableInTerm, maxAdd, reserved, total } = getLimits(avail);

    const checked = !!selectedItems[k]?.checked;
    const qty = selectedItems[k]?.quantity ?? 1;

    const disabled = !HIDE_UNAVAILABLE && maxAdd <= 0;

    return (
      <div
        key={id}
        className={`relative rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4 ${disabled ? 'opacity-50' : ''}`}
      >
        {!HIDE_UNAVAILABLE &&
          disabled &&
          renderUnavailableOverlay('Brak możliwości dodania w tym terminie')}

        <label
          className={`flex items-start gap-3 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <input
            type="checkbox"
            disabled={disabled}
            checked={checked}
            onChange={() => handleToggle(type, id)}
            className="mt-1 h-4 w-4 rounded border-[#d3bb73]/20 text-[#d3bb73] focus:ring-[#d3bb73]"
          />

          <div className="flex-1">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate font-medium text-[#e5e4e2]">{title}</div>
                {subtitle && <div className="mt-1 text-xs text-[#e5e4e2]/60">{subtitle}</div>}
              </div>

              <div className="shrink-0 text-right text-xs">
                <div className="font-medium text-[#d3bb73]">{maxAdd} możesz jeszcze dodać</div>

                {/* ✅ dodatkowy kontekst (opcjonalny, ale mega pomaga) */}
                <div className="mt-1 text-[11px] text-[#e5e4e2]/45">
                  pula w terminie: {availableInTerm} • w evencie: {used}
                </div>
                <div className="mt-0.5 text-[11px] text-[#e5e4e2]/35">
                  zarezerw.: {reserved} • magazyn: {total}
                </div>
              </div>
            </div>
          </div>
        </label>

        {checked && !disabled && (
          <div className="ml-7 mt-3 space-y-3">
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-3">
              <label className="mb-2 block text-xs text-[#e5e4e2]/60">
                Ilość ({type === 'kit' ? 'zestawów' : 'jednostek'})
              </label>

              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={maxAdd || 1}
                  value={Math.min(qty, maxAdd || 1)}
                  onChange={(e) =>
                    handleQuantityChange(type, id, parseInt(e.target.value || '1', 10) || 1)
                  }
                  className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2.5 text-base text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50"
                />

                <div className="text-right">
                  <div className="text-sm font-medium text-[#d3bb73]">
                    {Math.min(qty, maxAdd || 1)} / {maxAdd || 1}
                  </div>
                  <div className="text-xs text-[#e5e4e2]/40">możesz jeszcze dodać</div>
                </div>
              </div>
            </div>

            <input
              type="text"
              value={selectedItems[k]?.notes || ''}
              onChange={(e) => handleNotesChange(type, id, e.target.value)}
              placeholder="Notatki (opcjonalnie)"
              className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <Header />
        <div className="mb-4">
          <input
            type="text"
            placeholder="Szukaj sprzętu lub zestawu..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          />
        </div>
        <Tabs />

        <div className="flex-1 space-y-4 overflow-y-auto pr-2">
          {showKits && kitsFiltered.length > 0 && (
            <div>
              <h3 className="sticky top-0 mb-3 bg-[#0f1119] py-2 text-sm font-medium text-[#e5e4e2]/80">
                🎁 Zestawy
              </h3>

              <div className="space-y-2">
                {kitsFiltered.map((kit) => renderRow('kit', kit, kit?.name || 'Zestaw'))}
              </div>
            </div>
          )}

          {showItems && itemsFiltered.length > 0 && (
            <div>
              <h3 className="sticky top-0 mb-3 bg-[#0f1119] py-2 text-sm font-medium text-[#e5e4e2]/80">
                📦 Pojedynczy sprzęt
              </h3>

              <div className="space-y-2">
                {itemsFiltered.map((item) =>
                  renderRow(
                    'item',
                    item,
                    item?.name || 'Sprzęt',
                    item?.category?.name || 'Brak kategorii',
                  ),
                )}
              </div>
            </div>
          )}

          {kitsFiltered.length === 0 && itemsFiltered.length === 0 && (
            <div className="py-12 text-center text-[#e5e4e2]/60">
              Brak sprzętu, który możesz jeszcze dodać w tym terminie
            </div>
          )}
        </div>

        <Footer />
      </div>
    </div>
  );
}
