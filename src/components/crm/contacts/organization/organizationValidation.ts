import * as yup from 'yup';
import { requiresKrsForLegalForm } from '@/lib/organizations/organizationLegalForm';
import { legalFormLabels } from '@/utils/labels/legalFormLabels';

export type OrganizationBusinessType = 'company' | 'hotel' | 'restaurant' | 'venue' | 'freelancer' | 'other';
export type OrganizationStatus = 'active' | 'inactive' | 'blacklisted';
/** Rola organizacji jako odbiorcy na fakturze (KSeF Podmiot3): 8 = jednostka podrzędna JST, 2 = jednostka wewnętrzna. */
export type OrganizationInvoiceRecipientRole = 2 | 8;

export interface OrganizationFormValues {
  name?: string | null;
  alias?: string | null;
  business_type?: OrganizationBusinessType | null;
  nip?: string | null;
  legal_form?: string | null;
  krs?: string | null;
  regon?: string | null;
  ksef_internal_id?: string | null;
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
  invoice_buyer_organization_id?: string | null;
  invoice_recipient_role?: OrganizationInvoiceRecipientRole | null;
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

export type OrganizationFormErrorField =
  | 'name'
  | 'alias'
  | 'business_type'
  | 'nip'
  | 'legal_form'
  | 'krs'
  | 'regon'
  | 'ksef_internal_id'
  | 'address'
  | 'city'
  | 'postal_code'
  | 'country'
  | 'email'
  | 'phone'
  | 'website'
  | 'rating'
  | 'status'
  | 'location_id'
  | 'invoice_buyer_organization_id'
  | 'invoice_recipient_role';

export type OrganizationFormErrors = Partial<Record<OrganizationFormErrorField, string>>;

export const organizationStatusLabels: Record<OrganizationStatus, string> = {
  active: 'Aktywna',
  inactive: 'Nieaktywna',
  blacklisted: 'Czarna lista',
};

const POLISH_COUNTRY_NAMES = new Set(['', 'PL', 'POLSKA', 'POLAND']);

/** Pusty kraj traktujemy jak Polskę — tak zapisuje formularz i tak czyta go KSeF. */
export const isPolishCountry = (country?: string | null) =>
  POLISH_COUNTRY_NAMES.has(String(country || '').trim().toUpperCase());

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];
const REGON9_WEIGHTS = [8, 9, 2, 3, 4, 5, 6, 7];
const REGON14_WEIGHTS = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8];

const checksum = (value: string, weights: number[]) =>
  weights.reduce((sum, weight, index) => sum + Number(value[index]) * weight, 0) % 11;

export const isValidPolishNip = (value?: string | null) =>
  !!value && /^\d{10}$/.test(value) && checksum(value, NIP_WEIGHTS) === Number(value[9]);

export const isValidRegon = (value?: string | null) => {
  if (!value) return false;
  const control = (digits: string, weights: number[]) => {
    const rest = checksum(digits, weights);
    return (rest === 10 ? 0 : rest) === Number(digits[weights.length]);
  };
  if (/^\d{9}$/.test(value)) return control(value, REGON9_WEIGHTS);
  if (/^\d{14}$/.test(value)) return control(value.slice(0, 9), REGON9_WEIGHTS) && control(value, REGON14_WEIGHTS);
  return false;
};

/** IDWew w KSeF: NIP nabywcy + 5 cyfr, np. 5252228219-00145. */
export const isValidKsefInternalId = (value?: string | null) =>
  !!value && /^\d{10}-\d{5}$/.test(value) && isValidPolishNip(value.slice(0, 10));

/** Strona bez protokołu dostaje https:// — użytkownicy zwykle wpisują „mavinci.pl”. */
export const normalizeWebsite = (value?: string | null) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const trimmedOrNull = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed;
};

const digitsOrNull = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/\D/g, '');
  return digits || null;
};

const normalizePhone = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, ' ');
};

const normalizeTaxId = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const compact = value.replace(/[\s.-]/g, '').toUpperCase();
  if (!compact) return null;
  return /^PL\d{10}$/.test(compact) ? compact.slice(2) : compact;
};

const normalizePostalCode = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().toUpperCase();
  return trimmed || null;
};

