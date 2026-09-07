type OptimizeOfferImageOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  outputType?: 'image/jpeg' | 'image/png' | 'image/webp';
};

export async function optimizeOfferImage(
  file: File,
  options: OptimizeOfferImageOptions = {},
): Promise<File> {
  if (typeof window === 'undefined' || typeof createImageBitmap === 'undefined') return file;

  const maxWidth = options.maxWidth ?? 1800;
  const maxHeight = options.maxHeight ?? 1800;
  const quality = options.quality ?? 0.82;
  const requestedOutputType = options.outputType;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    if (scale === 1 && file.size <= 1_500_000 && (!requestedOutputType || requestedOutputType === file.type)) {
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

    const outputType = requestedOutputType || (
      file.type === 'image/png'
        ? 'image/png'
        : file.type === 'image/webp'
          ? 'image/webp'
          : 'image/jpeg'
    );
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        resolve,
        outputType,
        outputType === 'image/jpeg' || outputType === 'image/webp' ? quality : undefined,
      );
    });
    if (!blob || (
      blob.size >= file.size
      && scale === 1
      && (!requestedOutputType || requestedOutputType === file.type)
    )) return file;

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'offer-image';
    const extension =
      outputType === 'image/png' ? 'png' : outputType === 'image/webp' ? 'webp' : 'jpg';
    return new File([blob], `${baseName}.${extension}`, {
      type: outputType,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
