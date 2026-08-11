import React, { createContext, useState, useEffect, useContext, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase, Employee } from '../lib/supabase';
import { Session } from '@supabase/supabase-js';

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
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [onlineEmployeeIds, setOnlineEmployeeIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        loadEmployee(session.user.email!);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        loadEmployee(session.user.email!);
      } else {
        setEmployee(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!employee?.id) {
      setOnlineEmployeeIds([]);
      return;
    }

    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let subscribed = false;
    const channel = supabase.channel('presence:employees', {
      config: { presence: { key: employee.id } },
    });

    const syncOnlineEmployees = () => {
      const state = channel.presenceState() as Record<string, any[]>;
      const activeIds = Object.entries(state)
        .filter(([, entries]) => entries.some((entry) => entry?.active !== false))
        .map(([employeeId]) => employeeId);
      setOnlineEmployeeIds(activeIds);
    };

    const trackActivity = async () => {
      if (!subscribed || appStateRef.current !== 'active') return;
      const now = new Date().toISOString();
      await Promise.allSettled([
        channel.track({ employee_id: employee.id, active: true, at: now }),
        supabase.from('employees').update({ last_active_at: now }).eq('id', employee.id),
      ]);
    };

    channel
      .on('presence', { event: 'sync' }, syncOnlineEmployees)
      .on('presence', { event: 'join' }, syncOnlineEmployees)
      .on('presence', { event: 'leave' }, syncOnlineEmployees)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          subscribed = true;
          void trackActivity();
          syncOnlineEmployees();
          heartbeat = setInterval(() => void trackActivity(), 30000);
        }
      });

    presenceChannelRef.current = channel;

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      if (nextState === 'active') {
        void trackActivity();
      } else if (subscribed) {
        void channel.untrack();
      }
    });

    return () => {
      if (heartbeat) clearInterval(heartbeat);
      appStateSubscription.remove();
      if (subscribed) void channel.untrack();
      void supabase.removeChannel(channel);
      if (presenceChannelRef.current === channel) presenceChannelRef.current = null;
      setOnlineEmployeeIds([]);
    };
  }, [employee?.id]);

  const loadEmployee = async (email: string) => {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('email', email)
        .eq('is_active', true)
        .maybeSingle();

      if (data && !error) {
        setEmployee(data);
      }
    } catch (error) {
      console.error('Error loading employee:', error);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
    setEmployee(null);
  };

  return (
    <AuthContext.Provider
      value={{ session, employee, onlineEmployeeIds, loading, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
