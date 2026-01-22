'use client';

import { useState, useEffect } from 'react';
import { X, Send, Mail, Loader, Eye, Code } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { generateEmailSignature } from './EmailSignatureGenerator';

interface SendContractEmailModalProps {
  contractId: string;
  eventId: string;
  clientEmail?: string;
  clientName?: string;
  onClose: () => void;
  onSent?: () => void;
}

interface EmailAccount {
  id: string;
  email_address: string;
  from_name: string;
}

export default function SendContractEmailModal({
  contractId,
  eventId,
  clientEmail = '',
  clientName = '',
  onClose,
  onSent,
}: SendContractEmailModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [formData, setFormData] = useState({
    to: clientEmail,
    subject: `Umowa - Event`,
    message: `Dzień dobry,

W załączeniu przesyłam umowę na realizację wydarzenia.

Proszę o zapoznanie się z treścią i odesłanie podpisanego egzemplarza.

W razie pytań proszę o kontakt.`,
    fromAccountId: '',
  });
  const [signature, setSignature] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [employee, setEmployee] = useState<any>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [contract, setContract] = useState<any>(null);

  useEffect(() => {
    fetchEmailAccounts();
    fetchSignatureAndTemplate();
    fetchContract();
  }, []);

  useEffect(() => {
    if (clientEmail) {
      setFormData((prev) => ({ ...prev, to: clientEmail }));
    }
  }, [clientEmail]);

  useEffect(() => {
    generatePreview();
  }, [formData.message, signature, template]);

  const fetchContract = async () => {
    try {
      const { data, error } = await supabase
        .from('contracts')
        .select('contract_number')
        .eq('id', contractId)
        .maybeSingle();

      if (error) throw error;
      setContract(data);
    } catch (error) {
      console.error('Error fetching contract:', error);
    }
  };

  const fetchSignatureAndTemplate = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const [empResult, sigResult, templateResult] = await Promise.all([
        supabase.from('employees').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('employee_signatures').select('*').eq('employee_id', user.id).maybeSingle(),
        supabase.from('email_templates').select('*').eq('is_default', true).maybeSingle(),
      ]);

      setEmployee(empResult.data);
      setSignature(sigResult.data);
      setTemplate(templateResult.data);
    } catch (error) {
      console.error('Error fetching signature/template:', error);
    }
  };

  const generateSignatureHtml = () => {
    if (!signature && !employee) return '';

    const sig = signature || {
      full_name: employee ? employee.nickname || `${employee.name} ${employee.surname}` : '',
      position: employee?.occupation || '',
      phone: employee?.phone_number || '',
      email: employee?.email || '',
      website: 'https://mavinci.pl',
      avatar_url: employee?.avatar_url || '',
    };

    if (signature && signature.use_custom_html && signature.custom_html) {
      return signature.custom_html;
    }

    return generateEmailSignature(sig);
  };

  const generatePreview = () => {
    const signatureHtml = generateSignatureHtml();
    const contentHtml = formData.message.replace(/\n/g, '<br>');

    if (template && template.body_template) {
      const logoUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/site-images/logo-mavinci.svg`;

      let html = template.body_template
        .replace('{{LOGO_URL}}', logoUrl || '')
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

  const generateContractPDF = async (): Promise<{ base64: string; filename: string }> => {
    if (!contract) throw new Error('Brak danych umowy');

    const { data: contractData, error } = await supabase
      .from('contracts')
      .select('*')
      .eq('id', contractId)
      .maybeSingle();

    if (error || !contractData) {
      throw new Error('Nie znaleziono umowy');
    }

    const html2pdf = (await import('html2pdf.js')).default;

    const element = document.createElement('div');
    element.innerHTML = `
      <div style="padding: 20px; font-family: Arial, sans-serif;">
        <h2>${contractData.contract_number || 'Umowa'}</h2>
        <div>${contractData.content || ''}</div>
      </div>
    `;
    element.style.width = '210mm';
    element.style.position = 'absolute';
    element.style.left = '-9999px';
    document.body.appendChild(element);

    try {
      const pdfBlob = await html2pdf()
        .set({
          margin: 10,
          filename: `${contractData.contract_number}.pdf`,
          html2canvas: { scale: 1 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(element)
        .output('blob');

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
      });

      reader.readAsDataURL(pdfBlob);
      const base64 = await base64Promise;

      return {
        base64,
        filename: `${contractData.contract_number}.pdf`,
      };
    } finally {
      document.body.removeChild(element);
    }
  };

  const fetchEmailAccounts = async () => {
    try {
      setLoadingAccounts(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        showSnackbar('Brak zalogowanego użytkownika', 'error');
        return;
      }

      const { data: accounts, error } = await supabase
        .from('employee_email_accounts')
        .select('id, email_address, from_name')
        .eq('employee_id', user.id)
        .eq('is_active', true)
        .order('is_default', { ascending: false });

      if (error) throw error;

      setEmailAccounts(accounts || []);

      if (accounts && accounts.length > 0) {
        setFormData((prev) => ({ ...prev, fromAccountId: accounts[0].id }));
      }
    } catch (error: any) {
      console.error('Error fetching email accounts:', error);
      showSnackbar('Błąd podczas ładowania kont email', 'error');
    } finally {
      setLoadingAccounts(false);
    }
  };

  const handleSend = async () => {
    if (!formData.to.trim()) {
      showSnackbar('Wprowadź adres email odbiorcy', 'error');
      return;
    }

    if (!formData.subject.trim()) {
      showSnackbar('Wprowadź temat wiadomości', 'error');
      return;
    }

    if (!formData.fromAccountId && emailAccounts.length > 0) {
      showSnackbar('Wybierz konto pocztowe nadawcy', 'error');
      return;
    }

    if (emailAccounts.length === 0) {
      showSnackbar('Nie masz skonfigurowanych kont pocztowych', 'error');
      return;
    }

    setLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        showSnackbar('Brak sesji użytkownika', 'error');
        setLoading(false);
        return;
      }

      let attachments: any[] = [];

      showSnackbar('Test: Wysyłam bez załącznika PDF', 'info');

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            emailAccountId: formData.fromAccountId,
            to: formData.to,
            subject: formData.subject,
            body: previewHtml,
            attachments: attachments,
          }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        console.error('[SendContract] Error response:', error);
        throw new Error(error.error || error.message || 'Błąd podczas wysyłania email');
      }

      const result = await response.json();

      await supabase
        .from('contracts')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', contractId);

      showSnackbar('Umowa wysłana przez email', 'success');
      onSent?.();
      onClose();
    } catch (error: any) {
      console.error('Error sending email:', error);
      showSnackbar(error.message || 'Błąd podczas wysyłania email', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <div className="flex items-center gap-3">
            <Mail className="h-6 w-6 text-[#d3bb73]" />
            <h2 className="text-xl font-light text-[#e5e4e2]">Wyślij umowę przez email</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="flex items-center gap-2 rounded-lg bg-[#0f1119] px-3 py-2 text-[#d3bb73] transition-colors hover:bg-[#1a1d2e]"
            >
              {showPreview ? <Code className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showPreview ? 'Edycja' : 'Podgląd'}
            </button>
            <button
              onClick={onClose}
              disabled={loading}
              className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-4 p-6">
          {showPreview ? (
            <div>
              <div className="mb-4 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-4">
                <p className="text-sm text-[#e5e4e2]/70">
                  <strong>Podgląd:</strong> Tak będzie wyglądać Twoja wiadomość u odbiorcy
                </p>
              </div>
              <div className="rounded-lg bg-white p-4">
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            </div>
          ) : loadingAccounts ? (
            <div className="py-8 text-center text-[#e5e4e2]/60">Ładowanie kont email...</div>
          ) : emailAccounts.length === 0 ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
              <p className="text-sm text-red-400">
                <strong>Brak skonfigurowanych kont email.</strong>
                <br />
                Skonfiguruj konto pocztowe w ustawieniach profilu, aby móc wysyłać wiadomości.
              </p>
            </div>
          ) : (
            <>
              {emailAccounts.length > 1 && (
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                    Wyślij z konta <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={formData.fromAccountId}
                    onChange={(e) => setFormData({ ...formData, fromAccountId: e.target.value })}
                    disabled={loading}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
                  >
                    {emailAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.from_name} ({account.email_address})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {emailAccounts.length === 1 && (
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                  <p className="text-sm text-blue-400">
                    <strong>Wysyła z konta:</strong> {emailAccounts[0].from_name} (
                    {emailAccounts[0].email_address})
                  </p>
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Do (email odbiorcy) <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  value={formData.to}
                  onChange={(e) => setFormData({ ...formData, to: e.target.value })}
                  disabled={loading}
                  placeholder="klient@example.com"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
                />
                {clientName && (
                  <p className="mt-1 text-xs text-[#e5e4e2]/40">Klient: {clientName}</p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Temat <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  disabled={loading}
                  placeholder="Umowa..."
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Treść wiadomości</label>
                <textarea
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  disabled={loading}
                  rows={10}
                  placeholder="Wpisz treść wiadomości..."
                  className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
                />
                {!signature ? (
                  <div className="mt-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
                    <p className="text-xs text-yellow-400">
                      ⚠️ Nie masz skonfigurowanej stopki. Użyjemy podstawowych danych z profilu
                      pracownika.
                      <br />
                      <a
                        href="/crm/employees/signature"
                        target="_blank"
                        className="underline hover:text-yellow-300"
                      >
                        Kliknij tutaj aby stworzyć profesjonalną stopkę
                      </a>
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-[#e5e4e2]/50">
                    ✓ Stopka zostanie dodana automatycznie
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                <p className="text-xs text-amber-400">
                  <strong>Wskazówka:</strong> Po wysłaniu umowy status zostanie automatycznie
                  zmieniony na &quot;Wysłana&quot;, a umowa zostanie załączona jako plik PDF.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 p-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-6 py-2.5 text-[#e5e4e2]/80 transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleSend}
            disabled={loading || loadingAccounts || emailAccounts.length === 0}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                Wysyłanie...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Wyślij umowę
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
