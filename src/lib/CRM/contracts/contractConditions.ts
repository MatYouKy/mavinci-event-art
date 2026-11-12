/**
 * Warunki w szablonie umowy — akapit, punkt albo cała sekcja widoczna tylko w części umów.
 *
 * Zapis w treści: atrybut `data-contract-if` z jednym warunkiem:
 * - `zamowienie` — pole umowy jest wypełnione (`!zamowienie` — puste),
 * - `klient=firma` / `klient=osoba` — rodzaj klienta wydarzenia,
 * - `kategoria=Wesele|Studniówka` — rodzaj (kategoria) wydarzenia; `kategoria!=Wesele` — każdy inny,
 * - `opcja_nocleg` — opcja umowy włączona (`!opcja_nocleg` — wyłączona); opcje definiuje szablon
 *   (`page_settings.contractOptions`), a włącza się je przy każdej umowie.
 * Warunki łączy się zagnieżdżając sekcje (sekcja „firma” z akapitem „opcja_nocleg” = firma i nocleg).
 * Wszystkie warunki to porównania zmiennych umowy, więc działają tak samo w podglądzie szablonu, w umowie wydarzenia
 * i w PDF. Nieprawidłowy zapis nie ukrywa treści (bezpieczniej pokazać akapit niż go zgubić).
 */

export const CONTRACT_CONDITION_ATTRIBUTE = 'data-contract-if';
export const CONTRACT_CLIENT_VARIABLE = 'klient';
export const CONTRACT_CATEGORY_VARIABLE = 'kategoria';
export const CONTRACT_OPTION_PREFIX = 'opcja_';

export type ContractClientKind = 'firma' | 'osoba';
export const CONTRACT_CLIENT_KIND_LABELS: Record<ContractClientKind, string> = {
  firma: 'firma',
  osoba: 'osoba prywatna',
};

export type ContractConditionKind = 'client' | 'category' | 'option' | 'filled' | 'equals';

export interface ContractCondition {
  kind: ContractConditionKind;
  variable: string;
  /** Wartości do porównania (`klient=firma`, `kategoria=Wesele|Studniówka`); puste — warunek „wypełnione”. */
  values: string[];
  negate: boolean;
}

/** Opcja umowy definiowana w szablonie (np. „Nocleg dla wykonawcy”), przełączana przy każdej umowie. */
export interface ContractOption {
  key: string;
  label: string;
  defaultOn: boolean;
}

const VARIABLE = /^[A-Za-z0-9_]+$/;

export const parseContractCondition = (expression: string | null | undefined): ContractCondition | null => {
  let text = (expression || '').trim();
  if (!text) return null;
  const comparison = text.match(/^([A-Za-z0-9_]+)\s*(!=|=)\s*(.+)$/);
  let negate = false;
  let variable: string;
  let values: string[] = [];
  if (comparison) {
    variable = comparison[1];
    negate = comparison[2] === '!=';
    values = comparison[3].split('|').map((value) => value.trim()).filter(Boolean);
    if (!values.length) return null;
  } else {
    if (text.startsWith('!')) {
      negate = true;
      text = text.slice(1).trim();
    }
    if (!VARIABLE.test(text)) return null;
    variable = text;
  }
  const kind: ContractConditionKind =
    variable === CONTRACT_CLIENT_VARIABLE && values.length ? 'client'
      : variable === CONTRACT_CATEGORY_VARIABLE && values.length ? 'category'
        : variable.startsWith(CONTRACT_OPTION_PREFIX) && !values.length ? 'option'
          : values.length ? 'equals' : 'filled';
  return { kind, variable, values, negate };
};

export const serializeContractCondition = (condition: ContractCondition) => {
  if (condition.values.length) return `${condition.variable}${condition.negate ? '!=' : '='}${condition.values.join('|')}`;
  return `${condition.negate ? '!' : ''}${condition.variable}`;
};

export const negateContractCondition = (expression: string) => {
  const condition = parseContractCondition(expression);
  return condition ? serializeContractCondition({ ...condition, negate: !condition.negate }) : expression;
};

const plainText = (value: string | null | undefined) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|\u00a0/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Porównanie bez wielkości liter i polskich znaków („STUDNIÓWKA” = „Studniówka” = „studniowka”). */
export const normalizeContractConditionValue = (value: string | null | undefined) =>
  plainText(value)
    .toLocaleLowerCase('pl-PL')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const FALSE_VALUES = new Set(['nie', 'false', '0', 'off', 'brak']);
const isFilled = (value: string | null | undefined) => {
  const text = normalizeContractConditionValue(value);
  return Boolean(text) && !FALSE_VALUES.has(text);
};

/** `true`/`false` — czy pokazać treść; `null` — nieprawidłowy warunek (treść zostaje). */
export const evaluateContractCondition = (expression: string, variables: Record<string, string | undefined>) => {
  const condition = parseContractCondition(expression);
  if (!condition) return null;
  const value = variables[condition.variable];
  const result = condition.values.length
    ? condition.values.some((expected) => normalizeContractConditionValue(expected) === normalizeContractConditionValue(value))
    : isFilled(value);
  return condition.negate ? !result : result;
};

