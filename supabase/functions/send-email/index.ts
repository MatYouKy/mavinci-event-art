import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Keep these helpers local: Supabase Dashboard deployments may include only index.ts.
// When updating the equivalents in _shared, keep both send-email functions in sync.
async function salesDeliveryActor(req: Request, body: any, service: any, functionName: string) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Wymagane logowanie');
  if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    const id = body._scheduledDispatch?.scheduledEmailId;
    if (!id) throw new Error('Brak zlecenia wysyłki');
    const { data: job, error } = await service.from('scheduled_emails').select('created_by,status,function_name').eq('id', id).single();
    if (error || job.status !== 'processing' || job.function_name !== functionName) throw new Error('Nieprawidłowe zlecenie wysyłki');
    return { userId: job.created_by, scheduled: true, deliveryKey: `scheduled:${id}` };
  }
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new Error('Sesja wygasła');
  return { userId: data.user.id, scheduled: false, deliveryKey: null };
}
async function assertSalesDocumentPermission(service: any, kind: string, id: string, userId: string) {
  const { data, error } = await service.rpc('sales_actor_can_manage', { p_kind: kind, p_document: id, p_user: userId });
  if (error || !data) throw new Error('Brak uprawnień do dokumentu');
}
async function assertSalesMailbox(service: any, accountId: string, userId: string) {
  const { data: employee } = await service.from('employees').select('id,permissions,role,access_level').or(`id.eq.${userId},auth_user_id.eq.${userId}`).eq('is_active', true).limit(1).single();
  const { data: account } = await service.from('employee_email_accounts').select('employee_id,account_type,is_active').eq('id', accountId).single();
  if (!employee || !account?.is_active || account.account_type === 'system') throw new Error('Wybierz aktywną skrzynkę pracownika');
  const { data: assignment } = await service.from('employee_email_account_assignments').select('id').eq('email_account_id', accountId).eq('employee_id', employee.id).maybeSingle();
  if (account.employee_id !== employee.id && !assignment && !employee.permissions?.includes('admin') && employee.role !== 'admin' && employee.access_level !== 'admin') throw new Error('Brak dostępu do skrzynki');
  return employee.id;
}

interface RelayEmailAttachment {
  filename: string;
  content?: string;
  contentType?: string;
  contentDisposition?: "attachment" | "inline";
  cid?: string;
  // Created here from an authorized delivery, never accepted from the caller.
  storageAttachment?: { kind: 'brochure-storage-v1'; url: string; sizeBytes: number };
}

