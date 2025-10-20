import React, { useState, useEffect } from 'react';
import { TouchableOpacity, View, Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

import DashboardScreen from '../screens/DashboardScreen';
import CalendarScreen from '../screens/CalendarScreen';
import TasksStackNavigator from './TasksStackNavigator';
import ClientsScreen from '../screens/ClientsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import CustomDrawer from '../components/CustomDrawer';

export type MainTabParamList = {
  Dashboard: undefined;
  Calendar: undefined;
  Tasks: undefined;
  Clients: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator() {
  const navigation = useNavigation();
  const { employee } = useAuth();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [currentScreen, setCurrentScreen] = useState('Dashboard');
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (employee?.id) {
      fetchUnreadNotifications();

      const channel = supabase
        .channel('notification_recipients_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notification_recipients',
            filter: `employee_id=eq.${employee.id}`,
          },
          () => {
            fetchUnreadNotifications();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [employee?.id]);

  const fetchUnreadNotifications = async () => {
    if (!employee?.id) return;

    try {
      const { count } = await supabase
        .from('notification_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', employee.id)
        .eq('is_read', false);

      setUnreadCount(count || 0);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  return (
    <>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: true,
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => setDrawerVisible(true)}
              style={{ marginLeft: 16 }}
            >
              <Feather name="menu" color={colors.text.primary} size={24} />
            </TouchableOpacity>
          ),
          headerTitle: () => (
            <View style={{ alignItems: 'center' }}>
              <Text style={{
                fontSize: 18,
                fontWeight: '700',
                color: colors.primary.gold,
                letterSpacing: 1,
              }}>
                MAVINCI CRM
              </Text>
            </View>
          ),
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigation.navigate('Notifications' as never)}
              style={{ marginRight: 16, position: 'relative' }}
            >
              <Feather name="bell" color={colors.text.primary} size={24} />
              {unreadCount > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    backgroundColor: colors.status.error,
                    borderRadius: 10,
                    minWidth: 20,
                    height: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                  }}
                >
                  <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ),
          headerStyle: {
            backgroundColor: colors.background.secondary,
          },
          headerTintColor: colors.text.primary,
          tabBarStyle: {
            backgroundColor: colors.background.secondary,
            borderTopColor: colors.border.default,
            borderTopWidth: 1,
          },
          tabBarActiveTintColor: colors.primary.gold,
          tabBarInactiveTintColor: colors.text.tertiary,
        })}
        screenListeners={{
          state: (e) => {
            const state = e.data.state;
            if (state) {
              const currentRoute = state.routes[state.index];
              setCurrentScreen(currentRoute.name);
            }
          },
        }}
      >
        <Tab.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color, size }) => <Feather name="home" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Calendar"
          component={CalendarScreen}
          options={{
            title: 'Kalendarz',
            tabBarIcon: ({ color, size }) => <Feather name="calendar" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Tasks"
          component={TasksStackNavigator}
          options={{
            title: 'Zadania',
            tabBarIcon: ({ color, size }) => <Feather name="check-square" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Clients"
          component={ClientsScreen}
          options={{
            title: 'Klienci',
            tabBarIcon: ({ color, size }) => <Feather name="users" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: 'Ustawienia',
            tabBarIcon: ({ color, size }) => <Feather name="settings" color={color} size={size} />,
          }}
        />
      </Tab.Navigator>

      <CustomDrawer
        visible={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        navigation={navigation}
        currentScreen={currentScreen}
      />
    </>
  );
}
