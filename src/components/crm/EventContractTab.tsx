'use client';

import { useState, useEffect } from 'react';
import { FileText, Download, Edit, Save, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Props {
  eventId: string;
}

const numberToWords = (num: number): string => {
  const units = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
  const teens = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
  const tens = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
  const hundreds = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];

  if (num === 0) return 'zero';
  if (num < 0) return 'minus ' + numberToWords(-num);

  let result = '';
  const thousand = Math.floor(num / 1000);
  const remainder = num % 1000;

  if (thousand > 0) {
    if (thousand === 1) result += 'tysiąc ';
    else if (thousand < 10) result += units[thousand] + ' tysiące ';
    else result += numberToWords(thousand) + ' tysięcy ';
  }

  const hundred = Math.floor(remainder / 100);
  const ten = Math.floor((remainder % 100) / 10);
  const unit = remainder % 10;

  if (hundred > 0) result += hundreds[hundred] + ' ';
  if (ten === 1) result += teens[unit] + ' ';
  else {
    if (ten > 0) result += tens[ten] + ' ';
    if (unit > 0) result += units[unit] + ' ';
  }

  return result.trim();
};

const replaceVariables = (template: string, variables: Record<string, string>): string => {
  let result = template;
  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value || '');
  });
  return result;
};

export function EventContractTab({ eventId }: Props) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [contractContent, setContractContent] = useState('');
  const [originalTemplate, setOriginalTemplate] = useState('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [editedVariables, setEditedVariables] = useState<Record<string, string>>({});
  const [templateExists, setTemplateExists] = useState(false);

  useEffect(() => {
    fetchContractData();
  }, [eventId]);

  const fetchContractData = async () => {
    try {
      setLoading(true);

      const { data: event, error: eventError } = await supabase
        .from('events')
        .select(`
          id,
          name,
          event_date,
          event_end_date,
          budget,
          organization_id,
          location_id,
          location,
          category_id,
          contact_person_id,
          locations:location_id(name, formatted_address, address, city, postal_code),
          organizations:organization_id(name, nip, address, city, postal_code, phone, email),
          contacts:contact_person_id(first_name, last_name, full_name, email, phone, pesel, address, city, postal_code),
          event_categories:category_id(
            name,
            contract_template_id,
            contract_templates:contract_template_id(id, name, content, content_html, page_settings)
          )
        `)
        .eq('id', eventId)
        .single();

      if (eventError) throw eventError;

      const template = event.event_categories?.contract_templates;

      if (!template) {
        setTemplateExists(false);
        setLoading(false);
        return;
      }

      setTemplateExists(true);

      let templateToStore = template.content_html || template.content;
      if (template.page_settings?.pages) {
        templateToStore = JSON.stringify(template.page_settings);
      }
      setOriginalTemplate(templateToStore);

      const { data: offers } = await supabase
        .from('offers')
        .select('description, total_price')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const contractNumber = `UMW/${new Date().getFullYear()}/${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      const totalPrice = event.budget || offers?.total_price || 0;
      const depositAmount = Math.round(totalPrice * 0.5);

      const formatDate = (dateStr: string) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('pl-PL', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      };

      const formatDateOnly = (dateStr: string) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('pl-PL', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
      };

      const formatTimeOnly = (dateStr: string) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleTimeString('pl-PL', {
          hour: '2-digit',
          minute: '2-digit'
        });
      };

      const contact = event.contacts;
      const organization = event.organizations;
      const location = event.locations;

      const parseLocationString = (locationStr: string) => {
        if (!locationStr) return { address: '', city: '', postal: '' };
        const parts = locationStr.split(',').map(s => s.trim());
        if (parts.length >= 3) {
          const postalCity = parts[1].trim().split(' ');
          return {
            address: parts[0] || '',
            postal: postalCity[0] || '',
            city: postalCity.slice(1).join(' ') || '',
          };
        }
        return { address: locationStr, city: '', postal: '' };
      };

      const locationString = event.location || '';
      const parsedLocation = parseLocationString(locationString);

      const varsMap: Record<string, string> = {
        contact_first_name: contact?.first_name || '',
        contact_last_name: contact?.last_name || '',
        contact_full_name: contact?.full_name || '',
        contact_email: contact?.email || '',
        contact_phone: contact?.phone || '',
        contact_pesel: contact?.pesel || '',
        contact_address: contact?.address || '',
        contact_city: contact?.city || '',
        contact_postal_code: contact?.postal_code || '',

        organization_name: organization?.name || '',
        organization_nip: organization?.nip || '',
        organization_address: organization?.address || '',
        organization_city: organization?.city || '',
        organization_postal_code: organization?.postal_code || '',
        organization_phone: organization?.phone || '',
        organization_email: organization?.email || '',

        event_name: event.name || '',
        event_date: formatDate(event.event_date),
        event_end_date: formatDate(event.event_end_date),
        event_date_only: formatDateOnly(event.event_date),
        event_end_date_only: formatDateOnly(event.event_end_date),
        event_time_start: formatTimeOnly(event.event_date),
        event_time_end: formatTimeOnly(event.event_end_date),

        location_name: location?.name || parsedLocation.address || '',
        location_address: location?.address || parsedLocation.address || '',
        location_city: location?.city || parsedLocation.city || '',
        location_postal_code: location?.postal_code || parsedLocation.postal || '',
        location_full: location?.formatted_address || locationString || '',

        budget: totalPrice.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł',
        deposit_amount: depositAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł',

        contract_number: contractNumber,
        contract_date: new Date().toLocaleDateString('pl-PL'),

        executor_name: 'EVENT RULERS',
        executor_address: 'ul. Przykładowa 1',
        executor_postal_code: '30-000',
        executor_city: 'Kraków',
        executor_nip: '1234567890',
        executor_phone: '698-212-279',
        executor_email: 'biuro@eventrulers.pl',
      };

      setVariables(varsMap);
      setEditedVariables(varsMap);

      let contentToSet = '';
      if (template.page_settings?.pages) {
        const pages = template.page_settings.pages.map((page: string) =>
          replaceVariables(page, varsMap)
        );
        contentToSet = JSON.stringify(pages);
      } else {
        const templateToUse = template.content_html || template.content;
        contentToSet = replaceVariables(templateToUse, varsMap);
      }
      setContractContent(contentToSet);

    } catch (err) {
      console.error('Error fetching contract data:', err);
      showSnackbar('Błąd podczas ładowania danych umowy', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    setVariables(editedVariables);

    try {
      const parsed = JSON.parse(originalTemplate);
      if (Array.isArray(parsed)) {
        const pages = parsed.map((page: string) =>
          replaceVariables(page, editedVariables)
        );
        setContractContent(JSON.stringify(pages));
      } else {
        setContractContent(replaceVariables(originalTemplate, editedVariables));
      }
    } catch {
      setContractContent(replaceVariables(originalTemplate, editedVariables));
    }

    setEditMode(false);
    showSnackbar('Dane umowy zostały zaktualizowane', 'success');
  };

  const handleCancel = () => {
    setEditedVariables(variables);
    setEditMode(false);
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-8">
        <div className="text-center text-[#e5e4e2]/60">Ładowanie danych umowy...</div>
      </div>
    );
  }

  if (!templateExists) {
    return (
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-8">
        <div className="text-center">
          <FileText className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <h3 className="text-xl text-[#e5e4e2] mb-2">Brak szablonu umowy</h3>
          <p className="text-[#e5e4e2]/60 mb-4">
            Dla tej kategorii wydarzenia nie został przypisany szablon umowy.
          </p>
          <p className="text-sm text-[#e5e4e2]/40">
            Przejdź do <a href="/crm/event-categories" className="text-[#d3bb73] hover:underline">kategorii wydarzeń</a> aby przypisać szablon.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="no-print flex items-center justify-between bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div>
          <h2 className="text-2xl font-light text-[#e5e4e2] mb-1">Umowa na realizację wydarzenia</h2>
          <p className="text-sm text-[#e5e4e2]/60">
            Automatycznie wygenerowana z danych wydarzenia
          </p>
        </div>
        <div className="flex items-center gap-3">
          {editMode ? (
            <>
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] hover:bg-[#d3bb73]/5"
              >
                <X className="w-4 h-4" />
                Anuluj
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
              >
                <Save className="w-4 h-4" />
                Zapisz
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditMode(true)}
                className="flex items-center gap-2 px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] hover:bg-[#d3bb73]/5"
              >
                <Edit className="w-4 h-4" />
                Edytuj zmienne
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
              >
                <Download className="w-4 h-4" />
                Pobierz PDF
              </button>
            </>
          )}
        </div>
      </div>

      {editMode && (
        <div className="no-print bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Edycja zmiennych</h3>
          <div className="grid grid-cols-2 gap-4 max-h-96 overflow-y-auto">
            {Object.entries(editedVariables).map(([key, value]) => (
              <div key={key}>
                <label className="block text-sm text-[#e5e4e2]/60 mb-1">
                  {key.replace(/_/g, ' ')}
                </label>
                <input
                  type="text"
                  value={value}
                  onChange={(e) => setEditedVariables({ ...editedVariables, [key]: e.target.value })}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="contract-a4-container">
        {(() => {
          try {
            const pages = JSON.parse(contractContent);
            if (Array.isArray(pages)) {
              return pages.map((pageContent: string, pageIndex: number) => (
                <div key={pageIndex} className="contract-a4-page" style={{ marginBottom: pageIndex < pages.length - 1 ? '20px' : '0' }}>
                  <div className="contract-header-logo">
                    <img src="/erulers_logo_vect.png" alt="EVENT RULERS" />
                  </div>

                  <div className="contract-current-date">
                    {new Date().toLocaleDateString('pl-PL', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </div>

                  <div
                    className="contract-content"
                    dangerouslySetInnerHTML={{ __html: pageContent }}
                  />

                  <div className="contract-footer">
                    <div className="footer-logo">
                      <img src="/erulers_logo_vect.png" alt="EVENT RULERS" />
                    </div>
                    <div className="footer-info">
                      <p><strong>EVENT RULERS</strong> – <em>Więcej niż Wodzireje!</em></p>
                      <p>www.eventrulers.pl | biuro@eventrulers.pl | tel: 698-212-279</p>
                    </div>
                    {pageIndex > 0 && pages.length > 1 && (
                      <div className="footer-page-number">Strona {pageIndex + 1}</div>
                    )}
                  </div>
                </div>
              ));
            }
          } catch (e) {
            // Fallback dla starych szablonów
          }
          return (
            <div className="contract-a4-page">
              <div className="contract-header-logo">
                <img src="/erulers_logo_vect.png" alt="EVENT RULERS" />
              </div>

              <div className="contract-current-date">
                {new Date().toLocaleDateString('pl-PL', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </div>

              <div
                className="contract-content"
                dangerouslySetInnerHTML={{ __html: contractContent }}
              />

              <div className="contract-footer">
                <div className="footer-logo">
                  <img src="/erulers_logo_vect.png" alt="EVENT RULERS" />
                </div>
                <div className="footer-info">
                  <p><strong>EVENT RULERS</strong> – <em>Więcej niż Wodzireje!</em></p>
                  <p>www.eventrulers.pl | biuro@eventrulers.pl | tel: 698-212-279</p>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 0;
          }

          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
            background: white !important;
          }

          .contract-a4-container {
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          .contract-a4-page {
            box-shadow: none !important;
            page-break-after: always;
            margin: 0 !important;
          }

          .contract-a4-page:last-child {
            page-break-after: auto;
          }

          nav, header, footer:not(.contract-footer), button, .no-print {
            display: none !important;
          }
        }

        .contract-a4-container {
          background: #f5f5f5;
          padding: 20px;
          min-height: 100vh;
        }

        .contract-a4-page {
          position: relative;
          width: 210mm;
          margin: 0 auto 20px auto;
          padding: 20mm 25mm 5mm;
          background: white;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          font-family: Arial, sans-serif;
          font-size: 12pt;
          line-height: 1.6;
          color: #000;
          page-break-after: always;
          break-after: page;
          display: flex;
          flex-direction: column;
        }

        .contract-header-logo {
          width: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          margin-bottom: 4mm;
          transition: all 0.2s ease;
        }

        .contract-header-logo img {
          height: auto;
          object-fit: contain;
          max-width: 80%;
        }

        .contract-current-date {
          position: absolute;
          top: 20mm;
          right: 20mm;
          text-align: right;
          font-size: 10pt;
          color: #333;
          font-weight: 500;
        }

        .contract-content {
          flex: 1;
          min-height: 160mm;
          text-align: justify;
          color: #000;
          font-family: Arial, sans-serif;
          font-size: 12pt;
          line-height: 1.6;
          direction: ltr !important;
          unicode-bidi: embed !important;
          overflow-wrap: break-word;
          word-wrap: break-word;
        }

        .contract-content > * {
          display: block;
          white-space: pre-wrap;
        }

        .contract-content p,
        .contract-content pre {
          display: block;
          margin: 0;
          padding: 0;
          text-align: justify;
          white-space: pre-wrap;
          font-family: Arial, sans-serif;
          font-size: 12pt;
          line-height: 1.6;
          border: none;
          background: transparent;
          color: #000;
        }

        .contract-content h1,
        .contract-content h2,
        .contract-content h3,
        .contract-content h4 {
          display: block;
          margin-top: 1.5em;
          margin-bottom: 0.75em;
          font-weight: bold;
          white-space: pre-wrap;
          color: #000;
        }

        .contract-content h1 {
          font-size: 18pt;
          text-align: center;
        }

        .contract-content h2 {
          font-size: 16pt;
        }

        .contract-content h3 {
          font-size: 14pt;
        }

        .contract-content strong,
        .contract-content b {
          font-weight: bold;
          color: #000;
        }

        .contract-content em,
        .contract-content i {
          font-style: italic;
          color: #000;
        }

        .contract-footer {
          margin-top: auto;
          width: 100%;
          min-height: 25mm;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          padding: 10px 0;
          background: white;
          flex-shrink: 0;
          position: relative;
        }

        .contract-footer::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: #d3bb73;
        }

        .footer-logo {
          display: none;
        }

        .footer-info {
          text-align: center;
          font-size: 10pt;
          color: #333;
          line-height: 1.2;
        }

        .footer-info p {
          margin: 4px 0;
          color: #333;
        }

        .footer-page-number {
          position: absolute;
          top: -25px;
          right: 25mm;
          font-size: 10pt;
          color: #666;
        }

        .contract-content u {
          text-decoration: underline;
        }

        .contract-content ul,
        .contract-content ol {
          margin-left: 2em;
          margin-bottom: 1em;
          padding-left: 0;
        }

        .contract-content li {
          margin-bottom: 0.5em;
        }

        .contract-content blockquote {
          margin-left: 2em;
          padding-left: 1em;
          border-left: 3px solid #ccc;
          font-style: italic;
          margin-bottom: 1em;
        }

        .contract-content div[style*="text-align: center"],
        .contract-content .ql-align-center {
          text-align: center;
        }

        .contract-content div[style*="text-align: right"],
        .contract-content .ql-align-right {
          text-align: right;
        }

        .contract-content div[style*="text-align: left"],
        .contract-content .ql-align-left {
          text-align: left;
        }

        .contract-content .ql-indent-1 {
          padding-left: 3em;
        }

        .contract-content .ql-indent-2 {
          padding-left: 6em;
        }

        .contract-content .ql-indent-3 {
          padding-left: 9em;
        }

        .contract-content table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 1em;
        }

        .contract-content table td,
        .contract-content table th {
          border: 1px solid #ddd;
          padding: 8px;
        }

        .contract-content br {
          display: block;
          content: "";
          margin: 0.5em 0;
        }

        .contract-content p br {
          display: inline;
          margin: 0;
        }

        @media print {
          body * {
            visibility: hidden;
          }

          .contract-preview, .contract-preview * {
            visibility: visible;
          }

          .contract-preview {
            position: absolute;
            left: 0;
            top: 0;
            width: 210mm;
            min-height: 297mm;
            margin: 0;
            padding: 20mm 25mm;
            background: white;
            box-shadow: none;
            border-radius: 0;
            font-family: 'Calibri', 'Arial', sans-serif;
            font-size: 11pt;
            line-height: 1.5;
          }

          .contract-header img {
            height: 50px;
          }

          @page {
            size: A4;
            margin: 0;
          }
        }
      `}</style>
    </div>
  );
}
