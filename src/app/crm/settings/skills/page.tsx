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
    const { data } = await supabase
      .from('skill_categories')
      .select('*')
      .order('name');
    if (data) setCategories(data);
  };

  const fetchSkills = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('skills')
      .select('*, skill_categories(*)')
      .order('name');
    if (data) setSkills(data);
    setLoading(false);
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Czy na pewno usunąć tę kategorię?')) return;

    const { error } = await supabase
      .from('skill_categories')
      .delete()
      .eq('id', id);

    if (error) {
      showSnackbar('Błąd usuwania kategorii', 'error');
    } else {
      showSnackbar('Kategoria usunięta', 'success');
      fetchCategories();
    }
  };

  const handleDeleteSkill = async (id: string) => {
    if (!confirm('Czy na pewno usunąć tę umiejętność?')) return;

    const { error } = await supabase
      .from('skills')
      .delete()
      .eq('id', id);

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
          className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-[#e5e4e2]" />
        </button>
        <h1 className="text-2xl font-light text-[#e5e4e2]">Zarządzanie umiejętnościami</h1>
      </div>

      {/* Kategorie */}
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Kategorie umiejętności</h2>
          </div>
          {isAdmin && (
            <button
              onClick={() => {
                setEditingCategory(null);
                setShowCategoryModal(true);
              }}
              className="px-4 py-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 text-sm flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Dodaj kategorię
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((cat) => (
            <div key={cat.id} className="p-4 bg-[#0a0d1a] rounded-lg border border-[#d3bb73]/10">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: cat.color + '20' }}>
                    <span className="text-lg" style={{ color: cat.color }}>●</span>
                  </div>
                  <h3 className="text-[#e5e4e2] font-medium">{cat.name}</h3>
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
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              <p className="text-xs text-[#e5e4e2]/60">{cat.description}</p>
              <p className="text-xs text-[#d3bb73] mt-2">
                {skills.filter(s => s.category_id === cat.id).length} umiejętności
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Umiejętności */}
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Umiejętności</h2>
          </div>
          {isAdmin && (
            <button
              onClick={() => {
                setEditingSkill(null);
                setShowSkillModal(true);
              }}
              className="px-4 py-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 text-sm flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Dodaj umiejętność
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-center text-[#e5e4e2]/60 py-8">Ładowanie...</p>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
              <div key={skill.id} className="flex items-center justify-between p-3 bg-[#0a0d1a] rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: skill.skill_categories?.color || '#d3bb73' }}></div>
                  <div>
                    <div className="text-[#e5e4e2] font-medium">{skill.name}</div>
                    {skill.description && (
                      <div className="text-xs text-[#e5e4e2]/60">{skill.description}</div>
                    )}
                    <div className="text-xs text-[#e5e4e2]/40 mt-1">{skill.skill_categories?.name}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {!skill.is_active && (
                    <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs">Nieaktywna</span>
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
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteSkill(skill.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4" />
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

function CategoryModal({ category, onClose, onSuccess }: { category: SkillCategory | null; onClose: () => void; onSuccess: () => void }) {
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-lg w-full">
        <div className="p-6 border-b border-[#d3bb73]/10">
          <h3 className="text-xl font-light text-[#e5e4e2]">
            {category ? 'Edytuj kategorię' : 'Nowa kategoria'}
          </h3>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Kolor</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-full h-10 bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg"
            />
          </div>
        </div>

        <div className="p-6 border-t border-[#d3bb73]/10 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Zapisuję...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SkillModal({ skill, categories, onClose, onSuccess }: { skill: Skill | null; categories: SkillCategory[]; onClose: () => void; onSuccess: () => void }) {
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-lg w-full">
        <div className="p-6 border-b border-[#d3bb73]/10">
          <h3 className="text-xl font-light text-[#e5e4e2]">
            {skill ? 'Edytuj umiejętność' : 'Nowa umiejętność'}
          </h3>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Obsługa konsolet GrandMA"
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Dodatkowe informacje o umiejętności..."
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Kategoria</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            >
              <option value="">Brak kategorii</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
              />
              <span className="text-sm text-[#e5e4e2]">Aktywna</span>
            </label>
          </div>
        </div>

        <div className="p-6 border-t border-[#d3bb73]/10 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Zapisuję...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
