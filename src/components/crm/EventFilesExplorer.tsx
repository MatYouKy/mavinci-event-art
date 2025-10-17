'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Folder, File, Upload, FolderPlus, Grid3x3, List, Image as ImageIcon, Download, Trash2, CreditCard as Edit2, Copy, Move, ChevronRight, ChevronDown, MoreVertical, X, FileText, FileVideo, FileAudio, Archive, ExternalLink, Eye } from 'lucide-react';

interface FileItem {
  id: string;
  name: string;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  thumbnail_url?: string;
  uploaded_by: string;
  created_at: string;
}

interface FolderItem {
  id: string;
  name: string;
  path: string;
  parent_folder_id: string | null;
  created_by: string;
  created_at: string;
  children?: FolderItem[];
}

type ViewMode = 'list' | 'grid' | 'thumbnails';
type SortBy = 'name' | 'date' | 'size' | 'type';

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  item: FileItem | FolderItem | null;
  type: 'file' | 'folder' | null;
}

export default function EventFilesExplorer({ eventId }: { eventId: string }) {
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<FolderItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    item: null,
    type: null
  });
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [renameItem, setRenameItem] = useState<{ id: string; type: 'file' | 'folder' } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [fileUrl, setFileUrl] = useState<string>('');

  useEffect(() => {
    fetchFolders();
    fetchFiles();
  }, [eventId, currentFolder]);

  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu({ isOpen: false, x: 0, y: 0, item: null, type: null });
    };

    if (contextMenu.isOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu.isOpen]);

  const fetchFolders = async () => {
    const { data, error } = await supabase
      .from('event_folders')
      .select('*')
      .eq('event_id', eventId)
      .order('name');

    if (!error && data) {
      setFolders(buildFolderTree(data));
      updateBreadcrumbs(data);
    }
  };

  const fetchFiles = async () => {
    const query = supabase
      .from('event_files')
      .select('*')
      .eq('event_id', eventId);

    if (currentFolder) {
      query.eq('folder_id', currentFolder);
    } else {
      query.is('folder_id', null);
    }

    const { data, error } = await query.order('name');

    if (!error && data) {
      setFiles(data);
    }
  };

  const buildFolderTree = (flatFolders: any[]): FolderItem[] => {
    const folderMap = new Map<string, FolderItem>();
    const rootFolders: FolderItem[] = [];

    flatFolders.forEach(folder => {
      folderMap.set(folder.id, { ...folder, children: [] });
    });

    folderMap.forEach(folder => {
      if (folder.parent_folder_id === null) {
        rootFolders.push(folder);
      } else {
        const parent = folderMap.get(folder.parent_folder_id);
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(folder);
        }
      }
    });

    return rootFolders;
  };

  const updateBreadcrumbs = (allFolders: any[]) => {
    if (!currentFolder) {
      setBreadcrumbs([]);
      return;
    }

    const crumbs: FolderItem[] = [];
    let folderId: string | null = currentFolder;

    while (folderId) {
      const folder = allFolders.find(f => f.id === folderId);
      if (folder) {
        crumbs.unshift(folder);
        folderId = folder.parent_folder_id;
      } else {
        break;
      }
    }

    setBreadcrumbs(crumbs);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;

    const { error } = await supabase
      .from('event_folders')
      .insert([{
        event_id: eventId,
        parent_folder_id: currentFolder,
        name: newFolderName.trim(),
        created_by: session.user.id
      }]);

    if (!error) {
      setShowNewFolderModal(false);
      setNewFolderName('');
      fetchFolders();
    } else {
      alert('Błąd podczas tworzenia folderu');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    setUploading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      setUploading(false);
      return;
    }

    for (const file of Array.from(uploadedFiles)) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${eventId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('event-files')
        .upload(fileName, file);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        continue;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('event-files')
        .getPublicUrl(fileName);

      await supabase
        .from('event_files')
        .insert([{
          event_id: eventId,
          folder_id: currentFolder,
          name: file.name,
          original_name: file.name,
          file_path: fileName,
          file_size: file.size,
          mime_type: file.type,
          thumbnail_url: file.type.startsWith('image/') ? publicUrl : null,
          uploaded_by: session.user.id
        }]);
    }

    setUploading(false);
    fetchFiles();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRename = async () => {
    if (!renameItem || !renameValue.trim()) return;

    if (renameItem.type === 'folder') {
      const { error } = await supabase
        .from('event_folders')
        .update({ name: renameValue.trim() })
        .eq('id', renameItem.id);

      if (!error) {
        fetchFolders();
      }
    } else {
      const { error } = await supabase
        .from('event_files')
        .update({ name: renameValue.trim() })
        .eq('id', renameItem.id);

      if (!error) {
        fetchFiles();
      }
    }

    setShowRenameModal(false);
    setRenameValue('');
    setRenameItem(null);
  };

  const handleDelete = async (id: string, type: 'file' | 'folder') => {
    if (!confirm(`Czy na pewno chcesz usunąć ten ${type === 'folder' ? 'folder' : 'plik'}?`)) return;

    if (type === 'folder') {
      const { error } = await supabase
        .from('event_folders')
        .delete()
        .eq('id', id);

      if (!error) {
        fetchFolders();
      }
    } else {
      const file = files.find(f => f.id === id);
      if (file) {
        await supabase.storage
          .from('event-files')
          .remove([file.file_path]);

        const { error } = await supabase
          .from('event_files')
          .delete()
          .eq('id', id);

        if (!error) {
          fetchFiles();
        }
      }
    }
  };

  const handlePreview = async (file: FileItem) => {
    // Dla PDF i innych typów używamy signed URL z odpowiednimi nagłówkami
    if (file.mime_type === 'application/pdf' ||
        file.mime_type.startsWith('video/') ||
        file.mime_type.startsWith('audio/')) {
      const { data, error } = await supabase.storage
        .from('event-files')
        .createSignedUrl(file.file_path, 3600); // 1 godzina ważności

      if (data) {
        setFileUrl(data.signedUrl);
        setPreviewFile(file);
      } else {
        console.error('Error creating signed URL:', error);
        // Fallback do public URL
        const { data: { publicUrl } } = supabase.storage
          .from('event-files')
          .getPublicUrl(file.file_path);
        setFileUrl(publicUrl);
        setPreviewFile(file);
      }
    } else {
      // Dla obrazków używamy public URL
      const { data: { publicUrl } } = supabase.storage
        .from('event-files')
        .getPublicUrl(file.file_path);
      setFileUrl(publicUrl);
      setPreviewFile(file);
    }
  };

  const handleDownload = async (file: FileItem) => {
    const { data } = await supabase.storage
      .from('event-files')
      .download(file.file_path);

    if (data) {
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.original_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, item: FileItem | FolderItem, type: 'file' | 'folder') => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      item,
      type
    });
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0) return;

    setUploading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      setUploading(false);
      return;
    }

    for (const file of droppedFiles) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${eventId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('event-files')
        .upload(fileName, file);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        continue;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('event-files')
        .getPublicUrl(fileName);

      await supabase
        .from('event_files')
        .insert([{
          event_id: eventId,
          folder_id: currentFolder,
          name: file.name,
          original_name: file.name,
          file_path: fileName,
          file_size: file.size,
          mime_type: file.type,
          thumbnail_url: file.type.startsWith('image/') ? publicUrl : null,
          uploaded_by: session.user.id
        }]);
    }

    setUploading(false);
    fetchFiles();
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return <ImageIcon className="w-5 h-5" />;
    if (mimeType.startsWith('video/')) return <FileVideo className="w-5 h-5" />;
    if (mimeType.startsWith('audio/')) return <FileAudio className="w-5 h-5" />;
    if (mimeType.includes('zip') || mimeType.includes('rar')) return <Archive className="w-5 h-5" />;
    return <FileText className="w-5 h-5" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const sortedFiles = [...files].sort((a, b) => {
    switch (sortBy) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'date':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case 'size':
        return b.file_size - a.file_size;
      case 'type':
        return a.mime_type.localeCompare(b.mime_type);
      default:
        return 0;
    }
  });

  const renderFolderTree = (foldersList: FolderItem[], level = 0) => {
    return foldersList.map(folder => (
      <div key={folder.id} style={{ marginLeft: `${level * 16}px` }}>
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-[#d3bb73]/10 transition-colors ${
            currentFolder === folder.id ? 'bg-[#d3bb73]/20' : ''
          }`}
          onClick={() => setCurrentFolder(folder.id)}
          onContextMenu={(e) => handleContextMenu(e, folder, 'folder')}
        >
          {folder.children && folder.children.length > 0 ? (
            <ChevronDown className="w-4 h-4 text-[#e5e4e2]/60" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[#e5e4e2]/60" />
          )}
          <Folder className="w-4 h-4 text-[#d3bb73]" />
          <span className="text-sm text-[#e5e4e2]">{folder.name}</span>
        </div>
        {folder.children && folder.children.length > 0 && renderFolderTree(folder.children, level + 1)}
      </div>
    ));
  };

  return (
    <div className="flex h-[600px] bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl overflow-hidden">
      <div className="w-64 border-r border-[#d3bb73]/10 p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-[#e5e4e2]">Foldery</h3>
          <button
            onClick={() => setShowNewFolderModal(true)}
            className="p-1 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        </div>

        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-[#d3bb73]/10 transition-colors mb-2 ${
            currentFolder === null ? 'bg-[#d3bb73]/20' : ''
          }`}
          onClick={() => setCurrentFolder(null)}
        >
          <Folder className="w-4 h-4 text-[#d3bb73]" />
          <span className="text-sm text-[#e5e4e2]">Główny folder</span>
        </div>

        {renderFolderTree(folders)}
      </div>

      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-[#d3bb73]/10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentFolder(null)}
              className="text-sm text-[#d3bb73] hover:underline"
            >
              Główny
            </button>
            {breadcrumbs.map((crumb, idx) => (
              <div key={crumb.id} className="flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-[#e5e4e2]/40" />
                <button
                  onClick={() => setCurrentFolder(crumb.id)}
                  className="text-sm text-[#d3bb73] hover:underline"
                >
                  {crumb.name}
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-1 text-sm text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="name">Nazwa</option>
              <option value="date">Data</option>
              <option value="size">Rozmiar</option>
              <option value="type">Typ</option>
            </select>

            <div className="flex items-center gap-1 border border-[#d3bb73]/20 rounded-lg p-1">
              <button
                onClick={() => setViewMode('list')}
                className={`p-1 rounded transition-colors ${
                  viewMode === 'list' ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10'
                }`}
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1 rounded transition-colors ${
                  viewMode === 'grid' ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10'
                }`}
              >
                <Grid3x3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('thumbnails')}
                className={`p-1 rounded transition-colors ${
                  viewMode === 'thumbnails' ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10'
                }`}
              >
                <ImageIcon className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        </div>

        <div
          className="flex-1 p-4 overflow-y-auto"
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
        >
          {dragOver && (
            <div className="absolute inset-0 bg-[#d3bb73]/10 border-2 border-dashed border-[#d3bb73] rounded-lg flex items-center justify-center z-10">
              <div className="text-center">
                <Upload className="w-12 h-12 text-[#d3bb73] mx-auto mb-2" />
                <p className="text-[#e5e4e2]">Upuść pliki tutaj</p>
              </div>
            </div>
          )}

          {sortedFiles.length === 0 ? (
            <div className="text-center py-12">
              <File className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
              <p className="text-[#e5e4e2]/60">Brak plików w tym folderze</p>
              <p className="text-sm text-[#e5e4e2]/40 mt-2">
                Przeciągnij i upuść pliki lub kliknij Upload
              </p>
            </div>
          ) : viewMode === 'list' ? (
            <div className="space-y-1">
              {sortedFiles.map(file => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-[#d3bb73]/5 cursor-pointer group"
                  onContextMenu={(e) => handleContextMenu(e, file, 'file')}
                >
                  <div className="text-[#d3bb73]">
                    {getFileIcon(file.mime_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#e5e4e2] truncate">{file.name}</p>
                    <p className="text-xs text-[#e5e4e2]/40">
                      {formatFileSize(file.file_size)} • {new Date(file.created_at).toLocaleDateString('pl-PL')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePreview(file);
                      }}
                      className="p-1 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded"
                      title="Podgląd"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDownload(file)}
                      className="p-1 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded"
                      title="Pobierz"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setRenameItem({ id: file.id, type: 'file' });
                        setRenameValue(file.name);
                        setShowRenameModal(true);
                      }}
                      className="p-1 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(file.id, 'file')}
                      className="p-1 text-red-400 hover:bg-red-400/10 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-4 gap-4">
              {sortedFiles.map(file => (
                <div
                  key={file.id}
                  className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4 hover:border-[#d3bb73]/30 cursor-pointer group"
                  onContextMenu={(e) => handleContextMenu(e, file, 'file')}
                  onClick={() => handlePreview(file)}
                >
                  <div className="text-[#d3bb73] mb-3">
                    {getFileIcon(file.mime_type)}
                  </div>
                  <p className="text-sm text-[#e5e4e2] truncate mb-1">{file.name}</p>
                  <p className="text-xs text-[#e5e4e2]/40">{formatFileSize(file.file_size)}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-4">
              {sortedFiles.map(file => (
                <div
                  key={file.id}
                  className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg overflow-hidden hover:border-[#d3bb73]/30 cursor-pointer group"
                  onContextMenu={(e) => handleContextMenu(e, file, 'file')}
                  onClick={() => handlePreview(file)}
                >
                  {file.thumbnail_url ? (
                    <img
                      src={file.thumbnail_url}
                      alt={file.name}
                      className="w-full h-32 object-cover"
                    />
                  ) : (
                    <div className="w-full h-32 bg-[#1c1f33] flex items-center justify-center">
                      <div className="text-[#d3bb73]">
                        {getFileIcon(file.mime_type)}
                      </div>
                    </div>
                  )}
                  <div className="p-2">
                    <p className="text-xs text-[#e5e4e2] truncate">{file.name}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {contextMenu.isOpen && (
        <div
          className="fixed bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg shadow-lg py-2 z-50"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.type === 'file' && contextMenu.item && (
            <>
              <button
                onClick={() => {
                  handlePreview(contextMenu.item as FileItem);
                  setContextMenu({ ...contextMenu, isOpen: false });
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10"
              >
                <Eye className="w-4 h-4" />
                Podgląd
              </button>
              <button
                onClick={() => {
                  handleDownload(contextMenu.item as FileItem);
                  setContextMenu({ ...contextMenu, isOpen: false });
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10"
              >
                <Download className="w-4 h-4" />
                Pobierz
              </button>
              <button
                onClick={() => {
                  setRenameItem({ id: contextMenu.item!.id, type: 'file' });
                  setRenameValue((contextMenu.item as FileItem).name);
                  setShowRenameModal(true);
                  setContextMenu({ ...contextMenu, isOpen: false });
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10"
              >
                <Edit2 className="w-4 h-4" />
                Zmień nazwę
              </button>
              <button
                onClick={() => {
                  handleDelete(contextMenu.item!.id, 'file');
                  setContextMenu({ ...contextMenu, isOpen: false });
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-400/10"
              >
                <Trash2 className="w-4 h-4" />
                Usuń
              </button>
            </>
          )}
          {contextMenu.type === 'folder' && contextMenu.item && (
            <>
              <button
                onClick={() => {
                  setRenameItem({ id: contextMenu.item!.id, type: 'folder' });
                  setRenameValue((contextMenu.item as FolderItem).name);
                  setShowRenameModal(true);
                  setContextMenu({ ...contextMenu, isOpen: false });
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10"
              >
                <Edit2 className="w-4 h-4" />
                Zmień nazwę
              </button>
              <button
                onClick={() => {
                  handleDelete(contextMenu.item!.id, 'folder');
                  setContextMenu({ ...contextMenu, isOpen: false });
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-400/10"
              >
                <Trash2 className="w-4 h-4" />
                Usuń
              </button>
            </>
          )}
        </div>
      )}

      {showNewFolderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-light text-[#e5e4e2]">Nowy folder</h3>
              <button
                onClick={() => {
                  setShowNewFolderModal(false);
                  setNewFolderName('');
                }}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Nazwa folderu"
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] mb-4 focus:outline-none focus:border-[#d3bb73]"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowNewFolderModal(false);
                  setNewFolderName('');
                }}
                className="px-4 py-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                Anuluj
              </button>
              <button
                onClick={handleCreateFolder}
                className="bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90"
              >
                Utwórz
              </button>
            </div>
          </div>
        </div>
      )}

      {showRenameModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-light text-[#e5e4e2]">Zmień nazwę</h3>
              <button
                onClick={() => {
                  setShowRenameModal(false);
                  setRenameValue('');
                  setRenameItem(null);
                }}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Nowa nazwa"
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] mb-4 focus:outline-none focus:border-[#d3bb73]"
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowRenameModal(false);
                  setRenameValue('');
                  setRenameItem(null);
                }}
                className="px-4 py-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                Anuluj
              </button>
              <button
                onClick={handleRename}
                className="bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90"
              >
                Zapisz
              </button>
            </div>
          </div>
        </div>
      )}

      {previewFile && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-[#d3bb73]/10">
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-light text-[#e5e4e2] truncate">{previewFile.name}</h3>
                <p className="text-sm text-[#e5e4e2]/60">
                  {formatFileSize(previewFile.file_size)} • {new Date(previewFile.created_at).toLocaleDateString('pl-PL')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors"
                  title="Otwórz w nowej karcie"
                >
                  <ExternalLink className="w-5 h-5" />
                </a>
                <button
                  onClick={() => handleDownload(previewFile)}
                  className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors"
                  title="Pobierz"
                >
                  <Download className="w-5 h-5" />
                </button>
                <button
                  onClick={() => {
                    setPreviewFile(null);
                    setFileUrl('');
                  }}
                  className="p-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] hover:bg-[#e5e4e2]/10 rounded transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 bg-[#1c1f33]">
              {previewFile.mime_type.startsWith('image/') ? (
                <img
                  src={fileUrl}
                  alt={previewFile.name}
                  className="max-w-full max-h-full mx-auto object-contain"
                />
              ) : previewFile.mime_type.startsWith('video/') ? (
                <video
                  src={fileUrl}
                  controls
                  className="max-w-full max-h-full mx-auto"
                  style={{ maxHeight: '70vh' }}
                >
                  Twoja przeglądarka nie obsługuje odtwarzania wideo.
                </video>
              ) : previewFile.mime_type.startsWith('audio/') ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <FileAudio className="w-16 h-16 text-[#d3bb73] mx-auto mb-4" />
                    <audio
                      src={fileUrl}
                      controls
                      className="mx-auto"
                    >
                      Twoja przeglądarka nie obsługuje odtwarzania audio.
                    </audio>
                  </div>
                </div>
              ) : previewFile.mime_type === 'application/pdf' ? (
                <div className="w-full h-full">
                  <iframe
                    src={`${fileUrl}#toolbar=1&navpanes=1&scrollbar=1`}
                    className="w-full h-full min-h-[600px] rounded-lg"
                    title={previewFile.name}
                  />
                  <div className="mt-4 text-center">
                    <p className="text-sm text-[#e5e4e2]/60 mb-2">
                      Nie widzi PDF?
                    </p>
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Otwórz w nowej karcie
                    </a>
                  </div>
                </div>
              ) : previewFile.mime_type.includes('text/') ||
                 previewFile.mime_type === 'application/json' ||
                 previewFile.mime_type === 'application/xml' ? (
                <iframe
                  src={fileUrl}
                  className="w-full h-full min-h-[600px] rounded-lg bg-white"
                  title={previewFile.name}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="text-[#d3bb73] mb-4">
                    {getFileIcon(previewFile.mime_type)}
                  </div>
                  <p className="text-[#e5e4e2] mb-2">Podgląd niedostępny dla tego typu pliku</p>
                  <p className="text-sm text-[#e5e4e2]/60 mb-4">{previewFile.mime_type}</p>
                  <div className="flex gap-2">
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Otwórz w nowej karcie
                    </a>
                    <button
                      onClick={() => handleDownload(previewFile)}
                      className="flex items-center gap-2 bg-[#d3bb73]/20 text-[#d3bb73] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Pobierz plik
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
