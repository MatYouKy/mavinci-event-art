'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Eye, FileCheck2, Loader, Upload } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';

type Attachment = { id: string; original_name: string; file_size: number; mime_type: string; created_at: string };

export default function SignedContractAttachments({ contractId, cancelled = false }: {
  contractId: string; cancelled?: boolean;
}) {
  const { showSnackbar } = useSnackbar();
  const [files, setFiles] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [canUpload, setCanUpload] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [reload, setReload] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const endpoint = `/bridge/events/contracts/signed-files?contractId=${encodeURIComponent(contractId)}`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setCanUpload(false);
    const load = async () => {
      try {
        const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Nie udało się pobrać załączników.');
        setFiles(data.files || []);
        setCanUpload(Boolean(data.canUpload));
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Nie udało się pobrać załączników.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [endpoint, cancelled, reload]);

  const upload = async (selected: FileList | null) => {
    if (!selected?.length || busy.current || !canUpload || cancelled) return;
    if (selected.length !== 1) {
      showSnackbar('Dodaj jeden plik naraz. Wielostronicową umowę najlepiej zapisać jako jeden PDF.', 'warning');
      return;
    }
    const file = selected[0];
    if (!/\.(pdf|jpe?g|png)$/i.test(file.name) || !file.size || file.size > 20 * 1024 * 1024) {
      showSnackbar('Wybierz plik PDF, JPG lub PNG o rozmiarze do 20 MB.', 'warning');
      return;
    }
    busy.current = true;
    setUploading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(endpoint, { method: 'POST', body });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.file) throw new Error(result?.error || 'Nie udało się zapisać podpisanej umowy.');
      setFiles((previous) => [result.file, ...previous]);
      showSnackbar('Podpisana umowa została załączona do CRM.', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nie udało się załączyć pliku. Sprawdź listę przed ponownym wysłaniem.';
      setError(message);
      showSnackbar(message, 'error');
    } finally {
      busy.current = false;
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <section className="no-print min-w-0 space-y-3 rounded-xl bg-[#210811]/65 p-4 lg:col-span-2 md:p-5" aria-label="Podpisana umowa">
      <div className="flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
        <FileCheck2 className="h-4 w-4 text-[#d3bb73]" />
        {cancelled ? 'Podpisana umowa — archiwum' : 'Podpisana umowa'}
      </div>
      <p className="text-xs leading-5 text-[#e5e4e2]/55">Oryginał z podpisami jest przechowywany oddzielnie od generowanego PDF. Dodanie kolejnego pliku nie zastępuje wcześniejszych załączników.</p>
      {loading && <p role="status" className="flex items-center gap-2 text-sm text-white/60"><Loader className="h-4 w-4 animate-spin" />Ładowanie załączników…</p>}
      {!loading && canUpload && !cancelled && (
        <>
          <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" aria-label="Wybierz podpisaną umowę" onChange={(event) => void upload(event.target.files)} disabled={uploading} />
          <button
            type="button"
            disabled={uploading}
            onClick={() => { if (input.current) { input.current.value = ''; input.current.click(); } }}
            onDragOver={(event) => { event.preventDefault(); if (!uploading) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files); }}
            className={`flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73]/50 disabled:cursor-wait ${dragging ? 'bg-[#d3bb73]/10' : 'bg-[#351020]/65 hover:bg-[#411326]'}`}
          >
            {uploading ? <Loader className="h-6 w-6 animate-spin text-[#d3bb73]" /> : <Upload className="h-6 w-6 text-[#d3bb73]" />}
            <span className="text-[#e5e4e2]">{uploading ? 'Zapisywanie podpisanej umowy…' : 'Przeciągnij podpisaną umowę lub kliknij, aby wybrać plik'}</span>
            <span className="text-xs text-[#e5e4e2]/45">PDF, JPG, PNG · maksymalnie 20 MB</span>
          </button>
        </>
      )}
      {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-200/90">
        <span>{error}</span>
        <button type="button" disabled={loading || uploading} onClick={() => setReload((value) => value + 1)} className="rounded-lg border-0 bg-white/5 px-3 py-2 text-[#d3bb73]">Odśwież listę</button>
      </div>}
      {!loading && !error && files.length === 0 && <p className="text-xs text-white/45">Nie załączono jeszcze podpisanej umowy.</p>}
      {files.length > 0 && <ul className="space-y-2">
        {files.map((file) => <li key={file.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-white/[0.025] px-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm text-[#e5e4e2]">{file.original_name}</p>
            <p className="mt-1 text-xs text-white/45">{(file.file_size / 1024 / 1024).toFixed(2)} MB · {new Date(file.created_at).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}</p>
          </div>
          <a href={`${endpoint}&fileId=${encodeURIComponent(file.id)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73] hover:bg-white/10"><Eye className="h-4 w-4" />Otwórz</a>
          <a href={`${endpoint}&fileId=${encodeURIComponent(file.id)}&download=1`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73] hover:bg-white/10"><Download className="h-4 w-4" />Pobierz</a>
        </li>)}
      </ul>}
    </section>
  );
}
