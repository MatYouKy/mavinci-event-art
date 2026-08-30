'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, CreditCard as Edit, Trash2, Save, X, FileText, Building2, DollarSign, CheckCircle, Upload, Image as ImageIcon, Settings, Move, Type, ChevronDown, ChevronRight, Tag, Table2, Package, Layers3, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import dynamic from 'next/dynamic';
import Draggable from 'react-draggable';
import PricingTableConfigEditor from './PricingTableConfigEditor';
import { optimizeOfferImage } from '@/lib/optimizeOfferImage';

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
  hero_image_path?: string | null;
  hero_image_alt?: string | null;
  design_config?: CategoryDesignConfig | null;
}

interface CategoryDesignConfig {
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  surface_color: string;
  hero_opacity: number;
  hero_gradient_enabled: boolean;
  hero_gradient_end: number;
  hero_height: number;
  logo_scale: number;
  assumptions_layout: 'cards' | 'simple';
  visual_image_height: number;
  pricing_style: 'card' | 'minimal';
  info_page_enabled: boolean;
  info_page_title: string;
  order_process_text: string;
  technical_requirements_text: string;
  reservation_terms_text: string;
}

const DEFAULT_CATEGORY_DESIGN: CategoryDesignConfig = {
  primary_color: '#5b001f',
  secondary_color: '#1c1f33',
  accent_color: '#d3bb73',
  surface_color: '#faf7f2',
  hero_opacity: 0.58,
  hero_gradient_enabled: true,
  hero_gradient_end: 0.45,
  hero_height: 395,
  logo_scale: 1,
  assumptions_layout: 'cards',
  visual_image_height: 285,
  pricing_style: 'card',
  info_page_enabled: true,
  info_page_title: 'INFORMACJE I WARUNKI',
  order_process_text: 'Akceptacja zakresu i wyceny\nPotwierdzenie terminu i podpisanie umowy\nUstalenia techniczne z obiektem\nRealizacja wydarzenia',
  technical_requirements_text: 'Dostęp do sali przed wydarzeniem w czasie uzgodnionym z realizatorem\nStabilne zasilanie 230 V oraz miejsce dla stanowiska technicznego\nDostęp do internetu przewodowego przy realizacjach online\nKontakt do osoby technicznej po stronie obiektu',
  reservation_terms_text: 'Termin rezerwujemy po akceptacji oferty i podpisaniu umowy\nZakres końcowy potwierdzamy po weryfikacji warunków technicznych\nDodatkowe usługi i zmiany wymagają potwierdzenia przed wydarzeniem',
};

interface EventCategoryAssignment {
  id: string;
  name: string;
  default_offer_template_category_id?: string | null;
}

interface OfferPageTemplate {
  id: string;
  type: 'cover' | 'about' | 'product' | 'pricing' | 'final';
  name: string;
  description: string;
  is_default: boolean;
  is_active: boolean;
  pdf_url?: string;
  pdf_width?: number;
  pdf_height?: number;
  text_fields_config?: TextFieldConfig[];
  template_category_id?: string;
  variant_key?: 'default' | 'compact' | 'visual';
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
  line_height?: number;
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
    label: '1. Okładka',
    icon: FileText,
    description: 'Nazwa wydarzenia, termin, klient i zdjęcie przewodnie',
  },
  {
    value: 'about',
    label: '2. Założenia wydarzenia',
    icon: Building2,
    description: 'Najważniejsze liczby, cel spotkania i rekomendowany zakres',
  },
  {
    value: 'product',
    label: '3. Strony produktów i usług',
    icon: Package,
    description: 'Powtarzalna strona z opisem, grafiką i danymi pozycji',
  },
  {
    value: 'pricing',
    label: '4. Wycena',
    icon: DollarSign,
    description: 'Podsumowanie cenowe i warunki',
  },
  {
    value: 'final',
    label: '5. Zakończenie',
    icon: CheckCircle,
    description: 'Zdjęcie, dane sprzedawcy i czytelne wezwanie do kontaktu',
  },
];

const sectionTypes: Record<string, string[]> = {
  cover: ['logo', 'title', 'subtitle', 'client_details', 'offer_details', 'background_image'],
  about: ['company_description', 'achievements', 'certifications', 'team', 'gallery'],
  product: ['product_details', 'product_benefits', 'product_image', 'item_summary'],
  pricing: ['summary_table', 'payment_terms', 'validity', 'notes'],
  final: ['technical_requirements', 'seller_details', 'contact_info', 'legal_terms', 'footer'],
};

