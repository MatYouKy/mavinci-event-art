'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Edit2, Trash2, ChevronRight, Save, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';

interface WarehouseCategory {
  id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  color: string;
  level: number;
  order_index: number;
}

export default function CategoriesPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const [categories, setCategories] = useState<WarehouseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [addingMain, setAddingMain] = useState(false);
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      const { data } = await supabase
        .from('warehouse_categories')
        .select('*')
        .eq('is_active', true)
        .order('level')
        .order('order_index');
      setCategories(data || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (category: WarehouseCategory) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditDescription(category.description || '');
  };

  const handleSave = async () => {
    if (!editingId || !editName.trim()) return;

    try {
      const { data, error } = await supabase
        .from('warehouse_categories')
        .update({
          name: editName.trim(),
          description: editDescription.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingId)
        .select();

      if (error) {
        console.error('Update error:', error);
        throw error;
      }

      showSnackbar('Zapisano zmiany', 'success');
      setEditingId(null);
      setEditName('');
      setEditDescription('');
      await fetchCategories();
    } catch (error: any) {
      console.error('Error updating category:', error);
      showSnackbar(error?.message || 'Błąd zapisu', 'error');
    }
  };

  const handleAddMain = async () => {
    if (!newName.trim()) return;

    try {
      const maxOrder = Math.max(...categories.filter(c => c.level === 1).map(c => c.order_index), -1);

      const { data, error } = await supabase
        .from('warehouse_categories')
        .insert({
          name: newName.trim(),
          description: newDescription.trim() || null,
          level: 1,
          parent_id: null,
          order_index: maxOrder + 1,
          is_active: true,
          color: '#d3bb73',
        })
        .select();

      if (error) {
        console.error('Insert error:', error);
        throw error;
      }

      showSnackbar('Dodano kategorię', 'success');
      setAddingMain(false);
      setNewName('');
      setNewDescription('');
      fetchCategories();
    } catch (error: any) {
      console.error('Error adding main category:', error);
      showSnackbar(error?.message || 'Błąd dodawania', 'error');
    }
  };

  const handleAddSub = async (parentId: string) => {
    if (!newName.trim()) return;

    try {
      const siblings = categories.filter(c => c.parent_id === parentId);
      const maxOrder = Math.max(...siblings.map(c => c.order_index), -1);

      const { data, error } = await supabase
        .from('warehouse_categories')
        .insert({
          name: newName.trim(),
          description: newDescription.trim() || null,
          level: 2,
          parent_id: parentId,
          order_index: maxOrder + 1,
          is_active: true,
          color: '#d3bb73',
        })
        .select();

      if (error) {
        console.error('Insert error:', error);
        throw error;
      }

      showSnackbar('Dodano podkategorię', 'success');
      setAddingSubFor(null);
      setNewName('');
      setNewDescription('');
      fetchCategories();
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
      const { error } = await supabase
        .from('warehouse_categories')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Delete error:', error);
        throw error;
      }

      showSnackbar('Usunięto kategorię', 'success');
      await fetchCategories();
    } catch (error: any) {
      console.error('Error deleting category:', error);
      showSnackbar(error?.message || 'Błąd usuwania', 'error');
    }
  };

  const mainCategories = categories.filter(c => c.level === 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
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
            className="p-2 hover:bg-[#1c1f33] rounded-lg text-[#e5e4e2]"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Zarządzanie kategoriami</h2>
        </div>
      </div>

      <div className="space-y-6">
        {mainCategories.map(mainCat => {
          const subcategories = categories.filter(c => c.parent_id === mainCat.id);

          return (
            <div key={mainCat.id} className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              {editingId === mainCat.id ? (
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa kategorii</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2.5 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                      placeholder="Nazwa kategorii"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis (opcjonalny)</label>
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2.5 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                      placeholder="Opis kategorii"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSave}
                      className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
                    >
                      <Save className="w-4 h-4" />
                      Zapisz
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="flex items-center gap-2 px-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg hover:border-[#d3bb73]/40"
                    >
                      <X className="w-4 h-4" />
                      Anuluj
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h3 className="text-xl font-medium text-[#e5e4e2] mb-1">{mainCat.name}</h3>
                    {mainCat.description && (
                      <p className="text-[#e5e4e2]/60 text-sm">{mainCat.description}</p>
                    )}
                    <p className="text-[#e5e4e2]/40 text-xs mt-1">
                      {subcategories.length} {subcategories.length === 1 ? 'podkategoria' : 'podkategorii'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(mainCat)}
                      className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded-lg"
                      title="Edytuj kategorię"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(mainCat.id, mainCat.name, subcategories.length > 0)}
                      className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg"
                      title="Usuń kategorię"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <h4 className="text-sm font-medium text-[#e5e4e2]/80 mb-3">Podkategorie</h4>

                {subcategories.map(subCat => (
                  <div key={subCat.id} className="bg-[#0f1119] rounded-lg p-4">
                    {editingId === subCat.id ? (
                      <div className="space-y-3">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                          placeholder="Nazwa podkategorii"
                          autoFocus
                        />
                        <input
                          type="text"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                          placeholder="Opis (opcjonalny)"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleSave}
                            className="flex items-center gap-2 px-3 py-1.5 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 text-sm"
                          >
                            <Save className="w-3.5 h-3.5" />
                            Zapisz
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg hover:border-[#d3bb73]/40 text-sm"
                          >
                            <X className="w-3.5 h-3.5" />
                            Anuluj
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <ChevronRight className="w-4 h-4 text-[#e5e4e2]/40" />
                          <div>
                            <span className="text-[#e5e4e2]">{subCat.name}</span>
                            {subCat.description && (
                              <span className="text-[#e5e4e2]/60 text-sm ml-2">— {subCat.description}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEdit(subCat)}
                            className="p-1.5 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded-lg"
                            title="Edytuj podkategorię"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(subCat.id, subCat.name, false)}
                            className="p-1.5 text-red-400 hover:bg-red-400/10 rounded-lg"
                            title="Usuń podkategorię"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {addingSubFor === mainCat.id ? (
                  <div className="bg-[#0f1119] rounded-lg p-4 space-y-3 border-2 border-[#d3bb73]/20">
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                      placeholder="Nazwa podkategorii"
                      autoFocus
                    />
                    <input
                      type="text"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                      placeholder="Opis (opcjonalny)"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAddSub(mainCat.id)}
                        className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 text-sm"
                      >
                        <Plus className="w-4 h-4" />
                        Dodaj
                      </button>
                      <button
                        onClick={() => {
                          setAddingSubFor(null);
                          setNewName('');
                          setNewDescription('');
                        }}
                        className="px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg hover:border-[#d3bb73]/40 text-sm"
                      >
                        Anuluj
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingSubFor(mainCat.id)}
                    className="w-full bg-[#0f1119] border border-dashed border-[#d3bb73]/20 rounded-lg p-4 text-[#e5e4e2]/60 hover:text-[#e5e4e2] hover:border-[#d3bb73]/40 flex items-center justify-center gap-2 text-sm"
                  >
                    <Plus className="w-4 h-4" />
                    Dodaj podkategorię
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {addingMain ? (
          <div className="bg-[#1c1f33] border-2 border-[#d3bb73]/20 rounded-xl p-6 space-y-4">
            <h3 className="text-lg font-medium text-[#e5e4e2]">Nowa kategoria główna</h3>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa kategorii</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2.5 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="np. Dekoracje, Kostiumy..."
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis (opcjonalny)</label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2.5 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="Krótki opis kategorii"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddMain}
                className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
              >
                <Plus className="w-4 h-4" />
                Dodaj kategorię
              </button>
              <button
                onClick={() => {
                  setAddingMain(false);
                  setNewName('');
                  setNewDescription('');
                }}
                className="px-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg hover:border-[#d3bb73]/40"
              >
                Anuluj
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingMain(true)}
            className="w-full bg-[#1c1f33] border border-dashed border-[#d3bb73]/20 rounded-xl p-6 text-[#e5e4e2]/60 hover:text-[#e5e4e2] hover:border-[#d3bb73]/40 flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" />
            <span className="font-medium">Dodaj nową kategorię główną</span>
          </button>
        )}
      </div>
    </div>
  );
}
