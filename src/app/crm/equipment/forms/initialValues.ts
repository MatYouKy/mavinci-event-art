// src/app/crm/equipment/forms/initialValues.ts
import { string } from 'yup';
import { EquipmentMainCategory, ICableSpecs, IEquipment, IEquipmentComponent, IEquipmentHistory, IEquipmentTechnicalSpec, IStockHistoryEntry } from '../types/equipment.types';

import { ISingleImage } from '@/types/image';

export const newEquipmentInitialValues: IEquipment = {
  name: '',
  brand: '',
  model: '',
  category: '' as EquipmentMainCategory,
  subcategory: '',
  description: '',
  notes: '',
  thumbnail_url: null,

  details: {
    desciption: '',
    notes: '',
    requiredSkills: [] as any[], // IExtraSkills[]
    recommendedSkills: [] as any[],
  },

  technical: {
    equip: null as IEquipmentTechnicalSpec | null,
    cable: null as ICableSpecs | null,
  },

  quantity: {
    available_quantity: 0,
    total_quantity: 0,
    units: null,
  },

  components: {
    components: [] as IEquipmentComponent[],
  },

  gallery: [] as ISingleImage[],

  history: [] as IEquipmentHistory[],
};
