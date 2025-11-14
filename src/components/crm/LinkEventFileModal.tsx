'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Search,
  File,
  Image,
  FileText,
  Film,
  Music,
  Link as LinkIcon,
  Folder,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface EventFile {
  id: string;
  name: string;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  thumbnail_url: string | null;
  folder_id: string | null;
  created_at: string;
  employees: {
    name: string;
    surname: string;
  } | null;
}

interface LinkEventFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  eventId: string;
  onFileLinked: () => void;
}

export default function LinkEventFileModal({
  isOpen,
  onClose,
  taskId,
  eventId,
  onFileLinked,
}: LinkEventFileModalProps) {
  const [files, setFiles] = useState<EventFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    if (isOpen && eventId) {
      fetchEventFiles();
    }
  }, [isOpen, eventId]);

  const fetchEventFiles = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('event_files')
        .select(
          `
          id,
          name,
          original_name,
          file_path,
          file_size,
          mime_type,
          thumbnail_url,
          folder_id,
          created_at,
          employees:uploaded_by (
            name,
            surname
          )
        `,
        )
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setFiles(data || []);
    } catch (error) {
      console.error('Error fetching event files:', error);
      showSnackbar('Błąd podczas ładowania plików wydarzenia', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return <Image className="h-5 w-5" />;
    if (mimeType.startsWith('video/')) return <Film className="h-5 w-5" />;
    if (mimeType.startsWith('audio/')) return <Music className="h-5 w-5" />;
    if (mimeType.includes('pdf') || mimeType.includes('document'))
      return <FileText className="h-5 w-5" />;
    return <File className="h-5 w-5" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const toggleFileSelection = (fileId: string) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(fileId)) {
      newSelected.delete(fileId);
    } else {
      newSelected.add(fileId);
    }
    setSelectedFiles(newSelected);
  };

  const handleLinkFiles = async () => {
    if (selectedFiles.size === 0) return;

    try {
      setLoading(true);

      for (const fileId of Array.from(selectedFiles)) {
        const { error } = await supabase.rpc('link_event_file_to_task', {
          p_task_id: taskId,
          p_event_file_id: fileId,
          p_employee_id: (await supabase.auth.getUser()).data.user?.id,
        });

        if (error) throw error;
      }

      showSnackbar(`Dodano ${selectedFiles.size} plik(ów) do zadania`, 'success');
      onFileLinked();
      onClose();
      setSelectedFiles(new Set());
    } catch (error) {
      console.error('Error linking files:', error);
      showSnackbar('Błąd podczas linkowania plików', 'error');
    } finally {
      setLoading(false);
    }
  };

  const filteredFiles = files.filter((file) =>
    file.original_name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-lg border border-[#d3bb73]/20 bg-[#0f1119]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#d3bb73]/10">
              <LinkIcon className="h-5 w-5 text-[#d3bb73]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#e5e4e2]">Dodaj pliki z wydarzenia</h2>
              <p className="text-sm text-[#e5e4e2]/60">
                Wybierz pliki które chcesz podlinkować do zadania
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-[#d3bb73]/10"
          >
            <X className="h-5 w-5 text-[#e5e4e2]/60" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-[#d3bb73]/10 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Szukaj plików..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1a1d2e] py-2 pl-10 pr-4 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/50 focus:outline-none"
            />
          </div>
          {selectedFiles.size > 0 && (
            <div className="mt-2 text-sm text-[#d3bb73]">
              Wybrano: {selectedFiles.size} {selectedFiles.size === 1 ? 'plik' : 'pliki'}
            </div>
          )}
        </div>

        {/* Files List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#d3bb73] border-t-transparent" />
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-[#e5e4e2]/60">
              <File className="mb-2 h-12 w-12 opacity-40" />
              <p className="text-sm">Brak plików w wydarzeniu</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {filteredFiles.map((file) => (
                <button
                  key={file.id}
                  onClick={() => toggleFileSelection(file.id)}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    selectedFiles.has(file.id)
                      ? 'border-[#d3bb73]/40 bg-[#d3bb73]/10'
                      : 'border-[#d3bb73]/10 bg-[#1a1d2e] hover:border-[#d3bb73]/30'
                  }`}
                >
                  <div
                    className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                      selectedFiles.has(file.id)
                        ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                        : 'bg-[#d3bb73]/10 text-[#e5e4e2]/60'
                    }`}
                  >
                    {getFileIcon(file.mime_type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-[#e5e4e2]">{file.original_name}</div>
                    <div className="text-xs text-[#e5e4e2]/60">
                      {formatFileSize(file.file_size)} •{' '}
                      {new Date(file.created_at).toLocaleDateString('pl-PL')}
                      {file.employees && ` • ${file.employees.name} ${file.employees.surname}`}
                    </div>
                  </div>
                  {selectedFiles.has(file.id) && (
                    <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#d3bb73]">
                      <svg className="h-3 w-3 text-[#0f1119]" viewBox="0 0 12 12">
                        <path
                          fill="currentColor"
                          d="M10 3L4.5 8.5L2 6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/10 p-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            Anuluj
          </button>
          <button
            onClick={handleLinkFiles}
            disabled={selectedFiles.size === 0 || loading}
            className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#0f1119] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Dodawanie...' : `Dodaj (${selectedFiles.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
