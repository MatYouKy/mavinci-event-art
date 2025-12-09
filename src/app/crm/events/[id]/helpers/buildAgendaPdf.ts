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
  contactName,
  contactNumber,
  agendaItems,
  agendaNotes = [],
  lastUpdated,
  authorName,
  authorNumber,
}: {
  eventName: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  clientContact: string;
  contactName: string;
  contactNumber: string;
  agendaItems: { time: string; title: string; description: string }[];
  agendaNotes?: AgendaNote[];
  lastUpdated?: string;
  authorName: string;
  authorNumber: string;
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
        const children =
          note.children && note.children.length > 0 ? renderNotes(note.children) : '';

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

  const formatLastUpdated = (dateStr?: string): string => {
    if (!dateStr)
      return new Date().toLocaleString('pl-PL', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

    const date = new Date(dateStr);
    return date.toLocaleString('pl-PL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const notesHtml =
    agendaNotes && agendaNotes.length > 0
      ? `
      <h2 style="padding-top: 16px; border-top: 0.5px solid #333;">Uwagi</h2>
      <div style="margin-top:8px;line-height:1.6;margin-bottom:24px;">
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
    html, body {
      margin: 0;
      padding: 0;
      height: 100vh;
    }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      color: #111827;
      padding: 24px 24px 0 24px;
      display: flex;
      flex-direction: column;
      min-height: 297mm;
      height: 100%;
    }
    .page-container {
      height: calc(297mm - 120px);
      position: relative;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .content {
      flex: 1;
      height: 100%;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }
    .header-left {
      flex: 1;
      padding-right: 16px;
    }
    .header-right {
      flex-shrink: 0;
      min-width: 220px;
      text-align: right;
    }
    .logo {
      max-width: 150px;
      height: auto;
      filter: grayscale(100%);
      margin-top: 12px;
      margin-left: auto;
      display: block;
    }
    h1 {
      font-size: 20px;
      margin: 0 0 8px;
    }
    h2 {
      font-size: 14px;
      margin: 8px 0;
    }
    .meta {
      margin-bottom: 12px;
      font-size: 12px;
      line-height: 1.5;
    }
    .meta-row {
      margin-bottom: 2px;
    }
    .meta-right {
      margin-bottom: 8px;
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
  <div class="page-container">
    <div class="content">
      <div class="header">
        <div class="header-left">
          <h1>Agenda wydarzenia</h1>
          <div class="meta">
            <div class="meta-row"><strong>Nazwa:</strong> ${eventName}</div>
            <div class="meta-row"><strong>Klient:</strong> ${clientContact || '-'}</div>
            <div class="meta-row"><strong>Osoba kontaktowa:</strong> ${contactName || '-'}</div>
            <div class="meta-row"><strong>Telefon kontaktowy:</strong> ${contactNumber || '-'}</div>
            <div class="meta-row"><strong>Data:</strong> ${eventDate || '-'}</div>
            <div class="meta-row"><strong>Godziny:</strong> ${startTime || '--:--'} – ${endTime || '--:--'}</div>
          </div>
        </div>
        <div class="header-right">
          <div class="meta meta-right">
            <img src="/logo-mavinci-crm.png" alt="Mavinci CRM" class="logo" />
            <div class="meta-row"><strong>Sprzedawca:</strong> ${authorName || '-'}</div>
            <div class="meta-row"><strong>Telefon sprzedawcy:</strong> ${authorNumber || '-'}</div>
            <div class="meta-row"><strong>Ostatnia aktualizacja:</strong> ${formatLastUpdated(lastUpdated)}</div>
          </div>
          
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
          ${
            rows ||
            `<tr><td colspan="3" style="padding:8px 10px;border:1px solid #ddd;">Brak etapów</td></tr>`
          }
        </tbody>
      </table>
      ${notesHtml}
    </div>
  </div>
</body>
</html>
`;
};