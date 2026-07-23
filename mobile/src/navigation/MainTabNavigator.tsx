import React, { useState, useEffect } from 'react';
import { TouchableOpacity, View, Text, Image } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { colors } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

import DashboardScreen from '../screens/DashboardScreen';
import CalendarScreen from '../screens/CalendarScreen';
import MeetingsScreen from '../screens/MeetingsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';
import MessagesStackNavigator from './MessagesStackNavigator';
import TasksStackNavigator from './TasksStackNavigator';
import EventsStackNavigator from './EventsStackNavigator';
import EquipmentStackNavigator from './EquipmentStackNavigator';
import TimeTrackingScreen from '../screens/TimeTrackingScreen';
import EmployeesScreen from '../screens/EmployeesScreen';
import CustomDrawer from '../components/CustomDrawer';
import { useUnreadChatCount } from '../services/chatNotifications';
import { globalNotificationTarget } from '../../App';

export type MainTabParamList = {
  Dashboard: undefined;
  Calendar: undefined;
  Meetings: undefined;
  Profile: undefined;
  Settings: undefined;
  Messages: undefined;
  Events: undefined;
  Tasks: undefined;
  Equipment: undefined;
  TimeTracking: undefined;
  Employees: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator() {
  const navigation = useNavigation();
  const { employee } = useAuth();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [currentScreen, setCurrentScreen] = useState('Dashboard');
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingMeetingId, setPendingMeetingId] = useState<string | null>(null);
  const { unreadCount: unreadChatCount } = useUnreadChatCount(employee?.id);

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
            filter: `user_id=eq.${employee.id}`,
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
        .eq('user_id', employee.id)
        .eq('is_read', false);

      setUnreadCount(count || 0);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  // Handle notification taps - switch to the correct tab
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.type === 'chat_message' && data?.conversation_id) {
        setCurrentScreen('Messages');
      } else if (data?.type === 'meeting_reminder' && data?.meetingId) {
        setPendingMeetingId(data.meetingId as string);
        setCurrentScreen('Calendar');
        setTimeout(() => setPendingMeetingId(null), 1000);
      } else if (data?.type === 'crm_notification') {
        const entityType = data.entity_type as string | undefined;
        const category = data.category as string | undefined;
        if (entityType === 'task' || category === 'tasks') {
          setCurrentScreen('Tasks');
        } else if (entityType === 'event' || category === 'events' || category === 'team') {
          setCurrentScreen('Events');
        } else if (category === 'messages' || category === 'contact_form') {
          setCurrentScreen('Messages');
        }
      }
    });

    // Also check on mount for pending target from cold start
    if (globalNotificationTarget?.type === 'chat_message') {
      setCurrentScreen('Messages');
    } else if (globalNotificationTarget?.type === 'meeting_reminder') {
      setPendingMeetingId(globalNotificationTarget.meetingId ?? null);
      setCurrentScreen('Calendar');
      setTimeout(() => setPendingMeetingId(null), 1000);
    } else if (globalNotificationTarget?.type === 'crm_notification') {
      const entityType = globalNotificationTarget.entity_type;
      const category = globalNotificationTarget.category;
      if (entityType === 'task' || category === 'tasks') {
        setCurrentScreen('Tasks');
      } else if (entityType === 'event' || category === 'events' || category === 'team') {
        setCurrentScreen('Events');
      } else if (category === 'messages' || category === 'contact_form') {
        setCurrentScreen('Messages');
      }
    }

    return () => sub.remove();
  }, []);

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
              <Image
                source={require('../assets/logo.png')}
                style={{ height: 32, width: 120 }}
                resizeMode="contain"
              />
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
        {/* === Bottom tab bar items === */}
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
          options={{
            title: 'Kalendarz',
            tabBarIcon: ({ color, size }) => <Feather name="calendar" color={color} size={size} />,
          }}
        >
          {() => (
            <CalendarScreen
              initialMeetingId={pendingMeetingId}
              key={pendingMeetingId ?? 'calendar'}
            />
          )}
        </Tab.Screen>
        <Tab.Screen
          name="Meetings"
          component={MeetingsScreen}
          options={{
            title: 'Spotkania',
            headerShown: false,
            tabBarButton: () => null,
            tabBarIcon: ({ color, size }) => <Feather name="users" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Messages"
          component={MessagesStackNavigator}
          options={{
            title: 'Komunikator',
            headerShown: false,
            tabBarIcon: ({ color, size }) => <Feather name="message-circle" color={color} size={size} />,
            tabBarBadge: unreadChatCount > 0 ? (unreadChatCount > 99 ? '99+' : unreadChatCount) : undefined,
            tabBarBadgeStyle: {
              backgroundColor: colors.status.error,
              fontSize: 10,
              fontWeight: 'bold',
              minWidth: 18,
              height: 18,
              lineHeight: 14,
            },
          }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileScreen}
          options={{
            title: 'Profil',
            tabBarIcon: ({ color, size }) => <Feather name="user" color={color} size={size} />,
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

        {/* === Hidden from tab bar, accessible from drawer === */}
        <Tab.Screen
          name="Events"
          component={EventsStackNavigator}
          options={{
            title: 'Wydarzenia',
            tabBarButton: () => null,
            tabBarIcon: ({ color, size }) => <Feather name="star" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Tasks"
          component={TasksStackNavigator}
          options={{
            title: 'Zadania',
            tabBarButton: () => null,
            tabBarIcon: ({ color, size }) => <Feather name="check-square" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Equipment"
          component={EquipmentStackNavigator}
          options={{
            title: 'Sprzęt',
            tabBarButton: () => null,
            tabBarIcon: ({ color, size }) => <Feather name="package" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="TimeTracking"
          component={TimeTrackingScreen}
          options={{
            title: 'Czas pracy',
            tabBarButton: () => null,
            tabBarIcon: ({ color, size }) => <Feather name="clock" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Employees"
          component={EmployeesScreen}
          options={{
            title: 'Pracownicy',
            tabBarButton: () => null,
            tabBarIcon: ({ color, size }) => <Feather name="users" color={color} size={size} />,
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
