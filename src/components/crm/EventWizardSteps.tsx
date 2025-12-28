'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Search, Check, AlertCircle, Star, Award } from 'lucide-react';
import { supabase } from '@/lib/supabase';

// Step 2: Oferta
export function OfferStep({
  createOffer,
  setCreateOffer,
  offerData,
  setOfferData
}: any) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={createOffer}
            onChange={(e) => setCreateOffer(e.target.checked)}
            className="w-5 h-5 rounded border-[#d3bb73]/30 text-[#d3bb73] focus:ring-[#d3bb73]"
          />
          <span className="text-sm text-blue-300">
            Utwórz ofertę dla tego eventu
          </span>
        </label>
      </div>

      {createOffer && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Numer oferty
            </label>
            <input
              type="text"
              value={offerData.offer_number}
              onChange={(e) => setOfferData({ ...offerData, offer_number: e.target.value })}
              className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
              placeholder="Zostaw puste aby wygenerować automatycznie"
            />
            <p className="text-xs text-[#e5e4e2]/50 mt-1">
              Pozostaw puste - numer zostanie wygenerowany automatycznie (OF/YYYY/MM/XXX)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Ważna do
            </label>
            <input
              type="date"
              value={offerData.valid_until}
              onChange={(e) => setOfferData({ ...offerData, valid_until: e.target.value })}
              className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Notatki
            </label>
            <textarea
              value={offerData.notes}
              onChange={(e) => setOfferData({ ...offerData, notes: e.target.value })}
              rows={4}
              className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
              placeholder="Dodatkowe informacje do oferty..."
            />
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <p className="text-sm text-yellow-300">
              Oferta zostanie utworzona jako szkic. Możesz dodać pozycje i szczegóły później w zakładce Oferty eventu.
            </p>
          </div>
        </div>
      )}

      {!createOffer && (
        <div className="text-center py-12 text-[#e5e4e2]/50">
          <p>Ofertę możesz utworzyć później ze strony szczegółów eventu</p>
        </div>
      )}
    </div>
  );
}

