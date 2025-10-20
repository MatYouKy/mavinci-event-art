'use client';

import { useState, useEffect } from 'react';
import { X, Search, File, Image, FileText, Film, Music, Link as LinkIcon, Folder } from 'lucide-react';
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
        .select(`
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
        `)
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
    if (mimeType.startsWith('image/')) return <Image className="w-5 h-5" />;
    if (mimeType.startsWith('video/')) return <Film className="w-5 h-5" />;
    if (mimeType.startsWith('audio/')) return <Music className="w-5 h-5" />;
    if (mimeType.includes('pdf') || mimeType.includes('document')) return <FileText className="w-5 h-5" />;
    return <File className="w-5 h-5" />;
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

  const filteredFiles = files.filter(file =>
    file.original_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#d3bb73]/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#d3bb73]/10 flex items-center justify-center">
              <LinkIcon className="w-5 h-5 text-[#d3bb73]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#e5e4e2]">Dodaj pliki z wydarzenia</h2>
              <p className="text-sm text-[#e5e4e2]/60">Wybierz pliki które chcesz podlinkować do zadania</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#e5e4e2]/60" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-[#d3bb73]/10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#e5e4e2]/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Szukaj plików..."
              className="w-full bg-[#1a1d2e] border border-[#d3bb73]/20 rounded-lg pl-10 pr-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/50"
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
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin w-6 h-6 border-2 border-[#d3bb73] border-t-transparent rounded-full" />
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-[#e5e4e2]/60">
              <File className="w-12 h-12 mb-2 opacity-40" />
              <p className="text-sm">Brak plików w wydarzeniu</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {filteredFiles.map((file) => (
                <button
                  key={file.id}
                  onClick={() => toggleFileSelection(file.id)}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                    selectedFiles.has(file.id)
                      ? 'bg-[#d3bb73]/10 border-[#d3bb73]/40'
                      : 'bg-[#1a1d2e] border-[#d3bb73]/10 hover:border-[#d3bb73]/30'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    selectedFiles.has(file.id) ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'bg-[#d3bb73]/10 text-[#e5e4e2]/60'
                  }`}>
                    {getFileIcon(file.mime_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[#e5e4e2] truncate">{file.original_name}</div>
                    <div className="text-xs text-[#e5e4e2]/60">
                      {formatFileSize(file.file_size)} • {new Date(file.created_at).toLocaleDateString('pl-PL')}
                      {file.employees && ` • ${file.employees.name} ${file.employees.surname}`}
                    </div>
                  </div>
                  {selectedFiles.has(file.id) && (
                    <div className="w-5 h-5 rounded-full bg-[#d3bb73] flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-[#0f1119]" viewBox="0 0 12 12">
                        <path fill="currentColor" d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-[#d3bb73]/10">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
          >
            Anuluj
          </button>
          <button
            onClick={handleLinkFiles}
            disabled={selectedFiles.size === 0 || loading}
            className="px-6 py-2 bg-[#d3bb73] hover:bg-[#d3bb73]/90 text-[#0f1119] rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Dodawanie...' : `Dodaj (${selectedFiles.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
