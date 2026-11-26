'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowDown, ArrowUp, Eye, FilePlus2, FileStack, Loader2, RefreshCw, ScanLine, Settings2, Trash2 } from 'lucide-react';
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
  /** `pages` — liczba stron (tylko w trybie wielostronicowym). */
  onScanned: (file: File, pages?: number) => void;
  /**
   * Dokument wielostronicowy (np. umowa): każdy skan dokłada strony do listy („Dodaj stronę” — kolejny skan), strony można
   * obejrzeć, przestawić i usunąć, a „Zakończ” łączy je w jeden PDF (pdf-lib w przeglądarce, bez ponownej kompresji obrazów).
   * Skan z podajnika może od razu mieć kilka stron. Bez tej opcji — jeden skan to jeden plik (faktury).
   */
  multiPage?: boolean;
  /** Tytuł okna, opis nad skanerem i początek nazwy pliku (domyślnie — faktura). */
  title?: string;
  intro?: string;
  fileName?: string;
  /** Limit rozmiaru gotowego pliku (np. limit magazynu) — po przekroczeniu „Zakończ” jest zablokowane z podpowiedzią. */
  maxBytes?: number;
  /** Warstwa okna, gdy skaner otwiera się nad oknem z warstwą wyższą niż z-50 (np. formularz umowy). */
  layerClassName?: string;
}

/** Zeskanowana część dokumentu (jeden skan — jedna lub kilka stron z podajnika). */
type ScannedPart = { id: string; blob: Blob; pages: number };

