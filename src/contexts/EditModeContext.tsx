'use client';

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { useAuth } from './AuthContext';

interface EditModeContextType {
  isEditMode: boolean;
  setIsEditMode: (value: boolean) => void;
  toggleEditMode: () => void;
}

const EditModeContext = createContext<EditModeContextType | undefined>(undefined);

export function EditModeProvider({ children }: { children: ReactNode }) {
  const { authUser } = useAuth();
  const userId: string | null = authUser?.id ?? null;
  const [mode, setMode] = useState<{ userId: string | null; enabled: boolean }>({ userId: null, enabled: false });
  // Editor controls cannot survive a sign-out or appear under another account,
  // even for the render before Navbar finishes resolving the new permissions.
  const isEditMode = Boolean(userId && mode.userId === userId && mode.enabled);

  useEffect(() => { setMode({ userId: null, enabled: false }); }, [userId]);
  const setIsEditMode = useCallback((value: boolean) => {
    setMode({ userId, enabled: Boolean(userId) && value });
  }, [userId]);
  const toggleEditMode = useCallback(() => {
    setMode((previous) => ({ userId, enabled: Boolean(userId) && !(previous.userId === userId && previous.enabled) }));
  }, [userId]);

  return (
    <EditModeContext.Provider value={{ isEditMode, setIsEditMode, toggleEditMode }}>
      {children}
    </EditModeContext.Provider>
  );
}

export function useEditMode() {
  const context = useContext(EditModeContext);
  if (context === undefined) {
    throw new Error('useEditMode must be used within an EditModeProvider');
  }
  return context;
}
