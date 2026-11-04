import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../../theme';
import { supabase } from '../../../lib/supabase';
import { WebView } from 'react-native-webview';
import { useState } from 'react';

export interface EventFile {
  id: string;
  name: string;
  original_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  document_type: string | null;
  folder_id: string | null;
  folder?: { name: string } | null;
  /** Ścieżka folderu („Dokumenty / Agenda”) z folderów widocznych dla osoby. */
  folder_path?: string | null;
  created_at: string;
  uploaded_by_employee: { name: string; surname: string } | null;
}

export type EventFolderRow = { id: string; name: string | null; parent_folder_id: string | null };

/**
 * Ścieżki folderów plików. Baza zwraca tylko foldery w zakresie osoby (foldery dokumentacji — oferty, umowy,
 * faktury, kalkulacje — tylko obszarowi handlowemu), więc folder nadrzędny może nie przyjść albo już nie istnieć:
 * ścieżka kończy się wtedy na ostatnim widocznym folderze, a plik bez widocznego folderu trafia do „Pozostałe”.
 * Aplikacja nie tworzy folderów — foldery systemowe zakłada CRM i baza.
 */
export function withEventFolderPaths(files: EventFile[], folders: EventFolderRow[]): EventFile[] {
  const byId = new Map<string, EventFolderRow>();
  for (const folder of folders) if (folder?.id) byId.set(folder.id, folder);
  const cache = new Map<string, string | null>();
  const pathOf = (folderId: string): string | null => {
    if (cache.has(folderId)) return cache.get(folderId) ?? null;
    const names: string[] = [];
    const seen = new Set<string>();
    let current: string | null = folderId;
    // Ochrona przed pętlą i zbyt głębokim drzewem (jak w bazie: 20 poziomów).
    while (current && !seen.has(current) && seen.size < 20) {
      seen.add(current);
      const folder = byId.get(current);
      if (!folder) break;
      const name = folder.name?.trim();
      if (name) names.unshift(name);
      current = folder.parent_folder_id;
    }
    const path = names.length ? names.join(' / ') : null;
    cache.set(folderId, path);
    return path;
  };
  return files.map((file) => ({
    ...file,
    folder_path: file.folder_id ? pathOf(file.folder_id) ?? file.folder?.name?.trim() ?? null : null,
  }));
}

/** Nazwa grupy pliku albo null (plik bez folderu lub folder poza zakresem osoby — grupa „Pozostałe”). */
function folderLabel(file: EventFile): string | null {
  if (!file.folder_id) return null;
  const label = file.folder_path?.trim() || file.folder?.name?.trim();
  return label || null;
}

