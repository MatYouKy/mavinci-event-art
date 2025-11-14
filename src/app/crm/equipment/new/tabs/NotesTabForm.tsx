'use client';

import { useFormikContext } from 'formik';

export function NotesTabForm() {
  const { values, setFieldValue } = useFormikContext<any>();

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Notatki</h3>

      <textarea
        rows={5}
        value={values.notes ?? ''}
        onChange={(e) => setFieldValue('notes', e.target.value)}
        className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
        placeholder="Dodatkowe informacje, uwagi serwisowe, rekomendacje użycia..."
      />

      {/* Jeśli chcesz tu rozwinąć wymagane/rekomendowane umiejętności z Twoich typów:
         - dodaj FieldArray na values.details.requiredSkills / recommendedSkills
         - lub osobną sekcję z Autocomplete do IExtraSkills[]
      */}
    </div>
  );
}