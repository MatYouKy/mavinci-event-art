import { EquipmentMainCategory } from '../types/equipment.types';

// config/categoryFields.ts
export type FieldKind = 'text' | 'number' | 'boolean' | 'select';
export interface FieldSchema {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: readonly string[];
  min?: number;
  step?: number;
}

export const CableTypes = [
  'audio_xlr',
  'audio_speakon',
  'dmx',
  'video_hdmi',
  'video_sdi',
  'displayport',
  'power_schuko',
  'power_powercon',
  'power_cee',
  'ethernet_rj45',
] as const;
export const ConnectorTypes = [
  'xlr_m',
  'xlr_f',
  'speakon_nl4',
  'bnc',
  'hdmi',
  'displayport',
  'rj45',
  'schuko',
  'powercon_blue',
  'powercon_white',
  'cee_16a',
  'cee_32a',
] as const;

export const CategoryFieldSchemas: Record<EquipmentMainCategory, readonly FieldSchema[]> = {
  audio: [
    { key: 'weight_kg', label: 'Waga (kg)', kind: 'number', min: 0, step: 0.01 },
    { key: 'power_w', label: 'Moc / pobór (W)', kind: 'number', min: 0 },
    { key: 'dimensions_length', label: 'Długość (cm)', kind: 'number', min: 0, step: 0.1 },
    { key: 'dimensions_width', label: 'Szerokość (cm)', kind: 'number', min: 0, step: 0.1 },
    { key: 'dimensions_height', label: 'Wysokość (cm)', kind: 'number', min: 0, step: 0.1 },
  ],
  lighting: [
    { key: 'weight_kg', label: 'Waga (kg)', kind: 'number', min: 0, step: 0.01 },
    { key: 'dmx_channels', label: 'Kanały DMX', kind: 'number', min: 1, step: 1 },
    { key: 'power_w', label: 'Pobór mocy (W)', kind: 'number', min: 0 },
  ],
  stage: [
    { key: 'weight_kg', label: 'Waga (kg)', kind: 'number', min: 0, step: 0.01 },
    { key: 'dimensions_length', label: 'Długość (cm)', kind: 'number', min: 0, step: 0.1 },
    { key: 'dimensions_width', label: 'Szerokość (cm)', kind: 'number', min: 0, step: 0.1 },
    { key: 'dimensions_height', label: 'Wysokość (cm)', kind: 'number', min: 0, step: 0.1 },
  ],
  video: [
    { key: 'weight_kg', label: 'Waga (kg)', kind: 'number', min: 0, step: 0.01 },
    { key: 'power_w', label: 'Pobór mocy (W)', kind: 'number', min: 0 },
  ],
  structures: [
    { key: 'weight_kg', label: 'Waga (kg)', kind: 'number', min: 0, step: 0.01 },
    { key: 'dimensions_length', label: 'Długość (cm)', kind: 'number', min: 0, step: 0.1 },
    { key: 'dimensions_width', label: 'Szerokość (cm)', kind: 'number', min: 0, step: 0.1 },
    { key: 'dimensions_height', label: 'Wysokość (cm)', kind: 'number', min: 0, step: 0.1 },
  ],
  power: [
    { key: 'weight_kg', label: 'Waga (kg)', kind: 'number', min: 0, step: 0.01 },
    { key: 'power_w', label: 'Moc / pobór (W)', kind: 'number', min: 0 },
  ],
  decoration: [
    { key: 'weight_kg', label: 'Waga (kg)', kind: 'number', min: 0, step: 0.01 },
    { key: 'dimensions_length', label: 'Długość (cm)', kind: 'number', min: 0, step: 0.1 },
    { key: 'dimensions_width', label: 'Szerokość (cm)', kind: 'number', min: 0, step: 0.1 },
    { key: 'dimensions_height', label: 'Wysokość (cm)', kind: 'number', min: 0, step: 0.1 },
  ],
  attractions: [
    { key: 'weight_kg', label: 'Waga (kg)', kind: 'number', min: 0, step: 0.01 },
    { key: 'power_w', label: 'Pobór mocy (W)', kind: 'number', min: 0 },
  ],
  cables: [
    {
      key: 'cable_length_meters',
      label: 'Długość (m)',
      kind: 'number',
      min: 0.5,
      step: 0.5,
      required: true,
    },
    {
      key: 'cable_connector_in',
      label: 'Wtyk wejściowy',
      kind: 'select',
      options: ConnectorTypes,
      required: true,
    },
    {
      key: 'cable_connector_out',
      label: 'Wtyk wyjściowy',
      kind: 'select',
      options: ConnectorTypes,
      required: true,
    },
    { key: 'cable_type', label: 'Typ kabla', kind: 'select', options: CableTypes },
  ],
  other: [{ key: 'weight_kg', label: 'Waga (kg)', kind: 'number', min: 0, step: 0.01 }],
};
