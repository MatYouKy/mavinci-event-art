'use client';

import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Save, X, FileText, Building2, DollarSign, CheckCircle, Upload, Image as ImageIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import dynamic from 'next/dynamic';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';

interface OfferPageTemplate {
  id: string;
  type: 'cover' | 'about' | 'pricing' | 'final';
  name: string;
  description: string;
  is_default: boolean;
  is_active: boolean;
  pdf_url?: string;
  created_by: string;
  created_at: string;
}

interface TemplateContent {
  id: string;
  template_id: string;
  section_type: string;
  content_html: string;
  content_json: any;
  display_order: number;
  styles: any;
}

const templateTypes = [
  { value: 'cover', label: 'Strona tytułowa', icon: FileText, description: 'Pierwsza strona oferty z logo i danymi' },
  { value: 'about', label: 'O nas', icon: Building2, description: 'Informacje o firmie i doświadczeniu' },
  { value: 'pricing', label: 'Wycena', icon: DollarSign, description: 'Podsumowanie cenowe i warunki' },
  { value: 'final', label: 'Strona końcowa', icon: CheckCircle, description: 'Warunki techniczne i dane sprzedawcy' },
];

const sectionTypes: Record<string, string[]> = {
  cover: ['logo', 'title', 'subtitle', 'client_details', 'offer_details', 'background_image'],
  about: ['company_description', 'achievements', 'certifications', 'team', 'gallery'],
  pricing: ['summary_table', 'payment_terms', 'validity', 'notes'],
  final: ['technical_requirements', 'seller_details', 'contact_info', 'legal_terms', 'footer'],
};

