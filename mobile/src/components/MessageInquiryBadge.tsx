import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import EmployeeAvatar from './EmployeeAvatar';
import { colors } from '../theme';
import type { MessageSalesContext } from '../lib/messageSalesContext';

export default function MessageInquiryBadge({ inquiry }: { inquiry: MessageSalesContext['inquiries'][number] }) {
  const owner = inquiry.ownerName || 'Przypisany pracownik';
  return <View style={styles.row}>
    <Text style={styles.label}>W lejku{inquiry.archived ? ' · Archiwum' : ''}</Text>
    {inquiry.ownerId ? <View style={styles.row} accessibilityLabel={`Opiekun: ${owner}`}>
      <EmployeeAvatar avatarUrl={inquiry.ownerAvatarUrl} avatarMetadata={inquiry.ownerAvatarMetadata} employeeName={owner} size={28} />
      <Text style={styles.label}>{owner}</Text>
    </View> : <Text style={styles.label}>Bez opiekuna</Text>}
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  label: { color: colors.text.secondary, fontSize: 12 },
});
