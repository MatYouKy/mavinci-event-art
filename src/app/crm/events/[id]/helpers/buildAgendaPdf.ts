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
  agendaItems: Array<{ time?: string; title?: string; description?: string }>;
  agendaNotes?: AgendaNote[];
  lastUpdated?: string;
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

    /* header identyczny vibe jak checklista */
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

    .meta { font-size: 10px; }
    .meta-row { margin-bottom: 2px; }

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

    .stamp {
      margin-top: 4px;
      font-size: 9px;
      color: #6b7280;
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
  <div class="header">
    <div class="left">
      <h1>Agenda wydarzenia</h1>
      <div class="meta">
        <div class="meta-row"><strong>Wydarzenie:</strong> ${esc(eventName)}</div>
        <div class="meta-row"><strong>Data:</strong> ${esc(eventDate || '-')}</div>
        <div class="meta-row"><strong>Godziny:</strong> ${esc(timeRange)}</div>
        <div class="meta-row"><strong>Klient:</strong> ${esc(clientContact || '-')}</div>
        <div class="meta-row"><strong>Kontakt:</strong> ${esc(contactName || '-')} ${contactNumber ? `(${esc(contactNumber)})` : ''}</div>
      </div>
    </div>

    <div class="right">
      <img src="/shape-mavinci-black.png" alt="Logo" class="logo" />
      <div class="meta">
        <div class="meta-row"><strong>Opiekun:</strong> ${esc(authorName || '-')}</div>
        <div class="meta-row"><strong>Tel:</strong> ${esc(authorNumber || '-')}</div>
      </div>
      <div class="stamp">Ostatnia aktualizacja: ${esc(formatLastUpdated(lastUpdated))}</div>
    </div>
  </div>

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
