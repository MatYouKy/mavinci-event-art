import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Buffer } from 'node:buffer';
import { X509Certificate, constants, publicEncrypt } from 'node:crypto';

const KSEF_TEST_URL = 'https://api-test.ksef.mf.gov.pl/v2';
const KSEF_PROD_URL = 'https://api.ksef.mf.gov.pl/v2';
const REQUEST_TIMEOUT_MS = 30_000;

type Credentials = {
  id: string;
  my_company_id: string;
  nip: string;
  token: string;
  is_test_environment: boolean;
  access_token: string | null;
  access_token_valid_until: string | null;
  refresh_token: string | null;
  refresh_token_valid_until: string | null;
};

type ParsedInvoice = {
  invoice_number: string | null;
  issue_date: string | null;
  seller_name: string | null;
  seller_nip: string | null;
  seller_address: string | null;
  buyer_name: string | null;
  buyer_nip: string | null;
  buyer_address: string | null;
  net_amount: number | null;
  vat_amount: number | null;
  gross_amount: number | null;
  vat_rate: string | null;
  currency: string;
  payment_method: string | null;
  payment_due_date: string | null;
  payment_date: string | null;
  bank_account_number: string | null;
  invoice_items: Array<Record<string, unknown>>;
};

function decodeJwtRole(authorization: string | null) {
  try {
    const token = authorization?.replace(/^Bearer\s+/i, '').trim() || '';
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded))?.role || null;
  } catch {
    return null;
  }
}

function baseUrl(isTestEnvironment: boolean) {
  return isTestEnvironment ? KSEF_TEST_URL : KSEF_PROD_URL;
}

