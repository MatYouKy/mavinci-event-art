'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';

type PublicBrandTheme = {
  heading_font_family?: string | null;
  heading_font_weight?: string | null;
  heading_font_url?: string | null;
  colors?: Record<string, string> | null;
};

const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim());

const isBurgundy = (value: string) => {
  const hex = value.replace('#', '');
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return red >= 55 && red > green * 1.8 && red > blue * 1.15;
};

const isGold = (value: string) => {
  const hex = value.replace('#', '');
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return red >= 150 && green >= 120 && blue < green;
};

const safeFontFamily = (value: unknown) => {
  const normalized = String(value || 'Atom').replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ _-]/g, '').trim();
  return normalized || 'Atom';
};

const safeFontUrl = (value: unknown) => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
};

const fontFormat = (url: string) => {
  const pathname = new URL(url).pathname.toLocaleLowerCase('en-US');
  if (pathname.endsWith('.woff2')) return 'woff2';
  if (pathname.endsWith('.woff')) return 'woff';
  if (pathname.endsWith('.otf')) return 'opentype';
  return 'truetype';
};

export default function BrandThemeProvider() {
  useEffect(() => {
    let active = true;

    const loadTheme = async () => {
      const { data, error } = await supabase.rpc('get_public_brand_theme');
      if (!active || error || !data || typeof data !== 'object') return;

      const theme = data as PublicBrandTheme;
      const root = document.documentElement;
      const palette = theme.colors || {};
      const primaryCandidate = [palette.primary, palette.burgundy, palette.brand_primary]
        .find((color) => isHexColor(color) && isBurgundy(color));
      const accentCandidate = [palette.accent, palette.gold, palette.secondary]
        .find((color) => isHexColor(color) && isGold(color));

      if (primaryCandidate) root.style.setProperty('--brand-burgundy-700', primaryCandidate);
      if (accentCandidate) root.style.setProperty('--brand-gold', accentCandidate);

      const family = safeFontFamily(theme.heading_font_family);
      const url = safeFontUrl(theme.heading_font_url);
      root.style.setProperty('--font-brand-heading', `'${family}', 'Atom', 'Montserrat', sans-serif`);

      if (!url) return;
      const styleId = 'mavinci-brand-heading-font';
      let style = document.getElementById(styleId) as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        document.head.appendChild(style);
      }
      style.textContent = `@font-face{font-family:'${family}';src:url('${url}') format('${fontFormat(url)}');font-weight:${String(theme.heading_font_weight || '400').replace(/[^0-9]/g, '') || '400'};font-style:normal;font-display:swap;}`;
    };

    void loadTheme();
    return () => { active = false; };
  }, []);

  return null;
}
