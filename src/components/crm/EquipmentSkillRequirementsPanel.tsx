'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Brain, AlertCircle, User as UserIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import TaskAssigneeAvatars from '@/components/crm/TaskAssigneeAvatars';

interface SkillRequirement {
  id: string;
  minimum_proficiency: 'basic' | 'intermediate' | 'advanced' | 'expert';
  is_required: boolean;
  notes: string | null;
  skill: {
    id: string;
    name: string;
    description: string | null;
    category: {
      name: string;
      color: string | null;
    } | null;
  };
}

interface AvailableSkill {
  id: string;
  name: string;
  description: string | null;
  category: {
    id: string;
    name: string;
    color: string | null;
  } | null;
}

interface EquipmentSkillRequirementsPanelProps {
  equipmentId: string;
  canEdit: boolean;
}

export default function EquipmentSkillRequirementsPanel({
  equipmentId,
  canEdit,
}: EquipmentSkillRequirementsPanelProps) {
  const [requirements, setRequirements] = useState<SkillRequirement[]>([]);
  const [availableSkills, setAvailableSkills] = useState<AvailableSkill[]>([]);
  const [qualifiedEmployees, setQualifiedEmployees] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchData();
  }, [equipmentId]);

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([fetchRequirements(), fetchAvailableSkills()]);
    setLoading(false);
  };

  const fetchRequirements = async () => {
    const { data, error } = await supabase
      .from('equipment_skill_requirements')
      .select(
        `
        *,
        skill:skills(
          *,
          category:skill_categories(name, color)
        )
      `,
      )
      .eq('equipment_item_id', equipmentId);

    if (error) {
      console.error('Error fetching skill requirements:', error);
      return;
    }

    setRequirements(data || []);

    // Pobierz pracowników z każdą umiejętnością
    if (data && data.length > 0) {
      const employeesBySkill: Record<string, any[]> = {};

      const proficiencyOrder = ['basic', 'intermediate', 'advanced', 'expert'];

      for (const req of data) {
        const { data: employees, error: empError } = await supabase
          .from('employee_skills')
          .select(
            `
            employee_id,
            proficiency_level,
            years_of_experience,
            employee:employees!employee_skills_employee_id_fkey(id, name, surname, nickname, email, avatar_url, avatar_metadata)
          `,
          )
          .eq('skill_id', req.skill.id);

        if (empError) {
          console.error(`Error fetching employees for skill ${req.skill.name}:`, empError);
          employeesBySkill[req.skill.id] = [];
        } else if (employees) {
          const minLevel = req.minimum_proficiency || 'basic';
          const minIndex = proficiencyOrder.indexOf(minLevel);

          console.log(`Fetched ${employees.length} employees with skill: ${req.skill.name}`);

          const qualified = employees.filter((e) => {
            const empIndex = proficiencyOrder.indexOf(e.proficiency_level);
            const isQualified = empIndex >= minIndex;

            // Debug log
            console.log(
              `  - Employee: ${e.employee?.name || 'Unknown'}, Level: ${e.proficiency_level} (${empIndex}), Required: ${minLevel} (${minIndex}), Qualified: ${isQualified}`,
            );

            return isQualified;
          });

          employeesBySkill[req.skill.id] = qualified.map((e) => ({
            ...e.employee,
            proficiency_level: e.proficiency_level,
            years_of_experience: e.years_of_experience,
          }));

          console.log(`✅ ${qualified.length} qualified employees for ${req.skill.name}`);
        }
      }

      setQualifiedEmployees(employeesBySkill);
    }
  };

  const fetchAvailableSkills = async () => {
    const { data, error } = await supabase
      .from('skills')
      .select(
        `
        *,
        category:skill_categories(id, name, color)
      `,
      )
      .eq('is_active', true)
      .order('name');

    if (!error) {
      setAvailableSkills(data || []);
    }
  };

  const handleAddRequirement = async (formData: any) => {
    const { error } = await supabase.from('equipment_skill_requirements').insert([
      {
        equipment_item_id: equipmentId,
        ...formData,
      },
    ]);

    if (error) {
      console.error('Error adding skill requirement:', error);
      alert('Błąd podczas dodawania wymagania');
      return;
    }

    fetchRequirements();
    setShowAddModal(false);
  };

  const handleDeleteRequirement = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć to wymaganie?')) return;

    const { error } = await supabase.from('equipment_skill_requirements').delete().eq('id', id);

    if (error) {
      console.error('Error deleting requirement:', error);
      alert('Błąd podczas usuwania wymagania');
      return;
    }

    fetchRequirements();
  };

  const getProficiencyLabel = (level: string) => {
    const labels = {
      basic: 'Podstawowy',
      intermediate: 'Średniozaawansowany',
      advanced: 'Zaawansowany',
      expert: 'Ekspert',
    };
    return labels[level as keyof typeof labels] || level;
  };

  const getProficiencyColor = (level: string) => {
    const colors = {
      basic: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      intermediate: 'bg-green-500/20 text-green-400 border-green-500/30',
      advanced: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      expert: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    };
    return colors[level as keyof typeof colors] || 'bg-gray-500/20 text-gray-400';
  };

  if (loading) {
    return <div className="p-6 text-center text-[#e5e4e2]/60">Ładowanie...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-[#d3bb73]" />
          <h3 className="text-lg font-light text-[#e5e4e2]">Wymagane umiejętności</h3>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-sm text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Dodaj wymaganie
          </button>
        )}
      </div>

      {requirements.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-400" />
          <div className="text-sm text-orange-200">
            <strong>Uwaga!</strong> Ten sprzęt wymaga specjalnych umiejętności. Upewnij się, że w
            zespole eventu znajduje się osoba z odpowiednimi kwalifikacjami.
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {requirements.length === 0 ? (
          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#252842] py-8 text-center text-[#e5e4e2]/40">
            Brak wymaganych umiejętności. Ten sprzęt może obsłużyć każdy.
          </div>
        ) : (
          requirements.map((req) => {
            const employees = qualifiedEmployees[req.skill.id] || [];

            return (
              <div key={req.id} className="rounded-lg border border-[#d3bb73]/10 bg-[#252842] p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <Brain className="h-4 w-4 text-[#d3bb73]" />
                      <h4 className="font-medium text-[#e5e4e2]">{req.skill.name}</h4>
                      {req.skill.category && (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs"
                          style={{
                            backgroundColor: `${req.skill.category.color}20`,
                            color: req.skill.category.color || '#d3bb73',
                            border: `1px solid ${req.skill.category.color}40`,
                          }}
                        >
                          {req.skill.category.name}
                        </span>
                      )}
                      {req.is_required && (
                        <span className="rounded border border-red-500/30 bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                          Wymagane
                        </span>
                      )}
                    </div>

                    <div className="mb-2 flex items-center gap-2 text-sm">
                      <span className="text-[#e5e4e2]/60">Minimalny poziom:</span>
                      <span
                        className={`rounded border px-2 py-0.5 text-xs ${getProficiencyColor(req.minimum_proficiency)}`}
                      >
                        {getProficiencyLabel(req.minimum_proficiency)}
                      </span>
                    </div>

                    {req.notes && (
                      <p className="mb-2 text-sm italic text-[#e5e4e2]/40">{req.notes}</p>
                    )}

                    {/* Lista pracowników z tą umiejętnością */}
                    {employees.length > 0 && (
                      <div className="mt-3 border-t border-[#d3bb73]/10 pt-3">
                        <div className="mb-2 flex items-center gap-2">
                          <UserIcon className="h-4 w-4 text-[#d3bb73]" />
                          <span className="text-sm text-[#e5e4e2]/60">
                            Pracownicy z tą umiejętnością ({employees.length})
                          </span>
                        </div>
                        <TaskAssigneeAvatars
                          assignees={employees.map((emp: any) => ({
                            employee_id: emp.id,
                            employees: {
                              name: emp.name,
                              surname: emp.surname,
                              avatar_url: emp.avatar_url,
                              avatar_metadata: emp.avatar_metadata,
                            },
                          }))}
                          maxVisible={8}
                        />
                      </div>
                    )}

                    {employees.length === 0 && (
                      <div className="mt-3 border-t border-[#d3bb73]/10 pt-3">
                        <div className="flex items-center gap-2 text-sm text-orange-400">
                          <AlertCircle className="h-4 w-4" />
                          <span>Brak pracowników z tą umiejętnością!</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {canEdit && (
                    <button
                      onClick={() => handleDeleteRequirement(req.id)}
                      className="rounded-lg p-2 text-red-400 transition-colors hover:bg-[#1c1f33]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {showAddModal && (
        <AddSkillRequirementModal
          availableSkills={availableSkills}
          existingRequirements={requirements}
          onSave={handleAddRequirement}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}

function AddSkillRequirementModal({
  availableSkills,
  existingRequirements,
  onSave,
  onClose,
}: {
  availableSkills: AvailableSkill[];
  existingRequirements: SkillRequirement[];
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState({
    skill_id: '',
    minimum_proficiency: 'intermediate' as 'basic' | 'intermediate' | 'advanced' | 'expert',
    is_required: true,
    notes: '',
  });
  const [showNewSkillForm, setShowNewSkillForm] = useState(false);
  const [newSkillName, setNewSkillName] = useState('');
  const [isCreatingSkill, setIsCreatingSkill] = useState(false);

  // Filtruj już dodane umiejętności
  const availableSkillsFiltered = availableSkills.filter(
    (skill) => !existingRequirements.some((req) => req.skill.id === skill.id),
  );

  const handleCreateNewSkill = async () => {
    if (!newSkillName.trim()) {
      alert('Podaj nazwę umiejętności');
      return;
    }

    setIsCreatingSkill(true);
    try {
      const { data, error } = await supabase
        .from('skills')
        .insert([
          {
            name: newSkillName.trim(),
            description: 'Dodane przez użytkownika',
            is_active: true,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error('Error creating skill:', error);
        alert('Błąd podczas dodawania umiejętności: ' + error.message);
        return;
      }

      // Dodaj nową umiejętność do listy
      const newSkill = { ...data, category: null };
      availableSkills.push(newSkill as any);

      // Ustaw jako wybraną
      setFormData({ ...formData, skill_id: data.id });
      setShowNewSkillForm(false);
      setNewSkillName('');
    } catch (err) {
      console.error('Error:', err);
      alert('Błąd podczas dodawania umiejętności');
    } finally {
      setIsCreatingSkill(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      notes: formData.notes || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <h3 className="mb-4 text-xl font-light text-[#e5e4e2]">Dodaj wymaganie umiejętności</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-[#e5e4e2]/60">Umiejętność *</label>
            {!showNewSkillForm ? (
              <>
                <select
                  required
                  value={formData.skill_id}
                  onChange={(e) => {
                    if (e.target.value === '__new__') {
                      setShowNewSkillForm(true);
                    } else {
                      setFormData({ ...formData, skill_id: e.target.value });
                    }
                  }}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#252842] px-3 py-2 text-[#e5e4e2]"
                >
                  <option value="">Wybierz...</option>
                  {availableSkillsFiltered.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name} {skill.category && `(${skill.category.name})`}
                    </option>
                  ))}
                  <option value="__new__" className="font-medium text-[#d3bb73]">
                    + Dodaj nową umiejętność
                  </option>
                </select>
              </>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSkillName}
                    onChange={(e) => setNewSkillName(e.target.value)}
                    placeholder="Nazwa nowej umiejętności..."
                    className="flex-1 rounded-lg border border-[#d3bb73]/10 bg-[#252842] px-3 py-2 text-[#e5e4e2]"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleCreateNewSkill}
                    disabled={isCreatingSkill || !newSkillName.trim()}
                    className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
                  >
                    {isCreatingSkill ? 'Dodawanie...' : 'Dodaj'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewSkillForm(false);
                      setNewSkillName('');
                    }}
                    className="rounded-lg bg-[#252842] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#2a2f4a]"
                  >
                    Anuluj
                  </button>
                </div>
                <p className="text-xs text-[#e5e4e2]/40">
                  Nowa umiejętność będzie dostępna dla wszystkich pracowników i sprzętu
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm text-[#e5e4e2]/60">Minimalny poziom *</label>
            <select
              required
              value={formData.minimum_proficiency}
              onChange={(e) =>
                setFormData({ ...formData, minimum_proficiency: e.target.value as any })
              }
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#252842] px-3 py-2 text-[#e5e4e2]"
            >
              <option value="basic">Podstawowy</option>
              <option value="intermediate">Średniozaawansowany</option>
              <option value="advanced">Zaawansowany</option>
              <option value="expert">Ekspert</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_required"
              checked={formData.is_required}
              onChange={(e) => setFormData({ ...formData, is_required: e.target.checked })}
              className="h-4 w-4 rounded border-[#d3bb73]/30 bg-[#252842] text-[#d3bb73]"
            />
            <label htmlFor="is_required" className="cursor-pointer text-sm text-[#e5e4e2]/60">
              Umiejętność wymagana (bez niej sprzęt nie może być użyty)
            </label>
          </div>

          <div>
            <label className="mb-1 block text-sm text-[#e5e4e2]/60">Notatki</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#252842] px-3 py-2 text-[#e5e4e2]"
              placeholder="Dodatkowe wymagania lub informacje..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#252842] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#2a2f4a]"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={!formData.skill_id}
              className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Dodaj
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
