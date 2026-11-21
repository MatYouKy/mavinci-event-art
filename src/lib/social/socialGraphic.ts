import {
  SOCIAL_FORMAT_INFO, SOCIAL_FORMATS, socialGraphicText, type SocialCrop, type SocialFormat, type SocialGraphicStyle,
} from './socialShared';
import { socialLayoutRect, type SocialLayoutColor, type SocialLayoutDefinition, type SocialLayoutElement, type SocialLayoutPhoto } from './socialLayout';

/*
 * Grafika social media z szablonu marki — jeden HTML dla renderu na serwerze Next (Chromium → JPEG, plik wspólny dla web,
 * Maca i telefonu) i podglądu na żywo w kreatorze CRM (ramka z tym samym HTML). Logo, fonty i kolory pochodzą wyłącznie
 * z księgi znaku marki (szablon wskazuje je po identyfikatorze) — tu są tylko liczby układu z ustawień szablonu.
 * Układ „Klasyczny” jak szablon PSD 1080×1350: logo u góry na środku, przyciemnienie góry i dołu w kolorze przyciemnienia,
 * tytuł (wersaliki, szeroki odstęp liter), kreska w kolorze akcentu, podpis. Pozostałe style (rama, passe-partout, kino,
 * winieta, okładka) zmieniają tylko układ, ramki, maski i cienie — kolory i fonty nadal z szablonu. Opcjonalny napis nad
 * tytułem (np. „REALIZACJA”) w kolorze akcentu. Teksty dłuższe niż szerokość między marginesami są zmniejszane w ramce
 * (skrypt w HTML), dopiero potem grafika jest gotowa (`data-ready="1"` na <html>).
 * Warstwa bez zdjęcia na przezroczystym tle (`photo: null`, `transparent: true`) — podgląd kadru na żywo na Macu: zdjęcie
 * w bieżącym kadrze + ta warstwa = ta sama kompozycja co pełny render (zdjęcie zawsze wypełnia całą grafikę i leży pod
 * wszystkimi pozostałymi elementami; passe-partout i kinowe pasy są nieprzezroczyste).
 * Układ jako dane (`layout`, `socialLayout.ts`) zastępuje styl: tło w kolorze roli, zdjęcia w miejscach (kolaż; zdjęcie 0 —
 * `photo`, kolejne — `photos[n]`), przyciemnienia, prostokąty, logo i teksty z definicji. Warstwa bez zdjęć ma tło
 * z otworami w miejscach zdjęć (maska SVG) — Mac wkłada zdjęcia pod warstwę w tych samych prostokątach.
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

type TextItem = { baseline: number; size: number; tracking: number };

/** Położenie elementów w stylu grafiki (px formatu). `content` — które teksty są na grafice (wpływa na środek bloku). */
export function socialStyleLayout(
  settings: SocialTemplateSettings,
  format: SocialFormat,
  style: SocialGraphicStyle = 'classic',
  content: { kicker: boolean; title: boolean; caption: boolean } = { kicker: false, title: true, caption: true },
) {
  const base = socialGraphicLayout(settings, format);
  const { width: W, height: H, scale: s, insetTop, insetBottom } = base;
  const cx = W / 2;
  const kickerOf = (titleBaseline: number, titleSize: number, size: number): TextItem | null => (content.kicker ? {
    baseline: content.title ? titleBaseline - titleSize * 1.57 : titleBaseline,
    size,
    tracking: 0.42,
  } : null);

  // Klasyczny układ tekstu (pozycje z szablonu) — także rama i winieta.
  let align: 'center' | 'left' = 'center';
  let textX = cx;
  let textMaxWidth = base.textMaxWidth;
  let title: TextItem = { baseline: base.titleBaseline, size: base.titleSize, tracking: base.titleTracking };
  let caption: TextItem = { baseline: base.captionBaseline, size: base.captionSize, tracking: base.captionTracking };
  let line = { x: cx - base.lineWidth / 2, top: base.lineTop, width: base.lineWidth, height: base.lineHeight };
  let kicker = kickerOf(title.baseline, title.size, base.captionSize * 0.9);
  let window: SocialGuideRect | null = null;
  // Logo: szerokość (wysokość z proporcji pliku) albo dopasowanie w polu (kinowy pasek).
  let logo: { mode: 'width'; left: number; top: number; width: number } | { mode: 'fit'; box: SocialGuideRect; maxWidth: number; maxHeight: number } = {
    mode: 'width', left: (W - base.logoWidth) / 2, top: base.logoTop, width: base.logoWidth,
  };
  let topBar = 0;
  let bottomBar = 0;

  /** Blok tekstu (napis, tytuł, kreska, podpis) na środku pasa `[top, bottom]` — zmniejszony, gdy się nie mieści. */
  const centerBlock = (top: number, bottom: number) => {
    const rel = {
      title: 0,
      line: base.lineTop - base.titleBaseline,
      caption: base.captionBaseline - base.titleBaseline,
    };
    const kickerSize = base.captionSize * 0.9;
    const parts: Array<[number, number]> = [];
    if (content.kicker) parts.push([(content.title ? -base.titleSize * 1.57 : 0) - kickerSize * 0.72, content.title ? -base.titleSize * 1.57 : 0]);
    if (content.title) parts.push([-base.titleSize * 0.72, 0]);
    if (content.title || content.caption) parts.push([rel.line, rel.line + base.lineHeight]);
    if (content.caption) parts.push([rel.caption - base.captionSize * 0.72, rel.caption]);
    const blockTop = Math.min(...parts.map((part) => part[0]));
    const blockBottom = Math.max(...parts.map((part) => part[1]));
    const room = Math.max(1, bottom - top);
    const f = Math.min(1, (room * 0.86) / Math.max(1, blockBottom - blockTop));
    const origin = (top + bottom) / 2 - ((blockTop + blockBottom) / 2) * f;
    title = { baseline: origin, size: base.titleSize * f, tracking: base.titleTracking };
    line = { x: cx - (base.lineWidth * f) / 2, top: origin + rel.line * f, width: base.lineWidth * f, height: Math.max(1, base.lineHeight * f) };
    caption = { baseline: origin + rel.caption * f, size: base.captionSize * f, tracking: base.captionTracking };
    kicker = kickerOf(origin, base.titleSize * f, kickerSize * f);
  };

  if (style === 'mat') {
    const margin = Math.round(46 * s);
    const windowTop = Math.round(margin + insetTop * 0.75);
    const band = Math.round(250 * s + insetBottom);
    window = { x: margin, y: windowTop, w: W - 2 * margin, h: H - band - windowTop };
    logo = { mode: 'width', left: (W - base.logoWidth) / 2, top: Math.max(base.logoTop, windowTop + 40 * s), width: base.logoWidth };
    centerBlock(H - band, H - insetBottom);
  } else if (style === 'cinema') {
    const available = H - insetTop - insetBottom;
    const photoHeight = Math.min(W / 1.5, available * 0.58);
    const rest = available - photoHeight;
    topBar = Math.round(insetTop + rest * 0.42);
    bottomBar = Math.round(H - topBar - photoHeight);
    window = { x: 0, y: topBar, w: W, h: H - topBar - bottomBar };
    // Logo i teksty z dala od linii akcentu przy krawędziach zdjęcia.
    const logoBox = { x: 0, y: insetTop + 6 * s, w: W, h: Math.max(1, topBar - insetTop - 28 * s) };
    logo = { mode: 'fit', box: logoBox, maxWidth: base.logoWidth * 0.8, maxHeight: logoBox.h * 0.6 };
    centerBlock(H - bottomBar + 22 * s, H - insetBottom - 6 * s);
  } else if (style === 'cover') {
    const margin = settings.sideMarginPx * s * 0.72;
    align = 'left';
    textX = margin;
    textMaxWidth = Math.max(80, W - 2 * margin);
    logo = { mode: 'width', left: margin, top: base.logoTop, width: base.logoWidth * 0.8 };
    const titleSize = base.titleSize * 1.5;
    title = { baseline: base.lineTop - 30 * s, size: titleSize, tracking: 0.1 };
    caption = { baseline: base.captionBaseline, size: base.captionSize * 1.05, tracking: 0.3 };
    line = { x: margin, top: base.lineTop, width: base.lineWidth * 1.5, height: base.lineHeight };
    kicker = content.kicker ? {
      baseline: content.title ? title.baseline - titleSize * 0.72 - 24 * s : title.baseline,
      size: base.captionSize * 0.95,
      tracking: 0.42,
    } : null;
  }

  return {
    ...base,
    style,
    align,
    textX,
    textMaxWidth,
    title,
    caption,
    line,
    kicker,
    window,
    logo,
    topBar,
    bottomBar,
    /** Rama: odstęp od krawędzi i grubość linii. */
    frameInset: 34 * s,
    frameStroke: Math.max(1.5, 2 * s),
  };
}

