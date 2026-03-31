import { supabase } from '@/lib/supabase/browser';

/**
 * Usuwa ofertę wraz z wszystkimi powiązanymi plikami ze storage
 *
 * @param offerId - ID oferty do usunięcia
 * @returns Promise z wynikiem operacji
 */
export async function deleteOfferWithFiles(offerId: string): Promise<{ success: boolean; error?: string }> {
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
      .eq('offer_id', offerId);

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

    // 4. Usuń ofertę z bazy (CASCADE usunie rekordy z event_files)
    const { error } = await supabase.from('offers').delete().eq('id', offerId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error('Error deleting offer with files:', err);
    return { success: false, error: err.message || 'Błąd podczas usuwania oferty' };
  }
}
