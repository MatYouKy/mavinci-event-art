import React, { useSyncExternalStore } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Animated,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, typography, borderRadius } from '../theme';
import { getVisibleMenuItems } from '../lib/permissions';
import EmployeeAvatar from './EmployeeAvatar';
import { APP_VERSION } from '../lib/appVersion';
import { TABLET_SIDEBAR_WIDTH } from '../hooks/useTabletLayout';
import { navigateToEventsList } from '../navigation/navigationRef';

const DRAWER_WIDTH = TABLET_SIDEBAR_WIDTH;

/*
 * Menu aplikacji: wysuwane z lewej (przycisk „burger” — telefon i tablet w pionie) albo stały pasek boczny na tablecie
 * w poziomie (`DrawerContent` w `RootNavigator`, jak CRM na komputerze). Pozycje według uprawnień (`getVisibleMenuItems`).
 */

/*
 * Liczniki przy pozycjach menu (np. nieprzeczytane w Komunikatorze). Na tablecie w poziomie dolny pasek zakładek jest
 * ukryty, więc licznik z zakładki pokazuje menu; ustawia go `MainTabNavigator` (`setMenuBadge`).
 */
let menuBadges: Record<string, number> = {};
const menuBadgeListeners = new Set<() => void>();

export function setMenuBadge(screen: string, count: number) {
  const next = Math.max(0, Math.floor(count) || 0);
  if ((menuBadges[screen] ?? 0) === next) return;
  menuBadges = { ...menuBadges, [screen]: next };
  menuBadgeListeners.forEach((listener) => listener());
}

function subscribeMenuBadges(listener: () => void) {
  menuBadgeListeners.add(listener);
  return () => { menuBadgeListeners.delete(listener); };
}

function useMenuBadges() {
  return useSyncExternalStore(subscribeMenuBadges, () => menuBadges, () => menuBadges);
}

interface DrawerProps {
  visible: boolean;
  onClose: () => void;
  navigation: any;
  currentScreen?: string;
}

export default function CustomDrawer({ visible, onClose, navigation, currentScreen }: DrawerProps) {
  const slideAnim = React.useRef(new Animated.Value(-DRAWER_WIDTH)).current;

  React.useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 0 : -DRAWER_WIDTH,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  const handleNavigate = (screen: string) => {
    onClose();
    if (screen === 'Tasks') {
      navigation.navigate('Tasks', { screen: 'TasksList', initial: false });
    } else if (screen === 'Events') {
      // Zawsze lista eventów, nie ostatnio otwarty event (np. z dashboardu).
      navigateToEventsList();
    } else if (screen === 'Inquiries') {
      navigation.navigate('Inquiries', { screen: 'InquiriesList', initial: false });
    } else {
      navigation.navigate(screen);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.drawer,
            {
              transform: [{ translateX: slideAnim }],
            },
          ]}
        >
          <DrawerContent currentScreen={currentScreen} onNavigate={handleNavigate} onSignedOut={onClose} />
        </Animated.View>

        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
      </View>
    </Modal>
  );
}

/** Stały pasek boczny tabletu w poziomie (jak menu CRM na komputerze) — te same pozycje i uprawnienia co menu „burger”. */
export function TabletSidebar({ currentScreen, onNavigate }: { currentScreen?: string; onNavigate: (screen: string) => void }) {
  return (
    <View style={styles.sidebar}>
      <SafeAreaView edges={['top', 'left']} style={styles.sidebarTop} />
      <SafeAreaView edges={['left', 'bottom']} style={styles.sidebarBody}>
        <DrawerContent currentScreen={currentScreen} onNavigate={onNavigate} permanent />
      </SafeAreaView>
    </View>
  );
}

/**
 * Zawartość menu: pracownik, pozycje według uprawnień, wylogowanie i wersja. `permanent` — stały pasek boczny (tablet
 * w poziomie): nagłówek bez odstępu na pasek stanu (zapewnia go obszar bezpieczny paska).
 */
