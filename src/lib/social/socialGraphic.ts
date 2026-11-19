import { SOCIAL_FORMAT_INFO, SOCIAL_FORMATS, socialGraphicText, type SocialCrop, type SocialFormat } from './socialShared';

/*
 * Grafika social media z szablonu marki — jeden HTML dla renderu na serwerze Next (Chromium → JPEG, plik wspólny dla web,
 * Maca i telefonu) i podglądu na żywo w kreatorze CRM (ramka z tym samym HTML). Logo, fonty i kolory pochodzą wyłącznie
 * z księgi znaku marki (szablon wskazuje je po identyfikatorze) — tu są tylko liczby układu z ustawień szablonu.
 * Układ jak szablon PSD 1080×1350: logo u góry na środku, przyciemnienie góry i dołu w kolorze przyciemnienia, tytuł
 * (wersaliki, szeroki odstęp liter), kreska w kolorze akcentu, podpis. Teksty dłuższe niż szerokość między marginesami
 * są zmniejszane w ramce (skrypt w HTML), dopiero potem grafika jest gotowa (`data-ready="1"` na <html>).
 */

export type SocialFormatLayout = { scale: number; insetTopPx: number; insetBottomPx: number };

export type SocialTemplateSettings = {
  logo: { widthPx: number; topPx: number };
  topShade: { heightPx: number; opacity: number; darken: number };
  bottomShade: { heightPx: number; opacity: number; darken: number };
  title: { sizePx: number; trackingEm: number; baselineFromBottomPx: number; maxChars: number };
  line: { widthPx: number; heightPx: number; topFromBottomPx: number };
  caption: { sizePx: number; trackingEm: number; baselineFromBottomPx: number; maxChars: number };
  sideMarginPx: number;
  formats: Record<SocialFormat, SocialFormatLayout>;
};

/** Układ szablonu PSD Mavinci (liczby w px dla szerokości 1080) — gdy w ustawieniach szablonu brakuje wartości. */
export const DEFAULT_SOCIAL_TEMPLATE_SETTINGS: SocialTemplateSettings = {
  logo: { widthPx: 170, topPx: 56 },
  topShade: { heightPx: 300, opacity: 0.6, darken: 0.86 },
  bottomShade: { heightPx: 540, opacity: 0.9, darken: 0.73 },
  title: { sizePx: 34, trackingEm: 0.2, baselineFromBottomPx: 168, maxChars: 30 },
  line: { widthPx: 72, heightPx: 2, topFromBottomPx: 129 },
  caption: { sizePx: 17, trackingEm: 0.35, baselineFromBottomPx: 88, maxChars: 60 },
  sideMarginPx: 90,
  formats: {
    '4:5': { scale: 1, insetTopPx: 0, insetBottomPx: 0 },
    '1:1': { scale: 0.92, insetTopPx: 0, insetBottomPx: 0 },
    '9:16': { scale: 1.05, insetTopPx: 220, insetBottomPx: 300 },
    '1.91:1': { scale: 0.8, insetTopPx: 0, insetBottomPx: 0 },
  },
};

