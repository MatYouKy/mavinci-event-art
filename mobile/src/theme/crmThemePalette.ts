/**
 * Motywy CRM (Ustawienia → Ogólne → Wygląd) — wybór pracownika w `employees.crm_theme`, ten sam w CRM, na Macu i w telefonie.
 * Paleta poziomów tła odpowiada zmiennym `--brand-burgundy-950…750` z `src/styles/crm-themes.css` i `src/index.css`
 * (jasny motyw — kolory widoczne po odwróceniu filtrem, jak `Theme.swift` na Macu). Akcent ciemnych motywów to złoto marki —
 * w CRM i pokazie nadpisuje go księga znaku; w jasnym motywie — ciemne złoto dla kontrastu.
 * Kopia 1:1: src/lib/CRM/theme/crmThemePalette.ts ↔ mobile/src/theme/crmThemePalette.ts (scripts/ci/check-shared-copies.mjs).
 */

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

/** Kolory motywu. Tła i tekst — `#rrggbb` (można dopisać przezroczystość, np. `${palette.accent}33`). */
export type CrmThemePalette = {
  scheme: 'dark' | 'light';
  /** Tło strony (`--brand-burgundy-950`). */
  page: string;
  /** Paski: nagłówek, menu, dolna nawigacja (`900`). */
  bar: string;
  /** Karty i pola (`850`). */
  card: string;
  /** Powierzchnia podniesiona: modale, arkusze, ekran pokazu prezentacji (`800`). */
  surface: string;
  /** Wyróżnienie na powierzchni (`750`). */
  raised: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
  accent: string;
  accentDark: string;
  accentLight: string;
  border: string;
  borderHover: string;
  borderFocus: string;
  /** Delikatna warstwa (obramowania, zaznaczenia): w ciemnych — jasna, w jasnym — ciemna. */
  veil: string;
  veilStrong: string;
  /** Wnęka na powierzchni (pola, kafle, wiersze): w ciemnych — przyciemnienie, w jasnym — lekka szarość. */
  well: string;
  wellStrong: string;
};

const DARK_TEXT = { text: '#e5e4e2', textSecondary: '#b0b0b0', textTertiary: '#808080', textDisabled: '#4a4a4a' };
const GOLD = {
  accent: '#d3bb73', accentDark: '#b8a05e', accentLight: '#e5d9a8',
  border: 'rgba(211, 187, 115, 0.1)', borderHover: 'rgba(211, 187, 115, 0.3)', borderFocus: 'rgba(211, 187, 115, 0.5)',
};
const DARK_LAYERS = { veil: 'rgba(255, 255, 255, 0.08)', veilStrong: 'rgba(255, 255, 255, 0.15)', well: 'rgba(0, 0, 0, 0.25)', wellStrong: 'rgba(0, 0, 0, 0.4)' };

export const CRM_THEME_PALETTES: Record<CrmTheme, CrmThemePalette> = {
  burgundy: { scheme: 'dark', page: '#210811', bar: '#2c0b18', card: '#351020', surface: '#411326', raised: '#521a31', ...DARK_TEXT, ...GOLD, ...DARK_LAYERS },
  navy: { scheme: 'dark', page: '#0f1119', bar: '#13162a', card: '#171a2c', surface: '#1c1f33', raised: '#252842', ...DARK_TEXT, ...GOLD, ...DARK_LAYERS },
  dark: { scheme: 'dark', page: '#1e1e1e', bar: '#232323', card: '#282828', surface: '#2c2c2e', raised: '#3a3a3c', ...DARK_TEXT, ...GOLD, ...DARK_LAYERS },
  light: {
    scheme: 'light', page: '#f2f2f4', bar: '#ececee', card: '#f5f5f7', surface: '#ffffff', raised: '#ebebed',
    text: '#1d1d1f', textSecondary: '#48484a', textTertiary: '#6e6e73', textDisabled: '#aeaeb2',
    accent: '#7a5c12', accentDark: '#5f470d', accentLight: '#a07d2a',
    border: 'rgba(122, 92, 18, 0.15)', borderHover: 'rgba(122, 92, 18, 0.35)', borderFocus: 'rgba(122, 92, 18, 0.55)',
    veil: 'rgba(0, 0, 0, 0.06)', veilStrong: 'rgba(0, 0, 0, 0.12)', well: 'rgba(0, 0, 0, 0.04)', wellStrong: 'rgba(0, 0, 0, 0.08)',
  },
};

export const crmThemePalette = (theme: unknown): CrmThemePalette => CRM_THEME_PALETTES[resolveCrmTheme(theme)];

/**
 * Akcent pokazu prezentacji: w ciemnych motywach — kolor akcentu z księgi znaku, w jasnym — akcent motywu (złoto marki
 * na białym tle jest nieczytelne).
 */
export const crmThemeShowcaseAccent = (palette: CrmThemePalette, brandAccent: string | null | undefined) =>
  (palette.scheme === 'light' ? palette.accent : brandAccent || palette.accent);
