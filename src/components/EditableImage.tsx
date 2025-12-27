'use client';

import { useState, useEffect } from 'react';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { getSiteImage } from '@/lib/siteImages';
import type { SiteImage } from '@/lib/siteImages';
import { SliderX, SliderY, SliderScale } from './UI/Slider/Slider';
import { Save, X, Upload, RotateCcw } from 'lucide-react';
import { uploadImage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { ThreeDotMenu } from './UI/ThreeDotMenu/ThreeDotMenu';

interface EditableImageProps {
  section: string;
  defaultImage: string;
  alt: string;
  className?: string;
  imageClassName?: string;
}

export function EditableImage({
  section,
  defaultImage,
  alt,
  className = '',
  imageClassName = '',
}: EditableImageProps) {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const [siteImage, setSiteImage] = useState<SiteImage | null>(null);
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
  }, [section]);

  const loadImage = async () => {
    setLoading(true);

    const pageTableName = `${section.split('-')[0]}_page_images`;

    try {
      const { data: pageImage, error: pageError } = await supabase
        .from(pageTableName)
        .select('*')
        .eq('section', section)
        .eq('is_active', true)
        .maybeSingle();

      if (!pageError && pageImage) {
        const convertedImage: SiteImage = {
          id: pageImage.id,
          section: section,
          name: pageImage.name,
          description: pageImage.description,
          desktop_url: pageImage.image_url,
          mobile_url: pageImage.image_url,
          alt_text: pageImage.alt_text,
          position: 'center',
          order_index: pageImage.order_index || 1,
          is_active: pageImage.is_active,
          image_metadata: pageImage.image_metadata,
          opacity: pageImage.opacity || 1,
          created_at: pageImage.created_at,
          updated_at: pageImage.updated_at,
        };
        setSiteImage(convertedImage);
        setEditState({
          posX: convertedImage.image_metadata?.desktop?.position?.posX || 0,
          posY: convertedImage.image_metadata?.desktop?.position?.posY || 0,
          scale: convertedImage.image_metadata?.desktop?.position?.scale || 1,
        });
        setLoading(false);
        return;
      }
    } catch (err) {
      showSnackbar('Tabela ${pageTableName} nie istnieje, używam starych tabel', 'error');
    }

    const image = await getSiteImage(section);
    setSiteImage(image);

    if (image) {
      setEditState({
        posX: image.image_metadata?.desktop?.position?.posX || 0,
        posY: image.image_metadata?.desktop?.position?.posY || 0,
        scale: image.image_metadata?.desktop?.position?.scale || 1,
      });
    }
    setLoading(false);
  };

  const handleSavePosition = async () => {
    setSaving(true);
    try {
      const pageTableName = `${section.split('-')[0]}_page_images`;

      try {
        const { data: existing } = await supabase
          .from(pageTableName)
          .select('id')
          .eq('section', section)
          .maybeSingle();

        if (existing || section.includes('about') || section.includes('team')) {
          if (!existing) {
            const { error } = await supabase
              .from(pageTableName)
              .insert({
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
              .from(pageTableName)
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
          return;
        }
      } catch (err) {
        showSnackbar('Używam starych tabel', 'error');
      }

      if (!siteImage) {
        const { data, error } = await supabase
          .from('site_images')
          .insert({
            section,
            name: `Image ${section}`,
            description: `Image for ${section}`,
            desktop_url: defaultImage,
            alt_text: alt,
            image_metadata: {
              desktop: {
                src: defaultImage,
                position: {
                  posX: editState.posX,
                  posY: editState.posY,
                  scale: editState.scale,
                },
                objectFit: 'cover',
              },
              mobile: {
                src: defaultImage,
                position: {
                  posX: editState.posX,
                  posY: editState.posY,
                  scale: editState.scale,
                },
                objectFit: 'cover',
              },
            },
          })
          .select()
          .single();

        if (error) throw error;
        setSiteImage(data);
      } else {
        const { error } = await supabase
          .from('site_images')
          .update({
            image_metadata: {
              ...siteImage.image_metadata,
              desktop: {
                ...siteImage.image_metadata?.desktop,
                src: siteImage.desktop_url,
                position: {
                  posX: editState.posX,
                  posY: editState.posY,
                  scale: editState.scale,
                },
                objectFit: siteImage.image_metadata?.desktop?.objectFit || 'cover',
              },
              mobile: {
                ...siteImage.image_metadata?.mobile,
                src: siteImage.mobile_url || siteImage.desktop_url,
                position: {
                  posX: editState.posX,
                  posY: editState.posY,
                  scale: editState.scale,
                },
                objectFit: siteImage.image_metadata?.mobile?.objectFit || 'cover',
              },
            },
          })
          .eq('id', siteImage.id);

        if (error) throw error;
        await loadImage();
      }

      setIsEditingPosition(false);
      setPositionSubMenu(false);
      showSnackbar('Pozycja zapisana pomyślnie', 'success');
    } catch (error) {
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
      const pageTableName = `${section.split('-')[0]}_page_images`;

      try {
        const { data: existing } = await supabase
          .from(pageTableName)
          .select('id')
          .eq('section', section)
          .maybeSingle();

        if (existing || section.includes('about') || section.includes('team')) {
          if (existing) {
            const { error } = await supabase
              .from(pageTableName)
              .update({
                image_url: url,
              })
              .eq('section', section);
            if (error) throw error;
          } else {
            const { error } = await supabase
              .from(pageTableName)
              .insert({
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
          return;
        }
      } catch (err) {
        showSnackbar('Używam starych tabel', 'error');
      }

      if (siteImage) {
        const { error } = await supabase
          .from('site_images')
          .update({
            desktop_url: url,
            image_metadata: {
              ...siteImage.image_metadata,
              desktop: {
                ...siteImage.image_metadata?.desktop,
                src: url,
              },
              mobile: {
                ...siteImage.image_metadata?.mobile,
                src: url,
              },
            },
          })
          .eq('id', siteImage.id);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('site_images')
          .insert({
            section,
            name: `Image ${section}`,
            description: `Image for ${section}`,
            desktop_url: url,
            alt_text: alt,
            image_metadata: {
              desktop: {
                src: url,
                position: { posX: 0, posY: 0, scale: 1 },
                objectFit: 'cover',
              },
              mobile: {
                src: url,
                position: { posX: 0, posY: 0, scale: 1 },
                objectFit: 'cover',
              },
            },
          })
          .select()
          .single();

        if (error) throw error;
        setSiteImage(data);
      }

      await loadImage();
      showSnackbar('Zdjęcie wgrane pomyślnie', 'success');
    } catch (error) {
      showSnackbar('Błąd podczas przesyłania zdjęcia', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleCancelPosition = () => {
    setIsEditingPosition(false);
    setPositionSubMenu(false);
    if (siteImage) {
      setEditState({
        posX: siteImage.image_metadata?.desktop?.position?.posX || 0,
        posY: siteImage.image_metadata?.desktop?.position?.posY || 0,
        scale: siteImage.image_metadata?.desktop?.position?.scale || 1,
      });
    }
  };

  const handleResetPosition = async () => {
    setEditState({ posX: 0, posY: 0, scale: 1 });

    if (siteImage) {
      setSaving(true);
      try {
        const pageTableName = `${section.split('-')[0]}_page_images`;

        try {
          const { data: existing } = await supabase
            .from(pageTableName)
            .select('id')
            .eq('section', section)
            .maybeSingle();

          if (existing) {
            const { error } = await supabase
              .from(pageTableName)
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
            return;
          }
        } catch (err) {
          showSnackbar('Błąd podczas resetowania pozycji', 'error');
        }

        const { error } = await supabase
          .from('site_images')
          .update({
            image_metadata: {
              ...siteImage.image_metadata,
              desktop: {
                ...siteImage.image_metadata?.desktop,
                position: { posX: 0, posY: 0, scale: 1 },
              },
              mobile: {
                ...siteImage.image_metadata?.mobile,
                position: { posX: 0, posY: 0, scale: 1 },
              },
            },
          })
          .eq('id', siteImage.id);

        if (error) throw error;
        await loadImage();
        showSnackbar('Pozycja zresetowana', 'success');
      } catch (error) {
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
        document.getElementById(`editable-image-upload-${section}`)?.click();
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

  const imageUrl = siteImage?.desktop_url || defaultImage;
  const displayPosition = isEditingPosition ? editState : (siteImage?.image_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 });

  return (
    <div className={`relative ${className}`}>
      <div className="overflow-hidden w-full h-full">
        <img
          src={imageUrl}
          alt={siteImage?.alt_text || alt}
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
            id={`editable-image-upload-${section}`}
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
                  className="p-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <div className="w-5 h-5 border-2 border-[#1c1f33] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Save className="w-5 h-5" />
                  )}
                </button>
                <button
                  onClick={handleCancelPosition}
                  disabled={saving}
                  className="p-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <X className="w-5 h-5" />
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
              onChange={(_, v) => setEditState(s => ({ ...s, posX: v as number }))}
            />
            <SliderY
              value={editState.posY}
              min={-100}
              max={100}
              step={0.1}
              onChange={(_, v) => setEditState(s => ({ ...s, posY: v as number }))}
            />
            <SliderScale
              value={editState.scale}
              min={0.1}
              max={3}
              step={0.01}
              onChange={(_, v) => setEditState(s => ({ ...s, scale: v as number }))}
            />
          </div>
        </div>
      )}

      {uploading && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="w-16 h-16 border-4 border-[#d3bb73] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
