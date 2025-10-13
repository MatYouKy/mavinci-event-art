import { supabase } from './supabase';

/**
 * Image size presets for responsive images
 */
export const IMAGE_SIZES = {
  desktop: { width: 2200, quality: 0.85 },
  mobile: { width: 800, quality: 0.85 },
  thumbnail: { width: 400, quality: 0.8 },
} as const;

interface ResizeOptions {
  maxWidth: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'webp' | 'png';
}

/**
 * Advanced image compression with multiple format support
 * Resizes and compresses images while maintaining aspect ratio
 */
const compressAndResizeImage = async (
  file: File,
  options: ResizeOptions
): Promise<Blob> => {
  const {
    maxWidth,
    maxHeight = maxWidth,
    quality = 0.85,
    format = 'webp',
  } = options;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Calculate new dimensions maintaining aspect ratio
        if (width > maxWidth || height > maxHeight) {
          const aspectRatio = width / height;
          if (width > height) {
            width = Math.min(width, maxWidth);
            height = width / aspectRatio;
          } else {
            height = Math.min(height, maxHeight);
            width = height * aspectRatio;
          }
        }

        // Round to avoid subpixel rendering
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);

        const ctx = canvas.getContext('2d', { alpha: format === 'png' });
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Use better image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Convert to specified format
        const mimeType = format === 'webp'
          ? 'image/webp'
          : format === 'png'
          ? 'image/png'
          : 'image/jpeg';

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Compression failed'));
              return;
            }
            resolve(blob);
          },
          mimeType,
          quality
        );
      };
      img.onerror = () => reject(new Error('Image load failed'));
    };
    reader.onerror = () => reject(new Error('File read failed'));
  });
};

/**
 * Legacy compression function - kept for backwards compatibility
 */
