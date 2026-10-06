import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { PDFDocument, PDFDict, PDFName, rgb } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};
const maxOriginalBytes = 12 * 1024 * 1024;
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
const stringValue = (value: unknown, limit = 20000): string => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > limit) fail('Opis dokumentu jest nieprawidłowy lub zbyt długi. Skróć opis w CRM przed wysyłką.');
  return (value as string).normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
};
const money = (value: unknown, currency: unknown): string => {
  if (value == null) return 'nie zapisano';
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('Nieprawidłowa kwota powiązanej płatności.');
  return `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value as number)} ${stringValue(currency, 12) || 'waluta niepodana'}`;
};
const date = (value: unknown): string => {
  const text = stringValue(value, 40);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(text);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : text || 'nie zapisano';
};

let cachedFonts: Promise<Uint8Array[]> | null = null;
const fonts = () => {
  if (!cachedFonts) {
    cachedFonts = Promise.all(['Regular', 'Bold'].map(async (weight) => {
      const response = await fetch(`https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-${weight}.ttf`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) fail('Nie można pobrać czcionki z polskimi znakami. Spróbuj przygotować pakiet ponownie.', 503);
      return new Uint8Array(await response.arrayBuffer());
    })).catch((error) => { cachedFonts = null; throw error; });
  }
  return cachedFonts;
};

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) fail('Zaloguj się ponownie do CRM.', 401);
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization! } },
      auth: { persistSession: false },
    });
    const { data: identity, error: identityError } = await client.auth.getUser();
    if (identityError || !identity.user) fail('Sesja CRM wygasła. Zaloguj się ponownie.', 401);
    const { data: mayManage, error: permissionError } = await client.rpc('finance_can_manage');
    if (permissionError || mayManage !== true) fail('Brak uprawnień do przygotowania dokumentów finansowych.', 403);
    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > maxOriginalBytes + 512000) fail('Plik lub opis przekracza dopuszczalny rozmiar.');
    const form = await request.formData();
    const original = form.get('file');
    const rawAnnotation = form.get('annotation');
    if (!(original instanceof File) || !original.size || original.size > maxOriginalBytes) fail('Załącz poprawny plik o rozmiarze do 12 MB.');
    if (typeof rawAnnotation !== 'string' || rawAnnotation.length > 250000) fail('Brak poprawnego opisu dokumentu.');
    const annotation = JSON.parse(rawAnnotation as string);
    if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) fail('Nieprawidłowy opis dokumentu.');
    const companyId = stringValue(annotation.companyId, 36);
    if (!/^[0-9a-f-]{36}$/i.test(companyId)) fail('Nie wybrano firmy.');
    const { data: mayAccessCompany, error: companyAccessError } = await client.rpc('finance_company_visible', { p_company_id: companyId });
    if (companyAccessError || mayAccessCompany !== true) fail('Brak uprawnień finansowych do wybranej firmy.', 403);
    // The company select uses the caller's JWT and database RLS, never a service-role client.
    const { data: company, error: companyError } = await client.from('my_companies').select('id,name').eq('id', companyId).maybeSingle();
    if (companyError || !company) fail('Brak dostępu do wybranej firmy.', 403);
    const payments = annotation.payments ?? [];
    if (!Array.isArray(payments) || payments.length > 300) fail('Zbyt wiele powiązań płatności w jednym dokumencie.');

    const sourceBytes = new Uint8Array(await (original as File).arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', sourceBytes));
    const sourceHash = Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    let output = await PDFDocument.create();
    const isPdf = new TextDecoder().decode(sourceBytes.subarray(0, 1024)).includes('%PDF-');
    const isPng = sourceBytes[0] === 137 && sourceBytes[1] === 80 && sourceBytes[2] === 78 && sourceBytes[3] === 71;
    const isJpeg = sourceBytes[0] === 255 && sourceBytes[1] === 216 && sourceBytes[2] === 255;
    if (isPdf) {
      let source: PDFDocument;
      try { source = await PDFDocument.load(sourceBytes); }
      catch { fail('PDF jest zaszyfrowany lub uszkodzony. Oryginał zachowano; dołącz czytelną kopię bez hasła.'); }
      if (!source!.getPageCount() || source!.getPageCount() > 300) fail('PDF musi zawierać od 1 do 300 stron.');
      const hasSignature = source!.context.enumerateIndirectObjects().some(([, object]) => object instanceof PDFDict && (
        object.has(PDFName.of('ByteRange'))
        || object.get(PDFName.of('FT'))?.toString() === '/Sig'
        || object.get(PDFName.of('Type'))?.toString() === '/Sig'
      ));
      if (hasSignature) fail('PDF ma pole podpisu elektronicznego. Nie dołączono opisu, aby nie naruszyć podpisu. Ten dokument wymaga przekazania oryginału z oddzielnym opisem.');
      // Append to an in-memory copy of the complete document, retaining form
      // fields and their appearances as well as ordinary page content.
      output = source!;
    } else if (isPng || isJpeg) {
      const image = isPng ? await output.embedPng(sourceBytes) : await output.embedJpg(sourceBytes);
      if (image.width * image.height > 60000000) fail('Obraz jest zbyt duży. Zmniejsz rozdzielczość skanu przed wysyłką.');
      const page = output.addPage([595.28, 841.89]);
      const scale = Math.min(523.28 / image.width, 769.89 / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      page.drawImage(image, { x: (595.28 - width) / 2, y: (841.89 - height) / 2, width, height });
    } else fail('Kopia z opisem obsługuje PDF, JPG i PNG. Przekonwertuj ten dokument w CRM przed wysyłką.');

    output.registerFontkit(fontkit);
    const [regularBytes, boldBytes] = await fonts();
    const regular = await output.embedFont(regularBytes, { subset: true });
    const bold = await output.embedFont(boldBytes, { subset: true });
    const supported = new Set(regular.getCharacterSet());
    const originalPages = output.getPageCount();
    const annotationPages: ReturnType<PDFDocument['addPage']>[] = [];
    let page = output.addPage([595.28, 841.89]);
    annotationPages.push(page);
    let y = 794;
    const draw = (raw: unknown, options: { bold?: boolean; size?: number; gap?: number } = {}) => {
      const text = stringValue(raw);
      const font = options.bold ? bold : regular;
      const size = options.size || 10;
      const leading = size * 1.5;
      for (const character of text) {
        if (character !== '\n' && character !== '\r' && character !== '\t' && !supported.has(character.codePointAt(0)!)) {
          fail('Opis zawiera znaki nieobsługiwane przez czcionkę PDF. Usuń symbole graficzne lub emotikony z opisu przed wysyłką.');
        }
      }
      const lines: string[] = [];
      for (const paragraph of text.replace(/\r/g, '').split('\n')) {
        let line = '';
        for (const word of paragraph.replace(/\t/g, ' ').split(/\s+/)) {
          const next = line ? `${line} ${word}` : word;
          if (font.widthOfTextAtSize(next, size) <= 499) { line = next; continue; }
          if (line) lines.push(line);
          line = '';
          for (const character of word) {
            if (font.widthOfTextAtSize(line + character, size) > 499 && line) { lines.push(line); line = ''; }
            line += character;
          }
        }
        lines.push(line);
      }
      for (const line of lines) {
        if (y < 65) {
          if (annotationPages.length >= 100) fail('Opis przekracza limit 100 stron. Skróć go przed wysyłką.');
          page = output.addPage([595.28, 841.89]);
          annotationPages.push(page);
          y = 794;
        }
        page.drawText(line, { x: 48, y, font, size, color: rgb(0.13, 0.16, 0.2) });
        y -= leading;
      }
      y -= options.gap ?? 5;
    };
    draw('OPIS UZGODNIENIA CRM', { bold: true, size: 17, gap: 9 });
    draw('Załącznik informacyjny dla księgowości — nie jest fakturą ani korektą.', { bold: true });
    draw(`Firma: ${company.name}\nOkres przekazania: ${stringValue(annotation.period, 40) || 'nie podano'}\nDokument: ${stringValue(annotation.documentNumber, 500) || (original as File).name}\nRodzaj: ${stringValue(annotation.documentKind, 200) || 'dokument źródłowy'}`);
    const hasAllocatedPayment = payments.some((payment) => typeof payment?.allocatedAmount === 'number' && payment.allocatedAmount > 0);
    if (!hasAllocatedPayment) {
      draw('Istniejący opis z analizy CRM', { bold: true, size: 12 });
      draw(stringValue(annotation.accountingNote) || 'Brak zapisanego opisu w analizie CRM.');
    }
    draw(`Powiązane płatności (${payments.length})`, { bold: true, size: 12 });
    if (!payments.length) draw('Brak zapisanych powiązań płatności w CRM. Nie stanowi to potwierdzenia, że dokument jest nieopłacony.');
    for (let index = 0; index < payments.length; index += 1) {
      const payment = payments[index];
      if (!payment || typeof payment !== 'object') fail('Nieprawidłowe powiązanie płatności.');
      draw(`${index + 1}. ${date(payment.date)} · ${money(payment.bankAmount, payment.bankCurrency)}`, { bold: true });
      draw(`Numer płatności z wyciągu: ${stringValue(payment.reference, 1000) || 'nie zapisano'}\nKontrahent przelewu: ${stringValue(payment.counterparty, 2000) || 'nie zapisano'}\nTytuł: ${stringValue(payment.title, 10000) || 'nie zapisano'}\nWyciąg: ${stringValue(payment.statementName, 2000) || 'nie zapisano'}`);
      if (payment.postingDate) draw(`Data księgowania: ${date(payment.postingDate)}`);
      draw(`Przypisano z przelewu do tego dokumentu: ${money(payment.allocatedAmount, payment.bankCurrency)}`);
      if (payment.documentAllocatedAmount != null) draw(`Rozliczona wartość w walucie dokumentu: ${money(payment.documentAllocatedAmount, payment.documentCurrency)}`);
      if (payment.collective) draw('Płatność zbiorcza: jeden przelew rozlicza kilka dokumentów. Pełnej kwoty przelewu nie należy przypisywać ponownie do każdego z nich.', { bold: true });
      if (payment.paymentNote) draw(`Rozliczenie płatności według CRM: ${stringValue(payment.paymentNote)}`);
      y -= 6;
    }
    draw('Zasady przekazania', { bold: true, size: 12 });
    draw('Opis odzwierciedla zapisane uzgodnienia CRM, a nie decyzję księgową. Informacje o płatnościach są częścią tej kopii PDF; wysłanie e-mailem nie ustawia automatycznie rozrachunków ani statusu zapłaty w Saldeo. Oryginał dokumentu pozostaje bez zmian w CRM.');
    draw(`Plik źródłowy: ${(original as File).name}\nSHA-256 oryginału: ${sourceHash}`, { size: 8 });
    annotationPages.forEach((annotationPage, index) => {
      annotationPage.drawText(`Opis CRM ${index + 1}/${annotationPages.length} | strony dokumentu źródłowego: ${originalPages}`, {
        x: 48, y: 32, font: regular, size: 8, color: rgb(0.4, 0.43, 0.47),
      });
    });
    output.setTitle(`${stringValue(annotation.documentNumber, 500) || 'Dokument'} — kopia z opisem CRM`);
    output.setSubject('Dokument źródłowy i załącznik z uzgodnieniem płatności');
    output.setProducer('Mavinci CRM — przygotowanie dokumentów do Saldeo');
    const result = await output.save();
    return new Response(result, { status: 200, headers: { ...cors, 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 400;
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Nie udało się przygotować kopii dokumentu.' }), {
      status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
});
