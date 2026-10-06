/** The same renderer is used for a template preview, a frozen contract and its download. */
export async function buildPersonnelPdf(content, options = {}, factory) {
  const html2pdf = factory || (await import('html2pdf.js')).default;
  const root = document.createElement('article');
  root.style.cssText = 'display:flow-root;width:178mm;background:#ffffff;color:#000000;font-family:Arial,sans-serif;font-size:10.5pt;line-height:1.55;text-align:justify;text-align-last:left;';
  if (options.template) {
    const note = document.createElement('p');
    note.textContent = 'SZABLON • POLA W NAWIASACH ZOSTANĄ UZUPEŁNIONE Z FORMULARZA';
    note.style.cssText = 'font-size:7.5pt;color:#000000;margin:0 0 8mm;letter-spacing:.5px;';
    root.appendChild(note);
  }
  for (const [index, paragraph] of content.trim().split(/\n\s*\n/).entries()) {
    const signatureLines = paragraph.split('\n').map(line => line.match(/^\s*(Pracownik|Pracodawca|Zleceniobiorca|Zleceniodawca|Wykonawca|Zamawiający)\s*:\s*[_….\s-]*$/u));
    const signaturePair = signatureLines.length === 2 && signatureLines.every(Boolean)
      ? [['Pracownik','Pracodawca'],['Zleceniobiorca','Zleceniodawca'],['Wykonawca','Zamawiający']].find(pair => pair.every(role => signatureLines.some(match => match[1] === role)))
      : null;
    if (signaturePair) {
      const signatures = document.createElement('div');
      signatures.className = 'personnel-pdf-paragraph';
      signatures.style.cssText = 'display:flex;justify-content:space-between;margin:0 0 4mm;break-inside:avoid;color:#000000;';
      for (const role of signaturePair) {
        const column = document.createElement('div');
        column.style.cssText = 'width:65mm;text-align:center;text-align-last:center;';
        const label = document.createElement('div');
        label.textContent = role;
        const line = document.createElement('div');
        line.textContent = '................................................';
        line.style.cssText = 'margin-top:1.55em;line-height:1;letter-spacing:0.5px;white-space:nowrap;';
        column.append(label,line);
        signatures.appendChild(column);
      }
      root.appendChild(signatures);
      continue;
    }
    const block = document.createElement('div');
    block.className = 'personnel-pdf-paragraph';
    block.style.cssText = 'display:flow-root;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 4mm;break-inside:avoid;';
    const lines = paragraph.split('\n');
    lines.forEach((line, lineIndex) => {
      const heading = line.match(/^\s*§\s*(\d+[a-z]?)\.?\s*(.*)$/iu);
      const followsSectionNumber = lineIndex > 0 && /^\s*§\s*\d+[a-z]?\.?\s*$/iu.test(lines[lineIndex - 1]);
      if (heading) {
        const number = document.createElement('div');
        number.textContent = `§ ${heading[1]}.`;
        number.style.cssText = 'color:#000000;font-size:11pt;font-weight:700;text-align:center;text-align-last:center;margin-bottom:1mm;';
        block.appendChild(number);
        if (!heading[2]) return;
        line = heading[2];
      }
      const node = document.createElement('div');
      if (heading || followsSectionNumber) node.style.cssText = 'color:#000000;font-size:11pt;font-weight:700;text-align:center;text-align-last:center;margin-bottom:3mm;';
      else if (index === 0) node.style.cssText = 'font-size:15pt;font-weight:700;line-height:1.3;margin-bottom:5mm;text-align:center;text-align-last:center;';
      for (const part of line.split(/(\{\{[^}]+\}\})/g)) {
        if (options.template && /^\{\{/.test(part)) {
          const token = document.createElement('span');
          token.textContent = part;
          token.style.cssText = 'color:#000000;font-weight:600;';
          node.appendChild(token);
        } else node.appendChild(document.createTextNode(part));
      }
      block.appendChild(node);
    });
    root.appendChild(block);
  }
  const worker = html2pdf().set({
    margin: [16,16,20,16],
    image: {type:'jpeg',quality:.98}, html2canvas: {scale:2,backgroundColor:'#ffffff'},
    jsPDF: {unit:'mm',format:'a4',orientation:'portrait'},
    pagebreak: {mode:['css','legacy'],avoid:'.personnel-pdf-paragraph'},
  }).from(root).toPdf();
  const pdf = await worker.get('pdf');
  const pages = pdf.internal.getNumberOfPages();
  for (let page=1; page<=pages; page++) {
    pdf.setPage(page);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(0);
    pdf.text(`Strona ${page} / ${pages}`,194,286,{align:'right'});
  }
  pdf.setProperties({title:options.title || 'Umowa',subject:options.template?'Szablon umowy':'Dokument umowy',creator:'Mavinci CRM'});
  return pdf.output('blob');
}
export function downloadPersonnelPdf(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href=url;link.download=name.replace(/[^\p{L}\p{N}_.-]/gu,'_')+'.pdf';
  document.body.appendChild(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),60000);
}
