'use client';

import { useEffect, useMemo } from 'react';
import { useFormikContext, getIn } from 'formik';
import {
  EquipmentMainCategory,
  EquipmentMainCategoryLabels,
} from '../../types/equipment.types';
import { normalizeSubcategories } from '../../helpers/category';

type Props = {
  nameCategory?: string;
  nameSubcategory?: string;
  labelCategory?: string;
  labelSubcategory?: string;
  required?: boolean;
  disabled?: boolean;
  /** 🔹 Nowa flaga — tryb edycji */
  editMode?: boolean;
};

export function CategorySelectorBar({
  nameCategory = 'category',
  nameSubcategory = 'subcategory',
  labelCategory = 'Kategoria główna',
  labelSubcategory = 'Podkategoria',
  required = false,
  disabled = false,
  editMode = true,
}: Props) {
  const { values, setFieldValue } = useFormikContext<any>();

  const main: EquipmentMainCategory | '' =
    (getIn(values, nameCategory) as EquipmentMainCategory | '') || '';

  const sub: string = getIn(values, nameSubcategory) || '';

  const subsMap = useMemo(() => normalizeSubcategories(main), [main]);
  const subKeys = useMemo(() => Object.keys(subsMap), [subsMap]);

  useEffect(() => {
    if (!main && sub) {
      setFieldValue(nameSubcategory, '');
      return;
    }
    if (main && sub && !subKeys.includes(sub)) {
      setFieldValue(nameSubcategory, '');
    }
  }, [main, sub, subKeys, nameSubcategory, setFieldValue]);

  const categoryAsterisk = required ? (
    <span className="text-red-400">*</span>
  ) : null;

  const disabledSub = disabled || !main || subKeys.length === 0;

  // 🔸 Styl tekstu w trybie podglądu
  const readOnlyTextClass =
    'rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]/60 px-4 py-3 text-base text-[#e5e4e2]/70';

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* --- KATEGORIA --- */}
      <div>
        <label className="mb-2 block text-sm text-[#e5e4e2]/60">
          {labelCategory} {categoryAsterisk}
        </label>

        {editMode ? (
          <select
            value={main}
            onChange={(e) => setFieldValue(nameCategory, e.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-3 text-base text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-60"
          >
            <option value="">
              {disabled ? 'Brak' : 'Wybierz kategorię sprzętu'}
            </option>
            {Object.entries(EquipmentMainCategoryLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          <div className={readOnlyTextClass}>
            {main ? EquipmentMainCategoryLabels[main] : '—'}
          </div>
        )}
      </div>

      {/* --- PODKATEGORIA --- */}
      <div>
        <label className="mb-2 block text-sm text-[#e5e4e2]/60">
          {labelSubcategory}
        </label>

        {editMode ? (
          <select
            value={sub}
            onChange={(e) => setFieldValue(nameSubcategory, e.target.value)}
            disabled={disabledSub}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-3 text-base text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-60"
          >
            <option value="">
              {!main
                ? 'Najpierw wybierz kategorię'
                : subKeys.length
                ? 'Wybierz podkategorię (opcjonalnie)'
                : 'Brak podkategorii'}
            </option>
            {subKeys.map((key) => (
              <option key={key} value={key}>
                {subsMap[key]}
              </option>
            ))}
          </select>
        ) : (
          <div className={readOnlyTextClass}>
            {sub ? subsMap[sub] ?? sub : '—'}
          </div>
        )}
      </div>
    </div>
  );
}