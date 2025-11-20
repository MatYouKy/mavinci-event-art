'use client';

import { useState } from 'react';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase';
import { Upload, X, Save } from 'lucide-react';
import { SliderX, SliderY, SliderScale, SliderOpacity } from './UI/Slider/Slider';

interface ServerSideHeroImageProps {
  section: string;
  pageSlug: string;
  imageUrl: string;
  opacity: number;
  position: {
    posX: number;
    posY: number;
    scale: number;
  };
  children: React.ReactNode;
  onImageUpdate?: () => void;
}

export function ServerSideHeroImage({
  section,
  pageSlug,
  imageUrl: initialImageUrl,
  opacity: initialOpacity,
  position: initialPosition,
  children,
  onImageUpdate,
}: ServerSideHeroImageProps) {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();

  const [imageUrl, setImageUrl] = useState(initialImageUrl);
  const [opacity, setOpacity] = useState(initialOpacity);
  const [position, setPosition] = useState(initialPosition);
  const [uploading, setUploading] = useState(false);
  const [editingImage, setEditingImage] = useState(false);
  const [editingOpacity, setEditingOpacity] = useState(false);

  const getTableName = () => {
    const cleanSection = section.replace('-hero', '');
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
    };
    return serviceMapping[cleanSection] || `${cleanSection}_page_images`;
  };

  const updateMetadataOgImage = async (newImageUrl: string) => {
    try {
      const normalizedSlug = pageSlug.replace(/^\/+/, '').replace(/\/+$/, '');
      const { data: existing } = await supabase
        .from('schema_org_page_metadata')
        .select('id')
        .eq('page_slug', normalizedSlug)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('schema_org_page_metadata')
          .update({
            og_image: newImageUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      }
    } catch (error) {
      console.error('Error updating metadata:', error);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `hero/${fileName}`;

      const { error: uploadError, data } = await supabase.storage
        .from('site-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('site-images')
        .getPublicUrl(filePath);

      const tableName = getTableName();
      await supabase
        .from(tableName)
        .update({
          image_url: publicUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('section', 'hero');

      await updateMetadataOgImage(publicUrl);

      setImageUrl(publicUrl);
      showSnackbar('Obraz zaktualizowany pomyślnie', 'success');

      if (onImageUpdate) {
        setTimeout(() => onImageUpdate(), 500);
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      showSnackbar('Błąd podczas uploadowania obrazu', 'error');
    } finally {
      setUploading(false);
    }
  };

  const savePosition = async () => {
    try {
      const tableName = getTableName();
      await supabase
        .from(tableName)
        .update({
          image_metadata: {
            desktop: {
              position: position,
            },
          },
          updated_at: new Date().toISOString(),
        })
        .eq('section', 'hero');

      setEditingImage(false);
      showSnackbar('Pozycja zapisana pomyślnie', 'success');
    } catch (error) {
      console.error('Error saving position:', error);
      showSnackbar('Błąd podczas zapisywania pozycji', 'error');
    }
  };

  const saveOpacity = async () => {
    try {
      const tableName = getTableName();
      await supabase
        .from(tableName)
        .update({
          opacity,
          updated_at: new Date().toISOString(),
        })
        .eq('section', 'hero');

      setEditingOpacity(false);
      showSnackbar('Przezroczystość zapisana pomyślnie', 'success');
    } catch (error) {
      console.error('Error saving opacity:', error);
      showSnackbar('Błąd podczas zapisywania przezroczystości', 'error');
    }
  };

  return (
    <div className="relative">
      {/* Background Image */}
      <div className="absolute inset-0 overflow-hidden">
        <img
          src={imageUrl}
          alt="Hero background"
          className="h-full w-full object-cover"
          style={{
            transform: `translate(${position.posX}%, ${position.posY}%) scale(${position.scale})`,
            transformOrigin: 'center center',
          }}
        />
        <div
          className="absolute inset-0 bg-[#0f1119]"
          style={{ opacity }}
        />
      </div>

      {/* Edit Controls */}
      {isEditMode && (
        <div className="absolute right-4 top-4 z-50 flex gap-2">
          {/* Upload Image */}
          <label className="cursor-pointer rounded-lg bg-[#1c1f33] px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#1c1f33]/80">
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
              disabled={uploading}
            />
            <Upload className="inline h-4 w-4" />
            {uploading ? ' Uploadowanie...' : ' Zmień obraz'}
          </label>

          {/* Edit Position */}
          <button
            onClick={() => setEditingImage(!editingImage)}
            className="rounded-lg bg-[#1c1f33] px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#1c1f33]/80"
          >
            Pozycja
          </button>

          {/* Edit Opacity */}
          <button
            onClick={() => setEditingOpacity(!editingOpacity)}
            className="rounded-lg bg-[#1c1f33] px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#1c1f33]/80"
          >
            Przezroczystość
          </button>
        </div>
      )}

      {/* Position Edit Panel */}
      {editingImage && (
        <div className="absolute left-4 top-20 z-50 rounded-lg bg-[#1c1f33] p-4 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-medium text-[#d3bb73]">Pozycja obrazu</h3>
            <button onClick={() => setEditingImage(false)} className="text-[#e5e4e2]/50 hover:text-[#e5e4e2]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-4">
            <SliderX value={position.posX} onChange={(val) => setPosition({ ...position, posX: val })} />
            <SliderY value={position.posY} onChange={(val) => setPosition({ ...position, posY: val })} />
            <SliderScale value={position.scale} onChange={(val) => setPosition({ ...position, scale: val })} />
            <button
              onClick={savePosition}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              <Save className="h-4 w-4" />
              Zapisz
            </button>
          </div>
        </div>
      )}

      {/* Opacity Edit Panel */}
      {editingOpacity && (
        <div className="absolute left-4 top-20 z-50 rounded-lg bg-[#1c1f33] p-4 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-medium text-[#d3bb73]">Przezroczystość</h3>
            <button onClick={() => setEditingOpacity(false)} className="text-[#e5e4e2]/50 hover:text-[#e5e4e2]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-4">
            <SliderOpacity value={opacity} onChange={setOpacity} />
            <button
              onClick={saveOpacity}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              <Save className="h-4 w-4" />
              Zapisz
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="relative">{children}</div>
    </div>
  );
}
