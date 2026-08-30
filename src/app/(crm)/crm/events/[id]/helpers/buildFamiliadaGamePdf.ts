export type FamiliadaPdfQuestion = {
  number: number;
  question: string;
};

type FamiliadaPdfPayload = {
  eventName: string;
  eventDate: string | null;
  gameName: string;
  questions: FamiliadaPdfQuestion[];
};

const QUESTIONS_PER_PAGE = 12;

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const formatDate = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
};

const chunkQuestions = (questions: FamiliadaPdfQuestion[]) => {
  const pages: FamiliadaPdfQuestion[][] = [];
  for (let index = 0; index < questions.length; index += QUESTIONS_PER_PAGE) {
    pages.push(questions.slice(index, index + QUESTIONS_PER_PAGE));
  }
  return pages;
};

export function buildFamiliadaGamePdfHtml(payload: FamiliadaPdfPayload) {
  const questionPages = chunkQuestions(payload.questions);
  const eventDate = formatDate(payload.eventDate);
  const pages = questionPages.map((questions, pageIndex) => `
    <section class="page">
      <header>
        <div class="brand">MAVINCI</div>
        <p class="eyebrow">KARTA WESELNA · FAMILIADA</p>
        <h1>${escapeHtml(payload.gameName)}</h1>
        <p class="event-meta">${escapeHtml(payload.eventName)}${eventDate ? ` · ${escapeHtml(eventDate)}` : ''}</p>
      </header>

      <main>
        <h2>Lista pytań</h2>
        <ol class="question-list">
          ${questions.map((question) => `
            <li>
              <span class="number">${String(question.number).padStart(2, '0')}</span>
              <span class="question">${escapeHtml(question.question)}</span>
            </li>
          `).join('')}
        </ol>
      </main>

      <footer><span>Pytania Familiady</span><span>${pageIndex + 1}/${questionPages.length}</span></footer>
    </section>
  `).join('');

  return `<!doctype html>
  <html lang="pl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(payload.gameName)} · Pytania Familiady</title>
    <style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; color: #211b20; font-family: Arial, Helvetica, sans-serif; background: #fff; }
      .page { position: relative; width: 210mm; min-height: 297mm; padding: 18mm 20mm 17mm; overflow: hidden; page-break-after: always; background: #fff; }
      .page::before { content: ''; position: absolute; width: 62mm; height: 62mm; right: -31mm; top: -36mm; border-radius: 50%; background: rgba(91, 0, 34, .055); }
      .page::after { content: ''; position: absolute; width: 48mm; height: 48mm; right: -22mm; top: -29mm; border-radius: 50%; background: rgba(211, 187, 115, .14); }
      .page:last-child { page-break-after: auto; }
      header { position: relative; z-index: 1; }
      .brand { color: #5b0022; font-size: 11px; font-weight: 700; letter-spacing: .42em; }
      .eyebrow { margin: 14mm 0 2.5mm; color: #a38a45; font-size: 8px; font-weight: 700; letter-spacing: .16em; }
      h1 { max-width: 150mm; margin: 0; color: #5b0022; font-size: 29px; font-weight: 500; line-height: 1.16; }
      .event-meta { margin: 3mm 0 0; color: #70666d; font-size: 10px; }
      main { margin-top: 13mm; }
      main h2 { margin: 0 0 6mm; color: #312a2f; font-size: 14px; font-weight: 600; }
      .question-list { display: grid; gap: 5mm; margin: 0; padding: 0; list-style: none; }
      .question-list li { display: grid; grid-template-columns: 13mm minmax(0, 1fr); align-items: start; gap: 4mm; break-inside: avoid; }
      .number { display: flex; width: 11mm; height: 11mm; align-items: center; justify-content: center; border-radius: 50%; color: #fff; background: #5b0022; font-size: 9px; font-weight: 700; }
      .question { padding-top: 1.7mm; font-size: 14px; font-weight: 600; line-height: 1.38; }
      footer { position: absolute; right: 20mm; bottom: 9mm; left: 20mm; display: flex; justify-content: space-between; color: #9a9096; font-size: 7px; }
    </style>
  </head>
  <body>${pages}</body>
  </html>`;
}
