import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import EmployeeAvatar from '../../EmployeeAvatar';
import { colors, spacing } from '../../../theme';
import {
  addEventTeamMember,
  EVENT_TEAM_PERMISSIONS,
  emptyTeamPermissions,
  fetchTeamCandidates,
  saveEventTeamPermissions,
  setEventTeamTransport,
  teamErrorMessage,
  updateEventTeamRole,
  type EventTeamPermissions,
  type ManagedAssignment,
  type TeamCandidate,
  type TeamCandidatePhase,
} from '../../../lib/eventTeamManage';
import { teamTransportVehicleLabel, type TeamTransportLoad } from '../../../lib/teamTransport';

/*
 * Okna zarządzania zespołem eventu (TeamTab): czynności osoby, uprawnienia w evencie, rola i obowiązki, auto na dojazd
 * i „Dodaj osobę do zespołu” — jak w CRM (`TeamMembersList`, `AddEventEmployeeModal`) i na Macu (`EventTeamTab`).
 */

type FeatherIcon = React.ComponentProps<typeof Feather>['name'];

function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  locked,
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  /** Trwa zapis — okna nie da się zamknąć. */
  locked?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !locked && onClose()}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => !locked && onClose()} accessibilityLabel="Zamknij" />
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Zamknij"
              style={styles.closeButton}
              onPress={onClose}
              disabled={locked}
            >
              <Feather name="x" size={22} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FooterButtons({
  saving,
  label,
  onCancel,
  onSubmit,
  disabled,
}: {
  saving: boolean;
  label: string;
  onCancel: () => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  return (
    <>
      <TouchableOpacity style={styles.secondaryButton} onPress={onCancel} disabled={saving}>
        <Text style={styles.secondaryButtonText}>Anuluj</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.primaryButton, (saving || disabled) && styles.buttonDisabled]}
        onPress={onSubmit}
        disabled={saving || disabled}
      >
        {saving ? (
          <ActivityIndicator size="small" color={colors.background.primary} />
        ) : (
          <Text style={styles.primaryButtonText}>{label}</Text>
        )}
      </TouchableOpacity>
    </>
  );
}

function ErrorText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Text accessibilityRole="alert" style={styles.error}>
      {text}
    </Text>
  );
}

function ToggleRow({
  title,
  detail,
  value,
  onChange,
  disabled,
}: {
  title: string;
  detail?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleTitle}>{title}</Text>
        {!!detail && <Text style={styles.toggleDetail}>{detail}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.background.elevated, true: colors.primary.gold }}
        thumbColor={colors.white}
        accessibilityLabel={title}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Czynności osoby
// ---------------------------------------------------------------------------------------------------------------