async function ksefJson<T>(
  credentials: Pick<Credentials, 'is_test_environment'>,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`${baseUrl(credentials.is_test_environment)}${path}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`KSeF API ${response.status}: ${raw}`);
  }

  return (raw ? JSON.parse(raw) : null) as T;
}

function certificateToPem(certificate: string) {
  const normalized = certificate
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  const chunks = normalized.match(/.{1,64}/g) || [];
  return ['-----BEGIN CERTIFICATE-----', ...chunks, '-----END CERTIFICATE-----'].join('\n');
}

function encryptKSeFToken(payload: string, certificate: string) {
  const x509 = new X509Certificate(certificateToPem(certificate));
  return publicEncrypt(
    {
      key: x509.publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(payload, 'utf8'),
  ).toString('base64');
}

async function fullAuthentication(supabase: any, credentials: Credentials) {
  const challenge = await ksefJson<any>(credentials, '/auth/challenge', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  const certificates = await ksefJson<any[]>(credentials, '/security/public-key-certificates', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const encryptionCertificate = certificates.find((item) =>
    Array.isArray(item.usage) && item.usage.includes('KsefTokenEncryption')
  );

  if (!encryptionCertificate?.certificate) {
    throw new Error('Brak certyfikatu KsefTokenEncryption.');
  }

  const authentication = await ksefJson<any>(credentials, '/auth/ksef-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      challenge: challenge.challenge,
      contextIdentifier: { type: 'Nip', value: credentials.nip },
      encryptedToken: encryptKSeFToken(
        `${credentials.token}|${challenge.timestampMs}`,
        encryptionCertificate.certificate,
      ),
    }),
  });

  const authenticationToken = authentication?.authenticationToken?.token;
  if (!authenticationToken || !authentication?.referenceNumber) {
    throw new Error('KSeF nie zwrócił danych rozpoczętej autoryzacji.');
  }

  let status: any = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 1200 : 750));
    status = await ksefJson<any>(credentials, `/auth/${authentication.referenceNumber}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${authenticationToken}` },
    });
    if (status?.status?.code === 200) break;
  }

  if (status?.status?.code !== 200) {
    throw new Error(`Autoryzacja KSeF nie została zakończona: ${status?.status?.description || 'timeout'}`);
  }

  const redeemed = await ksefJson<any>(credentials, '/auth/token/redeem', {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${authenticationToken}` },
  });
  const accessToken = redeemed?.accessToken?.token;

  if (!accessToken) throw new Error('KSeF nie zwrócił accessToken.');

  const { error } = await supabase
    .from('ksef_credentials')
    .update({
      access_token: accessToken,
      access_token_valid_until: redeemed.accessToken?.validUntil || null,
      refresh_token: redeemed.refreshToken?.token || null,
      refresh_token_valid_until: redeemed.refreshToken?.validUntil || null,
      last_auth_reference_number: authentication.referenceNumber,
      last_authenticated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', credentials.id);

  if (error) throw error;
  return accessToken as string;
}

function tokenIsValid(validUntil: string | null, marginMs = 120_000) {
  return Boolean(validUntil && new Date(validUntil).getTime() > Date.now() + marginMs);
}

async function ensureAccessToken(supabase: any, credentials: Credentials) {
  if (credentials.access_token && tokenIsValid(credentials.access_token_valid_until)) {
    return credentials.access_token;
  }

  if (credentials.refresh_token && tokenIsValid(credentials.refresh_token_valid_until)) {
    try {
      const refreshed = await ksefJson<any>(credentials, '/auth/token/refresh', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${credentials.refresh_token}`,
        },
      });
      const accessToken = refreshed?.accessToken?.token;
      if (!accessToken) throw new Error('Brak accessToken po odświeżeniu.');

      const { error } = await supabase
        .from('ksef_credentials')
        .update({
          access_token: accessToken,
          access_token_valid_until: refreshed.accessToken?.validUntil || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', credentials.id);
      if (error) throw error;
      return accessToken as string;
    } catch (error) {
      console.warn('[KSEF_DAILY] refresh failed, starting full authentication', error);
    }
  }

  return await fullAuthentication(supabase, credentials);
}

function tagContent(source: string, tag: string) {
  const match = source.match(
    new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`),
  );
  return match?.[1]?.trim() || null;
}

function allTagContents(source: string, tag: string) {
  const regex = new RegExp(
    `<(?:[a-zA-Z0-9_]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`,
    'g',
  );
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) values.push(match[1]);
  return values;
}

function decodeXml(value: string | null) {
  return value
    ?.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim() || null;
}

function numberValue(value: string | null) {
  if (!value) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function buildAddress(block: string) {
  const address = tagContent(block, 'AdresPol') || tagContent(block, 'AdresZagr') || block;
  const locality = [tagContent(address, 'KodPocztowy'), tagContent(address, 'Miejscowosc')]
    .filter(Boolean)
    .join(' ');
  const street = [tagContent(address, 'Ulica'), tagContent(address, 'NrDomu')]
    .filter(Boolean)
    .join(' ');
  return decodeXml([locality, street].filter(Boolean).join(', '));
}

function normalizeDate(value: string | null) {
  return value?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null;
}

function parseInvoiceXml(xml: string): ParsedInvoice {
  const seller = tagContent(xml, 'Podmiot1') || '';
  const buyer = tagContent(xml, 'Podmiot2') || '';
  const invoice = tagContent(xml, 'Fa') || xml;
  const payment = tagContent(invoice, 'Platnosc') || '';
  const dueDateRaw = tagContent(payment, 'TerminPlatnosci');
  const paidFlag = tagContent(payment, 'Zaplacono');
  const itemBlocks = allTagContents(xml, 'FaWiersz');
  const netValues = Array.from(invoice.matchAll(/<(?:\w+:)?P_13_\d+\b[^>]*>([^<]+)</g))
    .map((match) => numberValue(match[1]))
    .filter((value): value is number => value !== null);
  const vatValues = Array.from(invoice.matchAll(/<(?:\w+:)?P_14_\d+\b[^>]*>([^<]+)</g))
    .map((match) => numberValue(match[1]))
    .filter((value): value is number => value !== null);
  const issueDate = normalizeDate(tagContent(invoice, 'P_1'));

  const items = itemBlocks.map((block, index) => ({
    position_number: numberValue(tagContent(block, 'NrWierszaFa')) || index + 1,
    name: decodeXml(tagContent(block, 'P_7') || tagContent(block, 'P_7A')) || 'Pozycja',
    unit: decodeXml(tagContent(block, 'P_8A')) || 'szt.',
    quantity: numberValue(tagContent(block, 'P_8B')) || 1,
    price_net: numberValue(tagContent(block, 'P_9A')),
    value_net: numberValue(tagContent(block, 'P_11')),
    vat_rate: tagContent(block, 'P_12'),
    value_gross: numberValue(tagContent(block, 'P_11A')),
  }));

  return {
    invoice_number: decodeXml(tagContent(invoice, 'P_2')),
    issue_date: issueDate,
    seller_name: decodeXml(tagContent(seller, 'Nazwa') || tagContent(seller, 'PelnaNazwa')),
    seller_nip: tagContent(seller, 'NIP') || tagContent(seller, 'Nip'),
    seller_address: buildAddress(seller),
    buyer_name: decodeXml(tagContent(buyer, 'Nazwa') || tagContent(buyer, 'PelnaNazwa')),
    buyer_nip: tagContent(buyer, 'NIP') || tagContent(buyer, 'Nip'),
    buyer_address: buildAddress(buyer),
    net_amount: netValues.length ? netValues.reduce((sum, value) => sum + value, 0) : null,
    vat_amount: vatValues.length ? vatValues.reduce((sum, value) => sum + value, 0) : null,
    gross_amount: numberValue(tagContent(invoice, 'P_15')),
    vat_rate: items[0]?.vat_rate ? String(items[0].vat_rate) : null,
    currency: tagContent(invoice, 'KodWaluty') || 'PLN',
    payment_method: tagContent(payment, 'FormaPlatnosci'),
    payment_due_date: normalizeDate(tagContent(dueDateRaw || '', 'Termin') || dueDateRaw),
    payment_date: paidFlag === '1' || paidFlag?.toLowerCase() === 'tak' ? issueDate : null,
    bank_account_number: tagContent(tagContent(payment, 'RachunekBankowy') || '', 'NrRB'),
    invoice_items: items,
  };
}

function paymentStatus(invoice: ParsedInvoice) {
  if (invoice.payment_method === '1' || invoice.payment_method === '2' || invoice.payment_date) {
    return 'paid';
  }
  if (invoice.payment_due_date && new Date(invoice.payment_due_date) < new Date()) {
    return 'overdue';
  }
  return 'unpaid';
}

async function fetchInvoiceMetadata(
  credentials: Credentials,
  accessToken: string,
  subjectType: 'Subject1' | 'Subject2',
  dateFrom: string,
  dateTo: string,
) {
  const invoices: any[] = [];
  const seen = new Set<string>();

  for (let pageOffset = 0; pageOffset < 100; pageOffset += 1) {
    const page = await ksefJson<any>(
      credentials,
      `/invoices/query/metadata?sortOrder=Desc&pageOffset=${pageOffset}&pageSize=100`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          subjectType,
          dateRange: { dateType: 'PermanentStorage', from: dateFrom, to: dateTo },
        }),
      },
    );
    const rows = Array.isArray(page?.invoices) ? page.invoices : [];
    let added = 0;
    for (const invoice of rows) {
      const reference = invoice.ksefNumber || invoice.ksefReferenceNumber || invoice.referenceNumber;
      if (!reference || seen.has(reference)) continue;
      seen.add(reference);
      invoices.push(invoice);
      added += 1;
    }
    if (rows.length < 100 || page?.hasMore === false || added === 0) break;
  }
  return invoices;
}