/**
 * Usuwa treść, której warunek nie jest spełniony. Sekcje (`<div data-contract-if>`) ze spełnionym warunkiem są
 * rozwijane, żeby podział na strony widział zwykłe akapity i listy jak w szablonie bez warunków.
 */
export const applyContractConditionsInElement = (root: Element, variables: Record<string, string | undefined>) => {
  root.querySelectorAll(`[${CONTRACT_CONDITION_ATTRIBUTE}]`).forEach((element) => {
    if (!element.parentNode) return;
    const visible = evaluateContractCondition(element.getAttribute(CONTRACT_CONDITION_ATTRIBUTE) || '', variables);
    if (visible === false) element.remove();
  });
  root.querySelectorAll(`div[${CONTRACT_CONDITION_ATTRIBUTE}], section[${CONTRACT_CONDITION_ATTRIBUTE}]`).forEach((section) => {
    if (section.parentNode && section.querySelector('p, div, ol, ul, table, h1, h2, h3, h4, li')) {
      section.replaceWith(...Array.from(section.childNodes));
    }
  });
};

export const applyContractConditions = (html: string, variables: Record<string, string | undefined>) => {
  if (typeof document === 'undefined' || !html || !html.includes(CONTRACT_CONDITION_ATTRIBUTE)) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  applyContractConditionsInElement(container, variables);
  return container.innerHTML;
};

/** Zmienne użyte w warunkach (np. do listy ustawień umowy). */
export const contractConditionVariableNames = (html: string) => {
  const names = new Set<string>();
  for (const match of (html || '').matchAll(/data-contract-if="([^"]*)"/g)) {
    const condition = parseContractCondition(match[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
    if (condition) names.add(condition.variable);
  }
  return names;
};

// MARK: Opcje umowy

export const contractOptionVariable = (key: string) => `${CONTRACT_OPTION_PREFIX}${key}`;

/** Klucz opcji z nazwy: „Nocleg dla wykonawcy” → `nocleg_dla_wykonawcy` (unikalny w szablonie). */
export const contractOptionKeyFromLabel = (label: string, existing: string[] = []) => {
  const base = normalizeContractConditionValue(label)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'opcja';
  let key = base;
  let index = 2;
  while (existing.includes(key)) key = `${base}_${index++}`;
  return key;
};

export const resolveContractOptions = (settings: { contractOptions?: unknown } | null | undefined): ContractOption[] => {
  const raw = Array.isArray(settings?.contractOptions) ? settings!.contractOptions as unknown[] : [];
  const seen = new Set<string>();
  return raw.flatMap((item) => {
    const option = item as Partial<ContractOption>;
    const key = typeof option?.key === 'string' && VARIABLE.test(option.key) ? option.key : '';
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{ key, label: typeof option.label === 'string' && option.label.trim() ? option.label.trim() : key, defaultOn: option.defaultOn === true }];
  });
};

export interface ContractConditionContext {
  /** Klient jest firmą (organizacja), a nie osobą prywatną. */
  isCompany: boolean;
  categoryName?: string | null;
  options?: ContractOption[];
}

/** Zmienne warunków dla umowy wydarzenia: rodzaj klienta, kategoria i domyślne ustawienia opcji szablonu. */
export const contractConditionVariables = ({ isCompany, categoryName, options = [] }: ContractConditionContext) => {
  const variables: Record<string, string> = {
    [CONTRACT_CLIENT_VARIABLE]: isCompany ? 'firma' : 'osoba',
    [CONTRACT_CATEGORY_VARIABLE]: (categoryName || '').trim(),
  };
  options.forEach((option) => { variables[contractOptionVariable(option.key)] = option.defaultOn ? 'tak' : ''; });
  return variables;
};

// MARK: Opis dla ludzi

export interface ContractConditionDescribeContext {
  options?: ContractOption[];
  /** Nazwy pól umowy (`{{…}}`) — np. z grup pól edytora. */
  fieldLabels?: Record<string, string>;
}

export const describeContractCondition = (expression: string, context: ContractConditionDescribeContext = {}) => {
  const condition = parseContractCondition(expression);
  if (!condition) return `Nieprawidłowy warunek: ${expression}`;
  const list = (values: string[]) => values.join(' lub ');
  switch (condition.kind) {
    case 'client': {
      const labels = condition.values.map((value) => CONTRACT_CLIENT_KIND_LABELS[normalizeContractConditionValue(value) as ContractClientKind] || value);
      return condition.negate ? `Klient inny niż ${list(labels)}` : `Klient: ${list(labels)}`;
    }
    case 'category':
      return condition.negate ? `Wydarzenie inne niż ${list(condition.values)}` : `Wydarzenie: ${list(condition.values)}`;
    case 'option': {
      const key = condition.variable.slice(CONTRACT_OPTION_PREFIX.length);
      const label = context.options?.find((option) => option.key === key)?.label || key;
      return condition.negate ? `Bez opcji: ${label}` : `Opcja: ${label}`;
    }
    case 'filled': {
      const label = context.fieldLabels?.[condition.variable] || condition.variable;
      return condition.negate ? `Gdy puste: ${label}` : `Gdy wypełnione: ${label}`;
    }
    default: {
      const label = context.fieldLabels?.[condition.variable] || condition.variable;
      return `${label} ${condition.negate ? '≠' : '='} ${list(condition.values)}`;
    }
  }
};
