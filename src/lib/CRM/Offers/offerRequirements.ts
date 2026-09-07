export type OfferRequirementOrigin = 'template' | 'product' | 'manual';

export type OfferRequirementEntry = {
  key: string;
  category: string;
  title: string;
  description: string;
  sources: string[];
  origin: OfferRequirementOrigin;
  included: boolean;
  priority: number;
};

type ProductRequirementSource = {
  name?: string | null;
  product?: {
    name?: string | null;
    offer_requirements?: string[] | null;
    offer_additional_requirements?: Array<{
      category?: string | null;
      title?: string | null;
      description?: string | null;
    }> | null;
  } | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  people: 'LUDZIE I OBSADA', resources: 'SPRZĘT I ZASOBY', place: 'MIEJSCE REALIZACJI',
  time: 'CZAS I HARMONOGRAM',
  power: 'ZASILANIE', internet: 'ŁĄCZE INTERNETOWE', access: 'DOSTĘP DO OBIEKTU',
  coordination: 'KOORDYNACJA Z OBIEKTEM', setup: 'MONTAŻ I PRÓBA', schedule: 'HARMONOGRAM',
  surface: 'MIEJSCE REALIZACJI', venue_approval: 'ZGODA OBIEKTU', safety: 'BEZPIECZEŃSTWO',
  accommodation: 'ZAKWATEROWANIE', backstage: 'ZAPLECZE / GARDEROBA',
  hospitality: 'GOŚCINNOŚĆ / CATERING', logistics: 'LOGISTYKA', other: 'INNE WYMAGANIE',
  permissions: 'POZWOLENIA OBIEKTU',
  technical: 'WARUNEK TECHNICZNY',
};

const normalize = (value: string) => value.toLocaleLowerCase('pl-PL').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, ' ').trim();

const fingerprint = (value: string) => normalize(value).split(' ')
  .filter((word) => word.length > 2 && !['oraz', 'dla', 'przed', 'przez', 'jest', 'byc', 'miec'].includes(word))
  .slice(0, 10).sort().join('-');

export const splitOfferRequirementLines = (value: unknown) => String(value || '').split(/\r?\n/)
  .map((line) => line.replace(/^\s*(?:[-–—•]|\d+[.)])\s*/, '').trim()).filter(Boolean);

export const inferOfferRequirementCategory = (description: string, preferred?: string) => {
  const value = normalize(description);
  if (/zasil|230\s*v|230v|400\s*v|400v|3\s*faz|trojfaz|sila|gniazd|prad|obwod/.test(value)) return 'power';
  if (/internet|lacze|ethernet|wi fi|wifi|sieciow/.test(value)) return 'internet';
  if (/osob|technik|realizator|operator|obsluga|personel|ekipa/.test(value)) return 'people';
  if (/sprzet|urzadzen|zasob|okablow|mikrofon|glosnik|ekran|projektor/.test(value)) return 'resources';
  if (/zgod.*obiekt|akceptac.*obiekt|dopuszcz|czujek|przeciwpozar/.test(value)) return 'venue_approval';
  if (/kontakt|koordyn|osob.*decyzyjn|osob.*technicz/.test(value)) return 'coordination';
  if (/montaz|demontaz|proba|wczesniejsz.*wejsc|wyprzedzeniem/.test(value)) return 'setup';
  if (/harmonogram|scenariusz|moment|program wydarzenia/.test(value)) return 'schedule';
  if (/godzin|termin|czas realizac|okno czasow/.test(value)) return 'time';
  if (/dostep|dojazd|wniesien|transportow/.test(value)) return 'access';
  if (/rowne|stabilne|suche|podloze|stanowisko|powierzchni/.test(value)) return 'surface';
  if (/miejsce|sala|scena|przestrzen/.test(value)) return 'place';
  if (/bezpiecz|strefa|ewakuac|latwopal/.test(value)) return 'safety';
  return preferred && CATEGORY_LABELS[preferred] ? preferred : 'technical';
};

