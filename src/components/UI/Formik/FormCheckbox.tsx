import { useField } from 'formik';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

interface FormCheckboxProps {
  name: string;
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Stylowy checkbox zgodny z layoutem MAVINCI
 * Kolor: złoty (#d3bb73) na ciemnym tle (#0f1119)
 */
export const FormCheckbox: React.FC<FormCheckboxProps> = ({
  name,
  label,
  disabled,
  className = '',
}) => {
  const [field, meta, helpers] = useField<boolean>(name);
  const { value } = field;
  const { setValue } = helpers;

  return (
    <label
      htmlFor={name}
      className={`group relative flex cursor-pointer items-center gap-3 select-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''
        } ${className}`}
    >
      {/* Checkbox box */}
      <motion.div
        whileTap={!disabled ? { scale: 0.9 } : {}}
        className={`
          flex h-5 w-5 items-center justify-center rounded-md border
          ${value
            ? 'bg-[#d3bb73] border-[#d3bb73]'
            : 'border-[#d3bb73]/40 bg-[#0f1119]'
          }
          transition-colors duration-150
          group-hover:border-[#d3bb73]
        `}
        onClick={() => !disabled && setValue(!value)}
      >
        {value && (
          <Check
            size={14}
            strokeWidth={3}
            className="text-[#0f1119] pointer-events-none"
          />
        )}
      </motion.div>

      {/* Label text */}
      <span
        className={`text-sm font-medium text-[#e5e4e2]/90 tracking-wide
          ${disabled ? 'text-[#e5e4e2]/40' : ''}
        `}
        onClick={() => !disabled && setValue(!value)}
      >
        {label}
      </span>

      {/* Validation error (opcjonalnie) */}
      {meta.touched && meta.error ? (
        <div className="absolute -bottom-5 left-0 text-xs text-red-400">
          {meta.error}
        </div>
      ) : null}
    </label>
  );
};