/**
 * Strefy grafiki znormalizowane do formatu (0…1) — nakładka natywnego edytora kadru na Macu i w CRM: logo, teksty,
 * widoczna część zdjęcia (passe-partout, kino) i strefy zasłaniane w relacji przez interfejs Instagrama.
 * `logoAspect` — szerokość / wysokość pliku logo.
 */
export function socialLayoutGuides(settings: SocialTemplateSettings, format: SocialFormat, logoAspect: number | null, style: SocialGraphicStyle = 'classic') {
  const layout = socialStyleLayout(settings, format, style);
  const aspect = logoAspect && logoAspect > 0 ? logoAspect : 1.34;
  let logo: SocialGuideRect;
  if (layout.logo.mode === 'width') {
    logo = { x: layout.logo.left, y: layout.logo.top, w: layout.logo.width, h: layout.logo.width / aspect };
  } else {
    const w = Math.min(layout.logo.maxWidth, layout.logo.maxHeight * aspect);
    const h = w / aspect;
    logo = { x: layout.logo.box.x + (layout.logo.box.w - w) / 2, y: layout.logo.box.y + (layout.logo.box.h - h) / 2, w, h };
  }
  const textTop = Math.min(layout.title.baseline - layout.title.size, layout.line.top, layout.caption.baseline - layout.caption.size);
  const textBottom = Math.max(layout.caption.baseline + layout.caption.size * 0.3, layout.line.top + layout.line.height);
  const textLeft = layout.align === 'left' ? layout.textX : (layout.width - layout.textMaxWidth) / 2;
  const rect = (x: number, y: number, w: number, h: number): SocialGuideRect => ({
    x: round(x / layout.width), y: round(y / layout.height), w: round(w / layout.width), h: round(h / layout.height),
  });
  return {
    logo: rect(logo.x, logo.y, logo.w, logo.h),
    text: rect(textLeft, textTop, layout.textMaxWidth, textBottom - textTop),
    unsafeTop: layout.insetTop > 0 ? rect(0, 0, layout.width, layout.insetTop) : null,
    unsafeBottom: layout.insetBottom > 0 ? rect(0, layout.height - layout.insetBottom, layout.width, layout.insetBottom) : null,
    /** Widoczna część zdjęcia — poza nią passe-partout albo kinowe pasy (`null` — zdjęcie na całej grafice). */
    window: layout.window ? rect(layout.window.x, layout.window.y, layout.window.w, layout.window.h) : null,
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
  /** Styl grafiki (brak — „Klasyczny”) i napis nad tytułem (np. „Realizacja”). */
  style?: SocialGraphicStyle;
  kicker?: string;
  /** Tło przezroczyste zamiast koloru przyciemnienia — tylko warstwa podglądu na żywo (render grafiki: brak / `false`). */
  transparent?: boolean;
  /** Układ jako dane — zamiast stylu (`style` dotyczy wtedy tylko slajdów karuzeli, renderowanych bez układu). */
  layout?: SocialLayoutDefinition | null;
  /** Zdjęcia kolażu: indeks = numer miejsca (1–3; miejsce 0 to `photo`), kadr w proporcjach miejsca. */
  photos?: Array<{ src: string; crop: SocialCrop } | null>;
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

const px = (value: number) => `${value.toFixed(2)}px`;

/** Pełny dokument HTML grafiki w wymiarach formatu. */
export function buildSocialGraphicHtml(input: SocialGraphicInput): string {
  if (input.layout) return buildLayoutHtml(input, input.layout);
  const style: SocialGraphicStyle = input.style || 'classic';
  const headline = socialGraphicText(input.headline);
  const subline = socialGraphicText(input.subline);
  const kicker = socialGraphicText(input.kicker || '');
  const layout = socialStyleLayout(input.settings, input.format, style, { kicker: Boolean(kicker), title: Boolean(headline), caption: Boolean(subline) });
  const { width: W, height: H, scale: s } = layout;
  const overlay = parseHexColor(input.colors.overlay) || [0, 0, 0];
  const accent = parseHexColor(input.colors.accent) || overlay;
  const text = parseHexColor(input.colors.text) || accent;
  const topTint = overlay.map((channel) => channel * (1 - input.settings.topShade.darken)) as [number, number, number];
  const bottomTint = overlay.map((channel) => channel * (1 - input.settings.bottomShade.darken)) as [number, number, number];
  const cx = W / 2;
  const background = input.transparent ? 'transparent' : css(overlay, 1);

  let photo = '';
  if (input.photo) {
    const crop = input.photo.crop;
    const width = W / crop.w;
    const height = H / crop.h;
    photo = `<img id="photo" alt="" src="${input.photo.src.replaceAll('"', '%22')}" style="left:${(-crop.x * width).toFixed(3)}px;top:${(-crop.y * height).toFixed(3)}px;width:${width.toFixed(3)}px;height:${height.toFixed(3)}px">`;
  }

  const topShade = (top: number, height: number) =>
    `<div class="shade" style="top:${top ? px(top) : '0'};height:${height.toFixed(2)}px;background:${gradient(topTint, topTint, input.settings.topShade.opacity, 0)}"></div>`;
  const bottomShade = (height: number, opacity: number) =>
    `<div class="shade" style="bottom:0;height:${height.toFixed(2)}px;background:${gradient(overlay, bottomTint, 0, opacity)}"></div>`;

  // Warstwy między zdjęciem a logo — zależne od stylu (przyciemnienia, ramy, maski, cienie).
  const decor: string[] = [];
  if (style === 'classic') {
    decor.push(topShade(0, layout.topShadeHeight), bottomShade(layout.bottomShadeHeight, input.settings.bottomShade.opacity));
  } else if (style === 'frame') {
    decor.push(
      `<div class="fill" style="box-shadow:inset 0 0 ${px(150 * s)} ${css(bottomTint, 0.55)}"></div>`,
      topShade(0, layout.topShadeHeight),
      bottomShade(layout.bottomShadeHeight, input.settings.bottomShade.opacity),
      `<div class="box" style="left:${px(layout.frameInset)};top:${px(layout.frameInset)};width:${px(W - 2 * layout.frameInset)};height:${px(H - 2 * layout.frameInset)};border:${px(layout.frameStroke)} solid ${css(accent, 0.9)}"></div>`,
    );
  } else if (style === 'vignette') {
    decor.push(
      `<div class="fill" style="background:radial-gradient(ellipse 78% 70% at 50% 44%,${css(bottomTint, 0)} 46%,${css(bottomTint, 0.45)} 72%,${css(bottomTint, 0.88)} 100%)"></div>`,
      topShade(0, layout.topShadeHeight),
      bottomShade(layout.bottomShadeHeight * 0.9, input.settings.bottomShade.opacity),
    );
  } else if (style === 'cover') {
    decor.push(
      topShade(0, layout.topShadeHeight),
      bottomShade(Math.min(H, layout.bottomShadeHeight * 1.2), Math.min(0.96, input.settings.bottomShade.opacity + 0.05)),
    );
  } else if (style === 'mat' && layout.window) {
    const box = layout.window;
    const gap = 12 * s;
    decor.push(
      topShade(box.y, input.settings.topShade.heightPx * s),
      `<div class="box" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;box-shadow:0 0 0 ${W + H}px ${css(overlay, 1)},inset 0 0 ${px(30 * s)} rgba(0,0,0,0.55),inset 0 0 0 1px rgba(0,0,0,0.35)"></div>`,
      `<div class="box" style="left:${px(box.x - gap)};top:${px(box.y - gap)};width:${px(box.w + 2 * gap)};height:${px(box.h + 2 * gap)};border:${px(Math.max(1, 1.5 * s))} solid ${css(accent, 0.75)}"></div>`,
    );
  } else if (style === 'cinema' && layout.window) {
    const box = layout.window;
    const hairline = Math.max(1, 1.2 * s);
    const inset = layout.textMaxWidth;
    decor.push(
      `<div class="box" style="left:0;top:${box.y}px;width:${W}px;height:${box.h}px;box-shadow:inset 0 ${px(18 * s)} ${px(30 * s)} ${px(-10 * s)} rgba(0,0,0,0.7),inset 0 ${px(-18 * s)} ${px(30 * s)} ${px(-10 * s)} rgba(0,0,0,0.7)"></div>`,
      `<div class="box" style="left:0;top:0;width:${W}px;height:${layout.topBar}px;background:${css(topTint, 1)}"></div>`,
      `<div class="box" style="left:0;top:${H - layout.bottomBar}px;width:${W}px;height:${layout.bottomBar}px;background:${css(topTint, 1)}"></div>`,
      `<div class="box" style="left:${px((W - inset) / 2)};top:${px(layout.topBar - 14 * s - hairline)};width:${px(inset)};height:${px(hairline)};background:${css(accent, 0.35)}"></div>`,
      `<div class="box" style="left:${px((W - inset) / 2)};top:${px(H - layout.bottomBar + 14 * s)};width:${px(inset)};height:${px(hairline)};background:${css(accent, 0.35)}"></div>`,
    );
  }

  let logo = '';
  let logoCss = '';
  if (input.logo) {
    const src = input.logo.src.replaceAll('"', '%22');
    if (layout.logo.mode === 'width') {
      logo = `<img id="logo" alt="" src="${src}">`;
      logoCss = `#logo{position:absolute;left:${layout.logo.left.toFixed(2)}px;top:${layout.logo.top.toFixed(2)}px;width:${layout.logo.width.toFixed(2)}px;height:auto;display:block;}`;
    } else {
      const box = layout.logo.box;
      logo = `<div id="logobox"><img id="logo" alt="" src="${src}"></div>`;
      logoCss = `#logobox{position:absolute;left:${px(box.x)};top:${px(box.y)};width:${px(box.w)};height:${px(box.h)};display:flex;align-items:center;justify-content:center;}`
        + `#logo{display:block;width:auto;height:auto;max-width:${px(layout.logo.maxWidth)};max-height:${px(layout.logo.maxHeight)};}`;
    }
  }

  const textNode = (id: string, value: string, item: TextItem, color: string, family: string) => {
    const spacing = item.size * item.tracking;
    // Odstęp liter dodaje się także za ostatnią literą — przy środkowaniu przesunięcie o połowę wyrównuje środek tekstu.
    const x = layout.align === 'center' ? cx + spacing / 2 : layout.textX;
    return `<text id="${id}" x="${x.toFixed(2)}" y="${item.baseline.toFixed(2)}" text-anchor="${layout.align === 'center' ? 'middle' : 'start'}" font-size="${item.size.toFixed(2)}" data-tracking="${item.tracking}" style="letter-spacing:${spacing.toFixed(2)}px;font-family:${family}" fill="${color}">${escapeXml(value)}</text>`;
  };

  const svgParts: string[] = [];
  const titleFamily = fontStack('MvSocialTitle', input.titleFont);
  const captionFamily = fontStack('MvSocialCaption', input.captionFont);
  if (kicker && layout.kicker) {
    svgParts.push(textNode('kicker', kicker, layout.kicker, css(accent, 1), captionFamily));
    if (layout.align === 'center') {
      const height = Math.max(1, 1.2 * s);
      const y = layout.kicker.baseline - layout.kicker.size * 0.36 - height / 2;
      svgParts.push(`<rect id="kicker-l" x="0" y="${y.toFixed(2)}" width="0" height="${height.toFixed(2)}" fill="${css(accent, 0.8)}"/>`);
      svgParts.push(`<rect id="kicker-r" x="0" y="${y.toFixed(2)}" width="0" height="${height.toFixed(2)}" fill="${css(accent, 0.8)}"/>`);
    }
  }
  if (headline) {
    svgParts.push(textNode('title', headline, layout.title, css(text, 1), titleFamily));
  }
  if ((headline || subline) && layout.line.width > 0) {
    svgParts.push(`<rect x="${layout.line.x.toFixed(2)}" y="${layout.line.top.toFixed(2)}" width="${layout.line.width.toFixed(2)}" height="${layout.line.height.toFixed(2)}" fill="${css(accent, 1)}"/>`);
  }
  if (subline) {
    svgParts.push(textNode('caption', subline, layout.caption, css(accent, 1), captionFamily));
  }

  const fontLoads = [
    headline && input.titleFont.src ? `document.fonts.load(${JSON.stringify(`${layout.title.size.toFixed(0)}px MvSocialTitle`)},${JSON.stringify(headline)})` : '',
    subline && input.captionFont.src ? `document.fonts.load(${JSON.stringify(`${layout.caption.size.toFixed(0)}px MvSocialCaption`)},${JSON.stringify(subline)})` : '',
    kicker && layout.kicker && input.captionFont.src ? `document.fonts.load(${JSON.stringify(`${layout.kicker.size.toFixed(0)}px MvSocialCaption`)},${JSON.stringify(kicker)})` : '',
  ].filter(Boolean);

  // Dopasowanie: tekst szerszy niż pole między marginesami jest zmniejszany (z odstępem liter); kreski przy napisie
  // nad tytułem układają się po obu stronach jego zmierzonej szerokości.
  const script = `(function(){
var root=document.documentElement;
function ready(){root.setAttribute('data-ready','1');}
function fit(){var max=${layout.textMaxWidth.toFixed(2)},cx=${cx.toFixed(2)},center=${layout.align === 'center' ? 'true' : 'false'};['kicker','title','caption'].forEach(function(id){var el=document.getElementById(id);if(!el||!el.getComputedTextLength)return;var size=parseFloat(el.getAttribute('font-size'));var tr=parseFloat(el.getAttribute('data-tracking'))||0;var guard=0;while(el.getComputedTextLength()>max&&size>6&&guard<80){size=size*0.97;el.setAttribute('font-size',size.toFixed(2));el.style.letterSpacing=(size*tr).toFixed(2)+'px';if(center)el.setAttribute('x',(cx+size*tr/2).toFixed(2));guard++;}});
var k=document.getElementById('kicker'),l=document.getElementById('kicker-l'),r=document.getElementById('kicker-r');if(k&&l&&r&&k.getComputedTextLength){var ks=parseFloat(k.getAttribute('font-size'));var ktr=parseFloat(k.getAttribute('data-tracking'))||0;var half=(k.getComputedTextLength()-ks*ktr)/2,gap=ks*0.9,len=ks*2.2;l.setAttribute('x',(cx-half-gap-len).toFixed(2));l.setAttribute('width',len.toFixed(2));r.setAttribute('x',(cx+half+gap).toFixed(2));r.setAttribute('width',len.toFixed(2));}}
var waits=[${fontLoads.join(',')}];
[].slice.call(document.images).forEach(function(img){if(!img.complete)waits.push(new Promise(function(r){img.onload=r;img.onerror=r;}));});
var fonts=document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve();
Promise.all(waits.map(function(p){return Promise.resolve(p).catch(function(){});})).then(function(){return fonts;}).then(function(){try{fit();}catch(e){}ready();},function(){ready();});
})();`;

  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=${W}">
<style>
${fontFace('MvSocialTitle', input.titleFont)}${fontFace('MvSocialCaption', input.captionFont)}
html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden;background:${background};}
#canvas{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${background};}
#photo{position:absolute;display:block;max-width:none;}
.shade{position:absolute;left:0;width:100%;pointer-events:none;}
.fill{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;}
.box{position:absolute;box-sizing:border-box;pointer-events:none;}
${logoCss}
svg{position:absolute;left:0;top:0;overflow:visible;}
text{font-weight:400;}
</style></head><body><div id="canvas">${photo}
${decor.join('\n')}
${logo}
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${svgParts.join('')}</svg>
</div><script>${script}</script></body></html>`;
}

// Układ jako dane ----------------------------------------------------------------------------------------------------------

function directedGradient(direction: string, rgb: [number, number, number], fromAlpha: number, toAlpha: number) {
  const stops: string[] = [];
  for (let index = 0; index <= 8; index += 1) {
    const t = index / 8;
    stops.push(`${css(rgb, fromAlpha + (toAlpha - fromAlpha) * t)} ${Math.round(t * 1000) / 10}%`);
  }
  const to = direction === 'up' ? 'top' : direction === 'left' ? 'left' : direction === 'right' ? 'right' : 'bottom';
  return `linear-gradient(to ${to},${stops.join(',')})`;
}

/** Grafika z układu: tło, zdjęcia miejsc, potem elementy w kolejności listy; teksty dopasowane do szerokości prostokątów. */
function buildLayoutHtml(input: SocialGraphicInput, layout: SocialLayoutDefinition): string {
  const { width: W, height: H } = SOCIAL_FORMAT_INFO[input.format];
  const s = W / 1080;
  const overlay = parseHexColor(input.colors.overlay) || [0, 0, 0];
  const accent = parseHexColor(input.colors.accent) || overlay;
  const textColor = parseHexColor(input.colors.text) || accent;
  const role = (color: SocialLayoutColor): [number, number, number] => (color === 'accent' ? accent : color === 'text' ? textColor : overlay);
  const box = (element: SocialLayoutElement) => {
    const rect = socialLayoutRect(element, input.format);
    return { left: rect.x * W, top: rect.y * H, width: rect.w * W, height: rect.h * H };
  };
  const position = (b: { left: number; top: number; width: number; height: number }) =>
    `left:${px(b.left)};top:${px(b.top)};width:${px(b.width)};height:${px(b.height)}`;
  const background = css(role(layout.background), 1);
  const texts = {
    headline: socialGraphicText(input.headline),
    subline: socialGraphicText(input.subline),
    kicker: socialGraphicText(input.kicker || ''),
  };

  // Zdjęcia miejsc — zawsze pod pozostałymi elementami (kolejność: numer miejsca).
  const photoElements = layout.elements.filter((item): item is SocialLayoutPhoto => item.type === 'photo').sort((a, b) => a.slot - b.slot);
  const photoParts: string[] = [];
  for (const element of photoElements) {
    const source = element.slot === 0 ? input.photo : input.photos?.[element.slot] || null;
    if (!source) continue;
    const b = box(element);
    const width = b.width / source.crop.w;
    const height = b.height / source.crop.h;
    photoParts.push(`<div class="slot" style="${position(b)};border-radius:${px(element.radius * s)}"><img alt="" src="${source.src.replaceAll('"', '%22')}" style="left:${(-source.crop.x * width).toFixed(3)}px;top:${(-source.crop.y * height).toFixed(3)}px;width:${width.toFixed(3)}px;height:${height.toFixed(3)}px"></div>`);
  }

  // Warstwa podglądu (bez zdjęć): tło z otworami w miejscach zdjęć — maska SVG.
  let backdrop = '';
  if (input.transparent) {
    const holes = photoElements.map((element) => {
      const b = box(element);
      return `<rect x="${b.left.toFixed(2)}" y="${b.top.toFixed(2)}" width="${b.width.toFixed(2)}" height="${b.height.toFixed(2)}" rx="${(element.radius * s).toFixed(2)}" fill="black"/>`;
    }).join('');
    backdrop = `<svg class="layer" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs><mask id="holes" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="${H}" fill="white"/>${holes}</mask></defs><rect x="0" y="0" width="${W}" height="${H}" fill="${background}" mask="url(#holes)"/></svg>`;
  }

  const titleFamily = fontStack('MvSocialTitle', input.titleFont);
  const captionFamily = fontStack('MvSocialCaption', input.captionFont);
  const parts: string[] = [];
  const fits: Array<{ id: string; max: number; anchor: string; x: number }> = [];
  const loads: string[] = [];
  let textIndex = 0;
  for (const element of layout.elements) {
    if (element.type === 'photo') continue;
    const b = box(element);
    if (element.type === 'shade') {
      parts.push(`<div class="el" style="${position(b)};background:${directedGradient(element.direction, role(element.color), element.from, element.to)}"></div>`);
    } else if (element.type === 'box') {
      const fill = element.fill ? `background:${css(role(element.fill.color), element.fill.opacity)};` : '';
      const stroke = element.stroke ? `border:${px(element.stroke.width * s)} solid ${css(role(element.stroke.color), element.stroke.opacity)};` : '';
      parts.push(`<div class="el" style="${position(b)};${fill}${stroke}border-radius:${px(element.radius * s)}"></div>`);
    } else if (element.type === 'logo') {
      if (!input.logo) continue;
      const justify = element.align === 'left' ? 'flex-start' : element.align === 'right' ? 'flex-end' : 'center';
      const align = element.valign === 'top' ? 'flex-start' : element.valign === 'bottom' ? 'flex-end' : 'center';
      parts.push(`<div class="el logo" style="${position(b)};justify-content:${justify};align-items:${align}"><img alt="" src="${input.logo.src.replaceAll('"', '%22')}"></div>`);
    } else if (element.type === 'text') {
      const value = texts[element.bind];
      if (!value) continue;
      textIndex += 1;
      const id = `t${textIndex}`;
      const size = element.size * s;
      const spacing = size * element.tracking;
      const anchor = element.align === 'left' ? 'start' : element.align === 'right' ? 'end' : 'middle';
      // Odstęp liter dodaje się też za ostatnią literą — przesunięcie wyrównuje środek / prawą krawędź tekstu.
      const x = element.align === 'left' ? b.left : element.align === 'right' ? b.left + b.width + spacing : b.left + b.width / 2 + spacing / 2;
      const baseline = b.top + b.height / 2 + size * 0.36;
      const family = element.font === 'title' ? titleFamily : captionFamily;
      const face = element.font === 'title' ? 'MvSocialTitle' : 'MvSocialCaption';
      const font = element.font === 'title' ? input.titleFont : input.captionFont;
      parts.push(`<svg class="layer" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><text id="${id}" x="${x.toFixed(2)}" y="${baseline.toFixed(2)}" text-anchor="${anchor}" font-size="${size.toFixed(2)}" data-tracking="${element.tracking}" style="letter-spacing:${spacing.toFixed(2)}px;font-family:${family}" fill="${css(role(element.color), 1)}">${escapeXml(value)}</text></svg>`);
      fits.push({ id, max: Math.max(20, b.width), anchor, x: element.align === 'center' ? b.left + b.width / 2 : element.align === 'right' ? b.left + b.width : b.left });
      if (font.src) loads.push(`document.fonts.load(${JSON.stringify(`${size.toFixed(0)}px ${face}`)},${JSON.stringify(value)})`);
    }
  }

  const script = `(function(){
var root=document.documentElement;
function ready(){root.setAttribute('data-ready','1');}
var items=${JSON.stringify(fits.map((item) => ({ id: item.id, max: Math.round(item.max * 100) / 100, anchor: item.anchor, x: Math.round(item.x * 100) / 100 })))};
function fit(){items.forEach(function(it){var el=document.getElementById(it.id);if(!el||!el.getComputedTextLength)return;var size=parseFloat(el.getAttribute('font-size'));var tr=parseFloat(el.getAttribute('data-tracking'))||0;var guard=0;while(el.getComputedTextLength()>it.max&&size>5&&guard<90){size=size*0.97;el.setAttribute('font-size',size.toFixed(2));el.style.letterSpacing=(size*tr).toFixed(2)+'px';if(it.anchor==='middle')el.setAttribute('x',(it.x+size*tr/2).toFixed(2));if(it.anchor==='end')el.setAttribute('x',(it.x+size*tr).toFixed(2));guard++;}});}
var waits=[${loads.join(',')}];
[].slice.call(document.images).forEach(function(img){if(!img.complete)waits.push(new Promise(function(r){img.onload=r;img.onerror=r;}));});
var fonts=document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve();
Promise.all(waits.map(function(p){return Promise.resolve(p).catch(function(){});})).then(function(){return fonts;}).then(function(){try{fit();}catch(e){}ready();},function(){ready();});
})();`;

  const canvasBackground = input.transparent ? 'transparent' : background;
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=${W}">
<style>
${fontFace('MvSocialTitle', input.titleFont)}${fontFace('MvSocialCaption', input.captionFont)}
html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden;background:${canvasBackground};}
#canvas{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${canvasBackground};}
.slot{position:absolute;overflow:hidden;}
.slot img{position:absolute;display:block;max-width:none;}
.el{position:absolute;box-sizing:border-box;pointer-events:none;}
.logo{display:flex;}
.logo img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;}
.layer{position:absolute;left:0;top:0;overflow:visible;}
text{font-weight:400;}
</style></head><body><div id="canvas">${backdrop}${photoParts.join('')}
${parts.join('\n')}
</div><script>${script}</script></body></html>`;
}
