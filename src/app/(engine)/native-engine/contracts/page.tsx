'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import '@/styles/contractA4.css';
import { CONTRACT_DEFAULT_LINE_HEIGHT, renderContractDocument } from '@/lib/CRM/contracts/contractPagination';
import {
  applyContractAuditDecisions,
  extractContractAuditBlocks,
  getContractDocumentParts,
  type ContractAuditBlock,
  type ContractAuditResult,
} from '@/lib/CRM/contracts/contractAudit';
import { convertLegacyContractTemplate } from '@/lib/CRM/contracts/contractTemplateConverter';
import { CONTRACT_STYLE_IDS, CONTRACT_STYLE_LABELS, isContractDocumentStylesTemplate } from '@/lib/CRM/contracts/contractDocumentStyles';
import { normalizeContractListStructureInElement, normalizeContractParagraphPlaceholders } from '@/lib/CRM/contracts/contractParagraphs';
import { negateContractCondition } from '@/lib/CRM/contracts/contractConditions';
import { appendContractVariant, mergeContractTemplates } from '@/lib/CRM/contracts/contractTemplateMerge';
import { getContractCssForPrint, getContractDocumentCss } from '@/components/crm/events/calculations/helpers/getContractCssForPrint';
import { ContractPagesView } from '@/components/crm/events/contract/ContractPagesView';
import { CONTRACT_CLIENT_VARIABLE, contractOptionVariable } from '@/lib/CRM/contracts/contractConditions';
import { getContractClauseTopicLabel, type ContractClauseCategory } from '@/lib/CRM/contracts/contractClauseContent';
import { serializeEventContractClauseItems, type EventContractClauseItem } from '@/lib/CRM/contracts/eventContractClauseOverrides';
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
  type ContractStatus,
  type EventContractDataContext,
} from '@/lib/CRM/contracts/eventContractData';

/*
 * Silnik umów dla Maca (`window.mavinciContractEngine`) — kod 1:1 z CRM:
 * - `convertTemplate` jak „Przekształć szablon” (`ContractTemplateConvertBanner`): strony przed i po, rozpoznane style,
 *   ostrzeżenia, treść i style dokumentu do zapisu;
 * - `mergeTemplates` jak „Porównaj” w „Scal z innym szablonem” (`ContractMergeDialog`): scalone akapity, wariant jako
 *   cała sekcja, statystyki i warunek dla treści tylko z bieżącego szablonu;
 * - `eventContract` jak zakładka „Umowa” wydarzenia (`EventContractTab`): składanie umowy (`fetchEventContractData`,
 *   wspólny kod z CRM) tokenem pracownika — podgląd stron, „Przygotuj umowę” (`ensureContractRecord`), „Odśwież szablon
 *   i dane” (`handleRefreshFromOffer`), strony do PDF (`handlePrint`: zawartość `.contract-a4-container` i CSS wydruku),
 *   pola i warunki z uwagami przed wystawieniem (`state`), zapis pól (`saveFields`, jak „Zapisz”), depozyt (`saveDeposit`)
 *   i zmiana statusu szkicu, w tym wystawienie (`status`, jak `handleStatusChange` z potwierdzonymi uwagami),
 *   „Klauzule tej umowy” (`clauses` i `saveClauses`, jak `EventContractClausesModal` i `handleSaveEventContractClauses`),
 *   wybór rozbieżnych wersji wspólnych ustaleń (`applySelections`, jak `handleApplyProductClauseSelections`) oraz
 *   złożenie treści z nowego szablonu po „Zmień szablon umowy” (`refresh` z `templateId`),
 *   edycja treści (`content` i `saveContent`, jak edytor umowy wydarzenia `edit-wysiwyg?contractId=…`), audyt AI umowy
 *   (`audit` i `applyAudit`, jak `handleStartContractAudit` / `handleApplyContractAudit`) i klauzul (`auditClauses`, jak
 *   „Asystent AI” w oknie klauzul).
 * Wynik wraca jako tekst JSON (DevTools `Runtime.evaluate`).
 */

type Settings = Record<string, any>;

const withoutPages = (settings: Settings | null | undefined) => {
  const copy: Settings = { ...(settings || {}) };
  delete copy.pages;
  delete copy.flowContent;
  return copy;
};

async function convertTemplate(input: { flow: string; settings: Settings }) {
  const settings = withoutPages(input.settings);
  const flow = input.flow || '';
  const before = await renderContractDocument(flow, settings as any);
  const conversion = await convertLegacyContractTemplate(flow, {
    selectedFont: settings.selectedFont,
    lineHeight: settings.lineHeight,
    baseCss: getContractDocumentCss(),
  });
  const v2Settings = {
    ...settings,
    documentStyles: conversion.documentStyles,
    selectedFont: conversion.documentStyles.styles.body.fontFamily,
    lineHeight: conversion.documentStyles.styles.body.lineHeight,
  };
  const after = await renderContractDocument(conversion.html, v2Settings as any);
  return {
    flowContent: after.flowContent,
    documentStyles: conversion.documentStyles,
    pagesBefore: before.pages.length,
    pagesAfter: after.pages.length,
    styles: CONTRACT_STYLE_IDS.filter((id) => conversion.report.styleCounts[id])
      .map((id) => `${CONTRACT_STYLE_LABELS[id]}: ${conversion.report.styleCounts[id]}`),
    warnings: conversion.report.warnings,
  };
}

async function mergeTemplates(input: { baseHtml: string; otherFlow: string; otherSettings: Settings; condition: string }) {
  const settings = input.otherSettings || {};
  // Wariant w starym formacie przechodzi tę samą konwersję co przy „Przekształć szablon”.
  const otherHtml = isContractDocumentStylesTemplate(settings)
    ? input.otherFlow
    : (await convertLegacyContractTemplate(input.otherFlow, {
        selectedFont: settings.selectedFont,
        lineHeight: settings.lineHeight,
        baseCss: getContractDocumentCss(),
      })).html;
  const base = normalizeContractParagraphPlaceholders(input.baseHtml);
  const other = normalizeContractParagraphPlaceholders(otherHtml);
  const merged = mergeContractTemplates(base, other, input.condition);
  return {
    merged: merged.html,
    appended: appendContractVariant(base, other, input.condition),
    stats: merged.stats,
    baseCondition: negateContractCondition(input.condition),
  };
}

