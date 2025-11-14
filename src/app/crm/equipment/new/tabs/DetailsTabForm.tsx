'use client';
import { useFormikContext } from 'formik';
import { EquipmentMainCategory, EquipmentMainCategoryLabels, EquipmentCategories } from '../../types/equipment.types';

export function DetailsTabForm() {
  const { values, setFieldValue } = useFormikContext<any>();
  const main: EquipmentMainCategory | '' = values.category;

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Podstawowe informacje</h3>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa *</label>
          <input
            value={values.name}
            onChange={(e) => setFieldValue('name', e.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Marka</label>
          <input
            value={values.brand}
            onChange={(e) => setFieldValue('brand', e.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kategoria *</label>
          <select
            value={values.category}
            onChange={(e) => {
              setFieldValue('category', e.target.value);
              setFieldValue('subcategory', '');
              // reset pól warunkowych, gdy zmienisz main
              if (e.target.value === 'cables') {
                setFieldValue('technical.cable', { length_meters: '', connector_in: '', connector_out: '' });
                setFieldValue('technical.weight', null);
                setFieldValue('technical.height', null);
                setFieldValue('technical.width',  null);
                setFieldValue('technical.length', null);
              } else {
                setFieldValue('technical.cable', undefined);
              }
            }}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
          >
            <option value="">Wybierz kategorię</option>
            {Object.entries(EquipmentMainCategoryLabels).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Podkategoria</label>
          <select
            value={values.subcategory}
            onChange={(e) => setFieldValue('subcategory', e.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
            disabled={!main}
          >
            <option value="">Wybierz podkategorię</option>
            {main &&
              EquipmentCategories[main].map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
          <textarea
            rows={3}
            value={values.details.desciption}
            onChange={(e) => setFieldValue('details.desciption', e.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
          />
        </div>
      </div>
    </div>
  );
}