'use client';

import { useState, useEffect } from 'react';
import { X, RotateCcw } from 'lucide-react';

interface ImagePosition {
  posX: number;
  posY: number;
  scale: number;
}

interface ImageMetadata {
  desktop?: {
    position?: ImagePosition;
    objectFit?: string;
  };
}

interface ImagePositionEditorProps {
  imageUrl: string;
  currentMetadata: ImageMetadata | null;
  onSave: (metadata: ImageMetadata) => Promise<void>;
  onClose: () => void;
  title?: string;
  previewAspectRatio?: string;
  previewWidth?: number;
  previewHeight?: number;
  showCircularPreview?: boolean;
}

export default function ImagePositionEditor({
  imageUrl,
  currentMetadata,
  onSave,
  onClose,
  title = 'Edytuj pozycję zdjęcia',
  previewAspectRatio = '1/1',
  previewWidth = 200,
  previewHeight = 200,
  showCircularPreview = false,
}: ImagePositionEditorProps) {
  const [position, setPosition] = useState<ImagePosition>({
    posX: currentMetadata?.desktop?.position?.posX ?? 0,
    posY: currentMetadata?.desktop?.position?.posY ?? 0,
    scale: currentMetadata?.desktop?.position?.scale ?? 1,
  });
  const [objectFit, setObjectFit] = useState<string>(
    currentMetadata?.desktop?.objectFit ?? 'cover',
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleReset = () => {
    setPosition({ posX: 0, posY: 0, scale: 1 });
    setObjectFit('cover');
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const metadata: ImageMetadata = {
        desktop: {
          position,
          objectFit,
        },
      };
      await onSave(metadata);
      onClose();
    } catch (error) {
      console.error('Error saving position:', error);
      alert('Błąd podczas zapisywania pozycji');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-xl font-light text-[#e5e4e2]">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-2 transition-colors hover:bg-[#252842]">
            <X className="h-5 w-5 text-[#e5e4e2]" />
          </button>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Preview */}
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Podgląd: {showCircularPreview && '(okrągły - jak avatar)'}
            </label>
            <div
              className={`relative mx-auto overflow-hidden border-2 border-[#d3bb73]/20 bg-[#0f1119] ${
                showCircularPreview ? 'rounded-full' : 'rounded-lg'
              }`}
              style={{
                width: '100%',
                maxWidth: `${previewWidth}px`,
                aspectRatio: previewAspectRatio,
              }}
            >
              <img
                src={imageUrl}
                alt="Preview"
                className="h-full w-full"
                style={{
                  objectFit: objectFit as any,
                  transform: `translate(${position.posX}%, ${position.posY}%) scale(${position.scale})`,
                }}
              />
            </div>

            <div className="mt-4 rounded-lg bg-[#252842] p-3">
              <p className="mb-2 text-xs text-[#e5e4e2]/60">Aktualne wartości:</p>
              <div className="space-y-1 text-xs text-[#e5e4e2]">
                <div>
                  X: <span className="text-[#d3bb73]">{position.posX.toFixed(1)}%</span>
                </div>
                <div>
                  Y: <span className="text-[#d3bb73]">{position.posY.toFixed(1)}%</span>
                </div>
                <div>
                  Skala: <span className="text-[#d3bb73]">{position.scale.toFixed(2)}x</span>
                </div>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="space-y-4">
            {/* Position X */}
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                Pozycja pozioma (X): {position.posX.toFixed(1)}%
              </label>
              <input
                type="range"
                min="-50"
                max="50"
                step="0.5"
                value={position.posX}
                onChange={(e) => setPosition({ ...position, posX: parseFloat(e.target.value) })}
                className="h-3 w-full cursor-pointer appearance-none rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#1c1f33] [&::-moz-range-thumb]:bg-[#d3bb73] [&::-moz-range-thumb]:shadow-lg [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#1c1f33] [&::-webkit-slider-thumb]:bg-[#d3bb73] [&::-webkit-slider-thumb]:shadow-lg"
              />
              <div className="mt-1 flex justify-between text-xs text-[#e5e4e2]/40">
                <span>Lewo</span>
                <span>Prawo</span>
              </div>
            </div>

            {/* Position Y */}
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                Pozycja pionowa (Y): {position.posY.toFixed(1)}%
              </label>
              <input
                type="range"
                min="-50"
                max="50"
                step="0.5"
                value={position.posY}
                onChange={(e) => setPosition({ ...position, posY: parseFloat(e.target.value) })}
                className="h-3 w-full cursor-pointer appearance-none rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#1c1f33] [&::-moz-range-thumb]:bg-[#d3bb73] [&::-moz-range-thumb]:shadow-lg [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#1c1f33] [&::-webkit-slider-thumb]:bg-[#d3bb73] [&::-webkit-slider-thumb]:shadow-lg"
              />
              <div className="mt-1 flex justify-between text-xs text-[#e5e4e2]/40">
                <span>Góra</span>
                <span>Dół</span>
              </div>
            </div>

            {/* Scale */}
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                Skala: {position.scale.toFixed(2)}x
              </label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={position.scale}
                onChange={(e) => setPosition({ ...position, scale: parseFloat(e.target.value) })}
                className="h-3 w-full cursor-pointer appearance-none rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#1c1f33] [&::-moz-range-thumb]:bg-[#d3bb73] [&::-moz-range-thumb]:shadow-lg [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#1c1f33] [&::-webkit-slider-thumb]:bg-[#d3bb73] [&::-webkit-slider-thumb]:shadow-lg"
              />
              <div className="mt-1 flex justify-between text-xs text-[#e5e4e2]/40">
                <span>Mniejsze</span>
                <span>Większe</span>
              </div>
            </div>

            {/* Object Fit */}
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Dopasowanie:</label>
              <select
                value={objectFit}
                onChange={(e) => setObjectFit(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#252842] px-3 py-2 text-[#e5e4e2]"
              >
                <option value="cover">Wypełnij (Cover)</option>
                <option value="contain">Zmieść (Contain)</option>
                <option value="fill">Rozciągnij (Fill)</option>
              </select>
            </div>

            {/* Reset Button */}
            <button
              onClick={handleReset}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#252842] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#2a2f4a]"
            >
              <RotateCcw className="h-4 w-4" />
              Resetuj do domyślnych
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex justify-end gap-3 border-t border-[#d3bb73]/10 pt-6">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg bg-[#252842] px-6 py-2 text-[#e5e4e2] transition-colors hover:bg-[#2a2f4a] disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {isSaving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
