'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Package, Users, DollarSign, Clock, Plus, Trash2, CreditCard as Edit, Save, X, CheckSquare, Wrench } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Attraction {
  id: string;
  name: string;
  description: string;
  category: string;
  base_price: number;
  unit: string;
  duration_hours: number;
  max_daily_capacity: number;
  requires_operator: boolean;
  setup_time_minutes: number;
  breakdown_time_minutes: number;
  is_active: boolean;
}

export default function AttractionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const attractionId = params.id as string;

  const [attraction, setAttraction] = useState<Attraction | null>(null);
  const [requiredEquipment, setRequiredEquipment] = useState<any[]>([]);
  const [requiredStaff, setRequiredStaff] = useState<any[]>([]);
  const [costs, setCosts] = useState<any[]>([]);
  const [checklistTemplates, setChecklistTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'equipment' | 'staff' | 'costs' | 'checklist'>('overview');

  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false);
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);
  const [showAddCostModal, setShowAddCostModal] = useState(false);
  const [showAddChecklistModal, setShowAddChecklistModal] = useState(false);

  useEffect(() => {
    if (attractionId && attractionId !== 'new') {
      fetchAttractionDetails();
    } else if (attractionId === 'new') {
      setLoading(false);
    }
  }, [attractionId]);

  const fetchAttractionDetails = async () => {
    try {
      setLoading(true);

      const { data: attractionData, error: attractionError } = await supabase
        .from('attractions')
        .select('*')
        .eq('id', attractionId)
        .maybeSingle();

      if (attractionError || !attractionData) {
        console.error('Error fetching attraction:', attractionError);
        setAttraction(null);
        setLoading(false);
        return;
      }

      setAttraction(attractionData);

      const { data: equipmentData } = await supabase
        .from('attraction_required_equipment')
        .select(`
          *,
          equipment:equipment_id(id, name, category, status)
        `)
        .eq('attraction_id', attractionId);

      setRequiredEquipment(equipmentData || []);

      const { data: staffData } = await supabase
        .from('attraction_required_staff')
        .select('*')
        .eq('attraction_id', attractionId);

      setRequiredStaff(staffData || []);

      const { data: costsData } = await supabase
        .from('attraction_costs')
        .select('*')
        .eq('attraction_id', attractionId);

      setCosts(costsData || []);

      const { data: checklistData } = await supabase
        .from('attraction_checklist_templates')
        .select('*')
        .eq('attraction_id', attractionId)
        .order('sort_order');

      setChecklistTemplates(checklistData || []);

      setLoading(false);
    } catch (err) {
      console.error('Error:', err);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!attraction && attractionId !== 'new') {
    return (
      <div className="flex flex-col items-center justify-center h-screen space-y-4">
        <div className="text-[#e5e4e2] text-lg">Atrakcja nie została znaleziona</div>
        <button
          onClick={() => router.push('/crm/attractions')}
          className="bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
        >
          Wróć do listy
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/crm/attractions')}
            className="p-2 text-[#e5e4e2] hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-light text-[#e5e4e2]">
              {attraction?.name || 'Nowa atrakcja'}
            </h1>
            <p className="text-sm text-[#e5e4e2]/60 mt-1">
              Szczegóły, wymagany sprzęt i personel
            </p>
          </div>
        </div>
      </div>

      {attraction && (
        <>
          <div className="flex gap-2 border-b border-[#d3bb73]/10">
            {[
              { id: 'overview', label: 'Przegląd', icon: Package },
              { id: 'equipment', label: 'Sprzęt', icon: Wrench },
              { id: 'staff', label: 'Personel', icon: Users },
              { id: 'costs', label: 'Kosztorys', icon: DollarSign },
              { id: 'checklist', label: 'Checklist', icon: CheckSquare },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                    activeTab === tab.id
                      ? 'border-[#d3bb73] text-[#d3bb73]'
                      : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
                <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Informacje podstawowe</h2>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Nazwa</p>
                    <p className="text-[#e5e4e2]">{attraction.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Opis</p>
                    <p className="text-[#e5e4e2]">{attraction.description || 'Brak opisu'}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Cena bazowa</p>
                      <p className="text-[#e5e4e2]">
                        {attraction.base_price?.toLocaleString('pl-PL')} zł
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Jednostka</p>
                      <p className="text-[#e5e4e2]">{attraction.unit}</p>
                    </div>
                  </div>
                  {attraction.duration_hours && (
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Czas trwania</p>
                      <p className="text-[#e5e4e2]">{attraction.duration_hours} godz.</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
                  <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Limity i czasy</h2>
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Max dziennie</p>
                      <p className="text-[#e5e4e2]">
                        {attraction.max_daily_capacity || 'Bez limitu'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Czas montażu</p>
                      <p className="text-[#e5e4e2]">{attraction.setup_time_minutes || 0} min</p>
                    </div>
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Czas demontażu</p>
                      <p className="text-[#e5e4e2]">
                        {attraction.breakdown_time_minutes || 0} min
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
                  <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Podsumowanie</h2>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#e5e4e2]/60">Sprzęt</span>
                      <span className="text-[#e5e4e2]">{requiredEquipment.length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#e5e4e2]/60">Personel</span>
                      <span className="text-[#e5e4e2]">{requiredStaff.length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#e5e4e2]/60">Koszty</span>
                      <span className="text-[#e5e4e2]">{costs.length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#e5e4e2]/60">Checklist</span>
                      <span className="text-[#e5e4e2]">{checklistTemplates.length}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'equipment' && (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-light text-[#e5e4e2]">Wymagany sprzęt</h2>
                <button
                  onClick={() => setShowAddEquipmentModal(true)}
                  className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
                >
                  <Plus className="w-4 h-4" />
                  Dodaj sprzęt
                </button>
              </div>

              {requiredEquipment.length === 0 ? (
                <div className="text-center py-12">
                  <Wrench className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
                  <p className="text-[#e5e4e2]/60">Brak wymaganego sprzętu</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {requiredEquipment.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4"
                    >
                      <div className="flex-1">
                        <h3 className="text-[#e5e4e2] font-medium">
                          {item.equipment?.name || 'Nieznany sprzęt'}
                        </h3>
                        <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60 mt-1">
                          <span>Ilość: {item.quantity}</span>
                          {item.is_primary && (
                            <span className="text-[#d3bb73]">Główny</span>
                          )}
                        </div>
                        {item.notes && (
                          <p className="text-sm text-[#e5e4e2]/40 mt-2">{item.notes}</p>
                        )}
                      </div>
                      <button
                        onClick={async () => {
                          if (confirm('Usunąć ten sprzęt?')) {
                            await supabase
                              .from('attraction_required_equipment')
                              .delete()
                              .eq('id', item.id);
                            fetchAttractionDetails();
                          }
                        }}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'staff' && (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-light text-[#e5e4e2]">Wymagany personel</h2>
                <button
                  onClick={() => setShowAddStaffModal(true)}
                  className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
                >
                  <Plus className="w-4 h-4" />
                  Dodaj personel
                </button>
              </div>

              {requiredStaff.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
                  <p className="text-[#e5e4e2]/60">Brak wymaganego personelu</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {requiredStaff.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4"
                    >
                      <div className="flex-1">
                        <h3 className="text-[#e5e4e2] font-medium">{item.role}</h3>
                        <p className="text-sm text-[#e5e4e2]/60 mt-1">Ilość: {item.count}</p>
                        {item.required_skills && item.required_skills.length > 0 && (
                          <div className="flex gap-2 mt-2">
                            {item.required_skills.map((skill: string, idx: number) => (
                              <span
                                key={idx}
                                className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs"
                              >
                                {skill}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.notes && (
                          <p className="text-sm text-[#e5e4e2]/40 mt-2">{item.notes}</p>
                        )}
                      </div>
                      <button
                        onClick={async () => {
                          if (confirm('Usunąć ten personel?')) {
                            await supabase
                              .from('attraction_required_staff')
                              .delete()
                              .eq('id', item.id);
                            fetchAttractionDetails();
                          }
                        }}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'costs' && (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-light text-[#e5e4e2]">Kosztorys</h2>
                <button
                  onClick={() => setShowAddCostModal(true)}
                  className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
                >
                  <Plus className="w-4 h-4" />
                  Dodaj koszt
                </button>
              </div>

              {costs.length === 0 ? (
                <div className="text-center py-12">
                  <DollarSign className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
                  <p className="text-[#e5e4e2]/60">Brak kosztów</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {costs.map((cost) => (
                    <div
                      key={cost.id}
                      className="flex items-center justify-between bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-[#e5e4e2] font-medium">{cost.description}</h3>
                          <span className="px-2 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded text-xs">
                            {cost.cost_type}
                          </span>
                        </div>
                        {cost.notes && (
                          <p className="text-sm text-[#e5e4e2]/40 mt-1">{cost.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-[#d3bb73] font-medium">
                          {cost.amount?.toLocaleString('pl-PL')} zł
                        </span>
                        <button
                          onClick={async () => {
                            if (confirm('Usunąć ten koszt?')) {
                              await supabase
                                .from('attraction_costs')
                                .delete()
                                .eq('id', cost.id);
                              fetchAttractionDetails();
                            }
                          }}
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="bg-[#0f1119] border-2 border-[#d3bb73]/30 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-medium text-[#e5e4e2]">Suma</span>
                      <span className="text-xl font-medium text-[#d3bb73]">
                        {costs
                          .reduce((sum, cost) => sum + (cost.amount || 0), 0)
                          .toLocaleString('pl-PL')}{' '}
                        zł
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'checklist' && (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-light text-[#e5e4e2]">Szablon checklisty</h2>
                  <p className="text-sm text-[#e5e4e2]/60 mt-1">
                    Automatycznie generowany przy dodaniu do eventu
                  </p>
                </div>
                <button
                  onClick={() => setShowAddChecklistModal(true)}
                  className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
                >
                  <Plus className="w-4 h-4" />
                  Dodaj punkt
                </button>
              </div>

              {checklistTemplates.length === 0 ? (
                <div className="text-center py-12">
                  <CheckSquare className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
                  <p className="text-[#e5e4e2]/60">Brak szablonu checklisty</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {checklistTemplates.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start gap-3 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4"
                    >
                      <CheckSquare className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-[#e5e4e2] font-medium">{item.title}</h3>
                          {item.is_required && (
                            <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs">
                              Wymagane
                            </span>
                          )}
                          {item.category && (
                            <span className="px-2 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded text-xs">
                              {item.category}
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="text-sm text-[#e5e4e2]/60 mt-1">{item.description}</p>
                        )}
                      </div>
                      <button
                        onClick={async () => {
                          if (confirm('Usunąć ten punkt?')) {
                            await supabase
                              .from('attraction_checklist_templates')
                              .delete()
                              .eq('id', item.id);
                            fetchAttractionDetails();
                          }
                        }}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
