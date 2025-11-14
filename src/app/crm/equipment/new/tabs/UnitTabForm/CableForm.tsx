'use client';

import { useFormikContext } from 'formik';
import { IStorageLocation } from '../../../types/equipment.types';
import { FormikInput } from '@/components/UI/Formik/FormikInput';
import { FormikSelect } from '@/components/UI/Formik/FormikSelect';


type CableFormProps = {
  locations: IStorageLocation[];
};

export default function CableForm({ locations }: CableFormProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <FormikInput
        name="quantity.total_quantity"
        label="Ilość (szt.)"
        type="number"
        className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
      />

      <FormikInput
        name="quantity.available_quantity"
        label="Dostępna ilość (szt.)"
        type="number"
        className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
        required
      />    

      <FormikSelect
        name="quantity.units.storage_location_id"
        label="Lokalizacja"
        options={locations.map((l) => ({ value: l._id, label: l.name }))}
        className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
      />

      {/* opcjonalne, jeśli chcesz dokładniejsze miejsce: regał/półka */}
    </div>
  );
}