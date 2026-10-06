import type { SearchComboboxOption } from '@/components/crm/SearchCombobox';

export type SearchableSubcontractor = {
  id: string;
  company_name: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  hourly_rate?: number;
  organization?: { name?: string | null; alias?: string | null; phone?: string | null } | null;
};
const normalize = (value: string) =>
  value
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');

export function subcontractorOption(sub: SearchableSubcontractor): SearchComboboxOption {
  const phones = [sub.phone, sub.organization?.phone].filter(Boolean) as string[];
  return {
    id: sub.id,
    label: sub.company_name,
    description: [
      sub.organization?.alias,
      sub.contact_person,
      ...Array.from(new Set(phones)),
      sub.hourly_rate ? `${sub.hourly_rate} zł/h` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    keywords: [
      sub.organization?.name,
      sub.organization?.alias,
      sub.email,
      ...phones.flatMap((phone) => {
        const digits = phone.replace(/\D/g, '');
        return digits.length === 9 ? [digits, `48${digits}`] : [digits];
      }),
    ]
      .filter(Boolean)
      .join(' '),
  };
}

export function matchesSubcontractor(option: SearchComboboxOption, query: string): boolean {
  const text = normalize(`${option.label} ${option.description || ''} ${option.keywords || ''}`);
  const normalized = normalize(query.trim());
  if (/^[+\d\s().-]+$/.test(normalized)) {
    const digits = normalized.replace(/\D/g, '');
    return !!digits && text.includes(digits);
  }
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => text.includes(token));
}
