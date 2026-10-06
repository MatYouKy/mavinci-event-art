import { getSharedContractClause } from './sharedContractClauses';

const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*?>/i;
const ESCAPED_HTML_PATTERN = /&lt;\/?(?:p|div|h[1-6]|ol|ul|li|strong|em|blockquote)\b/i;

export type ContractClausePrimaryCategory =
  | 'conditions'
  | 'requirements'
  | 'obligations'
  | 'risks'
  | 'additional_requirements';
export type ContractClauseCategory = ContractClausePrimaryCategory | 'general';
export type ContractClausesByCategory = Partial<Record<ContractClauseCategory, string>>;

export type ContractClauseTopicDefinition = {
  value: string;
  category: ContractClausePrimaryCategory;
  label: string;
};

export type ContractClauseEntry = {
  id: string;
  category: ContractClausePrimaryCategory;
  topic: string;
  title: string;
  content: string;
  sharedKey?: string;
  legacyId?: string;
};

export const CONTRACT_CLAUSE_CATEGORIES: ContractClauseCategory[] = [
  'conditions',
  'requirements',
  'obligations',
  'risks',
  'additional_requirements',
  'general',
];

export const CONTRACT_CLAUSE_PRIMARY_CATEGORIES: ContractClausePrimaryCategory[] = [
  'conditions',
  'requirements',
  'obligations',
  'risks',
  'additional_requirements',
];

export const CONTRACT_CLAUSE_CATEGORY_LABELS: Record<ContractClausePrimaryCategory, string> = {
  conditions: 'Warunki realizacji',
  requirements: 'Wymagania podstawowe',
  obligations: 'Obowiązki stron',
  risks: 'Ryzyka i odpowiedzialność',
  additional_requirements: 'Wymagania dodatkowe',
};

export const CONTRACT_CLAUSE_TOPICS: ContractClauseTopicDefinition[] = [
  { value: 'scope_condition', category: 'conditions', label: 'Warunek zakresu usługi' },
  { value: 'site_readiness', category: 'conditions', label: 'Gotowość miejsca' },
  { value: 'acceptance', category: 'conditions', label: 'Odbiór i akceptacja' },
  { value: 'approvals_condition', category: 'conditions', label: 'Zgody i dopuszczenia' },
  { value: 'dependencies', category: 'conditions', label: 'Zależności od innych usług' },
  { value: 'payment_condition', category: 'conditions', label: 'Warunek płatności' },
  { value: 'cancellation_condition', category: 'conditions', label: 'Warunek rezygnacji' },
  { value: 'other_condition', category: 'conditions', label: 'Inny warunek realizacji' },

  { value: 'people', category: 'requirements', label: 'Ludzie i obsada' },
  { value: 'resources', category: 'requirements', label: 'Sprzęt i zasoby' },
  { value: 'place', category: 'requirements', label: 'Miejsce realizacji' },
  { value: 'time', category: 'requirements', label: 'Czas i harmonogram' },
  { value: 'power', category: 'requirements', label: 'Prąd i zasilanie' },
  { value: 'access', category: 'requirements', label: 'Dostęp, wniesienie i rozładunek' },
  { value: 'internet', category: 'requirements', label: 'Internet i sieć' },
  { value: 'surface', category: 'requirements', label: 'Powierzchnia i podłoże' },
  { value: 'safety', category: 'requirements', label: 'Bezpieczeństwo' },
  { value: 'logistics', category: 'requirements', label: 'Logistyka techniczna' },
  { value: 'permissions', category: 'requirements', label: 'Pozwolenia obiektu' },
  { value: 'technical', category: 'requirements', label: 'Inne wymaganie techniczne' },

  { value: 'client_duties', category: 'obligations', label: 'Obowiązki Zamawiającego' },
  { value: 'contractor_duties', category: 'obligations', label: 'Obowiązki Wykonawcy' },
  { value: 'venue_duties', category: 'obligations', label: 'Obowiązki obiektu' },
  { value: 'cooperation', category: 'obligations', label: 'Współpraca stron' },
  { value: 'information', category: 'obligations', label: 'Informacje i materiały' },
  { value: 'approvals_duty', category: 'obligations', label: 'Uzyskanie zgód' },
  { value: 'payments', category: 'obligations', label: 'Płatności i rozliczenia' },
  { value: 'returns', category: 'obligations', label: 'Zwrot i odbiór mienia' },
  { value: 'confidentiality', category: 'obligations', label: 'Poufność' },
  { value: 'data_protection_duty', category: 'obligations', label: 'Ochrona danych' },
  { value: 'other_obligation', category: 'obligations', label: 'Inny obowiązek' },

  { value: 'health_safety', category: 'risks', label: 'Zdrowie i bezpieczeństwo' },
  { value: 'property_damage', category: 'risks', label: 'Uszkodzenie mienia' },
  { value: 'weather', category: 'risks', label: 'Pogoda i realizacja plenerowa' },
  { value: 'force_majeure', category: 'risks', label: 'Siła wyższa' },
  { value: 'infrastructure', category: 'risks', label: 'Infrastruktura obiektu' },
  { value: 'delay', category: 'risks', label: 'Opóźnienia' },
  { value: 'third_party', category: 'risks', label: 'Osoby i podmioty trzecie' },
  { value: 'technical_failure', category: 'risks', label: 'Awaria techniczna' },
  { value: 'power_failure', category: 'risks', label: 'Awaria lub brak zasilania' },
  { value: 'internet_failure', category: 'risks', label: 'Awaria lub brak internetu' },
  { value: 'cancellation_risk', category: 'risks', label: 'Odwołanie lub rezygnacja' },
  { value: 'liability', category: 'risks', label: 'Odpowiedzialność stron' },
  { value: 'insurance_risk', category: 'risks', label: 'Ubezpieczenie' },
  { value: 'data_protection_risk', category: 'risks', label: 'Ryzyko ochrony danych' },
  { value: 'intellectual_property', category: 'risks', label: 'Prawa autorskie i licencje' },
  { value: 'other_risk', category: 'risks', label: 'Inne ryzyko' },

  { value: 'accommodation', category: 'additional_requirements', label: 'Zakwaterowanie' },
  { value: 'backstage', category: 'additional_requirements', label: 'Zaplecze i garderoba' },
  { value: 'hospitality', category: 'additional_requirements', label: 'Catering i gościnność' },
  { value: 'parking', category: 'additional_requirements', label: 'Parking' },
  { value: 'transport', category: 'additional_requirements', label: 'Transport' },
  { value: 'security', category: 'additional_requirements', label: 'Ochrona' },
  { value: 'coordination', category: 'additional_requirements', label: 'Koordynacja' },
  { value: 'materials', category: 'additional_requirements', label: 'Materiały od klienta' },
  { value: 'documentation', category: 'additional_requirements', label: 'Dokumentacja' },
  { value: 'insurance_additional', category: 'additional_requirements', label: 'Dodatkowe ubezpieczenie' },
  { value: 'other_additional', category: 'additional_requirements', label: 'Inne wymaganie dodatkowe' },
];

