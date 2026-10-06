export const BROCHURE_ICONS = {
  building: 'Hotel / obiekt', mic: 'Mikrofon', sound: 'Nagłośnienie', screen: 'Multimedia',
  light: 'Światło', stage: 'Scena', camera: 'Zdjęcia i film', music: 'Muzyka', people: 'Zespół',
  trophy: 'Gala / nagrody', casino: 'Kasyno', vr: 'Wirtualna rzeczywistość', check: 'Uzgodnienia',
  file: 'Oferta / dokument', chat: 'Kontakt', clock: 'Harmonogram', briefcase: 'Biznes',
  sparkles: 'Atrakcje', route: 'Proces', game: 'Gry i teleturnieje',
} as const;
export type BrochureIcon = keyof typeof BROCHURE_ICONS;
export const isBrochureIcon = (value: unknown): value is BrochureIcon => typeof value === 'string' && Object.prototype.hasOwnProperty.call(BROCHURE_ICONS, value);
// Small, fixed vector marks. User data never becomes SVG markup.
const paths: Record<BrochureIcon, string> = {
  building: '<path d="M4 21V4h16v17M8 8h2m4 0h2M8 12h2m4 0h2M10 21v-5h4v5M2 21h20"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0014 0v-2M12 19v3m-4 0h8"/>',
  sound: '<path d="M11 4L5 9H2v6h3l6 5zM15 8a6 6 0 010 8m3-11a10 10 0 010 14"/>',
  screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4m-5 0h10M6 7h6m-6 4h10"/>',
  light: '<path d="M9 18h6m-5 3h4M8 14a6 6 0 118 0l-1 2H9zM2 8H0m22 0h2M4 2L2 0m18 2l2-2"/>',
  stage: '<path d="M2 4h20v14H2zM2 18l-1 4m21-4l1 4M7 18v4m10-4v4M5 4l3 4m11-4l-3 4M8 15h8"/>',
  camera: '<path d="M3 6h4l2-3h6l2 3h4v14H3z"/><circle cx="12" cy="12" r="4"/>',
  music: '<path d="M9 18V5l12-3v14M9 9l12-3"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0114 0v3M16 4a3 3 0 010 6m2 4a6 6 0 014 6"/>',
  trophy: '<path d="M7 3h10v5a5 5 0 01-10 0zM7 5H3v3a4 4 0 004 4m10-7h4v3a4 4 0 01-4 4M12 13v6m-5 3h10m-8-3h6"/>',
  casino: '<path d="M12 2l9 10-9 10L3 12z"/><circle cx="12" cy="12" r="2"/>',
  vr: '<path d="M3 6h18l2 12h-7l-4-3-4 3H1zM7 10v4m-2-2h4m8-2h.01m2 3h.01"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="M7 12l3 3 7-7"/>',
  file: '<path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8m-8 4h6"/>',
  chat: '<path d="M3 3h18v14H9l-6 5zM7 8h10m-10 4h7"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 3"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V3h8v4M2 12l10 4 10-4m-10 1v5"/>',
  sparkles: '<path d="M9 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM19 1l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM20 16v6m-3-3h6"/>',
  route: '<circle cx="4" cy="4" r="2"/><circle cx="20" cy="20" r="2"/><path d="M6 4h9a5 5 0 010 10H9a3 3 0 000 6h9"/>',
  game: '<path d="M6 6h12l4 13-3 2-5-5h-4l-5 5-3-2zM7 9v5m-2-2h5m6-2h.01m2 3h.01"/>',
};
export function renderBrochureIcon(value?: string) {
  if (!isBrochureIcon(value)) return '';
  return `<svg class="brochure-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[value]}</svg>`;
}
