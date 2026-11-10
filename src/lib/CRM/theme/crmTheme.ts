/** Motywy CRM — wybór pracownika w employees.crm_theme, kolory w styles/crm-themes.css. */
export type CrmTheme = 'burgundy' | 'navy' | 'dark' | 'light';

export const CRM_THEMES: { id: CrmTheme; label: string; description: string }[] = [
  { id: 'burgundy', label: 'Burgund', description: 'Kolory marki Mavinci' },
  { id: 'navy', label: 'Granat', description: 'Klasyczny ciemnogranatowy' },
  { id: 'dark', label: 'Ciemny', description: 'Szary, jak tryb ciemny macOS' },
  { id: 'light', label: 'Jasny', description: 'Jak tryb jasny macOS' },
];

export const DEFAULT_CRM_THEME: CrmTheme = 'burgundy';

export const isCrmTheme = (value: unknown): value is CrmTheme =>
  value === 'burgundy' || value === 'navy' || value === 'dark' || value === 'light';

export const resolveCrmTheme = (value: unknown): CrmTheme => (isCrmTheme(value) ? value : DEFAULT_CRM_THEME);