export const getContractClauseTopicOptions = (category: ContractClausePrimaryCategory) =>
  CONTRACT_CLAUSE_TOPICS.filter((topic) => topic.category === category);

export const getContractClauseTopicLabel = (topic: string) =>
  CONTRACT_CLAUSE_TOPICS.find((definition) => definition.value === topic)?.label || 'Inny typ';

const normalizeClauseTopicText = (value: string) => String(value || '')
  .replace(/<[^>]+>/g, ' ')
  .toLocaleLowerCase('pl-PL')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ł/g, 'l')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const inferContractClauseTopic = (
  category: ContractClausePrimaryCategory,
  content: string,
) => {
  const value = normalizeClauseTopicText(content);
  if (category === 'requirements') {
    if (/zasil|230 v|400 v|trojfaz|gniazd|prad|obwod/.test(value)) return 'power';
    if (/internet|lacze|ethernet|wi fi|wifi|sieciow/.test(value)) return 'internet';
    if (/dostep|dojazd|wniesien|rozlad|winda|brama/.test(value)) return 'access';
    if (/godzin|termin|harmonogram|montaz|demontaz|proba/.test(value)) return 'time';
    if (/osob|technik|realizator|operator|obsluga|personel/.test(value)) return 'people';
    if (/sprzet|urzadzen|zasob|okablow|mikrofon|glosnik|ekran/.test(value)) return 'resources';
    if (/podloze|powierzch|rowne|suche|stabilne/.test(value)) return 'surface';
    if (/miejsce|sala|scena|stanowisko|przestrzen/.test(value)) return 'place';
    if (/bezpiecz|ewakuac|pozar|strefa/.test(value)) return 'safety';
    if (/zgod|pozwol|dopuszcz|akceptac.*obiekt/.test(value)) return 'permissions';
    if (/transport|logist|magazyn/.test(value)) return 'logistics';
    return 'technical';
  }
  if (category === 'conditions') {
    if (/gotow|przygotowan.*miej|warunk.*obiekt/.test(value)) return 'site_readiness';
    if (/odbior|akceptac|zatwierdz/.test(value)) return 'acceptance';
    if (/zgod|pozwol|dopuszcz/.test(value)) return 'approvals_condition';
    if (/platn|zaliczk|wplat/.test(value)) return 'payment_condition';
    if (/rezygn|odwol|anul/.test(value)) return 'cancellation_condition';
    if (/zalezn|pod warunkiem|jezeli|o ile/.test(value)) return 'dependencies';
    return 'scope_condition';
  }
  if (category === 'obligations') {
    if (/zamawiajac|klient/.test(value)) return 'client_duties';
    if (/wykonawc/.test(value)) return 'contractor_duties';
    if (/obiekt|sala|hotel/.test(value)) return 'venue_duties';
    if (/platn|wynagrodz|faktur/.test(value)) return 'payments';
    if (/informac|material|scenariusz|harmonogram/.test(value)) return 'information';
    if (/zgod|pozwol|licenc/.test(value)) return 'approvals_duty';
    if (/poufn/.test(value)) return 'confidentiality';
    if (/dane osob|rodo/.test(value)) return 'data_protection_duty';
    if (/zwrot|odbior.*sprzet|wydanie/.test(value)) return 'returns';
    return 'cooperation';
  }
  if (category === 'risks') {
    if (/sila wyzsza/.test(value)) return 'force_majeure';
    if (/pogod|deszcz|wiatr|plener/.test(value)) return 'weather';
    if (/uszkodz|zniszcz|mieni|kradziez/.test(value)) return 'property_damage';
    if (/opozn|spozn/.test(value)) return 'delay';
    if (/zasil|prad|napiec/.test(value)) return 'power_failure';
    if (/internet|lacze|sieci/.test(value)) return 'internet_failure';
    if (/awari|usterk|technicz/.test(value)) return 'technical_failure';
    if (/odwol|rezygn|anul/.test(value)) return 'cancellation_risk';
    if (/ubezpiec/.test(value)) return 'insurance_risk';
    if (/dane osob|rodo/.test(value)) return 'data_protection_risk';
    if (/autorsk|licenc|wizerun/.test(value)) return 'intellectual_property';
    if (/osob.*trzec|podmiot.*trzec/.test(value)) return 'third_party';
    if (/bezpiecz|wypad|zdrow|zyci/.test(value)) return 'health_safety';
    if (/infrastruktur|obiekt|instalac/.test(value)) return 'infrastructure';
    return 'liability';
  }
  if (/nocleg|hotel|zakwater/.test(value)) return 'accommodation';
  if (/garderob|backstage|zaplecze/.test(value)) return 'backstage';
  if (/catering|posilek|napoj|woda/.test(value)) return 'hospitality';
  if (/parking|miejsce postoj/.test(value)) return 'parking';
  if (/transport|przejazd/.test(value)) return 'transport';
  if (/ochron|security/.test(value)) return 'security';
  if (/koordyn|kontakt.*obiekt|osob.*kontakt/.test(value)) return 'coordination';
  if (/material|plik|logo|prezentac/.test(value)) return 'materials';
  if (/dokument|protokol|certyfikat/.test(value)) return 'documentation';
  if (/ubezpiec/.test(value)) return 'insurance_additional';
  return 'other_additional';
};

