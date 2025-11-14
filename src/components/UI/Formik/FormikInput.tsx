'use client';
import { useField } from 'formik';
import React from 'react';

type Props = {
  name: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
  disabled?: boolean;
  type?: string;
  step?: string;
  min?: string;
  max?: string;
  noNegative?: boolean; // 🔹 nowa opcja
};

export function FormikInput({
  name,
  label,
  placeholder,
  required,
  className,
  disabled,
  type = 'text',
  step,
  min,
  max,
  noNegative = false,
}: Props) {
  const [field, meta, helpers] = useField<string>(name);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (noNegative && type === 'number') {
      const value = e.target.value;
      // zablokuj wprowadzenie wartości ujemnych
      if (value === '-' || Number(value) < 0) {
        e.preventDefault();
        helpers.setValue('0');
        return;
      }
    }
    field.onChange(e);
  };

  return (
    <div>
      {label && (
        <label htmlFor={name} className="block text-sm text-[#e5e4e2]/60 mb-2">
          {label} {required && <span className="text-red-400">*</span>}
        </label>
      )}
      <input
        id={name}
        {...field}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
        type={type}
        step={step ? parseFloat(step) : undefined}
        min={noNegative ? 0 : min ? parseFloat(min) : undefined}
        max={max ? parseFloat(max) : undefined}
        className={
          className ??
          'w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30'
        }
      />
      {meta.touched && meta.error ? (
        <div className="mt-1 text-xs text-red-400">{meta.error}</div>
      ) : null}
    </div>
  );
}