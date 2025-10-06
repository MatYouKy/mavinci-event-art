import { supabase } from './supabase';

export const uploadImage = async (file: File, folder: string = 'site-images'): Promise<string> => {
  const fileExt = file.name.split('.').pop();
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

  const { data, error } = await supabase.storage
    .from('site-images')
    .upload(fileName, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    console.error('Upload error:', error);
    throw new Error(`Upload failed: ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from('site-images')
    .getPublicUrl(data.path);

  return urlData.publicUrl;
};

export const deleteImage = async (url: string): Promise<void> => {
  try {
    const path = url.split('/site-images/').pop();
    if (!path) return;

    const { error } = await supabase.storage
      .from('site-images')
      .remove([path]);

    if (error) {
      console.error('Delete error:', error);
    }
  } catch (error) {
    console.error('Delete image error:', error);
  }
};
