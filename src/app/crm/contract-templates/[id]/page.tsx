'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Edit, Printer } from 'lucide-react';

interface ContractTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  category: string;
  placeholders: any[];
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
    <div className="min-h-screen bg-[#0a0d1a]">
      <div className="max-w-5xl mx-auto p-6 print:p-0">
        <div className="flex items-center justify-between mb-6 print:hidden">
          <button
            onClick={() => router.push('/crm/contract-templates')}
            className="flex items-center gap-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <ArrowLeft className="w-5 h-5" />
            Powrót do listy
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(`/crm/contract-templates/${templateId}/edit-wysiwyg`)}
              className="flex items-center gap-2 px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] hover:bg-[#d3bb73]/5"
            >
              <Edit className="w-4 h-4" />
              Edytuj
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
            >
              <Printer className="w-4 h-4" />
              Drukuj
            </button>
          </div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 mb-6 print:hidden">
          <h1 className="text-2xl font-light text-[#e5e4e2] mb-2">{template.name}</h1>
          {template.description && (
            <p className="text-[#e5e4e2]/60 mb-4">{template.description}</p>
          )}
          <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/40">
            <span
              className={`px-2 py-1 rounded ${
                template.is_active
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-gray-500/20 text-gray-400'
              }`}
            >
              {template.is_active ? 'Aktywny' : 'Nieaktywny'}
            </span>
            <span>Kategoria: {template.category}</span>
            <span>
              Utworzono: {new Date(template.created_at).toLocaleDateString('pl-PL')}
            </span>
          </div>
        </div>

        <div className="contract-document bg-white shadow-lg print:shadow-none">
          <div className="contract-header text-center mb-8">
            <img
              src="/erulers_logo_vect.png"
              alt="EVENT RULERS"
              className="mx-auto mb-4"
              style={{ height: '60px' }}
            />
          </div>
          <div
            className="contract-content"
            dangerouslySetInnerHTML={{ __html: template.content }}
          />
        </div>
      </div>

      <style jsx global>{`
        .contract-document {
          max-width: 210mm;
          margin: 0 auto;
          padding: 40mm 25mm;
          font-family: 'Calibri', 'Arial', sans-serif;
          font-size: 11pt;
          line-height: 1.6;
          color: #000;
        }

        .contract-content {
          text-align: justify;
        }

        .contract-content strong,
        .contract-content b {
          font-weight: 600;
        }

        .contract-content div[style*="text-align: center"] {
          text-align: center;
        }

        .contract-content table {
          width: 100%;
          border-collapse: collapse;
        }

        .contract-content br {
          display: block;
          content: "";
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

          .contract-content {
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
