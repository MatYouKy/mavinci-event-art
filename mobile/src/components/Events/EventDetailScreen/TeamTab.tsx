import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useAuth } from '../../../contexts/AuthContext';
import { canView } from '../../../lib/permissions';
import EmployeeAvatar from '../../EmployeeAvatar';
import { colors, spacing } from '../../../theme';
import { getOrCreateDirectConversation } from '../../../services/directConversation';
import { navigateToChat } from '../../../navigation/navigationRef';
import {
  changeRealizationManager,
  loadEventTeamManage,
  removeEventTeamMember,
  sendEventTeamInvitation,
  teamErrorMessage,
  type EventTeamManageData,
  type ManagedAssignment,
} from '../../../lib/eventTeamManage';
import { summarizeTeamTransport, type TeamTransportVehicle } from '../../../lib/teamTransport';
import {
  TeamActionSheet,
  TeamAddMemberModal,
  TeamPermissionsModal,
  TeamRoleModal,
  TeamTransportModal,
  type TeamSheetAction,
} from './TeamManageModals';

export interface EventTeamMember {
  id: string;
  name: string;
  surname: string;
  nickname?: string | null;
  avatar_url?: string | null;
  avatar_metadata?: any;
  role: string | null;
  phone_number?: string | null;
  email?: string | null;
  responsibility_roles?: string[];
  occupation?: string | null;
  responsibilities?: string | null;
  status?: string | null;
}

interface Props {
  employees: EventTeamMember[];
  currentEmployeeId: string | null;
  /**
   * Event, którego zespołem można zarządzać (dodanie osoby, kierownik realizacji, uprawnienia, rola, dojazd, zaproszenia).
   * Bez `eventId` lista jest tylko do odczytu (np. pulpit realizacji).
   */
  eventId?: string;
  /** Prawo do zarządzania zespołem jak w CRM (`canManageTeam`); kierownika wyznacza każdy z prawem prowadzenia realizacji. */
  canManage?: boolean;
  /** Po zmianie w zespole (ekran eventu odświeża listę osób). */
  onChanged?: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  accepted: 'Potwierdzone',
  pending: 'Oczekuje',
  rejected: 'Odrzucone',
};

type Notice = { tone: 'success' | 'error'; text: string };

export const vehicleLabel = (vehicle: TeamTransportVehicle) =>
  `${vehicle.name}${vehicle.registration ? ` · ${vehicle.registration}` : ''}`;

