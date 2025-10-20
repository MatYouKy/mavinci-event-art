import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { createDrawerNavigator, DrawerContentComponentProps } from '@react-navigation/drawer';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, typography, borderRadius } from '../theme';

import MainTabNavigator from './MainTabNavigator';
import NotificationsScreen from '../screens/NotificationsScreen';

export type DrawerParamList = {
  MainTabs: undefined;
  Notifications: undefined;
};

const Drawer = createDrawerNavigator<DrawerParamList>();

function CustomDrawerContent(props: DrawerContentComponentProps) {
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

  const menuItems = [
    {
      icon: 'home',
      label: 'Dashboard',
      onPress: () => props.navigation.navigate('MainTabs'),
    },
    {
      icon: 'calendar',
      label: 'Kalendarz',
      onPress: () => props.navigation.navigate('MainTabs', { screen: 'Calendar' }),
    },
    {
      icon: 'check-square',
      label: 'Zadania',
      onPress: () => props.navigation.navigate('MainTabs', { screen: 'Tasks' }),
    },
    {
      icon: 'users',
      label: 'Klienci',
      onPress: () => props.navigation.navigate('MainTabs', { screen: 'Clients' }),
    },
    {
      icon: 'settings',
      label: 'Ustawienia',
      onPress: () => props.navigation.navigate('MainTabs', { screen: 'Settings' }),
    },
  ];

  return (
    <View style={styles.drawerContainer}>
      {/* Header with user info */}
      <View style={styles.drawerHeader}>
        <View style={styles.avatar}>
          <Feather name="user" color={colors.primary.gold} size={32} />
        </View>
        <Text style={styles.userName} numberOfLines={1}>
          {employee?.nickname || employee?.name}
        </Text>
        <Text style={styles.userEmail} numberOfLines={1}>
          {employee?.email}
        </Text>
        {employee?.role && (
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{employee.role}</Text>
          </View>
        )}
      </View>

      {/* Menu Items */}
      <ScrollView style={styles.menuContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.menuSection}>
          <Text style={styles.sectionTitle}>NAWIGACJA</Text>
          {menuItems.map((item, index) => (
            <TouchableOpacity
              key={index}
              style={styles.menuItem}
              onPress={item.onPress}
            >
              <Feather name={item.icon as any} color={colors.text.secondary} size={20} />
              <Text style={styles.menuItemText}>{item.label}</Text>
              <Feather name="chevron-right" color={colors.text.tertiary} size={16} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Footer with logout */}
      <View style={styles.drawerFooter}>
        <TouchableOpacity style={styles.logoutButton} onPress={handleSignOut}>
          <Feather name="log-out" color={colors.status.error} size={20} />
          <Text style={styles.logoutText}>Wyloguj się</Text>
        </TouchableOpacity>
        <Text style={styles.version}>Mavinci CRM Mobile v1.0.0</Text>
      </View>
    </View>
  );
}

export default function DrawerNavigator() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerStyle: {
          backgroundColor: colors.background.primary,
          width: 280,
        },
        swipeEnabled: true,
        unmountOnBlur: false,
      }}
    >
      <Drawer.Screen name="MainTabs" component={MainTabNavigator} />
      <Drawer.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          headerShown: true,
          title: 'Powiadomienia',
        }}
      />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  drawerContainer: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  drawerHeader: {
    padding: spacing.xl,
    paddingTop: spacing.xxxl,
    backgroundColor: colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    alignItems: 'center',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.full,
    backgroundColor: colors.background.tertiary,
    borderWidth: 2,
    borderColor: colors.primary.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  userName: {
    fontSize: typography.fontSizes.lg,
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
  menuContainer: {
    flex: 1,
    paddingTop: spacing.md,
  },
  menuSection: {
    paddingHorizontal: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text.tertiary,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background.secondary,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  menuItemText: {
    flex: 1,
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.medium,
    color: colors.text.primary,
    marginLeft: spacing.md,
  },
  drawerFooter: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
    gap: spacing.md,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: colors.background.secondary,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.status.error + '40',
    gap: spacing.sm,
  },
  logoutText: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold,
    color: colors.status.error,
  },
  version: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
    textAlign: 'center',
  },
});
