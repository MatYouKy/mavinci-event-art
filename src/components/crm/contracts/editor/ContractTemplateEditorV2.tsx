'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { ArrowLeft, Download, Eye, Filter, GitMerge, ListChecks, Loader2, PenLine, Printer, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { SYSTEM_FONTS } from '@/lib/CRM/systemFonts';
import {
  buildContractFooterHtml,
  buildContractHeaderHtml,
  renderContractDocument,
} from '@/lib/CRM/contracts/contractPagination';
import { normalizeContractParagraphPlaceholders } from '@/lib/CRM/contracts/contractParagraphs';
import {
  CONTRACT_STYLE_IDS,
  resolveContractDocumentStyles,
  type ContractDocumentStyle,
  type ContractDocumentStyles,
  type ContractStyleId,
} from '@/lib/CRM/contracts/contractDocumentStyles';
import { createContractDraftPdf } from '@/app/(crm)/crm/contract-templates/printDraft';
import { getContractDocumentCss } from '@/components/crm/events/calculations/helpers/getContractCssForPrint';
import { prepareContractHtmlForEditor } from '@/lib/CRM/contracts/contractEditorHtml';
import { CONTRACT_PLACEHOLDER_GROUPS } from '@/lib/CRM/contracts/contractPlaceholderGroups';
import {
  CONTRACT_CATEGORY_VARIABLE,
  CONTRACT_CLIENT_VARIABLE,
  applyContractConditions,
  contractConditionVariableNames,
  contractOptionVariable,
  resolveContractOptions,
  type ContractOption,
} from '@/lib/CRM/contracts/contractConditions';
import ContractDocumentEditor, { contractEditorHtml } from './ContractDocumentEditor';
import ContractConditionDialog from './ContractConditionDialog';
import ContractOptionsDialog from './ContractOptionsDialog';
import ContractMergeDialog from './ContractMergeDialog';
import {
  contractConditionAtSelection,
  refreshContractConditions,
  removeContractCondition,
  selectionSpansBlocks,
  setContractCondition,
} from './contractEditorExtensions';
import ContractEditorRibbon, { RibbonButton, RibbonGroup } from './ContractEditorRibbon';
import ContractStyleDialog from './ContractStyleDialog';

type FooterContent = { companyName: string; tagline: string; website: string; email: string; phone: string; logoUrl: string };

export interface ContractTemplateEditorV2Props {
  template: any;
  brandLogos: Array<{ url: string; label: string; companyName: string }>;
  brandFonts: Array<{ label: string; family: string }>;
  footerTemplates: any[];
  onBack: () => void;
  /** Po zapisie — zapisany wiersz (nowa wersja `updated_at`), bez przeładowania edytora. */
  onSaved?: (saved: { updated_at: string; content_html: string; page_settings: any }) => void;
}

const DEFAULT_LOGO = '/erulers_logo_vect.png';
const DEFAULT_FOOTER: FooterContent = {
  companyName: 'EVENT RULERS',
  tagline: 'Więcej niż Wodzireje!',
  website: 'www.eventrulers.pl',
  email: 'biuro@eventrulers.pl',
  phone: '698-212-279',
  logoUrl: DEFAULT_LOGO,
};

/** Pola umowy do warunku „Pole wypełnione” (bez numeru § i miejsc na klauzule). */
const CONDITION_FIELDS = CONTRACT_PLACEHOLDER_GROUPS
  .filter((group) => !('clauseSlots' in group))
  .flatMap((group) => group.items)
  .filter((item) => item.key.startsWith('{{'))
  .map((item) => ({ key: item.key.replace(/[{}]/g, ''), label: item.label }));
const FIELD_LABELS: Record<string, string> = {
  // Pole używane w warunkach szablonów, a nieobecne w menu pól.
  zamowienie: 'Numer zamówienia klienta',
  ...Object.fromEntries(CONDITION_FIELDS.map((field) => [field.key, field.label])),
};

/** Symulacja „Pokaż jako”: klient, kategoria wydarzenia i stan opcji umowy. */
type Simulation = { klient: 'firma' | 'osoba'; kategoria: string; options: Record<string, boolean> };

