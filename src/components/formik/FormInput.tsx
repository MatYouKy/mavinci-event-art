import { useField } from 'formik';
import React from 'react';

interface FormInputProps {
  name: string;
  label?: string;
  type?: string;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}

export const FormInput: React.FC<FormInputProps> = ({
  name,
  label,
  type = 'text',
  placeholder,
  multiline = false,
  rows = 3,
}) => {
  const [field, meta] = useField(name);
  const hasError = meta.touched && meta.error;

  const inputClasses = `w-full px-4 py-3 bg-[#1c1f33] border ${
    hasError ? 'border-red-500' : 'border-[#d3bb73]/30'
  } rounded-lg text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73] transition-colors`;

  if (type === 'checkbox') {
    return (
      <div className="mb-4 flex items-center gap-3">
        <input
          {...field}
          type="checkbox"
          checked={field.value}
          className="w-5 h-5 rounded bg-[#1c1f33] border-[#d3bb73]/30 text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-0"
        />
        {label && (
          <label className="text-[#e5e4e2] font-light cursor-pointer">
            {label}
          </label>
        )}
        {hasError && (
          <p className="text-red-500 text-sm mt-1">{meta.error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mb-4">
      {label && (
        <label className="block text-[#e5e4e2] mb-2 font-light">
          {label}
        </label>
      )}
      {multiline ? (
        <textarea
          {...field}
          placeholder={placeholder}
          rows={rows}
          className={inputClasses}
        />
      ) : (
        <input
          {...field}
          type={type}
          placeholder={placeholder}
          className={inputClasses}
        />
      )}
      {hasError && (
        <p className="text-red-500 text-sm mt-1">{meta.error}</p>
      )}
    </div>
  );
};
