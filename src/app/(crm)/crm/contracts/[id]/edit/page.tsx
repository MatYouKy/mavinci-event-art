'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { Save, ArrowLeft, Eye, FileText } from 'lucide-react';
import dynamic from 'next/dynamic';
import 'react-quill/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });

export default function EditContractPage() {
  const params = useParams();
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const contractId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [contract, setContract] = useState<any>(null);
  const [editorContent, setEditorContent] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [logoSettings, setLogoSettings] = useState({
    header_logo_url: '',
    header_logo_height: 50,
    center_logo_url: '',
    center_logo_height: 100,
    show_header_logo: false,
    show_center_logo: false,
  });

  useEffect(() => {
    fetchContract();
  }, [contractId]);

  const fillPlaceholders = (content: string, contractData: any) => {
    if (!content) return '';

    let filledContent = content;

    const clientName = contractData.client?.full_name ||
      (contractData.client?.first_name && contractData.client?.last_name
        ? `${contractData.client?.first_name} ${contractData.client?.last_name}`
        : '');

    filledContent = filledContent.replace(/\{\{client_name\}\}/g, clientName || '[Imię i nazwisko klienta]');
    filledContent = filledContent.replace(/\{\{client_email\}\}/g, contractData.client?.email || '[Email klienta]');
    filledContent = filledContent.replace(/\{\{client_phone\}\}/g, contractData.client?.phone || '[Telefon klienta]');

    filledContent = filledContent.replace(/\{\{event_name\}\}/g, contractData.event?.name || '[Nazwa eventu]');
    filledContent = filledContent.replace(/\{\{event_date\}\}/g,
      contractData.event?.event_date
        ? new Date(contractData.event.event_date).toLocaleDateString('pl-PL')
        : '[Data eventu]'
    );

    filledContent = filledContent.replace(/\{\{contract_number\}\}/g, contractData.contract_number || '[Numer umowy]');
    filledContent = filledContent.replace(/\{\{total_amount\}\}/g,
      contractData.total_amount
        ? `${contractData.total_amount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN`
        : '[Kwota]'
    );
    filledContent = filledContent.replace(/\{\{date\}\}/g, new Date().toLocaleDateString('pl-PL'));

    return filledContent;
  };

  const fetchContract = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('contracts')
        .select(
          `
          *,
          client:contacts!client_id(
            id,
            full_name,
            first_name,
            last_name,
            email,
            phone
          ),
          event:events!event_id(name, event_date),
          template:contract_templates!template_id(*)
        `,
        )
        .eq('id', contractId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setContract(data);

        let content = data.content;

        if (content) {
          try {
            const parsed = typeof content === 'string' ? JSON.parse(content) : content;
            if (parsed.pages && Array.isArray(parsed.pages)) {
              content = parsed.pages
                .map((page: string) =>
                  page
                    .replace(/\\n/g, '<br/>')
                    .replace(/\n/g, '<br/>')
                )
                .join('<p style="page-break-after: always;"></p>');

              content = `<div>${content}</div>`;
            }
          } catch (e) {
            console.log('Content is not JSON, using as-is');
          }
        } else if (data.template?.content) {
          content = fillPlaceholders(data.template.content, data);
        }

        setEditorContent(content || '');
        setTotalAmount(data.total_amount?.toString() || '');

        const logos = {
          header_logo_url: data.header_logo_url || data.template?.header_logo_url || '',
          header_logo_height: data.header_logo_height || data.template?.header_logo_height || 50,
          center_logo_url: data.center_logo_url || data.template?.center_logo_url || '',
          center_logo_height: data.center_logo_height || data.template?.center_logo_height || 100,
          show_header_logo: data.show_header_logo ?? data.template?.show_header_logo ?? false,
          show_center_logo: data.show_center_logo ?? data.template?.show_center_logo ?? false,
        };

        setLogoSettings(logos);
      }
    } catch (err) {
      console.error('Error fetching contract:', err);
      showSnackbar('Błąd podczas wczytywania umowy', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      const updates: any = {
        content: editorContent,
        updated_at: new Date().toISOString(),
      };

      if (totalAmount) {
        updates.total_amount = parseFloat(totalAmount);
      }

      const { error } = await supabase.from('contracts').update(updates).eq('id', contractId);

      if (error) throw error;

      showSnackbar('Umowa zapisana pomyślnie!', 'success');
      router.push(`/crm/contracts/${contractId}`);
    } catch (err) {
      console.error('Error saving contract:', err);
      showSnackbar('Błąd podczas zapisywania umowy', 'error');
    } finally {
      setSaving(false);
    }
  };

  const modules = useMemo(
    () => ({
      toolbar: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        [{ indent: '-1' }, { indent: '+1' }],
        [{ align: [] }],
        [{ color: [] }, { background: [] }],
        ['link'],
        ['clean'],
      ],
    }),
    []
  );

  const formats = [
    'header',
    'bold',
    'italic',
    'underline',
    'strike',
    'list',
    'bullet',
    'indent',
    'align',
    'color',
    'background',
    'link',
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-[#e5e4e2]/60">Nie znaleziono umowy</div>
      </div>
    );
  }

  const clientName =
    contract.client?.full_name ||
    (contract.client?.first_name && contract.client?.last_name
      ? `${contract.client?.first_name} ${contract.client?.last_name}`
      : 'Brak klienta');

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/crm/contracts/${contractId}`)}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div>
            <h1 className="text-2xl font-light text-[#e5e4e2]">Edycja umowy</h1>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              {contract.contract_number} - {clientName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-2 rounded-lg bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]/80"
          >
            {showPreview ? <FileText className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            {showPreview ? 'Edycja' : 'Podgląd'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            <Save className="h-5 w-5" />
            {saving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="lg:col-span-3">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-center justify-between">
              <label className="text-sm font-medium text-[#e5e4e2]">Treść umowy</label>
              <div className="text-xs text-[#e5e4e2]/40">
                {showPreview ? 'Podgląd dokumentu' : 'Edycja dokumentu'}
              </div>
            </div>

            {showPreview ? (
              <div className="space-y-8">
                <div
                  className="a4-page mx-auto rounded-lg bg-white p-12 shadow-2xl"
                  style={{
                    width: '210mm',
                    minHeight: '297mm',
                    maxWidth: '100%',
                  }}
                >
                  {logoSettings.show_header_logo && logoSettings.header_logo_url && (
                    <div className="mb-8">
                      <img
                        src={logoSettings.header_logo_url}
                        alt="Logo nagłówka"
                        style={{ height: `${logoSettings.header_logo_height}px` }}
                        className="object-contain"
                      />
                    </div>
                  )}

                  {logoSettings.show_center_logo && logoSettings.center_logo_url && (
                    <div className="mb-12 text-center">
                      <img
                        src={logoSettings.center_logo_url}
                        alt="Logo"
                        style={{ height: `${logoSettings.center_logo_height}px` }}
                        className="mx-auto object-contain"
                      />
                    </div>
                  )}

                  <div
                    className="contract-preview text-black"
                    dangerouslySetInnerHTML={{ __html: editorContent || 'Brak treści' }}
                  />
                </div>
              </div>
            ) : (
              <>
                <div
                  className="a4-page-logos mx-auto"
                  style={{
                    width: '210mm',
                    maxWidth: '100%',
                    background: 'white',
                    padding: '48px 48px 0 48px',
                    borderTopLeftRadius: '8px',
                    borderTopRightRadius: '8px',
                  }}
                >
                  {logoSettings.show_header_logo && logoSettings.header_logo_url && (
                    <div className="mb-8">
                      <img
                        src={logoSettings.header_logo_url}
                        alt="Logo nagłówka"
                        style={{ height: `${logoSettings.header_logo_height}px` }}
                        className="object-contain"
                      />
                    </div>
                  )}

                  {logoSettings.show_center_logo && logoSettings.center_logo_url && (
                    <div className="mb-12 text-center">
                      <img
                        src={logoSettings.center_logo_url}
                        alt="Logo"
                        style={{ height: `${logoSettings.center_logo_height}px` }}
                        className="mx-auto object-contain"
                      />
                    </div>
                  )}
                </div>
              <div
                className="a4-page-editor mx-auto shadow-2xl"
                style={{
                  width: '210mm',
                  maxWidth: '100%',
                  marginTop: '-1px',
                }}
              >
                <style jsx global>{`
                  .a4-page-editor .ql-toolbar {
                    background: #f8f9fa;
                    border: 1px solid #e5e7eb;
                    border-bottom: none;
                  }

                  .a4-page-editor .ql-container {
                    background: white;
                    border: 1px solid #e5e7eb;
                    border-bottom-left-radius: 8px;
                    border-bottom-right-radius: 8px;
                    font-family: 'Arial', sans-serif;
                  }

                  .a4-page-editor .ql-editor {
                    min-height: calc(297mm - 96px);
                    padding: 0 48px 48px 48px;
                    color: #000000;
                    font-size: 14px;
                    line-height: 1.8;
                  }

                  .a4-page-editor .ql-editor strong {
                    font-weight: bold;
                    color: #000000;
                  }

                  .a4-page-editor .ql-editor p {
                    margin-bottom: 1em;
                    color: #000000;
                    text-align: left;
                  }

                  .a4-page-editor .ql-editor h1,
                  .a4-page-editor .ql-editor h2,
                  .a4-page-editor .ql-editor h3 {
                    font-weight: bold;
                    margin-top: 1.2em;
                    margin-bottom: 0.8em;
                    color: #000000;
                  }

                  .a4-page-editor .ql-editor h1 {
                    font-size: 20px;
                    text-align: center;
                  }

                  .a4-page-editor .ql-editor h2 {
                    font-size: 18px;
                  }

                  .a4-page-editor .ql-editor h3 {
                    font-size: 16px;
                  }

                  .a4-page-editor .ql-editor ul,
                  .a4-page-editor .ql-editor ol {
                    padding-left: 24px;
                    margin-bottom: 1em;
                    color: #000000;
                  }

                  .a4-page-editor .ql-editor li {
                    color: #000000;
                    margin-bottom: 0.5em;
                  }

                  .a4-page-editor .ql-editor.ql-blank::before {
                    color: #9ca3af;
                    font-style: italic;
                  }

                  .a4-page-editor .ql-editor .ql-align-center {
                    text-align: center;
                  }

                  .a4-page-editor .ql-editor .ql-align-right {
                    text-align: right;
                  }

                  .contract-preview {
                    font-family: 'Arial', sans-serif;
                    font-size: 14px;
                    line-height: 1.8;
                  }

                  .contract-preview p {
                    margin-bottom: 1em;
                  }

                  .contract-preview strong {
                    font-weight: bold;
                  }

                  .contract-preview h1,
                  .contract-preview h2,
                  .contract-preview h3 {
                    font-weight: bold;
                    margin-top: 1.2em;
                    margin-bottom: 0.8em;
                  }

                  .contract-preview h1 {
                    font-size: 20px;
                    text-align: center;
                  }

                  .contract-preview h2 {
                    font-size: 18px;
                  }

                  .contract-preview h3 {
                    font-size: 16px;
                  }

                  .contract-preview ul,
                  .contract-preview ol {
                    padding-left: 24px;
                    margin-bottom: 1em;
                  }

                  .contract-preview li {
                    margin-bottom: 0.5em;
                  }

                  .contract-preview .ql-align-center,
                  .contract-preview p[style*="text-align: center"] {
                    text-align: center;
                  }

                  .contract-preview .ql-align-right,
                  .contract-preview p[style*="text-align: right"] {
                    text-align: right;
                  }

                  @media print {
                    .a4-page {
                      page-break-after: always;
                      box-shadow: none;
                    }
                  }
                `}</style>
                <ReactQuill
                  theme="snow"
                  value={editorContent}
                  onChange={setEditorContent}
                  modules={modules}
                  formats={formats}
                  placeholder="Wpisz treść umowy..."
                />
              </div>
              </>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje</h2>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Klient</label>
                <div className="text-[#e5e4e2]">{clientName}</div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Event</label>
                <div className="text-[#e5e4e2]">{contract.event?.name || 'Brak'}</div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Numer umowy</label>
                <div className="text-[#e5e4e2]">{contract.contract_number}</div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wartość (PLN)</label>
                <input
                  type="number"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  placeholder="0.00"
                  step="0.01"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status</label>
                <div className="capitalize text-[#e5e4e2]">
                  {contract.status === 'draft' && 'Szkic'}
                  {contract.status === 'sent' && 'Wysłana'}
                  {contract.status === 'signed' && 'Podpisana'}
                  {contract.status === 'cancelled' && 'Anulowana'}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h3 className="mb-3 text-sm font-medium text-[#e5e4e2]">Pomoc</h3>
            <div className="space-y-2 text-xs text-[#e5e4e2]/60">
              <p>• Edytor wygląda jak strona A4</p>
              <p>• Tekst jest czarny, widoczne formatowanie</p>
              <p>• Możesz formatować jak w Wordzie</p>
              <p>• Podgląd pokazuje jak będzie wyglądać dokument</p>
              <p>• Zmiany zapisują się tylko w tej umowie</p>
            </div>
          </div>

          {logoSettings.show_header_logo && logoSettings.header_logo_url && (
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h3 className="mb-3 text-sm font-medium text-[#e5e4e2]">Logo nagłówka</h3>
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
                <img
                  src={logoSettings.header_logo_url}
                  alt="Logo nagłówka"
                  style={{ height: `${logoSettings.header_logo_height}px` }}
                  className="object-contain"
                />
              </div>
            </div>
          )}

          {logoSettings.show_center_logo && logoSettings.center_logo_url && (
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h3 className="mb-3 text-sm font-medium text-[#e5e4e2]">Logo centralne</h3>
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 text-center">
                <img
                  src={logoSettings.center_logo_url}
                  alt="Logo centralne"
                  style={{ height: `${logoSettings.center_logo_height}px` }}
                  className="mx-auto object-contain"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
