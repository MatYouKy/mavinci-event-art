import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Animated,
  Dimensions,
  Alert,
  Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, typography, borderRadius } from '../theme';

const { width } = Dimensions.get('window');
const DRAWER_WIDTH = 280;

interface DrawerProps {
  visible: boolean;
  onClose: () => void;
  navigation: any;
  currentScreen?: string;
}

export default function CustomDrawer({ visible, onClose, navigation, currentScreen }: DrawerProps) {
  const { employee, signOut } = useAuth();
  const slideAnim = React.useRef(new Animated.Value(-DRAWER_WIDTH)).current;

  React.useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 0 : -DRAWER_WIDTH,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible]);

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
              onClose();
            } catch (error) {
              Alert.alert('Błąd', 'Nie udało się wylogować');
            }
          },
        },
      ]
    );
  };

  const menuItems = [
    { icon: 'home', label: 'Dashboard', screen: 'Dashboard' },
    { icon: 'calendar', label: 'Kalendarz', screen: 'Calendar' },
    { icon: 'check-square', label: 'Zadania', screen: 'Tasks' },
    { icon: 'users', label: 'Klienci', screen: 'Clients' },
    { icon: 'settings', label: 'Ustawienia', screen: 'Settings' },
  ];

  const handleNavigate = (screen: string) => {
    onClose();
    navigation.navigate(screen);
  };

  const getAvatarSource = () => {
    if (employee?.avatar_url) {
      return { uri: employee.avatar_url };
    }
    return null;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
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
          {/* Compact Header with user info */}
          <View style={styles.drawerHeader}>
            <View style={styles.userRow}>
              <View style={styles.avatarContainer}>
                {getAvatarSource() ? (
                  <Image
                    source={getAvatarSource()!}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Feather name="user" color={colors.primary.gold} size={20} />
                )}
              </View>
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
                  onPress={() => handleNavigate(item.screen)}
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
            <Text style={styles.version}>v1.0.0</Text>
          </View>
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
  drawerHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarContainer: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.background.tertiary,
    borderWidth: 2,
    borderColor: colors.primary.gold,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
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
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.medium,
    color: colors.text.primary,
  },
  menuItemTextActive: {
    color: colors.primary.gold,
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
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    color: colors.status.error,
  },
  version: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
    textAlign: 'center',
  },
});