// Step 3: Sprzęt
export function EquipmentStep({
  assignEquipment,
  setAssignEquipment,
  selectedEquipment,
  setSelectedEquipment,
  equipmentList
}: any) {
  const [searchQuery, setSearchQuery] = useState('');
  const filteredEquipment = equipmentList.filter((eq: any) =>
    eq.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    eq.equipment_categories?.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleEquipment = (equipment: any) => {
    const exists = selectedEquipment.find((e: any) => e.id === equipment.id);
    if (exists) {
      setSelectedEquipment(selectedEquipment.filter((e: any) => e.id !== equipment.id));
    } else {
      setSelectedEquipment([...selectedEquipment, { ...equipment, quantity: 1 }]);
    }
  };

  const updateQuantity = (equipmentId: string, quantity: number) => {
    setSelectedEquipment(
      selectedEquipment.map((e: any) =>
        e.id === equipmentId ? { ...e, quantity: Math.max(1, quantity) } : e
      )
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={assignEquipment}
            onChange={(e) => setAssignEquipment(e.target.checked)}
            className="w-5 h-5 rounded border-[#d3bb73]/30 text-[#d3bb73] focus:ring-[#d3bb73]"
          />
          <span className="text-sm text-blue-300">
            Przypisz sprzęt do eventu
          </span>
        </label>
      </div>

      {assignEquipment && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#e5e4e2]/50" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Szukaj sprzętu..."
              className="w-full pl-10 pr-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
            />
          </div>

          {selectedEquipment.length > 0 && (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-4">
              <h4 className="text-sm font-medium text-[#e5e4e2] mb-3">
                Wybrany sprzęt ({selectedEquipment.length})
              </h4>
              <div className="space-y-2">
                {selectedEquipment.map((eq: any) => (
                  <div
                    key={eq.id}
                    className="flex items-center justify-between py-2 px-3 bg-[#0f1117] rounded-lg"
                  >
                    <span className="text-sm text-[#e5e4e2]">{eq.name}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={eq.quantity}
                        onChange={(e) => updateQuantity(eq.id, parseInt(e.target.value))}
                        className="w-20 px-2 py-1 bg-[#1c1f33] border border-[#d3bb73]/20 rounded text-[#e5e4e2] text-sm"
                        min="1"
                      />
                      <button
                        onClick={() => toggleEquipment(eq)}
                        className="p-1 hover:bg-red-500/20 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
            {filteredEquipment.map((equipment: any) => {
              const isSelected = selectedEquipment.some((e: any) => e.id === equipment.id);
              return (
                <button
                  key={equipment.id}
                  onClick={() => toggleEquipment(equipment)}
                  className={`p-4 rounded-lg border text-left transition-all ${
                    isSelected
                      ? 'bg-[#d3bb73]/20 border-[#d3bb73] text-[#e5e4e2]'
                      : 'bg-[#1c1f33] border-[#d3bb73]/20 text-[#e5e4e2]/70 hover:border-[#d3bb73]/50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{equipment.name}</div>
                      {equipment.equipment_categories?.name && (
                        <div className="text-xs text-[#e5e4e2]/50 mt-1">
                          {equipment.equipment_categories.name}
                        </div>
                      )}
                    </div>
                    {isSelected && <Check className="w-5 h-5 text-[#d3bb73]" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!assignEquipment && (
        <div className="text-center py-12 text-[#e5e4e2]/50">
          <p>Sprzęt możesz przypisać później ze strony szczegółów eventu</p>
        </div>
      )}
    </div>
  );
}

// Step 4: Zespół
export function TeamStep({
  assignTeam,
  setAssignTeam,
  selectedEmployees,
  setSelectedEmployees,
  employeesList,
  eventId
}: any) {
  const [suggestedEmployees, setSuggestedEmployees] = useState<any[]>([]);
  const [requiredSkills, setRequiredSkills] = useState<any[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  useEffect(() => {
    if (eventId && assignTeam) {
      fetchSuggestions();
    }
  }, [eventId, assignTeam]);

  const fetchSuggestions = async () => {
    if (!eventId) return;

    setLoadingSuggestions(true);
    try {
      const { data, error } = await supabase.rpc('suggest_employees_for_event', {
        p_event_id: eventId,
      });

      if (error) throw error;

      if (data) {
        setRequiredSkills(data.required_skills || []);
        setSuggestedEmployees(data.suggested_employees || []);
      }
    } catch (e: any) {
      console.error('Błąd pobierania sugestii:', e?.message);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const toggleEmployee = (employee: any) => {
    const exists = selectedEmployees.find((e: any) => e.id === employee.id);
    if (exists) {
      setSelectedEmployees(selectedEmployees.filter((e: any) => e.id !== employee.id));
    } else {
      setSelectedEmployees([...selectedEmployees, { ...employee, role: 'Członek zespołu' }]);
    }
  };

  const updateRole = (employeeId: string, role: string) => {
    setSelectedEmployees(
      selectedEmployees.map((e: any) =>
        e.id === employeeId ? { ...e, role } : e
      )
    );
  };

  const getProficiencyColor = (proficiency: string) => {
    switch (proficiency) {
      case 'expert': return 'text-purple-400 bg-purple-500/20';
      case 'advanced': return 'text-blue-400 bg-blue-500/20';
      case 'intermediate': return 'text-green-400 bg-green-500/20';
      case 'basic': return 'text-yellow-400 bg-yellow-500/20';
      default: return 'text-[#e5e4e2]/60 bg-[#e5e4e2]/10';
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={assignTeam}
            onChange={(e) => setAssignTeam(e.target.checked)}
            className="w-5 h-5 rounded border-[#d3bb73]/30 text-[#d3bb73] focus:ring-[#d3bb73]"
          />
          <span className="text-sm text-blue-300">
            Przypisz zespół do eventu
          </span>
        </label>
      </div>

      {assignTeam && (
        <div className="space-y-4">
          {/* Wymagane umiejętności */}
          {requiredSkills.length > 0 && (
            <div className="mb-4 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
              <div className="mb-2 flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-400" />
                <h3 className="font-medium text-yellow-300">
                  Wymagane umiejętności dla sprzętu
                </h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {requiredSkills.map((skill: any) => (
                  <div
                    key={skill.skill_id}
                    className="flex items-center gap-1 rounded-full bg-[#0a0d1a]/50 px-3 py-1 text-sm"
                  >
                    <span className="text-[#e5e4e2]">{skill.skill_name}</span>
                    <span className="text-[#e5e4e2]/60">·</span>
                    <span className={`text-xs ${getProficiencyColor(skill.minimum_proficiency).split(' ')[0]}`}>
                      min. {skill.minimum_proficiency}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sugerowani pracownicy */}
          {suggestedEmployees.length > 0 && (
            <div className="mb-4 rounded-lg border border-green-500/20 bg-green-500/10 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Star className="h-5 w-5 text-green-400" />
                <h3 className="font-medium text-green-300">
                  Sugerowani pracownicy ({suggestedEmployees.length})
                </h3>
              </div>
              <p className="mb-3 text-sm text-green-200/80">
                Ci pracownicy posiadają wymagane umiejętności:
              </p>
              <div className="grid grid-cols-1 gap-2">
                {suggestedEmployees.map((emp: any) => {
                  const isSelected = selectedEmployees.some((e: any) => e.id === emp.employee_id);
                  return (
                    <button
                      key={emp.employee_id}
                      onClick={() => {
                        const employee = employeesList.find((e: any) => e.id === emp.employee_id);
                        if (employee) toggleEmployee(employee);
                      }}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        isSelected
                          ? 'border-[#d3bb73] bg-[#d3bb73]/20'
                          : 'border-green-500/30 bg-[#0a0d1a]/50 hover:border-green-500/50'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[#e5e4e2]">{emp.employee_name}</span>
                            <div className="flex items-center gap-1 rounded-full bg-green-500/20 px-2 py-0.5">
                              <Award className="h-3 w-3 text-green-400" />
                              <span className="text-xs text-green-400">
                                {emp.match_percentage}% dopasowanie
                              </span>
                            </div>
                          </div>
                          <p className="mt-1 text-xs text-[#e5e4e2]/60">{emp.email}</p>
                          {emp.skills && emp.skills.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {emp.skills.map((skill: any, idx: number) => (
                                <span
                                  key={idx}
                                  className={`rounded px-2 py-0.5 text-xs ${getProficiencyColor(skill.proficiency)}`}
                                >
                                  {skill.skill_name} ({skill.proficiency})
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {isSelected && <Check className="ml-2 h-5 w-5 text-[#d3bb73]" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedEmployees.length > 0 && (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-4">
              <h4 className="text-sm font-medium text-[#e5e4e2] mb-3">
                Wybrany zespół ({selectedEmployees.length})
              </h4>
              <div className="space-y-2">
                {selectedEmployees.map((emp: any) => (
                  <div
                    key={emp.id}
                    className="flex items-center justify-between py-2 px-3 bg-[#0f1117] rounded-lg"
                  >
                    <span className="text-sm text-[#e5e4e2]">{emp.full_name}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={emp.role}
                        onChange={(e) => updateRole(emp.id, e.target.value)}
                        placeholder="Rola"
                        className="w-40 px-2 py-1 bg-[#1c1f33] border border-[#d3bb73]/20 rounded text-[#e5e4e2] text-sm"
                      />
                      <button
                        onClick={() => toggleEmployee(emp)}
                        className="p-1 hover:bg-red-500/20 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
            {employeesList.map((employee: any) => {
              const isSelected = selectedEmployees.some((e: any) => e.id === employee.id);
              return (
                <button
                  key={employee.id}
                  onClick={() => toggleEmployee(employee)}
                  className={`p-4 rounded-lg border text-left transition-all ${
                    isSelected
                      ? 'bg-[#d3bb73]/20 border-[#d3bb73] text-[#e5e4e2]'
                      : 'bg-[#1c1f33] border-[#d3bb73]/20 text-[#e5e4e2]/70 hover:border-[#d3bb73]/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {employee.avatar_url ? (
                        <img
                          src={employee.avatar_url}
                          alt={employee.full_name}
                          className="w-10 h-10 rounded-full"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-[#d3bb73]/20 flex items-center justify-center">
                          <span className="text-[#d3bb73] font-medium text-sm">
                            {employee.full_name?.charAt(0)}
                          </span>
                        </div>
                      )}
                      <div>
                        <div className="font-medium text-sm">{employee.full_name}</div>
                        <div className="text-xs text-[#e5e4e2]/50">{employee.email}</div>
                      </div>
                    </div>
                    {isSelected && <Check className="w-5 h-5 text-[#d3bb73]" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!assignTeam && (
        <div className="text-center py-12 text-[#e5e4e2]/50">
          <p>Zespół możesz przypisać później ze strony szczegółów eventu</p>
        </div>
      )}
    </div>
  );
}
