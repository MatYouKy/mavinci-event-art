import { IContractTemplate } from './type';

const FOOTER_HTML = `
  <div class="draft-footer">
    <div class="draft-footer-logo">
      <img src="/erulers_logo_vect.png" alt="EVENT RULERS" style="height:30px" />
    </div>
    <p style="margin:0"><strong>EVENT RULERS</strong> &ndash; <em>Wi&#281;cej ni&#380; Wodzireje!</em></p>
    <p style="margin:5px 0 0 0">www.eventrulers.pl | biuro@eventrulers.pl | tel: 698-212-279</p>
  </div>
`;

const DRAFT_STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #f1f1f1;
    font-family: 'Arial', sans-serif;
    font-size: 12pt;
    line-height: 1.6;
    color: #000;
  }
  .draft-page {
    position: relative;
    width: 210mm;
    min-height: 297mm;
    padding: 20mm;
    margin: 0 auto 10mm auto;
    background: #fff;
    box-shadow: 0 0 10px rgba(0,0,0,0.15);
    overflow: hidden;
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
    pointer-events: none;
    z-index: 0;
  }
  .draft-content {
    position: relative;
    z-index: 1;
    text-align: justify;
  }
  .draft-content p { margin-bottom: 1em; text-align: justify; }
  .draft-content h1 { font-size: 18pt; font-weight: bold; margin: 1.5em 0 0.5em; }
  .draft-content h2 { font-size: 16pt; font-weight: bold; margin: 1.5em 0 0.5em; }
  .draft-content h3 { font-size: 14pt; font-weight: bold; margin: 1.5em 0 0.5em; }
  .draft-content ul, .draft-content ol { margin-left: 1.5em; margin-bottom: 1em; }
  .draft-content li { margin-bottom: 0.5em; }
  .draft-content strong, .draft-content b { font-weight: 600; }
  .draft-content em { font-style: italic; }
  .draft-content u { text-decoration: underline; }
  .draft-content table { width: 100%; border-collapse: collapse; }
  .draft-content-plain {
    white-space: pre-wrap;
    word-wrap: break-word;
    font-size: 11pt;
    margin: 0;
  }
  .draft-footer {
    position: absolute;
    bottom: 15mm;
    left: 20mm;
    right: 20mm;
    text-align: center;
    font-size: 10pt;
    color: #666;
    border-top: 1px solid #ddd;
    padding-top: 10px;
    z-index: 1;
  }
  .draft-footer-logo {
    display: flex;
    justify-content: center;
    margin-bottom: 10px;
  }
  @media print {
    body { background: #fff; }
    .draft-page {
      margin: 0;
      box-shadow: none;
      page-break-after: always;
    }
    @page { size: A4; margin: 0; }
  }
`;

function renderPages(template: IContractTemplate): string {
  const pages: string[] | undefined = template.page_settings?.pages;

  if (pages && pages.length > 0) {
    return pages
      .map(
        (pageContent) => `
        <div class="draft-page">
          <div class="draft-watermark">WERSJA ROBOCZA</div>
          <div class="draft-content">${pageContent}</div>
          ${FOOTER_HTML}
        </div>`,
      )
      .join('');
  }

  const body = template.content_html
    ? `<div class="draft-content">${template.content_html}</div>`
    : `<pre class="draft-content draft-content-plain">${escapeHtml(template.content || '')}</pre>`;

  return `
    <div class="draft-page">
      <div class="draft-watermark">WERSJA ROBOCZA</div>
      ${body}
      ${FOOTER_HTML}
    </div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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
  <style>${DRAFT_STYLES}</style>
</head>
<body>
  ${renderPages(template)}
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
