import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { canView, canManage, hasPermission, isAdmin, ModuleName } from '../lib/permissions';
import { colors, spacing, typography } from '../theme';

interface Props {
  children: React.ReactNode;
  module?: ModuleName;
  permission?: string;
  requireManage?: boolean;
  fallback?: React.ReactNode;
}

export default function PermissionGate({
  children,
  module,
  permission,
  requireManage = false,
  fallback,
}: Props) {
  const { employee } = useAuth();

  const hasAccess = (): boolean => {
    if (!employee) return false;
    if (isAdmin(employee)) return true;

    if (permission) {
      return hasPermission(employee, permission);
    }

    if (module) {
      return requireManage ? canManage(employee, module) : canView(employee, module);
    }

    return true;
  };

  if (!hasAccess()) {
    if (fallback) return <>{fallback}</>;

    return (
      <View style={styles.container}>
        <Feather name="shield-off" size={48} color={colors.status.error} />
        <Text style={styles.title}>Brak uprawnień</Text>
        <Text style={styles.subtitle}>
          Nie masz dostępu do tej sekcji.
          {module && `\nWymagane: ${module}_view`}
        </Text>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background.primary,
  },
  title: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold as any,
    color: colors.text.primary,
    marginTop: spacing.md,
  },
  subtitle: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.tertiary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
});
