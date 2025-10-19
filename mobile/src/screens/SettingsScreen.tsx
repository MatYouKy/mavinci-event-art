import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { LogOut, User, Bell, Lock, Info } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, typography, borderRadius } from '../theme';

export default function SettingsScreen() {
  const { employee, signOut } = useAuth();

  const handleSignOut = () => {
    Alert.alert(
      'Wylogowanie',
      'Czy na pewno chcesz się wylogować?',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Wyloguj',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
            } catch (error) {
              Alert.alert('Błąd', 'Nie udało się wylogować');
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      {/* User Info */}
      <View style={styles.userSection}>
        <View style={styles.avatar}>
          <User color={colors.primary.gold} size={32} />
        </View>
        <Text style={styles.userName}>
          {employee?.nickname || `${employee?.name} ${employee?.surname}`}
        </Text>
        <Text style={styles.userEmail}>{employee?.email}</Text>
        {employee?.role && (
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{employee.role}</Text>
          </View>
        )}
      </View>

      {/* Settings Options */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Ustawienia</Text>

        <TouchableOpacity style={styles.menuItem}>
          <View style={styles.menuIcon}>
            <User color={colors.text.secondary} size={20} />
          </View>
          <Text style={styles.menuText}>Profil</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem}>
          <View style={styles.menuIcon}>
            <Bell color={colors.text.secondary} size={20} />
          </View>
          <Text style={styles.menuText}>Powiadomienia</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem}>
          <View style={styles.menuIcon}>
            <Lock color={colors.text.secondary} size={20} />
          </View>
          <Text style={styles.menuText}>Bezpieczeństwo</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem}>
          <View style={styles.menuIcon}>
            <Info color={colors.text.secondary} size={20} />
          </View>
          <Text style={styles.menuText}>O aplikacji</Text>
        </TouchableOpacity>
      </View>

      {/* Sign Out */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
        >
          <LogOut color={colors.status.error} size={20} />
          <Text style={styles.signOutText}>Wyloguj się</Text>
        </TouchableOpacity>
      </View>

      {/* Version */}
      <View style={styles.footer}>
        <Text style={styles.version}>Mavinci CRM Mobile v1.0.0</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  userSection: {
    alignItems: 'center',
    padding: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.full,
    backgroundColor: colors.background.secondary,
    borderWidth: 2,
    borderColor: colors.primary.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  userName: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.bold,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  userEmail: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
    marginBottom: spacing.sm,
  },
  roleBadge: {
    backgroundColor: colors.primary.gold + '20',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  roleText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
    color: colors.primary.gold,
    textTransform: 'uppercase',
  },
  section: {
    padding: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  menuText: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.medium,
    color: colors.text.primary,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.secondary,
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.status.error + '40',
    gap: spacing.sm,
  },
  signOutText: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold,
    color: colors.status.error,
  },
  footer: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  version: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },
});
