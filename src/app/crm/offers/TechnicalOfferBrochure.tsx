'use client';

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Edit2, Save, X, Eye, Download, Phone, Mail, MapPin, Music, Lightbulb, Tv, Sparkles, Radio, Gauge, Users, Award, Upload, Plus, Trash2, Image as ImageIcon } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { uploadImage } from '@/lib/storage';

interface BrochureContent {
  id: string;
  section: string;
  content_key: string;
  content_value: string;
  content_type: string;
  order_index: number;
  is_visible: boolean;
  metadata: any;
}

interface BrochureImage {
  id: string;
  section: string;
  image_url: string;
  alt_text: string;
  position_x: number;
  position_y: number;
  object_fit: string;
  order_index: number;
  is_visible: boolean;
}

interface TechnicalOfferBrochureProps {
  editMode?: boolean;
  showControls?: boolean;
}

const TechnicalOfferBrochure = ({ editMode: externalEditMode = false, showControls = true }: TechnicalOfferBrochureProps) => {
  const [editMode, setEditMode] = useState(externalEditMode);
  const [content, setContent] = useState<Record<string, BrochureContent>>({});
  const [images, setImages] = useState<BrochureImage[]>([]);
  const [editingContent, setEditingContent] = useState<string | null>(null);
  const [editingImage, setEditingImage] = useState<BrochureImage | null>(null);
  const [showImageManager, setShowImageManager] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showSnackbar } = useSnackbar();
  const { employee } = useCurrentEmployee();

  useEffect(() => {
    const styleId = 'brochure-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @media print {
          * {
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
          }

          body {
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #0f1119 !important;
          }

          .page-break {
            page-break-after: always !important;
            break-after: page !important;
            page-break-inside: avoid !important;
          }

          .no-print {
            display: none !important;
          }

          .brochure-page {
            width: 210mm !important;
            height: 297mm !important;
            min-height: 297mm !important;
            max-height: 297mm !important;
            margin: 0 !important;
            padding: 15mm !important;
            box-sizing: border-box !important;
            background: #0f1119 !important;
            position: relative !important;
            overflow: hidden !important;
            page-break-inside: avoid !important;
          }

          .brochure-page::before,
          .brochure-page::after,
          .decorative-shape {
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
          }
        }

        @page {
          size: A4;
          margin: 0;
        }

        .brochure-page {
          width: 210mm;
          height: 297mm;
          min-height: 297mm;
          max-height: 297mm;
          margin: 0 auto;
          padding: 15mm;
          box-sizing: border-box;
          background: #0f1119;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .brochure-content-wrapper {
          position: relative;
          z-index: 10;
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .decorative-shape {
          position: absolute;
          pointer-events: none;
        }

        .shape-1 {
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, rgba(211, 187, 115, 0.1) 0%, transparent 70%);
          top: -150px;
          right: -150px;
          border-radius: 50%;
        }

        .shape-2 {
          width: 400px;
          height: 400px;
          background-image:
            linear-gradient(rgba(211, 187, 115, 0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(211, 187, 115, 0.08) 1px, transparent 1px);
          background-size: 40px 40px;
          bottom: -100px;
          left: -100px;
          opacity: 0.5;
          transform: rotate(15deg);
        }

        .shape-3 {
          width: 300px;
          height: 300px;
          background-image:
            radial-gradient(circle, transparent 40%, rgba(211, 187, 115, 0.1) 40%, rgba(211, 187, 115, 0.1) 41%, transparent 41%),
            radial-gradient(circle, transparent 60%, rgba(211, 187, 115, 0.08) 60%, rgba(211, 187, 115, 0.08) 61%, transparent 61%),
            radial-gradient(circle, transparent 80%, rgba(211, 187, 115, 0.06) 80%, rgba(211, 187, 115, 0.06) 81%, transparent 81%);
          top: 30%;
          right: 5%;
          opacity: 0.7;
        }

        .shape-4 {
          width: 350px;
          height: 350px;
          background-image:
            repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(211, 187, 115, 0.06) 40px, rgba(211, 187, 115, 0.06) 42px),
            repeating-linear-gradient(60deg, transparent, transparent 40px, rgba(211, 187, 115, 0.06) 40px, rgba(211, 187, 115, 0.06) 42px),
            repeating-linear-gradient(120deg, transparent, transparent 40px, rgba(211, 187, 115, 0.06) 40px, rgba(211, 187, 115, 0.06) 42px);
          bottom: 20%;
          left: 10%;
          opacity: 0.6;
          transform: rotate(-20deg);
        }

        .shape-5 {
          width: 250px;
          height: 250px;
          background-image:
            radial-gradient(circle, rgba(211, 187, 115, 0.2) 2px, transparent 2px);
          background-size: 25px 25px;
          top: 50%;
          left: -80px;
          opacity: 0.5;
          transform: rotate(30deg);
        }

        .shape-6 {
          width: 300px;
          height: 300px;
          background-image:
            radial-gradient(circle, rgba(211, 187, 115, 0.12) 3px, transparent 3px);
          background-size: 50px 50px;
          bottom: 10%;
          right: 10%;
          opacity: 0.6;
        }
      `;
      document.head.appendChild(style);
    }

    fetchContent();
    fetchImages();

    return () => {
      const existingStyle = document.getElementById(styleId);
      if (existingStyle) {
        existingStyle.remove();
      }
    };
  }, []);

  const fetchContent = async () => {
    const { data, error } = await supabase
      .from('technical_brochure_content')
      .select('*')
      .eq('is_visible', true)
      .order('order_index');

    if (!error && data) {
      const contentMap: Record<string, BrochureContent> = {};
      data.forEach((item) => {
        contentMap[item.content_key] = item;
      });
      setContent(contentMap);
    }
  };

  const fetchImages = async () => {
    const { data, error } = await supabase
      .from('technical_brochure_images')
      .select('*')
      .eq('is_visible', true)
      .order('order_index');

    if (!error && data) {
      setImages(data);
    }
  };

  const updateContent = async (key: string, value: string) => {
    const { error } = await supabase
      .from('technical_brochure_content')
      .update({ content_value: value, updated_at: new Date().toISOString() })
      .eq('content_key', key);

    if (error) {
      showSnackbar('Błąd zapisu treści', 'error');
    } else {
      showSnackbar('Zapisano treść', 'success');
      fetchContent();
      setEditingContent(null);
    }
  };

  const updateImage = async (image: BrochureImage) => {
    const { error } = await supabase
      .from('technical_brochure_images')
      .update({
        image_url: image.image_url,
        alt_text: image.alt_text,
        position_x: image.position_x,
        position_y: image.position_y,
        object_fit: image.object_fit,
        updated_at: new Date().toISOString()
      })
      .eq('id', image.id);

    if (error) {
      showSnackbar('Błąd zapisu obrazu', 'error');
    } else {
      showSnackbar('Zapisano obraz', 'success');
      fetchImages();
      setEditingImage(null);
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>, section: string) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    try {
      const imageUrl = await uploadImage(file, 'technical-brochure');

      const maxOrder = images
        .filter(img => img.section === section)
        .reduce((max, img) => Math.max(max, img.order_index), 0);

      const { error } = await supabase
        .from('technical_brochure_images')
        .insert({
          section,
          image_url: imageUrl,
          alt_text: file.name,
          position_x: 50,
          position_y: 50,
          object_fit: 'cover',
          order_index: maxOrder + 1,
          is_visible: true
        });

      if (error) throw error;

      showSnackbar('Dodano obraz', 'success');
      fetchImages();
    } catch (error) {
      console.error('Upload error:', error);
      showSnackbar('Błąd podczas uploadu obrazu', 'error');
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const deleteImage = async (imageId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten obraz?')) return;

    const { error } = await supabase
      .from('technical_brochure_images')
      .delete()
      .eq('id', imageId);

    if (error) {
      showSnackbar('Błąd usuwania obrazu', 'error');
    } else {
      showSnackbar('Usunięto obraz', 'success');
      fetchImages();
    }
  };

  const handleDownloadPDF = () => {
    const printContent = document.getElementById('brochure-content');
    const originalContent = document.body.innerHTML;

    if (printContent) {
      document.body.innerHTML = printContent.innerHTML;
      window.print();
      document.body.innerHTML = originalContent;
      window.location.reload();
    }
  };

  const getContentValue = (key: string, fallback: string = '') => {
    return content[key]?.content_value || fallback;
  };

  const getEmployeePhone = () => {
    return employee?.phone || getContentValue('phone', '+48 123 456 789');
  };

  const getEmployeeEmail = () => {
    return employee?.email || getContentValue('email', 'kontakt@mavinci.pl');
  };

  const getImageBySection = (section: string, index: number = 0): BrochureImage | null => {
    const sectionImages = images.filter(img => img.section === section);
    return sectionImages[index] || null;
  };

  const renderEditableText = (key: string, defaultValue: string, className: string, multiline: boolean = false) => {
    const isEditing = editingContent === key;
    const value = getContentValue(key, defaultValue);

    if (!editMode) {
      return <span className={className}>{value}</span>;
    }

    if (isEditing) {
      return (
        <div className="flex items-center gap-2">
          {multiline ? (
            <textarea
              value={value}
              onChange={(e) => setContent({ ...content, [key]: { ...content[key], content_value: e.target.value } })}
              className="flex-1 bg-[#0a0d1a] border border-[#d3bb73]/30 rounded px-3 py-2 text-[#e5e4e2]"
              rows={3}
            />
          ) : (
            <input
              type="text"
              value={value}
              onChange={(e) => setContent({ ...content, [key]: { ...content[key], content_value: e.target.value } })}
              className="flex-1 bg-[#0a0d1a] border border-[#d3bb73]/30 rounded px-3 py-2 text-[#e5e4e2]"
            />
          )}
          <button
            onClick={() => updateContent(key, value)}
            className="p-2 bg-green-500/20 text-green-400 rounded hover:bg-green-500/30"
          >
            <Save className="w-5 h-5" />
          </button>
          <button
            onClick={() => {
              setEditingContent(null);
              fetchContent();
            }}
            className="p-2 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      );
    }

    return (
      <span
        onClick={() => setEditingContent(key)}
        className={`${className} ${editMode ? 'cursor-pointer hover:bg-[#d3bb73]/10 px-2 py-1 rounded transition-colors' : ''}`}
      >
        {value}
      </span>
    );
  };

  const renderEditableImage = (section: string, index: number = 0, className: string, alt: string) => {
    const image = getImageBySection(section, index);

    if (!image) {
      if (!editMode) {
        return <div className={`${className} bg-[#1c1f33]/50 flex items-center justify-center text-[#e5e4e2]/40`}>Brak obrazu</div>;
      }

      return (
        <div className={`${className} bg-[#1c1f33]/50 flex flex-col items-center justify-center text-[#e5e4e2]/40 gap-3 border-2 border-dashed border-[#d3bb73]/30`}>
          <ImageIcon className="w-12 h-12 text-[#d3bb73]/40" />
          <p className="text-sm">Brak obrazu</p>
          <label className="cursor-pointer px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm font-medium">
            <Upload className="w-4 h-4 inline mr-2" />
            Dodaj obraz
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleImageUpload(e, section)}
              disabled={uploadingImage}
            />
          </label>
        </div>
      );
    }

    if (editMode && editingImage?.id === image.id) {
      return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setEditingImage(null)} />

          <div className="relative bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-light text-[#e5e4e2]">Edytuj obraz</h3>
              <button
                onClick={() => setEditingImage(null)}
                className="p-2 hover:bg-[#252842] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[#e5e4e2]" />
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Podgląd:</label>
                <div className="relative bg-[#0f1119] border-2 border-[#d3bb73]/20 rounded-lg overflow-hidden aspect-video">
                  <img
                    src={image.image_url}
                    alt={image.alt_text}
                    className="w-full h-full"
                    style={{
                      objectFit: image.object_fit as any,
                      objectPosition: `${image.position_x}% ${image.position_y}%`
                    }}
                  />
                </div>

                <div className="mt-4 p-3 bg-[#252842] rounded-lg">
                  <p className="text-xs text-[#e5e4e2]/60 mb-2">Aktualne wartości:</p>
                  <div className="text-xs text-[#e5e4e2] space-y-1">
                    <div>X: <span className="text-[#d3bb73]">{image.position_x}%</span></div>
                    <div>Y: <span className="text-[#d3bb73]">{image.position_y}%</span></div>
                    <div>Dopasowanie: <span className="text-[#d3bb73]">{image.object_fit}</span></div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">URL obrazu:</label>
                  <input
                    type="text"
                    value={image.image_url}
                    onChange={(e) => setEditingImage({ ...image, image_url: e.target.value })}
                    className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Alt text:</label>
                  <input
                    type="text"
                    value={image.alt_text}
                    onChange={(e) => setEditingImage({ ...image, alt_text: e.target.value })}
                    className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                    Pozycja X: {image.position_x}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={image.position_x}
                    onChange={(e) => setEditingImage({ ...image, position_x: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                    Pozycja Y: {image.position_y}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={image.position_y}
                    onChange={(e) => setEditingImage({ ...image, position_y: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Dopasowanie:</label>
                  <select
                    value={image.object_fit}
                    onChange={(e) => setEditingImage({ ...image, object_fit: e.target.value })}
                    className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
                  >
                    <option value="cover">Wypełnij (Cover)</option>
                    <option value="contain">Zmieść (Contain)</option>
                    <option value="fill">Rozciągnij (Fill)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Lub wgraj nowy obraz:</label>
                  <label className="cursor-pointer flex items-center justify-center gap-2 w-full px-4 py-3 bg-[#252842] border-2 border-dashed border-[#d3bb73]/30 rounded-lg hover:bg-[#2a2f4a] transition-colors">
                    <Upload className="w-5 h-5 text-[#d3bb73]" />
                    <span className="text-[#e5e4e2]">Wybierz plik</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        setUploadingImage(true);
                        try {
                          const imageUrl = await uploadImage(file, 'technical-brochure');
                          setEditingImage({ ...image, image_url: imageUrl });
                          showSnackbar('Wgrano nowy obraz', 'success');
                        } catch (error) {
                          showSnackbar('Błąd podczas uploadu', 'error');
                        } finally {
                          setUploadingImage(false);
                        }
                      }}
                      disabled={uploadingImage}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-end mt-6 pt-6 border-t border-[#d3bb73]/10">
              <button
                onClick={() => setEditingImage(null)}
                className="px-6 py-2 bg-[#252842] text-[#e5e4e2] rounded-lg hover:bg-[#2a2f4a] transition-colors"
              >
                Anuluj
              </button>
              <button
                onClick={() => updateImage(editingImage)}
                className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors font-medium"
              >
                Zapisz zmiany
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="relative group">
        <img
          src={image.image_url}
          alt={image.alt_text || alt}
          className={className}
          style={{
            objectFit: image.object_fit as any,
            objectPosition: `${image.position_x}% ${image.position_y}%`
          }}
        />
        {editMode && (
          <button
            onClick={() => setEditingImage(image)}
            className="absolute top-2 right-2 p-2 bg-[#d3bb73]/90 text-[#1c1f33] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-20"
          >
            <Edit2 className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="bg-[#0f1119]">
      {/* Floating Controls */}
      {showControls && (
        <div className="no-print fixed top-8 right-8 z-50 flex items-center gap-3">
          <button
            onClick={() => setEditMode(!editMode)}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-2xl transition-all duration-300 hover:scale-105 ${
              editMode
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'bg-[#d3bb73]/20 text-[#d3bb73] hover:bg-[#d3bb73]/30'
            }`}
          >
            {editMode ? <X className="w-5 h-5" /> : <Edit2 className="w-5 h-5" />}
            <span className="font-semibold">{editMode ? 'Zakończ edycję' : 'Tryb edycji'}</span>
          </button>

          {editMode && (
            <button
              onClick={() => setShowImageManager(!showImageManager)}
              className="flex items-center gap-2 px-4 py-3 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded-xl shadow-2xl transition-all duration-300 hover:scale-105"
            >
              <ImageIcon className="w-5 h-5" />
              <span className="font-semibold">Zarządzaj obrazami</span>
            </button>
          )}

          <button
            onClick={handleDownloadPDF}
            className="group flex items-center gap-3 bg-gradient-to-r from-[#d3bb73] to-[#c1a85f] hover:from-[#c1a85f] hover:to-[#d3bb73] text-[#1c1f33] font-bold px-6 py-4 rounded-xl shadow-2xl transition-all duration-300 hover:scale-105 hover:shadow-[#d3bb73]/50"
          >
            <Download className="w-6 h-6 group-hover:animate-bounce" />
            <span>Pobierz PDF</span>
          </button>
        </div>
      )}

      {/* Image Manager Modal */}
      {showImageManager && editMode && (
        <div className="no-print fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowImageManager(false)} />

          <div className="relative bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-light text-[#e5e4e2]">Zarządzanie obrazami broszury</h3>
              <button
                onClick={() => setShowImageManager(false)}
                className="p-2 hover:bg-[#252842] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[#e5e4e2]" />
              </button>
            </div>

            <div className="space-y-8">
              {['hero', 'portfolio', 'contact'].map((section) => {
                const sectionImages = images.filter(img => img.section === section);
                const sectionNames: Record<string, string> = {
                  hero: 'Hero (strona 2)',
                  portfolio: 'Portfolio (strony 5-6)',
                  contact: 'Kontakt (strona 8)'
                };

                return (
                  <div key={section} className="border border-[#d3bb73]/20 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xl font-semibold text-[#e5e4e2]">{sectionNames[section]}</h4>
                      <label className="cursor-pointer px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm font-medium">
                        <Plus className="w-4 h-4 inline mr-2" />
                        Dodaj obraz
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleImageUpload(e, section)}
                          disabled={uploadingImage}
                        />
                      </label>
                    </div>

                    {sectionImages.length === 0 ? (
                      <p className="text-[#e5e4e2]/40 text-center py-8">Brak obrazów w tej sekcji</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-4">
                        {sectionImages.map((img) => (
                          <div key={img.id} className="relative group bg-[#252842] rounded-lg overflow-hidden">
                            <img
                              src={img.image_url}
                              alt={img.alt_text}
                              className="w-full h-48 object-cover"
                              style={{
                                objectPosition: `${img.position_x}% ${img.position_y}%`
                              }}
                            />
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                              <button
                                onClick={() => {
                                  setEditingImage(img);
                                  setShowImageManager(false);
                                }}
                                className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => deleteImage(img.id)}
                                className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="p-2 bg-[#1c1f33]/90">
                              <p className="text-xs text-[#e5e4e2]/60 truncate">{img.alt_text}</p>
                              <p className="text-xs text-[#d3bb73]">Kolejność: {img.order_index}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end mt-6 pt-6 border-t border-[#d3bb73]/10">
              <button
                onClick={() => setShowImageManager(false)}
                className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors font-medium"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Brochure Content */}
      <div id="brochure-content" className="min-h-screen">
        {/* Page 1: Cover */}
        <div className="brochure-page page-break">
          <div className="decorative-shape shape-1"></div>
          <div className="decorative-shape shape-2"></div>
          <div className="brochure-content-wrapper items-center justify-center text-center">
            <div className="space-y-12">
              <div className="space-y-6">
                <h1 className="text-8xl font-black tracking-tight leading-tight">
                  {renderEditableText('title', 'Technika Estradowa', 'text-8xl font-black tracking-tight leading-tight bg-gradient-to-r from-[#d3bb73] via-[#e5d5a0] to-[#d3bb73] bg-clip-text text-transparent', false)}
                </h1>
                <div className="h-1 w-64 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
                <h2 className="text-5xl font-light tracking-[0.3em] uppercase">
                  {renderEditableText('subtitle', 'Premium', 'text-5xl font-light tracking-[0.3em] uppercase text-[#e5e4e2]', false)}
                </h2>
              </div>
              <p className="text-2xl text-[#e5e4e2]/90 max-w-3xl mx-auto leading-relaxed font-light">
                {renderEditableText('description', 'Twórz niezapomniane wydarzenia z najlepszym sprzętem scenicznym i profesjonalną obsługą techniczną', 'text-2xl text-[#e5e4e2]/90 max-w-3xl mx-auto leading-relaxed font-light', true)}
              </p>
              <div className="pt-12">
                <div className="inline-block bg-gradient-to-r from-[#d3bb73] to-[#c1a85f] px-12 py-6 rounded-2xl">
                  <p className="text-[#1c1f33] text-2xl font-bold">www.mavinci.pl</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Page 2: Hero Image Full */}
        <div className="brochure-page page-break">
          <div className="decorative-shape shape-3"></div>
          <div className="brochure-content-wrapper">
            <div className="relative h-full rounded-3xl overflow-hidden shadow-2xl">
              {renderEditableImage('hero', 0, 'absolute inset-0 w-full h-full', 'Stage with professional lighting')}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
              <div className="absolute bottom-12 left-12 right-12 z-10">
                <h2 className="text-5xl font-bold text-[#d3bb73] mb-4">
                  {renderEditableText('hero_title', 'Profesjonalizm w każdym detalu', 'text-5xl font-bold text-[#d3bb73]', false)}
                </h2>
                <p className="text-2xl text-[#e5e4e2]/90 leading-relaxed max-w-3xl">
                  {renderEditableText('hero_desc', 'Kompleksowa obsługa techniczna eventów - od koncepcji po realizację. Najnowocześniejszy sprzęt i doświadczony zespół specjalistów.', 'text-2xl text-[#e5e4e2]/90 leading-relaxed', true)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Page 3: Services Part 1 */}
        <div className="brochure-page page-break">
          <div className="decorative-shape shape-4"></div>
          <div className="decorative-shape shape-5"></div>
          <div className="brochure-content-wrapper">
            <h2 className="text-6xl font-bold text-[#d3bb73] mb-12 text-center">
              {renderEditableText('services_title', 'Nasze Usługi', 'text-6xl font-bold text-[#d3bb73]', false)}
            </h2>
            <div className="grid grid-cols-2 gap-8 flex-1">
              <div className="bg-[#1c1f33]/80 backdrop-blur rounded-3xl p-10 border border-[#d3bb73]/30">
                <Music className="w-20 h-20 text-[#d3bb73] mb-6"/>
                <h3 className="text-3xl font-bold text-[#e5e4e2] mb-4">
                  {renderEditableText('sound_title', 'Nagłośnienie', 'text-3xl font-bold text-[#e5e4e2]', false)}
                </h3>
                <p className="text-[#e5e4e2]/80 text-lg leading-relaxed">
                  {renderEditableText('sound_desc', 'Systemy line array premium od L-Acoustics, d&b audiotechnik, Meyer Sound. Mikrofony bezprzewodowe Shure Axient Digital i Sennheiser Digital 6000.', 'text-[#e5e4e2]/80 text-lg leading-relaxed', true)}
                </p>
              </div>
              <div className="bg-[#1c1f33]/80 backdrop-blur rounded-3xl p-10 border border-[#d3bb73]/30">
                <Lightbulb className="w-20 h-20 text-[#d3bb73] mb-6"/>
                <h3 className="text-3xl font-bold text-[#e5e4e2] mb-4">
                  {renderEditableText('light_title', 'Oświetlenie', 'text-3xl font-bold text-[#e5e4e2]', false)}
                </h3>
                <p className="text-[#e5e4e2]/80 text-lg leading-relaxed">
                  {renderEditableText('light_desc', 'Inteligentne reflektory LED Robe, Martin by Harman, Clay Paky. Lasery i efekty specjalne. Sterowanie DMX/Art-Net.', 'text-[#e5e4e2]/80 text-lg leading-relaxed', true)}
                </p>
              </div>
              <div className="bg-[#1c1f33]/80 backdrop-blur rounded-3xl p-10 border border-[#d3bb73]/30">
                <Tv className="w-20 h-20 text-[#d3bb73] mb-6"/>
                <h3 className="text-3xl font-bold text-[#e5e4e2] mb-4">
                  {renderEditableText('led_title', 'Ekrany LED', 'text-3xl font-bold text-[#e5e4e2]', false)}
                </h3>
                <p className="text-[#e5e4e2]/80 text-lg leading-relaxed">
                  {renderEditableText('led_desc', 'Ekrany LED wewnętrzne i zewnętrzne w rozdzielczości HD i 4K. Modułowa konstrukcja, pełna obsługa techniczna.', 'text-[#e5e4e2]/80 text-lg leading-relaxed', true)}
                </p>
              </div>
              <div className="bg-[#1c1f33]/80 backdrop-blur rounded-3xl p-10 border border-[#d3bb73]/30">
                <Sparkles className="w-20 h-20 text-[#d3bb73] mb-6"/>
                <h3 className="text-3xl font-bold text-[#e5e4e2] mb-4">
                  {renderEditableText('stage_title', 'Scena i konstrukcje', 'text-3xl font-bold text-[#e5e4e2]', false)}
                </h3>
                <p className="text-[#e5e4e2]/80 text-lg leading-relaxed">
                  {renderEditableText('stage_desc', 'Podesty sceniczne Layher i Prolyte. Konstrukcje aluminiowe Ground Support i truss. Dekoracje sceniczne.', 'text-[#e5e4e2]/80 text-lg leading-relaxed', true)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Page 4: Services Part 2 */}
        <div className="brochure-page page-break">
          <div className="decorative-shape shape-6"></div>
          <div className="decorative-shape shape-1"></div>
          <div className="brochure-content-wrapper">
            <div className="grid grid-cols-2 gap-8 flex-1">
              <div className="bg-[#1c1f33]/80 backdrop-blur rounded-3xl p-10 border border-[#d3bb73]/30">
                <Radio className="w-20 h-20 text-[#d3bb73] mb-6"/>
                <h3 className="text-3xl font-bold text-[#e5e4e2] mb-4">
                  {renderEditableText('streaming_title', 'Realizacja i Streaming', 'text-3xl font-bold text-[#e5e4e2]', false)}
                </h3>
                <p className="text-[#e5e4e2]/80 text-lg leading-relaxed">
                  {renderEditableText('streaming_desc', 'Kamery 4K Sony i Panasonic, reżyseria obrazu, transmisje live. Nagrania HD/4K z postprodukcją.', 'text-[#e5e4e2]/80 text-lg leading-relaxed', true)}
                </p>
              </div>
              <div className="bg-[#1c1f33]/80 backdrop-blur rounded-3xl p-10 border border-[#d3bb73]/30">
                <Gauge className="w-20 h-20 text-[#d3bb73] mb-6"/>
                <h3 className="text-3xl font-bold text-[#e5e4e2] mb-4">
                  {renderEditableText('power_title', 'Zasilanie i dystrybucja', 'text-3xl font-bold text-[#e5e4e2]', false)}
                </h3>
                <p className="text-[#e5e4e2]/80 text-lg leading-relaxed">
                  {renderEditableText('power_desc', 'Agregaty prądotwórcze, systemy UPS i ochrona przepięciowa. Profesjonalna dystrybucja energii.', 'text-[#e5e4e2]/80 text-lg leading-relaxed', true)}
                </p>
              </div>
              <div className="bg-[#1c1f33]/80 backdrop-blur rounded-3xl p-10 border border-[#d3bb73]/30 col-span-2">
                <Users className="w-20 h-20 text-[#d3bb73] mb-6 mx-auto"/>
                <h3 className="text-3xl font-bold text-[#e5e4e2] mb-4 text-center">
                  {renderEditableText('team_title', 'Profesjonalny zespół', 'text-3xl font-bold text-[#e5e4e2]', false)}
                </h3>
                <p className="text-[#e5e4e2]/80 text-lg leading-relaxed text-center max-w-3xl mx-auto">
                  {renderEditableText('team_desc', 'Doświadczeni realizatorzy dźwięku, operatorzy świateł, technicy sceniczni. Wieloletnie doświadczenie w branży eventowej.', 'text-[#e5e4e2]/80 text-lg leading-relaxed', true)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Page 5: Portfolio Image 1 */}
        <div className="brochure-page page-break">
          <div className="decorative-shape shape-2"></div>
          <div className="brochure-content-wrapper">
            <h2 className="text-5xl font-bold text-[#d3bb73] mb-8 text-center">
              {renderEditableText('portfolio_title', 'Nasze Realizacje', 'text-5xl font-bold text-[#d3bb73]', false)}
            </h2>
            <div className="relative flex-1 rounded-3xl overflow-hidden shadow-2xl">
              {renderEditableImage('portfolio', 0, 'absolute inset-0 w-full h-full', 'Portfolio showcase')}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"></div>
              <div className="absolute bottom-8 left-8 right-8 z-10">
                <h3 className="text-3xl font-bold text-[#e5e4e2] mb-3">
                  {renderEditableText('portfolio_1_title', 'Konferencje korporacyjne', 'text-3xl font-bold text-[#e5e4e2]', false)}
                </h3>
                <p className="text-xl text-[#e5e4e2]/90">
                  {renderEditableText('portfolio_1_desc', 'Kompleksowa obsługa techniczna konferencji dla 500+ uczestników', 'text-xl text-[#e5e4e2]/90', true)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Page 6: Portfolio Image 2 */}
        <div className="brochure-page page-break">
          <div className="decorative-shape shape-3"></div>
          <div className="brochure-content-wrapper">
            <div className="relative flex-1 rounded-3xl overflow-hidden shadow-2xl">
              {renderEditableImage('portfolio', 1, 'absolute inset-0 w-full h-full', 'Portfolio showcase 2')}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"></div>
              <div className="absolute bottom-8 left-8 right-8 z-10">
                <h3 className="text-3xl font-bold text-[#e5e4e2] mb-3">
                  {renderEditableText('portfolio_2_title', 'Gale i eventy', 'text-3xl font-bold text-[#e5e4e2]', false)}
                </h3>
                <p className="text-xl text-[#e5e4e2]/90">
                  {renderEditableText('portfolio_2_desc', 'Spektakularne oświetlenie i realizacje multimedialne', 'text-xl text-[#e5e4e2]/90', true)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Page 7: Why Us */}
        <div className="brochure-page page-break">
          <div className="decorative-shape shape-4"></div>
          <div className="decorative-shape shape-5"></div>
          <div className="brochure-content-wrapper justify-center">
            <h2 className="text-6xl font-bold text-[#d3bb73] mb-12 text-center">
              {renderEditableText('why_us_title', 'Dlaczego My?', 'text-6xl font-bold text-[#d3bb73]', false)}
            </h2>
            <div className="grid grid-cols-2 gap-8">
              {[
                { icon: Award, key: 'why_1', defaultTitle: '15+ lat doświadczenia', defaultDesc: 'Setki udanych eventów w całej Polsce' },
                { icon: Users, key: 'why_2', defaultTitle: 'Profesjonalny zespół', defaultDesc: 'Certyfikowani specjaliści z pasją' },
                { icon: Sparkles, key: 'why_3', defaultTitle: 'Najnowszy sprzęt', defaultDesc: 'Regularnie aktualizowany park maszynowy' },
                { icon: Gauge, key: 'why_4', defaultTitle: 'Obsługa 24/7', defaultDesc: 'Wsparcie techniczne przez całą dobę' },
              ].map((item, idx) => (
                <div key={idx} className="bg-[#1c1f33]/80 backdrop-blur rounded-2xl p-8 border border-[#d3bb73]/30 text-center">
                  <item.icon className="w-16 h-16 text-[#d3bb73] mx-auto mb-6"/>
                  <h3 className="text-2xl font-bold text-[#e5e4e2] mb-3">
                    {renderEditableText(`${item.key}_title`, item.defaultTitle, 'text-2xl font-bold text-[#e5e4e2]', false)}
                  </h3>
                  <p className="text-[#e5e4e2]/80 text-lg">
                    {renderEditableText(`${item.key}_desc`, item.defaultDesc, 'text-[#e5e4e2]/80 text-lg', false)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Page 8: Contact */}
        <div className="brochure-page">
          <div className="decorative-shape shape-4"></div>
          <div className="decorative-shape shape-5"></div>
          <div className="decorative-shape shape-6"></div>

          <div className="brochure-content-wrapper justify-center">
            <div className="text-center mb-12">
              <h2 className="text-5xl font-bold text-[#d3bb73] mb-4">
                {renderEditableText('contact_title', 'Skontaktuj się z nami', 'text-5xl font-bold text-[#d3bb73]', false)}
              </h2>
              <p className="text-xl text-[#e5e4e2]/70">
                {renderEditableText('contact_subtitle', 'Porozmawiajmy o Twoim projekcie', 'text-xl text-[#e5e4e2]/70', false)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-12">
              <div className="space-y-8">
                <div className="bg-[#1c1f33]/80 backdrop-blur rounded-2xl p-8 border border-[#d3bb73]/30">
                  <h3 className="text-2xl font-bold text-[#d3bb73] mb-6">Dane kontaktowe</h3>

                  <div className="space-y-6">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-[#d3bb73]/20 rounded-full flex items-center justify-center flex-shrink-0">
                        <Phone className="w-6 h-6 text-[#d3bb73]" />
                      </div>
                      <div>
                        <p className="text-[#e5e4e2]/60 text-sm mb-1">Telefon</p>
                        <p className="text-[#e5e4e2] text-xl font-semibold">{getEmployeePhone()}</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-[#d3bb73]/20 rounded-full flex items-center justify-center flex-shrink-0">
                        <Mail className="w-6 h-6 text-[#d3bb73]" />
                      </div>
                      <div>
                        <p className="text-[#e5e4e2]/60 text-sm mb-1">Email</p>
                        <p className="text-[#e5e4e2] text-xl font-semibold">{getEmployeeEmail()}</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-[#d3bb73]/20 rounded-full flex items-center justify-center flex-shrink-0">
                        <MapPin className="w-6 h-6 text-[#d3bb73]" />
                      </div>
                      <div>
                        <p className="text-[#e5e4e2]/60 text-sm mb-1">Biuro</p>
                        <p className="text-[#e5e4e2] text-xl font-semibold">
                          {renderEditableText('location', 'Polska', 'text-[#e5e4e2] text-xl font-semibold', false)}
                        </p>
                        <p className="text-[#e5e4e2]/80 text-lg">
                          {renderEditableText('location_desc', 'Działamy w całym kraju', 'text-[#e5e4e2]/80 text-lg', false)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-[#d3bb73] to-[#c1a85f] rounded-2xl p-8 text-center">
                  <p className="text-[#1c1f33] text-lg font-bold mb-2">
                    {renderEditableText('availability_title', 'Dostępność 24/7', 'text-[#1c1f33] text-lg font-bold', false)}
                  </p>
                  <p className="text-[#1c1f33]/90">
                    {renderEditableText('availability_desc', 'W przypadku pilnych zleceń jesteśmy do dyspozycji', 'text-[#1c1f33]/90', false)}
                  </p>
                </div>
              </div>

              <div className="flex flex-col justify-center space-y-8">
                {employee ? (
                  <div className="bg-[#1c1f33]/80 backdrop-blur rounded-2xl p-8 border border-[#d3bb73]/30 text-center space-y-6">
                    {employee.avatar_url && (
                      <img
                        src={employee.avatar_url}
                        alt={`${employee.name} ${employee.surname}`}
                        className="w-48 h-48 rounded-full object-cover mx-auto border-4 border-[#d3bb73]/40 shadow-2xl"
                      />
                    )}
                    <div>
                      <h3 className="text-3xl font-bold text-[#e5e4e2] mb-2">
                        {employee.name} {employee.surname}
                      </h3>
                      {employee.position && (
                        <p className="text-[#d3bb73] text-xl font-semibold">{employee.position}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#1c1f33]/80 backdrop-blur rounded-xl p-8 border border-[#d3bb73]/30">
                    <h3 className="text-3xl font-bold text-[#e5e4e2] mb-4">
                      {renderEditableText('company_name', 'Mavinci Event & Art', 'text-3xl font-bold text-[#e5e4e2]', false)}
                    </h3>
                    <p className="text-[#d3bb73] text-lg font-semibold mb-4">
                      {renderEditableText('company_tagline', 'Profesjonalna obsługa techniczna eventów', 'text-[#d3bb73] text-lg font-semibold', false)}
                    </p>
                    <p className="text-[#e5e4e2]/80 leading-relaxed mb-6">
                      {renderEditableText('company_desc', 'Od ponad 15 lat realizujemy wydarzenia na najwyższym poziomie. Konferencje, gale, koncerty i eventy korporacyjne – każdy projekt traktujemy indywidualnie i z pełnym zaangażowaniem.', 'text-[#e5e4e2]/80 leading-relaxed', true)}
                    </p>
                    <div className="space-y-3">
                      {['feature_1', 'feature_2', 'feature_3', 'feature_4'].map((key, idx) => {
                        const defaults = [
                          'Nagłośnienie premium',
                          'Oświetlenie sceniczne i architektoniczne',
                          'Konstrukcje sceniczne i multimedia',
                          'Realizacja i streaming online'
                        ];
                        return (
                          <div key={key} className="flex items-center gap-3 text-[#e5e4e2]/80">
                            <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                            {renderEditableText(key, defaults[idx], 'text-[#e5e4e2]/80', false)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {renderEditableImage('contact', 0, 'w-full h-64 object-cover rounded-2xl shadow-2xl', 'Mavinci team')}
              </div>
            </div>

            <div className="text-center space-y-4 pt-8 border-t border-[#d3bb73]/20 mt-12">
              <div className="flex items-center justify-center gap-4">
                <img
                  src="/logo mavinci-simple.svg"
                  alt="Mavinci Logo"
                  className="h-12 w-12"
                />
              </div>
              <p className="text-[#e5e4e2]/60">www.mavinci.pl</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TechnicalOfferBrochure;