async function requireBrochureRelay() {
  const url = Deno.env.get('SMTP_RELAY_URL');
  const secret = Deno.env.get('SMTP_RELAY_SECRET');
  if (!url || !secret) throw new Error('Nie skonfigurowano usługi wysyłania poczty.');
  const response = await fetch(`${url.replace(/\/+$/, '')}/api/capabilities`, {
    headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!response) {
    throw new Error('Nie można połączyć się z usługą SMTP. Sprawdź, czy worker jest uruchomiony i dostępny. Niczego nie wysłano.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('Usługa SMTP odrzuciła autoryzację. Sprawdź zgodność SMTP_RELAY_SECRET z RELAY_SECRET workera. Niczego nie wysłano.');
  }
  if (response.status === 404) {
    throw new Error('Zaktualizuj SMTP Relay Worker do wersji obsługującej zapisane broszury. Niczego nie wysłano.');
  }
  if (!response.ok) {
    throw new Error(`Usługa SMTP jest niedostępna (HTTP ${response.status}). Niczego nie wysłano.`);
  }
  const capabilities = await response.json().catch(() => null);
  if (capabilities?.brochureStorageAttachments !== 1) {
    throw new Error('Usługa SMTP nie potwierdziła obsługi zapisanych broszur. Sprawdź wersję workera i adres SMTP_RELAY_URL. Niczego nie wysłano.');
  }
  if (capabilities.brochureStorageConfigured !== true) {
    throw new Error('W konfiguracji SMTP Relay Worker ustaw SUPABASE_URL swojego projektu. Niczego nie wysłano.');
  }
}

interface PreparedEmail {
  html: string;
  attachments: RelayEmailAttachment[];
}

const extensionForMime = (mime: string): string => {
  const normalized = mime.toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/svg+xml") return "svg";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/webp") return "webp";
  return "png";
};

/**
 * Gmail usuwa data:image/... z HTML wiadomości. Zamieniamy je na obrazy MIME
 * osadzone przez Content-ID, zachowując przy tym dotychczasowy szablon stopki.
 */
const prepareInlineEmailImages = (
  html: string,
  existingAttachments: RelayEmailAttachment[] = [],
): PreparedEmail => {
  if (!html || !/data:image\//i.test(html)) {
    return { html, attachments: [...existingAttachments] };
  }

  const inlineAttachments: RelayEmailAttachment[] = [];
  const knownImages = new Map<string, string>();
  let imageIndex = 0;

  const preparedHtml = html.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:(image\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,([^"']+))\2/gi,
    (_match, prefix: string, quote: string, dataUri: string, mime: string, base64: string) => {
      const existingCid = knownImages.get(dataUri);
      if (existingCid) return `${prefix}${quote}cid:${existingCid}${quote}`;

      imageIndex += 1;
      const cid = `mavinci-inline-${imageIndex}-${crypto.randomUUID()}@mavinci.pl`;
      knownImages.set(dataUri, cid);
      inlineAttachments.push({
        filename: `mavinci-inline-${imageIndex}.${extensionForMime(mime)}`,
        content: base64.replace(/\s+/g, ""),
        contentType: mime,
        contentDisposition: "inline",
        cid,
      });

      return `${prefix}${quote}cid:${cid}${quote}`;
    },
  );

  return {
    html: preparedHtml,
    attachments: [...existingAttachments, ...inlineAttachments],
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  useTls: boolean;
  from: string;
  fromName: string;
}

interface EmailRequest {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string[];
  messageId?: string;
  emailAccountId?: string;
  smtpConfig?: SmtpConfig;
  attachments?: RelayEmailAttachment[];
  // Only a trusted server may supply this transport-only secret.
  saldeoDelivery?: {
    companyId: string;
    actorUserId: string;
    periodMonth: number;
    periodYear: number;
    documentType: 'FK' | 'DS' | 'P';
    pin: string;
  };
}

interface EmailAccount {
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  email_address: string;
  from_name: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  let isSaldeoDelivery = false;
  let deliveryState: 'not_sent' | 'uncertain' | 'sent' = 'not_sent';
  let acceptedMessageId: string | null = null;
  let persistedSentEmailId: string | null = null;
  let brochureDispatch: {
    id: string; token: string; service: any; pdfPath: string; fileName: string; fileSize: number;
  } | null = null;
  const recordBrochureResult = async (values: Record<string, unknown>) => {
    if (!brochureDispatch) return;
    const { error } = await brochureDispatch.service.from('sales_brochure_deliveries')
      .update(values).eq('id', brochureDispatch.id).eq('dispatch_token', brochureDispatch.token)
      .in('status', ['sending', 'uncertain']);
    if (error) console.error('[send-email] Could not persist brochure transport result:', error.code);
  };
  try {

    const requestBody = await req.json();
    isSaldeoDelivery = requestBody?.saldeoDelivery != null;
    if (requestBody.action === 'brochure_transport_capabilities') {
      const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      await salesDeliveryActor(req, requestBody, service, 'send-email');
      await requireBrochureRelay();
      return new Response(JSON.stringify({ success: true, brochureTransportVersion: 1 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const {
      to,
      cc,
      bcc,
      subject: providedSubject,
      body,
      replyTo,
      inReplyTo,
      references,
      messageId,
      emailAccountId,
      smtpConfig,
      attachments = [],
      saldeoDelivery,
    }: EmailRequest = requestBody;
    if (!Array.isArray(attachments) || attachments.some(item => !item || item.storageAttachment)) {
      throw new Error('Załączniki ze Storage są dostępne wyłącznie przez zapisaną wysyłkę broszury.');
    }
    // Wysyłka z podaną konfiguracją SMTP (bez skrzynki z CRM) nie przechodziła żadnej kontroli
    // wywołującego: z publicznym kluczem anon każdy mógł wysyłać pocztę przez nasz relay SMTP
    // na dowolny serwer. Dziś żaden klient CRM ani aplikacji z niej nie korzysta — tylko serwer.
    if (smtpConfig) {
      const bearer = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim() || '';
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      if (!serviceKey || bearer !== serviceKey) {
        throw new Error('Bezpośrednia konfiguracja SMTP jest dostępna wyłącznie dla serwera.');
      }
    }

    let salesActor: { userId: string; scheduled: boolean; deliveryKey: string | null } | null = null;
    let salesEmployeeId: string | null = null;
    const salesDocument = requestBody.salesDocument;
    if (salesDocument) {
      if (salesDocument.kind !== 'calculation' || !emailAccountId || smtpConfig) throw new Error('Nieprawidłowa wysyłka kalkulacji');
      const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      salesActor = await salesDeliveryActor(req, requestBody, service, 'send-email');
      await assertSalesDocumentPermission(service, 'calculation', salesDocument.id, salesActor.userId);
      salesEmployeeId = await assertSalesMailbox(service, emailAccountId, salesActor.userId);
      const { data: file } = await service.from('sales_document_files').select('id').eq('calculation_id', salesDocument.id).eq('storage_bucket', 'event-files').eq('storage_path', salesDocument.storagePath).eq('revision', salesDocument.revision).maybeSingle();
      if (!file) throw new Error('Brak zapisanej wersji PDF kalkulacji');
      if (!salesActor.scheduled) {
        const { data: calculation } = await service.from('event_calculations').select('content_revision,generated_pdf_path').eq('id', salesDocument.id).single();
        if (calculation?.content_revision !== salesDocument.revision || calculation.generated_pdf_path !== salesDocument.storagePath) throw new Error('Kalkulacja została zmieniona. Wygeneruj PDF ponownie.');
      }
      const { data: pdf, error: pdfError } = await service.storage.from('event-files').download(salesDocument.storagePath);
      if (pdfError || !pdf) throw new Error('Nie udało się pobrać PDF');
      const bytes = new Uint8Array(await pdf.arrayBuffer()); let binary = '';
      for (let i=0; i<bytes.length; i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
      if (!attachments?.length) throw new Error('Brak załącznika kalkulacji');
      attachments[0] = { filename: 'kalkulacja.pdf', content: btoa(binary), contentType: 'application/pdf', contentDisposition: 'attachment' };
    }

    if (requestBody.inquiryId && !salesDocument) {
      const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      salesActor = await salesDeliveryActor(req, requestBody, service, 'send-email');
      await assertSalesDocumentPermission(service, 'inquiry', requestBody.inquiryId, salesActor.userId);
      if (!emailAccountId || smtpConfig) throw new Error('Wybierz skrzynkę pracownika');
      salesEmployeeId = await assertSalesMailbox(service, emailAccountId, salesActor.userId);
    }
    if (emailAccountId && !salesEmployeeId && !isSaldeoDelivery) {
      const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      if (token !== serviceKey || requestBody._scheduledDispatch) {
        const service = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
        const actor = await salesDeliveryActor(req, requestBody, service, 'send-email');
        const { data: sender, error: senderError } = await service.from('employees').select('id,permissions,role,access_level').or(`id.eq.${actor.userId},auth_user_id.eq.${actor.userId}`).eq('is_active',true).maybeSingle();
        const { data: account, error: accountError } = await service.from('employee_email_accounts').select('employee_id,is_active').eq('id',emailAccountId).maybeSingle();
        const { data: assignment, error: assignmentError } = sender ? await service.from('employee_email_account_assignments').select('can_send').eq('email_account_id',emailAccountId).eq('employee_id',sender.id).maybeSingle() : {data:null,error:null};
        const canUseMessages = sender && (sender.role === 'admin' || sender.access_level === 'admin' || sender.permissions?.some((p: string) => ['admin','messages_view','messages_manage'].includes(p)));
        if (senderError || accountError || assignmentError || !canUseMessages || !account?.is_active || (account.employee_id !== sender.id && assignment?.can_send !== true) || smtpConfig) throw new Error('Brak uprawnień do wysyłania z tej skrzynki');
        salesEmployeeId = sender.id;
      }
    }
    if (requestBody.brochureDeliveryId) {
      if (!salesEmployeeId || !emailAccountId || smtpConfig || salesDocument || requestBody.inquiryId
        || isSaldeoDelivery || cc || bcc || attachments.length || requestBody._scheduledDispatch) {
        throw new Error('Nieprawidłowa wysyłka zapisanej broszury.');
      }
      const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const actorToken = req.headers.get('Authorization')!;
      const actorClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: actorToken } },
      });
      const [permission, scope, stored] = await Promise.all([
        actorClient.rpc('can_manage_sales_brochures'),
        actorClient.rpc('can_view_brochure_employee', { p_employee: salesEmployeeId }),
        service.from('sales_brochure_deliveries')
          .select('id,employee_id,generation_id,status,dispatch_token,transport_started_at,email_account_id,recipient_email,subject,body_html')
          .eq('id', requestBody.brochureDeliveryId).maybeSingle(),
      ]);
      const delivery = stored.data;
      if (permission.error || scope.error || !permission.data || !scope.data || stored.error || !delivery
        || delivery.employee_id !== salesEmployeeId || delivery.email_account_id !== emailAccountId
        || delivery.recipient_email !== to || delivery.subject !== providedSubject || delivery.body_html !== body
        || !delivery.dispatch_token || delivery.dispatch_token !== requestBody.brochureDispatchToken) {
        throw new Error('Brak dostępu do tej wersji wiadomości lub próby wysyłki broszury.');
      }
      // Repeated invocations cannot send the same attempt a second time.
      // A rejected duplicate is NOT evidence that the first call did not send.
      deliveryState = 'uncertain';
      if (delivery.status !== 'sending' || delivery.transport_started_at) {
        throw new Error('Ta próba wysyłki została już obsłużona. Odśwież jej stan; nie ponawiaj wysyłki.');
      }
      const { data: source, error: sourceError } = await service.from('sales_brochure_generations')
        .select('pdf_path,file_name,file_size,created_by').eq('id', delivery.generation_id).maybeSingle();
      if (sourceError || !source || source.created_by !== salesEmployeeId || !source.pdf_path
        || !Number.isSafeInteger(source.file_size) || source.file_size <= 0 || source.file_size > 52428800) {
        deliveryState = 'not_sent';
        throw new Error('Brak poprawnego zapisanego PDF broszury (maksymalnie 50 MiB). Niczego nie wysłano.');
      }
      const { data: claimed, error: claimError } = await service.from('sales_brochure_deliveries')
        .update({ transport_started_at: new Date().toISOString() })
        .eq('id', delivery.id).eq('dispatch_token', delivery.dispatch_token).eq('status', 'sending')
        .is('transport_started_at', null).select('id').maybeSingle();
      if (claimError || !claimed) throw new Error('Nie można ponownie uruchomić tej próby. Odśwież stan wysyłki.');
      brochureDispatch = {
        id: delivery.id, token: delivery.dispatch_token, service,
        pdfPath: source.pdf_path, fileName: source.file_name, fileSize: source.file_size,
      };
      deliveryState = 'not_sent';
      await requireBrochureRelay();
      const { data: signed, error: signedError } = await service.storage.from('generated-brochures')
        .createSignedUrl(source.pdf_path, 600);
      if (signedError || !signed?.signedUrl) throw new Error('Nie udało się udostępnić załącznika usłudze pocztowej. Niczego nie wysłano.');
      attachments.push({
        filename: source.file_name, contentType: 'application/pdf', contentDisposition: 'attachment',
        storageAttachment: { kind: 'brochure-storage-v1', url: signed.signedUrl, sizeBytes: source.file_size },
      });
    }
    let subject = providedSubject;
    let persistedSubject = providedSubject;
    let saldeoActorId: string | null = null;
    if (isSaldeoDelivery) {
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const bearer = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
      if (!serviceKey || bearer !== serviceKey || !saldeoDelivery) throw new Error('Saldeo server authorization required');
      const { companyId, actorUserId, periodMonth, periodYear, documentType, pin } = saldeoDelivery;
      const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
      if (!uuid.test(companyId) || !uuid.test(actorUserId) || typeof pin !== 'string' || !/^[^\s()\r\n]{4,64}$/.test(pin)
        || !Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12
        || !Number.isInteger(periodYear) || periodYear < 2000 || periodYear > 2100
        || !['FK', 'DS', 'P'].includes(documentType) || cc || bcc || smtpConfig || !emailAccountId || !attachments?.length) {
        throw new Error('Invalid private Saldeo delivery');
      }
      const server = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
      const [companyResult, actorResult] = await Promise.all([
        server.from('my_companies').select('saldeo_document_email').eq('id', companyId).eq('is_active', true).maybeSingle(),
        server.from('employees').select('id,role,access_level').eq('is_active', true)
          .or(`id.eq.${actorUserId},auth_user_id.eq.${actorUserId}`).limit(1).maybeSingle(),
      ]);
      const expectedRecipient = String(companyResult.data?.saldeo_document_email || '').trim();
      if (companyResult.error || actorResult.error || !actorResult.data
        || (actorResult.data.role !== 'admin' && actorResult.data.access_level !== 'admin')
        || !/^[^\s@]+@dok\.saldeo\.pl$/i.test(expectedRecipient)
        || typeof to !== 'string' || to.trim().toLowerCase() !== expectedRecipient.toLowerCase()) {
        throw new Error('Saldeo recipient or administrator not authorized');
      }
      const period = `${String(periodMonth).padStart(2, '0')}/${periodYear}`;
      subject = `(${period}) (${pin}) {${documentType}}`;
      persistedSubject = `(${period}) (PIN ukryty) {${documentType}}`;
      saldeoActorId = actorUserId;
    }

    if (!to || !subject || !body) {
      console.error('[send-email] Missing fields:', { to: !!to, subject: !!subject, body: !!body });
      throw new Error("Missing required fields: to, subject, body");
    }

    console.log('[send-email] Sending to:', to);
    

    let imapSettings: { host: string; port: number; username: string; password: string; secure: boolean } | undefined;
    let smtpSettings: {
      host: string;
      port: number;
      username: string;
      password: string;
      useTls: boolean;
      from: string;
      fromName: string;
    };

    if (smtpConfig) {
      smtpSettings = smtpConfig;
    } else if (emailAccountId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data: emailAccount, error: accountError } = await supabase
        .from("employee_email_accounts")
        .select("*")
        .eq("id", emailAccountId)
        .maybeSingle();

      if (accountError || !emailAccount) {
        throw new Error("Email account not found");
      }

      const account = emailAccount as EmailAccount;
      imapSettings = { host: account.imap_host, port: account.imap_port,
        username: account.imap_username, password: account.imap_password, secure: account.imap_use_ssl };
      smtpSettings = {
        host: account.smtp_host,
        port: account.smtp_port,
        username: account.smtp_username,
        password: account.smtp_password,
        useTls: account.smtp_use_tls,
        from: account.email_address,
        fromName: account.from_name,
      };
    } else {
      throw new Error("Either emailAccountId or smtpConfig must be provided");
    }

    console.log('[send-email] SMTP settings:', {
      host: smtpSettings.host,
      port: smtpSettings.port,
      username: smtpSettings.username,
    });

    const relayUrl = Deno.env.get("SMTP_RELAY_URL");
    const relaySecret = Deno.env.get("SMTP_RELAY_SECRET");

    if (!relayUrl || !relaySecret) {
      throw new Error("SMTP_RELAY_URL or SMTP_RELAY_SECRET not configured");
    }

    console.log('[send-email] Using SMTP relay:', relayUrl);

    const preparedEmail = prepareInlineEmailImages(body, attachments ?? []);

    const relayPayload = {
      smtpConfig: smtpSettings,
      imapConfig: imapSettings,
      to,
      cc,
      bcc,
      subject,
      body: preparedEmail.html,
      replyTo,
      inReplyTo,
      references,
      attachments: preparedEmail.attachments,
    };

    console.log('[send-email] Sending request to relay with attachments count:', attachments?.length || 0);

    // From now on a connection failure is ambiguous, unless the relay explicitly
    // confirms a failure BEFORE acceptance by SMTP.
    deliveryState = 'uncertain';
    const relayResponse = await fetch(`${relayUrl}/api/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${relaySecret}`,
      },
      body: JSON.stringify(relayPayload),
    });

    const relayResult = await relayResponse.json();
    if (!relayResponse.ok || relayResult.success !== true) {
      if (relayResult.deliveryState === 'not_sent') deliveryState = 'not_sent';
      throw new Error(`Usługa pocztowa: ${relayResult.error || 'Brak potwierdzenia wysyłki'}`);
    }
    deliveryState = 'sent';
    const warnings: string[] = [];
    const sentCopy = relayResult.sentCopy || { status: 'unknown', warning: 'Usługa pocztowa nie potwierdziła zapisu kopii w folderze Wysłane. Wymagana aktualizacja usługi SMTP.' };
    if (sentCopy.warning) warnings.push(sentCopy.warning);
    let savedAttachments = 0;
    acceptedMessageId = relayResult.messageId || null;
    const info = { messageId: relayResult.messageId };
    // Persist acceptance before attachment archiving/other follow-up work.
    // The CRM can then recover even when its HTTP request times out.
    await recordBrochureResult({
      status: 'sent', sent_at: new Date().toISOString(), message_id: acceptedMessageId, error_message: null,
    });

    console.log('[send-email] Email sent successfully via relay. MessageId:', info.messageId);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (emailAccountId) {
      let employeeId: string | null = salesEmployeeId || saldeoActorId;

      const authHeader = req.headers.get("Authorization");
      if (authHeader && !saldeoActorId && !salesEmployeeId) {
        try {
          const { data: { user } } = await supabase.auth.getUser(
            authHeader.replace("Bearer ", "")
          );
          if (user) employeeId = user.id;
        } catch (e) {
          console.warn('[send-email] Could not resolve user from auth header:', e);
        }
      }

      if (!employeeId) {
        const { data: accountRow } = await supabase
          .from("employee_email_accounts")
          .select("employee_id")
          .eq("id", emailAccountId)
          .maybeSingle();
        if (accountRow?.employee_id) employeeId = accountRow.employee_id;
      }

      if (employeeId) {
        const { data: sentEmail, error: insertError } = await supabase
          .from("sent_emails")
          .insert({
            employee_id: employeeId,
            email_account_id: emailAccountId,
            to_address: to,
            subject: persistedSubject,
            // Do CRM zapisujemy wersję z obrazami data URI. Wersja CID jest
            // przeznaczona wyłącznie dla transportu SMTP i bez części MIME nie
            // nadaje się do późniejszego podglądu w folderze „Wysłane”.
            body,
            reply_to: replyTo,
            in_reply_to: inReplyTo || null,
            email_references: references || [],
            message_id: info.messageId,
            sent_at: new Date().toISOString(),
            has_attachments: attachments.length > 0,
            delivery_archive: { sentCopy, attachments: { expected: attachments.length, saved: 0, status: 'pending' } },
          })
          .select("id")
          .single();
        if (insertError) {
          console.error('[send-email] Failed to insert sent_emails record:', insertError);
          warnings.push('Wiadomość wysłana, ale nie zapisano jej kopii w CRM.');
        } else {
          persistedSentEmailId = sentEmail.id;
        }
      } else {
        console.warn('[send-email] No employee_id resolved; skipping sent_emails persistence');
      }
    }

    if (persistedSentEmailId && attachments?.length) {
      for (const attachment of attachments) {
        try {
          if (attachment.storageAttachment && brochureDispatch) {
            const storagePath = `sent/${persistedSentEmailId}/${crypto.randomUUID()}-broszura.pdf`;
            const { error: copyError } = await supabase.storage.from('generated-brochures')
              .copy(brochureDispatch.pdfPath, storagePath, { destinationBucket: 'email-attachments' });
            if (copyError) throw copyError;
            const { error: attachmentError } = await supabase.from('email_attachments').insert({
              email_id: persistedSentEmailId, email_type: 'sent',
              filename: brochureDispatch.fileName, content_type: 'application/pdf',
              size_bytes: brochureDispatch.fileSize, storage_path: storagePath,
            });
            if (attachmentError) {
              await supabase.storage.from('email-attachments').remove([storagePath]);
              throw attachmentError;
            }
            savedAttachments += 1;
            continue;
          }
          if (typeof attachment.content !== 'string') throw new Error('Brak treści załącznika do archiwizacji');
          const encoded = attachment.content.includes(",")
            ? attachment.content.split(",").pop() || ""
            : attachment.content;
          const binary = atob(encoded);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
          }

          const safeFilename = attachment.filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
          const storagePath = `sent/${persistedSentEmailId}/${crypto.randomUUID()}-${safeFilename}`;
          const contentType = attachment.contentType || "application/octet-stream";
          const { error: uploadError } = await supabase.storage
            .from("email-attachments")
            .upload(storagePath, bytes, { contentType, upsert: false });
          if (uploadError) throw uploadError;

          const { error: attachmentError } = await supabase.from("email_attachments").insert({
            email_id: persistedSentEmailId,
            email_type: "sent",
            filename: attachment.filename,
            content_type: contentType,
            size_bytes: bytes.byteLength,
            storage_path: storagePath,
          });
          if (attachmentError) {
            await supabase.storage.from("email-attachments").remove([storagePath]);
            throw attachmentError;
          }
          savedAttachments += 1;
        } catch (attachmentError) {
          console.error("[send-email] Failed to persist attachment:", attachment.filename, attachmentError);
        }
      }
    }
    if (persistedSentEmailId) {
      const attachmentArchive = { expected: attachments.length, saved: savedAttachments,
        status: savedAttachments === attachments.length ? 'complete' : 'partial' };
      const { error: archiveError } = await supabase.from('sent_emails').update({
        delivery_archive: { sentCopy, attachments: attachmentArchive },
      }).eq('id', persistedSentEmailId);
      if (archiveError || attachmentArchive.status !== 'complete') warnings.push('Nie zapisano pełnego archiwum załączników w CRM.');
    }
    if (brochureDispatch && persistedSentEmailId) {
      const { error } = await supabase.from('sales_brochure_deliveries')
        .update({ sent_email_id: persistedSentEmailId })
        .eq('id', brochureDispatch.id).eq('dispatch_token', brochureDispatch.token).eq('status', 'sent');
      if (error) console.error('[send-email] Could not link sent email:', error.code);
    }

    if (salesDocument && salesActor) {
      const { error } = await supabase.rpc('record_sales_delivery', { p_kind: 'calculation', p_document: salesDocument.id, p_delivery_key: salesActor.deliveryKey || `calculation:${salesDocument.id}:${info.messageId || crypto.randomUUID()}`, p_storage_path: salesDocument.storagePath, p_recipient: to });
      if (error) console.error('Calculation delivered; activity write failed', error.code);
    }

    if (requestBody.inquiryId && !salesDocument && salesActor) {
      const { error } = await supabase.rpc('record_inquiry_delivery', { p_inquiry: requestBody.inquiryId, p_delivery_key: salesActor.deliveryKey || `inquiry:${requestBody.inquiryId}:${info.messageId || crypto.randomUUID()}`, p_recipient: to });
      if (error) console.error('Inquiry email delivered; activity write failed', error.code);
    }
    if (messageId && emailAccountId) {
      await supabase
        .from("contact_messages")
        .update({
          status: "replied",
          replied_at: new Date().toISOString()
        })
        .eq("id", messageId);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        deliveryState: 'sent',
        messageId: info.messageId,
        message: "Email sent successfully",
        sentEmailId: persistedSentEmailId,
        sentCopy,
        warning: warnings.length ? `${warnings.join(' ')} Nie wysyłaj ponownie.` : null,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    // Relay errors may contain the transport subject. Never expose the PIN in
    // a log, stored CRM message, or HTTP response for the private Saldeo path.
    if (isSaldeoDelivery) console.error('[send-email] Private Saldeo delivery failed; details withheld');
    else console.error("Error sending email:", error);
    // Failure to archive an already accepted message must never invite a resend.
    if (deliveryState === 'sent') {
      return new Response(JSON.stringify({
        success: true, deliveryState: 'sent', messageId: acceptedMessageId,
        sentEmailId: persistedSentEmailId,
        warning: 'Serwer pocztowy przyjął wiadomość, ale nie udało się zapisać wszystkich informacji w CRM. Nie wysyłaj ponownie.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const errorMessage = isSaldeoDelivery
      ? 'Nie udało się potwierdzić wysyłki do Saldeo. Sprawdź jej stan przed ponowieniem.'
      : error instanceof Error ? error.message : 'Nieznany błąd usługi pocztowej';
    await recordBrochureResult({
      status: deliveryState === 'not_sent' ? 'failed' : 'uncertain',
      error_message: deliveryState === 'not_sent' ? errorMessage
        : `${errorMessage} Wynik wysyłki jest niepewny — sprawdź folder Wysłane przed ponowieniem.`,
    }).catch(() => console.error('[send-email] Could not persist transport failure'));
    return new Response(
      JSON.stringify({ 
        success: false, 
        deliveryState,
        error: errorMessage,
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
