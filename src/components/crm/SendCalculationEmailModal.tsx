'use client';

import { useState, useEffect } from 'react';
import { X, Send, Mail, Loader, Eye, Code } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { generateEmailSignature } from './EmailSignatureGenerator';
import { buildCompanySignatureHtml, buildCompanyEmailBody } from '@/lib/buildCompanySignature';

interface SendCalculationEmailModalProps {
  calculationId: string;
  eventId: string;
  calculationName?: string;
  eventName?: string;
  defaultEmail?: string;
  recipientName?: string;
  contactPerson?: {
    id: string;
    name: string;
    email: string | null;
  } | null;
  onClose: () => void;
  onSent?: () => void;
}

interface EmailAccount {
  id: string;
  email_address: string;
  from_name: string;
}
interface EventAttachment {
  id: string;
  name: string;
  original_name: string;
  file_path: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
}

export default function SendCalculationEmailModal({
  calculationId,
  eventId,
  calculationName = '',
  eventName = '',
  defaultEmail = '',
  recipientName = '',
  contactPerson = null,
  onClose,
  onSent,
}: SendCalculationEmailModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [eventFiles, setEventFiles] = useState<EventAttachment[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [formData, setFormData] = useState({
    to: defaultEmail,
    subject: calculationName
      ? `Kalkulacja: ${calculationName}`
      : eventName
        ? `Kalkulacja - ${eventName}`
        : 'Kalkulacja wydarzenia',
    message: `Dzień dobry,

W załączeniu przesyłam kalkulację wydarzenia.

Proszę o zapoznanie się z treścią. W razie pytań lub uwag pozostaję do dyspozycji.`,
    fromAccountId: '',
  });
  const [signature, setSignature] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [employee, setEmployee] = useState<any>(null);
  const [avatarDataUri, setAvatarDataUri] = useState<string>('');
  const [companySignatureHtml, setCompanySignatureHtml] = useState<string>('');
  const [companySignatureEnabled, setCompanySignatureEnabled] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [includeEventFiles, setIncludeEventFiles] = useState(false);

  useEffect(() => {
    if (defaultEmail) {
      setFormData((prev) => ({ ...prev, to: defaultEmail }));
    }
  }, [defaultEmail]);

  useEffect(() => {
    generatePreview();
  }, [
    formData.message,
    formData.subject,
    recipientName,
    signature,
    template,
    avatarDataUri,
    companySignatureHtml,
    companySignatureEnabled,
  ]);

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

      const rawAvatarUrl = empResult.data?.signature_thumb || empResult.data?.avatar_url || '';
      if (rawAvatarUrl) {
        const dataUri = await fetchAvatarAsDataUri(rawAvatarUrl);
        if (dataUri) setAvatarDataUri(dataUri);
      }
    } catch (error) {
      console.error('Error fetching signature/template:', error);
    }
  };

  const fetchEventFiles = async () => {
    try {
      setLoadingFiles(true);

      const { data, error } = await supabase
        .from('event_files')
        .select('id, name, original_name, file_path, file_size, mime_type, created_at')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setEventFiles(
        (data || []).map((file) => ({
          id: file.id,
          name: file.name || file.original_name,
          original_name: file.original_name,
          file_path: file.file_path,
          file_size: file.file_size,
          mime_type: file.mime_type,
          created_at: file.created_at,
        })),
      );
    } catch (error) {
      console.error('Error fetching event files:', error);
      showSnackbar('Nie udało się pobrać plików wydarzenia', 'error');
    } finally {
      setLoadingFiles(false);
    }
  };

  const fetchAvatarAsDataUri = async (url: string): Promise<string> => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return '';
      const blob = await resp.blob();
      const buffer = await blob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
      );
      const mime = blob.type || 'image/jpeg';
      return `data:${mime};base64,${base64}`;
    } catch (err) {
      console.error('Error fetching avatar:', err);
      return '';
    }
  };

  const generateSignatureHtml = () => {
    if (companySignatureEnabled && companySignatureHtml) return companySignatureHtml;
    if (!signature && !employee) return '';

    const sig = signature || {
      full_name: employee ? employee.nickname || `${employee.name} ${employee.surname}` : '',
      position: employee?.occupation || '',
      phone: employee?.phone_number || '',
      email: employee?.email || '',
      website: 'https://mavinci.pl',
    };

    const employeeAvatar = employee?.signature_thumb || employee?.avatar_url || '';
    const finalAvatar = avatarDataUri || employeeAvatar;

    if (signature && signature.use_custom_html && signature.custom_html) {
      let html = signature.custom_html;
      if (finalAvatar) {
        if (signature.avatar_url) {
          html = html.split(signature.avatar_url).join(finalAvatar);
        }
        if (employee?.avatar_url && employee.avatar_url !== signature.avatar_url) {
          html = html.split(employee.avatar_url).join(finalAvatar);
        }
        html = html.replace(
          /(<img[^>]*src=["'])([^"']*\/employee-avatars\/[^"']*)(["'])/gi,
          `$1${finalAvatar}$3`,
        );
      }
      return html;
    }

    return generateEmailSignature({
      ...sig,
      avatar_url: finalAvatar,
    });
  };

  const generatePreview = async () => {
    const signatureHtml = generateSignatureHtml();
    const result = await buildCompanyEmailBody({
      content: formData.message,
      subject: formData.subject,
      recipientName,
      signatureHtml,
      purpose: 'offer',
    });
    setPreviewHtml(result.html);
  };

  const fetchStoredCalculationPDF = async (): Promise<{ base64: string; filename: string }> => {
    const { data, error } = await supabase
      .from('event_calculations')
      .select('name, generated_pdf_path')
      .eq('id', calculationId)
      .maybeSingle();

    if (error || !data) {
      throw new Error('Nie znaleziono kalkulacji');
    }

    if (!data.generated_pdf_path) {
      throw new Error(
        'PDF kalkulacji nie został jeszcze wygenerowany. Najpierw kliknij "Generuj PDF".',
      );
    }

    const { data: signedData, error: signedErr } = await supabase.storage
      .from('event-files')
      .createSignedUrl(data.generated_pdf_path, 300);

    if (signedErr || !signedData?.signedUrl) {
      throw new Error('Nie udało się pobrać PDF ze storage');
    }

    const pdfResp = await fetch(signedData.signedUrl);
    if (!pdfResp.ok) throw new Error('Błąd pobierania PDF');

    const buffer = await pdfResp.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
    );

    const filename =
      data.generated_pdf_path.split('/').pop() || `Kalkulacja_${data.name || calculationId}.pdf`;

    return { base64, filename };
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

  const fetchEventFileAsAttachment = async (file: EventAttachment) => {
    const { data: signedData, error } = await supabase.storage
      .from('event-files')
      .createSignedUrl(file.file_path, 300);

    if (error || !signedData?.signedUrl) {
      throw new Error(`Nie udało się pobrać pliku: ${file.name}`);
    }

    const resp = await fetch(signedData.signedUrl);
    if (!resp.ok) {
      throw new Error(`Błąd pobierania pliku: ${file.name}`);
    }

    const blob = await resp.blob();
    const buffer = await blob.arrayBuffer();

    const base64 = btoa(
      new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
    );

    return {
      filename: file.name,
      content: base64,
      contentType: file.mime_type || blob.type || 'application/octet-stream',
    };
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
        return;
      }

      showSnackbar('Pobieram PDF kalkulacji...', 'info');

      const pdfData = await fetchStoredCalculationPDF();

      const attachments = [
        {
          filename: pdfData.filename,
          content: pdfData.base64,
          contentType: 'application/pdf',
        },
      ];

      const selectedFiles = eventFiles.filter((file) => selectedFileIds.includes(file.id));

      if (selectedFiles.length > 0) {
        showSnackbar(`Pobieram dodatkowe załączniki (${selectedFiles.length})...`, 'info');

        for (const file of selectedFiles) {
          const attachment = await fetchEventFileAsAttachment(file);
          attachments.push(attachment);
        }
      }

      showSnackbar('Załączniki gotowe, wysyłam email...', 'info');

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
            to: formData.to.trim(),
            subject: formData.subject.trim(),
            body: previewHtml,
            attachments,
          }),
        },
      );

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        console.error('[SendCalculation] Error response:', error);

        throw new Error(error?.error || error?.message || 'Błąd podczas wysyłania email');
      }

      showSnackbar('Kalkulacja wysłana przez email', 'success');
      onSent?.();
      onClose();
    } catch (error: any) {
      console.error('Error sending email:', error);
      showSnackbar(error.message || 'Błąd podczas wysyłania email', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!includeEventFiles) {
      setSelectedFileIds([]);
      return;
    }

    fetchEventFiles();
  }, [includeEventFiles, eventId]);

  useEffect(() => {
    fetchEmailAccounts();
    fetchSignatureAndTemplate();

    buildCompanySignatureHtml().then((res) => {
      setCompanySignatureHtml(res.html);
      setCompanySignatureEnabled(res.enabled);
    });
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <div className="flex items-center gap-3">
            <Mail className="h-6 w-6 text-[#d3bb73]" />
            <h2 className="text-xl font-light text-[#e5e4e2]">Wyślij kalkulację przez email</h2>
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
                  {contactPerson?.email ? (
                    <span className="mt-1 text-xs text-[#e5e4e2]/40 ml-3">Kontakt główny: {contactPerson.name}</span>
                  ) : recipientName ? (
                    <span className="mt-1 text-xs text-[#e5e4e2]/40 ml-3">Kontakt główny: {recipientName}</span>
                  ) : null}
                </label>
                <input
                  type="email"
                  value={formData.to}
                  onChange={(e) => setFormData({ ...formData, to: e.target.value })}
                  disabled={loading}
                  placeholder="klient@example.com"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
                />
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
                <p className="mt-2 text-xs text-[#e5e4e2]/50">
                  Stopka zostanie dodana automatycznie
                </p>
              </div>
              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={includeEventFiles}
                    onChange={(e) => setIncludeEventFiles(e.target.checked)}
                    disabled={loading}
                    className="mt-1 h-4 w-4 rounded border-[#d3bb73]/40 bg-[#0a0d1a]"
                  />

                  <div>
                    <p className="text-sm font-medium text-[#e5e4e2]">
                      Dołącz dodatkowe pliki z eventu
                    </p>
                    <p className="mt-1 text-xs text-[#e5e4e2]/50">
                      Zobaczysz tylko pliki, do których masz dostęp zgodnie z uprawnieniami.
                    </p>
                  </div>
                </label>
              </div>
              {includeEventFiles && (
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[#e5e4e2]">
                        Dodatkowe załączniki z eventu
                      </p>
                      <p className="text-xs text-[#e5e4e2]/50">
                        Wybierz pliki, które chcesz dołączyć do wiadomości
                      </p>
                    </div>

                    {eventFiles.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedFileIds.length === eventFiles.length) {
                            setSelectedFileIds([]);
                          } else {
                            setSelectedFileIds(eventFiles.map((f) => f.id));
                          }
                        }}
                        className="text-xs text-[#d3bb73] hover:underline"
                      >
                        {selectedFileIds.length === eventFiles.length
                          ? 'Odznacz wszystkie'
                          : 'Zaznacz wszystkie'}
                      </button>
                    )}
                  </div>

                  {loadingFiles ? (
                    <div className="py-4 text-sm text-[#e5e4e2]/50">Ładowanie plików...</div>
                  ) : eventFiles.length === 0 ? (
                    <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-3 text-sm text-[#e5e4e2]/50">
                      Brak dostępnych plików lub nie masz uprawnień do ich odczytu.
                    </div>
                  ) : (
                    <div className="max-h-48 space-y-2 overflow-y-auto">
                      {eventFiles.map((file) => {
                        const checked = selectedFileIds.includes(file.id);

                        return (
                          <label
                            key={file.id}
                            className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 hover:border-[#d3bb73]/30"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSelectedFileIds((prev) =>
                                  prev.includes(file.id)
                                    ? prev.filter((id) => id !== file.id)
                                    : [...prev, file.id],
                                );
                              }}
                              className="h-4 w-4 rounded border-[#d3bb73]/40 bg-[#0a0d1a]"
                            />

                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm text-[#e5e4e2]">{file.name}</p>
                              {file.file_size && (
                                <p className="text-xs text-[#e5e4e2]/40">
                                  {(file.file_size / 1024 / 1024).toFixed(2)} MB
                                </p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                <p className="text-xs text-amber-400">
                  <strong>Wskazówka:</strong> Kalkulacja w formacie PDF zostanie załączona do
                  wiadomości. Upewnij się, że wcześniej wygenerowałeś aktualny PDF.
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
                Wyślij kalkulację
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