const stableClauseEntryId = (category: string, content: string, index: number) => {
  const source = `${category}:${index}:${normalizeClauseTopicText(content).slice(0, 320)}`;
  let hash = 2166136261;
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    hash ^= source.charCodeAt(cursor);
    hash = Math.imul(hash, 16777619);
  }
  return `clause-${Math.abs(hash >>> 0).toString(36)}`;
};

const asPrimaryCategory = (value: unknown): ContractClausePrimaryCategory | null => {
  const category = value === 'general' ? 'additional_requirements' : String(value || '');
  return CONTRACT_CLAUSE_PRIMARY_CATEGORIES.includes(category as ContractClausePrimaryCategory)
    ? category as ContractClausePrimaryCategory
    : null;
};

export const parseContractClauseEntries = (
  input: string | null | undefined,
  fallbackCategory: ContractClauseCategory = 'requirements',
): ContractClauseEntry[] => {
  const raw = String(input || '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === 2 && Array.isArray(parsed.entries)) {
      return parsed.entries.flatMap((entry: unknown, index: number) => {
        if (!entry || typeof entry !== 'object') return [];
        const candidate = entry as Partial<ContractClauseEntry>;
        const shared = getSharedContractClause(candidate.sharedKey);
        const category = asPrimaryCategory(shared?.category || candidate.category);
        const content = String(shared?.content || candidate.content || '').trim();
        if (!category || !content) return [];
        const allowedTopics = getContractClauseTopicOptions(category).map((topic) => topic.value);
        const topic = allowedTopics.includes(String(shared?.topic || candidate.topic || ''))
          ? String(shared?.topic || candidate.topic)
          : inferContractClauseTopic(category, content);
        return [{
          id: String(candidate.id || stableClauseEntryId(category, content, index)),
          category,
          topic,
          title: String(shared?.title || candidate.title || getContractClauseTopicLabel(topic)).trim(),
          content,
          ...(shared ? { sharedKey: shared.key } : {}),
          ...(typeof candidate.legacyId === 'string' ? { legacyId: candidate.legacyId } : {}),
        }];
      });
    }
  } catch {
    // Format historyczny zostanie obsłużony poniżej.
  }

  const grouped = parseContractClausesByCategory(raw, fallbackCategory);
  return CONTRACT_CLAUSE_CATEGORIES.flatMap((legacyCategory, index) => {
    const content = String(grouped[legacyCategory] || '').trim();
    const category = asPrimaryCategory(legacyCategory);
    if (!content || !category) return [];
    const topic = inferContractClauseTopic(category, content);
    return [{
      id: stableClauseEntryId(category, content, index),
      category,
      topic,
      title: getContractClauseTopicLabel(topic),
      content,
    }];
  });
};

export const serializeContractClauseEntries = (entries: ContractClauseEntry[]) =>
  JSON.stringify({
    version: 2,
    entries: entries
      .filter((entry) => entry.content.trim())
      .map((entry, index) => {
        const category = asPrimaryCategory(entry.category) || 'requirements';
        const topic = getContractClauseTopicOptions(category).some(
          (definition) => definition.value === entry.topic,
        )
          ? entry.topic
          : inferContractClauseTopic(category, entry.content);
        return {
          id: entry.id || stableClauseEntryId(category, entry.content, index),
          category,
          topic,
          title: String(entry.title || getContractClauseTopicLabel(topic)).trim(),
          content: entry.content.trim(),
          ...(getSharedContractClause(entry.sharedKey) ? { sharedKey: entry.sharedKey } : {}),
          ...(entry.legacyId ? { legacyId: entry.legacyId } : {}),
        };
      }),
  });

