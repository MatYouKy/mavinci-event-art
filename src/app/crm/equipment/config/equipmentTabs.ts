export type EquipmentTab =
  | 'technical'
  | 'purchase'
  | 'components'
  | 'units'
  | 'gallery'
  | 'history';

export const CategoryTabConfig: Record<string, EquipmentTab[]> = {
  audio: ['technical', 'purchase', 'components', 'units', 'gallery', 'history'],
  lighting: ['technical', 'purchase', 'units', 'gallery', 'history'],
  stage: ['technical', 'purchase', 'components', 'units', 'gallery', 'history'],
  video: ['technical', 'purchase', 'components', 'units', 'gallery', 'history'],
  structures: ['technical', 'purchase', 'units', 'gallery'],
  power: ['technical', 'purchase', 'units', 'gallery', 'history'],
  decoration: ['technical', 'purchase', 'units', 'gallery'],
  attractions: ['technical', 'purchase', 'components', 'units', 'gallery'],
  cables: ['technical', 'purchase', 'units', 'gallery'], // bez history (opcjonalnie)
  other: ['technical', 'purchase', 'units', 'gallery'],
};
