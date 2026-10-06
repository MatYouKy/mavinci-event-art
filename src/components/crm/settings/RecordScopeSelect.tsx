"use client";

export const RECORD_SCOPE_MODULES = ['contracts', 'offers', 'events'];
export default function RecordScopeSelect({ module, permissions, onChange, disabled = false }: {
  module: string; permissions: string[]; onChange: (permissions: string[]) => void; disabled?: boolean;
}) {
  if (!RECORD_SCOPE_MODULES.includes(module)) return null;
  const key = `${module}_own_only`;
  return <label className="block rounded-lg bg-[#0f1119] p-3">
    <span className="mb-2 block">Zakres danych</span>
    <select className="w-full rounded-lg bg-[#210811] px-3 py-2" disabled={disabled}
      value={permissions.includes(key) ? 'own' : 'all'}
      onChange={event => onChange([...permissions.filter(item => item !== key), ...(event.target.value === 'own' ? [key] : [])])}>
      <option value="own">Tylko własne</option><option value="all">Wszystkie dostępne w firmie</option>
    </select>
    {module === 'events' && <span className="mt-2 block text-sm text-[#e5e4e2]/60">Uprawnienie „Zarządzanie magazynem” daje dodatkowo dostęp do zaakceptowanych realizacji przypisanych marek.</span>}
    <span className="mt-2 block text-sm text-[#e5e4e2]/60">Własne: utworzone przez pracownika lub przypisane mu jako opiekun/sprzedawca. Zakres dotyczy także edycji i nie rozszerza dostępu do marek. Uprawnienia do działań ustawiasz osobno.</span>
  </label>;
}