// MARK: Umowa wydarzenia

type EventContractMode = 'preview' | 'create' | 'refresh' | 'pdf' | 'state' | 'saveFields' | 'saveDeposit' | 'status'
  | 'clauses' | 'saveClauses' | 'applySelections' | 'content' | 'saveContent' | 'audit' | 'applyAudit' | 'auditClauses';
type EventContractInput = {
  token: string;
  eventId: string;
  canViewAmounts: boolean;
  employeeId?: string | null;
  isAdmin?: boolean;
  mode: EventContractMode;
  /** `saveFields`: zmienione pola i warunki oraz wybrane osoby podpisujące. */
  edit?: { values?: Record<string, string>; signerIds?: string[] };
  /** `saveDeposit`: procent i kwota brutto jak w polach depozytu. */
  deposit?: { percent?: string; amount?: string };
  /** `status`: nowy status i uwagi przed wystawieniem, z którymi pracownik świadomie się zapoznał. */
  status?: string;
  acknowledged?: string[];
  /** `refresh`: szablon wybrany w „Zmień szablon umowy” (`fetchContractData(undefined, true, newTemplateId)`). */
  templateId?: string;
  /** `saveClauses`: zmiany w „Klauzule tej umowy” — istniejące klauzule po `id` i nowe ustalenia dla wydarzenia. */
  clauses?: ClauseChanges;
  /** `applySelections`: wybrane wersje rozbieżnych wspólnych ustaleń (klucz konfliktu → klauzula). */
  selections?: Record<string, string>;
  /** `saveContent`: treść z edytora i znacznik zapisanej umowy z chwili otwarcia edycji. */
  content?: { flowContent?: unknown; stamp?: unknown };
  /** `applyAudit`: wynik audytu, decyzje, treść poddana audytowi i znacznik zapisanej umowy z chwili audytu. */
  review?: { audit?: unknown; selections?: unknown; source?: unknown; stamp?: unknown };
  /** `auditClauses`: aktywne klauzule z okna „Klauzule tej umowy” (treść jako tekst). */
  auditItems?: Array<{ id?: unknown; category?: unknown; title?: unknown; productName?: unknown; text?: unknown }>;
};

type ClauseChanges = {
  items?: Array<{ id?: unknown; enabled?: unknown; text?: unknown; restore?: unknown; remove?: unknown }>;
  added?: Array<{ category?: unknown; title?: unknown; text?: unknown }>;
};

type ContractSetters = {
  [K in keyof EventContractDataContext as K extends `set${string}` ? K : never]: EventContractDataContext[K];
};
type SetterValue<S> = S extends Dispatch<SetStateAction<infer T>> ? T : never;
/** Stan zakładki „Umowa”, który ustawia składanie umowy (nazwy jak `useState` w komponencie). */
type EventContractState = {
  [K in keyof ContractSetters as K extends `set${infer Name}` ? Uncapitalize<Name> : never]: SetterValue<ContractSetters[K]>;
};

/** Wartości początkowe jak `useState(...)` w `EventContractTab`. */
const initialContractState = (): EventContractState => ({
  loading: true,
  templateId: null,
  selectedTemplateName: '',
  selectedTemplateId: null,
  originalTemplate: '',
  modifiedAfterGeneration: false,
  contractSourceOutdated: false,
  variables: {},
  variableOverrides: {},
  unplacedClauseCategories: [],
  statusDates: {},
  sourceContractContent: '',
  selectedClientSignerIds: [],
  savedClientSignerIds: [],
  productClauseSelections: {},
  productClauseSelectionDraft: {},
  productClauseConflicts: [],
  previousContracts: [],
  generatedPdfPath: null,
  eventContractClauseItems: [],
  eventCompanyBranding: null,
  editedVariables: {},
  contractVersion: 1,
  contractStatus: 'draft',
  contractLockedAt: null,
  contractId: null,
  contractFontFaceCss: '',
  contractCreatedBy: null,
  contractContent: '',
  companySignedAt: null,
  clientPartySigners: [],
  clientPartyBase: '',
  clientName: '',
  clientEmail: '',
});

/** Jedno wywołanie `fetchContractData` z bieżącym stanem; komunikat błędu jak snackbar w CRM (z przyczyną). */
async function runContractData(
  state: EventContractState,
  base: { supabase: EventContractDataContext['supabase']; eventId: string; canViewAmounts: boolean },
  ...args: [Record<string, string> | undefined, boolean?, string?]
) {
  const setters: Record<string, unknown> = {};
  (Object.keys(state) as Array<keyof EventContractState>).forEach((key) => {
    setters[`set${key.charAt(0).toUpperCase()}${key.slice(1)}`] = (value: unknown) => {
      const previous = state[key];
      (state as Record<string, unknown>)[key] = typeof value === 'function' ? (value as (current: unknown) => unknown)(previous) : value;
    };
  });
  const notices: Array<{ message: string; type: string }> = [];
  const causes: string[] = [];
  const consoleError = console.error;
  console.error = (...items: unknown[]) => {
    const cause = items.find((item) => item && typeof item === 'object' && 'message' in (item as object)) as { message?: unknown } | undefined;
    if (cause?.message) causes.push(String(cause.message));
    consoleError(...items);
  };
  try {
    const context = {
      ...base,
      variables: state.variables,
      productClauseSelections: state.productClauseSelections,
      showSnackbar: (message: string, type?: string) => { notices.push({ message, type: type || 'info' }); },
      ...setters,
    } as EventContractDataContext;
    await fetchEventContractData(context, ...args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    throw new Error(message || 'Błąd podczas ładowania danych umowy');
  } finally {
    console.error = consoleError;
  }
  const failure = notices.find((notice) => notice.type === 'error');
  if (failure) throw new Error(causes.length ? `${failure.message}: ${causes[causes.length - 1]}` : failure.message);
}

/** Zawartość `.contract-a4-container` dokładnie jak w podglądzie zakładki „Umowa” (ten sam komponent stron). */
function contractPagesHtml(contractContent: string) {
  const host = document.createElement('div');
  host.className = 'contract-a4-container';
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'absolute', left: '-100000px', top: '0' });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<ContractPagesView contractContent={contractContent} />));
    return host.innerHTML;
  } finally {
    root.unmount();
    host.remove();
  }
}

