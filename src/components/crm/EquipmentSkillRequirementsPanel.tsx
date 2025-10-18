'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Brain, AlertCircle, User as UserIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';

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

export default function EquipmentSkillRequirementsPanel({ equipmentId, canEdit }: EquipmentSkillRequirementsPanelProps) {
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
    await Promise.all([
      fetchRequirements(),
      fetchAvailableSkills(),
    ]);
    setLoading(false);
  };

  const fetchRequirements = async () => {
    const { data, error } = await supabase
      .from('equipment_skill_requirements')
      .select(`
        *,
        skill:skills(
          *,
          category:skill_categories(name, color)
        )
      `)
      .eq('equipment_item_id', equipmentId);

    if (error) {
      console.error('Error fetching skill requirements:', error);
      return;
    }

    setRequirements(data || []);

    // Pobierz pracowników z każdą umiejętnością
    if (data && data.length > 0) {
      const employeesBySkill: Record<string, any[]> = {};

      for (const req of data) {
        const { data: employees, error: empError } = await supabase
          .from('employee_skills')
          .select(`
            employee_id,
            proficiency_level,
            years_of_experience,
            employee:employees(id, name, surname, email)
          `)
          .eq('skill_id', req.skill.id)
          .gte('proficiency_level', req.minimum_proficiency || 'basic');

        if (!empError && employees) {
          employeesBySkill[req.skill.id] = employees.map(e => ({
            ...e.employee,
            proficiency_level: e.proficiency_level,
            years_of_experience: e.years_of_experience,
          }));
        }
      }

      setQualifiedEmployees(employeesBySkill);
    }
  };

  const fetchAvailableSkills = async () => {
    const { data, error } = await supabase
      .from('skills')
      .select(`
        *,
        category:skill_categories(id, name, color)
      `)
      .eq('is_active', true)
      .order('name');

    if (!error) {
      setAvailableSkills(data || []);
    }
  };

  const handleAddRequirement = async (formData: any) => {
    const { error } = await supabase
      .from('equipment_skill_requirements')
      .insert([{
        equipment_item_id: equipmentId,
        ...formData,
      }]);

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

    const { error } = await supabase
      .from('equipment_skill_requirements')
      .delete()
      .eq('id', id);

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
    return (
      <div className="p-6 text-center text-[#e5e4e2]/60">
        Ładowanie...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-[#d3bb73]" />
          <h3 className="text-lg font-light text-[#e5e4e2]">Wymagane umiejętności</h3>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            Dodaj wymaganie
          </button>
        )}
      </div>

      {requirements.length > 0 && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-orange-200">
            <strong>Uwaga!</strong> Ten sprzęt wymaga specjalnych umiejętności. Upewnij się, że w zespole eventu
            znajduje się osoba z odpowiednimi kwalifikacjami.
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {requirements.length === 0 ? (
          <div className="text-center py-8 text-[#e5e4e2]/40 bg-[#252842] border border-[#d3bb73]/10 rounded-lg">
            Brak wymaganych umiejętności. Ten sprzęt może obsłużyć każdy.
          </div>
        ) : (
          requirements.map((req) => {
            const employees = qualifiedEmployees[req.skill.id] || [];

            return (
              <div
                key={req.id}
                className="bg-[#252842] border border-[#d3bb73]/10 rounded-lg p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Brain className="w-4 h-4 text-[#d3bb73]" />
                      <h4 className="font-medium text-[#e5e4e2]">
                        {req.skill.name}
                      </h4>
                      {req.skill.category && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
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
                        <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                          Wymagane
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-sm mb-2">
                      <span className="text-[#e5e4e2]/60">Minimalny poziom:</span>
                      <span className={`px-2 py-0.5 rounded border text-xs ${getProficiencyColor(req.minimum_proficiency)}`}>
                        {getProficiencyLabel(req.minimum_proficiency)}
                      </span>
                    </div>

                    {req.notes && (
                      <p className="text-sm text-[#e5e4e2]/40 italic mb-2">
                        {req.notes}
                      </p>
                    )}

                    {/* Lista pracowników z tą umiejętnością */}
                    {employees.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-[#d3bb73]/10">
                        <div className="flex items-center gap-2 mb-2">
                          <UserIcon className="w-4 h-4 text-[#d3bb73]" />
                          <span className="text-sm text-[#e5e4e2]/60">
                            Pracownicy z tą umiejętnością ({employees.length})
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {employees.slice(0, 5).map((emp: any) => (
                            <span
                              key={emp.id}
                              className="text-xs px-2 py-1 bg-[#1c1f33] border border-[#d3bb73]/10 rounded text-[#e5e4e2]"
                              title={`${emp.proficiency_level}${emp.years_of_experience ? ` - ${emp.years_of_experience} lat` : ''}`}
                            >
                              {emp.name} {emp.surname}
                            </span>
                          ))}
                          {employees.length > 5 && (
                            <span className="text-xs px-2 py-1 text-[#e5e4e2]/60">
                              +{employees.length - 5} więcej
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {employees.length === 0 && (
                      <div className="mt-3 pt-3 border-t border-[#d3bb73]/10">
                        <div className="flex items-center gap-2 text-sm text-orange-400">
                          <AlertCircle className="w-4 h-4" />
                          <span>Brak pracowników z tą umiejętnością!</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {canEdit && (
                    <button
                      onClick={() => handleDeleteRequirement(req.id)}
                      className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
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

  // Filtruj już dodane umiejętności
  const availableSkillsFiltered = availableSkills.filter(
    skill => !existingRequirements.some(req => req.skill.id === skill.id)
  );

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
      <div className="relative bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 max-w-lg w-full">
        <h3 className="text-xl font-light text-[#e5e4e2] mb-4">Dodaj wymaganie umiejętności</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Umiejętność *</label>
            <select
              required
              value={formData.skill_id}
              onChange={(e) => setFormData({ ...formData, skill_id: e.target.value })}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
            >
              <option value="">Wybierz...</option>
              {availableSkillsFiltered.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name} {skill.category && `(${skill.category.name})`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Minimalny poziom *</label>
            <select
              required
              value={formData.minimum_proficiency}
              onChange={(e) => setFormData({ ...formData, minimum_proficiency: e.target.value as any })}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
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
              className="w-4 h-4 rounded border-[#d3bb73]/30 bg-[#252842] text-[#d3bb73]"
            />
            <label htmlFor="is_required" className="text-sm text-[#e5e4e2]/60 cursor-pointer">
              Umiejętność wymagana (bez niej sprzęt nie może być użyty)
            </label>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Notatki</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
              placeholder="Dodatkowe wymagania lub informacje..."
            />
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-[#252842] text-[#e5e4e2] rounded-lg hover:bg-[#2a2f4a] transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={!formData.skill_id}
              className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Dodaj
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
