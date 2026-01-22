'use client';

import { useState, useEffect } from 'react';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { SliderX, SliderY, SliderScale } from './UI/Slider/Slider';
import { Save, X } from 'lucide-react';
import { uploadImage } from '@/lib/storage';
import { supabase } from '@/lib/supabase/browser';
import { ThreeDotMenu } from './UI/ThreeDotMenu/ThreeDotMenu';

interface ImageMetadata {
  desktop?: {
    position?: {
      posX: number;
      posY: number;
      scale: number;
    };
    objectFit?: string;
  };
  mobile?: {
    position?: {
      posX: number;
      posY: number;
      scale: number;
    };
    objectFit?: string;
  };
}

interface GalleryImage {
  id: string;
  section: string;
  name: string;
  description: string | null;
  image_url: string;
  alt_text: string | null;
  image_metadata: ImageMetadata;
  opacity: number;
  order_index: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface EditableImageSectionProps {
  section: string;
  tableName: string;
  defaultImage: string;
  alt: string;
  className?: string;
  imageClassName?: string;
}

export function EditableImageSection({
  section,
  tableName,
  defaultImage,
  alt,
  className = '',
  imageClassName = '',
}: EditableImageSectionProps) {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const [galleryImage, setGalleryImage] = useState<GalleryImage | null>(null);
  const [isEditingPosition, setIsEditingPosition] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [positionSubMenu, setPositionSubMenu] = useState(false);

  const [editState, setEditState] = useState({
    posX: 0,
    posY: 0,
    scale: 1,
  });

  useEffect(() => {
    loadImage();
  }, [section, tableName]);

  const loadImage = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('section', section)
        .eq('is_active', true)
        .maybeSingle();

      if (!error && data) {
        setGalleryImage(data);
        setEditState({
          posX: data.image_metadata?.desktop?.position?.posX || 0,
          posY: data.image_metadata?.desktop?.position?.posY || 0,
          scale: data.image_metadata?.desktop?.position?.scale || 1,
        });
      }
    } catch (err) {
      console.error('Error loading image:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePosition = async () => {
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from(tableName)
        .select('id')
        .eq('section', section)
        .maybeSingle();

      if (!existing) {
        const { error } = await supabase.from(tableName).insert({
          section: section,
          name: `Image ${section}`,
          description: `Image for ${section}`,
          image_url: defaultImage,
          alt_text: alt,
          image_metadata: {
            desktop: {
              position: {
                posX: editState.posX,
                posY: editState.posY,
                scale: editState.scale,
              },
              objectFit: 'cover',
            },
            mobile: {
              position: {
                posX: editState.posX,
                posY: editState.posY,
                scale: editState.scale,
              },
              objectFit: 'cover',
            },
          },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from(tableName)
          .update({
            image_metadata: {
              desktop: {
                position: {
                  posX: editState.posX,
                  posY: editState.posY,
                  scale: editState.scale,
                },
                objectFit: 'cover',
              },
              mobile: {
                position: {
                  posX: editState.posX,
                  posY: editState.posY,
                  scale: editState.scale,
                },
                objectFit: 'cover',
              },
            },
          })
          .eq('section', section);
        if (error) throw error;
      }

      await loadImage();
      setIsEditingPosition(false);
      setPositionSubMenu(false);
      showSnackbar('Pozycja zapisana pomyślnie', 'success');
    } catch (error) {
      console.error('Error saving position:', error);
      showSnackbar('Błąd podczas zapisywania pozycji', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const url = await uploadImage(file, section);

      const { data: existing } = await supabase
        .from(tableName)
        .select('id')
        .eq('section', section)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from(tableName)
          .update({
            image_url: url,
          })
          .eq('section', section);
        if (error) throw error;
      } else {
        const { error } = await supabase.from(tableName).insert({
          section: section,
          name: `Image ${section}`,
          description: `Image for ${section}`,
          image_url: url,
          alt_text: alt,
          image_metadata: {
            desktop: {
              position: { posX: 0, posY: 0, scale: 1 },
              objectFit: 'cover',
            },
            mobile: {
              position: { posX: 0, posY: 0, scale: 1 },
              objectFit: 'cover',
            },
          },
        });
        if (error) throw error;
      }

      await loadImage();
      showSnackbar('Zdjęcie wgrane pomyślnie', 'success');
    } catch (error) {
      console.error('Error uploading image:', error);
      showSnackbar('Błąd podczas przesyłania zdjęcia', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleCancelPosition = () => {
    setIsEditingPosition(false);
    setPositionSubMenu(false);
    if (galleryImage) {
      setEditState({
        posX: galleryImage.image_metadata?.desktop?.position?.posX || 0,
        posY: galleryImage.image_metadata?.desktop?.position?.posY || 0,
        scale: galleryImage.image_metadata?.desktop?.position?.scale || 1,
      });
    }
  };

  const handleResetPosition = async () => {
    setEditState({ posX: 0, posY: 0, scale: 1 });

    if (galleryImage) {
      setSaving(true);
      try {
        const { error } = await supabase
          .from(tableName)
          .update({
            image_metadata: {
              desktop: {
                position: { posX: 0, posY: 0, scale: 1 },
                objectFit: 'cover',
              },
              mobile: {
                position: { posX: 0, posY: 0, scale: 1 },
                objectFit: 'cover',
              },
            },
          })
          .eq('section', section);

        if (error) throw error;
        await loadImage();
        showSnackbar('Pozycja zresetowana', 'success');
      } catch (error) {
        console.error('Error resetting position:', error);
        showSnackbar('Błąd podczas resetowania pozycji', 'error');
      } finally {
        setSaving(false);
      }
    }
  };

  const menuItems = [
    {
      children: 'Wgraj Zdjęcie',
      onClick: () => {
        document.getElementById(`editable-section-upload-${section}`)?.click();
      },
    },
    {
      children: 'Ustaw Pozycję',
      onClick: () => {
        setIsEditingPosition(true);
        setPositionSubMenu(true);
      },
    },
    {
      children: 'Resetuj Pozycję',
      onClick: handleResetPosition,
    },
  ];

  const imageUrl = galleryImage?.image_url || defaultImage;
  const displayPosition = isEditingPosition
    ? editState
    : galleryImage?.image_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 };

  return (
    <div className={`relative ${className}`}>
      <div className="h-full w-full overflow-hidden">
        <img
          src={imageUrl}
          alt={galleryImage?.alt_text || alt}
          className={imageClassName}
          style={{
            minWidth: '100%',
            minHeight: '100%',
            width: 'auto',
            height: 'auto',
            maxWidth: 'none',
            objectFit: 'cover',
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: `translate(calc(-50% + ${displayPosition.posX}%), calc(-50% + ${displayPosition.posY}%)) scale(${displayPosition.scale})`,
            transformOrigin: 'center',
          }}
        />
      </div>

      {isEditMode && (
        <>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
            id={`editable-section-upload-${section}`}
          />

          <ThreeDotMenu
            menuPosition="right-bottom"
            menu_items={menuItems}
            menuAction={positionSubMenu}
            menuActionContent={
              <div className="flex gap-2 p-2">
                <button
                  onClick={handleSavePosition}
                  disabled={saving}
                  className="rounded-lg bg-[#d3bb73] p-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#1c1f33] border-t-transparent" />
                  ) : (
                    <Save className="h-5 w-5" />
                  )}
                </button>
                <button
                  onClick={handleCancelPosition}
                  disabled={saving}
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

      {uploading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="h-16 w-16 animate-spin rounded-full border-4 border-[#d3bb73] border-t-transparent" />
        </div>
      )}
    </div>
  );
}
