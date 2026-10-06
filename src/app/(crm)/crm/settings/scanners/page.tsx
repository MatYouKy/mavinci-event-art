'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  ScanLine,
  Server,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  findPreferredScanner,
  getScannerBridgeHealth,
  listScannerDevices,
  loadScannerSettings,
  saveScannerSettings,
  scanDocument,
  type ScannerDevice,
  type ScannerSettings,
} from '@/lib/scannerBridge';

type ConnectionStatus = 'checking' | 'ready' | 'bridge-missing' | 'naps2-missing';

const selectClass =
  'w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/60';

export default function ScannerSettingsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const [devices, setDevices] = useState<ScannerDevice[]>([]);
  const [settings, setSettings] = useState<ScannerSettings>(() => loadScannerSettings());
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === settings.deviceId) || null,
    [devices, settings.deviceId],
  );

  const refresh = useCallback(async (networkAddress?: string) => {
    setStatus('checking');
    setError(null);
    let bridgeConnected = false;

    try {
      const health = await getScannerBridgeHealth();
      bridgeConnected = true;
      if (!health.naps2Available) {
        setDevices([]);
        setStatus('naps2-missing');
        return;
      }

      const discovered = await listScannerDevices(networkAddress);
      setDevices(discovered);
      setStatus('ready');

      setSettings((current) => {
        if (discovered.some((device) => device.id === current.deviceId)) return current;
        const preferred = findPreferredScanner(discovered);
        return { ...current, deviceId: preferred?.id || '' };
      });

      if (discovered.length === 0) {
        setError('Nie znaleziono skanera w sieci ani wśród urządzeń systemowych.');
      }
    } catch (connectionError) {
      setDevices([]);
      setStatus(bridgeConnected ? 'ready' : 'bridge-missing');
      setError(connectionError instanceof Error ? connectionError.message : 'Nie udało się połączyć z modułem skanowania.');
    }
  }, []);

  useEffect(() => {
    void refresh(loadScannerSettings().networkAddress);
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const updateSettings = <K extends keyof ScannerSettings>(key: K, value: ScannerSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const persistSettings = () => {
    if (!selectedDevice) {
      showSnackbar('Wybierz skaner przed zapisaniem ustawień', 'error');
      return;
    }
    saveScannerSettings(settings);
    showSnackbar('Domyślny skaner został zapisany na tym komputerze', 'success');
  };

  const testScanner = async () => {
    if (!selectedDevice) return;
    setTesting(true);
    setError(null);

    try {
      saveScannerSettings(settings);
      const pdf = await scanDocument(settings);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(pdf));
      showSnackbar('Skan testowy zakończony — urządzenie jest gotowe', 'success');
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Skan testowy nie powiódł się.');
      showSnackbar('Nie udało się wykonać skanu testowego', 'error');
    } finally {
      setTesting(false);
    }
  };

  const copyBridgeCommand = async () => {
    await navigator.clipboard.writeText('npm run scanner:install');
    showSnackbar('Polecenie zostało skopiowane', 'success');
  };

  return (
    <div className="max-w-6xl">
      <button
        type="button"
        onClick={() => router.push('/crm/settings')}
        className="mb-5 flex items-center gap-2 text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
      >
        <ArrowLeft className="h-4 w-4" />
        Powrót do ustawień
      </button>

      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#d3bb73]/10">
            <ScanLine className="h-6 w-6 text-[#d3bb73]" />
          </div>
          <div>
            <h1 className="text-3xl font-light text-[#e5e4e2]">Skanery dokumentów</h1>
            <p className="text-[#e5e4e2]/60">Konfiguracja skanowania faktur bezpośrednio do CRM</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh(settings.networkAddress)}
          disabled={status === 'checking' || testing}
          className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/25 bg-[#0f1119] px-4 py-2.5 text-sm text-[#e5e4e2] hover:bg-[#1c1f33] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${status === 'checking' ? 'animate-spin' : ''}`} />
          Wykryj urządzenia
        </button>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-5">
          <div className="mb-3 flex items-center gap-3">
            <Server className="h-5 w-5 text-[#d3bb73]" />
            <h2 className="font-medium text-[#e5e4e2]">Połączenie lokalne</h2>
          </div>
          {status === 'checking' && (
            <p className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
              <Loader2 className="h-4 w-4 animate-spin" /> Sprawdzanie modułu skanowania…
            </p>
          )}
          {status === 'ready' && (
            <p className="flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> Moduł skanowania jest gotowy
            </p>
          )}
          {status === 'bridge-missing' && (
            <div className="space-y-3 text-sm text-[#e5e4e2]/70">
              <p className="flex items-start gap-2 text-amber-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Lokalny moduł skanowania nie działa
              </p>
              <p>
                Uruchom jednorazową konfigurację w katalogu CRM. Moduł wystartuje od razu i będzie
                uruchamiał się automatycznie razem z macOS:
              </p>
              <button
                type="button"
                onClick={() => void copyBridgeCommand()}
                className="flex w-full items-center justify-between rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 font-mono text-xs text-[#d3bb73]"
              >
                npm run scanner:install
                <Copy className="h-4 w-4" />
              </button>
            </div>
          )}
          {status === 'naps2-missing' && (
            <div className="space-y-3 text-sm text-[#e5e4e2]/70">
              <p className="flex items-start gap-2 text-amber-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> NAPS2 nie jest zainstalowany
              </p>
              <a
                href="https://www.naps2.com/download"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 font-medium text-[#d3bb73] hover:underline"
              >
                Pobierz bezpłatny NAPS2
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-5">
          <h2 className="mb-3 font-medium text-[#e5e4e2]">Obsługiwane urządzenia</h2>
          <div className="space-y-2 text-sm text-[#e5e4e2]/70">
            <div className="flex items-center justify-between gap-3 rounded-lg bg-[#0f1119] px-3 py-2">
              <span>Brother MFC-T920</span>
              <span className="text-xs text-[#e5e4e2]/45">po podłączeniu do sieci</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-[#0f1119] px-3 py-2">
              <span>HP Photosmart 6510</span>
              <span className="rounded bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">192.168.1.17</span>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-[#e5e4e2]/45">
            Wykrywanie korzysta ze sterownika Apple oraz sieciowego eSCL. Oba urządzenia muszą być
            włączone i dostępne z tego komputera.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-6">
        <div className="mb-5">
          <h2 className="text-lg font-medium text-[#e5e4e2]">Domyślne ustawienia skanowania</h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/55">
            Ustawienia są zapisane tylko na tym komputerze, ponieważ dotyczą lokalnego urządzenia.
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-100/90">
            {error}
          </div>
        )}

        <fieldset disabled={status !== 'ready' || testing} className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <label className="mb-2 block text-sm text-[#e5e4e2]/70">Adres IP skanera sieciowego</label>
            <input
              className={selectClass}
              value={settings.networkAddress}
              inputMode="decimal"
              placeholder="np. 192.168.1.17"
              onChange={(event) => updateSettings('networkAddress', event.target.value)}
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#e5e4e2]/45">
              <span>Adres HP został wpisany domyślnie; nie czekamy już wyłącznie na mDNS.</span>
              {settings.networkAddress && (
                <a
                  href={`http://${settings.networkAddress.replace(/^https?:\/\//, '').replace(/\/$/, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#d3bb73] hover:underline"
                >
                  Otwórz panel urządzenia <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          <div className="lg:col-span-2">
            <label className="mb-2 block text-sm text-[#e5e4e2]/70">Domyślny skaner</label>
            <select
              className={selectClass}
              value={settings.deviceId}
              onChange={(event) => updateSettings('deviceId', event.target.value)}
            >
              <option value="">Wybierz skaner</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} ({device.driver.toUpperCase()})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/70">Źródło</label>
            <select
              className={selectClass}
              value={settings.source}
              onChange={(event) => updateSettings('source', event.target.value as ScannerSettings['source'])}
            >
              <option value="glass">Szyba</option>
              <option value="feeder">Podajnik</option>
              <option value="duplex">Podajnik dwustronny</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/70">Jakość</label>
            <select
              className={selectClass}
              value={settings.dpi}
              onChange={(event) => updateSettings('dpi', Number(event.target.value) as ScannerSettings['dpi'])}
            >
              <option value={150}>150 DPI</option>
              <option value={200}>200 DPI</option>
              <option value={300}>300 DPI — zalecane</option>
              <option value={600}>600 DPI</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/70">Kolor</label>
            <select
              className={selectClass}
              value={settings.bitDepth}
              onChange={(event) => updateSettings('bitDepth', event.target.value as ScannerSettings['bitDepth'])}
            >
              <option value="color">Kolor</option>
              <option value="gray">Skala szarości</option>
              <option value="bw">Czarno-biały</option>
            </select>
          </div>
        </fieldset>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => void testScanner()}
            disabled={status !== 'ready' || testing || !selectedDevice}
            className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/25 px-4 py-2.5 text-sm text-[#e5e4e2] disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
            {testing ? 'Skanowanie…' : 'Wykonaj skan testowy'}
          </button>
          <button
            type="button"
            onClick={persistSettings}
            disabled={status !== 'ready' || testing || !selectedDevice}
            className="rounded-lg bg-[#d3bb73] px-5 py-2.5 text-sm font-medium text-[#0a0d1a] disabled:opacity-50"
          >
            Zapisz ustawienia
          </button>
        </div>

        {previewUrl && (
          <div className="mt-6 border-t border-[#d3bb73]/15 pt-6">
            <h3 className="mb-3 font-medium text-[#e5e4e2]">Podgląd skanu testowego</h3>
            <iframe
              title="Podgląd skanu testowego"
              src={previewUrl}
              className="h-[560px] w-full rounded-xl border border-[#d3bb73]/20 bg-white"
            />
          </div>
        )}
      </div>
    </div>
  );
}