export default function OfferPageTemplatesEditor() {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { employee } = useCurrentEmployee();
  const [templates, setTemplates] = useState<OfferPageTemplate[]>([]);
  const [categories, setCategories] = useState<OfferTemplateCategory[]>([]);
  const [eventCategoryAssignments, setEventCategoryAssignments] = useState<EventCategoryAssignment[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalCategoryId, setModalCategoryId] = useState<string | null>(null);
  const [modalType, setModalType] = useState<string>('cover');
  const [editingTemplate, setEditingTemplate] = useState<OfferPageTemplate | null>(null);
  const [uploadingPdf, setUploadingPdf] = useState<string | null>(null);
  const [showTextFieldsEditor, setShowTextFieldsEditor] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<OfferTemplateCategory | null>(null);
  const [showTableConfigEditor, setShowTableConfigEditor] = useState(false);

  useEffect(() => {
    fetchCategories();
    fetchTemplates();
    fetchEventCategoryAssignments();
  }, []);

  const fetchEventCategoryAssignments = async () => {
    const { data } = await supabase
      .from('event_categories')
      .select('id, name, default_offer_template_category_id')
      .eq('is_active', true)
      .order('name');
    setEventCategoryAssignments((data || []) as EventCategoryAssignment[]);
  };

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

  const handleEditTableConfig = (template: OfferPageTemplate) => {
    setEditingTemplate(template);
    setShowTableConfigEditor(true);
  };

  const handleCreateTemplate = (categoryId: string, type: string) => {
    setEditingTemplate(null);
    setModalCategoryId(categoryId);
    setModalType(type);
    setShowModal(true);
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
          <h2 className="text-xl font-light text-[#e5e4e2]">Projekt oferty PDF</h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Jeden spójny proces dla każdej kategorii wydarzenia
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
              const defaultCategoryId =
                categories.find((c) => c.is_default)?.id || categories[0]?.id || '';
              if (defaultCategoryId) {
                handleCreateTemplate(defaultCategoryId, 'cover');
              } else {
                showSnackbar('Najpierw utwórz kategorię', 'error');
              }
            }}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Nowy szablon
          </button>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-[#7f1734]/40 bg-[#7f1734]/10 p-4 md:grid-cols-3">
        <div className="flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#7f1734] text-sm font-semibold text-white">1</div>
          <div><p className="text-sm font-medium text-[#e5e4e2]">Wybierz kategorię</p><p className="mt-1 text-xs text-[#e5e4e2]/55">Np. konferencja, wesele lub nagłośnienie.</p></div>
        </div>
        <div className="flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#7f1734] text-sm font-semibold text-white">2</div>
          <div><p className="text-sm font-medium text-[#e5e4e2]">Użyj projektu Mavinci</p><p className="mt-1 text-xs text-[#e5e4e2]/55">Gotowy układ działa od razu. Własny PDF jest opcjonalnym tłem.</p></div>
        </div>
        <div className="flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#7f1734] text-sm font-semibold text-white">3</div>
          <div><p className="text-sm font-medium text-[#e5e4e2]">Dodaj pola CRM</p><p className="mt-1 text-xs text-[#e5e4e2]/55">Po wgraniu własnego tła rozmieść dane i tabelę wyceny.</p></div>
        </div>
      </div>

      {/* Kategorie w accordion */}
      <div className="space-y-3">
        {categories.map((category) => {
          const isExpanded = expandedCategories.has(category.id);
          const assignedEventCategories = eventCategoryAssignments.filter(
            (eventCategory) => eventCategory.default_offer_template_category_id === category.id,
          );

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
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${category.hero_image_path ? 'bg-green-500/15 text-green-300' : 'bg-amber-500/15 text-amber-300'}`}>
                        {category.hero_image_path ? 'Zdjęcie hero: gotowe' : 'Zdjęcie hero: do uzupełnienia'}
                      </span>
                      <span className="rounded bg-[#7f1734]/15 px-2 py-0.5 text-xs text-[#d77a94]">
                        5 etapów dokumentu
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditCategory(category);
                    }}
                    className="flex items-center gap-2 rounded-lg border border-[#b94b69]/40 bg-[#7f1734]/25 px-3 py-2 text-sm text-[#f0c8d3] transition-colors hover:bg-[#7f1734]/40"
                    title={category.hero_image_path ? 'Zmień zdjęcie hero' : 'Wgraj zdjęcie hero'}
                  >
                    <ImageIcon className="h-4 w-4" />
                    {category.hero_image_path ? 'Zmień hero' : 'Wgraj hero'}
                  </button>
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
                  <div className="grid gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4 md:grid-cols-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[#e5e4e2]/35">1. Przypisanie</p>
                      <p className={`mt-1 text-sm ${assignedEventCategories.length > 0 || category.is_default ? 'text-green-300' : 'text-amber-300'}`}>
                        {assignedEventCategories.length > 0
                          ? assignedEventCategories.map((item) => item.name).join(', ')
                          : category.is_default
                            ? 'Zestaw domyślny'
                            : 'Nieprzypisana do kategorii wydarzenia'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[#e5e4e2]/35">2. Zdjęcie hero</p>
                      <p className={`mt-1 text-sm ${category.hero_image_path ? 'text-green-300' : 'text-amber-300'}`}>
                        {category.hero_image_path ? 'Gotowe' : 'Brak zdjęcia dla okładki'}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleEditCategory(category)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[#7f1734]/30 px-2.5 py-1.5 text-xs text-[#f0c8d3] hover:bg-[#7f1734]/45"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {category.hero_image_path ? 'Zmień zdjęcie' : 'Wgraj zdjęcie'}
                      </button>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[#e5e4e2]/35">3. Strony dokumentu</p>
                      <p className="mt-1 text-sm text-green-300">Gotowy układ Mavinci + opcjonalne tła</p>
                    </div>
                  </div>
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
                              handleCreateTemplate(category.id, type.value);
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
                                      {template.type === 'product' && (
                                        <span className="rounded bg-[#7f1734]/25 px-2 py-0.5 text-xs text-[#d77a94]">
                                          {template.variant_key || 'default'}
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
                                          Własne tło PDF
                                        </span>
                                      ) : (
                                        <span className="flex items-center gap-1 rounded bg-[#7f1734]/20 px-2 py-0.5 text-xs text-[#d77a94]">
                                          <Layers3 className="h-3 w-3" />
                                          Gotowy układ Mavinci
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center justify-end gap-2">
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
                                        className="flex items-center gap-1.5 rounded-lg border border-blue-400/20 px-2.5 py-1.5 text-xs text-blue-300 transition-colors hover:bg-blue-400/10"
                                        title="Opcjonalnie wgraj własne tło PDF"
                                      >
                                        <Upload className="h-4 w-4" />
                                        {uploadingPdf === template.id ? 'Wgrywanie…' : template.pdf_url ? 'Zmień tło' : 'Własne tło'}
                                      </div>
                                    </label>
                                    {template.pdf_url && (
                                      <button
                                        onClick={() => handleEditTextFields(template)}
                                        className="flex items-center gap-1.5 rounded-lg border border-green-400/20 px-2.5 py-1.5 text-xs text-green-300 transition-colors hover:bg-green-400/10"
                                        title="Konfiguruj pola"
                                      >
                                        <Type className="h-4 w-4" />
                                        Rozmieść dane
                                      </button>
                                    )}
                                    {template.pdf_url && (
                                      <button
                                        onClick={() => handleDeletePdf(template)}
                                        className="flex items-center gap-1.5 rounded-lg border border-red-400/20 px-2.5 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-400/10"
                                        title="Usuń własne tło i wróć do gotowego układu Mavinci"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                        Wróć do Mavinci
                                      </button>
                                    )}
                                    {template.type === 'pricing' && (
                                      <button
                                        onClick={() => handleEditTableConfig(template)}
                                        className="flex items-center gap-1.5 rounded-lg border border-cyan-400/20 px-2.5 py-1.5 text-xs text-cyan-300 transition-colors hover:bg-cyan-400/10"
                                        title="Konfiguruj tabelę wyceny"
                                      >
                                        <Table2 className="h-4 w-4" />
                                        Tabela wyceny
                                      </button>
                                    )}
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
                            Używany jest gotowy układ Mavinci. Dodaj wpis tylko wtedy, gdy chcesz go zastąpić własnym tłem PDF.
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


      {/* Modal tworzenia szablonu */}
      {showModal && modalCategoryId && (
        <CreateTemplateModal
          type={modalType as any}
          categoryId={modalCategoryId}
          employee={employee}
          onClose={() => {
            setShowModal(false);
            setModalCategoryId(null);
          }}
          onSuccess={() => {
            setShowModal(false);
            setModalCategoryId(null);
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

      {/* Edytor tabeli wyceny */}
      {showTableConfigEditor && editingTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
            <div className="flex flex-shrink-0 items-center justify-between border-b border-[#d3bb73]/10 p-4">
              <div>
                <h3 className="text-xl font-light text-[#e5e4e2]">
                  Konfiguracja tabeli wyceny: {editingTemplate.name}
                </h3>
                <p className="mt-1 text-sm text-[#e5e4e2]/60">
                  Ustaw wygląd tabeli generowanej w PDF oferty
                </p>
              </div>
              <button
                onClick={() => {
                  setShowTableConfigEditor(false);
                  setEditingTemplate(null);
                }}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              <PricingTableConfigEditor
                templateId={editingTemplate.id}
                initialConfig={(editingTemplate as any).table_config || {}}
                embedded
                onSave={() => {
                  setShowTableConfigEditor(false);
                  setEditingTemplate(null);
                  fetchTemplates();
                }}
              />
            </div>
          </div>
        </div>
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
  type: 'cover' | 'about' | 'product' | 'pricing' | 'final';
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
    variant_key: 'default',
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

          {type === 'product' && (
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wariant karty produktu</label>
              <select
                value={formData.variant_key}
                onChange={(e) => setFormData({ ...formData, variant_key: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              >
                <option value="default">Domyślny</option>
                <option value="compact">Kompaktowy - do 3 produktów na stronie</option>
                <option value="visual">Duża grafika</option>
              </select>
              <p className="mt-1 text-xs text-[#e5e4e2]/40">
                Produkty kompaktowe są automatycznie grupowane po maksymalnie trzy na stronie.
              </p>
            </div>
          )}

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
  { value: 'organization_name', label: 'Organizacja: nazwa / alias', type: 'text' },
  { value: 'organization_legal_name', label: 'Organizacja: pełna nazwa prawna', type: 'text' },
  { value: 'contact_person_name', label: 'Osoba kontaktowa: imię i nazwisko', type: 'text' },
  { value: 'contact_person_email', label: 'Osoba kontaktowa: e-mail', type: 'email' },
  { value: 'contact_person_phone', label: 'Osoba kontaktowa: telefon', type: 'phone' },
  { value: 'client_address', label: 'Adres klienta', type: 'text' },
  { value: 'client_nip', label: 'NIP klienta', type: 'text' },
  { value: 'client_city', label: 'Miasto klienta', type: 'text' },
  { value: 'client_postal_code', label: 'Kod pocztowy klienta', type: 'text' },
  { value: 'client_street', label: 'Ulica klienta', type: 'text' },
  { value: 'offer_number', label: 'Numer oferty', type: 'text' },
  { value: 'offer_name', label: 'Nazwa oferty', type: 'text' },
  { value: 'offer_date', label: 'Data oferty', type: 'text' },
  { value: 'event_name', label: 'Nazwa eventu', type: 'text' },
  { value: 'event_category_name', label: 'Kategoria wydarzenia', type: 'text' },
  { value: 'event_date', label: 'Data eventu', type: 'text' },
  { value: 'event_location', label: 'Lokalizacja eventu', type: 'text' },
  { value: 'event_assumptions', label: 'Założenia wydarzenia', type: 'text' },
  { value: 'event_goal', label: 'Cel wydarzenia', type: 'text' },
  { value: 'category_hero_image', label: 'Kategoria: zdjęcie hero', type: 'image' },
  { value: 'company_logo', label: 'Firma: logo z my_companies', type: 'image' },
  { value: 'product_name', label: 'Produkt: nazwa', type: 'text' },
  { value: 'product_short_description', label: 'Produkt: krótki opis', type: 'text' },
  { value: 'product_description', label: 'Produkt: opis do oferty', type: 'text' },
  { value: 'product_benefits', label: 'Produkt: lista korzyści', type: 'text' },
  { value: 'product_image', label: 'Produkt: grafika', type: 'image' },
  { value: 'product_quantity', label: 'Pozycja: ilość', type: 'text' },
  { value: 'product_unit', label: 'Pozycja: jednostka', type: 'text' },
  { value: 'product_unit_price', label: 'Pozycja: cena jednostkowa', type: 'text' },
  { value: 'product_total', label: 'Pozycja: wartość', type: 'text' },
  { value: 'product_1_name', label: 'Kompaktowy 1: nazwa', type: 'text' },
  { value: 'product_1_short_description', label: 'Kompaktowy 1: lead', type: 'text' },
  { value: 'product_1_description', label: 'Kompaktowy 1: opis', type: 'text' },
  { value: 'product_1_image', label: 'Kompaktowy 1: zdjęcie', type: 'image' },
  { value: 'product_2_name', label: 'Kompaktowy 2: nazwa', type: 'text' },
  { value: 'product_2_short_description', label: 'Kompaktowy 2: lead', type: 'text' },
  { value: 'product_2_description', label: 'Kompaktowy 2: opis', type: 'text' },
  { value: 'product_2_image', label: 'Kompaktowy 2: zdjęcie', type: 'image' },
  { value: 'product_3_name', label: 'Kompaktowy 3: nazwa', type: 'text' },
  { value: 'product_3_short_description', label: 'Kompaktowy 3: lead', type: 'text' },
  { value: 'product_3_description', label: 'Kompaktowy 3: opis', type: 'text' },
  { value: 'product_3_image', label: 'Kompaktowy 3: zdjęcie', type: 'image' },
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
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [heroPreviewUrl, setHeroPreviewUrl] = useState('');
  const [heroDragActive, setHeroDragActive] = useState(false);
  const heroDragDepth = useRef(0);
  const [removeHero, setRemoveHero] = useState(false);
  const [brandLogoPreviewUrl, setBrandLogoPreviewUrl] = useState('');
  const [brandHeadingPreviewUrl, setBrandHeadingPreviewUrl] = useState('');
  const [formData, setFormData] = useState({
    name: category?.name || '',
    description: category?.description || '',
    color: category?.color || '#d3bb73',
    is_default: category?.is_default || false,
    hero_image_alt: category?.hero_image_alt || '',
    design_config: {
      ...DEFAULT_CATEGORY_DESIGN,
      ...(category?.design_config || {}),
    },
  });

  const updateDesign = <K extends keyof CategoryDesignConfig>(key: K, value: CategoryDesignConfig[K]) => {
    setFormData((current) => ({
      ...current,
      design_config: { ...current.design_config, [key]: value },
    }));
  };

  useEffect(() => {
    let active = true;
    const loadBrandLogo = async () => {
      const { data: company } = await supabase
        .from('my_companies')
        .select('id, logo_url')
        .eq('is_active', true)
        .eq('is_default', true)
        .limit(1)
        .maybeSingle();
      if (!company) return;
      const [{ data: logos }, { data: headingFont }] = await Promise.all([
        supabase
          .from('company_brandbook_logos')
          .select('url, is_default, order_index')
          .eq('company_id', company.id)
          .order('is_default', { ascending: false })
          .order('order_index'),
        supabase
          .from('company_brandbook_fonts')
          .select('file_url, storage_path')
          .eq('company_id', company.id)
          .eq('role', 'heading')
          .order('order_index')
          .limit(1)
          .maybeSingle(),
      ]);
      const logoPath = logos?.find((logo: any) => logo.is_default)?.url || logos?.[0]?.url || company.logo_url;
      if (!logoPath || !active) return;
      const publicUrl = logoPath.startsWith('http')
        ? logoPath
        : supabase.storage.from('company-logos').getPublicUrl(logoPath).data.publicUrl;
      if (active) setBrandLogoPreviewUrl(publicUrl);
      if (active && headingFont) {
        setBrandHeadingPreviewUrl(
          headingFont.file_url
            || (headingFont.storage_path
              ? supabase.storage.from('company-logos').getPublicUrl(headingFont.storage_path).data.publicUrl
              : ''),
        );
      }
    };
    loadBrandLogo();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!category?.hero_image_path) return;
    supabase.storage
      .from('offer-template-pages')
      .createSignedUrl(category.hero_image_path, 3600)
      .then(({ data }) => {
        if (active) setHeroPreviewUrl(data?.signedUrl || '');
      });
    return () => { active = false; };
  }, [category?.hero_image_path]);

  useEffect(() => {
    if (!heroFile) return;
    const objectUrl = URL.createObjectURL(heroFile);
    setHeroPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [heroFile]);

  const selectHeroFile = (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showSnackbar('Wybierz zdjęcie JPG, PNG lub WEBP', 'error');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      showSnackbar('Zdjęcie może mieć maksymalnie 12 MB', 'error');
      return;
    }
    setHeroFile(file);
    setRemoveHero(false);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      showSnackbar('Podaj nazwę kategorii', 'error');
      return;
    }

    try {
      setLoading(true);

      let categoryId = category?.id || '';
      if (category) {
        // Update existing category
        const { error } = await supabase
          .from('offer_template_categories')
          .update({
            name: formData.name,
            description: formData.description,
            color: formData.color,
            is_default: formData.is_default,
            hero_image_alt: formData.hero_image_alt || null,
            design_config: formData.design_config,
          })
          .eq('id', category.id);

        if (error) throw error;
        showSnackbar('Kategoria zaktualizowana', 'success');
      } else {
        // Create new category
        const { data, error } = await supabase
          .from('offer_template_categories')
          .insert({
            name: formData.name,
            description: formData.description,
            color: formData.color,
            is_default: formData.is_default,
            hero_image_alt: formData.hero_image_alt || null,
            design_config: formData.design_config,
          })
          .select('id')
          .single();

        if (error) throw error;
        categoryId = data.id;
        showSnackbar('Kategoria utworzona', 'success');
      }

      if (heroFile && categoryId) {
        const optimizedHeroFile = await optimizeOfferImage(heroFile, {
          maxWidth: 1800,
          maxHeight: 1800,
          quality: 0.82,
        });
        const extension = optimizedHeroFile.type === 'image/png' ? 'png' : 'jpg';
        const heroPath = `category-heroes/${categoryId}/hero-${Date.now()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from('offer-template-pages')
          .upload(heroPath, optimizedHeroFile, { contentType: optimizedHeroFile.type, upsert: true });
        if (uploadError) throw uploadError;

        const { error: heroUpdateError } = await supabase
          .from('offer_template_categories')
          .update({ hero_image_path: heroPath, hero_image_alt: formData.hero_image_alt || null })
          .eq('id', categoryId);
        if (heroUpdateError) throw heroUpdateError;
      } else if (removeHero && categoryId) {
        const { error: heroUpdateError } = await supabase
          .from('offer_template_categories')
          .update({ hero_image_path: null, hero_image_alt: null })
          .eq('id', categoryId);
        if (heroUpdateError) throw heroUpdateError;
      }

      onSuccess();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd zapisu kategorii', 'error');
    } finally {
      setLoading(false);
    }
  };

  const heroPreviewHeightPercent = (Math.min(470, Math.max(320, formData.design_config.hero_height)) / 841.89) * 100;
  const heroPreviewTopPercent = ((841.89 - 210 - Math.min(470, Math.max(320, formData.design_config.hero_height))) / 841.89) * 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">
            {category ? 'Edytuj kategorię' : 'Nowa kategoria'}
          </h3>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-6">
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
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Zdjęcie hero kategorii</label>
            <label
              className={`relative flex min-h-[180px] cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-all duration-150 ${
                heroDragActive
                  ? 'scale-[1.01] border-[#d3bb73] bg-[#d3bb73]/15 shadow-[0_0_0_4px_rgba(211,187,115,0.12)]'
                  : 'border-[#d3bb73]/30 bg-[#0a0d1a] hover:border-[#d3bb73]/60'
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                heroDragDepth.current += 1;
                setHeroDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                setHeroDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                heroDragDepth.current = Math.max(0, heroDragDepth.current - 1);
                if (heroDragDepth.current === 0) setHeroDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                heroDragDepth.current = 0;
                setHeroDragActive(false);
                selectHeroFile(event.dataTransfer.files?.[0]);
              }}
            >
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => selectHeroFile(event.target.files?.[0])} />
              {heroPreviewUrl && !removeHero ? (
                <img src={heroPreviewUrl} alt="Podgląd hero kategorii" className="h-[220px] w-full object-cover" />
              ) : (
                <div className="px-6 py-10 text-center">
                  <ImageIcon className="mx-auto h-10 w-10 text-[#d3bb73]/50" />
                  <p className="mt-3 text-sm text-[#e5e4e2]/70">Upuść zdjęcie lub kliknij, aby wybrać</p>
                  <p className="mt-1 text-xs text-[#e5e4e2]/35">JPG, PNG lub WEBP, maks. 12 MB</p>
                </div>
              )}
              {heroDragActive && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0a0d1a]/85 backdrop-blur-[2px]">
                  <div className="text-center">
                    <Upload className="mx-auto h-11 w-11 animate-bounce text-[#d3bb73]" />
                    <p className="mt-3 text-base font-medium text-[#f3e7bd]">Upuść zdjęcie tutaj</p>
                    <p className="mt-1 text-xs text-[#e5e4e2]/60">Pole jest gotowe do wgrania pliku</p>
                  </div>
                </div>
              )}
            </label>
            {(heroPreviewUrl || category?.hero_image_path) && !removeHero && (
              <button type="button" onClick={() => { setHeroFile(null); setHeroPreviewUrl(''); setRemoveHero(true); }} className="mt-2 text-xs text-red-300 hover:text-red-200">Usuń zdjęcie hero</button>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis zdjęcia hero</label>
            <input
              type="text"
              value={formData.hero_image_alt}
              onChange={(e) => setFormData({ ...formData, hero_image_alt: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Np. eleganckie przyjęcie weselne w sali balowej"
            />
          </div>

          <div className="rounded-xl border border-[#d3bb73]/15 bg-[#0a0d1a] p-5">
            {brandHeadingPreviewUrl && <style>{`@font-face{font-family:'CategoryOfferHeading';src:url('${brandHeadingPreviewUrl}') format('truetype');font-weight:400;font-style:normal;font-display:swap;}`}</style>}
            <div className="mb-4">
              <h4 className="text-base font-medium text-[#e5e4e2]">Kreator wyglądu kategorii</h4>
              <p className="mt-1 text-xs text-[#e5e4e2]/45">Te ustawienia sterują okładką, założeniami, dużą kartą produktu i wyceną.</p>
            </div>

            <div
              className="relative mx-auto mb-5 aspect-[1/1.414] w-full max-w-[430px] overflow-hidden rounded-lg border border-white/10 shadow-2xl"
              style={{ backgroundColor: formData.design_config.primary_color }}
            >
              {heroPreviewUrl && !removeHero && (
                <div className="absolute inset-x-0 bg-cover bg-center" style={{ backgroundImage: `url(${heroPreviewUrl})`, top: `${heroPreviewTopPercent}%`, height: `${heroPreviewHeightPercent}%` }} />
              )}
              <div
                className="absolute inset-x-0"
                style={formData.design_config.hero_gradient_enabled
                  ? {
                      background: `linear-gradient(to right, ${formData.design_config.primary_color} 0%, ${formData.design_config.primary_color}${Math.round((1 - formData.design_config.hero_gradient_end) * 255).toString(16).padStart(2, '0')} 100%)`,
                      top: `${heroPreviewTopPercent}%`,
                      height: `${heroPreviewHeightPercent}%`,
                    }
                  : { backgroundColor: formData.design_config.primary_color, opacity: formData.design_config.hero_opacity, top: `${heroPreviewTopPercent}%`, height: `${heroPreviewHeightPercent}%` }}
              />
              {brandLogoPreviewUrl ? (
                <img
                  src={brandLogoPreviewUrl}
                  alt="Logo z my_companies"
                  className="absolute left-[7%] top-[5%] h-[15%] w-[24%] object-contain object-left-top"
                  style={{ transform: `scale(${formData.design_config.logo_scale})`, transformOrigin: 'left top' }}
                />
              ) : (
                <span className="absolute left-[7%] top-[7%] text-sm font-semibold tracking-[0.3em] text-white">MAVINCI</span>
              )}
              <div className="absolute left-[7%] top-[28%] text-[9px] uppercase tracking-[0.12em]" style={{ color: formData.design_config.accent_color }}>Oferta obsługi technicznej</div>
              <div className="absolute left-[7%] top-[34%] max-w-[78%] text-2xl font-light leading-tight text-white" style={{ fontFamily: brandHeadingPreviewUrl ? "'CategoryOfferHeading', sans-serif" : undefined }}>NAZWA<br />WYDARZENIA</div>
              <div className="absolute left-[7%] top-[47%] h-px w-[82%]" style={{ backgroundColor: formData.design_config.accent_color }} />
              <div className="absolute left-[7%] top-[51%] text-[8px] uppercase" style={{ color: formData.design_config.accent_color }}>Termin i miejsce</div>
              <div className="absolute left-[7%] top-[55%] text-xs text-white">24.10.2026 · 10:00–18:00</div>
              <div className="absolute left-[7%] top-[59%] text-[10px] text-white">Lokalizacja z CRM</div>
              <div className="absolute bottom-[6%] left-[7%] text-[8px] text-white/70">OFERTA PRZYGOTOWANA NA PODSTAWIE ZAPYTANIA</div>
              <div className="absolute bottom-[6%] right-[7%] text-[8px]" style={{ color: formData.design_config.accent_color }}>01</div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {([
                ['primary_color', 'Kolor główny'],
                ['secondary_color', 'Kolor dodatkowy'],
                ['accent_color', 'Kolor akcentu'],
                ['surface_color', 'Tło jasnych stron'],
              ] as Array<[keyof CategoryDesignConfig, string]>).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 text-sm text-[#e5e4e2]/70">
                  {label}
                  <div className="flex items-center gap-2">
                    <input type="color" value={String(formData.design_config[key])} onChange={(event) => updateDesign(key, event.target.value as never)} className="h-9 w-12 rounded border-0 bg-transparent" />
                    <span className="w-20 text-xs text-[#e5e4e2]/45">{String(formData.design_config[key])}</span>
                  </div>
                </label>
              ))}

              <label className="text-sm text-[#e5e4e2]/70">
                Przyciemnienie zdjęcia: {Math.round(formData.design_config.hero_opacity * 100)}%
                <input type="range" min="0.2" max="0.85" step="0.05" value={formData.design_config.hero_opacity} onChange={(event) => updateDesign('hero_opacity', Number(event.target.value))} className="mt-2 w-full accent-[#b94b69]" />
              </label>
              <div className="space-y-2 text-sm text-[#e5e4e2]/70">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={formData.design_config.hero_gradient_enabled} onChange={(event) => updateDesign('hero_gradient_enabled', event.target.checked)} className="h-4 w-4 accent-[#b94b69]" />
                  Gradient widoczności zdjęcia
                </label>
                <div className={formData.design_config.hero_gradient_enabled ? '' : 'opacity-40'}>
                  Widoczność po prawej: {Math.round(formData.design_config.hero_gradient_end * 100)}%
                  <input type="range" min="0.2" max="0.8" step="0.05" disabled={!formData.design_config.hero_gradient_enabled} value={formData.design_config.hero_gradient_end} onChange={(event) => updateDesign('hero_gradient_end', Number(event.target.value))} className="mt-2 w-full accent-[#b94b69]" />
                </div>
              </div>
              <label className="text-sm text-[#e5e4e2]/70">
                Wielkość logo: {Math.round(formData.design_config.logo_scale * 100)}%
                <input type="range" min="0.7" max="1.5" step="0.05" value={formData.design_config.logo_scale} onChange={(event) => updateDesign('logo_scale', Number(event.target.value))} className="mt-2 w-full accent-[#b94b69]" />
              </label>
              <label className="text-sm text-[#e5e4e2]/70">
                Wysokość hero: {formData.design_config.hero_height} pt
                <input type="range" min="320" max="470" step="5" value={formData.design_config.hero_height} onChange={(event) => updateDesign('hero_height', Number(event.target.value))} className="mt-2 w-full accent-[#b94b69]" />
              </label>
              <label className="text-sm text-[#e5e4e2]/70">
                Wysokość dużego zdjęcia produktu: {formData.design_config.visual_image_height} pt
                <input type="range" min="220" max="330" step="5" value={formData.design_config.visual_image_height} onChange={(event) => updateDesign('visual_image_height', Number(event.target.value))} className="mt-2 w-full accent-[#b94b69]" />
              </label>
              <label className="text-sm text-[#e5e4e2]/70">
                Strona założeń
                <select value={formData.design_config.assumptions_layout} onChange={(event) => updateDesign('assumptions_layout', event.target.value as CategoryDesignConfig['assumptions_layout'])} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2]">
                  <option value="cards">Karty jak w projekcie</option>
                  <option value="simple">Prosty układ tekstowy</option>
                </select>
              </label>
              <label className="text-sm text-[#e5e4e2]/70">
                Karta podsumowania wyceny
                <select value={formData.design_config.pricing_style} onChange={(event) => updateDesign('pricing_style', event.target.value as CategoryDesignConfig['pricing_style'])} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2]">
                  <option value="card">Duża kolorowa karta</option>
                  <option value="minimal">Minimalna linia podsumowania</option>
                </select>
              </label>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-[#e5e4e2]/45">Podgląd strony założeń</p>
                <div className="aspect-[1/1.414] overflow-hidden rounded-lg p-4 shadow-xl" style={{ backgroundColor: formData.design_config.surface_color }}>
                  <p className="text-lg" style={{ color: formData.design_config.primary_color, fontFamily: brandHeadingPreviewUrl ? "'CategoryOfferHeading', sans-serif" : undefined }}>ZAŁOŻENIA SPOTKANIA</p>
                  <div className="mt-2 h-px" style={{ backgroundColor: formData.design_config.primary_color }} />
                  <div className="mt-5 space-y-2">
                    {[
                      ['180', 'LICZBA GOŚCI', 'Wartość może zostać wpisana i wyeksponowana w znaczniku.'],
                      ['02', 'PRZEBIEG I POTRZEBY KLIENTA', 'Przy pustej wartości znacznik zachowuje numer sekcji.'],
                      ['6 H', 'CZAS REALIZACJI', 'Krótka wartość może zawierać również jednostkę.'],
                    ].map(([number, title, detail]) => (
                      <div key={number} className="flex items-center gap-3 rounded-md bg-white px-3 py-3">
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[9px] text-white"
                          style={{
                            backgroundColor: formData.design_config.primary_color,
                            fontFamily: brandHeadingPreviewUrl ? "'CategoryOfferHeading', sans-serif" : undefined,
                          }}
                        >
                          {number}
                        </span>
                        <span className="min-w-0">
                          <span
                            className="block text-[8px] uppercase"
                            style={{
                              color: formData.design_config.primary_color,
                              fontFamily: brandHeadingPreviewUrl ? "'CategoryOfferHeading', sans-serif" : undefined,
                            }}
                          >
                            {title}
                          </span>
                          <span className="mt-1 block text-[6px] text-black/70">{detail}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-5 text-[8px] uppercase" style={{ color: formData.design_config.primary_color }}>Cel realizacji</p>
                  <div className="mt-2 h-6 rounded bg-black/5" />
                  <div className="mt-4 rounded-md px-3 py-4 text-[8px] text-white" style={{ backgroundColor: formData.design_config.primary_color }}>REKOMENDOWANY ZESTAW</div>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-[#e5e4e2]/45">Podgląd wyceny</p>
                <div className="aspect-[1/1.414] overflow-hidden rounded-lg p-4 shadow-xl" style={{ backgroundColor: formData.design_config.surface_color }}>
                  <p className="text-lg" style={{ color: formData.design_config.primary_color, fontFamily: brandHeadingPreviewUrl ? "'CategoryOfferHeading', sans-serif" : undefined }}>WYCENA</p>
                  <div className="mt-2 h-px" style={{ backgroundColor: formData.design_config.primary_color }} />
                  <div className="mt-5 overflow-hidden rounded-sm bg-white text-[7px]">
                    <div className="grid grid-cols-[1fr_auto] gap-2 px-2 py-2 text-white" style={{ backgroundColor: formData.design_config.primary_color }}><span>NAZWA POZYCJI</span><span>WARTOŚĆ</span></div>
                    <div className="grid grid-cols-[1fr_auto] gap-2 px-2 py-2"><span>Usługa techniczna</span><span>5 000 PLN</span></div>
                    <div className="grid grid-cols-[1fr_auto] gap-2 bg-black/[0.03] px-2 py-2"><span>Streaming</span><span>2 500 PLN</span></div>
                  </div>
                  <div className={`mt-auto translate-y-24 px-3 py-4 ${formData.design_config.pricing_style === 'minimal' ? 'border-t' : 'rounded-md text-white'}`} style={formData.design_config.pricing_style === 'minimal' ? { borderColor: formData.design_config.primary_color, color: formData.design_config.primary_color } : { backgroundColor: formData.design_config.primary_color }}>
                    <p className="text-[7px] uppercase">Łączna wartość oferty</p>
                    <p className="mt-2 text-base">7 500 PLN</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-[#d3bb73]/15 bg-[#121625] p-4">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={formData.design_config.info_page_enabled}
                  onChange={(event) => updateDesign('info_page_enabled', event.target.checked)}
                  className="h-4 w-4 accent-[#b94b69]"
                />
                <span>
                  <span className="block text-sm text-[#e5e4e2]">Dodaj stronę „Informacje i warunki”</span>
                  <span className="mt-0.5 block text-xs text-[#e5e4e2]/40">Strona pojawi się po wycenie, przed kontaktem do sprzedawcy.</span>
                </span>
              </label>

              {formData.design_config.info_page_enabled && (
                <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_250px]">
                  <div className="space-y-4">
                    <label className="block text-sm text-[#e5e4e2]/70">
                      Tytuł strony
                      <input
                        type="text"
                        value={formData.design_config.info_page_title}
                        onChange={(event) => updateDesign('info_page_title', event.target.value)}
                        className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </label>
                    {([
                      ['order_process_text', 'Jak wygląda zamówienie', 'Każdy krok wpisz w nowym wierszu.'],
                      ['technical_requirements_text', 'Warunki techniczne', 'Każdy warunek wpisz w nowym wierszu.'],
                      ['reservation_terms_text', 'Rezerwacja i zmiany', 'Każdą zasadę wpisz w nowym wierszu.'],
                    ] as Array<[keyof CategoryDesignConfig, string, string]>).map(([key, label, hint]) => (
                      <label key={key} className="block text-sm text-[#e5e4e2]/70">
                        {label}
                        <textarea
                          rows={4}
                          value={String(formData.design_config[key])}
                          onChange={(event) => updateDesign(key, event.target.value as never)}
                          className="mt-2 w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        />
                        <span className="mt-1 block text-xs text-[#e5e4e2]/35">{hint}</span>
                      </label>
                    ))}
                  </div>

                  <div>
                    <p className="mb-2 text-xs uppercase tracking-wide text-[#e5e4e2]/45">Podgląd strony</p>
                    <div className="aspect-[1/1.414] overflow-hidden rounded-lg p-4 shadow-xl" style={{ backgroundColor: formData.design_config.surface_color }}>
                      <p className="text-base leading-tight" style={{ color: formData.design_config.primary_color, fontFamily: brandHeadingPreviewUrl ? "'CategoryOfferHeading', sans-serif" : undefined }}>{formData.design_config.info_page_title || 'INFORMACJE I WARUNKI'}</p>
                      <div className="mt-2 h-px" style={{ backgroundColor: formData.design_config.primary_color }} />
                      {[
                        ['01', 'JAK WYGLĄDA ZAMÓWIENIE', formData.design_config.order_process_text],
                        ['02', 'WARUNKI TECHNICZNE', formData.design_config.technical_requirements_text],
                        ['03', 'REZERWACJA I ZMIANY', formData.design_config.reservation_terms_text],
                      ].map(([number, title, content]) => (
                        <div key={number} className="mt-3 rounded-md bg-white p-2.5">
                          <div className="flex gap-2">
                            <span className="text-xs" style={{ color: formData.design_config.accent_color }}>{number}</span>
                            <div className="min-w-0">
                              <p className="text-[7px] font-medium" style={{ color: formData.design_config.primary_color }}>{title}</p>
                              <p className="mt-1 line-clamp-3 whitespace-pre-line text-[6px] leading-relaxed text-black/55">{content}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
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
            className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
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

  const isPricing = template.type === 'pricing';
  const existingTableConfig = (template as any).table_config || {};
  const [tablePosition, setTablePosition] = useState<{ x: number; y: number; width: number; height: number } | null>(
    existingTableConfig._layout_x != null
      ? { x: existingTableConfig._layout_x, y: existingTableConfig._layout_y, width: existingTableConfig._layout_width || 495, height: existingTableConfig._layout_height || 200 }
      : null,
  );
  const [tableSelected, setTableSelected] = useState(false);
  const [showEmbeddedTableConfig, setShowEmbeddedTableConfig] = useState(false);
  const [tableConfig, setTableConfig] = useState<any>(existingTableConfig);

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

  const handleAddTable = () => {
    if (tablePosition) {
      showSnackbar('Tabela już istnieje - przesuń ją na PDF', 'info');
      setTableSelected(true);
      setSelectedFieldIndex(null);
      return;
    }
    setTablePosition({
      x: snapToGridIfEnabled(50),
      y: snapToGridIfEnabled(200),
      width: snapToGridIfEnabled(pdfDimensions.width - 100),
      height: snapToGridIfEnabled(200),
    });
    setTableSelected(true);
    setSelectedFieldIndex(null);
  };

  const handleRemoveTable = () => {
    setTablePosition(null);
    setTableSelected(false);
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

      const updateData: Record<string, any> = { text_fields_config: textFields };

      if (isPricing) {
        const updatedTableConfig = { ...tableConfig };
        if (tablePosition) {
          updatedTableConfig._layout_x = tablePosition.x;
          updatedTableConfig._layout_y = tablePosition.y;
          updatedTableConfig._layout_width = tablePosition.width;
          updatedTableConfig._layout_height = tablePosition.height;
          updatedTableConfig.start_y = tablePosition.y;
          updatedTableConfig.margin_left = tablePosition.x;
          updatedTableConfig.margin_right = pdfDimensions.width - tablePosition.x - tablePosition.width;
        } else {
          delete updatedTableConfig._layout_x;
          delete updatedTableConfig._layout_y;
          delete updatedTableConfig._layout_width;
          delete updatedTableConfig._layout_height;
        }
        updateData.table_config = updatedTableConfig;
      }

      const { error } = await supabase
        .from('offer_page_templates')
        .update(updateData)
        .eq('id', template.id);

      if (error) throw error;

      showSnackbar('Konfiguracja zapisana', 'success');
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
            {isPricing && (
              <button
                onClick={handleAddTable}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                  tablePosition
                    ? 'bg-cyan-600/20 text-cyan-400 ring-1 ring-cyan-400/30 hover:bg-cyan-600/30'
                    : 'bg-cyan-600 text-white hover:bg-cyan-700'
                }`}
              >
                <Table2 className="h-4 w-4" />
                {tablePosition ? 'Tabela dodana' : 'Dodaj tabelę'}
              </button>
            )}
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
                            setTableSelected(false);
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

                    {/* Tabela wyceny - draggable placeholder */}
                    {isPricing && tablePosition && (
                      <Draggable
                        position={{ x: tablePosition.x, y: tablePosition.y }}
                        onStop={(e, data) => {
                          const x = snapToGridIfEnabled(Math.max(0, Math.min(data.x, pdfDimensions.width - tablePosition.width)));
                          const y = snapToGridIfEnabled(Math.max(0, Math.min(data.y, pdfDimensions.height - 50)));
                          setTablePosition((prev) => prev ? { ...prev, x, y } : prev);
                        }}
                        bounds="parent"
                        grid={snapToGrid ? [gridSize, gridSize] : undefined}
                      >
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setTableSelected(true);
                            setSelectedFieldIndex(null);
                          }}
                          className={`absolute cursor-move rounded border-2 border-dashed transition-all ${
                            tableSelected
                              ? 'border-cyan-400 bg-cyan-400/15 shadow-lg ring-2 ring-cyan-400/40'
                              : 'border-cyan-400/60 bg-cyan-400/5 hover:border-cyan-400 hover:bg-cyan-400/10'
                          }`}
                          style={{
                            width: `${tablePosition.width}px`,
                            height: `${tablePosition.height}px`,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                          }}
                        >
                          <Table2 className="h-6 w-6 text-cyan-400/70" />
                          <span className="text-xs font-medium text-cyan-400/80">Tabela wyceny</span>
                          <span className="text-[10px] text-cyan-400/50">
                            {Math.round(tablePosition.width)} x {Math.round(tablePosition.height)}px
                          </span>
                          {/* Resize handle */}
                          <div
                            className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              const startX = e.clientX;
                              const startY = e.clientY;
                              const startW = tablePosition.width;
                              const startH = tablePosition.height;
                              const onMove = (me: MouseEvent) => {
                                const newW = snapToGridIfEnabled(Math.max(200, startW + (me.clientX - startX)));
                                const newH = snapToGridIfEnabled(Math.max(80, startH + (me.clientY - startY)));
                                setTablePosition((prev) => prev ? { ...prev, width: newW, height: newH } : prev);
                              };
                              const onUp = () => {
                                window.removeEventListener('mousemove', onMove);
                                window.removeEventListener('mouseup', onUp);
                              };
                              window.addEventListener('mousemove', onMove);
                              window.addEventListener('mouseup', onUp);
                            }}
                          >
                            <svg className="h-4 w-4 text-cyan-400/60" viewBox="0 0 16 16">
                              <path d="M14 14L14 8M14 14L8 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </div>
                        </div>
                      </Draggable>
                    )}

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
            {tableSelected && tablePosition ? (
              <div className="space-y-4 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="font-medium text-cyan-400">Tabela wyceny</h4>
                  <button
                    onClick={handleRemoveTable}
                    className="rounded p-2 text-red-400 transition-colors hover:bg-red-400/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">X</label>
                    <input
                      type="number"
                      value={Math.round(tablePosition.x)}
                      onChange={(e) => setTablePosition((prev) => prev ? { ...prev, x: parseInt(e.target.value) } : prev)}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Y</label>
                    <input
                      type="number"
                      value={Math.round(tablePosition.y)}
                      onChange={(e) => setTablePosition((prev) => prev ? { ...prev, y: parseInt(e.target.value) } : prev)}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Szerokość</label>
                    <input
                      type="number"
                      value={Math.round(tablePosition.width)}
                      onChange={(e) => setTablePosition((prev) => prev ? { ...prev, width: Math.max(200, parseInt(e.target.value) || 200) } : prev)}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wysokość</label>
                    <input
                      type="number"
                      value={Math.round(tablePosition.height)}
                      onChange={(e) => setTablePosition((prev) => prev ? { ...prev, height: Math.max(80, parseInt(e.target.value) || 80) } : prev)}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3">
                  <p className="text-xs text-cyan-400">
                    Przeciągnij tabelę na PDF lub edytuj wartości ręcznie. Użyj uchwytu w rogu do zmiany rozmiaru.
                  </p>
                </div>

                <button
                  onClick={() => setShowEmbeddedTableConfig(!showEmbeddedTableConfig)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-4 py-2.5 text-sm text-cyan-400 transition-colors hover:bg-cyan-400/20"
                >
                  <Settings className="h-4 w-4" />
                  {showEmbeddedTableConfig ? 'Ukryj konfigurację tabeli' : 'Konfiguruj wygląd tabeli'}
                </button>

                {showEmbeddedTableConfig && (
                  <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-3">
                    <PricingTableConfigEditor
                      templateId={template.id}
                      initialConfig={tableConfig}
                      embedded
                      onSave={() => {
                        showSnackbar('Konfiguracja tabeli zapisana', 'success');
                      }}
                    />
                  </div>
                )}
              </div>
            ) : selectedField ? (
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
                        handleUpdateField(selectedFieldIndex!, { x: parseInt(e.target.value) })
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
                        handleUpdateField(selectedFieldIndex!, { y: parseInt(e.target.value) })
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

                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                        Interlinia (opcjonalne)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        value={selectedField.line_height || ''}
                        onChange={(e) =>
                          handleUpdateField(selectedFieldIndex!, {
                            line_height: parseFloat(e.target.value) || undefined,
                          })
                        }
                        placeholder="Automatyczna"
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
                  lub kliknij &ldquo;Dodaj pole&rdquo; aby utworzyć nowe
                </p>
              </div>
            )}

            {/* Lista wszystkich pól */}
            <div className="border-t border-[#d3bb73]/10 p-4">
              <h5 className="mb-3 text-sm font-medium text-[#e5e4e2]">
                Wszystkie pola ({textFields.length + (isPricing && tablePosition ? 1 : 0)})
              </h5>
              <div className="space-y-2">
                {isPricing && tablePosition && (
                  <button
                    onClick={() => {
                      setTableSelected(true);
                      setSelectedFieldIndex(null);
                    }}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      tableSelected
                        ? 'border border-cyan-400/30 bg-cyan-400/20 text-cyan-400'
                        : 'border border-cyan-400/20 bg-[#0a0d1a] text-cyan-400/70 hover:border-cyan-400/30'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <Table2 className="h-3.5 w-3.5" />
                      Tabela wyceny
                    </div>
                    <div className="text-xs opacity-60">
                      X: {Math.round(tablePosition.x)}, Y: {Math.round(tablePosition.y)}, {Math.round(tablePosition.width)}x{Math.round(tablePosition.height)}
                    </div>
                  </button>
                )}
                {textFields.map((field, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      setSelectedFieldIndex(index);
                      setTableSelected(false);
                    }}
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
