import { useField } from 'formik';
import React, { useImperativeHandle, useRef, forwardRef } from 'react';
import { Upload } from 'lucide-react';

interface FormImageInputProps {
  name: string;
  label?: string;
}

export interface FormImageInputHandle {
  click: () => void;
}

export const FormImageInput = forwardRef<FormImageInputHandle, FormImageInputProps>(
  ({ name, label }, ref) => {
    const [field, , helpers] = useField(name);
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      click: () => {
        inputRef.current?.click();
      },
    }));

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        helpers.setValue(file);
      }
    };

    return (
      <div className="mb-4">
        {label && (
          <label className="block text-[#e5e4e2] mb-2 font-light">
            {label}
          </label>
        )}
        <div
          onClick={() => inputRef.current?.click()}
          className="w-full px-4 py-8 bg-[#1c1f33] border-2 border-dashed border-[#d3bb73]/30 rounded-lg cursor-pointer hover:border-[#d3bb73] transition-colors flex flex-col items-center justify-center gap-2"
        >
          <Upload className="w-8 h-8 text-[#d3bb73]" />
          <p className="text-[#e5e4e2]/60 text-sm">
            {field.value instanceof File
              ? field.value.name
              : 'Kliknij aby wybrać zdjęcie'}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={handleChange}
          className="hidden"
        />
      </div>
    );
  }
);

FormImageInput.displayName = 'FormImageInput';
