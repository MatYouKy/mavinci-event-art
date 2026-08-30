export const CONTRACT_CLAUSE_SLOTS = [
  {
    key: '{{contract_clauses_requirements}}',
    name: 'contract_clauses_requirements',
    label: 'Wymagania organizacyjne i techniczne',
  },
  {
    key: '{{contract_clauses_obligations}}',
    name: 'contract_clauses_obligations',
    label: 'Obowiązki zamawiającego',
  },
  {
    key: '{{contract_clauses_risks}}',
    name: 'contract_clauses_risks',
    label: 'Ryzyka i odpowiedzialność',
  },
  {
    key: '{{contract_clauses_general}}',
    name: 'contract_clauses_general',
    label: 'Postanowienia dodatkowe',
  },
  {
    key: '{{contract_clauses_all}}',
    name: 'contract_clauses_all',
    label: 'Wszystkie klauzule produktowe',
  },
] as const;

const CATEGORY_NAMES = ['requirements', 'obligations', 'risks', 'general'] as const;
const SLOT_NAMES = CONTRACT_CLAUSE_SLOTS.map((slot) => slot.name);

const normalizeSlotName = (value?: string | null) => {
  const normalized = String(value || '').replace(/[{}]/g, '').trim().toLowerCase();
  if (CATEGORY_NAMES.includes(normalized as (typeof CATEGORY_NAMES)[number])) {
    return `contract_clauses_${normalized}`;
  }
  if (normalized === 'all' || normalized === 'clauses') return 'contract_clauses_all';
  return normalized;
};

const placeholderPattern = (name: string) =>
  new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'i');

/**
 * Oznacza placeholdery jako stabilne obszary szablonu. Atrybut jest źródłem
 * prawdy; zawartość pola może być bezpiecznie odbudowana po edycji WYSIWYG.
 */
export const decorateContractClauseSlots = (html: string) => {
  let decorated = html;

  if (typeof document !== 'undefined') {
    const container = document.createElement('div');
    container.innerHTML = decorated;
    container.querySelectorAll<HTMLElement>('[data-contract-clause-slot]').forEach((slot) => {
      const slotName = normalizeSlotName(slot.dataset.contractClauseSlot);
      if (!SLOT_NAMES.includes(slotName as (typeof SLOT_NAMES)[number])) return;
      const definition = CONTRACT_CLAUSE_SLOTS.find((item) => item.name === slotName);
      slot.dataset.contractClauseSlot = slotName;
      if (definition) slot.dataset.clauseLabel = definition.label;
      slot.innerHTML = `<span data-clause-placeholder="true">{{${slotName}}}</span>`;
    });
    decorated = container.innerHTML;
  }

  CONTRACT_CLAUSE_SLOTS.forEach(({ key, name, label }) => {
    if (!placeholderPattern(name).test(decorated)) return;
    if (decorated.includes(`data-contract-clause-slot="${name}"`)) return;
    decorated = decorated.replace(
      placeholderPattern(name),
      `<div data-contract-clause-slot="${name}" data-clause-label="${label}"><span data-clause-placeholder="true">${key}</span></div>`,
    );
  });

  return decorated;
};

/**
 * Wstrzykuje sekcje klauzul wyłącznie do miejsc zadeklarowanych w szablonie.
 * Brak obszaru jest raportowany wywołującemu. Nie doklejamy klauzul na końcu,
 * ponieważ tworzyłoby to dokument niezgodny z układem zatwierdzonym w szablonie.
 */
export const placeContractClauses = (
  flow: string,
  sourceVariables: Record<string, string>,
) => {
  const nextVariables = { ...sourceVariables };
  const declaredSlots = new Set<string>();
  let flowContent = flow;

  if (typeof document !== 'undefined') {
    const container = document.createElement('div');
    container.innerHTML = flow;
    container.querySelectorAll('[data-auto-product-clauses="true"]').forEach((node) => node.remove());
    container.querySelectorAll<HTMLElement>('[data-contract-clause-slot]').forEach((slot) => {
      const slotName = normalizeSlotName(slot.dataset.contractClauseSlot);
      if (!SLOT_NAMES.includes(slotName as (typeof SLOT_NAMES)[number])) return;
      declaredSlots.add(slotName);
      slot.dataset.contractClauseSlot = slotName;
      // W finalnym dokumencie klauzula zawiera elementy blokowe (akapity, listy).
      // Nie wolno umieszczać ich wewnątrz <span>, bo przeglądarka i Chromium PDF
      // naprawiają taki niepoprawny HTML w różny sposób.
      slot.innerHTML = `{{${slotName}}}`;
    });
    flowContent = container.innerHTML;
  }

  SLOT_NAMES.forEach((name) => {
    if (placeholderPattern(name).test(flowContent)) declaredSlots.add(name);
  });

  const unplacedSections = CATEGORY_NAMES
    .filter((category) => !declaredSlots.has(`contract_clauses_${category}`))
    .map((category) => nextVariables[`contract_clauses_${category}`])
    .filter(Boolean);

  nextVariables.contract_clauses_all = unplacedSections.join('');
  const hasCatchAllSlot = declaredSlots.has('contract_clauses_all');
  const unplacedClauseCategories = CATEGORY_NAMES.filter(
    (category) =>
      Boolean(nextVariables[`contract_clauses_${category}`]) &&
      !declaredSlots.has(`contract_clauses_${category}`) &&
      !hasCatchAllSlot,
  );

  return {
    flowContent,
    variables: nextVariables,
    declaredSlots: Array.from(declaredSlots),
    unplacedClauseCategories,
  };
};