export const parseContractClausesByCategory = (
  input: string | null | undefined,
  fallbackCategory: ContractClauseCategory = 'requirements',
): ContractClausesByCategory => {
  const raw = String(input || '').trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (parsed.version === 2 && Array.isArray(parsed.entries)) {
        return parsed.entries.reduce<ContractClausesByCategory>((result, entry: unknown) => {
          if (!entry || typeof entry !== 'object') return result;
          const candidate = entry as Partial<ContractClauseEntry>;
          const category = asPrimaryCategory(candidate.category);
          const content = String(candidate.content || '').trim();
          if (!category || !content) return result;
          result[category] = `${result[category] || ''}${content}`;
          return result;
        }, {});
      }
      return CONTRACT_CLAUSE_CATEGORIES.reduce<ContractClausesByCategory>((result, category) => {
        const value = parsed[category];
        if (typeof value === 'string' && value.trim()) result[category] = value;
        return result;
      }, {});
    }
  } catch {
    // Starsze produkty przechowują pojedynczy blok HTML lub zwykłego tekstu.
  }

  return { [fallbackCategory]: raw };
};

export const serializeContractClausesByCategory = (clauses: ContractClausesByCategory) =>
  JSON.stringify(
    CONTRACT_CLAUSE_CATEGORIES.reduce<ContractClausesByCategory>((result, category) => {
      const value = String(clauses[category] || '').trim();
      if (value) result[category] = value;
      return result;
    }, {}),
  );

const ALLOWED_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'STRONG',
  'B',
  'EM',
  'I',
  'U',
  'S',
  'DEL',
  'BLOCKQUOTE',
  'OL',
  'UL',
  'LI',
  'BR',
]);

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const plainTextToHtml = (value: string) => {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let listType: 'ol' | 'ul' | null = null;
  let listMarker = '';

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
    listMarker = '';
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      return;
    }

    const bullet = line.match(/^[-*•]\s+(.+)$/u);
    const numbered = line.match(/^(\d+)([.)])\s+(.+)$/u);
    const lettered = line.match(/^([a-z])([.)])\s+(.+)$/iu);
    const nextType = bullet ? 'ul' : numbered || lettered ? 'ol' : null;
    // W umowie wszystkie listy numerowane mają ten sam zapis z kropką,
    // niezależnie od tego, czy autor klauzuli wpisał wcześniej `1)` czy `1.`.
    const nextMarker = numbered ? 'decimal' : lettered ? 'lower-alpha' : '';

    if (nextType) {
      if (listType !== nextType || listMarker !== nextMarker) {
        closeList();
        const markerAttribute = nextMarker ? ` data-clause-marker="${nextMarker}"` : '';
        html.push(`<${nextType}${markerAttribute}>`);
        listType = nextType;
        listMarker = nextMarker;
      }
      html.push(`<li>${escapeHtml(bullet?.[1] || numbered?.[3] || lettered?.[3] || '')}</li>`);
      return;
    }

    closeList();
    const isParagraphHeading = /^§\s*(?:n|\d+)\b/iu.test(line);
    html.push(
      isParagraphHeading
        ? `<p data-contract-paragraph="true" data-clause-role="paragraphHeading">${escapeHtml(line)}</p>`
        : `<p>${escapeHtml(line)}</p>`,
    );
  });

  closeList();
  return html.join('');
};

const decodeEscapedHtml = (value: string) => {
  if (typeof document === 'undefined' || !ESCAPED_HTML_PATTERN.test(value)) return value;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  const decoded = textarea.value;
  return HTML_TAG_PATTERN.test(decoded) ? decoded : value;
};

type QuillListItem = {
  node: HTMLLIElement;
  type: 'ordered' | 'bullet';
  indent: number;
};

