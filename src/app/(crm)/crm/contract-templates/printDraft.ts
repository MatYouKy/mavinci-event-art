import { IContractTemplate } from './type';
import { getContractCssForPrint } from '@/components/crm/events/calculations/helpers/getContractCssForPrint';

interface TemplateSettings {
  logoScale: number;
  logoPositionX: number;
  logoPositionY: number;
  lineHeight: number;
  selectedFont: string;
  selectedLogo: string;
  selectedFooter: string;
  footerContent: {
    companyName: string;
    tagline: string;
    website: string;
    email: string;
    phone: string;
    logoUrl: string;
  };
  footerLogoScale: number;
}

const DEFAULT_FOOTER = {
  companyName: 'EVENT RULERS',
  tagline: 'Więcej niż Wodzireje!',
  website: 'www.eventrulers.pl',
  email: 'biuro@eventrulers.pl',
  phone: '698-212-279',
  logoUrl: '/erulers_logo_vect.png',
};

const getTemplateSettings = (pageSettings: any): TemplateSettings => ({
  logoScale: pageSettings?.logoScale ?? 80,
  logoPositionX: pageSettings?.logoPositionX ?? 50,
  logoPositionY: pageSettings?.logoPositionY ?? 0,
  lineHeight: pageSettings?.lineHeight ?? 1.6,
  selectedFont: pageSettings?.selectedFont ?? 'Georgia, serif',
  selectedLogo: pageSettings?.selectedLogo ?? '/erulers_logo_vect.png',
  selectedFooter: pageSettings?.selectedFooter ?? 'default',
  footerContent: pageSettings?.footerContent ?? DEFAULT_FOOTER,
  footerLogoScale: pageSettings?.footerLogoScale ?? 80,
});

const resolveLogoUrl = (url?: string) => {
  const value = url || '/erulers_logo_vect.png';
  return value.startsWith('http') ? value : `https://mavinci.pl${value}`;
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Zamienia placeholdery {{...}} na wykropkowane miejsca do uzupełnienia.
const createDraftList = (itemsCount = 6): string => {
  const items = Array.from(
    { length: itemsCount },
    () => '<li><span class="draft-list-space">&nbsp;</span></li>',
  ).join('');

  return `<ul class="draft-placeholder-list">${items}</ul>`;
};

const replacePlaceholdersWithBlanks = (html: string): string =>
  html.replace(
    /\{\{\s*([^}]+?)\s*\}\}/g,
    (_match, placeholderName: string) => {
      const name = placeholderName.trim();

      const isListPlaceholder =
        /(?:_list|_items|_scope|_table)$/i.test(name);

      if (isListPlaceholder) {
        return createDraftList(3);
      }

      return '<span class="draft-blank"></span>';
    },
  );

const WATERMARK_HTML = `
  <div class="draft-watermark-layer" aria-hidden="true">
    <div class="draft-watermark">WERSJA ROBOCZA</div>
  </div>
`;

const DRAFT_EXTRA_STYLES = `
// .draft-watermark-layer {
//   position: absolute;
//   inset: 0;
//   overflow: hidden;
//   contain: paint;
//   pointer-events: none;
//   z-index: 0;
// }
  .draft-watermark-layer {
  overflow: hidden;
  contain: paint;
}

.draft-watermark {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-35deg);
  font-size: 90pt;
  font-weight: 700;
  letter-spacing: 8px;
  color: rgba(211, 187, 115, 0.18);
  white-space: nowrap;
}



.contract-header-logo,
.contract-content,
.contract-footer {
  position: relative;
  z-index: 1;
}

.contract-current-date {
  z-index: 2;
}

.contract-page-counter {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 2mm;
  text-align: center;
  font-size: 10pt;
  color: #666;
  z-index: 2;
}

.draft-blank {
  display: inline-block;
  min-width: 140px;
  height: 1em;
  border-bottom: 1px dotted #333;
  vertical-align: baseline;
}
  @media print {
  .contract-a4-container[data-pdf-root='1'] .contract-a4-page {
    padding-top: 17mm !important;
    page-break-after: auto !important;
    break-after: auto !important;
  }
}
  .draft-placeholder-list {
  margin: 4px 0 8px;
  padding-left: 24px;
  list-style-type: disc;
}

.draft-placeholder-list li {
  display: list-item !important;
  min-height: 1.4em;
  margin: 2px 0;
}

.draft-list-space {
  display: inline-block;
  min-width: 1px;
}
`;

