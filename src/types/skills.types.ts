/** Wewnętrzne wartości numeryczne do łatwych porównań: 1..5 */
export type SkillLevel = 1 | 2 | 3 | 4 | 5;

/** Brak wpisu/oceny = null */
export type SkillProficiency = SkillLevel | null;

/** Etykiety po polsku (użyteczne w UI) */
export const SkillLevelLabels: Record<SkillLevel, string> = {
  1: 'Podstawowy',
  2: 'Średni',
  3: 'Średniozaawansowany',
  4: 'Zaawansowany',
  5: 'Ekspert',
} as const;

/** Opcjonalnie: mapowanie na skróty / klucze tekstowe (np. do API) */
export type SkillLevelKey = 'basic' | 'intermediate' | 'upper_intermediate' | 'advanced' | 'expert';

export const SkillLevelFromKey: Record<SkillLevelKey, SkillLevel> = {
  basic: 1,
  intermediate: 2,
  upper_intermediate: 3,
  advanced: 4,
  expert: 5,
} as const;

export const SkillLevelToKey: Record<SkillLevel, SkillLevelKey> = {
  1: 'basic',
  2: 'intermediate',
  3: 'upper_intermediate',
  4: 'advanced',
  5: 'expert',
} as const;

export interface IExtraSkills {
  skill: string;
  skillProficiency: SkillProficiency;
  experience?: number;
}