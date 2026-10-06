import { cloneElement, type ReactElement, type InputHTMLAttributes, useId } from 'react';
import * as yup from 'yup';
import { organizationValidationSchema } from './organization/organizationValidation';

export const personContactSchema = yup.object({
  firstName: yup.string().trim().required('Imię jest wymagane'),
  lastName: yup.string().trim().required('Nazwisko jest wymagane'),
  email: organizationValidationSchema.fields.email,
  phone: organizationValidationSchema.fields.phone,
  mobile: organizationValidationSchema.fields.phone,
  businessPhone: organizationValidationSchema.fields.phone,
  nip: yup
    .string()
    .trim()
    .test(
      'nip',
      'NIP musi zawierać dokładnie 10 cyfr',
      (value) => !value || /^\d{10}$/.test(value.replace(/[\s-]/g, '')),
    ),
  postalCode: yup
    .string()
    .trim()
    .test(
      'postal-code',
      'Kod pocztowy musi mieć format 00-000',
      (value) => !value || /^\d{2}-\d{3}$/.test(value),
    ),
});

export function collectValidationErrors(
  schema: yup.AnyObjectSchema,
  values: unknown,
  prefix = '',
): Record<string, string> {
  try {
    schema.validateSync(values, { abortEarly: false });
    return {};
  } catch (error) {
    if (!(error instanceof yup.ValidationError)) throw error;
    const errors: Record<string, string> = {};
    for (const issue of error.inner.length ? error.inner : [error]) {
      if (issue.path && !errors[prefix + issue.path]) errors[prefix + issue.path] = issue.message;
    }
    return errors;
  }
}

export function ContactValidationField({
  field,
  error,
  children,
}: {
  field: string;
  error?: string;
  children: ReactElement<InputHTMLAttributes<HTMLInputElement>>;
}) {
  const errorId = useId();
  return (
    <div className="min-w-0">
      {cloneElement(children, {
        name: field,
        'aria-invalid': Boolean(error),
        'aria-describedby': error ? errorId : undefined,
        style: {
          ...children.props.style,
          ...(error
            ? { borderColor: 'rgba(248,113,113,0.45)', backgroundColor: 'rgba(127,29,29,0.12)' }
            : {}),
        },
      })}
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