/** Polski kod wpisany bez myślnika (10200) zapisujemy jako 10-200. */
const formatPolishPostalCode = (value: unknown) =>
  typeof value === 'string' && /^\d{5}$/.test(value) ? `${value.slice(0, 2)}-${value.slice(2)}` : value;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const organizationValidationSchema = yup.object({
  name: yup
    .string()
    .nullable()
    .transform(trimmedOrNull)
    .required('Nazwa jest wymagana')
    .min(2, 'Nazwa musi mieć co najmniej 2 znaki')
    .max(512, 'Nazwa może mieć najwyżej 512 znaków'),

  alias: yup.string().nullable().transform(trimmedOrNull).max(256, 'Alias może mieć najwyżej 256 znaków'),

  country: yup.string().nullable().transform(trimmedOrNull).max(64, 'Nazwa kraju jest za długa'),

  nip: yup
    .string()
    .nullable()
    .transform(normalizeTaxId)
    .required('NIP jest wymagany')
    .test('nip', 'Nieprawidłowy NIP', function validateNip(value) {
      if (!value) return true;
      if (isPolishCountry(this.parent?.country)) {
        if (!/^\d{10}$/.test(value)) return this.createError({ message: 'NIP musi mieć dokładnie 10 cyfr' });
        if (!isValidPolishNip(value)) {
          return this.createError({ message: 'Nieprawidłowy NIP — suma kontrolna się nie zgadza. Sprawdź cyfry.' });
        }
        return true;
      }
      return /^[A-Z0-9]{4,20}$/.test(value)
        || this.createError({ message: 'Numer podatkowy może mieć 4–20 liter i cyfr (bez spacji)' });
    }),

  address: yup
    .string()
    .nullable()
    .transform(trimmedOrNull)
    .required('Adres jest wymagany')
    .min(3, 'Adres jest zbyt krótki')
    .max(512, 'Adres może mieć najwyżej 512 znaków'),

  city: yup
    .string()
    .nullable()
    .transform(trimmedOrNull)
    .required('Miasto jest wymagane')
    .min(2, 'Miasto jest zbyt krótkie')
    .max(256, 'Nazwa miasta jest za długa'),

  postal_code: yup
    .string()
    .nullable()
    .transform(normalizePostalCode)
    .required('Kod pocztowy jest wymagany')
    .when('country', {
      is: (country: string | null | undefined) => isPolishCountry(country),
      then: (schema) => schema
        .transform(formatPolishPostalCode)
        .matches(/^\d{2}-\d{3}$/, { message: 'Kod pocztowy musi mieć format 00-000', excludeEmptyString: true }),
      otherwise: (schema) => schema
        .matches(/^[A-Z0-9][A-Z0-9 -]{1,10}$/, {
          message: 'Kod pocztowy może mieć 2–11 liter, cyfr, spacji lub myślników',
          excludeEmptyString: true,
        }),
    }),

  ksef_internal_id: yup
    .string()
    .nullable()
    .transform((value: unknown) => (typeof value === 'string' ? value.replace(/\s/g, '') || null : value))
    .test('ksef-internal-id', 'Numer wewnętrzny KSeF ma postać NIP–5 cyfr, np. 5252228219-00145', (value) =>
      !value || isValidKsefInternalId(value),
    ),

  business_type: yup
    .mixed<OrganizationBusinessType>()
    .oneOf(['company', 'hotel', 'restaurant', 'venue', 'freelancer', 'other'], 'Wybierz profil działalności')
    .required('Profil działalności jest wymagany'),

  legal_form: yup
    .string()
    .nullable()
    .transform(trimmedOrNull)
    .required('Forma prawna lub typ podmiotu jest wymagany')
    .oneOf(Object.keys(legalFormLabels), 'Wybierz formę prawną z listy'),

  krs: yup
    .string()
    .nullable()
    .transform(digitsOrNull)
    .when('legal_form', {
      is: (legalForm: string | null | undefined) => requiresKrsForLegalForm(legalForm),
      then: (schema) =>
        schema.required('KRS jest wymagany dla wybranej formy prawnej').matches(/^\d{10}$/, 'KRS musi zawierać dokładnie 10 cyfr'),
      otherwise: (schema) =>
        schema.test('optional-krs', 'KRS musi zawierać dokładnie 10 cyfr', (value) => !value || /^\d{10}$/.test(value)),
    }),

  regon: yup
    .string()
    .nullable()
    .transform(digitsOrNull)
    .test('regon-format', 'REGON musi zawierać 9 albo 14 cyfr', (value) => !value || /^(?:\d{9}|\d{14})$/.test(value))
    .test('regon-checksum', 'Nieprawidłowy REGON — suma kontrolna się nie zgadza', (value) =>
      !value || !/^(?:\d{9}|\d{14})$/.test(value) || isValidRegon(value),
    ),

  email: yup
    .string()
    .nullable()
    .transform((value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() || null : value))
    .email('Nieprawidłowy adres e-mail')
    .test('email-domain', 'Adres e-mail musi mieć domenę, np. biuro@firma.pl', (value) =>
      !value || /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(value),
    )
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
    .transform((value: unknown) => (typeof value === 'string' ? normalizeWebsite(value) : value))
    .max(512, 'Adres strony może mieć najwyżej 512 znaków')
    .test('is-valid-url', 'Nieprawidłowy adres strony, np. https://mavinci.pl', (value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') && !/\s/.test(value);
      } catch {
        return false;
      }
    }),

  rating: yup
    .number()
    .nullable()
    .transform((value: unknown, original: unknown) => (original === '' || original === 0 || original === '0' ? null : value))
    .integer('Ocena musi być liczbą całkowitą')
    .min(1, 'Ocena od 1 do 5')
    .max(5, 'Ocena od 1 do 5'),

  status: yup
    .string()
    .nullable()
    .transform(trimmedOrNull)
    .oneOf([...Object.keys(organizationStatusLabels), null], 'Wybierz status z listy'),

  location_id: yup.string().nullable().transform(trimmedOrNull)
    .matches(uuidRegex, { message: 'Wybierz lokalizację z listy', excludeEmptyString: true })
    .when('business_type', {
      is: 'hotel',
      then: (schema) => schema.required('Hotel musi być powiązany z lokalizacją. Wybierz obiekt z listy lub dodaj nowy.'),
    }),

  invoice_recipient_role: yup
    .number()
    .nullable()
    .transform((value: unknown, original: unknown) => (original === '' || original == null ? null : value))
    .oneOf([2, 8, null], 'Wybierz rolę organizacji na fakturze'),

  invoice_buyer_organization_id: yup
    .string()
    .nullable()
    .transform(trimmedOrNull)
    .matches(uuidRegex, { message: 'Wybierz organizację z listy', excludeEmptyString: true })
    .when('invoice_recipient_role', {
      is: (role: number | null | undefined) => role === 2 || role === 8,
      then: (schema) => schema.required('Wybierz organizację, na którą wystawiamy faktury (np. gminę).'),
    }),

  primary_contact_id: yup.string().nullable(),
  legal_representative_id: yup.string().nullable(),
  legal_representative_title: yup.string().nullable().transform(trimmedOrNull),
  contact_is_representative: yup.boolean().nullable(),
  representation_type: yup
    .mixed<'sole' | 'joint' | 'joint_with_proxy' | 'proxy' | 'other'>()
    .nullable()
    .oneOf(['sole', 'joint', 'joint_with_proxy', 'proxy', 'other', null]),
  representation_rule: yup.string().nullable().transform(trimmedOrNull),
  representation_basis: yup.string().nullable().transform(trimmedOrNull),
  representation_verified_at: yup.string().nullable().transform(trimmedOrNull),
  google_maps_url: yup.string().nullable().transform(trimmedOrNull),
  latitude: yup.number().nullable(),
  longitude: yup.number().nullable(),
});

/** Kolumny organizacji zapisywane przez wspólny formularz (dodawanie i edycja). */
export const organizationFormPayload = (values: OrganizationFormValues) => {
  const buyerId = values.invoice_buyer_organization_id || null;
  return {
    name: values.name ?? null,
    alias: values.alias ?? null,
    business_type: values.business_type ?? 'company',
    nip: values.nip ?? null,
    legal_form: values.legal_form ?? null,
    krs: requiresKrsForLegalForm(values.legal_form) ? values.krs ?? null : null,
    regon: values.regon ?? null,
    ksef_internal_id: values.ksef_internal_id ?? null,
    address: values.address ?? null,
    city: values.city ?? null,
    postal_code: values.postal_code ?? null,
    country: values.country ?? 'Polska',
    email: values.email ?? null,
    phone: values.phone ?? null,
    website: values.website ?? null,
    rating: values.rating ?? null,
    status: (values.status as OrganizationStatus | null) || 'active',
    location_id: values.location_id || null,
    invoice_buyer_organization_id: buyerId,
    invoice_recipient_role: buyerId ? values.invoice_recipient_role ?? 8 : null,
  };
};

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
      validatedData: validatedData as OrganizationFormValues,
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
