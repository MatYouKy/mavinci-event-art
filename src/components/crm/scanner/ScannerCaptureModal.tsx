'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2, RefreshCw, ScanLine, Settings2 } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';
import {
  findPreferredScanner,
  getScannerBridgeHealth,
  listScannerDevices,
  loadScannerSettings,
  saveScannerSettings,
  scanDocument,
  ScannerBridgeError,
  type ScannerDevice,
  type ScannerSettings,
} from '@/lib/scannerBridge';

interface ScannerCaptureModalProps {
  open: boolean;
  onClose: () => void;
  onScanned: (file: File) => void;
}

const selectClass =
  'w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/60';

function friendlyError(error: unknown) {
  if (error instanceof ScannerBridgeError) return error.message;
  return error instanceof Error
    ? error.message
    : 'Nie udało się połączyć ze skanerem. Sprawdź urządzenie i spróbuj ponownie.';
}

export function ScannerCaptureModal({ open, onClose, onScanned }: ScannerCaptureModalProps) {
  const router = useRouter();
  const [settings, setSettings] = useState<ScannerSettings>(() => loadScannerSettings());
  const [devices, setDevices] = useState<ScannerDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfiguration, setNeedsConfiguration] = useState(false);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === settings.deviceId) || null,
    [devices, settings.deviceId],
  );

  const discoverDevices = useCallback(async (networkAddress?: string) => {
    setLoading(true);
    setError(null);
    setNeedsConfiguration(false);

    try {
      const health = await getScannerBridgeHealth();
      if (!health.naps2Available) {
        setDevices([]);
        setNeedsConfiguration(true);
        setError('Moduł lokalny działa, ale NAPS2 nie jest jeszcze zainstalowany.');
        return;
      }

      const discovered = await listScannerDevices(networkAddress);
      setDevices(discovered);

      if (discovered.length === 0) {
        setNeedsConfiguration(true);
        setError('Nie wykryto żadnego skanera. Sprawdź, czy urządzenie jest włączone i w tej samej sieci.');
        return;
      }

      setSettings((current) => {
        if (discovered.some((device) => device.id === current.deviceId)) return current;
        const preferred = findPreferredScanner(discovered);
        return { ...current, deviceId: preferred?.id || '' };
      });
    } catch (discoveryError) {
      setDevices([]);
      setNeedsConfiguration(true);
      setError(friendlyError(discoveryError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const storedSettings = loadScannerSettings();
    setSettings(storedSettings);
    void discoverDevices(storedSettings.networkAddress);
  }, [discoverDevices, open]);

  const updateSettings = <K extends keyof ScannerSettings>(key: K, value: ScannerSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const startScan = async () => {
    if (!selectedDevice) {
      setError('Najpierw wybierz skaner.');
      setNeedsConfiguration(true);
      return;
    }

    setScanning(true);
    setError(null);

    try {
      saveScannerSettings(settings);
      const pdf = await scanDocument(settings);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = new File([pdf], `skan-faktury-${timestamp}.pdf`, {
        type: 'application/pdf',
        lastModified: Date.now(),
      });
      onScanned(file);
    } catch (scanError) {
      setError(friendlyError(scanError));
      setNeedsConfiguration(scanError instanceof ScannerBridgeError);
    } finally {
      setScanning(false);
    }
  };

  const openConfiguration = () => {
    onClose();
    router.push('/crm/settings/scanners');
  };

  return (
    <Modal open={open} onClose={scanning ? () => undefined : onClose} title="Skanuj fakturę">
      <div className="space-y-5">
        <div className="rounded-xl border border-[#d3bb73]/15 bg-[#0f1119] p-4 text-sm leading-6 text-[#e5e4e2]/70">
          Połóż dokument na szybie albo w podajniku. Po skanowaniu PDF pojawi się w podglądzie
          faktury i zostanie wysłany do CRM dopiero po kliknięciu „Zapisz fakturę”.
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-4 text-sm text-amber-100/90">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <p>{error}</p>
              {needsConfiguration && (
                <button
                  type="button"
                  onClick={openConfiguration}
                  className="mt-3 inline-flex items-center gap-2 font-medium text-[#d3bb73] hover:underline"
                >
                  <Settings2 className="h-4 w-4" />
                  Otwórz konfigurator skanera
                </button>
              )}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label className="text-sm text-[#e5e4e2]/70">Urządzenie</label>
            <button
              type="button"
              onClick={() => void discoverDevices(settings.networkAddress)}
              disabled={loading || scanning}
              className="inline-flex items-center gap-1.5 text-xs text-[#d3bb73] disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Wykryj ponownie
            </button>
          </div>
          <select
            className={selectClass}
            value={settings.deviceId}
            disabled={loading || scanning || devices.length === 0}
            onChange={(event) => updateSettings('deviceId', event.target.value)}
          >
            <option value="">{loading ? 'Wykrywanie skanerów…' : 'Wybierz skaner'}</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name} ({device.driver.toUpperCase()})
              </option>
            ))}
          </select>
          {selectedDevice && /brother|mfc[-\s]?t920/i.test(selectedDevice.name) && (
            <p className="mt-1.5 text-xs text-emerald-300/80">Preferowany skaner Brother został wykryty.</p>
          )}
        </div>

        <fieldset className="grid gap-4 sm:grid-cols-3" disabled={scanning}>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/70">Źródło papieru</label>
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
              <option value={150}>150 DPI — szybki</option>
              <option value={200}>200 DPI</option>
              <option value={300}>300 DPI — zalecany</option>
              <option value={600}>600 DPI — dokładny</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/70">Kolor</label>
            <select
              className={selectClass}
              value={settings.bitDepth}
              onChange={(event) =>
                updateSettings('bitDepth', event.target.value as ScannerSettings['bitDepth'])
              }
            >
              <option value="color">Kolor</option>
              <option value="gray">Skala szarości</option>
              <option value="bw">Czarno-biały</option>
            </select>
          </div>
        </fieldset>

        <div className="flex flex-wrap justify-end gap-3 border-t border-[#d3bb73]/15 pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={scanning}
            className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]/70 hover:text-[#e5e4e2] disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={() => void startScan()}
            disabled={loading || scanning || !selectedDevice}
            className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-2 text-sm font-medium text-[#0a0d1a] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
            {scanning ? 'Skanowanie…' : 'Rozpocznij skanowanie'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
