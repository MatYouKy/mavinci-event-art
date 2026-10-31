'use client';

import { useEffect, useRef, useState } from 'react';
import { deliveryTimestamp, type SellerDeliveryState, type SellerDocument } from '@/lib/seller/delivery';
import {
  hasOriginalCaretakerNote, readCorrectionReply, reviewThreadMessages,
  type ReviewHistoryCursor, type ReviewHistoryPage, type ReviewHistorySnapshot, type ReviewThreadMessage,
} from '@/lib/seller/reviewThread';

type Review = SellerDeliveryState['review'];
const button='rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs text-[#d3bb73] disabled:opacity-40';

function ReviewMessage({ message, documents }: { message: ReviewThreadMessage; documents: SellerDocument[] }) {
  const index=documents.findIndex(document=>document.id===message.document_id);
  return <article className={`rounded-lg p-3 text-sm ${message.kind==='decision' ? 'bg-[#d3bb73]/10' : 'bg-white/5'}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <p className="font-medium text-[#d3bb73]">{message.title} · {message.author}</p>
      <p className="text-xs text-white/50">
        <time dateTime={message.at}>{deliveryTimestamp(message.at)}</time>{index>=0 && ` · PDF: wersja ${documents.length-index}`}
      </p>
    </div>
    <p className="mt-2 whitespace-pre-wrap break-words leading-6">{message.body}</p>
    {message.details && <details className="mt-2 text-xs text-white/50">
      <summary className="cursor-pointer">Szczegóły przekazania i zakres</summary>
      <p className="mt-2 whitespace-pre-wrap break-words leading-5">{message.details}</p>
    </details>}
  </article>;
}

export default function SellerReviewSubmission({ review, current, sellerName, documents, refreshKey, loadHistory }: {
  review: Review; current: boolean; sellerName?: string; documents: SellerDocument[]; refreshKey: string;
  loadHistory?: (before: ReviewHistoryCursor | null) => Promise<ReviewHistoryPage>;
}) {
  const [entries,setEntries]=useState<ReviewHistorySnapshot[]>([]);
  const [cursor,setCursor]=useState<ReviewHistoryCursor | null>(null);
  const [loading,setLoading]=useState(false);
  const [loadingMore,setLoadingMore]=useState(false);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const generation=useRef(0);
  const moreLock=useRef(false);

  useEffect(()=>{
    const request=++generation.current;
    setEntries([]);setCursor(null);setError('');setLoadingMore(false);moreLock.current=false;
    if(!loadHistory){setLoading(false);return;}
    setLoading(true);
    void loadHistory(null).then(page=>{
      if(request!==generation.current)return;
      setEntries(page.entries);setCursor(page.next_cursor);
    }).catch(()=>{
      if(request===generation.current)setError('Nie udało się wczytać pełnej historii. Poniżej pozostają uwagi z bieżącego przekazania.');
    }).finally(()=>{if(request===generation.current)setLoading(false);});
    return ()=>{++generation.current;};
  },[loadHistory,refreshKey,retry]);

  const loadMore=async()=>{
    if(!loadHistory || !cursor || loading || moreLock.current)return;
    const request=generation.current;
    moreLock.current=true;setLoadingMore(true);setError('');
    try{
      const page=await loadHistory(cursor);
      if(request!==generation.current)return;
      setEntries(previous=>[...new Map([...previous,...page.entries].map(entry=>[entry.id,entry])).values()]);
      setCursor(page.next_cursor);
    }catch{
      if(request===generation.current)setError('Nie udało się wczytać wcześniejszych uwag. Możesz ponowić; już wczytane wpisy pozostają widoczne.');
    }finally{
      if(request===generation.current){moreLock.current=false;setLoadingMore(false);}
    }
  };

  const messages=reviewThreadMessages(entries,review,sellerName || 'Sprzedawca');
  // Keep the preceding caretaker decision and the latest seller response
  // together. Older rounds remain expandable rather than being overwritten.
  let latestSubmission=-1;
  for(let i=messages.length-1;i>=0;i--)if(messages[i].kind==='submission'){latestSubmission=i;break;}
  let start=Math.max(0,latestSubmission);
  for(let i=latestSubmission-1;i>=0;i--)if(messages[i].kind==='decision'){start=i;break;}
  const older=messages.slice(0,start);
  const latest=messages.slice(start);
  const correction=readCorrectionReply(review?.request_note);
  const fallback=correction?.previousNote && !hasOriginalCaretakerNote(messages,correction);

  return <div aria-label="Historia uwag i odpowiedzi do oferty" className="space-y-3">
    {loading && <p role="status" className="text-xs text-white/50">Wczytywanie historii uwag…</p>}
    {error && <div role="alert" className="space-y-2 text-xs text-amber-200">
      <p>{error}</p><button type="button" disabled={loading || loadingMore} className={button} onClick={()=>setRetry(value=>value+1)}>Odśwież historię</button>
    </div>}
    {(older.length>0 || cursor) && <details className="rounded-lg bg-black/10 p-3">
      <summary className="cursor-pointer text-xs text-[#d3bb73]">Wcześniejsze uwagi i decyzje{older.length>0 && ` (${older.length})`}</summary>
      <div className="mt-3 space-y-3">
        {cursor && <button type="button" disabled={loading || loadingMore} className={button} onClick={()=>void loadMore()}>{loadingMore ? 'Wczytywanie…' : 'Wczytaj wcześniejsze wpisy'}</button>}
        {older.map(message=><ReviewMessage key={message.id} message={message} documents={documents}/>)}
      </div>
    </details>}
    {fallback && correction && <div className="rounded-lg bg-[#d3bb73]/10 p-3 text-sm">
      <p className="text-xs text-[#d3bb73]">Wcześniejsza uwaga opiekuna · zapis z przekazania{correction.previousDecisionAt && ` · ${correction.previousDecisionAt}`}</p>
      <p className="mt-2 whitespace-pre-wrap break-words leading-6">{correction.previousNote}</p>
    </div>}
    {latest.map(message=><ReviewMessage key={message.id} message={message} documents={documents}/>)}
    {!loading && !messages.length && !fallback && <p className="text-xs text-white/50">Nie ma jeszcze zapisanych uwag do tej oferty.</p>}
    {review && <p className="text-xs text-white/55">{!current
      ? 'Ostatnie przekazanie dotyczy wcześniejszej wersji. Uwagi pozostają w historii; aktualna oferta wymaga osobnej oceny.'
      : review.status==='pending' ? 'Teraz Twoja decyzja: zgłoś dalsze uwagi albo zaakceptuj ocenianą wersję oferty.'
        : review.status==='changes_requested' || review.status==='rejected' ? 'Uwagi są przekazane sprzedawcy. Po poprawkach i ponownym przekazaniu jego odpowiedź pojawi się tutaj.'
          : 'Akceptacja tej wersji jest zapisana. Potwierdzenie realizacji pozostaje osobnym krokiem.'}</p>}
  </div>;
}
