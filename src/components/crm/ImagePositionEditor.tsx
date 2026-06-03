'use client';

import { useState, useEffect } from 'react';
import { X, RotateCcw } from 'lucide-react';
import Image from 'next/image';

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
    currentMetadata?.desktop?.objectFit ?? 'cover'
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

      <div className="relative bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">{title}</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#252842] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#e5e4e2]" />
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Preview */}
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Podgląd: {showCircularPreview && '(okrągły - jak avatar)'}
            </label>
            <div
              className={`relative bg-[#0f1119] border-2 border-[#d3bb73]/20 overflow-hidden mx-auto ${
                showCircularPreview ? 'rounded-full' : 'rounded-lg'
              }`}
              style={{
                width: '100%',
                maxWidth: `${previewWidth}px`,
                aspectRatio: previewAspectRatio,
              }}
            >
              <Image
                src={imageUrl}
                alt="Preview"
                className="w-full h-full"
                style={{
                  objectFit: objectFit as any,
                  transform: `translate(${position.posX}%, ${position.posY}%) scale(${position.scale})`,
                }}
              />
            </div>

            <div className="mt-4 p-3 bg-[#252842] rounded-lg">
              <p className="text-xs text-[#e5e4e2]/60 mb-2">Aktualne wartości:</p>
              <div className="text-xs text-[#e5e4e2] space-y-1">
                <div>X: <span className="text-[#d3bb73]">{position.posX.toFixed(1)}%</span></div>
                <div>Y: <span className="text-[#d3bb73]">{position.posY.toFixed(1)}%</span></div>
                <div>Skala: <span className="text-[#d3bb73]">{position.scale.toFixed(2)}x</span></div>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="space-y-4">
            {/* Position X */}
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Pozycja pozioma (X): {position.posX.toFixed(1)}%
              </label>
              <input
                type="range"
                min="-50"
                max="50"
                step="0.5"
                value={position.posX}
                onChange={(e) => setPosition({ ...position, posX: parseFloat(e.target.value) })}
                className="w-full h-3 bg-[#0f1119] rounded-lg appearance-none cursor-pointer border border-[#d3bb73]/20 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#d3bb73] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#1c1f33] [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#d3bb73] [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#1c1f33] [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:shadow-lg"
              />
              <div className="flex justify-between text-xs text-[#e5e4e2]/40 mt-1">
                <span>Lewo</span>
                <span>Prawo</span>
              </div>
            </div>

            {/* Position Y */}
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Pozycja pionowa (Y): {position.posY.toFixed(1)}%
              </label>
              <input
                type="range"
                min="-50"
                max="50"
                step="0.5"
                value={position.posY}
                onChange={(e) => setPosition({ ...position, posY: parseFloat(e.target.value) })}
                className="w-full h-3 bg-[#0f1119] rounded-lg appearance-none cursor-pointer border border-[#d3bb73]/20 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#d3bb73] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#1c1f33] [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#d3bb73] [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#1c1f33] [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:shadow-lg"
              />
              <div className="flex justify-between text-xs text-[#e5e4e2]/40 mt-1">
                <span>Góra</span>
                <span>Dół</span>
              </div>
            </div>

            {/* Scale */}
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Skala: {position.scale.toFixed(2)}x
              </label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={position.scale}
                onChange={(e) => setPosition({ ...position, scale: parseFloat(e.target.value) })}
                className="w-full h-3 bg-[#0f1119] rounded-lg appearance-none cursor-pointer border border-[#d3bb73]/20 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#d3bb73] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#1c1f33] [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#d3bb73] [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#1c1f33] [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:shadow-lg"
              />
              <div className="flex justify-between text-xs text-[#e5e4e2]/40 mt-1">
                <span>Mniejsze</span>
                <span>Większe</span>
              </div>
            </div>

            {/* Object Fit */}
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Dopasowanie:</label>
              <select
                value={objectFit}
                onChange={(e) => setObjectFit(e.target.value)}
                className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
              >
                <option value="cover">Wypełnij (Cover)</option>
                <option value="contain">Zmieść (Contain)</option>
                <option value="fill">Rozciągnij (Fill)</option>
              </select>
            </div>

            {/* Reset Button */}
            <button
              onClick={handleReset}
              className="w-full py-2 px-4 bg-[#252842] text-[#e5e4e2] rounded-lg hover:bg-[#2a2f4a] transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Resetuj do domyślnych
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end mt-6 pt-6 border-t border-[#d3bb73]/10">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-6 py-2 bg-[#252842] text-[#e5e4e2] rounded-lg hover:bg-[#2a2f4a] transition-colors disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 font-medium"
          >
            {isSaving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
