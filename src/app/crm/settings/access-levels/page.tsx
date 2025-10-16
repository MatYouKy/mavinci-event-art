'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
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

  useEffect(() => {
    fetchAccessLevels();
  }, []);

  const fetchAccessLevels = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('access_levels')
        .select('*')
        .order('order_index');

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
          })
          .eq('id', editingLevel.id);

        if (error) throw error;
        showSnackbar('Poziom dostępu zaktualizowany', 'success');
      } else {
        const { error } = await supabase
          .from('access_levels')
          .insert([{
            name: formData.name,
            slug: formData.slug,
            description: formData.description,
            config: formData.config,
            default_permissions: formData.default_permissions,
            order_index: accessLevels.length + 1,
          }]);

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
      const { error } = await supabase
        .from('access_levels')
        .delete()
        .eq('id', id);

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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-[#d3bb73]" />
          <h1 className="text-2xl font-bold text-[#e5e4e2]">Poziomy dostępu</h1>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 bg-[#d3bb73] text-[#0f1119] px-4 py-2 rounded hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Dodaj poziom
        </button>
      </div>

      <div className="grid gap-4">
        {accessLevels.map((level) => (
          <div key={level.id} className="bg-[#1a1d29] border border-[#d3bb73]/20 rounded-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-medium text-[#e5e4e2] mb-1">{level.name}</h3>
                <p className="text-sm text-[#e5e4e2]/60 mb-2">{level.description}</p>
                <code className="text-xs bg-[#0f1119] px-2 py-1 rounded text-[#d3bb73]">
                  {level.slug}
                </code>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleOpenModal(level)}
                  className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(level.id)}
                  className="p-2 text-red-400 hover:bg-red-400/10 rounded transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(level.config).map(([key, value]) => (
                <div
                  key={key}
                  className={`text-xs px-3 py-2 rounded ${
                    value
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-[#0f1119] text-[#e5e4e2]/40 border border-[#e5e4e2]/10'
                  }`}
                >
                  {key.replace(/_/g, ' ')}
                </div>
              ))}
            </div>

            {level.default_permissions.length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-[#e5e4e2]/60 mb-2">Domyślne uprawnienia:</div>
                <div className="flex flex-wrap gap-2">
                  {level.default_permissions.map((perm) => (
                    <span
                      key={perm}
                      className="text-xs bg-[#d3bb73]/20 text-[#d3bb73] px-2 py-1 rounded"
                    >
                      {perm}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1d29] border border-[#d3bb73]/30 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-[#e5e4e2]">
                  {editingLevel ? 'Edytuj poziom dostępu' : 'Nowy poziom dostępu'}
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/80 mb-2">Nazwa</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/30 rounded px-3 py-2 text-[#e5e4e2]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/80 mb-2">Slug</label>
                    <input
                      type="text"
                      value={formData.slug}
                      onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/30 rounded px-3 py-2 text-[#e5e4e2]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/80 mb-2">Opis</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/30 rounded px-3 py-2 text-[#e5e4e2] h-20"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/80 mb-3">Konfiguracja dostępu</label>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.keys(formData.config).map((key) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
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
                        <span className="text-sm text-[#e5e4e2]">
                          {key.replace(/_/g, ' ')}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/80 mb-3">Domyślne uprawnienia</label>
                  <div className="grid grid-cols-2 gap-3">
                    {availablePermissions.map((perm) => (
                      <label key={perm.value} className="flex items-center gap-2 cursor-pointer">
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
                                  (p) => p !== perm.value
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
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleSave}
                  className="flex items-center gap-2 bg-[#d3bb73] text-[#0f1119] px-6 py-2 rounded hover:bg-[#d3bb73]/90 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  Zapisz
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="px-6 py-2 border border-[#d3bb73]/30 rounded text-[#e5e4e2] hover:bg-[#d3bb73]/10 transition-colors"
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