const normalizeQuillList = (source: HTMLOListElement | HTMLUListElement) => {
  const sourceItems = Array.from(source.children).filter(
    (child): child is HTMLLIElement => child.tagName === 'LI',
  );
  if (!sourceItems.length) return;

  const hasQuillSemantics = sourceItems.some(
    (item) => item.hasAttribute('data-list') || /(?:^|\s)ql-indent-\d+(?:\s|$)/.test(item.className),
  );
  if (!hasQuillSemantics) return;

  const items: QuillListItem[] = sourceItems.map((item) => {
    const indentMatch = item.className.match(/(?:^|\s)ql-indent-(\d+)(?:\s|$)/);
    return {
      node: item,
      type: item.dataset.list === 'bullet' ? 'bullet' : 'ordered',
      indent: indentMatch ? Number(indentMatch[1]) : 0,
    };
  });

  const buildLevel = (
    startIndex: number,
    level: number,
  ): { fragment: DocumentFragment; index: number } => {
    const fragment = document.createDocumentFragment();
    let currentList: HTMLOListElement | HTMLUListElement | null = null;
    let currentType: QuillListItem['type'] | null = null;
    let lastItem: HTMLLIElement | null = null;
    let index = startIndex;

    while (index < items.length) {
      const item = items[index];
      if (item.indent < level) break;

      if (item.indent > level && lastItem) {
        const nested = buildLevel(index, level + 1);
        lastItem.appendChild(nested.fragment);
        index = nested.index;
        continue;
      }

      if (item.indent > level) item.indent = level;
      const effectiveType = item.type === 'bullet' ? 'bullet' : 'ordered';
      if (!currentList || currentType !== effectiveType) {
        currentList = document.createElement(effectiveType === 'bullet' ? 'ul' : 'ol');
        if (effectiveType === 'ordered') {
          currentList.dataset.clauseMarker = 'outline-decimal';
        }
        fragment.appendChild(currentList);
        currentType = effectiveType;
      }

      const cleanItem = document.createElement('li');
      if (item.node.dataset.clauseAlign) {
        cleanItem.dataset.clauseAlign = item.node.dataset.clauseAlign;
      }
      while (item.node.firstChild) cleanItem.appendChild(item.node.firstChild);
      currentList.appendChild(cleanItem);
      lastItem = cleanItem;
      index += 1;
    }

    return { fragment, index };
  };

  source.replaceWith(buildLevel(0, 0).fragment);
};

const convertElement = (element: HTMLElement, targetTag: string) => {
  const replacement = document.createElement(targetTag);
  Array.from(element.attributes).forEach((attribute) => {
    replacement.setAttribute(attribute.name, attribute.value);
  });
  while (element.firstChild) replacement.appendChild(element.firstChild);
  element.replaceWith(replacement);
  return replacement;
};

const normalizeMarkedParagraphLists = (container: HTMLElement) => {
  const parents = [container, ...Array.from(container.querySelectorAll<HTMLElement>('blockquote'))];
  parents.forEach((parent) => {
    let currentList: HTMLOListElement | HTMLUListElement | null = null;
    let currentMarker = '';

    Array.from(parent.children).forEach((child) => {
      if (!['P', 'DIV'].includes(child.tagName)) {
        currentList = null;
        currentMarker = '';
        return;
      }

      const text = child.textContent?.trim() || '';
      const bullet = text.match(/^[-*•]\s+(.+)$/u);
      const numbered = text.match(/^(\d+)([.)])\s+(.+)$/u);
      const lettered = text.match(/^([a-z])([.)])\s+(.+)$/iu);
      if (!bullet && !numbered && !lettered) {
        currentList = null;
        currentMarker = '';
        return;
      }

      const type = bullet ? 'ul' : 'ol';
      const marker = numbered ? 'decimal' : lettered ? 'lower-alpha' : '';
      if (!currentList || currentList.tagName.toLowerCase() !== type || currentMarker !== marker) {
        currentList = document.createElement(type) as HTMLOListElement | HTMLUListElement;
        if (marker) currentList.dataset.clauseMarker = marker;
        child.before(currentList);
        currentMarker = marker;
      }

      const item = document.createElement('li');
      item.textContent = bullet?.[1] || numbered?.[3] || lettered?.[3] || '';
      currentList.appendChild(item);
      child.remove();
    });
  });
};

const preserveStructuralFormatting = (container: HTMLElement) => {
  container.querySelectorAll<HTMLElement>('*').forEach((element) => {
    const classNames = element.getAttribute('class') || '';
    const classAlignment = classNames.match(/(?:^|\s)ql-align-(left|center|right|justify)(?:\s|$)/i)?.[1];
    const inlineAlignment = element.style?.textAlign;
    const alignment = (classAlignment || inlineAlignment || '').toLowerCase();
    if (['left', 'center', 'right', 'justify'].includes(alignment)) {
      element.dataset.clauseAlign = alignment;
    }

    const classIndent = classNames.match(/(?:^|\s)ql-indent-(\d+)(?:\s|$)/)?.[1];
    if (classIndent && element.tagName !== 'LI') {
      element.dataset.clauseIndent = String(Math.min(8, Number(classIndent)));
    }
  });
};

const applyListHierarchy = (container: HTMLElement) => {
  container.querySelectorAll<HTMLOListElement>('ol').forEach((list) => {
    if (list.dataset.clauseMarker) {
      // Snapshoty i starsze klauzule mogą nadal zawierać znaczniki `*-paren`.
      // Zachowujemy poziom listy, ale kanonizujemy sam separator do kropki.
      list.dataset.clauseMarker = list.dataset.clauseMarker.replace(/-paren$/, '');
      return;
    }
    list.dataset.clauseMarker = 'outline-decimal';
  });
};

/**
 * Zamienia treść z edytora klauzul na przewidywalny, semantyczny HTML.
 * Font, rozmiar, kolor, interlinia i odstępy należą wyłącznie do szablonu umowy.
 */
