'use client';
import { useField } from 'formik';

type Props = {
  name: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  className?: string;
  disabled?: boolean;
};

export function FormikTextarea({
  name,
  label,
  placeholder,
  required,
  rows = 4,
  className,
  disabled,
}: Props) {
  const [field, meta] = useField<string>(name);

  return (
    <div>
      {label && (
        <label htmlFor={name} className="block text-sm text-[#e5e4e2]/60 mb-2">
          {label} {required && <span className="text-red-400">*</span>}
        </label>
      )}
      <textarea
        id={name}
        {...field}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
          className={
          className ??
          `w-full min-h-[120px] bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30 resize-none ${disabled ? 'opacity-70 cursor-not-allowed' : ''}`
        }
      />
      {meta.touched && meta.error ? (
        <div className="mt-1 text-xs text-red-400">{meta.error}</div>
      ) : null}
    </div>
  );
}