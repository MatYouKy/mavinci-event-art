 'use client';

import { addressTypes, normalizeProfileAddress, type ProfileAddress } from '@/components/crm/subcontractors/profileAddress';
import { formatPersonnelAddress as formatProfileAddress } from '@/lib/personnel/employeeAddress';
import { personnelInput } from '@/lib/personnel/workspace';

export function PersonnelContractAddressFields({ value, parts, onChange }: {
  value: string;
  parts?: ProfileAddress;
  onChange: (value: string, parts: ProfileAddress) => void;
}) {
  const address = normalizeProfileAddress(parts);
  const change = (key: keyof ProfileAddress, next: string) => {
    const updated = { ...address, [key]: next };
    onChange(formatProfileAddress(updated), updated);
  };
  return <fieldset className="space-y-3 rounded-lg bg-white/[0.025] p-4 sm:col-span-2">
    <legend className="text-xs">Adres strony umowy</legend>
    {!parts && value && <p className="text-xs leading-5 opacity-70">Dotychczasowy adres: {value}. Pozostanie zapisany, dopóki nie uzupełnisz pól poniżej.</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs">Typ adresu<select className={personnelInput} value={address.type} onChange={event => change('type', event.target.value)}>
        {Object.entries(addressTypes).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
      </select></label>
      <label className="text-xs">{address.type === 'village' ? 'Nazwa wsi' : 'Nazwa ulicy / placu / miejscowości'}<input className={personnelInput} value={address.name} maxLength={200} onChange={event => change('name', event.target.value)} /></label>
      <label className="text-xs">Numer budynku<input className={personnelInput} value={address.house} maxLength={30} onChange={event => change('house', event.target.value)} /></label>
      <label className="text-xs">Numer lokalu (opcjonalnie)<input className={personnelInput} value={address.apartment} maxLength={30} onChange={event => change('apartment', event.target.value)} /></label>
      <label className="text-xs">Kod pocztowy<input className={personnelInput} autoComplete="postal-code" value={address.postal_code} placeholder="00-000" onChange={event => change('postal_code', event.target.value)} /></label>
      <label className="text-xs">Miejscowość<input className={personnelInput} autoComplete="address-level2" value={address.city} maxLength={200} onChange={event => change('city', event.target.value)} /></label>
      <label className="text-xs sm:col-span-2">Kraj<input className={personnelInput} autoComplete="country-name" value={address.country} maxLength={100} onChange={event => change('country', event.target.value)} /></label>
    </div>
    {address.type === 'village' && <p className="text-xs opacity-60">Nazwa wsi będzie zapisana bez prefiksu, np. „Brzeziny 12”.</p>}
    {parts && value && <p className="text-xs leading-5 opacity-70">Adres w umowie: {value}</p>}
  </fieldset>;
}
