import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useRoute, useNavigation } from '@react-navigation/native';
import EventsScreen, { EventListItem } from '../screens/EventsScreen';
import EventDetailScreen from '../screens/EventDetailScreen';
import PermissionGate from '../components/PermissionGate';

export type EventsStackParamList = {
  EventsList: undefined;
  EventDetail: { eventId: string };
};

const Stack = createNativeStackNavigator<EventsStackParamList>();

function EventDetailWrapper() {
  const route = useRoute<any>();
  const navigation = useNavigation();
  const { eventId } = route.params as { eventId: string };

  return (
    <EventDetailScreen
      eventId={eventId}
      onBack={() => navigation.goBack()}
    />
  );
}

function EventsListWrapper() {
  const navigation = useNavigation<any>();

  return (
    <EventsScreen
      onEventPress={(event: EventListItem) =>
        navigation.navigate('EventDetail', { eventId: event.id })
      }
    />
  );
}

export default function EventsStackNavigator() {
  return (
    <PermissionGate module="events">
      <Stack.Navigator>
        <Stack.Screen
          name="EventsList"
          component={EventsListWrapper}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="EventDetail"
          component={EventDetailWrapper}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </PermissionGate>
  );
}
