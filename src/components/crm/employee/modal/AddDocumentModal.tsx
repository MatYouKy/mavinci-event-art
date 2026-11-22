'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { DRIVE_UPLOAD_LIMITS, EMPLOYEE_DOCUMENT_LIMITS, EMPLOYEE_DOCUMENT_TYPES, driveEmployeeDocumentsNode, type EmployeeDocumentType } from '@/lib/drive/driveShared';
import { formatMaterialBytes } from '@/lib/materials/materialsShared';
import { cardClass, errorMessage, ghostButton, inputClass, primaryButton } from '@/components/crm/materials/materialsUi';
import { uploadDriveFile } from '@/components/crm/drive/driveApi';

/*
 * Nowy dokument pracownika (profil → Dokumenty): plik z dysku komputera (do 50 MB) + nazwa, rodzaj, opis i termin ważności.
 * Plik trafia do Dysku → Pracownicy → pracownik → Dokumenty (to samo API co Mac, Finder i telefon — `/bridge/native/v1/drive`).
 */

export function AddDocumentModal({
  isOpen,
  onClose,
  employeeId,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string;
  onAdded: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [documentType, setDocumentType] = useState<EmployeeDocumentType>('other');
  const [description, setDescription] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [saving, setSaving] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isOpen) return;
    setFile(null);
    setName('');
    setDocumentType('other');
    setDescription('');
    setExpiryDate('');
  }, [isOpen]);

  useEffect(() => () => abort.current?.abort(), []);

  if (!isOpen) return null;

  const pick = (picked: File | null) => {
    setFile(picked);
    if (picked && !name.trim()) setName(picked.name.replace(/\.[A-Za-z0-9]{1,8}$/, '').slice(0, EMPLOYEE_DOCUMENT_LIMITS.name));
  };

  const tooLarge = Boolean(file && file.size > DRIVE_UPLOAD_LIMITS.file);

  const submit = async () => {
    if (!file || saving) return;
    if (tooLarge) {
      showSnackbar('Plik przekracza 50 MB — limit dokumentów pracownika.', 'error');
      return;
    }
    setSaving(true);
    const controller = new AbortController();
    abort.current = controller;
    showLoader('Dodaję dokument', file.name);
    try {
      await uploadDriveFile(driveEmployeeDocumentsNode(employeeId), file, () => undefined, controller.signal, {
        title: name.trim(), documentType, description: description.trim(), expiryDate,
      });
      showSnackbar('Dodano dokument.', 'success');
      onAdded();
      onClose();
    } catch (error) {
      showSnackbar(errorMessage(error, 'Nie udało się dodać dokumentu.'), 'error');
    } finally {
      abort.current = null;
      hideLoader();
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="add-document-title">
      <div className={`${cardClass} w-full max-w-lg space-y-4 p-6 text-[#e5e4e2]`}>
        <div className="flex items-center gap-2">
          <h2 id="add-document-title" className="flex-1 text-xl font-light">Dodaj dokument</h2>
          <button type="button" className={ghostButton} onClick={onClose} aria-label="Zamknij" disabled={saving}><X className="h-4 w-4" /></button>
        </div>

        <label className="block space-y-1.5 text-sm">
          <span className="text-[#e5e4e2]/60">Plik *</span>
          <input type="file" className={`${inputClass} w-full file:mr-3 file:rounded-md file:border-0 file:bg-[#d3bb73]/15 file:px-3 file:py-1 file:text-[#d3bb73]`}
            onChange={(event) => pick(event.target.files?.[0] || null)} disabled={saving} />
          {file && (
            <span className={`block text-xs ${tooLarge ? 'text-red-300' : 'text-[#e5e4e2]/50'}`}>
              {file.name} · {formatMaterialBytes(file.size)}{tooLarge ? ' — przekracza 50 MB' : ''}
            </span>
          )}
        </label>

        <label className="block space-y-1.5 text-sm">
          <span className="text-[#e5e4e2]/60">Nazwa dokumentu</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={EMPLOYEE_DOCUMENT_LIMITS.name} className={`${inputClass} w-full`}
            placeholder="np. Badania okresowe 2026" disabled={saving} />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5 text-sm">
            <span className="text-[#e5e4e2]/60">Rodzaj</span>
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value as EmployeeDocumentType)} className={`${inputClass} w-full`} disabled={saving}>
              {EMPLOYEE_DOCUMENT_TYPES.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="text-[#e5e4e2]/60">Ważny do</span>
            <input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} className={`${inputClass} w-full`} disabled={saving} />
          </label>
        </div>

        <label className="block space-y-1.5 text-sm">
          <span className="text-[#e5e4e2]/60">Opis</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={EMPLOYEE_DOCUMENT_LIMITS.description}
            className={`${inputClass} min-h-[80px] w-full`} placeholder="Dodatkowe informacje…" disabled={saving} />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={ghostButton} onClick={onClose} disabled={saving}>Anuluj</button>
          <button type="button" className={primaryButton} onClick={() => void submit()} disabled={!file || tooLarge || saving}>
            <Upload className="h-4 w-4" />Dodaj
          </button>
        </div>
      </div>
    </div>
  );
}