export function DrawerContent({ currentScreen, onNavigate, onSignedOut, permanent = false }: {
  currentScreen?: string;
  onNavigate: (screen: string) => void;
  onSignedOut?: () => void;
  permanent?: boolean;
}) {
  const { employee, signOut } = useAuth();
  const badges = useMenuBadges();

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
              onSignedOut?.();
            } catch (error) {
              Alert.alert('Błąd', 'Nie udało się wylogować');
            }
          },
        },
      ]
    );
  };

  const menuItems = getVisibleMenuItems(employee);

  return (
    <>
          {/* Compact Header with user info */}
          <View style={[styles.drawerHeader, permanent && styles.drawerHeaderPermanent]}>
            <View style={styles.userRow}>
              <EmployeeAvatar
                avatarUrl={employee?.avatar_url}
                avatarMetadata={employee?.avatar_metadata}
                employeeName={employee?.nickname || employee?.name || 'Użytkownik'}
                size={48}
              />
              <View style={styles.userInfo}>
                <Text style={styles.userName} numberOfLines={1}>
                  {employee?.nickname || employee?.name || 'Użytkownik'}
                </Text>
                {employee?.role && (
                  <Text style={styles.userRole} numberOfLines={1}>
                    {employee.role}
                  </Text>
                )}
              </View>
            </View>
          </View>

          {/* Menu Items */}
          <ScrollView style={styles.menuContainer} showsVerticalScrollIndicator={false}>
            <View style={styles.menuSection}>
              {menuItems.map((item, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.menuItem,
                    currentScreen === item.screen && styles.menuItemActive,
                  ]}
                  onPress={() => onNavigate(item.screen)}
                >
                  <Feather
                    name={item.icon as any}
                    color={currentScreen === item.screen ? colors.primary.gold : colors.text.secondary}
                    size={20}
                  />
                  <Text style={[
                    styles.menuItemText,
                    currentScreen === item.screen && styles.menuItemTextActive,
                  ]}>
                    {item.label}
                  </Text>
                  {(badges[item.screen] ?? 0) > 0 && (
                    <View style={styles.menuBadge}>
                      <Text style={styles.menuBadgeText}>{badges[item.screen] > 99 ? '99+' : badges[item.screen]}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Footer with logout */}
          <View style={styles.drawerFooter}>
            <TouchableOpacity style={styles.logoutButton} onPress={handleSignOut}>
              <Feather name="log-out" color={colors.status.error} size={18} />
              <Text style={styles.logoutText}>Wyloguj</Text>
            </TouchableOpacity>
            <Text style={styles.version}>v{APP_VERSION}</Text>
          </View>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  drawer: {
    width: DRAWER_WIDTH,
    backgroundColor: colors.background.primary,
    borderRightWidth: 1,
    borderRightColor: colors.border.default,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sidebar: {
    width: TABLET_SIDEBAR_WIDTH,
    backgroundColor: colors.background.primary,
    borderRightWidth: 1,
    borderRightColor: colors.border.default,
  },
  sidebarTop: {
    backgroundColor: colors.background.secondary,
  },
  sidebarBody: {
    flex: 1,
  },
  drawerHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  drawerHeaderPermanent: {
    paddingTop: spacing.lg,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.bold,
    color: colors.text.primary,
    marginBottom: 2,
  },
  userRole: {
    fontSize: typography.fontSizes.xs,
    color: colors.primary.gold,
    textTransform: 'uppercase',
  },
  menuContainer: {
    flex: 1,
    paddingTop: spacing.md,
  },
  menuSection: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.background.secondary,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border.default,
    gap: spacing.md,
  },
  menuItemActive: {
    backgroundColor: colors.primary.gold + '20',
    borderColor: colors.primary.gold + '40',
  },
  menuItemText: {
    flex: 1,
    fontFamily: typography.fontFamilies.heading,
    fontSize: typography.fontSizes.xs,
    fontWeight: '400',
    letterSpacing: 0.35,
    textTransform: 'uppercase',
    color: colors.text.primary,
  },
  menuItemTextActive: {
    color: colors.primary.gold,
  },
  menuBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.status.error,
  },
  menuBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  drawerFooter: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
    gap: spacing.sm,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    backgroundColor: colors.background.secondary,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.status.error + '40',
    gap: spacing.sm,
  },
  logoutText: {
    fontFamily: typography.fontFamilies.heading,
    fontSize: typography.fontSizes.xs,
    fontWeight: '400',
    letterSpacing: 0.35,
    textTransform: 'uppercase',
    color: colors.status.error,
  },
  version: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
    textAlign: 'center',
  },
});
