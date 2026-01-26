'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { X, Send, Eye, Code, RefreshCw, Paperclip, Trash2 } from 'lucide-react';
import { generateEmailSignature } from './EmailSignatureGenerator';

interface ComposeEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (data: {
    to: string;
    subject: string;
    body: string;
    bodyHtml: string;
    attachments?: File[];
    fromAccountId?: string;
  }) => Promise<void>;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  forwardedBody?: string;
  selectedAccountId?: string;
  emailAccounts?: any[];
}

export default function ComposeEmailModal({
  isOpen,
  onClose,
  onSend,
  initialTo = '',
  initialSubject = '',
  initialBody = '',
  forwardedBody = '',
  selectedAccountId,
  emailAccounts = [],
}: ComposeEmailModalProps) {
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [signature, setSignature] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [employee, setEmployee] = useState<any>(null);
  const [fromAccountId, setFromAccountId] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setTo(initialTo);
      setSubject(initialSubject);
      setBody(initialBody || forwardedBody || '');
      setAttachments([]);
      fetchSignatureAndTemplate();

      // Set default account
      if (emailAccounts.length > 0) {
        // If selectedAccountId is a real account (not 'all' or 'contact_form'), use it
        const validAccount = emailAccounts.find((acc) => acc.id === selectedAccountId);
        setFromAccountId(validAccount ? selectedAccountId : emailAccounts[0].id);
      }
    }
  }, [isOpen, initialTo, initialSubject, initialBody, forwardedBody, selectedAccountId, emailAccounts]);

  useEffect(() => {
    generatePreview();
  }, [body, signature, template]);

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
    if (!signature && !employee)
      return '<p style="color: #999; font-style: italic;">Skonfiguruj stopkę w /crm/employees/signature</p>';

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
    const contentHtml = body.replace(/\n/g, '<br>');

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setAttachments((prev) => [...prev, ...newFiles]);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const handleSend = async () => {
    if (!to || !subject || !body) {
      alert('Wypełnij wszystkie pola');
      return;
    }

    if (!fromAccountId && emailAccounts.length > 0) {
      alert('Wybierz konto, z którego chcesz wysłać wiadomość');
      return;
    }

    setSending(true);
    try {
      await onSend({
        to,
        subject,
        body,
        bodyHtml: previewHtml,
        attachments,
        fromAccountId,
      });
      setTo('');
      setSubject('');
      setBody('');
      setAttachments([]);
      onClose();
    } catch (error) {
      console.error('Error sending:', error);
    }
    setSending(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <h2 className="text-2xl font-bold text-white">Nowa Wiadomość</h2>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="flex items-center gap-2 rounded-lg bg-[#0f1119] px-4 py-2 text-[#d3bb73] transition-colors hover:bg-[#1a1d2e]"
            >
              {showPreview ? <Code className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              {showPreview ? 'Edycja' : 'Podgląd'}
            </button>
            <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-white">
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!showPreview ? (
            <div className="space-y-4">
              {emailAccounts.length > 0 && (
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                    Z konta: <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={fromAccountId}
                    onChange={(e) => setFromAccountId(e.target.value)}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
                  >
                    <option value="">-- Wybierz konto email --</option>
                    {emailAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.display_name || account.email_address}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-[#e5e4e2]/50">
                    Wybierz z jakiego konta email chcesz wysłać wiadomość
                  </p>
                </div>
              )}
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">Do:</label>
                <input
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="email@example.com"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">Temat:</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Temat wiadomości"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">Wiadomość:</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Treść wiadomości..."
                  rows={12}
                  className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
                />
                {!signature ? (
                  <div className="mt-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
                    <p className="text-xs text-yellow-400">
                      ⚠️ Nie masz skonfigurowanej stopki. Użyjemy podstawowych danych z profilu
                      pracownika.
                      <br />
                      <a
                        href="/crm/employees/signature"
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
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">Załączniki:</label>
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#d3bb73] transition-colors hover:bg-[#1a1d2e]">
                    <Paperclip className="h-5 w-5" />
                    <span>Dodaj załącznik</span>
                    <input type="file" onChange={handleFileSelect} multiple className="hidden" />
                  </label>
                  {attachments.length > 0 && (
                    <div className="space-y-2">
                      {attachments.map((file, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <Paperclip className="h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm text-white">{file.name}</p>
                              <p className="text-xs text-[#e5e4e2]/50">
                                {formatFileSize(file.size)}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => removeAttachment(index)}
                            className="p-2 text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-4 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-4">
                <p className="text-sm text-[#e5e4e2]/70">
                  <strong>Podgląd:</strong> Tak będzie wyglądać Twoja wiadomość u odbiorcy
                </p>
              </div>
              <div className="rounded-lg bg-white">
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-4 border-t border-[#d3bb73]/20 p-6">
          <button
            onClick={onClose}
            className="rounded-lg bg-[#0f1119] px-6 py-3 text-white transition-colors hover:bg-[#1a1d2e]"
          >
            Anuluj
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#c5ad65] disabled:opacity-50"
          >
            {sending ? (
              <>
                <RefreshCw className="h-5 w-5 animate-spin" />
                Wysyłanie...
              </>
            ) : (
              <>
                <Send className="h-5 w-5" />
                Wyślij
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