export function TeamTab({ employees, currentEmployeeId, eventId, canManage = false, onChanged }: Props) {
  const { employee } = useAuth();
  const openContact = (url: string) => {
    void Linking.openURL(url).catch(() => Alert.alert('Kontakt', 'Nie udało się otworzyć aplikacji.'));
  };
  const [openingConversationWith, setOpeningConversationWith] = useState<string | null>(null);
  const [manage, setManage] = useState<{ eventId: string; data: EventTeamManageData } | null>(null);
  const [manageError, setManageError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sheetFor, setSheetFor] = useState<EventTeamMember | null>(null);
  const [permissionsFor, setPermissionsFor] = useState<ManagedAssignment | null>(null);
  const [roleFor, setRoleFor] = useState<ManagedAssignment | null>(null);
  const [transportFor, setTransportFor] = useState<ManagedAssignment | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const readVersion = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  const data = eventId && manage?.eventId === eventId ? manage.data : null;

  const reload = useCallback(async () => {
    if (!eventId) return;
    const version = ++readVersion.current;
    try {
      const next = await loadEventTeamManage(eventId);
      if (version !== readVersion.current) return;
      setManage({ eventId, data: next });
      setManageError('');
    } catch (error) {
      if (version === readVersion.current) setManageError(teamErrorMessage(error, 'Nie udało się odczytać zarządzania zespołem.'));
    }
  }, [eventId]);

  // Lista osób przychodzi z ekranu eventu (odświeżana na żywo) — po każdej zmianie odczytujemy też przypisania.
  const employeesKey = employees.map((member) => `${member.id}:${member.status ?? ''}:${member.role ?? ''}`).join('|');
  useEffect(() => {
    void reload();
  }, [reload, employeesKey]);

  useEffect(
    () => () => {
      readVersion.current++;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const showNotice = (next: Notice) => {
    setNotice(next);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), next.tone === 'success' ? 3500 : 6000);
  };

  /** Zapis z blokadą (jedna zmiana naraz), komunikatem i odświeżeniem zespołu. */
  const run = async (label: string, task: () => Promise<string | null>, fallback: string) => {
    if (busy) return false;
    setBusy(label);
    try {
      const message = await task();
      await reload();
      changedRef.current?.();
      if (message) showNotice({ tone: 'success', text: message });
      return true;
    } catch (error) {
      showNotice({ tone: 'error', text: teamErrorMessage(error, fallback) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const startConversation = async (employeeId: string) => {
    if (!currentEmployeeId || openingConversationWith || !canView(employee, 'chat')) return;

    setOpeningConversationWith(employeeId);
    try {
      const conversationId = await getOrCreateDirectConversation(currentEmployeeId, employeeId);
      navigateToChat(conversationId);
    } catch (error) {
      console.error('Error starting team conversation:', error);
      Alert.alert('Błąd', 'Nie udało się rozpocząć rozmowy z tym pracownikiem.');
    } finally {
      setOpeningConversationWith(null);
    }
  };

  const assignmentOf = (employeeId: string) => data?.assignments.find((row) => row.employeeId === employeeId) ?? null;
  const leadership = data?.leadership ?? null;
  const vehicles = data?.vehicles ?? null;
  const transport =
    vehicles && vehicles.length > 0 && data
      ? summarizeTeamTransport(
          vehicles,
          data.assignments.map((row) => ({
            employeeId: row.employeeId,
            transportVehicleId: row.transportVehicleId,
            rejected: row.status === 'rejected',
          })),
        )
      : null;

  const displayName = (member: EventTeamMember) => member.nickname || `${member.name} ${member.surname}`.trim();

  const transportText = (member: EventTeamMember, assignment: ManagedAssignment | null): string | null => {
    if (!vehicles?.length) return null;
    const driving = vehicles.find((vehicle) => vehicle.driverId === member.id);
    if (driving) return `Kieruje: ${vehicleLabel(driving)}`;
    if (!assignment || assignment.status === 'rejected') return null;
    const riding = assignment.transportVehicleId ? vehicles.find((vehicle) => vehicle.id === assignment.transportVehicleId) : null;
    return riding ? `Jedzie: ${vehicleLabel(riding)}` : 'Bez auta (dojazd własny)';
  };

  const actionsFor = (member: EventTeamMember): TeamSheetAction[] => {
    if (!eventId || !data) return [];
    const assignment = assignmentOf(member.id);
    const isLeader = Boolean(leadership?.managerId && leadership.managerId === member.id);
    const name = displayName(member);
    const list: TeamSheetAction[] = [];
    if (leadership?.canManage && (isLeader || assignment?.status === 'accepted')) {
      list.push({
        key: 'leader',
        title: isLeader ? 'Odbierz uprawnienia kierownika' : 'Mianuj kierownikiem realizacji',
        detail: leadership.canChange
          ? isLeader
            ? 'Kierownik traci prowadzenie realizacji tego eventu.'
            : 'Kierownik prowadzi realizację: kroki, sprzęt, zespół na miejscu.'
          : 'Realizacja jest zakończona — kierownika nie można już zmienić.',
        icon: isLeader ? 'user-minus' : 'award',
        destructive: isLeader,
        disabled: !leadership.canChange,
        onPress: () =>
          void run(
            'leader',
            async () => {
              await changeRealizationManager(eventId, member.id, isLeader);
              return isLeader ? 'Odebrano rolę kierownika realizacji.' : `${name} jest kierownikiem realizacji.`;
            },
            'Nie udało się zmienić kierownika realizacji.',
          ),
      });
    }
    if (canManage && assignment) {
      if (assignment.status === 'pending' && !assignment.invitationEmailSent) {
        list.push({
          key: 'invite',
          title: 'Wyślij zaproszenie',
          icon: 'send',
          onPress: () =>
            void run(
              'invite',
              async () =>
                (await sendEventTeamInvitation(assignment.id, false, 'invitation')) === 'skipped'
                  ? 'Zaproszenie nie jest potrzebne — nie wysłano wiadomości.'
                  : 'Zaproszenie zostało wysłane.',
              'Błąd podczas wysyłania zaproszenia.',
            ),
        });
      }
      if (assignment.status !== 'rejected') {
        list.push({
          key: 'timeline',
          title: 'Wyślij aktualny timeline',
          icon: 'mail',
          onPress: () =>
            void run(
              'timeline',
              async () =>
                (await sendEventTeamInvitation(assignment.id, true, 'timeline_update')) === 'skipped'
                  ? 'Wiadomość nie jest potrzebna — nie wysłano.'
                  : 'Uzupełniony harmonogram został wysłany.',
              'Nie wysłano harmonogramu.',
            ),
        });
      }
      list.push({ key: 'role', title: 'Edytuj rolę i obowiązki', icon: 'edit-2', onPress: () => setRoleFor(assignment) });
      list.push({ key: 'permissions', title: 'Uprawnienia w evencie', icon: 'shield', onPress: () => setPermissionsFor(assignment) });
      if (vehicles?.length && !vehicles.some((vehicle) => vehicle.driverId === member.id)) {
        list.push({ key: 'transport', title: 'Auto na dojazd', icon: 'truck', onPress: () => setTransportFor(assignment) });
      }
      list.push({
        key: 'remove',
        title: 'Usuń z zespołu',
        icon: 'trash-2',
        destructive: true,
        onPress: () =>
          Alert.alert('Usunąć z zespołu?', `Czy na pewno chcesz usunąć ${name} z eventu? Osoba straci dostęp do eventu.`, [
            { text: 'Anuluj', style: 'cancel' },
            {
              text: 'Usuń',
              style: 'destructive',
              onPress: () =>
                void run(
                  'remove',
                  async () => {
                    await removeEventTeamMember(eventId, assignment.id);
                    return 'Pracownik został usunięty z eventu.';
                  },
                  'Błąd podczas usuwania pracownika.',
                ),
            },
          ]),
      });
    }
    return list;
  };

  const sheetActions = sheetFor ? actionsFor(sheetFor) : [];
  const assignedIds = new Set([...(data?.assignments.map((row) => row.employeeId) ?? []), ...employees.map((member) => member.id)]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Zespół eventu</Text>
          <Text style={styles.description}>
            {canManage
              ? 'Dotknij osoby, aby zmienić rolę, uprawnienia, dojazd albo mianować kierownika.'
              : 'Osoby przypisane do eventu i status ich udziału.'}
          </Text>
        </View>
        {canManage && !!eventId && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Dodaj osobę do zespołu"
            style={styles.addButton}
            onPress={() => setAddOpen(true)}
            disabled={!data}
          >
            <Feather name="user-plus" size={16} color={colors.background.primary} />
            <Text style={styles.addButtonText}>Dodaj osobę</Text>
          </TouchableOpacity>
        )}
      </View>

      {!!busy && (
        <View style={styles.busyRow}>
          <ActivityIndicator size="small" color={colors.primary.gold} />
          <Text style={styles.busyText}>Zapisywanie…</Text>
        </View>
      )}
      {!!notice && (
        <View style={[styles.notice, notice.tone === 'error' ? styles.noticeError : styles.noticeSuccess]}>
          <Feather
            name={notice.tone === 'error' ? 'alert-circle' : 'check-circle'}
            size={15}
            color={notice.tone === 'error' ? colors.status.error : colors.status.success}
          />
          <Text accessibilityRole={notice.tone === 'error' ? 'alert' : undefined} style={styles.noticeText}>
            {notice.text}
          </Text>
        </View>
      )}
      {!!manageError && !!eventId && (
        <TouchableOpacity accessibilityRole="button" onPress={() => void reload()} style={styles.notice}>
          <Feather name="refresh-cw" size={14} color={colors.text.secondary} />
          <Text style={styles.noticeText}>{manageError} Dotknij, aby ponowić.</Text>
        </TouchableOpacity>
      )}
      {!!transport && transport.warnings.length > 0 && (
        <View style={[styles.notice, styles.noticeWarning]}>
          <Feather name="alert-triangle" size={14} color={colors.status.warning} />
          <Text style={styles.noticeText}>{transport.warnings.join('\n')}</Text>
        </View>
      )}

      {employees.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="users" size={40} color={colors.text.tertiary} />
          <Text style={styles.emptyTitle}>Brak przypisanych pracowników</Text>
          {canManage && !!eventId && <Text style={styles.description}>Dodaj osoby przyciskiem „Dodaj osobę”.</Text>}
        </View>
      ) : (
        <View style={styles.list}>
          {employees.map((teamMember) => {
            const name = displayName(teamMember);
            const assignmentLabel = teamMember.responsibility_roles?.join(' · ') || teamMember.role || teamMember.occupation;
            const isCurrentEmployee = teamMember.id === currentEmployeeId;
            const isOpening = openingConversationWith === teamMember.id;
            const assignment = assignmentOf(teamMember.id);
            const isLeader = Boolean(leadership?.managerId && leadership.managerId === teamMember.id);
            const ride = transportText(teamMember, assignment);
            const manageable = actionsFor(teamMember).length > 0;

            return (
              <View key={teamMember.id} style={styles.employeeRow}>
                <EmployeeAvatar
                  avatarUrl={teamMember.avatar_url}
                  avatarMetadata={teamMember.avatar_metadata}
                  employeeName={name}
                  size={44}
                />

                <TouchableOpacity
                  style={styles.employeeInfo}
                  disabled={!manageable}
                  onPress={() => setSheetFor(teamMember)}
                  accessibilityRole={manageable ? 'button' : undefined}
                  accessibilityLabel={manageable ? `Zarządzaj: ${name}` : undefined}
                >
                  <View style={styles.nameRow}>
                    <Text style={styles.employeeName} numberOfLines={1}>
                      {name}
                      {isCurrentEmployee ? ' (Ty)' : ''}
                    </Text>
                    {manageable && <Feather name="more-horizontal" size={16} color={colors.text.tertiary} />}
                  </View>
                  {(isLeader || Boolean(teamMember.status && STATUS_LABELS[teamMember.status])) && (
                    <View style={styles.badgeRow}>
                      {isLeader && (
                        <View style={styles.leaderBadge}>
                          <Feather name="award" size={11} color={colors.primary.gold} />
                          <Text style={styles.leaderText}>Kierownik realizacji</Text>
                        </View>
                      )}
                      {!!teamMember.status && !!STATUS_LABELS[teamMember.status] && (
                        <View
                          style={[
                            styles.statusBadge,
                            teamMember.status === 'accepted' && styles.statusAccepted,
                            teamMember.status === 'rejected' && styles.statusRejected,
                          ]}
                        >
                          <Text style={styles.statusText}>{STATUS_LABELS[teamMember.status]}</Text>
                        </View>
                      )}
                    </View>
                  )}
                  {!!assignmentLabel && (
                    <Text style={styles.assignmentRole} numberOfLines={1}>
                      {assignmentLabel}
                    </Text>
                  )}
                  {!!teamMember.responsibilities && (
                    <Text style={styles.responsibilities} numberOfLines={2}>
                      {teamMember.responsibilities}
                    </Text>
                  )}
                  {!!ride && (
                    <Text style={styles.rideText} numberOfLines={1}>
                      {ride}
                    </Text>
                  )}
                </TouchableOpacity>

                {!isCurrentEmployee && (
                  <View style={{ gap: 8 }}>
                    {!!teamMember.phone_number && (
                      <>
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`Zadzwoń do ${name}`}
                          onPress={() => openContact(`tel:${teamMember.phone_number!.replace(/[^+0-9]/g, '')}`)}
                        >
                          <Text style={{ color: colors.primary.gold }}>Zadzwoń</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          accessibilityRole="button"
                          onPress={() => openContact(`sms:${teamMember.phone_number!.replace(/[^+0-9]/g, '')}`)}
                        >
                          <Text style={{ color: colors.primary.gold }}>SMS</Text>
                        </TouchableOpacity>
                      </>
                    )}
                    {!!teamMember.email && (
                      <TouchableOpacity
                        accessibilityRole="button"
                        onPress={() => openContact(`mailto:${encodeURIComponent(teamMember.email!)}`)}
                      >
                        <Text style={{ color: colors.primary.gold }}>E-mail</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                {!isCurrentEmployee && canView(employee, 'chat') && (
                  <TouchableOpacity
                    style={styles.messageButton}
                    onPress={() => startConversation(teamMember.id)}
                    disabled={Boolean(openingConversationWith)}
                    accessibilityRole="button"
                    accessibilityLabel={`Rozpocznij rozmowę z ${name}`}
                  >
                    {isOpening ? (
                      <ActivityIndicator size="small" color={colors.primary.gold} />
                    ) : (
                      <Feather name="message-circle" size={19} color={colors.primary.gold} />
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}

      <TeamActionSheet
        visible={Boolean(sheetFor) && sheetActions.length > 0}
        title={sheetFor ? displayName(sheetFor) : ''}
        subtitle={sheetFor ? transportText(sheetFor, assignmentOf(sheetFor.id)) : null}
        actions={sheetActions}
        busy={Boolean(busy)}
        onClose={() => setSheetFor(null)}
      />
      {eventId && (
        <>
          <TeamPermissionsModal
            assignment={permissionsFor}
            memberName={permissionsFor ? displayName(employees.find((m) => m.id === permissionsFor.employeeId) ?? fallbackMember) : ''}
            eventId={eventId}
            onClose={() => setPermissionsFor(null)}
            onSaved={async () => {
              setPermissionsFor(null);
              await run('permissions', async () => 'Uprawnienia zostały zapisane.', 'Nie udało się odświeżyć zespołu.');
            }}
          />
          <TeamRoleModal
            assignment={roleFor}
            memberName={roleFor ? displayName(employees.find((m) => m.id === roleFor.employeeId) ?? fallbackMember) : ''}
            eventId={eventId}
            onClose={() => setRoleFor(null)}
            onSaved={async () => {
              setRoleFor(null);
              await run('role', async () => 'Zapisano rolę i obowiązki.', 'Nie udało się odświeżyć zespołu.');
            }}
          />
          <TeamTransportModal
            assignment={transportFor}
            memberName={transportFor ? displayName(employees.find((m) => m.id === transportFor.employeeId) ?? fallbackMember) : ''}
            eventId={eventId}
            loads={transport?.loads ?? []}
            onClose={() => setTransportFor(null)}
            onSaved={async (message) => {
              setTransportFor(null);
              await run('transport', async () => message, 'Nie udało się odświeżyć zespołu.');
            }}
          />
          <TeamAddMemberModal
            visible={addOpen}
            eventId={eventId}
            assigned={assignedIds}
            onClose={() => setAddOpen(false)}
            onAdded={async (message) => {
              setAddOpen(false);
              await run('add', async () => message, 'Nie udało się odświeżyć zespołu.');
            }}
          />
        </>
      )}
    </View>
  );
}

const fallbackMember: EventTeamMember = { id: '', name: 'Pracownik', surname: '', role: null };

const styles = StyleSheet.create({
  container: { padding: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heading: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 16, fontWeight: '400', color: colors.text.primary },
  description: { marginTop: 4, fontSize: 12, lineHeight: 18, color: colors.text.tertiary },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: colors.primary.gold,
  },
  addButtonText: { fontSize: 13, fontWeight: '700', color: colors.background.primary },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  busyText: { fontSize: 12, color: colors.primary.gold },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 10,
    padding: 10,
    borderRadius: 9,
    backgroundColor: colors.background.tertiary,
  },
  noticeSuccess: { backgroundColor: colors.status.success + '1a' },
  noticeError: { backgroundColor: colors.status.error + '1f' },
  noticeWarning: { backgroundColor: colors.status.warning + '1a' },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.text.primary },
  list: { marginTop: spacing.md, gap: 8 },
  employeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },
  employeeInfo: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  employeeName: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.text.primary },
  badgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 3 },
  leaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colors.primary.gold + '1f',
  },
  leaderText: { fontSize: 10, fontWeight: '700', color: colors.primary.gold },
  assignmentRole: { marginTop: 2, fontSize: 11, color: colors.primary.gold },
  responsibilities: { marginTop: 3, fontSize: 11, lineHeight: 15, color: colors.text.tertiary },
  rideText: { marginTop: 3, fontSize: 11, color: colors.text.secondary },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#f59e0b22',
  },
  statusAccepted: { backgroundColor: '#22c55e22' },
  statusRejected: { backgroundColor: '#ef444422' },
  statusText: { fontSize: 9, fontWeight: '700', color: colors.text.secondary },
  messageButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primary.gold + '45',
    backgroundColor: colors.primary.gold + '12',
  },
  emptyState: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 60 },
  emptyTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 14, color: colors.text.tertiary },
});
