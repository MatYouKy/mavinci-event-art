'use client';
import {useEffect,useState} from 'react';
import {Download,Loader2} from 'lucide-react';
import {buildPersonnelPdf,downloadPersonnelPdf} from '@/lib/personnel/contractPdf';
import {personnelSecondary as secondary} from '@/lib/personnel/workspace';
export function PersonnelPdfPreview({content,title,template=false}:{content:string;title:string;template?:boolean}) {
 const key=JSON.stringify([content,title,template]);
 const [file,setFile]=useState<{key:string;url:string;blob:Blob}|null>(null),[failure,setFailure]=useState<{key:string;message:string}|null>(null);
 useEffect(()=>{
  let cancelled=false,url='';
  const timer=window.setTimeout(()=>{
   if(!content.trim())return;
   void buildPersonnelPdf(content,{title,template}).then((blob:Blob)=>{if(cancelled)return;url=URL.createObjectURL(blob);setFile({key,url,blob});setFailure(null);}).catch((e:Error)=>{if(!cancelled)setFailure({key,message:e.message||'Nie udało się przygotować PDF.'});});
  },450);
  return()=>{cancelled=true;window.clearTimeout(timer);if(url)URL.revokeObjectURL(url);};
 },[key,content,title,template]);
 const ready=file?.key===key?file:null;
 return <section className="space-y-3 rounded-xl bg-black/10 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{template?'Podgląd PDF z placeholderami':'Podgląd dokumentu PDF'}</span><button type="button" className={secondary} disabled={!ready} onClick={()=>{if(ready)downloadPersonnelPdf(ready.blob,title);}}><Download className="h-4 w-4"/>Pobierz PDF</button></div>
 {!content.trim()?<p className="p-6 text-sm opacity-60">Wpisz treść szablonu, aby zobaczyć PDF.</p>:failure?.key===key?<p role="alert" className="p-6 text-sm text-red-300">{failure.message}</p>:ready?<><iframe title={title} src={ready.url+'#toolbar=1&navpanes=0'} className="h-[70vh] min-h-[460px] w-full rounded-lg bg-white"/><a className="text-xs underline opacity-65" href={ready.url} target="_blank" rel="noreferrer">Otwórz PDF w osobnej karcie</a></>:<p className="flex min-h-[460px] items-center justify-center gap-2 text-sm opacity-60"><Loader2 className="h-4 w-4 animate-spin"/>Przygotowywanie PDF…</p>}
 {template&&<p className="text-xs leading-5 opacity-60">Pola w podwójnych nawiasach zostaną uzupełnione danymi formularza. Układ jest wspólny z końcowym PDF; długość danych może zmienić liczbę stron.</p>}
 </section>;
}
