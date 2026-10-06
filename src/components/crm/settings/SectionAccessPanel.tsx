'use client';

import RecordScopeSelect, { RECORD_SCOPE_MODULES } from './RecordScopeSelect';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import SearchCombobox from '@/components/crm/SearchCombobox';
import { ACCESS_SECTIONS, sectionPermissions } from '@/lib/accessSections';
import { isAdmin } from '@/lib/permissions';
import { getPermissionLabel } from '@/lib/permissionCatalog';
import { supabase } from '@/lib/supabase/browser';
import { Modal } from '@/components/UI/Modal';
import { useSnackbar } from '@/contexts/SnackbarContext';

type Person = { id: string; name: string; surname: string; role: string; access_level: string; permissions: string[]; is_active: boolean; role_permissions_inherited: boolean };

export default function SectionAccessPanel() {
  const [people, setPeople] = useState<Person[]>([]);
  const [module, setModule] = useState('contracts');
  const [search, setSearch] = useState('');
  const [onlyAssigned, setOnlyAssigned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const { showSnackbar } = useSnackbar();
  const section = ACCESS_SECTIONS.find(item => item.key === module)!;

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('employees').select('id,name,surname,role,access_level,permissions,is_active,role_permissions_inherited').order('surname');
    if (error) setError('Nie udało się pobrać dostępów pracowników.');
    else { setPeople((data || []) as Person[]); setError(''); }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase.channel('section-access-employees').on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => { void load(); }).subscribe();
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { void supabase.removeChannel(channel); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const closeEditor = () => {
    if (saving) return;
    setAdding(false); setEditing(null); setSelected([]);
  };
  const hasSelectedAccess = selected.some(scope => !scope.endsWith('_own_only'));
  const candidates = people.filter(person => person.is_active && !isAdmin(person as any));

  const save = async () => {
    if (!editing || saving || (adding && !hasSelectedAccess)) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('admin_set_employee_section_permissions', {
        p_employee_id: editing.id, p_module: module, p_permissions: selected,
        p_expected_permissions: sectionPermissions(editing.permissions, module),
      });
      if (error) throw error;
      if (adding) setSearch('');
      setAdding(false);
      setEditing(null);
      await load();
      showSnackbar('Zapisano uprawnienia pracownika', 'success');
    } catch (error: any) { showSnackbar(error?.message || 'Nie udało się zapisać uprawnień', 'error'); }
    finally { setSaving(false); }
  };

  const filtered = people.filter(person => {
    const matches = `${person.name || ''} ${person.surname || ''}`.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl'));
    return matches && (!onlyAssigned || isAdmin(person as any) || sectionPermissions(person.permissions, module).some(scope => !scope.endsWith('_own_only')));
  });

  return <section className="space-y-4 rounded-xl bg-[#1c1f33] p-4 md:p-5">
    <div><h2 className="text-xl">Dostęp według sekcji</h2><p className="mt-2 text-sm text-[#e5e4e2]/60">Te same zakresy są widoczne w profilu pracownika, w zakładce Uprawnienia. Podstrony sekcji korzystają z jej zakresów; dodatkowe ograniczenia marek i danych nadal obowiązują.</p></div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex flex-col gap-1 text-sm">Sekcja<select disabled={adding || Boolean(editing)} value={module} onChange={event => setModule(event.target.value)} className="rounded-lg bg-[#0f1119] p-2">{ACCESS_SECTIONS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <label className="flex flex-1 flex-col gap-1 text-sm">Pracownik<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Szukaj po imieniu i nazwisku" className="min-w-48 rounded-lg bg-[#0f1119] p-2" /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyAssigned} onChange={event => setOnlyAssigned(event.target.checked)} />Tylko osoby z nadanym dostępem</label>
    </div>
    <button type="button" disabled={loading || Boolean(error)} onClick={() => { setAdding(true); setEditing(null); setSelected([]); }} className="rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#210811] disabled:opacity-50">Dodaj dostęp pracownikowi</button>
    <details className="text-sm text-[#e5e4e2]/60"><summary className="cursor-pointer text-[#d3bb73]">Podstrony sekcji ({section.paths.length})</summary><ul className="mt-2 space-y-1">{section.paths.map(path => <li key={path}>{path}</li>)}</ul></details>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {loading ? <p>Ładowanie dostępów…</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-[#e5e4e2]/50"><tr><th className="p-3">Pracownik</th><th className="p-3">Zakres dostępu</th><th className="p-3">Źródło</th><th className="p-3">Akcje</th></tr></thead><tbody>
      {filtered.map(person => <tr key={person.id} className="border-t border-white/5">
        <td className="p-3"><Link className="text-[#d3bb73] hover:underline" href={`/crm/employees/${person.id}?tab=permissions`}>{person.name} {person.surname}</Link>{!person.is_active && <span className="ml-2 text-[#e5e4e2]/50">Nieaktywny — brak dostępu</span>}</td>
        <td className="p-3">{isAdmin(person as any) ? 'Pełny dostęp administratora' : !sectionPermissions(person.permissions, module).some(scope => !scope.endsWith('_own_only')) ? 'Brak dostępu' : [...sectionPermissions(person.permissions, module).filter(scope => !scope.endsWith('_own_only')).map(getPermissionLabel), ...(RECORD_SCOPE_MODULES.includes(module) ? [person.permissions?.includes(`${module}_own_only`) ? 'Tylko własne' : 'Wszystkie dostępne'] : [])].join(' · ') || 'Brak dostępu'}</td>
        <td className="p-3 text-[#e5e4e2]/60">{isAdmin(person as any) ? 'Administrator' : person.role_permissions_inherited ? 'Pakiet roli' : 'Indywidualne'}</td>
        <td className="p-3">{!isAdmin(person as any) && <button className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-[#d3bb73]" onClick={() => { setEditing(person); setSelected(sectionPermissions(person.permissions, module)); }}>Zmień dostęp</button>}</td>
      </tr>)}
    </tbody></table>{!filtered.length && <p className="p-4 text-[#e5e4e2]/60">Brak pasujących osób. Użyj „Dodaj dostęp pracownikowi”, aby nadać uprawnienia do tej sekcji.</p>}</div>}
    <Modal open={adding || Boolean(editing)} onClose={closeEditor} title={adding ? `Dodaj dostęp — ${section.label}` : `${section.label} — ${editing?.name || ''} ${editing?.surname || ''}`}>
      <div className={`space-y-3 ${adding && !editing && candidates.length ? 'min-h-80' : ''}`}>
      {adding && <div className="space-y-2">
        <p className="text-sm">Pracownik</p>
        <SearchCombobox value={editing?.id || ''} disabled={saving} ariaLabel="Wybierz pracownika do nadania dostępu" placeholder="Wyszukaj pracownika po imieniu lub nazwisku"
          options={candidates.map(person => ({ id: person.id, label: `${person.name || ''} ${person.surname || ''}`.trim(), description: sectionPermissions(person.permissions, module).some(scope => !scope.endsWith('_own_only')) ? 'Ma już dostęp — możesz rozszerzyć zakres' : 'Brak dostępu do tej sekcji' }))}
          onChange={id => { const person = candidates.find(item => item.id === id) || null; setEditing(person); setSelected(person ? sectionPermissions(person.permissions, module) : []); }}
          emptyLabel="Brak pasujących aktywnych pracowników" />
        {!candidates.length && <p className="text-sm text-[#e5e4e2]/60">Brak aktywnych pracowników do dodania. Administratorzy mają już pełny dostęp.</p>}
      </div>}
      {editing && <>{section.scopes.filter(scope => !scope.key.endsWith('_own_only')).map(scope => <label key={scope.key} className="flex items-start gap-3 rounded-lg bg-[#0f1119] p-3"><input type="checkbox" disabled={saving} checked={selected.includes(scope.key)} onChange={event => setSelected(current => event.target.checked ? [...current, scope.key] : current.filter(key => key !== scope.key))} /><span>{scope.label}<span className="mt-1 block text-xs text-[#e5e4e2]/60">{scope.description}</span></span></label>)}
      <RecordScopeSelect module={module} permissions={selected} onChange={setSelected} disabled={saving} />
      <p className="text-sm text-[#e5e4e2]/60">Zapis zmienia tylko tę sekcję. Ręczna zmiana oznaczy uprawnienia jako indywidualny wyjątek od pakietu roli. Zarządzanie obejmuje podgląd i tworzenie.</p>
      {adding && !hasSelectedAccess && <p className="text-sm text-[#d3bb73]">Zaznacz co najmniej jedno uprawnienie, aby nadać dostęp.</p>}
      </>}
      <div className="flex flex-wrap gap-3">{!adding && <button disabled={saving} onClick={() => setSelected([])} className="rounded-lg bg-red-500/10 px-4 py-2 text-red-300">Odbierz dostęp do sekcji</button>}<button disabled={saving || !editing || (adding && !hasSelectedAccess)} onClick={save} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#210811] disabled:opacity-50">{saving ? 'Zapisywanie…' : adding ? 'Zapisz dostęp' : 'Zapisz zakresy'}</button><button type="button" disabled={saving} onClick={closeEditor} className="rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-[#d3bb73]">Anuluj</button></div></div>
    </Modal>
  </section>;
}
