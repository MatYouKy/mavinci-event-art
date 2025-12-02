'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Save, ArrowLeft, Upload, Eye, X } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import dynamic from 'next/dynamic';
import 'react-quill/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });

interface Logo {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
  const [showPreview, setShowPreview] = useState(false);

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
      }
    } catch (err: any) {
      console.error('Error:', err);
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

    if (!contentHtml || contentHtml.trim() === '' || contentHtml === '<p><br></p>') {
      showSnackbar('Treść szablonu nie może być pusta', 'error');
      return;
    }

    try {
      setSaving(true);

      console.log('Saving content_html (original):', contentHtml);

      const plainText = contentHtml.replace(/<[^>]*>/g, '').trim();

      let processedHtml = contentHtml;
      processedHtml = processedHtml.replace(/<p>/g, '<pre>');
      processedHtml = processedHtml.replace(/<\/p>/g, '</pre>');
      processedHtml = processedHtml.replace(/<pre><br><\/pre>/g, '<pre>\n</pre>');
      processedHtml = processedHtml.replace(/<br>/g, '\n');

      console.log('Saving content_html (processed):', processedHtml);

      const updateData = {
        content: plainText || 'Szablon umowy',
        content_html: processedHtml,
        updated_at: new Date().toISOString(),
      };

      console.log('Update data:', updateData);

      const { data, error } = await supabase
        .from('contract_templates')
        .update(updateData)
        .eq('id', templateId)
        .select();

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      console.log('Saved successfully:', data);
      showSnackbar('Szablon zapisany pomyślnie', 'success');

      await fetchTemplate();
    } catch (err: any) {
      console.error('Error saving template:', err);
      showSnackbar(err.message || 'Błąd podczas zapisywania szablonu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const modules = useMemo(
    () => ({
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
    }),
    []
  );

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

      {/* Debug Info */}
      <div className="max-w-[1200px] mx-auto px-6 pb-4">
        <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3 text-xs text-yellow-200">
          <div><strong>Debug:</strong> contentHtml length = {contentHtml?.length || 0}</div>
          <div>Has content: {contentHtml ? 'Yes' : 'No'}</div>
          <div>Preview: {contentHtml?.substring(0, 100)}...</div>
        </div>
      </div>

      {/* Editor */}
      <div className="max-w-[1200px] mx-auto px-6 py-8">
        {!showPreview ? (
          <div className="bg-white rounded-lg shadow-2xl overflow-hidden">
            {typeof window !== 'undefined' && (
              <ReactQuill
                ref={quillRef}
                theme="snow"
                value={contentHtml}
                onChange={(content, delta, source, editor) => {
                  console.log('Content changed:', content);
                  setContentHtml(content);
                }}
                modules={modules}
                formats={formats}
                className="wysiwyg-editor"
                placeholder="Wpisz treść szablonu umowy..."
                style={{
                  minHeight: '800px',
                  backgroundColor: 'white',
                }}
              />
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-2xl overflow-hidden p-12">
            <div
              className="prose prose-lg max-w-none"
              dangerouslySetInnerHTML={{ __html: contentHtml }}
              style={{
                minHeight: '800px',
                color: '#000',
                fontFamily: 'Arial, sans-serif',
                fontSize: '12pt',
                lineHeight: '1.6',
              }}
            />
          </div>
        )}
      </div>

      {/* Custom Styles */}
      <style jsx global>{`
        .wysiwyg-editor .ql-toolbar {
          background: #f8f9fa !important;
          border: 1px solid #dee2e6 !important;
          border-bottom: none !important;
          border-radius: 8px 8px 0 0 !important;
          padding: 12px !important;
        }

        .wysiwyg-editor .ql-container {
          background: white !important;
          border: 1px solid #dee2e6 !important;
          border-radius: 0 0 8px 8px !important;
          font-family: Arial, sans-serif !important;
          font-size: 12pt !important;
          line-height: 1.6 !important;
          min-height: 800px !important;
        }

        .wysiwyg-editor .ql-editor {
          min-height: 800px !important;
          padding: 40px !important;
          color: #000 !important;
        }

        .wysiwyg-editor .ql-editor p {
          margin-bottom: 1em !important;
          display: block !important;
        }

        .wysiwyg-editor .ql-editor p br {
          display: block !important;
        }

        .wysiwyg-editor .ql-editor h1,
        .wysiwyg-editor .ql-editor h2,
        .wysiwyg-editor .ql-editor h3 {
          margin-top: 1.5em !important;
          margin-bottom: 0.75em !important;
        }

        .wysiwyg-editor .ql-snow .ql-picker {
          color: #000 !important;
        }

        .wysiwyg-editor .ql-toolbar button:hover,
        .wysiwyg-editor .ql-toolbar button.ql-active {
          color: #d3bb73 !important;
        }

        .wysiwyg-editor .ql-snow.ql-toolbar button:hover .ql-stroke,
        .wysiwyg-editor .ql-snow .ql-toolbar button:hover .ql-stroke,
        .wysiwyg-editor .ql-snow.ql-toolbar button.ql-active .ql-stroke,
        .wysiwyg-editor .ql-snow .ql-toolbar button.ql-active .ql-stroke {
          stroke: #d3bb73 !important;
        }

        .wysiwyg-editor .ql-snow.ql-toolbar button:hover .ql-fill,
        .wysiwyg-editor .ql-snow .ql-toolbar button:hover .ql-fill,
        .wysiwyg-editor .ql-snow.ql-toolbar button.ql-active .ql-fill,
        .wysiwyg-editor .ql-snow .ql-toolbar button.ql-active .ql-fill {
          fill: #d3bb73 !important;
        }

        .prose p {
          margin-bottom: 1em;
        }

        .prose h1,
        .prose h2,
        .prose h3,
        .prose h4 {
          margin-top: 1.5em;
          margin-bottom: 0.75em;
          font-weight: bold;
        }

        .prose strong {
          font-weight: bold;
        }

        .prose em {
          font-style: italic;
        }

        .prose u {
          text-decoration: underline;
        }

        .prose ul,
        .prose ol {
          margin-left: 1.5em;
          margin-bottom: 1em;
        }

        .prose li {
          margin-bottom: 0.5em;
        }

        .prose blockquote {
          margin-left: 2em;
          padding-left: 1em;
          border-left: 3px solid #ccc;
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
