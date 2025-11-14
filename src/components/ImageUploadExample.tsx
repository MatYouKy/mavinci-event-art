'use client';

import { useState } from 'react';
import { uploadOptimizedImage, uploadImageSimple } from '@/lib/storage';
import ResponsiveImage from './ResponsiveImage';
import { Upload, Image as ImageIcon, Check, X } from 'lucide-react';

/**
 * Example component showing how to use the new image optimization system
 * This is a reference implementation - copy patterns to your components
 */
export default function ImageUploadExample() {
  const [uploading, setUploading] = useState(false);
  const [uploadedUrls, setUploadedUrls] = useState<{
    desktop: string;
    mobile: string;
    thumbnail: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [originalSize, setOriginalSize] = useState<number>(0);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setOriginalSize(file.size);

    try {
      // Method 1: Upload with all responsive versions (RECOMMENDED)
      const urls = await uploadOptimizedImage(file, 'examples');
      setUploadedUrls(urls);

      // Save to database example:
      // await supabase.from('my_table').insert({
      //   image_desktop: urls.desktop,
      //   image_mobile: urls.mobile,
      //   image_thumbnail: urls.thumbnail,
      // });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSimpleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setOriginalSize(file.size);

    try {
      // Method 2: Simple upload (desktop only, 2200px max)
      const result = await uploadImageSimple(file, 'examples', 2200);

      if (result.success && result.url) {
        setUploadedUrls({
          desktop: result.url,
          mobile: result.url,
          thumbnail: result.url,
        });
      } else {
        setError(result.error || 'Upload failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
        <h2 className="mb-4 flex items-center gap-2 text-2xl font-light text-[#e5e4e2]">
          <ImageIcon className="h-6 w-6 text-[#d3bb73]" />
          System Optymalizacji Obrazów
        </h2>
        <p className="mb-6 text-[#e5e4e2]/70">
          Automatyczna kompresja i generowanie wersji responsywnych (desktop 2200px, mobile 800px,
          thumbnail 400px)
        </p>

        {/* Upload buttons */}
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#d3bb73]/30 p-8 transition-colors hover:border-[#d3bb73]/50">
            <Upload className="mb-2 h-8 w-8 text-[#d3bb73]" />
            <span className="mb-1 text-sm font-medium text-[#e5e4e2]">
              Upload z wersjami responsive
            </span>
            <span className="text-center text-xs text-[#e5e4e2]/60">
              Generuje desktop, mobile i thumbnail
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              disabled={uploading}
              className="hidden"
            />
          </label>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#d3bb73]/30 p-8 transition-colors hover:border-[#d3bb73]/50">
            <ImageIcon className="mb-2 h-8 w-8 text-[#d3bb73]" />
            <span className="mb-1 text-sm font-medium text-[#e5e4e2]">Upload prosty</span>
            <span className="text-center text-xs text-[#e5e4e2]/60">
              Tylko desktop (2200px max)
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={handleSimpleUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
        </div>

        {/* Loading state */}
        {uploading && (
          <div className="mb-6 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 p-4">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
              <span className="text-[#e5e4e2]">Przetwarzanie i upload obrazu...</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <div className="flex items-center gap-3">
              <X className="h-5 w-5 text-red-500" />
              <span className="text-red-500">{error}</span>
            </div>
          </div>
        )}

        {/* Success state */}
        {uploadedUrls && !uploading && (
          <div className="space-y-4">
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
              <div className="mb-3 flex items-center gap-3">
                <Check className="h-5 w-5 text-green-500" />
                <span className="font-medium text-green-500">Upload zakończony!</span>
              </div>
              <div className="space-y-1 text-sm text-[#e5e4e2]/70">
                <div>Oryginalny rozmiar: {(originalSize / 1024 / 1024).toFixed(2)} MB</div>
              </div>
            </div>

            {/* URLs display */}
            <div className="space-y-3 rounded-lg bg-[#0f1119] p-4">
              <h3 className="mb-2 font-medium text-[#e5e4e2]">Wygenerowane wersje:</h3>

              <div className="space-y-2">
                <div>
                  <span className="text-sm text-[#d3bb73]">Desktop (2200px):</span>
                  <div className="mt-1 break-all font-mono text-xs text-[#e5e4e2]/60">
                    {uploadedUrls.desktop}
                  </div>
                </div>

                {uploadedUrls.mobile !== uploadedUrls.desktop && (
                  <>
                    <div>
                      <span className="text-sm text-[#d3bb73]">Mobile (800px):</span>
                      <div className="mt-1 break-all font-mono text-xs text-[#e5e4e2]/60">
                        {uploadedUrls.mobile}
                      </div>
                    </div>

                    <div>
                      <span className="text-sm text-[#d3bb73]">Thumbnail (400px):</span>
                      <div className="mt-1 break-all font-mono text-xs text-[#e5e4e2]/60">
                        {uploadedUrls.thumbnail}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Preview using ResponsiveImage component */}
            <div className="rounded-lg bg-[#0f1119] p-4">
              <h3 className="mb-3 font-medium text-[#e5e4e2]">Podgląd (responsive):</h3>
              <div className="aspect-video overflow-hidden rounded-lg">
                <ResponsiveImage
                  desktop={uploadedUrls.desktop}
                  mobile={uploadedUrls.mobile}
                  thumbnail={uploadedUrls.thumbnail}
                  alt="Uploaded image preview"
                  loading="eager"
                />
              </div>
              <p className="mt-2 text-xs text-[#e5e4e2]/60">
                Zmień szerokość okna przeglądarki - na mobile załaduje się mniejsza wersja!
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Documentation */}
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-6">
        <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">📚 Jak używać w swoim kodzie</h3>

        <div className="space-y-4 text-sm">
          <div>
            <h4 className="mb-2 font-medium text-[#d3bb73]">1. Upload z wersjami responsive:</h4>
            <pre className="overflow-x-auto rounded-lg bg-[#0f1119] p-3 text-xs text-[#e5e4e2]/70">
              {`const urls = await uploadOptimizedImage(file, 'folder');
// urls.desktop  - 2200px
// urls.mobile   - 800px
// urls.thumbnail - 400px`}
            </pre>
          </div>

          <div>
            <h4 className="mb-2 font-medium text-[#d3bb73]">2. Wyświetlanie:</h4>
            <pre className="overflow-x-auto rounded-lg bg-[#0f1119] p-3 text-xs text-[#e5e4e2]/70">
              {`<ResponsiveImage
  desktop={urls.desktop}
  mobile={urls.mobile}
  thumbnail={urls.thumbnail}
  alt="Opis"
/>`}
            </pre>
          </div>

          <div>
            <h4 className="mb-2 font-medium text-[#d3bb73]">3. Zapis do bazy:</h4>
            <pre className="overflow-x-auto rounded-lg bg-[#0f1119] p-3 text-xs text-[#e5e4e2]/70">
              {`await supabase.from('portfolio').insert({
  image_desktop: urls.desktop,
  image_mobile: urls.mobile,
  image_thumbnail: urls.thumbnail,
});`}
            </pre>
          </div>
        </div>

        <div className="mt-6 border-t border-[#d3bb73]/10 pt-6">
          <p className="text-xs text-[#e5e4e2]/60">
            Pełna dokumentacja: <code className="text-[#d3bb73]">IMAGE_OPTIMIZATION_GUIDE.md</code>
          </p>
        </div>
      </div>
    </div>
  );
}
