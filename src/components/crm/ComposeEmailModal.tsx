'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { X, Send, RefreshCw, Paperclip, Trash2, Sparkles } from 'lucide-react';
import { generateEmailSignature } from './EmailSignatureGenerator';
import { buildCompanyEmailBody, buildCompanySignatureHtml } from '@/lib/buildCompanySignature';
import UnifiedEmailComposer, {
  buildUnifiedEmailHtml,
  hasUnifiedEmailBody,
  plainTextToEmailHtml,
  type UnifiedEmailDraft,
} from './UnifiedEmailComposer';

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
    cc?: string;
    bcc?: string;
  }) => Promise<void>;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  forwardedBody?: string;
  replyContext?: EmailReplyContext;
  selectedAccountId?: string;
  emailAccounts?: any[];
  onImproveWithAI?: (draft: { subject: string; body: string }) => Promise<{
    subject?: string;
    body: string;
  }>;
}

export interface EmailReplyContext {
  from: string;
  to?: string | string[] | null;
  cc?: string | string[] | null;
  date: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  messageId?: string | null;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const sanitizeQuotedEmailHtml = (html: string) => {
  if (!html || typeof window === 'undefined') return '';
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  documentNode
    .querySelectorAll('script, style, iframe, object, embed, form, input, button, meta, link, base')
    .forEach((element) => element.remove());

  documentNode.body.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'src') && value.startsWith('javascript:'))) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return documentNode.body.innerHTML;
};

