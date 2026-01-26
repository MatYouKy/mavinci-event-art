/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { supabase } from '@/lib/supabase/browser';

interface AuthContextType {
  session: any;
  authUser: any;
  employeeId: string | null;
  loading: boolean;

  // presence
  isOnline: (employeeId: string) => boolean;
  onlineIds: string[];

  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<any>(null);
  const [authUser, setAuthUser] = useState<any>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // presence
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // 2) map auth user -> employees.id
useEffect(() => {
  const run = async () => {
    setEmployeeId(null);

    if (!authUser?.id) {
      return;
    }

    const { data, error } = await supabase
      .from('employees')
      .select('id, email, auth_user_id')
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

// 3) presence socket
useEffect(() => {
  const cleanup = () => {
    if (presenceChannelRef.current) {
      supabase.removeChannel(presenceChannelRef.current);
      presenceChannelRef.current = null;
    }
    setOnlineIds([]);
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
    setOnlineIds(ids);
  };

  channel
    .on('presence', { event: 'sync' }, () => {
      updateOnlineFromState();
    })
    .on('presence', { event: 'join' }, (payload) => {
      updateOnlineFromState();
    })
    .on('presence', { event: 'leave' }, (payload) => {
      updateOnlineFromState();
    });

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      const trackRes = await channel.track({
        employee_id: employeeId,
        at: new Date().toISOString(),
      });

      updateOnlineFromState();
    }

    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.error('[presence] subscribe problem:', status);
    }
  });

  presenceChannelRef.current = channel;

  return () => cleanup();
}, [session, employeeId]);

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

      setEmployeeId(data?.id ?? null);
    };

    run();
  }, [authUser?.id]);

  // 3) presence socket
  useEffect(() => {
    const cleanup = () => {
      if (presenceChannelRef.current) {
        supabase.removeChannel(presenceChannelRef.current);
        presenceChannelRef.current = null;
      }
      setOnlineIds([]);
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
      setOnlineIds(ids);
    };

    channel
      .on('presence', { event: 'sync' }, () => {
        updateOnlineFromState();
      })
      .on('presence', { event: 'join' }, (payload) => {
        updateOnlineFromState();
      })
      .on('presence', { event: 'leave' }, (payload) => {
        updateOnlineFromState();
      });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        const trackRes = await channel.track({
          employee_id: employeeId,
          at: new Date().toISOString(),
        });
        updateOnlineFromState();
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('[presence] subscribe problem:', status);
      }
    });

    presenceChannelRef.current = channel;

    return () => cleanup();
  }, [session, employeeId]);

  const isOnline = (id: string) => onlineIds.includes(id);

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
    () => ({ session, authUser, employeeId, loading, isOnline, onlineIds, signOut }),
    [session, authUser, employeeId, loading, onlineIds],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}