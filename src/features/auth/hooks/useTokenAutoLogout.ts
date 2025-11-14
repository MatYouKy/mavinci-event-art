
import { useAppDispatch } from '@/store/hooks';
import { useEffect } from 'react';
import { logout } from '../authSlice';
import { jwtDecode } from 'jwt-decode';

export const useTokenAutoLogout = () => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const checkToken = () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      try {
        const decoded = jwtDecode<{ exp: number }>(token);
        const timeUntilExpiry = decoded.exp * 1000 - Date.now();

        if (timeUntilExpiry <= 0) {
          dispatch(logout());
          return;
        }

        timeout = setTimeout(() => dispatch(logout()), timeUntilExpiry);
      } catch {
        dispatch(logout());
      }
    };

    checkToken();

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'token') {
        if (timeout) clearTimeout(timeout);
        checkToken();
      }
    };

    window.addEventListener('storage', onStorage);
    return () => {
      if (timeout) clearTimeout(timeout);
      window.removeEventListener('storage', onStorage);
    };
  }, [dispatch]);
};