export const normalizeContractClauseHtml = (input: string | null | undefined) => {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';

  const decoded = decodeEscapedHtml(trimmed);
  const source = HTML_TAG_PATTERN.test(decoded) ? decoded : plainTextToHtml(decoded);
  if (typeof document === 'undefined') return source;

  const container = document.createElement('div');
  container.innerHTML = source;
  container.querySelectorAll('style, script, link, meta, iframe, object, embed').forEach((node) => node.remove());
  preserveStructuralFormatting(container);

  Array.from(container.querySelectorAll<HTMLOListElement | HTMLUListElement>('ol, ul'))
    .reverse()
    .forEach(normalizeQuillList);

  container.querySelectorAll<HTMLElement>('font, span').forEach((element) => {
    element.replaceWith(...Array.from(element.childNodes));
  });

  container.querySelectorAll<HTMLElement>('h4, h5, h6').forEach((element) => {
    convertElement(element, 'h3');
  });

  container.querySelectorAll<HTMLElement>('div').forEach((element) => {
    const hasBlockChildren = Boolean(element.querySelector(':scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > ol, :scope > ul, :scope > blockquote'));
    if (hasBlockChildren) element.replaceWith(...Array.from(element.childNodes));
    else convertElement(element, 'p');
  });

  Array.from(container.childNodes).forEach((node) => {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return;
    const paragraph = document.createElement('p');
    paragraph.textContent = node.textContent;
    node.replaceWith(paragraph);
  });

  normalizeMarkedParagraphLists(container);
  applyListHierarchy(container);

  container.querySelectorAll<HTMLElement>('p, h1, h2, h3').forEach((element) => {
    const text = element.textContent?.trim() || '';
    // Separator między pełnym numerem paragrafu a tytułem jest obowiązkowy.
    // Bez niego sam nagłówek „§ 11” mógł zostać przez backtracking regexu
    // rozcięty na „§ 1” oraz osobny tytuł „1”.
    const combinedHeading = text.match(
      /^(§\s*(?:n|\d+))(?:(?:[.\-–—:]\s*)|\s+)(\S[\s\S]*)$/iu,
    );
    if (!combinedHeading) return;

    const paragraphHeading = document.createElement('p');
    paragraphHeading.dataset.contractParagraph = 'true';
    paragraphHeading.dataset.clauseRole = 'paragraphHeading';
    if (element.dataset.clauseAlign) {
      paragraphHeading.dataset.clauseAlign = element.dataset.clauseAlign;
    }
    paragraphHeading.textContent = combinedHeading[1];

    const title = document.createElement('p');
    title.dataset.clauseRole = 'title';
    if (element.dataset.clauseAlign) title.dataset.clauseAlign = element.dataset.clauseAlign;
    title.textContent = combinedHeading[2];
    element.replaceWith(paragraphHeading, title);
  });

  container.querySelectorAll<HTMLElement>('p, h1, h2, h3').forEach((element) => {
    const text = element.textContent?.trim() || '';
    if (/^§\s*(?:n|\d+)\s*$/iu.test(text)) {
      element.dataset.contractParagraph = 'true';
      element.dataset.clauseRole = 'paragraphHeading';
    } else if (/^H[1-3]$/.test(element.tagName)) {
      element.dataset.clauseRole = 'title';
    }
  });

  Array.from(container.querySelectorAll<HTMLElement>('*')).reverse().forEach((element) => {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }

    Array.from(element.attributes).forEach((attribute) => {
      const keep =
        (attribute.name === 'data-contract-paragraph' && element.matches('p, h1, h2, h3')) ||
        (attribute.name === 'data-clause-role' && element.matches('p, h1, h2, h3, li')) ||
        (attribute.name === 'data-clause-align' && element.matches('p, h1, h2, h3, li, blockquote')) ||
        (attribute.name === 'data-clause-indent' && element.matches('p, h1, h2, h3, blockquote')) ||
        (attribute.name === 'data-clause-marker' && element.matches('ol')) ||
        (attribute.name === 'data-contract-list-continuation' && element.matches('ol, ul')) ||
        (attribute.name === 'data-contract-list-item-continuation' && element.matches('li')) ||
        (attribute.name === 'start' && element.matches('ol'));
      if (!keep) element.removeAttribute(attribute.name);
    });
  });

  container.querySelectorAll<HTMLElement>('p, h1, h2, h3, li, blockquote').forEach((element) => {
    if (!element.textContent?.trim() && !element.querySelector('br, ol, ul')) element.remove();
  });

  return container.innerHTML.trim();
};

const isClauseStructuralHeading = (element: HTMLElement) =>
  element.dataset.contractParagraph === 'true' ||
  element.dataset.clauseRole === 'paragraphHeading' ||
  element.dataset.clauseRole === 'title' ||
  /^H[1-6]$/.test(element.tagName);

const copyClauseBlockToListItem = (source: HTMLElement) => {
  const item = document.createElement('li');
  if (source.dataset.clauseRole) item.dataset.clauseRole = source.dataset.clauseRole;
  if (source.dataset.clauseAlign) item.dataset.clauseAlign = source.dataset.clauseAlign;
  while (source.firstChild) item.appendChild(source.firstChild);
  return item;
};

/**
 * Każdy zwykły akapit klauzuli produktu jest punktem umowy. Numery nie są
 * częścią treści: wynikają z kolejności elementów listy, dzięki czemu dodanie,
 * usunięcie lub przesunięcie klauzuli automatycznie aktualizuje numerację.
 * Zagnieżdżenia są wyliczane jako 1., 1.1, 1.1.1 itd.
 */
