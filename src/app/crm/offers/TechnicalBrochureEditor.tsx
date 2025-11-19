'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Edit2, Save, X, Eye, Download, Image as ImageIcon, Phone, Mail, MapPin } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import ImagePositionEditor from '@/components/crm/ImagePositionEditor';

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

interface Employee {
  id: string;
  name: string;
  surname: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  position: string | null;
}

interface TechnicalBrochureEditorProps {
  employee: Employee | null;
}

export default function TechnicalBrochureEditor({ employee }: TechnicalBrochureEditorProps) {
  const [editMode, setEditMode] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [content, setContent] = useState<Record<string, BrochureContent>>({});
  const [images, setImages] = useState<BrochureImage[]>([]);
  const [editingContent, setEditingContent] = useState<string | null>(null);
  const [editingImage, setEditingImage] = useState<BrochureImage | null>(null);
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    fetchContent();
    fetchImages();
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
    const printContent = document.getElementById('brochure-preview');
    if (printContent) {
      window.print();
    }
  };

  const getContentValue = (key: string, fallback: string = '') => {
    return content[key]?.content_value || fallback;
  };

  const getEmployeePhone = () => {
    return employee?.phone || getContentValue('contact_phone', '+48 123 456 789');
  };

  const getEmployeeEmail = () => {
    return employee?.email || getContentValue('contact_email', 'kontakt@mavinci.pl');
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
              className="flex-1 bg-[#0a0d1a] border border-[#d3bb73]/30 rounded px-2 py-1 text-[#e5e4e2] text-sm"
              rows={3}
            />
          ) : (
            <input
              type="text"
              value={value}
              onChange={(e) => setContent({ ...content, [key]: { ...content[key], content_value: e.target.value } })}
              className="flex-1 bg-[#0a0d1a] border border-[#d3bb73]/30 rounded px-2 py-1 text-[#e5e4e2] text-sm"
            />
          )}
          <button
            onClick={() => updateContent(key, value)}
            className="p-1 bg-green-500/20 text-green-400 rounded hover:bg-green-500/30"
          >
            <Save className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setEditingContent(null);
              fetchContent();
            }}
            className="p-1 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      );
    }

    return (
      <span
        onClick={() => setEditingContent(key)}
        className={`${className} cursor-pointer hover:bg-[#d3bb73]/10 px-2 py-1 rounded transition-colors`}
      >
        {value}
      </span>
    );
  };

  const renderEditableImage = (section: string, index: number = 0, className: string, alt: string) => {
    const image = getImageBySection(section, index);
    if (!image) return null;

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
            className="absolute top-2 right-2 p-2 bg-[#d3bb73]/90 text-[#1c1f33] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Edit2 className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between bg-[#1c1f33] rounded-lg p-4 border border-[#d3bb73]/20">
        <div>
          <h2 className="text-xl font-light text-[#e5e4e2]">Technika Estradowa - Broszura</h2>
          <p className="text-sm text-[#e5e4e2]/60 mt-1">
            {editMode ? 'Tryb edycji - kliknij na tekst lub obraz aby edytować' : 'Podgląd broszury'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPreviewMode(!previewMode)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors"
          >
            <Eye className="w-5 h-5" />
            <span>{previewMode ? 'Tryb CRM' : 'Pełny podgląd'}</span>
          </button>
          <button
            onClick={() => setEditMode(!editMode)}
            className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
          >
            {editMode ? <X className="w-5 h-5" /> : <Edit2 className="w-5 h-5" />}
            <span>{editMode ? 'Zakończ edycję' : 'Edytuj'}</span>
          </button>
          <button
            onClick={handleDownloadPDF}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#d3bb73] to-[#c1a85f] text-[#1c1f33] font-semibold rounded-lg hover:scale-105 transition-transform"
          >
            <Download className="w-5 h-5" />
            <span>Pobierz PDF</span>
          </button>
        </div>
      </div>

      {/* Brochure Preview */}
      <div id="brochure-preview" className={`${previewMode ? 'fixed inset-0 z-50 bg-[#0f1119] overflow-y-auto' : 'bg-[#0f1119] rounded-xl border border-[#d3bb73]/20'}`}>
        <div className="max-w-[210mm] mx-auto p-8 space-y-12">
          {/* Hero Section */}
          <div className="relative h-[400px] rounded-2xl overflow-hidden">
            {renderEditableImage('hero', 0, 'absolute inset-0 w-full h-full', 'Hero background')}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center z-10 px-8">
              <div className="mb-4">
                {renderEditableText('hero_title', 'Technika Estradowa', 'text-6xl font-bold text-[#d3bb73]', false)}
              </div>
              <div className="mb-6">
                {renderEditableText('hero_subtitle', 'Premium', 'text-3xl text-[#e5e4e2]', false)}
              </div>
              <div>
                {renderEditableText('hero_description', 'Twórz niezapomniane wydarzenia z najlepszym sprzętem scenicznym i profesjonalną obsługą techniczną', 'text-xl text-[#e5e4e2]/80 max-w-3xl', true)}
              </div>
            </div>
          </div>

          {/* Services Grid */}
          <div className="grid grid-cols-3 gap-6">
            {[
              { icon: '🎵', titleKey: 'sound_title', descKey: 'sound_desc', title: 'Nagłośnienie' },
              { icon: '💡', titleKey: 'light_title', descKey: 'light_desc', title: 'Oświetlenie' },
              { icon: '📺', titleKey: 'led_title', descKey: 'led_desc', title: 'Ekrany LED' },
              { icon: '🎭', titleKey: 'stage_title', descKey: 'stage_desc', title: 'Scena i konstrukcje' },
              { icon: '🎬', titleKey: 'streaming_title', descKey: 'streaming_desc', title: 'Realizacja i Streaming' },
              { icon: '⚡', titleKey: 'power_title', descKey: 'power_desc', title: 'Zasilanie i dystrybucja' },
            ].map((service) => (
              <div key={service.titleKey} className="bg-[#1c1f33]/80 backdrop-blur rounded-xl p-6 border border-[#d3bb73]/30">
                <div className="text-4xl mb-4">{service.icon}</div>
                <h3 className="text-xl font-bold text-[#d3bb73] mb-3">
                  {renderEditableText(service.titleKey, service.title, 'text-xl font-bold text-[#d3bb73]', false)}
                </h3>
                <p className="text-[#e5e4e2]/80 text-sm">
                  {renderEditableText(service.descKey, '', 'text-[#e5e4e2]/80 text-sm', true)}
                </p>
              </div>
            ))}
          </div>

          {/* Contact Section */}
          <div className="bg-[#1c1f33]/80 backdrop-blur rounded-2xl p-8 border border-[#d3bb73]/30">
            <div className="text-center mb-8">
              <h2 className="text-4xl font-bold text-[#d3bb73] mb-2">
                {renderEditableText('contact_title', 'Skontaktuj się z nami', 'text-4xl font-bold text-[#d3bb73]', false)}
              </h2>
              <p className="text-xl text-[#e5e4e2]/70">
                {renderEditableText('contact_subtitle', 'Porozmawiajmy o Twoim projekcie', 'text-xl text-[#e5e4e2]/70', false)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-8">
              {/* Contact Info */}
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
                    <p className="text-[#e5e4e2]/60 text-sm mb-1">Lokalizacja</p>
                    <p className="text-[#e5e4e2] text-xl font-semibold">
                      {renderEditableText('contact_location', 'Polska', 'text-[#e5e4e2] text-xl font-semibold', false)}
                    </p>
                    <p className="text-[#e5e4e2]/80 text-lg">
                      {renderEditableText('contact_location_desc', 'Działamy w całym kraju', 'text-[#e5e4e2]/80 text-lg', false)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Employee Info or Company */}
              <div className="flex flex-col justify-center">
                {employee ? (
                  <div className="text-center space-y-4">
                    {employee.avatar_url && (
                      <img
                        src={employee.avatar_url}
                        alt={`${employee.name} ${employee.surname}`}
                        className="w-32 h-32 rounded-full object-cover mx-auto border-4 border-[#d3bb73]/30"
                      />
                    )}
                    <div>
                      <h3 className="text-2xl font-bold text-[#e5e4e2]">
                        {employee.name} {employee.surname}
                      </h3>
                      {employee.position && (
                        <p className="text-[#d3bb73] text-lg">{employee.position}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    {renderEditableImage('contact', 0, 'w-full h-64 object-cover rounded-2xl shadow-2xl mb-4', 'Company team')}
                    <h3 className="text-3xl font-bold text-[#e5e4e2] mb-2">
                      {renderEditableText('contact_company_name', 'Mavinci Event & Art', 'text-3xl font-bold text-[#e5e4e2]', false)}
                    </h3>
                    <p className="text-[#d3bb73] text-lg font-semibold">
                      {renderEditableText('contact_company_tagline', 'Profesjonalna obsługa techniczna eventów', 'text-[#d3bb73] text-lg font-semibold', false)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
