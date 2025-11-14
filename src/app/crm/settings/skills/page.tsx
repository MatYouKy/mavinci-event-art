'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Edit, Trash2, BookOpen, Tag } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface SkillCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  created_at: string;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  category_id: string;
  icon: string;
  is_active: boolean;
  skill_categories?: SkillCategory;
}

export default function SkillsManagementPage() {
  const router = useRouter();
  const { isAdmin } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();

  const [categories, setCategories] = useState<SkillCategory[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<SkillCategory | null>(null);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  useEffect(() => {
    fetchCategories();
    fetchSkills();
  }, []);

  const fetchCategories = async () => {
    const { data } = await supabase.from('skill_categories').select('*').order('name');
    if (data) setCategories(data);
  };

  const fetchSkills = async () => {
    setLoading(true);
    const { data } = await supabase.from('skills').select('*, skill_categories(*)').order('name');
    if (data) setSkills(data);
    setLoading(false);
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Czy na pewno usunąć tę kategorię?')) return;

    const { error } = await supabase.from('skill_categories').delete().eq('id', id);

    if (error) {
      showSnackbar('Błąd usuwania kategorii', 'error');
    } else {
      showSnackbar('Kategoria usunięta', 'success');
      fetchCategories();
    }
  };

  const handleDeleteSkill = async (id: string) => {
    if (!confirm('Czy na pewno usunąć tę umiejętność?')) return;

    const { error } = await supabase.from('skills').delete().eq('id', id);

    if (error) {
      showSnackbar('Błąd usuwania umiejętności', 'error');
    } else {
      showSnackbar('Umiejętność usunięta', 'success');
      fetchSkills();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/crm/settings')}
          className="rounded-lg p-2 transition-colors hover:bg-[#1c1f33]"
        >
          <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
        </button>
        <h1 className="text-2xl font-light text-[#e5e4e2]">Zarządzanie umiejętnościami</h1>
      </div>

      {/* Kategorie */}
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Kategorie umiejętności</h2>
          </div>
          {isAdmin && (
            <button
              onClick={() => {
                setEditingCategory(null);
                setShowCategoryModal(true);
              }}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/20 px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/30"
            >
              <Plus className="h-4 w-4" />
              Dodaj kategorię
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <div key={cat.id} className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
              <div className="mb-2 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{ backgroundColor: cat.color + '20' }}
                  >
                    <span className="text-lg" style={{ color: cat.color }}>
                      ●
                    </span>
                  </div>
                  <h3 className="font-medium text-[#e5e4e2]">{cat.name}</h3>
                </div>
                {isAdmin && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingCategory(cat);
                        setShowCategoryModal(true);
                      }}
                      className="text-[#d3bb73] hover:text-[#d3bb73]/80"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              <p className="text-xs text-[#e5e4e2]/60">{cat.description}</p>
              <p className="mt-2 text-xs text-[#d3bb73]">
                {skills.filter((s) => s.category_id === cat.id).length} umiejętności
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Umiejętności */}
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Umiejętności</h2>
          </div>
          {isAdmin && (
            <button
              onClick={() => {
                setEditingSkill(null);
                setShowSkillModal(true);
              }}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/20 px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/30"
            >
              <Plus className="h-4 w-4" />
              Dodaj umiejętność
            </button>
          )}
        </div>

        {loading ? (
          <p className="py-8 text-center text-[#e5e4e2]/60">Ładowanie...</p>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-center justify-between rounded-lg bg-[#0a0d1a] p-3"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: skill.skill_categories?.color || '#d3bb73' }}
                  ></div>
                  <div>
                    <div className="font-medium text-[#e5e4e2]">{skill.name}</div>
                    {skill.description && (
                      <div className="text-xs text-[#e5e4e2]/60">{skill.description}</div>
                    )}
                    <div className="mt-1 text-xs text-[#e5e4e2]/40">
                      {skill.skill_categories?.name}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {!skill.is_active && (
                    <span className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-400">
                      Nieaktywna
                    </span>
                  )}
                  {isAdmin && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingSkill(skill);
                          setShowSkillModal(true);
                        }}
                        className="text-[#d3bb73] hover:text-[#d3bb73]/80"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteSkill(skill.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCategoryModal && (
        <CategoryModal
          category={editingCategory}
          onClose={() => {
            setShowCategoryModal(false);
            setEditingCategory(null);
          }}
          onSuccess={() => {
            fetchCategories();
            setShowCategoryModal(false);
            setEditingCategory(null);
          }}
        />
      )}

      {showSkillModal && (
        <SkillModal
          skill={editingSkill}
          categories={categories}
          onClose={() => {
            setShowSkillModal(false);
            setEditingSkill(null);
          }}
          onSuccess={() => {
            fetchSkills();
            setShowSkillModal(false);
            setEditingSkill(null);
          }}
        />
      )}
    </div>
  );
}

function CategoryModal({
  category,
  onClose,
  onSuccess,
}: {
  category: SkillCategory | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(category?.name || '');
  const [description, setDescription] = useState(category?.description || '');
  const [color, setColor] = useState(category?.color || '#d3bb73');
  const [loading, setLoading] = useState(false);
  const { showSnackbar } = useSnackbar();

  const handleSubmit = async () => {
    if (!name) {
      showSnackbar('Podaj nazwę kategorii', 'error');
      return;
    }

    setLoading(true);
    try {
      if (category) {
        const { error } = await supabase
          .from('skill_categories')
          .update({ name, description, color })
          .eq('id', category.id);
        if (error) throw error;
        showSnackbar('Kategoria zaktualizowana', 'success');
      } else {
        const { error } = await supabase
          .from('skill_categories')
          .insert({ name, description, color });
        if (error) throw error;
        showSnackbar('Kategoria dodana', 'success');
      }
      onSuccess();
    } catch (error) {
      console.error(error);
      showSnackbar('Błąd zapisu kategorii', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="border-b border-[#d3bb73]/10 p-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">
            {category ? 'Edytuj kategorię' : 'Nowa kategoria'}
          </h3>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kolor</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a]"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[#d3bb73]/10 p-6">
          <button
            onClick={onClose}
            className="rounded-lg bg-[#e5e4e2]/10 px-6 py-2 text-[#e5e4e2] hover:bg-[#e5e4e2]/20"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Zapisuję...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SkillModal({
  skill,
  categories,
  onClose,
  onSuccess,
}: {
  skill: Skill | null;
  categories: SkillCategory[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(skill?.name || '');
  const [description, setDescription] = useState(skill?.description || '');
  const [categoryId, setCategoryId] = useState(skill?.category_id || '');
  const [isActive, setIsActive] = useState(skill?.is_active ?? true);
  const [loading, setLoading] = useState(false);
  const { showSnackbar } = useSnackbar();

  const handleSubmit = async () => {
    if (!name) {
      showSnackbar('Podaj nazwę umiejętności', 'error');
      return;
    }

    setLoading(true);
    try {
      if (skill) {
        const { error } = await supabase
          .from('skills')
          .update({ name, description, category_id: categoryId || null, is_active: isActive })
          .eq('id', skill.id);
        if (error) throw error;
        showSnackbar('Umiejętność zaktualizowana', 'success');
      } else {
        const { error } = await supabase
          .from('skills')
          .insert({ name, description, category_id: categoryId || null, is_active: isActive });
        if (error) throw error;
        showSnackbar('Umiejętność dodana', 'success');
      }
      onSuccess();
    } catch (error) {
      console.error(error);
      showSnackbar('Błąd zapisu umiejętności', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="border-b border-[#d3bb73]/10 p-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">
            {skill ? 'Edytuj umiejętność' : 'Nowa umiejętność'}
          </h3>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Obsługa konsolet GrandMA"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Dodatkowe informacje o umiejętności..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kategoria</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
            >
              <option value="">Brak kategorii</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
              />
              <span className="text-sm text-[#e5e4e2]">Aktywna</span>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[#d3bb73]/10 p-6">
          <button
            onClick={onClose}
            className="rounded-lg bg-[#e5e4e2]/10 px-6 py-2 text-[#e5e4e2] hover:bg-[#e5e4e2]/20"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Zapisuję...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
