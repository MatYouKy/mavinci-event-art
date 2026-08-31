'use client';
import '@/styles/contractA4.css';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import {
  Save,
  ArrowLeft,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Type,
  Columns,
  Eye,
  Printer,
  Download,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import Image from 'next/image';
import {
  renderContractDocument,
  createDefaultContractClauseTypography,
  resolveContractClauseTypography,
  type ContractClauseTypography,
  type ContractClauseTypographyRole,
  type ContractClauseTextStyle,
} from '@/lib/CRM/contracts/contractPagination';
import { normalizeContractParagraphPlaceholders } from '@/lib/CRM/contracts/contractParagraphs';
import {
  CONTRACT_CLAUSE_SLOTS,
  decorateContractClauseSlots,
} from '@/lib/CRM/contracts/contractClauseSlots';
import { createContractDraftPdf } from '../../printDraft';
import { getContractDocumentCss } from '@/components/crm/events/calculations/helpers/getContractCssForPrint';

const DEFAULT_LOGO = '/erulers_logo_vect.png';

const SYSTEM_FONTS = [
  { label: 'Arial', family: 'Arial, sans-serif' },
  { label: 'Helvetica', family: "'Helvetica Neue', Helvetica, sans-serif" },
  { label: 'Times New Roman', family: "'Times New Roman', Times, serif" },
  { label: 'Georgia', family: 'Georgia, serif' },
  { label: 'Verdana', family: 'Verdana, sans-serif' },
  { label: 'Tahoma', family: 'Tahoma, sans-serif' },
  { label: 'Trebuchet MS', family: "'Trebuchet MS', sans-serif" },
  { label: 'Courier New', family: "'Courier New', monospace" },
  { label: 'Palatino', family: "Palatino, 'Palatino Linotype', serif" },
  { label: 'Garamond', family: 'Garamond, serif' },
  { label: 'Systemowy', family: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif' },
];

const CLAUSE_TYPOGRAPHY_ROLES: Array<{
  key: ContractClauseTypographyRole;
  label: string;
}> = [
  { key: 'paragraphHeading', label: 'Numer paragrafu (§)' },
  { key: 'title', label: 'Tytuł klauzuli' },
  { key: 'body', label: 'Treść klauzuli' },
  { key: 'list', label: 'Lista / punkt' },
  { key: 'subpoint', label: 'Podpunkt' },
];

const PLACEHOLDER_CONTEXT_GROUPS = [
  {
    label: 'Dokument',
    items: [{ key: '§n', label: 'Automatyczny numer paragrafu' }],
  },
  {
    label: 'Oferta',
    items: [
      { key: '{{offer_number}}', label: 'Numer oferty' },
      { key: '{{offer_scope}}', label: 'Zakres oferty' },
      { key: '{{offer_valid_until}}', label: 'Oferta ważna do' },
      { key: '{{offer_items}}', label: 'Pozycje z oferty' },
      { key: '{{OFFER_ITEMS_TABLE}}', label: 'Tabela pozycji' },
    ],
  },
  {
    label: 'Kontakt',
    items: [
      { key: '{{contact_first_name}}', label: 'Imię' },
      { key: '{{contact_last_name}}', label: 'Nazwisko' },
      { key: '{{contact_full_name}}', label: 'Imię i nazwisko' },
      { key: '{{contact_email}}', label: 'E-mail' },
      { key: '{{contact_phone}}', label: 'Telefon' },
      { key: '{{contact_pesel}}', label: 'PESEL' },
      { key: '{{contact_address}}', label: 'Adres' },
      { key: '{{contact_city}}', label: 'Miasto' },
      { key: '{{contact_postal_code}}', label: 'Kod pocztowy' },
    ],
  },
  {
    label: 'Firma',
    items: [
      { key: '{{organization_name}}', label: 'Nazwa firmy' },
      { key: '{{organization_nip}}', label: 'NIP' },
      { key: '{{organization_legal_form}}', label: 'Forma prawna' },
      { key: '{{organization_krs}}', label: 'KRS' },
      { key: '{{organization_regon}}', label: 'REGON' },
      { key: '{{organization_full_address}}', label: 'Pełny adres' },
      { key: '{{primary_contact_full_name}}', label: 'Osoba kontaktowa' },
      { key: '{{legal_representative_full_name}}', label: 'Reprezentant prawny' },
      { key: '{{decision_makers_list}}', label: 'Osoby decyzyjne' },
      { key: '{{client_contract_party_block}}', label: 'Pełne dane strony klienta' },
    ],
  },
  {
    label: 'Wydarzenie',
    items: [
      { key: '{{event_name}}', label: 'Nazwa wydarzenia' },
      { key: '{{event_date}}', label: 'Data i czas rozpoczęcia' },
      { key: '{{event_end_date}}', label: 'Data i czas zakończenia' },
      { key: '{{event_date_only}}', label: 'Data rozpoczęcia' },
      { key: '{{event_end_date_only}}', label: 'Data zakończenia' },
      { key: '{{event_time_start}}', label: 'Godzina rozpoczęcia' },
      { key: '{{event_time_end}}', label: 'Godzina zakończenia' },
    ],
  },
  {
    label: 'Lokalizacja',
    items: [
      { key: '{{location_name}}', label: 'Nazwa lokalizacji' },
      { key: '{{location_address}}', label: 'Adres' },
      { key: '{{location_city}}', label: 'Miasto' },
      { key: '{{location_postal_code}}', label: 'Kod pocztowy' },
      { key: '{{location_full}}', label: 'Pełny adres' },
    ],
  },
  {
    label: 'Finanse i umowa',
    items: [
      { key: '{{budget}}', label: 'Kwota umowy (alias)' },
      { key: '{{budget_words}}', label: 'Kwota umowy słownie' },
      { key: '{{budget_netto}}', label: 'Kwota umowy netto po rabacie' },
      { key: '{{budget_netto_words}}', label: 'Kwota netto słownie' },
      { key: '{{budget_brutto}}', label: 'Kwota umowy brutto po rabacie' },
      { key: '{{budget_brutto_words}}', label: 'Kwota brutto słownie' },
      { key: '{{budget_before_discount_netto}}', label: 'Wartość netto przed rabatem' },
      { key: '{{discount_amount}}', label: 'Rabat kwotowy netto' },
      { key: '{{discount_percent}}', label: 'Rabat procentowy' },
      { key: '{{deposit_amount}}', label: 'Zadatek' },
      { key: '{{deposit_words}}', label: 'Zadatek słownie' },
      { key: '{{contract_number}}', label: 'Numer umowy' },
      { key: '{{contract_date}}', label: 'Data umowy' },
    ],
  },
  {
    label: 'Wykonawca',
    items: [
      { key: '{{executor_name}}', label: 'Nazwa firmy' },
      { key: '{{executor_address}}', label: 'Adres' },
      { key: '{{executor_postal_code}}', label: 'Kod pocztowy' },
      { key: '{{executor_city}}', label: 'Miasto' },
      { key: '{{executor_nip}}', label: 'NIP' },
      { key: '{{executor_regon}}', label: 'REGON' },
      { key: '{{executor_krs}}', label: 'KRS' },
      { key: '{{executor_phone}}', label: 'Telefon' },
      { key: '{{executor_email}}', label: 'E-mail' },
      { key: '{{executor_website}}', label: 'Strona WWW' },
      { key: '{{executor_bank_account}}', label: 'Rachunek bankowy' },
      { key: '{{executor_bank_name}}', label: 'Nazwa banku' },
      { key: '{{executor_representative_name}}', label: 'Reprezentant wykonawcy' },
      { key: '{{executor_representative_title}}', label: 'Stanowisko reprezentanta' },
      { key: '{{executor_contract_party_block}}', label: 'Pełne dane wykonawcy' },
    ],
  },
  { label: 'Sekcje klauzul', items: CONTRACT_CLAUSE_SLOTS, clauseSlots: true },
] as const;

export default function EditTemplateWYSIWYGPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const templateId = params.id as string;
  const contractId = searchParams.get('contractId');
  const eventId = searchParams.get('eventId');
  const isContractInstance = Boolean(contractId && eventId);
  const editorRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftAction, setDraftAction] = useState<'preview' | 'print' | 'download' | null>(null);
  const [template, setTemplate] = useState<any>(null);
  const [contentHtml, setContentHtml] = useState('');
  const [logoScale, setLogoScale] = useState(80);
  const [logoPositionX, setLogoPositionX] = useState(50);
  const [logoPositionY, setLogoPositionY] = useState(0);
  const [lineHeight, setLineHeight] = useState(1.6);
  const [selectedLogo, setSelectedLogo] = useState('/erulers_logo_vect.png');
  const [selectedFooter, setSelectedFooter] = useState<'default' | 'minimal' | 'none'>('default');
  const [selectedFooterTemplateId, setSelectedFooterTemplateId] = useState<string | null>(null);
  const [footerTemplates, setFooterTemplates] = useState<any[]>([]);
  const [brandLogos, setBrandLogos] = useState<
    Array<{ url: string; label: string; companyName: string }>
  >([]);
  const [brandFonts, setBrandFonts] = useState<
    Array<{ id: string; label: string; family: string; weight: string; file_url?: string | null }>
  >([]);
  const [showFooterEditor, setShowFooterEditor] = useState(false);
  const [showClauseTypographyEditor, setShowClauseTypographyEditor] = useState(false);
  const [footerLogoScale, setFooterLogoScale] = useState(80);
  const [footerContent, setFooterContent] = useState({
    companyName: 'EVENT RULERS',
    tagline: 'Więcej niż Wodzireje!',
    website: 'www.eventrulers.pl',
    email: 'biuro@eventrulers.pl',
    phone: '698-212-279',
    logoUrl: '/erulers_logo_vect.png',
  });
  const [history, setHistory] = useState<string[][]>([['']]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedFont, setSelectedFont] = useState<string>('Georgia, serif');
  const [clauseTypography, setClauseTypography] = useState<ContractClauseTypography>(() =>
    createDefaultContractClauseTypography('Georgia, serif', 1.6),
  );
  const [showPlaceholders, setShowPlaceholders] = useState(false);
  const [placeholderCategory, setPlaceholderCategory] = useState<string>('offer');
  const [pages, setPages] = useState<string[]>(['']);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState('');
  const updateTimeoutRef = useRef<number | null>(null);
  const contextRangeRef = useRef<Range | null>(null);
  const formatRangeRef = useRef<Range | null>(null);
  const [placeholderContextMenu, setPlaceholderContextMenu] = useState<{
    x: number;
    y: number;
    pageIndex: number;
    openLeft: boolean;
  } | null>(null);

  const paginationSettings = () => ({
    logoScale,
    logoPositionX,
    logoPositionY,
    lineHeight,
    selectedFont,
    selectedLogo,
    selectedFooter,
    footerContent,
    footerLogoScale,
    clauseTypography,
  });

  useEffect(() => {
    fetchTemplate();
    fetchFooterTemplates();
    fetchBrandLogos();
    fetchBrandFonts();
  }, [templateId]);

  useEffect(() => {
    if (editorRef.current && contentHtml && !editorRef.current.innerHTML) {
      editorRef.current.innerHTML = contentHtml;
      editorRef.current.setAttribute('dir', 'ltr');
      editorRef.current.style.direction = 'ltr';
      editorRef.current.style.unicodeBidi = 'embed';
      editorRef.current.style.lineHeight = String(lineHeight);
    }
  }, [contentHtml]);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.style.lineHeight = String(lineHeight);
    }
  }, [lineHeight]);

  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current !== null) {
        window.clearTimeout(updateTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!placeholderContextMenu) return;
    const close = () => setPlaceholderContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [placeholderContextMenu]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

      if (ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (ctrlKey && e.key === 'b') {
        e.preventDefault();
        execCommand('bold');
      } else if (ctrlKey && e.key === 'i') {
        e.preventDefault();
        execCommand('italic');
      } else if (ctrlKey && e.key === 'u') {
        e.preventDefault();
        execCommand('underline');
      } else if (ctrlKey && e.shiftKey && e.key === 'X') {
        e.preventDefault();
        execCommand('strikeThrough');
      } else if (ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);

  const fetchTemplate = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('contract_templates')
        .select('*')
        .eq('id', templateId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        let instanceContract: any = null;
        if (isContractInstance) {
          const { data: contractData, error: contractError } = await supabase
            .from('contracts')
            .select('id, title, content, status, locked_at')
            .eq('id', contractId)
            .eq('event_id', eventId)
            .maybeSingle();

          if (contractError) throw contractError;
          if (!contractData) throw new Error('Nie znaleziono umowy przypisanej do wydarzenia');
          if (contractData.locked_at) {
            throw new Error('Podpisana umowa jest zablokowana i nie może być edytowana');
          }
          instanceContract = contractData;
        }

        setTemplate(
          instanceContract
            ? { ...data, name: instanceContract.title || `Umowa wydarzenia ${eventId}` }
            : data,
        );

        let initialHtml = data.content_html || '';
        let settings = data.page_settings || {};

        if (instanceContract?.content) {
          try {
            const parsedContent = JSON.parse(instanceContract.content);
            initialHtml =
              parsedContent.flowContent ||
              (Array.isArray(parsedContent.pages) ? parsedContent.pages.join('') : '') ||
              instanceContract.content;
            settings = { ...settings, ...(parsedContent.settings || {}) };
          } catch {
            initialHtml = instanceContract.content;
          }
        }

        if (!initialHtml && data.content) {
          initialHtml = data.content
            .split('\n')
            .map((line: string) => `<pre>${line || '\n'}</pre>`)
            .join('');
        }

        initialHtml = normalizeContractParagraphPlaceholders(
          isContractInstance ? initialHtml : decorateContractClauseSlots(initialHtml),
        );
        setContentHtml(initialHtml);

        setSelectedLogo(settings.selectedLogo || DEFAULT_LOGO);
        const templateFont = settings.selectedFont || 'Georgia, serif';
        const templateLineHeight = settings.lineHeight || 1.6;
        setClauseTypography(
          resolveContractClauseTypography({
            selectedFont: templateFont,
            lineHeight: templateLineHeight,
            clauseTypography: settings.clauseTypography,
          }),
        );

        if (Object.keys(settings).length > 0) {
          if (settings.logoScale) setLogoScale(settings.logoScale);
          if (settings.logoPositionX !== undefined) setLogoPositionX(settings.logoPositionX);
          if (settings.logoPositionY !== undefined) setLogoPositionY(settings.logoPositionY);
          if (settings.lineHeight) setLineHeight(settings.lineHeight);
          if (settings.selectedFont) setSelectedFont(settings.selectedFont);

          if (settings.selectedFooter) setSelectedFooter(settings.selectedFooter);
          if (settings.selectedFooterTemplateId)
            setSelectedFooterTemplateId(settings.selectedFooterTemplateId);
          if (settings.footerContent) setFooterContent(settings.footerContent);
          if (settings.footerLogoScale) setFooterLogoScale(settings.footerLogoScale);
          if (isContractInstance || settings.flowContent || (settings.pages && Array.isArray(settings.pages))) {
            const source = normalizeContractParagraphPlaceholders(
              isContractInstance
                ? initialHtml
                : decorateContractClauseSlots(settings.flowContent || settings.pages.join('')),
            );
            const initialDocument = await renderContractDocument(source, {
              ...settings,
              selectedFooter: settings.selectedFooter || 'default',
            }, { resolveParagraphNumbers: false });
            setPages(initialDocument.pages);
            setHistory([initialDocument.pages]);
            setHistoryIndex(0);
          } else if (initialHtml) {
            setPages([initialHtml]);
            setHistory([[initialHtml]]);
            setHistoryIndex(0);
          }
        } else if (initialHtml) {
          setPages([initialHtml]);
          setHistory([[initialHtml]]);
          setHistoryIndex(0);
        }
      }
    } catch (err: any) {
      console.error('Error:', err);
      showSnackbar(err.message || 'Błąd ładowania szablonu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTemplateName = async () => {
    if (isContractInstance) return;
    if (!tempName.trim()) {
      showSnackbar('Nazwa szablonu nie może być pusta', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('contract_templates')
        .update({ name: tempName.trim(), updated_at: new Date().toISOString() })
        .eq('id', templateId);

      if (error) throw error;

      setTemplate({ ...template, name: tempName.trim() });
      setEditingName(false);
      showSnackbar('Nazwa szablonu została zmieniona', 'success');
    } catch (err: any) {
      console.error('Error:', err);
      showSnackbar(err.message || 'Błąd zapisu nazwy', 'error');
    }
  };

  const handleSave = async () => {
    if (!template?.name.trim()) {
      showSnackbar('Nazwa szablonu jest wymagana', 'error');
      return;
    }

    const flowContent = normalizeContractParagraphPlaceholders(pages.join(''));
    const renderedDocument = await renderContractDocument(
      flowContent,
      paginationSettings(),
      { resolveParagraphNumbers: false },
    );
    const paginatedPages = renderedDocument.pages;
    const allContent = paginatedPages.join('');
    const plainText = allContent.replace(/<[^>]*>/g, '').trim();

    if (!allContent || plainText === '') {
      showSnackbar('Treść szablonu nie może być pusta', 'error');
      return;
    }

    try {
      setSaving(true);
      setPages(paginatedPages);

      if (isContractInstance && contractId && eventId) {
        const { error } = await supabase
          .from('contracts')
          .update({
            content: JSON.stringify({
              flowContent,
              pages: paginatedPages,
              settings: {
                ...paginationSettings(),
                selectedFooterTemplateId,
                paginationMode: 'automatic',
                marginTop: 50,
                marginBottom: 50,
                marginLeft: 50,
                marginRight: 50,
                pageSize: 'A4',
              },
              meta: {
                individuallyEdited: true,
                editSource: 'wysiwyg',
                editedAt: new Date().toISOString(),
              },
            }),
            modified_after_generation: true,
          })
          .eq('id', contractId)
          .eq('event_id', eventId);

        if (error) throw error;
        showSnackbar('Indywidualna treść umowy została zapisana', 'success');
        router.push(`/crm/events/${eventId}?tab=contract`);
        return;
      }

      const updateData = {
        content: plainText || 'Szablon umowy',
        content_html: allContent,
        page_settings: {
          logoScale,
          logoPositionX,
          logoPositionY,
          lineHeight,
          selectedFont,
          selectedLogo,
          selectedFooter,
          selectedFooterTemplateId,
          footerContent,
          footerLogoScale,
          clauseTypography,
          flowContent,
          pages: paginatedPages,
          paginationMode: 'automatic',
          marginTop: 50,
          marginBottom: 50,
          marginLeft: 50,
          marginRight: 50,
          pageSize: 'A4',
        },
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('contract_templates')
        .update(updateData)
        .eq('id', templateId);

      if (error) throw error;

      showSnackbar('Szablon zapisany pomyślnie', 'success');
      await fetchTemplate();
    } catch (err: any) {
      console.error('Error saving template:', err);
      showSnackbar(err.message || 'Błąd podczas zapisywania szablonu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const fetchFooterTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('footer_templates')
        .select('*')
        .order('is_default', { ascending: false })
        .order('name');

      if (error) throw error;
      setFooterTemplates(data || []);
    } catch (err: any) {
      console.error('Error fetching footer templates:', err);
    }
  };

  const fetchBrandLogos = async () => {
    try {
      const { data: companies } = await supabase
        .from('my_companies')
        .select('id, name, logo_url')
        .eq('is_active', true)
        .order('is_default', { ascending: false });

      const { data: logos } = await supabase
        .from('company_brandbook_logos')
        .select('url, label, variant, company_id')
        .order('order_index');

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const toPublicUrl = (path: string) => {
        if (path.startsWith('http')) return path;
        return `${supabaseUrl}/storage/v1/object/public/company-logos/${path}`;
      };

      const result: Array<{ url: string; label: string; companyName: string }> = [];

      (companies || []).forEach((company: any) => {
        const companyLogos = (logos || []).filter((l: any) => l.company_id === company.id);

        if (companyLogos.length > 0) {
          companyLogos.forEach((logo: any) => {
            result.push({
              url: toPublicUrl(logo.url),
              label: logo.label || logo.variant || 'Logo',
              companyName: company.name,
            });
          });
        } else if (company.logo_url) {
          result.push({
            url: company.logo_url.startsWith('http')
              ? company.logo_url
              : toPublicUrl(company.logo_url),
            label: 'Logo domyslne',
            companyName: company.name,
          });
        }
      });

      setBrandLogos(result);
    } catch (err: any) {
      console.error('Error fetching brand logos:', err);
    }
  };

  const fetchBrandFonts = async () => {
    try {
      const { data, error } = await supabase
        .from('company_brandbook_fonts')
        .select('id, label, family, weight, file_url')
        .order('order_index');
      if (error) throw error;
      const nextFonts = data || [];
      setBrandFonts(nextFonts);
      await Promise.all(
        nextFonts
          .filter((font: any) => font.file_url)
          .map(async (font: any) => {
            const loadedFont = new FontFace(font.family, `url(${font.file_url})`, {
              weight: font.weight || '400',
            });
            await loadedFont.load();
            document.fonts.add(loadedFont);
          }),
      );
    } catch (error) {
      console.error('Error fetching brand fonts:', error);
    }
  };

  const rememberEditorSelection = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    if (element?.closest('.contract-content')) formatRangeRef.current = range.cloneRange();
  };

  const restoreEditorSelection = () => {
    const range = formatRangeRef.current;
    if (!range) return null;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return range;
  };

  const persistFormattedEditor = () => {
    const range = formatRangeRef.current;
    if (!range) return;
    const node = range.commonAncestorContainer;
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    const editor = element?.closest('.contract-content') as HTMLDivElement | null;
    const pageIndex = pageRefs.current.findIndex((page) => page === editor);
    if (editor && pageIndex >= 0) updatePageContent(pageIndex, editor.innerHTML);
  };

  const handleFooterTemplateSelect = (templateId: string) => {
    const template = footerTemplates.find((t) => t.id === templateId);
    if (template) {
      setSelectedFooterTemplateId(templateId);
      setFooterContent({
        companyName: template.company_name,
        tagline: template.tagline || '',
        website: template.website,
        email: template.email,
        phone: template.phone,
        logoUrl: template.logo_url,
      });
      setFooterLogoScale(template.logo_scale || 80);
    }
  };

  const handleSaveAsNewFooterTemplate = async () => {
    const name = prompt('Podaj nazwę szablonu stopki:');
    if (!name) return;

    try {
      const { error } = await supabase.from('footer_templates').insert({
        name,
        company_name: footerContent.companyName,
        tagline: footerContent.tagline,
        website: footerContent.website,
        email: footerContent.email,
        phone: footerContent.phone,
        logo_url: footerContent.logoUrl,
        logo_scale: footerLogoScale,
        is_default: false,
      });

      if (error) throw error;
      showSnackbar('Szablon stopki zapisany', 'success');
      fetchFooterTemplates();
    } catch (err: any) {
      console.error('Error:', err);
      showSnackbar(err.message || 'Błąd zapisu szablonu', 'error');
    }
  };

  const addToHistory = (newPages: string[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push([...newPages]);
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      const prevPages = history[newIndex];
      setPages([...prevPages]);

      prevPages.forEach((pageContent, index) => {
        if (pageRefs.current[index]) {
          pageRefs.current[index]!.innerHTML = pageContent;
        }
      });
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      const nextPages = history[newIndex];
      setPages([...nextPages]);

      nextPages.forEach((pageContent, index) => {
        if (pageRefs.current[index]) {
          pageRefs.current[index]!.innerHTML = pageContent;
        }
      });
    }
  };

  const toggleStrikethrough = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return;

    // znajdź kontener .contract-content (żeby potem zapisać stronę)
    let containerEl: HTMLElement | null =
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? (range.commonAncestorContainer.parentElement as HTMLElement | null)
        : (range.commonAncestorContainer as HTMLElement | null);

    while (containerEl && !containerEl.classList?.contains('contract-content')) {
      containerEl = containerEl.parentElement;
    }
    if (!containerEl) return;

    const pageIndex = pageRefs.current.findIndex((ref) => ref === containerEl);
    if (pageIndex === -1) return;

    // helper: sprawdź czy zakres jest "w całości" wewnątrz przekreślenia
    const isRangeInsideStrike = (r: Range) => {
      const startEl =
        r.startContainer.nodeType === Node.TEXT_NODE
          ? (r.startContainer.parentElement as HTMLElement | null)
          : (r.startContainer as HTMLElement | null);
      const endEl =
        r.endContainer.nodeType === Node.TEXT_NODE
          ? (r.endContainer.parentElement as HTMLElement | null)
          : (r.endContainer as HTMLElement | null);

      const startStrike = startEl?.closest?.('span[data-strike="1"]');
      const endStrike = endEl?.closest?.('span[data-strike="1"]');

      return !!startStrike && startStrike === endStrike;
    };

    // helper: unwrap span
    const unwrap = (el: HTMLElement) => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    };

    // Jeśli zaznaczenie w jednym strike-span → zdejmij przekreślenie (unwrap)
    if (isRangeInsideStrike(range)) {
      const startEl =
        range.startContainer.nodeType === Node.TEXT_NODE
          ? (range.startContainer.parentElement as HTMLElement)
          : (range.startContainer as HTMLElement);
      const strikeSpan = startEl.closest('span[data-strike="1"]') as HTMLElement | null;
      if (strikeSpan) {
        unwrap(strikeSpan);

        // zapis strony
        setTimeout(() => {
          const newPages = [...pages];
          newPages[pageIndex] = containerEl!.innerHTML;
          setPages(newPages);
          addToHistory(newPages);
        }, 10);
      }
      return;
    }

    // W przeciwnym razie: dodaj przekreślenie jako <span style="text-decoration:line-through">
    const extracted = range.extractContents();

    const span = document.createElement('span');
    span.setAttribute('data-strike', '1'); // łatwe wykrywanie/odwijanie
    span.style.textDecorationLine = 'line-through';
    span.style.textDecorationThickness = '2px';
    span.style.textDecorationSkipInk = 'none';

    span.appendChild(extracted);
    range.insertNode(span);

    // Uporządkuj: usuń zagnieżdżone strike, połącz sąsiednie
    const normalize = () => {
      // usuń zagnieżdżone strike w strike
      span.querySelectorAll('span[data-strike="1"] span[data-strike="1"]').forEach((nested) => {
        unwrap(nested as HTMLElement);
      });

      // scal sąsiednie strike
      const parent = span.parentElement;
      if (!parent) return;

      const prev = span.previousSibling;
      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const prevEl = prev as HTMLElement;
        if (prevEl.matches('span[data-strike="1"]')) {
          // przenieś dzieci
          while (span.firstChild) prevEl.appendChild(span.firstChild);
          span.remove();
          return;
        }
      }
      const next = span.nextSibling;
      if (next && next.nodeType === Node.ELEMENT_NODE) {
        const nextEl = next as HTMLElement;
        if (nextEl.matches('span[data-strike="1"]')) {
          // przenieś dzieci z next do span
          while (nextEl.firstChild) span.appendChild(nextEl.firstChild);
          nextEl.remove();
        }
      }
    };

    normalize();

    // ustaw selekcję na nowym spanie
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    selection.addRange(newRange);

    // zapis strony
    setTimeout(() => {
      const newPages = [...pages];
      newPages[pageIndex] = containerEl!.innerHTML;
      setPages(newPages);
      addToHistory(newPages);
    }, 10);
  };

  const execCommand = (command: string, value?: string) => {
    if (command === 'strikeThrough') {
      toggleStrikethrough();
      return;
    }

    const alignmentByCommand: Record<string, 'left' | 'center' | 'right' | 'justify'> = {
      justifyLeft: 'left',
      justifyCenter: 'center',
      justifyRight: 'right',
      justifyFull: 'justify',
    };
    const requestedAlignment = alignmentByCommand[command];
    if (requestedAlignment) {
      restoreEditorSelection();
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;

      const range = selection.getRangeAt(0);
      const selectionNode = range.commonAncestorContainer;
      const selectionElement =
        selectionNode.nodeType === Node.TEXT_NODE
          ? selectionNode.parentElement
          : (selectionNode as Element);
      const editorElement = selectionElement?.closest('.contract-content') as HTMLDivElement | null;
      if (!editorElement) return;

      const blockSelector =
        'p, pre, li, h1, h2, h3, h4, h5, h6, [data-contract-paragraph="true"], .contract-paragraph-heading, div';
      const closestBlock = selectionElement?.closest(blockSelector) as HTMLElement | null;
      const intersectingBlocks = Array.from(
        editorElement.querySelectorAll<HTMLElement>(blockSelector),
      ).filter((element) => {
        if (element === editorElement) return false;
        try {
          return range.intersectsNode(element);
        } catch {
          return false;
        }
      });
      const blocks = range.collapsed
        ? closestBlock && closestBlock !== editorElement
          ? [closestBlock]
          : []
        : intersectingBlocks;

      if (blocks.length === 0) {
        document.execCommand(command, false, value);
      } else {
        blocks.forEach((block) => {
          block.style.textAlign = requestedAlignment;
        });
      }

      formatRangeRef.current = range.cloneRange();
      const pageIndex = pageRefs.current.findIndex((page) => page === editorElement);
      if (pageIndex >= 0) updatePageContent(pageIndex, editorElement.innerHTML);
      return;
    }

    restoreEditorSelection();
    const selection = window.getSelection();
    if (!selection) return;

    const focusNode = selection.focusNode;
    if (!focusNode) return;

    let editorElement: HTMLElement | null = focusNode as HTMLElement;
    if (focusNode.nodeType === Node.TEXT_NODE) {
      editorElement = focusNode.parentElement;
    }

    while (editorElement && !editorElement.classList?.contains('contract-content')) {
      editorElement = editorElement.parentElement;
    }

    if (!editorElement) return;

    const pageIndex = pageRefs.current.findIndex((ref) => ref === editorElement);
    if (pageIndex === -1) return;

    document.execCommand(command, false, value);

    setTimeout(() => {
      if (editorElement) {
        const newPages = [...pages];
        newPages[pageIndex] = editorElement.innerHTML;
        setPages(newPages);
        addToHistory(newPages);
      }
    }, 10);
  };

  const insertPlaceholder = (placeholder: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;

    let editorElement =
      container.nodeType === 3 ? container.parentElement : (container as HTMLElement);
    while (editorElement && !editorElement.classList.contains('contract-content')) {
      editorElement = editorElement.parentElement;
    }

    if (!editorElement) return;

    const pageIndex = pageRefs.current.findIndex((ref) => ref === editorElement);
    if (pageIndex === -1) return;

    const textNode = document.createTextNode(placeholder);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);

    updatePageContent(pageIndex, editorElement.innerHTML);
  };

  const insertClauseSlot = (placeholder: string, label: string) => {
    if (pages.join('').includes(placeholder)) {
      showSnackbar(`Sekcja „${label}” jest już umieszczona w szablonie`, 'info');
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      showSnackbar('Kliknij w treści umowy w miejscu, w którym ma znaleźć się sekcja', 'info');
      return;
    }

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    let editorElement =
      container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as HTMLElement);

    while (editorElement && !editorElement.classList.contains('contract-content')) {
      editorElement = editorElement.parentElement;
    }
    if (!editorElement) {
      showSnackbar('Najpierw ustaw kursor w treści umowy', 'info');
      return;
    }

    const pageIndex = pageRefs.current.findIndex((ref) => ref === editorElement);
    if (pageIndex === -1) return;

    const slot = document.createElement('div');
    slot.setAttribute('data-contract-clause-slot', placeholder.replace(/[{}]/g, ''));
    slot.setAttribute('data-clause-label', label);
    slot.innerHTML = `<span data-clause-placeholder="true">${placeholder}</span>`;

    range.deleteContents();
    range.insertNode(slot);
    range.setStartAfter(slot);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    updatePageContent(pageIndex, editorElement.innerHTML);
  };

  const openPlaceholderContextMenu = (
    event: React.MouseEvent<HTMLDivElement>,
    pageIndex: number,
  ) => {
    event.preventDefault();

    const documentWithCaret = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
    };
    let range = documentWithCaret.caretRangeFromPoint?.(event.clientX, event.clientY) || null;
    if (!range) {
      const position = documentWithCaret.caretPositionFromPoint?.(event.clientX, event.clientY);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
      }
    }
    if (!range || !event.currentTarget.contains(range.startContainer)) return;

    range.collapse(true);
    contextRangeRef.current = range.cloneRange();
    setPlaceholderContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 230),
      y: Math.min(event.clientY, window.innerHeight - 330),
      pageIndex,
      openLeft: event.clientX > window.innerWidth - 520,
    });
  };

  const insertPlaceholderFromContext = (
    placeholder: string,
    label: string,
    clauseSlot = false,
  ) => {
    const menu = placeholderContextMenu;
    const range = contextRangeRef.current;
    const editor = menu ? pageRefs.current[menu.pageIndex] : null;
    if (!menu || !range || !editor || !editor.contains(range.startContainer)) return;

    if (clauseSlot && pages.join('').includes(placeholder)) {
      showSnackbar(`Sekcja „${label}” jest już umieszczona w szablonie`, 'info');
      setPlaceholderContextMenu(null);
      return;
    }

    range.deleteContents();
    const node = clauseSlot ? document.createElement('div') : document.createTextNode(placeholder);
    if (node instanceof HTMLDivElement) {
      node.setAttribute('data-contract-clause-slot', placeholder.replace(/[{}]/g, ''));
      node.setAttribute('data-clause-label', label);
      node.innerHTML = `<span data-clause-placeholder="true">${placeholder}</span>`;
    }
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    updatePageContent(menu.pageIndex, editor.innerHTML);
    contextRangeRef.current = null;
    setPlaceholderContextMenu(null);
  };

  const insertLogo = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;

    let editorElement =
      container.nodeType === 3 ? container.parentElement : (container as HTMLElement);
    while (editorElement && !editorElement.classList.contains('contract-content')) {
      editorElement = editorElement.parentElement;
    }

    if (!editorElement) return;

    const pageIndex = pageRefs.current.findIndex((ref) => ref === editorElement);
    if (pageIndex === -1) return;

    const img = document.createElement('img');
    img.src = selectedLogo;
    img.style.maxWidth = '300px';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.style.margin = '20px auto';

    range.insertNode(img);
    range.setStartAfter(img);
    range.setEndAfter(img);
    selection.removeAllRanges();
    selection.addRange(range);

    updatePageContent(pageIndex, editorElement.innerHTML);
  };

  const insertParagraphMarker = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;

    let editorElement =
      container.nodeType === 3 ? container.parentElement : (container as HTMLElement);
    while (editorElement && !editorElement.classList.contains('contract-content')) {
      editorElement = editorElement.parentElement;
    }

    if (!editorElement) return;

    const pageIndex = pageRefs.current.findIndex((ref) => ref === editorElement);
    if (pageIndex === -1) return;

    const p = document.createElement('p');
    p.style.fontWeight = 'bold';
    p.style.textAlign = 'center';
    p.style.margin = '1.5em 0';
    p.setAttribute('data-contract-paragraph', 'true');
    p.innerHTML = '§n ';

    range.insertNode(p);
    range.setStart(p.firstChild!, p.innerHTML.length);
    range.setEnd(p.firstChild!, p.innerHTML.length);
    selection.removeAllRanges();
    selection.addRange(range);

    updatePageContent(pageIndex, editorElement.innerHTML);
  };

  const repaginate = async (sourcePages = pages) => {
    const normalizedContent = normalizeContractParagraphPlaceholders(sourcePages.join(''));
    const nextDocument = await renderContractDocument(
      normalizedContent,
      paginationSettings(),
      { resolveParagraphNumbers: false },
    );
    setPages(nextDocument.pages);
    pageRefs.current = [];
  };

  const currentDraftTemplate = () => ({
    ...template,
    name: template?.name || 'Szablon umowy',
    content_html: pages.join(''),
    page_settings: {
      ...(template?.page_settings || {}),
      ...paginationSettings(),
      flowContent: pages.join(''),
      pages,
      paginationMode: 'automatic',
    },
  });

  const handleDraftAction = async (action: 'preview' | 'print' | 'download') => {
    const previewWindow = action !== 'download' ? window.open('', '_blank') : null;
    if (action !== 'download' && !previewWindow) {
      showSnackbar('Zezwól przeglądarce na otwieranie nowych kart.', 'error');
      return;
    }

    try {
      setDraftAction(action);
      const blob = await createContractDraftPdf(currentDraftTemplate());
      const url = URL.createObjectURL(blob);

      if (action === 'download') {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${template?.name || 'szablon-umowy'}-draft.pdf`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        return;
      }

      previewWindow!.location.href = url;
      if (action === 'print') {
        previewWindow!.addEventListener('load', () => previewWindow!.print(), { once: true });
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error: any) {
      previewWindow?.close();
      showSnackbar(error?.message || 'Nie udało się przygotować draftu', 'error');
    } finally {
      setDraftAction(null);
    }
  };

  const updatePageContent = (pageIndex: number, content: string) => {
    const newPages = [...pages];
    newPages[pageIndex] = content;
    setPages(newPages);
  
    if (updateTimeoutRef.current !== null) {
      window.clearTimeout(updateTimeoutRef.current);
    }
  
    updateTimeoutRef.current = window.setTimeout(() => {
      addToHistory(newPages);
      updateTimeoutRef.current = null;
    }, 500);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0b14]">
        <div className="text-[#e5e4e2]">Szablon nie został znaleziony</div>
      </div>
    );
  }

  return (
    <div className="-m-2 min-h-screen bg-[#0a0b14] sm:-m-4 md:-m-6">
      <style dangerouslySetInnerHTML={{ __html: getContractDocumentCss() }} />
      <div className="sticky -top-2 z-40 max-h-[calc(100dvh-73px)] overflow-y-auto overscroll-contain bg-[#1c1f33] shadow-xl sm:-top-4 md:-top-6">
      {/* Header */}
      <div className="border-b border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="mx-auto max-w-[1400px] px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() =>
                  router.push(
                    isContractInstance && eventId
                      ? `/crm/events/${eventId}?tab=contract`
                      : '/crm/contract-templates',
                  )
                }
                className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                {editingName && !isContractInstance ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={tempName}
                      onChange={(e) => setTempName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveTemplateName();
                        if (e.key === 'Escape') {
                          setEditingName(false);
                          setTempName('');
                        }
                      }}
                      className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1 text-lg text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveTemplateName}
                      className="rounded-lg bg-[#d3bb73] px-3 py-1 text-sm text-[#1c1f33] hover:bg-[#d3bb73]/90"
                    >
                      Zapisz
                    </button>
                    <button
                      onClick={() => {
                        setEditingName(false);
                        setTempName('');
                      }}
                      className="rounded-lg border border-[#d3bb73]/20 px-3 py-1 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10"
                    >
                      Anuluj
                    </button>
                  </div>
                ) : (
                  <h1
                    onClick={() => {
                      if (isContractInstance) return;
                      setEditingName(true);
                      setTempName(template.name);
                    }}
                    className={`text-xl font-light text-[#e5e4e2] ${
                      isContractInstance
                        ? ''
                        : 'cursor-pointer hover:text-[#d3bb73]'
                    }`}
                    title={isContractInstance ? undefined : 'Kliknij aby edytować nazwę'}
                  >
                    {template.name}
                  </h1>
                )}
                <p className="text-sm text-[#e5e4e2]/40">
                  {isContractInstance
                    ? 'Indywidualna treść umowy — zmiany nie modyfikują szablonu ani klauzul'
                    : 'Edytor WYSIWYG'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => void handleDraftAction('preview')}
                disabled={draftAction !== null}
                className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-3 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 disabled:opacity-50"
              >
                {draftAction === 'preview' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                Zobacz draft
              </button>
              <button
                onClick={() => void handleDraftAction('print')}
                disabled={draftAction !== null}
                className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-3 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 disabled:opacity-50"
              >
                {draftAction === 'print' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                Drukuj draft
              </button>
              <button
                onClick={() => void handleDraftAction('download')}
                disabled={draftAction !== null}
                className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-3 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 disabled:opacity-50"
              >
                {draftAction === 'download' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Pobierz draft
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Zapisywanie...' : 'Zapisz'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="border-b border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="mx-auto max-w-[1400px] px-6 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => execCommand('bold')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Pogrubienie"
            >
              <Bold className="h-4 w-4 text-[#e5e4e2]" />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => execCommand('italic')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Kursywa"
            >
              <Italic className="h-4 w-4 text-[#e5e4e2]" />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => execCommand('underline')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Podkreślenie"
            >
              <Underline className="h-4 w-4 text-[#e5e4e2]" />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => execCommand('strikeThrough')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Przekreślenie"
            >
              <Strikethrough className="h-4 w-4 text-[#e5e4e2]" />
            </button>

            <div className="mx-2 h-6 w-px bg-[#d3bb73]/30" />

            <button
              onMouseDown={(e) => {
                rememberEditorSelection();
                e.preventDefault();
              }}
              onClick={() => execCommand('justifyLeft')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Do lewej"
            >
              <AlignLeft className="h-4 w-4 text-[#e5e4e2]" />
            </button>
            <button
              onMouseDown={(e) => {
                rememberEditorSelection();
                e.preventDefault();
              }}
              onClick={() => execCommand('justifyCenter')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Wyśrodkuj"
            >
              <AlignCenter className="h-4 w-4 text-[#e5e4e2]" />
            </button>
            <button
              onMouseDown={(e) => {
                rememberEditorSelection();
                e.preventDefault();
              }}
              onClick={() => execCommand('justifyRight')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Do prawej"
            >
              <AlignRight className="h-4 w-4 text-[#e5e4e2]" />
            </button>
            <button
              onMouseDown={(e) => {
                rememberEditorSelection();
                e.preventDefault();
              }}
              onClick={() => execCommand('justifyFull')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Wyjustuj"
            >
              <AlignJustify className="h-4 w-4 text-[#e5e4e2]" />
            </button>

            <div className="mx-2 h-6 w-px bg-[#d3bb73]/30" />

            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => execCommand('insertUnorderedList')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Lista"
            >
              <List className="h-4 w-4 text-[#e5e4e2]" />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => execCommand('insertOrderedList')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Lista numerowana"
            >
              <ListOrdered className="h-4 w-4 text-[#e5e4e2]" />
            </button>

            <div className="mx-2 h-6 w-px bg-[#d3bb73]/30" />

            <select
              onMouseDown={rememberEditorSelection}
              onChange={(e) => {
                const size = e.target.value;
                if (!size || !restoreEditorSelection()) return;
                document.execCommand('fontSize', false, '7');
                const fontElements = document.querySelectorAll<HTMLFontElement>(
                  '.contract-content font[size="7"]',
                );
                for (let i = 0; i < fontElements.length; i++) {
                  fontElements[i].removeAttribute('size');
                  fontElements[i].style.fontSize = `${size}pt`;
                }
                persistFormattedEditor();
                e.target.value = '';
              }}
              className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2]"
            >
              <option value="">Rozmiar</option>
              <option value="6">6pt</option>
              <option value="8">8pt</option>
              <option value="9">9pt</option>
              <option value="10">10pt</option>
              <option value="11">11pt</option>
              <option value="12">12pt</option>
              <option value="14">14pt</option>
              <option value="16">16pt</option>
              <option value="18">18pt</option>
              <option value="20">20pt</option>
              <option value="22">22pt</option>
              <option value="24">24pt</option>
              <option value="28">28pt</option>
              <option value="32">32pt</option>
              <option value="36">36pt</option>
              <option value="40">40pt</option>
              <option value="48">48pt</option>
              <option value="56">56pt</option>
              <option value="64">64pt</option>
              <option value="72">72pt</option>
            </select>

            <div className="ml-2 flex items-center gap-2">
              <span className="text-xs text-[#e5e4e2]/60">Czcionka:</span>
              <select
                onMouseDown={rememberEditorSelection}
                value={selectedFont}
                onChange={(e) => {
                  const family = e.target.value;
                  const range = restoreEditorSelection();
                  if (range && !range.collapsed) {
                    document.execCommand('fontName', false, family);
                    document
                      .querySelectorAll<HTMLFontElement>('.contract-content font[face]')
                      .forEach((fontElement) => {
                        fontElement.style.fontFamily = fontElement.getAttribute('face') || family;
                        fontElement.removeAttribute('face');
                      });
                    persistFormattedEditor();
                  } else {
                    setSelectedFont(family);
                  }
                }}
                className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2]"
              >
                <optgroup label="Fonty systemowe i przeglądarki">
                  {SYSTEM_FONTS.map((font) => (
                    <option key={font.family} value={font.family} style={{ fontFamily: font.family }}>
                      {font.label}
                    </option>
                  ))}
                </optgroup>
                {brandFonts.length > 0 && (
                  <optgroup label="Fonty brandbooka">
                    {brandFonts.map((font) => (
                      <option
                        key={font.id}
                        value={`'${font.family}', sans-serif`}
                        style={{ fontFamily: font.family }}
                      >
                        {font.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <div className="ml-2 flex items-center gap-2">
              <span className="text-xs text-[#e5e4e2]/60">Odstęp linii:</span>
              <input
                type="range"
                min="0.7"
                max="3"
                step="0.05"
                value={lineHeight}
                onChange={(e) => {
                  const newValue = Number(e.target.value);
                  setLineHeight(newValue);
                  if (editorRef.current) {
                    editorRef.current.style.lineHeight = String(newValue);
                  }
                }}
                className="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-[#0f1119] accent-[#d3bb73]"
              />
              <span className="w-8 text-xs text-[#e5e4e2]">{lineHeight.toFixed(1)}</span>
            </div>

            <div className="mx-2 h-6 w-px bg-[#d3bb73]/30" />

            <button
              onClick={insertParagraphMarker}
              className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-sm font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"
              title="Nowy paragraf (§)"
            >
              §n Paragraf automatyczny
            </button>

            <button
              onClick={() => void repaginate()}
              className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-sm font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"
              title="Przelicz podział stron z uwzględnieniem nagłówka i stopki"
            >
              📄 Przelicz strony
            </button>

            <button
              onClick={() => setShowClauseTypographyEditor((value) => !value)}
              className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-sm font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"
              title="Ustaw jednolity wygląd klauzul produktowych"
            >
              Typografia klauzul
            </button>

            <div className="mx-2 h-6 w-px bg-[#d3bb73]/30" />

            <div className="flex items-center gap-2">
              <span className="text-xs text-[#e5e4e2]/60">Logo:</span>
              <select
                value={selectedLogo}
                onChange={(e) => setSelectedLogo(e.target.value)}
                className="max-w-[220px] rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2]"
              >
                {brandLogos.length > 0 ? (
                  brandLogos.map((logo, idx) => (
                    <option key={`brand-${idx}`} value={logo.url}>
                      {logo.companyName} - {logo.label}
                    </option>
                  ))
                ) : (
                  <option value="" disabled>
                    Brak logotypow w brandbooku
                  </option>
                )}
                {selectedLogo && !brandLogos.some((l) => l.url === selectedLogo) && (
                  <option value={selectedLogo}>
                    {selectedLogo.split('/').pop()} (niestandardowe)
                  </option>
                )}
              </select>
            </div>

            <button
              onClick={insertLogo}
              className="rounded bg-[#d3bb73] px-3 py-1.5 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Wstaw Logo
            </button>

            <div className="ml-2 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#e5e4e2]/60">Skala:</span>
                <input
                  type="range"
                  min="20"
                  max="120"
                  value={logoScale}
                  onChange={(e) => setLogoScale(Number(e.target.value))}
                  className="h-1 w-20 cursor-pointer appearance-none rounded-lg bg-[#0f1119] accent-[#d3bb73]"
                />
                <span className="w-8 text-xs text-[#e5e4e2]">{logoScale}%</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-[#e5e4e2]/60">Poz X:</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={logoPositionX}
                  onChange={(e) => setLogoPositionX(Number(e.target.value))}
                  className="h-1 w-20 cursor-pointer appearance-none rounded-lg bg-[#0f1119] accent-[#d3bb73]"
                />
                <span className="w-8 text-xs text-[#e5e4e2]">{logoPositionX}%</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-[#e5e4e2]/60">Poz Y:</span>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={logoPositionY}
                  onChange={(e) => setLogoPositionY(Number(e.target.value))}
                  className="h-1 w-20 cursor-pointer appearance-none rounded-lg bg-[#0f1119] accent-[#d3bb73]"
                />
                <span className="w-8 text-xs text-[#e5e4e2]">{logoPositionY}mm</span>
              </div>
            </div>

            <div className="mx-2 h-6 w-px bg-[#d3bb73]/30" />

            <div className="flex items-center gap-2">
              <span className="text-xs text-[#e5e4e2]/60">Stopka:</span>
              <select
                value={selectedFooter}
                onChange={(e) =>
                  setSelectedFooter(e.target.value as 'default' | 'minimal' | 'none')
                }
                className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2]"
              >
                <option value="default">Pełna (logo + kontakt)</option>
                <option value="minimal">Minimalna (tylko kontakt)</option>
                <option value="none">Brak stopki</option>
              </select>
            </div>

            {selectedFooter !== 'none' && (
              <>
                <div className="mx-2 h-6 w-px bg-[#d3bb73]/30" />

                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#e5e4e2]/60">Szablon stopki:</span>
                  <select
                    value={selectedFooterTemplateId || ''}
                    onChange={(e) => handleFooterTemplateSelect(e.target.value)}
                    className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2]"
                  >
                    <option value="">-- Własna stopka --</option>
                    {footerTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={() => setShowFooterEditor(!showFooterEditor)}
                  className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                >
                  {showFooterEditor ? 'Ukryj edytor' : 'Edytuj stopkę'}
                </button>

                <button
                  onClick={handleSaveAsNewFooterTemplate}
                  className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                  title="Zapisz aktualną stopkę jako nowy szablon"
                >
                  Zapisz jako szablon
                </button>
              </>
            )}

            <div className="mx-2 h-6 w-px bg-[#d3bb73]/30" />

            <button
              onClick={() => setShowPlaceholders(!showPlaceholders)}
              className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-sm font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"
            >
              {showPlaceholders ? '✕ Ukryj' : '+ Zmienne'} (
              {
                {
                  offer: 'Oferta',
                  contact: 'Kontakt',
                  organization: 'Firma',
                  event: 'Wydarzenie',
                  location: 'Lokalizacja',
                  financial: 'Finanse',
                  executor: 'Wykonawca',
                  clauses: 'Klauzule',
                }[placeholderCategory]
              }
              )
            </button>
          </div>
        </div>
      </div>

      {/* Placeholders Panel */}
      {showPlaceholders && (
        <div
          className="border-b border-[#d3bb73]/20 bg-[#16171d] px-4 py-3"
          onMouseDown={(event) => {
            if ((event.target as HTMLElement).closest('button')) event.preventDefault();
          }}
        >
          <div className="mx-auto max-w-[230mm]">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-[#d3bb73]">Zmienne:</span>
              {[
                { key: 'offer', label: 'Oferta' },
                { key: 'contact', label: 'Kontakt' },
                { key: 'organization', label: 'Firma' },
                { key: 'event', label: 'Wydarzenie' },
                { key: 'location', label: 'Lokalizacja' },
                { key: 'financial', label: 'Finanse' },
                { key: 'executor', label: 'Wykonawca' },
                { key: 'clauses', label: 'Klauzule' },
              ].map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => setPlaceholderCategory(cat.key)}
                  className={`rounded px-2 py-1 text-xs ${placeholderCategory === cat.key ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#0f1119] text-[#d3bb73] hover:bg-[#d3bb73]/10'}`}
                >
                  {cat.label}
                </button>
              ))}
              <button
                onClick={() => setShowPlaceholders(false)}
                className="ml-auto text-xs text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                Zamknij
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {placeholderCategory === 'offer' &&
                [
                  { key: '{{offer_number}}', label: 'Numer oferty' },
                  { key: '{{offer_scope}}', label: 'Zakres oferty (lista pozycji)' },
                  { key: '{{offer_valid_until}}', label: 'Oferta wazna do' },
                  { key: '{{offer_items}}', label: 'Pozycje z oferty (HTML)' },
                  { key: '{{OFFER_ITEMS_TABLE}}', label: 'Tabela pozycji (HTML)' },
                ].map((p) => (
                  <button
                    key={p.key}
                    onClick={() => insertPlaceholder(p.key)}
                    className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                    title={p.key}
                  >
                    {p.label}
                  </button>
                ))}
              {placeholderCategory === 'clauses' &&
                CONTRACT_CLAUSE_SLOTS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => insertClauseSlot(p.key, p.label)}
                    className="rounded border border-blue-400/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-500/20"
                    title={`Wstaw miejsce: ${p.label}`}
                  >
                    Wstaw sekcję: {p.label}
                  </button>
                ))}
              {placeholderCategory === 'contact' &&
                [
                  { key: '{{contact_first_name}}', label: 'Imię' },
                  { key: '{{contact_last_name}}', label: 'Nazwisko' },
                  { key: '{{contact_full_name}}', label: 'Imię i nazwisko' },
                  { key: '{{contact_email}}', label: 'Email' },
                  { key: '{{contact_phone}}', label: 'Telefon' },
                  { key: '{{contact_pesel}}', label: 'PESEL' },
                  { key: '{{contact_address}}', label: 'Adres (ulica)' },
                  { key: '{{contact_city}}', label: 'Miasto' },
                  { key: '{{contact_postal_code}}', label: 'Kod pocztowy' },
                ].map((p) => (
                  <button
                    key={p.key}
                    onClick={() => insertPlaceholder(p.key)}
                    className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                    title={p.key}
                  >
                    {p.label}
                  </button>
                ))}
              {placeholderCategory === 'organization' &&
                [
                  { key: '{{organization_name}}', label: 'Nazwa firmy' },
                  { key: '{{organization_nip}}', label: 'NIP' },
                  { key: '{{organization_legal_form}}', label: 'Forma prawna' },
                  { key: '{{organization_krs}}', label: 'KRS (pokazuje tylko jeśli istnieje)' },
                  { key: '{{organization_regon}}', label: 'REGON' },
                  { key: '{{organization_full_address}}', label: 'Pełny adres' },
                  { key: '{{organization_address}}', label: 'Adres (ulica)' },
                  { key: '{{organization_city}}', label: 'Miasto' },
                  { key: '{{organization_postal_code}}', label: 'Kod pocztowy' },
                  { key: '{{organization_country}}', label: 'Kraj' },
                  { key: '{{primary_contact_full_name}}', label: 'Osoba kontaktowa' },
                  { key: '{{primary_contact_position}}', label: 'Stanowisko osoby kont.' },
                  { key: '{{primary_contact_email}}', label: 'Email osoby kont.' },
                  { key: '{{primary_contact_phone}}', label: 'Telefon osoby kont.' },
                  { key: '{{legal_representative_full_name}}', label: 'Reprezentant prawny' },
                  { key: '{{legal_representative_title}}', label: 'Stanowisko reprezentanta' },
                  { key: '{{decision_makers_list}}', label: 'Lista osób decyzyjnych' },
                  { key: '{{client_contract_party_block}}', label: 'Pełne dane strony klienta' },
                ].map((p) => (
                  <button
                    key={p.key}
                    onClick={() => insertPlaceholder(p.key)}
                    className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                    title={p.key}
                  >
                    {p.label}
                  </button>
                ))}
              {placeholderCategory === 'event' &&
                [
                  { key: '{{event_name}}', label: 'Nazwa wydarzenia' },
                  { key: '{{event_date}}', label: 'Data i czas start' },
                  { key: '{{event_end_date}}', label: 'Data i czas koniec' },
                  { key: '{{event_date_only}}', label: 'Data start (DD.MM.RRRR)' },
                  { key: '{{event_end_date_only}}', label: 'Data koniec (DD.MM.RRRR)' },
                  { key: '{{event_time_start}}', label: 'Godzina start (HH:MM)' },
                  { key: '{{event_time_end}}', label: 'Godzina koniec (HH:MM)' },
                ].map((p) => (
                  <button
                    key={p.key}
                    onClick={() => insertPlaceholder(p.key)}
                    className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                    title={p.key}
                  >
                    {p.label}
                  </button>
                ))}
              {placeholderCategory === 'location' &&
                [
                  { key: '{{location_name}}', label: 'Nazwa lokalizacji' },
                  { key: '{{location_address}}', label: 'Adres' },
                  { key: '{{location_city}}', label: 'Miasto' },
                  { key: '{{location_postal_code}}', label: 'Kod pocztowy' },
                  { key: '{{location_full}}', label: 'Pełny adres' },
                ].map((p) => (
                  <button
                    key={p.key}
                    onClick={() => insertPlaceholder(p.key)}
                    className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                    title={p.key}
                  >
                    {p.label}
                  </button>
                ))}
              {placeholderCategory === 'financial' &&
                [
                  { key: '{{budget}}', label: 'Kwota umowy (alias)' },
                  { key: '{{budget_words}}', label: 'Kwota umowy słownie' },
                  { key: '{{budget_netto}}', label: 'Netto po rabacie' },
                  { key: '{{budget_netto_words}}', label: 'Netto słownie' },
                  { key: '{{budget_brutto}}', label: 'Brutto po rabacie' },
                  { key: '{{budget_brutto_words}}', label: 'Brutto słownie' },
                  { key: '{{budget_before_discount_netto}}', label: 'Netto przed rabatem' },
                  { key: '{{discount_amount}}', label: 'Rabat kwotowy netto' },
                  { key: '{{discount_percent}}', label: 'Rabat procentowy' },
                  { key: '{{deposit_amount}}', label: 'Zadatek (liczba)' },
                  { key: '{{deposit_words}}', label: 'Zadatek słownie' },
                  { key: '{{contract_number}}', label: 'Numer umowy' },
                  { key: '{{contract_date}}', label: 'Data umowy' },
                ].map((p) => (
                  <button
                    key={p.key}
                    onClick={() => insertPlaceholder(p.key)}
                    className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                    title={p.key}
                  >
                    {p.label}
                  </button>
                ))}
              {placeholderCategory === 'executor' &&
                [
                  { key: '{{executor_name}}', label: 'Nazwa firmy' },
                  { key: '{{executor_address}}', label: 'Adres' },
                  { key: '{{executor_postal_code}}', label: 'Kod pocztowy' },
                  { key: '{{executor_city}}', label: 'Miasto' },
                  { key: '{{executor_nip}}', label: 'NIP' },
                  { key: '{{executor_regon}}', label: 'REGON' },
                  { key: '{{executor_krs}}', label: 'KRS' },
                  { key: '{{executor_phone}}', label: 'Telefon' },
                  { key: '{{executor_email}}', label: 'Email' },
                  { key: '{{executor_website}}', label: 'Strona WWW' },
                  { key: '{{executor_bank_account}}', label: 'Rachunek bankowy' },
                  { key: '{{executor_bank_name}}', label: 'Nazwa banku' },
                  { key: '{{executor_representative_name}}', label: 'Reprezentant wykonawcy' },
                  { key: '{{executor_representative_title}}', label: 'Stanowisko reprezentanta' },
                  { key: '{{executor_contract_party_block}}', label: 'Pełne dane wykonawcy' },
                ].map((p) => (
                  <button
                    key={p.key}
                    onClick={() => insertPlaceholder(p.key)}
                    className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                    title={p.key}
                  >
                    {p.label}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Footer Editor Panel */}
      {selectedFooter !== 'none' && showFooterEditor && (
        <div className="border-b border-[#d3bb73]/20 bg-[#16171d] px-4 py-3">
          <div className="mx-auto max-w-[230mm]">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-semibold text-[#d3bb73]">
                Edytor stopki
                {selectedFooterTemplateId && (
                  <span className="ml-2 text-[#e5e4e2]/60">
                    ({footerTemplates.find((t) => t.id === selectedFooterTemplateId)?.name})
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowFooterEditor(false)}
                className="text-xs text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                Zamknij
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-[#e5e4e2]/60">Nazwa firmy</label>
                <input
                  type="text"
                  value={footerContent.companyName}
                  onChange={(e) =>
                    setFooterContent({ ...footerContent, companyName: e.target.value })
                  }
                  className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-sm text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[#e5e4e2]/60">Hasło / Tagline</label>
                <input
                  type="text"
                  value={footerContent.tagline}
                  onChange={(e) => setFooterContent({ ...footerContent, tagline: e.target.value })}
                  className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-sm text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[#e5e4e2]/60">Strona www</label>
                <input
                  type="text"
                  value={footerContent.website}
                  onChange={(e) => setFooterContent({ ...footerContent, website: e.target.value })}
                  className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-sm text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[#e5e4e2]/60">Email</label>
                <input
                  type="text"
                  value={footerContent.email}
                  onChange={(e) => setFooterContent({ ...footerContent, email: e.target.value })}
                  className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-sm text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[#e5e4e2]/60">Telefon</label>
                <input
                  type="text"
                  value={footerContent.phone}
                  onChange={(e) => setFooterContent({ ...footerContent, phone: e.target.value })}
                  className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-sm text-[#e5e4e2]"
                />
              </div>
              <div className="md:col-span-2 lg:col-span-3">
                <label className="mb-1 block text-xs text-[#e5e4e2]/60">Logo stopki</label>
                <div className="flex gap-2">
                  <select
                    value={footerContent.logoUrl}
                    onChange={(e) =>
                      setFooterContent({ ...footerContent, logoUrl: e.target.value })
                    }
                    className="flex-1 rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-sm text-[#e5e4e2]"
                  >
                    {brandLogos.length > 0 ? (
                      brandLogos.map((logo, idx) => (
                        <option key={`footer-brand-${idx}`} value={logo.url}>
                          {logo.companyName} - {logo.label}
                        </option>
                      ))
                    ) : (
                      <option value="" disabled>
                        Brak logotypow w brandbooku
                      </option>
                    )}
                    {footerContent.logoUrl &&
                      !brandLogos.some((l) => l.url === footerContent.logoUrl) && (
                        <option value={footerContent.logoUrl}>
                          {footerContent.logoUrl} (niestandardowe)
                        </option>
                      )}
                  </select>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#e5e4e2]/60">Skala:</span>
                    <input
                      type="range"
                      min="20"
                      max="120"
                      value={footerLogoScale}
                      onChange={(e) => setFooterLogoScale(Number(e.target.value))}
                      className="h-1 w-32 cursor-pointer appearance-none rounded-lg bg-[#0f1119] accent-[#d3bb73]"
                    />
                    <span className="w-10 text-xs text-[#e5e4e2]">{footerLogoScale}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showClauseTypographyEditor && (
        <div className="border-b border-[#d3bb73]/20 bg-[#16171d] px-4 py-4">
          <div className="mx-auto max-w-[230mm]">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[#d3bb73]">Typografia klauzul</div>
                <p className="mt-1 text-xs text-[#e5e4e2]/50">
                  Dekoracje zapisane w produkcie są ignorowane. Podgląd i PDF używają wyłącznie tego profilu.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setClauseTypography(
                      createDefaultContractClauseTypography(selectedFont, lineHeight),
                    )
                  }
                  className="rounded border border-[#d3bb73]/20 px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                >
                  Ustaw jak dokument
                </button>
                <button
                  type="button"
                  onClick={() => setShowClauseTypographyEditor(false)}
                  className="rounded px-3 py-1.5 text-xs text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
                >
                  Zamknij
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {CLAUSE_TYPOGRAPHY_ROLES.map(({ key, label }) => {
                const role = clauseTypography[key];
                return (
                  <div
                    key={key}
                    className="grid gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 md:grid-cols-[140px_minmax(150px,1fr)_64px_88px_72px_72px_72px_100px] md:items-center"
                  >
                    <span className="text-xs font-semibold text-[#e5e4e2]">{label}</span>
                    <select
                      value={role.fontFamily}
                      onChange={(event) =>
                        setClauseTypography((current) => ({
                          ...current,
                          [key]: { ...current[key], fontFamily: event.target.value },
                        }))
                      }
                      className="rounded border border-[#d3bb73]/20 bg-[#16171d] px-2 py-1.5 text-xs text-[#e5e4e2]"
                    >
                      {SYSTEM_FONTS.map((font) => (
                        <option key={`${key}-${font.family}`} value={font.family}>{font.label}</option>
                      ))}
                      {brandFonts.map((font) => (
                        <option key={`${key}-${font.id}`} value={font.family}>{font.label || font.family}</option>
                      ))}
                      {![...SYSTEM_FONTS.map((font) => font.family), ...brandFonts.map((font) => font.family)].includes(role.fontFamily) && (
                        <option value={role.fontFamily}>{role.fontFamily}</option>
                      )}
                    </select>
                    <label className="flex items-center gap-1 text-[10px] text-[#e5e4e2]/50">
                      pt
                      <input
                        type="number"
                        min="6"
                        max="72"
                        step="0.5"
                        value={role.fontSizePt}
                        onChange={(event) =>
                          setClauseTypography((current) => ({
                            ...current,
                            [key]: { ...current[key], fontSizePt: Number(event.target.value) },
                          }))
                        }
                        className="w-full rounded border border-[#d3bb73]/20 bg-[#16171d] px-2 py-1.5 text-xs text-[#e5e4e2]"
                      />
                    </label>
                    <select
                      value={role.fontWeight}
                      onChange={(event) =>
                        setClauseTypography((current) => ({
                          ...current,
                          [key]: { ...current[key], fontWeight: Number(event.target.value) },
                        }))
                      }
                      className="rounded border border-[#d3bb73]/20 bg-[#16171d] px-2 py-1.5 text-xs text-[#e5e4e2]"
                    >
                      <option value="300">Lekka</option>
                      <option value="400">Normalna</option>
                      <option value="500">Średnia</option>
                      <option value="600">Półgruba</option>
                      <option value="700">Gruba</option>
                    </select>
                    <label className="flex items-center gap-1 text-[10px] text-[#e5e4e2]/50">
                      inter.
                      <input
                        type="number"
                        min="0.7"
                        max="3"
                        step="0.05"
                        value={role.lineHeight}
                        title="Interlinia"
                        aria-label={`${label}: interlinia`}
                        onChange={(event) =>
                          setClauseTypography((current) => ({
                            ...current,
                            [key]: { ...current[key], lineHeight: Number(event.target.value) },
                          }))
                        }
                        className="min-w-0 w-full rounded border border-[#d3bb73]/20 bg-[#16171d] px-1.5 py-1.5 text-xs text-[#e5e4e2]"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-[10px] text-[#e5e4e2]/50">
                      przed
                      <input
                        type="number"
                        min="0"
                        max="72"
                        step="0.5"
                        value={role.spaceBeforePt}
                        aria-label={`${label}: odstęp przed`}
                        onChange={(event) =>
                          setClauseTypography((current) => ({
                            ...current,
                            [key]: { ...current[key], spaceBeforePt: Number(event.target.value) },
                          }))
                        }
                        className="min-w-0 w-full rounded border border-[#d3bb73]/20 bg-[#16171d] px-1.5 py-1.5 text-xs text-[#e5e4e2]"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-[10px] text-[#e5e4e2]/50">
                      po
                      <input
                        type="number"
                        min="0"
                        max="72"
                        step="0.5"
                        value={role.spaceAfterPt}
                        aria-label={`${label}: odstęp po`}
                        onChange={(event) =>
                          setClauseTypography((current) => ({
                            ...current,
                            [key]: { ...current[key], spaceAfterPt: Number(event.target.value) },
                          }))
                        }
                        className="min-w-0 w-full rounded border border-[#d3bb73]/20 bg-[#16171d] px-1.5 py-1.5 text-xs text-[#e5e4e2]"
                      />
                    </label>
                    <select
                      value={role.textAlign}
                      onChange={(event) =>
                        setClauseTypography((current) => ({
                          ...current,
                          [key]: {
                            ...current[key],
                            textAlign: event.target.value as ContractClauseTextStyle['textAlign'],
                          },
                        }))
                      }
                      className="rounded border border-[#d3bb73]/20 bg-[#16171d] px-2 py-1.5 text-xs text-[#e5e4e2]"
                    >
                      <option value="left">Do lewej</option>
                      <option value="center">Środek</option>
                      <option value="right">Do prawej</option>
                      <option value="justify">Justuj</option>
                    </select>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap gap-5 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 text-xs text-[#e5e4e2]/70">
              <label className="flex items-center gap-2">
                Pogrubienie
                <select
                  value={clauseTypography.emphasisWeight}
                  onChange={(event) =>
                    setClauseTypography((current) => ({ ...current, emphasisWeight: Number(event.target.value) }))
                  }
                  className="rounded border border-[#d3bb73]/20 bg-[#16171d] px-2 py-1 text-[#e5e4e2]"
                >
                  <option value="600">Półgrube</option>
                  <option value="700">Grube</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={clauseTypography.italicEnabled} onChange={(event) => setClauseTypography((current) => ({ ...current, italicEnabled: event.target.checked }))} />
                Stosuj kursywę semantyczną
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={clauseTypography.underlineEnabled} onChange={(event) => setClauseTypography((current) => ({ ...current, underlineEnabled: event.target.checked }))} />
                Stosuj podkreślenie semantyczne
              </label>
            </div>
          </div>
        </div>
      )}

      {/* A4 Editor */}
      <div className="min-h-screen bg-[#525659] py-8">
        <div className="mx-auto" style={{ maxWidth: '230mm' }}>
          {pages.map((pageContent, pageIndex) => (
            <div key={pageIndex} className="contract-a4-page">
              {pageIndex === 0 && (
                <>
                  <div
                    className="contract-header-logo"
                    style={{
                      justifyContent:
                        logoPositionX <= 33
                          ? 'flex-start'
                          : logoPositionX >= 67
                            ? 'flex-end'
                            : 'center',
                      marginTop: `${logoPositionY}mm`,
                    }}
                  >
                    <Image
                      src={selectedLogo}
                      alt="Logo"
                      width={300}
                      height={120}
                      style={{
                        width: `${logoScale * 6}px`,
                        height: 'auto',
                        objectFit: 'contain',
                      }}
                    />
                  </div>

                  <div className="contract-current-date">
                    Olsztyn,{' '}
                    {new Date().toLocaleDateString('pl-PL', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </div>
                </>
              )}

              <div
                ref={(el) => {
                  pageRefs.current[pageIndex] = el;
                  if (el && el.innerHTML === '' && pageContent) {
                    el.innerHTML = pageContent;
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Tab') return;

                  const selection = window.getSelection();
                  const node = selection?.focusNode;
                  const el =
                    node?.nodeType === Node.TEXT_NODE
                      ? node.parentElement
                      : (node as HTMLElement | null);

                  const li = el?.closest?.('li');

                  if (li) {
                    e.preventDefault();
                    document.execCommand(e.shiftKey ? 'outdent' : 'indent');
                    updatePageContent(pageIndex, e.currentTarget.innerHTML);
                  }
                }}
                onContextMenu={(event) => openPlaceholderContextMenu(event, pageIndex)}
                onMouseUp={rememberEditorSelection}
                onKeyUp={rememberEditorSelection}
                onSelect={rememberEditorSelection}
                contentEditable={true}
                suppressContentEditableWarning
                dir="ltr"
                onInput={(e) => updatePageContent(pageIndex, e.currentTarget.innerHTML)}
                onBlur={(e) => {
                  const nextPages = [...pages];
                  nextPages[pageIndex] = e.currentTarget.innerHTML;
                  updatePageContent(pageIndex, e.currentTarget.innerHTML);
                  void repaginate(nextPages);
                }}
                className="contract-content contract-template-editor"
                style={{
                  outline: 'none',
                  direction: 'ltr',
                  unicodeBidi: 'embed',
                  lineHeight: String(lineHeight),
                  fontFamily: selectedFont,
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              />

              {selectedFooter !== 'none' && (
                <div className="contract-footer">
                  {selectedFooter === 'default' && (
                    <div className="footer-logo">
                      <Image
                        src={footerContent.logoUrl}
                        alt="Logo"
                        style={{ maxWidth: `${footerLogoScale}%` }}
                        width={100}
                        height={100}
                      />
                    </div>
                  )}
                  <div className="footer-info">
                    <p>
                      <span className="font-bold">{footerContent.companyName}</span>
                      {footerContent.tagline && (
                        <>
                          {' '}
                          – <span className="italic">{footerContent.tagline}</span>
                        </>
                      )}
                    </p>
                    <p>
                      {footerContent.website} | {footerContent.email}
                    </p>
                    <p>tel: {footerContent.phone}</p>
                  </div>
                </div>
              )}

              <div className="contract-page-counter">
                {pageIndex + 1}/{pages.length}
              </div>
            </div>
          ))}
        </div>
      </div>

      {placeholderContextMenu && (
        <div
          className="fixed z-[100] w-56 rounded-lg border border-[#d3bb73]/30 bg-[#16171d] py-1 text-sm text-[#e5e4e2] shadow-2xl"
          style={{ left: placeholderContextMenu.x, top: placeholderContextMenu.y }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="border-b border-[#d3bb73]/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#d3bb73]">
            Wstaw zmienną
          </div>
          {PLACEHOLDER_CONTEXT_GROUPS.map((group) => (
            <div key={group.label} className="group relative">
              <button className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[#d3bb73]/10">
                <span>{group.label}</span>
                <ChevronRight className="h-4 w-4 text-[#d3bb73]" />
              </button>
              <div
                className={`invisible absolute top-0 z-[101] max-h-[360px] w-64 overflow-y-auto rounded-lg border border-[#d3bb73]/30 bg-[#16171d] py-1 opacity-0 shadow-2xl transition-opacity group-hover:visible group-hover:opacity-100 ${placeholderContextMenu.openLeft ? 'right-full' : 'left-full'}`}
              >
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    onClick={() =>
                      insertPlaceholderFromContext(
                        item.key,
                        item.label,
                        'clauseSlots' in group && group.clauseSlots,
                      )
                    }
                    className="block w-full px-3 py-2 text-left hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                    title={item.key}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Custom Styles
      <style jsx global>{`
        .contract-a4-page-wysiwyg {
          position: relative;
          width: 210mm;
          margin: 0 auto 20px auto;
          padding: 20mm 25mm 5mm;
          background: white;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          font-family: Arial, sans-serif;
          font-size: 12pt;
          line-height: 1.6;
          color: #000;
          page-break-after: always;
          break-after: page;
          display: flex;
          flex-direction: column;
        }

        .contract-header-logo-wysiwyg {
          width: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          margin-bottom: 4mm;
          transition: all 0.2s ease;
        }

        .contract-header-logo-wysiwyg img {
          height: auto;
          object-fit: contain;
        }

        .contract-current-date-wysiwyg {
          position: absolute;
          top: 20mm;
          right: 20mm;
          text-align: right;
          font-size: 10pt;
          color: #333;
          font-weight: 500;
        }

        .contract-content-wysiwyg {
          flex: 1;
          text-align: justify;
          color: #000;
          font-family: Arial, sans-serif;
          font-size: 12pt;
          line-height: 1.6;
          direction: ltr !important;
          unicode-bidi: embed !important;
          overflow-wrap: break-word;
          word-wrap: break-word;
          overflow: hidden;
        }

        .contract-content-wysiwyg * {
          direction: ltr !important;
          unicode-bidi: embed !important;
        }

        .contract-content-wysiwyg:focus {
          outline: 2px solid #d3bb73;
          outline-offset: 4px;
        }

        .contract-content-wysiwyg p {
          margin: 0 0 1em 0;
          page-break-inside: avoid;
          break-inside: avoid;
        }

        .contract-content-wysiwyg h1,
        .contract-content-wysiwyg h2,
        .contract-content-wysiwyg h3 {
          margin-top: 1.5em;
          margin-bottom: 0.75em;
          font-weight: bold;
          page-break-after: avoid;
          break-after: avoid;
          page-break-inside: avoid;
          break-inside: avoid;
        }

        .contract-content-wysiwyg h1 {
          font-size: 18pt;
          text-align: center;
        }

        .contract-content-wysiwyg h2 {
          font-size: 16pt;
        }

        .contract-content-wysiwyg h3 {
          font-size: 14pt;
        }

        .contract-content-wysiwyg strong,
        .contract-content-wysiwyg b {
          font-weight: bold;
        }

        .contract-content-wysiwyg em,
        .contract-content-wysiwyg i {
          font-style: italic;
        }

        .contract-content-wysiwyg u {
          text-decoration: underline;
        }

        .contract-content-wysiwyg ul,
        .contract-content-wysiwyg ol {
          margin: 1em 0;
          padding-left: 2em;
          list-style-position: outside;
        }

        .contract-content-wysiwyg ul {
          list-style-type: disc;
        }

        .contract-content-wysiwyg ol {
          list-style-type: decimal;
        }

        .contract-content-wysiwyg li {
          margin: 0.1em 0;
          display: list-item;
        }

        .contract-content-wysiwyg img {
          max-width: 100%;
          height: auto;
          display: block;
          margin: 10px auto;
        }

        .contract-content-wysiwyg div[data-page-break='true'] {
          page-break-after: always;
          break-after: page;
          margin: 20px 0;
        }

        .contract-content-wysiwyg div[data-page-break='true'] hr {
          border: 1px dashed #d3bb73;
          margin: 20px 0;
        }

        @media print {
          .contract-content-wysiwyg div[data-page-break='true'] hr {
            display: none;
          }

          .contract-content-wysiwyg div[data-page-break='true'] {
            margin: 0;
            height: 0;
          }
        }

        .contract-footer-wysiwyg {
          margin-top: auto;
          width: 100%;
          min-height: 15mm;
          display: flex;
          justify-content: flex-end;
          padding: 10px 0;
          background: white;
          pointer-events: none;
          flex-shrink: 0;
          position: relative;
        }

        .page-number-footer {
          position: absolute;
          top: -20px;
          right: 0;
          font-size: 10pt;
          color: #666;
          font-weight: 500;
        }

        .contract-footer-wysiwyg::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: #d3bb73;
        }

        .footer-logo-wysiwyg {
          display: none;
        }

        .footer-info-wysiwyg {
          text-align: right;
          font-size: 10pt;
          color: #333;
          line-height: 1.2;
        }

        .footer-info-wysiwyg p {
          margin: 4px 0;
          color: #333;
        }
      `}</style> */}
    </div>
  );
}
