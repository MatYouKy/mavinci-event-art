import { deliveryTimestamp, type SellerDeliveryState } from './delivery';

export type ReviewStatus = 'pending' | 'approved' | 'changes_requested' | 'rejected';
export type ReviewHistoryCursor = { at: string; id: string };
export type ReviewHistorySnapshot = {
  id: string; recorded_at: string; document_id: string; status: ReviewStatus;
  request_note: string; response_note: string;
  requested_at: string | null; reviewed_at: string | null; reviewer_name: string | null;
};
export type ReviewHistoryPage = { entries: ReviewHistorySnapshot[]; next_cursor: ReviewHistoryCursor | null };
export type ReviewThreadMessage = {
  id: string; kind: 'submission' | 'decision'; at: string; document_id: string;
  author: string; title: string; body: string; details?: string;
};
type CorrectionReply = { reply: string; previousNote: string; previousDecisionAt: string; parsed: boolean };

// Existing submissions store the public reply before the generated offer
// summary. Read that format without rewriting saved requests or audit history.
// Ambiguous/free-text delimiters must never silently hide part of a reply.
export function readCorrectionReply(requestNote?: string): CorrectionReply | null {
  const saved = (requestNote || '').replace(/\r\n/g, '\n').trim();
  const confirmation = 'Akceptacja klienta potwierdzona przez sprzedawcę dla przekazanej wersji PDF.\n';
  const note = saved.startsWith(confirmation) ? saved.slice(confirmation.length) : saved;
  const heading = 'Ponowna weryfikacja — odpowiedź na uwagi opiekuna.\n';
  if (!note.startsWith(heading)) return null;

  const fallback: CorrectionReply = { reply: saved, previousNote: '', previousDecisionAt: '', parsed: false };
  let body = note.slice(heading.length);
  let previousDecisionAt = '';
  const decisionPrefix = 'Decyzja opiekuna z: ';
  if (body.startsWith(decisionPrefix)) {
    const lineEnd = body.indexOf('\n');
    if (lineEnd < 0) return fallback;
    previousDecisionAt = body.slice(decisionPrefix.length, lineEnd).trim();
    body = body.slice(lineEnd + 1);
  }
  const replyPrefix = 'Odpowiedź sprzedawcy:\n';
  if (!body.startsWith(replyPrefix)) return fallback;
  body = body.slice(replyPrefix.length);
  const confirmed = '\nSprzedawca potwierdził, że uwagi zostały uwzględnione lub wyjaśnione.';
  const replyEnd = body.indexOf(confirmed);
  if (replyEnd < 0 || replyEnd !== body.lastIndexOf(confirmed)) return fallback;
  const reply = body.slice(0, replyEnd).trim();
  if (!reply) return fallback;

  const remaining = body.slice(replyEnd + confirmed.length);
  const summaryPrefix = '\n\nOferta: ';
  const summaryStart = remaining.indexOf(summaryPrefix);
  if (summaryStart < 0 || summaryStart !== remaining.lastIndexOf(summaryPrefix)) return fallback;
  const previous = remaining.slice(0, summaryStart).trim();
  const previousPrefix = 'Wcześniejsze uwagi opiekuna: ';
  if (previous && !previous.startsWith(previousPrefix)) return fallback;
  return { reply, previousNote: previous.slice(previousPrefix.length).trim(), previousDecisionAt, parsed: true };
}


const decisionTitles: Record<Exclude<ReviewStatus, 'pending'>, string> = {
  approved: 'Akceptacja opiekuna', changes_requested: 'Uwagi opiekuna', rejected: 'Odmowa opiekuna',
};
const decisionText: Record<Exclude<ReviewStatus, 'pending'>, string> = {
  approved: 'Oferta zaakceptowana.', changes_requested: 'Oferta wymaga poprawek.', rejected: 'Oferta nie została zaakceptowana.',
};
const time = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

// Audit snapshots repeat the request on every update. Merge by round and
// decision identity, never by message text (the same note can recur later).
export function reviewThreadMessages(
  entries: ReviewHistorySnapshot[], current: SellerDeliveryState['review'], sellerName: string,
): ReviewThreadMessage[] {
  const snapshots: ReviewHistorySnapshot[] = [...entries].sort((a,b) =>
    time(a.recorded_at)-time(b.recorded_at) || a.id.localeCompare(b.id));
  if (current && ['pending','approved','changes_requested','rejected'].includes(current.status)) snapshots.push({
    id: 'current', recorded_at: current.reviewed_at || current.requested_at || '',
    document_id: current.document_id, status: current.status as ReviewStatus,
    request_note: current.request_note || '', response_note: current.response_note || '',
    requested_at: current.requested_at || null, reviewed_at: current.reviewed_at || null, reviewer_name: null,
  });
  const messages = new Map<string, ReviewThreadMessage>();
  for (const snapshot of snapshots) {
    if (snapshot.requested_at && (snapshot.request_note || snapshot.status==='pending')) {
      const correction = readCorrectionReply(snapshot.request_note);
      const plain = snapshot.request_note.replace(/^Akceptacja klienta potwierdzona przez sprzedawcę dla przekazanej wersji PDF\.\r?\n/, '').trim();
      const automatic = plain.startsWith('Oferta: ');
      const id = JSON.stringify(['submission',snapshot.document_id,time(snapshot.requested_at)]);
      messages.set(id, {
        id, kind: 'submission', at: snapshot.requested_at, document_id: snapshot.document_id,
        author: sellerName || 'Sprzedawca', title: correction ? 'Odpowiedź na uwagi' : 'Przekazanie oferty',
        body: correction?.reply || (automatic || !plain ? 'Przekazano ofertę do oceny.' : plain),
        details: correction?.parsed || automatic ? snapshot.request_note : undefined,
      });
    }
    if (snapshot.status!=='pending' && snapshot.reviewed_at) {
      const id = JSON.stringify(['decision',snapshot.document_id,time(snapshot.requested_at),time(snapshot.reviewed_at),snapshot.status]);
      messages.set(id, {
        id, kind: 'decision', at: snapshot.reviewed_at, document_id: snapshot.document_id,
        author: snapshot.reviewer_name || messages.get(id)?.author || 'Opiekun',
        title: decisionTitles[snapshot.status], body: snapshot.response_note || decisionText[snapshot.status],
      });
    }
  }
  return [...messages.values()].sort((a,b) => time(a.at)-time(b.at)
    || (a.kind===b.kind ? a.id.localeCompare(b.id) : a.kind==='submission' ? -1 : 1));
}

export function hasOriginalCaretakerNote(messages: ReviewThreadMessage[], correction: CorrectionReply | null) {
  if (!correction?.previousNote) return false;
  const suffix='… (skrócono; pełna decyzja pozostaje w historii)';
  const shortened=correction.previousNote.endsWith(suffix);
  const note=shortened ? correction.previousNote.slice(0,-suffix.length) : correction.previousNote;
  return messages.some(message => message.kind==='decision'
    && (!correction.previousDecisionAt || deliveryTimestamp(message.at)===correction.previousDecisionAt)
    && (shortened ? message.body.startsWith(note) : message.body===note));
}
