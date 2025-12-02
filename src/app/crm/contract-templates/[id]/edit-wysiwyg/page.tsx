'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Save, ArrowLeft, Trash2, Upload, FileCode, Eye } from 'lucide-react';
import dynamic from 'next/dynamic';
import Draggable from 'react-draggable';
import 'react-quill/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });

interface Placeholder {
  key: string;
  label: string;
  type: string;
  style?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    color?: string;
  };
}

interface Logo {
  id: string;
  url: string;
  height: number;
  x: number;
  y: number;
}

const A4_WIDTH = 794;
const A4_HEIGHT = 1123;

export default function EditTemplateWYSIWYGPage() {
  const params = useParams();
  const router = useRouter();
  const templateId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'event',
    is_active: true,
  });
  const [contentHtml, setContentHtml] = useState('');
  const [logos, setLogos] = useState<Logo[]>([]);
  const [selectedLogo, setSelectedLogo] = useState<string | null>(null);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [showPlaceholderModal, setShowPlaceholderModal] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [pageSettings, setPageSettings] = useState({
    marginTop: 50,
    marginBottom: 50,
    marginLeft: 50,
    marginRight: 50,
  });

  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [contentLength, setContentLength] = useState(0);

  const quillRef = useRef<any>(null);

  useEffect(() => {
    fetchTemplate();
  }, [templateId]);

  useEffect(() => {
    const text = contentHtml.replace(/<[^>]*>/g, '');
    setContentLength(text.length);
  }, [contentHtml]);

  const fetchTemplate = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('contract_templates')
        .select('*')
        .eq('id', templateId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setFormData({
          name: data.name,
          description: data.description || '',
          category: data.category,
          is_active: data.is_active,
        });
        setContentHtml(data.content_html || data.content || '');
        setPlaceholders(data.placeholders || []);

        if (data.logo_position) {
          const customLogos = data.logo_position.custom || [];
          setLogos(customLogos);
        }

        if (data.page_settings) {
          setPageSettings(data.page_settings);
        }
      }
    } catch (err) {
      console.error('Error fetching template:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      alert('Nazwa szablonu jest wymagana');
      return;
    }

    try {
      setSaving(true);
      const { error } = await supabase
        .from('contract_templates')
        .update({
          name: formData.name,
          description: formData.description || null,
          content: contentHtml.replace(/<[^>]*>/g, ''),
          content_html: contentHtml,
          category: formData.category,
          is_active: formData.is_active,
          placeholders: placeholders,
          logo_position: {
            custom: logos,
          },
          page_settings: pageSettings,
        })
        .eq('id', templateId);

      if (error) throw error;

      alert('Szablon zapisany pomyślnie');
      router.push('/crm/contract-templates');
    } catch (err) {
      console.error('Error saving template:', err);
      alert('Błąd podczas zapisywania szablonu');
    } finally {
      setSaving(false);
    }
  };

  const modules = {
    toolbar: [
      [{ header: [1, 2, 3, 4, 5, 6, false] }],
      [{ font: [] }],
      [{ size: [] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ color: [] }, { background: [] }],
      [{ align: [] }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ indent: '-1' }, { indent: '+1' }],
      ['clean'],
    ],
  };

  const formats = [
    'header',
    'font',
    'size',
    'bold',
    'italic',
    'underline',
    'strike',
    'color',
    'background',
    'align',
    'list',
    'bullet',
    'indent',
  ];

  const handleLogoMove = (id: string, x: number, y: number) => {
    setLogos((prev) =>
      prev.map((logo) => (logo.id === id ? { ...logo, x, y } : logo))
    );
  };

  const handleLogoDelete = (id: string) => {
    setLogos((prev) => prev.filter((logo) => logo.id !== id));
    if (selectedLogo === id) setSelectedLogo(null);
  };

  const handleLogoResize = (id: string, height: number) => {
    setLogos((prev) =>
      prev.map((logo) => (logo.id === id ? { ...logo, height } : logo))
    );
  };

  const handleFileUpload = async (file: File) => {
    try {
      setIsUploadingLogo(true);

      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `contract-logos/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('images')
        .getPublicUrl(filePath);

      const newLogo: Logo = {
        id: Date.now().toString(),
        url: urlData.publicUrl,
        height: 60,
        x: 50,
        y: 50,
      };

      setLogos([...logos, newLogo]);
    } catch (err) {
      console.error('Error uploading logo:', err);
      alert('Błąd podczas uploadu logo');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFileUpload(file);
    }
  };

  const insertPlaceholder = (placeholder: Placeholder) => {
    if (!placeholder.key) return;

    const quill = quillRef.current?.getEditor();
    if (quill) {
      const range = quill.getSelection();
      if (range) {
        let html = `<span class="placeholder" data-key="${placeholder.key}" style="`;
        if (placeholder.style?.bold) html += 'font-weight: bold; ';
        if (placeholder.style?.italic) html += 'font-style: italic; ';
        if (placeholder.style?.underline) html += 'text-decoration: underline; ';
        if (placeholder.style?.color) html += `color: ${placeholder.style.color}; `;
        html += `background-color: #fff3cd; padding: 2px 4px; border-radius: 3px;">{{${placeholder.key}}}</span>&nbsp;`;

        const delta = quill.clipboard.convert(html);
        quill.updateContents(delta, 'user');
        quill.setSelection(range.index + 1);
      }
    }
  };

  const calculatePages = () => {
    const avgCharsPerPage = 3000;
    const estimatedPages = Math.max(1, Math.ceil(contentLength / avgCharsPerPage));
    return estimatedPages;
  };

  const numberOfPages = calculatePages();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0d1a] flex items-center justify-center">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/crm/contract-templates')}
              className="p-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <div>
              <h1 className="text-3xl font-light text-[#e5e4e2]">Edytor WYSIWYG</h1>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowPlaceholderModal(true)}
              className="flex items-center gap-2 bg-[#1c1f33] text-[#e5e4e2] px-4 py-2 rounded-lg border border-[#d3bb73]/20 hover:bg-[#1c1f33]/80"
            >
              <FileCode className="w-5 h-5" />
              Placeholdery
            </button>
            <button
              onClick={() => setShowPreview(true)}
              className="flex items-center gap-2 bg-[#1c1f33] text-[#e5e4e2] px-4 py-2 rounded-lg border border-[#d3bb73]/20 hover:bg-[#1c1f33]/80"
            >
              <Eye className="w-5 h-5" />
              Podgląd PDF
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {saving ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          </div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4 mb-6">
          <div className="grid grid-cols-4 gap-4">
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Nazwa szablonu"
              className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="event">Event</option>
              <option value="service">Usługa</option>
              <option value="rental">Wynajem</option>
              <option value="other">Inne</option>
            </select>
            <div>
              <label className="block text-xs text-[#e5e4e2]/60 mb-1">
                Margines góra: {pageSettings.marginTop}px
              </label>
              <input
                type="range"
                min="10"
                max="100"
                value={pageSettings.marginTop}
                onChange={(e) =>
                  setPageSettings({ ...pageSettings, marginTop: parseInt(e.target.value) })
                }
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-[#e5e4e2]/60 mb-1">
                Margines lewo: {pageSettings.marginLeft}px
              </label>
              <input
                type="range"
                min="10"
                max="100"
                value={pageSettings.marginLeft}
                onChange={(e) =>
                  setPageSettings({ ...pageSettings, marginLeft: parseInt(e.target.value) })
                }
                className="w-full"
              />
            </div>
          </div>
        </div>

        <div className="bg-[#2a2d3a] rounded-xl p-6 flex justify-center">
          <div className="space-y-4">
            {Array.from({ length: numberOfPages }).map((_, pageIndex) => (
              <div
                key={pageIndex}
                className="relative bg-white shadow-2xl"
                style={{
                  width: `${A4_WIDTH}px`,
                  height: `${A4_HEIGHT}px`,
                }}
              >
                <div
                  className="absolute border-2 border-dashed border-blue-300/50 pointer-events-none"
                  style={{
                    top: `${pageSettings.marginTop}px`,
                    left: `${pageSettings.marginLeft}px`,
                    right: `${pageSettings.marginRight}px`,
                    bottom: `${pageSettings.marginBottom}px`,
                  }}
                >
                  <div className="absolute -top-6 left-0 text-xs text-blue-400 font-medium">
                    {pageSettings.marginTop}px
                  </div>
                  <div className="absolute top-0 -left-16 text-xs text-blue-400 font-medium">
                    {pageSettings.marginLeft}px
                  </div>
                </div>

                {pageIndex === 0 && (
                  <div
                    className="absolute inset-0"
                    style={{
                      padding: `${pageSettings.marginTop}px ${pageSettings.marginRight}px ${pageSettings.marginBottom}px ${pageSettings.marginLeft}px`,
                    }}
                  >
                    <div
                      className={`relative w-full h-full transition-colors ${
                        isDraggingFile ? 'bg-[#d3bb73]/10 border-2 border-dashed border-[#d3bb73]' : ''
                      }`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDraggingFile(true);
                      }}
                      onDragLeave={() => setIsDraggingFile(false)}
                      onDrop={handleDrop}
                    >
                      {logos.map((logo) => (
                        <Draggable
                          key={logo.id}
                          position={{ x: logo.x, y: logo.y }}
                          onStop={(e, data) => handleLogoMove(logo.id, data.x, data.y)}
                          bounds="parent"
                        >
                          <div
                            className={`absolute cursor-move group ${
                              selectedLogo === logo.id ? 'ring-2 ring-blue-500' : ''
                            }`}
                            onClick={() => setSelectedLogo(logo.id)}
                            style={{ zIndex: 10 }}
                          >
                            <img
                              src={logo.url}
                              alt="Logo"
                              style={{ height: `${logo.height}px` }}
                              className="object-contain pointer-events-none"
                              draggable={false}
                            />
                            <div className="absolute -top-8 left-0 hidden group-hover:flex gap-1 bg-black/80 rounded px-2 py-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleLogoDelete(logo.id);
                                }}
                                className="text-xs text-white hover:text-red-400"
                              >
                                Usuń
                              </button>
                            </div>
                          </div>
                        </Draggable>
                      ))}

                      {isDraggingFile && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="text-center">
                            <Upload className="w-12 h-12 text-[#d3bb73] mx-auto mb-2" />
                            <p className="text-[#d3bb73] font-medium">
                              {isUploadingLogo ? 'Uploading...' : 'Upuść logo tutaj'}
                            </p>
                          </div>
                        </div>
                      )}

                      <ReactQuill
                        ref={quillRef}
                        theme="snow"
                        value={contentHtml}
                        onChange={setContentHtml}
                        modules={modules}
                        formats={formats}
                        placeholder="Wprowadź treść umowy..."
                        className="contract-editor"
                      />
                    </div>
                  </div>
                )}

                <div className="absolute bottom-2 right-2 text-xs text-gray-400">
                  Strona {pageIndex + 1}
                </div>

                {pageIndex === 0 && selectedLogo && (
                  <div className="absolute bottom-4 right-4 bg-black/90 text-white p-3 rounded-lg">
                    <div className="text-xs mb-2">
                      Wysokość: {logos.find((l) => l.id === selectedLogo)?.height}px
                    </div>
                    <input
                      type="range"
                      min="30"
                      max="200"
                      value={logos.find((l) => l.id === selectedLogo)?.height || 50}
                      onChange={(e) => handleLogoResize(selectedLogo, parseInt(e.target.value))}
                      className="w-32"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {showPlaceholderModal && (
        <PlaceholderModal
          placeholders={placeholders}
          setPlaceholders={setPlaceholders}
          onClose={() => setShowPlaceholderModal(false)}
          onInsert={insertPlaceholder}
        />
      )}

      {showPreview && (
        <PreviewModal
          contentHtml={contentHtml}
          logos={logos}
          pageSettings={pageSettings}
          onClose={() => setShowPreview(false)}
        />
      )}

      <style jsx global>{`
        .contract-editor .ql-container {
          border: none;
          font-size: 12px;
          font-family: 'Calibri', Arial, sans-serif;
          height: calc(100% - 42px);
          background: white;
        }
        .contract-editor .ql-editor {
          min-height: 980px;
          background: white;
          color: #000;
          padding: 20px;
        }
        .contract-editor .ql-editor.ql-blank::before {
          color: #999;
          font-style: italic;
        }
        .contract-editor .ql-toolbar {
          border: none;
          background: white;
          border-bottom: 2px solid #e5e4e2;
        }
        .contract-editor .ql-toolbar button {
          color: #333;
        }
        .contract-editor .ql-toolbar button:hover {
          color: #d3bb73;
        }
        .contract-editor .ql-toolbar .ql-stroke {
          stroke: #333;
        }
        .contract-editor .ql-toolbar .ql-fill {
          fill: #333;
        }
        .contract-editor .ql-toolbar button:hover .ql-stroke {
          stroke: #d3bb73;
        }
        .contract-editor .ql-toolbar button:hover .ql-fill {
          fill: #d3bb73;
        }
        .placeholder {
          background-color: #fff3cd;
          padding: 2px 4px;
          border-radius: 3px;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

function PlaceholderModal({
  placeholders,
  setPlaceholders,
  onClose,
  onInsert,
}: {
  placeholders: Placeholder[];
  setPlaceholders: (p: Placeholder[]) => void;
  onClose: () => void;
  onInsert: (p: Placeholder) => void;
}) {
  const addPlaceholder = () => {
    setPlaceholders([...placeholders, { key: '', label: '', type: 'text', style: {} }]);
  };

  const updatePlaceholder = (index: number, field: string, value: any) => {
    const updated = [...placeholders];
    if (field.startsWith('style.')) {
      const styleField = field.split('.')[1];
      updated[index].style = { ...updated[index].style, [styleField]: value };
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    setPlaceholders(updated);
  };

  const removePlaceholder = (index: number) => {
    setPlaceholders(placeholders.filter((_, i) => i !== index));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-light text-[#e5e4e2]">Zarządzaj Placeholderami</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] text-2xl">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 mb-6">
          {placeholders.map((placeholder, index) => (
            <div key={index} className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <input
                  type="text"
                  value={placeholder.key}
                  onChange={(e) => updatePlaceholder(index, 'key', e.target.value)}
                  placeholder="Klucz (np. client_name)"
                  className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-[#e5e4e2] text-sm"
                />
                <input
                  type="text"
                  value={placeholder.label}
                  onChange={(e) => updatePlaceholder(index, 'label', e.target.value)}
                  placeholder="Etykieta (np. Nazwa klienta)"
                  className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-[#e5e4e2] text-sm"
                />
              </div>

              <div className="flex items-center gap-4 mb-3">
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/80">
                  <input
                    type="checkbox"
                    checked={placeholder.style?.bold || false}
                    onChange={(e) => updatePlaceholder(index, 'style.bold', e.target.checked)}
                    className="w-4 h-4"
                  />
                  <strong>Pogrubienie</strong>
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/80">
                  <input
                    type="checkbox"
                    checked={placeholder.style?.italic || false}
                    onChange={(e) => updatePlaceholder(index, 'style.italic', e.target.checked)}
                    className="w-4 h-4"
                  />
                  <em>Kursywa</em>
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/80">
                  <input
                    type="checkbox"
                    checked={placeholder.style?.underline || false}
                    onChange={(e) => updatePlaceholder(index, 'style.underline', e.target.checked)}
                    className="w-4 h-4"
                  />
                  <u>Podkreślenie</u>
                </label>
                <input
                  type="color"
                  value={placeholder.style?.color || '#000000'}
                  onChange={(e) => updatePlaceholder(index, 'style.color', e.target.value)}
                  className="w-12 h-8 rounded cursor-pointer"
                  title="Kolor tekstu"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onInsert(placeholder);
                    onClose();
                  }}
                  disabled={!placeholder.key}
                  className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded text-sm font-medium hover:bg-[#d3bb73]/90 disabled:opacity-50"
                >
                  Wstaw w dokument
                </button>
                <button
                  onClick={() => removePlaceholder(index)}
                  className="px-4 py-2 text-red-400 hover:text-red-300 rounded border border-red-400/20"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={addPlaceholder}
            className="flex-1 bg-[#1c1f33] text-[#e5e4e2] px-4 py-2 rounded-lg border border-[#d3bb73]/20 hover:bg-[#1c1f33]/80"
          >
            + Dodaj placeholder
          </button>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewModal({
  contentHtml,
  logos,
  pageSettings,
  onClose,
}: {
  contentHtml: string;
  logos: Logo[];
  pageSettings: { marginTop: number; marginBottom: number; marginLeft: number; marginRight: number };
  onClose: () => void;
}) {
  const calculatePages = () => {
    const text = contentHtml.replace(/<[^>]*>/g, '');
    const avgCharsPerPage = 3000;
    return Math.max(1, Math.ceil(text.length / avgCharsPerPage));
  };

  const numberOfPages = calculatePages();

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#2a2d3a] rounded-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-[#d3bb73]/20">
          <h2 className="text-2xl font-light text-[#e5e4e2]">Podgląd PDF</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] text-2xl">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex justify-center">
            <div className="space-y-4">
              {Array.from({ length: numberOfPages }).map((_, pageIndex) => (
                <div
                  key={pageIndex}
                  className="relative bg-white shadow-2xl"
                  style={{
                    width: `${A4_WIDTH}px`,
                    height: `${A4_HEIGHT}px`,
                  }}
                >
                  {pageIndex === 0 && (
                    <div
                      className="absolute inset-0"
                      style={{
                        padding: `${pageSettings.marginTop}px ${pageSettings.marginRight}px ${pageSettings.marginBottom}px ${pageSettings.marginLeft}px`,
                      }}
                    >
                      {logos.map((logo) => (
                        <div
                          key={logo.id}
                          className="absolute"
                          style={{
                            left: `${logo.x}px`,
                            top: `${logo.y}px`,
                            zIndex: 10,
                          }}
                        >
                          <img
                            src={logo.url}
                            alt="Logo"
                            style={{ height: `${logo.height}px` }}
                            className="object-contain"
                          />
                        </div>
                      ))}

                      <div
                        className="contract-preview-content"
                        dangerouslySetInnerHTML={{ __html: contentHtml }}
                      />
                    </div>
                  )}

                  <div className="absolute bottom-2 right-2 text-xs text-gray-400">
                    Strona {pageIndex + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-[#d3bb73]/20">
          <button
            onClick={onClose}
            className="w-full bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg font-medium hover:bg-[#d3bb73]/90"
          >
            Zamknij podgląd
          </button>
        </div>
      </div>

      <style jsx>{`
        .contract-preview-content {
          font-size: 11pt;
          font-family: 'Calibri', Arial, sans-serif;
          line-height: 1.6;
          color: #000;
          text-align: justify;
        }
        .contract-preview-content p {
          margin: 0 0 12px 0;
        }
        .contract-preview-content h1,
        .contract-preview-content h2,
        .contract-preview-content h3 {
          margin: 16px 0 8px 0;
          font-weight: 600;
        }
        .contract-preview-content ul,
        .contract-preview-content ol {
          margin: 0 0 12px 0;
          padding-left: 24px;
        }
        .contract-preview-content strong,
        .contract-preview-content b {
          font-weight: 600;
        }
        .contract-preview-content :global(.placeholder) {
          background-color: #fff3cd;
          padding: 2px 4px;
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
}
