import { supabase } from '@/lib/supabase/browser';

/**
 * Usuwa tylko pliki PDF oferty (nie usuwa samej oferty z bazy)
 *
 * @param offerId - ID oferty której pliki PDF mają być usunięte
 * @returns Promise z wynikiem operacji
 */
export async function deleteOfferPdfFiles(offerId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Pobierz dane oferty aby uzyskać generated_pdf_url
    const { data: offer } = await supabase
      .from('offers')
      .select('generated_pdf_url')
      .eq('id', offerId)
      .maybeSingle();

    // 2. Usuń plik główny PDF z storage 'generated-offers'
    if (offer?.generated_pdf_url) {
      const { error: storageError } = await supabase.storage
        .from('generated-offers')
        .remove([offer.generated_pdf_url]);

      if (storageError) {
        console.warn('Failed to delete main PDF from storage:', storageError);
      }
    }

    // 3. Pobierz i usuń wszystkie pliki z event_files
    const { data: eventFiles } = await supabase
      .from('event_files')
      .select('file_path')
      .eq('offer_id', offerId)
      .eq('document_type', 'offer');

    if (eventFiles && eventFiles.length > 0) {
      const filePaths = eventFiles.map(f => f.file_path).filter(Boolean);
      if (filePaths.length > 0) {
        const { error: eventStorageError } = await supabase.storage
          .from('event-files')
          .remove(filePaths);

        if (eventStorageError) {
          console.warn('Failed to delete event files from storage:', eventStorageError);
        }
      }
    }

    // 4. Usuń rekordy z event_files (nie usuwamy oferty!)
    await supabase
      .from('event_files')
      .delete()
      .eq('offer_id', offerId)
      .eq('document_type', 'offer');

    // 5. Wyczyść generated_pdf_url w ofercie
    const { error: updateError } = await supabase
      .from('offers')
      .update({
        generated_pdf_url: null,
        modified_after_generation: false
      })
      .eq('id', offerId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error('Error deleting offer PDF files:', err);
    return { success: false, error: err.message || 'Błąd podczas usuwania plików PDF' };
  }
}
