import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, DevSettings } from 'react-native';
import * as Updates from 'expo-updates';
import { applyThemeColors } from './colors';
import { CRM_THEME_PALETTES, DEFAULT_CRM_THEME, resolveCrmTheme, type CrmTheme, type CrmThemePalette } from './crmThemePalette';

/*
 * Motyw aplikacji = motyw CRM pracownika (`employees.crm_theme`), jak w przeglądarce i na Macu. Ostatni motyw jest zapisany
 * na urządzeniu i ustawiany przy starcie, zanim wczytają się ekrany (ich style powstają raz). Gdy profil ma inny motyw
 * (zmiana w CRM, na Macu albo w Ustawieniach telefonu) — zapis i ponowne uruchomienie kodu aplikacji.
 */

const KEY = 'mavinci.crmTheme';
let current: CrmTheme = DEFAULT_CRM_THEME;
let storageReady = false;
let switching = false;

export const appTheme = () => current;
export const appPalette = (): CrmThemePalette => CRM_THEME_PALETTES[current];

const light = () => CRM_THEME_PALETTES[current].scheme === 'light';

/** Jasne odcienie stanów (czerwony, bursztynowy, zielony, niebieski) czytelne na ciemnym tle → ciemniejsze w jasnym motywie. */
const LIGHT_TONES: Record<string, string> = {
  '#ff9999': '#b91c1c', '#fca5a5': '#b91c1c', '#fecaca': '#991b1b', '#f87171': '#dc2626', '#f88': '#b91c1c',
  '#fcd34d': '#a16207', '#fde68a': '#92400e', '#fbbf24': '#b45309', '#f5c26b': '#a16207',
  '#86efac': '#15803d', '#4ade80': '#16a34a', '#7bd99c': '#15803d', '#34d399': '#047857',
  '#bfdbfe': '#1d4ed8', '#60a5fa': '#2563eb',
};

/** Kolor stanu dobrany do motywu: w ciemnych — bez zmian, w jasnym — ciemniejszy odpowiednik. */
export const tone = (hex: string) => (light() ? LIGHT_TONES[hex.toLowerCase()] || hex : hex);

/** `#rrggbb` z przezroczystością (np. tekst motywu przygaszony). */
export const withAlpha = (hex: string, alpha: number) => {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!value) return hex;
  const number = parseInt(value, 16);
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
};
/** Tekst motywu z przezroczystością (w ciemnych — jasny, w jasnym — ciemny). */
export const ink = (alpha: number) => withAlpha(CRM_THEME_PALETTES[current].text, alpha);
/** Przyciemnienie wnęk i kafli: w ciemnych — czarne, w jasnym — delikatna szarość. */
export const shade = (alpha: number) => (light() ? `rgba(0, 0, 0, ${Math.round(alpha * 25) / 100})` : `rgba(0, 0, 0, ${alpha})`);
/** Rozjaśnienie obramowań i zaznaczeń: w ciemnych — białe, w jasnym — ciemne. */
export const glow = (alpha: number) => (light() ? `rgba(0, 0, 0, ${Math.round(alpha * 80) / 100})` : `rgba(255, 255, 255, ${alpha})`);

function apply(theme: CrmTheme) {
  current = theme;
  const palette = CRM_THEME_PALETTES[theme];
  applyThemeColors(palette);
  // Elementy systemowe (wybór daty, alerty, klawiatura) w tym samym trybie co aplikacja.
  try { Appearance.setColorScheme(palette.scheme); } catch { /* starsza wersja React Native */ }
}

/** Motyw zapisany na urządzeniu — przed wczytaniem ekranów (`App.tsx`). */
export async function loadAppTheme(): Promise<CrmTheme> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    storageReady = true;
    apply(resolveCrmTheme(saved));
  } catch {
    apply(DEFAULT_CRM_THEME);
  }
  return current;
}

async function restartApp() {
  try {
    await Updates.reloadAsync();
    return;
  } catch { /* tryb deweloperski albo aktualizacje wyłączone */ }
  try { DevSettings.reload(); } catch { /* motyw włączy się przy następnym uruchomieniu */ }
}

/**
 * Motyw z profilu pracownika (`crm_theme`; brak — Burgund). Inny niż bieżący: zapis na urządzeniu i ponowne uruchomienie.
 * Gdy pamięć urządzenia nie działa — bez ponownego uruchamiania (żeby nie zapętlić startu). `true` — trwa zmiana motywu.
 */
export async function syncAppTheme(value: unknown): Promise<boolean> {
  const theme = resolveCrmTheme(value);
  if (theme === current || switching || !storageReady) return switching;
  switching = true;
  try {
    await AsyncStorage.setItem(KEY, theme);
    if ((await AsyncStorage.getItem(KEY)) !== theme) { switching = false; return false; }
  } catch {
    switching = false;
    return false;
  }
  await restartApp();
  return true;
}
