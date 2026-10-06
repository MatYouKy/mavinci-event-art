export const addressTypes = { '': 'Bez prefiksu', street: 'Ulica (ul.)', avenue: 'Aleja (al.)', square: 'Plac (pl.)', village: 'Wieś', estate: 'Osiedle (os.)' };
export const emptyAddress = { type: '', name: '', house: '', apartment: '', postal_code: '', city: '', country: 'Polska' };
export type ProfileAddress = typeof emptyAddress;
export function formatProfileAddress(address: ProfileAddress): string {
  const prefix: Record<string,string> = {street:'ul.',avenue:'al.',square:'pl.',village:'',estate:'os.'};
  const number = [address.house.trim(), address.apartment.trim()].filter(Boolean).join('/');
  const line = [address.name.trim() ? prefix[address.type] : '', address.name.trim(), number].filter(Boolean).join(' ');
  const city = [address.postal_code.trim(), address.city.trim()].filter(Boolean).join(' ');
  if (!line && !city) return '';
  return [line,city,address.country.trim()].filter(Boolean).join(', ');
}

// Recognize the former village prefix when loading existing structured addresses.
// This preserves their fields without rewriting archived contract text.
export function matchesProfileAddress(address: ProfileAddress, text: string | null | undefined): boolean {
  const formatted = formatProfileAddress(address);
  return formatted === (text || '')
    || (address.type === 'village' && Boolean(address.name.trim()) && `wieś ${formatted}` === text);
}

export function normalizeProfileAddress(value?: Partial<ProfileAddress> | null): ProfileAddress {
  return Object.fromEntries(Object.entries(emptyAddress).map(([key, fallback]) =>
    [key, typeof value?.[key as keyof ProfileAddress] === 'string' ? value[key as keyof ProfileAddress] : fallback],
  )) as ProfileAddress;
}
