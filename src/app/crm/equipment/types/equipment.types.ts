import { ISingleImage } from '@/types/image';
import { IExtraSkills } from '@/types/skills.types';
import { IConnectorType } from '../connectors/connector.type';

export type UnitEventType =
  | 'damage'
  | 'repair'
  | 'service'
  | 'status_change'
  | 'note'
  | 'inspection'
  | 'sold';

export type EquipmentTabsCarouselType =
  | 'details'
  | 'technical'
  | 'components'
  | 'units'
  | 'gallery'
  | 'history'
  | 'notes';

// Jeśli masz już gdzieś EquipmentTab – zrób ALIAS zamiast dublowania:
export type EquipmentTab = EquipmentTabsCarouselType;

// (Opcjonalnie) zestaw wszystkich:
export const ALL_EQUIPMENT_TABS: readonly EquipmentTab[] = [
  'details',
  'technical',
  'components',
  'units',
  'gallery',
  'history',
  'notes',
] as const;

export type EquipmentMainCategory =
  | 'audio'
  | 'lighting'
  | 'stage'
  | 'video'
  | 'structures'
  | 'power'
  | 'decoration'
  | 'attractions'
  | 'cables'
  | 'other';

export const EquipmentMainCategoryLabels: Record<EquipmentMainCategory, string> = {
  audio: 'Dźwięk',
  lighting: 'Oświetlenie',
  stage: 'Scena / Backline',
  video: 'Multimedia i AV',
  structures: 'Konstrukcje',
  power: 'Zasilanie',
  decoration: 'Dekoracja',
  attractions: 'Atrakcje',
  cables: 'Kable i przewody',
  other: 'Inne',
};

export const EquipmentCategories: Record<EquipmentMainCategory, string[]> = {
  audio: [
    'Głośniki i subbasy',
    'Końcówki mocy',
    'Miksery audio',
    'Mikrofony przewodowe',
    'Mikrofony bezprzewodowe',
    'Systemy odsłuchowe (monitory)',
    'Procesory i DSP',
    'Instrumenty muzyczne',
    'Okablowanie audio',
    'Akcesoria audio (statywy, DI-boxy, klamry)',
  ],

  lighting: [
    'Ruchome głowy',
    'PAR LED / Fresnel',
    'Listwy i bary LED',
    'Lasery i efekty świetlne',
    'Sterowniki DMX i konsole',
    'Zasilacze i dimmery',
    'Oświetlenie architektoniczne',
    'Oświetlenie dekoracyjne',
    'Statywy i akcesoria oświetleniowe',
    'Efekty specjalne (dym, hazer, konfetti)',
  ],

  stage: [
    'Podesty sceniczne',
    'Zestawy DJ / miksery muzyczne',
    'Backline (instrumenty, statywy, perkusje, keyboardy)',
    'Odsłuchy sceniczne',
    'Monitory / wedge',
    'Nagłośnienie sceniczne',
    'Kurtyny i tła sceniczne',
    'Podesty dla muzyków',
    'Schody sceniczne i barierki',
    'Akcesoria sceniczne',
  ],

  video: [
    'Projektory',
    'Ekrany projekcyjne',
    'Monitory LED / LCD',
    'Ściany LED',
    'Miksery wideo / switchery',
    'Kamery i grabbery',
    'Rejestratory i streamery',
    'Konwertery i matryce sygnałów',
    'Okablowanie video (HDMI, SDI, DisplayPort)',
    'Komputery multimedialne i laptopy prezentacyjne',
  ],

  structures: [
    'Kratownice (truss)',
    'Lifty i wciągarki',
    'Statywy i uchwyty',
    'Ramy pod ścianki i banery',
    'Zadaszenia sceniczne',
    'Stelaże i rusztowania',
    'Systemy podwieszeń i mocowań',
    'Elementy montażowe i złączki',
  ],

  power: [
    'Rozdzielnie prądowe',
    'Przedłużacze i kable zasilające',
    'Agregaty prądotwórcze',
    'UPS-y i stabilizatory',
    'Listwy zasilające',
    'Zabezpieczenia i bezpieczniki',
    'Adaptery i przejściówki',
    'Osprzęt montażowy i testery napięcia',
  ],

  decoration: [
    'Ścianki (balonowe, brandingowe, tła)',
    'Balony i girlandy',
    'Tkaniny i kotary',
    'Meble eventowe',
    'Rośliny i kwiaty sztuczne',
    'Neony i oświetlenie dekoracyjne',
    'Scenografia tematyczna',
    'Druk i branding (roll-upy, banery)',
    'Dekoracje sezonowe i tematyczne',
  ],

  attractions: [
    'Fotolustra i fotobudki',
    'Ścianki foto',
    'Dmuchańce',
    'Bańki mydlane / maszyny do baniek',
    'Kasyno eventowe (ruletka, blackjack, poker)',
    'Teleturnieje i systemy interaktywne (pilot, quiz)',
    'Efekty specjalne (dym, iskry, konfetti)',
    'Gry integracyjne i zabawy tematyczne',
    'Atrakcje dla dzieci',
    'Strefy chill / lounge',
  ],
  cables: [
    'XLR',
    'S',
    'Speakon',
    'DMX',
    'HDMI',
    'SDI',
    'DisplayPort',
    'Schuko',
    'PowerCon',
    'CEE',
    'Ethernet',
    'RJ45',
    'Hybrydowe (audio + power / data)',
    'Przedłużacze',
    'Multicory',
  ],

  other: [
    'Case’y transportowe',
    'Skrzynie i wózki',
    'Narzędzia i sprzęt serwisowy',
    'Oznaczenia kabli i transportu',
    'Materiały eksploatacyjne (taśmy, opaski, rzepy)',
    'Elementy zapasowe / serwisowe',
    'Inne elementy nienależące do kategorii głównych',
  ],
};

