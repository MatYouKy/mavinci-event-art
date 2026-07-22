import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../theme';
import EquipmentScreen, { EquipmentListItem } from '../screens/EquipmentScreen';
import EquipmentDetailScreen from '../screens/EquipmentDetailScreen';

export default function EquipmentStackNavigator() {
  const [selectedItem, setSelectedItem] = useState<{ id: string; isKit: boolean } | null>(null);

  if (selectedItem) {
    return (
      <View style={styles.container}>
        <EquipmentDetailScreen
          equipmentId={selectedItem.id}
          isKit={selectedItem.isKit}
          onBack={() => setSelectedItem(null)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <EquipmentScreen
        onItemPress={(item: EquipmentListItem) =>
          setSelectedItem({ id: item.id, isKit: !!item.is_kit })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
});
