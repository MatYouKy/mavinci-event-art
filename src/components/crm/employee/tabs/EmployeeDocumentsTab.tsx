'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, FileText, HardDrive, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { useDialog } from '@/contexts/DialogContext';
import { driveEmployeeDocumentsNode, type DriveListing, type DriveRoot } from '@/lib/drive/driveShared';
import { formatMaterialBytes, type MaterialKind } from '@/lib/materials/materialsShared';
import { MaterialThumb, cardClass, dateLabel, errorMessage, ghostButton, primaryButton, secondaryButton } from '@/components/crm/materials/materialsUi';
import { deleteDriveFile, downloadDriveFile, driveGet } from '@/components/crm/drive/driveApi';
import { AddDocumentModal } from '../modal/AddDocumentModal';

/*
 * Profil pracownika → Dokumenty: dokumenty z Dysku → Pracownicy → pracownik → Dokumenty (ten sam folder w Finderze, na Macu
 * i w telefonie). Widzi i dodaje sam pracownik, administrator i „Pracownicy — zarządzanie”; usuwa administrator,
 * „Pracownicy — zarządzanie” i autor dokumentu (decyduje baza).
 */

export function EmployeeDocumentsTab({ employeeId }: { employeeId: string }) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const { showConfirm } = useDialog();
  const [listing, setListing] = useState<DriveListing | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  /** Dział Pracownicy w Dysku (odnośnik „Otwórz w Dysku” tylko z dostępem do działu). */
  const [inDrive, setInDrive] = useState(false);
  const node = driveEmployeeDocumentsNode(employeeId);

  useEffect(() => {
    let active = true;
    driveGet<DriveRoot>('root')
      .then((root) => { if (active) setInDrive(root.sections.some((section) => section.key === 'employees' && section.available)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setListing(await driveGet<DriveListing>('list', { node }));
      setError('');
    } catch (cause) {
      setError(errorMessage(cause, 'Nie udało się pobrać dokumentów.'));
    } finally {
      setLoading(false);
    }
  }, [node]);

  useEffect(() => { void load(); }, [load]);

  const download = async (id: string) => {
    try {
      await downloadDriveFile(id);
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się pobrać dokumentu.'), 'error');
    }
  };

  const remove = async (id: string, name: string) => {
    const confirmed = await showConfirm({
      title: 'Usuń dokument', message: `Usunąć dokument „${name}”? Plik zniknie także z Dysku, Findera i telefonu.`, confirmText: 'Usuń', cancelText: 'Anuluj',
    });
    if (!confirmed) return;
    showLoader('Usuwam dokument', 'Proszę chwilę poczekać...');
    try {
      await deleteDriveFile(id);
      showSnackbar('Usunięto dokument.', 'success');
      await load();
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się usunąć dokumentu.'), 'error');
    } finally {
      hideLoader();
    }
  };

  const files = listing?.files || [];

  return (
    <div className={`${cardClass} space-y-4 p-6 text-[#e5e4e2]`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 text-lg font-light">Dokumenty</h3>
        {inDrive && (
          <Link href={`/crm/materials?section=employees&node=${encodeURIComponent(node)}`} className={secondaryButton} title="Ten folder w Dysku">
            <HardDrive className="h-4 w-4" />Otwórz w Dysku
          </Link>
        )}
        <button type="button" className={ghostButton} onClick={() => void load()} title="Odśwież" aria-label="Odśwież"><RefreshCw className="h-4 w-4" /></button>
        {listing?.canUpload && (
          <button type="button" className={primaryButton} onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Dodaj dokument</button>
        )}
      </div>

      {loading && !listing ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>
      ) : error && !listing ? (
        <div className="py-10 text-center text-sm text-[#e5e4e2]/70">
          <p>{error}</p>
          <button type="button" className={`${secondaryButton} mt-4`} onClick={() => void load()}><RefreshCw className="h-4 w-4" />Spróbuj ponownie</button>
        </div>
      ) : !files.length ? (
        <div className="py-12 text-center">
          <FileText className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">Brak dokumentów</p>
        </div>
      ) : (
        <div className="divide-y divide-[#d3bb73]/10 rounded-lg border border-[#d3bb73]/10">
          {files.map((file) => (
            <div key={file.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#e5e4e2]/5">
              <MaterialThumb url={file.thumbnailUrl} kind={file.kind as MaterialKind} name={file.name} className="h-10 w-10 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" title={file.name}>{file.name}</p>
                <p className={`truncate text-xs ${file.detail.includes('termin minął') ? 'text-red-300' : 'text-[#e5e4e2]/50'}`}>{file.detail}</p>
              </div>
              <span className="hidden w-24 shrink-0 text-right text-xs text-[#e5e4e2]/50 md:block">{file.size ? formatMaterialBytes(file.size) : ''}</span>
              <span className="hidden w-24 shrink-0 text-right text-xs text-[#e5e4e2]/50 md:block">{dateLabel(file.updatedAt)}</span>
              <button type="button" className={ghostButton} onClick={() => void download(file.id)} title="Pobierz" aria-label={`Pobierz: ${file.name}`}>
                <Download className="h-4 w-4 text-[#d3bb73]" />
              </button>
              {listing?.canUpload && (
                <button type="button" className={ghostButton} onClick={() => void remove(file.id, file.name)} title="Usuń" aria-label={`Usuń: ${file.name}`}>
                  <Trash2 className="h-4 w-4 text-red-400" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <AddDocumentModal isOpen={adding} onClose={() => setAdding(false)} employeeId={employeeId} onAdded={() => void load()} />
    </div>
  );
}
