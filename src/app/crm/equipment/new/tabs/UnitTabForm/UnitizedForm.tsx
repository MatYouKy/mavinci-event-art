'use client';

import { FieldArray, useFormikContext } from 'formik';
import { useMemo } from 'react';
import { Plus, Trash2, Copy, Upload } from 'lucide-react';
import { uploadImage } from '@/lib/storage';
import { IStorageLocation } from '../../../types/equipment.types';
import { DatePickerField } from '@/components/UI/DatePicker/DatePickerField';

export type DraftUnitStatus = 'available' | 'damaged' | 'in_service' | 'retired';

type DraftUnit = {
  id: string;
  unit_serial_number: string;
  status: DraftUnitStatus;
  location_id: string;
  condition_notes: string;
  purchase_date: string;
  last_service_date: string;
  estimated_repair_date: string;
  thumbnail_url: string;
};

type Location = { id: string; name: string };

type UnitizedFormProps = {
  /** Lista lokalizacji do selecta */
  locations: IStorageLocation[];
};

/**
 * Komponent z formularzem JEDNOSTEK (unitized)
 * - zakłada, że wartości Formika zawierają:
 *   values.unitsDraft: DraftUnit[]
 *   values.name, values.quantity?.storage_location_id, values.purchase?.purchase_date
 */
