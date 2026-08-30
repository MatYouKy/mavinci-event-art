type OptimizeOfferImageOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
};

export async function optimizeOfferImage(
  file: File,
  options: OptimizeOfferImageOptions = {},
): Promise<File> {
  if (typeof window === 'undefined' || typeof createImageBitmap === 'undefined') return file;

  const maxWidth = options.maxWidth ?? 1800;
  const maxHeight = options.maxHeight ?? 1800;
  const quality = options.quality ?? 0.82;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    if (scale === 1 && file.size <= 1_500_000) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      bitmap.close();
      return file;
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, outputType, outputType === 'image/jpeg' ? quality : undefined);
    });
    if (!blob || (blob.size >= file.size && scale === 1)) return file;

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'offer-image';
    const extension = outputType === 'image/png' ? 'png' : 'jpg';
    return new File([blob], `${baseName}.${extension}`, {
      type: outputType,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
