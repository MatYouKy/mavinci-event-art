'use client';

import { useState } from 'react';
import { Upload, X, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadImageToStorage } from '@/lib/storage';
import { SliderX, SliderY, SliderScale } from './UI/Slider/Slider';

interface ImagePosition {
  posX: number;
  posY: number;
  scale: number;
}

interface ImageMetadata {
  position?: ImagePosition;
  object_fit?: 'cover' | 'contain' | 'fill' | 'scale-down';
}

interface EmployeeImageEditorProps {
  employeeId: string;
  currentImageUrl: string | null;
  metadata: ImageMetadata | null;
  onUpdate: () => void;
  imageType: 'avatar' | 'background';
  title: string;
}

export function EmployeeImageEditor({
  employeeId,
  currentImageUrl,
  metadata,
  onUpdate,
  imageType,
  title,
}: EmployeeImageEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(currentImageUrl);
  const [objectFit, setObjectFit] = useState<string>(metadata?.object_fit || 'cover');
  const [position, setPosition] = useState<ImagePosition>({
    posX: metadata?.position?.posX || 0,
    posY: metadata?.position?.posY || 0,
    scale: metadata?.position?.scale || 1,
  });
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.type.startsWith('image/')) {
      alert('Proszę wybrać plik graficzny');
      return;
    }

    setFile(selectedFile);
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleSave = async () => {
    try {
      setUploading(true);

      let imageUrl = currentImageUrl;

      if (file) {
        const folder = imageType === 'avatar' ? 'employee-avatars' : 'employee-backgrounds';
        const uploadResult = await uploadImageToStorage(file, folder);

        if (!uploadResult.success || !uploadResult.url) {
          throw new Error(uploadResult.error || 'Upload failed');
        }

        imageUrl = uploadResult.url;
      }

      const newMetadata = {
        position: {
          posX: position.posX,
          posY: position.posY,
          scale: position.scale,
        },
        object_fit: objectFit,
      };

      const updateData: any = {};

      if (imageType === 'avatar') {
        updateData.avatar_url = imageUrl;
        updateData.avatar_metadata = newMetadata;
      } else {
        updateData.background_image_url = imageUrl;
        updateData.background_metadata = newMetadata;
      }

      const { error } = await supabase
        .from('employees')
        .update(updateData)
        .eq('id', employeeId);

      if (error) throw error;

      onUpdate();
      setIsOpen(false);
      setFile(null);
    } catch (err) {
      console.error('Error saving image:', err);
      alert('Błąd podczas zapisywania zdjęcia');
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 flex items-center gap-2"
      >
        <Upload className="w-4 h-4" />
        {title}
      </button>
    );
  }

  const getTransformStyle = () => {
    return {
      transform: `translate(${position.posX}%, ${position.posY}%) scale(${position.scale})`,
      transition: 'transform 0.1s ease-out',
    };
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">{title}</h2>
          <button
            onClick={() => {
              setIsOpen(false);
              setFile(null);
              setPreview(currentImageUrl);
            }}
            className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#e5e4e2]" />
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Wybierz zdjęcie
            </label>
            {preview ? (
              <div className="relative aspect-[16/9] overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
                <div className="absolute inset-0 flex items-center justify-center">
                  <img
                    src={preview}
                    alt="Podgląd"
                    className="w-full h-full"
                    style={{
                      objectFit: objectFit as any,
                      ...getTransformStyle(),
                    }}
                  />
                </div>
                <button
                  onClick={() => {
                    setFile(null);
                    setPreview(currentImageUrl);
                  }}
                  className="absolute top-2 right-2 p-2 bg-[#800020] text-[#e5e4e2] rounded-lg hover:bg-[#800020]/90 transition-colors z-10"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full aspect-[16/9] border-2 border-dashed border-[#d3bb73]/20 rounded-lg cursor-pointer hover:border-[#d3bb73]/40 transition-colors">
                <div className="flex flex-col items-center justify-center">
                  <Upload className="w-12 h-12 text-[#d3bb73] mb-4" />
                  <p className="mb-2 text-sm text-[#e5e4e2]">
                    <span className="font-semibold">Kliknij aby wybrać</span> lub przeciągnij plik
                  </p>
                  <p className="text-xs text-[#e5e4e2]/60">PNG, JPG (MAX. 5MB)</p>
                </div>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handleFileSelect}
                />
              </label>
            )}
          </div>

          {preview && (
            <>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Dopasowanie
                </label>
                <select
                  value={objectFit}
                  onChange={(e) => setObjectFit(e.target.value)}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                >
                  <option value="cover">Wypełnij (Cover)</option>
                  <option value="contain">Zmieść (Contain)</option>
                  <option value="fill">Rozciągnij (Fill)</option>
                  <option value="scale-down">Zmniejsz (Scale Down)</option>
                </select>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-medium text-[#e5e4e2]">Pozycjonowanie</h3>

                <div>
                  <label className="block text-xs text-[#e5e4e2]/60 mb-2">
                    Pozycja X (lewo/prawo)
                  </label>
                  <SliderX
                    value={position.posX}
                    onChange={(value) => setPosition({ ...position, posX: value })}
                  />
                </div>

                <div>
                  <label className="block text-xs text-[#e5e4e2]/60 mb-2">
                    Pozycja Y (góra/dół)
                  </label>
                  <SliderY
                    value={position.posY}
                    onChange={(value) => setPosition({ ...position, posY: value })}
                  />
                </div>

                <div>
                  <label className="block text-xs text-[#e5e4e2]/60 mb-2">
                    Skala (zoom)
                  </label>
                  <SliderScale
                    value={position.scale}
                    onChange={(value) => setPosition({ ...position, scale: value })}
                  />
                </div>

                <button
                  onClick={() => setPosition({ posX: 0, posY: 0, scale: 1 })}
                  className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                >
                  Resetuj pozycję
                </button>
              </div>
            </>
          )}

          <div className="flex gap-3 pt-4 border-t border-[#d3bb73]/10">
            <button
              onClick={handleSave}
              disabled={uploading || (!file && currentImageUrl === preview)}
              className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              {uploading ? 'Zapisywanie...' : 'Zapisz'}
            </button>
            <button
              onClick={() => {
                setIsOpen(false);
                setFile(null);
                setPreview(currentImageUrl);
                setPosition({
                  posX: metadata?.position?.posX || 0,
                  posY: metadata?.position?.posY || 0,
                  scale: metadata?.position?.scale || 1,
                });
              }}
              className="px-4 py-2 rounded-lg text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
