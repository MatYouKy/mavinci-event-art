'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { ArrowLeft, Edit, Printer } from 'lucide-react';

interface ContractTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  content_html: string | null;
  category: string;
  placeholders: any[];
  logo_positions: any[] | null;
  page_settings: any | null;
  is_active: boolean;
  created_at: string;
}

export default function ContractTemplateViewPage() {
  const router = useRouter();
  const params = useParams();
  const templateId = params?.id as string;
  const [template, setTemplate] = useState<ContractTemplate | null>(null);
  const [loading, setLoading] = useState(true);

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
        .single();

      if (error) throw error;
      setTemplate(data);
    } catch (err) {
      console.error('Error fetching template:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]">Szablon nie został znaleziony</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a]">
      <div className="mx-auto max-w-5xl p-6 print:p-0">
        <div className="mb-6 flex items-center justify-between print:hidden">
          <button
            onClick={() => router.push('/crm/contract-templates')}
            className="flex items-center gap-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <ArrowLeft className="h-5 w-5" />
            Powrót do listy
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(`/crm/contract-templates/${templateId}/edit-wysiwyg`)}
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] hover:bg-[#d3bb73]/5"
            >
              <Edit className="h-4 w-4" />
              Edytuj
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              <Printer className="h-4 w-4" />
              Drukuj
            </button>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 print:hidden">
          <h1 className="mb-2 text-2xl font-light text-[#e5e4e2]">{template.name}</h1>
          {template.description && <p className="mb-4 text-[#e5e4e2]/60">{template.description}</p>}
          <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/40">
            <span
              className={`rounded px-2 py-1 ${
                template.is_active
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-gray-500/20 text-gray-400'
              }`}
            >
              {template.is_active ? 'Aktywny' : 'Nieaktywny'}
            </span>
            <span>Kategoria: {template.category}</span>
            <span>Utworzono: {new Date(template.created_at).toLocaleDateString('pl-PL')}</span>
          </div>
        </div>

        <div className="contract-document bg-white shadow-lg print:shadow-none">
          <div className="contract-header mb-8 text-center">
            <img
              src="/erulers_logo_vect.png"
              alt="EVENT RULERS"
              className="mx-auto mb-4"
              style={{ height: '60px' }}
            />
          </div>

          {/* Render logos */}
          {template.logo_positions && template.logo_positions.length > 0 && (
            <div className="logos-container">
              {template.logo_positions.map((logo: any) => (
                <img
                  key={logo.id}
                  src={logo.url}
                  alt="Logo"
                  style={{
                    position: 'absolute',
                    left: `${logo.x}px`,
                    top: `${logo.y}px`,
                    width: `${logo.width}px`,
                    height: `${logo.height}px`,
                    objectFit: 'contain',
                  }}
                />
              ))}
            </div>
          )}

          {/* Render content */}
          {template.page_settings?.pages ? (
            <div className="contract-pages">
              {template.page_settings.pages.map((pageContent: string, pageIndex: number) => (
                <div
                  key={pageIndex}
                  className="contract-page"
                  style={{
                    minHeight: '297mm',
                    width: '210mm',
                    padding: '20mm',
                    marginBottom:
                      pageIndex < template.page_settings.pages.length - 1 ? '10mm' : '0',
                    pageBreakAfter:
                      pageIndex < template.page_settings.pages.length - 1 ? 'always' : 'auto',
                    background: 'white',
                    position: 'relative',
                  }}
                >
                  <div
                    className="contract-content prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: pageContent }}
                  />

                  <div
                    style={{
                      position: 'absolute',
                      bottom: '15mm',
                      left: '20mm',
                      right: '20mm',
                      textAlign: 'center',
                      fontSize: '10pt',
                      color: '#666',
                      borderTop: '1px solid #ddd',
                      paddingTop: '10px',
                    }}
                  >
                    <div
                      style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}
                    >
                      <img
                        src="/erulers_logo_vect.png"
                        alt="EVENT RULERS"
                        style={{ height: '30px' }}
                      />
                    </div>
                    <p style={{ margin: 0 }}>
                      <strong>EVENT RULERS</strong> – <em>Więcej niż Wodzireje!</em>
                    </p>
                    <p style={{ margin: '5px 0 0 0' }}>
                      www.eventrulers.pl | biuro@eventrulers.pl | tel: 698-212-279
                    </p>
                    {pageIndex > 0 && template.page_settings.pages.length > 1 && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '-25px',
                          right: '0',
                          fontSize: '10pt',
                          color: '#666',
                        }}
                      >
                        Strona {pageIndex + 1}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : template.content_html ? (
            <div
              className="contract-content prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: template.content_html }}
            />
          ) : (
            <pre className="contract-content-plain">{template.content}</pre>
          )}
        </div>
      </div>

      <style jsx global>{`
        .contract-document {
          max-width: 210mm;
          margin: 0 auto;
          padding: 40mm 25mm;
          font-family: 'Arial', sans-serif;
          font-size: 12pt;
          line-height: 1.6;
          color: #000;
          position: relative;
        }

        .logos-container {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          pointer-events: none;
        }

        .contract-content {
          position: relative;
          z-index: 1;
        }

        .contract-content p {
          margin-bottom: 1em;
          text-align: justify;
        }

        .contract-content h1,
        .contract-content h2,
        .contract-content h3,
        .contract-content h4 {
          margin-top: 1.5em;
          margin-bottom: 0.5em;
          font-weight: bold;
        }

        .contract-content h1 {
          font-size: 18pt;
        }

        .contract-content h2 {
          font-size: 16pt;
        }

        .contract-content h3 {
          font-size: 14pt;
        }

        .contract-content ul,
        .contract-content ol {
          margin-left: 1.5em;
          margin-bottom: 1em;
        }

        .contract-content li {
          margin-bottom: 0.5em;
        }

        .contract-content strong {
          font-weight: bold;
        }

        .contract-content em {
          font-style: italic;
        }

        .contract-content u {
          text-decoration: underline;
        }

        .contract-content blockquote {
          margin-left: 2em;
          padding-left: 1em;
          border-left: 3px solid #ccc;
          font-style: italic;
        }

        .contract-content-plain {
          font-family: 'Calibri', 'Arial', sans-serif;
          font-size: 11pt;
          line-height: 1.6;
          white-space: pre-wrap;
          word-wrap: break-word;
          margin: 0;
        }

        .contract-content strong,
        .contract-content b {
          font-weight: 600;
        }

        .contract-content div[style*='text-align: center'] {
          text-align: center;
        }

        .contract-content table {
          width: 100%;
          border-collapse: collapse;
        }

        .contract-content br {
          display: block;
          content: '';
          margin-top: 0.5em;
        }

        @media print {
          body {
            background: white;
          }

          .print\\:hidden {
            display: none !important;
          }

          .contract-document {
            position: absolute;
            left: 0;
            top: 0;
            width: 210mm;
            min-height: 297mm;
            margin: 0;
            padding: 20mm 25mm;
            background: white;
            box-shadow: none;
            page-break-after: always;
          }

          .contract-header img {
            height: 50px;
          }

          .contract-content,
          .contract-content-plain {
            font-size: 11pt;
            line-height: 1.5;
          }

          @page {
            size: A4;
            margin: 0;
          }
        }

        @media screen {
          .contract-document {
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          }
        }
      `}</style>
    </div>
  );
}
