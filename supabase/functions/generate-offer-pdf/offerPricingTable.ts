import { PDFDocument, PDFFont, PDFPage, rgb, RGB } from 'npm:pdf-lib@1.17.1';

/** Shared by CRM offers, seller offers and the public seller demo. */
export function drawPaginatedOfferPricingTable(
  pdf: PDFDocument, pageIndex: number, items: any[], totalNet: number,
  regular: PDFFont, bold: PDFFont, config: any = {},
) {
  if (!items.length) return;
  const firstPage = pdf.getPage(pageIndex);
  const { width, height } = firstPage.getSize();
  const color = (hex: string | undefined, fallback: string): RGB => {
    const value = /^#?([\da-f]{6})$/i.exec(hex || fallback)?.[1] || fallback.slice(1);
    return rgb(parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255);
  };
  const headerColor = color(config.header_color, '#680025');
  const headerText = color(config.header_text_color, '#ffffff');
  const textColor = color(config.text_color, '#0c1a30');
  const summaryColor = color(config.summary_color, '#680025');
  const left = config.margin_left ?? 45;
  const tableWidth = Math.min(config.table_width || width - left - (config.margin_right ?? 45), width - left - 20);
  const fontSize = Math.max(7, Math.min(12, config.body_font_size || 9));
  const headerSize = Math.max(7, Math.min(11, config.header_font_size || 9));
  const lineHeight = fontSize + 3;
  const headerHeight = Math.max(config.header_height || 34, headerSize * 2 + 12);
  const rowHeight = Math.max(config.row_height || 27, lineHeight + 12);
  const showSummary = config.show_summary !== false;
  const discount = Number(config.discount_amount || 0);
  const summaryGap = 12;
  const summaryHeight = showSummary ? summaryGap + 44 + (discount > 0 ? 56 : 0) : 0;
  const bottom = 110; // Reserved for continuation notes and the document footer.
  const continuationTop = 122;
  const capacity = height - continuationTop - headerHeight - bottom;
  const maxLines = Math.max(1, Math.floor((capacity - summaryHeight - 12) / lineHeight));
  const money = (value: number) => value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  type Column = { key: string; label: string; width: number; align: 'left' | 'right' | 'center' };
  const columns: Column[] = [
    { key: 'lp', label: 'Lp.', width: config.col_lp_width || 22, align: 'left' },
    { key: 'name', label: 'Nazwa pozycji', width: 0, align: 'left' },
    ...(config.show_quantity === false ? [] : [{ key: 'quantity', label: 'Ilość', width: config.col_qty_width || 34, align: 'center' as const }]),
    { key: 'unit', label: 'Jedn.', width: config.col_unit_width || 32, align: 'center' },
  ];
  if (config.show_unit_price_net !== false) columns.push({ key: 'price', label: 'Cena jedn.\nnetto', width: config.col_unit_price_width || 56, align: 'right' });
  if (config.show_vat_column === true) columns.push({ key: 'vat', label: 'VAT', width: config.col_vat_width || 34, align: 'center' });
  if (config.show_value_net !== false) columns.push({ key: 'net', label: 'Wartość\nnetto', width: config.col_value_net_width || 66, align: 'right' });
  if (config.show_value_gross !== false) columns.push({ key: 'gross', label: 'Wartość\nbrutto', width: config.col_value_gross_width || 66, align: 'right' });
  const fixedWidth = columns.reduce((sum, col) => sum + col.width, 0);
  // Keep configured columns inside the page even in narrower legacy templates.
  const scale = Math.min(1, (tableWidth - 90) / fixedWidth);
  columns.forEach(col => { col.width *= scale; });
  columns[1].width = tableWidth - columns.reduce((sum, col) => sum + col.width, 0);

  const wrap = (value: string, maxWidth: number): string[] => {
    const lines: string[] = [];
    for (const paragraph of String(value).replace(/\r/g, '').split('\n')) {
      let current = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = current ? `${current} ${word}` : word;
        if (regular.widthOfTextAtSize(candidate, fontSize) <= maxWidth) { current = candidate; continue; }
        if (current) lines.push(current);
        current = '';
        // Also break single long product codes/URLs without losing characters.
        for (const char of word) {
          if (current && regular.widthOfTextAtSize(current + char, fontSize) > maxWidth) { lines.push(current); current = ''; }
          current += char;
        }
      }
      lines.push(current);
    }
    return lines;
  };
  type Row = { index: number; lines: string[]; values: Record<string, string>; height: number; continued: boolean; parentId?: string };
  const rows: Row[] = [];
  let computedNet = 0;
  let computedGross = 0;
  items.forEach((item, index) => {
    const quantity = Number(item.quantity ?? 1);
    const price = Number(item.unit_price ?? item.final_price ?? 0);
    const vat = Number(item.product?.vat_rate ?? item.vat_rate ?? config.vat_rate ?? 23);
    const missing = config.demo_mode && item.demo_price_entered === false;
    const net = missing ? 0 : round(Number(item.subtotal ?? quantity * price));
    const gross = round(net * (1 + vat / 100));
    computedNet += net;
    computedGross += gross;
    const name = String(item.name || item.product?.name || 'Pozycja');
    const description = item.calculation_note || (config.show_description ? String(item.description || item.product?.description || '') : '');
    const lines = wrap([name, description].filter(Boolean).join('\n'), columns[1].width - 10);
    const values = {
      lp: `${index + 1}.`, quantity: quantity.toLocaleString('pl-PL'), unit: item.unit || 'szt.',
      price: item.price_label || (missing ? '—' : money(price)), vat: `${vat}%`, net: missing ? '—' : money(net), gross: missing ? '—' : money(gross),
    };
    for (let offset = 0; offset < lines.length; offset += maxLines) {
      const part = lines.slice(offset, offset + maxLines);
      rows.push({ index, lines: part, values, height: Math.max(rowHeight, part.length * lineHeight + 12), continued: offset > 0, parentId: item.pricing_parent_id });
    }
  });

  type Sheet = { page: PDFPage; top: number; bottom: number; rows: Row[] };
  const sheets: Sheet[] = [{ page: firstPage, top: config.start_y || 155, bottom: config.table_bottom_margin ?? 220, rows: [] }];
  const appendSheet = () => {
    const page = pdf.insertPage(pageIndex + sheets.length, [width, height]);
    page.drawRectangle({ x: 0, y: 0, width, height, color: color(config.continuation_background_color, '#faf7f2') });
    sheets.push({ page, top: continuationTop, bottom, rows: [] });
  };
  rows.forEach((row, index) => {
    let sheet = sheets[sheets.length - 1];
    const used = sheet.rows.reduce((sum, entry) => sum + entry.height, 0);
    const next = rows[index + 1];
    // Keep the base package with its first extra whenever both fit on one page.
    const firstInGroup = row.parentId && rows[index - 1]?.parentId !== row.parentId;
    const nextHeight = firstInGroup && next?.parentId === row.parentId && row.height + next.height <= capacity - summaryHeight ? next.height : 0;
    const required = row.height + nextHeight + (index === rows.length - 1 || (nextHeight > 0 && index === rows.length - 2) ? summaryHeight : 0);
    if (height - sheet.top - headerHeight - used - required < sheet.bottom) {
      appendSheet();
      sheet = sheets[sheets.length - 1];
    }
    sheet.rows.push(row);
  });

  const drawCell = (page: PDFPage, value: string, x: number, y: number, w: number, size: number, font: PDFFont, ink: RGB, align: Column['align'] = 'left') => {
    const safeValue = String(value).replace(/[\r\n\t]/g, ' ');
    const naturalWidth = font.widthOfTextAtSize(safeValue, size);
    const fitted = naturalWidth > w - 10 ? size * (w - 10) / naturalWidth : size;
    const textWidth = font.widthOfTextAtSize(safeValue, fitted);
    page.drawText(safeValue, { x: align === 'right' ? x + w - 5 - textWidth : align === 'center' ? x + (w - textWidth) / 2 : x + 5, y, size: fitted, font, color: ink });
  };
  const borderColor = color(config.border_color, '#ded9d4');
  const drawGrid = (page: PDFPage, top: number, end: number) => {
    if (!config.show_borders) return;
    const line = (x1: number, y1: number, x2: number, y2: number) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: config.border_width ?? 0.5, color: borderColor });
    if (config.show_horizontal_borders !== false) line(left, end, left + tableWidth, end);
    if (config.show_outer_border) { line(left, top, left, end); line(left + tableWidth, top, left + tableWidth, end); }
    if (config.show_vertical_borders) {
      let x = left;
      columns.slice(0, -1).forEach(col => { x += col.width; line(x, top, x, end); });
    }
  };
  sheets.forEach((sheet, sheetIndex) => {
    const { page } = sheet;
    if (sheetIndex > 0) {
      drawCell(page, config.continuation_title || (config.demo_mode ? 'PRÓBNA KALKULACJA · CIĄG DALSZY' : 'WYCENA · CIĄG DALSZY'), left - 5, height - 65, tableWidth, 19, bold, headerColor);
      drawCell(page, config.continuation_note || 'Kontynuacja pozycji z poprzedniej strony. Wszystkie kwoty w PLN.', left - 5, height - 92, tableWidth, 9, regular, textColor);
    }
    let y = height - sheet.top;
    if (sheet.rows.length) {
      page.drawRectangle({ x: left, y: y - headerHeight, width: tableWidth, height: headerHeight, color: headerColor });
      let x = left;
      columns.forEach(col => {
        const lines = col.label.split('\n');
        lines.forEach((line, i) => drawCell(page, line, x, y - (headerHeight - lines.length * (headerSize + 1)) / 2 - headerSize - i * (headerSize + 1), col.width, headerSize, bold, headerText, col.align));
        x += col.width;
      });
      y -= headerHeight;
    }
    sheet.rows.forEach(row => {
      page.drawRectangle({ x: left, y: y - row.height, width: tableWidth, height: row.height, color: row.index % 2 ? color(config.row_odd_bg_color, '#f4f0e8') : color(config.row_bg_color, '#ffffff') });
      let x = left;
      columns.forEach(col => {
        if (col.key === 'name') {
          row.lines.forEach((line, i) => drawCell(page, line, x, y - 6 - fontSize - i * lineHeight, col.width, fontSize, regular, textColor));

        }
        else drawCell(page, row.continued ? (col.key === 'lp' ? `${row.index + 1}. cd.` : '') : row.values[col.key], x, y - 6 - fontSize, col.width, fontSize, regular, textColor, col.align);
        x += col.width;
      });
      drawGrid(page, y, y - row.height);
      y -= row.height;
    });
    const last = sheetIndex === sheets.length - 1;
    if (last && showSummary) {
      // Include this spacing in pagination so the final item stays with its summary.
      page.drawLine({ start: { x: left, y: y - summaryGap / 2 }, end: { x: left + tableWidth, y: y - summaryGap / 2 }, thickness: 0.6, color: borderColor });
      y -= summaryGap;
      const net = Number.isFinite(totalNet) ? totalNet : computedNet;
      const gross = Number.isFinite(Number(config.total_gross)) ? Number(config.total_gross) : computedGross;
      const hasPrices = !config.demo_mode || items.some(item => item.demo_price_entered);
      const partial = config.demo_mode && items.some(item => !item.demo_price_entered);
      const numericStart = columns.findIndex(col => col.key === 'net' || col.key === 'gross');
      const labelWidth = columns.slice(0, numericStart < 0 ? columns.length : numericStart).reduce((sum, col) => sum + col.width, 0);
      if (discount > 0) {
        const listNet = Number(config.list_net ?? computedNet);
        const listGross = Number(config.list_gross ?? computedGross);
        const summaryRow = (label: string, netValue: number, grossValue: number) => {
          page.drawRectangle({ x: left, y: y - 28, width: tableWidth, height: 28, color: color(config.row_odd_bg_color, '#f4f0e8') });
          drawCell(page, label, left, y - 18, labelWidth, fontSize, bold, textColor);
          let x = left;
          columns.forEach(col => {
            if (col.key === 'net' || col.key === 'gross') drawCell(page, money(col.key === 'net' ? netValue : grossValue), x, y - 18, col.width, fontSize, bold, textColor, 'right');
            x += col.width;
          });
          y -= 28;
        };
        summaryRow('RAZEM PRZED RABATEM (PLN)', listNet, listGross);
        summaryRow(`RABAT ${money(Number(config.discount_percent || 0))}% (PLN)`, -discount, -round(listGross - gross));
      }
      page.drawRectangle({ x: left, y: y - 44, width: tableWidth, height: 44, color: headerColor });
      drawCell(page, partial ? 'RAZEM WPISANE CENY (PLN)' : discount > 0 ? 'RAZEM PO RABACIE (PLN)' : 'RAZEM (PLN)', left, y - 26, labelWidth, fontSize, bold, headerText);
      let x = left;
      columns.forEach(col => {
        if (col.key === 'net' || col.key === 'gross') {
          drawCell(page, col.key === 'net' ? 'Netto razem' : 'Brutto razem', x, y - 13, col.width, 7, regular, headerText, 'right');
          drawCell(page, hasPrices ? money(col.key === 'net' ? net : gross) : '—', x, y - 30, col.width, fontSize + 1, bold, headerText, 'right');
        }
        x += col.width;
      });
    }
    const note = !last ? 'Dalsze pozycje na kolejnej stronie →' : config.final_note || (showSummary ? 'Koniec kalkulacji · podsumowanie obejmuje wszystkie strony.' : 'Wartość wybranego wariantu znajduje się w porównaniu pakietów.');
    drawCell(page, note, left - 5, sheet.bottom - 20, tableWidth - 90, 8, regular, summaryColor);
    drawCell(page, `Kalkulacja ${sheetIndex + 1} / ${sheets.length}`, left + tableWidth - 95, sheet.bottom - 20, 100, 8, bold, summaryColor, 'right');
  });
}