const compressImage = async (file: File, maxSizeMB: number = 2): Promise<File> => {
  const blob = await compressAndResizeImage(file, {
    maxWidth: 1920,
    quality: 0.85,
    format: 'jpeg',
  });

  return new File([blob], file.name, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
};

/**
 * Upload optimized image with responsive versions
 * Generates desktop (2200px), mobile (800px), and thumbnail (400px) versions
 */
export const uploadOptimizedImage = async (
  file: File,
  folder: string = 'site-images'
): Promise<{
  desktop: string;
  mobile: string;
  thumbnail: string;
  original?: string;
}> => {
  const baseFileName = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

  console.log(`[uploadOptimizedImage] Starting upload for: ${file.name}`);
  console.log(`[uploadOptimizedImage] Original size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);

  // Generate all versions in parallel
  const [desktopBlob, mobileBlob, thumbnailBlob] = await Promise.all([
    compressAndResizeImage(file, {
      maxWidth: IMAGE_SIZES.desktop.width,
      quality: IMAGE_SIZES.desktop.quality,
      format: 'webp',
    }),
    compressAndResizeImage(file, {
      maxWidth: IMAGE_SIZES.mobile.width,
      quality: IMAGE_SIZES.mobile.quality,
      format: 'webp',
    }),
    compressAndResizeImage(file, {
      maxWidth: IMAGE_SIZES.thumbnail.width,
      quality: IMAGE_SIZES.thumbnail.quality,
      format: 'webp',
    }),
  ]);

  console.log(`[uploadOptimizedImage] Generated versions:`);
  console.log(`  - Desktop: ${(desktopBlob.size / 1024).toFixed(0)}KB`);
  console.log(`  - Mobile: ${(mobileBlob.size / 1024).toFixed(0)}KB`);
  console.log(`  - Thumbnail: ${(thumbnailBlob.size / 1024).toFixed(0)}KB`);

  // Upload all versions in parallel
  const uploadPromises = [
    supabase.storage
      .from('site-images')
      .upload(`${folder}/${baseFileName}-desktop.webp`, desktopBlob, {
        cacheControl: '31536000',
        contentType: 'image/webp',
        upsert: false,
      }),
    supabase.storage
      .from('site-images')
      .upload(`${folder}/${baseFileName}-mobile.webp`, mobileBlob, {
        cacheControl: '31536000',
        contentType: 'image/webp',
        upsert: false,
      }),
    supabase.storage
      .from('site-images')
      .upload(`${folder}/${baseFileName}-thumb.webp`, thumbnailBlob, {
        cacheControl: '31536000',
        contentType: 'image/webp',
        upsert: false,
      }),
  ];

  const results = await Promise.all(uploadPromises);

  // Check for errors
  const errors = results.filter((r) => r.error);
  if (errors.length > 0) {
    console.error('[uploadOptimizedImage] Upload errors:', errors);
    throw new Error(`Upload failed: ${errors[0].error?.message}`);
  }

  // Get public URLs
  const [desktopData, mobileData, thumbnailData] = results.map((r) => r.data!);

  const desktopUrl = supabase.storage
    .from('site-images')
    .getPublicUrl(desktopData.path).data.publicUrl;

  const mobileUrl = supabase.storage
    .from('site-images')
    .getPublicUrl(mobileData.path).data.publicUrl;

  const thumbnailUrl = supabase.storage
    .from('site-images')
    .getPublicUrl(thumbnailData.path).data.publicUrl;

  console.log(`[uploadOptimizedImage] Upload complete!`);
  console.log(`  - Desktop: ${desktopUrl}`);
  console.log(`  - Mobile: ${mobileUrl}`);
  console.log(`  - Thumbnail: ${thumbnailUrl}`);

  return {
    desktop: desktopUrl,
    mobile: mobileUrl,
    thumbnail: thumbnailUrl,
  };
};

/**
 * Legacy upload function - now uses optimized version with desktop image
 * @deprecated Use uploadOptimizedImage instead
 */
export const uploadImage = async (file: File, folder: string = 'site-images'): Promise<string> => {
  let fileToUpload = file;

  if (file.size > 2 * 1024 * 1024) {
    console.log('Image too large, compressing...');
    fileToUpload = await compressImage(file, 2);
    console.log(`Compressed from ${(file.size / 1024 / 1024).toFixed(2)}MB to ${(fileToUpload.size / 1024 / 1024).toFixed(2)}MB`);
  }

  const fileExt = 'jpg';
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

  const { data, error } = await supabase.storage
    .from('site-images')
    .upload(fileName, fileToUpload, {
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

/**
 * Upload image with automatic optimization and responsive versions
 * Returns desktop URL for backwards compatibility but uploads all versions
 */
export const uploadImageToStorage = async (
  file: File,
  folder: string = 'site-images'
): Promise<{
  success: boolean;
  url?: string;
  urls?: { desktop: string; mobile: string; thumbnail: string };
  error?: string;
}> => {
  try {
    const urls = await uploadOptimizedImage(file, folder);

    return {
      success: true,
      url: urls.desktop, // For backwards compatibility
      urls, // New field with all versions
    };
  } catch (error) {
    console.error('Upload error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Simple upload with compression - desktop only (2200px max)
 * Use this for quick uploads without responsive versions
 */
export const uploadImageSimple = async (
  file: File,
  folder: string = 'site-images',
  maxWidth: number = 2200
): Promise<{ success: boolean; url?: string; error?: string }> => {
  try {
    console.log(`[uploadImageSimple] Uploading: ${file.name}`);
    console.log(`[uploadImageSimple] Original size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);

    // Generate optimized image
    const blob = await compressAndResizeImage(file, {
      maxWidth,
      quality: 0.85,
      format: 'webp',
    });

    console.log(`[uploadImageSimple] Optimized size: ${(blob.size / 1024).toFixed(0)}KB`);

    const fileName = `${folder}/${Date.now()}-${Math.random()
      .toString(36)
      .substring(7)}.webp`;

    const { data, error } = await supabase.storage
      .from('site-images')
      .upload(fileName, blob, {
        cacheControl: '31536000',
        contentType: 'image/webp',
        upsert: false,
      });

    if (error) {
      console.error('[uploadImageSimple] Upload error:', error);
      return {
        success: false,
        error: `Upload failed: ${error.message}`,
      };
    }

    const { data: urlData } = supabase.storage
      .from('site-images')
      .getPublicUrl(data.path);

    console.log(`[uploadImageSimple] Upload complete: ${urlData.publicUrl}`);

    return {
      success: true,
      url: urlData.publicUrl,
    };
  } catch (error) {
    console.error('[uploadImageSimple] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};
