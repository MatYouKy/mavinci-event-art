// src/features/auth/authSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { LoginResponse } from './auth.types';
import { IUser } from '@/types/auth.types';

const isBrowser = typeof window !== 'undefined';

function load<T>(key: string): T | null {
  if (!isBrowser) return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const initialState: Omit<LoginResponse, 'snackbar'> = {
  token: isBrowser ? window.localStorage.getItem('token') : null,
  user: load<IUser>('user'),
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (state, action: PayloadAction<LoginResponse>) => {
      const { token, user } = action.payload;
      state.token = token ?? null;
      state.user = user ?? null;
      if (isBrowser) {
        window.localStorage.setItem('token', token ?? '');
        window.localStorage.setItem('user', JSON.stringify(user ?? null));
      }
    },
    logout: (state) => {
      state.token = null;
      state.user = null;
      if (isBrowser) {
        window.localStorage.removeItem('token');
        window.localStorage.removeItem('user');
      }
    },
    // opcjonalnie: doładowanie ze storage po mount'cie (gdybyś chciał)
    hydrateFromStorage: (state) => {
      if (!isBrowser) return;
      state.token = window.localStorage.getItem('token');
      state.user = load<IUser>('user');
    },
  },
});

export const { setCredentials, logout, hydrateFromStorage } = authSlice.actions;
export default authSlice.reducer;