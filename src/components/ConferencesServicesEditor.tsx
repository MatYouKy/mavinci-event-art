'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
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
  'Mic', 'Camera', 'Lightbulb', 'Monitor', 'Wifi', 'Settings',
  'Video', 'Music', 'Presentation', 'Package'
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
    const { error } = await supabase
      .from('conferences_services')
      .update(editData)
      .eq('id', id);

    if (!error) {
      setEditingId(null);
      setEditData({});
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę kategorię?')) return;

    const { error } = await supabase
      .from('conferences_services')
      .delete()
      .eq('id', id);

    if (!error) {
    }
  };

  const handleAddService = async () => {
    const { error } = await supabase
      .from('conferences_services')
      .insert({
        category_name: 'Nowa kategoria',
        category_description: 'Opis kategorii',
        services_list: ['Usługa 1', 'Usługa 2'],
        icon_name: 'Settings',
        display_order: services.length,
        is_active: true
      });

    if (!error) {
    }
  };

  const addServiceToList = () => {
    if (!newServiceItem.trim() || !editData.services_list) return;
    setEditData({
      ...editData,
      services_list: [...editData.services_list, newServiceItem.trim()]
    });
    setNewServiceItem('');
  };

  const removeServiceFromList = (index: number) => {
    if (!editData.services_list) return;
    setEditData({
      ...editData,
      services_list: editData.services_list.filter((_, i) => i !== index)
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

  if (!isEditMode) return <div>
<h1>Zakres obsługi technicznej</h1>

  </div>;

  return (
    <div className="bg-[#1c1f33] border-2 border-[#d3bb73] rounded-xl p-6 mb-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-[#d3bb73] text-xl font-medium">Edycja Zakresu Obsługi Technicznej</h3>
        <button
          onClick={handleAddService}
          className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Dodaj kategorię
        </button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {services.map((service) => (
          <div
            key={service.id}
            className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-4"
          >
            {editingId === service.id ? (
              <div className="space-y-3">
                <div>
                  <label className="text-[#e5e4e2] text-xs mb-1 block">Nazwa kategorii</label>
                  <input
                    type="text"
                    value={editData.category_name || ''}
                    onChange={(e) => setEditData({ ...editData, category_name: e.target.value })}
                    className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[#e5e4e2] text-xs mb-1 block">Ikona</label>
                  <select
                    value={editData.icon_name || 'Settings'}
                    onChange={(e) => setEditData({ ...editData, icon_name: e.target.value })}
                    className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none"
                  >
                    {availableIcons.map((icon) => (
                      <option key={icon} value={icon}>{icon}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[#e5e4e2] text-xs mb-1 block">Opis</label>
                  <textarea
                    value={editData.category_description || ''}
                    onChange={(e) => setEditData({ ...editData, category_description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none resize-none"
                  />
                </div>

                <div>
                  <label className="text-[#e5e4e2] text-xs mb-2 block">Usługi w pakiecie</label>
                  <div className="space-y-2 mb-2">
                    {editData.services_list?.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-[#1c1f33] rounded px-2 py-1">
                        <span className="text-[#e5e4e2] text-xs flex-1">{item}</span>
                        <button
                          onClick={() => removeServiceFromList(idx)}
                          className="p-1 text-red-400 hover:bg-red-400/10 rounded"
                        >
                          <X className="w-3 h-3" />
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
                      className="flex-1 px-2 py-1 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] text-xs focus:border-[#d3bb73] focus:outline-none"
                    />
                    <button
                      onClick={addServiceToList}
                      className="px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded text-xs hover:bg-[#d3bb73]/30"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 pt-2 border-t border-[#d3bb73]/20">
                  <button
                    onClick={() => handleSave(service.id)}
                    className="flex-1 px-3 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-xs font-medium"
                  >
                    Zapisz
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setEditData({});
                    }}
                    className="flex-1 px-3 py-2 bg-[#1c1f33] text-[#e5e4e2] border border-[#d3bb73]/30 rounded-lg hover:border-[#d3bb73] transition-colors text-xs"
                  >
                    Anuluj
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h4 className="text-[#d3bb73] font-medium mb-1">{service.category_name}</h4>
                    <p className="text-[#e5e4e2]/70 text-xs">{service.category_description}</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleStartEdit(service)}
                      className="p-1.5 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors"
                      title="Edytuj"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(service.id)}
                      className="p-1.5 text-red-400 hover:bg-red-400/10 rounded transition-colors"
                      title="Usuń"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => toggleExpanded(service.id)}
                  className="flex items-center gap-2 text-[#e5e4e2]/60 text-xs hover:text-[#d3bb73] transition-colors mb-2"
                >
                  {expandedServices.has(service.id) ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                  <span>Usługi ({service.services_list.length})</span>
                </button>

                {expandedServices.has(service.id) && (
                  <ul className="space-y-1 text-xs text-[#e5e4e2]/70">
                    {service.services_list.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-[#d3bb73] mt-0.5">•</span>
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
