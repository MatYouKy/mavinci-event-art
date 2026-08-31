'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCompanySignatureHtml } from '@/lib/buildCompanySignature';

interface EmailHtmlPreviewProps {
  html: string;
  employeeId?: string | null;
  emailAccountId?: string | null;
  title?: string;
}

const replaceCidImages = (html: string, replacementSources: string[] = []) => {
  let imageIndex = 0;

  return html.replace(/<img\b[^>]*\bsrc\s*=\s*(["'])cid:[^"']+\1[^>]*>/gi, (tag) => {
    const replacement = replacementSources[imageIndex];
    imageIndex += 1;

    if (!replacement) return '';
    return tag.replace(
      /(\bsrc\s*=\s*)(["'])cid:[^"']+\2/i,
      (_source, prefix: string, quote: string) => `${prefix}${quote}${replacement}${quote}`,
    );
  });
};

const extractImageSources = (html: string) =>
  Array.from(html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/gi))
    .map((match) => match[2])
    .filter(Boolean);

const removeActiveEmailContent = (html: string) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<(?:object|embed)\b[^>]*>[\s\S]*?<\/(?:object|embed)>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*(["'])?refresh\1?[^>]*>/gi, '');

const previewStyles = `
  <style>
    :root { color-scheme: light; }
    html, body { margin: 0; padding: 0; min-height: 100%; background: #ffffff; color: #1c1f33; }
    body { padding: 18px; box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; }
    a { color: #7f1734; }
    blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #d3bb73; }
  </style>
  <base target="_blank" />
`;

const buildPreviewDocument = (html: string) => {
  const safeHtml = removeActiveEmailContent(html);

  if (/<html\b/i.test(safeHtml)) {
    if (/<head\b[^>]*>/i.test(safeHtml)) {
      return safeHtml.replace(/<head\b[^>]*>/i, (head) => `${head}${previewStyles}`);
    }
    return safeHtml.replace(/<html\b[^>]*>/i, (root) => `${root}<head>${previewStyles}</head>`);
  }

  return `<!doctype html><html><head>${previewStyles}</head><body>${safeHtml}</body></html>`;
};

export default function EmailHtmlPreview({
  html,
  employeeId,
  emailAccountId,
  title = 'Treść wiadomości email',
}: EmailHtmlPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [iframeHeight, setIframeHeight] = useState(180);
  const [resolvedHtml, setResolvedHtml] = useState(() => replaceCidImages(html));

  useEffect(() => {
    let active = true;
    const withoutBrokenCidRequests = replaceCidImages(html);
    setResolvedHtml(withoutBrokenCidRequests);

    if (!/\bsrc\s*=\s*(["'])cid:/i.test(html) || (!employeeId && !emailAccountId)) {
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        const signature = await buildCompanySignatureHtml({ employeeId, emailAccountId });
        if (!active) return;
        setResolvedHtml(replaceCidImages(html, extractImageSources(signature.html)));
      } catch (error) {
        console.warn('Nie udało się odtworzyć obrazów historycznej stopki:', error);
      }
    })();

    return () => {
      active = false;
    };
  }, [emailAccountId, employeeId, html]);

  const srcDoc = useMemo(() => buildPreviewDocument(resolvedHtml), [resolvedHtml]);

  useEffect(() => {
    setIframeHeight(180);
  }, [srcDoc]);

  useEffect(
    () => () => {
      resizeObserverRef.current?.disconnect();
    },
    [],
  );

  const updateHeight = () => {
    const iframe = iframeRef.current;
    const document = iframe?.contentDocument;
    if (!document) return;

    const nextHeight = Math.max(
      120,
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0,
    );
    setIframeHeight(nextHeight);

    resizeObserverRef.current?.disconnect();
    if (typeof ResizeObserver !== 'undefined' && document.body) {
      const observer = new ResizeObserver(() => {
        const currentDocument = iframeRef.current?.contentDocument;
        if (!currentDocument) return;
        setIframeHeight(
          Math.max(
            120,
            currentDocument.documentElement.scrollHeight,
            currentDocument.body?.scrollHeight || 0,
          ),
        );
      });
      observer.observe(document.body);
      resizeObserverRef.current = observer;
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-[#d3bb73]/15 bg-white shadow-sm">
      <iframe
        ref={iframeRef}
        title={title}
        srcDoc={srcDoc}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        onLoad={updateHeight}
        className="block w-full border-0 bg-white"
        style={{ height: `${iframeHeight}px` }}
      />
    </div>
  );
}
