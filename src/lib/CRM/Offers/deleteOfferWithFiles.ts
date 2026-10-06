import { supabase } from '@/lib/supabase/browser';

/** Delete the row first: a rejected deletion must never remove an accepted document. */
export async function deleteOfferWithFiles(offerId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: offer, error: readError } = await supabase.from('offers').select('generated_pdf_url,inquiry_id,status').eq('id', offerId).single();
    if (readError) throw readError;
    const { data: allowed, error: permissionError } = await supabase.rpc('sales_can_manage_offer', { p_offer: offerId });
    if (permissionError || !allowed) throw new Error('Brak uprawnień do usunięcia oferty.');
    const { data: versions, error: versionsError } = await supabase.from('sales_document_files').select('id').eq('offer_id', offerId).limit(1);
    if (versionsError) throw versionsError;
    if (offer.status === 'accepted' || (offer.inquiry_id && versions?.length)) throw new Error('Zachowujemy ofertę i historię dokumentów. Możesz odrzucić wariant lub utworzyć jego kopię.');
    const { data: files, error: filesError } = await supabase.from('event_files').select('file_path').eq('offer_id', offerId);
    if (filesError) throw filesError;
    const { error: deleteError } = await supabase.from('offers').delete().eq('id', offerId).select('id').single();
    if (deleteError) throw deleteError;
    if (offer.generated_pdf_url) await supabase.storage.from('generated-offers').remove([offer.generated_pdf_url]);
    const paths = (files || []).map(file => file.file_path).filter(Boolean);
    if (paths.length) await supabase.storage.from('event-files').remove(paths);
    return { success: true };
  } catch (error: any) { return { success: false, error: error.message || 'Nie udało się usunąć oferty.' }; }
}
