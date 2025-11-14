'use client';
import { useField } from 'formik';
import clsx from 'clsx';

type Option = {
  value: string | number;
  label: string;
};

type FormikSelectProps = {
  name: string;
  label?: string;
  placeholder?: string;
  options: Option[];
  required?: boolean;
  disabled?: boolean;
  className?: string;
};

export function FormikSelect({
  name,
  label,
  placeholder = 'Wybierz...',
  options,
  required = false,
  disabled = false,
  className,
}: FormikSelectProps) {
  const [field, meta] = useField<string | number>(name);

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={name}
          className={clsx(
            'block text-sm mb-2',
            disabled ? 'text-[#e5e4e2]/40' : 'text-[#e5e4e2]/60'
          )}
        >
          {label} {required && <span className="text-red-400">*</span>}
        </label>
      )}

      <select
        id={name}
        {...field}
        disabled={disabled}
        className={clsx(
          'w-full rounded-lg border px-4 py-2 focus:outline-none transition-colors',
          disabled
            ? 'bg-[#0f1119]/70 text-[#e5e4e2]/60 cursor-not-allowed border-[#d3bb73]/10'
            : 'bg-[#0f1119] text-[#e5e4e2] border-[#d3bb73]/10 hover:border-[#d3bb73]/20 focus:border-[#d3bb73]/30',
          className
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {meta.touched && meta.error && (
        <div className="mt-1 text-xs text-red-400">{meta.error}</div>
      )}
    </div>
  );
}