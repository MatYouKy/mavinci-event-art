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
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
        <h2 className="text-2xl font-light text-[#e5e4e2] mb-4 flex items-center gap-2">
          <ImageIcon className="w-6 h-6 text-[#d3bb73]" />
          System Optymalizacji Obrazów
        </h2>
        <p className="text-[#e5e4e2]/70 mb-6">
          Automatyczna kompresja i generowanie wersji responsywnych (desktop 2200px, mobile 800px, thumbnail 400px)
        </p>

        {/* Upload buttons */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-[#d3bb73]/30 rounded-lg cursor-pointer hover:border-[#d3bb73]/50 transition-colors">
            <Upload className="w-8 h-8 text-[#d3bb73] mb-2" />
            <span className="text-[#e5e4e2] text-sm font-medium mb-1">
              Upload z wersjami responsive
            </span>
            <span className="text-[#e5e4e2]/60 text-xs text-center">
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

          <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-[#d3bb73]/30 rounded-lg cursor-pointer hover:border-[#d3bb73]/50 transition-colors">
            <ImageIcon className="w-8 h-8 text-[#d3bb73] mb-2" />
            <span className="text-[#e5e4e2] text-sm font-medium mb-1">
              Upload prosty
            </span>
            <span className="text-[#e5e4e2]/60 text-xs text-center">
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
          <div className="bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#d3bb73]"></div>
              <span className="text-[#e5e4e2]">Przetwarzanie i upload obrazu...</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <X className="w-5 h-5 text-red-500" />
              <span className="text-red-500">{error}</span>
            </div>
          </div>
        )}

        {/* Success state */}
        {uploadedUrls && !uploading && (
          <div className="space-y-4">
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
              <div className="flex items-center gap-3 mb-3">
                <Check className="w-5 h-5 text-green-500" />
                <span className="text-green-500 font-medium">Upload zakończony!</span>
              </div>
              <div className="text-[#e5e4e2]/70 text-sm space-y-1">
                <div>Oryginalny rozmiar: {(originalSize / 1024 / 1024).toFixed(2)} MB</div>
              </div>
            </div>

            {/* URLs display */}
            <div className="bg-[#0f1119] rounded-lg p-4 space-y-3">
              <h3 className="text-[#e5e4e2] font-medium mb-2">Wygenerowane wersje:</h3>

              <div className="space-y-2">
                <div>
                  <span className="text-[#d3bb73] text-sm">Desktop (2200px):</span>
                  <div className="text-[#e5e4e2]/60 text-xs font-mono break-all mt-1">
                    {uploadedUrls.desktop}
                  </div>
                </div>

                {uploadedUrls.mobile !== uploadedUrls.desktop && (
                  <>
                    <div>
                      <span className="text-[#d3bb73] text-sm">Mobile (800px):</span>
                      <div className="text-[#e5e4e2]/60 text-xs font-mono break-all mt-1">
                        {uploadedUrls.mobile}
                      </div>
                    </div>

                    <div>
                      <span className="text-[#d3bb73] text-sm">Thumbnail (400px):</span>
                      <div className="text-[#e5e4e2]/60 text-xs font-mono break-all mt-1">
                        {uploadedUrls.thumbnail}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Preview using ResponsiveImage component */}
            <div className="bg-[#0f1119] rounded-lg p-4">
              <h3 className="text-[#e5e4e2] font-medium mb-3">Podgląd (responsive):</h3>
              <div className="aspect-video rounded-lg overflow-hidden">
                <ResponsiveImage
                  desktop={uploadedUrls.desktop}
                  mobile={uploadedUrls.mobile}
                  thumbnail={uploadedUrls.thumbnail}
                  alt="Uploaded image preview"
                  loading="eager"
                />
              </div>
              <p className="text-[#e5e4e2]/60 text-xs mt-2">
                Zmień szerokość okna przeglądarki - na mobile załaduje się mniejsza wersja!
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Documentation */}
      <div className="bg-[#1c1f33]/50 border border-[#d3bb73]/10 rounded-xl p-6">
        <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">📚 Jak używać w swoim kodzie</h3>

        <div className="space-y-4 text-sm">
          <div>
            <h4 className="text-[#d3bb73] font-medium mb-2">1. Upload z wersjami responsive:</h4>
            <pre className="bg-[#0f1119] rounded-lg p-3 text-[#e5e4e2]/70 overflow-x-auto text-xs">
{`const urls = await uploadOptimizedImage(file, 'folder');
// urls.desktop  - 2200px
// urls.mobile   - 800px
// urls.thumbnail - 400px`}
            </pre>
          </div>

          <div>
            <h4 className="text-[#d3bb73] font-medium mb-2">2. Wyświetlanie:</h4>
            <pre className="bg-[#0f1119] rounded-lg p-3 text-[#e5e4e2]/70 overflow-x-auto text-xs">
{`<ResponsiveImage
  desktop={urls.desktop}
  mobile={urls.mobile}
  thumbnail={urls.thumbnail}
  alt="Opis"
/>`}
            </pre>
          </div>

          <div>
            <h4 className="text-[#d3bb73] font-medium mb-2">3. Zapis do bazy:</h4>
            <pre className="bg-[#0f1119] rounded-lg p-3 text-[#e5e4e2]/70 overflow-x-auto text-xs">
{`await supabase.from('portfolio').insert({
  image_desktop: urls.desktop,
  image_mobile: urls.mobile,
  image_thumbnail: urls.thumbnail,
});`}
            </pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-[#d3bb73]/10">
          <p className="text-[#e5e4e2]/60 text-xs">
            Pełna dokumentacja: <code className="text-[#d3bb73]">IMAGE_OPTIMIZATION_GUIDE.md</code>
          </p>
        </div>
      </div>
    </div>
  );
}
