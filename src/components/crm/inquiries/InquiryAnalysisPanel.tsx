'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Loader2, Send, CheckCircle2, Sparkles } from 'lucide-react';

const DEFAULT_ANALYSIS_PROMPT = 'Przeanalizuj zapytanie mailowe i całą dołączoną korespondencję jako jedną sprawę. Przedstaw aktualne założenia wydarzenia, potrzeby klienta, pytania wymagające doprecyzowania, proponowany zakres usług oraz szacunkową kalkulację netto w PLN z podstawą wyceny i brakami wpływającymi na cenę. Oddziel potwierdzone ustalenia od propozycji i założeń roboczych.';

type Analysis = { id: string; created_at: string; brief_revision: number; result: any };
export default function InquiryAnalysisPanel({ analyses, approved, approvedCurrent, canManage, busy, dirty, onSend, onApprove, renderResult, children }: {
  analyses: Analysis[];
  approved: { summary: string; approved_at: string; analysis_id: string } | null;
  approvedCurrent: boolean;
  canManage: boolean; busy: boolean; dirty: boolean;
  onSend: (message: string, requestId: string) => Promise<void>;
  onApprove: (analysisId: string) => Promise<void>;
  renderResult: (result: any) => ReactNode;
  children: ReactNode;
}) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const request = useRef<{ text: string; id: string } | null>(null);
  const lock = useRef(false);
  const latest = analyses[0];
  const send = async (text: string) => {
    if (lock.current || busy) return;
    text = text.trim() || DEFAULT_ANALYSIS_PROMPT;
    lock.current = true; setSending(true); setError('');
    if (!request.current || request.current.text !== text) request.current = { text, id: crypto.randomUUID() };
    try { await onSend(text, request.current.id); setMessage(''); request.current = null; }
    catch (e: any) { setError(e.message || 'Nie udało się uzyskać odpowiedzi. Spróbuj ponownie.'); }
    finally { setSending(false); lock.current = false; }
  };
  const approve = async () => {
    if (!latest || lock.current || busy) return;
    lock.current = true; setSending(true); setError('');
    try { await onApprove(latest.id); }
    catch (e: any) { setError(e.message || 'Nie udało się zatwierdzić podsumowania.'); }
    finally { setSending(false); lock.current = false; }
  };
  return <div className="space-y-5">
    <section className="rounded-xl bg-[#1c1f33] p-5">
      <h2 className="flex items-center gap-2 text-lg"><Sparkles className="h-5 w-5 text-[#d3bb73]" />Analiza i rozmowa z AI</h2>
      <p className="mt-2 text-sm text-white/55">Jedno miejsce na analizę zapytania, korespondencji i doprecyzowanie ustaleń. Rozmowa i kolejne podsumowania są zapisywane przy zapytaniu.</p>
      {approved && <div className="mt-4 rounded-lg bg-[#d3bb73]/10 p-4">
        <p className="flex items-center gap-2 text-sm text-[#d3bb73]"><CheckCircle2 className="h-4 w-4" />{approvedCurrent ? 'Zatwierdzone do oferty / kalkulacji' : 'Poprzednio zatwierdzone podsumowanie — sprawdź nowe ustalenia'}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-white/75">{approved.summary}</p>
        <p className="mt-2 text-xs text-white/40">{new Date(approved.approved_at).toLocaleString('pl-PL')}</p>
      </div>}
      {latest ? <div className="mt-5">
        <h3 className="text-sm font-medium">Aktualne podsumowanie przed ofertą / kalkulacją</h3>
        {renderResult(latest.result)}
        {canManage && <button onClick={() => void approve()} disabled={sending || busy || dirty || approvedCurrent} className="mt-4 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#1c1f33] disabled:opacity-45">Zatwierdź do oferty / kalkulacji</button>}
        {dirty && <p className="mt-2 text-xs text-white/50">Zapisz ustalenia i odśwież analizę przed zatwierdzeniem.</p>}
      </div> : <p className="mt-4 text-sm text-white/50">Nie ma jeszcze analizy. Rozpocznij od podsumowania dostępnych informacji.</p>}
      {analyses.length > 0 && <details className="mt-5"><summary className="cursor-pointer text-sm text-white/60">Zapisana rozmowa i historia analiz ({analyses.length}{analyses.length === 30 ? ', ostatnie 30' : ''})</summary>
        <div className="mt-3 space-y-3">{[...analyses].reverse().map(turn => <div key={turn.id} className="space-y-2 rounded-lg bg-black/15 p-3 text-sm">
          <p className="text-xs text-white/40">{new Date(turn.created_at).toLocaleString('pl-PL')}</p>
          <p className="whitespace-pre-wrap text-[#d3bb73]">Ty: {turn.result.chat_message || 'Przeanalizuj zapytanie i korespondencję.'}</p>
          <p className="whitespace-pre-wrap text-white/75">AI: {turn.result.assistant_reply || turn.result.summary}</p>
          <details><summary className="cursor-pointer text-xs text-white/45">Podsumowanie z tej analizy</summary>{renderResult(turn.result)}</details>
        </div>)}</div>
      </details>}
      {canManage && <form className="mt-5 space-y-3" onSubmit={event => { event.preventDefault(); void send(message); }}>
        <label className="block text-sm text-white/65">Doprecyzuj ustalenia lub zadaj pytanie (opcjonalnie)<textarea value={message} onChange={e => setMessage(e.target.value)} disabled={busy || sending} maxLength={4000} rows={3} placeholder="Np. Klient potwierdził 120 osób. Co musimy jeszcze ustalić przed wyceną?" className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-3 text-sm" /></label>
        <p className="text-xs text-white/45">Zostaw puste, aby przeanalizować zapytanie i całą korespondencję: założenia, potrzeby, pytania, propozycje oraz szacunkową kalkulację.</p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy || sending} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#1c1f33] disabled:opacity-45">{busy || sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{message.trim() ? 'Wyślij do AI' : latest ? 'Odśwież analizę' : 'Przeanalizuj zapytanie'}</button>
        </div>
      </form>}
      {error && <p role="alert" className="mt-3 text-sm text-amber-200">{error}</p>}
    </section>
    {children}
  </div>;
}
