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
  companyLogoUrl,
  company,
  contactPerson,
  preparedBy,
}: {
  eventName: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  clientContact: string;
  contactName: string;
  contactNumber: string;
  agendaItems: Array<{ time?: string; title?: string; description?: string }>;
  agendaNotes?: AgendaNote[];
  lastUpdated?: string;
  authorName: string;
  authorNumber: string;
  companyLogoUrl?: string | null;
  company?: any;
contactPerson?: {
  name: string;
  email?: string | null;
  phone?: string | null;
} | null;
preparedBy?: {
  name: string;
  email?: string | null;
  phone?: string | null;
} | null;
}) => {
  let rowNumber = 1;

  const esc = (s: any) =>
    String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

  const formatLastUpdated = (dateStr?: string): string => {
    const d = dateStr ? new Date(dateStr) : new Date();
    return d.toLocaleString('pl-PL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const clean = (v: any) => String(v ?? '').trim();

  const rows =
    (agendaItems || [])
      .map((item) => {
        const t = clean(item?.time) || '—';
        const title = clean(item?.title) || '—';
        const desc = clean(item?.description) || ' ';

        return `
          <tr class="row">
            <td class="lp">${rowNumber++}</td>
            <td class="time">${esc(t)}</td>
            <td class="topic">
              <div class="topic-inner">
                <div class="title-line">${esc(title)}</div>
                <div class="desc-line"><em>${esc(desc)}</em></div>
              </div>
            </td>
          </tr>
        `;
      })
      .join('') ||
    `
      <tr class="row">
        <td colspan="3" style="padding:10px;text-align:center;color:#999;">
          Brak pozycji w agendzie
        </td>
      </tr>
    `;

  const renderNotes = (notes: AgendaNote[]): string => {
    if (!notes || notes.length === 0) return '';

    return notes
      .map((note) => {
        const lvl = Number(note.level ?? 0);
        const indent = Math.min(4, Math.max(0, lvl)) * 12; // ograniczamy, żeby nie “uciekało”
        const children = note.children?.length ? renderNotes(note.children) : '';

        return `
          <div class="note" style="margin-left:${indent}px">
            <div class="note-row">
              <span class="dot">•</span>
              <span class="note-text">${esc(note.content || '')}</span>
            </div>
            ${children}
          </div>
        `;
      })
      .join('');
  };

  const notesHtml =
    agendaNotes && agendaNotes.length
      ? `
        <div class="notes-block">
          <div class="notes-title">Uwagi</div>
          <div class="notes-list">
            ${renderNotes(agendaNotes)}
          </div>
        </div>
      `
      : '';

  const timeRange =
    [clean(startTime), clean(endTime)].filter(Boolean).length > 0
      ? `${clean(startTime) || '—'} – ${clean(endTime) || '—'}`
      : '—';

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <title>Agenda – ${esc(eventName)}</title>
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

    header {
      padding-bottom: 12px;
      margin-bottom: 16px;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: start;
      gap: 18px;
    }

    header h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 300;
      letter-spacing: 0.4px;
    }

header .event-meta {
  font-size: 9.5px;
  color: #555;
  margin-top: 6px;
  line-height: 1.4;
  font-weight: 400;
}

header .event-meta strong {
  color: #1c1f33;
  font-weight: 600;
}

    header .logo-wrap {
      display: flex;
      justify-content: center;
      align-items: center;
      min-width: 120px;
    }

    header img.logo {
      display: block;
      max-height: 76px;
      max-width: 130px;
      object-fit: contain;
    }

    header .meta {
      font-size: 9.5px;
      color: #555;
      text-align: right;
      line-height: 1.4;
    }

    header .meta strong {
      color: #1c1f33;
    }

    header .meta .company-name {
      font-size: 11px;
      color: #1c1f33;
      font-weight: 600;
    }

    header .event-meta div {
      margin-bottom: 2px;
    }

    .company-claim {
      font-size: 8.5px;
      font-style: italic;
      letter-spacing: 0.4px;
      color: #777;
      margin-top: 1px;
    }

    .prepared-by {
      margin-top: 8px;
    }

    h1 {
      font-size: 16px;
      margin: 0 0 6px;
      font-weight: 700;
    }

    /* tabela */
    table {
      border-collapse: collapse;
      width: 100%;
      table-layout: fixed;
    }

    thead { display: table-header-group; }

    th, td { border: 1px solid #333; }
    td { vertical-align: top; padding: 0px 6px; }

    th {
      background: #f3f4f6;
      font-size: 9px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 0 6px 6px 6px;
    }

    tr.row { break-inside: avoid; page-break-inside: avoid; height: 10mm; }

    .lp { width: 9mm; text-align: center; }
    .time { width: 18mm; text-align: center; font-weight: 700; align-items: center; }

    .lp,
    .time {
      text-align: center;
      vertical-align: middle;
      font-weight: 700;
    }
    .title { width: 46mm; font-weight: 800; line-height: 1.05; }
    .topic { padding: 4px 8px; vertical-align: top;}
    .desc { width: auto; line-height: 1.05; }
    .tick {
      width: 12mm;
      padding: 0;
      text-align: center;
      vertical-align: middle;
    }
    .topic-inner{
      display: block; 
    }

    .cb {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 1.6px solid #111;
      box-sizing: border-box;
    }

    /* uwagi */
    .notes-block {
      margin-top: 10px;
      padding-top: 8px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .notes-title {
      font-size: 11px;
      font-weight: 800;
      margin-bottom: 6px;
    }
    .notes-list { font-size: 10px; line-height: 1.25; }

    .note { margin-bottom: 5px; }
    .note-row {
      display: flex;
      align-items: flex-start;
      gap: 6px;
    }
    .dot { color: #6b7280; }
    .note-text { color: #111827; }

    .title-line {
      font-size: 10.5px;
      font-weight: 800;
      line-height: 1.2;
      margin: 0;
    }
    .desc-line {
      margin-top: 3px;
      font-size: 9.5px;
      line-height: 1.35;
      color: #6b7280;
    }
    .desc-line em { font-style: italic; }
  </style>
</head>
<body>
  <header>
  <div>
    <h1>Agenda wydarzenia</h1>

    <div class="event-meta">
      ${eventName ? `<div>Wydarzenie: <strong>${esc(eventName)}</strong></div>` : ''}
      ${eventDate ? `<div>Data: <strong>${esc(eventDate)}</strong></div>` : ''}
      ${timeRange ? `<div>Godziny: <strong>${esc(timeRange)}</strong></div>` : ''}

      ${
        contactPerson?.name || contactName
          ? `<div>Agenda dla: <strong>${esc(contactPerson?.name || contactName)}</strong></div>`
          : ''
      }
      ${
        contactPerson?.phone || contactNumber
          ? `<div>Telefon: ${esc(contactPerson?.phone || contactNumber)}</div>`
          : ''
      }
      ${contactPerson?.email ? `<div>E-mail: ${esc(contactPerson.email)}</div>` : ''}
    </div>
  </div>

  <div class="logo-wrap">
    ${
      company?.logo_url || companyLogoUrl
        ? `<img class="logo" src="${esc(company?.logo_url || companyLogoUrl)}" alt="${esc(company?.name || '')}" />`
        : ''
    }
  </div>

  <div class="meta">
    ${
      company
        ? `<div class="company-name">${esc(company.legal_name || company.name || '')}</div>`
        : `<div class="company-name">MAVINCI SP. Z O.O.</div>`
    }

    <div class="prepared-by">
      ${preparedBy?.name || authorName ? `<div>Przygotowane przez: <strong>${esc(preparedBy?.name || authorName)}</strong></div>` : ''}
      ${preparedBy?.phone || authorNumber ? `<div>Telefon: ${esc(preparedBy?.phone || authorNumber)}</div>` : ''}
      ${preparedBy?.email ? `<div>E-mail: ${esc(preparedBy.email)}</div>` : ''}
    </div>

    <div style="margin-top:5px;color:#888;">
      Aktualizacja: <strong>${esc(formatLastUpdated(lastUpdated))}</strong>
    </div>
  </div>
</header>

  <table>
    <thead>
      <tr>
        <th class="lp">LP</th>
        <th class="time">CZAS</th>
        <th class="topic">AGENDA</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  ${notesHtml}

</body>
</html>`;
};
