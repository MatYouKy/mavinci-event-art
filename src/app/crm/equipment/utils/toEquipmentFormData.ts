// utils/toEquipmentFormData.ts
import type { IEquipment } from '@/app/crm/equipment/types/equipment.types';

type GalleryMetaItem = {
  order: number;
  is_main: boolean;
  alt: string;
  src?: string;
};

function sanitize(values: IEquipment): IEquipment {
  const v: any = { ...values };

  if (v?.details) {
    v.details = {
      ...v.details,
      description: v.details.description ?? v.details.desciption ?? '',
    };
    delete v.details.desciption;
  }

  if (typeof v.thumbnail_url === 'string' && v.thumbnail_url.startsWith('blob:')) {
    v.thumbnail_url = null;
  }

  return v as IEquipment;
}

interface KeyMap {
  payload?: string;
  files?: string;
}

export function toEquipmentFormData(values: IEquipment, key?: KeyMap): FormData {
  const fd = new FormData();
  const safe = sanitize(values);

  const { payload = 'equipment', files = 'gallery' } = key ?? {};
  const payloadObj: any = { ...safe, gallery: undefined };

  fd.append(payload, JSON.stringify(payloadObj));

  const meta: GalleryMetaItem[] = [];
  (safe.gallery ?? []).forEach((g, i) => {
    const maybeFile: unknown = (g as any).file;
    const isNew = typeof File !== 'undefined' && maybeFile instanceof File;

    meta.push({
      order: typeof g.order === 'number' ? g.order : i,
      is_main: !!g.is_main,
      alt: g.alt ?? '',
      src: isNew ? '' : (g.src ?? ''),
    });
    if (isNew) fd.append(files, maybeFile as File);
  });
  fd.append(`${files}_meta`, JSON.stringify(meta));
  return fd;
}

// alias dla update – ten sam format
export const toUpdateEquipmentFormData = toEquipmentFormData;