export interface IStorageLocation {
  _id?: string;
  name: string;
  address: string | null;
  access_info: string | null;
  google_maps_url: string | null;
  notes: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}
export interface ICableSpecs {
  length_meters: string;
  connector_in: IConnectorType;
  connector_out: IConnectorType;
}

export interface IEquipmentDimensions {
  weight: number;
  height: number;
  width: number;
  length: number;
}

export interface IEquipmentTechnicalSpec {
  user_manual_url: string | null;
  serial_number: string | null;
  dimensions: IEquipmentDimensions | null;
}

export interface IEquipmentTechnical {
  cable: ICableSpecs | null;
  equip: IEquipmentTechnicalSpec | null;
}

export interface IEquipmentDetails {
  desciption: string;
  notes: string;
  requiredSkills?: IExtraSkills[];
  recommendedSkills?: IExtraSkills[];
}

export type UnitStatus = 'available' | 'damaged' | 'in_service' | 'retired';

export interface IEquipmentUnitEvent {
  id: string;
  unit_id: string;
  event_type: UnitStatus;
  description: string;
  image_url: string | null;
  old_status: string | null;
  new_status: string | null;
  employee_id: string | null;
  created_at: string;
  employees: { name: string; surname: string } | null;
  purchase: IEquipmentPurchase;
}

export interface IEquipmentUnit {
  _id?: string; // ID z backendu (po zapisie)
  unit_serial_number?: string | null;
  status: UnitStatus;
  location_id?: string | null;
  thumbnail_url?: string | null;
  events: IEquipmentUnitEvent[];
  created_at: string | null;
  updated_at: string | null;

  // zakup/serwis – opcjonalnie
  purchase_date?: string | null; // 'yyyy-MM-dd'
  purchase_price?: number | null;
  purchase_currency?: 'PLN' | 'EUR' | 'USD' | string | null;
  vendor?: string | null;
  invoice_number?: string | null;
  last_service_date?: string | null; // 'yyyy-MM-dd'
  total_quantity: number;
  available_quantity: number;
}

export interface ICableUnits {
  cable_units?: number;
  storage_location_id?: IStorageLocation;
  created_at: string | null;
  updated_at: string | null;
}

export type IEquipmentQuantity = {
  total_quantity: number;
  available_quantity: number;
  units: IEquipmentUnit[] | ICableUnits;
} 

export interface IEquipmentPurchase {
  purchase_date: string | null;
  purchase_price: number;
  purchase_currency: string;
  purchase_currency_rate: number;
  purchase_currency_rate_date: string | null;
}

export interface IEquipmentComponent {
  _id: string;
  component_name: string;
  quantity: number;
  description?: string | null;
  is_included: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface IEquipmentComponents {
  components: IEquipmentComponent[];
}
export interface IEquipmentHistory {
  event_type: UnitEventType;
  description: string;
  image_url: string | null;
  old_status: string | null;
  new_status: string | null;
  employee_id: string | null;
  created_at: string | null;
}
export interface IStockHistoryEntry {
  _id: string;
  equipment_id: string;
  change_type: 'add' | 'remove' | 'manual' | 'adjust' | string;
  quantity_before?: number;
  quantity_change?: number;
  quantity_after?: number;
  notes?: string;
  created_at: string | null;
  created_by?: string;
}

export interface IEquipment {
  _id?: string;
  name: string;
  brand: string;
  model: string;
  description: string;
  notes: string;

  category: EquipmentMainCategory;
  subcategory: string;
  
  thumbnail_url: string | null;
  gallery: ISingleImage[];

  details: IEquipmentDetails;

  quantity: IEquipmentQuantity;

  technical: IEquipmentTechnical;
  history: IEquipmentHistory[];
  components: IEquipmentComponents;
  is_kit?: boolean;
}
