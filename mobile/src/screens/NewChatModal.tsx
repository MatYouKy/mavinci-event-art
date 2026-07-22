import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '../theme';
import { supabase, Employee } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import EmployeeAvatar from '../components/EmployeeAvatar';
import { Conversation } from './ChatListScreen';

interface Props {
  visible: boolean;
  onClose: () => void;
  onConversationCreated: (conversation: Conversation) => void;
}

export default function NewChatModal({ visible, onClose, onConversationCreated }: Props) {
  const { employee } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const isGroupMode = selected.length > 1;

  useEffect(() => {
    if (!visible) return;
    fetchEmployees();
    return () => {
      setSelected([]);
      setSearch('');
      setGroupName('');
    };
  }, [visible]);

  const fetchEmployees = async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from('employees')
      .select('*')
      .neq('id', employee?.id || '')
      .order('name', { ascending: true });
    setEmployees(data || []);
    setIsLoading(false);
  };

  const toggleSelect = (empId: string) => {
    setSelected((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId]
    );
  };

  const createConversation = async () => {
    if (!employee || selected.length === 0 || isCreating) return;
    setIsCreating(true);

    try {
      // Check if 1-on-1 conversation already exists
      if (selected.length === 1) {
        const { data: existingParticipations } = await supabase
          .from('employee_conversation_participants')
          .select('conversation_id')
          .eq('employee_id', employee.id);

        if (existingParticipations && existingParticipations.length > 0) {
          const convIds = existingParticipations.map((p) => p.conversation_id);

          const { data: otherParticipations } = await supabase
            .from('employee_conversation_participants')
            .select('conversation_id')
            .eq('employee_id', selected[0])
            .in('conversation_id', convIds);

          if (otherParticipations && otherParticipations.length > 0) {
            // Check if any of these are 1-on-1
            const commonIds = otherParticipations.map((p) => p.conversation_id);
            const { data: existingConvos } = await supabase
              .from('employee_conversations')
              .select('*')
              .in('id', commonIds)
              .eq('is_group', false);

            if (existingConvos && existingConvos.length > 0) {
              // Use existing conversation
              const existing = existingConvos[0];
              const { data: parts } = await supabase
                .from('employee_conversation_participants')
                .select('id, conversation_id, employee_id, last_read_at')
                .eq('conversation_id', existing.id);

              const partEmployeeIds = (parts || []).map((p) => p.employee_id);
              const { data: empData } = await supabase
                .from('employees')
                .select('id, name, surname, nickname, avatar_url, avatar_metadata')
                .in('id', partEmployeeIds);

              const empMap = new Map((empData || []).map((e) => [e.id, e]));
              const enriched: Conversation = {
                ...existing,
                participants: (parts || []).map((p) => ({
                  ...p,
                  employee: empMap.get(p.employee_id),
                })),
                unread_count: 0,
              };

              onConversationCreated(enriched);
              onClose();
              return;
            }
          }
        }
      }

      // Create new conversation
      const { data: newConv, error: convError } = await supabase
        .from('employee_conversations')
        .insert({
          title: isGroupMode ? groupName || null : null,
          is_group: isGroupMode,
          created_by: employee.id,
        })
        .select()
        .single();

      if (convError || !newConv) {
        console.error('Failed to create conversation:', convError?.message);
        return;
      }

      // Add participants (including self)
      const participantInserts = [employee.id, ...selected].map((empId) => ({
        conversation_id: newConv.id,
        employee_id: empId,
      }));

      await supabase
        .from('employee_conversation_participants')
        .insert(participantInserts);

      // Fetch full data for the new conversation
      const { data: parts } = await supabase
        .from('employee_conversation_participants')
        .select('id, conversation_id, employee_id, last_read_at')
        .eq('conversation_id', newConv.id);

      const partEmployeeIds = (parts || []).map((p) => p.employee_id);
      const { data: empData } = await supabase
        .from('employees')
        .select('id, name, surname, nickname, avatar_url, avatar_metadata')
        .in('id', partEmployeeIds);

      const empMap = new Map((empData || []).map((e) => [e.id, e]));
      const enriched: Conversation = {
        ...newConv,
        participants: (parts || []).map((p) => ({
          ...p,
          employee: empMap.get(p.employee_id),
        })),
        unread_count: 0,
      };

      onConversationCreated(enriched);
      onClose();
    } catch (err) {
      console.error('Error creating conversation:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const filteredEmployees = employees.filter((emp) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      emp.name?.toLowerCase().includes(q) ||
      emp.surname?.toLowerCase().includes(q) ||
      emp.nickname?.toLowerCase().includes(q) ||
      emp.email?.toLowerCase().includes(q)
    );
  });

  const renderEmployee = ({ item }: { item: Employee }) => {
    const isSelected = selected.includes(item.id);
    const displayName = item.nickname || `${item.name} ${item.surname}`;

    return (
      <TouchableOpacity
        style={[styles.employeeRow, isSelected && styles.employeeRowSelected]}
        onPress={() => toggleSelect(item.id)}
        activeOpacity={0.7}
      >
        <EmployeeAvatar
          avatarUrl={item.avatar_url}
          avatarMetadata={item.avatar_metadata}
          employeeName={displayName}
          size={44}
        />
        <View style={styles.employeeInfo}>
          <Text style={styles.employeeName}>{displayName}</Text>
          {item.nickname && (
            <Text style={styles.employeeSubtext}>
              {item.name} {item.surname}
            </Text>
          )}
          <Text style={styles.employeeRole}>{item.role || item.email}</Text>
        </View>
        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
          {isSelected && <Feather name="check" size={14} color="#fff" />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>Anuluj</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Nowy czat</Text>
          <TouchableOpacity
            style={[styles.createBtn, selected.length === 0 && styles.createBtnDisabled]}
            onPress={createConversation}
            disabled={selected.length === 0 || isCreating}
          >
            {isCreating ? (
              <ActivityIndicator size="small" color={colors.primary.gold} />
            ) : (
              <Text
                style={[
                  styles.createBtnText,
                  selected.length === 0 && styles.createBtnTextDisabled,
                ]}
              >
                Utwórz
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Group name (shows when 2+ selected) */}
        {isGroupMode && (
          <View style={styles.groupNameContainer}>
            <Feather name="users" size={16} color={colors.primary.gold} />
            <TextInput
              style={styles.groupNameInput}
              placeholder="Nazwa grupy (opcjonalnie)"
              placeholderTextColor={colors.text.tertiary}
              value={groupName}
              onChangeText={setGroupName}
            />
          </View>
        )}

        {/* Selected chips */}
        {selected.length > 0 && (
          <View style={styles.selectedContainer}>
            {selected.map((id) => {
              const emp = employees.find((e) => e.id === id);
              if (!emp) return null;
              return (
                <TouchableOpacity
                  key={id}
                  style={styles.selectedChip}
                  onPress={() => toggleSelect(id)}
                >
                  <Text style={styles.selectedChipText}>
                    {emp.nickname || emp.name}
                  </Text>
                  <Feather name="x" size={12} color={colors.primary.gold} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Search */}
        <View style={styles.searchContainer}>
          <Feather name="search" size={16} color={colors.text.tertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Szukaj pracownika..."
            placeholderTextColor={colors.text.tertiary}
            value={search}
            onChangeText={setSearch}
            autoFocus
          />
        </View>

        {/* Employee list */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary.gold} />
          </View>
        ) : (
          <FlatList
            data={filteredEmployees}
            renderItem={renderEmployee}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>Nie znaleziono pracowników</Text>
              </View>
            }
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  closeBtnText: {
    fontSize: typography.fontSizes.md,
    color: colors.text.secondary,
  },
  headerTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold as any,
    color: colors.text.primary,
  },
  createBtn: {
    padding: spacing.xs,
  },
  createBtnDisabled: {
    opacity: 0.4,
  },
  createBtnText: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold as any,
    color: colors.primary.gold,
  },
  createBtnTextDisabled: {
    color: colors.text.tertiary,
  },
  groupNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  groupNameInput: {
    flex: 1,
    fontSize: typography.fontSizes.md,
    color: colors.text.primary,
  },
  selectedContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary.gold + '20',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.primary.gold + '40',
  },
  selectedChipText: {
    fontSize: typography.fontSizes.xs,
    color: colors.primary.gold,
    fontWeight: typography.fontWeights.medium as any,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    height: 38,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.sm,
    fontSize: typography.fontSizes.sm,
    color: colors.text.primary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  employeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  employeeRowSelected: {
    backgroundColor: colors.primary.gold + '08',
  },
  employeeInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  employeeName: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.medium as any,
    color: colors.text.primary,
  },
  employeeSubtext: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },
  employeeRole: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.secondary,
    marginTop: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border.default,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.primary.gold,
    borderColor: colors.primary.gold,
  },
  emptyContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.tertiary,
  },
});
