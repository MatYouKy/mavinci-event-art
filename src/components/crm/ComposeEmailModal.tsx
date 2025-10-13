'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Send, Eye, Code, RefreshCw } from 'lucide-react';

interface ComposeEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (data: { to: string; subject: string; body: string; bodyHtml: string }) => Promise<void>;
  initialTo?: string;
  initialSubject?: string;
  selectedAccountId?: string;
}

export default function ComposeEmailModal({
  isOpen,
  onClose,
  onSend,
  initialTo = '',
  initialSubject = '',
  selectedAccountId,
}: ComposeEmailModalProps) {
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [signature, setSignature] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [employee, setEmployee] = useState<any>(null);

  useEffect(() => {
    if (isOpen) {
      setTo(initialTo);
      setSubject(initialSubject);
      fetchSignatureAndTemplate();
    }
  }, [isOpen, initialTo, initialSubject]);

  useEffect(() => {
    generatePreview();
  }, [body, signature, template]);

  const fetchSignatureAndTemplate = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [empResult, sigResult, templateResult] = await Promise.all([
        supabase
          .from('employees')
          .select('*')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('employee_signatures')
          .select('*')
          .eq('employee_id', user.id)
          .maybeSingle(),
        supabase
          .from('email_templates')
          .select('*')
          .eq('is_default', true)
          .maybeSingle(),
      ]);

      setEmployee(empResult.data);
      setSignature(sigResult.data);
      setTemplate(templateResult.data);
    } catch (error) {
      console.error('Error fetching signature/template:', error);
    }
  };

  const generateSignatureHtml = () => {
    if (!signature && !employee) return '<p style="color: #999; font-style: italic;">Skonfiguruj stopkę w /crm/employees/signature</p>';

    const sig = signature || {
      full_name: employee ? `${employee.name} ${employee.surname}` : '',
      position: employee?.occupation || '',
      phone: employee?.phone_number || '',
      email: employee?.email || '',
      website: 'https://mavinci.pl',
      avatar_url: employee?.avatar_url || '',
    };

    if (signature && signature.use_custom_html && signature.custom_html) {
      return signature.custom_html;
    }

    return `
      <table role="presentation" style="width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; margin-top: 20px;">
        <tr>
          <td style="padding: 20px; background-color: #f8f8f8; border: 1px solid #e0e0e0;">
            <table role="presentation" style="width: 100%; border-collapse: collapse;">
              <tr>
                ${sig.avatar_url ? `
                <td style="width: 80px; vertical-align: top; padding-right: 20px;">
                  <img src="${sig.avatar_url}" alt="${sig.full_name}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 3px solid #d3bb73;">
                </td>
                ` : ''}
                <td style="vertical-align: top;">
                  <h3 style="margin: 0 0 5px 0; color: #1c1f33; font-size: 18px; font-weight: bold;">${sig.full_name}</h3>
                  ${sig.position ? `<p style="margin: 0 0 10px 0; color: #666; font-size: 14px; font-style: italic;">${sig.position}</p>` : ''}

                  <table role="presentation" style="border-collapse: collapse; font-size: 14px; color: #333;">
                    ${sig.email ? `
                    <tr>
                      <td style="padding: 3px 10px 3px 0; vertical-align: middle;">
                        <span style="color: #d3bb73;">✉</span>
                      </td>
                      <td style="padding: 3px 0;">
                        <a href="mailto:${sig.email}" style="color: #d3bb73; text-decoration: none;">${sig.email}</a>
                      </td>
                    </tr>
                    ` : ''}
                    ${sig.phone ? `
                    <tr>
                      <td style="padding: 3px 10px 3px 0; vertical-align: middle;">
                        <span style="color: #d3bb73;">📞</span>
                      </td>
                      <td style="padding: 3px 0;">
                        <a href="tel:${sig.phone}" style="color: #333; text-decoration: none;">${sig.phone}</a>
                      </td>
                    </tr>
                    ` : ''}
                    ${sig.website ? `
                    <tr>
                      <td style="padding: 3px 10px 3px 0; vertical-align: middle;">
                        <span style="color: #d3bb73;">🌐</span>
                      </td>
                      <td style="padding: 3px 0;">
                        <a href="${sig.website}" style="color: #d3bb73; text-decoration: none;">${sig.website}</a>
                      </td>
                    </tr>
                    ` : ''}
                  </table>
                </td>
              </tr>
            </table>
            ${!signature ? `<p style="margin: 10px 0 0 0; padding: 10px; background-color: #fff3cd; border-left: 3px solid #d3bb73; color: #856404; font-size: 12px;"><strong>Wskazówka:</strong> Możesz dostosować tę stopkę w <a href="/crm/employees/signature" style="color: #d3bb73;">ustawieniach stopki</a></p>` : ''}
          </td>
        </tr>
      </table>
    `;
  };

  const generatePreview = () => {
    const signatureHtml = generateSignatureHtml();
    const contentHtml = body.replace(/\n/g, '<br>');

    if (template && template.body_template) {
      const logoUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/site-images/logo-mavinci.svg`;

      let html = template.body_template
        .replace('{{LOGO_URL}}', logoUrl || 'https://via.placeholder.com/200x50?text=MAVINCI')
        .replace('{{CONTENT}}', contentHtml)
        .replace('{{SIGNATURE}}', signatureHtml);

      setPreviewHtml(html);
    } else {
      setPreviewHtml(`
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <div style="white-space: pre-wrap;">${contentHtml}</div>
          ${signatureHtml}
        </div>
      `);
    }
  };

  const handleSend = async () => {
    if (!to || !subject || !body) {
      alert('Wypełnij wszystkie pola');
      return;
    }

    setSending(true);
    try {
      await onSend({
        to,
        subject,
        body,
        bodyHtml: previewHtml,
      });
      setTo('');
      setSubject('');
      setBody('');
      onClose();
    } catch (error) {
      console.error('Error sending:', error);
    }
    setSending(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] rounded-lg max-w-4xl w-full border border-[#d3bb73]/20 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-[#d3bb73]/20 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Nowa Wiadomość</h2>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="flex items-center gap-2 px-4 py-2 bg-[#0f1119] text-[#d3bb73] rounded-lg hover:bg-[#1a1d2e] transition-colors"
            >
              {showPreview ? <Code className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              {showPreview ? 'Edycja' : 'Podgląd'}
            </button>
            <button
              onClick={onClose}
              className="text-[#e5e4e2]/60 hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!showPreview ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/70 mb-2">Do:</label>
                <input
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="email@example.com"
                  className="w-full px-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/70 mb-2">Temat:</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Temat wiadomości"
                  className="w-full px-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/70 mb-2">Wiadomość:</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Treść wiadomości..."
                  rows={12}
                  className="w-full px-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white focus:border-[#d3bb73] focus:outline-none resize-none"
                />
                {!signature ? (
                  <div className="mt-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-xs text-yellow-400">
                      ⚠️ Nie masz skonfigurowanej stopki. Użyjemy podstawowych danych z profilu pracownika.
                      <br />
                      <a href="/crm/employees/signature" className="underline hover:text-yellow-300">
                        Kliknij tutaj aby stworzyć profesjonalną stopkę
                      </a>
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-[#e5e4e2]/50 mt-2">
                    ✓ Stopka zostanie dodana automatycznie
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-4 p-4 bg-[#0f1119] rounded-lg border border-[#d3bb73]/20">
                <p className="text-sm text-[#e5e4e2]/70">
                  <strong>Podgląd:</strong> Tak będzie wyglądać Twoja wiadomość u odbiorcy
                </p>
              </div>
              <div className="bg-white rounded-lg">
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-[#d3bb73]/20 flex justify-end gap-4">
          <button
            onClick={onClose}
            className="px-6 py-3 bg-[#0f1119] text-white rounded-lg hover:bg-[#1a1d2e] transition-colors"
          >
            Anuluj
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#c5ad65] transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {sending ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Wysyłanie...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Wyślij
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
