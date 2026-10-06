/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useEmployeeActivity } from '@/hooks/useEmployeeActivity';

interface AuthContextType {
  session: any;
  authUser: any;
  employeeId: string | null;
  loading: boolean;

  // ✅ activity
  getLastActivityAt: (employeeId: string) => string | null;
  lastActivityAtRef: Record<string, string>;

  // presence
  isOnline: (employeeId: string) => boolean;
  onlineIds: string[];

  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ONLINE_GRACE_MS = 10_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<any>(null);
  const [authUser, setAuthUser] = useState<any>(null);
  const [mappedEmployee, setMappedEmployee] = useState<{ userId: string; id: string } | null>(null);
  const authUserId: string | null = authUser?.id ?? null;
  const employeeId = mappedEmployee?.userId === authUserId ? mappedEmployee?.id ?? null : null;
  const [loading, setLoading] = useState(true);

  // presence
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const stopPresenceRef = useRef<(() => void) | null>(null);

  // {id: isoString}
  const lastActivityAtRef = useRef<Record<string, string>>({});

  // ✅ anti-flicker: pamiętamy kiedy user był ostatnio online
  const lastSeenOnlineRef = useRef<Record<string, number>>({}); // { [employeeId]: epochMs }

  // 1) init session + listener
  useEffect(() => {
    let disposed = false;
    let authChanged = false;
    // Register synchronously: cleanup must always have a subscription to remove.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (disposed) return;
      authChanged = true;
      setSession(newSession ?? null);
      setAuthUser(newSession?.user ?? null);
      setLoading(false);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (disposed || authChanged) return;
      if (error) console.error('[AuthProvider] session error:', error);
      setSession(data.session ?? null);
      setAuthUser(data.session?.user ?? null);
      setLoading(false);
    }).catch((error) => {
      if (disposed || authChanged) return;
      console.error('[AuthProvider] session error:', error);
      setLoading(false);
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, []);

  // 2) map auth user -> employees.id (wymaga employees.auth_user_id)
  useEffect(() => {
    const controller = new AbortController();
    setMappedEmployee(null);
    lastActivityAtRef.current = {};
    lastSeenOnlineRef.current = {};
    const run = async () => {
      if (!authUserId) return;

      const { data, error } = await supabase
        .from('employees')
        .select('id')
        .eq('auth_user_id', authUserId)
        .maybeSingle()
        .abortSignal(controller.signal);

      if (controller.signal.aborted) return;

      if (error) {
        console.error('[AuthProvider] employees lookup error:', error);
        return;
      }

      if (!data?.id) {
        console.warn(
          '[AuthProvider] mapped employeeId = null. Uzupełnij employees.auth_user_id dla tego authUser.id',
        );
        return;
      }

      setMappedEmployee({ userId: authUserId, id: data.id });
    };

    void run().catch((error) => {
      if (!controller.signal.aborted) console.error('[AuthProvider] employees lookup error:', error);
    });
    return () => controller.abort();
  }, [authUserId]);

  // Jedyny zapis aktywności pracownika w CRM.
  useEmployeeActivity(employeeId);

  // 3) presence socket (TYLKO raz)
  useEffect(() => {
    setOnlineIds([]);
    if (!authUserId || !employeeId) return;

    let disposed = false;
    let subscribed = false;
    let tracking = false;
    let interval: number | null = null;
    const clearHeartbeat = () => {
      if (interval !== null) window.clearInterval(interval);
      interval = null;
    };

    const channel = supabase.channel('presence:employees', {
      config: { presence: { key: employeeId } },
    });

    const updateOnlineFromState = () => {
      if (disposed) return;
      const state = channel.presenceState() as Record<string, any[]>;
      const ids = Object.keys(state);

      const now = Date.now();
      ids.forEach((id) => {
        lastSeenOnlineRef.current[id] = now;

        // ✅ presence może mieć kilka wpisów (różne taby). bierzemy najświeższe "at"
        const metas = state[id] || [];
        const latest = metas
          .map((m) => m?.at)
          .filter(Boolean)
          .sort()
          .at(-1);

        if (latest) lastActivityAtRef.current[id] = latest;
      });

      setOnlineIds(ids);
    };

    // sync already includes joins/leaves; do not process every change three times.
    channel.on('presence', { event: 'sync' }, updateOnlineFromState);

    const trackNow = async (active: boolean) => {
      if (disposed || !subscribed || tracking) return;
      tracking = true;
      try {
        await channel.track({
          employee_id: employeeId,
          at: new Date().toISOString(),
          active,
        });
      } catch (e) {
        // The next scheduled heartbeat retries; never create a retry loop.
      } finally {
        tracking = false;
      }
    };

    channel.subscribe((status) => {
      if (disposed) return;
      if (status === 'SUBSCRIBED') {
        if (subscribed) return;
        subscribed = true;
        clearHeartbeat();
        void trackNow(!document.hidden);
        updateOnlineFromState();

        // Create synchronously, so an awaited track cannot resurrect a cleaned-up timer.
        interval = window.setInterval(() => {
          if (!document.hidden) void trackNow(true);
        }, 30_000);
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        subscribed = false;
        clearHeartbeat();
      }
    });

    const onVis = () => {
      void trackNow(!document.hidden);
    };
    document.addEventListener('visibilitychange', onVis);

    presenceChannelRef.current = channel;

    const stop = () => {
      if (disposed) return;
      disposed = true;
      subscribed = false;
      clearHeartbeat();
      document.removeEventListener('visibilitychange', onVis);
      if (presenceChannelRef.current === channel) presenceChannelRef.current = null;
      if (stopPresenceRef.current === stop) stopPresenceRef.current = null;
      void supabase.removeChannel(channel).catch(() => {});
    };
    stopPresenceRef.current = stop;
    return stop;
  }, [authUserId, employeeId]);

  // ✅ grace: onlineIds + lastSeenOnlineRef (10s)
  const isOnline = (id: string) => {
    if (onlineIds.includes(id)) return true;

    const last = lastSeenOnlineRef.current[id];
    if (!last) return false;

    return Date.now() - last <= ONLINE_GRACE_MS;
  };

  const getLastActivityAt = (id: string) => lastActivityAtRef.current[id] ?? null;

  const signOut = async () => {
    stopPresenceRef.current?.();
    setOnlineIds([]);
    lastSeenOnlineRef.current = {};
    lastActivityAtRef.current = {};
    setSession(null);
    setAuthUser(null);
    setMappedEmployee(null);
    await supabase.auth.signOut({ scope: 'local' });
  };

  const value = useMemo<AuthContextType>(
    () => ({
      session,
      authUser,
      employeeId,
      loading,
      getLastActivityAt,
      lastActivityAtRef: lastActivityAtRef.current, // ✅ zwracamy Record
      isOnline,
      onlineIds,
      signOut,
    }),
    [session, authUser, employeeId, loading, onlineIds],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
