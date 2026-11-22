import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography, ink } from '../../theme';
import { DayField, Label, SelectField, SelectList, Sheet, SheetActions, kit } from '../Inquiries/InquiryKit';
import { TaskFilesField } from './TaskFilesField';
import type { PickedTaskFile } from '../../lib/taskFiles';
import {
  TASK_COLUMNS, TASK_PRIORITIES, newTaskId, saveBoardTask, taskColumnLabel, taskDueDay, taskEmployees, uploadTaskAttachment,
  type BoardTask, type TaskBoardKind, type TaskColumnId, type TaskEmployee, type TaskPriorityId,
} from '../../lib/tasksBoard';

/*
 * Nowe zadanie i edycja — jak formularz w CRM i na Macu: tytuł, opis, załączniki (zdjęcia, zrzuty ekranu, aparat, pliki, obraz
 * ze schowka), priorytet, kolumna, termin wykonania i przypisani pracownicy (tablica firmowa). Najpierw zapis zadania, potem pliki
 * po kolei; plik, który się nie wysłał, zostaje w formularzu — „Wyślij pozostałe pliki” nie tworzy drugiego zadania (zadanie
 * prywatne ma identyfikator nadany raz na formularz).
 */

type Run = <T>(label: string, action: () => Promise<T>, success?: string) => Promise<T | null>;

export type TaskEditTarget = { key: number; task: BoardTask | null; column: TaskColumnId };

