import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../theme';
import EventsScreen, { EventListItem } from '../screens/EventsScreen';
import EventDetailScreen from '../screens/EventDetailScreen';

export default function EventsStackNavigator() {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  if (selectedEventId) {
    return (
      <View style={styles.container}>
        <EventDetailScreen
          eventId={selectedEventId}
          onBack={() => setSelectedEventId(null)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <EventsScreen onEventPress={(event: EventListItem) => setSelectedEventId(event.id)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
});
