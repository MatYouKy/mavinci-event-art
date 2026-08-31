'use client';

import dynamic from 'next/dynamic';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Code, Eye } from 'lucide-react';
import 'react-quill/dist/quill.snow.css';
import {
  buildCompanyEmailBody,
  buildCompanySignatureHtml,
} from '@/lib/buildCompanySignature';
import type { EmailTemplatePurpose } from '@/lib/buildCompanySignature';
import { supabase } from '@/lib/supabase/browser';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });

export interface UnifiedEmailDraft {
  fromAccountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  messageHtml: string;
}

export interface UnifiedEmailAccount {
  id: string;
  email_address: string;
  from_name?: string | null;
  display_name?: string | null;
  account_name?: string | null;
  account_type?: string | null;
  is_default?: boolean | null;
}

export const loadUnifiedEmailAccounts = async (): Promise<UnifiedEmailAccount[]> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('id')
    .or(`id.eq.${user.id},auth_user_id.eq.${user.id}`)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (employeeError) throw employeeError;
  const employeeId = employee?.id || user.id;

  const [personalResult, assignmentsResult] = await Promise.all([
    supabase
      .from('employee_email_accounts')
      .select('id,email_address,from_name,account_name,account_type,is_default')
      .eq('employee_id', employeeId)
      .eq('is_active', true)
      .or('account_type.is.null,account_type.neq.system'),
    supabase
      .from('employee_email_account_assignments')
      .select('email_account_id')
      .eq('employee_id', employeeId)
      .eq('can_send', true),
  ]);
  if (personalResult.error) throw personalResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;

  const assignedIds = (assignmentsResult.data || []).map((row) => row.email_account_id);
  let assignedAccounts: UnifiedEmailAccount[] = [];
  if (assignedIds.length) {
    const assignedResult = await supabase
      .from('employee_email_accounts')
      .select('id,email_address,from_name,account_name,account_type,is_default')
      .in('id', assignedIds)
      .eq('is_active', true)
      .or('account_type.is.null,account_type.neq.system');
    if (assignedResult.error) throw assignedResult.error;
    assignedAccounts = assignedResult.data || [];
  }

  return Array.from(
    new Map(
      [...(personalResult.data || []), ...assignedAccounts].map((account) => [account.id, account]),
    ).values(),
  ).sort((left, right) => {
    if (Boolean(left.is_default) !== Boolean(right.is_default)) return left.is_default ? -1 : 1;
    const leftPersonal = (left.account_type || 'personal') === 'personal';
    const rightPersonal = (right.account_type || 'personal') === 'personal';
    if (leftPersonal !== rightPersonal) return leftPersonal ? -1 : 1;
    return left.email_address.localeCompare(right.email_address, 'pl');
  });
};

export interface UnifiedReplyContext {
  from: string;
  to?: string | string[] | null;
  cc?: string | string[] | null;
}

interface UnifiedEmailComposerProps {
  draft: UnifiedEmailDraft;
  onChange: (draft: UnifiedEmailDraft) => void;
  accounts: UnifiedEmailAccount[];
  accountsLoading?: boolean;
  disabled?: boolean;
  showPreview: boolean;
  onShowPreviewChange: (show: boolean) => void;
  previewHtml: string;
  previewLoading?: boolean;
  recipientHint?: ReactNode;
  recipientSuggestions?: ReactNode;
  editorAction?: ReactNode;
  afterEditor?: ReactNode;
  children?: ReactNode;
  accountHelp?: ReactNode;
  replyContext?: UnifiedReplyContext;
}

const emailEditorModules = {
  toolbar: [
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ indent: '-1' }, { indent: '+1' }],
    ['link'],
    ['clean'],
  ],
};

const emailEditorFormats = [
  'bold',
  'italic',
  'underline',
  'list',
  'bullet',
  'indent',
  'link',
];

export const plainTextToEmailHtml = (value: string): string => {
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>') || '<br>'}</p>`)
    .join('');
};

export const normalizeUnifiedEmailHtml = (html: string): string => {
  if (!html || typeof window === 'undefined') return html;

  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  documentNode
    .querySelectorAll('script, style, iframe, object, embed, form, input, button, meta, link, base')
    .forEach((element) => element.remove());

  documentNode.body.querySelectorAll<HTMLElement>('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith('on') ||
        ((name === 'href' || name === 'src') && value.startsWith('javascript:'))
      ) {
        element.removeAttribute(attribute.name);
      }
    });

    const indentMatch = element.className.match(/(?:^|\s)ql-indent-(\d+)(?:\s|$)/);
    if (indentMatch) element.style.marginLeft = `${Number(indentMatch[1]) * 24}px`;

    if (element.classList.contains('ql-align-center')) element.style.textAlign = 'center';
    if (element.classList.contains('ql-align-right')) element.style.textAlign = 'right';
    if (element.classList.contains('ql-align-justify')) element.style.textAlign = 'justify';
  });

  documentNode.body.querySelectorAll<HTMLElement>('p').forEach((paragraph) => {
    paragraph.style.margin = paragraph.textContent?.trim() ? '0 0 10px' : '0 0 8px';
  });
  documentNode.body.querySelectorAll<HTMLElement>('ol, ul').forEach((list) => {
    list.style.margin = '8px 0 12px';
    list.style.paddingLeft = '26px';
  });
  documentNode.body.querySelectorAll<HTMLElement>('li').forEach((item) => {
    item.style.margin = '4px 0';
  });

  return documentNode.body.innerHTML;
};

