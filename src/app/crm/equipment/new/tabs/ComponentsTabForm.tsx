// src/app/crm/equipment/new/tabs/ComponentsTab.tsx
'use client';
import { FieldArray, useFormikContext } from 'formik';
import { Plus, Trash2 } from 'lucide-react';

export function ComponentsTabForm() {
  const { values } = useFormikContext<any>();
  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Skład zestawu</h3>
        <FieldArray
          name="components"
          render={({ push }) => (
            <button
              type="button"
              onClick={() => push({ component_name: '', quantity: 1, description: '', is_included: true })}
              className="flex items-center gap-2 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
            >
              <Plus className="h-4 w-4" /> Dodaj komponent
            </button>
          )}
        />
      </div>

      <FieldArray
        name="components"
        render={({ remove, replace }) => (
          <div className="space-y-3">
            {values.components.length === 0 ? (
              <p className="py-4 text-center text-sm text-[#e5e4e2]/40">Brak komponentów.</p>
            ) : (
              values.components.map((c: any, idx: number) => (
                <div key={idx} className="flex items-start gap-3 rounded-lg bg-[#0f1119] p-3">
                  <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-3">
                    <input
                      value={c.component_name}
                      onChange={(e) => replace(idx, { ...c, component_name: e.target.value })}
                      className="rounded border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                      placeholder="Nazwa"
                    />
                    <input
                      type="number"
                      value={c.quantity}
                      onChange={(e) => replace(idx, { ...c, quantity: parseInt(e.target.value) || 1 })}
                      className="rounded border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                      placeholder="Ilość"
                      min={1}
                    />
                    <input
                      value={c.description}
                      onChange={(e) => replace(idx, { ...c, description: e.target.value })}
                      className="rounded border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                      placeholder="Opis (opcjonalnie)"
                    />
                  </div>
                  <button type="button" onClick={() => remove(idx)} className="p-2 text-red-400 hover:text-red-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      />
    </div>
  );
}