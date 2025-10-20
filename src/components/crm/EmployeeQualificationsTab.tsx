'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Award, BookOpen, FileCheck, Edit, Save, X, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import EmployeeDrivingLicensesPanel from './EmployeeDrivingLicensesPanel';

interface Certification {
  id: string;
  certification_type_id: string;
  issued_date: string;
  expiry_date: string | null;
  certification_number: string | null;
  issuing_authority: string | null;
  notes: string | null;
  is_active: boolean;
  certification_type: {
    id: string;
    name: string;
    description: string | null;
    requires_renewal: boolean;
    validity_period_months: number | null;
  };
}

interface Skill {
  id: string;
  skill_id: string;
  proficiency_level: 'basic' | 'intermediate' | 'advanced' | 'expert';
  years_of_experience: number | null;
  notes: string | null;
  skill: {
    id: string;
    name: string;
    description: string | null;
    category_id: string | null;
    category: {
      name: string;
      color: string | null;
    } | null;
  };
}

interface CertificationType {
  id: string;
  name: string;
  description: string | null;
  requires_renewal: boolean;
  validity_period_months: number | null;
}

interface SkillType {
  id: string;
  name: string;
  description: string | null;
  category: {
    id: string;
    name: string;
    color: string | null;
  } | null;
}

interface EmployeeQualificationsTabProps {
  employeeId: string;
  canEdit: boolean;
}

