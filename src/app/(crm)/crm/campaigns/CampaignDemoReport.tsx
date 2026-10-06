'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
type Report = { visits: number; sessions: number; pdfs: number; downloads: number };
export default function CampaignDemoReport({ campaignId, canGenerate }: { campaignId: string; canGenerate: boolean }) {
  const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [brochure,setBrochure]=useState(''),[url,setUrl]=useState(''),[tagged,setTagged]=useState(false);
  const load=useCallback(async()=>{
    setError('');
    try {
      const {data,error}=await supabase.rpc('get_seller_demo_campaign_report',{p_campaign:campaignId});if(error)throw error;setReport(data);
      const {data:campaign,error:campaignError}=await supabase.from('mailing_campaigns').select('brochure_generation_id').eq('id',campaignId).single();if(campaignError)throw campaignError;
      const {data:generation,error:generationError}=await supabase.from('sales_brochure_generations').select('brochure_id,pdf_path,snapshot').eq('id',campaign.brochure_generation_id).single();if(generationError)throw generationError;
      setBrochure(generation.brochure_id);
      const linked=generation.snapshot?.demoAttribution?.campaignId===campaignId;
      setTagged(linked);setUrl('');
      if(linked){const {data:signed}=await supabase.storage.from('generated-brochures').createSignedUrl(generation.pdf_path,3600);setUrl(signed?.signedUrl||'');}
    }catch{setError('Nie udało się wczytać danych demonstracji kampanii.');}
  },[campaignId]);
  useEffect(()=>{void load();},[load]);
  const generate=async()=>{
    setBusy(true);setError('');
    try{const response=await fetch('/bridge/brochures/generate-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brochureId:brochure,campaignId})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Nie udało się przygotować PDF kampanii.');await load();}
    catch(e){setError(e instanceof Error?e.message:'Nie udało się przygotować PDF kampanii.');}finally{setBusy(false);}
  };
  return <section className="space-y-4 rounded-xl bg-[#1c1f33] p-5"><h2 className="text-lg">Demo strefy sprzedawcy — skuteczność kampanii</h2><p className="text-xs leading-5 text-white/50">{tagged?'PDF zawiera link przypisany do tej kampanii.':'Przygotuj PDF kampanii, aby jej link naliczał osobne statystyki.'} Dane nie identyfikują poszczególnych odbiorców kampanii. Obejmują również użycie przekazanego dalej linku i próby wewnętrzne.</p>
    {report&&<div className="grid grid-cols-2 gap-3 md:grid-cols-4">{([{key:'visits',label:'Wejścia'},{key:'sessions',label:'Sesje'},{key:'pdfs',label:'Wygenerowane próbne PDF-y'},{key:'downloads',label:'Uruchomione pobrania'}] as const).map(m=><div key={m.key} className="rounded-lg bg-white/5 p-3"><p className="text-xl text-[#d3bb73]">{report[m.key]}</p><p className="mt-1 text-xs text-white/50">{m.label}</p></div>)}</div>}
    <div className="flex flex-wrap gap-3 text-xs"><button disabled={busy} onClick={()=>void load()} className="rounded-lg bg-white/5 px-3 py-2">Odśwież statystyki</button>{canGenerate&&<button disabled={busy||!brochure} onClick={()=>void generate()} className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-[#d3bb73]">{busy?'Przygotowywanie PDF…':'Generuj PDF przypisany do kampanii'}</button>}{url&&<a href={url} target="_blank" rel="noreferrer" className="rounded-lg bg-white/5 px-3 py-2 text-[#d3bb73]">Otwórz PDF kampanii</a>}</div>{error&&<p role="alert" className="text-xs text-amber-200">{error}</p>}
  </section>;
}