export const scanFileSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} kB`;

/** Liczba stron PDF ze skanera (pdf-lib ładowany dopiero przy skanie wielostronicowym). */
async function pdfPageCount(blob: Blob): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  try {
    const doc = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    throw new Error('Skaner zwrócił plik, którego nie da się odczytać jako PDF. Zeskanuj stronę ponownie.');
  }
}

/** Skany w kolejności z listy → jeden PDF. */
async function mergeScannedParts(parts: ScannedPart[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  merged.setCreator('Mavinci CRM');
  merged.setProducer('Mavinci CRM');
  for (const part of parts) {
    const doc = await PDFDocument.load(await part.blob.arrayBuffer(), { ignoreEncryption: true });
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return merged.save();
}

export const scanPagesLabel = (count: number) => (count === 1 ? '1 strona' : count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14) ? `${count} strony` : `${count} stron`);

const selectClass =
  'w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/60';

function friendlyError(error: unknown) {
  if (error instanceof ScannerBridgeError) return error.message;
  return error instanceof Error
    ? error.message
    : 'Nie udało się połączyć ze skanerem. Sprawdź urządzenie i spróbuj ponownie.';
}

export function ScannerCaptureModal({
  open,
  onClose,
  onScanned,
  multiPage = false,
  title = 'Skanuj fakturę',
  intro = 'Połóż dokument na szybie albo w podajniku. Po skanowaniu PDF pojawi się w podglądzie faktury i zostanie wysłany do CRM dopiero po kliknięciu „Zapisz fakturę”.',
  fileName = 'skan-faktury',
  maxBytes,
  layerClassName,
}: ScannerCaptureModalProps) {
  const router = useRouter();
  const [parts, setParts] = useState<ScannedPart[]>([]);
  const [merging, setMerging] = useState(false);
  const totalPages = parts.reduce((sum, part) => sum + part.pages, 0);
  const totalBytes = parts.reduce((sum, part) => sum + part.blob.size, 0);
  const tooLarge = maxBytes != null && totalBytes > maxBytes;
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
    setParts([]);
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
      if (multiPage) {
        // Kolejny skan dokłada strony na koniec listy; dokument powstaje dopiero po „Zakończ”.
        const pages = await pdfPageCount(pdf);
        setParts((current) => [...current, { id: `${Date.now()}-${current.length}`, blob: pdf, pages }]);
        return;
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = new File([pdf], `${fileName}-${timestamp}.pdf`, {
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

  /** Zamknięcie okna — zeskanowane, niepołączone strony przepadają, więc najpierw pytanie. */
  const close = () => {
    if (scanning || merging) return;
    if (parts.length && !window.confirm(`Odrzucić zeskanowane strony (${scanPagesLabel(totalPages)})?`)) return;
    setParts([]);
    onClose();
  };

  const openConfiguration = () => {
    if (parts.length && !window.confirm(`Odrzucić zeskanowane strony (${scanPagesLabel(totalPages)}) i otworzyć konfigurator skanera?`)) return;
    setParts([]);
    onClose();
    router.push('/crm/settings/scanners');
  };

  const previewPart = (part: ScannedPart) => {
    const url = URL.createObjectURL(part.blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const movePart = (index: number, offset: -1 | 1) => {
    setParts((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  /** „Zakończ”: wszystkie skany w kolejności z listy → jeden plik PDF. */
  const finish = async () => {
    if (!parts.length || merging || scanning || tooLarge) return;
    setMerging(true);
    setError(null);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const content = parts.length === 1 ? parts[0].blob : new Uint8Array(await mergeScannedParts(parts));
      const file = new File([content], `${fileName}-${timestamp}.pdf`, { type: 'application/pdf', lastModified: Date.now() });
      if (maxBytes != null && file.size > maxBytes) {
        setError(`Połączony plik ma ${scanFileSize(file.size)} — limit to ${scanFileSize(maxBytes)}. Zeskanuj część stron w niższej jakości (np. 200 DPI) albo w skali szarości.`);
        return;
      }
      setParts([]);
      onScanned(file, totalPages);
    } catch (mergeError) {
      setError(mergeError instanceof Error ? `Nie udało się połączyć stron w PDF: ${mergeError.message}` : 'Nie udało się połączyć stron w PDF.');
    } finally {
      setMerging(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title={title} layerClassName={layerClassName}>
      <div className="space-y-5">
        <div className="rounded-xl border border-[#d3bb73]/15 bg-[#0f1119] p-4 text-sm leading-6 text-[#e5e4e2]/70">
          {intro}
        </div>

        {multiPage && parts.length > 0 && (
          <div className="rounded-xl border border-[#d3bb73]/20 bg-[#d3bb73]/[0.04] p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
                <FileStack className="h-4 w-4 text-[#d3bb73]" /> Zeskanowano: {scanPagesLabel(totalPages)} · {scanFileSize(totalBytes)}
              </p>
              <span className="text-xs text-[#e5e4e2]/50">Połóż kolejną stronę i kliknij „Dodaj stronę” albo zakończ.</span>
            </div>
            <ol className="space-y-1.5">
              {parts.map((part, index) => (
                <li key={part.id} className="flex items-center gap-2 rounded-lg bg-[#0f1119] px-3 py-2 text-xs text-[#e5e4e2]/80">
                  <span className="min-w-0 flex-1">
                    Skan {index + 1} · {scanPagesLabel(part.pages)} · {scanFileSize(part.blob.size)}
                  </span>
                  <button type="button" onClick={() => previewPart(part)} disabled={merging} title="Podgląd skanu" className="rounded p-1 text-[#d3bb73] hover:bg-white/5 disabled:opacity-40">
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => movePart(index, -1)} disabled={index === 0 || merging || scanning} title="Wyżej" className="rounded p-1 text-[#e5e4e2]/60 hover:bg-white/5 disabled:opacity-30">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => movePart(index, 1)} disabled={index === parts.length - 1 || merging || scanning} title="Niżej" className="rounded p-1 text-[#e5e4e2]/60 hover:bg-white/5 disabled:opacity-30">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => setParts((current) => current.filter((item) => item.id !== part.id))} disabled={merging || scanning} title="Usuń skan" className="rounded p-1 text-[#e5e4e2]/50 hover:bg-white/5 hover:text-red-300 disabled:opacity-30">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ol>
            {tooLarge && maxBytes != null && (
              <p className="mt-2 text-xs text-amber-300">
                Plik przekroczy limit {scanFileSize(maxBytes)}. Usuń skan i zeskanuj go ponownie w niższej jakości (np. 200 DPI) albo w skali
                szarości.
              </p>
            )}
          </div>
        )}

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
            onClick={close}
            disabled={scanning || merging}
            className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]/70 hover:text-[#e5e4e2] disabled:opacity-50"
          >
            Anuluj
          </button>
          {multiPage && parts.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => void startScan()}
                disabled={loading || scanning || merging || !selectedDevice}
                className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/40 px-4 py-2 text-sm font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
                {scanning ? 'Skanowanie…' : 'Dodaj stronę'}
              </button>
              <button
                type="button"
                onClick={() => void finish()}
                disabled={scanning || merging || tooLarge}
                className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-2 text-sm font-medium text-[#0a0d1a] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileStack className="h-4 w-4" />}
                {merging ? 'Łączenie w PDF…' : `Zakończ — połącz w PDF (${scanPagesLabel(totalPages)})`}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void startScan()}
              disabled={loading || scanning || !selectedDevice}
              className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-2 text-sm font-medium text-[#0a0d1a] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
              {scanning ? 'Skanowanie…' : multiPage ? 'Skanuj pierwszą stronę' : 'Rozpocznij skanowanie'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
