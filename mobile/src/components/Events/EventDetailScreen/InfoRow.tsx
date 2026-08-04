import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Alert,
  Image,
  Modal,
  Pressable,
  Dimensions,
  TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../../theme';
import { supabase, supabaseUrl } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { canView } from '../../../lib/permissions';
import { STATUS_COLORS, STATUS_LABELS } from '../../../screens/EventsScreen';
import { ChecklistItem, ChecklistTab, EventEquipmentItem, LogisticsItem } from './ChecklistTab';
import { EventFile, FilesTab } from './FilesTab';
import { AgendaTab } from './AgendaTab';

export function InfoRow({
  icon,
  label,
  value,
  highlight,
}: {
  icon: string;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Feather name={icon as any} size={14} color={colors.text.tertiary} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text
        style={[styles.infoValue, highlight && { color: colors.primary.gold }]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoLabel: { fontSize: 12, color: colors.text.tertiary, width: 100 },
  infoValue: { flex: 1, fontSize: 13, color: colors.text.primary, fontWeight: '500' },
});
