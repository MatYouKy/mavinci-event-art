'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  FileText,
  Building2,
  DollarSign,
  CheckCircle,
  Upload,
  Image as ImageIcon,
  Settings,
  Move,
  Type,
  ChevronDown,
  ChevronRight,
  Tag,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import dynamic from 'next/dynamic';
import Draggable from 'react-draggable';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';

interface OfferTemplateCategory {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  color: string;
  created_at: string;
  updated_at: string;
}

interface OfferPageTemplate {
  id: string;
  type: 'cover' | 'about' | 'pricing' | 'final';
  name: string;
  description: string;
  is_default: boolean;
  is_active: boolean;
  pdf_url?: string;
  pdf_width?: number;
  pdf_height?: number;
  text_fields_config?: TextFieldConfig[];
  template_category_id?: string;
  created_by: string;
  created_at: string;
}

interface TextFieldConfig {
  field_name: string;
  label: string;
  x: number;
  y: number;
  type?: 'text' | 'image';
  font_size?: number;
  font_color?: string;
  max_width?: number;
  align?: 'left' | 'center' | 'right';
  width?: number;
  height?: number;
  border_radius?: number;
  is_circular?: boolean;
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
  {
    value: 'cover',
    label: 'Strona tytułowa',
    icon: FileText,
    description: 'Pierwsza strona oferty z logo i danymi',
  },
  {
    value: 'about',
    label: 'O nas',
    icon: Building2,
    description: 'Informacje o firmie i doświadczeniu',
  },
  {
    value: 'pricing',
    label: 'Wycena',
    icon: DollarSign,
    description: 'Podsumowanie cenowe i warunki',
  },
  {
    value: 'final',
    label: 'Strona końcowa',
    icon: CheckCircle,
    description: 'Warunki techniczne i dane sprzedawcy',
  },
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
  const { employee } = useCurrentEmployee();
  const [templates, setTemplates] = useState<OfferPageTemplate[]>([]);
  const [categories, setCategories] = useState<OfferTemplateCategory[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<string>('cover');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<OfferPageTemplate | null>(null);
  const [showContentEditor, setShowContentEditor] = useState(false);
  const [editingContent, setEditingContent] = useState<TemplateContent[]>([]);
  const [uploadingPdf, setUploadingPdf] = useState<string | null>(null);
  const [showTextFieldsEditor, setShowTextFieldsEditor] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<OfferTemplateCategory | null>(null);

  useEffect(() => {
    fetchCategories();
    fetchTemplates();
  }, [selectedType]);

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('offer_template_categories')
        .select('*')
        .order('is_default', { ascending: false })
        .order('name');

      if (error) throw error;
      setCategories(data || []);

      if (data && data.length > 0) {
        const defaultCategory = data.find((c) => c.is_default);
        if (defaultCategory) {
          setExpandedCategories(new Set([defaultCategory.id]));
        }
      }
    } catch (err: any) {
      console.error('Error fetching categories:', err);
      showSnackbar('Błąd podczas ładowania kategorii', 'error');
    }
  };

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('offer_page_templates')
        .select('*')
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

  const handleEditTextFields = (template: OfferPageTemplate) => {
    setEditingTemplate(template);
    setShowTextFieldsEditor(true);
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
      const { error } = await supabase.from('offer_page_templates').delete().eq('id', template.id);

      if (error) throw error;

      showSnackbar('Szablon usunięty', 'success');
      fetchTemplates();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd usuwania szablonu', 'error');
    }
  };

  const getTypeInfo = (type: string) => {
    return templateTypes.find((t) => t.value === type);
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
      await supabase.storage.from('offer-template-pages').remove([template.pdf_url]);

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

  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  const getTemplatesForCategory = (categoryId: string, type: string) => {
    return templates.filter((t) => t.template_category_id === categoryId && t.type === type);
  };

  const handleEditCategory = (category: OfferTemplateCategory) => {
    setEditingCategory(category);
    setShowCategoryModal(true);
  };

  const handleCreateCategory = () => {
    setEditingCategory(null);
    setShowCategoryModal(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-light text-[#e5e4e2]">Szablony stron ofert</h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Zarządzaj kategoriami i szablonami stron dla różnych typów eventów
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCreateCategory}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
          >
            <Tag className="h-4 w-4" />
            Nowa kategoria
          </button>
          <button
            onClick={() => {
              setSelectedCategoryId(
                categories.find((c) => c.is_default)?.id || categories[0]?.id || null,
              );
              handleCreateTemplate();
            }}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Nowy szablon
          </button>
        </div>
      </div>

      {/* Kategorie w accordion */}
      <div className="space-y-3">
        {categories.map((category) => {
          const isExpanded = expandedCategories.has(category.id);

          return (
            <div
              key={category.id}
              className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]"
            >
              {/* Header kategorii */}
              <button
                onClick={() => toggleCategory(category.id)}
                className="flex w-full items-center justify-between p-4 transition-colors hover:bg-[#d3bb73]/5"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg"
                    style={{ backgroundColor: category.color }}
                  >
                    <Tag className="h-5 w-5 text-white" />
                  </div>
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-medium text-[#e5e4e2]">{category.name}</h3>
                      {category.is_default && (
                        <span className="rounded bg-[#d3bb73] px-2 py-0.5 text-xs text-[#1c1f33]">
                          Domyślna
                        </span>
                      )}
                    </div>
                    {category.description && (
                      <p className="mt-0.5 text-sm text-[#e5e4e2]/60">{category.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditCategory(category);
                    }}
                    className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                    title="Edytuj kategorię"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5 text-[#e5e4e2]/60" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-[#e5e4e2]/60" />
                  )}
                </div>
              </button>

              {/* Rozwinięta zawartość - typy stron i szablony */}
              {isExpanded && (
                <div className="space-y-4 border-t border-[#d3bb73]/10 p-4">
                  {templateTypes.map((type) => {
                    const Icon = type.icon;
                    const categoryTemplates = getTemplatesForCategory(category.id, type.value);

                    return (
                      <div key={type.value} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-[#d3bb73]" />
                            <h4 className="font-medium text-[#e5e4e2]">{type.label}</h4>
                            <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                              {categoryTemplates.length}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              setSelectedCategoryId(category.id);
                              setSelectedType(type.value);
                              handleCreateTemplate();
                            }}
                            className="rounded bg-[#d3bb73]/20 px-3 py-1 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
                          >
                            + Dodaj
                          </button>
                        </div>

                        {categoryTemplates.length > 0 ? (
                          <div className="space-y-2 pl-6">
                            {categoryTemplates.map((template) => (
                              <div
                                key={template.id}
                                className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-3 transition-colors hover:border-[#d3bb73]/20"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex-1">
                                    <div className="mb-1 flex items-center gap-2">
                                      <h5 className="text-sm font-medium text-[#e5e4e2]">
                                        {template.name}
                                      </h5>
                                      {template.is_default && (
                                        <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                                          Domyślny
                                        </span>
                                      )}
                                      {!template.is_active && (
                                        <span className="rounded bg-gray-500/20 px-2 py-0.5 text-xs text-gray-400">
                                          Nieaktywny
                                        </span>
                                      )}
                                    </div>
                                    {template.description && (
                                      <p className="text-xs text-[#e5e4e2]/60">
                                        {template.description}
                                      </p>
                                    )}
                                    <div className="mt-1 flex items-center gap-2">
                                      {template.pdf_url ? (
                                        <span className="flex items-center gap-1 rounded bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                                          <FileText className="h-3 w-3" />
                                          PDF
                                        </span>
                                      ) : (
                                        <span className="flex items-center gap-1 rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                                          <FileText className="h-3 w-3" />
                                          Brak PDF
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
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
                                      <div
                                        className="rounded p-1.5 text-blue-400 transition-colors hover:bg-blue-400/10"
                                        title="Upload PDF"
                                      >
                                        <Upload className="h-4 w-4" />
                                      </div>
                                    </label>
                                    {template.pdf_url && (
                                      <button
                                        onClick={() => handleEditTextFields(template)}
                                        className="rounded p-1.5 text-green-400 transition-colors hover:bg-green-400/10"
                                        title="Konfiguruj pola"
                                      >
                                        <Type className="h-4 w-4" />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleEditTemplate(template)}
                                      className="rounded p-1.5 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                                      title="Edytuj"
                                    >
                                      <Edit className="h-4 w-4" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteTemplate(template)}
                                      className="rounded p-1.5 text-[#e5e4e2]/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
                                      title="Usuń"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="pl-6 text-sm italic text-[#e5e4e2]/40">
                            Brak szablonów
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {categories.length === 0 && (
          <div className="py-12 text-center text-[#e5e4e2]/60">
            <Tag className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
            <p className="mb-4">Brak kategorii szablonów</p>
            <button
              onClick={handleCreateCategory}
              className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              <Plus className="h-4 w-4" />
              Utwórz pierwszą kategorię
            </button>
          </div>
        )}
      </div>

      {/* Old template types - remove this */}
      <div className="hidden">
        {templateTypes.map((type) => {
          const Icon = type.icon;
          const isSelected = selectedType === type.value;
          const count = templates.filter((t) => t.type === type.value).length;

          return (
            <button
              key={type.value}
              onClick={() => setSelectedType(type.value)}
              className={`relative rounded-xl border p-4 transition-all ${
                isSelected
                  ? 'border-[#d3bb73]/30 bg-[#d3bb73]/10'
                  : 'border-[#d3bb73]/10 bg-[#1c1f33] hover:border-[#d3bb73]/20'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`rounded-lg p-2 ${isSelected ? 'bg-[#d3bb73]/20' : 'bg-[#d3bb73]/10'}`}
                >
                  <Icon
                    className={`h-5 w-5 ${isSelected ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60'}`}
                  />
                </div>
                <div className="flex-1 text-left">
                  <h3
                    className={`mb-1 font-medium ${
                      isSelected ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'
                    }`}
                  >
                    {type.label}
                  </h3>
                  <p className="text-xs text-[#e5e4e2]/60">{type.description}</p>
                </div>
              </div>
              {count > 0 && (
                <span className="absolute right-2 top-2 rounded-full bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Lista szablonów */}
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">
          {getTypeInfo(selectedType)?.label}
        </h3>

        {templates.length === 0 ? (
          <div className="py-12 text-center">
            <FileText className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
            <p className="mb-4 text-[#e5e4e2]/60">Brak szablonów dla tego typu strony</p>
            <button
              onClick={handleCreateTemplate}
              className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              <Plus className="h-4 w-4" />
              Utwórz szablon
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {templates.map((template) => (
              <div
                key={template.id}
                className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4 transition-colors hover:border-[#d3bb73]/20"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-3">
                      <h4 className="font-medium text-[#e5e4e2]">{template.name}</h4>
                      {template.is_default && (
                        <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                          Domyślny
                        </span>
                      )}
                      {!template.is_active && (
                        <span className="rounded bg-gray-500/20 px-2 py-0.5 text-xs text-gray-400">
                          Nieaktywny
                        </span>
                      )}
                    </div>
                    {template.description && (
                      <p className="text-sm text-[#e5e4e2]/60">{template.description}</p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      {template.pdf_url ? (
                        <span className="flex items-center gap-2 rounded bg-green-500/20 px-2 py-1 text-xs text-green-400">
                          <FileText className="h-3 w-3" />
                          PDF załączony
                        </span>
                      ) : (
                        <span className="flex items-center gap-2 rounded bg-red-500/20 px-2 py-1 text-xs text-red-400">
                          <FileText className="h-3 w-3" />
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
                      <div
                        className="rounded-lg p-2 text-blue-400 transition-colors hover:bg-blue-400/10"
                        title="Upload PDF"
                      >
                        <Upload className="h-4 w-4" />
                      </div>
                    </label>
                    {template.pdf_url && (
                      <>
                        <button
                          onClick={() => handleEditTextFields(template)}
                          className="rounded-lg p-2 text-green-400 transition-colors hover:bg-green-400/10"
                          title="Konfiguruj pola tekstowe"
                        >
                          <Settings className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeletePdf(template)}
                          className="rounded-lg p-2 text-orange-400 transition-colors hover:bg-orange-400/10"
                          title="Usuń PDF"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleEditTemplate(template)}
                      className="rounded-lg p-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                      title="Edytuj zawartość"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(template)}
                      className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-400/10"
                      title="Usuń szablon"
                    >
                      <Trash2 className="h-4 w-4" />
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
          categoryId={selectedCategoryId}
          employee={employee}
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

      {/* Edytor pól tekstowych */}
      {showTextFieldsEditor && editingTemplate && (
        <TextFieldsEditorModal
          template={editingTemplate}
          onClose={() => {
            setShowTextFieldsEditor(false);
            setEditingTemplate(null);
          }}
          onSuccess={() => {
            setShowTextFieldsEditor(false);
            setEditingTemplate(null);
            fetchTemplates();
          }}
        />
      )}

      {/* Modal kategorii */}
      {showCategoryModal && (
        <CategoryModal
          category={editingCategory}
          onClose={() => {
            setShowCategoryModal(false);
            setEditingCategory(null);
          }}
          onSuccess={() => {
            setShowCategoryModal(false);
            setEditingCategory(null);
            fetchCategories();
          }}
        />
      )}
    </div>
  );
}

function CreateTemplateModal({
  type,
  categoryId,
  employee,
  onClose,
  onSuccess,
}: {
  type: 'cover' | 'about' | 'pricing' | 'final';
  categoryId: string | null;
  employee: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
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

    if (!employee?.id) {
      showSnackbar('Musisz być zalogowany', 'error');
      return;
    }

    if (!categoryId) {
      showSnackbar('Nie wybrano kategorii', 'error');
      return;
    }

    try {
      setLoading(true);

      const { data: template, error } = await supabase
        .from('offer_page_templates')
        .insert({
          type,
          ...formData,
          template_category_id: categoryId,
          created_by: employee.id,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">Nowy szablon</h3>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa szablonu *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="np. Szablon standardowy"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Opcjonalny opis szablonu..."
            />
          </div>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
              />
              <span className="text-sm text-[#e5e4e2]">Ustaw jako domyślny</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
              />
              <span className="text-sm text-[#e5e4e2]">Aktywny</span>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[#d3bb73]/10 p-6">
          <button
            onClick={onClose}
            className="rounded-lg bg-[#e5e4e2]/10 px-6 py-2 text-[#e5e4e2] hover:bg-[#e5e4e2]/20"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Tworzenie...' : 'Utwórz szablon'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContentEditorModal({
  template,
  content,
  onClose,
  onSuccess,
}: {
  template: OfferPageTemplate;
  content: TemplateContent[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<TemplateContent[]>(content);
  const [activeSection, setActiveSection] = useState<string>(content[0]?.section_type || '');

  const handleSaveSection = async (sectionId: string, html: string) => {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, content_html: html } : s)));
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

  const activeContent = sections.find((s) => s.section_type === activeSection);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <div>
            <h3 className="text-xl font-light text-[#e5e4e2]">Edycja szablonu: {template.name}</h3>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              {templateTypes.find((t) => t.value === template.type)?.label}
            </p>
          </div>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar z sekcjami */}
          <div className="w-64 flex-shrink-0 overflow-y-auto border-r border-[#d3bb73]/10">
            <div className="space-y-1 p-4">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.section_type)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
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
                <div className="overflow-hidden rounded-lg bg-white">
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

        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-[#d3bb73]/10 p-6">
          <button
            onClick={onClose}
            className="rounded-lg bg-[#e5e4e2]/10 px-6 py-2 text-[#e5e4e2] hover:bg-[#e5e4e2]/20"
          >
            Anuluj
          </button>
          <button
            onClick={handleSaveAll}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {loading ? 'Zapisywanie...' : 'Zapisz wszystko'}
          </button>
        </div>
      </div>
    </div>
  );
}

const AVAILABLE_FIELDS = [
  { value: 'client_name', label: 'Nazwa klienta', type: 'text' },
  { value: 'client_address', label: 'Adres klienta', type: 'text' },
  { value: 'client_nip', label: 'NIP klienta', type: 'text' },
  { value: 'client_city', label: 'Miasto klienta', type: 'text' },
  { value: 'client_postal_code', label: 'Kod pocztowy klienta', type: 'text' },
  { value: 'client_street', label: 'Ulica klienta', type: 'text' },
  { value: 'offer_number', label: 'Numer oferty', type: 'text' },
  { value: 'offer_name', label: 'Nazwa oferty', type: 'text' },
  { value: 'offer_date', label: 'Data oferty', type: 'text' },
  { value: 'event_name', label: 'Nazwa eventu', type: 'text' },
  { value: 'event_date', label: 'Data eventu', type: 'text' },
  { value: 'event_location', label: 'Lokalizacja eventu', type: 'text' },
  { value: 'total_price', label: 'Całkowita cena', type: 'text' },
  { value: 'employee_first_name', label: 'Imię pracownika', type: 'text' },
  { value: 'employee_last_name', label: 'Nazwisko pracownika', type: 'text' },
  { value: 'employee_full_name', label: 'Imię i nazwisko pracownika', type: 'text' },
  { value: 'employee_email', label: 'Email pracownika', type: 'text' },
  { value: 'employee_phone', label: 'Telefon pracownika', type: 'text' },
  { value: 'employee_avatar_url', label: 'Avatar pracownika', type: 'image' },
  { value: 'seller_name', label: 'Nazwa sprzedawcy', type: 'text' },
  { value: 'seller_address', label: 'Adres sprzedawcy', type: 'text' },
  { value: 'seller_nip', label: 'NIP sprzedawcy', type: 'text' },
];

function CategoryModal({
  category,
  onClose,
  onSuccess,
}: {
  category: OfferTemplateCategory | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: category?.name || '',
    description: category?.description || '',
    color: category?.color || '#d3bb73',
    is_default: category?.is_default || false,
  });

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      showSnackbar('Podaj nazwę kategorii', 'error');
      return;
    }

    try {
      setLoading(true);

      if (category) {
        // Update existing category
        const { error } = await supabase
          .from('offer_template_categories')
          .update(formData)
          .eq('id', category.id);

        if (error) throw error;
        showSnackbar('Kategoria zaktualizowana', 'success');
      } else {
        // Create new category
        const { error } = await supabase.from('offer_template_categories').insert(formData);

        if (error) throw error;
        showSnackbar('Kategoria utworzona', 'success');
      }

      onSuccess();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd zapisu kategorii', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">
            {category ? 'Edytuj kategorię' : 'Nowa kategoria'}
          </h3>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa kategorii *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="np. Wesela"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Opis kategorii..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kolor</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="h-10 w-20 rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a]"
              />
              <input
                type="text"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="#d3bb73"
              />
            </div>
          </div>

          <div>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
              />
              <span className="text-sm text-[#e5e4e2]">Ustaw jako domyślną kategorię</span>
            </label>
            <p className="ml-6 mt-1 text-xs text-[#e5e4e2]/40">
              Domyślna kategoria jest używana przy tworzeniu nowych ofert
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[#d3bb73]/10 p-6">
          <button
            onClick={onClose}
            className="rounded-lg bg-[#e5e4e2]/10 px-6 py-2 text-[#e5e4e2] hover:bg-[#e5e4e2]/20"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Zapisywanie...' : category ? 'Zapisz zmiany' : 'Utwórz kategorię'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TextFieldsEditorModal({
  template,
  onClose,
  onSuccess,
}: {
  template: OfferPageTemplate;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [textFields, setTextFields] = useState<TextFieldConfig[]>(
    template.text_fields_config || [],
  );
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [selectedFieldIndex, setSelectedFieldIndex] = useState<number | null>(null);
  const [pdfDimensions, setPdfDimensions] = useState({ width: 595, height: 842 });
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [clickToPlaceMode, setClickToPlaceMode] = useState(false);
  const [pendingField, setPendingField] = useState<Partial<TextFieldConfig> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const embedRef = useRef<HTMLEmbedElement>(null);
  const gridSize = 10;

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.async = true;
    script.onload = () => {
      if ((window as any).pdfjsLib) {
        (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
    };
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, []);

  useEffect(() => {
    if (template.pdf_url) {
      loadPdfUrl();
    }
  }, [template.pdf_url]);

  useEffect(() => {
    if (template.pdf_width && template.pdf_height) {
      setPdfDimensions({ width: template.pdf_width, height: template.pdf_height });
    }
  }, [template.pdf_width, template.pdf_height]);

  const loadPdfUrl = async () => {
    try {
      const { data } = await supabase.storage
        .from('offer-template-pages')
        .createSignedUrl(template.pdf_url!, 3600);

      if (data?.signedUrl) {
        setPdfUrl(data.signedUrl);
        detectPdfDimensions(data.signedUrl);
      }
    } catch (err: any) {
      showSnackbar('Błąd ładowania PDF', 'error');
    }
  };

  const detectPdfDimensions = async (url: string) => {
    try {
      const pdfjsLib = (window as any).pdfjsLib;
      if (!pdfjsLib) {
        return;
      }

      const loadingTask = pdfjsLib.getDocument(url);
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });

      const newDimensions = {
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
      };

      setPdfDimensions(newDimensions);

      if (
        newDimensions.width !== template.pdf_width ||
        newDimensions.height !== template.pdf_height
      ) {
        await supabase
          .from('offer_page_templates')
          .update({
            pdf_width: newDimensions.width,
            pdf_height: newDimensions.height,
          })
          .eq('id', template.id);
      }
    } catch (err) {
      showSnackbar('Błąd wykrywania wymiarów PDF', 'error');
    }
  };

  const snapToGridIfEnabled = (value: number) => {
    if (!snapToGrid) return value;
    return Math.round(value / gridSize) * gridSize;
  };

  const handleAddField = () => {
    if (clickToPlaceMode) {
      setPendingField({
        field_name: 'client_name',
        label: 'Nazwa klienta',
        type: 'text',
        font_size: 14,
        font_color: '#000000',
        align: 'left',
      });
      showSnackbar('Kliknij na PDF aby umieścić pole', 'info');
    } else {
      const newField: TextFieldConfig = {
        field_name: 'client_name',
        label: 'Nazwa klienta',
        type: 'text',
        x: snapToGridIfEnabled(50),
        y: snapToGridIfEnabled(50),
        font_size: 14,
        font_color: '#000000',
        align: 'left',
      };
      setTextFields((prev) => [...prev, newField]);
      setSelectedFieldIndex(textFields.length);
    }
  };

  const handlePdfClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pendingField || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = snapToGridIfEnabled(e.clientX - rect.left);
    const y = snapToGridIfEnabled(e.clientY - rect.top);

    const newField: TextFieldConfig = {
      ...(pendingField as TextFieldConfig),
      x,
      y,
    };

    setTextFields((prev) => [...prev, newField]);
    setSelectedFieldIndex(textFields.length);
    setPendingField(null);
    setClickToPlaceMode(false);
  };

  const handleUpdateField = (index: number, updates: Partial<TextFieldConfig>) => {
    setTextFields((prev) =>
      prev.map((field, i) => (i === index ? { ...field, ...updates } : field)),
    );
  };

  const handleDeleteField = (index: number) => {
    setTextFields((prev) => prev.filter((_, i) => i !== index));
    if (selectedFieldIndex === index) {
      setSelectedFieldIndex(null);
    }
  };

  const handleDragStop = (index: number, e: any, data: any) => {
    const x = snapToGridIfEnabled(Math.max(0, Math.min(data.x, pdfDimensions.width - 100)));
    const y = snapToGridIfEnabled(Math.max(0, Math.min(data.y, pdfDimensions.height - 50)));

    handleUpdateField(index, { x, y });
  };

  const handleSaveAll = async () => {
    try {
      setLoading(true);

      const { error } = await supabase
        .from('offer_page_templates')
        .update({ text_fields_config: textFields })
        .eq('id', template.id);

      if (error) throw error;

      showSnackbar('Konfiguracja pól zapisana', 'success');
      onSuccess();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd zapisu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const selectedField = selectedFieldIndex !== null ? textFields[selectedFieldIndex] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[90vh] w-full max-w-[95vw] flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[#d3bb73]/10 p-4">
          <div>
            <h3 className="text-xl font-light text-[#e5e4e2]">
              Konfiguracja pól tekstowych: {template.name}
            </h3>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              PDF: {pdfDimensions.width}x{pdfDimensions.height}px | Pól: {textFields.length}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/80">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
                className="rounded"
              />
              Siatka
            </label>
            <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/80">
              <input
                type="checkbox"
                checked={snapToGrid}
                onChange={(e) => setSnapToGrid(e.target.checked)}
                className="rounded"
              />
              Przyciągaj
            </label>
            <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/80">
              <input
                type="checkbox"
                checked={clickToPlaceMode}
                onChange={(e) => setClickToPlaceMode(e.target.checked)}
                className="rounded"
              />
              Kliknij aby umieścić
            </label>
            <button
              onClick={handleAddField}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                clickToPlaceMode
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-[#d3bb73] text-[#1c1f33] hover:bg-[#d3bb73]/90'
              }`}
            >
              <Plus className="h-4 w-4" />
              {clickToPlaceMode ? 'Kliknij na PDF' : 'Dodaj pole'}
            </button>
            <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Podgląd PDF z polami */}
          <div className="flex-1 overflow-auto bg-[#0a0d1a] p-6">
            <div className="mx-auto flex justify-center">
              {pdfUrl ? (
                <div
                  className="relative"
                  style={{
                    width: `${pdfDimensions.width}px`,
                    height: `${pdfDimensions.height}px`,
                  }}
                >
                  {/* PDF jako tło */}
                  <div className="absolute inset-0 overflow-hidden rounded-lg bg-white shadow-2xl">
                    <embed
                      ref={embedRef}
                      src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                      type="application/pdf"
                      className="h-full w-full"
                    />
                  </div>

                  {/* Siatka pomocnicza */}
                  {showGrid && (
                    <svg
                      className="pointer-events-none absolute inset-0"
                      style={{ zIndex: 1 }}
                      width={pdfDimensions.width}
                      height={pdfDimensions.height}
                    >
                      <defs>
                        <pattern
                          id="grid"
                          width={gridSize}
                          height={gridSize}
                          patternUnits="userSpaceOnUse"
                        >
                          <path
                            d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
                            fill="none"
                            stroke="rgba(211, 187, 115, 0.15)"
                            strokeWidth="0.5"
                          />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#grid)" />
                    </svg>
                  )}

                  {/* Warstwa z polami tekstowymi */}
                  <div
                    ref={containerRef}
                    className="absolute inset-0"
                    style={{
                      zIndex: 2,
                      cursor: pendingField ? 'crosshair' : 'default',
                    }}
                    onClick={pendingField ? handlePdfClick : undefined}
                  >
                    {textFields.map((field, index) => (
                      <Draggable
                        key={index}
                        position={{ x: field.x, y: field.y }}
                        onStop={(e, data) => handleDragStop(index, e, data)}
                        bounds="parent"
                        grid={snapToGrid ? [gridSize, gridSize] : undefined}
                      >
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFieldIndex(index);
                          }}
                          className={`absolute cursor-move border-2 transition-all ${
                            field.is_circular || field.field_name.includes('avatar')
                              ? 'rounded-full'
                              : 'rounded'
                          } ${
                            selectedFieldIndex === index
                              ? 'border-[#d3bb73] bg-[#d3bb73]/20 shadow-lg ring-2 ring-[#d3bb73]/50'
                              : 'border-blue-400/70 bg-blue-400/10 hover:border-blue-400 hover:bg-blue-400/20'
                          }`}
                          style={{
                            fontSize:
                              field.type === 'image' ? '12px' : `${field.font_size || 12}px`,
                            color: field.font_color,
                            width:
                              field.type === 'image'
                                ? `${field.width || 100}px`
                                : field.max_width
                                  ? `${field.max_width}px`
                                  : 'auto',
                            height:
                              field.type === 'image'
                                ? `${field.height || 100}px`
                                : `${(field.font_size || 12) * 1.5}px`,
                            backdropFilter: 'blur(2px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <span className="text-xs font-medium opacity-70">{field.label}</span>
                        </div>
                      </Draggable>
                    ))}

                    {/* Podpowiedź w trybie click-to-place */}
                    {pendingField && (
                      <div className="absolute left-1/2 top-4 z-50 -translate-x-1/2 transform animate-pulse rounded-lg bg-green-600 px-4 py-2 text-white shadow-lg">
                        Kliknij na PDF aby umieścić pole
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-24 text-center">
                  <FileText className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
                  <p className="text-[#e5e4e2]/60">Ładowanie PDF...</p>
                  {template.pdf_url && (
                    <p className="mt-2 text-xs text-[#e5e4e2]/40">{template.pdf_url}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Panel edycji wybranego pola */}
          <div className="w-80 overflow-y-auto border-l border-[#d3bb73]/10 bg-[#1c1f33]">
            {selectedField ? (
              <div className="space-y-4 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="font-medium text-[#e5e4e2]">Edycja pola</h4>
                  <button
                    onClick={() => handleDeleteField(selectedFieldIndex!)}
                    className="rounded p-2 text-red-400 transition-colors hover:bg-red-400/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Pole danych</label>
                  <select
                    value={selectedField.field_name}
                    onChange={(e) => {
                      const selected = AVAILABLE_FIELDS.find((f) => f.value === e.target.value);
                      handleUpdateField(selectedFieldIndex!, {
                        field_name: e.target.value,
                        label: selected?.label || e.target.value,
                        type: (selected?.type as 'text' | 'image') || 'text',
                        ...(selected?.type === 'image'
                          ? { width: 100, height: 100 }
                          : { font_size: 12 }),
                      });
                    }}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  >
                    {AVAILABLE_FIELDS.map((field) => (
                      <option key={field.value} value={field.value}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">X</label>
                    <input
                      type="number"
                      value={Math.round(selectedField.x)}
                      onChange={(e) =>
                        handleUpdateField(selectedFieldIndex!, { x: parseInt(e.target.value) || 0 })
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Y</label>
                    <input
                      type="number"
                      value={Math.round(selectedField.y)}
                      onChange={(e) =>
                        handleUpdateField(selectedFieldIndex!, { y: parseInt(e.target.value) || 0 })
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    />
                  </div>
                </div>

                {selectedField.type === 'image' ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-2 block text-sm text-[#e5e4e2]/60">Szerokość</label>
                        <input
                          type="number"
                          value={selectedField.width || 100}
                          onChange={(e) =>
                            handleUpdateField(selectedFieldIndex!, {
                              width: parseInt(e.target.value) || 100,
                            })
                          }
                          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wysokość</label>
                        <input
                          type="number"
                          value={selectedField.height || 100}
                          onChange={(e) =>
                            handleUpdateField(selectedFieldIndex!, {
                              height: parseInt(e.target.value) || 100,
                            })
                          }
                          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedField.is_circular || false}
                          onChange={(e) =>
                            handleUpdateField(selectedFieldIndex!, {
                              is_circular: e.target.checked,
                            })
                          }
                          className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
                        />
                        <span className="text-sm text-[#e5e4e2]">Okrągły kształt (avatar)</span>
                      </label>
                      <p className="ml-6 mt-1 text-xs text-[#e5e4e2]/40">
                        Zaznacz dla avatarów pracowników
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                        Rozmiar czcionki
                      </label>
                      <input
                        type="number"
                        value={selectedField.font_size || 12}
                        onChange={(e) =>
                          handleUpdateField(selectedFieldIndex!, {
                            font_size: parseInt(e.target.value) || 12,
                          })
                        }
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kolor czcionki</label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={selectedField.font_color || '#000000'}
                          onChange={(e) =>
                            handleUpdateField(selectedFieldIndex!, { font_color: e.target.value })
                          }
                          className="h-10 w-16 rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-1"
                        />
                        <input
                          type="text"
                          value={selectedField.font_color || '#000000'}
                          onChange={(e) =>
                            handleUpdateField(selectedFieldIndex!, { font_color: e.target.value })
                          }
                          className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wyrównanie</label>
                      <select
                        value={selectedField.align || 'left'}
                        onChange={(e) =>
                          handleUpdateField(selectedFieldIndex!, { align: e.target.value as any })
                        }
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      >
                        <option value="left">Lewo</option>
                        <option value="center">Środek</option>
                        <option value="right">Prawo</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                        Max. szerokość (opcjonalne)
                      </label>
                      <input
                        type="number"
                        value={selectedField.max_width || ''}
                        onChange={(e) =>
                          handleUpdateField(selectedFieldIndex!, {
                            max_width: parseInt(e.target.value) || undefined,
                          })
                        }
                        placeholder="Auto"
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </div>
                  </>
                )}

                <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                  <p className="text-xs text-blue-400">
                    Przeciągnij pole na PDF lub edytuj wartości X/Y ręcznie
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center">
                <Type className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/20" />
                <p className="mb-2 text-sm text-[#e5e4e2]/60">Wybierz pole z PDF</p>
                <p className="text-xs text-[#e5e4e2]/40">
                  lub kliknij "Dodaj pole" aby utworzyć nowe
                </p>
              </div>
            )}

            {/* Lista wszystkich pól */}
            <div className="border-t border-[#d3bb73]/10 p-4">
              <h5 className="mb-3 text-sm font-medium text-[#e5e4e2]">
                Wszystkie pola ({textFields.length})
              </h5>
              <div className="space-y-2">
                {textFields.map((field, index) => (
                  <button
                    key={index}
                    onClick={() => setSelectedFieldIndex(index)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      selectedFieldIndex === index
                        ? 'border border-[#d3bb73]/30 bg-[#d3bb73]/20 text-[#d3bb73]'
                        : 'border border-[#d3bb73]/10 bg-[#0a0d1a] text-[#e5e4e2]/80 hover:border-[#d3bb73]/20'
                    }`}
                  >
                    <div className="font-medium">{field.label}</div>
                    <div className="text-xs opacity-60">
                      X: {Math.round(field.x)}, Y: {Math.round(field.y)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-[#d3bb73]/10 p-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-[#e5e4e2]/10 px-6 py-2 text-[#e5e4e2] hover:bg-[#e5e4e2]/20"
          >
            Anuluj
          </button>
          <button
            onClick={handleSaveAll}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {loading ? 'Zapisywanie...' : 'Zapisz konfigurację'}
          </button>
        </div>
      </div>
    </div>
  );
}
