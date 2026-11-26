import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import { useTestMode } from '../lib/testMode';
import { exitTestMode } from '../lib/testModeApi';

/*
 * Pasek trybu testowego „widok jako” (`docs/test-mode.md`) — zawsze na górze, na środku ekranu (nad nawigacją): kogo
 * oglądamy i „Wyjdź z trybu”. Kolory jak w CRM (`TestModeBar.tsx`) i na Macu. Wyjście: okno postępu, potem komunikat.
 */

const COLORS = { background: '#2a1d05', accent: '#fcd34d', text: '#fef3c7', buttonText: '#1c1405' };
const TOP = initialWindowMetrics?.insets.top ?? (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 44);

export default function TestModeBanner() {
  const { testMode, switching } = useTestMode();
  const [exiting, setExiting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const exit = async () => {
    if (exiting) return;
    setExiting(true);
    try {
      await exitTestMode();
      setToast('Zakończono tryb testowy — wróciłeś do swojego widoku.');
    } catch {
      setToast('Nie udało się zakończyć trybu testowego. Spróbuj ponownie.');
    } finally {
      setExiting(false);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 3500);
    }
  };

  return (
    <>
      {testMode ? (
        <View pointerEvents="box-none" style={[styles.host, { top: TOP + 4 }]}>
          <View style={styles.pill} accessibilityRole="summary" accessibilityLabel={`Tryb testowy, widok: ${testMode.label}`}>
            <Feather name="eye" size={14} color={COLORS.accent} />
            <View style={styles.texts}>
              <Text style={styles.title}>TRYB TESTOWY</Text>
              <Text style={styles.label} numberOfLines={1}>{testMode.label || 'pracownik'}</Text>
            </View>
            <TouchableOpacity style={styles.button} onPress={() => void exit()} disabled={exiting || switching} accessibilityRole="button">
              {exiting || switching ? <ActivityIndicator size="small" color={COLORS.buttonText} /> : <Feather name="log-out" size={13} color={COLORS.buttonText} />}
              <Text style={styles.buttonText}>Wyjdź z trybu</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {toast ? (
        <View pointerEvents="none" style={[styles.host, { top: TOP + 4 }]}>
          <View style={styles.toast}>
            <Feather name="check-circle" size={16} color={COLORS.accent} />
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      ) : null}
      <Modal visible={exiting} transparent animationType="fade">
        <View style={styles.busy}>
          <View style={styles.busyBox}>
            <ActivityIndicator size="large" color={COLORS.accent} />
            <Text style={styles.busyText}>Wychodzę z trybu testowego…</Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 10000, elevation: 30, paddingHorizontal: 12 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 420, paddingLeft: 12, paddingRight: 4, paddingVertical: 4,
    borderRadius: 999, borderWidth: 1, borderColor: 'rgba(252, 211, 77, 0.6)', backgroundColor: 'rgba(42, 29, 5, 0.96)',
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  texts: { flexShrink: 1, minWidth: 0 },
  title: { color: COLORS.accent, fontSize: 10, fontWeight: '600', letterSpacing: 0.8 },
  label: { color: COLORS.text, fontSize: 12 },
  button: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999,
    backgroundColor: COLORS.accent,
  },
  buttonText: { color: COLORS.buttonText, fontSize: 12, fontWeight: '700' },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 420, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14,
    backgroundColor: 'rgba(42, 29, 5, 0.96)', borderWidth: 1, borderColor: 'rgba(252, 211, 77, 0.6)',
  },
  toastText: { color: COLORS.text, fontSize: 13, flexShrink: 1 },
  busy: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  busyBox: { alignItems: 'center', gap: 14, padding: 24, borderRadius: 16, backgroundColor: COLORS.background },
  busyText: { color: COLORS.text, fontSize: 15 },
});
