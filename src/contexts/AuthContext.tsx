'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { logout } from '@/features/auth/authSlice';


interface AuthContextType {
  user: any;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const { isAuthenticated, user_token, user: storeUser } = useAppSelector((state) => state.auth);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user_token && storeUser) {
      setUser(storeUser);
    } else if (user_token) {
      const savedUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
      if (savedUser) {
        try {
          setUser(JSON.parse(savedUser));
        } catch (e) {
          setUser({ token: user_token });
        }
      } else {
        setUser({ token: user_token });
      }
    } else {
      setUser(null);
    }
  }, [user_token, isAuthenticated, storeUser]);

  const signIn = async (email: string, password: string) => {
    return { error: null };
  };

  const signOut = async () => {
    dispatch(logout());
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
