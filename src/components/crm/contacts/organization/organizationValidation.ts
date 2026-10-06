import * as yup from 'yup';
import { requiresKrsForLegalForm } from '@/lib/organizations/organizationLegalForm';

export interface OrganizationFormValues {
  name?: string | null;
  alias?: string | null;
  business_type?: 'company' | 'hotel' | 'restaurant' | 'venue' | 'freelancer' | 'other' | null;
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
  representation_type?: 'sole' | 'joint' | 'joint_with_proxy' | 'proxy' | 'other' | null;
  representation_rule?: string | null;
  representation_basis?: string | null;
  representation_verified_at?: string | null;
  google_maps_url?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export type OrganizationFormErrors = Partial<
  Record<
    | 'name'
    | 'business_type'
    | 'nip'
    | 'legal_form'
    | 'krs'
    | 'regon'
    | 'address'
    | 'city'
    | 'postal_code'
    | 'email'
    | 'phone'
    | 'website'
    | 'location_id',
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
const krsRegex = /^\d{10}$/;
const regonRegex = /^(?:\d{9}|\d{14})$/;

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
  business_type: yup
    .mixed<'company' | 'hotel' | 'restaurant' | 'venue' | 'freelancer' | 'other'>()
    .oneOf(['company', 'hotel', 'restaurant', 'venue', 'freelancer', 'other'])
    .required('Profil działalności jest wymagany'),
  legal_form: yup
    .string()
    .nullable()
    .transform(normalizeOptionalString)
    .required('Forma prawna lub typ podmiotu jest wymagany'),
  krs: yup
    .string()
    .nullable()
    .transform((value) => {
      if (typeof value !== 'string') return value;
      const digits = value.replace(/\D/g, '');
      return digits || null;
    })
    .when('legal_form', {
      is: (legalForm: string | null | undefined) => requiresKrsForLegalForm(legalForm),
      then: (schema) =>
        schema.required('KRS jest wymagany dla wybranej formy prawnej').matches(krsRegex, 'KRS musi zawierać dokładnie 10 cyfr'),
      otherwise: (schema) =>
        schema.test('optional-krs', 'KRS musi zawierać dokładnie 10 cyfr', (value) =>
          !value || krsRegex.test(value),
        ),
    }),
  regon: yup
    .string()
    .nullable()
    .transform((value) => {
      if (typeof value !== 'string') return value;
      const digits = value.replace(/\D/g, '');
      return digits || null;
    })
    .test('regon-format', 'REGON musi zawierać 9 albo 14 cyfr', (value) =>
      !value || regonRegex.test(value),
    ),
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
  location_id: yup.string().nullable().transform(normalizeOptionalString)
    .uuid('Wybierz lokalizację z listy')
    .when('business_type', {
      is: 'hotel',
      then: (schema) => schema.required('Hotel musi być powiązany z lokalizacją. Wybierz obiekt z listy lub dodaj nowy.'),
    }),
  primary_contact_id: yup.string().nullable(),
  legal_representative_id: yup.string().nullable(),
  legal_representative_title: yup.string().nullable().transform(normalizeOptionalString),
  contact_is_representative: yup.boolean().nullable(),
  representation_type: yup
    .mixed<'sole' | 'joint' | 'joint_with_proxy' | 'proxy' | 'other'>()
    .nullable()
    .oneOf(['sole', 'joint', 'joint_with_proxy', 'proxy', 'other', null]),
  representation_rule: yup.string().nullable().transform(normalizeOptionalString),
  representation_basis: yup.string().nullable().transform(normalizeOptionalString),
  representation_verified_at: yup.string().nullable().transform(normalizeOptionalString),
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
