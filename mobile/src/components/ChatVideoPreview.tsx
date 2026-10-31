import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme';

function VideoContent({ uri, onRetry }: { uri: string; onRetry: () => void }) {
  const player = useVideoPlayer(uri, instance => { instance.play(); });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') player.pause();
    });
    return () => subscription.remove();
  }, [player]);

  // useVideoPlayer releases playback when the preview closes or retries.
  return (
    <View style={styles.content}>
      <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
      {(status === 'loading' || status === 'idle') && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.primary.gold} />
        </View>
      )}
      {status === 'error' && (
        <View style={styles.overlay}>
          <Text style={styles.message}>Nie udało się odtworzyć filmu. Sprawdź połączenie lub format pliku.</Text>
          <TouchableOpacity onPress={onRetry} style={styles.retry} accessibilityRole="button">
            <Text style={styles.retryText}>Spróbuj ponownie</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function ChatVideoPreview({ uri, onClose }: { uri: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [attempt, setAttempt] = useState(0);
  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Film</Text>
          <TouchableOpacity onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Zamknij film">
            <Feather name="x" size={26} color="#fff" />
          </TouchableOpacity>
        </View>
        <VideoContent key={`${uri}:${attempt}`} uri={uri} onRetry={() => setAttempt(value => value + 1)} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  title: { color: '#fff', fontSize: 17 },
  close: { padding: 12 },
  content: { flex: 1 },
  video: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#000' },
  message: { color: '#fff', textAlign: 'center', fontSize: 16, marginBottom: 20 },
  retry: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.primary.gold },
  retryText: { color: '#1c1015', fontSize: 16 },
});
