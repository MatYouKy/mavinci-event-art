import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { IUser, LoginResponse } from '../../types/auth.types';

interface AuthState {
  user_token: string | null;
  user: IUser | null;
  isAuthenticated: boolean;
}

const getUserFromStorage = (): IUser | null => {
  if (typeof window === 'undefined') return null;
  const savedUser = localStorage.getItem('user');
  if (savedUser) {
    try {
      return JSON.parse(savedUser);
    } catch (e) {
      return null;
    }
  }
  return null;
};

const initialState: AuthState = {
  user_token: typeof window !== 'undefined' ? localStorage.getItem('token') : null,
  user: getUserFromStorage(),
  isAuthenticated: typeof window !== 'undefined' ? !!localStorage.getItem('token') : false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (state, action: PayloadAction<LoginResponse>) => {
      const { token, user } = action.payload;
      state.user_token = token;
      state.user = user;
      state.isAuthenticated = true;
      if (typeof window !== 'undefined') {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
      }
    },
    logout: (state) => {
      state.user_token = null;
      state.user = null;
      state.isAuthenticated = false;
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    },
  },
});

export const { setCredentials, logout } = authSlice.actions;
export default authSlice.reducer;
