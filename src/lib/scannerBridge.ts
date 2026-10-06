'use client';

export type ScannerDriver = 'apple' | 'escl' | 'sane' | 'wia' | 'twain';
export type ScannerSource = 'glass' | 'feeder' | 'duplex';
export type ScannerBitDepth = 'color' | 'gray' | 'bw';

export interface ScannerDevice {
  id: string;
  name: string;
  driver: ScannerDriver;
}

export interface ScannerSettings {
  deviceId: string;
  networkAddress: string;
  source: ScannerSource;
  dpi: 150 | 200 | 300 | 600;
  bitDepth: ScannerBitDepth;
  pageSize: 'a4';
}

export interface ScannerBridgeHealth {
  ok: boolean;
  naps2Available: boolean;
  naps2Path: string | null;
  platform: string;
}

const STORAGE_KEY = 'crm-scanner-settings:v1';
const BRIDGE_URL = (
  process.env.NEXT_PUBLIC_SCANNER_BRIDGE_URL || 'http://127.0.0.1:47831'
).replace(/\/$/, '');

export const DEFAULT_SCANNER_SETTINGS: ScannerSettings = {
  deviceId: '',
  networkAddress: '192.168.1.17',
  source: 'glass',
  dpi: 300,
  bitDepth: 'color',
  pageSize: 'a4',
};

export class ScannerBridgeError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ScannerBridgeError';
    this.code = code;
  }
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { code?: string; message?: string };
    return new ScannerBridgeError(
      body.code || 'SCANNER_BRIDGE_ERROR',
      body.message || 'Moduł skanowania zwrócił błąd.',
    );
  } catch {
    return new ScannerBridgeError('SCANNER_BRIDGE_ERROR', 'Moduł skanowania zwrócił błąd.');
  }
}

async function bridgeFetch(path: string, init?: RequestInit, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(`${BRIDGE_URL}${path}`, {
      cache: 'no-store',
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ScannerBridgeError(
        'BRIDGE_TIMEOUT',
        'Wykrywanie skanera trwało zbyt długo. Wpisz jego adres IP i spróbuj ponownie.',
      );
    }
    throw new ScannerBridgeError(
      'BRIDGE_UNREACHABLE',
      'Nie wykryto lokalnego modułu skanowania na tym komputerze.',
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

export function loadScannerSettings(): ScannerSettings {
  if (typeof window === 'undefined') return DEFAULT_SCANNER_SETTINGS;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_SCANNER_SETTINGS;
    return { ...DEFAULT_SCANNER_SETTINGS, ...JSON.parse(stored) } as ScannerSettings;
  } catch {
    return DEFAULT_SCANNER_SETTINGS;
  }
}

export function saveScannerSettings(settings: ScannerSettings) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function findPreferredScanner(devices: ScannerDevice[]) {
  const preferredPatterns = [/brother/i, /mfc[-\s]?t920/i, /photosmart\s*6510/i, /\bhp\b/i];

  for (const pattern of preferredPatterns) {
    const device = devices.find((candidate) => pattern.test(candidate.name));
    if (device) return device;
  }

  return devices[0] || null;
}

export async function getScannerBridgeHealth(): Promise<ScannerBridgeHealth> {
  const response = await bridgeFetch('/health');
  if (!response.ok) throw await readError(response);
  return response.json();
}

export async function listScannerDevices(networkAddress?: string): Promise<ScannerDevice[]> {
  const query = networkAddress?.trim()
    ? `?address=${encodeURIComponent(networkAddress.trim())}`
    : '';
  const response = await bridgeFetch(`/devices${query}`);
  if (!response.ok) throw await readError(response);
  const body = (await response.json()) as { devices?: ScannerDevice[]; warnings?: string[] };
  const devices = body.devices || [];

  if (networkAddress?.trim() && devices.length === 0) {
    const addressWarning = body.warnings?.find((warning) => warning.startsWith('Adres '));
    if (addressWarning) {
      throw new ScannerBridgeError(
        'SCANNER_NOT_REACHABLE',
        addressWarning.replace(/^Adres [^:]+:\s*/, ''),
      );
    }
  }

  return devices;
}

export async function scanDocument(settings: ScannerSettings): Promise<Blob> {
  const response = await bridgeFetch('/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }, 6 * 60_000);

  if (!response.ok) throw await readError(response);
  return response.blob();
}

export function scannerBridgeUrl() {
  return BRIDGE_URL;
}
