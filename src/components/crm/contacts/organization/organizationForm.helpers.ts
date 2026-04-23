import type { OrganizationFormErrors } from './organizationValidation';

export const getOrganizationInputClassName = (
  formErrors: OrganizationFormErrors,
  field?: keyof OrganizationFormErrors,
) =>
  `w-full rounded-lg border bg-[#0f1119] px-4 py-2 text-white focus:outline-none ${
    field && formErrors[field]
      ? 'border-red-500 focus:border-red-500'
      : 'border-gray-700 focus:border-[#d3bb73]'
  }`;

export const clearOrganizationFieldError = (
  field: keyof OrganizationFormErrors,
  setFormErrors: React.Dispatch<React.SetStateAction<OrganizationFormErrors>>,
) => {
  setFormErrors((prev) => ({
    ...prev,
    [field]: undefined,
  }));
};

export const formatNip = (value: string) => {
  const cleaned = value.replace(/\D/g, '').slice(0, 10);

  if (cleaned.length <= 3) return cleaned;

  if (cleaned.length <= 6) return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;

  if (cleaned.length <= 8)

    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;

  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6, 8)}-${cleaned.slice(8)}`;
};