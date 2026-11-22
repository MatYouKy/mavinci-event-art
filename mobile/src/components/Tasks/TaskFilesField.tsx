import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, glow } from '../../theme';
import { mergeTaskFiles, pickTaskFiles, taskFileSize, type PickedTaskFile, type TaskFileSource } from '../../lib/taskFiles';
import { TASK_ATTACHMENT_MAX_BYTES } from '../../lib/tasksBoard';

/*
 * Załączniki w formularzu zadania (jak w CRM i na Macu): zdjęcia z galerii (także zrzuty ekranu), aparat, pliki i obraz ze schowka.
 * Pliki czekają do zapisu zadania; podgląd miniatur zdjęć, nazwa, rozmiar i usuwanie z listy przed zapisem.
 */

type IconName = React.ComponentProps<typeof Feather>['name'];

const SOURCES: ReadonlyArray<{ id: TaskFileSource; label: string; icon: IconName }> = [
  { id: 'library', label: 'Zdjęcia', icon: 'image' },
  { id: 'camera', label: 'Aparat', icon: 'camera' },
  { id: 'files', label: 'Pliki', icon: 'paperclip' },
  { id: 'clipboard', label: 'Wklej obraz', icon: 'clipboard' },
];

/** Przyciski źródeł plików (także na ekranie szczegółów zadania). */
export function TaskFileSources({ onPick, disabled = false }: { onPick: (source: TaskFileSource) => void; disabled?: boolean }) {
  return (
    <View style={styles.sources}>
      {SOURCES.map((source) => (
        <TouchableOpacity key={source.id} onPress={() => onPick(source.id)} disabled={disabled} style={[styles.source, disabled && styles.disabled]}
          accessibilityRole="button" accessibilityLabel={`Dodaj załącznik: ${source.label}`}>
          <Feather name={source.icon} size={16} color={colors.primary.gold} />
          <Text style={styles.sourceText}>{source.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function TaskFilesField({ files, onChange, onError, disabled = false }: {
  files: PickedTaskFile[]; onChange: (files: PickedTaskFile[]) => void; onError: (message: string) => void; disabled?: boolean;
}) {
  const pick = async (source: TaskFileSource) => {
    try {
      const picked = await pickTaskFiles(source);
      if (!picked.length) return;
      const tooBig = picked.filter((file) => file.size > TASK_ATTACHMENT_MAX_BYTES);
      if (tooBig.length) onError(`Pominięto pliki większe niż 50 MB: ${tooBig.map((file) => file.name).join(', ')}.`);
      onChange(mergeTaskFiles(files, picked.filter((file) => file.size <= TASK_ATTACHMENT_MAX_BYTES)));
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Nie udało się dodać pliku.');
    }
  };

  return (
    <View style={styles.wrap}>
      {files.map((file) => (
        <View key={file.key} style={styles.file}>
          {file.image ? (
            <Image source={{ uri: file.uri }} style={styles.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
          ) : (
            <View style={[styles.thumb, styles.thumbIcon]}><Feather name="file-text" size={20} color={colors.primary.gold} /></View>
          )}
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={1}>{file.name}</Text>
            <Text style={styles.meta}>{taskFileSize(file.size)}</Text>
          </View>
          <TouchableOpacity onPress={() => onChange(files.filter((item) => item.key !== file.key))} disabled={disabled}
            style={styles.remove} accessibilityRole="button" accessibilityLabel={`Usuń załącznik ${file.name}`} hitSlop={8}>
            <Feather name="x" size={18} color={disabled ? colors.text.tertiary : colors.status.error} />
          </TouchableOpacity>
        </View>
      ))}
      <TaskFileSources onPick={(source) => void pick(source)} disabled={disabled} />
      <Text style={styles.hint}>Zdjęcia i zrzuty ekranu, PDF-y, dokumenty i inne pliki (do 50 MB). Możesz wybrać kilka naraz.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  file: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.md,
    backgroundColor: glow(0.04), borderWidth: 1, borderColor: glow(0.08),
  },
  thumb: { width: 44, height: 44, borderRadius: 6, backgroundColor: glow(0.06) },
  thumbIcon: { alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.text.primary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.medium },
  meta: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, marginTop: 2 },
  remove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  sources: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  source: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: spacing.md, borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: glow(0.12), backgroundColor: glow(0.03),
  },
  sourceText: { color: colors.text.primary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.medium },
  disabled: { opacity: 0.45 },
  hint: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
});
