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
const replacePlaceholdersWithBlanks = (html: string): string =>
  html.replace(/\{\{\s*[^}]+\s*\}\}/g, '<span class="draft-blank"></span>');

const WATERMARK_HTML = '<div class="draft-watermark">WERSJA ROBOCZA</div>';

const DRAFT_EXTRA_STYLES = `
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
  pointer-events: none;
  z-index: 0;
}
.contract-header-logo,
.contract-current-date,
.contract-content,
.contract-footer,
.contract-page-counter {
  position: relative;
  z-index: 1;
}
.draft-blank {
  display: inline-block;
  min-width: 140px;
  border-bottom: 1px dotted #333;
  height: 1em;
  vertical-align: baseline;
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

const renderContainer = (template: IContractTemplate): string => {
  const settings = getTemplateSettings(template.page_settings);
  const pages: string[] | undefined = template.page_settings?.pages;

  let pagesHtml: string;
  if (pages && pages.length > 0) {
    pagesHtml = pages
      .map((pageContent, index) => buildPage(pageContent, index, pages.length, settings))
      .join('');
  } else {
    const body = template.content_html
      ? template.content_html
      : `<pre style="white-space:pre-wrap;word-wrap:break-word;margin:0">${escapeHtml(template.content || '')}</pre>`;
    pagesHtml = buildPage(body, 0, 1, settings);
  }

  return `<div class="contract-a4-container">${pagesHtml}</div>`;
};

export function printContractDraft(template: IContractTemplate): boolean {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;

  const baseUrl = window.location.origin;
  const html = `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <base href="${baseUrl}/" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(template.name)} - wersja robocza</title>
  <style>${getContractCssForPrint()}${DRAFT_EXTRA_STYLES}</style>
</head>
<body>
  ${renderContainer(template)}
  <script>
    window.onload = function () {
      setTimeout(function () { window.print(); }, 400);
    };
  </script>
</body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  return true;
}


export { printContractDraft }