'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { FileText, Plus, CreditCard as Edit, Trash2, Copy, Eye, Search } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface ContractTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  event_category_id: string | null;
  event_categories?: { id: string; name: string; color: string };
  is_active: boolean;
  created_at: string;
}

export default function ContractTemplatesPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, []);

  useEffect(() => {
    filterTemplates();
  }, [searchQuery, categoryFilter, templates]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('contract_templates')
        .select('*, event_categories(id, name, color)')
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data) {
        setTemplates(data);
      }
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd ładowania szablonów', 'error');
    } finally {
      setLoading(false);
    }
  };

  const filterTemplates = () => {
    let filtered = [...templates];

    if (searchQuery) {
      filtered = filtered.filter(
        (t) =>
          t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (categoryFilter !== 'all') {
      filtered = filtered.filter((t) => t.event_category_id === categoryFilter);
    }

    setFilteredTemplates(filtered);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten szablon?')) return;

    try {
      const { error } = await supabase
        .from('contract_templates')
        .delete()
        .eq('id', id);

      if (error) throw error;
      showSnackbar('Szablon usunięty', 'success');
      fetchTemplates();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd podczas usuwania szablonu', 'error');
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('contract_templates')
        .update({ is_active: !isActive })
        .eq('id', id);

      if (error) throw error;
      showSnackbar('Status szablonu zaktualizowany', 'success');
      fetchTemplates();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd podczas aktualizacji szablonu', 'error');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0d1a] flex items-center justify-center">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-light text-[#e5e4e2] mb-2">Szablony umów</h1>
            <p className="text-[#e5e4e2]/60">Zarządzaj szablonami umów</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Nowy szablon
          </button>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
              <input
                type="text"
                placeholder="Szukaj szablonów..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg pl-10 pr-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="all">Wszystkie kategorie</option>
              <option value="event">Event</option>
              <option value="service">Usługa</option>
              <option value="rental">Wynajem</option>
              <option value="other">Inne</option>
            </select>
          </div>
        </div>

        {filteredTemplates.length === 0 ? (
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-12 text-center">
            <FileText className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
            <h3 className="text-xl font-light text-[#e5e4e2] mb-2">Brak szablonów</h3>
            <p className="text-[#e5e4e2]/60 mb-6">Utwórz pierwszy szablon umowy</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Nowy szablon
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-light text-[#e5e4e2]">
                        {template.name}
                      </h3>
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          template.is_active
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {template.is_active ? 'Aktywny' : 'Nieaktywny'}
                      </span>
                      {template.event_categories && (
                        <span
                          className="text-xs px-2 py-1 rounded flex items-center gap-1"
                          style={{
                            backgroundColor: `${template.event_categories.color}20`,
                            color: template.event_categories.color
                          }}
                        >
                          {template.event_categories.name}
                        </span>
                      )}
                    </div>
                    {template.description && (
                      <p className="text-sm text-[#e5e4e2]/60 mb-3">
                        {template.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-[#e5e4e2]/40">
                      <span>
                        Utworzono:{' '}
                        {new Date(template.created_at).toLocaleDateString('pl-PL')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => router.push(`/crm/contract-templates/${template.id}`)}
                      className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                      title="Szczegóły"
                    >
                      <Eye className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => router.push(`/crm/contract-templates/${template.id}/edit-wysiwyg`)}
                      className="p-2 text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors"
                      title="Edytor WYSIWYG"
                    >
                      <Edit className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleToggleActive(template.id, template.is_active)}
                      className="p-2 text-yellow-400 hover:bg-yellow-400/10 rounded-lg transition-colors"
                      title={template.is_active ? 'Dezaktywuj' : 'Aktywuj'}
                    >
                      <Copy className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(template.id)}
                      className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      title="Usuń"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateTemplateModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            fetchTemplates();
          }}
        />
      )}
    </div>
  );
}

function CreateTemplateModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    event_category_id: '',
  });
  const [eventCategories, setEventCategories] = useState<{id: string; name: string; color: string}[]>([]);

  useEffect(() => {
    fetchEventCategories();
  }, []);

  const fetchEventCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('event_categories')
        .select('id, name, color')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setEventCategories(data || []);
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd ładowania kategorii', 'error');
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      showSnackbar('Nazwa szablonu jest wymagana', 'error');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('contract_templates')
        .insert([
          {
            name: formData.name,
            description: formData.description || null,
            event_category_id: formData.event_category_id || null,
            content: '',
            is_active: true,
          },
        ])
        .select();

      if (error) throw error;

      if (data && data[0]) {
        showSnackbar('Szablon utworzony', 'success');
        router.push(`/crm/contract-templates/${data[0].id}/edit-wysiwyg`);
      }
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd podczas tworzenia szablonu', 'error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-lg w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">Nowy szablon umowy</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Nazwa szablonu *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              placeholder="np. Umowa na organizację eventu"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] h-24 resize-none"
              placeholder="Krótki opis szablonu"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Kategoria wydarzenia (opcjonalnie)
            </label>
            <select
              value={formData.event_category_id}
              onChange={(e) => setFormData({ ...formData, event_category_id: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="">Bez kategorii</option>
              {eventCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSubmit}
            className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            Utwórz i edytuj
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[#e5e4e2]/60 hover:bg-[#1c1f33] transition-colors"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
