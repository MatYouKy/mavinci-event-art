import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TasksScreen from '../screens/TasksScreen';
import TaskDetailScreen from '../screens/TaskDetailScreen';

export type TasksStackParamList = {
  TasksList: undefined;
  TaskDetail: { taskId: string };
};

const Stack = createNativeStackNavigator<TasksStackParamList>();

export default function TasksStackNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="TasksList"
        component={TasksScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="TaskDetail"
        component={TaskDetailScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
