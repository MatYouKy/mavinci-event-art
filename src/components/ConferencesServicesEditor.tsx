'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { X, Plus, Edit2, ChevronDown, ChevronUp } from 'lucide-react';
import { div } from 'framer-motion/client';
import { useEditMode } from '@/contexts/EditModeContext';

interface Service {
  id: string;
  category_name: string;
  category_description: string;
  services_list: string[];
  icon_name: string;
  display_order: number;
  is_active: boolean;
}

interface Props {
  services: Service[];
}

const availableIcons = [
  'Mic',
  'Camera',
  'Lightbulb',
  'Monitor',
  'Wifi',
  'Settings',
  'Video',
  'Music',
  'Presentation',
  'Package',
];

export function ConferencesServicesEditor({ services }: Props) {
  const { isEditMode } = useEditMode();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Service>>({});
  const [newServiceItem, setNewServiceItem] = useState('');
  const [expandedServices, setExpandedServices] = useState<Set<string>>(new Set());

  const handleStartEdit = (service: Service) => {
    setEditingId(service.id);
    setEditData(service);
  };

  const handleSave = async (id: string) => {
    const { error } = await supabase.from('conferences_services').update(editData).eq('id', id);

    if (!error) {
      setEditingId(null);
      setEditData({});
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę kategorię?')) return;

    const { error } = await supabase.from('conferences_services').delete().eq('id', id);

    if (!error) {
    }
  };

  const handleAddService = async () => {
    const { error } = await supabase.from('conferences_services').insert({
      category_name: 'Nowa kategoria',
      category_description: 'Opis kategorii',
      services_list: ['Usługa 1', 'Usługa 2'],
      icon_name: 'Settings',
      display_order: services.length,
      is_active: true,
    });

    if (!error) {
    }
  };

  const addServiceToList = () => {
    if (!newServiceItem.trim() || !editData.services_list) return;
    setEditData({
      ...editData,
      services_list: [...editData.services_list, newServiceItem.trim()],
    });
    setNewServiceItem('');
  };

  const removeServiceFromList = (index: number) => {
    if (!editData.services_list) return;
    setEditData({
      ...editData,
      services_list: editData.services_list.filter((_, i) => i !== index),
    });
  };

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedServices);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedServices(newExpanded);
  };

  if (!isEditMode)
    return (
      <div>
        <h1>Zakres obsługi technicznej</h1>
      </div>
    );

  return (
    <div className="mb-8 rounded-xl border-2 border-[#d3bb73] bg-[#1c1f33] p-6">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-xl font-medium text-[#d3bb73]">Edycja Zakresu Obsługi Technicznej</h3>
        <button
          onClick={handleAddService}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj kategorię
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {services.map((service) => (
          <div key={service.id} className="rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-4">
            {editingId === service.id ? (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]">Nazwa kategorii</label>
                  <input
                    type="text"
                    value={editData.category_name || ''}
                    onChange={(e) => setEditData({ ...editData, category_name: e.target.value })}
                    className="w-full rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]">Ikona</label>
                  <select
                    value={editData.icon_name || 'Settings'}
                    onChange={(e) => setEditData({ ...editData, icon_name: e.target.value })}
                    className="w-full rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  >
                    {availableIcons.map((icon) => (
                      <option key={icon} value={icon}>
                        {icon}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]">Opis</label>
                  <textarea
                    value={editData.category_description || ''}
                    onChange={(e) =>
                      setEditData({ ...editData, category_description: e.target.value })
                    }
                    rows={2}
                    className="w-full resize-none rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs text-[#e5e4e2]">Usługi w pakiecie</label>
                  <div className="mb-2 space-y-2">
                    {editData.services_list?.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 rounded bg-[#1c1f33] px-2 py-1"
                      >
                        <span className="flex-1 text-xs text-[#e5e4e2]">{item}</span>
                        <button
                          onClick={() => removeServiceFromList(idx)}
                          className="rounded p-1 text-red-400 hover:bg-red-400/10"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newServiceItem}
                      onChange={(e) => setNewServiceItem(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && addServiceToList()}
                      placeholder="Nowa usługa..."
                      className="flex-1 rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-2 py-1 text-xs text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    />
                    <button
                      onClick={addServiceToList}
                      className="rounded bg-[#d3bb73]/20 px-3 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/30"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 border-t border-[#d3bb73]/20 pt-2">
                  <button
                    onClick={() => handleSave(service.id)}
                    className="flex-1 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                  >
                    Zapisz
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setEditData({});
                    }}
                    className="flex-1 rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-xs text-[#e5e4e2] transition-colors hover:border-[#d3bb73]"
                  >
                    Anuluj
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="mb-1 font-medium text-[#d3bb73]">{service.category_name}</h4>
                    <p className="text-xs text-[#e5e4e2]/70">{service.category_description}</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleStartEdit(service)}
                      className="rounded p-1.5 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                      title="Edytuj"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(service.id)}
                      className="rounded p-1.5 text-red-400 transition-colors hover:bg-red-400/10"
                      title="Usuń"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => toggleExpanded(service.id)}
                  className="mb-2 flex items-center gap-2 text-xs text-[#e5e4e2]/60 transition-colors hover:text-[#d3bb73]"
                >
                  {expandedServices.has(service.id) ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                  <span>Usługi ({service.services_list.length})</span>
                </button>

                {expandedServices.has(service.id) && (
                  <ul className="space-y-1 text-xs text-[#e5e4e2]/70">
                    {service.services_list.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="mt-0.5 text-[#d3bb73]">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
