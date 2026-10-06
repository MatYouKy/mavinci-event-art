import catalog from './sharedContractClauses.json';
import legacyAliases from './legacySharedClauseAliases.json';
import type { ContractClausePrimaryCategory } from './contractClauseContent';

export type SharedContractClause = {
  key: string;
  category: ContractClausePrimaryCategory;
  topic: string;
  title: string;
  content: string;
};

export const SHARED_CONTRACT_CLAUSES = catalog as SharedContractClause[];
export const getSharedContractClause = (key: unknown) =>
  typeof key === 'string' ? SHARED_CONTRACT_CLAUSES.find((clause) => clause.key === key) : undefined;
export const CONTRACT_STRUCTURE_VERSION = 1;

// Tylko kompletne, rozpoznane brzmienie historyczne. Inne ustalenia oferty
// pozostają bez zmian, nawet jeśli dotyczą podobnego tematu.
export const getSharedContractClauseForText = (text: string) => {
  const identity = text.replace(/\s+/g, ' ').trim().toLocaleLowerCase('pl-PL');
  return getSharedContractClause((legacyAliases as Record<string, string>)[identity]) ||
    SHARED_CONTRACT_CLAUSES.find((clause) => clause.content.replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ').trim().toLocaleLowerCase('pl-PL') === identity);
};
