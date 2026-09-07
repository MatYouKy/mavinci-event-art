/**
 * Mavinci Brand Colors
 * Shared with web application
 */

export const colors = {
  // Primary colors
  primary: {
    gold: '#d3bb73',      // Złoty akcent
    goldDark: '#b8a05e',  // Ciemniejszy złoty
    goldLight: '#e5d9a8', // Jaśniejszy złoty
  },

  // Secondary colors
  secondary: {
    burgundy: '#650026',    // Bordowy akcent
    burgundyDark: '#3a0c20',
    burgundyLight: '#7f1734',
  },

  // Tła zgodne z motywem brand-theme--crm aplikacji webowej.
  background: {
    primary: '#210811',      // Główne tło
    secondary: '#2c0b18',    // Nawigacja i dolny pasek
    tertiary: '#351020',     // Karty i pola
    elevated: '#411326',     // Modale i podniesione elementy
  },

  // Text colors
  text: {
    primary: '#e5e4e2',      // Główny tekst (jasny)
    secondary: '#b0b0b0',    // Wtórny tekst
    tertiary: '#808080',     // Pomocniczy tekst
    disabled: '#4a4a4a',     // Wyłączony tekst
  },

  // Status colors
  status: {
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
  },

  // Utility colors
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',

  // Border colors
  border: {
    default: 'rgba(211, 187, 115, 0.1)',  // Złoty z opacity 10%
    hover: 'rgba(211, 187, 115, 0.3)',    // Złoty z opacity 30%
    focus: 'rgba(211, 187, 115, 0.5)',    // Złoty z opacity 50%
  },
} as const;

export type ColorPalette = typeof colors;
