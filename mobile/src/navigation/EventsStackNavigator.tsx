import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../theme';
import EventsScreen, { EventListItem } from '../screens/EventsScreen';
import EventDetailScreen from '../screens/EventDetailScreen';
import PermissionGate from '../components/PermissionGate';

export default function EventsStackNavigator() {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  return (
    <PermissionGate module="events">
      {selectedEventId ? (
        <View style={styles.container}>
          <EventDetailScreen
            eventId={selectedEventId}
            onBack={() => setSelectedEventId(null)}
          />
        </View>
      ) : (
        <View style={styles.container}>
          <EventsScreen onEventPress={(event: EventListItem) => setSelectedEventId(event.id)} />
        </View>
      )}
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
});
