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
          budget,
          organization_id,
          location_id,
          category_id,
          locations:location_id(name, formatted_address, address, city, postal_code),
          organizations:organization_id(name, nip, address, city, postal_code, phone, email),
          event_categories:category_id(
            name,
            contract_template_id,
            contract_templates:contract_template_id(id, name, content, content_html)
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
      setOriginalTemplate(template.content_html || template.content);

      const { data: offers } = await supabase
        .from('offers')
        .select('description, total_price')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const contractNumber = `UMW/${new Date().getFullYear()}/${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      const totalPrice = event.budget || offers?.total_price || 0;
      const depositAmount = Math.round(totalPrice * 0.3);

      const varsMap: Record<string, string> = {
        client_name: event.organizations?.name || '',
        client_address: event.organizations?.address || '',
        client_postal_code: event.organizations?.postal_code || '',
        client_city: event.organizations?.city || '',
        client_nip: event.organizations?.nip || '',
        client_id_number: '',
        client_phone: event.organizations?.phone || '',
        client_email: event.organizations?.email || '',
        executor_name: 'MAVINCI SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
        executor_address: 'Marcina Kasprzaka',
        executor_postal_code: '10-057',
        executor_city: 'Olsztyn',
        executor_nip: '7393958411',
        executor_phone: '+48 698-212-279',
        executor_email: 'wedding@eventrulers.pl',
        event_name: event.name || '',
        event_date: event.event_date ? new Date(event.event_date).toLocaleDateString('pl-PL') : '',
        event_time_start: '17:00',
        event_time_end: '4:00',
        event_location_name: event.locations?.name || '',
        event_location_address: event.locations?.formatted_address || `${event.locations?.address || ''}, ${event.locations?.postal_code || ''} ${event.locations?.city || ''}`.trim(),
        contract_number: contractNumber,
        contract_date: new Date().toLocaleDateString('pl-PL'),
        total_price: totalPrice.toString(),
        total_price_words: numberToWords(totalPrice) + ' złotych',
        deposit_amount: depositAmount.toString(),
        deposit_amount_words: numberToWords(depositAmount) + ' złotych',
        remaining_amount: (totalPrice - depositAmount).toString(),
        overtime_hour1_price: '1500',
        overtime_hour2_price: '2000',
        scope_description: offers?.description || 'Zakres usług zgodnie z ofertą',
        services_list: '• Flagowe Trio (Dj, Wodzirej, Akordeonista)\n• Familiada',
      };

      setVariables(varsMap);
      setEditedVariables(varsMap);
      const templateToUse = template.content_html || template.content;
      setContractContent(replaceVariables(templateToUse, varsMap));

    } catch (err) {
      console.error('Error fetching contract data:', err);
      showSnackbar('Błąd podczas ładowania danych umowy', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    setVariables(editedVariables);
    setContractContent(replaceVariables(originalTemplate, editedVariables));
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
      <div className="flex items-center justify-between bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
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
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
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
              <p>EVENT RULERS – Więcej niż Wodzireje!</p>
              <p>www.eventrulers.pl | biuro@eventrulers.pl</p>
              <p>tel: 698-212-279</p>
            </div>
          </div>
        </div>
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
          min-height: 297mm;
          margin: 0 auto;
          padding: 20mm 25mm 40mm 25mm;
          background: white;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          font-family: Arial, sans-serif;
          font-size: 12pt;
          line-height: 1.6;
          color: #000;
        }

        .contract-header-logo {
          position: absolute;
          top: 15mm;
          left: 50%;
          transform: translateX(-50%);
          width: 80%;
          height: 60mm;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 10mm;
        }

        .contract-header-logo img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        .contract-current-date {
          position: absolute;
          top: 15mm;
          right: 25mm;
          font-size: 10pt;
          color: #333;
          font-weight: 500;
        }

        .contract-content {
          margin-top: 80mm;
          text-align: justify;
          color: #000;
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
          border-top: 2px solid #e0e0e0;
        }

        .footer-logo {
          flex-shrink: 0;
          width: 120px;
          height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .footer-logo img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        .footer-info {
          text-align: right;
          font-size: 10pt;
          color: #333;
          line-height: 1.4;
        }

        .footer-info p {
          margin: 4px 0;
          color: #333;
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
