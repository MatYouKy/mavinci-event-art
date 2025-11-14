// components/equipment/TechnicalFields.tsx
import { useFormikContext } from 'formik';
import { CategoryFieldSchemas, FieldSchema } from '../../config/categoryFields';

export function TechnicalFields({ mainKey }: { mainKey: string }) {
  const { values, handleChange, setFieldValue } = useFormikContext<any>();
  const fields = CategoryFieldSchemas[mainKey] ?? [];

  const renderField = (f: FieldSchema) => {
    const common = {
      name: f.key,
      value: values[f.key] ?? '',
      onChange: handleChange,
      className:
        'w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]',
    };

    switch (f.kind) {
      case 'number':
        return <input type="number" step={f.step ?? 1} min={f.min} {...common} />;
      case 'boolean':
        return (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!values[f.key]}
              onChange={(e) => setFieldValue(f.key, e.target.checked)}
            />
            <span>{f.label}</span>
          </label>
        );
      case 'select':
        return (
          <select {...common}>
            <option value="">{f.label}</option>
            {f.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      default:
        return <input type="text" {...common} />;
    }
  };

  if (!fields.length) return null;

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Parametry techniczne</h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key}>
            {f.kind !== 'boolean' && (
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                {f.label}
                {f.required && ' *'}
              </label>
            )}
            {renderField(f)}
          </div>
        ))}
      </div>
    </div>
  );
}
