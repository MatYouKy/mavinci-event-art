'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';

type EquipmentConflictRow = {
  item_type: 'item' | 'kit';
  item_id: string;
  item_name: string;
  required_qty: number;
  total_qty: number;
  reserved_qty: number;
  available_qty: number;
  shortage_qty: number;
  conflict_until: string | null;
  conflicts: any[];
  alternatives: Array<{
    item_type: 'item' | 'kit';
    item_id: string;
    item_name: string;
    total_qty: number;
    reserved_qty: number;
    available_qty: number;
    warehouse_category_id?: string;
  }>;
};

type SelectedAlt = Record<string, { item_id: string; qty: number }>;

type EquipmentSubstitutions = Record<
  string,
  {
    qty: number;
    from_item_type: 'item' | 'kit';
    from_item_id: string;
    to_item_type: 'item' | 'kit';
    to_item_id: string;
  }
>;

interface EquipmentConflictsModalProps<TOfferItem = any> {
  open: boolean;
  onClose: () => void;

  conflicts: EquipmentConflictRow[];
  offerItems: TOfferItem[];

  selectedAlt: SelectedAlt;
  setSelectedAlt: React.Dispatch<React.SetStateAction<SelectedAlt>>;

  equipmentSubstitutions: EquipmentSubstitutions;
  setEquipmentSubstitutions: React.Dispatch<React.SetStateAction<EquipmentSubstitutions>>;

  checkCartConflicts: (items?: TOfferItem[]) => Promise<any>;
}

