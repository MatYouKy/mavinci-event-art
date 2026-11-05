import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { colors, spacing } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import EmployeeAvatar from '../components/EmployeeAvatar';
import { type MyCommissions, formatPln } from '../lib/eventSettlement';
import { fetchMyCommissions } from '../lib/eventSettlementApi';

export default function ProfileScreen() {
  const { employee, signOut } = useAuth();
  const navigation = useNavigation<any>();
  const focused = useIsFocused();
  // „Moje prowizje” (get_my_commissions). Wejście widać, gdy baza zwraca konto prowizji z włączoną prowizją albo
  // z wpisami; przed wdrożeniem migracji (brak RPC) i bez konta pracownika (42501) — bez wejścia i bez komunikatu.
  const [commissions, setCommissions] = useState<MyCommissions | null>(null);
  useEffect(() => {
    if (!focused || !employee?.id) return;
    let active = true;
    void fetchMyCommissions().then((result) => {
      if (!active) return;
      if (result.status === 'ready') setCommissions(result.data);
      else if (result.status !== 'error') setCommissions(null);
    });
    return () => {
      active = false;
    };
  }, [focused, employee?.id]);
  const showCommissions = Boolean(commissions && (commissions.enabled || commissions.commissions.length > 0));

  const handleSignOut = () => {
    Alert.alert('Wylogowanie', 'Czy na pewno chcesz się wylogować?', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Wyloguj',
        style: 'destructive',
        onPress: () => signOut(),
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Avatar & name */}
      <View style={styles.profileHeader}>
        <EmployeeAvatar
          avatarUrl={employee?.avatar_url}
          avatarMetadata={employee?.avatar_metadata}
          employeeName={employee?.nickname || employee?.name || 'Użytkownik'}
          size={80}
        />
        <Text style={styles.name}>
          {employee?.name} {employee?.surname}
        </Text>
        {employee?.nickname && (
          <Text style={styles.nickname}>{employee.nickname}</Text>
        )}
        {employee?.role && <Text style={styles.role}>{employee.role}</Text>}
      </View>

      {/* Info cards */}
      <View style={styles.section}>
        {employee?.email && (
          <View style={styles.infoRow}>
            <Feather name="mail" size={16} color={colors.text.tertiary} />
            <Text style={styles.infoText}>{employee.email}</Text>
          </View>
        )}
        {employee?.phone && (
          <View style={styles.infoRow}>
            <Feather name="phone" size={16} color={colors.text.tertiary} />
            <Text style={styles.infoText}>{employee.phone}</Text>
          </View>
        )}
      </View>

      {/* Moje prowizje */}
      {showCommissions && commissions && (
        <TouchableOpacity
          style={styles.menuRow}
          accessibilityRole="button"
          accessibilityLabel="Moje prowizje"
          onPress={() => navigation.navigate('MyCommissions')}
        >
          <View style={styles.menuIcon}>
            <Feather name="percent" size={18} color={colors.primary.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuTitle}>Moje prowizje</Text>
            <Text style={styles.menuSubtitle}>
              Do wypłaty {formatPln(commissions.totals.to_pay)} · Prognoza {formatPln(commissions.totals.forecast)}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.text.tertiary} />
        </TouchableOpacity>
      )}

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleSignOut}>
        <Feather name="log-out" size={18} color={colors.status.error} />
        <Text style={styles.logoutText}>Wyloguj się</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  content: {
    padding: spacing.md,
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text.primary,
    marginTop: 12,
  },
  nickname: {
    fontSize: 14,
    color: colors.primary.gold,
    fontWeight: '500',
  },
  role: {
    fontSize: 12,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoText: {
    fontSize: 14,
    color: colors.text.primary,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.tertiary,
  },
  menuTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.primary,
  },
  menuSubtitle: {
    fontSize: 12,
    color: colors.text.secondary,
    marginTop: 2,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    padding: 14,
    marginTop: 24,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.status.error + '30',
  },
  logoutText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.status.error,
  },
});
