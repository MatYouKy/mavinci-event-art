import { useField } from 'formik';
import React, { useImperativeHandle, useRef, forwardRef, useState } from 'react';
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
    const [isDragging, setIsDragging] = useState(false);

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

    const handleDragEnter = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
    };

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files && files[0]) {
        const file = files[0];
        if (file.type.startsWith('image/')) {
          helpers.setValue(file);
        }
      }
    };

    return (
      <div className="flex h-full w-full flex-col">
        {label && <label className="mb-2 block font-light text-[#e5e4e2]">{label}</label>}
        <div
          onClick={() => inputRef.current?.click()}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`flex w-full flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-transparent transition-colors ${
            isDragging
              ? 'border-[#d3bb73] bg-[#d3bb73]/10'
              : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/50'
          }`}
        >
          <Upload className="h-8 w-8 text-[#d3bb73]/60" />
          <p className="text-sm text-[#e5e4e2]/40">
            {field.value instanceof File ? field.value.name : 'Kliknij lub przeciągnij zdjęcie'}
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
  },
);

FormImageInput.displayName = 'FormImageInput';