export const normalizeContractClausePointListHtml = (
  input: string | null | undefined,
) => {
  const normalized = normalizeContractClauseHtml(input);
  if (!normalized || typeof document === 'undefined') return normalized;

  const container = document.createElement('div');
  container.innerHTML = normalized;
  let currentList: HTMLOListElement | null = null;
  let lastTopLevelItem: HTMLLIElement | null = null;

  const ensureCurrentList = (before: Element) => {
    if (currentList) return currentList;
    currentList = document.createElement('ol');
    currentList.dataset.clauseMarker = 'outline-decimal';
    currentList.dataset.clauseAutoPoints = 'true';
    before.before(currentList);
    return currentList;
  };

  Array.from(container.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;

    if (isClauseStructuralHeading(child)) {
      currentList = null;
      lastTopLevelItem = null;
      return;
    }

    if (child.tagName === 'OL') {
      const list = child as HTMLOListElement;
      const marker = list.dataset.clauseMarker || 'decimal';
      list.removeAttribute('start');

      if (
        [
          'lower-alpha',
          'lower-roman',
          'lower-alpha-paren',
          'lower-roman-paren',
          'bullet',
        ].includes(marker)
      ) {
        if (lastTopLevelItem) {
          lastTopLevelItem.appendChild(list);
          return;
        }
        currentList = null;
        return;
      }

      const target = ensureCurrentList(list);
      Array.from(list.children).forEach((item) => {
        if (item.tagName !== 'LI') return;
        target.appendChild(item);
        lastTopLevelItem = item as HTMLLIElement;
      });
      list.remove();
      return;
    }

    if (child.tagName === 'UL') {
      if (lastTopLevelItem) lastTopLevelItem.appendChild(child);
      else currentList = null;
      return;
    }

    if (child.matches('p, div, blockquote')) {
      const target = ensureCurrentList(child);
      const item = copyClauseBlockToListItem(child);
      target.appendChild(item);
      lastTopLevelItem = item;
      child.remove();
      return;
    }

    currentList = null;
    lastTopLevelItem = null;
  });

  applyListHierarchy(container);
  return container.innerHTML.trim();
};

export const getContractClauseSlotIndentLevel = (slot: HTMLElement | null) => {
  if (!slot) return 0;

  const savedLevel = Number(
    slot.dataset.contractClauseIndent || slot.dataset.editorIndent || 0,
  );
  const classLevel = Array.from(slot.classList)
    .map((className) => className.match(/^ql-indent-(\d+)$/)?.[1])
    .find(Boolean);
  const marginLevel = slot.style.marginLeft.endsWith('mm')
    ? Math.round((Number.parseFloat(slot.style.marginLeft) || 0) / 12.7)
    : slot.style.marginLeft.endsWith('em')
      ? Math.round((Number.parseFloat(slot.style.marginLeft) || 0) / 1.5)
      : 0;

  return Math.min(8, Math.max(0, savedLevel, Number(classLevel || 0), marginLevel));
};

/**
 * Wylicza jedną numerację punktów dla całego paragrafu umowy. Obejmuje zarówno
 * listy zapisane w szablonie, jak i listy dostawione z klauzul produktów.
 * Nowy § rozpoczyna numerację od 1.
 */