export default function EmployeeQualificationsTab({ employeeId, canEdit }: EmployeeQualificationsTabProps) {
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [availableCertTypes, setAvailableCertTypes] = useState<CertificationType[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddCertModal, setShowAddCertModal] = useState(false);
  const [showAddSkillModal, setShowAddSkillModal] = useState(false);
  const [editingCert, setEditingCert] = useState<string | null>(null);
  const [editingSkill, setEditingSkill] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [employeeId]);

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([
      fetchCertifications(),
      fetchSkills(),
      fetchAvailableCertTypes(),
      fetchAvailableSkills(),
    ]);
    setLoading(false);
  };

  const fetchCertifications = async () => {
    const { data, error } = await supabase
      .from('employee_certifications')
      .select(`
        *,
        certification_type:certification_types(*)
      `)
      .eq('employee_id', employeeId)
      .order('issued_date', { ascending: false });

    if (error) {
      console.error('Error fetching certifications:', error);
      return;
    }

    setCertifications(data || []);
  };

  const fetchSkills = async () => {
    const { data, error } = await supabase
      .from('employee_skills')
      .select(`
        *,
        skill:skills(
          *,
          category:skill_categories(name, color)
        )
      `)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching skills:', error);
      return;
    }

    setSkills(data || []);
  };

  const fetchAvailableCertTypes = async () => {
    const { data, error } = await supabase
      .from('certification_types')
      .select('*')
      .order('name');

    if (!error) {
      setAvailableCertTypes(data || []);
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

  const handleAddCertification = async (formData: any) => {
    const { error } = await supabase
      .from('employee_certifications')
      .insert([{
        employee_id: employeeId,
        ...formData,
      }]);

    if (error) {
      console.error('Error adding certification:', error);
      alert('Błąd podczas dodawania certyfikatu');
      return;
    }

    fetchCertifications();
    setShowAddCertModal(false);
  };

  const handleAddSkill = async (formData: any) => {
    const { error } = await supabase
      .from('employee_skills')
      .insert([{
        employee_id: employeeId,
        ...formData,
      }]);

    if (error) {
      console.error('Error adding skill:', error);
      alert('Błąd podczas dodawania umiejętności');
      return;
    }

    fetchSkills();
    setShowAddSkillModal(false);
  };

  const handleUpdateCertification = async (id: string, formData: any) => {
    const { error } = await supabase
      .from('employee_certifications')
      .update(formData)
      .eq('id', id);

    if (error) {
      console.error('Error updating certification:', error);
      alert('Błąd podczas aktualizacji certyfikatu');
      return;
    }

    fetchCertifications();
    setEditingCert(null);
  };

  const handleDeleteCertification = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten certyfikat?')) return;

    const { error } = await supabase
      .from('employee_certifications')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting certification:', error);
      alert('Błąd podczas usuwania certyfikatu');
      return;
    }

    fetchCertifications();
  };

  const handleUpdateSkill = async (id: string, formData: any) => {
    const { error } = await supabase
      .from('employee_skills')
      .update(formData)
      .eq('id', id);

    if (error) {
      console.error('Error updating skill:', error);
      alert('Błąd podczas aktualizacji umiejętności');
      return;
    }

    fetchSkills();
    setEditingSkill(null);
  };

  const handleDeleteSkill = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę umiejętność?')) return;

    const { error } = await supabase
      .from('employee_skills')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting skill:', error);
      alert('Błąd podczas usuwania umiejętności');
      return;
    }

    fetchSkills();
  };

  const isExpired = (expiryDate: string | null) => {
    if (!expiryDate) return false;
    return new Date(expiryDate) < new Date();
  };

  const isExpiringSoon = (expiryDate: string | null) => {
    if (!expiryDate) return false;
    const expiry = new Date(expiryDate);
    const inThreeMonths = new Date();
    inThreeMonths.setMonth(inThreeMonths.getMonth() + 3);
    return expiry < inThreeMonths && expiry >= new Date();
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
    <div className="p-6 space-y-8">
      {/* Certyfikaty / Uprawnienia */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-[#d3bb73]" />
            <h3 className="text-lg font-light text-[#e5e4e2]">Certyfikaty i Uprawnienia</h3>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowAddCertModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              Dodaj certyfikat
            </button>
          )}
        </div>

        <div className="grid gap-3">
          {certifications.length === 0 ? (
            <div className="text-center py-8 text-[#e5e4e2]/40">
              Brak certyfikatów
            </div>
          ) : (
            certifications.map((cert) => (
              <div
                key={cert.id}
                className={`bg-[#252842] border rounded-lg p-4 ${
                  isExpired(cert.expiry_date)
                    ? 'border-red-500/30'
                    : isExpiringSoon(cert.expiry_date)
                    ? 'border-orange-500/30'
                    : 'border-[#d3bb73]/10'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <FileCheck className="w-4 h-4 text-[#d3bb73]" />
                      <h4 className="font-medium text-[#e5e4e2]">
                        {cert.certification_type.name}
                      </h4>
                      {isExpired(cert.expiry_date) && (
                        <span className="flex items-center gap-1 text-xs text-red-400">
                          <AlertCircle className="w-3 h-3" />
                          Wygasło
                        </span>
                      )}
                      {isExpiringSoon(cert.expiry_date) && !isExpired(cert.expiry_date) && (
                        <span className="flex items-center gap-1 text-xs text-orange-400">
                          <AlertCircle className="w-3 h-3" />
                          Wkrótce wygaśnie
                        </span>
                      )}
                      {cert.is_active && !isExpired(cert.expiry_date) && !isExpiringSoon(cert.expiry_date) && (
                        <span className="flex items-center gap-1 text-xs text-green-400">
                          <CheckCircle className="w-3 h-3" />
                          Aktywny
                        </span>
                      )}
                    </div>

                    <div className="text-sm text-[#e5e4e2]/60 space-y-1">
                      {cert.certification_number && (
                        <p>Nr: {cert.certification_number}</p>
                      )}
                      <p>
                        Wydano: {new Date(cert.issued_date).toLocaleDateString('pl-PL')}
                      </p>
                      {cert.expiry_date && (
                        <p>
                          Ważne do: {new Date(cert.expiry_date).toLocaleDateString('pl-PL')}
                        </p>
                      )}
                      {cert.issuing_authority && (
                        <p>Wystawca: {cert.issuing_authority}</p>
                      )}
                      {cert.notes && (
                        <p className="text-[#e5e4e2]/40 italic mt-2">{cert.notes}</p>
                      )}
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingCert(cert.id)}
                        className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors text-[#d3bb73]"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteCertification(cert.id)}
                        className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Umiejętności */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[#d3bb73]" />
            <h3 className="text-lg font-light text-[#e5e4e2]">Umiejętności i Kompetencje</h3>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowAddSkillModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              Dodaj umiejętność
            </button>
          )}
        </div>

        <div className="grid gap-3">
          {skills.length === 0 ? (
            <div className="text-center py-8 text-[#e5e4e2]/40">
              Brak umiejętności
            </div>
          ) : (
            skills.map((skill) => (
              <div
                key={skill.id}
                className="bg-[#252842] border border-[#d3bb73]/10 rounded-lg p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <BookOpen className="w-4 h-4 text-[#d3bb73]" />
                      <h4 className="font-medium text-[#e5e4e2]">
                        {skill.skill.name}
                      </h4>
                      {skill.skill.category && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: `${skill.skill.category.color}20`,
                            color: skill.skill.category.color || '#d3bb73',
                            border: `1px solid ${skill.skill.category.color}40`,
                          }}
                        >
                          {skill.skill.category.name}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-sm">
                      <span className={`px-2 py-1 rounded border text-xs ${getProficiencyColor(skill.proficiency_level)}`}>
                        {getProficiencyLabel(skill.proficiency_level)}
                      </span>
                      {skill.years_of_experience && (
                        <span className="text-[#e5e4e2]/60">
                          {skill.years_of_experience} {skill.years_of_experience === 1 ? 'rok' : 'lat'} doświadczenia
                        </span>
                      )}
                    </div>

                    {skill.notes && (
                      <p className="text-sm text-[#e5e4e2]/40 italic mt-2">{skill.notes}</p>
                    )}
                  </div>

                  {canEdit && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingSkill(skill.id)}
                        className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors text-[#d3bb73]"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteSkill(skill.id)}
                        className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Prawa jazdy */}
      <EmployeeDrivingLicensesPanel
        employeeId={employeeId}
        canEdit={canEdit}
      />

      {/* Modal dodawania certyfikatu */}
      {showAddCertModal && (
        <AddCertificationModal
          availableTypes={availableCertTypes}
          onSave={handleAddCertification}
          onClose={() => setShowAddCertModal(false)}
        />
      )}

      {/* Modal dodawania umiejętności */}
      {showAddSkillModal && (
        <AddSkillModal
          availableSkills={availableSkills}
          onSave={handleAddSkill}
          onClose={() => setShowAddSkillModal(false)}
        />
      )}

      {/* Modal edycji certyfikatu */}
      {editingCert && (
        <EditCertificationModal
          certification={certifications.find(c => c.id === editingCert)!}
          availableTypes={availableCertTypes}
          onSave={(data) => handleUpdateCertification(editingCert, data)}
          onClose={() => setEditingCert(null)}
        />
      )}

      {/* Modal edycji umiejętności */}
      {editingSkill && (
        <EditSkillModal
          skill={skills.find(s => s.id === editingSkill)!}
          availableSkills={availableSkills}
          onSave={(data) => handleUpdateSkill(editingSkill, data)}
          onClose={() => setEditingSkill(null)}
        />
      )}
    </div>
  );
}

// Modal dodawania certyfikatu
function AddCertificationModal({
  availableTypes,
  onSave,
  onClose,
}: {
  availableTypes: CertificationType[];
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState({
    certification_type_id: '',
    issued_date: '',
    expiry_date: '',
    certification_number: '',
    issuing_authority: '',
    notes: '',
    is_active: true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      expiry_date: formData.expiry_date || null,
      certification_number: formData.certification_number || null,
      issuing_authority: formData.issuing_authority || null,
      notes: formData.notes || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 max-w-lg w-full">
        <h3 className="text-xl font-light text-[#e5e4e2] mb-4">Dodaj certyfikat</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Typ certyfikatu *</label>
            <select
              required
              value={formData.certification_type_id}
              onChange={(e) => setFormData({ ...formData, certification_type_id: e.target.value })}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
            >
              <option value="">Wybierz...</option>
              {availableTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-1">Data wydania *</label>
              <input
                type="date"
                required
                value={formData.issued_date}
                onChange={(e) => setFormData({ ...formData, issued_date: e.target.value })}
                className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-1">Data wygaśnięcia</label>
              <input
                type="date"
                value={formData.expiry_date}
                onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
                className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Numer certyfikatu</label>
            <input
              type="text"
              value={formData.certification_number}
              onChange={(e) => setFormData({ ...formData, certification_number: e.target.value })}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Wystawca</label>
            <input
              type="text"
              value={formData.issuing_authority}
              onChange={(e) => setFormData({ ...formData, issuing_authority: e.target.value })}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Notatki</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
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
              className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
            >
              Dodaj
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Modal dodawania umiejętności
function AddSkillModal({
  availableSkills,
  onSave,
  onClose,
}: {
  availableSkills: SkillType[];
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState({
    skill_id: '',
    proficiency_level: 'intermediate' as 'basic' | 'intermediate' | 'advanced' | 'expert',
    years_of_experience: '',
    notes: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      years_of_experience: formData.years_of_experience ? parseFloat(formData.years_of_experience) : null,
      notes: formData.notes || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 max-w-lg w-full">
        <h3 className="text-xl font-light text-[#e5e4e2] mb-4">Dodaj umiejętność</h3>

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
              {availableSkills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name} {skill.category && `(${skill.category.name})`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Poziom zaawansowania *</label>
            <select
              required
              value={formData.proficiency_level}
              onChange={(e) => setFormData({ ...formData, proficiency_level: e.target.value as any })}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
            >
              <option value="basic">Podstawowy</option>
              <option value="intermediate">Średniozaawansowany</option>
              <option value="advanced">Zaawansowany</option>
              <option value="expert">Ekspert</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Lata doświadczenia</label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={formData.years_of_experience}
              onChange={(e) => setFormData({ ...formData, years_of_experience: e.target.value })}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Notatki</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
              placeholder="np. Projekty, osiągnięcia, szkolenia..."
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
              className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
            >
              Dodaj
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Modal edycji certyfikatu
function EditCertificationModal({
  certification,
  availableTypes,
  onSave,
  onClose,
}: {
  certification: Certification;
  availableTypes: CertificationType[];
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState({
    certification_type_id: certification.certification_type_id,
    issued_date: certification.issued_date,
    expiry_date: certification.expiry_date || '',
    certification_number: certification.certification_number || '',
    issuing_authority: certification.issuing_authority || '',
    notes: certification.notes || '',
    is_active: certification.is_active,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      expiry_date: formData.expiry_date || null,
      certification_number: formData.certification_number || null,
      issuing_authority: formData.issuing_authority || null,
      notes: formData.notes || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-light text-[#e5e4e2] mb-4">Edytuj certyfikat</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Typ certyfikatu *</label>
            <select
              required
              value={formData.certification_type_id}
              onChange={(e) => setFormData({ ...formData, certification_type_id: e.target.value })}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
            >
              <option value="">Wybierz...</option>
              {availableTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-1">Data wydania *</label>
              <input
                type="date"
                required
                value={formData.issued_date}
                onChange={(e) => setFormData({ ...formData, issued_date: e.target.value })}
                className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-1">Data wygaśnięcia</label>
              <input
                type="date"
                value={formData.expiry_date}
                onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
                className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Numer certyfikatu</label>
            <input
              type="text"
              value={formData.certification_number}
              onChange={(e) => setFormData({ ...formData, certification_number: e.target.value })}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Wystawca</label>
            <input
              type="text"
              value={formData.issuing_authority}
              onChange={(e) => setFormData({ ...formData, issuing_authority: e.target.value })}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Notatki</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
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
              className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
            >
              Zapisz
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Modal edycji umiejętności
function EditSkillModal({
  skill,
  availableSkills,
  onSave,
  onClose,
}: {
  skill: Skill;
  availableSkills: SkillType[];
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState({
    skill_id: skill.skill_id,
    proficiency_level: skill.proficiency_level,
    years_of_experience: skill.years_of_experience?.toString() || '',
    notes: skill.notes || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      years_of_experience: formData.years_of_experience ? parseFloat(formData.years_of_experience) : null,
      notes: formData.notes || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 max-w-lg w-full">
        <h3 className="text-xl font-light text-[#e5e4e2] mb-4">Edytuj umiejętność</h3>

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
              {availableSkills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.category && `(${s.category.name})`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Poziom zaawansowania *</label>
            <select
              required
              value={formData.proficiency_level}
              onChange={(e) => setFormData({ ...formData, proficiency_level: e.target.value as any })}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
            >
              <option value="basic">Podstawowy</option>
              <option value="intermediate">Średniozaawansowany</option>
              <option value="advanced">Zaawansowany</option>
              <option value="expert">Ekspert</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Lata doświadczenia</label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={formData.years_of_experience}
              onChange={(e) => setFormData({ ...formData, years_of_experience: e.target.value })}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Notatki</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
              placeholder="np. Projekty, osiągnięcia, szkolenia..."
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
              className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
            >
              Zapisz
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
