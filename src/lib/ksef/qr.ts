import 'server-only';

import { createHash } from 'node:crypto';
import QRCode from 'qrcode';

export type KsefQrEnvironment = 'test' | 'demo' | 'production';

const QR_BASE_URLS: Record<KsefQrEnvironment, string> = {
  test: 'https://qr-test.ksef.mf.gov.pl',
  demo: 'https://qr-demo.ksef.mf.gov.pl',
  production: 'https://qr.ksef.mf.gov.pl',
};

function normalizeNip(value: string): string {
  const nip = value.replace(/\D/g, '');
  if (nip.length !== 10) throw new Error('Nieprawidłowy NIP sprzedawcy dla kodu QR KSeF');
  return nip;
}

function formatIssueDate(value: string): string {
  const date = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error('Nieprawidłowa data wystawienia dla kodu QR KSeF');
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function getKsefInvoiceHash(xmlContent: string): string {
  if (!xmlContent) throw new Error('Brak oryginalnego XML faktury KSeF');
  return createHash('sha256').update(Buffer.from(xmlContent, 'utf8')).digest('base64url');
}

export function buildKsefInvoiceVerificationUrl(params: {
  sellerNip: string;
  issueDate: string;
  xmlContent: string;
  environment: KsefQrEnvironment;
}): string {
  const nip = normalizeNip(params.sellerNip);
  const issueDate = formatIssueDate(params.issueDate);
  const invoiceHash = getKsefInvoiceHash(params.xmlContent);
  return `${QR_BASE_URLS[params.environment]}/invoice/${nip}/${issueDate}/${invoiceHash}`;
}

export async function generateKsefInvoiceQrDataUrl(params: {
  sellerNip: string;
  issueDate: string;
  xmlContent: string;
  environment: KsefQrEnvironment;
}): Promise<{ dataUrl: string; verificationUrl: string }> {
  const verificationUrl = buildKsefInvoiceVerificationUrl(params);
  const dataUrl = await QRCode.toDataURL(verificationUrl, {
    type: 'image/png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 180,
    color: { dark: '#000000', light: '#ffffff' },
  });

  return { dataUrl, verificationUrl };
}
