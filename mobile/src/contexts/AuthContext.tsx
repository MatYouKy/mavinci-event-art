import React, { createContext, useState, useEffect, useContext, useRef } from 'react';
import { supabase, Employee } from '../lib/supabase';
import { Session } from '@supabase/supabase-js';
import { removeSyncedCrmContactsFromDevice } from '../services/crmContactSync';
import { useForegroundEffect } from '../hooks/useForegroundEffect';

interface AuthContextType {
  session: Session | null;
  employee: Employee | null;
  onlineEmployeeIds: string[];
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [lookup, setLookup] = useState<{ userId: string; employee: Employee | null } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const stopPresenceRef = useRef<(() => void) | null>(null);
  const removalRef = useRef<Promise<unknown>>(Promise.resolve());
  const [onlineEmployeeIds, setOnlineEmployeeIds] = useState<string[]>([]);
  const userId = session?.user.id ?? null;
  const email = session?.user.email ?? null;
  const employee = !signingOut && lookup?.userId === userId ? lookup?.employee ?? null : null;
  const loading = !sessionReady || (!signingOut && !!userId && lookup?.userId !== userId);

  useEffect(() => {
    let disposed = false;
    let authChanged = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (disposed) return;
      authChanged = true;
      if (signingOutRef.current) return;
      setSession(nextSession);
      setSessionReady(true);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (disposed || authChanged || signingOutRef.current) return;
      if (error) console.error('Error loading session:', error);
      setSession(data.session);
      setSessionReady(true);
    }).catch((error) => {
      if (disposed || authChanged || signingOutRef.current) return;
      console.error('Error loading session:', error);
      setSessionReady(true);
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, []);

  // Token refresh no longer starts another lookup. Results belong to one identity.
  useEffect(() => {
    setLookup(null);
    if (!userId || signingOut) return;
    const controller = new AbortController();
    lookupAbortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let disposed = false;

    const load = async () => {
      try {
        // Match the same authenticated employee identity used by CRM chat.
        const { data, error } = await supabase
          .from('employees')
          .select('*')
          .eq('auth_user_id', userId)
          .eq('is_active', true)
          .abortSignal(controller.signal)
          .maybeSingle();
        if (disposed || signingOutRef.current) return;
        if (error) throw error;
        setLookup({ userId, employee: data ?? null });
      } catch (error) {
        if (!disposed && !controller.signal.aborted) console.error('Error loading employee:', error);
      } finally {
        clearTimeout(timeout);
        if (!disposed && !signingOutRef.current) {
          setLookup((current) => current?.userId === userId ? current : { userId, employee: null });
        }
      }
    };
    void load();
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
      if (lookupAbortRef.current === controller) lookupAbortRef.current = null;
    };
  }, [userId, email, signingOut]);

  useForegroundEffect((signal) => {
    if (!employee?.id) return;
    const owner = employee.id;
    void supabase.rpc('get_my_realizations').abortSignal(signal).then(({data,error}) => {
      if (signal.aborted || error) return;
      setLookup(current => current?.employee?.id === owner ? {...current, employee: {...current.employee, has_realizations: Array.isArray(data) && data.length>0}} : current);
    });
  }, [employee?.id]);

  useForegroundEffect((signal) => {
    setOnlineEmployeeIds([]);
    if (!employee?.id) return;
    const employeeId = employee.id;
    let disposed = false;
    let subscribed = false;
    let running = false;
    let heartbeat: ReturnType<typeof setTimeout> | null = null;
    let request: AbortController | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retryDelay = 30_000;
    const alive = () => !disposed && !signal.aborted && !signingOutRef.current;
    const clearHeartbeat = () => {
      if (heartbeat !== null) clearTimeout(heartbeat);
      heartbeat = null;
    };

    const stop = () => {
      if (disposed) return;
      disposed = true;
      subscribed = false;
      clearHeartbeat();
      request?.abort();
      if (channel) {
        const ownedChannel = channel;
        channel = null;
        // Wait for removal before reusing the shared Presence topic on resume.
        removalRef.current = supabase.removeChannel(ownedChannel).catch(() => {});
      }
      if (stopPresenceRef.current === stop) stopPresenceRef.current = null;
    };
    stopPresenceRef.current = stop;

    const setup = async () => {
      await removalRef.current;
      if (!alive()) return;
      const ownedChannel = supabase.channel('presence:employees', {
        config: { presence: { key: employeeId } },
      });
      channel = ownedChannel;

      const syncOnlineEmployees = () => {
        if (!alive()) return;
        const state = ownedChannel.presenceState() as Record<string, any[]>;
        setOnlineEmployeeIds(Object.entries(state)
          .filter(([, entries]) => entries.some((entry) => entry?.active !== false))
          .map(([id]) => id));
      };

      const trackActivity = async () => {
        if (!alive() || !subscribed || running) return;
        clearHeartbeat();
        running = true;
        const controller = new AbortController();
        request = controller;
        const timeout = setTimeout(() => controller.abort(), 20_000);
        try {
          const now = new Date().toISOString();
          const results = await Promise.allSettled([
            ownedChannel.track({ employee_id: employeeId, active: true, at: now }),
            supabase.from('employees').update({ last_active_at: now })
              .eq('id', employeeId).abortSignal(controller.signal),
          ]);
          const failed = results[0].status === 'rejected'
            || (results[0].status === 'fulfilled' && results[0].value !== 'ok')
            || results[1].status === 'rejected'
            || (results[1].status === 'fulfilled' && !!results[1].value.error);
          retryDelay = failed ? Math.min(retryDelay * 2, 300_000) : 30_000;
        } finally {
          clearTimeout(timeout);
          if (request === controller) request = null;
          running = false;
          if (alive() && subscribed) heartbeat = setTimeout(() => void trackActivity(), retryDelay);
        }
      };

      ownedChannel.on('presence', { event: 'sync' }, syncOnlineEmployees)
        .subscribe((status) => {
          if (!alive()) return;
          if (status === 'SUBSCRIBED') {
            if (subscribed) return;
            subscribed = true;
            void trackActivity();
            syncOnlineEmployees();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            subscribed = false;
            clearHeartbeat();
            request?.abort();
          }
        });
    };

    void setup().catch((error) => {
      if (alive()) console.error('Error setting up presence:', error);
      stop();
    });
    return stop;
  }, [employee?.id, userId]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    stopPresenceRef.current?.();
    lookupAbortRef.current?.abort();
    setOnlineEmployeeIds([]);
    try {
      await removeSyncedCrmContactsFromDevice();
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      setSession(null);
      setLookup(null);
    } finally {
      signingOutRef.current = false;
      setSigningOut(false);
    }
  };

  return (
    <AuthContext.Provider value={{ session, employee, onlineEmployeeIds, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
