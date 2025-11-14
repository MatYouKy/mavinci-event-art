'use client';

import React, { forwardRef, useId, useMemo } from 'react';
import { useField } from 'formik';
import DatePicker, { DatePickerProps } from 'react-datepicker';
import { format, parse } from 'date-fns';
import { pl } from 'date-fns/locale';
import { Calendar, X as XIcon } from 'lucide-react';

import 'react-datepicker/dist/react-datepicker.css';
import './react-datepicker.dark.css'; // patrz sekcja 2

type Props = {
  /** nazwa pola Formika */
  name: string;
  label?: string;
  placeholder?: string;

  /** format przechowywania w stanie (np. ISO bez czasu) */
  storeFormat?: string; // domyślnie 'yyyy-MM-dd'
  /** format wyświetlania w polu */
  displayFormat?: string; // domyślnie 'dd.MM.yyyy'

  disabled?: boolean;
  required?: boolean;
  className?: string;

  /** propsy przekazywane do react-datepicker */
  datepickerProps?: Partial<DatePickerProps>;
};

const parseMaybe = (val?: string | null, fmt = 'yyyy-MM-dd') => {
  if (!val) return null;
  try {
    const d = parse(val, fmt, new Date());
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

/** ---------------- custom input dla react-datepicker ----------------
 *  Musi przyjąć `value`, `onClick`, `ref`, `disabled` od react-datepicker.
 *  Dzięki temu klik faktycznie otwiera kalendarz.
 */
type ButtonInputProps = {
  value?: string;
  onClick?: () => void;
  disabled?: boolean;
  placeholder?: string;
  hasValue?: boolean;
  onClear?: () => void;
};
const ButtonInput = forwardRef<HTMLButtonElement, ButtonInputProps>(
  ({ value, onClick, disabled, placeholder, hasValue, onClear }, ref) => (
    <div className="relative">
      {/* ikona kalendarza */}
      <Calendar
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#d3bb73]"
        aria-hidden
      />

      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-2 pl-9 pr-9 text-left text-sm text-[#e5e4e2] hover:border-[#d3bb73]/30 focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
      >
        {hasValue && value ? (
          value
        ) : (
          <span className="text-[#e5e4e2]/40">{placeholder || 'Wybierz datę…'}</span>
        )}
      </button>

      {/* przycisk czyszczenia */}
      {hasValue && !!value && !disabled && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#e5e4e2]/60 hover:bg-[#1c1f33] hover:text-[#e5e4e2]"
          aria-label="Wyczyść datę"
        >
          <XIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  ),
);
ButtonInput.displayName = 'ButtonInput';

/** ---------------- główny komponent pola daty ---------------- */
export const DatePickerField: React.FC<Props> = ({
  name,
  label,
  placeholder = 'dd.mm.rrrr',
  storeFormat = 'yyyy-MM-dd',
  displayFormat = 'dd.MM.yyyy',
  disabled,
  required,
  className,
  datepickerProps,
}) => {
  const [field, meta, helpers] = useField<string | null>(name);
  const id = useId();

  const selectedDate = useMemo(
    () => parseMaybe(field.value ?? undefined, storeFormat),
    [field.value, storeFormat],
  );

  const hasError = meta.touched && !!meta.error;

  // Wyklucz onChange i selected z datepickerProps, żeby nie kolidowały
  const { onChange: _, selected: __, ...safeDatepickerProps } = datepickerProps || {};

  const handleChange = (d: Date | null) => {
    if (!d) {
      helpers.setValue(null);
      return;
    }
    helpers.setValue(format(d, storeFormat));
  };

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={id}
          className={`mb-1 block text-xs ${hasError ? 'text-red-400' : 'text-[#e5e4e2]/60'}`}
        >
          {label} {required ? <span className="text-red-400">*</span> : null}
        </label>
      )}

      {/* @ts-ignore - react-datepicker type inference issue with onChange overloads */}
      <DatePicker
        {...safeDatepickerProps}
        id={id}
        selected={selectedDate ?? undefined}
        onChange={handleChange}
        onBlur={() => helpers.setTouched(true)}
        locale={pl}
        dateFormat={displayFormat}
        calendarStartDay={1}
        disabled={disabled}
        // otwieranie w portalu (działa w modalach i scrollowalnych kontenerach)
        withPortal
        showPopperArrow={false}
        // odpowiedzialny custom input z forwardRef (naprawia problem klikania)
        customInput={
          <ButtonInput
            placeholder={placeholder}
            hasValue={!!selectedDate}
            onClear={() => helpers.setValue(null)}
          />
        }
        popperClassName="mavinci-datepicker-popper"
      />

      {hasError && <div className="mt-1 text-xs text-red-400">{meta.error}</div>}
    </div>
  );
};
