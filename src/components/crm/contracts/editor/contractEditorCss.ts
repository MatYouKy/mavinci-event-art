import {
  buildContractDocumentStylesCss,
  type ContractDocumentStyles,
} from '@/lib/CRM/contracts/contractDocumentStyles';

/**
 * Arkusz edytora umowy: kartka A4 z marginesami jak w PDF, style dokumentu (te same co w podglądzie i PDF),
 * numeracja punktów 1. / 1.1 / 1.1.1 oraz oznaczenia elementów szablonu (pola, klauzule, warunki).
 */
export const CONTRACT_EDITOR_SCOPE = '.contract-editor-sheet .ProseMirror';

export const buildContractEditorCss = (documentStyles: ContractDocumentStyles) => {
  const scope = CONTRACT_EDITOR_SCOPE;
  const body = documentStyles.styles.body;
  return `
.contract-editor-sheet{position:relative;width:210mm;min-height:297mm;margin:0 auto;padding:20mm 25mm 25mm;box-sizing:border-box;
  background:#fff;color:#000;box-shadow:0 1px 3px rgba(0,0,0,.25),0 8px 24px rgba(0,0,0,.18);}
${scope}{outline:none;min-height:200mm;overflow:visible;padding-bottom:0;font-family:${body.fontFamily};font-size:${body.fontSizePt}pt;
  line-height:${body.lineHeight};color:#000;text-align:${body.textAlign};caret-color:#000;}
${scope} > *{display:block;}
${scope} > table{display:table;}
${scope} p{min-height:1em;}
${scope} ol,${scope} ul{margin-top:0;margin-bottom:0;}
${scope} ol > li::marker{content:counter(list-item) '. ';}
${scope} ol ol > li::marker{content:counters(list-item, '.') ' ';}
${scope} ol[type="a"] > li::marker{content:counter(list-item, lower-alpha) ') ';}
${scope} ol[type="A"] > li::marker{content:counter(list-item, upper-alpha) ') ';}
${scope} ol[type="i"] > li::marker{content:counter(list-item, lower-roman) ') ';}
${scope} ol[type="I"] > li::marker{content:counter(list-item, upper-roman) ') ';}
${scope} li[data-style="heading"]::marker{font-weight:700;}
${scope} table{width:100%;border-collapse:collapse;table-layout:fixed;}
${scope} td,${scope} th{vertical-align:top;padding:2pt 4pt;outline:1px dashed rgba(60,60,60,.25);outline-offset:-1px;}
${scope} .selectedCell{background:rgba(66,133,244,.12);}
${scope} img{max-width:100%;height:auto;}
${scope} a{color:inherit;text-decoration:underline;}
${buildContractDocumentStylesCss(documentStyles, scope)}
${scope} .contract-editor-field{background:rgba(211,187,115,.22);border-radius:2px;box-shadow:inset 0 -1px 0 rgba(160,128,40,.65);}
${scope} .contract-editor-field--auto{background:rgba(66,133,244,.14);box-shadow:inset 0 -1px 0 rgba(66,133,244,.6);}
${scope} .contract-editor-slot{margin:3pt 0;padding:5pt 8pt;border:1px dashed rgba(66,133,244,.7);border-radius:4px;
  background:rgba(66,133,244,.06);color:#2a5bb8;font:600 8pt/1.3 Arial,sans-serif;text-align:left;cursor:default;user-select:none;}
${scope} .contract-editor-slot.ProseMirror-selectednode{outline:2px solid #4285f4;}
${scope} li > p.contract-editor-slot-lead{display:none;}
${scope} li > p.contract-editor-slot-lead + .contract-editor-slot{margin-top:0;}
${scope} li[data-contract-shared-clause]{box-shadow:inset 2px 0 0 rgba(66,133,244,.55);}
${scope} .contract-editor-cond{position:relative;background:rgba(150,110,220,.07);box-shadow:inset 2px 0 0 rgba(150,110,220,.6);}
${scope} .contract-editor-cond::after{content:attr(data-condition-label);position:absolute;right:-23mm;top:0;width:21mm;
  font:600 6.5pt/1.2 Arial,sans-serif;color:#7d5bc2;text-align:left;white-space:normal;pointer-events:none;}
${scope} div.contract-editor-cond{margin:2pt -3pt;padding:2pt 3pt;border:1px dashed rgba(150,110,220,.55);border-radius:3px;box-shadow:none;}
${scope} div.contract-editor-cond .contract-editor-cond::after{right:-26mm;}
${scope} .contract-editor-cond--off{opacity:.32;}
${scope} .contract-editor-cond--off::after{content:attr(data-condition-label) ' — ukryte';color:#9b9b9b;}
${scope} li[data-contract-shared-clause]::after{content:'klauzula wspólna';position:absolute;right:-23mm;width:21mm;
  font:600 6.5pt/1.2 Arial,sans-serif;color:#2a5bb8;text-align:left;}
${scope} li[data-contract-shared-clause]{position:relative;}
${scope} p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:#9a9a9a;float:left;height:0;pointer-events:none;}
`;
};
