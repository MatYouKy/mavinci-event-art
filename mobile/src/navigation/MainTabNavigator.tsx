import React, { useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme';

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
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [currentScreen, setCurrentScreen] = useState('Dashboard');

  const handleNavigate = (screen: string) => {
    setCurrentScreen(screen);
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
            headerShown: false,
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
        onNavigate={handleNavigate}
        currentScreen={currentScreen}
      />
    </>
  );
}
