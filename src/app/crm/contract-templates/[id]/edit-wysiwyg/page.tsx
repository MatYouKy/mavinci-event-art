'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Save, ArrowLeft, Upload, Eye, Image as ImageIcon, X } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import dynamic from 'next/dynamic';
import Draggable from 'react-draggable';
import 'react-quill/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });

interface Logo {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

export default function EditTemplateWYSIWYGPage() {
  const params = useParams();
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const templateId = params.id as string;
  const quillRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<any>(null);
  const [contentHtml, setContentHtml] = useState('');
  const [logos, setLogos] = useState<Logo[]>([]);
  const [selectedLogo, setSelectedLogo] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [pageSettings, setPageSettings] = useState({
    marginTop: 50,
    marginBottom: 50,
    marginLeft: 50,
    marginRight: 50,
  });

  useEffect(() => {
    fetchTemplate();
  }, [templateId]);

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
        setTemplate(data);
        setContentHtml(data.content_html || data.content || '');
        setLogos(data.logo_positions || []);
        if (data.page_settings) {
          setPageSettings(data.page_settings);
        }
      }
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd ładowania szablonu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!template?.name.trim()) {
      showSnackbar('Nazwa szablonu jest wymagana', 'error');
      return;
    }

    try {
      setSaving(true);

      // Wyciągnij czysty tekst z HTML
      const plainText = contentHtml.replace(/<[^>]*>/g, '');

      const { error } = await supabase
        .from('contract_templates')
        .update({
          content: plainText,
          content_html: contentHtml,
          logo_positions: logos,
          page_settings: pageSettings,
          updated_at: new Date().toISOString(),
        })
        .eq('id', templateId);

      if (error) throw error;

      showSnackbar('Szablon zapisany', 'success');
      fetchTemplate();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd podczas zapisywania szablonu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showSnackbar('Wybierz plik graficzny (PNG, JPG)', 'error');
      return;
    }

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${templateId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('contract-logos')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('contract-logos')
        .getPublicUrl(fileName);

      const newLogo: Logo = {
        id: Date.now().toString(),
        url: publicUrl,
        x: 50,
        y: 50,
        width: 150,
        height: 60,
        page: 1,
      };

      setLogos([...logos, newLogo]);
      showSnackbar('Logo dodane', 'success');
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd podczas uploadu logo', 'error');
    }
  };

  const handleDeleteLogo = (logoId: string) => {
    setLogos(logos.filter((l) => l.id !== logoId));
    if (selectedLogo === logoId) {
      setSelectedLogo(null);
    }
  };

  const handleLogoPositionChange = (logoId: string, x: number, y: number) => {
    setLogos(
      logos.map((logo) =>
        logo.id === logoId ? { ...logo, x, y } : logo
      )
    );
  };

  const handleLogoSizeChange = (logoId: string, width: number, height: number) => {
    setLogos(
      logos.map((logo) =>
        logo.id === logoId ? { ...logo, width, height } : logo
      )
    );
  };

  const quillModules = {
    toolbar: [
      [{ header: [1, 2, 3, 4, 5, 6, false] }],
      [{ font: [] }],
      [{ size: ['small', false, 'large', 'huge'] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ color: [] }, { background: [] }],
      [{ script: 'sub' }, { script: 'super' }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ indent: '-1' }, { indent: '+1' }],
      [{ align: [] }],
      ['blockquote', 'code-block'],
      ['link'],
      ['clean'],
    ],
  };

  const quillFormats = [
    'header',
    'font',
    'size',
    'bold',
    'italic',
    'underline',
    'strike',
    'color',
    'background',
    'script',
    'list',
    'bullet',
    'indent',
    'align',
    'blockquote',
    'code-block',
    'link',
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0b14] flex items-center justify-center">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="min-h-screen bg-[#0a0b14] flex items-center justify-center">
        <div className="text-[#e5e4e2]">Szablon nie został znaleziony</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0b14]">
      {/* Header */}
      <div className="bg-[#1c1f33] border-b border-[#d3bb73]/20 sticky top-0 z-40">
        <div className="max-w-[1400px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/crm/contract-templates')}
                className="p-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-xl font-light text-[#e5e4e2]">{template.name}</h1>
                <p className="text-sm text-[#e5e4e2]/40">Edytor WYSIWYG</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-2 px-4 py-2 text-[#e5e4e2] border border-[#d3bb73]/20 rounded-lg hover:bg-[#d3bb73]/10 transition-colors"
              >
                <Eye className="w-4 h-4" />
                {showPreview ? 'Edycja' : 'Podgląd'}
              </button>

              <label className="flex items-center gap-2 px-4 py-2 text-[#e5e4e2] border border-[#d3bb73]/20 rounded-lg hover:bg-[#d3bb73]/10 transition-colors cursor-pointer">
                <Upload className="w-4 h-4" />
                Dodaj logo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
              </label>

              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Zapisywanie...' : 'Zapisz'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="bg-white rounded-lg shadow-2xl overflow-hidden">
          {/* A4 Page Container */}
          <div
            className="relative mx-auto bg-white"
            style={{
              width: '210mm',
              minHeight: '297mm',
              padding: `${pageSettings.marginTop}px ${pageSettings.marginRight}px ${pageSettings.marginBottom}px ${pageSettings.marginLeft}px`,
              boxShadow: '0 0 20px rgba(0,0,0,0.1)',
            }}
          >
            {/* Draggable Logos */}
            {logos.map((logo) => (
              <Draggable
                key={logo.id}
                position={{ x: logo.x, y: logo.y }}
                onStop={(e, data) => handleLogoPositionChange(logo.id, data.x, data.y)}
                bounds="parent"
              >
                <div
                  className={`absolute cursor-move group ${
                    selectedLogo === logo.id ? 'ring-2 ring-[#d3bb73]' : ''
                  }`}
                  onClick={() => setSelectedLogo(logo.id)}
                  style={{
                    width: logo.width,
                    height: logo.height,
                  }}
                >
                  <img
                    src={logo.url}
                    alt="Logo"
                    className="w-full h-full object-contain"
                    draggable={false}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteLogo(logo.id);
                    }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  {selectedLogo === logo.id && (
                    <div className="absolute -bottom-12 left-0 bg-[#1c1f33] border border-[#d3bb73]/20 rounded p-2 flex gap-2 z-50">
                      <input
                        type="number"
                        value={logo.width}
                        onChange={(e) =>
                          handleLogoSizeChange(logo.id, parseInt(e.target.value) || 150, logo.height)
                        }
                        className="w-16 bg-[#0f1119] border border-[#d3bb73]/20 rounded px-2 py-1 text-xs text-[#e5e4e2]"
                        placeholder="Szerokość"
                      />
                      <input
                        type="number"
                        value={logo.height}
                        onChange={(e) =>
                          handleLogoSizeChange(logo.id, logo.width, parseInt(e.target.value) || 60)
                        }
                        className="w-16 bg-[#0f1119] border border-[#d3bb73]/20 rounded px-2 py-1 text-xs text-[#e5e4e2]"
                        placeholder="Wysokość"
                      />
                    </div>
                  )}
                </div>
              </Draggable>
            ))}

            {/* Quill Editor */}
            {!showPreview ? (
              <div className="relative z-10">
                <ReactQuill
                  ref={quillRef}
                  theme="snow"
                  value={contentHtml}
                  onChange={setContentHtml}
                  modules={quillModules}
                  formats={quillFormats}
                  style={{
                    minHeight: '800px',
                    backgroundColor: 'white',
                  }}
                />
              </div>
            ) : (
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: contentHtml }}
                style={{
                  minHeight: '800px',
                  color: '#000',
                  fontFamily: 'Arial, sans-serif',
                  fontSize: '12pt',
                  lineHeight: '1.6',
                }}
              />
            )}
          </div>
        </div>

        {/* Settings Panel */}
        <div className="mt-6 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-6">
          <h3 className="text-lg font-light text-[#e5e4e2] mb-4">Ustawienia strony A4</h3>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Margines górny (px)</label>
              <input
                type="number"
                value={pageSettings.marginTop}
                onChange={(e) =>
                  setPageSettings({ ...pageSettings, marginTop: parseInt(e.target.value) || 0 })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2]"
              />
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Margines dolny (px)</label>
              <input
                type="number"
                value={pageSettings.marginBottom}
                onChange={(e) =>
                  setPageSettings({ ...pageSettings, marginBottom: parseInt(e.target.value) || 0 })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2]"
              />
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Margines lewy (px)</label>
              <input
                type="number"
                value={pageSettings.marginLeft}
                onChange={(e) =>
                  setPageSettings({ ...pageSettings, marginLeft: parseInt(e.target.value) || 0 })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2]"
              />
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Margines prawy (px)</label>
              <input
                type="number"
                value={pageSettings.marginRight}
                onChange={(e) =>
                  setPageSettings({ ...pageSettings, marginRight: parseInt(e.target.value) || 0 })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>
        </div>

        {/* Logo List */}
        {logos.length > 0 && (
          <div className="mt-6 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-6">
            <h3 className="text-lg font-light text-[#e5e4e2] mb-4">
              Dodane loga i grafiki ({logos.length})
            </h3>
            <div className="grid grid-cols-4 gap-4">
              {logos.map((logo) => (
                <div
                  key={logo.id}
                  className={`relative border rounded-lg p-2 cursor-pointer transition-colors ${
                    selectedLogo === logo.id
                      ? 'border-[#d3bb73] bg-[#d3bb73]/5'
                      : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                  onClick={() => setSelectedLogo(logo.id)}
                >
                  <img
                    src={logo.url}
                    alt="Logo"
                    className="w-full h-20 object-contain mb-2"
                  />
                  <div className="text-xs text-[#e5e4e2]/60">
                    {logo.width} × {logo.height} px
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteLogo(logo.id);
                    }}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Custom Quill Styles */}
      <style jsx global>{`
        .ql-toolbar {
          background: #f8f9fa !important;
          border: 1px solid #dee2e6 !important;
          border-bottom: none !important;
          border-radius: 8px 8px 0 0 !important;
          padding: 12px !important;
        }

        .ql-container {
          background: white !important;
          border: 1px solid #dee2e6 !important;
          border-radius: 0 0 8px 8px !important;
          font-family: Arial, sans-serif !important;
          font-size: 12pt !important;
          line-height: 1.6 !important;
        }

        .ql-editor {
          min-height: 800px !important;
          padding: 20px !important;
          color: #000 !important;
        }

        .ql-editor p {
          margin-bottom: 1em !important;
        }

        .ql-editor h1,
        .ql-editor h2,
        .ql-editor h3 {
          margin-top: 1em !important;
          margin-bottom: 0.5em !important;
        }

        .ql-snow .ql-picker {
          color: #000 !important;
        }

        .ql-toolbar button:hover,
        .ql-toolbar button.ql-active {
          color: #d3bb73 !important;
        }

        .ql-snow.ql-toolbar button:hover .ql-stroke,
        .ql-snow .ql-toolbar button:hover .ql-stroke,
        .ql-snow.ql-toolbar button.ql-active .ql-stroke,
        .ql-snow .ql-toolbar button.ql-active .ql-stroke {
          stroke: #d3bb73 !important;
        }
      `}</style>
    </div>
  );
}
