import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, glow } from '../../theme';
import { formatInquiryFull } from '../../lib/inquiryFunnel';
import {
  TASK_COLUMNS, TASK_PRIORITIES, createWorkspaceTask, loadWorkspaceTasks, loadWorkspaceTeam, setWorkspaceTeamMember,
  type WorkspaceTasks, type WorkspaceTeam,
} from '../../lib/inquiryWorkspace';
import { SelectField, SmallButton, kit } from './InquiryKit';
import { TaskSheet } from './WorkspaceSheets';

/*
 * Zakładki karty zapytania ładowane osobno (jak na Macu): Zespół (`get_inquiry_team`, `set_inquiry_team_member`) i Zadania
 * (zadania przy zapytaniu, nowe zadanie z przypisaniem pracowników). `run` — czynność z oknem ładowania i komunikatem z ekranu.
 */

type Run = <T>(label: string, action: () => Promise<T>, success?: string) => Promise<T | null>;

/** Zespół zapytania: opiekun prowadzi sprzedaż, współpracownicy pomagają w ustaleniach, zadaniach, ofertach i kalkulacjach. */
export function TeamTab({ inquiryId, run, onChanged }: { inquiryId: string; run: Run; onChanged: () => void }) {
  const [data, setData] = useState<WorkspaceTeam | null>(null);
  const [problem, setProblem] = useState('');
  const [selected, setSelected] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await loadWorkspaceTeam(inquiryId));
      setProblem('');
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Nie udało się pobrać zespołu zapytania.');
    }
  }, [inquiryId]);
  useEffect(() => { void load(); }, [load]);

  const save = async (employeeId: string, active: boolean) => {
    if (!employeeId) return;
    const reply = await run('Zapisuję zespół…', () => setWorkspaceTeamMember(inquiryId, employeeId, active),
      active ? 'Pracownik dołączył do zespołu' : 'Usunięto pracownika z zespołu');
    if (reply) { setData(reply); setSelected(''); onChanged(); }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Zespół zapytania</Text>
      <Text style={kit.muted}>Opiekun prowadzi sprzedaż. Współpracownicy pomagają w ustaleniach, zadaniach, ofertach i kalkulacjach tego zapytania.</Text>
      <Text style={kit.muted}>Dostęp do skrzynek pocztowych pozostaje zgodny z indywidualnymi uprawnieniami.</Text>
      {problem ? (
        <View style={kit.between}><Text style={kit.warningText}>{problem}</Text><SmallButton label="Spróbuj ponownie" icon="refresh-cw" onPress={() => void load()} /></View>
      ) : null}
      {data ? (
        <>
          <View style={styles.person}>
            <Feather name="user-check" size={18} color={colors.primary.gold} />
            <Text style={[kit.text, kit.flex]}>{data.owner?.name || 'Brak opiekuna'}</Text>
            <Text style={[kit.muted, { color: colors.primary.gold }]}>Opiekun</Text>
          </View>
          {data.members.map((person) => (
            <View key={person.id} style={styles.person}>
              <Feather name="user" size={18} color={colors.text.tertiary} />
              <View style={kit.flex}>
                <Text style={kit.text}>{person.name}</Text>
                <Text style={kit.muted}>{person.active === false ? 'Konto nieaktywne' : 'Współpracownik'}</Text>
              </View>
              {data.canManageTeam ? <SmallButton label="Usuń" icon="x" danger onPress={() => void save(person.id, false)} /> : null}
            </View>
          ))}
          {!data.members.length ? <Text style={kit.muted}>Nie dodano jeszcze współpracowników.</Text> : null}
          {data.canManageTeam ? (
            <View style={styles.add}>
              <Text style={[kit.text, { fontWeight: typography.fontWeights.semibold }]}>Dodaj pracownika do zespołu</Text>
              {!data.owner ? <Text style={kit.muted}>Najpierw przypisz opiekuna zapytania.</Text> : (
                <>
                  <SelectField value={selected} onChange={setSelected} placeholder="Wybierz pracownika"
                    options={data.candidates.map((person) => ({ id: person.id, label: person.name }))} emptyText="Brak pracowników do dodania." />
                  <View style={kit.row}>
                    <SmallButton label="Dodaj do zespołu" icon="user-plus" primary disabled={!selected} onPress={() => void save(selected, true)} />
                  </View>
                  <Text style={kit.muted}>Lista obejmuje aktywnych pracowników z kontem i dostępem do zapytań. Opiekun i osoby już dodane nie są ponownie wyświetlane.</Text>
                </>
              )}
            </View>
          ) : null}
        </>
      ) : !problem ? <ActivityIndicator color={colors.primary.gold} /> : null}
    </View>
  );
}

