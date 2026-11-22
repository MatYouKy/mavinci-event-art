import { colors } from './colors';
import { spacing, borderRadius } from './spacing';
import { typography } from './typography';

export const theme = {
  colors,
  spacing,
  borderRadius,
  typography,
} as const;

export type Theme = typeof theme;

export { colors, spacing, borderRadius, typography };
/** Motyw CRM pracownika (Burgund, Granat, Ciemny, Jasny) — `appPalette().scheme` dla elementów systemowych. */
export { appPalette, appTheme, glow, ink, shade, tone, withAlpha } from './appTheme';
