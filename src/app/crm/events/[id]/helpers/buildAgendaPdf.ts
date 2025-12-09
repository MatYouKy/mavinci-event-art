interface AgendaNote {
  id?: string;
  content: string;
  order_index: number;
  level: number;
  parent_id: string | null;
  children?: AgendaNote[];
}

export const buildAgendaHtml = ({
  eventName,
  eventDate,
  startTime,
  endTime,
  clientContact,
  agendaItems,
  agendaNotes = [],
}: {
  eventName: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  clientContact: string;
  agendaItems: { time: string; title: string; description: string }[];
  agendaNotes?: AgendaNote[];
}) => {
  const rows = agendaItems
    .map(
      (item) => `
        <tr>
          <td style="padding:6px 10px;border:1px solid #ddd;">${item.time || ''}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;font-weight:600;">
            ${item.title || ''}
          </td>
          <td style="padding:6px 10px;border:1px solid #ddd;">${item.description || ''}</td>
        </tr>
      `,
    )
    .join('');

  const renderNotes = (notes: AgendaNote[]): string => {
    if (!notes || notes.length === 0) return '';

    return notes
      .map((note) => {
        const indent = note.level * 20;
        const children = note.children && note.children.length > 0 ? renderNotes(note.children) : '';

        return `
          <div style="margin-left:${indent}px;margin-bottom:6px;">
            <div style="display:flex;align-items:start;">
              <span style="margin-right:8px;color:#666;">•</span>
              <span>${note.content || ''}</span>
            </div>
            ${children}
          </div>
        `;
      })
      .join('');
  };

  const notesHtml = agendaNotes && agendaNotes.length > 0
    ? `
      <h2>Uwagi</h2>
      <div style="margin-top:8px;line-height:1.6;">
        ${renderNotes(agendaNotes)}
      </div>
    `
    : '';

  return `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <title>Agenda – ${eventName}</title>
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      color: #111827;
      margin: 24px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }
    .header-left {
      flex: 1;
    }
    .header-right {
      flex-shrink: 0;
      margin-left: 20px;
    }
    .logo {
      max-width: 150px;
      height: auto;
      filter: grayscale(100%);
    }
    h1 {
      font-size: 20px;
      margin: 0 0 4px;
    }
    h2 {
      font-size: 14px;
      margin: 16px 0 8px;
    }
    .meta {
      margin-bottom: 12px;
      font-size: 12px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-top: 8px;
    }
    th {
      text-align: left;
      padding: 6px 10px;
      border: 1px solid #ddd;
      background: #f3f4f6;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>Agenda wydarzenia</h1>
      <div class="meta">
        <div><strong>Nazwa:</strong> ${eventName}</div>
        <div><strong>Data:</strong> ${eventDate || '-'}</div>
        <div><strong>Godziny:</strong> ${startTime || '--:--'} – ${endTime || '--:--'}</div>
        <div><strong>Klient:</strong> ${clientContact || '-'}</div>
      </div>
    </div>
    <div class="header-right">
      <img src="/logo-mavinci-crm.png" alt="Mavinci CRM" class="logo" />
    </div>
  </div>

  <h2>Harmonogram</h2>
  <table>
    <thead>
      <tr>
        <th style="width:80px;">Godzina</th>
        <th>Etap</th>
        <th>Opis</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="3" style="padding:8px 10px;border:1px solid #ddd;">Brak etapów</td></tr>`}
    </tbody>
  </table>

  ${notesHtml}
</body>
</html>
`;
};