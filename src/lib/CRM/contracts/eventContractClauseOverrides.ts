import type {
  ContractClauseCategory,
  ContractClausePrimaryCategory,
} from './contractClauseContent';

export type EventContractClauseSource = 'automatic' | 'custom';

export type EventContractClauseBase = {
  id: string;
  category: ContractClausePrimaryCategory;
  topic: string;
  title: string;
  productName: string;
  html: string;
  preview: string;
  sharedKey?: string;
  legacyOverrideId?: string;
};

export type EventContractClauseItem = {
  id: string;
  category: ContractClauseCategory;
  topic: string;
  title: string;
  productName: string;
  html: string;
  preview: string;
  enabled: boolean;
  source: EventContractClauseSource;
  baseHtml: string;
  sharedKey?: string;
  legacyOverrideId?: string;
};

type StoredEventContractClauseOverride = {
  enabled?: boolean;
  html?: string;
  detachedSharedClause?: boolean;
};

type StoredEventContractCustomClause = {
  id: string;
  category: ContractClauseCategory;
  topic: string;
  title: string;
  productName: string;
  html: string;
  enabled?: boolean;
};

export type EventContractClauseOverrides = {
  version: 1;
  overrides: Record<string, StoredEventContractClauseOverride>;
  custom: StoredEventContractCustomClause[];
};

const EVENT_CONTRACT_CLAUSE_CATEGORIES: ContractClauseCategory[] = [
  'conditions',
  'requirements',
  'obligations',
  'risks',
  'additional_requirements',
  'general',
];

const isClauseCategory = (value: unknown): value is ContractClauseCategory =>
  EVENT_CONTRACT_CLAUSE_CATEGORIES.includes(value as ContractClauseCategory);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeHtmlForComparison = (value: string) =>
  String(value || '').replace(/\s+/g, ' ').trim();

export const parseEventContractClauseOverrides = (
  value: unknown,
): EventContractClauseOverrides => {
  const parsed = typeof value === 'string'
    ? (() => {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      })()
    : value;

  if (!isRecord(parsed)) {
    return { version: 1, overrides: {}, custom: [] };
  }

  const overrides = isRecord(parsed.overrides)
    ? Object.entries(parsed.overrides).reduce<Record<string, StoredEventContractClauseOverride>>(
        (result, [id, override]) => {
          if (!isRecord(override)) return result;
          const normalized: StoredEventContractClauseOverride = {};
          if (typeof override.enabled === 'boolean') normalized.enabled = override.enabled;
          if (typeof override.html === 'string') normalized.html = override.html;
          if (override.detachedSharedClause === true) normalized.detachedSharedClause = true;
          if (Object.keys(normalized).length > 0) result[id] = normalized;
          return result;
        },
        {},
      )
    : {};

  const custom = Array.isArray(parsed.custom)
    ? parsed.custom.flatMap((entry): StoredEventContractCustomClause[] => {
        if (!isRecord(entry) || !isClauseCategory(entry.category)) return [];
        const html = typeof entry.html === 'string' ? entry.html.trim() : '';
        if (!html) return [];
        return [{
          id: typeof entry.id === 'string' && entry.id
            ? entry.id
            : `event-custom:${Math.random().toString(36).slice(2)}`,
          category: entry.category,
          topic: typeof entry.topic === 'string' && entry.topic ? entry.topic : 'event_custom',
          title: typeof entry.title === 'string' && entry.title
            ? entry.title
            : 'Ustalenie dla wydarzenia',
          productName: typeof entry.productName === 'string' && entry.productName
            ? entry.productName
            : 'Sugestia klienta',
          html,
          enabled: entry.enabled !== false,
        }];
      })
    : [];

  return { version: 1, overrides, custom };
};

export const buildEventContractClauseItems = (
  automaticClauses: EventContractClauseBase[],
  storedValue: unknown,
): EventContractClauseItem[] => {
  const stored = parseEventContractClauseOverrides(storedValue);
  const usedLegacyReplacements = new Set<string>();
  const automaticItems = automaticClauses.map<EventContractClauseItem>((clause) => {
    const direct = stored.overrides[clause.id];
    const legacy = clause.legacyOverrideId ? stored.overrides[clause.legacyOverrideId] : undefined;
    const override = direct || legacy;
    const usesLegacyReplacement = !direct && typeof legacy?.html === 'string';
    const legacyReplacementUsed = usesLegacyReplacement && usedLegacyReplacements.has(clause.legacyOverrideId!);
    if (usesLegacyReplacement) usedLegacyReplacements.add(clause.legacyOverrideId!);
    const html = typeof override?.html === 'string' ? override.html : clause.html;
    return {
      ...clause,
      html,
      preview: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 420),
      enabled: override?.enabled !== false && !legacyReplacementUsed,
      sharedKey: usesLegacyReplacement || override?.detachedSharedClause ? undefined : clause.sharedKey,
      source: 'automatic',
      baseHtml: clause.html,
    };
  });

  const customItems = stored.custom.map<EventContractClauseItem>((clause) => ({
    ...clause,
    preview: clause.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 420),
    enabled: clause.enabled !== false,
    source: 'custom',
    baseHtml: clause.html,
  }));

  return [...automaticItems, ...customItems];
};

export const serializeEventContractClauseItems = (
  items: EventContractClauseItem[],
): EventContractClauseOverrides => {
  const overrides = items
    .filter((item) => item.source === 'automatic')
    .reduce<Record<string, StoredEventContractClauseOverride>>((result, item) => {
      const override: StoredEventContractClauseOverride = {};
      // Zapis historycznego zastąpienia całej grupy nie może przy ponownym
      // odczycie stać się nowym brzmieniem pojedynczej wspólnej zasady.
      if (!item.sharedKey && item.legacyOverrideId) override.detachedSharedClause = true;
      if (!item.enabled) override.enabled = false;
      if (
        normalizeHtmlForComparison(item.html) !==
        normalizeHtmlForComparison(item.baseHtml)
      ) {
        override.html = item.html;
      }
      if (Object.keys(override).length > 0) result[item.id] = override;
      return result;
    }, {});

  const custom = items
    .filter((item) => item.source === 'custom' && item.html.trim())
    .map<StoredEventContractCustomClause>((item) => ({
      id: item.id,
      category: item.category,
      topic: item.topic || 'event_custom',
      title: item.title || 'Ustalenie dla wydarzenia',
      productName: item.productName || 'Sugestia klienta',
      html: item.html,
      enabled: item.enabled,
    }));

  return { version: 1, overrides, custom };
};
