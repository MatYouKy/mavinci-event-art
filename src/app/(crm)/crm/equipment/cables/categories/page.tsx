'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FolderTree, Plus, Pencil } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useAppDispatch } from '@/store/hooks';
import { supabase } from '@/lib/supabase/browser';
import { equipmentApi } from '../../store/equipmentApi';

type Category = { id: string; parent_id: string | null; name: string; description: string | null; color: string; order_index: number; is_active: boolean };
type Draft = { id: string; existing: boolean; parent_id: string; name: string; description: string; color: string; order_index: string; is_active: boolean };
const fields = 'id,parent_id,name,description,color,order_index,is_active';
const input = 'w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm';
const sortCategories = (rows: Category[]) => [...rows].sort((a,b) => a.order_index-b.order_index || a.name.localeCompare(b.name,'pl'));

export default function CableCategoriesPage() {
  const { canManageModule, loading: permissionsLoading } = useCurrentEmployee();
  const canManage = canManageModule('equipment');
  const { showSnackbar } = useSnackbar();
  const dispatch = useAppDispatch();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);

  useEffect(() => {
    let active = true;
    if (permissionsLoading || !canManage) return;
    setLoading(true); setLoadError('');
    void (async () => {
      try {
        const result = await supabase.from('cable_categories').select(fields).order('order_index').order('name');
        if (result.error) throw result.error;
        if (active) setCategories(result.data || []);
      } catch { if (active) setLoadError('Nie udało się pobrać kategorii przewodów.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [permissionsLoading, canManage, attempt]);

  const open = (category?: Category, parentId = '') => {
    const siblings = categories.filter(row => (row.parent_id || '') === parentId);
    setError('');
    setDraft(category ? { ...category, existing: true, parent_id: category.parent_id || '', description: category.description || '', order_index: String(category.order_index) }
      : { id: crypto.randomUUID(), existing: false, parent_id: parentId, name: '', description: '', color: categories.find(row => row.id === parentId)?.color || '#d3bb73', order_index: String(Math.max(0,...siblings.map(row => row.order_index)) + 10), is_active: true });
  };
  const close = () => { if (!lock.current) setDraft(null); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || lock.current || !canManage) return;
    const name = draft.name.trim();
    const order = Number(draft.order_index);
    if (!name || !Number.isInteger(order) || Math.abs(order) > 2147483647) { setError('Podaj nazwę i całkowitą liczbę określającą kolejność.'); return; }
    const children = categories.filter(row => row.parent_id === draft.id);
    const parent = categories.find(row => row.id === draft.parent_id);
    if (draft.parent_id && (!parent || parent.parent_id || parent.id === draft.id || children.length)) { setError('Wybierz grupę główną. Kategoria z podkategoriami musi pozostać grupą główną.'); return; }
    if (draft.is_active && parent && !parent.is_active) { setError('Najpierw włącz grupę nadrzędną.'); return; }
    if (!draft.is_active && children.some(row => row.is_active)) { setError('Najpierw wyłącz aktywne podkategorie tej grupy.'); return; }
    if (categories.some(row => row.id !== draft.id && (row.parent_id || '') === draft.parent_id && row.name.trim().toLocaleLowerCase('pl-PL') === name.toLocaleLowerCase('pl-PL'))) { setError('Kategoria o tej nazwie już istnieje w wybranej grupie.'); return; }
    lock.current = true; setSaving(true); setError('');
    try {
      const payload = { name, parent_id: draft.parent_id || null, description: draft.description.trim() || null, color: draft.color, order_index: order, is_active: draft.is_active, updated_at: new Date().toISOString() };
      const result = draft.existing
        ? await supabase.from('cable_categories').update(payload).eq('id', draft.id).select(fields).single()
        : await supabase.from('cable_categories').upsert({ ...payload, id: draft.id, slug: `custom-${draft.id}` }, { onConflict: 'id' }).select(fields).single();
      if (result.error) throw result.error;
      setCategories(previous => sortCategories([...previous.filter(row => row.id !== draft.id), result.data as Category]));
      dispatch(equipmentApi.util.invalidateTags(['CableCategories','CablesList','Equipment','EquipmentList']));
      setDraft(null);
      showSnackbar(draft.existing ? 'Zapisano kategorię przewodów.' : 'Dodano kategorię przewodów.', 'success');
    } catch (cause: any) {
      setError(cause?.code === '42501' ? 'Brak uprawnień do zapisu. Sprawdź uprawnienia do sprzętu i wdrożenie migracji kategorii.' : cause?.message || 'Nie udało się zapisać kategorii.');
    } finally { lock.current = false; setSaving(false); }
  };

  if (permissionsLoading) return <p className="p-6">Wczytywanie…</p>;
  if (!canManage) return <div className="p-6"><Link href="/crm/equipment/cables" className="text-[#d3bb73]">Wróć do przewodów</Link><p className="mt-4">Zarządzanie kategoriami wymaga uprawnień do zarządzania sprzętem.</p></div>;
  const matches = (row: Category) => `${row.name} ${row.description || ''}`.toLocaleLowerCase('pl-PL').includes(search.trim().toLocaleLowerCase('pl-PL'));
  const roots = categories.filter(row => !row.parent_id && (matches(row) || categories.some(child => child.parent_id === row.id && matches(child))));
  const row = (category: Category) => <div className="flex flex-wrap items-center justify-between gap-3 p-4">
    <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: category.color }} /><span className="break-words">{category.name}</span>{!category.is_active && <span className="rounded bg-white/5 px-2 py-1 text-xs text-white/45">Nieaktywna</span>}</div>{category.description && <p className="mt-1 text-sm text-white/50">{category.description}</p>}</div>
    <div className="flex items-center gap-2"><span className="text-xs text-white/40">Kolejność: {category.order_index}</span>{!category.parent_id && category.is_active && <button type="button" onClick={() => open(undefined,category.id)} className="rounded-lg px-3 py-2 text-sm text-[#d3bb73] hover:bg-white/5">Dodaj podkategorię</button>}<button type="button" onClick={() => open(category)} className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-3 py-2 text-sm"><Pencil className="h-4 w-4" />Edytuj</button></div>
  </div>;
  return <div className="w-full space-y-5 p-4 text-[#e5e4e2] sm:p-6">
    <Link href="/crm/equipment/cables" className="inline-flex items-center gap-2 text-sm text-[#d3bb73]"><ArrowLeft className="h-4 w-4" />Wróć do przewodów</Link>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="flex items-center gap-2 text-2xl"><FolderTree className="h-6 w-6" />Kategorie przewodów</h1><button type="button" disabled={loading || Boolean(loadError)} onClick={() => open()} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#250914] disabled:opacity-40"><Plus className="h-4 w-4" />Dodaj kategorię</button></div>
    <p className="text-sm text-white/60">Przeznaczenie techniczne wybierane podczas dodawania i edycji przewodów. Nieaktywne kategorie pozostają przy istniejących przewodach, ale nie są dostępne do nowych przypisań.</p>
    <input type="search" aria-label="Szukaj kategorii" placeholder="Szukaj kategorii…" value={search} onChange={event => setSearch(event.target.value)} className={input} />
    {loading ? <p>Wczytywanie kategorii…</p> : loadError ? <div role="alert"><p>{loadError}</p><button type="button" onClick={() => setAttempt(value => value+1)} className="mt-2 text-[#d3bb73]">Spróbuj ponownie</button></div> : <div className="space-y-4">{roots.map(parent => <section key={parent.id} className="overflow-hidden rounded-xl bg-[#1c1f33]">{row(parent)}<div className="ml-4 bg-black/15 sm:ml-8">{categories.filter(child => child.parent_id === parent.id && (matches(parent) || matches(child))).map(child => <div key={child.id} className="border-t border-white/5">{row(child)}</div>)}</div></section>)}{!roots.length && <p className="text-sm text-white/50">Brak kategorii pasujących do wyszukiwania.</p>}</div>}
    {draft && <Modal open onClose={close} title={draft.existing ? 'Edytuj kategorię przewodów' : 'Dodaj kategorię przewodów'}>
      <form onSubmit={save} className="space-y-4 text-sm">
        <label className="block space-y-1"><span>Nazwa</span><input autoFocus required maxLength={150} value={draft.name} disabled={saving} onChange={event => setDraft({ ...draft,name:event.target.value })} className={input} /></label>
        <label className="block space-y-1"><span>Grupa nadrzędna</span><select value={draft.parent_id} disabled={saving || categories.some(row => row.parent_id === draft.id)} onChange={event => setDraft({ ...draft,parent_id:event.target.value })} className={input}><option value="">Brak — kategoria główna</option>{categories.filter(row => !row.parent_id && row.id !== draft.id && (row.is_active || row.id === draft.parent_id)).map(row => <option key={row.id} value={row.id}>{row.name}{row.is_active ? '' : ' (nieaktywna)'}</option>)}</select></label>
        <label className="block space-y-1"><span>Opis</span><textarea rows={3} value={draft.description} disabled={saving} onChange={event => setDraft({ ...draft,description:event.target.value })} className={input} /></label>
        <div className="grid grid-cols-2 gap-4"><label className="block space-y-1"><span>Kolor</span><input type="color" value={draft.color} disabled={saving} onChange={event => setDraft({ ...draft,color:event.target.value })} className="block h-10 w-16 rounded bg-transparent" /></label><label className="block space-y-1"><span>Kolejność</span><input type="number" required step="1" value={draft.order_index} disabled={saving} onChange={event => setDraft({ ...draft,order_index:event.target.value })} className={input} /></label></div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.is_active} disabled={saving} onChange={event => setDraft({ ...draft,is_active:event.target.checked })} />Aktywna — dostępna przy przypisywaniu przewodów</label>
        {error && <p role="alert" className="text-amber-200">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={close} className="rounded-lg bg-white/5 px-4 py-2">Anuluj</button><button type="submit" disabled={saving} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#250914] disabled:opacity-40">{saving ? 'Zapisywanie…' : 'Zapisz'}</button></div>
      </form>
    </Modal>}
  </div>;
}
