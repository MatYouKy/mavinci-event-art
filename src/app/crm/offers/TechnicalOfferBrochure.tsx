'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Edit2, Save, X, Eye, Download, Phone, Mail, MapPin } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import ImagePositionEditor from '@/components/crm/ImagePositionEditor';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

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
      return <div className={`${className} bg-[#1c1f33]/50 flex items-center justify-center text-[#e5e4e2]/40`}>Brak obrazu</div>;
    }

    if (editMode && editingImage?.id === image.id) {
      return (
        <ImagePositionEditor
          imageUrl={image.image_url}
          positionX={image.position_x}
          positionY={image.position_y}
          objectFit={image.object_fit as 'cover' | 'contain' | 'fill'}
          onSave={(newUrl, posX, posY, fit) => {
            updateImage({ ...image, image_url: newUrl, position_x: posX, position_y: posY, object_fit: fit });
          }}
          onCancel={() => setEditingImage(null)}
        />
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

          <button
            onClick={handleDownloadPDF}
            className="group flex items-center gap-3 bg-gradient-to-r from-[#d3bb73] to-[#c1a85f] hover:from-[#c1a85f] hover:to-[#d3bb73] text-[#1c1f33] font-bold px-6 py-4 rounded-xl shadow-2xl transition-all duration-300 hover:scale-105 hover:shadow-[#d3bb73]/50"
          >
            <Download className="w-6 h-6 group-hover:animate-bounce" />
            <span>Pobierz PDF</span>
          </button>
        </div>
      )}

      {/* Brochure Content */}
      <div id="brochure-content" className="min-h-screen">
        {/* Page 1: Hero + Services */}
        <div className="brochure-page page-break">
          <div className="decorative-shape shape-1"></div>
          <div className="decorative-shape shape-2"></div>
          <div className="decorative-shape shape-3"></div>

          <div className="brochure-content-wrapper">
            {/* Hero Section */}
            <div className="relative h-[350px] rounded-3xl overflow-hidden mb-12 shadow-2xl">
              {renderEditableImage('hero', 0, 'absolute inset-0 w-full h-full', 'Stage lighting hero')}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent"></div>

              <div className="absolute inset-0 flex flex-col items-center justify-center text-center z-10 px-12">
                <div className="space-y-6">
                  <h1 className="text-7xl font-black tracking-tight">
                    {renderEditableText('title', 'Technika Estradowa', 'text-7xl font-black tracking-tight bg-gradient-to-r from-[#d3bb73] via-[#e5d5a0] to-[#d3bb73] bg-clip-text text-transparent', false)}
                  </h1>
                  <div className="h-1 w-48 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
                  <h2 className="text-4xl font-light tracking-widest uppercase">
                    {renderEditableText('subtitle', 'Premium', 'text-4xl font-light tracking-widest uppercase text-[#e5e4e2]', false)}
                  </h2>
                  <p className="text-xl text-[#e5e4e2]/90 max-w-3xl mx-auto leading-relaxed">
                    {renderEditableText('description', 'Twórz niezapomniane wydarzenia z najlepszym sprzętem scenicznym i profesjonalną obsługą techniczną', 'text-xl text-[#e5e4e2]/90', true)}
                  </p>
                </div>
              </div>
            </div>

            {/* Services Grid */}
            <div className="grid grid-cols-3 gap-6">
              {[
                { icon: '🎵', titleKey: 'sound_title', descKey: 'sound_desc', defaultTitle: 'Nagłośnienie', defaultDesc: 'Systemy line array premium, mikrofony bezprzewodowe najwyższej klasy, cyfrowe konsole mikserskie' },
                { icon: '💡', titleKey: 'light_title', descKey: 'light_desc', defaultTitle: 'Oświetlenie', defaultDesc: 'Inteligentne reflektory LED, lasery i efekty specjalne, sterowanie DMX i Art-Net' },
                { icon: '📺', titleKey: 'led_title', descKey: 'led_desc', defaultTitle: 'Ekrany LED', defaultDesc: 'Ekrany wewnętrzne i zewnętrzne HD, modułowa konstrukcja, pełna obsługa techniczna' },
                { icon: '🎭', titleKey: 'stage_title', descKey: 'stage_desc', defaultTitle: 'Scena i konstrukcje', defaultDesc: 'Podesty sceniczne, konstrukcje aluminiowe, dekoracje i zabudowy sceniczne' },
                { icon: '🎬', titleKey: 'streaming_title', descKey: 'streaming_desc', defaultTitle: 'Realizacja i Streaming', defaultDesc: 'Kamery 4K, reżyseria obrazu, transmisje live, nagrania HD' },
                { icon: '⚡', titleKey: 'power_title', descKey: 'power_desc', defaultTitle: 'Zasilanie i dystrybucja', defaultDesc: 'Agregaty prądotwórcze, systemy UPS, profesjonalna dystrybucja energii' },
              ].map((service, idx) => (
                <div key={idx} className="bg-[#1c1f33]/80 backdrop-blur rounded-2xl p-6 border border-[#d3bb73]/30 hover:border-[#d3bb73]/50 transition-all duration-300 hover:transform hover:scale-105 hover:shadow-xl hover:shadow-[#d3bb73]/20">
                  <div className="text-5xl mb-4 filter drop-shadow-lg">{service.icon}</div>
                  <h3 className="text-xl font-bold text-[#d3bb73] mb-3">
                    {renderEditableText(service.titleKey, service.defaultTitle, 'text-xl font-bold text-[#d3bb73]', false)}
                  </h3>
                  <p className="text-[#e5e4e2]/80 text-sm leading-relaxed">
                    {renderEditableText(service.descKey, service.defaultDesc, 'text-[#e5e4e2]/80 text-sm', true)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Page 2: Contact */}
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
