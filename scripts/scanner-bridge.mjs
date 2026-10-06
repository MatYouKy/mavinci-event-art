import 'dotenv/config';

import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const host = '127.0.0.1';
const port = Number(process.env.SCANNER_BRIDGE_PORT || 47831);
const maxRequestBytes = 64 * 1024;

const configuredOrigins = [
  process.env.NEXT_PUBLIC_FRONTEND_URL,
  process.env.NEXT_PUBLIC_APP_URL,
  ...(process.env.SCANNER_ALLOWED_ORIGINS || '').split(','),
]
  .map((origin) => origin?.trim().replace(/\/$/, ''))
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (configuredOrigins.includes(origin.replace(/\/$/, ''))) return true;

  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  return {
    ...(origin && isOriginAllowed(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function sendJson(response, status, payload, origin) {
  response.writeHead(status, {
    ...corsHeaders(origin),
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

async function findExecutable() {
  const candidates = [];

  if (process.env.NAPS2_CONSOLE_PATH) {
    candidates.push({ executable: process.env.NAPS2_CONSOLE_PATH, prefix: [] });
  }

  if (process.platform === 'darwin') {
    candidates.push(
      { executable: '/Applications/NAPS2.app/Contents/MacOS/NAPS2', prefix: ['console'] },
      {
        executable: path.join(process.env.HOME || '', 'Applications/NAPS2.app/Contents/MacOS/NAPS2'),
        prefix: ['console'],
      },
    );
  } else if (process.platform === 'win32') {
    candidates.push(
      {
        executable: path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NAPS2/NAPS2.Console.exe'),
        prefix: [],
      },
      {
        executable: path.join(
          process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
          'NAPS2/NAPS2.Console.exe',
        ),
        prefix: [],
      },
    );
  } else {
    candidates.push({ executable: '/usr/bin/naps2', prefix: ['console'] });
  }

  for (const candidate of candidates) {
    if (!candidate.executable) continue;
    try {
      await access(candidate.executable, fsConstants.X_OK);
      return candidate;
    } catch {
      // Sprawdzamy kolejną standardową lokalizację.
    }
  }

  return null;
}

async function runNaps2(args, timeout = 30_000) {
  const command = await findExecutable();
  if (!command) {
    const error = new Error('NAPS2 nie jest zainstalowany na tym komputerze.');
    error.code = 'NAPS2_NOT_INSTALLED';
    throw error;
  }

  return execFileAsync(command.executable, [...command.prefix, ...args], {
    timeout,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
}

function driversForPlatform() {
  if (process.platform === 'darwin') return ['apple', 'escl'];
  if (process.platform === 'win32') return ['wia', 'twain', 'escl'];
  return ['escl', 'sane'];
}

function parseDeviceNames(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(devices?|available devices?)\s*:?$/i.test(line));
}

function normalizeNetworkAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(candidate);
  const octets = url.hostname.split('.').map(Number);
  const isPrivateIpv4 =
    octets.length === 4 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
    (octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254));

  if (!isPrivateIpv4 || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Podaj lokalny adres IP skanera, np. 192.168.1.17.');
  }

  return `${url.protocol}//${url.host}/eSCL`;
}

async function fetchWithTimeout(url, options = {}, timeout = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function postXmlWithNativeHttp(url, xml, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = Buffer.from(xml);
    const request = httpRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 80,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Content-Type': 'text/xml',
          'Content-Length': body.length,
          'User-Agent': 'Mozilla/5.0',
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    request.setTimeout(timeout, () => request.destroy(new Error('Przekroczono czas połączenia ze skanerem.')));
    request.on('error', reject);
    request.end(body);
  });
}

function extractScannerName(capabilities, fallback) {
  const match = capabilities.match(/<(?:\w+:)?MakeAndModel[^>]*>([^<]+)</i);
  return match?.[1]?.trim() || fallback;
}

function extractXmlValue(xml, localName) {
  const match = xml.match(new RegExp(`<(?:\\w+:)?${localName}[^>]*>([^<]+)<`, 'i'));
  return match?.[1]?.trim() || null;
}

async function probeEsclDevice(address) {
  const baseUrl = normalizeNetworkAddress(address);
  if (!baseUrl) return null;

  const response = await fetchWithTimeout(`${baseUrl}/ScannerCapabilities`, {
    headers: { Accept: 'application/xml, text/xml' },
  });

  if (!response.ok) {
    throw new Error(`Urządzenie odpowiada, ale nie udostępnia AirScan/eSCL (HTTP ${response.status}).`);
  }

  const capabilities = await response.text();
  if (!/ScannerCapabilities/i.test(capabilities)) {
    throw new Error('Pod tym adresem działa panel WWW, ale nie znaleziono usługi skanowania AirScan/eSCL.');
  }

  let scannerState = null;
  let adfState = null;
  try {
    const statusResponse = await fetchWithTimeout(`${baseUrl}/ScannerStatus`, {
      headers: { Accept: 'application/xml, text/xml' },
    });
    if (statusResponse.ok) {
      const scannerStatus = await statusResponse.text();
      scannerState = extractXmlValue(scannerStatus, 'State');
      adfState = extractXmlValue(scannerStatus, 'AdfState');
    }
  } catch {
    // Nie blokujemy wykrywania urządzenia, jeśli starszy skaner nie udostępnia stanu.
  }

  const hostname = new URL(baseUrl).hostname;
  const detectedName = extractScannerName(capabilities, 'Skaner sieciowy');
  const friendlyName = /^pst_[a-z0-9_-]+$/i.test(detectedName)
    ? 'HP Photosmart 6510'
    : detectedName;
  return {
    id: `escl-url:${baseUrl}`,
    name: `${friendlyName} — ${hostname}`,
    driver: 'escl',
    server: response.headers.get('server'),
    scannerState,
    adfState,
  };
}

async function listDevices(address) {
  const devices = [];
  const warnings = [];

  const drivers = address
    ? driversForPlatform().filter((driver) => driver !== 'escl')
    : driversForPlatform();
  const driverResultsPromise = Promise.all(
    drivers.map(async (driver) => {
      try {
        const { stdout } = await runNaps2(['--listdevices', '--driver', driver], 8_000);
        return { driver, names: parseDeviceNames(stdout) };
      } catch (error) {
        if (error.code === 'NAPS2_NOT_INSTALLED') throw error;
        warnings.push(`${driver}: ${error.stderr?.trim() || error.message}`);
        return { driver, names: [] };
      }
    }),
  );
  const directDevicePromise = address
    ? probeEsclDevice(address).catch((error) => {
        warnings.push(`Adres ${address}: ${error.message}`);
        return null;
      })
    : Promise.resolve(null);
  const [driverResults, directDevice] = await Promise.all([
    driverResultsPromise,
    directDevicePromise,
  ]);

  for (const result of driverResults) {
    for (const name of result.names) {
      devices.push({ id: `${result.driver}:${name}`, name, driver: result.driver });
    }
  }

  if (directDevice) devices.unshift(directDevice);

  return {
    devices: devices.filter(
      (device, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.driver === device.driver && candidate.name.toLowerCase() === device.name.toLowerCase(),
        ) === index,
    ),
    warnings,
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) throw new Error('Żądanie jest zbyt duże.');
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function validateScanSettings(body) {
  const directEsclPrefix = 'escl-url:';
  const directEsclUrl = String(body.deviceId || '').startsWith(directEsclPrefix)
    ? String(body.deviceId).slice(directEsclPrefix.length)
    : null;
  const [driverFromId, ...deviceParts] = String(body.deviceId || '').split(':');
  const driver = driverFromId;
  const device = deviceParts.join(':');
  const allowedDrivers = driversForPlatform();
  const allowedSources = ['glass', 'feeder', 'duplex'];
  const allowedDepths = ['color', 'gray', 'bw'];
  const allowedDpi = [150, 200, 300, 600];

  if (!directEsclUrl && (!allowedDrivers.includes(driver) || !device || device.length > 300)) {
    throw new Error('Wybierz poprawne urządzenie skanujące.');
  }
  if (!allowedSources.includes(body.source)) throw new Error('Nieprawidłowe źródło papieru.');
  if (!allowedDepths.includes(body.bitDepth)) throw new Error('Nieprawidłowy tryb koloru.');
  if (!allowedDpi.includes(Number(body.dpi))) throw new Error('Nieprawidłowa rozdzielczość.');

  return {
    driver: directEsclUrl ? 'escl-url' : driver,
    device: directEsclUrl ? normalizeNetworkAddress(directEsclUrl) : device,
    source: body.source,
    bitDepth: body.bitDepth,
    dpi: Number(body.dpi),
  };
}

function directScanTicket(settings) {
  const inputSource = settings.source === 'glass' ? 'Platen' : 'Feeder';
  const colorMode =
    settings.bitDepth === 'color'
      ? 'RGB24'
      : 'Grayscale8';

  return `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.0</pwg:Version>
  <scan:Intent>TextAndGraphic</scan:Intent>
  <pwg:ScanRegions pwg:MustHonor="true">
    <pwg:ScanRegion>
      <pwg:Height>3508</pwg:Height>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
      <pwg:Width>2480</pwg:Width>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>${inputSource}</pwg:InputSource>
  <scan:Duplex>${settings.source === 'duplex' ? 'true' : 'false'}</scan:Duplex>
  <scan:ColorMode>${colorMode}</scan:ColorMode>
  <scan:XResolution>${settings.dpi}</scan:XResolution>
  <scan:YResolution>${settings.dpi}</scan:YResolution>
  <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
</scan:ScanSettings>`;
}

function legacyHpScanTicket(settings) {
  const colorSpace = settings.bitDepth === 'color' ? 'Color' : 'Gray';

  return `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanJob xmlns:scan="http://www.hp.com/schemas/imaging/con/cnx/scan/2008/08/19" xmlns:dd="http://www.hp.com/schemas/imaging/con/dictionaries/1.0/">
  <scan:XResolution>${settings.dpi}</scan:XResolution>
  <scan:YResolution>${settings.dpi}</scan:YResolution>
  <scan:XStart>0</scan:XStart>
  <scan:YStart>0</scan:YStart>
  <scan:Width>2480</scan:Width>
  <scan:Height>3508</scan:Height>
  <scan:Format>Pdf</scan:Format>
  <scan:CompressionQFactor>25</scan:CompressionQFactor>
  <scan:ColorSpace>${colorSpace}</scan:ColorSpace>
  <scan:BitDepth>8</scan:BitDepth>
  <scan:InputSource>Platen</scan:InputSource>
  <scan:GrayRendering>NTSC</scan:GrayRendering>
  <scan:ToneMap>
    <scan:Gamma>1000</scan:Gamma>
    <scan:Brightness>1000</scan:Brightness>
    <scan:Contrast>1000</scan:Contrast>
    <scan:Highlite>179</scan:Highlite>
    <scan:Shadow>25</scan:Shadow>
  </scan:ToneMap>
  <scan:ContentType>Document</scan:ContentType>
</scan:ScanJob>`;
}

function decodeXmlText(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

async function scanLegacyHpLedm(settings, directory, outputPath) {
  if (settings.source !== 'glass') {
    throw new Error('HP Photosmart 6510 obsługuje skanowanie wyłącznie z szyby.');
  }

  const deviceOrigin = new URL(settings.device).origin;
  const statusResponse = await fetchWithTimeout(`${deviceOrigin}/Scan/Status`, {
    headers: { Accept: 'application/xml, text/xml' },
  });
  if (!statusResponse.ok) {
    throw new Error('Skaner nie udostępnia zgodnego mechanizmu HP WebScan.');
  }

  const statusXml = await statusResponse.text();
  const scannerState = extractXmlValue(statusXml, 'ScannerState');
  if (scannerState && scannerState.toLowerCase() !== 'idle') {
    throw new Error(`Skaner nie jest gotowy (stan: ${scannerState}). Zamknij WebScan i spróbuj ponownie.`);
  }

  const createJob = await postXmlWithNativeHttp(
    `${deviceOrigin}/Scan/Jobs`,
    legacyHpScanTicket(settings),
  );

  if (!createJob.ok) {
    const details = createJob.body.toString('utf8').trim();
    console.error(
      `HP WebScan odrzucił zadanie: HTTP ${createJob.status}${details ? `, odpowiedź: ${details.slice(0, 1000)}` : ''}`,
    );
    if ([409, 423, 503].includes(createJob.status)) {
      throw new Error('Skaner ma aktywne inne zadanie. Zamknij WebScan, odczekaj chwilę i spróbuj ponownie.');
    }
    throw new Error(`HP WebScan odrzucił rozpoczęcie skanu (HTTP ${createJob.status}).`);
  }

  const location = createJob.headers.location;
  if (!location) throw new Error('HP WebScan nie zwrócił adresu zadania skanowania.');
  const jobUrl = new URL(location, `${deviceOrigin}/`).toString();
  const deadline = Date.now() + 2 * 60_000;
  let binaryUrl = null;

  while (Date.now() < deadline) {
    const jobResponse = await fetchWithTimeout(jobUrl, {
      headers: { Accept: 'application/xml, text/xml' },
    });
    if (!jobResponse.ok) {
      throw new Error(`Nie udało się odczytać postępu skanowania HP (HTTP ${jobResponse.status}).`);
    }

    const jobXml = await jobResponse.text();
    const jobState = extractXmlValue(jobXml, 'JobState');
    const pageState = extractXmlValue(jobXml, 'PageState');
    const candidateUrl = extractXmlValue(jobXml, 'BinaryURL');

    if (candidateUrl && pageState === 'ReadyToUpload') {
      binaryUrl = new URL(decodeXmlText(candidateUrl), `${deviceOrigin}/`).toString();
      break;
    }
    if (['Canceled', 'ProcessingError'].includes(jobState || '')) {
      throw new Error(`Skanowanie HP zostało przerwane (stan: ${jobState}).`);
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  if (!binaryUrl) throw new Error('Skaner HP nie przygotował obrazu w wymaganym czasie.');

  const document = await fetchWithTimeout(
    binaryUrl,
    { headers: { Accept: 'application/pdf, image/jpeg, image/png, image/tiff' } },
    2 * 60_000,
  );
  if (!document.ok) {
    throw new Error(`Nie udało się pobrać skanu z HP (HTTP ${document.status}).`);
  }

  const contentType = document.headers.get('content-type') || 'application/pdf';
  const bytes = Buffer.from(await document.arrayBuffer());
  if (contentType.includes('pdf') || bytes.subarray(0, 4).toString() === '%PDF') {
    await writeFile(outputPath, bytes);
    return;
  }

  const extension = contentType.includes('png') ? 'png' : contentType.includes('tiff') ? 'tiff' : 'jpg';
  const pagePath = path.join(directory, `page-001.${extension}`);
  await writeFile(pagePath, bytes);
  await runNaps2(['-i', pagePath, '-n', '0', '-o', outputPath, '-f'], 60_000);
}

async function scanDirectEscl(settings, directory, outputPath) {
  const baseUrl = settings.device.replace(/\/$/, '');
  try {
    const capabilitiesResponse = await fetchWithTimeout(`${baseUrl}/ScannerCapabilities`, {
      headers: { Accept: 'application/xml, text/xml' },
    });
    if (capabilitiesResponse.ok) {
      const capabilities = await capabilitiesResponse.text();
      const model = extractXmlValue(capabilities, 'MakeAndModel');
      if (model && /^pst_[a-z0-9_-]+$/i.test(model)) {
        return scanLegacyHpLedm(settings, directory, outputPath);
      }
    }
  } catch {
    // Jeśli identyfikacja modelu się nie powiedzie, próbujemy standardowego eSCL.
  }

  let scannerState = null;
  try {
    const statusResponse = await fetchWithTimeout(`${baseUrl}/ScannerStatus`, {
      headers: { Accept: 'application/xml, text/xml' },
    });
    if (statusResponse.ok) {
      scannerState = extractXmlValue(await statusResponse.text(), 'State');
    }
  } catch {
    // Próba utworzenia zadania nadal może się udać bez osobnego odczytu stanu.
  }
  let createJob;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    createJob = await fetchWithTimeout(
      `${baseUrl}/ScanJobs`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/xml, text/xml',
          'Content-Type': 'text/xml; charset=utf-8',
        },
        body: directScanTicket(settings),
      },
      20_000,
    );

    if (createJob.status !== 409 || attempt === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }

  if (!createJob) throw new Error('Nie udało się rozpocząć zadania skanowania.');

  if (!createJob.ok) {
    const rejectionDetails = (await createJob.text()).trim();
    console.error(
      `eSCL ScanJobs odrzucone: HTTP ${createJob.status}, stan ${scannerState || 'nieznany'}${rejectionDetails ? `, odpowiedź: ${rejectionDetails.slice(0, 1000)}` : ''}`,
    );
    if (createJob.status === 409 && scannerState?.toLowerCase() === 'idle') {
      return scanLegacyHpLedm(settings, directory, outputPath);
    }
    if ([409, 423, 503].includes(createJob.status)) {
      throw new Error(
        'Skaner jest zajęty albo ma otwarte inne zadanie. Zamknij aktywne skanowanie w WebScan lub Brother iPrint&Scan, odczekaj chwilę i spróbuj ponownie.',
      );
    }
    throw new Error(`Skaner odrzucił rozpoczęcie skanu (HTTP ${createJob.status}).`);
  }

  const location = createJob.headers.get('location');
  if (!location) throw new Error('Skaner nie zwrócił adresu zadania skanowania.');
  const jobUrl = new URL(location, `${baseUrl}/`).toString().replace(/\/$/, '');
  const pages = [];

  for (let page = 1; page <= 100; page += 1) {
    const document = await fetchWithTimeout(
      `${jobUrl}/NextDocument`,
      { headers: { Accept: 'image/jpeg, image/png, image/tiff, application/pdf' } },
      2 * 60_000,
    );

    if ([404, 409, 503].includes(document.status) && pages.length > 0) break;
    if (!document.ok) {
      throw new Error(`Nie udało się pobrać strony ze skanera (HTTP ${document.status}).`);
    }

    const contentType = document.headers.get('content-type') || 'image/jpeg';
    const extension = contentType.includes('png')
      ? 'png'
      : contentType.includes('tiff')
        ? 'tiff'
        : contentType.includes('pdf')
          ? 'pdf'
          : 'jpg';
    const pagePath = path.join(directory, `page-${String(page).padStart(3, '0')}.${extension}`);
    await writeFile(pagePath, Buffer.from(await document.arrayBuffer()));
    pages.push(pagePath);

    if (settings.source === 'glass') break;
  }

  if (pages.length === 0) throw new Error('Skaner nie zwrócił żadnej strony.');

  await runNaps2(['-i', pages.join(';'), '-n', '0', '-o', outputPath, '-f'], 60_000);
}

async function scan(body) {
  const settings = validateScanSettings(body);
  const directory = await mkdtemp(path.join(tmpdir(), 'mavinci-scan-'));
  const outputPath = path.join(directory, 'scan.pdf');

  try {
    if (settings.driver === 'escl-url') {
      await scanDirectEscl(settings, directory, outputPath);
      return await readFile(outputPath);
    }

    await runNaps2(
      [
        '-o',
        outputPath,
        '--noprofile',
        '--driver',
        settings.driver,
        '--device',
        settings.device,
        '--source',
        settings.source,
        '--dpi',
        String(settings.dpi),
        '--pagesize',
        'a4',
        '--bitdepth',
        settings.bitDepth,
        '--deskew',
        '--disableocr',
        '-n',
        '1',
        '-f',
      ],
      5 * 60_000,
    );

    return await readFile(outputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;

  if (!isOriginAllowed(origin)) {
    sendJson(response, 403, { code: 'ORIGIN_REJECTED', message: 'Ta strona nie ma dostępu do skanera.' }, origin);
    return;
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(origin));
    response.end();
    return;
  }

  try {
    if (request.method === 'GET' && request.url === '/health') {
      const command = await findExecutable();
      sendJson(
        response,
        200,
        {
          ok: true,
          naps2Available: Boolean(command),
          naps2Path: command?.executable || null,
          platform: process.platform,
        },
        origin,
      );
      return;
    }

    const requestUrl = new URL(request.url || '/', `http://${host}:${port}`);

    if (request.method === 'GET' && requestUrl.pathname === '/devices') {
      const result = await listDevices(requestUrl.searchParams.get('address'));
      sendJson(response, 200, result, origin);
      return;
    }

    if (request.method === 'POST' && request.url === '/scan') {
      const body = await readJsonBody(request);
      const pdf = await scan(body);
      const filename = `skan-${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
      response.writeHead(200, {
        ...corsHeaders(origin),
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': pdf.length,
      });
      response.end(pdf);
      return;
    }

    sendJson(response, 404, { code: 'NOT_FOUND', message: 'Nie znaleziono operacji.' }, origin);
  } catch (error) {
    const code = error.code === 'NAPS2_NOT_INSTALLED' ? error.code : 'SCANNER_ERROR';
    const status = code === 'NAPS2_NOT_INSTALLED' ? 503 : 400;
    sendJson(
      response,
      status,
      {
        code,
        message:
          error.stderr?.trim() || error.message || 'Skanowanie nie powiodło się. Sprawdź urządzenie i spróbuj ponownie.',
      },
      origin,
    );
  }
});

server.listen(port, host, () => {
  console.log(`Mavinci Scanner Bridge działa na http://${host}:${port}`);
  console.log('Zostaw to okno otwarte podczas skanowania w CRM.');
});
