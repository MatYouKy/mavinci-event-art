import * as yup from 'yup';

export interface OrganizationFormValues {
  name?: string | null;
  alias?: string | null;
  nip?: string | null;
  legal_form?: string | null;
  krs?: string | null;
  regon?: string | null;
  address?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  rating?: number | null;
  status?: string | null;
  location_id?: string | null;
  primary_contact_id?: string | null;
  legal_representative_id?: string | null;
  legal_representative_title?: string | null;
  contact_is_representative?: boolean;
  google_maps_url?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export type OrganizationFormErrors = Partial<
  Record<
    'name' | 'nip' | 'address' | 'city' | 'postal_code' | 'email' | 'phone' | 'website',
    string
  >
>;

const normalizePhone = (value: unknown) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed) return null;

  return trimmed.replace(/\s+/g, ' ');
};

const postalCodeRegex = /^\d{2}-\d{3}$/;
const nipRegex = /^\d{10}$/;

const normalizeOptionalString = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export const organizationValidationSchema = yup.object({
  name: yup
    .string()
    .transform((value) => (typeof value === 'string' ? value.trim() : value))
    .required('Nazwa jest wymagana')
    .min(2, 'Nazwa musi mieć co najmniej 2 znaki'),

  nip: yup
    .string()
    .transform((value) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
    .required('NIP jest wymagany')
    .matches(nipRegex, 'NIP musi zawierać dokładnie 10 cyfr'),

  address: yup
    .string()
    .transform((value) => (typeof value === 'string' ? value.trim() : value))
    .required('Adres jest wymagany')
    .min(3, 'Adres jest zbyt krótki'),

  city: yup
    .string()
    .transform((value) => (typeof value === 'string' ? value.trim() : value))
    .required('Miasto jest wymagane')
    .min(2, 'Miasto jest zbyt krótkie'),

  postal_code: yup
    .string()
    .transform((value) => (typeof value === 'string' ? value.trim() : value))
    .required('Kod pocztowy jest wymagany')
    .matches(postalCodeRegex, 'Kod pocztowy musi mieć format 00-000'),

  alias: yup.string().nullable().transform(normalizeOptionalString),
  legal_form: yup.string().nullable().transform(normalizeOptionalString),
  krs: yup.string().nullable().transform(normalizeOptionalString),
  regon: yup.string().nullable().transform(normalizeOptionalString),
  country: yup.string().nullable().transform(normalizeOptionalString),

  email: yup
  .string()
  .nullable()
  .transform(normalizeOptionalString)
  .email('Nieprawidłowy adres e-mail')
  .max(256, 'Adres e-mail może mieć maksymalnie 256 znaków'),

  phone: yup
  .string()
  .nullable()
  .transform(normalizePhone)
  .test('phone-length', 'Telefon powinien mieć od 9 do 15 cyfr', (value) => {
    if (!value) return true;

    const digits = value.replace(/\D/g, '').length;
    return digits >= 9 && digits <= 15;
  })
  .test('phone-characters', 'Telefon może zawierać tylko cyfry, spacje, +, -, nawiasy', (value) => {
    if (!value) return true;

    return /^[0-9+\-()\s]+$/.test(value);
  }),

  website: yup
    .string()
    .nullable()
    .transform(normalizeOptionalString)
    .test('is-valid-url', 'Nieprawidłowy adres URL', (value) => {
      if (!value) return true;
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    }),

  rating: yup.number().nullable(),
  status: yup.string().nullable(),
  location_id: yup.string().nullable(),
  primary_contact_id: yup.string().nullable(),
  legal_representative_id: yup.string().nullable(),
  legal_representative_title: yup.string().nullable().transform(normalizeOptionalString),
  contact_is_representative: yup.boolean().nullable(),
  google_maps_url: yup.string().nullable().transform(normalizeOptionalString),
  latitude: yup.number().nullable(),
  longitude: yup.number().nullable(),
});

export const validateOrganizationForm = async (
  values: OrganizationFormValues,
): Promise<{
  isValid: boolean;
  validatedData: OrganizationFormValues | null;
  errors: OrganizationFormErrors;
}> => {
  try {
    const validatedData = await organizationValidationSchema.validate(values, {
      abortEarly: false,
      stripUnknown: false,
    });

    return {
      isValid: true,
      validatedData,
      errors: {},
    };
  } catch (error) {
    if (error instanceof yup.ValidationError) {
      const nextErrors: OrganizationFormErrors = {};

      error.inner.forEach((err) => {
        if (!err.path) return;
        if (!nextErrors[err.path as keyof OrganizationFormErrors]) {
          nextErrors[err.path as keyof OrganizationFormErrors] = err.message;
        }
      });

      return {
        isValid: false,
        validatedData: null,
        errors: nextErrors,
      };
    }

    throw error;
  }
};