/** `ensureContractRecord`: szkic umowy z bieżącą treścią i szablonem (klient — osoba kontaktowa albo organizacja). */
async function ensureContractRecord(state: EventContractState, input: EventContractInput, supabase: EventContractDataContext['supabase']) {
  if (state.contractId) return false;
  if (!input.canViewAmounts) throw new Error(CONTRACT_AMOUNTS_REQUIRED);
  if (!state.templateId && !state.selectedTemplateId) throw new Error('Wybierz szablon umowy');
  const { data: eventData, error: eventError } = await supabase
    .from('events')
    .select('contact_person_id, organization_id')
    .eq('id', input.eventId)
    .single();
  if (eventError) throw new Error('Błąd podczas tworzenia umowy');
  const clientId = eventData?.contact_person_id || eventData?.organization_id || null;
  const { data: newContract, error: createError } = await supabase
    .from('contracts')
    .insert({
      event_id: input.eventId,
      client_id: clientId,
      title: `Umowa dla eventu ${input.eventId}`,
      content: state.contractContent,
      status: 'draft',
      template_id: state.selectedTemplateId || state.templateId,
      created_by: input.employeeId || null,
    })
    .select('id')
    .single();
  if (createError || !newContract) throw new Error('Błąd podczas tworzenia umowy');
  state.contractId = newContract.id;
  return true;
}

/** Pola, warunki i uwagi liczone w komponencie (`usedContractVariableKeys`, `contractConditionSettings`, `contractPreflightIssues`). */
function contractEditState(state: EventContractState) {
  const used = eventContractUsedVariableKeys(state.eventContractClauseItems, state.originalTemplate, state.productClauseSelections, state.variables);
  const conditions = eventContractConditionSettings(state.originalTemplate);
  const unresolved = state.productClauseConflicts.filter((conflict) => !state.productClauseSelections[conflict.key]);
  const preflight = eventContractPreflightIssues({
    originalTemplate: state.originalTemplate,
    selectedTemplateId: state.selectedTemplateId,
    unresolvedProductClauseConflicts: unresolved,
    usedContractVariableKeys: used,
    variables: state.variables,
  });
  return { used, conditions, preflight };
}

/** Szkic, który można edytować („Edytuj pola i warunki umowy” i depozyt: `canEdit && isWorkingDraft`). */
const editableDraft = (state: EventContractState) => state.contractStatus === 'draft' && !state.contractLockedAt;

/** Zapis treści szkicu jak „Zapisz depozyt” / „Zapisz”: szkic istnieje albo powstaje, treść tylko gdy umowa jest nadal szkicem. */
async function saveDraftContent(state: EventContractState, input: EventContractInput, supabase: EventContractDataContext['supabase'], content: string) {
  await ensureContractRecord(state, input, supabase);
  const { data, error } = await supabase.from('contracts').update({ content, modified_after_generation: true })
    .eq('id', state.contractId!).eq('status', 'draft').select('id').single();
  if (error || !data) throw new Error(error?.message || 'Umowa nie jest już szkicem. Odśwież widok.');
  state.contractContent = content;
  state.modifiedAfterGeneration = true;
}

const CONTRACT_STATUSES: ContractStatus[] = ['draft', 'issued', 'sent', 'accepted', 'signed_by_client', 'signed_returned', 'cancelled'];

/** `handleStatusChange` (bez anulowania — wymaga hasła administratora w CRM): uprawnienia, blokada, uwagi, zapis treści. */
async function changeContractStatus(state: EventContractState, input: EventContractInput, supabase: EventContractDataContext['supabase']) {
  const next = String(input.status || '') as ContractStatus;
  const current = state.contractStatus;
  if (!CONTRACT_STATUSES.includes(next) || next === current) throw new Error('Nieprawidłowy status umowy.');
  if (next === 'cancelled') throw new Error('Anulowanie umowy wymaga potwierdzenia hasłem administratora w CRM.');
  if (current === 'cancelled') throw new Error('Umowa jest anulowana.');
  const isAdmin = input.isAdmin === true;
  const [workflow, permission] = await Promise.all([
    supabase.rpc('can_manage_event_workflows', { p_event_id: input.eventId }),
    supabase.rpc('crm_contract_permission', { p_action: 'manage' }),
  ]);
  const canChangeTemplate = !workflow.error && !permission.error && !!workflow.data && !!permission.data;
  if (!(isAdmin || canChangeTemplate)) throw new Error('Nie masz uprawnień do zmiany statusu umowy.');
  // `isContractStatusDisabled`
  if ((Boolean(state.contractLockedAt) && ['draft', 'issued', 'sent', 'accepted'].includes(next)) || (!isAdmin && next === 'draft' && current !== 'draft')) {
    throw new Error('Tego statusu nie można teraz ustawić.');
  }
  // `ensureContractPreflight` — uwagi sprawdzamy przy finalizacji szkicu.
  if (!['draft', 'cancelled'].includes(next) && ['draft', 'cancelled'].includes(current)) {
    const acknowledged = new Set(Array.isArray(input.acknowledged) ? input.acknowledged.map(String) : []);
    const blockers = contractEditState(state).preflight.filter((issue) => issue.severity === 'blocker' && !acknowledged.has(issue.key));
    if (blockers.length > 0) {
      throw new Error(`Przed zmianą statusu umowy uzupełnij dane albo potwierdź zapoznanie się z pozostałymi uwagami (${blockers.length}).`);
    }
  }
  const changesDocumentMode = ['draft', 'cancelled'].includes(current) !== ['draft', 'cancelled'].includes(next);
  const statusDateField = `${next}_at`;
  if (!state.contractId) {
    if (!state.templateId && !state.selectedTemplateId) throw new Error('Wybierz szablon umowy przed zmianą statusu');
    const { data: eventData } = await supabase.from('events').select('contact_person_id, organization_id').eq('id', input.eventId).single();
    const clientId = eventData?.contact_person_id || eventData?.organization_id || null;
    const insertData: Record<string, unknown> = {
      event_id: input.eventId,
      client_id: clientId,
      title: `Umowa dla eventu ${input.eventId}`,
      content: state.contractContent,
      status: next,
      template_id: state.selectedTemplateId || state.templateId,
    };
    if (next !== 'draft') insertData[statusDateField] = new Date().toISOString();
    const { data, error } = await supabase.from('contracts').insert(insertData).select('id').single();
    if (error || !data) throw new Error('Błąd podczas aktualizacji statusu');
    state.contractId = data.id;
  } else {
    const updateData: Record<string, unknown> = {
      status: next,
      content: state.contractContent,
      ...(changesDocumentMode ? { modified_after_generation: true } : {}),
    };
    if (next !== 'draft') updateData[statusDateField] = new Date().toISOString();
    const { error } = await supabase.from('contracts').update(updateData).eq('id', state.contractId);
    if (error) throw new Error('Błąd podczas aktualizacji statusu');
  }
  state.contractStatus = next;
}

