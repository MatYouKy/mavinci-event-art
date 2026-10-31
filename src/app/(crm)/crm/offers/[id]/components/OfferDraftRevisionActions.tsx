 'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

export default function OfferDraftRevisionActions({ offer, onSaved }: { offer: any; onSaved: () => void }) {
 const [revision, setRevision] = useState<{ saved_revision: number | null } | null>(null);
 const [busy, setBusy] = useState(false);
 const [askingReason, setAskingReason] = useState(false);
 const [reason, setReason] = useState('');
 const lock = useRef(false);
 const { showSnackbar } = useSnackbar();
 useEffect(() => {
  let active = true;
  setRevision(null);
  void supabase.from('offer_draft_revisions').select('saved_revision').eq('offer_id',offer.id).maybeSingle().then(({data}) => { if(active) setRevision(data); });
  return () => { active=false; };
 },[offer.id,offer.status,offer.content_revision]);
 const perform = async (begin: boolean) => {
  if(lock.current) return;
  lock.current=true; setBusy(true);
  try {
   const {error} = await supabase.rpc(begin ? 'reopen_accepted_offer_draft' : 'save_offer_draft_revision', begin
    ? {p_offer:offer.id,p_expected_revision:offer.content_revision}
    : {p_offer:offer.id,p_expected_revision:offer.content_revision,p_reason:reason.trim()});
   if(error) throw error;
   if(begin) setRevision({saved_revision:null});
   else {setRevision({saved_revision:offer.content_revision}); setAskingReason(false); setReason('');}
   showSnackbar(begin ? 'Oferta jest szkicem. Edytuj ją zwykłymi przyciskami, a potem zapisz aktualizację z uzasadnieniem.' : 'Zapisano uzasadnienie i historię aktualizacji. Oferta pozostaje szkicem.', 'success');
   onSaved();
  } catch(error:any) { showSnackbar(error.message || 'Nie udało się zaktualizować oferty.', 'error'); }
  finally {lock.current=false;setBusy(false);}
 };
 const needsReason = revision && revision.saved_revision !== offer.content_revision;
 return <>
  {offer.status==='accepted' && <button type="button" disabled={busy} onClick={() => void perform(true)} className="w-full rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-left text-sm text-[#d3bb73] disabled:opacity-50">{busy?'Otwieranie szkicu…':'Aktualizuj zaakceptowaną ofertę'}</button>}
  {offer.status==='draft' && revision && <>
    <p className="px-1 py-2 text-xs text-amber-200">Edytujesz szkic wcześniej zaakceptowanej oferty. Poprzednie rezerwacje pozostają do zatwierdzenia nowego zakresu. {needsReason ? 'Po zmianach zapisz aktualizację z uzasadnieniem.' : 'Uzasadnienie aktualizacji zapisane.'}</p>
    <button type="button" disabled={busy || !needsReason} onClick={() => setAskingReason(true)} className="w-full rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-black disabled:opacity-50">Zapisz aktualizację</button>
  </>}
  {askingReason && <div role="dialog" aria-modal="true" aria-label="Powód aktualizacji" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
    <div className="w-full max-w-lg space-y-4 rounded-xl border border-white/10 bg-[#1c1f33] p-6">
      <h3 className="text-lg">Dlaczego oferta została zaktualizowana?</h3>
      <textarea autoFocus value={reason} onChange={event=>setReason(event.target.value)} disabled={busy} maxLength={2000} rows={4} placeholder="Np. klientka zamówiła 4 dodatkowe mikrofony" className="w-full rounded-lg border border-white/10 bg-black/20 p-3" />
      <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={()=>setAskingReason(false)}>Wróć do edycji</button><button type="button" disabled={busy || reason.trim().length<3} onClick={()=>void perform(false)} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-black disabled:opacity-50">{busy?'Zapisuję…':'Zapisz'}</button></div>
    </div>
  </div>}
 </>;
}