export const getOfferRequirementPriority = (category: string, description: string) => {
  const value = normalize(description);
  let priority = Math.min(80, value.length);
  if (category === 'power') {
    if (/400\s*v|400v|3\s*faz|trojfaz|sila/.test(value)) priority += 500;
    else if (/230\s*v|230v/.test(value)) priority += 300;
    else priority += 100;
    if (/32\s*a|32a|63\s*a|63a|kw/.test(value)) priority += 60;
    if (/dedykowan|osobn.*obwod/.test(value)) priority += 30;
  }
  if (category === 'internet') {
    if (/ethernet|przewod/.test(value)) priority += 500;
    else if (/stabiln|gwarantowan/.test(value)) priority += 300;
    else if (/wi fi|wifi/.test(value)) priority += 100;
    if (/mb\/s|mbps|gb\/s|gbps/.test(value)) priority += 80;
  }
  if (category === 'access' && /ciezar|bus|samochod|bezposredni dojazd/.test(value)) priority += 200;
  return priority;
};

const requirementKey = (category: string, description: string) => {
  if (['people', 'resources', 'place', 'time', 'power', 'internet', 'access', 'coordination', 'setup', 'schedule', 'surface', 'venue_approval'].includes(category)) return category;
  return `${category}:${fingerprint(description) || 'requirement'}`;
};

const ensureSentence = (value: string) => {
  const result = value.replace(/\s+/g, ' ').trim();
  return !result || /[.!?]$/.test(result) ? result : `${result}.`;
};

const addEntry = (target: Map<string, OfferRequirementEntry>, candidate: Omit<OfferRequirementEntry, 'key' | 'priority'> & { key?: string; priority?: number }) => {
  const description = ensureSentence(candidate.description || candidate.title);
  if (!description) return;
  const category = candidate.category && CATEGORY_LABELS[candidate.category]
    ? candidate.category
    : inferOfferRequirementCategory(description);
  const key = candidate.key || requirementKey(category, description);
  const priority = candidate.priority ?? getOfferRequirementPriority(category, description);
  const existing = target.get(key);
  const sources = [...new Set([...(existing?.sources || []), ...candidate.sources.filter(Boolean)])];
  if (!existing || priority > existing.priority || (priority === existing.priority && description.length > existing.description.length)) {
    target.set(key, { ...candidate, key, category, title: candidate.title.trim() || CATEGORY_LABELS[category] || CATEGORY_LABELS.other, description, sources, priority });
  } else {
    target.set(key, { ...existing, sources });
  }
};