export function TaskEditorSheet({ board, target, me, run, notify, onClose, onSaved }: {
  board: TaskBoardKind;
  target: TaskEditTarget;
  me: string | null;
  run: Run;
  notify: (text: string, error?: boolean) => void;
  onClose: (changed: boolean) => void;
  onSaved: (id: string, created: boolean) => void;
}) {
  const editing = target.task;
  const company = board === 'company';
  const [title, setTitle] = useState(editing?.title ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [priority, setPriority] = useState<TaskPriorityId>(editing?.priority ?? 'medium');
  const [column, setColumn] = useState<TaskColumnId>(editing?.boardColumn ?? target.column);
  const [due, setDue] = useState(taskDueDay(editing?.dueDate) ?? '');
  const [assignees, setAssignees] = useState<string[]>(
    editing ? editing.assignees.map((person) => person.id) : company && me ? [me] : [],
  );
  const [files, setFiles] = useState<PickedTaskFile[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [newId] = useState(() => newTaskId());
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<TaskEmployee[]>([]);

  useEffect(() => {
    if (!company) return;
    let alive = true;
    taskEmployees().then((list) => { if (alive) setEmployees(list); }).catch(() => undefined);
    return () => { alive = false; };
  }, [company]);

  const people = useMemo(() => {
    const known = new Map(employees.map((employee) => [employee.id, employee]));
    // Osoby przypisane, których nie ma na liście aktywnych (np. konto wyłączone), zostają widoczne do odznaczenia.
    editing?.assignees.forEach((person) => { if (!known.has(person.id)) known.set(person.id, { id: person.id, name: person.name, nickname: '' }); });
    return [...known.values()]
      .map((employee) => ({ id: employee.id, label: employee.name || 'Pracownik', detail: employee.id === me ? 'Ty' : employee.nickname || undefined }))
      .sort((a, b) => Number(assignees.includes(b.id)) - Number(assignees.includes(a.id)) || a.label.localeCompare(b.label, 'pl'));
  }, [employees, editing, me, assignees]);

  const valid = title.trim().length > 0;
  const locked = Boolean(savedId);

  const save = async () => {
    if (saving) return;
    if (!valid) { notify('Tytuł zadania jest wymagany', true); return; }
    setSaving(true);
    try {
      let id = savedId;
      if (!id) {
        id = await run(editing ? 'Zapisuję zadanie…' : 'Tworzę zadanie…', () => saveBoardTask(board, {
          id: editing ? editing.id : company ? null : newId,
          existing: Boolean(editing),
          title,
          description,
          priority,
          boardColumn: column,
          dueDate: due || null,
          assignees: company ? assignees : null,
        }));
        if (!id) return;
        setSavedId(id);
      }
      let pending = files;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const sent = await run(`Przesyłam załącznik ${index + 1} z ${files.length}…`, async () => { await uploadTaskAttachment(id as string, file); return true; });
        if (!sent) {
          notify(`Zadanie jest zapisane. Nie wysłano pliku „${file.name}” — spróbuj ponownie („Wyślij pozostałe pliki”).`, true);
          return;
        }
        // Wysłane pliki znikają z listy — ponowienie nie wyśle ich drugi raz.
        pending = pending.filter((item) => item.key !== file.key);
        setFiles(pending);
      }
      onSaved(id, !editing);
    } finally {
      setSaving(false);
    }
  };

  const confirmLabel = locked ? 'Wyślij pozostałe pliki' : editing ? 'Zapisz' : 'Utwórz zadanie';

  return (
    <Sheet
      visible
      title={editing ? 'Edytuj zadanie' : 'Nowe zadanie'}
      subtitle={company ? 'Zadania firmowe' : 'Moja tablica zadań'}
      onClose={() => { if (!saving) onClose(locked); }}
      width={640}
      footer={<SheetActions onCancel={() => onClose(locked)} onConfirm={() => void save()} label={confirmLabel} disabled={!valid} saving={saving}
        cancelLabel={locked ? 'Zamknij' : 'Anuluj'} />}
    >
      {locked ? (
        <View style={styles.info}>
          <Feather name="check-circle" size={16} color={colors.status.success} />
          <Text style={[kit.text, kit.flex]}>Zadanie jest zapisane. Wyślij pozostałe pliki albo zamknij okno.</Text>
        </View>
      ) : null}

      <Label>Tytuł</Label>
      <TextInput value={title} onChangeText={setTitle} editable={!locked} placeholder="Co jest do zrobienia?" placeholderTextColor={ink(0.35)}
        style={styles.input} autoFocus={!editing} returnKeyType="next" accessibilityLabel="Tytuł zadania" />

      <Label>Opis</Label>
      <TextInput value={description} onChangeText={setDescription} editable={!locked} placeholder="Szczegóły (opcjonalnie)" placeholderTextColor={ink(0.35)}
        style={[styles.input, styles.multiline]} multiline textAlignVertical="top" accessibilityLabel="Opis zadania" />

      <Label>Załączniki</Label>
      <TaskFilesField files={files} onChange={setFiles} onError={(message) => notify(message, true)} disabled={saving} />

      <Label>Priorytet</Label>
      <SelectField value={priority} disabled={locked} options={TASK_PRIORITIES.map((item) => ({ id: item.id, label: item.label }))}
        onChange={(value) => setPriority(value as TaskPriorityId)} />

      <Label>Kolumna</Label>
      <SelectField value={column} disabled={locked} options={TASK_COLUMNS.map((item) => ({ id: item.id, label: taskColumnLabel(item.id, board) }))}
        onChange={(value) => setColumn(value as TaskColumnId)} />

      <Label>Termin wykonania</Label>
      <View style={kit.row}>
        <View style={kit.flex}>
          <DayField value={due} onChange={(value) => { if (!locked) setDue(value); }} placeholder="Bez terminu" />
        </View>
        {due && !locked ? (
          <TouchableOpacity onPress={() => setDue('')} style={kit.iconButton} accessibilityRole="button" accessibilityLabel="Usuń termin">
            <Feather name="x" size={16} color={colors.text.tertiary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {company ? (
        <>
          <Label>{`Przypisani pracownicy (${assignees.length})`}</Label>
          <SelectList
            options={people}
            selected={assignees}
            multiple
            searchable
            maxHeight={240}
            emptyText={employees.length ? 'Brak pracowników.' : 'Wczytuję pracowników…'}
            onToggle={(id) => { if (!locked) setAssignees((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id])); }}
          />
        </>
      ) : !editing || editing.isPrivate ? (
        <Text style={kit.muted}>Zadanie prywatne — widzisz je tylko Ty (jak „Moja tablica zadań” w CRM).</Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: ink(0.14),
    color: colors.text.primary, fontSize: typography.fontSizes.md, backgroundColor: colors.background.tertiary,
  },
  multiline: { minHeight: 110 },
  info: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: 10, backgroundColor: ink(0.05) },
});
