'use client';

import { useMemo } from 'react';
import { useFormikContext } from 'formik';
import { Upload, Package } from 'lucide-react';
import EquipmentSkillRequirementsPanel from '@/components/crm/EquipmentSkillRequirementsPanel';
import { EquipmentMainCategoryLabels } from '../../types/equipment.types';
import { CategorySelectorBar } from '../../new/parts/CategorySelectorBar';
import { FormikInput } from '@/components/UI/Formik/FormikInput';
import { FormikSelect } from '@/components/UI/Formik/FormikSelect';
import { FormikTextarea } from '@/components/UI/Formik/FormikTextarea';

type WarehouseCategory = { id: string; name: string; level?: number; parent_id?: string | null };
type StorageLocation = { id: string; name: string };

type Props = {
  equipment: any; // pełny obiekt z RTK (używany m.in. do alt/labeli)
  isEditing: boolean;
  storageLocations?: StorageLocation[];
};

export function DetailsTab({ equipment, isEditing, storageLocations = [] }: Props) {
  const { values, getFieldProps, setFieldValue } = useFormikContext<any>();
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Podstawowe informacje</h3>
          <div className="mt-6 space-y-4">
            <div>
              <div className="mb-1 text-sm text-[#e5e4e2]/60">Kategoria</div>
              <CategorySelectorBar editMode={isEditing} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <FormikInput
              name="name"
              label="Nazwa"
              disabled={!isEditing}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-70"
            />
            <div className="flex gap-2">
              <FormikInput
                name="brand"
                label="Marka"
                disabled={!isEditing}
                className="flex-1 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-70"
              />
              <FormikInput
                name="model"
                label="Model"
                disabled={!isEditing}
                className="flex-1 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-70"
              />
              <FormikSelect
                name="storage_location_id"
                label="Lokalizacja magazynowa"
                disabled={!isEditing}
                className=" rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-70"
                options={storageLocations.map((loc) => ({ value: loc.id, label: loc.name }))}
              />
            </div>

            <FormikTextarea
              name="description"
              label="Opis"
              rows={2}
              disabled={!isEditing}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-70"
            />
            <FormikTextarea
              name="notes"
              label="Notatki"
              rows={1}
              disabled={!isEditing}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none disabled:opacity-70"
            />
          </div>
        </div>
      </div>
      <div className="lg:col-span-1">
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          {/* Kategoria */}
          {/* <EquipmentSkillRequirementsPanel equipmentId={equipment.id} canEdit={isEditing} /> */}
        </div>
      </div>
    </div>
  );
}
