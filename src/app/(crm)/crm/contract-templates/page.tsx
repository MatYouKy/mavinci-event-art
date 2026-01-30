'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { FileText, Plus, CreditCard as Edit, Trash2, Copy, Eye, Search } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { IContractTemplate } from './type';

export default function ContractTemplatesPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [templates, setTemplates] = useState<IContractTemplate[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<IContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    fetchTemplates();
  }, []);

  useEffect(() => {
    filterTemplates();
  }, [searchQuery, templates]);

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
          t.description?.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    }

    setFilteredTemplates(filtered);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten szablon?')) return;

    try {
      const { error } = await supabase.from('contract_templates').delete().eq('id', id);

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

  const handleDuplicate = async (template: IContractTemplate) => {
    if (!confirm(`Czy na pewno chcesz zduplikować szablon "${template.name}"?`)) return;

    try {
      const { data, error } = await supabase
        .from('contract_templates')
        .insert([
          {
            name: `${template.name} (kopia)`,
            description: template.description,
            content: template.content,
            content_html: template.content_html,
            page_settings: template.page_settings,
            is_active: false,
          },
        ])
        .select();

      if (error) throw error;

      if (data && data[0]) {
        showSnackbar('Szablon zduplikowany pomyślnie', 'success');
        fetchTemplates();
      }
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd podczas duplikowania szablonu', 'error');
    }
  };

  const handleStartEdit = (template: IContractTemplate) => {
    setEditingId(template.id);
    setEditingName(template.name);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editingName.trim()) {
      showSnackbar('Nazwa nie może być pusta', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('contract_templates')
        .update({ name: editingName.trim(), updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      showSnackbar('Nazwa szablonu zaktualizowana', 'success');
      setEditingId(null);
      setEditingName('');
      fetchTemplates();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd podczas zapisywania', 'error');
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
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
                      {editingId === template.id ? (
                        <div className="flex flex-1 items-center gap-2">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit(template.id);
                              if (e.key === 'Escape') handleCancelEdit();
                            }}
                            className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveEdit(template.id)}
                            className="rounded-lg bg-[#d3bb73] px-3 py-1 text-sm text-[#1c1f33] hover:bg-[#d3bb73]/90"
                          >
                            Zapisz
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="rounded-lg border border-[#d3bb73]/20 px-3 py-1 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10"
                          >
                            Anuluj
                          </button>
                        </div>
                      ) : (
                        <h3
                          onClick={() => handleStartEdit(template)}
                          className="cursor-pointer text-lg font-light text-[#e5e4e2] transition-colors hover:text-[#d3bb73]"
                          title="Kliknij aby edytować nazwę"
                        >
                          {template.name}
                        </h3>
                      )}
                      <span
                        className={`rounded px-2 py-1 text-xs ${
                          template.is_active
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {template.is_active ? 'Aktywny' : 'Nieaktywny'}
                      </span>
                    </div>
                    {template.description && (
                      <p className="mb-3 text-sm text-[#e5e4e2]/60">{template.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-[#e5e4e2]/40">
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
                      onClick={() => handleDuplicate(template)}
                      className="rounded-lg p-2 text-green-400 transition-colors hover:bg-green-400/10"
                      title="Duplikuj szablon"
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
  const { showSnackbar } = useSnackbar();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
  });

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
