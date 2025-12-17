interface EquipmentItem {
  name: string;
  model?: string;
  quantity: number;
  category?: string;
  cable_length?: number;
  is_kit?: boolean;
  kit_items?: Array<{
    name: string;
    model?: string;
    quantity: number;
  }>;
}

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
  location: string;
  equipmentItems: EquipmentItem[];
  authorName: string;
  authorNumber: string;
}) => {
  let rowNumber = 1;

  const rows = equipmentItems
    .map((item) => {
      const itemName = item.cable_length
        ? `${item.name} (${item.cable_length}m)`
        : item.model
          ? `${item.name} ${item.model}`
          : item.name;

      let html = `
        <tr>
          <td style="padding:8px 10px;border:1px solid #ddd;text-align:center;">${rowNumber++}</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-weight:600;">
            ${itemName}${item.is_kit ? ' <span style="color:#666;font-weight:normal;">(ZESTAW)</span>' : ''}
          </td>
          <td style="padding:8px 10px;border:1px solid #ddd;text-align:center;font-weight:600;">${item.quantity}</td>
          <td style="padding:8px 10px;border:1px solid #ddd;text-align:center;width:60px;">☐</td>
          <td style="padding:8px 10px;border:1px solid #ddd;text-align:center;width:60px;">☐</td>
          <td style="padding:8px 10px;border:1px solid #ddd;"></td>
        </tr>
      `;

      if (item.is_kit && item.kit_items && item.kit_items.length > 0) {
        const kitRows = item.kit_items.map((kitItem) => {
          const kitItemName = kitItem.model ? `${kitItem.name} ${kitItem.model}` : kitItem.name;
          return `
            <tr style="background:#f9fafb;">
              <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;color:#666;">—</td>
              <td style="padding:6px 10px 6px 30px;border:1px solid #ddd;color:#666;font-size:11px;">
                ↳ ${kitItemName}
              </td>
              <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;color:#666;">${kitItem.quantity}</td>
              <td colspan="3" style="padding:6px 10px;border:1px solid #ddd;background:#fafafa;"></td>
            </tr>
          `;
        }).join('');
        html += kitRows;
      }

      return html;
    })
    .join('');

  return `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <title>Checklista sprzętu – ${eventName}</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
    }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      color: #111827;
      padding: 24px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 2px solid #333;
    }
    .header-left {
      flex: 1;
    }
    .header-right {
      flex-shrink: 0;
      min-width: 180px;
      text-align: right;
    }
    .logo {
      max-width: 120px;
      height: auto;
      filter: grayscale(100%);
      margin-bottom: 8px;
    }
    h1 {
      font-size: 24px;
      margin: 0 0 12px;
      font-weight: 600;
    }
    .meta {
      margin-bottom: 8px;
      font-size: 12px;
      line-height: 1.6;
    }
    .meta-row {
      margin-bottom: 3px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-top: 16px;
    }
    th {
      text-align: left;
      padding: 10px;
      border: 1px solid #333;
      background: #f3f4f6;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }
    .signatures {
      margin-top: 60px;
      display: flex;
      justify-content: space-between;
      gap: 40px;
    }
    .signature-box {
      flex: 1;
      text-align: center;
    }
    .signature-line {
      border-top: 1px solid #333;
      margin-top: 40px;
      padding-top: 8px;
      font-size: 11px;
      color: #666;
    }
    .page-break {
      page-break-after: always;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>Checklista sprzętu – Nota załadunkowa</h1>
      <div class="meta">
        <div class="meta-row"><strong>Wydarzenie:</strong> ${eventName}</div>
        <div class="meta-row"><strong>Data:</strong> ${eventDate || '-'}</div>
        <div class="meta-row"><strong>Lokalizacja:</strong> ${location || '-'}</div>
      </div>
    </div>
    <div class="header-right">
      <img src="/logo-mavinci-crm.png" alt="Logo" class="logo" />
      <div class="meta">
        <div class="meta-row"><strong>Opiekun:</strong> ${authorName || '-'}</div>
        <div class="meta-row"><strong>Tel:</strong> ${authorNumber || '-'}</div>
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:50px;text-align:center;">Lp</th>
        <th>Nazwa sprzętu</th>
        <th style="width:80px;text-align:center;">Ilość</th>
        <th style="width:80px;text-align:center;">☐ Załadowano</th>
        <th style="width:80px;text-align:center;">☐ Zwrócono</th>
        <th style="width:120px;">Uwagi</th>
      </tr>
    </thead>
    <tbody>
      ${
        rows ||
        `<tr><td colspan="6" style="padding:12px 10px;border:1px solid #ddd;text-align:center;color:#999;">Brak sprzętu do załadowania</td></tr>`
      }
    </tbody>
  </table>

  <div class="signatures">
    <div class="signature-box">
      <div class="signature-line">
        Osoba wydająca sprzęt
      </div>
    </div>
    <div class="signature-box">
      <div class="signature-line">
        Osoba przyjmująca sprzęt
      </div>
    </div>
  </div>
</body>
</html>
`;
};