export default function UnitizedForm({ locations }: UnitizedFormProps) {
  const { values, setFieldValue } = useFormikContext<any>();
  const unitsDraft: DraftUnit[] = useMemo(() => values.unitsDraft ?? [], [values.unitsDraft]);

  const addUnit = (push: (v: DraftUnit) => void) => {
    push({
      id: `tmp-${crypto.randomUUID()}`,
      unit_serial_number: '',
      status: 'available',
      location_id: '',
      condition_notes: '',
      purchase_date: '',
      last_service_date: '',
      estimated_repair_date: '',
      thumbnail_url: '',
    });
  };

  const duplicateUnit = (idx: number, replace: (i: number, v: DraftUnit) => void) => {
    const u = unitsDraft[idx];
    if (!u) return;
    replace(idx + 1, {
      ...u,
      id: `tmp-${crypto.randomUUID()}`,
      unit_serial_number: u.unit_serial_number ? `${u.unit_serial_number}-DUP` : '',
      condition_notes: u.condition_notes ? `${u.condition_notes} [DUPLIKAT]` : '',
    });
  };

  const bulkGenerateUnits = (count: number, push: (v: DraftUnit) => void) => {
    if (!Number.isFinite(count) || count <= 0) return;
    const base = (values.name || 'UNIT').toString().slice(0, 10).toUpperCase().replace(/\s+/g, '');
    const startIndex = (unitsDraft?.length ?? 0) + 1;
    Array.from({ length: count }).forEach((_, i) => {
      push({
        id: `tmp-${crypto.randomUUID()}`,
        unit_serial_number: `${base}-${String(startIndex + i).padStart(3, '0')}`,
        status: 'available',
        location_id: values.quantity?.storage_location_id ?? '',
        condition_notes: '',
        purchase_date: values.purchase?.purchase_date ?? '',
        last_service_date: '',
        estimated_repair_date: '',
        thumbnail_url: '',
      });
    });
  };

  const handleThumbUpload = async (
    file: File,
    idx: number,
    replace: (i: number, v: DraftUnit) => void,
  ) => {
    const u = unitsDraft[idx];
    if (!u || !file) return;
    const url = await uploadImage(file, 'equipment-units');
    replace(idx, { ...u, thumbnail_url: url });
  };

  return (
    <FieldArray
      name="unitsDraft"
      render={({ push, remove, replace }) => (
        <div className="space-y-4">
          {/* Toolbar szybkie akcje */}
          <div className="flex flex-wrap items-end gap-3">
            <button
              type="button"
              onClick={() => addUnit(push)}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              <Plus className="h-4 w-4" />
              Dodaj jednostkę
            </button>

            <div className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-2">
              <span className="text-xs text-[#e5e4e2]/60">Szybko utwórz</span>
              <input
                type="number"
                min={1}
                placeholder="np. 4"
                className="w-20 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2]"
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const v = Number((e.target as HTMLInputElement).value || 0);
                  bulkGenerateUnits(v, push);
                  (e.target as HTMLInputElement).value = '';
                }}
              />
              <span className="text-xs text-[#e5e4e2]/40">(Enter zatwierdza)</span>
            </div>
          </div>

          {/* Liczniki statusów */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {(['available', 'damaged', 'in_service', 'retired'] as DraftUnitStatus[]).map((s) => {
              const count = unitsDraft.filter((u) => u.status === s).length;
              const labelMap: Record<DraftUnitStatus, string> = {
                available: 'Dostępne',
                damaged: 'Uszkodzone',
                in_service: 'Serwis',
                retired: 'Wycofane',
              };
              const colorMap: Record<DraftUnitStatus, string> = {
                available: 'text-green-400 border-green-500/10',
                damaged: 'text-red-400 border-red-500/10',
                in_service: 'text-orange-400 border-orange-500/10',
                retired: 'text-gray-400 border-gray-500/10',
              };
              return (
                <div key={s} className={`rounded-xl border bg-[#1c1f33] p-4 ${colorMap[s]}`}>
                  <div className="mb-1 text-sm text-[#e5e4e2]/60">{labelMap[s]}</div>
                  <div className="text-2xl font-light">{count}</div>
                </div>
              );
            })}
          </div>

          {/* Lista jednostek */}
          {unitsDraft.length === 0 ? (
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] py-10 text-center text-sm text-[#e5e4e2]/50">
              Brak jednostek. Dodaj ręcznie lub użyj „Szybko utwórz”.
            </div>
          ) : (
            <div className="space-y-3">
              {unitsDraft.map((unit, idx) => (
                <div
                  key={unit.id}
                  className="rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Miniaturka */}
                    <div className="w-24 shrink-0">
                      {unit.thumbnail_url ? (
                        <img
                          src={unit.thumbnail_url}
                          alt="Miniaturka"
                          className="h-20 w-24 rounded-lg border border-[#d3bb73]/20 object-cover"
                        />
                      ) : (
                        <div className="flex h-20 w-24 items-center justify-center rounded-lg border border-dashed border-[#d3bb73]/20 text-xs text-[#e5e4e2]/40">
                          Brak zdjęcia
                        </div>
                      )}
                      <label className="mt-2 flex cursor-pointer items-center justify-center gap-1 rounded bg-[#1c1f33] px-2 py-1 text-xs text-[#e5e4e2]/80 hover:bg-[#1a2033]">
                        <Upload className="h-3 w-3" />
                        <span>Wgraj</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) await handleThumbUpload(file, idx, replace);
                          }}
                        />
                      </label>
                    </div>

                    {/* Pola */}
                    <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs text-[#e5e4e2]/60">
                          Numer seryjny
                        </label>
                        <input
                          value={unit.unit_serial_number}
                          onChange={(e) =>
                            replace(idx, { ...unit, unit_serial_number: e.target.value })
                          }
                          className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                          placeholder="SN..."
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs text-[#e5e4e2]/60">Status</label>
                        <select
                          value={unit.status}
                          onChange={(e) =>
                            replace(idx, { ...unit, status: e.target.value as DraftUnitStatus })
                          }
                          className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                        >
                          <option value="available">Dostępny</option>
                          <option value="damaged">Uszkodzony</option>
                          <option value="in_service">Serwis</option>
                          <option value="retired">Wycofany</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs text-[#e5e4e2]/60">Lokalizacja</label>
                        <select
                          value={unit.location_id}
                          onChange={(e) => replace(idx, { ...unit, location_id: e.target.value })}
                          className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                        >
                          <option value="">Brak</option>
                          {locations.map((loc) => (
                            <option key={loc._id} value={loc._id}>
                              {loc.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <DatePickerField
                          name={`unitsDraft.${idx}.purchase_date`}
                          label="Data zakupu"
                          placeholder="dd.mm.rrrr"
                          // przechowujemy 'yyyy-MM-dd', wyświetlamy 'dd.MM.yyyy'
                          storeFormat="yyyy-MM-dd"
                          displayFormat="dd.MM.yyyy"
                        />
                      </div>

                      <div>
                        <DatePickerField
                          name={`unitsDraft.${idx}.last_service_date`}
                          label="Ostatni serwis"
                          placeholder="dd.mm.rrrr"
                          storeFormat="yyyy-MM-dd"
                          displayFormat="dd.MM.yyyy"
                        />
                      </div>

                      <div>
                        <DatePickerField
                          name={`unitsDraft.${idx}.estimated_repair_date`}
                          label="Szac. dostępność"
                          placeholder="dd.mm.rrrr"
                          storeFormat="yyyy-MM-dd"
                          displayFormat="dd.MM.yyyy"
                          disabled={!(unit.status === 'damaged' || unit.status === 'in_service')}
                        />
                      </div>

                      <div className="md:col-span-3">
                        <label className="mb-1 block text-xs text-[#e5e4e2]/60">Notatki</label>
                        <textarea
                          rows={2}
                          value={unit.condition_notes}
                          onChange={(e) =>
                            replace(idx, { ...unit, condition_notes: e.target.value })
                          }
                          className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                          placeholder="Stan techniczny, usterki, naprawy..."
                        />
                      </div>
                    </div>

                    {/* Akcje */}
                    <div className="ml-2 flex shrink-0 flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => duplicateUnit(idx, replace)}
                        className="rounded-lg p-2 text-purple-400 transition-colors hover:bg-purple-500/10"
                        title="Duplikuj jednostkę"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(idx)}
                        className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-500/10"
                        title="Usuń"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    />
  );
}