export default function EquipmentConflictsModal<TOfferItem = any>({
  open,
  onClose,
  conflicts,
  offerItems,
  selectedAlt,
  setSelectedAlt,
  equipmentSubstitutions,
  setEquipmentSubstitutions,
  checkCartConflicts,
}: EquipmentConflictsModalProps<TOfferItem>) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Konflikt dostępności sprzętu (${conflicts.length})`}
    >
      {/* ✅ absolutnie kluczowe: nie pozwól klikom z treści zamykać modala */}
      <div
        className="space-y-6"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-orange-500/10 p-3">
            <AlertTriangle className="h-6 w-6 text-orange-400" />
          </div>

          <div className="min-w-0">
            <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">
              Produkt wymaga sprzętu, którego brakuje w terminie eventu.
            </h3>
            <p className="text-sm text-[#e5e4e2]/60">
              Możesz: (1) dodać mimo to, (2) zmienić produkt, albo (3) zamienić sprzęt na
              alternatywę tylko w tej ofercie.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {conflicts.map((c: any, idx: number) => (
            <div key={idx} className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate text-base font-medium text-[#e5e4e2]">{c.item_name}</div>

                  <div className="mt-1 text-sm text-[#e5e4e2]/60">
                    Wymagane: <b className="text-[#e5e4e2]">{c.required_qty}</b> • Dostępne:{' '}
                    <b className="text-[#e5e4e2]">{c.available_qty}</b> • Brak:{' '}
                    <b className="text-orange-300">{c.shortage_qty}</b>
                  </div>

                  {c.conflicts?.length > 0 && (
                    <div className="mt-2 space-y-1 text-xs text-[#e5e4e2]/55">
                      {c.conflicts.map((x: any, i: number) => (
                        <div key={i}>
                          Zajęte: <b>{new Date(x.overlap_start).toLocaleString('pl-PL')}</b> →{' '}
                          <b>{new Date(x.overlap_end).toLocaleString('pl-PL')}</b>
                          {x.event_name ? <> • {x.event_name}</> : null}
                        </div>
                      ))}
                    </div>
                  )}

                  {c.conflict_until && (
                    <div className="mt-2 text-xs text-[#d3bb73]">
                      Najbliżej wolne od: {new Date(c.conflict_until).toLocaleString('pl-PL')}
                    </div>
                  )}
                </div>

                <div className="w-[320px] shrink-0">
                  <div className="mb-2 text-xs uppercase tracking-wider text-[#e5e4e2]/40">
                    Alternatywy
                  </div>

                  {(c.alternatives || []).length === 0 ? (
                    <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 text-sm text-[#e5e4e2]/60">
                      Brak sugestii (dodamy je po stronie backendu).
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {c.alternatives.map((a: any) => {
                        const subKey = `${c.item_type}|${c.item_id}`;
                        const selected = equipmentSubstitutions[subKey];
                        const isSelected = selected?.to_item_id === a.item_id;

                        const key = `${c.item_type}|${c.item_id}`;
                        const picked = selectedAlt[key]?.item_id === a.item_id;

                        return (
                          <div
                            key={`${a.item_type}-${a.item_id}`}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                (e.currentTarget as HTMLDivElement).click();
                              }
                            }}
                            onClick={() => {
                              // ✅ toggle: klik drugi raz = odznacz
                              setSelectedAlt((prev) => {
                                if (prev[key]?.item_id === a.item_id) {
                                  const next = { ...prev };
                                  delete next[key];
                                  return next;
                                }
                                return {
                                  ...prev,
                                  [key]: {
                                    item_id: a.item_id,
                                    qty: prev[key]?.qty ?? c.shortage_qty ?? 1,
                                  },
                                };
                              });
                              // ❌ NIE przeliczamy konfliktów tutaj — tylko na "Zastosuj"
                            }}
                            className={`w-full rounded-lg border px-3 py-2 text-left text-sm cursor-pointer ${
                              picked
                                ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                                : 'border-[#d3bb73]/15 bg-[#0f1119]'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="font-medium">{a.item_name}</div>
                              {isSelected && <span className="text-xs text-[#d3bb73]">Wybrane ✓</span>}
                            </div>

                            <div className="text-xs text-[#e5e4e2]/55">
                              Dostępne: {a.available_qty} • Zarezerw.: {a.reserved_qty} • Magazyn: {a.total_qty}
                            </div>

                            {picked && (
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedAlt((prev) => {
                                      const nextQty = Math.max(1, (prev[key]?.qty ?? 1) - 1);
                                      return { ...prev, [key]: { item_id: a.item_id, qty: nextQty } };
                                    });
                                  }}
                                  className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1"
                                >
                                  -
                                </button>

                                <input
                                  type="number"
                                  min={1}
                                  value={selectedAlt[key]?.qty ?? 1}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    const nextQty = Math.max(1, parseInt(e.target.value) || 1);
                                    setSelectedAlt((prev) => ({
                                      ...prev,
                                      [key]: { item_id: a.item_id, qty: nextQty },
                                    }));
                                  }}
                                  className="w-20 rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-center"
                                />

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedAlt((prev) => {
                                      const nextQty = (prev[key]?.qty ?? 1) + 1;
                                      return { ...prev, [key]: { item_id: a.item_id, qty: nextQty } };
                                    });
                                  }}
                                  className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1"
                                >
                                  +
                                </button>
                              </div>
                            )}

                            {picked && (
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={async (e) => {
                                    e.stopPropagation();

                                    const qty = selectedAlt[key]?.qty ?? c.shortage_qty ?? 1;

                                    setEquipmentSubstitutions((prev) => ({
                                      ...prev,
                                      [subKey]: {
                                        from_item_type: c.item_type,
                                        from_item_id: c.item_id,
                                        to_item_type: a.item_type,
                                        to_item_id: a.item_id,
                                        qty,
                                      },
                                    }));

                                    // ✅ dopiero tu przeliczamy, bo to jest "commit"
                                    await checkCartConflicts(offerItems);
                                  }}
                                  className="rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2 hover:border-[#d3bb73]/30"
                                >
                                  Zastosuj
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/5"
          >
            Zamknij
          </button>

          <button
            type="button"
            onClick={() => {
              // ✅ pozwalasz “Dodaj mimo to” — ale decyzja należy do Ciebie, czy tu coś zapisujesz
              onClose();
            }}
            className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            Dodaj mimo to
          </button>
        </div>
      </div>
    </Modal>
  );
}