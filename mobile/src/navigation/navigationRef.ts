import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<any>();

export function navigateToChat(conversationId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Main', { screen: 'Messages', params: { conversationId } });
  }
}
