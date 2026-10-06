'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, FileText } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import UnifiedEmailComposer, { buildUnifiedEmailHtml, hasUnifiedEmailBody, loadUnifiedEmailAccounts, type UnifiedEmailAccount, type UnifiedEmailDraft } from '@/components/crm/UnifiedEmailComposer';
import BrochureRecipients from './BrochureRecipients';
import { brochureErrorMessage, readBrochureResponse, deliveryRequest, deliveryLabels, type Delivery, type Recipient, type RecipientContext } from './delivery';
type Brochure={id:string;name:string;my_company_id:string};
export default function SendBrochureEmailModal({brochureId,context,onClose,onSent}:{brochureId?:string;context?:RecipientContext;onClose:()=>void;onSent?:()=>void}) {
 const { showSnackbar } = useSnackbar();
 const [brochures,setBrochures]=useState<Brochure[]>([]),[selected,setSelected]=useState(brochureId||''),[recipients,setRecipients]=useState<Recipient[]>([]),[accounts,setAccounts]=useState<UnifiedEmailAccount[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[locked,setLocked]=useState(false),[deliveries,setDeliveries]=useState<Delivery[]>([]),[pdf,setPdf]=useState('');
 const [draft,setDraft]=useState<UnifiedEmailDraft>({fromAccountId:'',to:'',cc:'',bcc:'',subject:'Propozycja współpracy eventowej — Mavinci',messageHtml:'<p>Dzień dobry,</p><p>w załączeniu przesyłam broszurę z propozycją współpracy oraz zakresem usług eventowych Mavinci.</p><p>Chętnie porozmawiam o potrzebach Państwa obiektu i możliwościach wspólnej realizacji wydarzeń.</p><p>Zapraszam do kontaktu.</p>'});
 const [showPreview,setShowPreview]=useState(false),[preview,setPreview]=useState(''),[previewLoading,setPreviewLoading]=useState(false);
 const batch=useRef(crypto.randomUUID()),processing=useRef(false),prepared=useRef(new Map<string,Delivery>()),generated=useRef(new Map<string,string>());
 const brochure=brochures.find(b=>b.id===selected);
 const reportError=useCallback((message:string)=>{
  setError(message);
  showSnackbar(message.length>500?`${message.slice(0,500)}… Szczegóły w formularzu.`:message,'error',10000);
 },[showSnackbar]);
 useEffect(()=>{let active=true;void(async()=>{try{const [list,mailboxes]=await Promise.all([supabase.from('sales_brochures').select('id,name,my_company_id').neq('status','archived').order('name'),loadUnifiedEmailAccounts()]);if(list.error)throw list.error;if(active){setBrochures(list.data||[]);setAccounts(mailboxes);setDraft(d=>({...d,fromAccountId:mailboxes[0]?.id||''}));}}catch(e){if(active)reportError(`Nie udało się pobrać broszur lub kont pocztowych. ${brochureErrorMessage(e,'Spróbuj ponownie.')}`);}finally{if(active)setLoading(false);}})();return()=>{active=false;};},[reportError]);
 useEffect(()=>{if(!showPreview||!brochure)return;let active=true;setPreviewLoading(true);void buildUnifiedEmailHtml({draft,purpose:'offer',companyId:brochure.my_company_id,recipientName:recipients[0]?.name}).then(html=>{if(active)setPreview(html);}).catch(e=>{if(active){setPreview('');setError(`Nie udało się przygotować podglądu wiadomości. ${brochureErrorMessage(e,'Spróbuj ponownie.')}`);}}).finally(()=>{if(active)setPreviewLoading(false);});return()=>{active=false;};},[showPreview,draft,brochure,recipients]);
 const refresh=async()=>{const {data,error}=await supabase.from('sales_brochure_deliveries').select('*').eq('batch_id',batch.current).order('created_at');if(error)throw error;const rows=(data||[]) as Delivery[];for(const d of rows)prepared.current.set(d.recipient_email,d);setDeliveries(rows);return rows;};
 const prepare=async()=>{
  if(processing.current||!brochure)return;
  if(!recipients.length||!draft.fromAccountId||!draft.subject.trim()||!hasUnifiedEmailBody(draft.messageHtml)){reportError('Wybierz odbiorców, konto nadawcy oraz uzupełnij temat i treść.');return;}
  processing.current=true;setLocked(true);setError('');
  let stage='Odczyt przygotowanych wiadomości';
  let recipientEmail='';
  let preparationError='';
  try{
   setBusy('Przygotowywanie wiadomości…');await refresh();
   for(let i=0;i<recipients.length;i++){
    const r=recipients[i];if(prepared.current.has(r.email))continue;recipientEmail=r.email;stage='Przygotowanie treści wiadomości';setBusy(`Przygotowywanie wiadomości ${i+1} z ${recipients.length} · ${r.email}`);
    // Build the exact message before rendering its personalized attachment.
    const bodyHtml=await buildUnifiedEmailHtml({draft:{...draft,to:r.email},purpose:'offer',recipientName:r.name,companyId:brochure.my_company_id});
    let generationId=generated.current.get(r.email);
    if(!generationId){
     stage='Generowanie załącznika PDF';setBusy(`Przygotowywanie PDF ${i+1} z ${recipients.length} · ${r.email}`);
     const response=await fetch('/bridge/brochures/generate-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brochureId:selected,recipientEmail:r.email})});
     const result=await readBrochureResponse<{generation?:{id?:string};error?:unknown}>(response,'Nie udało się wygenerować załącznika.');
     if(!result.generation?.id)throw new Error(brochureErrorMessage(result.error,'Generator nie zwrócił identyfikatora PDF.'));
     generationId=result.generation.id;generated.current.set(r.email,generationId);
    }
    stage='Zapis przygotowanej wiadomości';setBusy(`Przygotowywanie zapisu wiadomości ${i+1} z ${recipients.length} · ${r.email}`);
    const row=await deliveryRequest({action:'prepare',generationId,batchId:batch.current,recipient:r,emailAccountId:draft.fromAccountId,subject:draft.subject,bodyHtml});prepared.current.set(r.email,row);setDeliveries([...prepared.current.values()]);
   }
   onSent?.();
  }catch(e){
   preparationError=`${stage}${recipientEmail?` (${recipientEmail})`:''}: ${brochureErrorMessage(e,'Nie udało się przygotować wiadomości.')} Żadna wiadomość nie została wysłana w tym kroku.`;
   // Keep the original failure and prepared rows even if refreshing also fails.
   try{await refresh();}catch{/* No sending happened. */}
  }
  finally{if(!prepared.current.size&&!generated.current.size)setLocked(false);setBusy('');processing.current=false;if(preparationError)reportError(preparationError);}
 };
 const send=async()=>{
  if(processing.current)return;
  processing.current=true;setBusy('Sprawdzanie przygotowanych wiadomości…');setError('');
  const failures:string[]=[];
  let completed=false;
  let sendError='';
  try{
   const rows=await refresh();
   for(const row of rows.filter(d=>d.status==='prepared'||d.status==='failed')){
    setBusy(`Wysyłanie do ${row.recipient_email}…`);
    try{
     const sent=await deliveryRequest({action:'send',deliveryId:row.id});
     prepared.current.set(sent.recipient_email,sent);setDeliveries([...prepared.current.values()]);
    }catch(e){failures.push(`${row.recipient_email}: ${brochureErrorMessage(e,'Nie otrzymano potwierdzenia wysyłki. Sprawdź historię przed ponowieniem.')}`);}
   }
   const finalRows=await refresh();
   completed=recipients.length>0&&recipients.every(recipient=>finalRows.some(row=>row.recipient_email===recipient.email&&row.status==='sent'));
   onSent?.();
   if(!completed)sendError=failures.length?failures.join('\n'):'Nie wszystkie wiadomości mają potwierdzenie wysyłki. Sprawdź ich stan w historii oraz folder Wysłane przed ponowieniem.';
  }catch(e){sendError=[...failures,`Nie udało się odczytać stanu wysyłki. ${brochureErrorMessage(e,'Spróbuj odświeżyć historię.')} Sprawdź historię i folder Wysłane przed ponowieniem.`].join('\n');}
  finally{
   setBusy('');processing.current=false;
   if(sendError)reportError(sendError);
   if(completed){
    showSnackbar(recipients.length===1?'Broszura została wysłana.':'Wszystkie wiadomości z broszurą zostały wysłane.','success');
    onClose();
   }
  }
 };
 const viewPdf=async(generationId:string)=>{try{const {data:g,error}=await supabase.from('sales_brochure_generations').select('pdf_path').eq('id',generationId).single();if(error)throw error;if(!g?.pdf_path)throw new Error('Brak zapisanego załącznika PDF.');const {data,error:e}=await supabase.storage.from('generated-brochures').createSignedUrl(g.pdf_path,300);if(e)throw e;if(!data?.signedUrl)throw new Error('Nie otrzymano adresu załącznika PDF.');setPdf(data.signedUrl);}catch(e){reportError(`Nie udało się otworzyć załącznika. ${brochureErrorMessage(e,'Spróbuj ponownie.')}`);}};
 const ready=deliveries.length===recipients.length&&recipients.length>0;
 const pending=deliveries.filter(d=>d.status==='prepared'||d.status==='failed').length;
 return <>
 <FullScreenLoader show={Boolean(busy)} title={busy.startsWith('Przygotowywanie') ? 'Przygotowywanie broszury' : 'Wysyłanie broszury'} description={busy}/>
 <Modal open scrollBody onClose={()=>{if(!processing.current)onClose();}} title="Wyślij broszurę">
  <div className="space-y-5" aria-busy={Boolean(busy)}>
   {error&&<p role="alert" className="whitespace-pre-line text-sm text-amber-200">{error}</p>}
   <label className="block text-sm text-white/70">Broszura<select disabled={loading||locked||Boolean(brochureId)} value={selected} onChange={e=>setSelected(e.target.value)} className="mt-2 w-full rounded-lg border border-white/5 bg-black/15 p-3 text-white"><option value="">Wybierz broszurę</option>{brochures.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
   <UnifiedEmailComposer draft={draft} onChange={setDraft} accounts={accounts} accountsLoading={loading} disabled={locked||Boolean(busy)} allowScheduling={false} recipientEditor={<BrochureRecipients value={recipients} onChange={setRecipients} context={context} disabled={locked||Boolean(busy)}/>} showPreview={showPreview} onShowPreviewChange={setShowPreview} previewHtml={preview} previewLoading={previewLoading}/>
   <p className="text-xs leading-5 text-white/50">Po przygotowaniu sprawdzisz załączniki i zatwierdzisz wysyłkę. Utworzymy {recipients.length} osobnych wiadomości. Treść i odbiorcy zostaną zablokowani dla przygotowanej wysyłki.</p>
   {deliveries.length>0&&<div className="space-y-3">{deliveries.map(d=><div key={d.id} className="rounded-lg bg-white/5 p-3 text-sm"><p>{d.recipient_email}</p><p className={`mt-1 text-xs ${d.status==='sent'?'text-green-300':'text-white/55'}`}>{deliveryLabels[d.status]}</p>{d.error_message&&<p className="mt-1 whitespace-pre-line text-xs text-amber-200">{d.error_message}</p>}<button type="button" disabled={Boolean(busy)} onClick={()=>void viewPdf(d.generation_id)} className="mt-2 inline-flex items-center gap-2 text-xs text-[#d3bb73]"><FileText className="h-4 w-4"/>Sprawdź załącznik PDF</button></div>)}</div>}
   {pdf&&<div><a href={pdf} target="_blank" rel="noreferrer" className="text-xs text-[#d3bb73]">Otwórz załącznik osobno</a><iframe title="Załączona broszura" src={pdf} className="mt-2 h-96 w-full rounded-lg bg-white"/></div>}
   <div className="flex flex-wrap justify-end gap-3"><button type="button" disabled={Boolean(busy)} onClick={onClose} className="rounded-lg bg-white/5 px-4 py-2 text-sm">Zamknij</button>
    {!ready&&<button type="button" disabled={loading||Boolean(busy)||!brochure||!recipients.length} onClick={()=>void prepare()} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#250914]">{locked?'Przygotuj brakujące załączniki':'Przygotuj wiadomości i PDF-y'}</button>}
    {ready&&pending>0&&<button type="button" disabled={Boolean(busy)} onClick={()=>void send()} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#250914]"><Send className="h-4 w-4"/>Wyślij osobne wiadomości ({pending})</button>}
   </div>
   {ready&&!pending&&deliveries.every(d=>d.status==='sent')&&<p role="status" className="text-sm text-green-300">Wszystkie wiadomości zostały wysłane. Historia jest dostępna przy broszurze i powiązanych odbiorcach.</p>}
  </div>
 </Modal>
 </>;
}
