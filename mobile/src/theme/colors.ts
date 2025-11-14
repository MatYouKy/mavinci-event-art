/**
 * Mavinci Brand Colors
 * Shared with web application
 */

export const colors = {
  // Primary colors
  primary: {
    gold: '#d3bb73', // Złoty akcent
    goldDark: '#b8a05e', // Ciemniejszy złoty
    goldLight: '#e5d9a8', // Jaśniejszy złoty
  },

  // Secondary colors
  secondary: {
    burgundy: '#800020', // Bordowy akcent
    burgundyDark: '#5c0017',
    burgundyLight: '#a6002a',
  },

  // Background colors
  background: {
    primary: '#0f1119', // Główne tło (bardzo ciemne)
    secondary: '#1c1f33', // Wtórne tło (ciemne)
    tertiary: '#252842', // Karty/komponenty
    elevated: '#2a2f4a', // Podniesione elementy
  },

  // Text colors
  text: {
    primary: '#e5e4e2', // Główny tekst (jasny)
    secondary: '#b0b0b0', // Wtórny tekst
    tertiary: '#808080', // Pomocniczy tekst
    disabled: '#4a4a4a', // Wyłączony tekst
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
    default: 'rgba(211, 187, 115, 0.1)', // Złoty z opacity 10%
    hover: 'rgba(211, 187, 115, 0.3)', // Złoty z opacity 30%
    focus: 'rgba(211, 187, 115, 0.5)', // Złoty z opacity 50%
  },
} as const;

export type ColorPalette = typeof colors;
