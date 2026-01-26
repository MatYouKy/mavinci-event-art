/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useEmployeeActivity } from '@/hooks/useEmployeeActivity'; // <- dopasuj ścieżkę do swojego hooka

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
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // presence
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // {id: isoString}
  const lastActivityAtRef = useRef<Record<string, string>>({});

  // ✅ anti-flicker: pamiętamy kiedy user był ostatnio online
  const lastSeenOnlineRef = useRef<Record<string, number>>({}); // { [employeeId]: epochMs }

  // 1) init session + listener
  useEffect(() => {
    let unsub: any;

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      setAuthUser(data.session?.user ?? null);
      setLoading(false);

      const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
        setSession(newSession ?? null);
        setAuthUser(newSession?.user ?? null);
      });

      unsub = sub.subscription;
    };

    init();

    return () => {
      if (unsub) unsub.unsubscribe();
    };
  }, []);

  // 2) map auth user -> employees.id (wymaga employees.auth_user_id)
  useEffect(() => {
    const run = async () => {
      setEmployeeId(null);

      if (!authUser?.id) return;

      const { data, error } = await supabase
        .from('employees')
        .select('id')
        .eq('auth_user_id', authUser.id)
        .maybeSingle();

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

      setEmployeeId(data.id);
    };

    run();
  }, [authUser?.id]);

  // ✅ heartbeat aktywności (Twoj hook)
  useEmployeeActivity(employeeId);

  // 3) presence socket (TYLKO raz)
  useEffect(() => {
    const cleanup = () => {
      if (presenceChannelRef.current) {
        supabase.removeChannel(presenceChannelRef.current);
        presenceChannelRef.current = null;
      }
      setOnlineIds([]);
      // nie czyścimy lastSeenOnlineRef – jest po to, żeby grace zadziałał
    };

    if (!session || !employeeId) {
      cleanup();
      return;
    }

    cleanup();

    const channel = supabase.channel('presence:employees', {
      config: { presence: { key: employeeId } },
    });

    const updateOnlineFromState = () => {
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

    channel
      .on('presence', { event: 'sync' }, updateOnlineFromState)
      .on('presence', { event: 'join' }, updateOnlineFromState)
      .on('presence', { event: 'leave' }, updateOnlineFromState);

    const trackNow = async (active: boolean) => {
      try {
        await channel.track({
          employee_id: employeeId,
          at: new Date().toISOString(),
          active,
        });
      } catch (e) {
        // ignore
      }
    };

    let interval: any = null;

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // ✅ od razu pingujemy, to naprawia refresh -> zielona
        await trackNow(!document.hidden);
        updateOnlineFromState();

        // ✅ co 30s ping, ale tylko jeśli karta aktywna
        interval = window.setInterval(() => {
          if (!document.hidden) trackNow(true);
        }, 30_000);
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('[presence] subscribe problem:', status);
      }
    });

    const onVis = () => {
      trackNow(!document.hidden);
    };
    document.addEventListener('visibilitychange', onVis);

    presenceChannelRef.current = channel;

    return () => {
      if (interval) window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
      cleanup();
    };
  }, [session, employeeId]);

  // ✅ grace: onlineIds + lastSeenOnlineRef (10s)
  const isOnline = (id: string) => {
    if (onlineIds.includes(id)) return true;

    const last = lastSeenOnlineRef.current[id];
    if (!last) return false;

    return Date.now() - last <= ONLINE_GRACE_MS;
  };

  const getLastActivityAt = (id: string) => lastActivityAtRef.current[id] ?? null;

  const signOut = async () => {
    if (presenceChannelRef.current) {
      supabase.removeChannel(presenceChannelRef.current);
      presenceChannelRef.current = null;
    }
    setOnlineIds([]);
    await supabase.auth.signOut();
    setSession(null);
    setAuthUser(null);
    setEmployeeId(null);
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