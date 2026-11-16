/* eslint-disable @next/next/no-img-element */
/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { Fragment, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Dialog from '@mui/material/Dialog';
import {
  FileText,
  Download,
  CreditCard as Edit,
  Save,
  X,
  Mail,
  Eye,
  Loader,
  Printer,
  FilePenLine,
  Pencil,
  RefreshCw,
  ShieldAlert,
  ExternalLink,
  Sparkles,
  Search,
  ListChecks,
  ChevronDown,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import '@/styles/contractA4.css';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import SendContractEmailModal from '@/components/crm/SendContractEmailModal';
import {
  getContractCssForPrint,
  getContractDocumentCss,
} from '../calculations/helpers/getContractCssForPrint';
import { renderContractDocument } from '@/lib/CRM/contracts/contractPagination';
import {
  getContractClauseTopicLabel,
  type ContractClauseCategory,
} from '@/lib/CRM/contracts/contractClauseContent';
import {
  serializeEventContractClauseItems,
  type EventContractClauseItem,
} from '@/lib/CRM/contracts/eventContractClauseOverrides';
import {
  CONTRACT_CLIENT_VARIABLE,
  contractOptionVariable,
} from '@/lib/CRM/contracts/contractConditions';
import { createContractDraftPdf } from '@/app/(crm)/crm/contract-templates/printDraft';
import ContractAuditReviewModal from './ContractAuditReviewModal';
import EventContractClausesModal from './EventContractClausesModal';
import CancelContractModal from './CancelContractModal';
import { ContractPagesView } from './ContractPagesView';
import SignedContractAttachments, { type Attachment } from './SignedContractAttachments';
import {
  applyContractAuditDecisions,
  extractContractAuditBlocks,
  getContractDocumentParts,
  type ContractAuditBlock,
  type ContractAuditResult,
} from '@/lib/CRM/contracts/contractAudit';
import {
  CONTRACT_AMOUNTS_REQUIRED,
  buildEventContractDepositContent,
  buildEventContractFieldsUpdate,
  clientPartyWithSigners,
  eventContractConditionSettings,
  eventContractDepositPatch,
  eventContractEditableVariables,
  eventContractPreflightIssues,
  eventContractUsedVariableKeys,
  fetchEventContractData,
  isEventContractHtmlField,
  isEventContractLongField,
  readContractDepositNumber,
  type ContractPreflightIssue,
  type ContractPartySigner,
  type ContractStatus,
  type EventCompanyBranding,
  type ProductClauseConflict,
} from '@/lib/CRM/contracts/eventContractData';

export type { DecisionMaker } from '@/lib/CRM/contracts/eventContractData';



type ContractAuditReviewState = {
  audit: ContractAuditResult;
  blocks: ContractAuditBlock[];
  sourceContent: string;
};



// HTML blocks use a visual editor; ordinary placeholders remain text fields.
function ContractVariableHtmlField({ value, label, onChange }: {
  value: string; label: string; onChange: (value: string) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (element.current && element.current.innerHTML !== value) element.current.innerHTML = value;
  }, [value]);
  return <div ref={element} contentEditable suppressContentEditableWarning
    role="textbox" aria-label={label} aria-multiline="true"
    onInput={(event) => onChange(event.currentTarget.innerHTML)}
    onPaste={(event) => {
      event.preventDefault();
      const selection = window.getSelection();
      if (!selection?.rangeCount || !event.currentTarget.contains(selection.anchorNode)) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const text = document.createTextNode(event.clipboardData.getData('text/plain'));
      range.insertNode(text);
      range.setStartAfter(text);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      onChange(event.currentTarget.innerHTML);
    }}
    className="min-h-28 overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#d3bb73]/20 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none" />;
}



const CONTRACT_CLAUSE_CATEGORY_LABELS: Record<string, string> = {
  conditions: 'warunki realizacji',
  requirements: 'wymagania organizacyjne i techniczne',
  obligations: 'obowiązki zamawiającego',
  risks: 'ryzyka i odpowiedzialność',
  additional_requirements: 'wymagania dodatkowe',
  general: 'postanowienia dodatkowe',
};

const EVENT_CONTRACT_CLAUSE_CATEGORY_ORDER: ContractClauseCategory[] = [
  'conditions',
  'requirements',
  'obligations',
  'risks',
  'additional_requirements',
  'general',
];

const normalizeClauseComparisonText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pl-PL')
    .replace(/[„”"'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const deduplicateExactClauseItemsInSection = (section: HTMLElement) => {
  const seenItems = new Set<string>();
  const topLevelItems = Array.from(section.querySelectorAll<HTMLLIElement>('li')).filter(
    (item) => !item.parentElement?.closest('li'),
  );

  topLevelItems.forEach((item) => {
    const signature = normalizeClauseComparisonText(item.textContent || '');
    if (!signature) return;
    if (seenItems.has(signature)) item.remove();
    else seenItems.add(signature);
  });

  section.querySelectorAll('ol, ul').forEach((list) => {
    if (!list.querySelector(':scope > li')) list.remove();
  });
  section.querySelectorAll<HTMLElement>('.product-contract-clause').forEach((clause) => {
    if (!clause.textContent?.trim()) clause.remove();
  });
};

const deduplicateProductClauseSections = (html: string) => {
  if (typeof document === 'undefined') return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  // Starsze wersje automatycznie dopisywały klauzule na końcu szablonu bez
  // zadeklarowanych obszarów. Taki fallback nie jest częścią indywidualnej
  // treści umowy i nie może wracać ze starego snapshotu.
  container
    .querySelectorAll('[data-auto-product-clauses="true"]')
    .forEach((section) => section.remove());
  container
    .querySelectorAll<HTMLElement>('.contract-product-clauses')
    .forEach(deduplicateExactClauseItemsInSection);
  const seenSections = new Set<string>();
  container.querySelectorAll<HTMLElement>('.contract-product-clauses').forEach((section) => {
    const signature = section.innerHTML.replace(/\s+/g, ' ').trim();
    if (seenSections.has(signature)) section.remove();
    else seenSections.add(signature);
  });
  return container.innerHTML;
};








/** Kolejne statusy umowy (anulowanie jest osobną czynnością). */
const CONTRACT_STATUS_FLOW: ContractStatus[] = ['draft', 'issued', 'sent', 'accepted', 'signed_by_client', 'signed_returned'];
const NEXT_STATUS_ACTION: Partial<Record<ContractStatus, string>> = {
  issued: 'Wystaw umowę',
  sent: 'Oznacz jako wysłaną',
  accepted: 'Oznacz jako zaakceptowaną',
  signed_by_client: 'Podpisana przez klienta',
  signed_returned: 'Podpisana i odesłana',
};

type ContractSection = 'content' | 'data' | 'clauses' | 'review' | 'documents';
const CONTRACT_SECTIONS: Array<{ id: ContractSection; label: string }> = [
  { id: 'content', label: 'Treść' },
  { id: 'data', label: 'Dane i warunki' },
  { id: 'clauses', label: 'Klauzule' },
  { id: 'review', label: 'Sprawdzenie' },
  { id: 'documents', label: 'Dokumenty i historia' },
];


export function EventContractTab({
  eventId,
  onSignedDocumentChange,
  canViewAmounts = true,
}: {
  eventId: string;
  onSignedDocumentChange?: (present: boolean) => void;
  /** Obszar „kwoty” (event_financials, kalkulacje): bez niego nie generujemy ani nie przeliczamy umowy. */
  canViewAmounts?: boolean;
}) {
  const [signedFilesState, setSignedFilesState] = useState<{ contractId: string; files: Attachment[] } | null>(null);
  const [documentPreviewOpen, setDocumentPreviewOpen] = useState(false);
  const [signedFilesOpen, setSignedFilesOpen] = useState(false);
  useEffect(() => { setSignedFilesOpen(false); }, [eventId]);
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { isAdmin, employee, canManageModule } = useCurrentEmployee();
  const canEditContractTemplate = Boolean(employee?.is_active && canManageModule('contracts'));
  // Generowanie i przeliczanie umowy wymaga kwot — bez nich zamiast „0 zł” pokazujemy komunikat.
  const blockedWithoutAmounts = () => {
    if (canViewAmounts) return false;
    showSnackbar(CONTRACT_AMOUNTS_REQUIRED, 'error');
    return true;
  };
  const [loading, setLoading] = useState(true);
  const refreshingSourcesRef = useRef(false);
  const [editMode, setEditMode] = useState(false);
  // Podzakładka zakładki Umowa; edycja pól zawsze w „Dane i warunki”.
  const [contractSection, setContractSection] = useState<ContractSection>('content');

  useEffect(() => {
    // Odnośnik z aplikacji na Maca może wskazać podzakładkę (`?tab=contract&contractSection=clauses`).
    const requested = new URLSearchParams(window.location.search).get('contractSection');
    setContractSection(CONTRACT_SECTIONS.find(({ id }) => id === requested)?.id ?? 'content');
    setEditMode(false);
  }, [eventId]);
  useEffect(() => {
    if (editMode) setContractSection('data');
  }, [editMode]);
  const [contractContent, setContractContent] = useState('');
  const [originalTemplate, setOriginalTemplate] = useState('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [editedVariables, setEditedVariables] = useState<Record<string, string>>({});
  const [depositPercentInput, setDepositPercentInput] = useState('');
  const [depositAmountInput, setDepositAmountInput] = useState('');
  const [savingDeposit, setSavingDeposit] = useState(false);
  const [depositDirty, setDepositDirty] = useState(false);
  const [editingDeposit, setEditingDeposit] = useState(false);
  // Ołówek przy nazwie szablonu: wybór innego szablonu (potwierdzenie w oknie „Zmień szablon umowy”).
  const [editingTemplate, setEditingTemplate] = useState(false);
  const readDepositNumber = readContractDepositNumber;
  useEffect(() => {
    setDepositPercentInput(String(readDepositNumber(variables.deposit_percent || '0')));
    setDepositAmountInput(String(readDepositNumber(variables.deposit_amount || '0')));
    setDepositDirty(false);
    setEditingDeposit(false);
  }, [variables.deposit_percent, variables.deposit_amount, eventId]);
  const changeDeposit = (field: 'percent' | 'amount', value: string) => {
    setDepositDirty(true);
    const total = readDepositNumber(variables.budget_brutto || '0');
    const number = readDepositNumber(value);
    if (field === 'percent') {
      setDepositPercentInput(value);
      setDepositAmountInput(value.trim() && Number.isFinite(number) ? String(Math.round(total * number) / 100) : '');
    } else {
      setDepositAmountInput(value);
      setDepositPercentInput(value.trim() && Number.isFinite(number) && total > 0 ? String(Math.round(number / total * 10000) / 100) : '');
    }
  };
  const [variableSearch, setVariableSearch] = useState('');
  const [variableOverrides, setVariableOverrides] = useState<Record<string, string>>({});
  const [clientPartyBase, setClientPartyBase] = useState('');
  const [clientPartySigners, setClientPartySigners] = useState<ContractPartySigner[]>([]);
  const [selectedClientSignerIds, setSelectedClientSignerIds] = useState<string[]>([]);
  const [savedClientSignerIds, setSavedClientSignerIds] = useState<string[]>([]);
  const selectClientSigners = (ids: string[]) => {
    setSelectedClientSignerIds(ids);
    setEditedVariables(current => ({
      ...current,
      client_contract_party_block: clientPartyWithSigners(clientPartyBase, clientPartySigners.filter(person => ids.includes(person.id))),
    }));
  };
  const [contractStatus, setContractStatus] = useState<ContractStatus>('draft');
  const [preflightAcknowledgements, setPreflightAcknowledgements] = useState<{
    context: string;
    keys: string[];
  }>({ context: '', keys: [] });
  const [contractId, setContractId] = useState<string | null>(null);
  const signedFiles = signedFilesState?.contractId === contractId ? signedFilesState.files : [];
  const hasSignedDocument = signedFiles.length > 0;
  const handleSignedFilesChange = useCallback((files: Attachment[]) => {
    if (contractId) setSignedFilesState({ contractId, files });
  }, [contractId]);
  useEffect(() => { onSignedDocumentChange?.(hasSignedDocument); }, [hasSignedDocument, onSignedDocumentChange]);
  useEffect(() => { setDocumentPreviewOpen(false); setSignedFilesOpen(false); }, [contractId, hasSignedDocument]);
  const [contractVersion, setContractVersion] = useState(1);
  const [canChangeTemplate, setCanChangeTemplate] = useState(false);
  const [changingTemplate, setChangingTemplate] = useState(false);
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);
  const changingTemplateRef = useRef(false);
  const [previousContracts, setPreviousContracts] = useState<Array<{
    id: string; title: string; created_at: string; generated_pdf_path: string | null;
  }>>([]);

  useEffect(() => {
    let active = true;
    setCanChangeTemplate(false);
    Promise.all([
      supabase.rpc('can_manage_event_workflows', { p_event_id: eventId }),
      supabase.rpc('crm_contract_permission', { p_action: 'manage' }),
    ]).then(([workflow, permission]) => {
      if (active) setCanChangeTemplate(!workflow.error && !permission.error && !!workflow.data && !!permission.data);
    });
    return () => { active = false; };
  }, [eventId]);
  const [contractLockedAt, setContractLockedAt] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [companySignedAt, setCompanySignedAt] = useState<string | null>(null);
  const deferDocumentPreview = hasSignedDocument || Boolean(contractId && companySignedAt && ['signed_by_client', 'signed_returned', 'cancelled'].includes(contractStatus) && signedFilesState?.contractId !== contractId);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [selectedTemplateName, setSelectedTemplateName] = useState('');
  const [showCancelContractModal, setShowCancelContractModal] = useState(false);
  const [contractCreatedBy, setContractCreatedBy] = useState<string | null>(null);
  const [showSendEmailModal, setShowSendEmailModal] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isPrintingDraft, setIsPrintingDraft] = useState(false);
  const [clientEmail, setClientEmail] = useState('');
  const [clientName, setClientName] = useState('');
  const [statusDates, setStatusDates] = useState<{
    accepted_at?: string;
    issued_at?: string;
    sent_at?: string;
    signed_by_client_at?: string;
    signed_returned_at?: string;
    cancelled_at?: string;
  }>({});
  const [generatedPdfPath, setGeneratedPdfPath] = useState<string | null>(null);
  const [modifiedAfterGeneration, setModifiedAfterGeneration] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [eventCompanyBranding, setEventCompanyBranding] =
    useState<EventCompanyBranding | null>(null);
  const [contractFontFaceCss, setContractFontFaceCss] = useState('');
  const [sourceContractContent, setSourceContractContent] = useState('');
  const [contractSourceOutdated, setContractSourceOutdated] = useState(false);
  const [unplacedClauseCategories, setUnplacedClauseCategories] = useState<string[]>([]);
  const [isAuditingContract, setIsAuditingContract] = useState(false);
  const [isApplyingContractAudit, setIsApplyingContractAudit] = useState(false);
  const [contractAuditReview, setContractAuditReview] =
    useState<ContractAuditReviewState | null>(null);
  const [productClauseConflicts, setProductClauseConflicts] =
    useState<ProductClauseConflict[]>([]);
  const [productClauseSelections, setProductClauseSelections] =
    useState<Record<string, string>>({});
  const [productClauseSelectionDraft, setProductClauseSelectionDraft] =
    useState<Record<string, string>>({});
  const [isApplyingProductClauseSelections, setIsApplyingProductClauseSelections] =
    useState(false);
  const [eventContractClauseItems, setEventContractClauseItems] =
    useState<EventContractClauseItem[]>([]);
  const [showEventContractClauses, setShowEventContractClauses] = useState(false);
  const [isSavingEventContractClauses, setIsSavingEventContractClauses] = useState(false);

  const unresolvedProductClauseConflicts = useMemo(
    () =>
      productClauseConflicts.filter(
        (conflict) => !productClauseSelections[conflict.key],
      ),
    [productClauseConflicts, productClauseSelections],
  );

  const usedContractVariableKeys = useMemo(
    () => eventContractUsedVariableKeys(eventContractClauseItems, originalTemplate, productClauseSelections, variables),
    [eventContractClauseItems, originalTemplate, productClauseSelections, variables],
  );

  /** Warunki szablonu ustawiane w tej umowie: rodzaj klienta i opcje (np. nocleg). */
  const contractConditionSettings = useMemo(() => eventContractConditionSettings(originalTemplate), [originalTemplate]);

  const editableContractVariables = useMemo(
    () => eventContractEditableVariables(usedContractVariableKeys, editedVariables, variableSearch),
    [editedVariables, usedContractVariableKeys, variableSearch],
  );

  const contractAuditSensitiveValues = useMemo(() => {
    const identityKey =
      /(client|organization|contact|representative|executor|seller|customer|company|primary_|legal_)/i;

    return Object.entries(variables)
      .filter(([key]) => identityKey.test(key))
      .flatMap(([, value]) => {
        const plainValue = String(value || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return [plainValue, ...plainValue.split(/[,;|]/g).map((part) => part.trim())];
      })
      .filter((value, index, values) => value.length >= 4 && values.indexOf(value) === index);
  }, [variables]);

  const contractPreflightIssues = useMemo<ContractPreflightIssue[]>(
    () => eventContractPreflightIssues({
      originalTemplate,
      selectedTemplateId,
      unresolvedProductClauseConflicts,
      usedContractVariableKeys,
      variables,
    }),
 [
    originalTemplate,
    selectedTemplateId,
    unresolvedProductClauseConflicts,
    usedContractVariableKeys,
    variables,
  ]);

  // Zgoda jest lokalna dla aktualnego dokumentu i użytkownika, nie wyłącza
  // walidacji globalnie. Zmieniona treść, dane lub uwagi wymagają nowej zgody.
  const preflightAcknowledgementContext = useMemo(() => JSON.stringify([
    eventId,
    employee?.id,
    selectedTemplateId || templateId,
    contractVersion,
    contractContent,
    variables,
    contractPreflightIssues,
  ]), [eventId, employee?.id, selectedTemplateId, templateId, contractVersion,
    contractContent, variables, contractPreflightIssues]);

  const isPreflightIssueAcknowledged = (key: string) =>
    preflightAcknowledgements.context === preflightAcknowledgementContext
    && preflightAcknowledgements.keys.includes(key);

  const acknowledgePreflightIssue = (key: string, checked: boolean) => {
    setPreflightAcknowledgements((current) => {
      const keys = current.context === preflightAcknowledgementContext ? current.keys : [];
      return {
        context: preflightAcknowledgementContext,
        keys: checked ? [...new Set([...keys, key])] : keys.filter((item) => item !== key),
      };
    });
  };

  const ensureContractPreflight = (action: string) => {
    // Uwagi sprawdzamy przy finalizacji szkicu, nie przy dalszej obsłudze
    // dokumentu, który został już wystawiony lub podpisany.
    if (!['draft', 'cancelled'].includes(contractStatus)) return true;
    const blockers = contractPreflightIssues.filter((issue) =>
      issue.severity === 'blocker' && !isPreflightIssueAcknowledged(issue.key));
    if (blockers.length === 0) return true;
    showSnackbar(
      `Przed ${action} uzupełnij dane albo potwierdź zapoznanie się z pozostałymi uwagami (${blockers.length}) nad podglądem umowy.`,
      'error',
    );
    return false;
  };

  useEffect(() => {
    fetchContractData();
    fetchAvailableTemplates();
  }, [eventId]);

  const fetchAvailableTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('contract_templates')
        .select('id, name')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      setAvailableTemplates(data || []);
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  };

  // Składanie umowy — wspólny kod z silnikiem dokumentów na Macu (`src/lib/CRM/contracts/eventContractData.ts`).
  const fetchContractData = (
    clauseSelectionOverride?: Record<string, string>,
    replaceExistingContent = false,
    templateIdOverride?: string,
  ) => fetchEventContractData({
    supabase,
    eventId,
    canViewAmounts,
    variables,
    productClauseSelections,
    showSnackbar,
    setClientEmail,
    setClientName,
    setClientPartyBase,
    setClientPartySigners,
    setCompanySignedAt,
    setContractContent,
    setContractCreatedBy,
    setContractFontFaceCss,
    setContractId,
    setContractLockedAt,
    setContractSourceOutdated,
    setContractStatus,
    setContractVersion,
    setEditedVariables,
    setEventCompanyBranding,
    setEventContractClauseItems,
    setGeneratedPdfPath,
    setLoading,
    setModifiedAfterGeneration,
    setOriginalTemplate,
    setPreviousContracts,
    setProductClauseConflicts,
    setProductClauseSelectionDraft,
    setProductClauseSelections,
    setSavedClientSignerIds,
    setSelectedClientSignerIds,
    setSelectedTemplateId,
    setSelectedTemplateName,
    setSourceContractContent,
    setStatusDates,
    setTemplateId,
    setUnplacedClauseCategories,
    setVariableOverrides,
    setVariables,
  }, clauseSelectionOverride, replaceExistingContent, templateIdOverride);

  const handleSave = async () => {
    if (blockedWithoutAmounts()) return;
    const result = await buildEventContractFieldsUpdate({
      variables,
      editedVariables,
      variableOverrides,
      editableKeys: [...usedContractVariableKeys, ...contractConditionSettings.keys],
      originalTemplate,
      eventContractClauseItems,
      productClauseSelections,
      selectedClientSignerIds,
    });
    setVariables(result.variables);
    setEditedVariables(result.variables);
    if (result.unplacedClauseCategories) setUnplacedClauseCategories(result.unplacedClauseCategories);
    setContractContent(result.contractContent);
    setSavedClientSignerIds(selectedClientSignerIds);
    setVariableOverrides(result.overrides);
    setEditMode(false);
    if (contractStatus !== 'draft' || contractLockedAt) {
      showSnackbar('Dane umowy zostały zaktualizowane', 'success');
      return;
    }
    // Szkic zapisujemy od razu (jak depozyt) — wcześniej zmiany zostawały tylko w tej karcie przeglądarki:
    // znikały po odświeżeniu, a po „Generuj PDF” zapisana treść różniła się od PDF.
    try {
      const id = await ensureContractRecord();
      if (!id) return;
      const { data, error } = await supabase.from('contracts')
        .update({ content: result.contractContent, modified_after_generation: true })
        .eq('id', id).eq('status', 'draft').select('id').single();
      if (error || !data) throw error || new Error('Umowa nie jest już szkicem. Odśwież widok.');
      setModifiedAfterGeneration(true);
      showSnackbar('Dane umowy zostały zapisane', 'success');
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Nie udało się zapisać danych umowy.', 'error');
    }
  };

  const saveDeposit = async () => {
    if (savingDeposit || !canEdit || contractStatus !== 'draft') return;
    const deposit = eventContractDepositPatch(depositPercentInput, depositAmountInput, variables);
    if ('error' in deposit) {
      showSnackbar(deposit.error, 'error');
      return;
    }
    setSavingDeposit(true);
    try {
      const { content, updated, overrides } = await buildEventContractDepositContent({
        patch: deposit.patch,
        variables,
        variableOverrides,
        originalTemplate,
        eventContractClauseItems,
        productClauseSelections,
        selectedClientSignerIds,
      });
      const id = await ensureContractRecord();
      if (!id) throw new Error('Nie udało się utworzyć szkicu umowy.');
      const { data, error } = await supabase.from('contracts').update({ content, modified_after_generation: true }).eq('id', id).eq('status', 'draft').select('id').single();
      if (error || !data) throw error || new Error('Umowa nie jest już szkicem. Odśwież widok.');
      setContractContent(content);
      setVariables(updated);
      setEditedVariables(updated);
      setVariableOverrides(overrides);
      setModifiedAfterGeneration(true);
      setDepositDirty(false);
      setEditingDeposit(false);
      showSnackbar('Zapisano procent i kwotę depozytu.', 'success');
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Nie udało się zapisać depozytu.', 'error');
    } finally { setSavingDeposit(false); }
  };

  const handleCancel = () => {
    setSelectedClientSignerIds(savedClientSignerIds);
    setEditedVariables(variables);
    setEditMode(false);
  };

  const handleTemplateChange = async (newTemplateId: string) => {
    if (!newTemplateId || newTemplateId === selectedTemplateId || changingTemplateRef.current) return;
    if (blockedWithoutAmounts()) return;
    setPendingTemplateId(null);
    changingTemplateRef.current = true;
    setChangingTemplate(true);
    try {
      const templateUpdateResponse = await fetch('/bridge/events/contracts/template', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, templateId: newTemplateId, contractId }),
      });
      const templateUpdateResult = await templateUpdateResponse.json();

      if (!templateUpdateResponse.ok || templateUpdateResult.templateId !== newTemplateId) {
        throw new Error(
          templateUpdateResult.error || 'Nie udało się utrwalić wyboru szablonu.',
        );
      }

      // Zmiana szablonu korzysta z tej samej ścieżki co pierwsze generowanie.
      // Ponownie dobieramy klauzule do pól szablonu i wczytujemy jego wartości domyślne.
      await fetchContractData(undefined, true, newTemplateId);
      setEditMode(false);
      showSnackbar(templateUpdateResult.createdRevision ? 'Utworzono nowy szkic umowy z wybranego szablonu' : 'Zmieniono szablon umowy', 'success');
    } catch (err) {
      console.error('Error changing template:', err);
      showSnackbar(
        err instanceof Error ? err.message : 'Błąd podczas zmiany szablonu',
        'error',
      );
    } finally {
      changingTemplateRef.current = false;
      setChangingTemplate(false);
    }
  };

  const ensureContractRecord = async (): Promise<string | null> => {
    if (contractId) return contractId;
    if (blockedWithoutAmounts()) return null;

    if (!templateId && !selectedTemplateId) {
      showSnackbar('Wybierz szablon umowy', 'error');
      return null;
    }

    try {
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('contact_person_id, organization_id')
        .eq('id', eventId)
        .single();

      if (eventError) throw eventError;

      const clientId = eventData?.contact_person_id || eventData?.organization_id || null;
      const { data: newContract, error: createError } = await supabase
        .from('contracts')
        .insert({
          event_id: eventId,
          client_id: clientId,
          title: `Umowa dla eventu ${eventId}`,
          content: contractContent,
          status: 'draft',
          template_id: selectedTemplateId || templateId,
          created_by: employee?.id || null,
        })
        .select('id')
        .single();

      if (createError) throw createError;
      setContractId(newContract.id);
      return newContract.id;
    } catch (err) {
      console.error('Error creating contract:', err);
      showSnackbar('Błąd podczas tworzenia umowy', 'error');
      return null;
    }
  };

  const handlePrintDraft = async () => {
    if (blockedWithoutAmounts()) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showSnackbar('Zezwól przeglądarce na otwieranie nowych kart', 'error');
      return;
    }

    printWindow.document.write(
      '<html><head><meta charset="utf-8"><title>Przygotowywanie draftu…</title></head>' +
        '<body style="font-family:Arial,sans-serif;padding:40px;color:#333">' +
        'Przygotowywanie wersji roboczej umowy…</body></html>',
    );
    printWindow.document.close();

    try {
      setIsPrintingDraft(true);
      let parsed: any = {};
      try {
        parsed = JSON.parse(contractContent);
      } catch {
        parsed = { flowContent: contractContent, pages: [contractContent], settings: {} };
      }
      const pages = Array.isArray(parsed?.pages) ? parsed.pages : [contractContent];
      const flowContent = parsed?.flowContent || pages.join('');
      const settings = parsed?.settings || {};
      const blob = await createContractDraftPdf({
        id: contractId || eventId,
        name: 'Umowa wydarzenia',
        description: 'Wersja robocza umowy wydarzenia',
        content: flowContent.replace(/<[^>]*>/g, ' ').trim() || 'Umowa wydarzenia',
        content_html: flowContent,
        page_settings: {
          ...settings,
          flowContent,
          pages,
          paginationMode: 'automatic',
        },
        is_active: true,
        created_at: new Date().toISOString(),
      });
      const url = URL.createObjectURL(blob);
      printWindow.location.href = url;
      printWindow.addEventListener('load', () => printWindow.print(), { once: true });
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      printWindow.close();
      console.error('Error printing contract draft:', err);
      showSnackbar(err?.message || 'Nie udało się przygotować draftu umowy', 'error');
    } finally {
      setIsPrintingDraft(false);
    }
  };

  const handleEditContractContent = async () => {
    const currentContractId = await ensureContractRecord();
    const currentTemplateId = selectedTemplateId || templateId;
    if (!currentContractId || !currentTemplateId) return;

    router.push(
      `/crm/contract-templates/${currentTemplateId}/edit-wysiwyg?contractId=${currentContractId}&eventId=${eventId}`,
    );
  };

  const handleRefreshFromOffer = async () => {
    const currentTemplateId = selectedTemplateId || templateId;
    if (!currentTemplateId || !canEdit || refreshingSourcesRef.current) return;
    if (blockedWithoutAmounts()) return;
    refreshingSourcesRef.current = true;
    try {
      if (contractId && !(await showConfirm({
        title: 'Odświeżyć szablon i dane umowy?',
        message: 'Pobierzemy najnowszą wersję użytego szablonu, dane klienta, ofertę i klauzule. Treść umowy zostanie odbudowana. Indywidualne poprawki treści i pól zostaną zastąpione. Kontynuować?',
        confirmText: 'Odśwież umowę',
        cancelText: 'Anuluj',
      }))) return;

      // Read the current template and source data from the database on every click.
      // sourceContractContent is only a snapshot from the previous page load.
      await fetchContractData(undefined, true, currentTemplateId);
      setEditMode(false);
      setContractSourceOutdated(false);
      showSnackbar('Umowa została odświeżona z najnowszego szablonu i danych źródłowych', 'success');
    } catch (err) {
      console.error('Error refreshing contract sources:', err);
      showSnackbar('Nie udało się odświeżyć szablonu i danych umowy', 'error');
    } finally {
      refreshingSourcesRef.current = false;
    }
  };

  const handlePrint = async () => {
    if (blockedWithoutAmounts()) return;
    if (!templateId && !selectedTemplateId) {
      showSnackbar('Wybierz szablon umowy przed wygenerowaniem PDF', 'error');
      return;
    }

    setIsGeneratingPdf(true);
    const currentContractId = await ensureContractRecord();
    if (!currentContractId) {
      setIsGeneratingPdf(false);
      return;
    }

    // 2) PDF na backendzie (Chromium)
    try {
      const contractContainer = document.querySelector(
        '.contract-a4-container',
      ) as HTMLElement | null;
      if (!contractContainer) {
        showSnackbar('Nie znaleziono widoku umowy', 'error');
        return;
      }

      const pagesHtml = contractContainer.innerHTML;

      // jeśli masz zamianę klas licznika stron – zostaw
      const pagesHtmlForPrint = pagesHtml.replace(
        /class="absolute bottom-4[^"]*text-\[#000\]\/50"/g,
        'class="contract-page-counter"',
      );

      const cssText = `${contractFontFaceCss}\n${getContractCssForPrint()}`;

      const res = await fetch('/bridge/events/contracts/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId,
          contractId: currentContractId,
          pagesHtml: pagesHtmlForPrint,
          cssText,
          createdBy: employee?.id ?? null,
          // fileName: `umowa-${eventId}.pdf` // opcjonalnie
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        console.error(json);
        showSnackbar(json?.error || 'Błąd generowania PDF', 'error');
        return;
      }

      // odśwież dane umowy (żeby złapać generated_pdf_path)
      await fetchContractData();

      showSnackbar('PDF umowy został wygenerowany i zapisany w Dokumenty → Umowy', 'success');
    } catch (e) {
      console.error(e);
      showSnackbar('Błąd generowania PDF', 'error');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleShowPdf = async () => {
    if (!generatedPdfPath) return;

    try {
      const { data } = await supabase.storage
        .from('event-files')
        .createSignedUrl(generatedPdfPath, 3600);

      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
      }
    } catch (err) {
      console.error('Error showing PDF:', err);
      showSnackbar('Błąd podczas otwierania PDF', 'error');
    }
  };

  const handleDownloadPdf = async () => {
    if (!generatedPdfPath) return;

    try {
      const { data } = await supabase.storage
        .from('event-files')
        .createSignedUrl(generatedPdfPath, 3600);

      if (data?.signedUrl) {
        const response = await fetch(data.signedUrl);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = generatedPdfPath.split('/').pop() || 'umowa.pdf';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();

        setTimeout(() => {
          document.body.removeChild(link);
          window.URL.revokeObjectURL(blobUrl);
        }, 100);
      }
    } catch (err) {
      console.error('Error downloading PDF:', err);
      showSnackbar('Błąd podczas pobierania PDF', 'error');
    }
  };

  const handleStatusChange = async (newStatus: ContractStatus) => {
    if (contractStatus === 'cancelled' || changingStatus || !(isAdmin || canChangeTemplate) || newStatus === contractStatus) return;
    if (newStatus === 'cancelled') {
      if (!isAdmin || !contractId) {
        showSnackbar('Anulowanie zapisanej umowy wymaga uprawnień administratora.', 'warning');
        return;
      }
      setShowCancelContractModal(true);
      return;
    }
    if (
      !['draft', 'cancelled'].includes(newStatus) &&
      !ensureContractPreflight('zmianą statusu umowy')
    ) {
      return;
    }

    const changesDocumentMode = ['draft', 'cancelled'].includes(contractStatus)
      !== ['draft', 'cancelled'].includes(newStatus);

    setChangingStatus(true);
    try {
      if (!contractId) {
        if (!templateId && !selectedTemplateId) {
          showSnackbar('Wybierz szablon umowy przed zmianą statusu', 'error');
          return;
        }

        const { data: eventData } = await supabase
          .from('events')
          .select('contact_person_id, organization_id')
          .eq('id', eventId)
          .single();

        const clientId = eventData?.contact_person_id || eventData?.organization_id || null;

        const statusDateField = `${newStatus}_at`;
        const insertData: any = {
          event_id: eventId,
          client_id: clientId,
          title: `Umowa dla eventu ${eventId}`,
          content: contractContent,
          status: newStatus,
          template_id: templateId,
        };

        if (newStatus !== 'draft') {
          insertData[statusDateField] = new Date().toISOString();
        }

        insertData.template_id = selectedTemplateId || templateId;

        const { data: newContract, error: createError } = await supabase
          .from('contracts')
          .insert(insertData)
          .select('id')
          .single();

        if (createError) throw createError;
        setContractId(newContract.id);
      } else {
        const statusDateField = `${newStatus}_at`;
        const updateData: any = {
          status: newStatus,
          content: contractContent,
          ...(changesDocumentMode ? { modified_after_generation: true } : {}),
        };

        if (newStatus !== 'draft') {
          updateData[statusDateField] = new Date().toISOString();
        }

        const { error: updateError } = await supabase
          .from('contracts')
          .update(updateData)
          .eq('id', contractId);

        if (updateError) throw updateError;
      }

      setContractStatus(newStatus);
      if (changesDocumentMode) setModifiedAfterGeneration(true);
      await fetchContractData();
      showSnackbar('Status umowy został zaktualizowany', 'success');
    } catch (err) {
      console.error('Error updating contract status:', err);
      showSnackbar('Błąd podczas aktualizacji statusu', 'error');
    } finally {
      setChangingStatus(false);
    }
  };

  const getStatusLabel = (status: ContractStatus) => {
    const labels: Record<ContractStatus, string> = {
      draft: '🟡 Szkic',
      issued: '🟢 Wystawiona',
      sent: '📤 Wysłana',
      accepted: 'Zaakceptowana',
      signed_by_client: '✍️ Podpisana przez klienta',
      signed_returned: '✅ Podpisana odesłana',
      cancelled: '❌ Anulowana',
    };
    return labels[status];
  };

  const getStatusDate = (status: ContractStatus) => {
    const dateMap: Record<ContractStatus, string | undefined> = {
      draft: undefined,
      issued: statusDates.issued_at,
      sent: statusDates.sent_at,
      accepted: statusDates.accepted_at,
      signed_by_client: statusDates.signed_by_client_at,
      signed_returned: statusDates.signed_returned_at,
      cancelled: statusDates.cancelled_at,
    };
    const date = dateMap[status];
    if (!date) return '';
    return new Date(date).toLocaleDateString('pl-PL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const canEdit = useMemo(() => {
    if (contractStatus === 'cancelled') return false;
    if (contractLockedAt) return false;
    if (isAdmin) return true;
    return contractStatus === 'draft' || contractStatus === 'cancelled';
  }, [contractLockedAt, isAdmin, contractStatus]);

  const isWorkingDraft = contractStatus === 'draft';

  const canSendEmail = useMemo(() => {
    if (contractStatus === 'cancelled') return false;
    if (!contractId) return false;
    if (isAdmin) return true;
    if (employee?.id && contractCreatedBy === employee.id) return true;
    return false;
  }, [isAdmin, employee, contractId, contractCreatedBy, contractStatus]);

  const confirmCompanySignature = async () => {
    if (!contractId || !employee?.id) return;
    const signedAt = new Date().toISOString();
    const { error } = await supabase
      .from('contracts')
      .update({ company_signed_at: signedAt, company_signed_by: employee.id })
      .eq('id', contractId);

    if (error) {
      showSnackbar(`Nie udało się potwierdzić podpisu firmy: ${error.message}`, 'error');
      return;
    }
    setCompanySignedAt(signedAt);
    showSnackbar('Podpis firmy został potwierdzony', 'success');
  };

  const handleApplyProductClauseSelections = async () => {
    if (blockedWithoutAmounts()) return;
    const unresolved = productClauseConflicts.filter(
      (conflict) => !productClauseSelectionDraft[conflict.key],
    );
    if (unresolved.length > 0) {
      showSnackbar(
        `Wybierz wersję dla wszystkich rozbieżnych wspólnych ustaleń (${unresolved.length}).`,
        'warning',
      );
      return;
    }
    if (
      contractId &&
      !(await showConfirm({
        title: 'Zastosować wybór klauzul?',
        message: 'Zastosowanie wyborów odbuduje draft z aktualnego szablonu, oferty i klauzul produktów. Indywidualne poprawki treści mogą zostać zastąpione. Kontynuować?',
        confirmText: 'Zastosuj wybór',
        cancelText: 'Anuluj',
      }))
    ) {
      return;
    }

    try {
      setIsApplyingProductClauseSelections(true);
      await fetchContractData(productClauseSelectionDraft, true);
      showSnackbar('Wybory klauzul zostały zastosowane do umowy', 'success');
    } catch (error) {
      console.error('Error applying product clause selections:', error);
      showSnackbar('Nie udało się zastosować wyborów klauzul', 'error');
    } finally {
      setIsApplyingProductClauseSelections(false);
    }
  };

  const handleSaveEventContractClauses = async (items: EventContractClauseItem[]) => {
    if (blockedWithoutAmounts()) return;
    let hasIndividualEdits = modifiedAfterGeneration;
    try {
      const parsedContract = JSON.parse(contractContent);
      hasIndividualEdits = hasIndividualEdits || parsedContract?.meta?.individuallyEdited === true;
    } catch {
      // Starsza treść umowy bez metadanych nie wymaga dodatkowego ostrzeżenia.
    }

    if (
      contractId &&
      hasIndividualEdits &&
      !(await showConfirm({
        title: 'Zapisać klauzule umowy?',
        message: 'Zapisanie klauzul odbuduje draft z aktualnego szablonu i oferty. Indywidualne poprawki naniesione bezpośrednio w treści umowy mogą zostać zastąpione. Kontynuować?',
        confirmText: 'Zapisz klauzule',
        cancelText: 'Anuluj',
      }))
    ) {
      return;
    }

    try {
      setIsSavingEventContractClauses(true);
      const clauseOverrides = serializeEventContractClauseItems(items);
      const { error } = await supabase
        .from('events')
        .update({ contract_clause_overrides: clauseOverrides })
        .eq('id', eventId);
      if (error) {
        if (['42703', 'PGRST204'].includes(error.code || '')) {
          throw new Error(
            'Brakuje pola klauzul wydarzenia w bazie. Uruchom najnowszą migrację Supabase i spróbuj ponownie.',
          );
        }
        throw error;
      }

      setShowEventContractClauses(false);
      await fetchContractData(undefined, true);
      showSnackbar('Klauzule tej umowy zostały zapisane', 'success');
    } catch (error) {
      console.error('Error saving event contract clauses:', error);
      showSnackbar(
        error instanceof Error ? error.message : 'Nie udało się zapisać klauzul umowy',
        'error',
      );
    } finally {
      setIsSavingEventContractClauses(false);
    }
  };

  const handleStartContractAudit = async () => {
    if (!isWorkingDraft) {
      showSnackbar('Audyt AI można zastosować wyłącznie do wersji roboczej umowy', 'warning');
      return;
    }
    if (!contractContent) {
      showSnackbar('Brak treści umowy do audytu', 'warning');
      return;
    }

    const allBlocks = extractContractAuditBlocks(
      contractContent,
      contractAuditSensitiveValues,
    );
    const auditBlocks = allBlocks.filter((block) => !block.protected);
    if (auditBlocks.length < 2) {
      showSnackbar('Po wyłączeniu danych stron pozostało za mało treści do audytu', 'warning');
      return;
    }

    try {
      setIsAuditingContract(true);
      const { data, error } = await supabase.functions.invoke('audit-contract', {
        body: {
          eventId,
          contractId,
          blocks: auditBlocks.map(({ protected: _protected, ...block }) => block),
        },
      });

      if (error) {
        throw new Error((data as { error?: string } | null)?.error || error.message);
      }
      const audit = (data as { result?: ContractAuditResult } | null)?.result;
      if (!audit) throw new Error('Asystent nie zwrócił wyniku audytu');

      setContractAuditReview({
        audit,
        blocks: allBlocks,
        sourceContent: contractContent,
      });
    } catch (err) {
      console.error('Error auditing contract:', err);
      showSnackbar(
        err instanceof Error ? err.message : 'Nie udało się przeprowadzić audytu umowy',
        'error',
      );
    } finally {
      setIsAuditingContract(false);
    }
  };

  const handleApplyContractAudit = async (selections: Record<string, string>) => {
    if (!contractAuditReview) return;
    if (contractAuditReview.sourceContent !== contractContent) {
      showSnackbar('Treść umowy zmieniła się od audytu. Uruchom audyt ponownie.', 'warning');
      setContractAuditReview(null);
      return;
    }

    try {
      setIsApplyingContractAudit(true);
      const applied = applyContractAuditDecisions(
        contractContent,
        contractAuditReview.audit,
        selections,
        contractAuditSensitiveValues,
      );
      if (applied.removed === 0 && applied.changed === 0) {
        setContractAuditReview(null);
        showSnackbar('Nie wybrano zmian do zastosowania', 'info');
        return;
      }

      const currentContractId = await ensureContractRecord();
      if (!currentContractId) return;

      const parts = getContractDocumentParts(contractContent);
      const renderedContract = await renderContractDocument(
        applied.flowContent,
        parts.settings,
      );
      const auditedContent = JSON.stringify({
        ...parts.parsed,
        ...renderedContract,
        meta: {
          ...(parts.parsed.meta || {}),
          individuallyEdited: true,
          editSource: 'ai-audit',
          lastAiAuditAt: contractAuditReview.audit.generatedAt || new Date().toISOString(),
          lastAiAuditModel: contractAuditReview.audit.model || null,
        },
      });

      const { error } = await supabase
        .from('contracts')
        .update({
          content: auditedContent,
          modified_after_generation: true,
        })
        .eq('id', currentContractId);
      if (error) throw error;

      setContractContent(auditedContent);
      setModifiedAfterGeneration(true);
      setContractAuditReview(null);
      showSnackbar(
        `Audyt zastosowany: usunięto ${applied.removed}, poprawiono ${applied.changed} fragmentów`,
        'success',
      );
    } catch (err) {
      console.error('Error applying contract audit:', err);
      showSnackbar(
        err instanceof Error ? err.message : 'Nie udało się zastosować audytu',
        'error',
      );
    } finally {
      setIsApplyingContractAudit(false);
    }
  };

  const actions = useMemo(() => {
    const cancelAction = isAdmin && contractId && contractStatus !== 'cancelled' ? [{
      label: 'Anuluj umowę',
      onClick: () => setShowCancelContractModal(true),
      icon: <X className="h-4 w-4" />,
      variant: 'danger' as const,
      disabled: isGeneratingPdf || isPrintingDraft,
    }] : [];
    if (hasSignedDocument && contractId && !editMode) {
      const endpoint = `/bridge/events/contracts/signed-files?contractId=${encodeURIComponent(contractId)}&fileId=${encodeURIComponent(signedFiles[0].id)}`;
      return [
        { label: 'Otwórz podpisaną umowę', onClick: () => { window.open(endpoint, '_blank', 'noopener,noreferrer'); }, icon: <Eye className="h-4 w-4" />, variant: 'primary' as const, pin: true },
        { label: 'Pobierz podpisaną umowę', onClick: () => { window.open(`${endpoint}&download=1`, '_blank', 'noopener,noreferrer'); }, icon: <Download className="h-4 w-4" />, variant: 'default' as const, pin: true },
        { label: documentPreviewOpen ? 'Zwiń podgląd treści umowy' : 'Rozwiń podgląd treści umowy', onClick: () => setDocumentPreviewOpen(open => !open), icon: <ChevronDown className="h-4 w-4" />, variant: 'default' as const },
        { label: contractStatus === 'cancelled' ? 'Archiwum podpisanych dokumentów' : 'Zarządzaj podpisanymi dokumentami', onClick: () => { setContractSection('documents'); setSignedFilesOpen(true); }, icon: <FileText className="h-4 w-4" />, variant: 'default' as const },
        ...cancelAction,
      ];
    }
    if (contractStatus === 'cancelled') {
      return generatedPdfPath ? [
        {
          label: 'Pokaż archiwalny PDF',
          onClick: handleShowPdf,
          icon: <Eye className="h-4 w-4" />,
          variant: 'primary' as const,
          pin: true,
        },
        {
          label: 'Pobierz archiwalny PDF',
          onClick: handleDownloadPdf,
          icon: <Download className="h-4 w-4" />,
          variant: 'default' as const,
        },
      ] : [];
    }
    if (editMode) {
      return [
        {
          label: 'Anuluj',
          onClick: handleCancel,
          icon: <X className="h-4 w-4" />,
          variant: 'default' as const,
        },
        {
          label: 'Zapisz',
          onClick: handleSave,
          icon: <Save className="h-4 w-4" />,
          variant: 'primary' as const,
        },
      ];
    }

    const baseActions: Array<{
      label: string;
      onClick: () => void;
      icon: React.ReactNode;
      variant: 'default' | 'primary' | 'danger';
      disabled?: boolean;
      pin?: boolean;
    }> = [];

    if (isWorkingDraft) baseActions.push({
      label: isPrintingDraft ? 'Przygotowywanie…' : 'Drukuj draft',
      onClick: handlePrintDraft,
      icon: isPrintingDraft ? (
        <Loader className="h-4 w-4 animate-spin" />
      ) : (
        <Printer className="h-4 w-4" />
      ),
      variant: 'default' as const,
      disabled: isPrintingDraft,
    });

    if (!generatedPdfPath || modifiedAfterGeneration) {
      baseActions.push({
        label: modifiedAfterGeneration
          ? isWorkingDraft
            ? 'Regeneruj PDF draftu'
            : 'Regeneruj PDF'
          : isWorkingDraft
            ? 'Generuj PDF draftu'
            : 'Generuj PDF',
        onClick: handlePrint,
        icon: <Download className="h-4 w-4" />,
        variant: 'primary' as const,
        pin: true,
      });
    } else {
      baseActions.push(
        {
          label: isWorkingDraft ? 'Pokaż PDF draftu' : 'Pokaż / drukuj umowę',
          onClick: handleShowPdf,
          icon: <Eye className="h-4 w-4" />,
          variant: 'primary' as const,
          pin: true,
        },
        {
          label: 'Pobierz PDF',
          onClick: handleDownloadPdf,
          icon: <Download className="h-4 w-4" />,
          variant: 'default' as const,
        },
      );
    }

    if (canSendEmail) {
      baseActions.unshift({
        label: isWorkingDraft ? 'Wyślij draft' : 'Wyślij umowę',
        onClick: () => {
          if (isWorkingDraft || ensureContractPreflight('wysłaniem finalnej umowy')) {
            setShowSendEmailModal(true);
          }
        },
        icon: <Mail className="h-4 w-4" />,
        variant: 'default' as const,
        pin: true,
      });
    }

    if (canEdit && isWorkingDraft) {
      baseActions.unshift({
        label: isAuditingContract ? 'Audytowanie…' : 'Audyt AI',
        onClick: handleStartContractAudit,
        icon: isAuditingContract ? (
          <Loader className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        ),
        variant: 'default' as const,
        disabled: isAuditingContract,
      });
    }

    if (canEdit) {
      baseActions.unshift(
        {
          label: contractSourceOutdated ? 'Dane zmienione — odśwież szablon i dane' : 'Odśwież szablon i dane',
          onClick: handleRefreshFromOffer,
          icon: <RefreshCw className="h-4 w-4" />,
          variant: contractSourceOutdated ? ('primary' as const) : ('default' as const),
          disabled: loading || !(selectedTemplateId || templateId),
          // Nieaktualne dane — przycisk na wierzchu, nie w menu.
          pin: contractSourceOutdated,
        },
        {
          label: 'Zarządzaj klauzulami',
          onClick: () => { setContractSection('clauses'); setShowEventContractClauses(true); },
          icon: <ListChecks className="h-4 w-4" />,
          variant: 'default' as const,
        },
        {
          label: 'Edytuj treść umowy',
          onClick: handleEditContractContent,
          icon: <FilePenLine className="h-4 w-4" />,
          variant: 'default' as const,
          pin: true,
        },
        {
          label: 'Edytuj informacje podstawowe',
          onClick: () => setEditMode(true),
          icon: <Edit className="h-4 w-4" />,
          variant: 'default' as const,
        },
      );
    }

    if (canChangeTemplate && contractStatus !== 'cancelled' && availableTemplates.length > 1) {
      baseActions.push({
        label: 'Zmień szablon umowy',
        onClick: () => setEditingTemplate(true),
        icon: <FileText className="h-4 w-4" />,
        variant: 'default' as const,
        disabled: changingTemplate || isGeneratingPdf,
      });
    }
    baseActions.push(...cancelAction);

    return baseActions;
  }, [
    hasSignedDocument, signedFiles, documentPreviewOpen, isAdmin,
    canChangeTemplate, availableTemplates.length, changingTemplate,
    editMode,
    canEdit,
    canSendEmail,
    generatedPdfPath,
    modifiedAfterGeneration,
    contractId,
    handleCancel,
    handleSave,
    handlePrint,
    handleShowPdf,
    handleDownloadPdf,
    handleStartContractAudit,
    isGeneratingPdf,
    isPrintingDraft,
    isAuditingContract,
    contractSourceOutdated,
    sourceContractContent,
    contractPreflightIssues,
    preflightAcknowledgements,
    preflightAcknowledgementContext,
    contractStatus,
    isWorkingDraft,
  ]);

  if (loading) {
    return (
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
        <div className="text-center text-[#e5e4e2]/60">Ładowanie danych umowy...</div>
      </div>
    );
  }

  if (!selectedTemplateId) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8">
          <div className="text-center">
            <FileText className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
            <h3 className="mb-2 text-xl text-[#e5e4e2]">Wybierz szablon umowy</h3>
            <p className="mb-6 text-[#e5e4e2]/60">
              Dla tej kategorii wydarzenia nie został przypisany domyślny szablon. Wybierz szablon z listy poniżej.
            </p>

            {availableTemplates.length > 0 ? (
              <div className="mx-auto max-w-md">
                <select
                  value=""
                  onChange={(e) => void handleTemplateChange(e.target.value)}
                  className="w-full cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-sm text-[#e5e4e2] transition-all hover:border-[#d3bb73]/40 focus:outline-none focus:ring-2 focus:ring-[#d3bb73]"
                >
                  <option value="" disabled className="bg-[#1c1f33] text-[#e5e4e2]/50">
                    Wybierz szablon...
                  </option>
                  {availableTemplates.map((t) => (
                    <option key={t.id} value={t.id} className="bg-[#1c1f33] text-[#e5e4e2]">
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-sm text-[#e5e4e2]/40">
                Brak aktywnych szablonów umów.{' '}
                <a href="/crm/event-categories" className="text-[#d3bb73] hover:underline">
                  Dodaj szablony
                </a>
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const canChangeContractStatus = (isAdmin || canChangeTemplate) && contractStatus !== 'cancelled';
  const isContractStatusDisabled = (status: ContractStatus) =>
    (Boolean(contractLockedAt) && ['draft', 'issued', 'sent', 'accepted'].includes(status)) ||
    (!isAdmin && ((status === 'cancelled' && contractStatus !== 'cancelled') || (status === 'draft' && contractStatus !== 'draft')));
  const nextContractStatus = contractStatus === 'cancelled'
    ? null
    : CONTRACT_STATUS_FLOW[CONTRACT_STATUS_FLOW.indexOf(contractStatus) + 1] || null;
  const contractAlerts: Array<{ key: string; label: string; section: ContractSection }> = [
    ...(isWorkingDraft && contractPreflightIssues.length > 0
      ? [{ key: 'preflight', label: `uwagi przed wystawieniem: ${contractPreflightIssues.length}`, section: 'review' as const }]
      : []),
    ...(isWorkingDraft && unresolvedProductClauseConflicts.length > 0
      ? [{ key: 'conflicts', label: `rozbieżne wersje wspólnych ustaleń: ${unresolvedProductClauseConflicts.length}`, section: 'clauses' as const }]
      : []),
    ...(contractSourceOutdated ? [{ key: 'outdated', label: 'dane wydarzenia lub oferta zmieniły się — odśwież', section: 'review' as const }] : []),
  ];
  const contractSectionBadges: Partial<Record<ContractSection, { count: number; warn?: boolean }>> = {
    clauses: isWorkingDraft && unresolvedProductClauseConflicts.length > 0
      ? { count: unresolvedProductClauseConflicts.length, warn: true }
      : { count: eventContractClauseItems.filter((item) => item.enabled).length },
    review: { count: (isWorkingDraft ? contractPreflightIssues.length : 0) + (contractSourceOutdated ? 1 : 0), warn: true },
    documents: { count: signedFiles.length + previousContracts.length },
  };
  let contentIndividuallyEdited = false;
  try {
    contentIndividuallyEdited = JSON.parse(contractContent)?.meta?.individuallyEdited === true;
  } catch {
    contentIndividuallyEdited = false;
  }
  const contractConditionsSummary = [
    ...(contractConditionSettings.client
      ? [`Klient: ${variables[CONTRACT_CLIENT_VARIABLE] === 'firma' ? 'firma' : 'osoba prywatna'}`]
      : []),
    ...contractConditionSettings.options.map((option) =>
      `${option.label}: ${variables[contractOptionVariable(option.key)] ? 'tak' : 'nie'}`),
  ].join(' · ');

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: getContractDocumentCss() }} />
      <div className="space-y-6">
        {!canViewAmounts && (
          <div role="status" className="no-print rounded-xl bg-amber-400/10 p-4 text-sm text-amber-100">
            {CONTRACT_AMOUNTS_REQUIRED} Podgląd może pokazywać niepełne kwoty — generowanie i przeliczanie umowy jest
            zablokowane.
          </div>
        )}
        <div className="no-print rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 md:p-6">
          <div className="mb-5 flex flex-col gap-4 md:mb-6 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h2 className="text-xl font-light leading-tight text-[#e5e4e2] md:text-2xl">
                Umowa na realizację wydarzenia
              </h2>
              <p className="mt-1 text-sm text-[#e5e4e2]/50">
                {contractStatus === 'cancelled'
                  ? 'Umowa anulowana. Zachowano jej treść, PDF i historię. Zapisany PDF jest dokumentem archiwalnym.'
                  : isWorkingDraft
                  ? 'Podgląd uwzględnia dane wydarzenia, ofertę i klauzule produktów. Aby wystawić finalną umowę, sprawdź uwagi i wybierz status „Wystawiona”.'
                  : 'Umowa finalna. Generowany PDF i wysyłka dotyczą umowy, nie wersji roboczej.'}
              </p>
              {selectedTemplateName && (
                <p className="mt-2 text-xs text-[#e5e4e2]/55">
                  Szablon umowy:{' '}
                  {editingTemplate && canChangeTemplate && contractStatus !== 'cancelled' && availableTemplates.length > 0 ? (
                    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                      <select
                        autoFocus
                        aria-label="Wybierz szablon umowy"
                        value={selectedTemplateId || ''}
                        disabled={changingTemplate || isGeneratingPdf || editMode}
                        onChange={(e) => {
                          if (e.target.value && e.target.value !== selectedTemplateId) setPendingTemplateId(e.target.value);
                          setEditingTemplate(false);
                        }}
                        onKeyDown={(e) => { if (e.key === 'Escape') setEditingTemplate(false); }}
                        className="max-w-[min(22rem,70vw)] cursor-pointer rounded bg-black/20 px-2 py-1 text-xs text-[#e5e4e2] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#d3bb73]/50"
                      >
                        {availableTemplates.map((template) => (
                          <option key={template.id} value={template.id} className="bg-[#351020] text-[#e5e4e2]">
                            {template.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" title="Anuluj zmianę szablonu" aria-label="Anuluj zmianę szablonu" onClick={() => setEditingTemplate(false)} className="rounded p-1 hover:bg-white/5"><X className="h-4 w-4" /></button>
                    </span>
                  ) : (
                    <>
                      {canEditContractTemplate && selectedTemplateId ? (
                        <Link
                          href={`/crm/contract-templates/${selectedTemplateId}/edit-wysiwyg`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Edytuj szablon umowy w edytorze WYSIWYG (nowa karta)"
                          className="rounded-sm font-medium text-[#d3bb73] underline decoration-[#d3bb73]/30 underline-offset-4 transition-colors hover:decoration-[#d3bb73] focus-visible:bg-[#d3bb73]/10 focus-visible:outline-none"
                        >
                          {selectedTemplateName}
                        </Link>
                      ) : (
                        <span className="font-medium text-[#d3bb73]">{selectedTemplateName}</span>
                      )}
                      {canChangeTemplate && contractStatus !== 'cancelled' && availableTemplates.length > 1 && (
                        <button
                          type="button"
                          title="Zmień szablon umowy"
                          aria-label="Zmień szablon umowy"
                          disabled={changingTemplate || isGeneratingPdf || editMode}
                          onClick={() => setEditingTemplate(true)}
                          className="ml-1 rounded p-1 align-middle text-[#d3bb73] hover:bg-white/5 disabled:opacity-50"
                        >
                          {changingTemplate ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      {canEditContractTemplate && selectedTemplateId && (
                        <Link
                          href={`/crm/contract-templates/${selectedTemplateId}/edit-wysiwyg`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Edytuj treść szablonu (nowa karta)"
                          aria-label="Edytuj treść szablonu (nowa karta)"
                          className="inline-flex rounded p-1 align-middle text-[#d3bb73]/70 hover:bg-white/5 hover:text-[#d3bb73]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </>
                  )}
                  {variables.deposit_percent && (
                    <span className="ml-3 inline-flex flex-wrap items-center gap-2 align-middle text-[#e5e4e2]/70">
                      <span aria-hidden="true">·</span>
                      <span>Zaliczka / depozyt:</span>
                      {editingDeposit && canEdit && isWorkingDraft ? (
                        <>
                          <label className="inline-flex items-center gap-1">
                            <input autoFocus aria-label="Procent depozytu" inputMode="decimal" value={depositPercentInput} disabled={savingDeposit || editMode} onChange={e => changeDeposit('percent', e.target.value)} className="w-20 rounded bg-black/20 px-2 py-1 text-xs text-[#e5e4e2]" /> %
                          </label>
                          <label className="inline-flex items-center gap-1">
                            <input aria-label="Kwota depozytu brutto" inputMode="decimal" value={depositAmountInput} disabled={savingDeposit || editMode} onChange={e => changeDeposit('amount', e.target.value)} className="w-28 rounded bg-black/20 px-2 py-1 text-xs text-[#e5e4e2]" /> zł brutto
                          </label>
                          <button type="button" title="Zapisz depozyt" aria-label="Zapisz depozyt" disabled={savingDeposit || editMode || !depositDirty} onClick={() => void saveDeposit()} className="rounded p-1 text-[#d3bb73] hover:bg-white/5 disabled:opacity-50">
                            {savingDeposit ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          </button>
                          <button type="button" title="Anuluj edycję depozytu" aria-label="Anuluj edycję depozytu" disabled={savingDeposit} onClick={() => {
                            setDepositPercentInput(String(readDepositNumber(variables.deposit_percent || '0')));
                            setDepositAmountInput(String(readDepositNumber(variables.deposit_amount || '0')));
                            setDepositDirty(false);
                            setEditingDeposit(false);
                          }} className="rounded p-1 hover:bg-white/5 disabled:opacity-50"><X className="h-4 w-4" /></button>
                        </>
                      ) : (
                        <>
                          <span>{variables.deposit_percent}{variables.deposit_amount ? ` (${variables.deposit_amount} brutto)` : ''}</span>
                          {canEdit && isWorkingDraft && <button type="button" title="Edytuj depozyt" aria-label="Edytuj depozyt" disabled={editMode} onClick={() => setEditingDeposit(true)} className="rounded p-1 text-[#d3bb73] hover:bg-white/5 disabled:opacity-50"><Pencil className="h-3.5 w-3.5" /></button>}
                        </>
                      )}
                    </span>
                  )}
                </p>
              )}
            </div>

            <div className="flex shrink-0 justify-start md:justify-end">
              {isGeneratingPdf ? (
                <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 md:w-auto">
                  <Loader className="h-4 w-4 animate-spin text-[#d3bb73]" />
                  <span className="text-sm text-[#e5e4e2]/60">Generowanie PDF...</span>
                </div>
              ) : (
                <ResponsiveActionBar actions={actions} />
              )}
            </div>
          </div>

          {/* Status jako ścieżka: kliknięcie zmienia status (te same reguły co dotąd), przycisk — następny krok. */}
          <nav aria-label="Status umowy" className="flex flex-wrap items-center gap-x-1 gap-y-2">
            {contractStatus === 'cancelled' ? (
              <span className="rounded-full bg-red-400/10 px-3 py-1.5 text-xs font-medium text-red-200">{getStatusLabel('cancelled')}</span>
            ) : CONTRACT_STATUS_FLOW.map((status, index) => {
              const currentIndex = CONTRACT_STATUS_FLOW.indexOf(contractStatus);
              const current = status === contractStatus;
              const clickable = canChangeContractStatus && !current && !isContractStatusDisabled(status) && !changingStatus && !loading && !isGeneratingPdf;
              return (
                <Fragment key={status}>
                  {index > 0 && <span aria-hidden="true" className="h-px w-3 bg-white/15 md:w-5" />}
                  <button
                    type="button"
                    disabled={!clickable}
                    aria-current={current ? 'step' : undefined}
                    title={clickable ? `Zmień status na „${getStatusLabel(status)}”` : undefined}
                    onClick={() => void handleStatusChange(status)}
                    className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                      current
                        ? 'bg-[#d3bb73] font-medium text-[#1c1f33]'
                        : index < currentIndex
                          ? 'border border-[#d3bb73]/30 text-[#d3bb73]/80'
                          : 'border border-white/15 text-[#e5e4e2]/60'
                    } ${clickable ? 'hover:border-[#d3bb73]/60 hover:text-[#e5e4e2]' : 'cursor-default'}`}
                  >
                    {getStatusLabel(status)}
                  </button>
                </Fragment>
              );
            })}
            <span className="ml-2 whitespace-nowrap rounded-full bg-[#d3bb73]/10 px-2.5 py-1 text-xs text-[#d3bb73]">Wersja {contractVersion}</span>
            {contractLockedAt && <span className="rounded-full bg-green-500/10 px-2.5 py-1 text-xs text-green-300">Zablokowana po podpisaniu</span>}
            {companySignedAt && <span className="rounded-full bg-[#d3bb73]/10 px-2.5 py-1 text-xs text-[#d3bb73]">Podpis firmy potwierdzony</span>}
            {getStatusDate(contractStatus) && <span className="text-xs text-[#e5e4e2]/55" title="Data zmiany statusu">{getStatusDate(contractStatus)}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {isAdmin && contractId && contractStatus !== 'cancelled' && !companySignedAt && contractStatus !== 'draft' && (
                <button type="button" onClick={confirmCompanySignature} className="rounded-lg bg-[#d3bb73]/10 px-3 py-1.5 text-xs font-medium text-[#d3bb73] hover:bg-[#d3bb73]/15">
                  Potwierdź podpis firmy
                </button>
              )}
              {nextContractStatus && canChangeContractStatus && !isContractStatusDisabled(nextContractStatus) && (
                <button
                  type="button"
                  disabled={changingStatus || loading || isGeneratingPdf}
                  onClick={() => void handleStatusChange(nextContractStatus)}
                  className="rounded-lg bg-[#d3bb73]/15 px-3 py-1.5 text-xs font-medium text-[#d3bb73] hover:bg-[#d3bb73]/25 disabled:opacity-50"
                >
                  {NEXT_STATUS_ACTION[nextContractStatus]} →
                </button>
              )}
            </span>
          </nav>

          {/* Uwagi zawsze na wierzchu — wcześniej ukryte pod „Pokaż ustawienia umowy”. */}
          {contractAlerts.length > 0 && (
            <div role="status" className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              <span className="flex items-center gap-1 font-semibold text-amber-200"><ShieldAlert className="h-4 w-4" /> Do sprawdzenia:</span>
              {contractAlerts.map((alert) => (
                <button key={alert.key} type="button" onClick={() => setContractSection(alert.section)} className="rounded-full bg-black/20 px-2.5 py-1 hover:bg-black/30">
                  {alert.label}
                </button>
              ))}
            </div>
          )}

          <div role="tablist" aria-label="Sekcje umowy" className="-mb-4 mt-5 flex gap-1 overflow-x-auto border-b border-white/10 text-sm md:-mb-6">
            {CONTRACT_SECTIONS.map(({ id, label }) => {
              const badge = contractSectionBadges[id];
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={contractSection === id}
                  onClick={() => setContractSection(id)}
                  className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 transition-colors ${
                    contractSection === id ? 'border-[#d3bb73] text-[#d3bb73]' : 'border-transparent text-[#e5e4e2]/65 hover:text-[#e5e4e2]'
                  }`}
                >
                  {label}
                  {badge && badge.count > 0 && (
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${badge.warn ? 'bg-amber-400/20 text-amber-200' : 'bg-white/10 text-[#e5e4e2]/70'}`}>
                      {badge.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {contractSection === 'content' && (<>
          <div className="no-print grid gap-3 text-xs text-[#e5e4e2]/70 md:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-[#1c1f33] p-3">
              <div className="mb-1 font-medium text-[#e5e4e2]">Treść umowy</div>
              {contentIndividuallyEdited ? 'Zmieniona indywidualnie dla tego wydarzenia.' : 'Wygenerowana z szablonu, danych wydarzenia i oferty.'}
            </div>
            <div className="rounded-lg border border-[#a083dc]/25 bg-[#a083dc]/5 p-3">
              <div className="mb-1 font-medium text-[#e5e4e2]">Warunki umowy</div>
              {contractConditionsSummary || 'Szablon nie ma warunków do wyboru.'}
              {contractConditionsSummary && canEdit && isWorkingDraft && (
                <button type="button" onClick={() => setContractSection('data')} className="mt-1 block text-[#d3bb73] hover:underline">Zmień w „Dane i warunki”</button>
              )}
            </div>
            <div className="rounded-lg border border-white/10 bg-[#1c1f33] p-3">
              <div className="mb-1 font-medium text-[#e5e4e2]">PDF</div>
              {!generatedPdfPath ? 'Jeszcze nie wygenerowany.' : modifiedAfterGeneration ? 'Treść zmieniła się po wygenerowaniu — wygeneruj ponownie.' : 'Aktualny.'}
            </div>
          </div>
        {deferDocumentPreview && (
          <button type="button" aria-expanded={documentPreviewOpen} aria-controls="contract-document-preview" onClick={() => setDocumentPreviewOpen(open => !open)} className="no-print flex w-full items-center justify-between rounded-lg bg-white/[0.03] px-4 py-3 text-sm text-[#e5e4e2]/70 hover:bg-white/5">
            Podgląd treści umowy
            <ChevronDown className={`h-4 w-4 transition-transform ${documentPreviewOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
        {(!deferDocumentPreview || documentPreviewOpen) && <div id="contract-document-preview" className="contract-a4-container">
          <ContractPagesView contractContent={contractContent} />
        </div>}
        </>)}

        {contractSection === 'data' && (
          <>
          <div className="no-print space-y-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 md:p-6">
          {clientPartyBase && usedContractVariableKeys.has('client_contract_party_block') && (
            <section className="mb-4 rounded-lg bg-black/15 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium text-[#e5e4e2]">Dane klienta i osoby podpisujące umowę</h3>
                {canEdit && isWorkingDraft && employee?.is_active && !editMode && (
                  <button type="button" onClick={() => setEditMode(true)} className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]">Edytuj dane i wybierz osoby</button>
                )}
              </div>
              {editMode && canEdit && isWorkingDraft && (
                <div className="my-3 space-y-2">
                  {clientPartySigners.length > 0 ? <>
                    <label className="flex items-center gap-2 text-sm text-[#d3bb73]">
                      <input type="checkbox" className="accent-[#d3bb73]"
                        checked={clientPartySigners.every(person => selectedClientSignerIds.includes(person.id))}
                        onChange={event => selectClientSigners(event.target.checked ? clientPartySigners.map(person => person.id) : [])} />
                      Uwzględnij wszystkie osoby uprawnione
                    </label>
                    {clientPartySigners.map(person => (
                      <label key={person.id} className="flex items-start gap-2 text-sm text-[#e5e4e2]/80">
                        <input type="checkbox" className="mt-1 accent-[#d3bb73]"
                          checked={selectedClientSignerIds.includes(person.id)}
                          onChange={event => selectClientSigners(event.target.checked ? [...selectedClientSignerIds, person.id] : selectedClientSignerIds.filter(id => id !== person.id))} />
                        <span>{person.fullName}{person.title && <span className="text-[#e5e4e2]/50"> — {person.title}</span>}</span>
                      </label>
                    ))}
                  </> : <p className="text-sm text-[#e5e4e2]/60">Brak osób uprawnionych do podpisu w danych organizacji.</p>}
                  {clientPartySigners.length > 0 && <button type="button" onClick={() => selectClientSigners(selectedClientSignerIds)} className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]">Wstaw wybrane osoby do bloku</button>}
                  <p className="text-xs text-[#e5e4e2]/50">Wybór osoby ponownie składa blok z danych organizacji. Możesz następnie poprawić jego treść poniżej. Zmiany dotyczą tylko tej umowy.</p>
                </div>
              )}
              <div className="mt-3">
                {editMode && canEdit && isWorkingDraft ? (
                  <ContractVariableHtmlField label="Pełne dane strony klienta" value={editedVariables.client_contract_party_block || ''}
                    onChange={value => setEditedVariables(current => ({ ...current, client_contract_party_block: value }))} />
                ) : (
                  <div className="text-sm leading-relaxed text-[#e5e4e2]/80" dangerouslySetInnerHTML={{ __html: variables.client_contract_party_block || '' }} />
                )}
              </div>
              {editMode && canEdit && isWorkingDraft && (
                <p className="mt-2 text-xs text-[#e5e4e2]/50">Zmiany zapiszesz przyciskiem „Zapisz” u góry.</p>
              )}
            </section>
          )}
            {!(clientPartyBase && usedContractVariableKeys.has('client_contract_party_block')) && (
              <p className="text-sm text-[#e5e4e2]/60">Dane stron, pola umowy i warunki (klient, opcje) edytujesz w trybie edycji.</p>
            )}
            {!editMode && canEdit && isWorkingDraft && (
              <button type="button" onClick={() => setEditMode(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/15">
                <Edit className="h-4 w-4" /> Edytuj pola i warunki umowy
              </button>
            )}
          </div>
        {editMode && (
          <div className="no-print rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 className="text-lg font-medium text-[#e5e4e2]">Edycja informacji podstawowych</h3>
                <p className="mt-1 text-sm text-[#e5e4e2]/50">
                  Możesz edytować wszystkie pola użyte w szablonie. Zmiany dotyczą tylko tej umowy i zapisują się przyciskiem „Zapisz” u góry.
                </p>
              </div>
              <label className="relative block w-full md:max-w-sm">
                <span className="sr-only">Szukaj zmiennej</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/45" />
                <input
                  type="search"
                  value={variableSearch}
                  onChange={(event) => setVariableSearch(event.target.value)}
                  placeholder="Szukaj pola, np. numer umowy"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-2 pl-10 pr-3 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/35 focus:border-[#d3bb73]/60 focus:outline-none"
                />
              </label>
            </div>

            {(contractConditionSettings.client || contractConditionSettings.options.length > 0) && (
              <section className="mb-4 rounded-lg border border-[#a083dc]/25 bg-[#a083dc]/5 p-4">
                <h4 className="text-sm font-medium text-[#e5e4e2]">Warunki umowy</h4>
                <p className="mt-1 text-xs text-[#e5e4e2]/50">
                  Decydują, które akapity szablonu trafią do tej umowy. Zastosuj przyciskiem „Zapisz” u góry.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[#e5e4e2]/85">
                  {contractConditionSettings.client && (
                    <label className="flex items-center gap-2">
                      Klient:
                      <select
                        value={editedVariables[CONTRACT_CLIENT_VARIABLE] === 'firma' ? 'firma' : 'osoba'}
                        onChange={(event) => setEditedVariables((current) => ({ ...current, [CONTRACT_CLIENT_VARIABLE]: event.target.value }))}
                        className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2]"
                      >
                        <option value="firma">firma</option>
                        <option value="osoba">osoba prywatna</option>
                      </select>
                    </label>
                  )}
                  {contractConditionSettings.options.map((option) => {
                    const key = contractOptionVariable(option.key);
                    return (
                      <label key={option.key} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="accent-[#d3bb73]"
                          checked={Boolean(editedVariables[key])}
                          onChange={(event) => setEditedVariables((current) => ({ ...current, [key]: event.target.checked ? 'tak' : '' }))}
                        />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
              </section>
            )}

            {editableContractVariables.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {editableContractVariables.map(({ key, value, label }) => {
                  const isHtml = isEventContractHtmlField(key, variables);
                  const useTextarea = isEventContractLongField(key, value);

                  return (
                    <div key={key} className={isHtml ? 'md:col-span-2' : undefined}>
                      <label className="mb-1 block text-sm text-[#e5e4e2]/70">{label}</label>
                      <span className="mb-2 block text-xs text-[#e5e4e2]/40">{'{{' + key + '}}'}</span>
                      {isHtml ? (
                        <ContractVariableHtmlField value={value} label={label}
                          onChange={(nextValue) => setEditedVariables((current) => ({ ...current, [key]: nextValue }))} />
                      ) : useTextarea ? (
                        <textarea
                          value={value}
                          rows={3}
                          onChange={(event) =>
                            setEditedVariables((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                          className="w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                      ) : (
                        <input
                          type="text"
                          value={value}
                          onChange={(event) =>
                            setEditedVariables((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#d3bb73]/20 px-4 py-8 text-center text-sm text-[#e5e4e2]/50">
                {variableSearch
                  ? 'Nie znaleziono pola o takiej nazwie.'
                  : 'Ten szablon nie zawiera pól przeznaczonych do ręcznej edycji.'}
              </div>
            )}
          </div>
        )}
          </>
        )}

        {contractSection === 'clauses' && (
          <div className="no-print space-y-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 md:p-6">
            {canEdit && (
              <div className="rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] p-3 lg:col-span-2 md:p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#e5e4e2]">
                      <ListChecks className="h-4 w-4 text-[#d3bb73]" />
                      Klauzule tej umowy
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/50">
                      Edytuj lub wyłącz automatyczne klauzule i dodaj ustalenia klienta tylko dla tego wydarzenia.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {EVENT_CONTRACT_CLAUSE_CATEGORY_ORDER.map((category) => {
                        const categoryItems = eventContractClauseItems.filter(
                          (item) => item.category === category,
                        );
                        if (categoryItems.length === 0) return null;
                        const activeItems = categoryItems.filter((item) => item.enabled).length;
                        return (
                          <span
                            key={category}
                            className="rounded-full border border-white/10 bg-white/[0.025] px-2.5 py-1 text-[10px] text-[#e5e4e2]/55"
                          >
                            {CONTRACT_CLAUSE_CATEGORY_LABELS[category] || category}: {activeItems}
                          </span>
                        );
                      })}
                      {eventContractClauseItems.length === 0 && (
                        <span className="text-[11px] text-[#e5e4e2]/35">
                          Brak klauzul automatycznych — możesz dodać własne.
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowEventContractClauses(true)}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/35 px-4 py-2.5 text-sm font-medium text-[#e7cf86] transition-colors hover:bg-[#d3bb73]/10"
                  >
                    <ListChecks className="h-4 w-4" />
                    Zarządzaj klauzulami
                  </button>
                </div>
              </div>
            )}
            {isWorkingDraft && unresolvedProductClauseConflicts.length > 0 && (
              <div className="rounded-xl border border-[#d3bb73]/30 bg-[#2c0b18] p-4 text-sm text-[#e5e4e2] lg:col-span-2 md:p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-[#d3bb73]">
                      <ShieldAlert className="h-4 w-4" />
                      Rozbieżne wersje wspólnych ustaleń
                    </div>
                    <p className="mt-1 max-w-3xl text-xs leading-5 text-[#e5e4e2]/60">
                      W źródłach umowy występują różne wersje tej samej wspólnej zasady.
                      Wybierz treść, która ma znaleźć się w umowie. Ustalenia specyficzne dla
                      różnych produktów nie są wzajemnie wykluczane.
                    </p>
                  </div>
                  <span className="w-fit rounded-full bg-[#d3bb73]/15 px-2.5 py-1 text-xs font-semibold text-[#d3bb73]">
                    {unresolvedProductClauseConflicts.length}
                  </span>
                </div>

                <div className="mt-4 space-y-4">
                  {unresolvedProductClauseConflicts.map((conflict) => (
                    <section key={conflict.key} className="rounded-lg border border-white/10 bg-black/15 p-3 md:p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-[#d3bb73]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#d3bb73]">
                          {CONTRACT_CLAUSE_CATEGORY_LABELS[conflict.category]}
                        </span>
                        <span className="font-medium text-[#f2eee2]">
                          {getContractClauseTopicLabel(conflict.topic)}
                        </span>
                      </div>
                      <div className="grid gap-2 lg:grid-cols-2">
                        {conflict.candidates.map((candidate) => (
                          <label
                            key={candidate.id}
                            className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                              productClauseSelectionDraft[conflict.key] === candidate.id
                                ? 'border-white/10 bg-[#d3bb73]/15'
                                : 'border-white/10 bg-white/[0.025] hover:border-white/20'
                            }`}
                          >
                            <span className="flex items-start gap-2">
                              <input
                                type="radio"
                                name={`product-clause-${conflict.key}`}
                                checked={productClauseSelectionDraft[conflict.key] === candidate.id}
                                onChange={() => setProductClauseSelectionDraft((current) => ({
                                  ...current,
                                  [conflict.key]: candidate.id,
                                }))}
                                className="mt-1 accent-[#d3bb73]"
                              />
                              <span className="min-w-0">
                                <span className="block text-xs font-semibold text-[#d3bb73]">
                                  {candidate.productName}
                                </span>
                                <span className="mt-1 block text-xs leading-5 text-[#e5e4e2]/65">
                                  {candidate.preview || candidate.title}
                                </span>
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>

                <div className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-[#e5e4e2]/45">
                    Wybrano {unresolvedProductClauseConflicts.filter((conflict) => Boolean(productClauseSelectionDraft[conflict.key])).length} z {unresolvedProductClauseConflicts.length} typów.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleApplyProductClauseSelections()}
                    disabled={
                      isApplyingProductClauseSelections ||
                      unresolvedProductClauseConflicts.some((conflict) => !productClauseSelectionDraft[conflict.key])
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-semibold text-[#210811] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isApplyingProductClauseSelections && <Loader className="h-4 w-4 animate-spin" />}
                    {isApplyingProductClauseSelections ? 'Aktualizowanie…' : 'Zastosuj wybory do umowy'}
                  </button>
                </div>
              </div>
            )}
            {unplacedClauseCategories.length > 0 && (
              <div className="rounded-lg border border-blue-400/25 bg-blue-400/10 p-3 text-sm text-blue-100 lg:col-span-2">
                <strong>Klauzule produktowe zostały pominięte.</strong>{' '}
                Ten szablon nie przewiduje miejsca dla sekcji: {unplacedClauseCategories.map(
                  (category) => CONTRACT_CLAUSE_CATEGORY_LABELS[category] || category,
                ).join(', ')}. Dokument zostanie wygenerowany bez nich — w przypadku umowy
                uproszczonej nie musisz nic robić.
              </div>
            )}
            {!canEdit && (
              <p className="text-sm text-[#e5e4e2]/60">Klauzulami tej umowy zarządzają osoby z uprawnieniem do edycji umów.</p>
            )}
          </div>
        )}

        {contractSection === 'review' && (
          <div className="no-print space-y-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 md:p-6">
            {isWorkingDraft && contractPreflightIssues.length > 0 && (
              <div className="rounded-lg border border-amber-400/10 bg-amber-400/10 p-4 text-sm text-amber-100 lg:col-span-2">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-amber-200">
                      Uwagi do sprawdzenia
                    </div>
                    <p className="mt-1 text-xs leading-5 text-amber-100/75">
                      Poniższe uwagi nie blokują generowania PDF ani drukowania umowy.
                      Aby wystawić lub wysłać finalną umowę mimo wskazanych braków, zaznacz
                      zapoznanie się z odpowiednimi uwagami. Potwierdzenie nie uzupełnia danych
                      i obowiązuje tylko dla bieżącej treści w tej sesji.
                    </p>
                    <div className="mt-3 space-y-2">
                      {contractPreflightIssues.map((issue) => (
                        <div
                          key={issue.key}
                          className="flex flex-col gap-2 rounded-md border border-amber-300/10 bg-black/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 py-1">
                            <input
                              type="checkbox"
                              checked={isPreflightIssueAcknowledged(issue.key)}
                              onChange={(e) => acknowledgePreflightIssue(issue.key, e.target.checked)}
                              disabled={!employee?.id || isGeneratingPdf}
                              className="mt-1 h-4 w-4 shrink-0 rounded accent-[#d3bb73] disabled:cursor-not-allowed"
                            />
                            <span className="min-w-0">
                              <span className="block leading-5">{issue.label}</span>
                              <span className="mt-1 block text-xs leading-5 text-amber-100/75">
                                {isPreflightIssueAcknowledged(issue.key)
                                  ? 'Potwierdzono — świadomie akceptuję tę uwagę przy wystawieniu i wysłaniu finalnej umowy.'
                                  : 'Zapoznałem(-am) się z uwagą i świadomie akceptuję wystawienie oraz wysłanie finalnej umowy mimo tego braku.'}
                              </span>
                            </span>
                          </label>
                          {issue.actionHref && (
                            <a
                              href={issue.actionHref}
                              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#d3bb73] hover:underline"
                            >
                              {issue.actionLabel || 'Uzupełnij'}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {contractSourceOutdated && (
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200 lg:col-span-2">
                Oferta, jej produkty lub harmonogram techniczny zmieniły się po indywidualnej
                edycji umowy. Użyj „Dane zmienione — odśwież”, aby ponownie pobrać aktualne dane.
                Operacja zastąpi indywidualnie zmienioną treść.
              </div>
            )}
            {contractSourceOutdated && canEdit && (
              <button type="button" disabled={loading} onClick={() => void handleRefreshFromOffer()} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-50">
                <RefreshCw className="h-4 w-4" /> Odśwież szablon i dane
              </button>
            )}
            {canEdit && isWorkingDraft && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#0f1119] p-3 text-sm text-[#e5e4e2]/70">
                <span>Audyt AI sprawdza treść umowy (spójność, braki, ryzyka) i proponuje poprawki do zatwierdzenia.</span>
                <button type="button" disabled={isAuditingContract} onClick={() => void handleStartContractAudit()} className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-[#e5e4e2] hover:bg-white/15 disabled:opacity-50">
                  {isAuditingContract ? <Loader className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {isAuditingContract ? 'Audytowanie…' : 'Audyt AI'}
                </button>
              </div>
            )}
            {!(isWorkingDraft && contractPreflightIssues.length > 0) && !contractSourceOutdated && (
              <p className="text-sm text-[#e5e4e2]/60">Brak uwag do sprawdzenia.</p>
            )}
          </div>
        )}

        {contractSection === 'documents' && (
          <div className="no-print space-y-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 md:p-6">
        {contractId && !companySignedAt && ['signed_by_client', 'signed_returned'].includes(contractStatus) && (
          <p className="no-print rounded-lg bg-[#d3bb73]/5 p-4 text-sm text-[#e5e4e2]/70">
            Aby załączyć podpisany dokument, administrator musi jeszcze potwierdzić podpis firmy przy statusie umowy.
          </p>
        )}
        {contractId && companySignedAt && ['signed_by_client', 'signed_returned', 'cancelled'].includes(contractStatus) && (
          <SignedContractAttachments
            key={contractId}
            contractId={contractId}
            onFilesChange={handleSignedFilesChange}
            manageOpen={signedFilesOpen}
            onManageClose={() => setSignedFilesOpen(false)}
            cancelled={contractStatus === 'cancelled'}
          />
        )}
          {previousContracts.length > 0 && (
            <details className="mb-4 rounded-lg border border-white/10 p-3 text-sm">
              <summary className="cursor-pointer text-[#d3bb73]">Poprzednie umowy ({previousContracts.length})</summary>
              <ul className="mt-3 space-y-2">
                {previousContracts.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{item.title} · {new Date(item.created_at).toLocaleString('pl-PL')}</span>
                    {item.generated_pdf_path && <button type="button" className="text-[#d3bb73] underline" onClick={async () => {
                      const { data, error } = await supabase.storage.from('event-files').createSignedUrl(item.generated_pdf_path!, 3600);
                      if (error || !data?.signedUrl) { showSnackbar('Nie udało się otworzyć archiwalnego PDF', 'error'); return; }
                      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
                    }}>Pokaż archiwalny PDF</button>}
                  </li>
                ))}
              </ul>
            </details>
          )}
            {!contractId || (!['signed_by_client', 'signed_returned', 'cancelled'].includes(contractStatus) && previousContracts.length === 0) ? (
              <p className="text-sm text-[#e5e4e2]/60">Podpisane dokumenty pojawią się tu po podpisaniu umowy przez klienta; wcześniejsze wersje umowy — po zmianie szablonu.</p>
            ) : null}
          </div>
        )}

      </div>

      <Dialog
        open={Boolean(pendingTemplateId)}
        onClose={() => setPendingTemplateId(null)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="change-contract-template-title"
        aria-describedby="change-contract-template-description"
        PaperProps={{ role: 'alertdialog', sx: { backgroundColor: '#210811', color: '#e5e4e2', borderRadius: '16px', backgroundImage: 'none' } }}
      >
        <div className="space-y-5 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 id="change-contract-template-title" className="text-lg font-medium uppercase">Zmień szablon umowy</h2>
            <button type="button" onClick={() => setPendingTemplateId(null)} aria-label="Zamknij" className="rounded-lg border-0 p-2 text-white/60 hover:bg-white/5">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div id="change-contract-template-description" className="space-y-3 text-sm leading-6 text-white/70">
            <p>Wybrany szablon: <strong className="text-[#d3bb73]">{availableTemplates.find((template) => template.id === pendingTemplateId)?.name}</strong></p>
            {contractId && (contractStatus !== 'draft' || generatedPdfPath || contractLockedAt) ? (
              <p>Przygotujemy nowy szkic z wybranego szablonu. Dotychczasowa umowa i jej PDF pozostaną w historii. Nową wersję możesz sprawdzić przed wysłaniem klientowi.</p>
            ) : (
              <p>Treść szkicu zostanie przygotowana z wybranego szablonu i danych wydarzenia. Indywidualne zmiany treści i zmiennych trzeba będzie wprowadzić ponownie.</p>
            )}
            <p>Zmiana szablonu nie wysyła wiadomości do klienta.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" autoFocus onClick={() => setPendingTemplateId(null)} className="min-h-11 rounded-lg border-0 bg-white/5 px-4 py-2.5 text-sm hover:bg-white/10">Anuluj</button>
            <button type="button" disabled={!pendingTemplateId || changingTemplate} onClick={() => { if (pendingTemplateId) void handleTemplateChange(pendingTemplateId); }} className="min-h-11 rounded-lg border-0 bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#210811] hover:bg-[#e7cf86] disabled:opacity-40">Zmień szablon</button>
          </div>
        </div>
      </Dialog>

      {showCancelContractModal && isAdmin && contractId && (
        <CancelContractModal
          contractId={contractId}
          eventId={eventId}
          status={contractStatus}
          templateName={selectedTemplateName}
          onClose={() => setShowCancelContractModal(false)}
          onCancelled={() => {
            setShowCancelContractModal(false);
            setShowSendEmailModal(false);
            setEditMode(false);
            setContractStatus('cancelled');
            showSnackbar('Umowa została anulowana. Treść, PDF i historia zostały zachowane.', 'success');
            void fetchContractData();
          }}
        />
      )}

      {contractAuditReview && (
        <ContractAuditReviewModal
          audit={contractAuditReview.audit}
          blocks={contractAuditReview.blocks}
          isApplying={isApplyingContractAudit}
          onClose={() => setContractAuditReview(null)}
          onApply={handleApplyContractAudit}
        />
      )}

      {showEventContractClauses && canEdit && (
        <EventContractClausesModal
          eventId={eventId}
          items={eventContractClauseItems}
          isSaving={isSavingEventContractClauses}
          onClose={() => setShowEventContractClauses(false)}
          onSave={handleSaveEventContractClauses}
        />
      )}

      {showSendEmailModal && contractId && (
        <SendContractEmailModal
          contractId={contractId}
          eventId={eventId}
          isDraft={isWorkingDraft}
          clientEmail={clientEmail}
          clientName={clientName}
          onClose={() => setShowSendEmailModal(false)}
          onSent={() => {
            fetchContractData();
          }}
        />
      )}
    </>
  );
}
