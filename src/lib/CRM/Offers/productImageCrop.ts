export type ImageCrop = { fit: 'cover' | 'contain'; x: number; y: number; zoom: number };
export type ImageCrops = Record<string, Partial<Record<string, ImageCrop>>>;
export const IMAGE_CROP_LAYOUTS = [
  { id: 'default', label: 'Osobna strona', width: 225, height: 190 },
  { id: 'visual', label: 'Duża grafika', width: 431, height: 285 },
  { id: 'compact', label: 'Kompaktowy', width: 145, height: 135 },
  { id: 'variants', label: 'Lista wariantów', width: 118, height: 100 },
  { id: 'recommendations', label: 'Propozycja dodatkowa — miniatura', width: 110, height: 110 },
] as const;
const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
export function imageCrop(profiles: unknown, path: string | null | undefined, layout: string): ImageCrop | undefined {
  const raw = (profiles as ImageCrops | undefined)?.[path || '']?.[layout];
  if (!raw || typeof raw !== 'object') return undefined;
  return { fit: raw.fit === 'contain' ? 'contain' : 'cover', x: clamp(raw.x, 0, 100, 50), y: clamp(raw.y, 0, 100, 50), zoom: clamp(raw.zoom, .5, 3, 1) };
}
export function pdfImageCrop(product: any, layout: string, path?: string | null) {
  const crop = imageCrop(product?.offer_image_crops, path || product?.offer_image_path, layout);
  return crop ? { image_fit: crop.fit, image_position_x: crop.x, image_position_y: crop.y, image_zoom: crop.zoom } : {};
}