type Row = Record<string, unknown>;
const object = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {});
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Ustawienia szablonu z bazy (`social_brand_templates.settings`) z wartościami domyślnymi i w bezpiecznych zakresach. */
export function parseSocialTemplateSettings(raw: unknown): SocialTemplateSettings {
  const source = object(raw);
  const d = DEFAULT_SOCIAL_TEMPLATE_SETTINGS;
  const logo = object(source.logo);
  const top = object(source.topShade);
  const bottom = object(source.bottomShade);
  const title = object(source.title);
  const line = object(source.line);
  const caption = object(source.caption);
  const formats = object(source.formats);
  return {
    logo: { widthPx: number(logo.widthPx, d.logo.widthPx, 40, 600), topPx: number(logo.topPx, d.logo.topPx, 0, 400) },
    topShade: {
      heightPx: number(top.heightPx, d.topShade.heightPx, 0, 1200),
      opacity: number(top.opacity, d.topShade.opacity, 0, 1),
      darken: number(top.darken, d.topShade.darken, 0, 1),
    },
    bottomShade: {
      heightPx: number(bottom.heightPx, d.bottomShade.heightPx, 0, 1600),
      opacity: number(bottom.opacity, d.bottomShade.opacity, 0, 1),
      darken: number(bottom.darken, d.bottomShade.darken, 0, 1),
    },
    title: {
      sizePx: number(title.sizePx, d.title.sizePx, 10, 160),
      trackingEm: number(title.trackingEm, d.title.trackingEm, 0, 1),
      baselineFromBottomPx: number(title.baselineFromBottomPx, d.title.baselineFromBottomPx, 20, 1200),
      maxChars: number(title.maxChars, d.title.maxChars, 5, 80),
    },
    line: {
      widthPx: number(line.widthPx, d.line.widthPx, 0, 600),
      heightPx: number(line.heightPx, d.line.heightPx, 0, 20),
      topFromBottomPx: number(line.topFromBottomPx, d.line.topFromBottomPx, 0, 1200),
    },
    caption: {
      sizePx: number(caption.sizePx, d.caption.sizePx, 8, 120),
      trackingEm: number(caption.trackingEm, d.caption.trackingEm, 0, 1),
      baselineFromBottomPx: number(caption.baselineFromBottomPx, d.caption.baselineFromBottomPx, 10, 1200),
      maxChars: number(caption.maxChars, d.caption.maxChars, 5, 120),
    },
    sideMarginPx: number(source.sideMarginPx, d.sideMarginPx, 0, 400),
    formats: Object.fromEntries(SOCIAL_FORMATS.map((format) => {
      const item = object(formats[format]);
      const base = d.formats[format];
      return [format, {
        scale: number(item.scale, base.scale, 0.3, 2),
        insetTopPx: number(item.insetTopPx, base.insetTopPx, 0, 600),
        insetBottomPx: number(item.insetBottomPx, base.insetBottomPx, 0, 800),
      }];
    })) as Record<SocialFormat, SocialFormatLayout>,
  };
}

/** Położenie elementów grafiki w px wyjściowego formatu. */
export function socialGraphicLayout(settings: SocialTemplateSettings, format: SocialFormat) {
  const { width, height } = SOCIAL_FORMAT_INFO[format];
  const { scale, insetTopPx, insetBottomPx } = settings.formats[format];
  return {
    width,
    height,
    scale,
    insetTop: insetTopPx,
    insetBottom: insetBottomPx,
    logoWidth: settings.logo.widthPx * scale,
    logoTop: settings.logo.topPx * scale + insetTopPx,
    topShadeHeight: settings.topShade.heightPx * scale + insetTopPx,
    bottomShadeHeight: settings.bottomShade.heightPx * scale + insetBottomPx,
    titleSize: settings.title.sizePx * scale,
    titleTracking: settings.title.trackingEm,
    titleBaseline: height - settings.title.baselineFromBottomPx * scale - insetBottomPx,
    lineWidth: settings.line.widthPx * scale,
    lineHeight: Math.max(1, settings.line.heightPx * scale),
    lineTop: height - settings.line.topFromBottomPx * scale - insetBottomPx,
    captionSize: settings.caption.sizePx * scale,
    captionTracking: settings.caption.trackingEm,
    captionBaseline: height - settings.caption.baselineFromBottomPx * scale - insetBottomPx,
    textMaxWidth: Math.max(80, width - 2 * settings.sideMarginPx * scale),
  };
}

export type SocialGuideRect = { x: number; y: number; w: number; h: number };

/**
 * Strefy grafiki znormalizowane do formatu (0…1) — nakładka natywnego edytora kadru na Macu i w CRM: logo, teksty
 * i strefy zasłaniane w relacji przez interfejs Instagrama. `logoAspect` — szerokość / wysokość pliku logo.
 */
export function socialLayoutGuides(settings: SocialTemplateSettings, format: SocialFormat, logoAspect: number | null) {
  const layout = socialGraphicLayout(settings, format);
  const logoHeight = layout.logoWidth / (logoAspect && logoAspect > 0 ? logoAspect : 1.34);
  const textTop = Math.min(layout.titleBaseline - layout.titleSize, layout.lineTop, layout.captionBaseline - layout.captionSize);
  const textBottom = Math.max(layout.captionBaseline + layout.captionSize * 0.3, layout.lineTop + layout.lineHeight);
  const rect = (x: number, y: number, w: number, h: number): SocialGuideRect => ({
    x: round(x / layout.width), y: round(y / layout.height), w: round(w / layout.width), h: round(h / layout.height),
  });
  return {
    logo: rect((layout.width - layout.logoWidth) / 2, layout.logoTop, layout.logoWidth, logoHeight),
    text: rect((layout.width - layout.textMaxWidth) / 2, textTop, layout.textMaxWidth, textBottom - textTop),
    unsafeTop: layout.insetTop > 0 ? rect(0, 0, layout.width, layout.insetTop) : null,
    unsafeBottom: layout.insetBottom > 0 ? rect(0, layout.height - layout.insetBottom, layout.width, layout.insetBottom) : null,
  };
}

