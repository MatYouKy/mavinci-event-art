import { SkillLevel } from '@/types/skills.types';

export const skillLevelSatisfies = (candidate: SkillLevel | null, required: SkillLevel | null) =>
  required === null || (candidate !== null && candidate >= required);