/** Zadania zespołu przy zapytaniu — przypomnienia, ustalenia, przygotowanie oferty. Dotknięcie otwiera zadanie. */
export function TasksTab({ inquiryId, run, creating, setCreating, onOpenTask }: {
  inquiryId: string; run: Run; creating: boolean; setCreating: (value: boolean) => void; onOpenTask: (taskId: string) => void;
}) {
  const [data, setData] = useState<WorkspaceTasks | null>(null);
  const [problem, setProblem] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await loadWorkspaceTasks(inquiryId));
      setProblem('');
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Nie udało się pobrać zadań zapytania.');
    }
  }, [inquiryId]);
  useEffect(() => { void load(); }, [load]);

  const now = Date.now();
  return (
    <View style={kit.gapSm}>
      <View style={kit.between}>
        <Text style={[kit.muted, kit.flex]}>Zadania zespołu przy tym zapytaniu — przypomnienia, ustalenia, przygotowanie oferty.</Text>
        {data?.canManage ? <SmallButton label="Nowe zadanie" icon="plus" primary onPress={() => setCreating(true)} /> : null}
      </View>
      {problem ? (
        <View style={kit.between}><Text style={kit.warningText}>{problem}</Text><SmallButton label="Spróbuj ponownie" icon="refresh-cw" onPress={() => void load()} /></View>
      ) : null}
      {data ? (data.tasks.length ? data.tasks.map((task) => {
        const done = task.column === 'completed';
        const due = task.dueDate ? Date.parse(task.dueDate) : NaN;
        const late = !done && !Number.isNaN(due) && due < now;
        return (
          <TouchableOpacity key={task.id} onPress={() => onOpenTask(task.id)} style={styles.task} accessibilityRole="button" accessibilityLabel={task.title}>
            <Feather name={done ? 'check-circle' : 'circle'} size={20} color={done ? colors.status.success : colors.text.tertiary} />
            <View style={kit.flex}>
              <Text style={[kit.text, { fontWeight: typography.fontWeights.medium }, done && styles.done]} numberOfLines={2}>{task.title}</Text>
              <Text style={kit.muted} numberOfLines={2}>
                {[
                  TASK_COLUMNS.find((item) => item.id === task.column)?.label || task.column,
                  `Priorytet: ${TASK_PRIORITIES.find((item) => item.id === task.priority)?.label || task.priority}`,
                  task.assignees.join(', '),
                ].filter(Boolean).join(' · ')}
              </Text>
              {task.dueDate ? <Text style={[kit.muted, late && { color: '#fca5a5' }]}>Termin: {formatInquiryFull(task.dueDate)}</Text> : null}
            </View>
            <Feather name="chevron-right" size={18} color={colors.text.tertiary} />
          </TouchableOpacity>
        );
      }) : <Text style={kit.muted}>Brak zadań dla tego zapytania.</Text>) : !problem ? <ActivityIndicator color={colors.primary.gold} /> : null}
      <TaskSheet visible={creating} employees={data?.employees || []} onClose={() => setCreating(false)}
        onSave={async (task) => {
          const reply = await run('Zapisuję zadanie…', () => createWorkspaceTask(inquiryId, task), 'Zadanie zostało utworzone');
          if (reply) void load();
          return Boolean(reply);
        }} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: glow(0.1), backgroundColor: glow(0.03) },
  cardTitle: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold },
  person: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: borderRadius.lg, backgroundColor: glow(0.04),
  },
  add: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: glow(0.08) },
  task: {
    minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg,
    backgroundColor: glow(0.04), borderWidth: 1, borderColor: glow(0.06),
  },
  done: { textDecorationLine: 'line-through', color: colors.text.tertiary },
});
