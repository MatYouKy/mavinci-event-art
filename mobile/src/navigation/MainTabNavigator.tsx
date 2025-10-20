import React from 'react';
import { TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme';

import DashboardScreen from '../screens/DashboardScreen';
import CalendarScreen from '../screens/CalendarScreen';
import TasksScreen from '../screens/TasksScreen';
import ClientsScreen from '../screens/ClientsScreen';
import SettingsScreen from '../screens/SettingsScreen';

export type MainTabParamList = {
  Dashboard: undefined;
  Calendar: undefined;
  Tasks: undefined;
  Clients: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

function HamburgerButton() {
  const navigation = useNavigation();

  return (
    <TouchableOpacity
      onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
      style={{ marginLeft: 16 }}
    >
      <Feather name="menu" color={colors.text.primary} size={24} />
    </TouchableOpacity>
  );
}

export default function MainTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        headerLeft: () => <HamburgerButton />,
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
        component={TasksScreen}
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
  );
}