// MARK: Klauzule tej umowy i rozbieżne wersje wspólnych ustaleń

/** Kategorie okna „Klauzule tej umowy” (`CATEGORIES` w `EventContractClausesModal`). */
const CLAUSE_CATEGORIES: Array<{ value: ContractClauseCategory; label: string }> = [
  { value: 'conditions', label: 'Warunki realizacji' },
  { value: 'requirements', label: 'Wymagania podstawowe' },
  { value: 'obligations', label: 'Obowiązki Zamawiającego' },
  { value: 'risks', label: 'Ryzyka i odpowiedzialność' },
  { value: 'additional_requirements', label: 'Wymagania dodatkowe' },
  { value: 'general', label: 'Postanowienia dodatkowe' },
];

/** Nazwy kategorii w zakładce „Umowa” (`CONTRACT_CLAUSE_CATEGORY_LABELS`). */
const CLAUSE_CATEGORY_TAB_LABELS: Record<string, string> = {
  conditions: 'warunki realizacji',
  requirements: 'wymagania organizacyjne i techniczne',
  obligations: 'obowiązki zamawiającego',
  risks: 'ryzyka i odpowiedzialność',
  additional_requirements: 'wymagania dodatkowe',
  general: 'postanowienia dodatkowe',
};

const stripClauseHtml = (value: string) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const normalizeClauseHtml = (value: string) => String(value || '').replace(/\s+/g, ' ').trim();
const escapeClauseHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

/** `plainTextToHtml` z okna klauzul — nowe ustalenie: każdy wiersz to akapit. */
const plainTextToClauseHtml = (value: string) =>
  value.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => `<p>${escapeClauseHtml(line)}</p>`).join('');

