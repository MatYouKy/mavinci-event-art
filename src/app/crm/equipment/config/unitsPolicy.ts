import { EquipmentMainCategory } from '../types/equipment.types';

// config/unitsPolicy.ts
export interface UnitsPolicyConfig {
  serialRequired: boolean;
  showHistory: boolean;
  fields: { key: string; label: string; kind: 'text' | 'select' }[];
}

export const UnitsPolicy: Record<EquipmentMainCategory, UnitsPolicyConfig> = {
  audio: { serialRequired: true, showHistory: true, fields: [] },
  lighting: { serialRequired: true, showHistory: true, fields: [] },
  stage: { serialRequired: false, showHistory: true, fields: [] },
  video: { serialRequired: true, showHistory: true, fields: [] },
  structures: { serialRequired: false, showHistory: false, fields: [] },
  power: { serialRequired: false, showHistory: true, fields: [] },
  decoration: { serialRequired: false, showHistory: false, fields: [] },
  attractions: { serialRequired: false, showHistory: false, fields: [] },
  cables: {
    serialRequired: false,
    showHistory: false,
    fields: [
      { key: 'reel_label', label: 'Bęben / oznaczenie', kind: 'text' },
      { key: 'color', label: 'Kolor', kind: 'select' },
    ],
  },
  other: { serialRequired: false, showHistory: false, fields: [] },
};
