'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { FileText, Plus, CreditCard as Edit, Trash2, Copy, Eye, Search } from 'lucide-react';

interface ContractTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  category: string;
  placeholders: any[];
  is_active: boolean;
  created_at: string;
}

export default function ContractTemplatesPage() {
  const router = useRouter();
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
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data) {
        setTemplates(data);
      }
    } catch (err) {
      console.error('Error fetching templates:', err);
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
          t.description?.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    }

    if (categoryFilter !== 'all') {
      filtered = filtered.filter((t) => t.category === categoryFilter);
    }

    setFilteredTemplates(filtered);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten szablon?')) return;

    try {
      const { error } = await supabase.from('contract_templates').delete().eq('id', id);

      if (error) throw error;
      fetchTemplates();
    } catch (err) {
      console.error('Error deleting template:', err);
      alert('Błąd podczas usuwania szablonu');
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('contract_templates')
        .update({ is_active: !isActive })
        .eq('id', id);

      if (error) throw error;
      fetchTemplates();
    } catch (err) {
      console.error('Error updating template:', err);
      alert('Błąd podczas aktualizacji szablonu');
    }
  };

  const categoryLabels: Record<string, string> = {
    event: 'Event',
    service: 'Usługa',
    rental: 'Wynajem',
    other: 'Inne',
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-light text-[#e5e4e2]">Szablony umów</h1>
            <p className="text-[#e5e4e2]/60">Zarządzaj szablonami umów</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-5 w-5" />
            Nowy szablon
          </button>
        </div>

        <div className="mb-6 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
              <input
                type="text"
                placeholder="Szukaj szablonów..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-2 pl-10 pr-4 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
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
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
            <FileText className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
            <h3 className="mb-2 text-xl font-light text-[#e5e4e2]">Brak szablonów</h3>
            <p className="mb-6 text-[#e5e4e2]/60">Utwórz pierwszy szablon umowy</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              <Plus className="h-5 w-5" />
              Nowy szablon
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 transition-colors hover:border-[#d3bb73]/30"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-3">
                      <h3 className="text-lg font-light text-[#e5e4e2]">{template.name}</h3>
                      <span
                        className={`rounded px-2 py-1 text-xs ${
                          template.is_active
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {template.is_active ? 'Aktywny' : 'Nieaktywny'}
                      </span>
                      <span className="rounded bg-blue-500/20 px-2 py-1 text-xs text-blue-400">
                        {categoryLabels[template.category]}
                      </span>
                    </div>
                    {template.description && (
                      <p className="mb-3 text-sm text-[#e5e4e2]/60">{template.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-[#e5e4e2]/40">
                      <span>Placeholdery: {template.placeholders?.length || 0}</span>
                      <span>
                        Utworzono: {new Date(template.created_at).toLocaleDateString('pl-PL')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => router.push(`/crm/contract-templates/${template.id}`)}
                      className="rounded-lg p-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                      title="Szczegóły"
                    >
                      <Eye className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() =>
                        router.push(`/crm/contract-templates/${template.id}/edit-wysiwyg`)
                      }
                      className="rounded-lg p-2 text-blue-400 transition-colors hover:bg-blue-400/10"
                      title="Edytor WYSIWYG"
                    >
                      <Edit className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => handleToggleActive(template.id, template.is_active)}
                      className="rounded-lg p-2 text-yellow-400 transition-colors hover:bg-yellow-400/10"
                      title={template.is_active ? 'Dezaktywuj' : 'Aktywuj'}
                    >
                      <Copy className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(template.id)}
                      className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-400/10"
                      title="Usuń"
                    >
                      <Trash2 className="h-5 w-5" />
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
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'event',
  });

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      alert('Nazwa szablonu jest wymagana');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('contract_templates')
        .insert([
          {
            name: formData.name,
            description: formData.description || null,
            category: formData.category,
            content: '',
            placeholders: [],
            is_active: true,
          },
        ])
        .select();

      if (error) throw error;

      if (data && data[0]) {
        router.push(`/crm/contract-templates/${data[0].id}/edit-wysiwyg`);
      }
    } catch (err) {
      console.error('Error creating template:', err);
      alert('Błąd podczas tworzenia szablonu');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-light text-[#e5e4e2]">Nowy szablon umowy</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa szablonu *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="np. Umowa na organizację eventu"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="h-24 w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Krótki opis szablonu"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kategoria</label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            >
              <option value="event">Event</option>
              <option value="service">Usługa</option>
              <option value="rental">Wynajem</option>
              <option value="other">Inne</option>
            </select>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={handleSubmit}
            className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            Utwórz i edytuj
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#1c1f33]"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
