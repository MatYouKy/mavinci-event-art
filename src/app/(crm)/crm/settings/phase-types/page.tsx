'use client';

import React, { useState } from 'react';
import { Plus, Edit, Trash2, Save, X } from 'lucide-react';
import {
  useGetPhaseTypesQuery,
  useCreatePhaseTypeMutation,
  useUpdatePhaseTypeMutation,
  EventPhaseType,
} from '@/store/api/eventPhasesApi';
import { useSnackbar } from '@/contexts/SnackbarContext';

export default function PhaseTypesManagementPage() {
  const { data: phaseTypes = [], isLoading } = useGetPhaseTypesQuery();
  const [createPhaseType] = useCreatePhaseTypeMutation();
  const [updatePhaseType] = useUpdatePhaseTypeMutation();
  const { showSnackbar } = useSnackbar();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<Partial<EventPhaseType>>({
    name: '',
    description: '',
    color: '#3b82f6',
    default_duration_hours: 4,
    sequence_priority: 0,
    is_active: true,
  });

  const handleCreate = async () => {
    if (!formData.name?.trim()) {
      showSnackbar('Nazwa jest wymagana', 'error');
      return;
    }

    try {
      await createPhaseType(formData).unwrap();
      showSnackbar('Typ fazy utworzony', 'success');
      setIsCreating(false);
      setFormData({
        name: '',
        description: '',
        color: '#3b82f6',
        default_duration_hours: 4,
        sequence_priority: 0,
        is_active: true,
      });
    } catch (error) {
      showSnackbar('Błąd podczas tworzenia typu fazy', 'error');
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      await updatePhaseType({ id, data: formData }).unwrap();
      showSnackbar('Typ fazy zaktualizowany', 'success');
      setEditingId(null);
    } catch (error) {
      showSnackbar('Błąd podczas aktualizacji typu fazy', 'error');
    }
  };

  const handleDeactivate = async (type: EventPhaseType) => {
    try {
      await updatePhaseType({
        id: type.id,
        data: { is_active: false },
      }).unwrap();
      showSnackbar('Typ fazy dezaktywowany', 'success');
    } catch (error) {
      showSnackbar('Błąd podczas dezaktywacji', 'error');
    }
  };

  const startEdit = (type: EventPhaseType) => {
    setEditingId(type.id);
    setFormData({
      name: type.name,
      description: type.description || '',
      color: type.color,
      default_duration_hours: type.default_duration_hours,
      sequence_priority: type.sequence_priority,
      is_active: type.is_active,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsCreating(false);
    setFormData({
      name: '',
      description: '',
      color: '#3b82f6',
      default_duration_hours: 4,
      sequence_priority: 0,
      is_active: true,
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#e5e4e2]">Typy Faz Wydarzeń</h1>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Zarządzaj typami faz używanymi w harmonogramie wydarzeń
          </p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj Typ Fazy
        </button>
      </div>

      {/* Create Form */}
      {isCreating && (
        <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
          <h3 className="mb-4 text-lg font-semibold text-[#e5e4e2]">Nowy Typ Fazy</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-[#e5e4e2]/60">Nazwa *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="np. Montaż"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-[#e5e4e2]/60">Domyślny czas (godz.)</label>
              <input
                type="number"
                value={formData.default_duration_hours}
                onChange={(e) =>
                  setFormData({ ...formData, default_duration_hours: parseInt(e.target.value) })
                }
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-[#e5e4e2]/60">Kolor</label>
              <input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="h-10 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119]"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-[#e5e4e2]/60">Kolejność</label>
              <input
                type="number"
                value={formData.sequence_priority}
                onChange={(e) =>
                  setFormData({ ...formData, sequence_priority: parseInt(e.target.value) })
                }
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-sm text-[#e5e4e2]/60">Opis</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="Opcjonalny opis..."
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={cancelEdit}
              className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10"
            >
              Anuluj
            </button>
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33]"
            >
              <Save className="h-4 w-4" />
              Zapisz
            </button>
          </div>
        </div>
      )}

      {/* Types List */}
      <div className="space-y-2">
        {phaseTypes.map((type) => (
          <div
            key={type.id}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4 transition-colors hover:border-[#d3bb73]/40"
          >
            {editingId === type.id ? (
              // Edit Mode
              <div>
                <div className="mb-4 grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm text-[#e5e4e2]/60">Nazwa *</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm text-[#e5e4e2]/60">
                      Domyślny czas (godz.)
                    </label>
                    <input
                      type="number"
                      value={formData.default_duration_hours}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          default_duration_hours: parseInt(e.target.value),
                        })
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm text-[#e5e4e2]/60">Kolor</label>
                    <input
                      type="color"
                      value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      className="h-10 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119]"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm text-[#e5e4e2]/60">Kolejność</label>
                    <input
                      type="number"
                      value={formData.sequence_priority}
                      onChange={(e) =>
                        setFormData({ ...formData, sequence_priority: parseInt(e.target.value) })
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="mb-1 block text-sm text-[#e5e4e2]/60">Opis</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={2}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={cancelEdit}
                    className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10"
                  >
                    <X className="h-4 w-4" />
                    Anuluj
                  </button>
                  <button
                    onClick={() => handleUpdate(type.id)}
                    className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33]"
                  >
                    <Save className="h-4 w-4" />
                    Zapisz
                  </button>
                </div>
              </div>
            ) : (
              // View Mode
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div
                    className="mt-1 h-10 w-10 rounded-lg border-2"
                    style={{ borderColor: type.color, backgroundColor: `${type.color}20` }}
                  />
                  <div>
                    <h3 className="text-lg font-semibold text-[#e5e4e2]">{type.name}</h3>
                    {type.description && (
                      <p className="mt-1 text-sm text-[#e5e4e2]/60">{type.description}</p>
                    )}
                    <div className="mt-2 flex items-center gap-4 text-xs text-[#e5e4e2]/40">
                      <span>Domyślny czas: {type.default_duration_hours}h</span>
                      <span>Kolejność: {type.sequence_priority}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEdit(type)}
                    className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDeactivate(type)}
                    className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
