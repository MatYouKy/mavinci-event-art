import React from 'react';
import {
  View,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '../theme';

export default function PdfViewerScreen({ route }: any) {
  const { url } = route.params;

  return (
    <View style={styles.container}>
      <WebView
        source={{
          uri: url,
        }}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loader}>
            <ActivityIndicator
              size="large"
              color={colors.primary.gold}
            />
          </View>
        )}
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },

  webview: {
    flex: 1,
  },

  loader: {
    position: 'absolute',
    inset: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
});