const buildReplyQuoteHtml = (context?: EmailReplyContext) => {
  if (!context) return '';
  const originalHtml = context.bodyHtml?.trim()
    ? sanitizeQuotedEmailHtml(context.bodyHtml)
    : escapeHtml(context.body || '').replace(/\n/g, '<br>');
  const formattedDate = new Date(context.date).toLocaleString('pl-PL', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return `
    <div style="margin:24px 0 0; padding:0; color:#4b5563; background:#ffffff; font-family:Arial,sans-serif; font-size:13px; line-height:1.5;">
      <div class="moz-cite-prefix" style="margin:0 0 8px; color:#4b5563;">
        Dnia ${escapeHtml(formattedDate)}, użytkownik ${escapeHtml(context.from)} napisał:
      </div>
      <blockquote type="cite"${context.messageId ? ` cite="mid:${escapeHtml(context.messageId)}"` : ''} style="margin:0; padding:0 0 0 14px; border-left:2px solid #729fcf; color:#1f2937; background:#ffffff;">
        ${originalHtml}
      </blockquote>
    </div>`;
};

export default function ComposeEmailModal({
  isOpen,
  onClose,
  onSend,
  initialTo = '',
  initialSubject = '',
  initialBody = '',
  forwardedBody = '',
  replyContext,
  selectedAccountId,
  emailAccounts = [],
  onImproveWithAI,
}: ComposeEmailModalProps) {
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [signature, setSignature] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [employee, setEmployee] = useState<any>(null);
  const [fromAccountId, setFromAccountId] = useState<string>('');
  const [companySignatureHtml, setCompanySignatureHtml] = useState('');
  const [companySignatureEnabled, setCompanySignatureEnabled] = useState(false);
  const [companySignatureCompanyName, setCompanySignatureCompanyName] = useState<string | null>(null);
  const [loadingSignature, setLoadingSignature] = useState(false);
  const [signatureProfileLoaded, setSignatureProfileLoaded] = useState(false);
  const [improvingWithAI, setImprovingWithAI] = useState(false);
  const replyQuoteHtml = useMemo(() => buildReplyQuoteHtml(replyContext), [replyContext]);
  const selectableEmailAccounts = emailAccounts.filter(
    (account) => account.id !== 'all' && account.id !== 'contact_form',
  );
  const emailAccountIdsKey = selectableEmailAccounts.map((account) => account.id).join('|');
  const selectedReplyAccountId =
    selectedAccountId && !['all', 'contact_form'].includes(selectedAccountId)
      ? selectedAccountId
      : '';
  const effectiveAccountId = fromAccountId || selectedReplyAccountId || null;
  const composerDraft: UnifiedEmailDraft = {
    fromAccountId: effectiveAccountId || '',
    to,
    cc,
    bcc,
    subject,
    messageHtml: body,
  };
  const updateComposerDraft = (next: UnifiedEmailDraft) => {
    setFromAccountId(next.fromAccountId);
    setTo(next.to);
    setCc(next.cc);
    setBcc(next.bcc);
    setSubject(next.subject);
    setBody(next.messageHtml);
  };

  useEffect(() => {
    if (isOpen) {
      setTo(initialTo);
      setSubject(initialSubject);
      setBody(plainTextToEmailHtml(initialBody || forwardedBody || ''));
      setCc('');
      setBcc('');
      setAttachments([]);
      setSignatureProfileLoaded(false);
      void fetchSignatureAndTemplate();
    }
  }, [isOpen, initialTo, initialSubject, initialBody, forwardedBody]);

  useEffect(() => {
    if (!isOpen) return;

    setFromAccountId((currentAccountId) => {
      const accountStillAvailable = selectableEmailAccounts.some(
        (account) => account.id === currentAccountId,
      );
      const incomingAccountAvailable = selectableEmailAccounts.some(
        (account) => account.id === selectedReplyAccountId,
      );

      if (selectedReplyAccountId && (incomingAccountAvailable || selectableEmailAccounts.length === 0)) {
        return selectedReplyAccountId;
      }
      if (accountStillAvailable) return currentAccountId;
      return selectableEmailAccounts[0]?.id || selectedReplyAccountId;
    });
  }, [isOpen, selectedReplyAccountId, emailAccountIdsKey]);

  useEffect(() => {
    if (!isOpen) return;
    if (selectableEmailAccounts.length > 0 && !effectiveAccountId) return;

    let active = true;
    setLoadingSignature(true);
    buildCompanySignatureHtml({ emailAccountId: effectiveAccountId })
      .then((result) => {
        if (!active) return;
        setCompanySignatureHtml(result.html);
        setCompanySignatureEnabled(result.enabled);
        setCompanySignatureCompanyName(result.companyName);
      })
      .finally(() => {
        if (active) setLoadingSignature(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, effectiveAccountId, emailAccountIdsKey]);

  useEffect(() => {
    void generatePreview();
  }, [
    body,
    subject,
    signature,
    template,
    companySignatureHtml,
    companySignatureEnabled,
    fromAccountId,
    selectedAccountId,
    replyQuoteHtml,
    employee,
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
    } catch (error) {
      console.error('Error fetching signature/template:', error);
    } finally {
      setSignatureProfileLoaded(true);
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

  const buildCurrentMessageHtml = async () => {
    return buildUnifiedEmailHtml({
      draft: {
        fromAccountId: effectiveAccountId || '',
        to,
        cc,
        bcc,
        subject,
        messageHtml: body,
      },
      purpose: 'general',
      quotedHtml: replyQuoteHtml,
    });
  };

  const generatePreview = async () => {
    const html = await buildCurrentMessageHtml();
    setPreviewHtml(html);
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
    if (!to || !subject || !hasUnifiedEmailBody(body)) {
      alert('Wypełnij wszystkie pola');
      return;
    }

    if (!effectiveAccountId && selectableEmailAccounts.length > 0) {
      alert('Wybierz konto, z którego chcesz wysłać wiadomość');
      return;
    }

    if (loadingSignature || !signatureProfileLoaded) {
      alert('Poczekaj chwilę — przygotowujemy stopkę wybranego konta.');
      return;
    }

    setSending(true);
    try {
      const finalHtml = await buildCurrentMessageHtml();
      setPreviewHtml(finalHtml);
      await onSend({
        to,
        subject,
        body: typeof window === 'undefined'
          ? body.replace(/<[^>]*>/g, ' ').trim()
          : new DOMParser().parseFromString(body, 'text/html').body.textContent?.trim() || '',
        bodyHtml: finalHtml,
        attachments,
        fromAccountId: effectiveAccountId || undefined,
        cc: cc.trim(),
        bcc: bcc.trim(),
      });
      setTo('');
      setSubject('');
      setBody('');
      setAttachments([]);
      onClose();
    } catch (error: any) {
      console.error('Error sending:', error);
      alert(error?.message || 'Nie udało się wysłać wiadomości');
    }
    setSending(false);
  };

  const handleImproveWithAI = async () => {
    if (!onImproveWithAI) return;
    setImprovingWithAI(true);
    try {
      const improved = await onImproveWithAI({
        subject,
        body: typeof window === 'undefined'
          ? body.replace(/<[^>]*>/g, ' ').trim()
          : new DOMParser().parseFromString(body, 'text/html').body.textContent?.trim() || '',
      });
      setBody(plainTextToEmailHtml(improved.body));
      if (improved.subject) setSubject(improved.subject);
    } catch (error: any) {
      console.error('Error improving email with AI:', error);
      alert(error?.message || 'Nie udało się poprawić wiadomości z pomocą AI');
    } finally {
      setImprovingWithAI(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <h2 className="text-2xl font-bold text-white">
            {replyContext ? 'Odpowiedź' : forwardedBody ? 'Przekaż wiadomość' : 'Nowa wiadomość'}
          </h2>
          <div className="flex items-center gap-4">
            <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-white">
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <UnifiedEmailComposer
            draft={composerDraft}
            onChange={updateComposerDraft}
            accounts={selectableEmailAccounts}
            disabled={sending}
            showPreview={showPreview}
            onShowPreviewChange={setShowPreview}
            previewHtml={previewHtml}
            previewLoading={loadingSignature}
            replyContext={replyContext ? {
              from: replyContext.from,
              to: replyContext.to,
              cc: replyContext.cc,
            } : undefined}
            editorAction={onImproveWithAI ? (
              <button
                type="button"
                onClick={() => void handleImproveWithAI()}
                disabled={improvingWithAI || sending}
                className="inline-flex items-center gap-2 rounded-lg border border-violet-400/25 bg-violet-400/10 px-3 py-1.5 text-xs text-violet-200 transition-colors hover:bg-violet-400/15 disabled:opacity-50"
              >
                {improvingWithAI ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {improvingWithAI ? 'Redaguję…' : 'Popraw z AI'}
              </button>
            ) : null}
            afterEditor={replyContext ? (
              <details className="mt-3 overflow-hidden rounded-lg border border-[#d3bb73]/15 bg-[#0f1119]">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
                  Cytowana wiadomość — zostanie dołączona pod odpowiedzią i stopką
                </summary>
                <div className="max-h-64 overflow-y-auto border-t border-[#d3bb73]/10 bg-white p-3">
                  <div className="break-words text-sm text-[#1c1f33]" dangerouslySetInnerHTML={{ __html: replyQuoteHtml }} />
                </div>
              </details>
            ) : null}
          >
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/70">Załączniki</label>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#d3bb73] transition-colors hover:bg-[#1a1d2e]">
                <Paperclip className="h-5 w-5" />
                <span>Dodaj załącznik</span>
                <input type="file" onChange={handleFileSelect} multiple className="hidden" />
              </label>
              {attachments.length > 0 && (
                <div className="mt-2 space-y-2">
                  {attachments.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="flex items-center justify-between rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <Paperclip className="h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                        <div className="min-w-0">
                          <p className="truncate text-sm text-white">{file.name}</p>
                          <p className="text-xs text-[#e5e4e2]/50">{formatFileSize(file.size)}</p>
                        </div>
                      </div>
                      <button type="button" onClick={() => removeAttachment(index)} className="p-2 text-red-400 hover:text-red-300">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </UnifiedEmailComposer>
          {false && (!showPreview ? (
            <div className="space-y-4">
              {selectableEmailAccounts.length > 0 && (
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                    Konto nadawcze i stopka: <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={fromAccountId}
                    onChange={(e) => setFromAccountId(e.target.value)}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
                  >
                    <option value="">-- Wybierz konto email --</option>
                    {selectableEmailAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.display_name || account.account_name || account.email_address}
                        {account.email_address &&
                        !String(account.display_name || account.account_name || '').includes(
                          account.email_address,
                        )
                          ? ` — ${account.email_address}`
                          : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-[#e5e4e2]/50">
                    Przy odpowiedzi domyślnie używamy konta, na które przyszła wiadomość. Zmiana
                    konta automatycznie zmieni również stopkę.
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
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/70">DW:</label>
                  <input
                    type="email"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="Opcjonalnie"
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/70">UDW:</label>
                  <input
                    type="email"
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="Opcjonalnie"
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>
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
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-sm text-[#e5e4e2]/70">Wiadomość:</label>
                  {onImproveWithAI && (
                    <button
                      type="button"
                      onClick={() => void handleImproveWithAI()}
                      disabled={improvingWithAI}
                      className="inline-flex items-center gap-2 rounded-lg border border-violet-400/25 bg-violet-400/10 px-3 py-1.5 text-xs text-violet-200 transition-colors hover:bg-violet-400/15 disabled:opacity-50"
                    >
                      {improvingWithAI ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {improvingWithAI ? 'Redaguję…' : 'Popraw z AI'}
                    </button>
                  )}
                </div>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Treść wiadomości..."
                  rows={12}
                  className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
                />
                {replyContext && (
                  <details className="mt-3 overflow-hidden rounded-lg border border-[#d3bb73]/15 bg-[#0f1119]">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
                      Pełna cytowana wiadomość — zostanie dołączona pod odpowiedzią i stopką
                    </summary>
                    <div className="max-h-64 overflow-y-auto border-t border-[#d3bb73]/10 bg-white p-3">
                      <div
                        className="break-words text-sm text-[#1c1f33]"
                        dangerouslySetInnerHTML={{ __html: replyQuoteHtml }}
                      />
                    </div>
                  </details>
                )}
                {!loadingSignature && !signature && !companySignatureEnabled && !employee ? (
                  <div className="mt-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
                    <p className="text-xs text-yellow-400">
                      ⚠️ Dla wybranego konta nie znaleziono danych stopki.
                      <br />
                      <a
                        href="/crm/settings/email-signature"
                        className="underline hover:text-yellow-300"
                      >
                        Otwórz ustawienia stopek e-mail
                      </a>
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-[#e5e4e2]/50">
                    {loadingSignature
                      ? 'Sprawdzam stopkę wybranego konta…'
                      : companySignatureEnabled
                        ? `✓ Stopka firmowa${companySignatureCompanyName ? `: ${companySignatureCompanyName}` : ''}`
                        : signature
                          ? '✓ Stopka pracownika zostanie dodana automatycznie'
                          : '✓ Stopka zostanie utworzona z danych profilu pracownika'}
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
          ))}
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
            disabled={sending || loadingSignature || !signatureProfileLoaded}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#c5ad65] disabled:opacity-50"
          >
            {sending ? (
              <>
                <RefreshCw className="h-5 w-5 animate-spin" />
                Wysyłanie...
              </>
            ) : (
              <>
                {loadingSignature || !signatureProfileLoaded ? (
                  <RefreshCw className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
                Wyślij
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
