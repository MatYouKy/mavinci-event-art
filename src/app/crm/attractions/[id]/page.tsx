'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Package,
  Users,
  DollarSign,
  Clock,
  Plus,
  Trash2,
  CreditCard as Edit,
  Save,
  X,
  CheckSquare,
  Wrench,
} from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState<
    'overview' | 'equipment' | 'staff' | 'costs' | 'checklist'
  >('overview');

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
        .select(
          `
          *,
          equipment:equipment_id(id, name, category, status)
        `,
        )
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
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  if (!attraction && attractionId !== 'new') {
    return (
      <div className="flex h-screen flex-col items-center justify-center space-y-4">
        <div className="text-lg text-[#e5e4e2]">Atrakcja nie została znaleziona</div>
        <button
          onClick={() => router.push('/crm/attractions')}
          className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
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
            className="rounded-lg p-2 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-light text-[#e5e4e2]">
              {attraction?.name || 'Nowa atrakcja'}
            </h1>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">Szczegóły, wymagany sprzęt i personel</p>
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
                  className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'border-[#d3bb73] text-[#d3bb73]'
                      : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 lg:col-span-2">
                <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje podstawowe</h2>
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
                <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
                  <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Limity i czasy</h2>
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
                      <p className="text-[#e5e4e2]">{attraction.breakdown_time_minutes || 0} min</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
                  <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Podsumowanie</h2>
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
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-light text-[#e5e4e2]">Wymagany sprzęt</h2>
                <button
                  onClick={() => setShowAddEquipmentModal(true)}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj sprzęt
                </button>
              </div>

              {requiredEquipment.length === 0 ? (
                <div className="py-12 text-center">
                  <Wrench className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
                  <p className="text-[#e5e4e2]/60">Brak wymaganego sprzętu</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {requiredEquipment.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4"
                    >
                      <div className="flex-1">
                        <h3 className="font-medium text-[#e5e4e2]">
                          {item.equipment?.name || 'Nieznany sprzęt'}
                        </h3>
                        <div className="mt-1 flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                          <span>Ilość: {item.quantity}</span>
                          {item.is_primary && <span className="text-[#d3bb73]">Główny</span>}
                        </div>
                        {item.notes && (
                          <p className="mt-2 text-sm text-[#e5e4e2]/40">{item.notes}</p>
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
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'staff' && (
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-light text-[#e5e4e2]">Wymagany personel</h2>
                <button
                  onClick={() => setShowAddStaffModal(true)}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj personel
                </button>
              </div>

              {requiredStaff.length === 0 ? (
                <div className="py-12 text-center">
                  <Users className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
                  <p className="text-[#e5e4e2]/60">Brak wymaganego personelu</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {requiredStaff.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4"
                    >
                      <div className="flex-1">
                        <h3 className="font-medium text-[#e5e4e2]">{item.role}</h3>
                        <p className="mt-1 text-sm text-[#e5e4e2]/60">Ilość: {item.count}</p>
                        {item.required_skills && item.required_skills.length > 0 && (
                          <div className="mt-2 flex gap-2">
                            {item.required_skills.map((skill: string, idx: number) => (
                              <span
                                key={idx}
                                className="rounded bg-blue-500/20 px-2 py-1 text-xs text-blue-400"
                              >
                                {skill}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.notes && (
                          <p className="mt-2 text-sm text-[#e5e4e2]/40">{item.notes}</p>
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
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'costs' && (
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-light text-[#e5e4e2]">Kosztorys</h2>
                <button
                  onClick={() => setShowAddCostModal(true)}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj koszt
                </button>
              </div>

              {costs.length === 0 ? (
                <div className="py-12 text-center">
                  <DollarSign className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
                  <p className="text-[#e5e4e2]/60">Brak kosztów</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {costs.map((cost) => (
                    <div
                      key={cost.id}
                      className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-[#e5e4e2]">{cost.description}</h3>
                          <span className="rounded bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73]">
                            {cost.cost_type}
                          </span>
                        </div>
                        {cost.notes && (
                          <p className="mt-1 text-sm text-[#e5e4e2]/40">{cost.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-medium text-[#d3bb73]">
                          {cost.amount?.toLocaleString('pl-PL')} zł
                        </span>
                        <button
                          onClick={async () => {
                            if (confirm('Usunąć ten koszt?')) {
                              await supabase.from('attraction_costs').delete().eq('id', cost.id);
                              fetchAttractionDetails();
                            }
                          }}
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="rounded-lg border-2 border-[#d3bb73]/30 bg-[#0f1119] p-4">
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
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-light text-[#e5e4e2]">Szablon checklisty</h2>
                  <p className="mt-1 text-sm text-[#e5e4e2]/60">
                    Automatycznie generowany przy dodaniu do eventu
                  </p>
                </div>
                <button
                  onClick={() => setShowAddChecklistModal(true)}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj punkt
                </button>
              </div>

              {checklistTemplates.length === 0 ? (
                <div className="py-12 text-center">
                  <CheckSquare className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
                  <p className="text-[#e5e4e2]/60">Brak szablonu checklisty</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {checklistTemplates.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4"
                    >
                      <CheckSquare className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-[#e5e4e2]">{item.title}</h3>
                          {item.is_required && (
                            <span className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-400">
                              Wymagane
                            </span>
                          )}
                          {item.category && (
                            <span className="rounded bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73]">
                              {item.category}
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="mt-1 text-sm text-[#e5e4e2]/60">{item.description}</p>
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
                        <Trash2 className="h-4 w-4" />
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
