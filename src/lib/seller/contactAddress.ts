import {
  addressTypes, emptyAddress, normalizeProfileAddress, formatProfileAddress, type ProfileAddress,
} from '@/components/crm/subcontractors/profileAddress';
import type { GUSCompanyData } from '@/lib/gus';

export type SellerAddressParts = ProfileAddress;
export const sellerAddressTypes = { ...addressTypes, village: 'Miejscowość bez ulicy' };
export const sellerAddressKeys = ['type', 'name', 'house', 'apartment', 'postal_code', 'city', 'country'] as const;

export function normalizeSellerAddress(value?: Partial<SellerAddressParts> | null): SellerAddressParts {
  const normalized = normalizeProfileAddress(value);
  for (const key of sellerAddressKeys) normalized[key] = normalized[key].trim();
  normalized.country ||= 'Polska';
  if (/^\d{5}$/.test(normalized.postal_code) && /^(polska|poland|pl)$/i.test(normalized.country)) {
    normalized.postal_code = normalized.postal_code.slice(0, 2) + '-' + normalized.postal_code.slice(2);
  }
  return normalized;
}

export function hasSellerAddress(value: SellerAddressParts): boolean {
  return sellerAddressKeys.some((key) => key !== 'country' && Boolean(value[key].trim()));
}

export function formatSellerAddress(value: SellerAddressParts): string {
  return formatProfileAddress(normalizeSellerAddress(value));
}

export function sellerAddressError(value: SellerAddressParts): string {
  const parts = normalizeSellerAddress(value);
  if (!hasSellerAddress(parts)) return '';
  if (!Object.prototype.hasOwnProperty.call(sellerAddressTypes, parts.type)) return 'Wybierz prefiks adresu lub „Bez prefiksu”.';
  if (!parts.name) return 'Podaj nazwę ulicy lub miejscowości bez ulicy.';
  if (!parts.house) return 'Podaj numer budynku. Numer lokalu jest opcjonalny.';
  if (!parts.city) return 'Podaj miejscowość.';
  if (!parts.postal_code) return 'Podaj kod pocztowy.';
  if (/^(polska|poland|pl)$/i.test(parts.country) && !/^\d{2}-\d{3}$/.test(parts.postal_code)) {
    return 'Podaj kod pocztowy w formacie 00-000.';
  }
  const limits: Record<keyof SellerAddressParts, number> = {
    type: 20, name: 200, house: 20, apartment: 20, postal_code: 20, city: 120, country: 80,
  };
  if (sellerAddressKeys.some((key) => parts[key].length > limits[key])) return 'Skróć dane adresowe do limitów pól.';
  return '';
}

function splitStreetName(value: string): Pick<SellerAddressParts, 'type' | 'name'> {
  const line = value.trim();
  const prefix = /^(ul\.?|ulica|al\.?|aleja|aleje|pl\.?|plac|os\.?|osiedle|wieś)\s+/i.exec(line);
  const token = prefix?.[1].toLocaleLowerCase('pl-PL') || '';
  const type = /^ul/.test(token) ? 'street' : /^al/.test(token) ? 'avenue'
    : /^pl/.test(token) ? 'square' : /^os/.test(token) ? 'estate' : token === 'wieś' ? 'village' : '';
  return { type, name: prefix ? line.slice(prefix[0].length).trim() : line };
}

function splitStreetLine(value: string): Pick<SellerAddressParts, 'type' | 'name' | 'house' | 'apartment'> {
  const line = value.trim();
  const numberOnly = /^(\d+[a-zA-Z]?(?:-\d+[a-zA-Z]?)?)(?:\s*\/\s*([\w-]+)|\s+(?:m\.?|lok\.?)\s*([\w-]+))?$/.exec(line);
  const number = numberOnly ? null : /^(.*?)\s+(\d+[a-zA-Z]?(?:-\d+[a-zA-Z]?)?)(?:\s*\/\s*([\w-]+)|\s+(?:m\.?|lok\.?)\s*([\w-]+))?$/.exec(line);
  return {
    ...splitStreetName(numberOnly ? '' : number ? number[1] : line),
    house: numberOnly?.[1] || number?.[2] || '',
    apartment: numberOnly?.[2] || numberOnly?.[3] || number?.[3] || number?.[4] || '',
  };
}

// Suggestions only: a legacy free-text address is not replaced until the user
// explicitly accepts or edits its split fields.
export function suggestSellerAddress(text?: string | null): SellerAddressParts {
  let line = (text || '').trim().replace(/,\s*(Polska|Poland|PL)\s*$/i, '');
  const locality = /(?:^|[,\s])(\d{2}-\d{3})\s+([^,\n]+)$/.exec(line);
  if (locality) line = line.slice(0, locality.index).replace(/[,\s]+$/, '');
  // Do not guess at an unrecognized multi-part / foreign address.
  if (/[,\n;]/.test(line)) return { ...emptyAddress };
  return normalizeSellerAddress({
    ...splitStreetLine(line), postal_code: locality?.[1] || '', city: locality?.[2] || '',
  });
}

export function sellerAddressFromRegistry(data: GUSCompanyData): SellerAddressParts {
  const parts = data.addressParts
    ? { ...splitStreetName(data.addressParts.street), house: data.addressParts.buildingNumber, apartment: data.addressParts.apartmentNumber }
    : splitStreetLine(data.address || '');
  return normalizeSellerAddress({
    ...parts,
    name: parts.name || (parts.house ? data.city || '' : ''),
    postal_code: data.postalCode || '', city: data.city || '', country: data.country || 'Polska',
  });
}
