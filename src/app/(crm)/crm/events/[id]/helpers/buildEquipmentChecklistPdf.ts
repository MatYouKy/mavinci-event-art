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
}: {
  eventName: string;
  eventDate: string;
  location: ILocation | any;
  equipmentItems: EquipmentItem[];
  authorName: string;
  authorNumber: string;
}) => {
  let rowNumber = 1;

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

    const brandModel = brand && model ? `${brand} - ${model}` : brand ? brand : model ? model : '—';

    const extra = item.cable_length
      ? ` <span class="muted">(${esc(item.cable_length)}m)</span>`
      : '';

    return `
          <div class="bm">${esc(brandModel)}</div>
          <div class="nm">
            <em>${esc(name || '—')}</em>
            ${extra}
            ${item.is_kit ? ` <span class="tag">(ZESTAW)</span>` : ''}
          </div>
        `;
  };

  const rows = equipmentItems
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
                  <div class="bm muted">↳ ${esc(brandModel || '—')}</div>
                  <div class="nm muted"><em>${esc(name || '—')}</em></div>
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

  const locText = formatLocation(location);

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <title>Checklista sprzętu – ${esc(eventName)}</title>
  <style>
    @page { size: A4; margin: 10mm 10mm 18mm 10mm; }

    html, body { margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #111827;
      font-size: 9.5px;
      line-height: 1.2;
      padding-bottom: 18mm;
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

    .name {
      padding-top: 0 !important;
      line-height: 1.05;
    }

    h1 {
      font-size: 16px;
      margin: 0 0 6px;
      font-weight: 700;
    }

    .meta { font-size: 10px; }
    .meta-row { margin-bottom: 2px; }
    
    .right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;   /* ✅ KLUCZ */
      text-align: right;
      min-width: 160px;
    }

    .logo { max-width: 105px; height: auto; margin-bottom: 4px;  filter: grayscale(100%); }

    table {
      border-collapse: collapse;
      width: 100%;
      table-layout: fixed;
    }

    thead { display: table-header-group; }

    th, td { border: 1px solid #333; }
    td { vertical-align: top; }
    td { padding: 3px 4px; }      /* globalnie ciaśniej */
    td.name { padding-top: 1px; padding-bottom: 8px; }
    th {
      background: #f3f4f6;
      font-size: 9px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 5px 6px;
    }

    tr.row { break-inside: avoid; page-break-inside: avoid; }

    /* kolumny */
    .lp { width: 9mm; text-align: center; }
    .qty { width: 9mm; text-align: center; font-weight: 700; }
    .tick {  
      width: 12mm;
      padding: 0;
      text-align: center;
      vertical-align: middle;
    }
    .tick .cb {
      display: inline-block;    /* ✅ żeby text-align działał */
      width: 12px;
      height: 12px;
      border: 1.6px solid #111;
      box-sizing: border-box;
    }
    .notes { width: 26mm; }

    .bm { font-weight: 800; line-height: 1.05; margin: 0; }
    .nm { margin-top: 1px; line-height: 1.05; margin: 0; }
    .name > div { margin: 0; display: block; padding: 0;} 
    .muted { color: #6b7280; }
    .tag { color: #6b7280; font-weight: 600; font-size: 9px; }

    tr.kit td { background: #fafafa; }

    /* ✅ stopka zawsze w całości */
    .page-break { break-before: page; page-break-before: always; }

    .signatures {
      margin-top: 8mm;
      height: 10mm;
      display: flex;
      justify-content: space-between;
      gap: 14mm;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .signature-box { flex: 1; text-align: center; }
    .signature-line {
      margin-top: 4mm;
      border-top: 1px solid #333;
      font-size: 9px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="left">
      <h1>Checklista sprzętu – Nota załadunkowa</h1>
      <div class="meta">
        <div class="meta-row"><strong>Wydarzenie:</strong> ${esc(eventName)}</div>
        <div class="meta-row"><strong>Data:</strong> ${esc(eventDate || '-')}</div>
        <div class="meta-row"><strong>Lokalizacja:</strong> ${esc(locText)}</div>
      </div>
    </div>

    <div class="right">
      <img src="/shape-mavinci-black.png" alt="Logo" class="logo" />
      <div class="meta">
        <div class="meta-row"><strong>Opiekun:</strong> ${esc(authorName || '-')}</div>
        <div class="meta-row"><strong>Tel:</strong> ${esc(authorNumber || '-')}</div>
      </div>
    </div>
  </div>

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
      ${
        rows ||
        `<tr class="row"><td colspan="6" style="padding:8px;text-align:center;color:#999;">Brak sprzętu do załadowania</td></tr>`
      }
    </tbody>
  </table>

  <div class="signatures">
    <div class="signature-box">
      <div class="signature-line">Osoba po stronie Magazynu</div>
    </div>
    <div class="signature-box">
      <div class="signature-line">Osoba po stronie Event</div>
    </div>
  </div>
</body>
</html>`;
};
