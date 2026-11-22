import 'server-only';
import { escapeHtml, loadPrintFontCss, renderHtmlToPdf } from '@/lib/print/pdfRenderer.server';

/*
 * PDF dokumentu umowy personelu na serwerze Next (Dysk → Pracownicy → „Umowy” w CRM, na Macu, w Finderze i w telefonie). Układ jak
 * `buildPersonnelPdf` w CRM (`contractPdf.js`, profil → „Umowy i rozliczenia” → „Pobierz PDF”): A4, marginesy 16/16/20/16 mm,
 * akapity rozdzielone pustą linią, pierwszy akapit — tytuł, „§ N.” z nagłówkiem paragrafu wyśrodkowane, para podpisów
 * (Pracownik / Pracodawca, Zleceniobiorca / Zleceniodawca, Wykonawca / Zamawiający) w dwóch kolumnach, numer strony na dole.
 * Treść zawsze jako tekst (escapeHtml) — bez skryptów i bez sieci.
 */

const SIGNATURE = /^\s*(Pracownik|Pracodawca|Zleceniobiorca|Zleceniodawca|Wykonawca|Zamawiający)\s*:\s*[_….\s-]*$/u;
const SIGNATURE_PAIRS = [['Pracownik', 'Pracodawca'], ['Zleceniobiorca', 'Zleceniodawca'], ['Wykonawca', 'Zamawiający']];
const SECTION = /^\s*§\s*(\d+[a-z]?)\.?\s*(.*)$/iu;
const SECTION_ONLY = /^\s*§\s*\d+[a-z]?\.?\s*$/iu;

const CENTER_BOLD = 'color:#000000;font-size:11pt;font-weight:700;text-align:center;text-align-last:center;';

/** HTML dokumentu umowy (bez fontów — `fontCss` z `loadPrintFontCss`). */
export function personnelContractHtml(content: string, title: string, fontCss = ''): string {
  const blocks: string[] = [];
  for (const [index, paragraph] of content.trim().split(/\n\s*\n/).entries()) {
    const lines = paragraph.split('\n');
    const signatures = lines.map((line) => line.match(SIGNATURE));
    const pair = lines.length === 2 && signatures.every(Boolean)
      ? SIGNATURE_PAIRS.find((roles) => roles.every((role) => signatures.some((match) => match?.[1] === role)))
      : undefined;
    if (pair) {
      blocks.push(`<div class="paragraph signatures">${pair.map((role) => (
        `<div class="signature"><div>${escapeHtml(role)}</div><div class="line">................................................</div></div>`
      )).join('')}</div>`);
      continue;
    }
    const parts: string[] = [];
    lines.forEach((raw, lineIndex) => {
      let line = raw;
      const heading = line.match(SECTION);
      const followsSectionNumber = lineIndex > 0 && SECTION_ONLY.test(lines[lineIndex - 1]);
      if (heading) {
        parts.push(`<div style="${CENTER_BOLD}margin-bottom:1mm;">§ ${escapeHtml(heading[1])}.</div>`);
        if (!heading[2]) return;
        line = heading[2];
      }
      const style = heading || followsSectionNumber ? `${CENTER_BOLD}margin-bottom:3mm;`
        : index === 0 ? 'font-size:15pt;font-weight:700;line-height:1.3;margin-bottom:5mm;text-align:center;text-align-last:center;' : '';
      parts.push(`<div${style ? ` style="${style}"` : ''}>${escapeHtml(line)}</div>`);
    });
    blocks.push(`<div class="paragraph">${parts.join('')}</div>`);
  }
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${fontCss}
@page { size: A4; margin: 16mm 16mm 20mm 16mm; }
html, body { margin: 0; padding: 0; background: #ffffff; }
article { display: flow-root; color: #000000; font-family: 'Inter', Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.55;
  text-align: justify; text-align-last: left; }
.paragraph { display: flow-root; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 4mm; break-inside: avoid; }
.signatures { display: flex; justify-content: space-between; white-space: normal; color: #000000; }
.signature { width: 65mm; text-align: center; text-align-last: center; }
.signature .line { margin-top: 1.55em; line-height: 1; letter-spacing: 0.5px; white-space: nowrap; }
</style></head><body><article>${blocks.join('')}</article></body></html>`;
}

/** PDF dokumentu umowy (Chromium na serwerze Next, numer strony w stopce). */
export async function renderPersonnelContractPdf(content: string, title: string): Promise<Buffer> {
  const html = personnelContractHtml(content, title, await loadPrintFontCss());
  const { pdf } = await renderHtmlToPdf({ html, footer: { left: title, right: '' } });
  return pdf;
}
