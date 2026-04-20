import { ILocation } from '@/app/(crm)/crm/locations/type';

interface EquipmentItem {
  name: string;
  model?: string | null;
  brand?: string | null;
  quantity: number;
  cable_length?: number | null;
  is_kit?: boolean;
  expand_kit_in_checklist?: boolean;
  kit_items?: Array<{
    name: string;
    model?: string | null;
    brand?: string | null;
    quantity: number;
  }>;
}

const formatLocation = (loc: ILocation) => {
  if (!loc) return '-';
  if (typeof loc === 'string') return loc;

  const parts = [loc?.address, loc?.postal_code, loc?.city].filter(Boolean);
  return parts.length ? parts.join(', ') : loc?.name || '-';
};

export const buildEquipmentChecklistHtml = ({
  eventName,
  eventDate,
  location,
  equipmentItems,
  authorName,
  authorNumber,
  contactName,
  contactPhone,
}: {
  eventName: string;
  eventDate: string;
  location: ILocation | any;
  equipmentItems: EquipmentItem[];
  authorName: string;
  authorNumber: string;
  contactName?: string;
  contactPhone?: string;
}) => {
  const esc = (s: any) =>
    String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

  const renderMainLabel = (item: EquipmentItem) => {
    const brand = item.brand?.trim();
    const model = item.model?.trim();
    const name = item.name?.trim();

    const brandModel = brand && model ? `${brand} - ${model}` : brand ? brand : model ? model : '';

    const mainBoldLabel = item.is_kit ? name || '—' : brandModel || name || '—';

    const secondaryName = item.is_kit
      ? ''
      : name && name !== mainBoldLabel
        ? `<em>${esc(name)}</em>`
        : '';

    const extra = item.cable_length ? ` <span class="muted">(${esc(item.cable_length)}m)</span>` : '';

    return `
      <div class="bm">${esc(mainBoldLabel)}</div>
      ${
        secondaryName || item.is_kit || extra
          ? `
            <div class="nm">
              ${secondaryName}
              ${extra}
              ${item.is_kit ? ` <span class="tag">(ZESTAW)</span>` : ''}
            </div>
          `
          : ''
      }
    `;
  };

  const getRowUnits = (item: EquipmentItem) => {
    if (item.is_kit && item.expand_kit_in_checklist && item.kit_items?.length) {
      return 1 + item.kit_items.length;
    }
    return 1;
  };

  // Dostosuj po testach wydruku
  const FIRST_PAGE_ROW_UNITS = 29;
  const NEXT_PAGE_ROW_UNITS = 30;
  const LAST_PAGE_RESERVED_UNITS = 2; // miejsce na numer strony + podpisy

  const paginateEquipmentItems = (items: EquipmentItem[]) => {
    if (!items.length) return [[]];

    const pages: EquipmentItem[][] = [];
    let currentPage: EquipmentItem[] = [];
    let currentUnits = 0;
    let pageIndex = 0;

    const getLimitForCurrentPage = () => {
      return pageIndex === 0 ? FIRST_PAGE_ROW_UNITS : NEXT_PAGE_ROW_UNITS;
    };

    for (const item of items) {
      const rowUnits = getRowUnits(item);
      const currentLimit = getLimitForCurrentPage();

      if (currentUnits + rowUnits > currentLimit && currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [];
        currentUnits = 0;
        pageIndex += 1;
      }

      currentPage.push(item);
      currentUnits += rowUnits;
    }

    if (currentPage.length > 0) {
      pages.push(currentPage);
    }

    // Jeśli ostatnia strona jest zbyt zapchana, przenieś kilka rekordów na nową stronę
    if (pages.length > 1) {
      let lastPage = pages[pages.length - 1];
      let lastUnits = lastPage.reduce((sum, item) => sum + getRowUnits(item), 0);

      while (lastUnits > NEXT_PAGE_ROW_UNITS - LAST_PAGE_RESERVED_UNITS && lastPage.length > 1) {
        const moved = lastPage.shift();
        if (!moved) break;

        const prevPage = pages[pages.length - 2];
        const newOverflowPage = [moved, ...lastPage];

        pages[pages.length - 2] = prevPage;
        pages[pages.length - 1] = newOverflowPage;

        lastPage = pages[pages.length - 1];
        lastUnits = lastPage.reduce((sum, item) => sum + getRowUnits(item), 0);

        const prevUnits = prevPage.reduce((sum, item) => sum + getRowUnits(item), 0);
        if (prevUnits > NEXT_PAGE_ROW_UNITS) {
          pages.splice(pages.length - 1, 0, [prevPage.pop() as EquipmentItem]);
        }
      }
    }

    return pages;
  };

  const renderRows = (items: EquipmentItem[], startRowNumber: number) => {
    let rowNumber = startRowNumber;

    return items
      .map((item) => {
        let html = `
          <tr class="row">
            <td class="lp">${rowNumber++}</td>
            <td class="name">${renderMainLabel(item)}</td>
            <td class="qty">${Number(item.quantity ?? 1)}</td>
            <td class="tick"><span class="cb"></span></td>
            <td class="tick"><span class="cb"></span></td>
            <td class="notes"></td>
          </tr>
        `;

        if (item.is_kit && item.expand_kit_in_checklist && item.kit_items?.length) {
          const kitRows = item.kit_items
            .map((k) => {
              const brand = (k.brand || '').trim();
              const model = (k.model || '').trim();
              const brandModel = [brand, model].filter(Boolean).join(' ');
              const name = (k.name || '').trim();

              return `
                <tr class="row kit">
                  <td class="lp muted">—</td>
                  <td class="name">
                    <div class="bm muted">↳ ${esc(brandModel || name || '—')}</div>
                    ${
                      brandModel && name
                        ? `<div class="nm muted"><em>${esc(name)}</em></div>`
                        : ''
                    }
                  </td>
                  <td class="qty muted">${Number(k.quantity ?? 1)}</td>
                  <td class="tick muted" colspan="3"></td>
                </tr>
              `;
            })
            .join('');

          html += kitRows;
        }

        return html;
      })
      .join('');
  };

  const locText = formatLocation(location);
  const pages = paginateEquipmentItems(equipmentItems ?? []);
  const totalPages = pages.length;

  let globalRowNumber = 1;

  const pagesHtml = pages
    .map((pageItems, pageIndex) => {
      const isLastPage = pageIndex === totalPages - 1;
      const rows =
        pageItems.length > 0
          ? renderRows(pageItems, globalRowNumber)
          : `<tr class="row"><td colspan="6" style="padding:8px;text-align:center;color:#999;">Brak sprzętu do załadowania</td></tr>`;

      globalRowNumber += pageItems.length;

      return `
        <section class="page ${pageIndex > 0 ? 'page-break' : ''}">
          ${
            pageIndex === 0
              ? `
              <div class="header">
                <div class="left">
                  <h1>Checklista sprzętu – Nota załadunkowa</h1>
                  <div class="meta">
                    <div class="meta-row"><strong>Wydarzenie:</strong> ${esc(eventName)}</div>
                    <div class="meta-row"><strong>Data:</strong> ${esc(eventDate || '-')}</div>
                    <div class="meta-row"><strong>Lokalizacja:</strong> ${esc(locText)}</div>
                    ${contactName && contactName !== '-' ? `<div class="meta-row"><strong>Kontakt:</strong> ${esc(contactName)}</div>` : ''}
                    ${contactPhone && contactPhone !== '-' ? `<div class="meta-row"><strong>Tel. kontakt:</strong> ${esc(contactPhone)}</div>` : ''}
                  </div>
                </div>

                <div class="right">
                  <img src="/shape-mavinci-black.png" alt="Logo" class="logo" />
                  <div class="meta">
                    <div class="meta-row"><strong>Opiekun:</strong> ${esc(authorName || '-')}</div>
                    <div class="meta-row"><strong>Tel. opiekun:</strong> ${esc(authorNumber || '-')}</div>
                  </div>
                </div>
              </div>
            `
              : `
              <div class="page-top-spacer"></div>
            `
          }

          <table>
            <thead>
              <tr>
                <th class="lp">LP</th>
                <th>SPRZĘT</th>
                <th class="qty">PCS</th>
                <th class="tick">BAZA</th>
                <th class="tick">EVENT</th>
                <th class="notes">UWAGI</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
                    ${
            isLastPage
              ? `
              <div class="signatures">
                <div class="signature-box">
                  <div class="signature-line">Osoba po stronie Magazynu</div>
                </div>
                <div class="signature-box">
                  <div class="signature-line">Osoba po stronie Event</div>
                </div>
              </div>
            `
              : ''
          }

          <div class="page-footer-meta">
            <div class="page-number">Strona ${pageIndex + 1} / ${totalPages}</div>
          </div>


        </section>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <title>Checklista sprzętu – ${esc(eventName)}</title>
  <style>
    @page { size: A4; margin: 10mm 10mm 18mm 10mm; }

    html, body {
      margin: 0;
      padding: 0;
    }

    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #111827;
      font-size: 9.5px;
      line-height: 1.2;
    }

    .page {
      min-height: 252mm;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
    }

    .page-break {
      break-before: page;
      page-break-before: always;
    }

    .page-top-spacer {
      height: 4mm;
    }

    .cb {
      width: 12px;
      height: 12px;
      border: 1.6px solid #111;
    }

    .header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 8px;
      margin-bottom: 8px;
    }

    h1 {
      font-size: 16px;
      margin: 0 0 6px;
      font-weight: 700;
    }

    .meta {
      font-size: 10px;
    }

    .meta-row {
      margin-bottom: 2px;
    }

    .right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      text-align: right;
      min-width: 160px;
    }

    .logo {
      max-width: 105px;
      height: auto;
      margin-bottom: 4px;
      filter: grayscale(100%);
    }

    table {
      border-collapse: separate;
      border-spacing: 0;
      width: 100%;
      table-layout: fixed;
    }

    thead {
      display: table-header-group;
    }

    th, td {
      vertical-align: top;
      padding: 3px 4px;
      border-right: 1px solid #333;
      border-bottom: 1px solid #333;
    }

    th:first-child,
    td:first-child {
      border-left: 1px solid #333;
    }

    thead th {
      background: #f3f4f6;
      font-size: 9px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 5px 6px;
      border-top: 1px solid #333;
    }

    tbody tr:first-child td {
      border-top: 1px solid #333;
    }

    td.name {
      padding-top: 1px;
      padding-bottom: 8px;
      line-height: 1.05;
    }

    tr.row {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .lp {
      width: 9mm;
      text-align: center;
    }

    .qty {
      width: 9mm;
      text-align: center;
      font-weight: 700;
    }

    .tick {
      width: 12mm;
      padding: 0;
      text-align: center;
      vertical-align: middle;
    }

    .tick .cb {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 1.6px solid #111;
      box-sizing: border-box;
    }

    .notes {
      width: 26mm;
    }

    .bm {
      font-weight: 800;
      line-height: 1.05;
      margin: 0;
    }

    .nm {
      margin-top: 1px;
      line-height: 1.05;
      margin: 0;
    }

    .name > div {
      margin: 0;
      display: block;
      padding: 0;
    }

    .muted {
      color: #6b7280;
    }

    .tag {
      color: #6b7280;
      font-weight: 600;
      font-size: 9px;
    }

    tr.kit td {
      background: #fafafa;
    }

    .signatures {
      margin-top: 16mm;
      height: 10mm;
      display: flex;
      justify-content: space-between;
      gap: 14mm;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .page-footer-meta {
      margin-top: auto;
      padding-top: 4mm;
      padding-bottom: 2mm;
      text-align: right;
      font-size: 9px;
      color: #6b7280;
    }

    .page-number {
      border-top: 1px solid #d1d5db;
      padding-top: 2mm;
      box-sizing: border-box;
    }

    .signature-box {
      flex: 1;
      text-align: center;
    }

    .signature-line {
      margin-top: 4mm;
      border-top: 1px solid #333;
      font-size: 9px;
      color: #666;
    }
  </style>
</head>
<body>
  ${pagesHtml}
</body>
</html>`;
};