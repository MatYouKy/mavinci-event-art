import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme';
import InquiriesScreen from '../screens/InquiriesScreen';
import TaskDetailScreen from '../screens/TaskDetailScreen';
import PermissionGate from '../components/PermissionGate';

export type InquiriesStackParamList = {
  InquiriesList: undefined;
  InquiryDetail: { taskId: string };
};

const Stack = createNativeStackNavigator<InquiriesStackParamList>();

export default function InquiriesStackNavigator() {
  return (
    <PermissionGate module="tasks">
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background.primary },
        }}
      >
        <Stack.Screen name="InquiriesList" component={InquiriesScreen} />
        <Stack.Screen name="InquiryDetail" component={TaskDetailScreen} />
      </Stack.Navigator>
    </PermissionGate>
  );
}
