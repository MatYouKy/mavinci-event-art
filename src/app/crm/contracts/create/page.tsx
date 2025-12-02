'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Save, ArrowLeft, Eye } from 'lucide-react';

export default function CreateContractPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get('template');
  const clientId = searchParams.get('client');
  const eventId = searchParams.get('event');
  const initialTitle = searchParams.get('title');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<any>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [generatedContent, setGeneratedContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [contractData, setContractData] = useState({
    title: initialTitle || '',
    valid_from: '',
    valid_until: '',
    notes: '',
  });

  useEffect(() => {
    if (templateId) {
      fetchTemplate();
    }
  }, [templateId]);

  useEffect(() => {
    if (clientId) fetchClientData();
  }, [clientId]);

  useEffect(() => {
    if (eventId) fetchEventData();
  }, [eventId]);

  useEffect(() => {
    generateContent();
  }, [formData, template]);

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
        const initialData: Record<string, any> = {};
        data.placeholders?.forEach((p: any) => {
          initialData[p.key] = '';
        });
        setFormData(initialData);
      }
    } catch (err) {
      console.error('Error fetching template:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchClientData = async () => {
    try {
      const { data } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .maybeSingle();

      if (data) {
        setFormData((prev) => ({
          ...prev,
          client_name: data.company_name || `${data.first_name} ${data.last_name}`,
          client_address: data.address || '',
          client_nip: data.nip || '',
          client_representative: data.contact_person || '',
        }));
      }
    } catch (err) {
      console.error('Error fetching client:', err);
    }
  };

  const fetchEventData = async () => {
    try {
      const { data } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .maybeSingle();

      if (data) {
        setFormData((prev) => ({
          ...prev,
          event_name: data.name || '',
          event_date: data.event_date
            ? new Date(data.event_date).toLocaleDateString('pl-PL')
            : '',
          event_location: data.location || '',
        }));
      }
    } catch (err) {
      console.error('Error fetching event:', err);
    }
  };

  const generateContent = () => {
    if (!template) return;

    let content = template.content;
    Object.keys(formData).forEach((key) => {
      const placeholder = `{{${key}}}`;
      const value = formData[key] || `[${key}]`;
      content = content.replaceAll(placeholder, value);
    });

    setGeneratedContent(content);
  };

  const handleSave = async () => {
    if (!contractData.title.trim()) {
      alert('Tytuł umowy jest wymagany');
      return;
    }

    try {
      setSaving(true);

      const { data, error } = await supabase
        .from('contracts')
        .insert([
          {
            template_id: templateId,
            client_id: clientId || null,
            event_id: eventId || null,
            title: contractData.title,
            content: generatedContent,
            status: 'draft',
            generated_data: formData,
            valid_from: contractData.valid_from || null,
            valid_until: contractData.valid_until || null,
            notes: contractData.notes || null,
            header_logo_url: template.header_logo_url || null,
            header_logo_height: template.header_logo_height || null,
            center_logo_url: template.center_logo_url || null,
            center_logo_height: template.center_logo_height || null,
            show_header_logo: template.show_header_logo || false,
            show_center_logo: template.show_center_logo || false,
          },
        ])
        .select();

      if (error) throw error;

      if (data && data[0]) {
        alert(`Utworzono umowę: ${data[0].contract_number}`);
        router.push(`/crm/contracts/${data[0].id}`);
      }
    } catch (err) {
      console.error('Error saving contract:', err);
      alert('Błąd podczas zapisywania umowy');
    } finally {
      setSaving(false);
    }
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
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/crm/contracts')}
              className="p-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <div>
              <h1 className="text-3xl font-light text-[#e5e4e2] mb-2">
                Generuj umowę
              </h1>
              <p className="text-[#e5e4e2]/60">
                Szablon: {template.name}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="flex items-center gap-2 bg-[#1c1f33] text-[#e5e4e2] px-4 py-2 rounded-lg hover:bg-[#1c1f33]/80 transition-colors"
            >
              <Eye className="w-5 h-5" />
              {showPreview ? 'Formularz' : 'Podgląd'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {saving ? 'Zapisywanie...' : 'Zapisz umowę'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {showPreview ? (
              <div className="contract-a4-container-create">
                {generatedContent.split('\n\n').reduce((pages: any[], paragraph, idx, arr) => {
                  const currentPage = pages[pages.length - 1];
                  const paragraphLines = paragraph.split('\n').length;

                  if (!currentPage || currentPage.lines + paragraphLines > 35) {
                    pages.push({ content: [paragraph], lines: paragraphLines });
                  } else {
                    currentPage.content.push(paragraph);
                    currentPage.lines += paragraphLines;
                  }

                  return pages;
                }, [{ content: [], lines: 0 }]).map((page, pageIndex, allPages) => (
                  <div key={pageIndex} className="contract-a4-page-create">
                    {pageIndex === 0 && (
                      <>
                        <div className="contract-header-logo-create">
                          <img src="/erulers_logo_vect.png" alt="EVENT RULERS" />
                        </div>

                        <div className="contract-current-date-create">
                          {new Date().toLocaleDateString('pl-PL', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </div>
                      </>
                    )}

                    <div
                      className="contract-content-create"
                      style={{
                        whiteSpace: 'pre-wrap',
                        marginTop: pageIndex === 0 ? '80mm' : '20mm'
                      }}
                    >
                      {page.content.join('\n\n')}
                    </div>

                    <div className="contract-footer-create">
                      <div className="footer-logo-create">
                        <img src="/erulers_logo_vect.png" alt="EVENT RULERS" />
                      </div>
                      <div className="footer-info-create">
                        <p>EVENT RULERS – Więcej niż Wodzireje!</p>
                        <p>www.eventrulers.pl | biuro@eventrulers.pl</p>
                        <p>tel: 698-212-279</p>
                        <p style={{ marginTop: '8px', fontSize: '9pt', color: '#999' }}>
                          Strona {pageIndex + 1} z {allPages.length}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
                  <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
                    Informacje o umowie
                  </h2>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                        Tytuł umowy *
                      </label>
                      <input
                        type="text"
                        value={contractData.title}
                        onChange={(e) =>
                          setContractData({ ...contractData, title: e.target.value })
                        }
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                          Ważna od
                        </label>
                        <input
                          type="date"
                          value={contractData.valid_from}
                          onChange={(e) =>
                            setContractData({
                              ...contractData,
                              valid_from: e.target.value,
                            })
                          }
                          className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                        />
                      </div>

                      <div>
                        <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                          Ważna do
                        </label>
                        <input
                          type="date"
                          value={contractData.valid_until}
                          onChange={(e) =>
                            setContractData({
                              ...contractData,
                              valid_until: e.target.value,
                            })
                          }
                          className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                        Notatki
                      </label>
                      <textarea
                        value={contractData.notes}
                        onChange={(e) =>
                          setContractData({ ...contractData, notes: e.target.value })
                        }
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] h-20 resize-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
                  <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
                    Dane do umowy
                  </h2>

                  <div className="space-y-4">
                    {template.placeholders?.map((placeholder: any) => (
                      <div key={placeholder.key}>
                        <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                          {placeholder.label}
                        </label>
                        {placeholder.type === 'textarea' ? (
                          <textarea
                            value={formData[placeholder.key] || ''}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                [placeholder.key]: e.target.value,
                              })
                            }
                            className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] h-24 resize-none"
                          />
                        ) : (
                          <input
                            type={placeholder.type}
                            value={formData[placeholder.key] || ''}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                [placeholder.key]: e.target.value,
                              })
                            }
                            className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 sticky top-6">
              <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Podgląd na żywo</h2>
              <div className="bg-white text-black rounded-lg p-4 max-h-[calc(100vh-200px)] overflow-y-auto">
                <div className="whitespace-pre-wrap text-xs font-mono" style={{ whiteSpace: 'pre-wrap' }}>
                  {generatedContent.slice(0, 1000)}...
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
      .contract-a4-container-create {
        background: #f5f5f5;
        padding: 20px;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .contract-a4-page-create {
        position: relative;
        width: 210mm;
        height: 297mm;
        margin: 0 auto;
        padding: 20mm 25mm 40mm 25mm;
        background: white;
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
        font-family: Arial, sans-serif;
        font-size: 12pt;
        line-height: 1.6;
        color: #000;
        overflow: hidden;
        page-break-after: always;
      }

      .contract-header-logo-create {
        position: absolute;
        top: 15mm;
        left: 50%;
        transform: translateX(-50%);
        width: 80%;
        height: 60mm;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .contract-header-logo-create img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }

      .contract-current-date-create {
        position: absolute;
        top: 15mm;
        right: 25mm;
        font-size: 10pt;
        color: #333;
        font-weight: 500;
      }

      .contract-content-create {
        margin-top: 80mm;
        text-align: justify;
        color: #000;
        white-space: pre-wrap;
        font-family: Arial, sans-serif;
        font-size: 12pt;
        line-height: 1.6;
      }

      .contract-footer-create {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 180px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 25mm;
        background: white;
        border-top: 3px solid #d3bb73;
        box-shadow: 0 -4px 6px -1px rgba(0, 0, 0, 0.05);
      }

      .footer-logo-create {
        flex-shrink: 0;
        width: 120px;
        height: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .footer-logo-create img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }

      .footer-info-create {
        text-align: right;
        font-size: 10pt;
        color: #333;
        line-height: 1.4;
      }

      .footer-info-create p {
        margin: 4px 0;
        color: #333;
      }
      `}</style>
    </div>
  );
}
