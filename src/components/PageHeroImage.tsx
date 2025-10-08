'use client';

import { useState, useEffect } from 'react';
import { useEditMode } from '@/contexts/EditModeContext';
import { getSiteImage } from '@/lib/siteImages';
import type { SiteImage } from '@/lib/siteImages';
import { SliderX, SliderY, SliderScale, SliderOpacity } from './UI/Slider/Slider';
import { Edit, Save, X, Upload } from 'lucide-react';
import { uploadImage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';

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
  const [siteImage, setSiteImage] = useState<SiteImage | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  const [editState, setEditState] = useState({
    posX: 0,
    posY: 0,
    scale: 1,
    opacity: defaultOpacity,
  });

  useEffect(() => {
    loadImage();
  }, [section]);

  const loadImage = async () => {
    setLoading(true);
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

  const handleSave = async () => {
    try {
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
            opacity: editState.opacity,
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
              },
            },
          })
          .eq('id', siteImage.id);

        if (error) throw error;
        await loadImage();
      }

      setIsEditing(false);
    } catch (error) {
      console.error('Error saving hero image:', error);
      alert('Błąd podczas zapisywania');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const url = await uploadImage(file, 'hero');

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
            },
          })
          .eq('id', siteImage.id);

        if (error) throw error;
      }

      await loadImage();
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Błąd podczas przesyłania zdjęcia');
    }
  };

  const imageUrl = siteImage?.desktop_url || defaultImage;
  const opacity = isEditing ? editState.opacity : (siteImage?.opacity || defaultOpacity);
  const position = isEditing ? editState : (siteImage?.image_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 });

  return (
    <div className={`relative ${className}`}>
      <div className="absolute inset-0">
        <img
          src={imageUrl}
          alt={siteImage?.alt_text || section}
          className="w-full h-full object-cover"
          style={{
            opacity,
            transform: `translate(${position.posX}%, ${position.posY}%) scale(${position.scale})`,
            transformOrigin: 'center',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#1c1f33]/90 to-[#0f1119]/90"></div>
      </div>

      {isEditMode && (
        <div className="absolute top-4 right-4 z-50 flex gap-2">
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="p-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors shadow-lg"
            >
              <Edit className="w-5 h-5" />
            </button>
          ) : (
            <>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                id="hero-image-upload"
              />
              <label
                htmlFor="hero-image-upload"
                className="p-3 bg-[#800020] text-[#e5e4e2] rounded-lg hover:bg-[#800020]/90 transition-colors cursor-pointer shadow-lg"
              >
                <Upload className="w-5 h-5" />
              </label>
              <button
                onClick={handleSave}
                className="p-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors shadow-lg"
              >
                <Save className="w-5 h-5" />
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  if (siteImage) {
                    setEditState({
                      posX: siteImage.image_metadata?.desktop?.position?.posX || 0,
                      posY: siteImage.image_metadata?.desktop?.position?.posY || 0,
                      scale: siteImage.image_metadata?.desktop?.position?.scale || 1,
                      opacity: siteImage.opacity || defaultOpacity,
                    });
                  }
                }}
                className="p-3 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors shadow-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      )}

      {isEditing && (
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
            <SliderOpacity
              value={editState.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(_, v) => setEditState(s => ({ ...s, opacity: v as number }))}
            />
          </div>
        </div>
      )}

      {children}
    </div>
  );
}
