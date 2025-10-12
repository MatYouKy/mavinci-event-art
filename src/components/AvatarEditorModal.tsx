'use client';

import { Dialog, IconButton, Slider } from '@mui/material';
import { X, Upload, Check, Move } from 'lucide-react';
import React, { useState, useRef } from 'react';
import { IImage, IUploadImage } from '../types/image';

interface AvatarEditorModalProps {
  open: boolean;
  onClose: () => void;
  image?: IImage | IUploadImage | null;
  onSave: (payload: { file?: File; image: IUploadImage | IImage }) => Promise<void>;
}

export const AvatarEditorModal: React.FC<AvatarEditorModalProps> = ({
  open,
  onClose,
  image,
  onSave,
}) => {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [positions, setPositions] = useState({
    posX: 0,
    posY: 0,
    scale: 1,
  });

  React.useEffect(() => {
    if (open && image && !previewUrl) {
      setPositions({
        posX: image.posX ?? 0,
        posY: image.posY ?? 0,
        scale: image.scale ?? 1,
      });
    }
  }, [open, image, previewUrl]);

  React.useEffect(() => {
    if (!open) {
      setUploadedFile(null);
      setPreviewUrl(null);
      setPositions({
        posX: image?.posX ?? 0,
        posY: image?.posY ?? 0,
        scale: image?.scale ?? 1,
      });
    }
  }, [open, image]);
  const [isPositioning, setIsPositioning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setPositions({ posX: 0, posY: 0, scale: 1 });
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const imageData: IUploadImage = {
        url: previewUrl || image?.url || '',
        alt: image?.alt || '',
        posX: positions.posX,
        posY: positions.posY,
        scale: positions.scale,
        opacity: image?.opacity ?? 1,
        objectFit: 'contain',
      };

      await onSave({
        file: uploadedFile || undefined,
        image: imageData,
      });

      onClose();
    } catch (error) {
      console.error('Error saving avatar:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const displayUrl = previewUrl || image?.url;

  React.useEffect(() => {
    console.log('AvatarEditorModal state:', {
      previewUrl,
      imageUrl: image?.url,
      displayUrl,
      uploadedFile: uploadedFile?.name,
      positions,
    });
  }, [previewUrl, image?.url, displayUrl, uploadedFile, positions]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: '#1c1f33',
          borderRadius: '12px',
          border: '1px solid rgba(211, 187, 115, 0.1)',
        },
      }}
    >
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">Edytuj zdjęcie profilowe</h3>
          <IconButton onClick={onClose} sx={{ color: '#e5e4e2' }}>
            <X size={20} />
          </IconButton>
        </div>

        <div className="relative w-full aspect-square mb-6 bg-[#0f1117] rounded-lg overflow-hidden">
          {displayUrl ? (
            <div
              className="absolute inset-0"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={displayUrl}
                alt="Avatar preview"
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain',
                  transform: `translate(${positions.posX}%, ${positions.posY}%) scale(${positions.scale})`,
                  transition: 'transform 0.1s ease-out',
                }}
                onLoad={() => console.log('Image loaded:', displayUrl)}
                onError={(e) => console.error('Image failed to load:', displayUrl, e)}
              />
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[#e5e4e2]/40">
              <Upload size={48} />
            </div>
          )}
        </div>

        {displayUrl && (
          <div className="space-y-4 mb-6">
            <div>
              <label className="text-sm text-[#e5e4e2]/60 mb-2 block">
                Pozycja X
              </label>
              <Slider
                value={positions.posX}
                min={-100}
                max={100}
                step={0.1}
                onChange={(_, value) => setPositions({ ...positions, posX: value as number })}
                sx={{
                  color: '#d3bb73',
                  '& .MuiSlider-thumb': {
                    backgroundColor: '#d3bb73',
                  },
                  '& .MuiSlider-track': {
                    backgroundColor: '#d3bb73',
                  },
                  '& .MuiSlider-rail': {
                    backgroundColor: '#e5e4e2',
                    opacity: 0.2,
                  },
                }}
              />
            </div>

            <div>
              <label className="text-sm text-[#e5e4e2]/60 mb-2 block">
                Pozycja Y
              </label>
              <Slider
                value={positions.posY}
                min={-100}
                max={100}
                step={0.1}
                onChange={(_, value) => setPositions({ ...positions, posY: value as number })}
                sx={{
                  color: '#d3bb73',
                  '& .MuiSlider-thumb': {
                    backgroundColor: '#d3bb73',
                  },
                  '& .MuiSlider-track': {
                    backgroundColor: '#d3bb73',
                  },
                  '& .MuiSlider-rail': {
                    backgroundColor: '#e5e4e2',
                    opacity: 0.2,
                  },
                }}
              />
            </div>

            <div>
              <label className="text-sm text-[#e5e4e2]/60 mb-2 block">
                Skala
              </label>
              <Slider
                value={positions.scale}
                min={0.1}
                max={3}
                step={0.01}
                onChange={(_, value) => setPositions({ ...positions, scale: value as number })}
                sx={{
                  color: '#d3bb73',
                  '& .MuiSlider-thumb': {
                    backgroundColor: '#d3bb73',
                  },
                  '& .MuiSlider-track': {
                    backgroundColor: '#d3bb73',
                  },
                  '& .MuiSlider-rail': {
                    backgroundColor: '#e5e4e2',
                    opacity: 0.2,
                  },
                }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-2 bg-[#d3bb73]/10 text-[#d3bb73] px-4 py-3 rounded-lg hover:bg-[#d3bb73]/20 transition-colors"
          >
            <Upload size={18} />
            {uploadedFile ? 'Zmień zdjęcie' : 'Wgraj zdjęcie'}
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving || !displayUrl}
            className="flex-1 flex items-center justify-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-3 rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check size={18} />
            {isSaving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </Dialog>
  );
};