export const resolveContractClausePointNumbersInElement = (root: HTMLElement) => {
  let nextPointNumber = 1;
  const indentedSlotContexts = new Map<HTMLElement, { prefix: string; next: number }>();
  const orderedElements = Array.from(
    root.querySelectorAll<HTMLElement>(
      '[data-contract-paragraph="true"], [data-clause-role="paragraphHeading"], .contract-paragraph-heading, ol',
    ),
  );

  orderedElements.forEach((element) => {
    if (
      element.dataset.contractParagraph === 'true' ||
      element.dataset.clauseRole === 'paragraphHeading' ||
      element.classList.contains('contract-paragraph-heading')
    ) {
      nextPointNumber = 1;
      return;
    }
    if (element.tagName !== 'OL' || element.parentElement?.closest('ol, ul')) return;

    const list = element as HTMLOListElement;
    const marker = (list.dataset.clauseMarker || '').replace(/-paren$/, '');
    const type = (list.getAttribute('type') || '').toLowerCase();
    const inlineListStyle = list.style.listStyleType.toLowerCase();
    const isDecimal = marker
      ? marker === 'decimal' || marker === 'outline-decimal'
      : (!type || type === '1') && !/(alpha|roman)/.test(inlineListStyle);
    if (!isDecimal) return;

    Array.from(list.children).forEach((child) => {
      if (child.tagName !== 'LI') return;
      const item = child as HTMLLIElement;
      if (!item.textContent?.trim() && !item.querySelector('img, table, ol, ul')) item.remove();
    });
    const directItems = Array.from(list.children).filter(
      (child): child is HTMLLIElement => child.tagName === 'LI',
    );
    if (directItems.length === 0) {
      list.remove();
      return;
    }

    const clauseSlot = list.closest<HTMLElement>('[data-contract-clause-slot]');
    const clauseIndentLevel = getContractClauseSlotIndentLevel(clauseSlot);
    if (clauseSlot && clauseIndentLevel > 0) {
      let context = indentedSlotContexts.get(clauseSlot);

      if (!context) {
        const precedingOutlineNumbers = Array.from(
          root.querySelectorAll<HTMLLIElement>('li[data-contract-outline-number]'),
        )
          .filter(
            (item) =>
              !clauseSlot.contains(item) &&
              Boolean(item.compareDocumentPosition(clauseSlot) & Node.DOCUMENT_POSITION_FOLLOWING),
          )
          .map((item) =>
            String(item.dataset.contractOutlineNumber || '')
              .replace(/\.$/, '')
              .split('.')
              .map((part) => Number(part))
              .filter((part) => Number.isFinite(part) && part > 0),
          )
          .filter((parts) => parts.length >= clauseIndentLevel);
        const nearestOutlineNumber = precedingOutlineNumbers.at(-1);

        if (nearestOutlineNumber) {
          const prefixParts = nearestOutlineNumber.slice(0, clauseIndentLevel);
          const siblingNumbers = precedingOutlineNumbers
            .filter(
              (parts) =>
                parts.length === clauseIndentLevel + 1 &&
                prefixParts.every((part, index) => parts[index] === part),
            )
            .map((parts) => parts[clauseIndentLevel]);
          context = {
            prefix: prefixParts.join('.'),
            next: Math.max(0, ...siblingNumbers) + 1,
          };
          indentedSlotContexts.set(clauseSlot, context);
        }
      }

      if (context) {
        directItems.forEach((item) => {
          item.dataset.contractOutlineNumber = `${context!.prefix}.${context!.next}`;
          item.value = context!.next;
          context!.next += 1;
        });
        list.dataset.contractClauseOutlineIntegrated = 'true';
        return;
      }
    }

    const firstItemContinues =
      list.dataset.contractListContinuation === 'true' ||
      directItems[0]?.dataset.contractListItemContinuation === 'true';
    const listStart = firstItemContinues
      ? Math.max(1, nextPointNumber - 1)
      : nextPointNumber;
    list.setAttribute('start', String(listStart));
    // Sam atrybut `start` na liście nie wystarczał po podziale listy pomiędzy
    // strony albo po wstawieniu kilku osobnych bloków klauzul. Nadajemy więc
    // wartość każdemu punktowi. Klony tworzone podczas paginacji zachowują
    // `value`, a fragment kontynuowany ma ten sam numer z ukrytym markerem.
    let itemNumber = listStart;
    directItems.forEach((item, index) => {
      if (index === 0 && firstItemContinues) {
        item.value = listStart;
        itemNumber = listStart + 1;
        return;
      }
      item.value = itemNumber;
      itemNumber += 1;
    });
    nextPointNumber = Math.max(nextPointNumber, itemNumber);
  });
};

const normalizeHeadingComparisonText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[„”“\"'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const HEADING_TOPIC_PATTERN =
  /\b(?:ryzyk|odpowiedzial|wymagan|obowiazk|bezpieczen|postanowien|klauzul|warunk)\w*\b/i;

/**
 * Starsze klauzule miały w treści nagłówek z nazwą produktu, np.
 * „Totem multimedialny 55” – ryzyka i odpowiedzialność”. W umowie produkt
 * jest już wskazany w zakresie, więc usuwamy wyłącznie taki redundantny nagłówek.
 */
export const stripProductNameHeadingFromClauseHtml = (
  input: string | null | undefined,
  productName: string | null | undefined,
) => {
  const html = String(input || '').trim();
  const normalizedProductName = normalizeHeadingComparisonText(String(productName || ''));
  if (!html || !normalizedProductName || typeof document === 'undefined') return html;

  const productTokens = normalizedProductName
    .split(' ')
    .filter((token) => token.length >= 2);
  if (!productTokens.length) return html;

  const container = document.createElement('div');
  container.innerHTML = html;
  const candidates = Array.from(container.children).slice(0, 4) as HTMLElement[];

  candidates.forEach((element) => {
    const text = normalizeHeadingComparisonText(element.textContent || '');
    if (!text || text.length > 180) return;

    const overlap = productTokens.filter((token) => text.includes(token)).length;
    const containsProductName =
      text.includes(normalizedProductName) ||
      normalizedProductName.includes(text) ||
      (overlap >= 2 && overlap / productTokens.length >= 0.5);
    const isHeading =
      /^H[1-6]$/.test(element.tagName) ||
      element.dataset.clauseRole === 'title' ||
      (element.children.length === 1 && ['STRONG', 'B'].includes(element.firstElementChild?.tagName || '')) ||
      HEADING_TOPIC_PATTERN.test(text);

    if (containsProductName && isHeading) element.remove();
  });

  return container.innerHTML.trim();
};

export const hasContractClauseContent = (input: string | null | undefined) => {
  const normalized = normalizeContractClauseHtml(input);
  if (!normalized) return false;
  if (typeof document === 'undefined') return Boolean(normalized.replace(/<[^>]+>/g, '').trim());
  const container = document.createElement('div');
  container.innerHTML = normalized;
  return Boolean(container.textContent?.trim() || container.querySelector('ol, ul, blockquote'));
};
