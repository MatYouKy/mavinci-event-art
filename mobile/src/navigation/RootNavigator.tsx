import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from './navigationRef';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, typography } from '../theme';

import LoginScreen from '../screens/LoginScreen';
import MainTabNavigator from './MainTabNavigator';
import NotificationsScreen from '../screens/NotificationsScreen';
import EmailMessageDetailScreen from '../screens/EmailMessageDetailScreen';
import InboundEventDetailScreen from '../screens/InboundEventDetailScreen';
import ContactMessageDetailScreen from '../screens/ContactMessageDetailScreen';
import MyCommissionsScreen from '../screens/MyCommissionsScreen';
import SellerCockpitScreen from '../screens/SellerCockpitScreen';
import SellerDetailScreen from '../screens/SellerDetailScreen';
import SellerHelpScreen from '../screens/SellerHelpScreen';
import SocialMediaScreen from '../screens/SocialMediaScreen';
import SocialPostScreen from '../screens/SocialPostScreen';
import SocialQuickPostScreen from '../screens/SocialQuickPostScreen';

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  Notifications: undefined;
  EmailMessageDetail: { messageId: string };
  InboundEventDetail: { eventId: string };
  ContactMessageDetail: { messageId: string };
  MyCommissions: undefined;
  SellerCockpit: undefined;
  SellerDetail: { sellerId: string; contactId: string | null; name: string; organization: string | null };
  /** Instrukcja opiekuna sprzedawców; `chapter` — rozdział otwarty na start (id z managerHelp.ts). */
  SellerHelp: { chapter?: string } | undefined;
  /** Marketing → Social media: akceptacja szkiców, plan publikacji, biblioteka zdjęć marki. */
  SocialMedia: { segment?: 'comments' | 'stats'; report?: string } | undefined;
  /** `comments` — z powiadomienia o komentarzach (przewinięcie do komentarzy). */
  SocialPost: { postId: string; comments?: boolean };
  /** Szybki post lub relacja z szablonu; parametry — zdjęcie z biblioteki, marka i wydarzenie. */
  SocialQuickPost: {
    companyId?: string | null; assetId?: string; assetThumb?: string | null; eventId?: string | null; eventName?: string | null;
  } | undefined;
  PdfViewer: { url: string };
  EventDetail: {
    eventId: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background.primary }}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={{
        dark: true,
        colors: {
          primary: colors.primary.gold,
          background: colors.background.primary,
          card: colors.background.secondary,
          text: colors.text.primary,
          border: colors.border.default,
          notification: colors.status.error,
        },
      }}
    >
      <Stack.Navigator screenOptions={{
        headerShown: false,
        headerTitleStyle: {
          fontFamily: typography.fontFamilies.heading,
          fontWeight: '400',
        },
      }}>
        {session ? (
          <>
            <Stack.Screen name="Main" component={MainTabNavigator} />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{
                headerShown: true,
                title: 'Powiadomienia'.toLocaleUpperCase('pl-PL'),
                headerStyle: {
                  backgroundColor: colors.background.secondary,
                },
                headerTintColor: colors.text.primary,
              }}
            />
            <Stack.Screen
              name="EmailMessageDetail"
              component={EmailMessageDetailScreen}
              options={{
                headerShown: true,
                title: 'Wiadomość e-mail'.toLocaleUpperCase('pl-PL'),
                headerStyle: { backgroundColor: colors.background.secondary },
                headerTintColor: colors.text.primary,
              }}
            />
            <Stack.Screen
              name="InboundEventDetail"
              component={InboundEventDetailScreen}
              options={{
                headerShown: true,
                title: 'Wiadomość z formularza'.toLocaleUpperCase('pl-PL'),
                headerStyle: { backgroundColor: colors.background.secondary },
                headerTintColor: colors.text.primary,
              }}
            />
            <Stack.Screen
              name="ContactMessageDetail"
              component={ContactMessageDetailScreen}
              options={{
                headerShown: true,
                title: 'Wiadomość kontaktowa'.toLocaleUpperCase('pl-PL'),
                headerStyle: { backgroundColor: colors.background.secondary },
                headerTintColor: colors.text.primary,
              }}
            />
            <Stack.Screen
              name="MyCommissions"
              component={MyCommissionsScreen}
              options={{
                headerShown: true,
                title: 'Moje prowizje'.toLocaleUpperCase('pl-PL'),
                headerStyle: { backgroundColor: colors.background.secondary },
                headerTintColor: colors.text.primary,
              }}
            />
            <Stack.Screen
              name="SellerCockpit"
              component={SellerCockpitScreen}
              options={({ navigation }) => ({
                headerShown: true,
                title: 'Moi sprzedawcy'.toLocaleUpperCase('pl-PL'),
                headerStyle: { backgroundColor: colors.background.secondary },
                headerTintColor: colors.text.primary,
                headerRight: () => (
                  <HelpButton onPress={() => navigation.navigate('SellerHelp', { chapter: 'kokpit' })} />
                ),
              })}
            />
            <Stack.Screen
              name="SellerDetail"
              component={SellerDetailScreen}
              options={({ navigation }) => ({
                headerShown: true,
                title: 'Sprzedawca'.toLocaleUpperCase('pl-PL'),
                headerStyle: { backgroundColor: colors.background.secondary },
                headerTintColor: colors.text.primary,
                headerRight: () => (
                  <HelpButton onPress={() => navigation.navigate('SellerHelp', { chapter: 'nowy-sprzedawca' })} />
                ),
              })}
            />
            <Stack.Screen
              name="SellerHelp"
              component={SellerHelpScreen}
              options={{
                headerShown: true,
                title: 'Instrukcja opiekuna'.toLocaleUpperCase('pl-PL'),
                headerStyle: { backgroundColor: colors.background.secondary },
                headerTintColor: colors.text.primary,
              }}
            />
            <Stack.Screen
              name="SocialMedia"
              component={SocialMediaScreen}
              options={{
                headerShown: true,
                title: 'Social media'.toLocaleUpperCase('pl-PL'),
                headerStyle: { backgroundColor: colors.background.secondary },
                headerTintColor: colors.text.primary,
              }}
            />
            <Stack.Screen
              name="SocialPost"
              component={SocialPostScreen}
              options={{
                headerShown: true,
                title: 'Post'.toLocaleUpperCase('pl-PL'),
                headerStyle: { backgroundColor: colors.background.secondary },
                headerTintColor: colors.text.primary,
              }}
            />
            <Stack.Screen
              name="SocialQuickPost"
              component={SocialQuickPostScreen}
              options={{
                headerShown: true,
                title: 'Szybki post'.toLocaleUpperCase('pl-PL'),
                headerStyle: { backgroundColor: colors.background.secondary },
                headerTintColor: colors.text.primary,
              }}
            />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/** „?” w nagłówku ekranów sprzedawców — instrukcja opiekuna (ta sama treść co w CRM i na Macu). */
function HelpButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel="Instrukcja opiekuna sprzedawców"
    >
      <Feather name="help-circle" size={20} color={colors.primary.gold} />
    </TouchableOpacity>
  );
}