export const hasUnifiedEmailBody = (html: string): boolean => {
  if (!html) return false;
  if (typeof window !== 'undefined') {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    return Boolean(parsed.body.textContent?.replace(/\u00a0/g, ' ').trim());
  }
  return Boolean(html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim());
};

export const unifiedEmailHtmlToPlainText = (html: string): string => {
  if (typeof window === 'undefined') {
    return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ').trim();
  }
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() || '';
};

interface BuildUnifiedEmailOptions {
  draft: UnifiedEmailDraft;
  purpose: EmailTemplatePurpose;
  recipientName?: string;
  companyId?: string | null;
  quotedHtml?: string;
}

export const buildUnifiedEmailContent = async (
  options: BuildUnifiedEmailOptions,
): Promise<{ html: string; signatureHtml: string }> => {
  const signature = await buildCompanySignatureHtml({
    companyId: options.companyId,
    emailAccountId: options.draft.fromAccountId || null,
  });
  const result = await buildCompanyEmailBody({
    content: normalizeUnifiedEmailHtml(options.draft.messageHtml),
    contentIsHtml: true,
    subject: options.draft.subject,
    recipientName: options.recipientName,
    signatureHtml: signature.html,
    purpose: options.purpose,
    companyId: options.companyId,
    emailAccountId: options.draft.fromAccountId || null,
  });
  return {
    html: `${result.html}${options.quotedHtml || ''}`,
    signatureHtml: result.signatureHtml || signature.html,
  };
};

export const buildUnifiedEmailHtml = async (
  options: BuildUnifiedEmailOptions,
): Promise<string> => (await buildUnifiedEmailContent(options)).html;

const extractAddresses = (value: string | string[] | null | undefined): string[] => {
  const source = Array.isArray(value) ? value.join(',') : value || '';
  const matches = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return Array.from(new Set(matches.map((address) => address.trim().toLowerCase())));
};

const getAccountLabel = (account: UnifiedEmailAccount): string => {
  const name = account.display_name || account.account_name || account.from_name || '';
  const shared = account.account_type === 'shared' ? ' (wspólna)' : '';
  return `${name ? `${name} — ` : ''}${account.email_address}${shared}`;
};

