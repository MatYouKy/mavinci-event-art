'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { Shield, Plus, Edit, Trash2, Save, X } from 'lucide-react';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface AccessLevel {
  id: string;
  name: string;
  slug: string;
  description: string;
  config: {
    view_full_event: boolean;
    view_agenda: boolean;
    view_files: boolean;
    view_team: boolean;
    view_equipment: boolean;
    view_client_info: boolean;
    view_budget: boolean;
    edit_tasks: boolean;
    manage_equipment: boolean;
  };
  default_permissions: string[];
  event_tabs: string[];
  order_index: number;
}

export default function AccessLevelsPage() {
  const [accessLevels, setAccessLevels] = useState<AccessLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingLevel, setEditingLevel] = useState<AccessLevel | null>(null);
  const [showModal, setShowModal] = useState(false);
  const { showSnackbar } = useSnackbar();
  const { employee, loading: employeeLoading } = useCurrentEmployee();

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
    config: {
      view_full_event: false,
      view_agenda: false,
      view_files: false,
      view_team: false,
      view_equipment: false,
      view_client_info: false,
      view_budget: false,
      edit_tasks: false,
      manage_equipment: false,
    },
    default_permissions: [] as string[],
    event_tabs: ['overview'] as string[],
  });

  const availablePermissions = [
    { value: 'events_manage', label: 'Zarządzanie wydarzeniami' },
    { value: 'clients_manage', label: 'Zarządzanie klientami' },
    { value: 'employees_manage', label: 'Zarządzanie pracownikami' },
    { value: 'equipment_manage', label: 'Zarządzanie sprzętem' },
    { value: 'offers_manage', label: 'Zarządzanie ofertami' },
    { value: 'contracts_manage', label: 'Zarządzanie umowami' },
    { value: 'messages_manage', label: 'Zarządzanie wiadomościami' },
    { value: 'attractions_manage', label: 'Zarządzanie atrakcjami' },
    { value: 'event_categories_manage', label: 'Zarządzanie kategoriami wydarzeń' },
  ];

  const availableEventTabs = [
    { value: 'overview', label: 'Przegląd', description: 'Podstawowe informacje o wydarzeniu' },
    { value: 'offer', label: 'Oferta', description: 'Tworzenie i zarządzanie ofertami' },
    { value: 'finances', label: 'Finanse', description: 'Budżet i koszty wydarzenia' },
    { value: 'contract', label: 'Umowa', description: 'Zarządzanie umowami' },
    {
      value: 'equipment',
      label: 'Sprzęt',
      description: 'Lista sprzętu przypisanego do wydarzenia',
    },
    { value: 'team', label: 'Zespół', description: 'Pracownicy przypisani do wydarzenia' },
    { value: 'logistics', label: 'Logistyka', description: 'Pojazdy i transport' },
    { value: 'subcontractors', label: 'Podwykonawcy', description: 'Zewnętrzni wykonawcy' },
    { value: 'files', label: 'Pliki', description: 'Dokumenty i załączniki' },
    { value: 'tasks', label: 'Zadania', description: 'Zarządzanie zadaniami' },
    { value: 'history', label: 'Historia', description: 'Dziennik zmian wydarzenia' },
  ];

  useEffect(() => {
    fetchAccessLevels();
  }, []);

  const fetchAccessLevels = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('access_levels').select('*').order('order_index');

      if (error) throw error;
      setAccessLevels(data || []);
    } catch (err) {
      console.error('Error fetching access levels:', err);
      showSnackbar('Błąd podczas pobierania poziomów dostępu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (level?: AccessLevel) => {
    if (level) {
      setEditingLevel(level);
      setFormData({
        name: level.name,
        slug: level.slug,
        description: level.description || '',
        config: level.config,
        default_permissions: level.default_permissions || [],
        event_tabs: level.event_tabs || ['overview'],
      });
    } else {
      setEditingLevel(null);
      setFormData({
        name: '',
        slug: '',
        description: '',
        config: {
          view_full_event: false,
          view_agenda: false,
          view_files: false,
          view_team: false,
          view_equipment: false,
          view_client_info: false,
          view_budget: false,
          edit_tasks: false,
          manage_equipment: false,
        },
        default_permissions: [],
        event_tabs: ['overview'],
      });
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    try {
      if (editingLevel) {
        const { error } = await supabase
          .from('access_levels')
          .update({
            name: formData.name,
            slug: formData.slug,
            description: formData.description,
            config: formData.config,
            default_permissions: formData.default_permissions,
            event_tabs: formData.event_tabs,
          })
          .eq('id', editingLevel.id);

        if (error) throw error;
        showSnackbar('Poziom dostępu zaktualizowany', 'success');
      } else {
        const { error } = await supabase.from('access_levels').insert([
          {
            name: formData.name,
            slug: formData.slug,
            description: formData.description,
            config: formData.config,
            default_permissions: formData.default_permissions,
            event_tabs: formData.event_tabs,
            order_index: accessLevels.length + 1,
          },
        ]);

        if (error) throw error;
        showSnackbar('Poziom dostępu utworzony', 'success');
      }

      setShowModal(false);
      fetchAccessLevels();
    } catch (err) {
      console.error('Error saving access level:', err);
      showSnackbar('Błąd podczas zapisywania', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten poziom dostępu?')) return;

    try {
      const { error } = await supabase.from('access_levels').delete().eq('id', id);

      if (error) throw error;
      showSnackbar('Poziom dostępu usunięty', 'success');
      fetchAccessLevels();
    } catch (err) {
      console.error('Error deleting access level:', err);
      showSnackbar('Błąd podczas usuwania', 'error');
    }
  };

  if (employeeLoading || loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  if (!employee || employee.role !== 'admin') {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[#e5e4e2]/60">Brak dostępu</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-[#d3bb73]" />
          <h1 className="text-2xl font-bold text-[#e5e4e2]">Poziomy dostępu</h1>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 rounded bg-[#d3bb73] px-4 py-2 text-[#0f1119] transition-colors hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj poziom
        </button>
      </div>

      <div className="grid gap-4">
        {accessLevels.map((level) => (
          <div key={level.id} className="rounded-lg border border-[#d3bb73]/20 bg-[#1a1d29] p-6">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="mb-1 text-lg font-medium text-[#e5e4e2]">{level.name}</h3>
                <p className="mb-2 text-sm text-[#e5e4e2]/60">{level.description}</p>
                <code className="rounded bg-[#0f1119] px-2 py-1 text-xs text-[#d3bb73]">
                  {level.slug}
                </code>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleOpenModal(level)}
                  className="rounded p-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                >
                  <Edit className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(level.id)}
                  className="rounded p-2 text-red-400 transition-colors hover:bg-red-400/10"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {Object.entries(level.config).map(([key, value]) => (
                <div
                  key={key}
                  className={`rounded px-3 py-2 text-xs ${
                    value
                      ? 'border border-green-500/30 bg-green-500/20 text-green-400'
                      : 'border border-[#e5e4e2]/10 bg-[#0f1119] text-[#e5e4e2]/40'
                  }`}
                >
                  {key.replace(/_/g, ' ')}
                </div>
              ))}
            </div>

            {level.default_permissions.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-xs text-[#e5e4e2]/60">Domyślne uprawnienia:</div>
                <div className="flex flex-wrap gap-2">
                  {level.default_permissions.map((perm) => (
                    <span
                      key={perm}
                      className="rounded bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73]"
                    >
                      {perm}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {level.event_tabs && level.event_tabs.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-xs text-[#e5e4e2]/60">Dostępne zakładki wydarzeń:</div>
                <div className="flex flex-wrap gap-2">
                  {level.event_tabs.map((tab) => {
                    const tabInfo = availableEventTabs.find((t) => t.value === tab);
                    return (
                      <span
                        key={tab}
                        className="rounded bg-blue-500/20 px-2 py-1 text-xs text-blue-400"
                        title={tabInfo?.description}
                      >
                        {tabInfo?.label || tab}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-[#d3bb73]/30 bg-[#1a1d29]">
            <div className="p-6">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-xl font-bold text-[#e5e4e2]">
                  {editingLevel ? 'Edytuj poziom dostępu' : 'Nowy poziom dostępu'}
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/80">Nazwa</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full rounded border border-[#d3bb73]/30 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/80">Slug</label>
                    <input
                      type="text"
                      value={formData.slug}
                      onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                      className="w-full rounded border border-[#d3bb73]/30 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/80">Opis</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="h-20 w-full rounded border border-[#d3bb73]/30 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                  />
                </div>

                <div>
                  <label className="mb-3 block text-sm text-[#e5e4e2]/80">
                    Konfiguracja dostępu
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.keys(formData.config).map((key) => (
                      <label key={key} className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={formData.config[key as keyof typeof formData.config]}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              config: { ...formData.config, [key]: e.target.checked },
                            })
                          }
                          className="rounded text-[#d3bb73]"
                        />
                        <span className="text-sm text-[#e5e4e2]">{key.replace(/_/g, ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-3 block text-sm text-[#e5e4e2]/80">
                    Domyślne uprawnienia
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {availablePermissions.map((perm) => (
                      <label key={perm.value} className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={formData.default_permissions.includes(perm.value)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                default_permissions: [...formData.default_permissions, perm.value],
                              });
                            } else {
                              setFormData({
                                ...formData,
                                default_permissions: formData.default_permissions.filter(
                                  (p) => p !== perm.value,
                                ),
                              });
                            }
                          }}
                          className="rounded text-[#d3bb73]"
                        />
                        <span className="text-sm text-[#e5e4e2]">{perm.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[#d3bb73]/20 pt-6">
                  <label className="mb-3 block text-sm text-[#e5e4e2]/80">
                    Dostępne zakładki w wydarzeniach
                    <span className="mt-1 block text-xs text-[#e5e4e2]/50">
                      Wybierz zakładki, które będą widoczne dla pracowników z tym poziomem dostępu
                    </span>
                  </label>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {availableEventTabs.map((tab) => (
                      <label
                        key={tab.value}
                        className="flex cursor-pointer items-start gap-3 rounded border border-[#d3bb73]/20 bg-[#0f1119] p-3 transition-colors hover:border-[#d3bb73]/40"
                      >
                        <input
                          type="checkbox"
                          checked={formData.event_tabs.includes(tab.value)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                event_tabs: [...formData.event_tabs, tab.value],
                              });
                            } else {
                              setFormData({
                                ...formData,
                                event_tabs: formData.event_tabs.filter((t) => t !== tab.value),
                              });
                            }
                          }}
                          className="mt-0.5 rounded text-[#d3bb73]"
                        />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-[#e5e4e2]">{tab.label}</div>
                          <div className="mt-0.5 text-xs text-[#e5e4e2]/50">{tab.description}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  onClick={handleSave}
                  className="flex items-center gap-2 rounded bg-[#d3bb73] px-6 py-2 text-[#0f1119] transition-colors hover:bg-[#d3bb73]/90"
                >
                  <Save className="h-4 w-4" />
                  Zapisz
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="rounded border border-[#d3bb73]/30 px-6 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
                >
                  Anuluj
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