/** `createCustomClauseId`. */
const createCustomClauseId = () =>
  `event-custom:${typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/** Formatowanie, którego zwykły tekst na Macu nie odda (pogrubienia, linki, listy numerowane, tabele, style). */
const CLAUSE_FORMATTING = /<(strong|b|em|i|u|a|ol|table|h[1-6]|sup|sub|mark|code)\b|\sstyle\s*=/i;

/** Treść klauzuli do edycji na Macu: akapit w wierszu, punkt listy zaczyna się od „• ”. */
function clauseHtmlToText(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  const lines: string[] = [];
  let current = '';
  let bullet = false;
  const flush = () => {
    const line = current.replace(/\s+/g, ' ').trim();
    if (line) {
      lines.push(`${bullet ? '• ' : ''}${line}`);
      bullet = false;
    }
    current = '';
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      current += node.textContent || '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (node as Element).tagName.toLowerCase();
    if (tag === 'br') {
      flush();
      return;
    }
    const block = /^(p|div|li|ul|ol|h[1-6]|blockquote|table|tr|section)$/.test(tag);
    if (block) flush();
    if (tag === 'li') bullet = true;
    node.childNodes.forEach(walk);
    if (block) flush();
  };
  root.childNodes.forEach(walk);
  flush();
  return lines.join('\n');
}

/** Tekst z Maca z powrotem w treści klauzuli: wiersze „• …” jako lista punktowana, pozostałe jako akapity. */
function clauseTextToHtml(value: string) {
  let html = '';
  let list: string[] = [];
  const closeList = () => {
    if (list.length) html += `<ul>${list.map((item) => `<li>${escapeClauseHtml(item)}</li>`).join('')}</ul>`;
    list = [];
  };
  value.split(/\n+/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const item = /^•\s*(.*)$/.exec(line);
    if (item) {
      if (item[1].trim()) list.push(item[1].trim());
      return;
    }
    closeList();
    html += `<p>${escapeClauseHtml(line)}</p>`;
  });
  closeList();
  return html;
}

/** `canEdit` z zakładki: umowa nieanulowana i niezablokowana; szkic — każdy, wystawiona — administrator. */
const canEditContract = (state: EventContractState, input: EventContractInput) =>
  state.contractStatus !== 'cancelled' && !state.contractLockedAt && (input.isAdmin === true || state.contractStatus === 'draft');

/** Okno „Klauzule tej umowy” i sekcja „Rozbieżne wersje wspólnych ustaleń” z bieżącego stanu umowy. */
function clausesView(state: EventContractState, input: EventContractInput) {
  let individuallyEdited = state.modifiedAfterGeneration;
  try {
    individuallyEdited = individuallyEdited || JSON.parse(state.contractContent)?.meta?.individuallyEdited === true;
  } catch {
    // Starsza treść umowy bez metadanych nie wymaga dodatkowego ostrzeżenia.
  }
  const unresolved = state.productClauseConflicts.filter((conflict) => !state.productClauseSelections[conflict.key]);
  return {
    canEdit: canEditContract(state, input),
    isWorkingDraft: state.contractStatus === 'draft',
    individuallyEdited,
    categories: CLAUSE_CATEGORIES,
    items: state.eventContractClauseItems.map((item) => ({
      id: item.id,
      category: item.category,
      title: item.title,
      productName: item.productName,
      source: item.source,
      enabled: item.enabled,
      edited: item.source === 'automatic' && normalizeClauseHtml(item.html) !== normalizeClauseHtml(item.baseHtml),
      text: clauseHtmlToText(item.html),
      formatted: CLAUSE_FORMATTING.test(item.html),
      // „Przywróć oryginał” — treść z produktu (tylko automatyczne klauzule).
      original: item.source === 'automatic' ? clauseHtmlToText(item.baseHtml) : null,
    })),
    conflicts: unresolved.map((conflict) => ({
      key: conflict.key,
      category: CLAUSE_CATEGORY_TAB_LABELS[conflict.category] || conflict.category,
      topic: getContractClauseTopicLabel(conflict.topic),
      candidates: conflict.candidates.map((candidate) => ({
        id: candidate.id, productName: candidate.productName, preview: candidate.preview || candidate.title,
      })),
    })),
    selections: state.productClauseSelectionDraft,
  };
}

/** Zmiany z okna klauzul: wyłączenie / przywrócenie automatycznych, edycja treści, oryginał, usunięcie i dodanie własnych. */
function applyClauseChanges(items: EventContractClauseItem[], changes: ClauseChanges | undefined) {
  const byId = new Map((Array.isArray(changes?.items) ? changes!.items! : []).map((change) => [String(change?.id || ''), change]));
  const next: EventContractClauseItem[] = [];
  items.forEach((item) => {
    const change = byId.get(item.id);
    if (!change) {
      next.push(item);
      return;
    }
    // „Usuń” mają tylko ustalenia dodane do wydarzenia; automatyczne klauzule się wyłącza.
    if (change.remove === true && item.source === 'custom') return;
    const updated: EventContractClauseItem = { ...item };
    if (item.source === 'automatic' && typeof change.enabled === 'boolean') updated.enabled = change.enabled;
    if (change.restore === true && item.source === 'automatic') {
      updated.html = item.baseHtml;
    } else if (typeof change.text === 'string') {
      const text = change.text.trim();
      if (!text) throw new Error(`Klauzula „${item.title}” nie może być pusta — wyłącz ją albo usuń.`);
      if (text !== clauseHtmlToText(item.html)) updated.html = clauseTextToHtml(text);
    }
    updated.preview = stripClauseHtml(updated.html).slice(0, 420);
    next.push(updated);
  });
  (Array.isArray(changes?.added) ? changes!.added! : []).forEach((entry) => {
    const category = CLAUSE_CATEGORIES.find((option) => option.value === entry?.category)?.value;
    if (!category) throw new Error('Nieznana kategoria klauzuli.');
    const html = plainTextToClauseHtml(String(entry.text ?? ''));
    if (!html) return;
    next.push({
      id: createCustomClauseId(),
      category,
      topic: 'event_custom',
      title: String(entry.title ?? '').trim() || 'Sugestia klienta',
      productName: 'Ustalenie dla wydarzenia',
      html,
      preview: stripClauseHtml(html).slice(0, 420),
      enabled: true,
      source: 'custom',
      baseHtml: html,
    });
  });
  return next;
}

// MARK: Edycja treści i audyt AI

/**
 * Znacznik zapisanej umowy (identyfikator i czas ostatniej zmiany) — edycja treści i audyt sprawdzają przed zapisem, czy
 * umowa nie zmieniła się w międzyczasie (szkic bez indywidualnych zmian składa się przy każdym odczycie od nowa, np. z nowym
 * numerem roboczym, więc porównujemy zapis w bazie, nie złożoną treść).
 */
async function contractStamp(state: EventContractState, supabase: EventContractDataContext['supabase']) {
  if (!state.contractId) return 'none';
  const { data, error } = await supabase.from('contracts').select('updated_at').eq('id', state.contractId).maybeSingle();
  if (error || !data) throw new Error('Nie udało się odczytać umowy.');
  return `${state.contractId}|${String((data as { updated_at?: string | null }).updated_at || '')}`;
}

/** `contractAuditSensitiveValues`: dane stron (klient, organizacja, reprezentanci, wykonawca) wyłączone z audytu. */
function auditSensitiveValues(variables: Record<string, string>) {
  const identityKey = /(client|organization|contact|representative|executor|seller|customer|company|primary_|legal_)/i;
  return Object.entries(variables)
    .filter(([key]) => identityKey.test(key))
    .flatMap(([, value]) => {
      const plainValue = String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return [plainValue, ...plainValue.split(/[,;|]/g).map((part) => part.trim())];
    })
    .filter((value, index, values) => value.length >= 4 && values.indexOf(value) === index);
}

/** `audit-contract` jak w CRM; komunikat błędu z odpowiedzi funkcji (np. limit usługi AI). */
async function invokeAudit(supabase: EventContractDataContext['supabase'], body: Record<string, unknown>, missing: string) {
  const { data, error } = await supabase.functions.invoke('audit-contract', { body });
  if (error) {
    let message = (data as { error?: string } | null)?.error;
    if (!message) {
      try {
        message = (await (error as { context?: Response }).context?.json())?.error;
      } catch {
        // Bez treści odpowiedzi — komunikat ogólny.
      }
    }
    throw new Error(message || error.message || 'Nie udało się przeprowadzić audytu umowy');
  }
  const audit = (data as { result?: ContractAuditResult } | null)?.result;
  if (!audit) throw new Error(missing);
  return audit;
}

/** Wynik audytu odesłany z Maca — tylko pola, z których korzysta `applyContractAuditDecisions`. */
function auditFromInput(value: unknown): ContractAuditResult {
  const audit = value as ContractAuditResult | null;
  if (!audit || typeof audit !== 'object' || !Array.isArray(audit.duplicates) || !Array.isArray(audit.issues)) {
    throw new Error('Brak wyniku audytu. Uruchom audyt ponownie.');
  }
  return {
    summary: String(audit.summary || ''),
    duplicates: audit.duplicates.map((duplicate) => ({
      id: String(duplicate?.id || ''),
      keepBlockId: String(duplicate?.keepBlockId || ''),
      removeBlockIds: Array.isArray(duplicate?.removeBlockIds) ? duplicate.removeBlockIds.map(String) : [],
      reason: String(duplicate?.reason || ''),
    })),
    issues: audit.issues.map((issue) => ({
      ...issue,
      id: String(issue?.id || ''),
      relatedBlockIds: Array.isArray(issue?.relatedBlockIds) ? issue.relatedBlockIds.map(String) : [],
      options: (Array.isArray(issue?.options) ? issue.options : []).map((option) => ({
        id: String(option?.id || ''),
        label: String(option?.label || ''),
        explanation: String(option?.explanation || ''),
        operations: (Array.isArray(option?.operations) ? option.operations : []).map((operation) => ({
          blockId: String(operation?.blockId || ''),
          action: operation?.action === 'remove' ? 'remove' as const : 'replace' as const,
          replacementText: String(operation?.replacementText || ''),
        })),
      })),
    })),
    model: audit.model ? String(audit.model) : undefined,
    generatedAt: audit.generatedAt ? String(audit.generatedAt) : undefined,
  };
}

/** Zapis treści umowy złożonej na nowo z przekazanej treści ciągłej (podział na strony jak w CRM). */
async function saveRenderedContent(
  state: EventContractState,
  input: EventContractInput,
  supabase: EventContractDataContext['supabase'],
  source: string,
  flowContent: string,
  meta: Record<string, unknown>,
) {
  const parts = getContractDocumentParts(source);
  const rendered = await renderContractDocument(flowContent, parts.settings);
  if (!rendered.flowContent.replace(/<[^>]*>/g, '').trim()) throw new Error('Treść umowy nie może być pusta');
  const content = JSON.stringify({ ...parts.parsed, ...rendered, meta: { ...(parts.parsed.meta || {}), ...meta } });
  const { data, error } = await supabase.from('contracts').update({ content, modified_after_generation: true })
    .eq('id', state.contractId!).eq('event_id', input.eventId).select('id');
  if (error) throw new Error(error.message || 'Nie udało się zapisać treści umowy');
  if (!data?.length) throw new Error('Nie masz uprawnień do zmiany tej umowy.');
  state.contractContent = content;
  state.modifiedAfterGeneration = true;
}

/** „Asystent AI” w oknie klauzul: bloki z aktywnych klauzul (jak `handleStartClauseAudit`). */
async function auditClauses(input: EventContractInput, supabase: EventContractDataContext['supabase']) {
  const items = (Array.isArray(input.auditItems) ? input.auditItems : [])
    .map((item) => ({
      id: String(item?.id || ''),
      category: String(item?.category || ''),
      title: String(item?.title || ''),
      productName: String(item?.productName || ''),
      text: String(item?.text || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((item) => item.id && item.text.length > 0);
  if (items.length < 2) throw new Error('Do porównania potrzebne są co najmniej dwie aktywne klauzule.');
  const blockToClauseId: Record<string, string> = {};
  const blocks: ContractAuditBlock[] = items.map((item, index) => {
    const id = `contract-block-${index + 1}`;
    blockToClauseId[id] = item.id;
    const categoryLabel = CLAUSE_CATEGORIES.find((category) => category.value === item.category)?.label || item.category;
    return {
      id,
      tag: 'li',
      text: item.text.slice(0, 2500),
      section: `${categoryLabel} · ${item.title} · źródło: ${item.productName}`.slice(0, 240),
      hasChildren: false,
      protected: false,
    };
  });
  const audit = await invokeAudit(supabase, {
    eventId: input.eventId,
    mode: 'clauses',
    blocks: blocks.map(({ protected: _protected, ...block }) => block),
  }, 'Asystent nie zwrócił wyniku analizy klauzul.');
  return { audit, blocks, blockToClauseId };
}

async function eventContract(input: EventContractInput) {
  if (!input.token || !input.eventId) throw new Error('Brak danych umowy.');
  // Klient tylko na to wywołanie — token pracownika z Maca, bez zapisu sesji (uprawnienia jak w CRM).
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${input.token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'mavinci-native-engine' },
  });
  const base = { supabase, eventId: input.eventId, canViewAmounts: input.canViewAmounts === true };
  // Analiza klauzul z okna nie potrzebuje składania umowy.
  if (input.mode === 'auditClauses') return { clauseAudit: await auditClauses(input, supabase) };
  const state = initialContractState();
  await runContractData(state, base, undefined);
  let created = false;
  if (input.mode === 'refresh') {
    // `handleRefreshFromOffer`: najnowszy szablon, dane klienta, oferta i klauzule; zapis treści istniejącej umowy.
    // Po „Zmień szablon umowy” — wybrany szablon (`fetchContractData(undefined, true, newTemplateId)`).
    const requestedTemplateId = typeof input.templateId === 'string' && input.templateId.trim() ? input.templateId.trim() : null;
    const currentTemplateId = requestedTemplateId || state.selectedTemplateId || state.templateId;
    if (!currentTemplateId) throw new Error('Wybierz szablon umowy');
    if (!base.canViewAmounts) throw new Error(CONTRACT_AMOUNTS_REQUIRED);
    await runContractData(state, base, undefined, true, currentTemplateId);
  }
  if (input.mode === 'create' || input.mode === 'pdf') created = await ensureContractRecord(state, input, supabase);
  if (input.mode === 'saveFields') {
    // „Zapisz” w edycji pól i warunków — te same nadpisania, kwoty słownie, klauzule i strony co w CRM.
    if (!editableDraft(state)) throw new Error('Pola i warunki zmienisz tylko w szkicu umowy.');
    if (!base.canViewAmounts) throw new Error(CONTRACT_AMOUNTS_REQUIRED);
    const { used, conditions } = contractEditState(state);
    const allowed = new Set<string>([...used, ...conditions.keys]);
    const edited = { ...state.editedVariables };
    Object.entries(input.edit?.values || {}).forEach(([key, value]) => {
      if (!allowed.has(key)) throw new Error(`Pole {{${key}}} nie występuje w tej umowie. Odśwież dane umowy.`);
      edited[key] = String(value ?? '');
    });
    let signerIds = state.selectedClientSignerIds;
    if (Array.isArray(input.edit?.signerIds) && state.clientPartyBase) {
      const requested = input.edit!.signerIds!.map(String);
      signerIds = state.clientPartySigners.filter((person) => requested.includes(person.id)).map((person) => person.id);
      const changed = signerIds.length !== state.selectedClientSignerIds.length || signerIds.some((id) => !state.selectedClientSignerIds.includes(id));
      // `selectClientSigners`: wybór osób ponownie składa blok strony klienta z danych organizacji.
      if (changed) edited.client_contract_party_block = clientPartyWithSigners(state.clientPartyBase, state.clientPartySigners.filter((person) => signerIds.includes(person.id)));
    }
    const result = await buildEventContractFieldsUpdate({
      variables: state.variables,
      editedVariables: edited,
      variableOverrides: state.variableOverrides,
      editableKeys: allowed,
      originalTemplate: state.originalTemplate,
      eventContractClauseItems: state.eventContractClauseItems,
      productClauseSelections: state.productClauseSelections,
      selectedClientSignerIds: signerIds,
    });
    created = !state.contractId;
    await saveDraftContent(state, input, supabase, result.contractContent);
  }
  if (input.mode === 'saveDeposit') {
    if (!editableDraft(state)) throw new Error('Depozyt zmienisz tylko w szkicu umowy.');
    if (!base.canViewAmounts) throw new Error(CONTRACT_AMOUNTS_REQUIRED);
    const deposit = eventContractDepositPatch(String(input.deposit?.percent ?? ''), String(input.deposit?.amount ?? ''), state.variables);
    if ('error' in deposit) throw new Error(deposit.error);
    const { content } = await buildEventContractDepositContent({
      patch: deposit.patch,
      variables: state.variables,
      variableOverrides: state.variableOverrides,
      originalTemplate: state.originalTemplate,
      eventContractClauseItems: state.eventContractClauseItems,
      productClauseSelections: state.productClauseSelections,
      selectedClientSignerIds: state.selectedClientSignerIds,
    });
    created = !state.contractId;
    await saveDraftContent(state, input, supabase, content);
  }
  if (input.mode === 'status') await changeContractStatus(state, input, supabase);
  if (input.mode === 'saveClauses') {
    // `handleSaveEventContractClauses`: klauzule zapisane przy wydarzeniu, potem draft odbudowany z szablonu i oferty.
    if (!canEditContract(state, input)) throw new Error('Klauzul tej umowy nie można już zmieniać.');
    if (!base.canViewAmounts) throw new Error(CONTRACT_AMOUNTS_REQUIRED);
    const items = applyClauseChanges(state.eventContractClauseItems, input.clauses);
    const { data, error } = await supabase
      .from('events')
      .update({ contract_clause_overrides: serializeEventContractClauseItems(items) })
      .eq('id', input.eventId)
      .select('id');
    if (error) {
      if (['42703', 'PGRST204'].includes(error.code || '')) {
        throw new Error('Brakuje pola klauzul wydarzenia w bazie. Uruchom najnowszą migrację Supabase i spróbuj ponownie.');
      }
      throw new Error(error.message || 'Nie udało się zapisać klauzul umowy');
    }
    if (!data?.length) throw new Error('Nie masz uprawnień do zmiany klauzul tego wydarzenia.');
    await runContractData(state, base, undefined, true);
  }
  let content = null;
  let saved = false;
  if (input.mode === 'content') {
    // Edytor umowy wydarzenia (`edit-wysiwyg?contractId=…`): ciągła treść do edycji, style dokumentu, krój i interlinia.
    if (!state.contractId) throw new Error('Najpierw przygotuj umowę.');
    if (!canEditContract(state, input)) throw new Error('Podpisana lub anulowana umowa nie może być edytowana.');
    if (!base.canViewAmounts) throw new Error(CONTRACT_AMOUNTS_REQUIRED);
    const parts = getContractDocumentParts(state.contractContent);
    const rendered = await renderContractDocument(normalizeContractParagraphPlaceholders(parts.flowContent), {
      ...parts.settings,
      selectedFooter: parts.settings.selectedFooter || 'default',
    });
    content = {
      flowContent: rendered.flowContent,
      cssText: `${state.contractFontFaceCss}\n${getContractDocumentCss()}`,
      font: String(rendered.settings.selectedFont || 'Georgia, serif'),
      lineHeight: Number(rendered.settings.lineHeight || CONTRACT_DEFAULT_LINE_HEIGHT),
      stamp: await contractStamp(state, supabase),
    };
  }
  if (input.mode === 'saveContent') {
    // „Zapisz” w edytorze treści: struktura list i paragrafów jak w CRM, podział na strony, indywidualna treść umowy.
    if (!state.contractId) throw new Error('Najpierw przygotuj umowę.');
    if (!canEditContract(state, input)) throw new Error('Podpisana lub anulowana umowa nie może być edytowana.');
    if (!base.canViewAmounts) throw new Error(CONTRACT_AMOUNTS_REQUIRED);
    if (String(input.content?.stamp || '') !== await contractStamp(state, supabase)) {
      throw new Error('Umowa zmieniła się od otwarcia edycji. Zamknij okno i otwórz edycję ponownie, aby nie nadpisać zmian.');
    }
    const host = document.createElement('div');
    host.innerHTML = typeof input.content?.flowContent === 'string' ? input.content.flowContent : '';
    normalizeContractListStructureInElement(host);
    const flowContent = normalizeContractParagraphPlaceholders(host.innerHTML);
    if (!flowContent.replace(/<[^>]*>/g, '').trim()) throw new Error('Treść umowy nie może być pusta');
    await saveRenderedContent(state, input, supabase, state.contractContent, flowContent, {
      individuallyEdited: true,
      editSource: 'wysiwyg',
      editedAt: new Date().toISOString(),
    });
    saved = true;
  }
  let audit = null;
  if (input.mode === 'audit' || input.mode === 'applyAudit') {
    if (state.contractStatus !== 'draft') throw new Error('Audyt AI można zastosować wyłącznie do wersji roboczej umowy');
    if (!canEditContract(state, input)) throw new Error('Tej umowy nie można już zmieniać.');
    if (!base.canViewAmounts) throw new Error(CONTRACT_AMOUNTS_REQUIRED);
  }
  if (input.mode === 'audit') {
    // `handleStartContractAudit`: bez danych stron, reprezentantów i podpisów; wynik do przeglądu na Macu.
    if (!state.contractContent) throw new Error('Brak treści umowy do audytu');
    const sensitive = auditSensitiveValues(state.variables);
    const blocks = extractContractAuditBlocks(state.contractContent, sensitive);
    const auditBlocks = blocks.filter((block) => !block.protected);
    if (auditBlocks.length < 2) throw new Error('Po wyłączeniu danych stron pozostało za mało treści do audytu');
    const result = await invokeAudit(supabase, {
      eventId: input.eventId,
      contractId: state.contractId,
      blocks: auditBlocks.map(({ protected: _protected, ...block }) => block),
    }, 'Asystent nie zwrócił wyniku audytu');
    audit = { audit: result, blocks, source: state.contractContent, stamp: await contractStamp(state, supabase) };
  }
  if (input.mode === 'applyAudit') {
    // `handleApplyContractAudit`: decyzje na treści, która była audytowana; umowa nie mogła zmienić się w międzyczasie.
    const source = typeof input.review?.source === 'string' ? input.review.source : '';
    if (!source || String(input.review?.stamp || '') !== await contractStamp(state, supabase)) {
      throw new Error('Treść umowy zmieniła się od audytu. Uruchom audyt ponownie.');
    }
    const result = auditFromInput(input.review?.audit);
    const raw = input.review?.selections && typeof input.review.selections === 'object' ? input.review.selections as Record<string, unknown> : {};
    const selections = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, String(value ?? '')]));
    const applied = applyContractAuditDecisions(source, result, selections, auditSensitiveValues(state.variables));
    audit = { removed: applied.removed, changed: applied.changed };
    if (applied.removed > 0 || applied.changed > 0) {
      created = await ensureContractRecord(state, input, supabase);
      await saveRenderedContent(state, input, supabase, source, applied.flowContent, {
        individuallyEdited: true,
        editSource: 'ai-audit',
        lastAiAuditAt: result.generatedAt || new Date().toISOString(),
        lastAiAuditModel: result.model || null,
      });
    }
  }
  if (input.mode === 'applySelections') {
    // `handleApplyProductClauseSelections`: wszystkie rozbieżności muszą mieć wybraną wersję.
    if (state.contractStatus !== 'draft') throw new Error('Wersje wspólnych ustaleń wybierasz w szkicu umowy.');
    if (!base.canViewAmounts) throw new Error(CONTRACT_AMOUNTS_REQUIRED);
    const requested = input.selections && typeof input.selections === 'object' ? input.selections : {};
    const draft: Record<string, string> = { ...state.productClauseSelectionDraft };
    state.productClauseConflicts.forEach((conflict) => {
      const selected = String(requested[conflict.key] || '');
      if (conflict.candidates.some((candidate) => candidate.id === selected)) draft[conflict.key] = selected;
    });
    const unresolved = state.productClauseConflicts.filter((conflict) => !draft[conflict.key]);
    if (unresolved.length > 0) {
      throw new Error(`Wybierz wersję dla wszystkich rozbieżnych wspólnych ustaleń (${unresolved.length}).`);
    }
    await runContractData(state, base, draft, true);
    // W CRM wybór zostaje w otwartej zakładce do „Przygotuj umowę”; na Macu zapisujemy go od razu w szkicu.
    if (!state.contractId) created = await ensureContractRecord(state, input, supabase);
  }
  let edit = null;
  let preflight = null;
  if (input.mode === 'state') {
    const editState = contractEditState(state);
    preflight = editState.preflight;
    const variables = state.variables;
    edit = {
      canEdit: editableDraft(state),
      fields: eventContractEditableVariables(editState.used, state.editedVariables, '').map((field) => ({
        ...field,
        html: isEventContractHtmlField(field.key, variables),
        long: isEventContractLongField(field.key, field.value),
      })),
      client: editState.conditions.client ? (state.editedVariables[CONTRACT_CLIENT_VARIABLE] === 'firma' ? 'firma' : 'osoba') : null,
      clientKey: CONTRACT_CLIENT_VARIABLE,
      options: editState.conditions.options.map((option) => ({
        key: contractOptionVariable(option.key),
        label: option.label,
        enabled: Boolean(state.editedVariables[contractOptionVariable(option.key)]),
      })),
      party: state.clientPartyBase && editState.used.has('client_contract_party_block')
        ? { html: variables.client_contract_party_block || '', signers: state.clientPartySigners, selected: state.selectedClientSignerIds }
        : null,
      deposit: variables.deposit_percent
        ? {
            label: `${variables.deposit_percent}${variables.deposit_amount ? ` (${variables.deposit_amount} brutto)` : ''}`,
            percent: String(readContractDepositNumber(variables.deposit_percent || '0')),
            amount: String(readContractDepositNumber(variables.deposit_amount || '0')),
            total: readContractDepositNumber(variables.budget_brutto || '0'),
          }
        : null,
      // Style dokumentu dla edytora pól z formatowaniem (jak style zakładki „Umowa” w CRM).
      cssText: `${state.contractFontFaceCss}\n${getContractDocumentCss()}`,
    };
  }
  const withPages = input.mode === 'preview' || input.mode === 'pdf';
  const pagesHtml = withPages
    ? contractPagesHtml(state.contractContent).replace(/class="absolute bottom-4[^"]*text-\[#000\]\/50"/g, 'class="contract-page-counter"')
    : null;
  let pageCount = 0;
  try {
    const parsed = JSON.parse(state.contractContent);
    pageCount = Array.isArray(parsed?.pages) ? parsed.pages.length : Array.isArray(parsed) ? parsed.length : 1;
  } catch {
    pageCount = state.contractContent ? 1 : 0;
  }
  return {
    contractId: state.contractId,
    created,
    status: state.contractStatus,
    templateId: state.selectedTemplateId || state.templateId,
    templateName: state.selectedTemplateName,
    sourceOutdated: state.contractSourceOutdated,
    modifiedAfterGeneration: state.modifiedAfterGeneration,
    generatedPdfPath: state.generatedPdfPath,
    unplacedClauseCategories: state.unplacedClauseCategories,
    unresolvedConflicts: state.productClauseConflicts.filter((conflict) => !state.productClauseSelections[conflict.key]).length,
    pageCount,
    pagesHtml,
    cssText: withPages ? `${state.contractFontFaceCss}\n${getContractCssForPrint()}` : null,
    edit,
    preflight,
    clauses: ['clauses', 'saveClauses', 'applySelections'].includes(input.mode) ? clausesView(state, input) : null,
    content,
    audit,
    saved,
  };
}

const engine = {
  version: 2,
  convertTemplate: async (input: Parameters<typeof convertTemplate>[0]) => JSON.stringify(await convertTemplate(input)),
  mergeTemplates: async (input: Parameters<typeof mergeTemplates>[0]) => JSON.stringify(await mergeTemplates(input)),
  eventContract: async (input: EventContractInput) => JSON.stringify(await eventContract(input)),
};

declare global {
  interface Window { mavinciContractEngine?: typeof engine }
}

export default function ContractEnginePage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    window.mavinciContractEngine = engine;
    setReady(true);
  }, []);
  return (
    <main data-engine-ready={ready ? 'true' : 'false'} style={{ padding: 16, fontFamily: 'system-ui', fontSize: 12, color: '#666' }}>
      Silnik dokumentów umów Mavinci (aplikacja na Maca).
    </main>
  );
}
