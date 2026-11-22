import React from 'react';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '../theme';
import InquiriesScreen from '../screens/InquiriesScreen';
import InquiryFunnelScreen from '../screens/InquiryFunnelScreen';
import InquiryWorkspaceScreen from '../screens/InquiryWorkspaceScreen';
import InquiryCalculationScreen, { type InquiryCalculationParams } from '../screens/InquiryCalculationScreen';
import TaskDetailScreen from '../screens/TaskDetailScreen';
import PermissionGate from '../components/PermissionGate';
import { useTabletLayout } from '../hooks/useTabletLayout';

export type InquiriesStackParamList = {
  InquiriesList: undefined;
  /** Zapytanie: tablet — karta zapytania jak w CRM i na Macu, telefon — karta zadania zapytania. */
  InquiryDetail: { taskId: string };
  /** Zadanie przy zapytaniu (z zakładki „Zadania” karty zapytania). */
  InquiryTask: { taskId: string };
  /** Edytor kalkulacji zapytania (tablet) z kontekstem zapytania. */
  InquiryCalculation: InquiryCalculationParams;
};

const Stack = createNativeStackNavigator<InquiriesStackParamList>();

/** Tablet — lejek zapytań jak w CRM (kolumny etapów z przeciąganiem, lista, przypisywanie, szczegóły); telefon — lista zapytań. */
function InquiriesHome() {
  const { tablet } = useTabletLayout();
  return tablet ? <InquiryFunnelScreen /> : <InquiriesScreen />;
}

/** Także z powiadomień, wiadomości, przetargów i Dysku (`navigateToInquiry`) — na tablecie pełna obsługa zapytania. */
function InquiryDetail(props: NativeStackScreenProps<InquiriesStackParamList, 'InquiryDetail'>) {
  const { tablet } = useTabletLayout();
  return tablet ? <InquiryWorkspaceScreen /> : <TaskDetailScreen route={props.route} navigation={props.navigation} />;
}

export default function InquiriesStackNavigator() {
  return (
    <PermissionGate module="inquiries">
      <Stack.Navigator
        initialRouteName="InquiriesList"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background.primary },
        }}
      >
        <Stack.Screen name="InquiriesList" component={InquiriesHome} />
        <Stack.Screen name="InquiryDetail" component={InquiryDetail} />
        <Stack.Screen name="InquiryTask" component={TaskDetailScreen} />
        <Stack.Screen name="InquiryCalculation" component={InquiryCalculationScreen} />
      </Stack.Navigator>
    </PermissionGate>
  );
}
