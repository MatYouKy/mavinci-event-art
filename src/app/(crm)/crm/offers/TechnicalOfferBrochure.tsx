'use client';

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/browser';
import {
  Edit2,
  Save,
  X,
  Eye,
  Download,
  Phone,
  Mail,
  MapPin,
  Music,
  Lightbulb,
  Tv,
  Sparkles,
  Radio,
  Gauge,
  Users,
  Award,
  Upload,
  Plus,
  Trash2,
  Image as ImageIcon,
} from 'lucide-react';
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

const TechnicalOfferBrochure = ({
  editMode: externalEditMode = false,
  showControls = true,
}: TechnicalOfferBrochureProps) => {
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
        updated_at: new Date().toISOString(),
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
        .filter((img) => img.section === section)
        .reduce((max, img) => Math.max(max, img.order_index), 0);

      const { error } = await supabase.from('technical_brochure_images').insert({
        section,
        image_url: imageUrl,
        alt_text: file.name,
        position_x: 50,
        position_y: 50,
        object_fit: 'cover',
        order_index: maxOrder + 1,
        is_visible: true,
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

    const { error } = await supabase.from('technical_brochure_images').delete().eq('id', imageId);

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
    return employee?.phone_number || getContentValue('phone_number', '+48 698 212 279');
  };

  const getEmployeeEmail = () => {
    return employee?.email || getContentValue('email', 'biuro@mavinci.pl');
  };

  const getImageBySection = (section: string, index: number = 0): BrochureImage | null => {
    const sectionImages = images.filter((img) => img.section === section);
    return sectionImages[index] || null;
  };

  const renderEditableText = (
    key: string,
    defaultValue: string,
    className: string,
    multiline: boolean = false,
  ) => {
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
              onChange={(e) =>
                setContent({
                  ...content,
                  [key]: { ...content[key], content_value: e.target.value },
                })
              }
              className="flex-1 rounded border border-[#d3bb73]/30 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2]"
              rows={3}
            />
          ) : (
            <input
              type="text"
              value={value}
              onChange={(e) =>
                setContent({
                  ...content,
                  [key]: { ...content[key], content_value: e.target.value },
                })
              }
              className="flex-1 rounded border border-[#d3bb73]/30 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2]"
            />
          )}
          <button
            onClick={() => updateContent(key, value)}
            className="rounded bg-green-500/20 p-2 text-green-400 hover:bg-green-500/30"
          >
            <Save className="h-5 w-5" />
          </button>
          <button
            onClick={() => {
              setEditingContent(null);
              fetchContent();
            }}
            className="rounded bg-red-500/20 p-2 text-red-400 hover:bg-red-500/30"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      );
    }

    return (
      <span
        onClick={() => setEditingContent(key)}
        className={`${className} ${editMode ? 'cursor-pointer rounded px-2 py-1 transition-colors hover:bg-[#d3bb73]/10' : ''}`}
      >
        {value}
      </span>
    );
  };

  const renderEditableImage = (
    section: string,
    index: number = 0,
    className: string,
    alt: string,
  ) => {
    const image = getImageBySection(section, index);

    if (!image) {
      if (!editMode) {
        return (
          <div
            className={`${className} flex items-center justify-center bg-[#1c1f33]/50 text-[#e5e4e2]/40`}
          >
            Brak obrazu
          </div>
        );
      }

      return (
        <div
          className={`${className} flex flex-col items-center justify-center gap-3 border-2 border-dashed border-[#d3bb73]/30 bg-[#1c1f33]/50 text-[#e5e4e2]/40`}
        >
          <ImageIcon className="h-12 w-12 text-[#d3bb73]/40" />
          <p className="text-sm">Brak obrazu</p>
          <label className="cursor-pointer rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90">
            <Upload className="mr-2 inline h-4 w-4" />
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
        <div className={`${className} relative`}>
          <img
            src={editingImage.image_url}
            alt={editingImage.alt_text}
            className={className}
            style={{
              objectFit: editingImage.object_fit as any,
              objectPosition: `${editingImage.position_x}% ${editingImage.position_y}%`,
            }}
          />
          <div className="pointer-events-none absolute inset-0 border-4 border-blue-500">
            <div className="absolute left-0 right-0 top-0 bg-blue-500 px-2 py-1 text-xs text-white">
              Edycja obrazu - zmień pozycję w panelu po prawej →
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="group relative">
        <img
          src={image.image_url}
          alt={image.alt_text || alt}
          className={className}
          style={{
            objectFit: image.object_fit as any,
            objectPosition: `${image.position_x}% ${image.position_y}%`,
          }}
        />
        {editMode && (
          <button
            onClick={() => setEditingImage(image)}
            className="absolute right-2 top-2 z-20 rounded-lg bg-[#d3bb73]/90 p-2 text-[#1c1f33] opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Edit2 className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-screen bg-[#1c1f33]">
      {/* Main Content Area */}
      <div
        className={`flex-1 bg-[#0f1119] transition-all duration-300 ${showImageManager && editMode ? 'mr-96' : ''}`}
      >
        {/* Floating Controls */}
        {showControls && (
          <div className="no-print fixed right-4 top-4 z-50 flex items-center gap-3">
            <button
              onClick={() => setEditMode(!editMode)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 shadow-xl transition-all ${
                editMode
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'bg-[#d3bb73]/20 text-[#d3bb73] hover:bg-[#d3bb73]/30'
              }`}
            >
              {editMode ? <X className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
              <span className="text-sm font-semibold">{editMode ? 'Zakończ' : 'Edycja'}</span>
            </button>

            {editMode && (
              <button
                onClick={() => setShowImageManager(!showImageManager)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 shadow-xl transition-all ${
                  showImageManager
                    ? 'bg-blue-500/30 text-blue-300'
                    : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                }`}
              >
                <ImageIcon className="h-4 w-4" />
                <span className="text-sm font-semibold">Obrazy</span>
              </button>
            )}

            <button
              onClick={handleDownloadPDF}
              className="group flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#d3bb73] to-[#c1a85f] px-4 py-2 font-bold text-[#1c1f33] shadow-xl transition-all hover:from-[#c1a85f] hover:to-[#d3bb73]"
            >
              <Download className="h-4 w-4" />
              <span className="text-sm">PDF</span>
            </button>
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
                  <h1 className="text-8xl font-black leading-tight tracking-tight">
                    {renderEditableText(
                      'title',
                      'Technika Estradowa',
                      'text-8xl font-black tracking-tight leading-tight bg-gradient-to-r from-[#d3bb73] via-[#e5d5a0] to-[#d3bb73] bg-clip-text text-transparent',
                      false,
                    )}
                  </h1>
                  <div className="mx-auto h-1 w-64 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
                  <h2 className="text-5xl font-light uppercase tracking-[0.3em]">
                    {renderEditableText(
                      'subtitle',
                      'Premium',
                      'text-5xl font-light tracking-[0.3em] uppercase text-[#e5e4e2]',
                      false,
                    )}
                  </h2>
                </div>
                <p className="mx-auto max-w-3xl text-2xl font-light leading-relaxed text-[#e5e4e2]/90">
                  {renderEditableText(
                    'description',
                    'Twórz niezapomniane wydarzenia z najlepszym sprzętem scenicznym i profesjonalną obsługą techniczną',
                    'text-2xl text-[#e5e4e2]/90 max-w-3xl mx-auto leading-relaxed font-light',
                    true,
                  )}
                </p>
                <div className="pt-12">
                  <div className="inline-block rounded-2xl bg-gradient-to-r from-[#d3bb73] to-[#c1a85f] px-12 py-6">
                    <p className="text-2xl font-bold text-[#1c1f33]">www.mavinci.pl</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Page 2: Hero Image Full */}
          <div className="brochure-page page-break">
            <div className="decorative-shape shape-3"></div>
            <div className="brochure-content-wrapper">
              <div className="relative h-full overflow-hidden rounded-3xl shadow-2xl">
                {renderEditableImage(
                  'hero',
                  0,
                  'absolute inset-0 w-full h-full',
                  'Stage with professional lighting',
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
                <div className="absolute bottom-12 left-12 right-12 z-10">
                  <h2 className="mb-4 text-5xl font-bold text-[#d3bb73]">
                    {renderEditableText(
                      'hero_title',
                      'Profesjonalizm w każdym detalu',
                      'text-5xl font-bold text-[#d3bb73]',
                      false,
                    )}
                  </h2>
                  <p className="max-w-3xl text-2xl leading-relaxed text-[#e5e4e2]/90">
                    {renderEditableText(
                      'hero_desc',
                      'Kompleksowa obsługa techniczna eventów - od koncepcji po realizację. Najnowocześniejszy sprzęt i doświadczony zespół specjalistów.',
                      'text-2xl text-[#e5e4e2]/90 leading-relaxed',
                      true,
                    )}
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
              <h2 className="mb-12 text-center text-6xl font-bold text-[#d3bb73]">
                {renderEditableText(
                  'services_title',
                  'Nasze Usługi',
                  'text-6xl font-bold text-[#d3bb73]',
                  false,
                )}
              </h2>
              <div className="grid flex-1 grid-cols-2 gap-8">
                <div className="rounded-3xl border border-[#d3bb73]/30 bg-[#1c1f33]/80 p-10 backdrop-blur">
                  <Music className="mb-6 h-20 w-20 text-[#d3bb73]" />
                  <h3 className="mb-4 text-3xl font-bold text-[#e5e4e2]">
                    {renderEditableText(
                      'sound_title',
                      'Nagłośnienie',
                      'text-3xl font-bold text-[#e5e4e2]',
                      false,
                    )}
                  </h3>
                  <p className="text-lg leading-relaxed text-[#e5e4e2]/80">
                    {renderEditableText(
                      'sound_desc',
                      'Systemy line array premium od L-Acoustics, d&b audiotechnik, Meyer Sound. Mikrofony bezprzewodowe Shure Axient Digital i Sennheiser Digital 6000.',
                      'text-[#e5e4e2]/80 text-lg leading-relaxed',
                      true,
                    )}
                  </p>
                </div>
                <div className="rounded-3xl border border-[#d3bb73]/30 bg-[#1c1f33]/80 p-10 backdrop-blur">
                  <Lightbulb className="mb-6 h-20 w-20 text-[#d3bb73]" />
                  <h3 className="mb-4 text-3xl font-bold text-[#e5e4e2]">
                    {renderEditableText(
                      'light_title',
                      'Oświetlenie',
                      'text-3xl font-bold text-[#e5e4e2]',
                      false,
                    )}
                  </h3>
                  <p className="text-lg leading-relaxed text-[#e5e4e2]/80">
                    {renderEditableText(
                      'light_desc',
                      'Inteligentne reflektory LED Robe, Martin by Harman, Clay Paky. Lasery i efekty specjalne. Sterowanie DMX/Art-Net.',
                      'text-[#e5e4e2]/80 text-lg leading-relaxed',
                      true,
                    )}
                  </p>
                </div>
                <div className="rounded-3xl border border-[#d3bb73]/30 bg-[#1c1f33]/80 p-10 backdrop-blur">
                  <Tv className="mb-6 h-20 w-20 text-[#d3bb73]" />
                  <h3 className="mb-4 text-3xl font-bold text-[#e5e4e2]">
                    {renderEditableText(
                      'led_title',
                      'Ekrany LED',
                      'text-3xl font-bold text-[#e5e4e2]',
                      false,
                    )}
                  </h3>
                  <p className="text-lg leading-relaxed text-[#e5e4e2]/80">
                    {renderEditableText(
                      'led_desc',
                      'Ekrany LED wewnętrzne i zewnętrzne w rozdzielczości HD i 4K. Modułowa konstrukcja, pełna obsługa techniczna.',
                      'text-[#e5e4e2]/80 text-lg leading-relaxed',
                      true,
                    )}
                  </p>
                </div>
                <div className="rounded-3xl border border-[#d3bb73]/30 bg-[#1c1f33]/80 p-10 backdrop-blur">
                  <Sparkles className="mb-6 h-20 w-20 text-[#d3bb73]" />
                  <h3 className="mb-4 text-3xl font-bold text-[#e5e4e2]">
                    {renderEditableText(
                      'stage_title',
                      'Scena i konstrukcje',
                      'text-3xl font-bold text-[#e5e4e2]',
                      false,
                    )}
                  </h3>
                  <p className="text-lg leading-relaxed text-[#e5e4e2]/80">
                    {renderEditableText(
                      'stage_desc',
                      'Podesty sceniczne Layher i Prolyte. Konstrukcje aluminiowe Ground Support i truss. Dekoracje sceniczne.',
                      'text-[#e5e4e2]/80 text-lg leading-relaxed',
                      true,
                    )}
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
              <div className="grid flex-1 grid-cols-2 gap-8">
                <div className="rounded-3xl border border-[#d3bb73]/30 bg-[#1c1f33]/80 p-10 backdrop-blur">
                  <Radio className="mb-6 h-20 w-20 text-[#d3bb73]" />
                  <h3 className="mb-4 text-3xl font-bold text-[#e5e4e2]">
                    {renderEditableText(
                      'streaming_title',
                      'Realizacja i Streaming',
                      'text-3xl font-bold text-[#e5e4e2]',
                      false,
                    )}
                  </h3>
                  <p className="text-lg leading-relaxed text-[#e5e4e2]/80">
                    {renderEditableText(
                      'streaming_desc',
                      'Kamery 4K Sony i Panasonic, reżyseria obrazu, transmisje live. Nagrania HD/4K z postprodukcją.',
                      'text-[#e5e4e2]/80 text-lg leading-relaxed',
                      true,
                    )}
                  </p>
                </div>
                <div className="rounded-3xl border border-[#d3bb73]/30 bg-[#1c1f33]/80 p-10 backdrop-blur">
                  <Gauge className="mb-6 h-20 w-20 text-[#d3bb73]" />
                  <h3 className="mb-4 text-3xl font-bold text-[#e5e4e2]">
                    {renderEditableText(
                      'power_title',
                      'Zasilanie i dystrybucja',
                      'text-3xl font-bold text-[#e5e4e2]',
                      false,
                    )}
                  </h3>
                  <p className="text-lg leading-relaxed text-[#e5e4e2]/80">
                    {renderEditableText(
                      'power_desc',
                      'Agregaty prądotwórcze, systemy UPS i ochrona przepięciowa. Profesjonalna dystrybucja energii.',
                      'text-[#e5e4e2]/80 text-lg leading-relaxed',
                      true,
                    )}
                  </p>
                </div>
                <div className="col-span-2 rounded-3xl border border-[#d3bb73]/30 bg-[#1c1f33]/80 p-10 backdrop-blur">
                  <Users className="mx-auto mb-6 h-20 w-20 text-[#d3bb73]" />
                  <h3 className="mb-4 text-center text-3xl font-bold text-[#e5e4e2]">
                    {renderEditableText(
                      'team_title',
                      'Profesjonalny zespół',
                      'text-3xl font-bold text-[#e5e4e2]',
                      false,
                    )}
                  </h3>
                  <p className="mx-auto max-w-3xl text-center text-lg leading-relaxed text-[#e5e4e2]/80">
                    {renderEditableText(
                      'team_desc',
                      'Doświadczeni realizatorzy dźwięku, operatorzy świateł, technicy sceniczni. Wieloletnie doświadczenie w branży eventowej.',
                      'text-[#e5e4e2]/80 text-lg leading-relaxed',
                      true,
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Page 5: Portfolio Image 1 */}
          <div className="brochure-page page-break">
            <div className="decorative-shape shape-2"></div>
            <div className="brochure-content-wrapper">
              <h2 className="mb-8 text-center text-5xl font-bold text-[#d3bb73]">
                {renderEditableText(
                  'portfolio_title',
                  'Nasze Realizacje',
                  'text-5xl font-bold text-[#d3bb73]',
                  false,
                )}
              </h2>
              <div className="relative flex-1 overflow-hidden rounded-3xl shadow-2xl">
                {renderEditableImage(
                  'portfolio',
                  0,
                  'absolute inset-0 w-full h-full',
                  'Portfolio showcase',
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"></div>
                <div className="absolute bottom-8 left-8 right-8 z-10">
                  <h3 className="mb-3 text-3xl font-bold text-[#e5e4e2]">
                    {renderEditableText(
                      'portfolio_1_title',
                      'Konferencje korporacyjne',
                      'text-3xl font-bold text-[#e5e4e2]',
                      false,
                    )}
                  </h3>
                  <p className="text-xl text-[#e5e4e2]/90">
                    {renderEditableText(
                      'portfolio_1_desc',
                      'Kompleksowa obsługa techniczna konferencji dla 500+ uczestników',
                      'text-xl text-[#e5e4e2]/90',
                      true,
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Page 6: Portfolio Image 2 */}
          <div className="brochure-page page-break">
            <div className="decorative-shape shape-3"></div>
            <div className="brochure-content-wrapper">
              <div className="relative flex-1 overflow-hidden rounded-3xl shadow-2xl">
                {renderEditableImage(
                  'portfolio',
                  1,
                  'absolute inset-0 w-full h-full',
                  'Portfolio showcase 2',
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"></div>
                <div className="absolute bottom-8 left-8 right-8 z-10">
                  <h3 className="mb-3 text-3xl font-bold text-[#e5e4e2]">
                    {renderEditableText(
                      'portfolio_2_title',
                      'Gale i eventy',
                      'text-3xl font-bold text-[#e5e4e2]',
                      false,
                    )}
                  </h3>
                  <p className="text-xl text-[#e5e4e2]/90">
                    {renderEditableText(
                      'portfolio_2_desc',
                      'Spektakularne oświetlenie i realizacje multimedialne',
                      'text-xl text-[#e5e4e2]/90',
                      true,
                    )}
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
              <h2 className="mb-12 text-center text-6xl font-bold text-[#d3bb73]">
                {renderEditableText(
                  'why_us_title',
                  'Dlaczego My?',
                  'text-6xl font-bold text-[#d3bb73]',
                  false,
                )}
              </h2>
              <div className="grid grid-cols-2 gap-8">
                {[
                  {
                    icon: Award,
                    key: 'why_1',
                    defaultTitle: '15+ lat doświadczenia',
                    defaultDesc: 'Setki udanych eventów w całej Polsce',
                  },
                  {
                    icon: Users,
                    key: 'why_2',
                    defaultTitle: 'Profesjonalny zespół',
                    defaultDesc: 'Certyfikowani specjaliści z pasją',
                  },
                  {
                    icon: Sparkles,
                    key: 'why_3',
                    defaultTitle: 'Najnowszy sprzęt',
                    defaultDesc: 'Regularnie aktualizowany park maszynowy',
                  },
                  {
                    icon: Gauge,
                    key: 'why_4',
                    defaultTitle: 'Obsługa 24/7',
                    defaultDesc: 'Wsparcie techniczne przez całą dobę',
                  },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded-2xl border border-[#d3bb73]/30 bg-[#1c1f33]/80 p-8 text-center backdrop-blur"
                  >
                    <item.icon className="mx-auto mb-6 h-16 w-16 text-[#d3bb73]" />
                    <h3 className="mb-3 text-2xl font-bold text-[#e5e4e2]">
                      {renderEditableText(
                        `${item.key}_title`,
                        item.defaultTitle,
                        'text-2xl font-bold text-[#e5e4e2]',
                        false,
                      )}
                    </h3>
                    <p className="text-lg text-[#e5e4e2]/80">
                      {renderEditableText(
                        `${item.key}_desc`,
                        item.defaultDesc,
                        'text-[#e5e4e2]/80 text-lg',
                        false,
                      )}
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
              <div className="mb-12 text-center">
                <h2 className="mb-4 text-5xl font-bold text-[#d3bb73]">
                  {renderEditableText(
                    'contact_title',
                    'Skontaktuj się z nami',
                    'text-5xl font-bold text-[#d3bb73]',
                    false,
                  )}
                </h2>
                <p className="text-xl text-[#e5e4e2]/70">
                  {renderEditableText(
                    'contact_subtitle',
                    'Porozmawiajmy o Twoim projekcie',
                    'text-xl text-[#e5e4e2]/70',
                    false,
                  )}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-12">
                <div className="space-y-8">
                  <div className="rounded-2xl border border-[#d3bb73]/30 bg-[#1c1f33]/80 p-8 backdrop-blur">
                    <h3 className="mb-6 text-2xl font-bold text-[#d3bb73]">Dane kontaktowe</h3>

                    <div className="space-y-6">
                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/20">
                          <Phone className="h-6 w-6 text-[#d3bb73]" />
                        </div>
                        <div>
                          <p className="mb-1 text-sm text-[#e5e4e2]/60">Telefon</p>
                          <p className="text-xl font-semibold text-[#e5e4e2]">
                            {getEmployeePhone()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/20">
                          <Mail className="h-6 w-6 text-[#d3bb73]" />
                        </div>
                        <div>
                          <p className="mb-1 text-sm text-[#e5e4e2]/60">Email</p>
                          <p className="text-xl font-semibold text-[#e5e4e2]">
                            {getEmployeeEmail()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/20">
                          <MapPin className="h-6 w-6 text-[#d3bb73]" />
                        </div>
                        <div>
                          <p className="mb-1 text-sm text-[#e5e4e2]/60">Biuro</p>
                          <p className="text-xl font-semibold text-[#e5e4e2]">
                            {renderEditableText(
                              'location',
                              'Polska',
                              'text-[#e5e4e2] text-xl font-semibold',
                              false,
                            )}
                          </p>
                          <p className="text-lg text-[#e5e4e2]/80">
                            {renderEditableText(
                              'location_desc',
                              'Działamy w całym kraju',
                              'text-[#e5e4e2]/80 text-lg',
                              false,
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-gradient-to-br from-[#d3bb73] to-[#c1a85f] p-8 text-center">
                    <p className="mb-2 text-lg font-bold text-[#1c1f33]">
                      {renderEditableText(
                        'availability_title',
                        'Dostępność 24/7',
                        'text-[#1c1f33] text-lg font-bold',
                        false,
                      )}
                    </p>
                    <p className="text-[#1c1f33]/90">
                      {renderEditableText(
                        'availability_desc',
                        'W przypadku pilnych zleceń jesteśmy do dyspozycji',
                        'text-[#1c1f33]/90',
                        false,
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col justify-center space-y-8">
                  {employee ? (
                    <div className="space-y-6 rounded-2xl border border-[#d3bb73]/30 bg-[#1c1f33]/80 p-8 text-center backdrop-blur">
                      {employee.avatar_url && (
                        <img
                          src={employee.avatar_url}
                          alt={`${employee.name} ${employee.surname}`}
                          className="mx-auto h-48 w-48 rounded-full border-4 border-[#d3bb73]/40 object-cover shadow-2xl"
                        />
                      )}
                      <div>
                        <h3 className="mb-2 text-3xl font-bold text-[#e5e4e2]">
                          {employee.name} {employee.surname}
                        </h3>
                        {employee.position && (
                          <p className="text-xl font-semibold text-[#d3bb73]">
                            {employee.position}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-[#d3bb73]/30 bg-[#1c1f33]/80 p-8 backdrop-blur">
                      <h3 className="mb-4 text-3xl font-bold text-[#e5e4e2]">
                        {renderEditableText(
                          'company_name',
                          'Mavinci Event & Art',
                          'text-3xl font-bold text-[#e5e4e2]',
                          false,
                        )}
                      </h3>
                      <p className="mb-4 text-lg font-semibold text-[#d3bb73]">
                        {renderEditableText(
                          'company_tagline',
                          'Profesjonalna obsługa techniczna eventów',
                          'text-[#d3bb73] text-lg font-semibold',
                          false,
                        )}
                      </p>
                      <p className="mb-6 leading-relaxed text-[#e5e4e2]/80">
                        {renderEditableText(
                          'company_desc',
                          'Od ponad 15 lat realizujemy wydarzenia na najwyższym poziomie. Konferencje, gale, koncerty i eventy korporacyjne – każdy projekt traktujemy indywidualnie i z pełnym zaangażowaniem.',
                          'text-[#e5e4e2]/80 leading-relaxed',
                          true,
                        )}
                      </p>
                      <div className="space-y-3">
                        {['feature_1', 'feature_2', 'feature_3', 'feature_4'].map((key, idx) => {
                          const defaults = [
                            'Nagłośnienie premium',
                            'Oświetlenie sceniczne i architektoniczne',
                            'Konstrukcje sceniczne i multimedia',
                            'Realizacja i streaming online',
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

                  {renderEditableImage(
                    'contact',
                    0,
                    'w-full h-64 object-cover rounded-2xl shadow-2xl',
                    'Mavinci team',
                  )}
                </div>
              </div>

              <div className="mt-12 space-y-4 border-t border-[#d3bb73]/20 pt-8 text-center">
                <div className="flex items-center justify-center gap-4">
                  <img src="/logo mavinci-simple.svg" alt="Mavinci Logo" className="h-12 w-12" />
                </div>
                <p className="text-[#e5e4e2]/60">www.mavinci.pl</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Sidebar - Image Manager */}
      {showImageManager && editMode && (
        <div className="no-print fixed right-0 top-0 z-40 h-screen w-96 overflow-y-auto border-l border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
          <div className="sticky top-0 z-10 border-b border-[#d3bb73]/20 bg-[#1c1f33] p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#e5e4e2]">
                {editingImage ? 'Edycja obrazu' : 'Zarządzanie obrazami'}
              </h3>
              <button
                onClick={() => {
                  setShowImageManager(false);
                  setEditingImage(null);
                }}
                className="rounded-lg p-2 transition-colors hover:bg-[#252842]"
              >
                <X className="h-5 w-5 text-[#e5e4e2]" />
              </button>
            </div>
            {!editingImage && (
              <p className="text-xs text-[#e5e4e2]/60">
                Kliknij obraz aby edytować jego pozycję lub dodaj nowe obrazy do sekcji
              </p>
            )}
          </div>

          <div className="space-y-6 p-4">
            {editingImage ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-blue-500/50 bg-[#252842] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500"></div>
                    <span className="text-sm font-semibold text-blue-400">Tryb edycji</span>
                  </div>
                  <img
                    src={editingImage.image_url}
                    alt={editingImage.alt_text}
                    className="mb-3 h-40 w-full rounded-lg object-cover"
                    style={{
                      objectFit: editingImage.object_fit as any,
                      objectPosition: `${editingImage.position_x}% ${editingImage.position_y}%`,
                    }}
                  />
                  <p className="text-xs text-[#e5e4e2]/60">Podgląd z aktualnymi ustawieniami</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]">
                      Pozycja X:{' '}
                      <span className="font-mono text-[#d3bb73]">{editingImage.position_x}%</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={editingImage.position_x}
                      onChange={(e) =>
                        setEditingImage({ ...editingImage, position_x: parseFloat(e.target.value) })
                      }
                      className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#252842] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#d3bb73]"
                    />
                    <div className="mt-1 flex justify-between text-xs text-[#e5e4e2]/40">
                      <span>Lewo</span>
                      <span>Prawo</span>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]">
                      Pozycja Y:{' '}
                      <span className="font-mono text-[#d3bb73]">{editingImage.position_y}%</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={editingImage.position_y}
                      onChange={(e) =>
                        setEditingImage({ ...editingImage, position_y: parseFloat(e.target.value) })
                      }
                      className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#252842] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#d3bb73]"
                    />
                    <div className="mt-1 flex justify-between text-xs text-[#e5e4e2]/40">
                      <span>Góra</span>
                      <span>Dół</span>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]">Dopasowanie:</label>
                    <select
                      value={editingImage.object_fit}
                      onChange={(e) =>
                        setEditingImage({ ...editingImage, object_fit: e.target.value })
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#252842] px-3 py-2 text-sm text-[#e5e4e2]"
                    >
                      <option value="cover">Wypełnij (Cover)</option>
                      <option value="contain">Zmieść (Contain)</option>
                      <option value="fill">Rozciągnij (Fill)</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]">Alt text:</label>
                    <input
                      type="text"
                      value={editingImage.alt_text}
                      onChange={(e) =>
                        setEditingImage({ ...editingImage, alt_text: e.target.value })
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#252842] px-3 py-2 text-sm text-[#e5e4e2]"
                      placeholder="Opis obrazu"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]">
                      Lub wgraj nowy obraz:
                    </label>
                    <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#d3bb73]/30 bg-[#252842] px-4 py-3 transition-colors hover:bg-[#2a2f4a]">
                      <Upload className="h-4 w-4 text-[#d3bb73]" />
                      <span className="text-sm text-[#e5e4e2]">Wybierz plik</span>
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
                            setEditingImage({ ...editingImage, image_url: imageUrl });
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

                <div className="flex gap-2 border-t border-[#d3bb73]/10 pt-4">
                  <button
                    onClick={() => setEditingImage(null)}
                    className="flex-1 rounded-lg bg-[#252842] px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#2a2f4a]"
                  >
                    Anuluj
                  </button>
                  <button
                    onClick={() => updateImage(editingImage)}
                    className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                  >
                    Zapisz
                  </button>
                </div>
              </div>
            ) : (
              <>
                {['hero', 'portfolio', 'contact'].map((section) => {
                  const sectionImages = images.filter((img) => img.section === section);
                  const sectionNames: Record<string, string> = {
                    hero: 'Hero (strona 2)',
                    portfolio: 'Portfolio (strony 5-6)',
                    contact: 'Kontakt (strona 8)',
                  };

                  return (
                    <div
                      key={section}
                      className="rounded-lg border border-[#d3bb73]/20 bg-[#252842] p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-[#e5e4e2]">
                          {sectionNames[section]}
                        </h4>
                        <label className="cursor-pointer rounded-lg bg-[#d3bb73] px-3 py-1.5 text-xs font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90">
                          <Plus className="mr-1 inline h-3 w-3" />
                          Dodaj
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
                        <p className="py-4 text-center text-xs text-[#e5e4e2]/40">Brak obrazów</p>
                      ) : (
                        <div className="space-y-3">
                          {sectionImages.map((img) => (
                            <div
                              key={img.id}
                              className="group relative overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] transition-colors hover:border-[#d3bb73]/30"
                            >
                              <img
                                src={img.image_url}
                                alt={img.alt_text}
                                className="h-32 w-full object-cover"
                                style={{
                                  objectFit: img.object_fit as any,
                                  objectPosition: `${img.position_x}% ${img.position_y}%`,
                                }}
                              />
                              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                                <button
                                  onClick={() => setEditingImage(img)}
                                  className="rounded-lg bg-blue-500 p-2 text-white transition-colors hover:bg-blue-600"
                                  title="Edytuj"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => deleteImage(img.id)}
                                  className="rounded-lg bg-red-500 p-2 text-white transition-colors hover:bg-red-600"
                                  title="Usuń"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                              <div className="p-2">
                                <p className="truncate text-xs text-[#e5e4e2]/80">{img.alt_text}</p>
                                <div className="mt-1 flex items-center justify-between">
                                  <span className="text-xs text-[#d3bb73]">#{img.order_index}</span>
                                  <span className="text-xs text-[#e5e4e2]/60">
                                    {img.object_fit}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {uploadingImage && (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"></div>
                    <span className="text-sm text-blue-400">Wgrywanie obrazu...</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TechnicalOfferBrochure;
