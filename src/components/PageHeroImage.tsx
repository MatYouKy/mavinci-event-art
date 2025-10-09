'use client';

import { useState, useEffect } from 'react';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { getSiteImage } from '@/lib/siteImages';
import type { SiteImage } from '@/lib/siteImages';
import { SliderX, SliderY, SliderScale, SliderOpacity } from './UI/Slider/Slider';
import { Save, X } from 'lucide-react';
import { uploadImage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { ThreeDotMenu } from './UI/ThreeDotMenu/ThreeDotMenu';

interface PageHeroImageProps {
  section: string;
  defaultImage?: string;
  defaultOpacity?: number;
  className?: string;
  children?: React.ReactNode;
}

export function PageHeroImage({
  section,
  defaultImage = 'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920',
  defaultOpacity = 0.2,
  className = '',
  children,
}: PageHeroImageProps) {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const [siteImage, setSiteImage] = useState<SiteImage | null>(null);
  const [isEditingPosition, setIsEditingPosition] = useState(false);
  const [isEditingOpacity, setIsEditingOpacity] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [positionSubMenu, setPositionSubMenu] = useState(false);
  const [opacitySubMenu, setOpacitySubMenu] = useState(false);

  const [editState, setEditState] = useState({
    posX: 0,
    posY: 0,
    scale: 1,
    opacity: defaultOpacity,
  });

  // Funkcja mapująca nazwy sekcji na nazwy tabel
  const getTableName = (sectionName: string) => {
    const cleanSection = sectionName.replace('-hero', '');

    // Mapowanie dla stron usług według rzeczywistych nazw tabel w bazie
    const serviceMapping: Record<string, string> = {
      'konferencje': 'konferencje_page_images',
      'streaming': 'streaming_page_images',
      'integracje': 'integracje_page_images',
      'kasyno': 'kasyno_page_images',
      'symulatory-vr': 'symulatory-vr_page_images',
      'naglosnienie': 'naglosnienie_page_images',
      'quizy-teleturnieje': 'quizy-teleturnieje_page_images',
      'technika-sceniczna': 'technika-sceniczna_page_images',
      'wieczory-tematyczne': 'wieczory-tematyczne_page_images',
      'zespol': 'team_page_images',
    };

    return serviceMapping[cleanSection] || `${cleanSection}_page_images`;
  };

  useEffect(() => {
    loadImage();
  }, [section]);

  const loadImage = async () => {
    setLoading(true);

    // Sprawdź czy używamy nowego systemu stron (team_page_images)
    const pageTableName = getTableName(section);

    try {
      // Próbuj pobrać z nowej tabeli stron
      const { data: pageImage, error: pageError } = await supabase
        .from(pageTableName)
        .select('*')
        .eq('section', 'hero')
        .eq('is_active', true)
        .maybeSingle();

      if (!pageError && pageImage) {
        // Konwertuj format z nowej tabeli na format SiteImage
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
          opacity: pageImage.opacity || defaultOpacity,
          created_at: pageImage.created_at,
          updated_at: pageImage.updated_at,
        };
        setSiteImage(convertedImage);
        setEditState({
          posX: convertedImage.image_metadata?.desktop?.position?.posX || 0,
          posY: convertedImage.image_metadata?.desktop?.position?.posY || 0,
          scale: convertedImage.image_metadata?.desktop?.position?.scale || 1,
          opacity: convertedImage.opacity || defaultOpacity,
        });
        setLoading(false);
        return;
      }
    } catch (err) {
      console.log(`Tabela ${pageTableName} nie istnieje, używam starych tabel`);
    }

    // Jeśli nie znaleziono w nowej tabeli, użyj starej
    const image = await getSiteImage(section);
    setSiteImage(image);

    if (image) {
      setEditState({
        posX: image.image_metadata?.desktop?.position?.posX || 0,
        posY: image.image_metadata?.desktop?.position?.posY || 0,
        scale: image.image_metadata?.desktop?.position?.scale || 1,
        opacity: image.opacity || defaultOpacity,
      });
    }
    setLoading(false);
  };

  const handleSavePosition = async () => {
    setSaving(true);
    try {
      const pageTableName = getTableName(section);
      console.log('[PageHeroImage] handleSavePosition - section:', section, 'tableName:', pageTableName);

      // Sprawdź czy używamy nowego systemu
      try {
        const { data: existing, error: checkError } = await supabase
          .from(pageTableName)
          .select('id')
          .eq('section', 'hero')
          .maybeSingle();

        console.log('[PageHeroImage] Check existing:', existing, 'error:', checkError);

        if (existing || section.includes('zespol') || section.includes('team')) {
          // Użyj nowej tabeli
          if (!existing) {
            const { error } = await supabase
              .from(pageTableName)
              .insert({
                section: 'hero',
                name: `Hero ${section}`,
                description: `Hero image for ${section} page`,
                image_url: defaultImage,
                alt_text: section,
                opacity: editState.opacity,
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
            console.log('[PageHeroImage] Updating position for existing record');
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
              .eq('section', 'hero');
            console.log('[PageHeroImage] Update result - error:', error);
            if (error) throw error;
          }

          await loadImage();
          setIsEditingPosition(false);
          setPositionSubMenu(false);
          showSnackbar('Pozycja zapisana pomyślnie', 'success');
          return;
        }
      } catch (err) {
        console.log('Używam starych tabel');
      }

      // Stary system (site_images)
      if (!siteImage) {
        const { data, error } = await supabase
          .from('site_images')
          .insert({
            section,
            name: `Hero ${section}`,
            description: `Hero image for ${section} page`,
            desktop_url: defaultImage,
            alt_text: section,
            opacity: defaultOpacity,
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
      console.error('Error saving position:', error);
      showSnackbar('Błąd podczas zapisywania pozycji', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOpacity = async () => {
    setSaving(true);
    try {
      const pageTableName = getTableName(section);
      console.log('[PageHeroImage] handleSaveOpacity - section:', section, 'tableName:', pageTableName, 'opacity:', editState.opacity);

      // Sprawdź czy używamy nowego systemu
      try {
        const { data: existing, error: checkError } = await supabase
          .from(pageTableName)
          .select('id')
          .eq('section', 'hero')
          .maybeSingle();

        console.log('[PageHeroImage] Check existing (opacity):', existing, 'error:', checkError);

        if (existing || section.includes('zespol') || section.includes('team')) {
          // Użyj nowej tabeli
          if (!existing) {
            const { error } = await supabase
              .from(pageTableName)
              .insert({
                section: 'hero',
                name: `Hero ${section}`,
                description: `Hero image for ${section} page`,
                image_url: defaultImage,
                alt_text: section,
                opacity: editState.opacity,
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
          } else {
            console.log('[PageHeroImage] Updating opacity for existing record');
            const { error } = await supabase
              .from(pageTableName)
              .update({
                opacity: editState.opacity,
              })
              .eq('section', 'hero');
            console.log('[PageHeroImage] Update opacity result - error:', error);
            if (error) throw error;
          }

          await loadImage();
          setIsEditingOpacity(false);
          setOpacitySubMenu(false);
          showSnackbar('Przezroczystość zapisana pomyślnie', 'success');
          return;
        }
      } catch (err) {
        console.log('Używam starych tabel');
      }

      // Stary system (site_images)
      if (!siteImage) {
        const { data, error } = await supabase
          .from('site_images')
          .insert({
            section,
            name: `Hero ${section}`,
            description: `Hero image for ${section} page`,
            desktop_url: defaultImage,
            alt_text: section,
            opacity: editState.opacity,
            image_metadata: {
              desktop: {
                src: defaultImage,
                position: { posX: 0, posY: 0, scale: 1 },
                objectFit: 'cover',
              },
              mobile: {
                src: defaultImage,
                position: { posX: 0, posY: 0, scale: 1 },
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
            opacity: editState.opacity,
          })
          .eq('id', siteImage.id);

        if (error) throw error;
        await loadImage();
      }

      setIsEditingOpacity(false);
      setOpacitySubMenu(false);
      showSnackbar('Przezroczystość zapisana pomyślnie', 'success');
    } catch (error) {
      console.error('Error saving opacity:', error);
      showSnackbar('Błąd podczas zapisywania przezroczystości', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const url = await uploadImage(file, 'hero');
      const pageTableName = getTableName(section);

      // Sprawdź czy używamy nowego systemu
      try {
        const { data: existing } = await supabase
          .from(pageTableName)
          .select('id')
          .eq('section', 'hero')
          .maybeSingle();

        if (existing || section.includes('zespol') || section.includes('team')) {
          // Użyj nowej tabeli
          if (existing) {
            const { error } = await supabase
              .from(pageTableName)
              .update({
                image_url: url,
              })
              .eq('section', 'hero');
            if (error) throw error;
          } else {
            const { error } = await supabase
              .from(pageTableName)
              .insert({
                section: 'hero',
                name: `Hero ${section}`,
                description: `Hero image for ${section} page`,
                image_url: url,
                alt_text: section,
                opacity: defaultOpacity,
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
        console.log('Używam starych tabel');
      }

      // Stary system (site_images)
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
            name: `Hero ${section}`,
            description: `Hero image for ${section} page`,
            desktop_url: url,
            alt_text: section,
            opacity: defaultOpacity,
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
      console.error('Error uploading image:', error);
      showSnackbar('Błąd podczas przesyłania zdjęcia', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleCancelPosition = () => {
    setIsEditingPosition(false);
    setPositionSubMenu(false);
    if (siteImage) {
      setEditState(s => ({
        ...s,
        posX: siteImage.image_metadata?.desktop?.position?.posX || 0,
        posY: siteImage.image_metadata?.desktop?.position?.posY || 0,
        scale: siteImage.image_metadata?.desktop?.position?.scale || 1,
      }));
    }
  };

  const handleCancelOpacity = () => {
    setIsEditingOpacity(false);
    setOpacitySubMenu(false);
    if (siteImage) {
      setEditState(s => ({
        ...s,
        opacity: siteImage.opacity || defaultOpacity,
      }));
    }
  };

  const handleResetPosition = async () => {
    setEditState(s => ({ ...s, posX: 0, posY: 0, scale: 1 }));

    if (siteImage) {
      setSaving(true);
      try {
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
        document.getElementById(`hero-image-upload-${section}`)?.click();
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
      children: 'Ustaw Przezroczystość',
      onClick: () => {
        setIsEditingOpacity(true);
        setOpacitySubMenu(true);
      },
    },
    {
      children: 'Resetuj Pozycję',
      onClick: handleResetPosition,
    },
  ];

  const imageUrl = siteImage?.desktop_url || defaultImage;
  const displayOpacity = isEditingOpacity ? editState.opacity : (siteImage?.opacity || defaultOpacity);
  const displayPosition = isEditingPosition ? editState : (siteImage?.image_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 });

  return (
    <div className={`relative ${className}`}>
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="w-full h-full"
          style={{
            position: 'relative',
            opacity: displayOpacity,
          }}
        >
          <img
            src={imageUrl}
            alt={siteImage?.alt_text || section}
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
        <div className="absolute inset-0 bg-gradient-to-br from-[#1c1f33]/90 to-[#0f1119]/90"></div>
      </div>

      {isEditMode && (
        <>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
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
                  onClick={positionSubMenu ? handleCancelPosition : handleCancelOpacity}
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

      {isEditingOpacity && opacitySubMenu && (
        <div className="absolute inset-0 z-40" style={{ pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto' }}>
            <SliderOpacity
              value={editState.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(_, v) => setEditState(s => ({ ...s, opacity: v as number }))}
              style={{ bottom: 70, top: 'auto' }}
            />
          </div>
        </div>
      )}

      {uploading && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="w-16 h-16 border-4 border-[#d3bb73] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {children}
    </div>
  );
}