export const buildOfferRequirements = ({
  templateRequirements,
  items,
  storedRequirements,
  refreshAutomaticSources = false,
}: {
  templateRequirements?: string | null;
  items?: ProductRequirementSource[] | null;
  storedRequirements?: OfferRequirementEntry[] | null;
  refreshAutomaticSources?: boolean;
}) => {
  const derived = new Map<string, OfferRequirementEntry>();
  const hasStoredRequirements = Array.isArray(storedRequirements) && storedRequirements.length > 0;
  if (!hasStoredRequirements || refreshAutomaticSources) {
    splitOfferRequirementLines(templateRequirements).forEach((description) => {
      const category = inferOfferRequirementCategory(description);
      addEntry(derived, { category, title: CATEGORY_LABELS[category] || CATEGORY_LABELS.technical, description, sources: ['Szablon główny oferty'], origin: 'template', included: true });
    });
    (items || []).forEach((item) => {
      const productName = String(item.name || item.product?.name || 'Produkt').trim();
      (item.product?.offer_requirements || []).forEach((description) => {
        if (typeof description !== 'string' || !description.trim()) return;
        const category = inferOfferRequirementCategory(description);
        addEntry(derived, { category, title: CATEGORY_LABELS[category] || CATEGORY_LABELS.technical, description, sources: [productName], origin: 'product', included: true });
      });
      (item.product?.offer_additional_requirements || []).forEach((requirement) => {
        const description = String(requirement?.description || requirement?.title || '').trim();
        if (!description) return;
        const category = inferOfferRequirementCategory(description, String(requirement?.category || 'other'));
        addEntry(derived, { category, title: String(requirement?.title || CATEGORY_LABELS[category] || CATEGORY_LABELS.other).toLocaleUpperCase('pl-PL'), description, sources: [productName], origin: 'product', included: true });
      });
    });
  }
  (storedRequirements || []).forEach((stored) => {
    if (!stored || typeof stored !== 'object') return;
    const description = String(stored.description || stored.title || '').trim();
    if (!description) return;
    const category = stored.category && CATEGORY_LABELS[stored.category]
      ? stored.category
      : inferOfferRequirementCategory(description);
    const key = stored.origin === 'manual' && stored.key
      ? stored.key
      : requirementKey(category, description);
    const priority = getOfferRequirementPriority(category, description);
    const current = derived.get(key);
    const shared = { key, category, sources: [...new Set([...(current?.sources || []), ...(stored.sources || [])].filter(Boolean))], included: stored.included !== false };
    if (!current || stored.origin === 'manual' || priority >= current.priority) {
      derived.set(key, { ...stored, ...shared, title: String(stored.title || CATEGORY_LABELS[category] || CATEGORY_LABELS.other).trim(), description: ensureSentence(description), origin: stored.origin || 'manual', priority });
    } else {
      derived.set(key, { ...current, ...shared });
    }
  });
  const order = [
    'people', 'resources', 'place', 'time', 'power', 'internet', 'access',
    'setup', 'surface', 'venue_approval', 'permissions', 'coordination',
    'schedule', 'safety', 'accommodation', 'backstage', 'hospitality',
    'logistics', 'technical', 'other',
  ];
  const uniqueByDescription = new Map<string, OfferRequirementEntry>();
  derived.forEach((entry) => {
    const descriptionKey = normalize(entry.description);
    const existing = uniqueByDescription.get(descriptionKey);
    if (!existing) {
      uniqueByDescription.set(descriptionKey, entry);
      return;
    }
    uniqueByDescription.set(descriptionKey, {
      ...(entry.priority > existing.priority ? entry : existing),
      sources: [...new Set([...existing.sources, ...entry.sources])],
      included: existing.included && entry.included,
    });
  });
  const groupedByTitle = new Map<string, { entry: OfferRequirementEntry; descriptions: string[] }>();
  uniqueByDescription.forEach((entry) => {
    const titleKey = normalize(entry.title) || entry.category;
    const existing = groupedByTitle.get(titleKey);
    if (!existing) {
      groupedByTitle.set(titleKey, { entry, descriptions: [entry.description] });
      return;
    }
    const descriptions = [...existing.descriptions];
    if (!descriptions.some((description) => normalize(description) === normalize(entry.description))) descriptions.push(entry.description);
    groupedByTitle.set(titleKey, {
      entry: {
        ...(entry.priority > existing.entry.priority ? entry : existing.entry),
        sources: [...new Set([...existing.entry.sources, ...entry.sources])],
        included: existing.entry.included && entry.included,
      },
      descriptions,
    });
  });
  return [...groupedByTitle.values()]
    .map(({ entry, descriptions }) => ({
      ...entry,
      description: descriptions.length > 1
        ? descriptions.map((description) => `• ${description}`).join('\n')
        : descriptions[0],
    }))
    .sort((a, b) => ((order.indexOf(a.category) < 0 ? 99 : order.indexOf(a.category)) - (order.indexOf(b.category) < 0 ? 99 : order.indexOf(b.category))) || b.priority - a.priority || a.title.localeCompare(b.title, 'pl'));
};

export const getOfferRequirementLabel = (category: string) => CATEGORY_LABELS[category] || CATEGORY_LABELS.other;
