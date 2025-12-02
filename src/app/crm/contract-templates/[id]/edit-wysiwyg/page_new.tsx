'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Save, ArrowLeft, Upload, Eye, FileCode, Image as ImageIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import Draggable from 'react-draggable';
import 'react-quill/dist/quill.snow.css';
import { useSnackbar } from '@/contexts/SnackbarContext';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });

const MM_TO_PX = 3.7795275591;
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const A4_WIDTH_PX = A4_WIDTH_MM * MM_TO_PX;
const A4_HEIGHT_PX = A4_HEIGHT_MM * MM_TO_PX;

interface Logo {
  id: string;
  url: string;
  height: number;
  x: number;
  y: number;
}

interface ContractTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  content_html: string;
  logo_position: {
    custom?: Logo[];
  } | null;
  footer_content: string | null;
  is_active: boolean;
}

export default function ContractTemplateEditorPage() {
  const params = useParams();
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const templateId = params.id as string;
  const quillRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<ContractTemplate | null>(null);
  const [contentHtml, setContentHtml] = useState('');
  const [footerContent, setFooterContent] = useState('');
  const [logos, setLogos] = useState<Logo[]>([]);
  const [selectedLogo, setSelectedLogo] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  useEffect(() => {
    if (templateId) {
      fetchTemplate();
    }
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
        setContentHtml(data.content_html || '');
        setFooterContent(data.footer_content || '');
        if (data.logo_position?.custom) {
          setLogos(data.logo_position.custom);
        }
      }
    } catch (err) {
      console.error('Error fetching template:', err);
      showSnackbar('Błąd ładowania szablonu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!template) return;

    try {
      setSaving(true);
      const { error } = await supabase
        .from('contract_templates')
        .update({
          content_html: contentHtml,
          content: contentHtml.replace(/<[^>]*>/g, ''),
          footer_content: footerContent,
          logo_position: {
            custom: logos,
          },
        })
        .eq('id', templateId);

      if (error) throw error;

      showSnackbar('Szablon zapisany', 'success');
    } catch (err) {
      console.error('Error saving template:', err);
      showSnackbar('Błąd podczas zapisywania szablonu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    try {
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
      showSnackbar('Błąd podczas uploadu logo', 'error');
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

  const handleLogoMove = (id: string, x: number, y: number) => {
    setLogos((prev) =>
      prev.map((logo) => (logo.id === id ? { ...logo, x, y } : logo))
    );
  };

  const handleLogoResize = (id: string, height: number) => {
    setLogos((prev) =>
      prev.map((logo) => (logo.id === id ? { ...logo, height } : logo))
    );
  };

  const handleLogoDelete = (id: string) => {
    setLogos((prev) => prev.filter((logo) => logo.id !== id));
    if (selectedLogo === id) setSelectedLogo(null);
  };

  const modules = {
    toolbar: [
      [{ header: [false, 1, 2, 3] }],
      ['bold', 'italic', 'underline'],
      [{ align: [] }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['clean'],
    ],
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0d1a] flex items-center justify-center">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="min-h-screen bg-[#0a0d1a] flex items-center justify-center">
        <div className="text-[#e5e4e2]">Szablon nie został znaleziony</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="max-w-[900px] mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/crm/contract-templates')}
              className="p-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <div>
              <h1 className="text-2xl font-light text-[#e5e4e2]">{template.name}</h1>
              <p className="text-sm text-[#e5e4e2]/60">Edytor szablonu umowy</p>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-lg hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            <Save className="w-5 h-5" />
            {saving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>

        <div className="bg-[#2a2d3a] rounded-xl p-6">
          <div
            className="bg-white shadow-2xl mx-auto relative"
            style={{
              width: `${A4_WIDTH_PX}px`,
              minHeight: `${A4_HEIGHT_PX}px`,
            }}
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
                  style={{ zIndex: 20 }}
                >
                  <img
                    src={logo.url}
                    alt="Logo"
                    style={{ height: `${logo.height}px` }}
                    className="object-contain"
                    draggable={false}
                  />
                  <div className="absolute -top-8 left-0 hidden group-hover:flex gap-2 bg-black/80 rounded px-2 py-1">
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

            {selectedLogo && (
              <div className="absolute top-4 right-4 bg-black/90 text-white p-3 rounded-lg z-30">
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

            {isDraggingFile && (
              <div className="absolute inset-0 bg-[#d3bb73]/20 border-4 border-dashed border-[#d3bb73] flex items-center justify-center z-10">
                <div className="text-center">
                  <Upload className="w-12 h-12 text-[#d3bb73] mx-auto mb-2" />
                  <p className="text-[#d3bb73] font-medium">Upuść logo tutaj</p>
                </div>
              </div>
            )}

            <div style={{ padding: '60px 50px' }}>
              <ReactQuill
                ref={quillRef}
                theme="snow"
                value={contentHtml}
                onChange={setContentHtml}
                modules={modules}
                className="contract-editor-a4"
                placeholder="Wprowadź treść umowy..."
              />
            </div>

            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                padding: '20px 50px',
                borderTop: '1px solid #e0e0e0',
                backgroundColor: '#f9f9f9',
                minHeight: '60px',
              }}
            >
              <input
                type="text"
                value={footerContent}
                onChange={(e) => setFooterContent(e.target.value)}
                placeholder="Stopka (np. strona {{page_number}})"
                className="w-full bg-white border border-gray-300 rounded px-3 py-1 text-sm text-gray-700"
              />
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .contract-editor-a4 .ql-container {
          border: none;
          font-family: 'Calibri', Arial, sans-serif;
          font-size: 11pt;
          line-height: 1.6;
        }

        .contract-editor-a4 .ql-editor {
          min-height: ${A4_HEIGHT_PX - 200}px;
          background: white;
          color: #000;
          padding: 0;
        }

        .contract-editor-a4 .ql-editor.ql-blank::before {
          color: #999;
          font-style: italic;
        }

        .contract-editor-a4 .ql-toolbar {
          border: none;
          background: white;
          border-bottom: 2px solid #e5e4e2;
          position: sticky;
          top: 0;
          z-index: 10;
        }
      `}</style>
    </div>
  );
}
