export const getContractCssForPrint = () => `
/* ===== BASE: contractA4.css (Twoje, 1:1) ===== */
.contract-a4-container {
  background: #f5f5f5;
  padding: 20px;
  min-height: 100vh;
}

.contract-a4-page {
  position: relative;
  width: 210mm;
  margin: 0 auto 20px auto;
  padding: 20mm 25mm 5mm;
  min-height: 297mm !important;
  background: white;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
  font-family: Arial, sans-serif;
  font-size: 12pt;
  line-height: 1.6;
  color: #000;
  page-break-after: always;
  break-after: page;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.contract-a4-page:last-of-type { margin-bottom: 0; }

.contract-header-logo {
  width: 100%;
  display: flex;
  align-items: center;
  margin-bottom: 4mm;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.contract-header-logo.justify-start { justify-content: flex-start; }
.contract-header-logo.justify-center { justify-content: center; }
.contract-header-logo.justify-end { justify-content: flex-end; }

.contract-header-logo img {
  height: auto;
  object-fit: contain;
  max-width: 80%;
}

.contract-current-date {
  position: absolute;
  top: 20mm;
  right: 25mm;
  text-align: right;
  font-size: 10pt;
  color: #333;
  font-weight: 500;
  z-index: 10;
}

.contract-content {
  flex: 1;
  text-align: justify;
  color: #000;
  font-family: Arial, sans-serif;
  font-size: 12pt;
  line-height: 1.6;
  direction: ltr !important;
  unicode-bidi: embed !important;
  overflow-wrap: break-word;
  word-wrap: break-word;
}

.contract-content > * {
  display: block;
  white-space: pre-wrap;
}

/* inline formatowanie */
.contract-content strong,
.contract-content b,
.contract-content em,
.contract-content i,
.contract-content u,
.contract-content s,
.contract-content strike,
.contract-content del {
  display: inline !important;
}

.contract-content p,
.contract-content pre {
  display: block;
  margin: 0;
  padding: 0;
  text-align: justify;
  white-space: pre-wrap;
  font-family: Arial, sans-serif;
  font-size: 12pt;
  line-height: 1.6;
  border: none;
  background: transparent;
  color: #000;
}

.contract-content s,
.contract-content strike,
.contract-content del {
  text-decoration-line: line-through;
  text-decoration-thickness: 2px;
  text-decoration-skip-ink: none;
}

.contract-content h1,
.contract-content h2,
.contract-content h3,
.contract-content h4 {
  display: block;
  margin-top: 1.5em;
  margin-bottom: 0.75em;
  font-weight: bold;
  white-space: pre-wrap;
  color: #000;
}

.contract-content h1 { font-size: 18pt; text-align: center; }
.contract-content h2 { font-size: 16pt; }
.contract-content h3 { font-size: 14pt; }

.contract-content strong,
.contract-content b { font-weight: bold; color: #000; }

.contract-content em,
.contract-content i { font-style: italic; color: #000; }

.contract-content u { text-decoration: underline; color: #000; }

.contract-footer {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid #d3bb73;
  margin-top: auto;
  width: 100%;
  min-height: 15mm;
  padding-top: 5px;
  background: white;
  pointer-events: none;
  flex-shrink: 0;
  position: relative;
  opacity: 0.7;
}

.footer-logo {
  width: 100%;
  display: flex;
  justify-content: flex-start;
  align-items: center;
}

.footer-logo img { height: 50px; width: auto; object-fit: contain; }

.footer-info {
  width: 100%;
  text-align: right;
  font-size: 10pt;
  color: #333;
  line-height: 1.2;
}

.footer-info p { margin: 4px 0; color: #333; }
.footer-info strong { font-weight: bold; color: #000; }
.footer-info em { font-style: italic; color: #666; }

.footer-page-number {
  position: absolute;
  bottom: 10mm;
  right: 25mm;
  font-size: 10pt;
  color: #666;
}

/* ===== PRINT (iframe) ===== */
@page { size: A4 portrait; margin: 0; }

html, body {
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
}

* {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

/* W iframe NIE robimy visibility:hidden na całe body — bo i tak drukujesz tylko iframe */
.contract-a4-container {
  background: #fff !important;
  padding: 0 !important;
  margin: 0 !important;
  min-height: auto !important;
  box-shadow: none !important;
}

/* kluczowe: usuń “centrowanie” i dolny margines kartki, żeby nie było białych przesunięć */
.contract-a4-page {
  margin: 0 !important;
  box-shadow: none !important;
  width: 210mm !important;
}

/* ostatnia strona bez dokładania pustej */
.contract-a4-page:last-child,
.contract-a4-page:last-of-type {
  page-break-after: auto !important;
  break-after: auto !important;
}

/* ===== PATCH: zamiennik Tailwinda dla numeracji stron ===== */
.contract-page-counter {
  position: absolute;
  bottom: 4mm;
  left: 25mm;
  right: 25mm;
  text-align: center;
  font-size: 10pt;
  color: rgba(0,0,0,0.5);
}
`;