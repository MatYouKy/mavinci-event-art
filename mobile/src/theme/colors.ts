/**
 * Kolory aplikacji — motyw CRM pracownika (`employees.crm_theme`: Burgund, Granat, Ciemny, Jasny), ten sam co w CRM i na Macu.
 * Wartości startowe — Burgund (domyślny motyw CRM). `applyThemeColors` ustawia paletę z `crmThemePalette.ts` (wspólnej z CRM)
 * przed wczytaniem ekranów (`appTheme.ts`, `App.tsx`), więc style ekranów powstają już w kolorach motywu.
 */

import type { CrmThemePalette } from './crmThemePalette';

export const colors = {
  // Akcent (złoto marki; w jasnym motywie — ciemne złoto)
  primary: {
    gold: '#d3bb73',
    goldDark: '#b8a05e',
    goldLight: '#e5d9a8',
  },

  // Burgund marki (wyróżnienia niezależne od motywu)
  secondary: {
    burgundy: '#650026',
    burgundyDark: '#3a0c20',
    burgundyLight: '#7f1734',
  },

  // Tła — poziomy jak `--brand-burgundy-950…800` w CRM.
  background: {
    primary: '#210811',      // Główne tło
    secondary: '#2c0b18',    // Nawigacja i dolny pasek
    tertiary: '#351020',     // Karty i pola
    elevated: '#411326',     // Modale i podniesione elementy
  },

  text: {
    primary: '#e5e4e2',
    secondary: '#b0b0b0',
    tertiary: '#808080',
    disabled: '#4a4a4a',
  },

  status: {
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
  },

  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',

  border: {
    default: 'rgba(211, 187, 115, 0.1)',
    hover: 'rgba(211, 187, 115, 0.3)',
    focus: 'rgba(211, 187, 115, 0.5)',
  },

  /** Warstwy zależne od motywu: `veil` — delikatne obramowania i zaznaczenia, `well` — wnęki (pola, kafle, wiersze). */
  layer: {
    veil: 'rgba(255, 255, 255, 0.08)',
    veilStrong: 'rgba(255, 255, 255, 0.15)',
    well: 'rgba(0, 0, 0, 0.25)',
    wellStrong: 'rgba(0, 0, 0, 0.4)',
  },
} as const;

export type ColorPalette = typeof colors;

/** Paleta motywu CRM → kolory aplikacji (zmiana w miejscu — przed utworzeniem stylów ekranów). */
export function applyThemeColors(palette: CrmThemePalette) {
  Object.assign(colors.primary, { gold: palette.accent, goldDark: palette.accentDark, goldLight: palette.accentLight });
  Object.assign(colors.background, { primary: palette.page, secondary: palette.bar, tertiary: palette.card, elevated: palette.surface });
  Object.assign(colors.text, {
    primary: palette.text, secondary: palette.textSecondary, tertiary: palette.textTertiary, disabled: palette.textDisabled,
  });
  Object.assign(colors.border, { default: palette.border, hover: palette.borderHover, focus: palette.borderFocus });
  Object.assign(colors.layer, { veil: palette.veil, veilStrong: palette.veilStrong, well: palette.well, wellStrong: palette.wellStrong });
}