export type TeamSheetAction = {
  key: string;
  title: string;
  detail?: string;
  icon: FeatherIcon;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export function TeamActionSheet({
  visible,
  title,
  subtitle,
  actions,
  busy,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string | null;
  actions: TeamSheetAction[];
  busy: boolean;
  onClose: () => void;
}) {
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  // Najpierw zamykamy arkusz, potem czynność (iOS nie pokaże kolejnego okna ani alertu w trakcie zamykania poprzedniego).
  const choose = (action: TeamSheetAction) => {
    onClose();
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(action.onPress, Platform.OS === 'ios' ? 450 : 80);
  };

  return (
    <Sheet visible={visible} title={title} subtitle={subtitle} onClose={onClose}>
      {actions.map((action) => (
        <TouchableOpacity
          key={action.key}
          accessibilityRole="button"
          accessibilityState={{ disabled: action.disabled || busy }}
          disabled={action.disabled || busy}
          onPress={() => choose(action)}
          style={[styles.actionRow, (action.disabled || busy) && styles.buttonDisabled]}
        >
          <Feather
            name={action.icon}
            size={18}
            color={action.destructive ? colors.status.error : colors.primary.gold}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.actionTitle, action.destructive && { color: colors.status.error }]}>{action.title}</Text>
            {!!action.detail && <Text style={styles.toggleDetail}>{action.detail}</Text>}
          </View>
          <Feather name="chevron-right" size={16} color={colors.text.tertiary} />
        </TouchableOpacity>
      ))}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Uprawnienia w evencie
// ---------------------------------------------------------------------------------------------------------------

export function TeamPermissionsModal({
  assignment,
  memberName,
  eventId,
  onClose,
  onSaved,
}: {
  assignment: ManagedAssignment | null;
  memberName: string;
  eventId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<EventTeamPermissions>(emptyTeamPermissions());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!assignment) return;
    setForm({ ...assignment.permissions });
    setError('');
  }, [assignment]);

  const save = async () => {
    if (!assignment || saving) return;
    setSaving(true);
    setError('');
    try {
      await saveEventTeamPermissions(eventId, assignment.id, form);
      await onSaved();
    } catch (cause) {
      setError(teamErrorMessage(cause, 'Błąd podczas aktualizacji uprawnień.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={Boolean(assignment)}
      title="Uprawnienia w evencie"
      subtitle={memberName}
      onClose={onClose}
      locked={saving}
      footer={<FooterButtons saving={saving} label="Zapisz" onCancel={onClose} onSubmit={() => void save()} />}
    >
      <Text style={styles.hint}>
        Co ta osoba widzi w evencie, wynika z jej roli w ustawieniach pracownika. Tu nadajesz dodatkowe uprawnienia do edycji w tym
        evencie.
      </Text>
      {EVENT_TEAM_PERMISSIONS.map((item) => (
        <ToggleRow
          key={item.key}
          title={item.title}
          detail={item.detail}
          value={form[item.key]}
          disabled={saving}
          onChange={(value) => setForm((current) => ({ ...current, [item.key]: value }))}
        />
      ))}
      <ErrorText text={error} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Rola i obowiązki
// ---------------------------------------------------------------------------------------------------------------

export function TeamRoleModal({
  assignment,
  memberName,
  eventId,
  onClose,
  onSaved,
}: {
  assignment: ManagedAssignment | null;
  memberName: string;
  eventId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [role, setRole] = useState('');
  const [responsibilities, setResponsibilities] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!assignment) return;
    setRole(assignment.role ?? '');
    setResponsibilities(assignment.responsibilities ?? '');
    setError('');
  }, [assignment]);

  const save = async () => {
    if (!assignment || saving) return;
    setSaving(true);
    setError('');
    try {
      await updateEventTeamRole(eventId, assignment.id, role, responsibilities);
      await onSaved();
    } catch (cause) {
      setError(teamErrorMessage(cause, 'Błąd podczas aktualizacji.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={Boolean(assignment)}
      title="Rola i obowiązki"
      subtitle={memberName}
      onClose={onClose}
      locked={saving}
      footer={<FooterButtons saving={saving} label="Zapisz" onCancel={onClose} onSubmit={() => void save()} />}
    >
      <Text style={styles.label}>Rola</Text>
      <TextInput
        style={styles.input}
        value={role}
        onChangeText={setRole}
        placeholder="np. Lead Audio, Technician…"
        placeholderTextColor={colors.text.disabled}
        editable={!saving}
      />
      <Text style={styles.label}>Zakres odpowiedzialności</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={responsibilities}
        onChangeText={setResponsibilities}
        placeholder="Opisz zakres obowiązków…"
        placeholderTextColor={colors.text.disabled}
        multiline
        textAlignVertical="top"
        editable={!saving}
      />
      <ErrorText text={error} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Auto na dojazd
// ---------------------------------------------------------------------------------------------------------------

export function TeamTransportModal({
  assignment,
  memberName,
  eventId,
  loads,
  onClose,
  onSaved,
}: {
  assignment: ManagedAssignment | null;
  memberName: string;
  eventId: string;
  loads: TeamTransportLoad[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (assignment) setError('');
  }, [assignment]);

  const choose = async (vehicleId: string | null) => {
    if (!assignment || saving) return;
    if (vehicleId === assignment.transportVehicleId) {
      onClose();
      return;
    }
    setSaving(vehicleId ?? 'none');
    setError('');
    try {
      await setEventTeamTransport(eventId, assignment.id, vehicleId);
      await onSaved(vehicleId ? 'Zapisano transport.' : 'Bez auta — dojazd własny.');
    } catch (cause) {
      setError(teamErrorMessage(cause, 'Nie udało się zapisać transportu.'));
    } finally {
      setSaving(null);
    }
  };

  const options: { id: string | null; label: string; warning: boolean }[] = [
    { id: null, label: 'Bez auta (dojazd własny)', warning: false },
    ...loads.map((load) => ({ id: load.vehicle.id, label: teamTransportVehicleLabel(load), warning: load.overCapacity })),
  ];

  return (
    <Sheet visible={Boolean(assignment)} title="Auto na dojazd" subtitle={memberName} onClose={onClose} locked={Boolean(saving)}>
      <Text style={styles.hint}>Kierowcę auta ustawia logistyka eventu. Tu wybierasz, którym autem jedzie ta osoba.</Text>
      {options.map((option) => {
        const selected = (assignment?.transportVehicleId ?? null) === option.id;
        const key = option.id ?? 'none';
        return (
          <TouchableOpacity
            key={key}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: Boolean(saving) }}
            disabled={Boolean(saving)}
            onPress={() => void choose(option.id)}
            style={[styles.optionRow, selected && styles.optionSelected]}
          >
            <Feather name={option.id ? 'truck' : 'user'} size={16} color={selected ? colors.primary.gold : colors.text.secondary} />
            <Text style={[styles.optionText, option.warning && { color: colors.status.warning }]}>{option.label}</Text>
            {saving === key ? (
              <ActivityIndicator size="small" color={colors.primary.gold} />
            ) : selected ? (
              <Feather name="check" size={16} color={colors.primary.gold} />
            ) : null}
          </TouchableOpacity>
        );
      })}
      <ErrorText text={error} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Dodaj osobę do zespołu
// ---------------------------------------------------------------------------------------------------------------

const LIST_LIMIT = 40;

/** „14.11, 18:00”. */
function shortDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** „1 faza”, „3 fazy”, „5 faz”. */
const phasesCount = (count: number) =>
  `${count} ${count === 1 ? 'faza' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? 'fazy' : 'faz'}`;

const fold = (value: string) =>
  value
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l');

export function TeamAddMemberModal({
  visible,
  eventId,
  assigned,
  onClose,
  onAdded,
}: {
  visible: boolean;
  eventId: string;
  assigned: Set<string>;
  onClose: () => void;
  onAdded: (message: string) => Promise<void>;
}) {
  const [candidates, setCandidates] = useState<TeamCandidate[] | null>(null);
  const [phases, setPhases] = useState<Record<string, TeamCandidatePhase[]>>({});
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [role, setRole] = useState('');
  const [responsibilities, setResponsibilities] = useState('');
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [permissions, setPermissions] = useState<EventTeamPermissions>(emptyTeamPermissions());
  const [sendInvitation, setSendInvitation] = useState(true);
  const [includePhases, setIncludePhases] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setCandidates(null);
    setLoadError('');
    setQuery('');
    setSelectedId('');
    setRole('');
    setResponsibilities('');
    setPermissionsOpen(false);
    setPermissions(emptyTeamPermissions());
    setSendInvitation(true);
    setIncludePhases(false);
    setError('');
    fetchTeamCandidates(eventId)
      .then((result) => {
        if (!active) return;
        setCandidates(result.employees);
        setPhases(result.phases);
        if (result.phasesError) setLoadError('Nie udało się pobrać faz timeline pracowników — możesz dodać osobę bez nich.');
      })
      .catch((cause) => {
        if (active) setLoadError(teamErrorMessage(cause, 'Nie udało się pobrać listy pracowników.'));
      });
    return () => {
      active = false;
    };
  }, [visible, eventId]);

  const available = useMemo(
    () => (candidates ?? []).filter((person) => !assigned.has(person.id)),
    [candidates, assigned],
  );
  const filtered = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return available;
    return available.filter((person) => fold(`${person.name} ${person.surname} ${person.nickname ?? ''}`).includes(needle));
  }, [available, query]);
  const selected = available.find((person) => person.id === selectedId) ?? null;
  const selectedPhases = selectedId ? phases[selectedId] ?? [] : [];
  const anyPermission = Object.values(permissions).some(Boolean);

  const submit = async () => {
    if (saving) return;
    if (!selected) {
      setError('Wybierz pracownika.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await addEventTeamMember(eventId, {
        employeeId: selected.id,
        role,
        responsibilities,
        permissions,
        sendInvitation,
        includePhases: sendInvitation && includePhases,
      });
      const name = `${selected.name} ${selected.surname}`.trim();
      await onAdded(
        result.invitation === 'sent'
          ? `Dodano do zespołu: ${name}. Zaproszenie zostało wysłane.`
          : result.invitation === 'failed'
            ? `Dodano do zespołu: ${name}. Zaproszenie nie zostało wysłane — wyślij je z listy zespołu.`
            : result.invitation === 'skipped'
              ? `Dodano do zespołu: ${name} (zaproszenie nie było potrzebne).`
              : `Dodano do zespołu: ${name}.`,
      );
    } catch (cause) {
      setError(teamErrorMessage(cause, 'Błąd podczas dodawania pracownika.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      title="Dodaj osobę do zespołu"
      subtitle="Dodanie do zespołu od razu nadaje dostęp do eventu. Timeline możesz uzupełnić później."
      onClose={onClose}
      locked={saving}
      footer={
        <FooterButtons
          saving={saving}
          label="Dodaj do eventu"
          onCancel={onClose}
          onSubmit={() => void submit()}
          disabled={!selected}
        />
      }
    >
      <Text style={styles.label}>Pracownik</Text>
      {selected ? (
        <TouchableOpacity style={[styles.personRow, styles.optionSelected]} onPress={() => setSelectedId('')} disabled={saving}>
          <EmployeeAvatar
            avatarUrl={selected.avatarUrl}
            avatarMetadata={selected.avatarMetadata}
            employeeName={`${selected.name} ${selected.surname}`}
            size={32}
          />
          <Text style={styles.optionText}>{`${selected.name} ${selected.surname}`.trim()}</Text>
          <Text style={styles.changeLink}>Zmień</Text>
        </TouchableOpacity>
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={candidates ? 'Szukaj pracownika…' : 'Ładowanie…'}
            placeholderTextColor={colors.text.disabled}
            autoCorrect={false}
            editable={Boolean(candidates)}
          />
          {!candidates && !loadError && <ActivityIndicator color={colors.primary.gold} style={{ marginVertical: 12 }} />}
          {candidates && !available.length && (
            <Text style={styles.hint}>Wszyscy aktywni pracownicy są już w zespole.</Text>
          )}
          {filtered.slice(0, LIST_LIMIT).map((person) => (
            <TouchableOpacity
              key={person.id}
              accessibilityRole="button"
              style={styles.personRow}
              onPress={() => setSelectedId(person.id)}
            >
              <EmployeeAvatar
                avatarUrl={person.avatarUrl}
                avatarMetadata={person.avatarMetadata}
                employeeName={`${person.name} ${person.surname}`}
                size={32}
              />
              <Text style={styles.optionText}>
                {`${person.name} ${person.surname}`.trim()}
                {person.nickname ? <Text style={styles.toggleDetail}>{`  ${person.nickname}`}</Text> : null}
              </Text>
              {(phases[person.id]?.length ?? 0) > 0 && (
                <Text style={styles.toggleDetail}>{phasesCount(phases[person.id].length)}</Text>
              )}
            </TouchableOpacity>
          ))}
          {filtered.length > LIST_LIMIT && (
            <Text style={styles.hint}>{`Pokazano ${LIST_LIMIT} z ${filtered.length} — zawęź wyszukiwanie.`}</Text>
          )}
        </>
      )}
      <ErrorText text={loadError} />

      {selectedPhases.length > 0 && (
        <View style={styles.phasesBox}>
          <Text style={styles.toggleTitle}>Przypisane fazy</Text>
          {selectedPhases.map((phase) => (
            <View key={phase.phaseId} style={styles.phaseRow}>
              <Text style={styles.phaseName}>{phase.name}</Text>
              <Text style={styles.toggleDetail}>{`Praca: ${shortDate(phase.workStart)} – ${shortDate(phase.workEnd)}`}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.label}>Rola w evencie</Text>
      <TextInput
        style={styles.input}
        value={role}
        onChangeText={setRole}
        placeholder="np. Lead Audio, Technician…"
        placeholderTextColor={colors.text.disabled}
        editable={!saving}
      />
      <Text style={styles.label}>Zakres odpowiedzialności</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={responsibilities}
        onChangeText={setResponsibilities}
        placeholder="Opisz zakres obowiązków…"
        placeholderTextColor={colors.text.disabled}
        multiline
        textAlignVertical="top"
        editable={!saving}
      />
      <Text style={styles.hint}>
        Co ta osoba widzi w evencie, wynika z jej roli w ustawieniach pracownika. Poniżej możesz dodatkowo nadać uprawnienia do
        edycji w tym evencie.
      </Text>
      <ToggleRow
        title="Nadaj uprawnienia współpracownika"
        value={permissionsOpen || anyPermission}
        disabled={saving}
        onChange={(on) => {
          setPermissionsOpen(on);
          if (!on) setPermissions(emptyTeamPermissions());
        }}
      />
      {(permissionsOpen || anyPermission) &&
        EVENT_TEAM_PERMISSIONS.map((item) => (
          <ToggleRow
            key={item.key}
            title={item.title}
            detail={item.detail}
            value={permissions[item.key]}
            disabled={saving}
            onChange={(value) => setPermissions((current) => ({ ...current, [item.key]: value }))}
          />
        ))}
      <View style={styles.inviteBox}>
        <ToggleRow
          title="Wyślij teraz zaproszenie e-mailem"
          detail="Pracownik może zostać dodany do zespołu również bez wysyłania wiadomości."
          value={sendInvitation}
          disabled={saving}
          onChange={setSendInvitation}
        />
        {sendInvitation && (
          <ToggleRow
            title="Dołącz aktualnie przypisane fazy timeline"
            detail={
              selectedPhases.length
                ? `Przypisane fazy w wiadomości: ${phasesCount(selectedPhases.length)}.`
                : 'Brak przypisanych faz — zaproszenie zostanie wysłane bez harmonogramu. Możesz dosłać go później z listy zespołu.'
            }
            value={includePhases}
            disabled={saving}
            onChange={setIncludePhases}
          />
        )}
      </View>
      <ErrorText text={error} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.68)' },
  card: {
    maxHeight: '90%',
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    backgroundColor: colors.background.secondary,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: colors.border.hover,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  title: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 17, fontWeight: '400', color: colors.text.primary },
  subtitle: { fontSize: 12, color: colors.text.secondary, marginTop: 3 },
  closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0 },
  content: { padding: spacing.md, paddingBottom: 24, gap: 8 },
  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
  },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border.hover,
    borderRadius: 9,
    paddingVertical: 11,
  },
  secondaryButtonText: { fontSize: 13, fontWeight: '600', color: colors.text.secondary },
  primaryButton: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: colors.primary.gold,
    paddingVertical: 11,
  },
  primaryButtonText: { fontSize: 13, fontWeight: '700', color: colors.background.primary },
  buttonDisabled: { opacity: 0.5 },
  error: { color: colors.status.error, fontSize: 12, marginTop: 6 },
  hint: { fontSize: 11, lineHeight: 16, color: colors.text.tertiary },
  label: { fontSize: 11, fontWeight: '600', color: colors.text.secondary, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border.hover,
    borderRadius: 9,
    backgroundColor: colors.background.primary,
    color: colors.text.primary,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  multiline: { minHeight: 80 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 9,
    backgroundColor: colors.background.tertiary,
  },
  toggleTitle: { fontSize: 13, fontWeight: '600', color: colors.text.primary },
  toggleDetail: { fontSize: 11, lineHeight: 15, color: colors.text.tertiary, marginTop: 1 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.background.tertiary,
  },
  actionTitle: { fontSize: 14, fontWeight: '600', color: colors.text.primary },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.tertiary,
  },
  optionSelected: { borderColor: colors.primary.gold, backgroundColor: colors.primary.gold + '14' },
  optionText: { flex: 1, fontSize: 13, color: colors.text.primary },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.tertiary,
  },
  changeLink: { fontSize: 12, fontWeight: '600', color: colors.primary.gold },
  phasesBox: { gap: 6, padding: 10, borderRadius: 9, backgroundColor: colors.background.tertiary },
  phaseRow: { gap: 1 },
  phaseName: { fontSize: 13, fontWeight: '600', color: colors.primary.gold },
  inviteBox: { gap: 8, marginTop: 4 },
});
