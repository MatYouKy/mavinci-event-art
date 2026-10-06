import { useRoute, useNavigation } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../theme';
import EquipmentScreen, { EquipmentListItem } from '../screens/EquipmentScreen';
import EquipmentDetailScreen from '../screens/EquipmentDetailScreen';
import PermissionGate from '../components/PermissionGate';

export default function EquipmentStackNavigator() {
  const [selectedItem, setSelectedItem] = useState<{ id: string; isKit: boolean } | null>(null);

  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  useEffect(() => {
    if (route.params?.equipmentId) {
      setSelectedItem({ id: route.params.equipmentId, isKit: false });
      navigation.setParams({ equipmentId: undefined });
    }
  }, [route.params?.equipmentId, navigation]);
  return (
    <PermissionGate module="equipment">
      {selectedItem ? (
        <View style={styles.container}>
          <EquipmentDetailScreen
            equipmentId={selectedItem.id}
            isKit={selectedItem.isKit}
            onBack={() => setSelectedItem(null)}
          />
        </View>
      ) : (
        <View style={styles.container}>
          <EquipmentScreen
            onItemPress={(item: EquipmentListItem) =>
              setSelectedItem({ id: item.id, isKit: !!item.is_kit })
            }
          />
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
