import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { openInCrmWeb } from '../../navigation/navigationRef';
import { colors } from '../../theme';

/**
 * Karta imprezy (PDF dla kierownika imprezy) — ten sam wydruk co w CRM.
 * PDF powstaje na serwerze CRM; aplikacja otwiera go w przeglądarce (strona wydarzenia z `?karta=1`),
 * gdzie obowiązuje ta sama reguła dostępu co pulpit realizacji.
 */
export default function EventCardButton({ eventId }: { eventId: string }) {
  return (
    <TouchableOpacity
      onPress={() => openInCrmWeb(`/crm/events/${eventId}?karta=1`)}
      accessibilityRole="button"
      accessibilityLabel="Otwórz kartę imprezy do druku"
      style={{ marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: colors.background.secondary }}
    >
      <View>
        <Text style={{ color: colors.primary.gold, fontWeight: '600' }}>Karta imprezy (PDF) →</Text>
        <Text style={{ color: colors.text.secondary, fontSize: 12, marginTop: 2 }}>
          Harmonogram, kontakty, auta i trasy, zespół, sprzęt i wytyczne dla kierownika imprezy
        </Text>
      </View>
    </TouchableOpacity>
  );
}
