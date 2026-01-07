'use client';

import { useState, useEffect } from 'react';
import { useEditMode } from '@/contexts/EditModeContext';

import { SliderX, SliderY, SliderScale, SliderOpacity } from './UI/Slider/Slider';
import { Save, X } from 'lucide-react';
import { ThreeDotMenu } from './UI/ThreeDotMenu/ThreeDotMenu';
import { useHeroImage } from './PageImage/hooks/useHeroImage';

export interface PageHeroImageProps {
  section: string;
  pageSlug?: string;
  defaultImage?: string;
  defaultOpacity?: number;
  className?: string;
  children?: React.ReactNode;
}

export function PageHeroImage({
  section,
  pageSlug,
  defaultImage = 'https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/hero/1760341625716-d0b65e.jpg',
  defaultOpacity = 0.2,
  className = '',
  children,
}: PageHeroImageProps) {
  const {
    imageUrl,
    opacity,
    position,
    screenMode,
    setScreenMode,
    uploadHeroImage,
    setPosition,
    setOpacity,
    savePosition,
    saveOpacity,
    loading,
    resetPosition,
  } = useHeroImage(section, {
    pageSlug,
    defaultOpacity: 0.2,
  });
  const [stableSrc, setStableSrc] = useState<string>(() => {
    return typeof defaultImage === 'string' && defaultImage.trim() ? defaultImage : '';
  });

  useEffect(() => {
    if (typeof imageUrl === 'string' && imageUrl.trim()) {
      setStableSrc(imageUrl);
    }
  }, [imageUrl]);

  useEffect(() => {
    // jeśli zmienił się default (np. inna strona), też aktualizuj
    if (typeof defaultImage === 'string' && defaultImage.trim()) {
      setStableSrc(defaultImage);
    }
  }, [defaultImage]);

  const { isEditMode } = useEditMode();
  const [isEditingPosition, setIsEditingPosition] = useState(false);
  const [isEditingOpacity, setIsEditingOpacity] = useState(false);

  const [positionSubMenu, setPositionSubMenu] = useState(false);
  const [opacitySubMenu, setOpacitySubMenu] = useState(false);

  const [editState, setEditState] = useState({
    posX: 0,
    posY: 0,
    scale: 1,
    opacity: defaultOpacity,
  });

  // Sync editState with hook values when they change
  useEffect(() => {
    if (!isEditingOpacity && !isEditingPosition) {
      setEditState({
        posX: position.posX,
        posY: position.posY,
        scale: position.scale,
        opacity: opacity || defaultOpacity,
      });
    }
  }, [position, opacity, defaultOpacity, isEditingOpacity, isEditingPosition]);

  const handleCancelPosition = () => {
    setIsEditingPosition(false);
    setPositionSubMenu(false);
    resetPosition();
  };

  const handleCancelOpacity = () => {
    setIsEditingOpacity(false);
    setOpacitySubMenu(false);
    setEditState((s) => ({ ...s, opacity: opacity || defaultOpacity }));
  };

  const handleStartEditingOpacity = () => {
    setIsEditingOpacity(true);
    setOpacitySubMenu(true);
    setEditState((s) => ({ ...s, opacity: opacity || defaultOpacity }));
  };

  const handleStartEditingPosition = () => {
    setIsEditingPosition(true);
    setPositionSubMenu(true);
    setEditState((s) => ({
      ...s,
      posX: position.posX,
      posY: position.posY,
      scale: position.scale,
    }));
  };

  const handleSaveOpacity = async () => {
    setOpacity(editState.opacity);
    await saveOpacity(editState.opacity);
    setIsEditingOpacity(false);
    setOpacitySubMenu(false);
  };

  const handleSavePosition = async () => {
    const newPosition = {
      posX: editState.posX,
      posY: editState.posY,
      scale: editState.scale,
    };

    setPosition(newPosition);
    await savePosition(newPosition);
    setIsEditingPosition(false);
    setPositionSubMenu(false);
  };

  const menuItems = [
    {
      children: 'Wgraj Zdjęcie',
      onClick: () => {
        document.getElementById(`hero-image-upload-${section}`)?.click();
      },
    },
    {
      children: 'Ustaw Pozycję',
      onClick: handleStartEditingPosition,
    },
    {
      children: 'Ustaw Przezroczystość',
      onClick: handleStartEditingOpacity,
    },
    {
      children: 'Resetuj Pozycję',
      onClick: resetPosition,
    },
  ];

  const displayOpacity = isEditingOpacity ? editState.opacity : opacity || defaultOpacity;
  const displayPosition = isEditingPosition
    ? editState
    : position || { posX: 0, posY: 0, scale: 1 };

  // Use initial values from SSR if available, otherwise fall back to hook values
  const finalOpacity = displayOpacity;

  return (
    <div className={`relative ${className}`}>
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="h-full w-full"
          style={{
            position: 'relative',
            opacity: isEditingOpacity ? displayOpacity : finalOpacity,
          }}
        >
          <img
            src={stableSrc}
            alt={section}
            className="absolute"
            style={{
              minWidth: '100%',
              minHeight: '100%',
              width: 'auto',
              height: 'auto',
              maxWidth: 'none',
              objectFit: 'cover',
              left: '50%',
              top: '50%',
              transform: `translate(calc(-50% + ${displayPosition.posX}%), calc(-50% + ${displayPosition.posY}%)) scale(${displayPosition.scale})`,
              transformOrigin: 'center',
            }}
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-br from-[#1c1f33]/70 to-[#0f1119]/70"></div>
      </div>

      {isEditMode && (
        <>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => uploadHeroImage(e.target.files?.[0] as unknown as File)}
            className="hidden"
            id={`hero-image-upload-${section}`}
          />

          <ThreeDotMenu
            menuPosition="right-bottom"
            menu_items={menuItems}
            menuAction={positionSubMenu || opacitySubMenu}
            menuActionContent={
              <div className="flex gap-2 p-2">
                <button
                  onClick={positionSubMenu ? handleSavePosition : handleSaveOpacity}
                  disabled={loading}
                  className="rounded-lg bg-[#d3bb73] p-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#1c1f33] border-t-transparent" />
                  ) : (
                    <Save className="h-5 w-5" />
                  )}
                </button>
                <button
                  onClick={positionSubMenu ? handleCancelPosition : handleCancelOpacity}
                  disabled={loading}
                  className="rounded-lg bg-[#800020]/20 p-2 text-[#e5e4e2] transition-colors hover:bg-[#800020]/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            }
          />
        </>
      )}

      {isEditingPosition && positionSubMenu && (
        <div className="absolute inset-0 z-40" style={{ pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto' }}>
            <div className="absolute left-4 top-4 z-50 flex gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33]/95 p-2">
              <button
                onClick={() => setScreenMode('desktop')}
                className={`rounded px-4 py-2 text-sm font-medium transition-colors ${
                  screenMode === 'desktop'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#d3bb73]/10 text-[#d3bb73] hover:bg-[#d3bb73]/20'
                }`}
              >
                Desktop
              </button>
              <button
                onClick={() => setScreenMode('mobile')}
                className={`rounded px-4 py-2 text-sm font-medium transition-colors ${
                  screenMode === 'mobile'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#d3bb73]/10 text-[#d3bb73] hover:bg-[#d3bb73]/20'
                }`}
              >
                Mobile
              </button>
            </div>
            <SliderX
              value={editState.posX}
              min={-100}
              max={100}
              step={0.1}
              onChange={(_, v) => setEditState((s) => ({ ...s, posX: v as number }))}
            />
            <SliderY
              value={editState.posY}
              min={-100}
              max={100}
              step={0.1}
              onChange={(_, v) => setEditState((s) => ({ ...s, posY: v as number }))}
            />
            <SliderScale
              value={editState.scale}
              min={0.1}
              max={3}
              step={0.01}
              onChange={(_, v) => setEditState((s) => ({ ...s, scale: v as number }))}
            />
          </div>
        </div>
      )}

      {isEditingOpacity && opacitySubMenu && (
        <div className="absolute inset-0 z-40" style={{ pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto' }}>
            <SliderOpacity
              value={editState.opacity}
              min={0}
              max={2}
              step={0.01}
              onChange={(_, v) => setEditState((s) => ({ ...s, opacity: v as number }))}
              style={{ bottom: 70, top: 'auto' }}
            />
          </div>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="h-16 w-16 animate-spin rounded-full border-4 border-[#d3bb73] border-t-transparent" />
        </div>
      )}

      {children}
    </div>
  );
}