async function fetchInvoiceXml(credentials: Credentials, accessToken: string, reference: string) {
  const response = await fetch(
    `${baseUrl(credentials.is_test_environment)}/invoices/ksef/${encodeURIComponent(reference)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/octet-stream', Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const xml = await response.text();
  if (!response.ok) throw new Error(`Pobranie XML ${reference}: HTTP ${response.status} ${xml}`);
  return xml;
}

async function existingReferences(supabase: any, references: string[]) {
  const existing = new Set<string>();
  for (let offset = 0; offset < references.length; offset += 200) {
    const { data, error } = await supabase
      .from('ksef_invoices')
      .select('ksef_reference_number')
      .in('ksef_reference_number', references.slice(offset, offset + 200));
    if (error) throw error;
    for (const row of data || []) existing.add(row.ksef_reference_number);
  }
  return existing;
}

async function syncDirection(
  supabase: any,
  credentials: Credentials,
  accessToken: string,
  direction: 'issued' | 'received',
  dateFrom: string,
  dateTo: string,
) {
  const metadata = await fetchInvoiceMetadata(
    credentials,
    accessToken,
    direction === 'issued' ? 'Subject1' : 'Subject2',
    dateFrom,
    dateTo,
  );
  const refs = metadata
    .map((item) => item.ksefNumber || item.ksefReferenceNumber || item.referenceNumber)
    .filter(Boolean);
  const existing = await existingReferences(supabase, refs);
  const rows: any[] = [];

  for (const item of metadata) {
    const reference = item.ksefNumber || item.ksefReferenceNumber || item.referenceNumber;
    if (!reference || existing.has(reference)) continue;

    try {
      const xml = await fetchInvoiceXml(credentials, accessToken, reference);
      const parsed = parseInvoiceXml(xml);
      rows.push({
        ksef_reference_number: reference,
        my_company_id: credentials.my_company_id,
        invoice_number: parsed.invoice_number || item.invoiceNumber || null,
        invoice_type: direction,
        seller_name: parsed.seller_name || item.seller?.name || null,
        seller_nip: parsed.seller_nip || item.seller?.nip || null,
        seller_address: parsed.seller_address,
        buyer_name: parsed.buyer_name || item.buyer?.name || null,
        buyer_nip: parsed.buyer_nip || item.buyer?.nip || null,
        buyer_address: parsed.buyer_address,
        net_amount: parsed.net_amount ?? item.netAmount ?? null,
        gross_amount: parsed.gross_amount ?? item.grossAmount ?? null,
        vat_amount: parsed.vat_amount ?? item.vatAmount ?? null,
        vat_rate: parsed.vat_rate ? `${parsed.vat_rate}%` : null,
        invoice_items: parsed.invoice_items,
        currency: parsed.currency || item.currency || 'PLN',
        issue_date: parsed.issue_date || normalizeDate(item.issueDate),
        payment_due_date: parsed.payment_due_date,
        payment_date: parsed.payment_date,
        payment_method: parsed.payment_method,
        bank_account_number: parsed.bank_account_number,
        payment_status: paymentStatus(parsed),
        xml_content: xml,
        sync_status: 'synced',
        sync_error: null,
        ksef_issued_at:
          item.acquisitionDate || item.invoicingDate || item.issueDate || new Date().toISOString(),
        synced_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[KSEF_DAILY] ${reference}`, error);
    }
  }

  for (let offset = 0; offset < rows.length; offset += 100) {
    const { error } = await supabase
      .from('ksef_invoices')
      .upsert(rows.slice(offset, offset + 100), {
        onConflict: 'ksef_reference_number',
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }

  if (direction === 'issued') {
    for (const row of rows) {
      if (!row.invoice_number) continue;
      const { data: localInvoice } = await supabase
        .from('invoices')
        .select('id, ksef_reference_number')
        .eq('my_company_id', credentials.my_company_id)
        .eq('invoice_number', row.invoice_number)
        .limit(1)
        .maybeSingle();
      if (localInvoice?.id && !localInvoice.ksef_reference_number) {
        const { error } = await supabase.rpc('reconcile_local_invoice_with_ksef_atomic', {
          p_invoice_id: localInvoice.id,
          p_ksef_reference_number: row.ksef_reference_number,
        });
        if (error) console.error('[KSEF_DAILY] local invoice reconciliation', error);
      }
    }
  }

  await supabase.from('ksef_sync_log').insert({
    sync_type: direction,
    status: 'success',
    invoices_count: metadata.length,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });

  return { fetched: metadata.length, inserted: rows.length };
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const providedToken = request.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim() || '';

  if (
    !serviceRoleKey ||
    (providedToken !== serviceRoleKey &&
      decodeJwtRole(request.headers.get('authorization')) !== 'service_role')
  ) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Missing Supabase configuration' }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: credentials, error } = await supabase
    .from('ksef_credentials')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
  }

  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 31);
  const dateFrom = `${from.toISOString().slice(0, 10)}T00:00:00`;
  const dateTo = `${now.toISOString().slice(0, 10)}T23:59:59`;
  const results: Array<Record<string, unknown>> = [];

  for (const item of (credentials || []) as Credentials[]) {
    try {
      const accessToken = await ensureAccessToken(supabase, item);
      const [issued, received] = await Promise.all([
        syncDirection(supabase, item, accessToken, 'issued', dateFrom, dateTo),
        syncDirection(supabase, item, accessToken, 'received', dateFrom, dateTo),
      ]);
      results.push({ companyId: item.my_company_id, nip: item.nip, success: true, issued, received });
    } catch (syncError) {
      console.error('[KSEF_DAILY] company sync failed', item.my_company_id, syncError);
      results.push({
        companyId: item.my_company_id,
        nip: item.nip,
        success: false,
        error: syncError instanceof Error ? syncError.message : String(syncError),
      });
    }
  }

  const failed = results.filter((result) => !result.success).length;
  return new Response(
    JSON.stringify({
      success: failed === 0,
      executedAt: now.toISOString(),
      companies: results.length,
      failed,
      results,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