export default function UnifiedEmailComposer({
  draft,
  onChange,
  accounts,
  accountsLoading = false,
  disabled = false,
  showPreview,
  onShowPreviewChange,
  previewHtml,
  previewLoading = false,
  recipientHint,
  recipientSuggestions,
  editorAction,
  afterEditor,
  children,
  accountHelp,
  replyContext,
}: UnifiedEmailComposerProps) {
  const [replyMode, setReplyMode] = useState<'reply' | 'replyAll'>('reply');
  const selectedAccountEmail = accounts.find((account) => account.id === draft.fromAccountId)
    ?.email_address;

  const replyAllCc = useMemo(() => {
    if (!replyContext) return '';
    const primaryRecipients = new Set(extractAddresses(draft.to));
    const excluded = new Set([
      ...primaryRecipients,
      ...extractAddresses(selectedAccountEmail),
      ...extractAddresses(replyContext.from),
    ]);
    return [...extractAddresses(replyContext.to), ...extractAddresses(replyContext.cc)]
      .filter((address, index, all) => !excluded.has(address) && all.indexOf(address) === index)
      .join(', ');
  }, [draft.to, replyContext, selectedAccountEmail]);

  useEffect(() => {
    if (replyMode === 'replyAll') {
      onChange({ ...draft, cc: replyAllCc });
    }
  }, [replyAllCc, replyMode]);

  const change = (patch: Partial<UnifiedEmailDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        {replyContext && replyAllCc ? (
          <div className="inline-flex rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-1">
            <button
              type="button"
              onClick={() => {
                setReplyMode('reply');
                change({ cc: '' });
              }}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                replyMode === 'reply' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/70'
              }`}
            >
              Odpowiedz
            </button>
            <button
              type="button"
              onClick={() => {
                setReplyMode('replyAll');
                change({ cc: replyAllCc });
              }}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                replyMode === 'replyAll'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/70'
              }`}
            >
              Odpowiedz wszystkim
            </button>
          </div>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => onShowPreviewChange(!showPreview)}
          disabled={previewLoading}
          className="ml-auto flex items-center gap-2 rounded-lg bg-[#0f1119] px-3 py-2 text-[#d3bb73] transition-colors hover:bg-[#1a1d2e] disabled:opacity-50"
        >
          {showPreview ? <Code className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {previewLoading ? 'Przygotowuję…' : showPreview ? 'Edycja' : 'Podgląd'}
        </button>
      </div>

      {showPreview ? (
        <div>
          <div className="mb-4 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-4 text-sm text-[#e5e4e2]/70">
            <strong>Podgląd:</strong> tak będzie wyglądać wiadomość u odbiorcy.
          </div>
          <div className="overflow-x-auto rounded-lg bg-white p-4 text-[#1c1f33] [color-scheme:light]">
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      ) : (
        <>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/70">
              Konto nadawcze i stopka <span className="text-red-400">*</span>
            </label>
            <select
              value={draft.fromAccountId}
              onChange={(event) => change({ fromAccountId: event.target.value })}
              disabled={disabled || accountsLoading}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
            >
              <option value="">
                {accountsLoading ? 'Pobieranie dostępnych skrzynek…' : 'Wybierz skrzynkę'}
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {getAccountLabel(account)}
                </option>
              ))}
            </select>
            {accountHelp || (
              <p className="mt-1 text-xs text-[#e5e4e2]/45">
                Wybrana skrzynka określa nadawcę, adres odpowiedzi i właściwą stopkę firmową.
              </p>
            )}
            {!accountsLoading && accounts.length === 0 && (
              <p className="mt-2 text-xs text-red-300">
                Brak aktywnej skrzynki dostępnej do wysyłki.
              </p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/70">
              Do <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={draft.to}
              onChange={(event) => change({ to: event.target.value })}
              disabled={disabled}
              placeholder="adres@email.pl lub kilka adresów po przecinku"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
            />
            {recipientHint}
            {recipientSuggestions}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/70">DW</label>
              <input
                type="text"
                value={draft.cc}
                onChange={(event) => change({ cc: event.target.value })}
                disabled={disabled}
                placeholder="adresy po przecinku"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/70">UDW</label>
              <input
                type="text"
                value={draft.bcc}
                onChange={(event) => change({ bcc: event.target.value })}
                disabled={disabled}
                placeholder="adresy ukryte po przecinku"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/70">
              Temat <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={draft.subject}
              onChange={(event) => change({ subject: event.target.value })}
              disabled={disabled}
              placeholder="Temat wiadomości"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="block text-sm text-[#e5e4e2]/70">Wiadomość</label>
              {editorAction}
            </div>
            <div className="unified-email-editor overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] focus-within:border-[#d3bb73]">
              <ReactQuill
                theme="snow"
                value={draft.messageHtml}
                onChange={(messageHtml) => change({ messageHtml })}
                readOnly={disabled}
                modules={emailEditorModules}
                formats={emailEditorFormats}
                placeholder="Wpisz treść wiadomości..."
              />
            </div>
            <p className="mt-2 text-xs text-[#e5e4e2]/50">
              Dostępne są listy, podpunkty, wcięcia, linki i podstawowe formatowanie. Stopka jest
              dodawana automatycznie.
            </p>
            {afterEditor}
          </div>

          {children}
        </>
      )}

      <style jsx global>{`
        .unified-email-editor .ql-toolbar.ql-snow {
          border: 0;
          border-bottom: 1px solid rgba(211, 187, 115, 0.2);
          background: #0f1119;
        }
        .unified-email-editor .ql-container.ql-snow {
          border: 0;
          background: #0a0d1a;
          font-family: Arial, sans-serif;
          font-size: 14px;
        }
        .unified-email-editor .ql-editor {
          min-height: 220px;
          max-height: 360px;
          overflow-y: auto;
          color: #e5e4e2;
          line-height: 1.6;
        }
        .unified-email-editor .ql-editor.ql-blank::before {
          color: rgba(229, 228, 226, 0.35);
          font-style: normal;
        }
        .unified-email-editor .ql-stroke { stroke: rgba(229, 228, 226, 0.75); }
        .unified-email-editor .ql-fill { fill: rgba(229, 228, 226, 0.75); }
        .unified-email-editor .ql-picker { color: rgba(229, 228, 226, 0.75); }
        .unified-email-editor .ql-toolbar button:hover .ql-stroke,
        .unified-email-editor .ql-toolbar button.ql-active .ql-stroke { stroke: #d3bb73; }
        .unified-email-editor .ql-toolbar button:hover .ql-fill,
        .unified-email-editor .ql-toolbar button.ql-active .ql-fill { fill: #d3bb73; }
      `}</style>
    </div>
  );
}
