// components/equipment/CommonFields.tsx
import { useFormikContext } from 'formik';

export function CommonFields({
  categories,
  subcategories,
  onCategoryChange,
  onThumbnailUpload,
}: {
  categories: { id: string; name: string; level: number }[];
  subcategories: { id: string; name: string; parent_id: string | null }[];
  onCategoryChange: (categoryId: string) => void;
  onThumbnailUpload: (file: File) => Promise<void>;
}) {
  const { values, handleChange, setFieldValue, touched, errors } = useFormikContext<any>();

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Podstawowe informacje</h3>

      {/* Kategoria */}
      <div className="mb-6">
        <label className="mb-2 block text-sm text-[#e5e4e2]/60">
          Kategoria <span className="text-red-400">*</span>
        </label>
        <select
          name="category_id"
          value={values.category_id}
          onChange={(e) => {
            handleChange(e);
            onCategoryChange(e.target.value);
          }}
          required
          className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-3 text-[#e5e4e2]"
        >
          <option value="">Wybierz kategorię sprzętu</option>
          {categories
            .filter((c) => c.level === 1)
            .map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
        </select>
        {touched.category_id && errors.category_id && (
          <p className="mt-1 text-xs text-red-400">{String(errors.category_id)}</p>
        )}
      </div>

      {/* Podkategoria */}
      {!!subcategories.length && (
        <div className="mb-6">
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Podkategoria</label>
          <select
            name="subcategory_id"
            value={values.subcategory_id}
            onChange={handleChange}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-3 text-[#e5e4e2]"
          >
            <option value="">Wybierz podkategorię (opcjonalnie)</option>
            {subcategories.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Nazwa, marka, model */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa sprzętu *</label>
          <input
            name="name"
            value={values.name}
            onChange={handleChange}
            required
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Marka</label>
          <input
            name="brand"
            value={values.brand}
            onChange={handleChange}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Model</label>
          <input
            name="model"
            value={values.model}
            onChange={handleChange}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
          <textarea
            name="description"
            value={values.description}
            onChange={handleChange}
            rows={3}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
          />
        </div>

        {/* Miniaturka */}
        <div className="md:col-span-2">
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Miniaturka</label>
          {values.thumbnail_url ? (
            <div className="flex items-center gap-4">
              <img src={values.thumbnail_url} className="h-24 w-24 rounded-lg object-cover" />
              <button
                type="button"
                onClick={() => setFieldValue('thumbnail_url', '')}
                className="text-sm text-red-400 hover:text-red-300"
              >
                Usuń
              </button>
            </div>
          ) : (
            <label className="relative block cursor-pointer">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.currentTarget.files?.[0];
                  if (!f) return;
                  await onThumbnailUpload(f);
                }}
              />
              <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-8 text-[#e5e4e2]/60 hover:border-[#d3bb73]/30">
                <span>Kliknij aby wybrać zdjęcie</span>
              </div>
            </label>
          )}
        </div>

        {/* Instrukcja */}
        <div className="md:col-span-2">
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Instrukcja obsługi (URL)</label>
          <input
            name="user_manual_url"
            value={values.user_manual_url}
            onChange={handleChange}
            type="url"
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
          />
        </div>
      </div>
    </div>
  );
}
