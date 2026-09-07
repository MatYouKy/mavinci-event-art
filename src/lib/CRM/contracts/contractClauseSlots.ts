export const CONTRACT_CLAUSE_SLOTS = [
  {
    key: '{{contract_clauses_conditions}}',
    name: 'contract_clauses_conditions',
    label: 'Warunki realizacji',
  },
  {
    key: '{{contract_clauses_requirements}}',
    name: 'contract_clauses_requirements',
    label: 'Wymagania podstawowe',
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
    key: '{{contract_clauses_additional_requirements}}',
    name: 'contract_clauses_additional_requirements',
    label: 'Wymagania dodatkowe',
  },
  {
    key: '{{contract_clauses_general}}',
    name: 'contract_clauses_general',
    label: 'Postanowienia dodatkowe (format historyczny)',
  },
  {
    key: '{{contract_clauses_all}}',
    name: 'contract_clauses_all',
    label: 'Wszystkie klauzule produktowe',
  },
] as const;

const CATEGORY_NAMES = [
  'conditions',
  'requirements',
  'obligations',
  'risks',
  'additional_requirements',
  'general',
] as const;
const SLOT_NAMES = CONTRACT_CLAUSE_SLOTS.map((slot) => slot.name);
const EMPTY_GENERAL_CLAUSES_HTML =
  '<div class="contract-clauses-empty" style="padding-left:0;font-family:inherit;font-size:inherit;font-weight:inherit;font-style:inherit;line-height:inherit;color:inherit;"><ul class="contract-clauses-empty-list" style="font-family:inherit;font-size:inherit;font-weight:inherit;font-style:inherit;line-height:inherit;color:inherit;"><li>Brak szczególnych postanowień dla zamówionych usług lub produktów.</li></ul></div>';

const hasVisibleClauseContent = (value?: string | null) =>
  String(value || '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .trim().length > 0;

const SLOT_TYPOGRAPHY_PROPERTIES = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration',
  'color',
] as const;

/**
 * contentEditable zapisuje formatowanie zaznaczonego placeholdera w zagnieżdżonym
 * <font> albo <span>. Przed odbudowaniem technicznej zawartości pola przenosimy
 * te style na trwały kontener, dzięki czemu nie znikają po zapisie szablonu i są
 * dziedziczone przez treść wstawianą do podglądu oraz PDF.
 */
const preserveClauseSlotTypography = (slot: HTMLElement) => {
  const placeholder = slot.querySelector<HTMLElement>('[data-clause-placeholder]');
  if (!placeholder) return;

  const styledElements = [placeholder, ...Array.from(placeholder.querySelectorAll<HTMLElement>('*'))];
  styledElements.forEach((element) => {
    SLOT_TYPOGRAPHY_PROPERTIES.forEach((property) => {
      const value = element.style.getPropertyValue(property).trim();
      if (!value || ['inherit', 'initial', 'unset'].includes(value)) return;
      slot.style.setProperty(property, value, element.style.getPropertyPriority(property));
    });

    if (element instanceof HTMLFontElement) {
      const face = element.getAttribute('face')?.trim();
      const color = element.getAttribute('color')?.trim();
      if (face) slot.style.fontFamily = face;
      if (color) slot.style.color = color;
    }
  });
};

const inheritClauseSlotTypographyFromNeighbor = (slot: HTMLElement) => {
  const neighbors = [slot.previousElementSibling, slot.nextElementSibling].filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
  const inheritedProperties = [
    'font-family',
    'font-size',
    'line-height',
    'letter-spacing',
    'color',
  ] as const;
  const explicitlyConfiguredProperties = new Set(
    inheritedProperties.filter((property) => slot.style.getPropertyValue(property).trim()),
  );

  for (const neighbor of neighbors) {
    const walker = neighbor.ownerDocument.createTreeWalker(neighbor, 4);
    const visibleTextNodes: Text[] = [];
    let textNode = walker.nextNode() as Text | null;
    while (textNode) {
      if (textNode.data.trim()) visibleTextNodes.push(textNode);
      textNode = walker.nextNode() as Text | null;
    }
    const visibleText = neighbor === slot.previousElementSibling
      ? visibleTextNodes[visibleTextNodes.length - 1]
      : visibleTextNodes[0];
    if (!visibleText?.parentElement) continue;

    const ancestry: HTMLElement[] = [];
    let element: HTMLElement | null = visibleText.parentElement;
    while (element && neighbor.contains(element)) {
      ancestry.unshift(element);
      if (element === neighbor) break;
      element = element.parentElement;
    }
    if (!ancestry.includes(neighbor)) ancestry.unshift(neighbor);

    ancestry.forEach((source) => {
      inheritedProperties.forEach((property) => {
        if (explicitlyConfiguredProperties.has(property)) return;
        const value = source.style.getPropertyValue(property).trim();
        if (!value || ['inherit', 'initial', 'unset'].includes(value)) return;
        slot.style.setProperty(property, value, source.style.getPropertyPriority(property));
      });
      if (source instanceof HTMLFontElement && !slot.style.fontFamily) {
        const face = source.getAttribute('face')?.trim();
        if (face) slot.style.fontFamily = face;
      }
    });

    if (slot.style.fontFamily || slot.style.fontSize) return;
  }
};

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
      preserveClauseSlotTypography(slot);
      inheritClauseSlotTypographyFromNeighbor(slot);
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
      preserveClauseSlotTypography(slot);
      inheritClauseSlotTypographyFromNeighbor(slot);
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

  // Starsze szablony nie mają jeszcze dwóch nowych placeholderów. Do czasu ich
  // uzupełnienia warunki trafiają przed wymaganiami, a wymagania dodatkowe do
  // historycznej sekcji postanowień dodatkowych. Treść nie znika z umowy.
  if (
    !declaredSlots.has('contract_clauses_conditions') &&
    declaredSlots.has('contract_clauses_requirements') &&
    nextVariables.contract_clauses_conditions
  ) {
    nextVariables.contract_clauses_requirements =
      `${nextVariables.contract_clauses_conditions}${nextVariables.contract_clauses_requirements || ''}`;
    nextVariables.contract_clauses_conditions = '';
    declaredSlots.add('contract_clauses_conditions');
  }
  if (
    !declaredSlots.has('contract_clauses_additional_requirements') &&
    declaredSlots.has('contract_clauses_general') &&
    nextVariables.contract_clauses_additional_requirements
  ) {
    nextVariables.contract_clauses_general =
      `${nextVariables.contract_clauses_general || ''}${nextVariables.contract_clauses_additional_requirements}`;
    nextVariables.contract_clauses_additional_requirements = '';
    declaredSlots.add('contract_clauses_additional_requirements');
  }

  // Zadeklarowana sekcja postanowień szczególnych nie może pozostać wizualnie
  // pusta. Wartość zastępczą dodajemy dopiero po obsłudze starszych szablonów,
  // aby nie poprzedzała faktycznie istniejących wymagań dodatkowych.
  if (
    declaredSlots.has('contract_clauses_general') &&
    !hasVisibleClauseContent(nextVariables.contract_clauses_general)
  ) {
    nextVariables.contract_clauses_general = EMPTY_GENERAL_CLAUSES_HTML;
  }

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
