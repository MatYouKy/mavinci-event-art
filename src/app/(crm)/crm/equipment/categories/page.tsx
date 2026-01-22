'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Edit2, Trash2, ChevronRight, Save, X } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import {
  useGetEquipmentCategoriesQuery,
  useCreateWarehouseCategoryMutation,
  useUpdateWarehouseCategoryMutation,
  useDeleteWarehouseCategoryMutation,
} from '@/app/(crm)/crm/equipment/store/equipmentApi';

/** ---- Types ---- **/
export interface SpecialProperty {
  name: string;
  value: boolean;
}

export interface WarehouseCategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  color: string;
  level: number;
  order_index: number;
  is_active: boolean;
  special_properties: SpecialProperty[];
  created_at?: string | null;
  updated_at?: string | null;
}

/** ---------- utils ---------- */
function sanitizeProps(list: SpecialProperty[]): SpecialProperty[] {
  const seen = new Set<string>();
  const out: SpecialProperty[] = [];
  for (const p of list ?? []) {
    const name = String(p?.name ?? '').trim();
    if (!name || seen.has(name)) continue;
    out.push({ name, value: Boolean(p?.value) });
    seen.add(name);
  }
  return out;
}

export default function CategoriesPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  // RTKQ: load categories
  const { data: categoriesRaw = [], isFetching } = useGetEquipmentCategoriesQuery();

  // ensure non-null special_properties
  const categories: WarehouseCategoryRow[] = useMemo(
    () =>
      (categoriesRaw as WarehouseCategoryRow[]).map((c) => ({
        ...c,
        special_properties: Array.isArray(c.special_properties) ? c.special_properties : [],
      })),
    [categoriesRaw],
  );

  // RTKQ: mutations
  const [createCategory, { isLoading: creating }] = useCreateWarehouseCategoryMutation();
  const [updateCategory, { isLoading: updating }] = useUpdateWarehouseCategoryMutation();
  const [deleteCategory, { isLoading: deleting }] = useDeleteWarehouseCategoryMutation();

  // editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editProps, setEditProps] = useState<SpecialProperty[]>([]);
  const [newEditPropName, setNewEditPropName] = useState('');

  // add state
  const [addingMain, setAddingMain] = useState(false);
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newProps, setNewProps] = useState<SpecialProperty[]>([]);
  const [newPropName, setNewPropName] = useState('');

  const handleEdit = (category: WarehouseCategoryRow) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditDescription(category.description ?? '');
    setEditProps(category.special_properties ?? []);
    setNewEditPropName('');
  };

  const handleSave = async () => {
    if (!editingId || !editName.trim()) return;
    try {
      await updateCategory({
        id: editingId,
        name: editName.trim(),
        description: editDescription.trim() || null,
        special_properties: sanitizeProps(editProps),
      }).unwrap();

      showSnackbar('Zapisano zmiany', 'success');
      setEditingId(null);
      setEditName('');
      setEditDescription('');
      setEditProps([]);
    } catch (error: any) {
      console.error('Error updating category:', error);
      showSnackbar(error?.message || 'Błąd zapisu', 'error');
    }
  };

  const handleAddMain = async () => {
    if (!newName.trim()) return;

    try {
      const main = categories.filter((c) => c.level === 1);
      const maxOrder = main.length ? Math.max(...main.map((c) => c.order_index)) : -1;

      await createCategory({
        name: newName.trim(),
        description: newDescription.trim() || null,
        special_properties: sanitizeProps(newProps),
        level: 1,
        parent_id: null,
        order_index: maxOrder + 1,
        color: '#d3bb73',
      }).unwrap();

      showSnackbar('Dodano kategorię', 'success');
      setAddingMain(false);
      setNewName('');
      setNewDescription('');
      setNewProps([]);
      setNewPropName('');
    } catch (error: any) {
      console.error('Error adding main category:', error);
      showSnackbar(error?.message || 'Błąd dodawania', 'error');
    }
  };

  const handleAddSub = async (parentId: string) => {
    if (!newName.trim()) return;

    try {
      const siblings = categories.filter((c) => c.parent_id === parentId);
      const maxOrder = siblings.length ? Math.max(...siblings.map((c) => c.order_index)) : -1;

      await createCategory({
        name: newName.trim(),
        description: newDescription.trim() || null,
        special_properties: sanitizeProps(newProps),
        level: 2,
        parent_id: parentId,
        order_index: maxOrder + 1,
        color: '#d3bb73',
      }).unwrap();

      showSnackbar('Dodano podkategorię', 'success');
      setAddingSubFor(null);
      setNewName('');
      setNewDescription('');
      setNewProps([]);
      setNewPropName('');
    } catch (error: any) {
      console.error('Error adding subcategory:', error);
      showSnackbar(error?.message || 'Błąd dodawania', 'error');
    }
  };

  const handleDelete = async (id: string, name: string, hasChildren: boolean) => {
    const message = hasChildren
      ? `Czy na pewno chcesz usunąć kategorię "${name}"? To usunie także wszystkie podkategorie i odłączy sprzęt.`
      : `Czy na pewno chcesz usunąć "${name}"?`;

    const confirmed = await showConfirm(message, 'Usuń');
    if (!confirmed) return;

    try {
      await deleteCategory({ id }).unwrap();
      showSnackbar('Usunięto kategorię', 'success');
    } catch (error: any) {
      console.error('Error deleting category:', error);
      showSnackbar(error?.message || 'Błąd usuwania', 'error');
    }
  };

  const mainCategories = useMemo(() => categories.filter((c) => c.level === 1), [categories]);

  if (isFetching) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/crm/equipment')}
            className="rounded-lg p-2 text-[#e5e4e2] hover:bg-[#1c1f33]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Zarządzanie kategoriami</h2>
        </div>
      </div>

      <div className="space-y-6">
        {mainCategories.map((mainCat) => {
          const subcategories = categories.filter((c) => c.parent_id === mainCat.id);

          return (
            <div
              key={mainCat.id}
              className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6"
            >
              {editingId === mainCat.id ? (
                <div className="mb-6 space-y-4">
                  <TextField
                    label="Nazwa kategorii"
                    value={editName}
                    onChange={setEditName}
                    placeholder="Nazwa kategorii"
                    autoFocus
                  />
                  <TextField
                    label="Opis (opcjonalny)"
                    value={editDescription}
                    onChange={setEditDescription}
                    placeholder="Opis kategorii"
                  />

                  <SpecialPropsEditor
                    propsList={editProps}
                    onChange={setEditProps}
                    newName={newEditPropName}
                    setNewName={setNewEditPropName}
                  />

                  <div className="flex gap-2">
                    <button
                      onClick={handleSave}
                      disabled={updating}
                      className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-60"
                    >
                      <Save className="h-4 w-4" />
                      Zapisz
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(null);
                        setEditName('');
                        setEditDescription('');
                        setEditProps([]);
                      }}
                      className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] hover:border-[#d3bb73]/40"
                    >
                      <X className="h-4 w-4" />
                      Anuluj
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mb-6 flex items-start justify-between">
                  <div>
                    <h3 className="mb-1 text-xl font-medium text-[#e5e4e2]">{mainCat.name}</h3>
                    {mainCat.description && (
                      <p className="text-sm text-[#e5e4e2]/60">{mainCat.description}</p>
                    )}
                    <PropsInline propsList={mainCat.special_properties} />
                    <p className="mt-1 text-xs text-[#e5e4e2]/40">
                      {subcategories.length}{' '}
                      {subcategories.length === 1 ? 'podkategoria' : 'podkategorii'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(mainCat)}
                      className="rounded-lg p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10"
                      title="Edytuj kategorię"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() =>
                        handleDelete(mainCat.id, mainCat.name, subcategories.length > 0)
                      }
                      disabled={deleting}
                      className="rounded-lg p-2 text-red-400 hover:bg-red-400/10 disabled:opacity-60"
                      title="Usuń kategorię"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <h4 className="mb-3 text-sm font-medium text-[#e5e4e2]/80">Podkategorie</h4>

                {subcategories.map((subCat) => (
                  <div key={subCat.id} className="rounded-lg bg-[#0f1119] p-4">
                    {editingId === subCat.id ? (
                      <div className="space-y-3">
                        <TextField
                          value={editName}
                          onChange={setEditName}
                          placeholder="Nazwa podkategorii"
                          autoFocus
                        />
                        <TextField
                          value={editDescription}
                          onChange={setEditDescription}
                          placeholder="Opis (opcjonalny)"
                        />
                        <SpecialPropsEditor
                          propsList={editProps}
                          onChange={setEditProps}
                          newName={newEditPropName}
                          setNewName={setNewEditPropName}
                          compact
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleSave}
                            disabled={updating}
                            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-sm text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-60"
                          >
                            <Save className="h-3.5 w-3.5" />
                            Zapisz
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditName('');
                              setEditDescription('');
                              setEditProps([]);
                            }}
                            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-1.5 text-sm text-[#e5e4e2] hover:border-[#d3bb73]/40"
                          >
                            <X className="h-3.5 w-3.5" />
                            Anuluj
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <ChevronRight className="h-4 w-4 text-[#e5e4e2]/40" />
                          <div>
                            <span className="text-[#e5e4e2]">{subCat.name}</span>
                            {subCat.description && (
                              <span className="ml-2 text-sm text-[#e5e4e2]/60">
                                — {subCat.description}
                              </span>
                            )}
                            <PropsInline propsList={subCat.special_properties} />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEdit(subCat)}
                            className="rounded-lg p-1.5 text-[#d3bb73] hover:bg-[#d3bb73]/10"
                            title="Edytuj podkategorię"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(subCat.id, subCat.name, false)}
                            disabled={deleting}
                            className="rounded-lg p-1.5 text-red-400 hover:bg-red-400/10 disabled:opacity-60"
                            title="Usuń podkategorię"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {addingSubFor === mainCat.id ? (
                  <div className="space-y-3 rounded-lg border-2 border-[#d3bb73]/20 bg-[#0f1119] p-4">
                    <TextField
                      value={newName}
                      onChange={setNewName}
                      placeholder="Nazwa podkategorii"
                      autoFocus
                    />
                    <TextField
                      value={newDescription}
                      onChange={setNewDescription}
                      placeholder="Opis (opcjonalny)"
                    />
                    <SpecialPropsEditor
                      propsList={newProps}
                      onChange={setNewProps}
                      newName={newPropName}
                      setNewName={setNewPropName}
                      compact
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAddSub(mainCat.id)}
                        disabled={creating}
                        className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-60"
                      >
                        <Plus className="h-4 w-4" />
                        Dodaj
                      </button>
                      <button
                        onClick={() => {
                          setAddingSubFor(null);
                          setNewName('');
                          setNewDescription('');
                          setNewProps([]);
                          setNewPropName('');
                        }}
                        className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-sm text-[#e5e4e2] hover:border-[#d3bb73]/40"
                      >
                        Anuluj
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingSubFor(mainCat.id)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#d3bb73]/20 bg-[#0f1119] p-4 text-sm text-[#e5e4e2]/60 hover:border-[#d3bb73]/40 hover:text-[#e5e4e2]"
                  >
                    <Plus className="h-4 w-4" />
                    Dodaj podkategorię
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {addingMain ? (
          <div className="space-y-4 rounded-xl border-2 border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <h3 className="text-lg font-medium text-[#e5e4e2]">Nowa kategoria główna</h3>
            <TextField
              label="Nazwa kategorii"
              value={newName}
              onChange={setNewName}
              placeholder="np. Dekoracje, Kostiumy..."
              autoFocus
            />
            <TextField
              label="Opis (opcjonalny)"
              value={newDescription}
              onChange={setNewDescription}
              placeholder="Krótki opis kategorii"
            />
            <SpecialPropsEditor
              propsList={newProps}
              onChange={setNewProps}
              newName={newPropName}
              setNewName={setNewPropName}
            />
            <div className="flex gap-2">
              <button
                onClick={handleAddMain}
                disabled={creating}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                Dodaj kategorię
              </button>
              <button
                onClick={() => {
                  setAddingMain(false);
                  setNewName('');
                  setNewDescription('');
                  setNewProps([]);
                  setNewPropName('');
                }}
                className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] hover:border-[#d3bb73]/40"
              >
                Anuluj
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingMain(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#d3bb73]/20 bg-[#1c1f33] p-6 text-[#e5e4e2]/60 hover:border-[#d3bb73]/40 hover:text-[#e5e4e2]"
          >
            <Plus className="h-5 w-5" />
            <span className="font-medium">Dodaj nową kategorię główną</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** ---------- Small UI helpers ---------- */

function TextField({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      {label && <label className="mb-2 block text-sm text-[#e5e4e2]/60">{label}</label>}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2.5 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
    </div>
  );
}

function PropsInline({ propsList }: { propsList: SpecialProperty[] }) {
  const active = propsList?.filter((p) => p.value);
  if (!active?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {active.map((p) => (
        <span
          key={p.name}
          className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-[10px] uppercase tracking-wide text-[#e5e4e2]/80"
        >
          {p.name}
        </span>
      ))}
    </div>
  );
}

function SpecialPropsEditor({
  propsList,
  onChange,
  newName,
  setNewName,
  compact,
}: {
  propsList: SpecialProperty[];
  onChange: (list: SpecialProperty[]) => void;
  newName: string;
  setNewName: (v: string) => void;
  compact?: boolean;
}) {
  const toggle = (name: string) => {
    const next = [...propsList];
    const idx = next.findIndex((p) => p.name === name);
    if (idx >= 0) next[idx] = { ...next[idx], value: !next[idx].value };
    onChange(next);
  };

  const remove = (name: string) => {
    onChange(propsList.filter((p) => p.name !== name));
  };

  const add = () => {
    const clean = newName.trim();
    if (!clean) return;
    if (propsList.some((p) => p.name === clean)) {
      setNewName('');
      return;
    }
    onChange([...propsList, { name: clean, value: true }]);
    setNewName('');
  };

  return (
    <div
      className={`rounded-lg ${compact ? 'p-3' : 'p-4'} border border-[#d3bb73]/15 bg-[#0f1119]`}
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
          placeholder="Dodaj właściwość (np. simple_quantity, requires_serial)"
        />
        <button
          onClick={add}
          className="rounded bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] hover:bg-[#d3bb73]/90"
        >
          Dodaj
        </button>
      </div>

      {!!propsList.length && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {propsList.map((p) => (
            <label
              key={p.name}
              className="flex items-center justify-between gap-3 rounded border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={p.value}
                  onChange={() => toggle(p.name)}
                  className="h-4 w-4 rounded border border-[#d3bb73]/30 bg-[#0f1119]"
                />
                <span className="text-sm text-[#e5e4e2]/90">{p.name}</span>
              </div>
              <button
                type="button"
                onClick={() => remove(p.name)}
                className="text-xs text-[#e5e4e2]/50 hover:text-red-400"
                title="Usuń właściwość"
              >
                Usuń
              </button>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