const buildHeader = (settings: TemplateSettings): string => {
  const justify =
    settings.logoPositionX <= 33
      ? 'justify-start'
      : settings.logoPositionX >= 67
        ? 'justify-end'
        : 'justify-center';

  const dateStr = new Date().toLocaleDateString('pl-PL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `
    <div class="contract-header-logo ${justify}" style="margin-top:${settings.logoPositionY}mm">
      <img src="${resolveLogoUrl(settings.selectedLogo)}" alt="Logo" style="max-width:${settings.logoScale}%;height:auto" />
    </div>
    <div class="contract-current-date">Olsztyn, ${dateStr}</div>`;
};

const buildFooter = (settings: TemplateSettings): string => {
  if (settings.selectedFooter === 'none') return '';

  const footer = settings.footerContent || DEFAULT_FOOTER;
  const logoBlock =
    settings.selectedFooter === 'default'
      ? `<div class="footer-logo">
          <img src="${resolveLogoUrl(footer.logoUrl || settings.selectedLogo)}" alt="Logo" style="max-width:${settings.footerLogoScale || 80}%;height:auto" />
        </div>`
      : '';

  return `
    <div class="contract-footer">
      ${logoBlock}
      <div class="footer-info">
        <p><span class="font-bold" style="font-weight:bold">${escapeHtml(footer.companyName || 'EVENT RULERS')}</span>${
          footer.tagline ? ` &ndash; <span class="italic" style="font-style:italic">${escapeHtml(footer.tagline)}</span>` : ''
        }</p>
        <p>${escapeHtml(footer.website || 'www.eventrulers.pl')} | ${escapeHtml(footer.email || 'biuro@eventrulers.pl')}</p>
        <p>tel: ${escapeHtml(footer.phone || '698-212-279')}</p>
      </div>
    </div>`;
};

const buildPage = (
  pageContent: string,
  pageIndex: number,
  totalPages: number,
  settings: TemplateSettings,
): string => {
  const header = pageIndex === 0 ? buildHeader(settings) : '';
  const minHeight = pageIndex === 0 ? '160mm' : '250mm';
  const counter =
    totalPages > 1
      ? `<div class="contract-page-counter">${pageIndex + 1} z ${totalPages}</div>`
      : '';

  return `
    <div class="contract-a4-page">
      ${WATERMARK_HTML} 
      ${header}
      <div class="contract-content" style="line-height:${settings.lineHeight};font-family:${settings.selectedFont};min-height:${minHeight}">
        ${replacePlaceholdersWithBlanks(pageContent)}
      </div>
      ${buildFooter(settings)}
      ${counter}
    </div>`;
};

// Buduje wyłącznie zawartość stron (bez opakowania .contract-a4-container),
// tak jak innerHTML kontenera w zakładce Umowa. Backend owija je w kontener.
const buildPagesHtml = (template: IContractTemplate): string => {
  const settings = getTemplateSettings(template.page_settings);
  const pages: string[] | undefined = template.page_settings?.pages;

  if (pages && pages.length > 0) {
    return pages
      .map((pageContent, index) => buildPage(pageContent, index, pages.length, settings))
      .join('');
  }

  const body = template.content_html
    ? template.content_html
    : `<pre style="white-space:pre-wrap;word-wrap:break-word;margin:0">${escapeHtml(template.content || '')}</pre>`;
  return buildPage(body, 0, 1, settings);
};

interface DraftResult {
  ok: boolean;
  error?: 'popup' | string;
}

// Generuje draft PDF przez ten sam silnik Chromium co zakładka Umowa w evencie,
// dzięki czemu wygląd jest identyczny. Otwiera gotowy PDF w nowej karcie.
export async function printContractDraft(template: IContractTemplate): Promise<DraftResult> {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return { ok: false, error: 'popup' };

  printWindow.document.write(
    '<html><head><meta charset="utf-8"><title>Generowanie wersji roboczej…</title></head>' +
      '<body style="font-family:Arial,sans-serif;padding:40px;color:#333">' +
      'Generowanie wersji roboczej PDF… Proszę czekać.</body></html>',
  );
  printWindow.document.close();

  try {
    const pagesHtml = buildPagesHtml(template);
    const cssText = getContractCssForPrint() + DRAFT_EXTRA_STYLES;

    const res = await fetch('/bridge/contract-templates/draft-pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pagesHtml,
        cssText,
        title: `${template.name} - wersja robocza`,
      }),
    });

    if (!res.ok) {
      let msg = 'Błąd generowania PDF';
      try {
        const j = await res.json();
        msg = j?.error || msg;
      } catch {
        // brak treści JSON
      }
      printWindow.close();
      return { ok: false, error: msg };
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    printWindow.location.href = url;
    return { ok: true };
  } catch (e: any) {
    printWindow.close();
    return { ok: false, error: e?.message || 'Błąd generowania PDF' };
  }
}
