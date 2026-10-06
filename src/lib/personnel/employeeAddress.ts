import { normalizeProfileAddress, formatProfileAddress, type ProfileAddress } from '@/components/crm/subcontractors/profileAddress';

export type EmployeeAddress = { address_street?: string | null; address_city?: string | null; address_postal_code?: string | null };
export function formatPersonnelAddress(parts: ProfileAddress) {
  return formatProfileAddress({ ...parts, type: ['street', 'avenue', 'square'].includes(parts.type) ? parts.type : '' });
}
export function employeeContractAddress(employee?: EmployeeAddress, saved?: Partial<ProfileAddress> | null): ProfileAddress | undefined {
  if (!employee || ![employee.address_street, employee.address_city, employee.address_postal_code].some(value => value?.trim())) return undefined;
  const street = (employee.address_street || '').trim();
  const previous = saved ? normalizeProfileAddress(saved) : undefined;
  // Retain structured fields (including country) only while the employee's address still matches.
  if (previous && formatProfileAddress({ ...previous, postal_code: '', city: '', country: '' }) === street) {
    return { ...previous, city: employee.address_city || '', postal_code: employee.address_postal_code || '' };
  }
  const prefix = /^(ul\.?|ulica|al\.?|aleja|aleje|pl\.?|plac|os\.?|osiedle|wieś)\s+/i.exec(street);
  const token = prefix?.[1].toLocaleLowerCase('pl-PL') || '';
  const type = /^ul/.test(token) ? 'street' : /^al/.test(token) ? 'avenue' : /^pl/.test(token) ? 'square' : /^os/.test(token) ? 'estate' : token === 'wieś' ? 'village' : '';
  const line = prefix ? street.slice(prefix[0].length) : street;
  const number = /^(.*?)\s+(\d+[a-zA-Z]?(?:-\d+[a-zA-Z]?)?)(?:\s*\/\s*([\w-]+)|\s+(?:m\.?|lok\.?)\s*([\w-]+))?$/.exec(line);
  return normalizeProfileAddress({ type, name: number ? number[1].trim() : line, house: number?.[2] || '', apartment: number?.[3] || number?.[4] || '', postal_code: employee.address_postal_code || '', city: employee.address_city || '', country: previous?.country || 'Polska' });
}
