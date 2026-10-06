'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, FileText, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { Modal } from '@/components/UI/Modal';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { deliveryLabels, deliveryRequest, type Delivery } from './delivery';
type Row=Delivery&{source:{version:number;pdf_path:string}|null;author:{name:string;surname:string}|null};
export default function BrochureDeliveryHistory({brochureId,contactId,organizationId,all=false,employeeFilter='',revision=0}:{brochureId?:string;contactId?:string;organizationId?:string;all?:boolean;employeeFilter?:string;revision?:number}) {
 const {employee,isAdmin,hasScope}=useCurrentEmployee();
 const [rows,setRows]=useState<Row[]>([]),[offset,setOffset]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState(''),[details,setDetails]=useState<Row|null>(null),[sending,setSending]=useState(false),[pdf,setPdf]=useState('');const ticket=useRef(0),lock=useRef(false);
 const canSend=isAdmin||hasScope('offers_manage');
 const scope=`${brochureId}:${contactId}:${organizationId}:${all}:${employeeFilter}`;
 useEffect(()=>{setOffset(0);setDetails(null);setPdf('');},[scope]);
 const load=useCallback(async()=>{
  if(!employee?.id)return;const current=++ticket.current;setLoading(true);setError('');
  let q=supabase.from('sales_brochure_deliveries').select('*,source:sales_brochure_generations(version,pdf_path),author:employees!sales_brochure_deliveries_employee_id_fkey(name,surname)').order('created_at',{ascending:false}).order('id').range(offset,offset+24);
  if(brochureId)q=q.eq('brochure_id',brochureId);if(contactId)q=q.eq('contact_id',contactId);if(organizationId)q=q.eq('organization_id',organizationId);
  if(!all)q=q.eq('employee_id',employee.id);else if(employeeFilter)q=q.eq('employee_id',employeeFilter);
  const {data,error}=await q;if(current!==ticket.current)return;setLoading(false);if(error){setRows([]);setError('Nie udało się wczytać historii wysyłek.');return;}
  const next=(data||[]) as unknown as Row[];setRows(next);setDetails(previous=>previous?next.find(r=>r.id===previous.id)||null:null);
 },[employee?.id,brochureId,contactId,organizationId,all,employeeFilter,offset]);
 useEffect(()=>{setRows([]);void load();return()=>{ticket.current+=1;};},[load,revision]);
 const openPdf=async(row:Row)=>{if(!row.source)return;const current=ticket.current;const {data,error}=await supabase.storage.from('generated-brochures').createSignedUrl(row.source.pdf_path,300);if(current!==ticket.current)return;if(error||!data?.signedUrl)setError('Nie udało się otworzyć załącznika.');else setPdf(data.signedUrl);};
 const send=async()=>{if(!details||lock.current)return;lock.current=true;setSending(true);setError('');try{await deliveryRequest({action:'send',deliveryId:details.id});await load();}catch(e){await load();setError(e instanceof Error?e.message:'Nie udało się wysłać wiadomości.');}finally{lock.current=false;setSending(false);}};
 return <section className="space-y-3">
  <FullScreenLoader show={sending} title="Wysyłanie broszury" description={`Wysyłanie wiadomości do ${details?.recipient_email || 'odbiorcy'}…`}/>
  <div className="flex items-center justify-between gap-3"><h3 className="text-sm">Historia wysyłek broszur</h3><button type="button" disabled={loading||sending} onClick={()=>void load()} className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/>Odśwież</button></div>
  {error&&<p role="alert" className="text-xs text-amber-200">{error}</p>}
  {!rows.length?<p className="text-xs text-white/45">{loading?'Wczytywanie historii…':'Brak przygotowanych wiadomości i wysyłek.'}</p>:<div className="overflow-auto"><table className="w-full text-left text-xs"><thead className="text-white/45"><tr><th className="p-2 font-normal">Data / wersja</th><th className="p-2 font-normal">Odbiorca</th>{all&&<th className="p-2 font-normal">Pracownik</th>}<th className="p-2 font-normal">Stan</th><th className="p-2 font-normal">Akcje</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} className="odd:bg-white/[.025]"><td className="p-2">{new Date(r.sent_at||r.created_at).toLocaleString('pl-PL')}<a className="mt-1 block text-[#d3bb73]" href={`/crm/brochures/${r.brochure_id}`}>Broszura v{r.source?.version??'—'}</a></td><td className="p-2">{r.recipient_email}<p className="mt-1 text-white/45">{r.recipient_name}</p>{r.contact_id&&<a className="mr-3 text-[#d3bb73]" href={`/crm/contacts/${r.contact_id}`}>Kontakt</a>}{r.organization_id&&<a className="text-[#d3bb73]" href={`/crm/contacts/${r.organization_id}`}>Organizacja</a>}</td>{all&&<td className="p-2">{[r.author?.name,r.author?.surname].filter(Boolean).join(' ')||'Pracownik'}</td>}<td className="p-2">{deliveryLabels[r.status]}</td><td className="p-2"><ResponsiveActionBar alwaysDropdown compact disabledBackground actions={[
   {label:'Zobacz wiadomość',icon:<Eye className="h-4 w-4"/>,onClick:()=>setDetails(r)},
   {label:'Zobacz załącznik PDF',icon:<FileText className="h-4 w-4"/>,onClick:()=>void openPdf(r),disabled:!r.source},
  ]}/></td></tr>)}</tbody></table></div>}
  <div className="flex justify-between text-xs"><button type="button" disabled={!offset||loading||sending} onClick={()=>setOffset(n=>Math.max(0,n-25))}>Poprzednie</button><button type="button" disabled={rows.length<25||loading||sending} onClick={()=>setOffset(n=>n+25)}>Następne</button></div>
  <p className="text-xs leading-5 text-white/40">„Wysłano” oznacza potwierdzenie nadania przez serwer pocztowy. Wejścia w demo i próbne PDF-y sprawdzisz w statystykach broszury. Przy niepewnym wyniku sprawdź folder Wysłane przed kolejną wysyłką.</p>
  <Modal open={Boolean(details)} onClose={()=>{if(!sending)setDetails(null);}} title="Wiadomość z broszurą">{details&&<div className="space-y-4 text-sm"><p>Do: {details.recipient_email}</p><p>Temat: {details.subject}</p><p>{deliveryLabels[details.status]}</p>{details.error_message&&<p className="text-amber-200">{details.error_message}</p>}{error&&<p role="alert" className="text-amber-200">{error}</p>}<iframe title="Zapisana treść wiadomości" sandbox="" srcDoc={details.body_html} className="h-96 w-full rounded-lg bg-white"/>{canSend&&details.employee_id===employee?.id&&['prepared','failed'].includes(details.status)&&<button type="button" disabled={sending} onClick={()=>void send()} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#250914]">{sending?'Wysyłanie…':'Wyślij tę wiadomość'}</button>}</div>}</Modal>
  <Modal open={Boolean(pdf)} onClose={()=>setPdf('')} title="Załącznik broszury"><a className="text-sm text-[#d3bb73]" href={pdf} target="_blank" rel="noreferrer">Otwórz PDF osobno</a><iframe title="Załącznik PDF" src={pdf} className="mt-3 h-[65vh] w-full rounded-lg bg-white"/></Modal>
 </section>;
}