export default function OfferPageTemplatesEditor() {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const [templates, setTemplates] = useState<OfferPageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<string>('cover');
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<OfferPageTemplate | null>(null);
  const [showContentEditor, setShowContentEditor] = useState(false);
  const [editingContent, setEditingContent] = useState<TemplateContent[]>([]);
  const [uploadingPdf, setUploadingPdf] = useState<string | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, [selectedType]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('offer_page_templates')
        .select('*')
        .eq('type', selectedType)
        .order('is_default', { ascending: false })
        .order('name');

      if (error) throw error;
      setTemplates(data || []);
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd pobierania szablonów', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTemplate = () => {
    setEditingTemplate(null);
    setShowModal(true);
  };

  const handleEditTemplate = async (template: OfferPageTemplate) => {
    setEditingTemplate(template);

    const { data: content } = await supabase
      .from('offer_page_template_content')
      .select('*')
      .eq('template_id', template.id)
      .order('display_order');

    setEditingContent(content || []);
    setShowContentEditor(true);
  };

  const handleDeleteTemplate = async (template: OfferPageTemplate) => {
    const confirmed = await showConfirm({
      title: 'Usunąć szablon?',
      message: `Czy na pewno chcesz usunąć szablon "${template.name}"? Ta operacja jest nieodwracalna.`,
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    });

    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('offer_page_templates')
        .delete()
        .eq('id', template.id);

      if (error) throw error;

      showSnackbar('Szablon usunięty', 'success');
      fetchTemplates();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd usuwania szablonu', 'error');
    }
  };

  const getTypeInfo = (type: string) => {
    return templateTypes.find(t => t.value === type);
  };

  const handleUploadPdf = async (template: OfferPageTemplate, file: File) => {
    if (!file.type.includes('pdf')) {
      showSnackbar('Wybierz plik PDF', 'error');
      return;
    }

    try {
      setUploadingPdf(template.id);

      const fileName = `${template.type}_${template.id}_${Date.now()}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from('offer-template-pages')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('offer_page_templates')
        .update({ pdf_url: fileName })
        .eq('id', template.id);

      if (updateError) throw updateError;

      showSnackbar('Plik PDF zapisany', 'success');
      fetchTemplates();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd uploadu PDF', 'error');
    } finally {
      setUploadingPdf(null);
    }
  };

  const handleDeletePdf = async (template: OfferPageTemplate) => {
    if (!template.pdf_url) return;

    const confirmed = await showConfirm({
      title: 'Usunąć plik PDF?',
      message: 'Czy na pewno chcesz usunąć plik PDF z tego szablonu?',
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    });

    if (!confirmed) return;

    try {
      await supabase.storage
        .from('offer-template-pages')
        .remove([template.pdf_url]);

      const { error } = await supabase
        .from('offer_page_templates')
        .update({ pdf_url: null })
        .eq('id', template.id);

      if (error) throw error;

      showSnackbar('Plik PDF usunięty', 'success');
      fetchTemplates();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd usuwania PDF', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-light text-[#e5e4e2]">Szablony stron ofert</h2>
          <p className="text-sm text-[#e5e4e2]/60 mt-1">
            Zarządzaj szablonami stron: tytułowa, o nas, wycena, końcowa
          </p>
        </div>
        <button
          onClick={handleCreateTemplate}
          className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nowy szablon
        </button>
      </div>

      {/* Filtry typów */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {templateTypes.map((type) => {
          const Icon = type.icon;
          const isSelected = selectedType === type.value;
          const count = templates.filter(t => t.type === type.value).length;

          return (
            <button
              key={type.value}
              onClick={() => setSelectedType(type.value)}
              className={`relative p-4 rounded-xl border transition-all ${
                isSelected
                  ? 'bg-[#d3bb73]/10 border-[#d3bb73]/30'
                  : 'bg-[#1c1f33] border-[#d3bb73]/10 hover:border-[#d3bb73]/20'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${
                  isSelected ? 'bg-[#d3bb73]/20' : 'bg-[#d3bb73]/10'
                }`}>
                  <Icon className={`w-5 h-5 ${isSelected ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60'}`} />
                </div>
                <div className="flex-1 text-left">
                  <h3 className={`font-medium mb-1 ${
                    isSelected ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'
                  }`}>
                    {type.label}
                  </h3>
                  <p className="text-xs text-[#e5e4e2]/60">{type.description}</p>
                </div>
              </div>
              {count > 0 && (
                <span className="absolute top-2 right-2 px-2 py-0.5 bg-[#d3bb73]/20 text-[#d3bb73] text-xs rounded-full">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Lista szablonów */}
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <h3 className="text-lg font-light text-[#e5e4e2] mb-4">
          {getTypeInfo(selectedType)?.label}
        </h3>

        {templates.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
            <p className="text-[#e5e4e2]/60 mb-4">
              Brak szablonów dla tego typu strony
            </p>
            <button
              onClick={handleCreateTemplate}
              className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Utwórz szablon
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {templates.map((template) => (
              <div
                key={template.id}
                className="bg-[#0a0d1a] border border-[#d3bb73]/10 rounded-lg p-4 hover:border-[#d3bb73]/20 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h4 className="font-medium text-[#e5e4e2]">{template.name}</h4>
                      {template.is_default && (
                        <span className="px-2 py-0.5 bg-[#d3bb73]/20 text-[#d3bb73] text-xs rounded">
                          Domyślny
                        </span>
                      )}
                      {!template.is_active && (
                        <span className="px-2 py-0.5 bg-gray-500/20 text-gray-400 text-xs rounded">
                          Nieaktywny
                        </span>
                      )}
                    </div>
                    {template.description && (
                      <p className="text-sm text-[#e5e4e2]/60">{template.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      {template.pdf_url ? (
                        <span className="flex items-center gap-2 px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded">
                          <FileText className="w-3 h-3" />
                          PDF załączony
                        </span>
                      ) : (
                        <span className="flex items-center gap-2 px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">
                          <FileText className="w-3 h-3" />
                          Brak PDF
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        disabled={uploadingPdf === template.id}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadPdf(template, file);
                        }}
                      />
                      <div className="p-2 text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors" title="Upload PDF">
                        <Upload className="w-4 h-4" />
                      </div>
                    </label>
                    {template.pdf_url && (
                      <button
                        onClick={() => handleDeletePdf(template)}
                        className="p-2 text-orange-400 hover:bg-orange-400/10 rounded-lg transition-colors"
                        title="Usuń PDF"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleEditTemplate(template)}
                      className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                      title="Edytuj zawartość"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(template)}
                      className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      title="Usuń szablon"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal tworzenia szablonu */}
      {showModal && (
        <CreateTemplateModal
          type={selectedType as any}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false);
            fetchTemplates();
          }}
        />
      )}

      {/* Edytor zawartości */}
      {showContentEditor && editingTemplate && (
        <ContentEditorModal
          template={editingTemplate}
          content={editingContent}
          onClose={() => {
            setShowContentEditor(false);
            setEditingTemplate(null);
            setEditingContent([]);
          }}
          onSuccess={() => {
            setShowContentEditor(false);
            setEditingTemplate(null);
            setEditingContent([]);
            fetchTemplates();
          }}
        />
      )}
    </div>
  );
}

function CreateTemplateModal({ type, onClose, onSuccess }: { type: 'cover' | 'about' | 'pricing' | 'final'; onClose: () => void; onSuccess: () => void }) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    is_default: false,
    is_active: true,
  });

  const handleSubmit = async () => {
    if (!formData.name) {
      showSnackbar('Podaj nazwę szablonu', 'error');
      return;
    }

    try {
      setLoading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Nie jesteś zalogowany');

      const { data: template, error } = await supabase
        .from('offer_page_templates')
        .insert({
          type,
          ...formData,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Stwórz domyślne sekcje dla tego typu
      const defaultSections = sectionTypes[type].map((sectionType, index) => ({
        template_id: template.id,
        section_type: sectionType,
        content_html: '',
        content_json: {},
        display_order: index,
        styles: {},
      }));

      const { error: sectionsError } = await supabase
        .from('offer_page_template_content')
        .insert(defaultSections);

      if (sectionsError) throw sectionsError;

      showSnackbar('Szablon utworzony', 'success');
      onSuccess();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd tworzenia szablonu', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-2xl w-full">
        <div className="p-6 border-b border-[#d3bb73]/10 flex items-center justify-between">
          <h3 className="text-xl font-light text-[#e5e4e2]">Nowy szablon</h3>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa szablonu *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              placeholder="np. Szablon standardowy"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              placeholder="Opcjonalny opis szablonu..."
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
              />
              <span className="text-sm text-[#e5e4e2]">Ustaw jako domyślny</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
              />
              <span className="text-sm text-[#e5e4e2]">Aktywny</span>
            </label>
          </div>
        </div>

        <div className="p-6 border-t border-[#d3bb73]/10 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Tworzenie...' : 'Utwórz szablon'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContentEditorModal({ template, content, onClose, onSuccess }: { template: OfferPageTemplate; content: TemplateContent[]; onClose: () => void; onSuccess: () => void }) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<TemplateContent[]>(content);
  const [activeSection, setActiveSection] = useState<string>(content[0]?.section_type || '');

  const handleSaveSection = async (sectionId: string, html: string) => {
    setSections(prev => prev.map(s =>
      s.id === sectionId ? { ...s, content_html: html } : s
    ));
  };

  const handleSaveAll = async () => {
    try {
      setLoading(true);

      for (const section of sections) {
        const { error } = await supabase
          .from('offer_page_template_content')
          .update({
            content_html: section.content_html,
            content_json: section.content_json,
          })
          .eq('id', section.id);

        if (error) throw error;
      }

      showSnackbar('Szablon zapisany', 'success');
      onSuccess();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd zapisu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getSectionLabel = (sectionType: string) => {
    const labels: Record<string, string> = {
      logo: 'Logo',
      title: 'Tytuł',
      subtitle: 'Podtytuł',
      client_details: 'Dane klienta',
      offer_details: 'Szczegóły oferty',
      background_image: 'Obrazek tła',
      company_description: 'Opis firmy',
      achievements: 'Osiągnięcia',
      certifications: 'Certyfikaty',
      team: 'Zespół',
      gallery: 'Galeria',
      summary_table: 'Tabela podsumowania',
      payment_terms: 'Warunki płatności',
      validity: 'Ważność oferty',
      notes: 'Notatki',
      technical_requirements: 'Wymagania techniczne',
      seller_details: 'Dane sprzedawcy',
      contact_info: 'Informacje kontaktowe',
      legal_terms: 'Warunki prawne',
      footer: 'Stopka',
    };
    return labels[sectionType] || sectionType;
  };

  const activeContent = sections.find(s => s.section_type === activeSection);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-[#d3bb73]/10 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-xl font-light text-[#e5e4e2]">Edycja szablonu: {template.name}</h3>
            <p className="text-sm text-[#e5e4e2]/60 mt-1">
              {templateTypes.find(t => t.value === template.type)?.label}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar z sekcjami */}
          <div className="w-64 border-r border-[#d3bb73]/10 overflow-y-auto flex-shrink-0">
            <div className="p-4 space-y-1">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.section_type)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    activeSection === section.section_type
                      ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                      : 'text-[#e5e4e2]/80 hover:bg-[#0a0d1a]'
                  }`}
                >
                  {getSectionLabel(section.section_type)}
                </button>
              ))}
            </div>
          </div>

          {/* Edytor WYSIWYG */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeContent && (
              <div className="space-y-4">
                <h4 className="text-lg font-medium text-[#e5e4e2]">
                  {getSectionLabel(activeContent.section_type)}
                </h4>
                <div className="bg-white rounded-lg overflow-hidden">
                  <ReactQuill
                    theme="snow"
                    value={activeContent.content_html || ''}
                    onChange={(html) => handleSaveSection(activeContent.id, html)}
                    modules={{
                      toolbar: [
                        [{ header: [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ list: 'ordered' }, { list: 'bullet' }],
                        [{ align: [] }],
                        ['link', 'image'],
                        [{ color: [] }, { background: [] }],
                        ['clean'],
                      ],
                    }}
                    className="h-96"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-[#d3bb73]/10 flex gap-3 justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20"
          >
            Anuluj
          </button>
          <button
            onClick={handleSaveAll}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {loading ? 'Zapisywanie...' : 'Zapisz wszystko'}
          </button>
        </div>
      </div>
    </div>
  );
}
