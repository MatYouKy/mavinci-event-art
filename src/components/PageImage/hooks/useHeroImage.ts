'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getSiteImage } from '@/lib/siteImages';
import type { SiteImage } from '@/lib/siteImages';
import { uploadImage } from '@/lib/storage';
import { useSnackbar } from '@/contexts/SnackbarContext';

export interface HeroPosition {
  posX: number;
  posY: number;
  scale: number;
}

export interface UseHeroImageOptions {
  defaultImage?: string;
  defaultOpacity?: number;
}

interface UseHeroImageReturn {
  loading: boolean;
  saving: boolean;
  uploading: boolean;
  siteImage: SiteImage | null;
  imageUrl: string;
  opacity: number;
  position: HeroPosition;

  // lokalne zmiany
  setPosition: (position: HeroPosition) => void;
  setOpacity: (opacity: number) => void;

  // operacje na bazie
  reload: () => Promise<void>;
  savePosition: () => Promise<void>;
  saveOpacity: () => Promise<void>;
  uploadHeroImage: (file: File) => Promise<void>;
  resetPosition: () => Promise<void>;
  deleteHeroImage: () => Promise<void>;
}

export function useHeroImage(
  section: string,
  {
    defaultImage = 'https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/hero/1760341625716-d0b65e.jpg',
    defaultOpacity = 0.2,
  }: UseHeroImageOptions = {}
): UseHeroImageReturn {
  const { showSnackbar } = useSnackbar();

  const [siteImage, setSiteImage] = useState<SiteImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [position, setPosition] = useState<HeroPosition>({
    posX: 0,
    posY: 0,
    scale: 1,
  });

  const [opacity, setOpacity] = useState<number>(defaultOpacity);

  // mapowanie sekcji -> tabela
  const getTableName = useCallback((sectionName: string) => {
    const cleanSection = sectionName.replace('-hero', '');

    const serviceMapping: Record<string, string> = {
      konferencje: 'konferencje_page_images',
      streaming: 'streaming_page_images',
      integracje: 'integracje_page_images',
      kasyno: 'kasyno_page_images',
      'symulatory-vr': 'symulatory-vr_page_images',
      naglosnienie: 'naglosnienie_page_images',
      'quizy-teleturnieje': 'quizy-teleturnieje_page_images',
      'technika-sceniczna': 'technika-sceniczna_page_images',
      'wieczory-tematyczne': 'wieczory-tematyczne_page_images',
      zespol: 'team_page_images',
    };

    return serviceMapping[cleanSection] || `${cleanSection}_page_images`;
  }, []);

  const loadImage = useCallback(async () => {
    setLoading(true);
    const pageTableName = getTableName(section);

    try {
      // nowy system: *_page_images
      const { data: pageImage, error: pageError } = await supabase
        .from(pageTableName)
        .select('*')
        .eq('section', 'hero')
        .eq('is_active', true)
        .maybeSingle();

      if (!pageError && pageImage) {
        const converted: SiteImage = {
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

        setSiteImage(converted);
        setPosition({
          posX: converted.image_metadata?.desktop?.position?.posX ?? 0,
          posY: converted.image_metadata?.desktop?.position?.posY ?? 0,
          scale: converted.image_metadata?.desktop?.position?.scale ?? 1,
        });
        setOpacity(converted.opacity ?? defaultOpacity);
        setLoading(false);
        return;
      }
    } catch (err) {
      console.log(`Tabela ${pageTableName} nie istnieje, używam starych tabel`);
    }

    // stary system: site_images
    const image = await getSiteImage(section);
    setSiteImage(image);

    if (image) {
      setPosition({
        posX: image.image_metadata?.desktop?.position?.posX ?? 0,
        posY: image.image_metadata?.desktop?.position?.posY ?? 0,
        scale: image.image_metadata?.desktop?.position?.scale ?? 1,
      });
      setOpacity(image.opacity ?? defaultOpacity);
    } else {
      // brak rekordu – zostanie default
      setPosition({ posX: 0, posY: 0, scale: 1 });
      setOpacity(defaultOpacity);
    }

    setLoading(false);
  }, [section, getTableName, defaultOpacity]);

  useEffect(() => {
    loadImage();
  }, [loadImage]);

  const savePosition = useCallback(async () => {
    setSaving(true);
    const pageTableName = getTableName(section);

    try {
      // próba: nowy system
      try {
        const { data: existing } = await supabase
          .from(pageTableName)
          .select('id')
          .eq('section', 'hero')
          .maybeSingle();

        if (existing || section.includes('zespol') || section.includes('team')) {
          if (!existing) {
            const { error } = await supabase.from(pageTableName).insert({
              section: 'hero',
              name: `Hero ${section}`,
              description: `Hero image for ${section} page`,
              image_url: siteImage?.desktop_url || defaultImage,
              alt_text: section,
              opacity,
              image_metadata: {
                desktop: {
                  position,
                  objectFit: 'cover',
                },
                mobile: {
                  position,
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
                    position,
                    objectFit: 'cover',
                  },
                  mobile: {
                    position,
                    objectFit: 'cover',
                  },
                },
              })
              .eq('section', 'hero');
            if (error) throw error;
          }

          await loadImage();
          showSnackbar('Pozycja zapisana pomyślnie', 'success');
          return;
        }
      } catch {
        console.log('Używam starych tabel (savePosition)');
      }

      // stary system
      if (!siteImage) {
        const { data, error } = await supabase
          .from('site_images')
          .insert({
            section,
            name: `Hero ${section}`,
            description: `Hero image for ${section} page`,
            desktop_url: defaultImage,
            alt_text: section,
            opacity,
            image_metadata: {
              desktop: {
                src: defaultImage,
                position,
                objectFit: 'cover',
              },
              mobile: {
                src: defaultImage,
                position,
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
                position,
                objectFit: siteImage.image_metadata?.desktop?.objectFit || 'cover',
              },
              mobile: {
                ...siteImage.image_metadata?.mobile,
                src: siteImage.mobile_url || siteImage.desktop_url,
                position,
                objectFit: siteImage.image_metadata?.mobile?.objectFit || 'cover',
              },
            },
          })
          .eq('id', siteImage.id);

        if (error) throw error;
        await loadImage();
      }

      showSnackbar('Pozycja zapisana pomyślnie', 'success');
    } catch (error) {
      console.error('Error saving position:', error);
      showSnackbar('Błąd podczas zapisywania pozycji', 'error');
    } finally {
      setSaving(false);
    }
  }, [section, siteImage, position, opacity, defaultImage, getTableName, loadImage, showSnackbar]);

  const saveOpacity = useCallback(async () => {
    setSaving(true);
    const pageTableName = getTableName(section);

    try {
      // nowy system
      try {
        const { data: existing } = await supabase
          .from(pageTableName)
          .select('id')
          .eq('section', 'hero')
          .maybeSingle();

        if (existing || section.includes('zespol') || section.includes('team')) {
          if (!existing) {
            const { error } = await supabase.from(pageTableName).insert({
              section: 'hero',
              name: `Hero ${section}`,
              description: `Hero image for ${section} page`,
              image_url: siteImage?.desktop_url || defaultImage,
              alt_text: section,
              opacity,
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
            const { error } = await supabase
              .from(pageTableName)
              .update({
                opacity,
              })
              .eq('section', 'hero');
            if (error) throw error;
          }

          await loadImage();
          showSnackbar('Przezroczystość zapisana pomyślnie', 'success');
          return;
        }
      } catch {
        console.log('Używam starych tabel (saveOpacity)');
      }

      // stary system
      if (!siteImage) {
        const { data, error } = await supabase
          .from('site_images')
          .insert({
            section,
            name: `Hero ${section}`,
            description: `Hero image for ${section} page`,
            desktop_url: defaultImage,
            alt_text: section,
            opacity,
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
          .update({ opacity })
          .eq('id', siteImage.id);

        if (error) throw error;
        await loadImage();
      }

      showSnackbar('Przezroczystość zapisana pomyślnie', 'success');
    } catch (error) {
      console.error('Error saving opacity:', error);
      showSnackbar('Błąd podczas zapisywania przezroczystości', 'error');
    } finally {
      setSaving(false);
    }
  }, [section, siteImage, opacity, defaultImage, getTableName, loadImage, showSnackbar]);

  const uploadHeroImage = useCallback(
    async (file: File) => {
      setUploading(true);
      const pageTableName = getTableName(section);

      try {
        const url = await uploadImage(file, 'hero');

        // nowy system
        try {
          const { data: existing } = await supabase
            .from(pageTableName)
            .select('id')
            .eq('section', 'hero')
            .maybeSingle();

          if (existing || section.includes('zespol') || section.includes('team')) {
            if (existing) {
              const { error } = await supabase
                .from(pageTableName)
                .update({ image_url: url })
                .eq('section', 'hero');
              if (error) throw error;
            } else {
              const { error } = await supabase.from(pageTableName).insert({
                section: 'hero',
                name: `Hero ${section}`,
                description: `Hero image for ${section} page`,
                image_url: url,
                alt_text: section,
                opacity,
                image_metadata: {
                  desktop: {
                    position,
                    objectFit: 'cover',
                  },
                  mobile: {
                    position,
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
        } catch {
          console.log('Używam starych tabel (uploadHeroImage)');
        }

        // stary system
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
              opacity,
              image_metadata: {
                desktop: {
                  src: url,
                  position,
                  objectFit: 'cover',
                },
                mobile: {
                  src: url,
                  position,
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
    },
    [section, siteImage, position, opacity, getTableName, loadImage, showSnackbar]
  );

  const resetPosition = useCallback(async () => {
    setPosition({ posX: 0, posY: 0, scale: 1 });

    if (!siteImage) return;

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
  }, [siteImage, loadImage, showSnackbar]);

  const deleteHeroImage = useCallback(async () => {
    if (!siteImage) return;

    setSaving(true);
    try {
      const pageTableName = getTableName(section);

      // spróbuj dezaktywować w nowej tabeli
      try {
        const { data: existing } = await supabase
          .from(pageTableName)
          .select('id')
          .eq('section', 'hero')
          .maybeSingle();

        if (existing) {
          const { error } = await supabase
            .from(pageTableName)
            .update({ is_active: false })
            .eq('section', 'hero');

          if (error) throw error;
          await loadImage();
          showSnackbar('Hero ukryty (is_active = false)', 'success');
          return;
        }
      } catch {
        console.log('Używam starych tabel (deleteHeroImage)');
      }

      // stary system – np. soft delete przez is_active lub delete
      const { error } = await supabase
        .from('site_images')
        .update({ is_active: false })
        .eq('id', siteImage.id);

      if (error) throw error;

      setSiteImage(null);
      showSnackbar('Hero ukryty (is_active = false)', 'success');
    } catch (error) {
      console.error('Error deleting hero:', error);
      showSnackbar('Błąd podczas usuwania hero', 'error');
    } finally {
      setSaving(false);
    }
  }, [siteImage, section, getTableName, loadImage, showSnackbar]);

  const imageUrl = siteImage?.desktop_url || defaultImage;

  return {
    loading,
    saving,
    uploading,
    siteImage,
    imageUrl,
    opacity,
    position,
    setPosition,
    setOpacity,
    reload: loadImage,
    savePosition,
    saveOpacity,
    uploadHeroImage,
    resetPosition,
    deleteHeroImage,
  };
}