export function FilesTab({ files }: { files: EventFile[] }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>('');

  if (files.length === 0) {
    return (
      <View style={styles.emptyTab}>
        <Feather name="file" size={40} color={colors.text.tertiary} />
        <Text style={styles.emptyTabText}>Brak plików</Text>
      </View>
    );
  }

  const getFileIcon = (type: string | null): string => {
    if (!type) return 'file';
    if (type.includes('pdf')) return 'file-text';
    if (type.includes('image')) return 'image';
    if (type.includes('video')) return 'video';
    if (type.includes('audio')) return 'music';
    if (type.includes('spreadsheet') || type.includes('excel')) return 'grid';
    return 'file';
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '';

    if (bytes < 1024) return `${bytes} B`;

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('pl-PL', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });


  const handleOpenFile = async (file: EventFile) => {
    try {
      const { data, error } = await supabase.storage
        .from('event-files')
        .createSignedUrl(file.file_path, 3600);

      if (error || !data?.signedUrl) {
        throw new Error();
      }

      setPreviewTitle(getDisplayFileName(file));
      setPreviewUrl(data.signedUrl);

    } catch {
      Alert.alert(
        'Błąd',
        'Nie udało się otworzyć pliku'
      );
    }
  };


  const getDisplayFileName = (file: EventFile): string => {
    if (file.name) return file.name;

    if (file.original_name) return file.original_name;

    if (file.file_path) {
      const parts = file.file_path.split('/');
      return decodeURIComponent(parts[parts.length - 1]);
    }

    return 'Plik bez nazwy';
  };


  const renderFileRow = (file: EventFile) => (
    <TouchableOpacity
      key={file.id}
      style={styles.fileRow}
      onPress={() => handleOpenFile(file)}
      activeOpacity={0.7}
    >

      <View style={styles.fileIconBg}>
        <Feather
          name={getFileIcon(file.mime_type) as any}
          size={16}
          color={colors.primary.gold}
        />
      </View>


      <View style={styles.fileInfo}>
        <Text
          style={styles.fileName}
          numberOfLines={2}
        >
          {getDisplayFileName(file)}
        </Text>


        <View style={styles.fileMetaRow}>

          {file.file_size && (
            <Text style={styles.fileMeta}>
              {formatFileSize(file.file_size)}
            </Text>
          )}

          <Text style={styles.fileMeta}>
            {formatDate(file.created_at)}
          </Text>


          {file.uploaded_by_employee && (
            <Text style={styles.fileMeta}>
              {file.uploaded_by_employee.name}{' '}
              {file.uploaded_by_employee.surname}
            </Text>
          )}

        </View>
      </View>


      <Feather
        name="eye"
        size={16}
        color={colors.text.tertiary}
      />

    </TouchableOpacity>
  );


  // Grupy według ścieżki folderu; pliki bez folderu i z folderem, którego osoba nie widzi — w „Pozostałe”.
  const folderNames = [
    ...new Set(
      files
        .map(folderLabel)
        .filter((label): label is string => Boolean(label))
    ),
  ].sort((a, b) => a.localeCompare(b, 'pl-PL'));


  const ungrouped = files.filter(
    (f) => !folderLabel(f)
  );


  return (
    <View style={styles.filesContainer}>


      {folderNames.map((folderName) => (
        <View key={folderName}>

          <View style={styles.folderHeader}>
            <Feather
              name="folder"
              size={14}
              color={colors.primary.gold}
            />

            <Text style={styles.folderName}>
              {folderName}
            </Text>
          </View>


          {files
            .filter(
              (f) => folderLabel(f) === folderName
            )
            .map(renderFileRow)}

        </View>
      ))}



      {ungrouped.length > 0 && (
        <View>

          {folderNames.length > 0 && (
            <View style={styles.folderHeader}>

              <Feather
                name="file"
                size={14}
                color={colors.primary.gold}
              />

              <Text style={styles.folderName}>
                Pozostałe
              </Text>

            </View>
          )}


          {ungrouped.map(renderFileRow)}

        </View>
      )}



      <Modal
        visible={!!previewUrl}
        animationType="slide"
        onRequestClose={() => setPreviewUrl(null)}
      >

        <View style={styles.previewContainer}>


          <View style={styles.previewHeader}>

            <Text
              style={styles.previewTitle}
              numberOfLines={1}
            >
              {previewTitle}
            </Text>


            <TouchableOpacity
              onPress={() => setPreviewUrl(null)}
            >
              <Feather
                name="x"
                size={26}
                color={colors.text.primary}
              />
            </TouchableOpacity>

          </View>



          {previewUrl && (
            <WebView
              source={{
                uri: previewUrl,
              }}
              style={styles.webview}
              startInLoadingState
            />
          )}


        </View>

      </Modal>


    </View>
  );
}


const styles = StyleSheet.create({

  emptyTab:{
    alignItems:'center',
    justifyContent:'center',
    paddingVertical:60,
    gap:12,
  },

  emptyTabText:{
    fontSize:14,
    color:colors.text.tertiary,
  },


  filesContainer:{
    padding:spacing.md,
  },


  fileRow:{
    flexDirection:'row',
    alignItems:'center',
    paddingVertical:10,
    borderBottomWidth:1,
    borderBottomColor:colors.border.default,
    gap:10,
  },


  fileIconBg:{
    width:36,
    height:36,
    borderRadius:8,
    backgroundColor:colors.primary.gold+'15',
    alignItems:'center',
    justifyContent:'center',
  },


  fileInfo:{
    flex:1,
  },


  fileName:{
    fontSize:13,
    fontWeight:'600',
    color:colors.text.primary,
    lineHeight:18,
  },


  fileMetaRow:{
    flexDirection:'row',
    gap:8,
    marginTop:3,
    flexWrap:'wrap',
  },


  fileMeta:{
    fontSize:10,
    color:colors.text.tertiary,
  },


  folderHeader:{
    flexDirection:'row',
    alignItems:'center',
    gap:8,
    paddingVertical:8,
    marginTop:8,
  },


  folderName:{
    fontSize:13,
    fontWeight:'700',
    color:colors.primary.gold,
  },


  previewContainer:{
    flex:1,
    backgroundColor:colors.background.primary,
  },


  previewHeader:{
    height:60,
    flexDirection:'row',
    alignItems:'center',
    justifyContent:'space-between',
    paddingHorizontal:16,
    backgroundColor:colors.background.secondary,
    borderBottomWidth:1,
    borderBottomColor:colors.border.default,
  },


  previewTitle:{


    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
    flex:1,
    fontSize:14,
    color:colors.text.primary,
    fontWeight:'600',
    marginRight:12,
  },


  webview:{
    flex:1,
  },

});
