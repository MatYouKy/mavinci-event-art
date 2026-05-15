'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Upload,
  Trash2,
  Loader2,
  FileText,
  Download,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  Pencil,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import ResponsiveActionBar from '../../ResponsiveActionBar';

interface EquipmentFile {
  id: string;
  equipment_id: string;
  file_name: string;
  file_path: string;
  file_url: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string | null;
  created_at: string;
}

interface UploadingItem {
  id: string;
  fileName: string;
  progress: number;
}

interface FilesTabProps {
  equipmentId: string;
  canManage: boolean;
  onCountChange?: (n: number) => void;
}

const splitFileName = (fileName: string) => {
  const lastDot = fileName.lastIndexOf('.');

  if (lastDot <= 0) {
    return {
      name: fileName,
      extension: '',
    };
  }

  return {
    name: fileName.slice(0, lastDot),
    extension: fileName.slice(lastDot),
  };
};

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const fileIconFor = (mime: string) => {
  if (mime.startsWith('image/')) return FileImage;
  if (mime.includes('pdf')) return FileText;
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv'))
    return FileSpreadsheet;
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('compressed'))
    return FileArchive;
  return FileIcon;
};

export function FilesTab({ equipmentId, canManage, onCountChange }: FilesTabProps) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { currentEmployee } = useCurrentEmployee();

  const [files, setFiles] = useState<EquipmentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<UploadingItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const [renameFile, setRenameFile] = useState<EquipmentFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameExtension, setRenameExtension] = useState('');
  const [renaming, setRenaming] = useState(false);

  const fetchFiles = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('equipment_files')
        .select('*')
        .eq('equipment_id', equipmentId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setFiles(data || []);
      onCountChange?.(data?.length || 0);
    } catch (e: any) {
      console.error('Error fetching files:', e);
      showSnackbar('Błąd ładowania plików', 'error');
    } finally {
      setLoading(false);
    }
  }, [equipmentId, onCountChange, showSnackbar]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const uploadFiles = async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;

    for (const file of arr) {
      if (file.size > 50 * 1024 * 1024) {
        showSnackbar(`${file.name} przekracza 50MB`, 'error');
        continue;
      }

      const tempId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
      setUploading((prev) => [...prev, { id: tempId, fileName: file.name, progress: 10 }]);

      try {
        const ext = file.name.split('.').pop() || 'bin';
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${equipmentId}/${Date.now()}-${Math.random()
          .toString(36)
          .substring(7)}-${safeName}`;

        setUploading((prev) => prev.map((u) => (u.id === tempId ? { ...u, progress: 40 } : u)));

        const { error: upErr } = await supabase.storage
          .from('equipment-files')
          .upload(path, file, { contentType: file.type || undefined });

        if (upErr) throw upErr;

        const {
          data: { publicUrl },
        } = supabase.storage.from('equipment-files').getPublicUrl(path);

        setUploading((prev) => prev.map((u) => (u.id === tempId ? { ...u, progress: 80 } : u)));

        const { error: dbErr } = await supabase.from('equipment_files').insert({
          equipment_id: equipmentId,
          file_name: file.name,
          file_path: path,
          file_url: publicUrl,
          file_size: file.size,
          mime_type: file.type || `application/${ext}`,
          uploaded_by: currentEmployee?.id ?? null,
        });

        if (dbErr) throw dbErr;

        setUploading((prev) => prev.map((u) => (u.id === tempId ? { ...u, progress: 100 } : u)));
        setTimeout(() => setUploading((prev) => prev.filter((u) => u.id !== tempId)), 500);
      } catch (e: any) {
        console.error('Upload error:', e);
        showSnackbar(`Błąd przesyłania ${file.name}`, 'error');
        setUploading((prev) => prev.filter((u) => u.id !== tempId));
      }
    }

    showSnackbar('Pliki przesłane', 'success');
    fetchFiles();
  };

  const handleOpenRename = (file: EquipmentFile) => {
    const split = splitFileName(file.file_name);

    setRenameFile(file);
    setRenameValue(split.name);
    setRenameExtension(split.extension);
  };

  const handleRename = async () => {
    if (!renameFile) return;

    const baseName = renameValue.trim();

    if (!baseName) {
      showSnackbar('Nazwa pliku nie może być pusta', 'error');
      return;
    }

    const nextName = `${baseName}${renameExtension}`;

    if (!nextName) {
      showSnackbar('Nazwa pliku nie może być pusta', 'error');
      return;
    }

    if (nextName === renameFile.file_name) {
      setRenameFile(null);
      setRenameValue('');
      return;
    }

    try {
      setRenaming(true);

      const { error } = await supabase
        .from('equipment_files')
        .update({ file_name: nextName })
        .eq('id', renameFile.id);

      if (error) throw error;

      setFiles((prev) =>
        prev.map((file) => (file.id === renameFile.id ? { ...file, file_name: nextName } : file)),
      );

      showSnackbar('Nazwa pliku została zmieniona', 'success');
      setRenameFile(null);
      setRenameValue('');
    } catch (e: any) {
      console.error('Rename file error:', e);
      showSnackbar('Błąd zmiany nazwy pliku', 'error');
    } finally {
      setRenaming(false);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleDelete = async (file: EquipmentFile) => {
    const ok = await showConfirm(
      `Czy na pewno chcesz usunąć plik "${file.file_name}"?`,
      'Usuń plik',
    );
    if (!ok) return;

    try {
      await supabase.storage.from('equipment-files').remove([file.file_path]);
      const { error } = await supabase.from('equipment_files').delete().eq('id', file.id);
      if (error) throw error;
      showSnackbar('Plik usunięty', 'success');
      fetchFiles();
    } catch (e: any) {
      console.error('Delete file error:', e);
      showSnackbar('Błąd usuwania pliku', 'error');
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter((p) => p + 1);
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter((p) => {
      const n = p - 1;
      if (n === 0) setIsDragging(false);
      return n;
    });
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setDragCounter(0);
    if (!canManage) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[#d3bb73]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[#e5e4e2]">Pliki sprzętu</h2>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90">
            <input
              type="file"
              multiple
              onChange={handleInput}
              disabled={uploading.length > 0}
              className="hidden"
            />
            {uploading.length > 0 ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Przesyłanie...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Dodaj pliki
              </>
            )}
          </label>
        </div>
      )}

      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`relative rounded-lg transition-all ${
          isDragging
            ? 'shadow-[0_0_20px_rgba(211,187,115,0.3)] ring-2 ring-[#d3bb73] ring-offset-2 ring-offset-[#0f1119]'
            : ''
        }`}
      >
        {isDragging && canManage && (
          <>
            <div className="pointer-events-none absolute inset-0 z-10 rounded-lg border-2 border-dashed border-[#d3bb73] bg-[#d3bb73]/5" />
            <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 animate-pulse rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] shadow-xl">
              <div className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                <span className="font-semibold">Upuść pliki tutaj</span>
              </div>
            </div>
          </>
        )}

        {files.length === 0 && uploading.length === 0 ? (
          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
            <FileText className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
            <p className="text-[#e5e4e2]/60">Brak plików</p>
            {canManage && (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-[#e5e4e2]/40">
                  Kliknij &quot;Dodaj pliki&quot; lub przeciągnij pliki tutaj
                </p>
                <div className="flex items-center justify-center gap-2 text-xs text-[#e5e4e2]/30">
                  <Upload className="h-4 w-4" />
                  <span>Obsługuje przeciąganie i upuszczanie</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y divide-[#d3bb73]/10 overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]">
            {files.map((file) => {
              const Icon = fileIconFor(file.mime_type || '');
              return (
                <div
                  key={file.id}
                  className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-[#d3bb73]/5"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#d3bb73]/10">
                    <Icon className="h-5 w-5 text-[#d3bb73]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <a
                      href={file.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-sm font-medium text-[#e5e4e2] hover:text-[#d3bb73]"
                      title={file.file_name}
                    >
                      {file.file_name}
                    </a>
                    <div className="mt-0.5 text-xs text-[#e5e4e2]/40">
                      {formatBytes(file.file_size)} &middot;{' '}
                      {new Date(file.created_at).toLocaleDateString('pl-PL')}
                    </div>
                  </div>
                  <div
                    className="flex items-center justify-end"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <ResponsiveActionBar
                      disabledBackground
                      mobileBreakpoint={2000}
                      actions={[
                        {
                          label: 'Pobierz',
                          onClick: () =>
                            window.open(file.file_url, '_blank', 'noopener,noreferrer'),
                          icon: <Download className="h-4 w-4" />,
                          variant: 'default',
                        },
                        {
                          label: 'Zmień nazwę',
                          onClick: () => handleOpenRename(file),
                          icon: <Pencil className="h-4 w-4" />,
                          variant: 'default',
                          show: canManage,
                        },
                        {
                          label: 'Usuń',
                          onClick: () => handleDelete(file),
                          icon: <Trash2 className="h-4 w-4" />,
                          variant: 'danger',
                          show: canManage,
                        },
                      ]}
                    />
                  </div>
                </div>
              );
            })}

            {uploading.map((u) => (
              <div key={u.id} className="flex items-center gap-4 px-4 py-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#d3bb73]/10">
                  <Loader2 className="h-5 w-5 animate-spin text-[#d3bb73]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-[#e5e4e2]">{u.fileName}</div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#0a0d1a]">
                    <div
                      className="h-full bg-[#d3bb73] transition-all"
                      style={{ width: `${u.progress}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs text-[#e5e4e2]/40">{u.progress}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {renameFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-5">
            <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Zmień nazwę pliku</h3>

            <div className="flex overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#0f1119]">
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') {
                    setRenameFile(null);
                    setRenameValue('');
                    setRenameExtension('');
                  }
                }}
                autoFocus
                disabled={renaming}
                className="flex-1 bg-transparent px-4 py-3 text-[#e5e4e2] focus:outline-none disabled:opacity-50"
              />

              {renameExtension && (
                <div className="flex items-center border-l border-[#d3bb73]/10 bg-[#d3bb73]/5 px-3 text-sm text-[#d3bb73]">
                  {renameExtension}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setRenameFile(null);
                  setRenameValue('');
                  setRenameExtension('');
                }}
                disabled={renaming}
                className="rounded-lg px-4 py-2 text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 disabled:opacity-50"
              >
                Anuluj
              </button>

              <button
                type="button"
                onClick={handleRename}
                disabled={renaming}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                {renaming && <Loader2 className="h-4 w-4 animate-spin" />}
                Zapisz
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
