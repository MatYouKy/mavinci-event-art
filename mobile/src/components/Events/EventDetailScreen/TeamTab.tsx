import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import EmployeeAvatar from '../../EmployeeAvatar';
import { colors, spacing } from '../../../theme';
import { getOrCreateDirectConversation } from '../../../services/directConversation';
import { navigateToChat } from '../../../navigation/navigationRef';

export interface EventTeamMember {
  id: string;
  name: string;
  surname: string;
  nickname?: string | null;
  avatar_url?: string | null;
  avatar_metadata?: any;
  role: string | null;
  occupation?: string | null;
  responsibilities?: string | null;
  status?: string | null;
}

interface Props {
  employees: EventTeamMember[];
  currentEmployeeId: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  accepted: 'Potwierdzone',
  pending: 'Oczekuje',
  rejected: 'Odrzucone',
};

export function TeamTab({ employees, currentEmployeeId }: Props) {
  const [openingConversationWith, setOpeningConversationWith] = useState<string | null>(null);

  const startConversation = async (employeeId: string) => {
    if (!currentEmployeeId || openingConversationWith) return;

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

  if (employees.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Feather name="users" size={40} color={colors.text.tertiary} />
        <Text style={styles.emptyTitle}>Brak przypisanych pracowników</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Zespół wydarzenia</Text>
      <Text style={styles.description}>Osoby przypisane do wydarzenia i status ich udziału.</Text>

      <View style={styles.list}>
        {employees.map((teamMember) => {
          const displayName =
            teamMember.nickname || `${teamMember.name} ${teamMember.surname}`.trim();
          const assignmentLabel = teamMember.role || teamMember.occupation;
          const isCurrentEmployee = teamMember.id === currentEmployeeId;
          const isOpening = openingConversationWith === teamMember.id;

          return (
            <View key={teamMember.id} style={styles.employeeRow}>
              <EmployeeAvatar
                avatarUrl={teamMember.avatar_url}
                avatarMetadata={teamMember.avatar_metadata}
                employeeName={displayName}
                size={44}
              />

              <View style={styles.employeeInfo}>
                <View style={styles.nameRow}>
                  <Text style={styles.employeeName} numberOfLines={1}>
                    {displayName}
                    {isCurrentEmployee ? ' (Ty)' : ''}
                  </Text>
                  {teamMember.status && STATUS_LABELS[teamMember.status] && (
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

                {assignmentLabel && (
                  <Text style={styles.assignmentRole} numberOfLines={1}>
                    {assignmentLabel}
                  </Text>
                )}
                {teamMember.responsibilities && (
                  <Text style={styles.responsibilities} numberOfLines={2}>
                    {teamMember.responsibilities}
                  </Text>
                )}
              </View>

              {!isCurrentEmployee && (
                <TouchableOpacity
                  style={styles.messageButton}
                  onPress={() => startConversation(teamMember.id)}
                  disabled={Boolean(openingConversationWith)}
                  accessibilityRole="button"
                  accessibilityLabel={`Rozpocznij rozmowę z ${displayName}`}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md },
  heading: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 16, fontWeight: '700', color: colors.text.primary },
  description: { marginTop: 4, fontSize: 12, lineHeight: 18, color: colors.text.tertiary },
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
  assignmentRole: { marginTop: 2, fontSize: 11, color: colors.primary.gold },
  responsibilities: { marginTop: 3, fontSize: 11, lineHeight: 15, color: colors.text.tertiary },
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
