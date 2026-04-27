import * as yup from 'yup';
import { legalFormLabels } from '../labels/legalFormLabels';
import { Organization } from '@/app/(crm)/crm/contacts/[id]/page';
import { OrganizationFormErrors } from '@/components/crm/contacts/organization/organizationValidation';

const normalizeToken = (value: unknown) => {
  if (typeof value !== 'string') return value;

  const cleaned = value
    .replace(/\u00A0/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned === '' ? null : cleaned;
};

const onlyDigits = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const cleaned = value.replace(/\D/g, '');
  return cleaned === '' ? null : cleaned;
};

export const organizationFa3Schema = yup.object({
  organization_type: yup
    .mixed<'client' | 'subcontractor'>()
    .oneOf(['client', 'subcontractor'])
    .required('Typ organizacji jest wymagany'),

  business_type: yup
    .mixed<'company' | 'hotel' | 'restaurant' | 'venue' | 'freelancer' | 'other'>()
    .oneOf(['company', 'hotel', 'restaurant', 'venue', 'freelancer', 'other'])
    .required('Typ działalności jest wymagany'),

  name: yup
    .string()
    .transform(normalizeToken)
    .required('Nazwa jest wymagana')
    .max(512, 'Nazwa może mieć maksymalnie 512 znaków'),

  alias: yup.string().nullable().transform(normalizeToken).max(256),

  nip: yup
    .string()
    .nullable()
    .transform(onlyDigits)
    .matches(/^\d{10}$/, {
      message: 'NIP musi mieć dokładnie 10 cyfr',
      excludeEmptyString: true,
    }),

  regon: yup
    .string()
    .nullable()
    .transform(onlyDigits)
    .matches(/^(\d{9}|\d{14})$/, {
      message: 'REGON musi mieć 9 albo 14 cyfr',
      excludeEmptyString: true,
    }),

  krs: yup
    .string()
    .nullable()
    .transform(onlyDigits)
    .matches(/^\d{10}$/, {
      message: 'KRS musi mieć dokładnie 10 cyfr',
      excludeEmptyString: true,
    }),

  legal_form: yup
    .mixed<keyof typeof legalFormLabels>()
    .nullable()
    .oneOf([...Object.keys(legalFormLabels), null] as any),

  address: yup
    .string()
    .nullable()
    .transform(normalizeToken)
    .max(512, 'Adres może mieć maksymalnie 512 znaków'),

  city: yup.string().nullable().transform(normalizeToken).max(256),

  postal_code: yup
    .string()
    .nullable()
    .transform(normalizeToken)
    .matches(/^\d{2}-\d{3}$/, {
      message: 'Kod pocztowy powinien mieć format 00-000',
      excludeEmptyString: true,
    }),

  country: yup.string().nullable().transform(normalizeToken).max(2),

  email: yup.string().nullable().transform(normalizeToken).email('Niepoprawny email').max(256),

  phone: yup.string().nullable().transform(normalizeToken).max(50),

  website: yup.string().nullable().transform(normalizeToken).url('Niepoprawny adres strony').max(512),

  bank_account: yup
    .string()
    .nullable()
    .transform((value) => {
      if (typeof value !== 'string') return value;
      const cleaned = value.replace(/\s/g, '').trim();
      return cleaned === '' ? null : cleaned;
    })
    .max(34, 'Numer rachunku jest za długi'),

  notes: yup.string().nullable().transform(normalizeToken).max(512),
});

export async function validateOrganizationForm(data: Partial<Organization>) {
  try {
    const validatedData = await organizationFa3Schema.validate(data, {
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
      const errors: OrganizationFormErrors = {};

      error.inner.forEach((err) => {
        if (err.path) {
          errors[err.path as keyof OrganizationFormErrors] = err.message;
        }
      });

      return {
        isValid: false,
        validatedData: null,
        errors,
      };
    }

    throw error;
  }
}