const layoutFrom = (settings: any) => ({
  selectedLogo: settings?.selectedLogo || DEFAULT_LOGO,
  logoScale: settings?.logoScale ?? 80,
  logoPositionX: settings?.logoPositionX ?? 50,
  logoPositionY: settings?.logoPositionY ?? 0,
  selectedFooter: (settings?.selectedFooter || 'default') as 'default' | 'minimal' | 'none',
  selectedFooterTemplateId: (settings?.selectedFooterTemplateId || null) as string | null,
  footerContent: { ...DEFAULT_FOOTER, ...(settings?.footerContent || {}) } as FooterContent,
  footerLogoScale: settings?.footerLogoScale ?? 80,
});

/** Ekran szablonu umowy w nowym formacie: wstążka, kartka A4 z treścią, style jak w Wordzie, podgląd stron i PDF. */
export default function ContractTemplateEditorV2({ template, brandLogos, brandFonts, footerTemplates, onBack, onSaved }: ContractTemplateEditorV2Props) {
  const { showSnackbar } = useSnackbar();
  // Zapisane numery „§ 1, § 2…” wracają do „§n” — numer nadaje się przy generowaniu (jak w starym edytorze).
  const [initialContent] = useState<string>(() =>
    normalizeContractParagraphPlaceholders(template?.page_settings?.flowContent || template?.content_html || ''));
  const [content, setContent] = useState<string>(initialContent);
  const [documentStyles, setDocumentStyles] = useState<ContractDocumentStyles>(() =>
    resolveContractDocumentStyles(template?.page_settings?.documentStyles));
  const [layout, setLayout] = useState(() => layoutFrom(template?.page_settings));
  const [saving, setSaving] = useState(false);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [draftAction, setDraftAction] = useState<'print' | 'download' | null>(null);
  const [modifying, setModifying] = useState<ContractStyleId | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [options, setOptions] = useState<ContractOption[]>(() => resolveContractOptions(template?.page_settings));
  const optionsBaselineRef = useRef(JSON.stringify(options));
  const [categories, setCategories] = useState<string[]>([]);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [conditionDialog, setConditionDialog] = useState<{
    initial: string | null;
    scope: string;
    resolve?: (value: { condition: string; options: ContractOption[] } | null) => void;
  } | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  // Wersja wiersza (optymistyczna blokada: zapis tylko, gdy nikt nie zmienił szablonu w innej karcie).
  const [version, setVersion] = useState<string | null>(template?.updated_at || null);
  const contentRef = useRef(content);
  contentRef.current = content;
  // Treść w chwili wczytania / ostatniego zapisu — „niezapisane zmiany” liczymy względem niej.
  const baselineRef = useRef<string | null>(null);
  const stylesBaselineRef = useRef(JSON.stringify(documentStyles));
  const layoutBaselineRef = useRef(JSON.stringify(layout));
  const [contentDirty, setContentDirty] = useState(false);
  const handleReady = useCallback((instance: Editor) => {
    setEditor(instance);
    baselineRef.current = contractEditorHtml(instance);
  }, []);

  const fonts = useMemo(() => {
    const list = [
      ...brandFonts.map((font) => ({ label: `${font.label || font.family} (marka)`, value: `${font.family}, sans-serif` })),
      ...SYSTEM_FONTS.map((font) => ({ label: font.label, value: font.family })),
    ];
    return list.filter((font, index) => list.findIndex((other) => other.value === font.value) === index);
  }, [brandFonts]);

  const settings = useCallback(() => ({
    ...(template?.page_settings || {}),
    ...layout,
    documentStyles,
    contractOptions: options,
    selectedFont: documentStyles.styles.body.fontFamily,
    lineHeight: documentStyles.styles.body.lineHeight,
  }), [template, layout, documentStyles, options]);

  // Kategorie wydarzeń do warunku „Rodzaj wydarzenia” i symulacji.
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('event_categories').select('name').eq('is_active', true).order('name');
      setCategories(Array.from(new Set((data || []).map((row: { name: string }) => row.name).filter(Boolean))));
    })();
  }, []);

  /** Zmienne warunków dla symulacji (pola umowy traktujemy jako wypełnione — jak w podglądzie z polami `{{…}}`). */
  const simulationVariables = useCallback((html: string): Record<string, string> | null => {
    if (!simulation) return null;
    const variables: Record<string, string> = {};
    contractConditionVariableNames(html).forEach((name) => { variables[name] = 'tak'; });
    variables[CONTRACT_CLIENT_VARIABLE] = simulation.klient;
    variables[CONTRACT_CATEGORY_VARIABLE] = simulation.kategoria;
    options.forEach((option) => {
      variables[contractOptionVariable(option.key)] = (simulation.options[option.key] ?? option.defaultOn) ? 'tak' : '';
    });
    return variables;
  }, [simulation, options]);

  /** Treść do podglądu, PDF i liczby stron — przy symulacji tylko to, co dostanie klient. */
  const visibleContent = useCallback((html: string) => {
    const variables = simulationVariables(html);
    return variables ? applyContractConditions(html, variables) : html;
  }, [simulationVariables]);

  // Etykiety warunków i przygaszenie treści poza symulacją.
  useEffect(() => {
    if (!editor) return;
    refreshContractConditions(editor, { options, fieldLabels: FIELD_LABELS, simulate: simulationVariables(contentRef.current) });
  }, [editor, options, simulationVariables, content]);

  const conditionState = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      const target = contractConditionAtSelection(current);
      return {
        condition: (target?.node.attrs.condition as string | undefined) || null,
        targetType: target?.type || null,
        spans: selectionSpansBlocks(current),
        inList: current.isActive('listItem'),
      };
    },
  });

  // Liczba stron jak w PDF — liczona w tle po przerwie w pisaniu.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const rendered = await renderContractDocument(visibleContent(content), settings());
        if (!cancelled) setPageCount(rendered.pages.length);
      } catch {
        if (!cancelled) setPageCount(null);
      }
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [content, settings, visibleContent]);

  const dirty = contentDirty || JSON.stringify(documentStyles) !== stylesBaselineRef.current ||
    JSON.stringify(layout) !== layoutBaselineRef.current || JSON.stringify(options) !== optionsBaselineRef.current;

  // Niezapisane zmiany — ostrzeżenie przy zamykaniu karty.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const currentContent = () => (editor ? contractEditorHtml(editor) : contentRef.current);

  const save = async () => {
    if (saving) return;
    const flowContent = currentContent();
    const plainText = flowContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!plainText) {
      showSnackbar('Treść szablonu nie może być pusta', 'error');
      return;
    }
    try {
      setSaving(true);
      const rendered = await renderContractDocument(flowContent, settings());
      if (!version) throw new Error('Odśwież szablon przed zapisaniem zmian.');
      const updatedAt = new Date().toISOString();
      const pageSettings = {
        ...settings(),
        flowContent: rendered.flowContent,
        pages: rendered.pages,
        paginationMode: 'automatic',
        marginTop: 50,
        marginBottom: 50,
        marginLeft: 50,
        marginRight: 50,
        pageSize: 'A4',
      };
      const { data, error } = await supabase
        .from('contract_templates')
        .update({
          content: plainText || 'Szablon umowy',
          content_html: rendered.flowContent,
          page_settings: pageSettings,
          updated_at: updatedAt,
        })
        .eq('id', template.id)
        .eq('updated_at', version)
        .select('id, updated_at')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Szablon został zmieniony w innej karcie. Skopiuj swoje poprawki i odśwież stronę przed ponownym zapisem.');
      setVersion(data.updated_at || updatedAt);
      baselineRef.current = flowContent;
      stylesBaselineRef.current = JSON.stringify(documentStyles);
      layoutBaselineRef.current = JSON.stringify(layout);
      optionsBaselineRef.current = JSON.stringify(options);
      setContentDirty(false);
      showSnackbar('Szablon zapisany', 'success');
      onSaved?.({ updated_at: data.updated_at || updatedAt, content_html: rendered.flowContent, page_settings: pageSettings });
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się zapisać szablonu', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ⌘S / Ctrl+S — zapis.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const showPages = async () => {
    const rendered = await renderContractDocument(visibleContent(currentContent()), settings());
    setPreview(rendered.pages);
    setPageCount(rendered.pages.length);
  };

  const draft = async (action: 'print' | 'download') => {
    const target = action === 'print' ? window.open('', '_blank') : null;
    if (action === 'print' && !target) {
      showSnackbar('Zezwól przeglądarce na otwieranie nowych kart.', 'error');
      return;
    }
    try {
      setDraftAction(action);
      const flowContent = visibleContent(currentContent());
      const rendered = await renderContractDocument(flowContent, settings());
      const blob = await createContractDraftPdf({
        ...template,
        name: template?.name || 'Szablon umowy',
        content_html: rendered.flowContent,
        page_settings: { ...settings(), flowContent: rendered.flowContent, pages: rendered.pages, paginationMode: 'automatic' },
      });
      const url = URL.createObjectURL(blob);
      if (action === 'download') {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${template?.name || 'szablon-umowy'}-draft.pdf`;
        link.click();
      } else {
        target!.location.href = url;
        target!.addEventListener('load', () => target!.print(), { once: true });
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error: any) {
      target?.close();
      showSnackbar(error?.message || 'Nie udało się przygotować PDF', 'error');
    } finally {
      setDraftAction(null);
    }
  };

  const updateStyles = (next: ContractDocumentStyles) => {
    setDocumentStyles(next);
    setPreview(null);
  };

  const saveStyle = (id: ContractStyleId, value: ContractDocumentStyle) => {
    updateStyles({ ...documentStyles, styles: { ...documentStyles.styles, [id]: value } });
    setModifying(null);
  };

  const setDocumentFont = (fontFamily: string) => {
    const styles = { ...documentStyles.styles };
    CONTRACT_STYLE_IDS.forEach((id) => { styles[id] = { ...styles[id], fontFamily }; });
    updateStyles({ ...documentStyles, styles });
  };

  const updateLayout = (patch: Partial<ReturnType<typeof layoutFrom>>) => {
    setLayout((current) => ({ ...current, ...patch }));
    setPreview(null);
  };

  const selectFooterTemplate = (id: string) => {
    const footer = footerTemplates.find((item) => item.id === id);
    if (!footer) return updateLayout({ selectedFooterTemplateId: null });
    updateLayout({
      selectedFooterTemplateId: id,
      footerContent: {
        companyName: footer.company_name,
        tagline: footer.tagline || '',
        website: footer.website,
        email: footer.email,
        phone: footer.phone,
        logoUrl: footer.logo_url,
      },
      footerLogoScale: footer.logo_scale || 80,
    });
  };

  const headerHtml = useMemo(() => buildContractHeaderHtml(settings() as any), [settings]);

  // MARK: Warunki

  const conditionScope = () => {
    if (!conditionState) return 'Akapit';
    if (conditionState.condition && !conditionState.spans) {
      return conditionState.targetType === 'contractSection' ? 'Sekcja' : conditionState.targetType === 'listItem' ? 'Punkt listy' : 'Akapit';
    }
    if (conditionState.spans) return 'Zaznaczone akapity (sekcja)';
    return conditionState.inList ? 'Punkt listy' : 'Akapit';
  };

  /** Okno warunku jako obietnica — używa go też scalanie szablonów. */
  const pickCondition = (initial: string | null, scope: string) =>
    new Promise<{ condition: string; options: ContractOption[] } | null>((resolve) => {
      setConditionDialog({ initial, scope, resolve });
    });

  const openConditionDialog = async (edit: boolean) => {
    if (!editor) return;
    const picked = await pickCondition(edit ? conditionState?.condition || null : null, conditionScope());
    if (!picked) return;
    setOptions(picked.options);
    setContractCondition(editor, picked.condition);
  };

  const optionUsage = useMemo(() => Object.fromEntries(options.map((option) => [
    option.key,
    (content.match(new RegExp(`data-contract-if="!?${contractOptionVariable(option.key)}"`, 'g')) || []).length,
  ])), [options, content]);

  const applyMerge = (html: string, nextOptions: ContractOption[]) => {
    if (!editor) return;
    setOptions(nextOptions);
    editor.commands.setContent(prepareContractHtmlForEditor(html), { emitUpdate: true });
    setMergeOpen(false);
    showSnackbar('Szablony scalone — sprawdź „Pokaż jako” i zapisz. Cofnięcie: ⌘Z.', 'success');
  };

  const conditionsTab = (
    <>
      <RibbonGroup title="Warunek">
        <RibbonButton label="Dodaj warunek do akapitu, punktu lub zaznaczonych akapitów" onClick={() => void openConditionDialog(false)}>
          <Filter className="h-4 w-4" /><span className="ml-1 text-xs">Dodaj warunek</span>
        </RibbonButton>
        <RibbonButton label="Zmień warunek" disabled={!conditionState?.condition} onClick={() => void openConditionDialog(true)}>
          <span className="text-xs">Zmień</span>
        </RibbonButton>
        <RibbonButton label="Usuń warunek (treść zostaje)" disabled={!conditionState?.condition} onClick={() => editor && removeContractCondition(editor)}>
          <Trash2 className="h-4 w-4" /><span className="ml-1 text-xs">Usuń</span>
        </RibbonButton>
      </RibbonGroup>
      <RibbonGroup title="Opcje umowy">
        <RibbonButton label="Opcje włączane przy każdej umowie (np. nocleg)" onClick={() => setOptionsOpen(true)}>
          <ListChecks className="h-4 w-4" /><span className="ml-1 text-xs">Opcje ({options.length})</span>
        </RibbonButton>
      </RibbonGroup>
      <RibbonGroup title="Warianty">
        <RibbonButton label="Scal z innym szablonem — różnice jako sekcje warunkowe" onClick={() => setMergeOpen(true)}>
          <GitMerge className="h-4 w-4" /><span className="ml-1 text-xs">Scal z szablonem…</span>
        </RibbonButton>
      </RibbonGroup>
      <RibbonGroup title="Pokaż jako (symulacja)">
        <RibbonButton
          label={simulation ? 'Wyłącz symulację — pokaż całą treść' : 'Pokaż treść tak, jak zobaczy ją wybrany klient'}
          active={Boolean(simulation)}
          onClick={() => setSimulation((current) => (current ? null : { klient: 'osoba', kategoria: categories[0] || '', options: {} }))}
        >
          <Eye className="h-4 w-4" /><span className="ml-1 text-xs">{simulation ? 'Wł.' : 'Wył.'}</span>
        </RibbonButton>
        {simulation && (
          <>
            <select
              value={simulation.klient}
              onChange={(event) => setSimulation({ ...simulation, klient: event.target.value as Simulation['klient'] })}
              className="h-7 rounded border border-white/15 bg-[#0f1119] px-2 text-xs text-[#e5e4e2]"
              aria-label="Klient"
            >
              <option value="osoba">Osoba prywatna</option>
              <option value="firma">Firma</option>
            </select>
            <select
              value={simulation.kategoria}
              onChange={(event) => setSimulation({ ...simulation, kategoria: event.target.value })}
              className="h-7 max-w-[160px] rounded border border-white/15 bg-[#0f1119] px-2 text-xs text-[#e5e4e2]"
              aria-label="Rodzaj wydarzenia"
            >
              <option value="">Bez kategorii</option>
              {categories.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            {options.map((option) => (
              <label key={option.key} className="flex items-center gap-1 text-xs text-[#e5e4e2]/80">
                <input
                  type="checkbox"
                  className="accent-[#d3bb73]"
                  checked={simulation.options[option.key] ?? option.defaultOn}
                  onChange={(event) => setSimulation({ ...simulation, options: { ...simulation.options, [option.key]: event.target.checked } })}
                />
                {option.label}
              </label>
            ))}
          </>
        )}
      </RibbonGroup>
    </>
  );

  const layoutTab = (
    <>
      <RibbonGroup title="Czcionka dokumentu">
        <select
          value={documentStyles.styles.body.fontFamily}
          onChange={(event) => setDocumentFont(event.target.value)}
          className="h-7 max-w-[200px] rounded border border-white/15 bg-[#0f1119] px-2 text-xs text-[#e5e4e2]"
          title="Zmienia czcionkę we wszystkich stylach"
        >
          {[{ label: documentStyles.styles.body.fontFamily.split(',')[0].replace(/["']/g, ''), value: documentStyles.styles.body.fontFamily }, ...fonts]
            .filter((font, index, list) => list.findIndex((other) => other.value === font.value) === index)
            .map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
        </select>
      </RibbonGroup>
      <RibbonGroup title="Logo w nagłówku">
        <select
          value={layout.selectedLogo}
          onChange={(event) => updateLayout({ selectedLogo: event.target.value })}
          className="h-7 max-w-[220px] rounded border border-white/15 bg-[#0f1119] px-2 text-xs text-[#e5e4e2]"
        >
          <option value={DEFAULT_LOGO}>Event Rulers (domyślne)</option>
          {brandLogos.map((logo) => <option key={logo.url} value={logo.url}>{logo.companyName} — {logo.label}</option>)}
          <option value="">Bez logo</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-[#e5e4e2]/70">
          Rozmiar
          <input type="range" min={20} max={150} value={layout.logoScale} onChange={(event) => updateLayout({ logoScale: Number(event.target.value) })} />
        </label>
        <div className="flex gap-0.5">
          {([['Lewo', 0], ['Środek', 50], ['Prawo', 100]] as const).map(([label, value]) => (
            <RibbonButton key={label} label={`Logo: ${label}`} active={layout.logoPositionX === value} onClick={() => updateLayout({ logoPositionX: value })}>
              <span className="text-xs">{label}</span>
            </RibbonButton>
          ))}
        </div>
      </RibbonGroup>
      <RibbonGroup title="Stopka">
        <select
          value={layout.selectedFooter}
          onChange={(event) => updateLayout({ selectedFooter: event.target.value as 'default' | 'minimal' | 'none' })}
          className="h-7 rounded border border-white/15 bg-[#0f1119] px-2 text-xs text-[#e5e4e2]"
        >
          <option value="default">Pełna</option>
          <option value="minimal">Minimalna</option>
          <option value="none">Bez stopki</option>
        </select>
        {footerTemplates.length > 0 && layout.selectedFooter !== 'none' && (
          <select
            value={layout.selectedFooterTemplateId || ''}
            onChange={(event) => selectFooterTemplate(event.target.value)}
            className="h-7 max-w-[200px] rounded border border-white/15 bg-[#0f1119] px-2 text-xs text-[#e5e4e2]"
          >
            <option value="">Dane z szablonu</option>
            {footerTemplates.map((footer) => <option key={footer.id} value={footer.id}>{footer.name}</option>)}
          </select>
        )}
      </RibbonGroup>
    </>
  );

  const viewTab = (
    <>
      <RibbonGroup title="Widok">
        <RibbonButton label="Edycja treści" active={!preview} onClick={() => setPreview(null)}>
          <PenLine className="h-4 w-4" /><span className="ml-1 text-xs">Edycja</span>
        </RibbonButton>
        <RibbonButton label="Strony jak w PDF" active={Boolean(preview)} onClick={() => void showPages()}>
          <Eye className="h-4 w-4" /><span className="ml-1 text-xs">Strony</span>
        </RibbonButton>
      </RibbonGroup>
      <RibbonGroup title="Wersja próbna">
        <RibbonButton label="Drukuj wersję próbną" disabled={draftAction !== null} onClick={() => void draft('print')}>
          {draftAction === 'print' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}<span className="ml-1 text-xs">Drukuj</span>
        </RibbonButton>
        <RibbonButton label="Pobierz PDF (wersja próbna)" disabled={draftAction !== null} onClick={() => void draft('download')}>
          {draftAction === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}<span className="ml-1 text-xs">PDF</span>
        </RibbonButton>
      </RibbonGroup>
    </>
  );

  return (
    <div className="-m-2 flex h-[calc(100dvh-73px)] flex-col bg-[#0f1119] sm:-m-4 md:-m-6">
      <style dangerouslySetInnerHTML={{ __html: getContractDocumentCss() }} />
      <div className="flex items-center gap-3 border-b border-white/10 bg-[#151827] px-4 py-2">
        <button type="button" onClick={onBack} className="rounded p-1.5 text-[#e5e4e2]/70 hover:bg-white/10 hover:text-[#e5e4e2]" aria-label="Wróć do listy szablonów">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[#e5e4e2]">{template?.name || 'Szablon umowy'}</div>
          <div className="text-xs text-[#e5e4e2]/50">
            {pageCount ? `${pageCount} ${pageCount === 1 ? 'strona' : pageCount < 5 ? 'strony' : 'stron'} w PDF` : 'Liczę strony…'}
            {dirty ? ' · niezapisane zmiany' : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-1.5 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-60"
          title="Zapisz (⌘S)"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Zapisz
        </button>
      </div>

      <ContractEditorRibbon
        editor={editor}
        documentStyles={documentStyles}
        onModifyStyle={setModifying}
        conditions={conditionsTab}
        layout={layoutTab}
        view={viewTab}
      />

      <div className="flex-1 overflow-auto bg-[#2a2d3a] py-8">
        <div className={preview ? 'hidden' : ''}>
          <ContractDocumentEditor
            content={initialContent}
            documentStyles={documentStyles}
            onReady={handleReady}
            onChange={(html) => {
              setContent(html);
              setContentDirty(baselineRef.current !== null && html !== baselineRef.current);
            }}
            onNotice={(message) => showSnackbar(message, 'info')}
            header={<div className="contract-editor-header" dangerouslySetInnerHTML={{ __html: headerHtml }} />}
          />
        </div>
        {preview && (
          <div className="contract-a4-container !min-h-0 !bg-transparent">
            {preview.map((page, index) => (
              <div key={index} className="contract-a4-page">
                {index === 0 && <div dangerouslySetInnerHTML={{ __html: buildContractHeaderHtml(settings() as any) }} />}
                <div className="contract-content" style={{ lineHeight: String(documentStyles.styles.body.lineHeight), fontFamily: documentStyles.styles.body.fontFamily }} dangerouslySetInnerHTML={{ __html: page }} />
                <div dangerouslySetInnerHTML={{ __html: buildContractFooterHtml(settings() as any) }} />
              </div>
            ))}
          </div>
        )}
      </div>

      {conditionDialog && (
        <ContractConditionDialog
          initial={conditionDialog.initial}
          scopeLabel={conditionDialog.scope}
          options={options}
          categories={categories}
          fields={CONDITION_FIELDS}
          onApply={(condition, nextOptions) => {
            conditionDialog.resolve?.({ condition, options: nextOptions });
            setConditionDialog(null);
          }}
          onRemove={conditionDialog.initial && conditionDialog.scope !== 'Wariant' ? () => {
            conditionDialog.resolve?.(null);
            setConditionDialog(null);
            if (editor) removeContractCondition(editor);
          } : undefined}
          onClose={() => {
            conditionDialog.resolve?.(null);
            setConditionDialog(null);
          }}
        />
      )}

      {optionsOpen && (
        <ContractOptionsDialog
          options={options}
          usage={optionUsage}
          onSave={(next) => { setOptions(next); setOptionsOpen(false); }}
          onClose={() => setOptionsOpen(false)}
        />
      )}

      {mergeOpen && template?.id && (
        <ContractMergeDialog
          templateId={template.id}
          baseHtml={currentContent()}
          options={options}
          fieldLabels={FIELD_LABELS}
          pickCondition={(initial) => pickCondition(initial, 'Wariant')}
          onMerge={applyMerge}
          onClose={() => setMergeOpen(false)}
        />
      )}

      {modifying && (
        <ContractStyleDialog
          styleId={modifying}
          value={documentStyles.styles[modifying]}
          fonts={fonts}
          onSave={(value) => saveStyle(modifying, value)}
          onClose={() => setModifying(null)}
        />
      )}
    </div>
  );
}