const round = (value: number) => Math.round(value * 10000) / 10000;

export type SocialFontFace = { family: string; src: string | null };

export type SocialGraphicInput = {
  format: SocialFormat;
  /** Zdjęcie (wersja robocza) i kadr znormalizowany do zdjęcia; `null` — tło w kolorze przyciemnienia. */
  photo: { src: string; crop: SocialCrop } | null;
  logo: { src: string } | null;
  titleFont: SocialFontFace;
  captionFont: SocialFontFace;
  /** Kolory z księgi znaku: przyciemnienie, akcent (kreska i podpis), tekst (tytuł) — `#rrggbb`. */
  colors: { overlay: string; accent: string; text: string };
  settings: SocialTemplateSettings;
  headline: string;
  subline: string;
};

const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

/** `#rgb`, `#rrggbb` albo `#rrggbbaa` (kanał alfa pomijany) → `[r, g, b]` albo `null`. */
export function parseHexColor(value: unknown): [number, number, number] | null {
  const raw = String(value || '').trim().replace(/^#/, '');
  const hex = /^[0-9a-f]{3}$/i.test(raw) ? raw.split('').map((part) => part + part).join('') : raw.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(hex) || ![3, 6, 8].includes(raw.length)) return null;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

const css = (rgb: [number, number, number], alpha: number) =>
  `rgba(${rgb.map((channel) => Math.round(channel)).join(',')},${Math.round(alpha * 1000) / 1000})`;

// Gradient jak pliki PSD: kolor i krycie zmieniają się liniowo (bez mnożenia przez alfę) — 9 przystanków.
function gradient(from: [number, number, number], to: [number, number, number], fromAlpha: number, toAlpha: number) {
  const stops: string[] = [];
  for (let index = 0; index <= 8; index += 1) {
    const t = index / 8;
    const rgb = from.map((channel, position) => channel + (to[position] - channel) * t) as [number, number, number];
    stops.push(`${css(rgb, fromAlpha + (toAlpha - fromAlpha) * t)} ${Math.round(t * 1000) / 10}%`);
  }
  return `linear-gradient(to bottom,${stops.join(',')})`;
}

const fontFormat = (src: string) => {
  const match = /^data:font\/([a-z0-9-]+)/i.exec(src) || /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(src);
  const ext = (match?.[1] || '').toLowerCase();
  if (ext === 'otf' || ext === 'opentype') return 'opentype';
  if (ext === 'woff2') return 'woff2';
  if (ext === 'woff') return 'woff';
  return 'truetype';
};

const fontFace = (name: string, font: SocialFontFace) =>
  font.src
    ? `@font-face{font-family:'${name}';src:url("${font.src.replaceAll('"', '%22')}") format("${fontFormat(font.src)}");font-weight:400;font-style:normal;font-display:block;}`
    : '';

const fontStack = (name: string, font: SocialFontFace) =>
  font.src ? `'${name}'` : font.family.split(',').map((part) => `'${part.trim().replace(/['"]/g, '')}'`).join(',');

/** Pełny dokument HTML grafiki w wymiarach formatu. */
export function buildSocialGraphicHtml(input: SocialGraphicInput): string {
  const layout = socialGraphicLayout(input.settings, input.format);
  const overlay = parseHexColor(input.colors.overlay) || [0, 0, 0];
  const accent = parseHexColor(input.colors.accent) || overlay;
  const text = parseHexColor(input.colors.text) || accent;
  const topTint = overlay.map((channel) => channel * (1 - input.settings.topShade.darken)) as [number, number, number];
  const bottomTint = overlay.map((channel) => channel * (1 - input.settings.bottomShade.darken)) as [number, number, number];
  const headline = socialGraphicText(input.headline);
  const subline = socialGraphicText(input.subline);
  const cx = layout.width / 2;

  let photo = '';
  if (input.photo) {
    const crop = input.photo.crop;
    const width = layout.width / crop.w;
    const height = layout.height / crop.h;
    photo = `<img id="photo" alt="" src="${input.photo.src.replaceAll('"', '%22')}" style="left:${(-crop.x * width).toFixed(3)}px;top:${(-crop.y * height).toFixed(3)}px;width:${width.toFixed(3)}px;height:${height.toFixed(3)}px">`;
  }

  const textNode = (id: string, value: string, baseline: number, size: number, tracking: number, color: string, family: string) => {
    const spacing = size * tracking;
    // Odstęp liter dodaje się także za ostatnią literą — przesunięcie o połowę wyrównuje środek tekstu.
    return `<text id="${id}" x="${(cx + spacing / 2).toFixed(2)}" y="${baseline.toFixed(2)}" text-anchor="middle" font-size="${size.toFixed(2)}" data-tracking="${tracking}" style="letter-spacing:${spacing.toFixed(2)}px;font-family:${family}" fill="${color}">${escapeXml(value)}</text>`;
  };

  const svgParts: string[] = [];
  if (headline) {
    svgParts.push(textNode('title', headline, layout.titleBaseline, layout.titleSize, layout.titleTracking, css(text, 1), fontStack('MvSocialTitle', input.titleFont)));
  }
  if ((headline || subline) && layout.lineWidth > 0) {
    svgParts.push(`<rect x="${(cx - layout.lineWidth / 2).toFixed(2)}" y="${layout.lineTop.toFixed(2)}" width="${layout.lineWidth.toFixed(2)}" height="${layout.lineHeight.toFixed(2)}" fill="${css(accent, 1)}"/>`);
  }
  if (subline) {
    svgParts.push(textNode('caption', subline, layout.captionBaseline, layout.captionSize, layout.captionTracking, css(accent, 1), fontStack('MvSocialCaption', input.captionFont)));
  }

  const fontLoads = [
    headline && input.titleFont.src ? `document.fonts.load(${JSON.stringify(`${layout.titleSize.toFixed(0)}px MvSocialTitle`)},${JSON.stringify(headline)})` : '',
    subline && input.captionFont.src ? `document.fonts.load(${JSON.stringify(`${layout.captionSize.toFixed(0)}px MvSocialCaption`)},${JSON.stringify(subline)})` : '',
  ].filter(Boolean);

  const script = `(function(){
var root=document.documentElement;
function ready(){root.setAttribute('data-ready','1');}
function fit(){var max=${layout.textMaxWidth.toFixed(2)},cx=${cx.toFixed(2)};['title','caption'].forEach(function(id){var el=document.getElementById(id);if(!el||!el.getComputedTextLength)return;var size=parseFloat(el.getAttribute('font-size'));var tr=parseFloat(el.getAttribute('data-tracking'))||0;var guard=0;while(el.getComputedTextLength()>max&&size>6&&guard<80){size=size*0.97;el.setAttribute('font-size',size.toFixed(2));el.style.letterSpacing=(size*tr).toFixed(2)+'px';el.setAttribute('x',(cx+size*tr/2).toFixed(2));guard++;}});}
var waits=[${fontLoads.join(',')}];
[].slice.call(document.images).forEach(function(img){if(!img.complete)waits.push(new Promise(function(r){img.onload=r;img.onerror=r;}));});
var fonts=document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve();
Promise.all(waits.map(function(p){return Promise.resolve(p).catch(function(){});})).then(function(){return fonts;}).then(function(){try{fit();}catch(e){}ready();},function(){ready();});
})();`;

  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=${layout.width}">
<style>
${fontFace('MvSocialTitle', input.titleFont)}${fontFace('MvSocialCaption', input.captionFont)}
html,body{margin:0;padding:0;width:${layout.width}px;height:${layout.height}px;overflow:hidden;background:${css(overlay, 1)};}
#canvas{position:relative;width:${layout.width}px;height:${layout.height}px;overflow:hidden;background:${css(overlay, 1)};}
#photo{position:absolute;display:block;max-width:none;}
.shade{position:absolute;left:0;width:100%;pointer-events:none;}
#logo{position:absolute;left:${((layout.width - layout.logoWidth) / 2).toFixed(2)}px;top:${layout.logoTop.toFixed(2)}px;width:${layout.logoWidth.toFixed(2)}px;height:auto;display:block;}
svg{position:absolute;left:0;top:0;overflow:visible;}
text{font-weight:400;}
</style></head><body><div id="canvas">${photo}
<div class="shade" style="top:0;height:${layout.topShadeHeight.toFixed(2)}px;background:${gradient(topTint, topTint, input.settings.topShade.opacity, 0)}"></div>
<div class="shade" style="bottom:0;height:${layout.bottomShadeHeight.toFixed(2)}px;background:${gradient(overlay, bottomTint, 0, input.settings.bottomShade.opacity)}"></div>
${input.logo ? `<img id="logo" alt="" src="${input.logo.src.replaceAll('"', '%22')}">` : ''}
<svg width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" xmlns="http://www.w3.org/2000/svg">${svgParts.join('')}</svg>
</div><script>${script}</script></body></html>`;
}
