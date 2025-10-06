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
              <div className="bg-white text-black border border-[#d3bb73]/10 rounded-xl p-8">
                {template.show_header_logo && template.header_logo_url && (
                  <div className="mb-6 pb-4 border-b border-gray-300">
                    <img
                      src={template.header_logo_url}
                      alt="Logo"
                      style={{ height: `${template.header_logo_height || 50}px` }}
                      className="object-contain"
                    />
                  </div>
                )}

                {template.show_center_logo && template.center_logo_url && (
                  <div className="mb-12 text-center">
                    <img
                      src={template.center_logo_url}
                      alt="Logo"
                      style={{ height: `${template.center_logo_height || 100}px` }}
                      className="object-contain mx-auto"
                    />
                  </div>
                )}

                <div className="whitespace-pre-wrap font-mono text-sm" style={{ whiteSpace: 'pre-wrap' }}>
                  {generatedContent}
                </div>
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
    </div>
  );
}
